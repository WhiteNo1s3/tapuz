'use strict';

/**
 * Intent → .pzn translator (the Grokin trick, Tapuziel edition).
 *
 * Grokin's key insight: the model emits a small, forgiving INTENT spec, and
 * the SERVER owns the real page vocabulary. Small models stay fast and
 * reliable because they never have to get the full syntax exactly right —
 * they describe sections, we serialize the canonical .pzn.
 *
 * Intent shape (all fields optional unless noted):
 *   {
 *     title: string,            // page <title>
 *     slug: string,             // bent-slug (derived from title if absent)
 *     lang: 'he'|'en', dir: 'rtl'|'ltr',
 *     tags: string[], teaser: string, cardImage: string,
 *     sections: [ { type, ...fields }, ... ]   // required, ≥1
 *   }
 *
 * Section types and their fields (everything HTML-escaped at serialize time):
 *   hero      { heading, text, buttonText, buttonHref, image, height, overlay, parallax }
 *   heading   { text, level, align, animate }
 *   text      { text, align, animate }
 *   image     { src, alt, caption, width }
 *   button    { text, href, variant, align }
 *   marquee   { text, speed }
 *   parallax  { image, overlay, height, sections:[...] }   // nested intent sections
 *   features  { columns, items:[{ title, icon, text }] }
 *   stats     { columns, items:[{ value, label }] }
 *   cta       { title, text, buttonText, href, tone }
 *   quote     { text, author }
 *   list      { ordered, items:[string] }
 *   columns   { gap, cols:[ { width, sections:[...] } ] }
 *   embed     { url }
 *   map       { address, zoom, height }
 *
 * Output is validated (parse + validate) before return; invalid intent throws
 * a BentError-shaped error the caller surfaces to the agent for self-repair.
 */

const { parse } = require('./language/parse');
const { validate } = require('./language/validate');
const { escapeHtml, escapeAttr } = require('./language/escape');

function esc(s) {
  return escapeHtml(String(s == null ? '' : s));
}
function attr(s) {
  return escapeAttr(String(s == null ? '' : s));
}

let uid = 0;
let sectionCount = 0;
const MAX_DEPTH = 6;        // hero>parallax>columns>… — real pages never nest deeper
const MAX_SECTIONS = 250;   // total module cap per build (DoS guard)

function nextId(prefix) {
  uid += 1;
  return `${prefix}-${uid}`;
}

/**
 * Slug that can NEVER escape the pages directory: strips path separators
 * (incl. backslash on Windows), collapses '..', drops leading dots.
 */
function deriveSlug(title) {
  return String(title || 'page')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[\\/:*?"<>|#]/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '')
    .slice(0, 80) || 'page';
}

/** Neutralize executable URL schemes on clickable-link fields. */
function safeUrl(v) {
  const s = String(v == null ? '' : v).trim();
  if (/^(?:javascript|data|vbscript):/i.test(s)) return '#';
  return s;
}

function attrList(pairs) {
  // pairs: [[name, value, includeWhen]]
  const out = [];
  for (const [name, value, include] of pairs) {
    if (include === false) continue;
    if (value === undefined || value === null || value === '') continue;
    out.push(`${name}="${attr(value)}"`);
  }
  return out.length ? ' ' + out.join(' ') : '';
}

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(n, min), max);
}

/**
 * Serialize one intent section to .pzn markup (indented `pad`).
 * @returns {string}
 */
