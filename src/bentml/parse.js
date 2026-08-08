'use strict';

const { BentmlError } = require('./errors');
const { getKeyword, isReserved, UNIVERSAL } = require('./keywords');

/**
 * BenTML v0.1 parser — keyword language per docs/bentml-v0.md.
 * Output AST is independent of storage; compile.js maps to Tapuz JSON blocks.
 */

/**
 * @param {string} source
 */
function parse(source) {
  if (source == null || typeof source !== 'string') {
    throw new BentmlError('E001', 'Source must be a string');
  }
  // strip BOM
  let text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lines = text.split(/\r?\n/);
  const p = new Parser(lines);
  return p.parseDocument();
}

class Parser {
  constructor(lines) {
    this.lines = lines;
    this.i = 0;
    this.n = lines.length;
  }

  lineNo() {
    return this.i + 1;
  }

  peekRaw() {
    return this.i < this.n ? this.lines[this.i] : null;
  }

  /**
   * Skip blank and // comment lines (structural positions only).
   */
  skipStructural() {
    while (this.i < this.n) {
      const t = this.lines[this.i].trim();
      if (t === '' || t.startsWith('//')) {
        this.i++;
        continue;
      }
      break;
    }
  }

  parseDocument() {
    this.skipStructural();
    if (this.i >= this.n) {
      throw new BentmlError('E001', 'Empty document: missing BENTML version line', {
        line: 1,
        fix: 'BENTML 0.2'
      });
    }

    // version line
    const verLine = this.lines[this.i].trim();
    const verMatch = /^BENTML\s+(\d+)\.(\d+)\s*$/i.exec(verLine);
    if (!verMatch) {
      throw new BentmlError(
        'E001',
        `Expected version line "BENTML 0.2", found: ${verLine.slice(0, 40)}`,
        { line: this.lineNo(), fix: 'BENTML 0.2' }
      );
    }
    const major = parseInt(verMatch[1], 10);
    const minor = parseInt(verMatch[2], 10);
    if (major > 0) {
      throw new BentmlError('E002', `Unsupported BenTML major version ${major}.${minor}`, {
        line: this.lineNo()
      });
    }
    this.i++;

    this.skipStructural();
    const meta = this.parseMeta();
    const body = [];
    while (true) {
      this.skipStructural();
      if (this.i >= this.n) break;
      body.push(this.parseBlock(0, null));
    }

    return {
      version: { major, minor },
      meta,
      body
    };
  }

