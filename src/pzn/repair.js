'use strict';

/**
 * Repair engine (v0.49) — "auto-correct, then you apply".
 *
 * The strict validator is right to reject off-spec .pzn, but rejecting the
 * WHOLE document on one bad tag is why "saving doesn't work". This turns a
 * rejection into a best-effort corrected document + a human-readable change
 * list the caller surfaces for one-click approval. The server owns the
 * vocabulary (the Grokin principle): the model doesn't have to be perfect.
 *
 * Two failure classes:
 *   • parse-level  — raw HTML/text in the body throws before validation.
 *                    We wrap the raw runs into provisional <bent-html> blocks
 *                    (the escape hatch) and re-parse.
 *   • AST-level    — unknown module, missing/enum/range prop, duplicate id,
 *                    illegal nesting. We alias near-miss tags to real modules,
 *                    quarantine the truly-unknown, fill/snap/clamp props, dedupe
 *                    ids, and hoist illegally-nested children.
 *
 * repair(source) never throws for content reasons; it returns what it could
 * fix and what it could not (`remaining`). Only a totally unparseable shell
 * (no <body>, broken <html>) yields ok:false.
 */

const { parse, tokenize } = require('./language/parse');
const { serialize } = require('./language/serialize');
const { validate } = require('./language/validate');
const { escapeAttr } = require('./language/escape');
const { walk, isModule, createModule } = require('./language/ast');
const { getModule, moduleNames } = require('./modules/registry');

const KNOWN = new Set(moduleNames());

/** Common model drift: near-miss tag → the real module it meant. */
const ALIASES = {
  paragraph: 'text', p: 'text', para: 'text', copy: 'text', prose: 'text',
  subtitle: 'text', subheading: 'text', body: 'text',
  img: 'image', picture: 'image', photo: 'image', figure: 'image',
  anchor: 'button', link: 'button',
  ul: 'list', ol: 'list',
  li: 'item', 'list-item': 'item', listitem: 'item',
  headline: 'heading', title: 'heading', h: 'heading',
  separator: 'divider', hr: 'divider', rule: 'divider',
  blockquote: 'quote', 'block-quote': 'quote', pullquote: 'quote',
  callout: 'banner', notice: 'banner', alert: 'banner',
  accordion: 'faq', faqs: 'faq',
  question: 'qa', 'faq-item': 'qa',
  grid: 'columns', row: 'columns', 'two-column': 'columns', 'three-column': 'columns',
  column: 'col', cell: 'col',
  'icon-box': 'feature', service: 'feature', benefit: 'feature',
  metric: 'stat', number: 'stat', counter: 'stat', kpi: 'stat',
  metrics: 'stats', numbers: 'stats', counters: 'stats',
  review: 'testimonial', testimonials: 'testimonial',
  'logo-wall': 'logos', clients: 'logos', brands: 'logos', 'logo-cloud': 'logos',
  'image-grid': 'gallery', images: 'gallery', 'gallery-grid': 'gallery',
  cover: 'hero', jumbotron: 'hero', masthead: 'hero', 'banner-hero': 'hero',
  container: 'section', wrapper: 'section', block: 'section', group: 'section', div: 'section',
  video: 'embed', youtube: 'embed', iframe: 'embed',
  'google-map': 'map', 'map-embed': 'map',
  'call-to-action': 'cta', 'cta-section': 'cta',
  gap: 'spacer', space: 'spacer',
  contact: 'contact-info', 'contact-details': 'contact-info'
};

/** Common model drift on PROP names: url= for href=, src= for image=… (v0.69).
 * Twin adoption fires only when the schema key is EMPTY and the twin is not
 * itself a real prop of the module — same "server owns the vocabulary" move
 * as the tag ALIASES above. */
const PROP_TWINS = {
  href: ['url', 'link', 'to'],
  url: ['href', 'link'],
  image: ['src', 'img', 'background'],
  src: ['image', 'file'],
  poster: ['thumbnail', 'thumb'],
  content: ['text', 'body'],
  text: ['content', 'label']
};

