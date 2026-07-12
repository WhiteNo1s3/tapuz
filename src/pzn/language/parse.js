'use strict';

const { BentError } = require('./errors');
const { createDocument, createModule } = require('./ast');
const { unescapeHtml } = require('./escape');
const { getModuleByTag } = require('../modules/registry');

/**
 * Minimal HTML tokenizer for the benTML dialect.
 * Intentional: we parse our language, not the entire HTML living standard.
 */

/**
 * @param {string} source
 * @returns {object} document AST
 */
function parse(source) {
  if (source == null || typeof source !== 'string') {
    throw new BentError('E_SOURCE', 'Source must be a string');
  }

  const tokens = tokenize(source);
  return buildDocument(tokens, source);
}

/**
 * @typedef {{ kind: string, value?: string, name?: string, attrs?: Record<string,string>, selfClosing?: boolean, line: number, column: number }} Token
 */

/**
 * @param {string} source
 * @returns {Token[]}
 */
function tokenize(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let column = 1;

  const advance = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (source[i] === '\n') {
        line++;
        column = 1;
      } else {
        column++;
      }
      i++;
    }
  };

  const peek = (n = 0) => source[i + n];

  while (i < source.length) {
    if (source.startsWith('<!DOCTYPE', i) || source.startsWith('<!doctype', i)) {
      const startLine = line;
      const startCol = column;
      const end = source.indexOf('>', i);
      if (end === -1) throw new BentError('E_PARSE', 'Unclosed doctype', { line: startLine, column: startCol });
      tokens.push({ kind: 'doctype', value: source.slice(i, end + 1), line: startLine, column: startCol });
      advance(end + 1 - i);
      continue;
    }

    if (source.startsWith('<!--', i)) {
      const startLine = line;
      const startCol = column;
      const end = source.indexOf('-->', i + 4);
      if (end === -1) throw new BentError('E_PARSE', 'Unclosed comment', { line: startLine, column: startCol });
      advance(end + 3 - i);
      continue;
    }

    if (peek() === '<') {
      const startLine = line;
      const startCol = column;
      const end = source.indexOf('>', i);
      if (end === -1) throw new BentError('E_PARSE', 'Unclosed tag', { line: startLine, column: startCol });
      const raw = source.slice(i, end + 1);
      advance(end + 1 - i);

      if (raw.startsWith('</')) {
        const name = raw.slice(2, -1).trim().toLowerCase();
        tokens.push({ kind: 'close', name, line: startLine, column: startCol });
      } else {
        const selfClosing = /\/\s*>$/.test(raw);
        const inner = raw.slice(1, selfClosing ? raw.length - 2 : raw.length - 1).trim();
        const { name, attrs } = parseStartTag(inner, startLine, startCol);
        tokens.push({
          kind: 'open',
          name: name.toLowerCase(),
          attrs,
          selfClosing,
          line: startLine,
          column: startCol
        });
      }
      continue;
    }

    // text run until next <
    const startLine = line;
    const startCol = column;
    let j = i;
    while (j < source.length && source[j] !== '<') j++;
    const value = source.slice(i, j);
    advance(j - i);
    tokens.push({ kind: 'text', value, line: startLine, column: startCol });
  }

  return tokens;
}

/**
 * @param {string} inner
 * @param {number} line
 * @param {number} column
 */
function parseStartTag(inner, line, column) {
  const nameMatch = /^([^\s/>]+)/.exec(inner);
  if (!nameMatch) throw new BentError('E_PARSE', 'Tag without name', { line, column });
  const name = nameMatch[1];
  let rest = inner.slice(name.length).trim();
  /** @type {Record<string, string>} */
  const attrs = {};

  while (rest.length) {
    const m = /^([^\s=]+)\s*=\s*"([^"]*)"/.exec(rest)
      || /^([^\s=]+)\s*=\s*'([^']*)'/.exec(rest)
      || /^([^\s=]+)\s*=\s*([^\s"']+)/.exec(rest);
    if (m) {
      attrs[m[1]] = unescapeHtml(m[2]);
      rest = rest.slice(m[0].length).trim();
      continue;
    }
    const flag = /^([^\s/>]+)/.exec(rest);
    if (flag) {
      attrs[flag[1]] = '';
      rest = rest.slice(flag[0].length).trim();
      continue;
    }
    throw new BentError('E_PARSE', `Bad attribute near: ${rest.slice(0, 24)}`, { line, column });
  }

  return { name, attrs };
}

