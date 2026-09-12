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
  process: 'steps', workflow: 'steps', stepper: 'steps', 'how-it-works': 'steps',
  breadcrumb: 'crumbs', breadcrumbs: 'crumbs', crumb: 'crumb', trail: 'crumbs',
  milestone: 'event', milestones: 'timeline', history: 'timeline', chrono: 'timeline',
  review: 'testimonial', testimonials: 'testimonial',
  staff: 'team', 'our-team': 'team', 'team-member': 'member', member: 'member',
  timer: 'countdown', 'count-down': 'countdown', deadline: 'countdown',
  'price-list': 'pricelist', 'menu-list': 'pricelist', 'restaurant-menu': 'pricelist',
  skills: 'progress', 'progress-bars': 'progress', 'skill-bar': 'bar', 'progress-bar': 'bar', skill: 'bar',
  'star-rating': 'rating', stars: 'rating', score: 'rating',
  'opening-hours': 'hours', 'business-hours': 'hours', 'open-hours': 'hours', schedule: 'hours',
  'table-of-contents': 'toc', contents: 'toc', 'toc-item': 'tocitem',
  'author-box': 'author', 'about-author': 'author', 'author-bio': 'author', byline: 'author',
  'before-after': 'compare', 'image-compare': 'compare', twentytwenty: 'compare',
  'flip-box': 'flipbox', flip: 'flipbox', 'flip-card': 'flipbox',
  'site-header': 'header', 'page-header': 'header', masthead: 'header', topbar: 'header',
  'site-footer': 'footer', 'page-footer': 'footer', colophon: 'footer',
  wa: 'whatsapp', 'whats-app': 'whatsapp', 'wa-button': 'whatsapp', 'click-to-chat': 'whatsapp',
  'social-icons': 'social', 'social-links': 'social', share: 'social',
  handle: 'handle', 'social-link': 'handle',
  'logo-wall': 'logos', clients: 'logos', brands: 'logos', 'logo-cloud': 'logos',
  'image-grid': 'gallery', images: 'gallery', 'gallery-grid': 'gallery',
  cover: 'hero', jumbotron: 'hero', masthead: 'hero', 'banner-hero': 'hero',
  container: 'section', wrapper: 'section', block: 'section', group: 'section', div: 'section',
  video: 'embed', youtube: 'embed', iframe: 'embed',
  'google-map': 'map', 'map-embed': 'map',
  'call-to-action': 'cta', 'cta-section': 'cta',
  gap: 'spacer', space: 'spacer',
  contact: 'contact-info', 'contact-details': 'contact-info',
  catalog: 'products', 'product-grid': 'products', 'product-list': 'products',
  woocommerce: 'products', 'shop-loop': 'products',
  search: 'search', 'search-form': 'search', 'site-search': 'search',
  newsletter: 'newsletter', subscribe: 'newsletter', mailchimp: 'newsletter',
  pagination: 'pager', pager: 'pager', paginate: 'pager',
  cookie: 'consent', gdpr: 'consent', 'cookie-banner': 'consent',
  related: 'related', 'related-posts': 'related',
  comments: 'comments',
  advertisement: 'slot', 'ad-slot': 'slot', adsbygoogle: 'slot',
  login: 'auth', signup: 'auth', 'account-menu': 'auth',
  pre: 'code', snippet: 'code', 'code-block': 'code',
  'post-tags': 'tags', 'tag-list': 'tags', 'tag-cloud': 'tags'
};

/** Common model drift on PROP VALUES (v1.97): grok's demo — and any model
 * that learned animation names elsewhere — writes `slide-up` where our canon
 * says `rise`, `zoom-in` for `zoom`. Snapping those to the default killed
 * the animation silently; aliasing them is a dictionary fix, exactly what
 * the repair telemetry's PROP_ALIAS bucket is for. Keyed by prop name,
 * consulted BEFORE the enum snap. */
