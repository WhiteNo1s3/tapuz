'use strict';

/**
 * HTML fragment sanitizer for the bent-html provisional block (v0.49).
 *
 * WHY THIS IS THE GUARANTEE (not the CSP): the published site's CSP allows
 * `'unsafe-inline'` scripts (the first-party analytics beacon), so the CSP does
 * NOT stop an inline <script> a raw block might carry. THIS scrubber is what
 * stops it. Until v0.47 the invariant "authored content cannot inject <script>"
 * held because raw HTML in the body was a hard parse error. The bent-html
 * escape hatch relaxes that on purpose, so this file has to earn the trust.
 *
 * Threat model: the content is admin-authored or admin-approved, but an LLM's
 * output can be steered by content it read — so we treat it as untrusted and
 * strip every script vector we can, entity-obfuscated ones included.
 *
 * This is a denylist scrubber, NOT a full HTML parser — the bent-html block is
 * PROVISIONAL by design and the editor nudges you to graduate it into real
 * modules. Written to avoid catastrophic backtracking (ReDoS): whole dangerous
 * elements are removed with a bounded lazy match looped a fixed number of times
 * to defeat nesting like `<scr<script>ipt>`; everything else is tag-/attr-local.
 *
 * Residual-risk follow-up (tracked): nonce/hash the analytics inline script so
 * the published `script-src` can drop `'unsafe-inline'` — then even a scrubber
 * miss could not execute. See docs/ROADMAP.md.
 */

// Elements removed WITH their content (their text is meaningless without them).
const DANGER_ELEMENTS = [
  'script', 'iframe', 'object', 'embed', 'form', 'template',
  'noscript', 'base', 'link', 'meta', 'frame', 'frameset', 'applet', 'param'
];

/** URL-bearing attributes whose value can carry an executable scheme. */
const URL_ATTRS = ['href', 'xlink:href', 'src', 'srcdoc', 'action', 'formaction', 'data', 'poster', 'background', 'cite', 'dynsrc', 'lowsrc'];

/** Decode numeric + a few named HTML entities so obfuscated schemes are seen. */
function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => {
      const n = parseInt(h, 16);
      return Number.isFinite(n) && n <= 0x10ffff ? safeFromCodePoint(n) : '';
    })
    .replace(/&#(\d+);?/g, (_, d) => {
      const n = parseInt(d, 10);
      return Number.isFinite(n) && n <= 0x10ffff ? safeFromCodePoint(n) : '';
    })
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n')
    .replace(/&amp;/gi, '&');
}
function safeFromCodePoint(n) {
  try { return String.fromCodePoint(n); } catch (e) { return ''; }
}

/**
 * True when `value`, once entities are decoded and in-scheme whitespace/control
 * chars are stripped (browsers ignore those before the colon), begins with an
 * executable scheme. Catches `java&#115;cript:`, `java\tscript:`, ` JavaScript:`.
 */
function hasDangerousScheme(value) {
  const decoded = decodeEntities(value)
    // strip whitespace + control chars (browsers ignore these before the
    // scheme colon, so `java\tscript:` and ` javascript:` must still be caught)
    .replace(/[\s\x00-\x1f]+/g, '')
    .toLowerCase();
  return /^(?:javascript|vbscript|livescript|mocha):/.test(decoded)
    || /^data:(?!image\/(?:png|jpe?g|gif|webp|avif|svg\+xml))/.test(decoded);
}

/** Remove whole dangerous elements (open→close, content included). */
function stripElementsWithContent(s, names) {
  const re = new RegExp('<\\s*(' + names.join('|') + ')\\b[^>]*>[\\s\\S]*?<\\s*/\\s*\\1\\s*>', 'gi');
  let prev; let passes = 0;
  do { prev = s; s = s.replace(re, ''); } while (s !== prev && ++passes < 8);
  return s;
}

/** Remove tags by name (tag only, keep inner text) — mops up unclosed danger tags. */
function stripTagsByName(s, names) {
  const re = new RegExp('<\\s*/?\\s*(?:' + names.join('|') + ')\\b[^>]*>', 'gi');
  let prev; let passes = 0;
  do { prev = s; s = s.replace(re, ''); } while (s !== prev && ++passes < 8);
  return s;
}

/** Scrub CSS (in <style> blocks or style="" attrs) of its few XSS vectors. */
function scrubCss(css) {
  return String(css == null ? '' : css)
    .replace(/@import\b[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, 'x(')
    .replace(/(?:-moz-)?binding\s*:/gi, 'x-binding:')
    .replace(/behaviou?r\s*:/gi, 'x-behavior:')
    .replace(/url\s*\(\s*(['"]?)\s*(?:javascript|vbscript|data)\s*:[^)]*\)/gi, 'url($1#$1)');
}

/** Replace a URL-attr value with '#', preserving the original quote style. */
function neutralizeAttrValue(name, quote) {
  const q = quote || '"';
  return `${name}=${q}#${q}`;
}

/**
 * Sanitize a raw HTML fragment for safe inline rendering on the public site.
 * @param {string} html
 * @returns {string}
 */
function sanitizeHtmlFragment(html) {
  let s = String(html == null ? '' : html);

  // 1) dangerous elements, content and all (script/iframe/form/…). <style> is
  //    kept but its content is scrubbed below — CSS is not JS.
  const withContent = DANGER_ELEMENTS.filter((n) => n !== 'style');
  s = stripElementsWithContent(s, withContent);
  // 2) mop up any leftover/unclosed dangerous open/close tags
  s = stripTagsByName(s, withContent);

  // 3) scrub <style> block contents
  s = s.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/\s*style\s*>)/gi, (m, open, css, close) => open + scrubCss(css) + close);

  // 4) event-handler attributes (space or '/' before the name; three quote forms)
  s = s.replace(/[\s/]on\w+\s*=\s*"[^"]*"/gi, ' ');
  s = s.replace(/[\s/]on\w+\s*=\s*'[^']*'/gi, ' ');
  s = s.replace(/[\s/]on\w+\s*=\s*[^\s>]+/gi, ' ');

  // 5) executable URL schemes in URL-bearing attributes — entity-aware
  const attrAlt = URL_ATTRS.map((a) => a.replace(':', '\\s*:\\s*')).join('|');
  const urlRe = new RegExp('(' + attrAlt + ')\\s*=\\s*("|\')([^"\']*)\\2', 'gi');
  s = s.replace(urlRe, (m, name, q, val) => (hasDangerousScheme(val) ? neutralizeAttrValue(name, q) : m));
  // unquoted form
  const urlReUnq = new RegExp('(' + attrAlt + ')\\s*=\\s*([^\\s"\'>]+)', 'gi');
  s = s.replace(urlReUnq, (m, name, val) => (hasDangerousScheme(val) ? `${name}="#"` : m));

  // 6) inline style="" attributes — same CSS vectors
  s = s.replace(/style\s*=\s*"([^"]*)"/gi, (m, css) => `style="${scrubCss(css)}"`);
  s = s.replace(/style\s*=\s*'([^']*)'/gi, (m, css) => `style='${scrubCss(css)}'`);

  return s;
}

module.exports = {
  sanitizeHtmlFragment,
  scrubCss,
  hasDangerousScheme,
  decodeEntities,
  DANGER_ELEMENTS
};