/**
 * @param {Token[]} tokens
 * @param {string} source
 */
function buildDocument(tokens, source) {
  const doc = createDocument();
  let i = 0;

  const skipWsText = () => {
    while (i < tokens.length && tokens[i].kind === 'text' && !tokens[i].value.trim()) i++;
  };

  // optional leading whitespace + doctype (template literals often start with \n)
  skipWsText();
  if (tokens[i]?.kind === 'doctype') i++;
  skipWsText();

  // html
  const htmlOpen = tokens[i];
  if (!htmlOpen || htmlOpen.kind !== 'open' || htmlOpen.name !== 'html') {
    // allow body-only fragments for builder ops / tests
    if (htmlOpen && htmlOpen.kind === 'open' && htmlOpen.name.startsWith('bent-')) {
      doc.body = parseModuleList(tokens, { i: 0 }, null);
      return doc;
    }
    throw new BentError('E_PARSE', 'Expected <html> root', {
      line: htmlOpen?.line,
      column: htmlOpen?.column
    });
  }
  i++;
  if (htmlOpen.attrs.lang) doc.lang = htmlOpen.attrs.lang;
  if (htmlOpen.attrs.dir) doc.dir = htmlOpen.attrs.dir;
  if (htmlOpen.attrs['bent-version']) doc.version = htmlOpen.attrs['bent-version'];

  skipWsText();

  // head
  if (tokens[i]?.kind === 'open' && tokens[i].name === 'head') {
    i++;
    while (i < tokens.length) {
      skipWsText();
      const t = tokens[i];
      if (!t) break;
      if (t.kind === 'close' && t.name === 'head') {
        i++;
        break;
      }
      if (t.kind === 'open' && t.name === 'title') {
        i++;
        let title = '';
        if (tokens[i]?.kind === 'text') {
          title = tokens[i].value;
          i++;
        }
        if (tokens[i]?.kind === 'close' && tokens[i].name === 'title') i++;
        doc.title = unescapeHtml(title).trim();
        continue;
      }
      if (t.kind === 'open' && t.name === 'meta') {
        const name = t.attrs.name || '';
        const content = t.attrs.content || '';
        if (name === 'bent-slug') doc.slug = content;
        else if (name === 'bent-tags') {
          doc.tags = content.split(',').map((s) => s.trim()).filter(Boolean);
        } else if (name === 'bent-teaser') doc.meta.teaser = content;
        else if (name === 'bent-card-image') doc.meta.cardImage = content;
        i++;
        if (!t.selfClosing && tokens[i]?.kind === 'close' && tokens[i].name === 'meta') i++;
        continue;
      }
      // skip other head tags
      if (t.kind === 'open') {
        const tag = t.name;
        i++;
        if (!t.selfClosing) {
          while (i < tokens.length && !(tokens[i].kind === 'close' && tokens[i].name === tag)) {
            i++;
          }
          if (tokens[i]?.kind === 'close') i++;
        }
        continue;
      }
      i++;
    }
  }

  skipWsText();

  // body
  if (tokens[i]?.kind === 'open' && tokens[i].name === 'body') {
    i++;
    const cursor = { i };
    doc.body = parseModuleList(tokens, cursor, 'body');
    i = cursor.i;
    if (tokens[i]?.kind === 'close' && tokens[i].name === 'body') i++;
  } else {
    throw new BentError('E_PARSE', 'Expected <body>', {
      line: tokens[i]?.line,
      column: tokens[i]?.column
    });
  }

  skipWsText();
  if (tokens[i]?.kind === 'close' && tokens[i].name === 'html') i++;

  return doc;
}

/**
 * Parse a sequence of modules until close of `untilClose` or EOF.
 * @param {Token[]} tokens
 * @param {{ i: number }} cursor
 * @param {string|null} untilClose
 */
