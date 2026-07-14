'use strict';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}

/**
 * Escape a URL for a CSS url('…') string inside an HTML style="…" attribute.
 * escapeHtml is the WRONG escaping here (the HTML parser decodes &#39; back to
 * a literal quote before the CSS parser runs), so we escape CSS-dangerous
 * characters as CSS hex escapes — neutralizing breakout, keeping URLs valid.
 */
function escapeCssUrl(str) {
  return String(str == null ? '' : str)
    .replace(/[\r\n\f]/g, '')
    .replace(/[\\'"()<>]/g, (c) => '\\' + c.charCodeAt(0).toString(16) + ' ');
}

// The named entities real pages actually carry (© — ' " … ® ™ nbsp …). `amp`
// lives here too: a single-pass decode never re-scans its own output, so an
// escaped "&amp;copy;" resolves to the literal "&copy;", not ©.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', shy: '­',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', deg: '°', middot: '·',
  bull: '•', sect: '§', para: '¶', euro: '€',
  pound: '£', cent: '¢', yen: '¥', times: '×', divide: '÷'
};

/** A numeric code point → char, guarding invalid/surrogate values (no crash). */
function fromCodePoint(n) {
  if (!Number.isInteger(n) || n < 1 || n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF)) return '';
  try { return String.fromCodePoint(n); } catch (e) { return ''; }
}

/**
 * Decode HTML entities in text/attr values pulled from real pages — named
 * (&copy; &nbsp; &mdash;…), decimal (&#169;) and hex (&#xA9;). ONE pass: a
 * decoded "&" is never re-scanned, so "&amp;copy;" stays the literal "&copy;".
 * Unknown names pass through untouched (never dropped).
 * @param {string} str
 */
function unescapeHtml(str) {
  return String(str ?? '').replace(
    /&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (m, body) => {
      if (body[0] === '#') {
        const n = (body[1] === 'x' || body[1] === 'X')
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        return fromCodePoint(n) || m;
      }
      const hit = NAMED_ENTITIES[body] !== undefined
        ? NAMED_ENTITIES[body]
        : NAMED_ENTITIES[body.toLowerCase()];
      return hit !== undefined ? hit : m;
    }
  );
}

/** Neutralize executable URL schemes on clickable links. */
function safeHref(url) {
  const s = String(url == null ? '' : url).trim();
  if (/^(?:javascript|data|vbscript):/i.test(s)) return '#';
  return s || '#';
}

module.exports = { escapeHtml, escapeAttr, escapeCssUrl, safeHref, unescapeHtml };
