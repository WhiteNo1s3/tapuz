'use strict';

/**
 * Upload validation (v0.47 security phase).
 *
 * The media library accepted base64 uploads whose extension came from the
 * CLIENT (data-URL mime or filename) — so `data:text/html;base64,…` named
 * "x.html" would be written to public/assets and served as executable HTML
 * (stored XSS / arbitrary hosting on the site origin). And SVGs — which can
 * carry <script> — were stored verbatim.
 *
 * This module: (1) sniffs the REAL type from magic bytes (never trusts the
 * client), (2) allows only a fixed image set, (3) sanitizes SVG, (4) caps
 * size. The caller must use the returned `ext`/`buf`, not the filename.
 */

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB per file

const EXT = { png: '.png', jpeg: '.jpg', gif: '.gif', webp: '.webp', avif: '.avif', svg: '.svg' };
const MIME = {
  png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml'
};

function fail(msg, code) {
  const e = new Error(msg);
  e.code = code;
  return e;
}

/** Identify an image type from leading bytes (or SVG text). null = unknown. */
function sniffType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) {
    // SVG can be tiny; fall through to the text check below
    if (!Buffer.isBuffer(buf) || !buf.length) return null;
  }
  const b = buf;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = b.slice(8, 12).toString('latin1');
    if (/avif|avis|mif1|miaf/i.test(brand)) return 'avif';
  }
  // SVG is text — the file must actually START as an SVG (an HTML doc that
  // merely contains <svg> must NOT be accepted as an image).
  const head = b.slice(0, 1024).toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<!doctype svg')) return 'svg';
  if (head.startsWith('<?xml') && /<svg[\s>]/.test(head)) return 'svg';
  return null;
}

/**
 * Best-effort SVG scrubber. NOTE: a regex scrubber CANNOT fully sanitize SVG
 * (nested/encoded markup leaks). The real guarantee is the SERVE LAYER — the
 * server sends uploaded SVGs with a `sandbox` CSP + `Content-Disposition:
 * attachment`, so a bypass still can't execute on the origin. This function is
 * defense-in-depth and is written to avoid catastrophic backtracking (ReDoS):
 * it removes TAGS by name (linear, no cross-content `[\s\S]*?`) and loops a
 * bounded number of times to defeat nesting like `<scr<script>ipt>`.
 */
function stripTagsByName(s, names) {
  const re = new RegExp('<\\s*/?\\s*(?:' + names.join('|') + ')\\b[^>]*>', 'gi');
  let prev;
  let passes = 0;
  do {
    prev = s;
    s = s.replace(re, '');
  } while (s !== prev && ++passes < 8);
  return s;
}

function sanitizeSvg(svg) {
  let s = String(svg == null ? '' : svg);
  // remove active elements entirely (tag-only removal — no ReDoS)
  s = stripTagsByName(s, ['script', 'foreignObject', 'animate', 'animateTransform', 'animateMotion', 'set', 'handler']);
  // event-handler attributes; the HTML tokenizer accepts space OR '/' before the name
  s = s.replace(/[\s/]on\w+\s*=\s*"[^"]*"/gi, ' ');
  s = s.replace(/[\s/]on\w+\s*=\s*'[^']*'/gi, ' ');
  s = s.replace(/[\s/]on\w+\s*=\s*[^\s>]+/gi, ' ');
  // neutralize executable schemes in link/animation-target attributes
  const schemeAttr = /((?:xlink:)?href|src|values|to|from)\s*=\s*("|')?\s*(?:javascript|data|vbscript)\s*:[^"'>\s]*/gi;
  s = s.replace(schemeAttr, (m, name, q) => `${name}=${q || '"'}#${q || '"'}`);
  return s;
}

/**
 * @param {Buffer} buf raw file bytes
 * @param {{ maxBytes?: number }} [opts]
 * @returns {{ type: string, ext: string, mime: string, buf: Buffer }}
 * @throws {Error} E_UPLOAD_EMPTY | E_UPLOAD_SIZE | E_UPLOAD_TYPE
 */
function validateUpload(buf, opts = {}) {
  const maxBytes = opts.maxBytes || MAX_BYTES;
  if (!Buffer.isBuffer(buf) || !buf.length) throw fail('empty upload', 'E_UPLOAD_EMPTY');
  if (buf.length > maxBytes) {
    throw fail(`file too large (max ${Math.round(maxBytes / 1048576)}MB)`, 'E_UPLOAD_SIZE');
  }
  const type = sniffType(buf);
  if (!type || !EXT[type]) throw fail('unsupported file type — images only', 'E_UPLOAD_TYPE');
  const out = type === 'svg' ? Buffer.from(sanitizeSvg(buf.toString('utf8')), 'utf8') : buf;
  return { type, ext: EXT[type], mime: MIME[type], buf: out };
}

module.exports = { validateUpload, sniffType, sanitizeSvg, MAX_BYTES, EXT, MIME };