const PROP_VALUE_TWINS = {
  animate: {
    'slide-up': 'rise', slideup: 'rise', slide: 'rise', up: 'rise', rise_up: 'rise',
    'fade-in': 'fade', fadein: 'fade', appear: 'fade',
    'zoom-in': 'zoom', zoomin: 'zoom', scale: 'zoom', grow: 'zoom'
  },
  speed: { sm: 'slow', lg: 'fast', small: 'slow', large: 'fast' }
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
        // a known twin of a legal value is vocabulary drift, not an error —
        // alias it (and let the telemetry count a dictionary fix), only then
        // snap what is truly foreign to the default
        const twin = PROP_VALUE_TWINS[key] && PROP_VALUE_TWINS[key][String(v).toLowerCase()];
        if (twin !== undefined && schema.values.includes(twin)) {
          node.props[key] = twin;
          changes.push({ code: 'PROP_ALIAS', message: `<bent-${node.name}> "${key}"=${JSON.stringify(v)} → ${JSON.stringify(twin)}` });
        } else {
          const snap = schema.default !== undefined ? schema.default : schema.values[0];
          node.props[key] = snap;
          changes.push({ code: 'PROP_ENUM', message: `<bent-${node.name}> "${key}"=${JSON.stringify(v)} → ${JSON.stringify(snap)}` });
        }
      } else if (schema.type === 'integer' || schema.type === 'number') {
        let n = Number(v);
        if (!Number.isFinite(n)) n = schema.default != null ? schema.default : (schema.min != null ? schema.min : 0);
        if (schema.min != null && n < schema.min) n = schema.min;
        if (schema.max != null && n > schema.max) n = schema.max;
        if (n !== v) { node.props[key] = n; changes.push({ code: 'PROP_CLAMP', message: `<bent-${node.name}> "${key}" → ${n}` }); }
      }
    }
  });

  // 3.5) unclosed LEAVES (v2.28, seen live from a local model): a leaf module
  // written as an opener with no `/>` and no closer — `<bent-feature
  // title="…" text="…">` — swallows every sibling after it, each nested one
  // level deeper. A leaf (container:false) can never hold modules, so its
  // module children ARE the siblings that were meant to follow it: re-parent
  // them, in order, right after the leaf. Hoisting them to the page end (the
  // old path) threw the page's order away and still left E_NOT_CONTAINER
  // errors behind, so the whole paste was refused.
  const unnest = (list) => {
    for (let i = 0; i < list.length; i++) {
      const node = list[i];
      if (!isModule(node)) continue;
      const def = getModule(node.name);
      if (def && !def.container && node.children && node.children.length) {
        const kids = node.children.filter(isModule);
        node.children = node.children.filter((c) => !isModule(c));
        if (kids.length) {
          list.splice(i + 1, 0, ...kids);
          changes.push({ code: 'UNCLOSED_LEAF', message: `<bent-${node.name}> was left open — ${kids.length} module(s) written inside it now follow it` });
        }
        continue; // the moved siblings are visited next
      }
      if (node.children && node.children.length) unnest(node.children);
    }
  };
  unnest(doc.body);

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
// ── inline HTML → BenTML marks (v2.19, Ben's "הבנייה נכשלה: Raw HTML <b>") ──
// Inline formatting the models keep writing as HTML (<b>, <i>, <a>, <br>…)
// is MEANING, not markup noise. The old path either threw E_RAW_HTML or
// "fixed" it by tearing the words out of the sentence into hoisted bent-html
// blocks ("שלום <b>מודגש</b> עולם" → "שלום  עולם"). Convert to the language's
// own marks BEFORE the parser ever sees them. These tags are never legitimate
// .pzn structure, so a source-level pass is safe; escaped content
// (&lt;b&gt; inside bent-html attrs) is untouched by construction.
// Flat-mark rule: the renderer's marks don't nest — when an inner already
// carries braces/marks, keep the words and shed the shell.
const INLINE_MARK_TAGS = [
  { re: /<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)\s*>/gi, wrap: (t) => `@B{${t}}` },
  { re: /<(?:i|em)\b[^>]*>([\s\S]*?)<\/(?:i|em)\s*>/gi, wrap: (t) => `@I{${t}}` },
  { re: /<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi, wrap: (t) => `@CODE{${t}}` }
];

function normalizeInlineHtml(source) {
  let s = String(source);
  let changed = 0;
  // innermost-first: repeat until no inline tag remains
  let prev;
  do {
    prev = s;
    for (const t of INLINE_MARK_TAGS) {
      s = s.replace(t.re, (m, inner) => {
        changed++;
        const text = inner.trim();
        return /[{}]/.test(text) ? inner : t.wrap(text);
      });
    }
  } while (s !== prev);
  // <a href> → @LINK (after the loop, so its inner is already mark-clean)
  s = s.replace(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi,
    (m, d1, d2, inner) => {
      changed++;
      const url = (d1 || d2 || '').trim();
      const text = inner.replace(/<[^>]+>/g, '').trim();
      if (!url || /[{}]/.test(text)) return text; // flat marks only — keep the words
      return `@LINK(url: "${url.replace(/"/g, '')}"){${text}}`;
    });
  // a bare <a> without href carries nothing we can keep but its words
  s = s.replace(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi, (m, inner) => { changed++; return inner; });
  s = s.replace(/<br\s*\/?\s*>/gi, () => { changed++; return ' @BREAK '; });
  // benign wrappers: shed the shell, keep the words
  s = s.replace(/<\/?(?:u|span|font|mark|small|big|sub|sup)\b[^>]*>/gi, () => { changed++; return ''; });
  return { source: s, changed };
}

function repair(source) {
  const changes = [];
  if (typeof source !== 'string' || !source.trim()) {
    return { ok: false, changes, remaining: [], error: 'empty source' };
  }

  // tag-name typos (v2.28, seen live from a local model): `<bent-text">` — a
  // quote glued to the tag name turns a known module into an unknown one
  const typo = source.replace(/<(\/?bent-[a-z][a-z0-9-]*)"(?=[\s>\/])/gi, '<$1');
  if (typo !== source) {
    source = typo;
    changes.push({ code: 'TAG_TYPO', message: 'a stray quote after a tag name removed' });
  }

  const inline = normalizeInlineHtml(source);
  if (inline.changed) {
    source = inline.source;
    changes.push({
      code: 'INLINE_MARKS',
      message: `${inline.changed} inline HTML tag(s) (<b>/<i>/<a>/<br>…) → @B/@I/@LINK marks`
    });
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