function section(s, pad = '    ', depth = 0) {
  if (!s || typeof s !== 'object' || !s.type) return '';
  if (depth > MAX_DEPTH) {
    const e = new Error(`intent nesting exceeds ${MAX_DEPTH} levels`);
    e.code = 'E_INTENT_TOO_DEEP';
    throw e;
  }
  if (++sectionCount > MAX_SECTIONS) {
    const e = new Error(`intent exceeds ${MAX_SECTIONS} sections`);
    e.code = 'E_INTENT_TOO_LARGE';
    throw e;
  }
  const t = String(s.type).toLowerCase();
  const inner = pad + '  ';

  switch (t) {
    case 'hero': {
      const a = attrList([
        ['id', s.id || nextId('hero')],
        ['image', s.image],
        ['height', s.height],
        ['overlay', s.overlay != null ? clampInt(s.overlay, 0, 80, 0) : ''],
        ['parallax', s.parallax ? 'true' : '', !!s.parallax]
      ]);
      const kids = [];
      if (s.heading) kids.push(`${inner}<bent-heading id="${attr(nextId('h'))}" level="1">${esc(s.heading)}</bent-heading>`);
      if (s.text) kids.push(`${inner}<bent-text id="${attr(nextId('t'))}">${esc(s.text)}</bent-text>`);
      if (s.buttonText) {
        kids.push(`${inner}<bent-button id="${attr(nextId('b'))}" href="${attr(safeUrl(s.buttonHref) || '#')}" variant="${attr(s.variant || 'primary')}">${esc(s.buttonText)}</bent-button>`);
      }
      return `${pad}<bent-hero${a}>\n${kids.join('\n')}\n${pad}</bent-hero>`;
    }
    case 'heading': {
      const a = attrList([
        ['id', s.id || nextId('h')],
        ['level', clampInt(s.level, 1, 6, 2)],
        ['align', s.align && s.align !== 'start' ? s.align : ''],
        ['animate', s.animate && s.animate !== 'none' ? s.animate : '']
      ]);
      return `${pad}<bent-heading${a}>${esc(s.text)}</bent-heading>`;
    }
    case 'text': {
      const a = attrList([
        ['id', s.id || nextId('t')],
        ['align', s.align && s.align !== 'start' ? s.align : ''],
        ['animate', s.animate && s.animate !== 'none' ? s.animate : '']
      ]);
      return `${pad}<bent-text${a}>${esc(s.text)}</bent-text>`;
    }
    case 'image': {
      const a = attrList([
        ['id', s.id || nextId('img')],
        ['src', s.src],
        ['alt', s.alt],
        ['caption', s.caption],
        ['width', s.width && s.width !== 'full' ? s.width : '']
      ]);
      return `${pad}<bent-image${a} />`;
    }
    case 'button': {
      const a = attrList([
        ['id', s.id || nextId('b')],
        ['href', safeUrl(s.href) || '#'],
        ['variant', s.variant || 'primary'],
        ['align', s.align && s.align !== 'start' ? s.align : '']
      ]);
      return `${pad}<bent-button${a}>${esc(s.text || '')}</bent-button>`;
    }
    case 'marquee': {
      const a = attrList([
        ['id', s.id || nextId('mq')],
        ['speed', s.speed && s.speed !== 'md' ? s.speed : '']
      ]);
      return `${pad}<bent-marquee${a}>${esc(s.text || '')}</bent-marquee>`;
    }
    case 'parallax': {
      const a = attrList([
        ['id', s.id || nextId('px')],
        ['image', s.image],
        ['overlay', s.overlay != null ? clampInt(s.overlay, 0, 80, 0) : ''],
        ['height', s.height && s.height !== 'md' ? s.height : '']
      ]);
      const kids = (s.sections || []).map((c) => section(c, inner, depth + 1)).filter(Boolean);
      return `${pad}<bent-parallax${a}>\n${kids.join('\n')}\n${pad}</bent-parallax>`;
    }
    case 'features': {
      const a = attrList([
        ['id', s.id || nextId('feat')],
        ['columns', clampInt(s.columns, 1, 4, 3)]
      ]);
      const kids = (s.items || []).map((it) => {
        const ia = attrList([
          ['id', nextId('f')],
          ['title', it.title],
          ['icon', it.icon]
        ]);
        return `${inner}<bent-feature${ia}>${esc(it.text || it.description || '')}</bent-feature>`;
      });
      return `${pad}<bent-features${a}>\n${kids.join('\n')}\n${pad}</bent-features>`;
    }
    case 'stats': {
      const a = attrList([
        ['id', s.id || nextId('stats')],
        ['columns', clampInt(s.columns, 2, 4, 3)]
      ]);
      const kids = (s.items || []).map((it) => {
        const ia = attrList([['id', nextId('s')], ['value', it.value], ['label', it.label]]);
        return `${inner}<bent-stat${ia} />`;
      });
      return `${pad}<bent-stats${a}>\n${kids.join('\n')}\n${pad}</bent-stats>`;
    }
    case 'cta': {
      const a = attrList([
        ['id', s.id || nextId('cta')],
        ['title', s.title],
        ['buttontext', s.buttonText],
        ['url', safeUrl(s.href) || '#'],
        ['tone', s.tone && s.tone !== 'brand' ? s.tone : '']
      ]);
      return `${pad}<bent-cta${a}>${esc(s.text || '')}</bent-cta>`;
    }
    case 'quote': {
      const a = attrList([['id', s.id || nextId('q')], ['author', s.author]]);
      return `${pad}<bent-quote${a}>${esc(s.text || '')}</bent-quote>`;
    }
    case 'list': {
      const a = attrList([
        ['id', s.id || nextId('list')],
        ['ordered', s.ordered ? 'true' : '', !!s.ordered]
      ]);
      const kids = (s.items || []).map(
        (it) => `${inner}<bent-item id="${attr(nextId('li'))}">${esc(typeof it === 'string' ? it : it.text || '')}</bent-item>`
      );
      return `${pad}<bent-list${a}>\n${kids.join('\n')}\n${pad}</bent-list>`;
    }
    case 'columns': {
      const a = attrList([['id', s.id || nextId('cols')], ['gap', s.gap && s.gap !== 'medium' ? s.gap : '']]);
      const cols = (s.cols || []).map((c) => {
        const ca = attrList([['id', nextId('col')], ['width', c.width || '1/2']]);
        const csec = (c.sections || []).map((cs) => section(cs, inner + '  ', depth + 1)).filter(Boolean);
        return `${inner}<bent-col${ca}>\n${csec.join('\n')}\n${inner}</bent-col>`;
      });
      return `${pad}<bent-columns${a}>\n${cols.join('\n')}\n${pad}</bent-columns>`;
    }
    case 'embed': {
      const a = attrList([['id', s.id || nextId('embed')], ['url', safeUrl(s.url)]]);
      return `${pad}<bent-embed${a} />`;
    }
    case 'map': {
      const a = attrList([
        ['id', s.id || nextId('map')],
        ['address', s.address],
        ['zoom', s.zoom != null ? clampInt(s.zoom, 1, 20, 15) : ''],
        ['height', s.height && s.height !== 'md' ? s.height : '']
      ]);
      return `${pad}<bent-map${a} />`;
    }
    default:
      // Unknown section type → a visible comment the agent can see and correct,
      // rather than silently dropping content.
      return `${pad}<bent-text id="${attr(nextId('t'))}">[unsupported section: ${esc(t)}]</bent-text>`;
  }
}