/** Adopt obvious prop twins across a parsed doc. @returns change list */
function adoptPropTwins(doc) {
  const changes = [];
  walk(doc, (node) => {
    if (!isModule(node)) return;
    const def = getModule(node.name);
    if (!def || !def.props) return;
    for (const [key, twins] of Object.entries(PROP_TWINS)) {
      if (!def.props[key]) continue;
      const cur = node.props && node.props[key];
      if (cur !== undefined && cur !== null && cur !== '') continue;
      for (const tw of twins) {
        if (def.props[tw]) continue; // a real prop here — not drift
        const v = node.props && node.props[tw];
        if (v !== undefined && v !== null && v !== '') {
          node.props[key] = v;
          delete node.props[tw];
          changes.push({ code: 'PROP_ALIAS', message: `<bent-${node.name}> "${tw}" → "${key}"` });
          break;
        }
      }
    }
  });
  return changes;
}

/** HTML tags safe to keep as element names when quarantining unknowns. */
const HTML_TAGS = new Set([
  'div', 'span', 'p', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'section', 'article', 'header', 'footer', 'nav', 'aside', 'main', 'figure',
  'figcaption', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img', 'strong',
  'em', 'b', 'i', 'u', 'small', 'blockquote', 'code', 'pre', 'hr', 'br',
  'button', 'label', 'dl', 'dt', 'dd', 'video', 'audio', 'picture', 'source', 'mark'
]);

// ── token → HTML reconstruction (for raw wrapping) ──────────────────

function formatTokenAttrs(token) {
  const attrs = token.attrs || {};
  const out = [];
  for (const [k, v] of Object.entries(attrs)) {
    out.push(v === '' ? k : `${k}="${escapeAttr(v)}"`);
  }
  return out.length ? ' ' + out.join(' ') : '';
}

function tokenToHtml(t) {
  if (t.kind === 'text') return t.value;
  if (t.kind === 'doctype') return t.value;
  if (t.kind === 'close') return `</${t.name}>`;
  if (t.kind === 'open') return `<${t.name}${formatTokenAttrs(t)}${t.selfClosing ? ' /' : ''}>`;
  return '';
}

/** Capture a raw (non-bent) element and its whole subtree as an HTML string. */
function captureRawSubtree(tokens, i) {
  const open = tokens[i];
  i++;
  let html = tokenToHtml(open);
  if (open.selfClosing) return { html, i };
  let depth = 1;
  while (i < tokens.length && depth > 0) {
    const t = tokens[i];
    if (t.kind === 'open' && t.name === open.name && !t.selfClosing) { depth++; html += tokenToHtml(t); i++; }
    else if (t.kind === 'close' && t.name === open.name) { depth--; html += `</${open.name}>`; i++; }
    else { html += tokenToHtml(t); i++; }
  }
  return { html, i };
}

function htmlWrapper(raw) {
  return `<bent-html content="${escapeAttr(raw.trim())}" provisional="true" />`;
}

/**
 * Rebuild a token run into clean bent markup, wrapping raw HTML into
 * provisional bent-html. `bodyLevel` true means bare text is illegal (wrap it);
 * inside a bent element bare text is legit content (keep it).
 * @returns {{ out: string, i: number, wraps: number }}
 */
function rebuild(tokens, i, stopName, bodyLevel) {
  let out = '';
  let raw = '';
  let wraps = 0;
  const flush = () => {
    if (raw.trim()) { out += htmlWrapper(raw); wraps++; }
    raw = '';
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === 'close' && t.name === stopName) break;
    if (t.kind === 'text') {
      if (bodyLevel) raw += t.value;      // illegal at body level → quarantine
      else { flush(); out += t.value; }   // legit module text
      i++;
      continue;
    }
    if (t.kind === 'open' && t.name.startsWith('bent-')) {
      flush();
      const open = t;
      i++;
      const attrs = formatTokenAttrs(open);
      if (open.selfClosing) { out += `<${open.name}${attrs} />`; continue; }
      const inner = rebuild(tokens, i, open.name, false);
      wraps += inner.wraps;
      out += `<${open.name}${attrs}>${inner.out}</${open.name}>`;
      i = inner.i;
      if (tokens[i] && tokens[i].kind === 'close' && tokens[i].name === open.name) i++;
      continue;
    }
    if (t.kind === 'open') { const cap = captureRawSubtree(tokens, i); raw += cap.html; i = cap.i; continue; }
    if (t.kind === 'close') { raw += `</${t.name}>`; i++; continue; }
    if (t.kind === 'doctype') { i++; continue; }
    i++;
  }
  flush();
  return { out, i, wraps };
}

