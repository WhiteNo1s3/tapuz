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

/**
 * Decode a minimal set of HTML entities in text/attr values.
 * @param {string} str
 */
function unescapeHtml(str) {
  return String(str ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

module.exports = { escapeHtml, escapeAttr, escapeCssUrl, unescapeHtml };