/**
 * Translate an intent object to canonical .pzn source.
 * @param {object} intent
 * @returns {string} .pzn source
 * @throws {Error} when the intent produces invalid .pzn (BentError-shaped)
 */
function intentToPzn(intent) {
  uid = 0;
  sectionCount = 0;
  const it = intent && typeof intent === 'object' ? intent : {};
  const sections = Array.isArray(it.sections) ? it.sections : [];
  if (!sections.length) {
    const err = new Error('intent.sections must be a non-empty array');
    err.code = 'E_INTENT_EMPTY';
    throw err;
  }

  const lang = it.lang === 'en' ? 'en' : 'he';
  const dir = it.dir === 'ltr' ? 'ltr' : 'rtl';
  const title = String(it.title || 'דף חדש');
  const slug = it.slug ? deriveSlug(it.slug) : deriveSlug(title);

  const head = [
    '<!DOCTYPE html>',
    `<html lang="${attr(lang)}" dir="${attr(dir)}" bent-version="0.1">`,
    '  <head>',
    '    <meta charset="utf-8" />',
    `    <title>${esc(title)}</title>`,
    `    <meta name="bent-slug" content="${attr(slug)}" />`
  ];
  if (Array.isArray(it.tags) && it.tags.length) {
    head.push(`    <meta name="bent-tags" content="${attr(it.tags.join(','))}" />`);
  }
  if (it.teaser) head.push(`    <meta name="bent-teaser" content="${attr(it.teaser)}" />`);
  if (it.cardImage) head.push(`    <meta name="bent-card-image" content="${attr(it.cardImage)}" />`);
  head.push('  </head>', '  <body>');

  const body = sections.map((s) => section(s)).filter(Boolean);
  const src = head.concat(body, ['  </body>', '</html>', '']).join('\n');

  // validate before handing back — bad intent should fail loudly for self-repair
  const doc = parse(src); // throws BentError on malformed structure
  const errors = validate(doc, { strict: false }).filter((i) => i.severity === 'error');
  if (errors.length) {
    const err = new Error('intent produced invalid .pzn: ' + errors.map((e) => `${e.code} ${e.message}`).join('; '));
    err.code = 'E_INTENT_INVALID';
    err.issues = errors;
    err.source = src;
    throw err;
  }
  return src;
}

module.exports = { intentToPzn, deriveSlug };