function parseModuleList(tokens, cursor, untilClose) {
  const list = [];
  while (cursor.i < tokens.length) {
    const t = tokens[cursor.i];
    if (t.kind === 'text') {
      if (t.value.trim()) {
        throw new BentError(
          'E_RAW_TEXT',
          'Raw text in body is not allowed; wrap in <bent-text>',
          { line: t.line, column: t.column }
        );
      }
      cursor.i++;
      continue;
    }
    if (t.kind === 'close') {
      if (untilClose && t.name === untilClose) break;
      if (t.name.startsWith('bent-') || untilClose) break;
      throw new BentError('E_PARSE', `Unexpected closing tag </${t.name}>`, {
        line: t.line,
        column: t.column
      });
    }
    if (t.kind === 'open') {
      if (!t.name.startsWith('bent-')) {
        throw new BentError(
          'E_RAW_HTML',
          `Raw HTML <${t.name}> is not allowed in v0.1 body; use a bent-* module`,
          { line: t.line, column: t.column }
        );
      }
      list.push(parseModule(tokens, cursor));
      continue;
    }
    cursor.i++;
  }
  return list;
}

/**
 * @param {Token[]} tokens
 * @param {{ i: number }} cursor
 */
function parseModule(tokens, cursor) {
  const open = tokens[cursor.i];
  cursor.i++;
  const name = open.name.slice(5); // strip bent-
  const def = getModuleByTag(open.name);
  // unknown modules still parse (validate will reject)
  const attrs = { ...open.attrs };
  const id = attrs.id || '';
  const className = attrs.class || attrs.className || '';
  delete attrs.id;
  delete attrs.class;
  delete attrs.className;

  const props = {};
  for (const [k, v] of Object.entries(attrs)) {
    props[k] = coerceProp(def, k, v);
  }

  if (open.selfClosing) {
    return createModule(name, { id, className, props, text: '', children: [] });
  }

  // collect content: text and/or child modules
  let textParts = [];
  const children = [];

  while (cursor.i < tokens.length) {
    const t = tokens[cursor.i];
    if (t.kind === 'close' && t.name === open.name) {
      cursor.i++;
      break;
    }
    if (t.kind === 'close') {
      throw new BentError(
        'E_PARSE',
        `Expected </${open.name}>, got </${t.name}>`,
        { line: t.line, column: t.column }
      );
    }
    if (t.kind === 'text') {
      textParts.push(t.value);
      cursor.i++;
      continue;
    }
    if (t.kind === 'open' && t.name.startsWith('bent-')) {
      // if we already have significant text, keep it; mixed content allowed as text + children
      children.push(parseModule(tokens, cursor));
      continue;
    }
    if (t.kind === 'open') {
      throw new BentError(
        'E_RAW_HTML',
        `Raw HTML <${t.name}> inside module is not allowed`,
        { line: t.line, column: t.column }
      );
    }
    cursor.i++;
  }

  let text = unescapeHtml(textParts.join(''));
  // trim only pure-wrapper whitespace when children exist
  if (children.length) {
    if (!text.trim()) text = '';
  } else {
    // preserve intentional inner text; strip pretty-print wrapper newlines
    text = text.replace(/^\r?\n/, '').replace(/\r?\n[ \t]*$/, '');
    // if entire text is indentation whitespace only
    if (!text.trim()) text = '';
    else {
      // de-indent pretty-printed text blocks carefully: only if every line is empty or indented
      text = dedentPretty(text);
      // trailing indent-only residue from pretty close tags
      text = text.replace(/\r?\n[ \t]*$/, '');
    }
  }

  // map content prop default key "text" from body when schema marks content
  return createModule(name, { id, className, props, text, children });
}

function coerceProp(def, key, value) {
  if (!def || !def.props || !def.props[key]) return value;
  const schema = def.props[key];
  if (schema.type === 'integer' || schema.type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (schema.type === 'boolean') {
    if (value === '' || value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  }
  return value;
}

function dedentPretty(text) {
  const lines = text.split('\n');
  if (lines.length <= 1) return text;
  const indents = lines
    .filter((l) => l.trim().length)
    .map((l) => (l.match(/^[ \t]*/) || [''])[0].length);
  if (!indents.length) return text.trim() ? text : '';
  const min = Math.min(...indents);
  if (min === 0) return text;
  return lines
    .map((l) => (l.length >= min ? l.slice(min) : l))
    .join('\n')
    .replace(/^\n/, '')
    .replace(/\n$/, '');
}

module.exports = { parse, tokenize };