  parseMeta() {
    this.skipStructural();
    const start = this.lineNo();
    const head = this.lines[this.i] && this.lines[this.i].trim();
    if (!head || !/^META\s*\{?\s*$/i.test(head) && !/^META\s*\{/i.test(head)) {
      // allow META {
      if (!head || !/^META\b/i.test(head)) {
        throw new BentmlError('E111', 'Expected META block after version line', {
          line: start,
          fix: 'META {\n  title: "..."\n}'
        });
      }
    }

    // META { on same line or next
    let open = this.lines[this.i];
    if (!open.includes('{')) {
      this.i++;
      this.skipStructural();
      open = this.lines[this.i] || '';
      if (!open.includes('{')) {
        throw new BentmlError('E110', 'META requires a body { ... }', { line: this.lineNo() });
      }
    }
    // consume opening line
    const afterBrace = open.slice(open.indexOf('{') + 1);
    this.i++;

    const entries = {};
    let buf = afterBrace;
    // if closing on same line
    if (buf.includes('}')) {
      const inner = buf.slice(0, buf.indexOf('}'));
      this.parseMetaEntries(inner, entries, start);
      return normalizeMeta(entries, start);
    }

    if (buf.trim() && !buf.trim().startsWith('//')) {
      this.parseMetaLine(buf.trim(), entries, this.lineNo() - 1);
    }

    while (this.i < this.n) {
      const raw = this.lines[this.i];
      const t = raw.trim();
      if (t === '}') {
        this.i++;
        break;
      }
      if (t === '' || t.startsWith('//')) {
        this.i++;
        continue;
      }
      if (t.endsWith('}')) {
        const without = t.slice(0, t.lastIndexOf('}')).trim();
        if (without) this.parseMetaLine(without, entries, this.lineNo());
        this.i++;
        break;
      }
      this.parseMetaLine(t, entries, this.lineNo());
      this.i++;
    }

    return normalizeMeta(entries, start);
  }

  parseMetaEntries(inner, entries, line) {
    for (const part of inner.split('\n')) {
      const t = part.trim();
      if (!t || t.startsWith('//')) continue;
      this.parseMetaLine(t, entries, line);
    }
  }

  parseMetaLine(line, entries, lineNo) {
    const m = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      throw new BentmlError('E302', `Invalid META entry: ${line}`, { line: lineNo });
    }
    const key = m[1].toLowerCase();
    if (Object.prototype.hasOwnProperty.call(entries, key)) {
      throw new BentmlError('E302', `Duplicate META key "${key}"`, { line: lineNo });
    }
    entries[key] = parseValue(m[2].trim(), lineNo);
  }

  /**
   * @param {number} depth
   * @param {string|null} parentKw
   */
  parseBlock(depth, parentKw) {
    if (depth > 4) {
      throw new BentmlError('E105', 'Nesting depth exceeds 4', { line: this.lineNo() });
    }
    this.skipStructural();
    if (this.i >= this.n) {
      throw new BentmlError('E102', 'Unexpected end of document', { line: this.lineNo() });
    }

    const line = this.lines[this.i];
    const trimmed = line.trim();

    // bare prose at structural position
    if (!/^[A-Za-z]/.test(trimmed)) {
      throw new BentmlError(
        'E102',
        'Bare content is not allowed — every construct needs a keyword',
        { line: this.lineNo(), fix: 'TEXT { ... }' }
      );
    }

    // HTML {{{ fence
    if (/^HTML\s*\{\{\{\s*$/i.test(trimmed) || /^HTML\s*\{\{\{/.test(trimmed)) {
      return this.parseHtmlBlock(depth);
    }

    const head = parseKeywordHead(trimmed, this.lineNo());
    const kw = getKeyword(head.name);

    if (!kw) {
      if (isReserved(head.name)) {
        throw new BentmlError(
          'E201',
          `Keyword ${head.name.toUpperCase()} is reserved for a future version`,
          { line: this.lineNo() }
        );
      }
      throw new BentmlError('E201', `Unknown keyword ${head.name}`, {
        line: this.lineNo(),
        fix: 'Use HEADING, TEXT, IMAGE, BUTTON, ROW, LIST, … (see bentml-cheatsheet.md)'
      });
    }

    if (kw.childOnly && parentKw !== kw.parent) {
      throw new BentmlError(
        'E104',
        `${kw.name} is only allowed inside ${kw.parent}`,
        { line: this.lineNo() }
      );
    }

    const params = parseParams(head.paramsSrc, this.lineNo(), kw);
    // required params even when the list is empty (e.g. bare IMAGE)
    enforceRequiredParams(params, kw, this.lineNo());
    this.i++; // consumed head line (may continue body)

    // determine if body follows
    if (kw.body === 'NO-BODY') {
      // optional empty braces forbidden? braces after NO-BODY → E103
      this.skipStructural();
      const next = this.peekRaw();
      if (next && next.trim().startsWith('{') && !next.trim().startsWith('{{{')) {
        // could be next block? NO - { alone starts body
        if (/^\s*\{/.test(next) && !/^\s*\{\{\{/.test(next)) {
          // if it's `{` for body - error
          const onlyBrace = next.trim() === '{' || /^\{/.test(next.trim());
          // Actually next block could be on same... NO-BODY shouldn't have body.
          // If next line is `{` it's E103
          if (next.trim() === '{' || /^\{[^\{]/.test(next.trim()) || next.trim() === '{}') {
            throw new BentmlError('E103', `${kw.name} cannot have a body`, {
              line: this.lineNo() + 1
            });
          }
        }
      }
      // same-line rest after params — already consumed as no body
      if (head.inlineBody != null) {
        throw new BentmlError('E103', `${kw.name} cannot have a body`, { line: this.lineNo() - 1 });
      }
      return { kind: 'block', name: kw.name, params, children: [], text: '', depth };
    }

    // TEXT-BODY or BLOCK-BODY need body
    let bodyOpen = head.inlineBody;
    if (bodyOpen == null) {
      // find {
      this.skipStructural();
      if (this.i >= this.n) {
        throw new BentmlError('E110', `${kw.name} requires a body { ... }`, {
          line: this.lineNo()
        });
      }
      const bl = this.lines[this.i];
      const bi = bl.indexOf('{');
      if (bi === -1) {
        throw new BentmlError('E110', `${kw.name} requires a body { ... }`, {
          line: this.lineNo(),
          fix: `${kw.name} { ... }`
        });
      }
      bodyOpen = bl.slice(bi + 1);
      // if same line has closing
      if (bodyOpen.includes('}') && kw.body === 'TEXT-BODY') {
        // careful with escapes — simple path
        const close = findUnescapedClose(bodyOpen);
        if (close !== -1) {
          const text = unescapeText(bodyOpen.slice(0, close));
          this.i++;
          return {
            kind: 'block',
            name: kw.name,
            params,
            children: [],
            text,
            depth
          };
        }
      }
      if (bodyOpen.includes('}') && kw.body === 'BLOCK-BODY') {
        const before = bodyOpen.slice(0, bodyOpen.indexOf('}')).trim();
        if (!before) {
          this.i++;
          return { kind: 'block', name: kw.name, params, children: [], text: '', depth };
        }
      }
      this.i++;
      if (bodyOpen.trim() === '' || bodyOpen.trim().startsWith('//')) {
        bodyOpen = '';
      }
    }

    if (kw.body === 'TEXT-BODY') {
      const text = this.collectTextBody(bodyOpen);
      return { kind: 'block', name: kw.name, params, children: [], text, depth };
    }

    // BLOCK-BODY
    const children = this.collectBlockBody(bodyOpen, depth + 1, kw);
    return { kind: 'block', name: kw.name, params, children, text: '', depth };
  }

  collectTextBody(firstChunk) {
    const parts = [];
    let inlineStart = false;
    const scan = { inMark: false }; // a mark split across lines must not close the body
    if (firstChunk) {
      const close = findUnescapedClose(firstChunk, scan);
      if (close !== -1) {
        return unescapeText(firstChunk.slice(0, close));
      }
      parts.push(firstChunk);
      inlineStart = true;
    }
    while (this.i < this.n) {
      const line = this.lines[this.i];
      const close = findUnescapedClose(line, scan);
      if (close !== -1) {
        parts.push(line.slice(0, close));
        this.i++;
        break;
      }
      parts.push(line);
      this.i++;
    }
    // pretty-printed bodies: the closing brace's own indentation and the
    // common leading indent of body lines are layout, not content — dedent
    // so decompile → compile round-trips stay byte-stable
    if (parts.length > (inlineStart ? 1 : 0) && parts[parts.length - 1].trim() === '') {
      parts.pop();
    }
    let dedent = Infinity;
    for (let i = inlineStart ? 1 : 0; i < parts.length; i++) {
      const l = parts[i];
      if (!l.trim()) continue;
      dedent = Math.min(dedent, /^ */.exec(l)[0].length);
    }
    if (!Number.isFinite(dedent)) dedent = 0;
    const cleaned = parts.map((l, i) => {
      if (inlineStart && i === 0) return l;
      return l.trim() ? l.slice(dedent) : '';
    });
    // strip one leading newline from pretty open
    let text = cleaned.join('\n');
    if (text.startsWith('\n')) text = text.slice(1);
    if (text.endsWith('\n')) text = text.slice(0, -1);
    return unescapeText(text);
  }

  /**
   * @param {string} firstChunk
   * @param {number} childDepth
   * @param {object} parentKw
   */
  collectBlockBody(firstChunk, childDepth, parentKw) {
    const children = [];
    // leftover after { on open line
    if (firstChunk && firstChunk.trim() && !firstChunk.trim().startsWith('//')) {
      // if only `}` 
      const t = firstChunk.trim();
      if (t === '}') return children;
      if (t.endsWith('}') && !t.slice(0, -1).trim()) return children;
    }

    while (this.i < this.n) {
      this.skipStructural();
      if (this.i >= this.n) {
        throw new BentmlError('E110', `Unclosed body for ${parentKw.name}`, {
          line: this.lineNo()
        });
      }
      const t = this.lines[this.i].trim();
      if (t === '}') {
        this.i++;
        break;
      }
      // child block
      const child = this.parseBlock(childDepth, parentKw.name);
      if (parentKw.children && parentKw.children.length) {
        if (!parentKw.children.includes(child.name)) {
          throw new BentmlError(
            'E104',
            `${parentKw.name} cannot contain ${child.name} (allowed: ${parentKw.children.join(', ')})`,
            { line: this.lineNo() }
          );
        }
      }
      children.push(child);
    }
    return children;
  }

  parseHtmlBlock(depth) {
    // HTML {{{ ... }}}
    const start = this.lineNo();
    let line = this.lines[this.i];
    const idx = line.indexOf('{{{');
    let first = line.slice(idx + 3);
    this.i++;
    const parts = [];
    if (first.trim() && !first.includes('}}}')) {
      parts.push(first.replace(/^\n/, ''));
    } else if (first.includes('}}}')) {
      const raw = first.slice(0, first.indexOf('}}}'));
      return { kind: 'block', name: 'HTML', params: {}, children: [], text: raw, depth };
    }
    while (this.i < this.n) {
      const l = this.lines[this.i];
      if (l.trim() === '}}}') {
        this.i++;
        break;
      }
      parts.push(l);
      this.i++;
    }
    return {
      kind: 'block',
      name: 'HTML',
      params: {},
      children: [],
      text: parts.join('\n'),
      depth
    };
  }
}

function parseKeywordHead(trimmed, lineNo) {
  // KEYWORD / KEYWORD(params) / KEYWORD(params) { body } / KEYWORD { body }
  const m = /^([A-Za-z][A-Za-z0-9]*)\b/.exec(trimmed);
  if (!m) {
    throw new BentmlError('E102', `Expected keyword, found: ${trimmed.slice(0, 40)}`, {
      line: lineNo
    });
  }
  const name = m[1];
  let rest = trimmed.slice(m[0].length).trim();
  let paramsSrc = '';
  let inlineBody = null;

  if (rest.startsWith('(')) {
    const end = findMatchingParen(rest, 0);
    if (end === -1) {
      throw new BentmlError('E301', 'Unclosed parameter list', { line: lineNo });
    }
    paramsSrc = rest.slice(1, end);
    rest = rest.slice(end + 1).trim();
  }

  if (rest.startsWith('{')) {
    inlineBody = rest.slice(1);
    // if closed on same line handled by caller via findUnescapedClose
  } else if (rest !== '') {
    // trailing garbage
    throw new BentmlError('E301', `Unexpected tokens after ${name}: ${rest}`, { line: lineNo });
  }

  return { name, paramsSrc, inlineBody };
}

function findMatchingParen(s, openIdx) {
  let depth = 0;
  let inStr = false;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Find the body-closing `}` — skipping inline-mark spans (`@B{…}`, `@I{…}`,
 * `@CODE{…}`, `@LINK(url: "…"){…}`), whose own closing brace must never
 * terminate the body: `TEXT { @B{כותרת} — המשך }` ends at the LAST brace.
 * Marks are flat (renderInlineMarks forbids braces inside them), so one
 * boolean of nesting suffices. Pass `state` ({inMark}) to carry a mark that
 * a line break split in half; stateless calls scan a fresh single line.
 */
function findUnescapedClose(s, state) {
  let inMark = state ? !!state.inMark : false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inMark) {
      if (c === '}') inMark = false;
      continue;
    }
    if (c === '@') {
      const m = /^@[A-Za-z]+(\([^)]*\))?\{/.exec(s.slice(i));
      if (m) {
        inMark = true;
        i += m[0].length - 1;
      }
      continue;
    }
    if (c === '}') {
      if (state) state.inMark = inMark;
      return i;
    }
  }
  if (state) state.inMark = inMark;
  return -1;
}

function unescapeText(s) {
  return String(s)
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/\\@/g, '@')
    .replace(/\\\\/g, '\\');
}

/**
 * @param {string} src
 * @param {number} lineNo
 * @param {object} kw
 */
function parseParams(src, lineNo, kw) {
  const out = {};
  if (!src || !src.trim()) return out;
  // split on commas not in strings
  const parts = splitParams(src);
  for (const part of parts) {
    const t = part.trim();
    if (!t) continue; // trailing comma
    const m = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/s.exec(t);
    if (!m) {
      throw new BentmlError('E301', `Invalid parameter: ${t}`, {
        line: lineNo,
        fix: 'name: value'
      });
    }
    const key = m[1].toLowerCase();
    const val = parseValue(m[2].trim(), lineNo);
    out[key] = val;
  }

  const schema = kw.params || {};
  for (const [key, def] of Object.entries(schema)) {
    if (out[key] !== undefined && def.values && !def.values.map(String).includes(String(out[key]))) {
      throw new BentmlError(
        'E305',
        `Invalid value for ${key}: ${out[key]} (allowed: ${def.values.join('|')})`,
        { line: lineNo }
      );
    }
    if (out[key] !== undefined && def.type === 'integer') {
      const n = Number(out[key]);
      if (!Number.isInteger(n)) {
        throw new BentmlError('E305', `${key} must be an integer`, { line: lineNo });
      }
      out[key] = n;
    }
  }

  return out;
}

function enforceRequiredParams(params, kw, lineNo) {
  const schema = kw.params || {};
  for (const [key, def] of Object.entries(schema)) {
    if (def.required && (params[key] === undefined || params[key] === '')) {
      throw new BentmlError('E306', `Missing required parameter "${key}" on ${kw.name}`, {
        line: lineNo,
        fix: `${kw.name}(${key}: "...")`
      });
    }
  }
}

function splitParams(src) {
  const parts = [];
  let cur = '';
  let inStr = false;
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      cur += c;
      if (c === '\\') {
        i++;
        if (i < src.length) cur += src[i];
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      cur += c;
      continue;
    }
    if (c === '[') {
      depth++;
      cur += c;
      continue;
    }
    if (c === ']') {
      depth--;
      cur += c;
      continue;
    }
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function parseValue(raw, lineNo) {
  if (raw === '') return '';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (raw.startsWith('[')) {
    try {
      return JSON.parse(raw.replace(/'/g, '"'));
    } catch {
      throw new BentmlError('E305', `Invalid list value: ${raw}`, { line: lineNo });
    }
  }
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      // fallback strip quotes
      if (raw.endsWith('"')) return raw.slice(1, -1).replace(/\\"/g, '"');
      throw new BentmlError('E305', `Unclosed string: ${raw}`, { line: lineNo });
    }
  }
  // bare enum/ident
  return raw;
}

function normalizeMeta(entries, line) {
  if (entries.title == null || entries.title === '') {
    throw new BentmlError('E306', 'META requires title', {
      line,
      fix: 'title: "כותרת העמוד"'
    });
  }
  const direction = entries.direction || 'rtl';
  if (direction !== 'rtl' && direction !== 'ltr') {
    throw new BentmlError('E305', 'direction must be rtl|ltr', { line });
  }
  let slug = entries.slug;
  if (slug == null || slug === '') {
    slug = deriveSlug(String(entries.title));
  } else {
    validateExplicitSlug(String(slug), line);
  }
  const status = entries.status || 'draft';
  if (status !== 'draft' && status !== 'published') {
    throw new BentmlError('E305', 'status must be draft|published', { line });
  }
  const lang = entries.lang || (direction === 'rtl' ? 'he' : 'en');
  return {
    title: String(entries.title),
    slug: String(slug),
    direction,
    theme: entries.theme != null ? String(entries.theme) : 'default',
    description: entries.description != null ? String(entries.description) : '',
    ogimage: entries.ogimage != null ? String(entries.ogimage) : '',
    seotitle: entries.seotitle != null ? String(entries.seotitle) : '',
    robots: entries.robots != null ? String(entries.robots) : '',
    teaser: entries.teaser != null ? String(entries.teaser) : '',
    cardimage: entries.cardimage != null ? String(entries.cardimage) : '',
    tags: Array.isArray(entries.tags) ? entries.tags.map(String) : [],
    status,
    lang,
    author: entries.author != null ? String(entries.author) : '',
    date: entries.date != null ? String(entries.date) : ''
  };
}

function deriveSlug(title) {
  let s = title.trim();
  s = s.replace(/\s+/g, '-');
  s = s.replace(/[—–]/g, '-');
  s = s.replace(/["'?!,.()\[\]{}\/\\:;&#$%*+=|<>@^~`]/g, '');
  s = s.replace(/[A-Z]/g, (c) => c.toLowerCase());
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s || 'page';
}

function validateExplicitSlug(slug, line) {
  if (!slug || /\s/.test(slug) || /["'?!,.()\[\]{}\/\\:;&#$%*+=|<>@^~`]/.test(slug)) {
    throw new BentmlError('E308', `Invalid explicit slug: ${slug}`, { line });
  }
}

module.exports = {
  parse,
  deriveSlug
};