/**
 * Wrap raw HTML/text in the <body> into provisional bent-html blocks so the
 * document parses. Head and everything outside <body> stay byte-identical.
 */
function wrapRawHtmlSource(source) {
  const openM = /<body\b[^>]*>/i.exec(source);
  const closeM = /<\/body\s*>/i.exec(source);
  if (!openM || !closeM || closeM.index < openM.index) return { source, wraps: 0 };
  const bodyStart = openM.index + openM[0].length;
  const inner = source.slice(bodyStart, closeM.index);
  const tokens = tokenize(inner);
  const built = rebuild(tokens, 0, null, true);
  if (!built.wraps) return { source, wraps: 0 };
  const newSource = source.slice(0, bodyStart) + '\n' + built.out + '\n' + source.slice(closeM.index);
  return { source: newSource, wraps: built.wraps };
}

// ── AST-level module reconstruction (quarantine) ────────────────────

function moduleToRawHtml(node) {
  const tag = HTML_TAGS.has(node.name) ? node.name : 'div';
  const attrs = [];
  if (!HTML_TAGS.has(node.name)) attrs.push(`data-bent-was="${escapeAttr(node.name)}"`);
  for (const [k, v] of Object.entries(node.props || {})) {
    if (v === undefined || v === null || v === '') continue;
    attrs.push(`${k}="${escapeAttr(String(v))}"`);
  }
  const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
  const kids = (node.children || []).map(moduleToRawHtml).join('');
  const text = node.text ? escapeAttr(String(node.text)) : '';
  return `${open}${text}${kids}</${tag}>`;
}

// ── AST repair passes ───────────────────────────────────────────────

function repairAst(doc, changes) {
  // 1) dir
  if (doc.dir && doc.dir !== 'rtl' && doc.dir !== 'ltr') {
    changes.push({ code: 'E_DIR', message: `dir "${doc.dir}" → "rtl"` });
    doc.dir = 'rtl';
  }

  // 2) aliases + quarantine unknown modules (mutate in place via parent arrays)
  const fixNames = (list) => {
    for (const node of list) {
      if (!isModule(node)) continue;
      if (node.children && node.children.length) fixNames(node.children);
      if (KNOWN.has(node.name)) continue;
      const hMatch = /^h([1-6])$/.exec(node.name);
      if (hMatch) {
        changes.push({ code: 'ALIAS', message: `<bent-${node.name}> → <bent-heading level="${hMatch[1]}">` });
        node.props.level = Number(hMatch[1]);
        node.name = 'heading';
        continue;
      }
      const alias = ALIASES[node.name];
      if (alias) {
        changes.push({ code: 'ALIAS', message: `<bent-${node.name}> → <bent-${alias}>` });
        if (node.name === 'ol') node.props.ordered = true;
        node.name = alias;
        continue;
      }
      // truly unknown → quarantine into a provisional raw-HTML block
      const wasName = node.name;
      changes.push({ code: 'QUARANTINE', message: `<bent-${wasName}> unknown → provisional bent-html` });
      const html = moduleToRawHtml(node);
      node.name = 'html';
      node.children = [];
      node.text = '';
      node.props = { content: html, provisional: true, note: `was <bent-${wasName}>` };
    }
  };
  fixNames(doc.body);

  // 3) props: required/enum/range/type, per (now-aliased) module def
  changes.push(...adoptPropTwins(doc)); // url= → href= before fill/snap/clamp
  walk(doc, (node) => {
    if (!isModule(node)) return;
    const def = getModule(node.name);
    if (!def) return;
    for (const [key, schema] of Object.entries(def.props || {})) {
      if (schema.content || key === 'id' || key === 'class') continue;
      let v = node.props[key];
      const missing = v === undefined || v === null || v === '';
      if (missing) {
        if (!schema.optional && schema.default === undefined) {
          const fill = schema.type === 'url' ? '#'
            : schema.type === 'integer' || schema.type === 'number' ? (schema.min != null ? schema.min : 1)
              : schema.values ? schema.values[0] : '·';
          node.props[key] = fill;
          changes.push({ code: 'PROP_FILL', message: `<bent-${node.name}> missing "${key}" → ${JSON.stringify(fill)}` });
        }
        continue;
      }
      if (schema.type === 'enum' && schema.values && !schema.values.includes(String(v)) && !schema.values.includes(v)) {
        const snap = schema.default !== undefined ? schema.default : schema.values[0];
        node.props[key] = snap;
        changes.push({ code: 'PROP_ENUM', message: `<bent-${node.name}> "${key}"=${JSON.stringify(v)} → ${JSON.stringify(snap)}` });
      } else if (schema.type === 'integer' || schema.type === 'number') {
        let n = Number(v);
        if (!Number.isFinite(n)) n = schema.default != null ? schema.default : (schema.min != null ? schema.min : 0);
        if (schema.min != null && n < schema.min) n = schema.min;
        if (schema.max != null && n > schema.max) n = schema.max;
        if (n !== v) { node.props[key] = n; changes.push({ code: 'PROP_CLAMP', message: `<bent-${node.name}> "${key}" → ${n}` }); }
      }
    }
  });

  // 4) illegal nesting: hoist offending children to the document body
  const hoisted = [];
  const enforce = (list, parentDef) => {
    for (let idx = list.length - 1; idx >= 0; idx--) {
      const node = list[idx];
      if (!isModule(node)) continue;
      const def = getModule(node.name);
      if (parentDef) {
        const badChild = (parentDef.accept && parentDef.accept.length && !parentDef.accept.includes(node.name))
          || !parentDef.container;
        if (badChild) {
          list.splice(idx, 1);
          hoisted.push(node);
          changes.push({ code: 'HOIST', message: `<bent-${node.name}> not allowed here → moved to page end` });
          continue;
        }
      }
      if (def && node.children && node.children.length) enforce(node.children, def);
    }
  };
  enforce(doc.body, null);
  if (hoisted.length) {
    // hoisted children were collected in reverse; restore order
    hoisted.reverse();
    for (const n of hoisted) {
      const def = getModule(n.name);
      if (def && def.children && n.children) enforce(n.children, def);
    }
    doc.body.push(...hoisted);
  }

  // 5) duplicate / missing ids
  const seen = new Set();
  let counter = 0;
  walk(doc, (node) => {
    if (!isModule(node)) return;
    if (!node.id) { node.id = `${node.name}-${++counter}`; return; }
    if (seen.has(node.id)) {
      let n = 2;
      let candidate = `${node.id}-${n}`;
      while (seen.has(candidate)) candidate = `${node.id}-${++n}`;
      changes.push({ code: 'DEDUP_ID', message: `duplicate id "${node.id}" → "${candidate}"` });
      node.id = candidate;
    }
    seen.add(node.id);
  });

  return doc;
}

/**
 * Best-effort repair of .pzn source.
 * @param {string} source
 * @returns {{ ok: boolean, source?: string, changes: object[], remaining: object[], error?: string }}
 */
function repair(source) {
  const changes = [];
  if (typeof source !== 'string' || !source.trim()) {
    return { ok: false, changes, remaining: [], error: 'empty source' };
  }

  let doc;
  try {
    doc = parse(source);
  } catch (e) {
    // parse-level failure — try wrapping raw HTML, then re-parse
    const wrapped = wrapRawHtmlSource(source);
    if (wrapped.wraps) {
      changes.push({ code: 'WRAP_HTML', message: `wrapped ${wrapped.wraps} raw HTML block(s) into provisional bent-html` });
      try { doc = parse(wrapped.source); } catch (e2) {
        return { ok: false, changes, remaining: [], error: e2.message };
      }
    } else {
      return { ok: false, changes, remaining: [], error: e.message };
    }
  }

  repairAst(doc, changes);
  const remaining = validate(doc, { strict: false }).filter((i) => i.severity === 'error');
  return { ok: true, source: serialize(doc), changes, remaining };
}

module.exports = { repair, ALIASES, adoptPropTwins };
