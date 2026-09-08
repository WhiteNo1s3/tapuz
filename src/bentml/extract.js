'use strict';

/**
 * extract.js — take ONLY the BenTML out of anything a model wrote (v2.20).
 *
 * Ben's rule: "the system automatically takes only the BenTML from the
 * generation of the LLM — any time, anywhere." Every door a model's text can
 * enter through (the builder's source panel, the 🤖 import modal, /admin/ai,
 * the copilot's create button, the extension's paste box, /agent/v1, the CLI,
 * and the page store itself) runs its input through this ONE function first.
 * What comes out is a bare document in one of the two dialects the ecosystem
 * speaks:
 *
 *   'pzn'  — the tag document (<!DOCTYPE html> … <bent-*> … </html>), or a
 *            body-only <bent-*> fragment
 *   'line' — the keyword document ("BENTML 0.2" / META { } / KEYWORD(…) { })
 *
 * What it strips, in the shapes models actually produce:
 *   • prose before and after ("בשמחה! הנה הדף:", "Let me know if…", PZN_READY)
 *   • markdown fences of any flavour — ``` or ~~~, any info string, a
 *     4-backtick outer fence around an inner one, an opener with the code
 *     glued on the same line, a fence the model forgot to close
 *   • HTML wrappers around the keyword dialect — <html>, <body>, <pre>,
 *     <code>, a stray <!DOCTYPE> — the "<html> brackets" Ben kept deleting
 *   • entity-escaped markup copied out of a rendered chat bubble (&lt;bent-…&gt;)
 *   • zero-width characters / BOM that break "BENTML 0.2" and "<!DOCTYPE"
 *   • a keyword document missing its version line (adds "BENTML 0.2")
 *   • a tag document whose <html> forgot its <body>
 *
 * When a reply carries SEVERAL candidates (the empty template echoed back
 * from the roleplay pack, then the real page) the richest one wins — the one
 * with the most modules — never merely the first.
 *
 * Contract: pure and dependency-free (it is bundled into the browser engine),
 * idempotent (extract(extract(x).source) ≡ extract(x)), and the identity on a
 * clean document — which is what makes it safe to run at every door,
 * including in front of the canonical store.
 */

const ZERO_WIDTH_RE = /[\u200b\u2060\ufeff]/g;

/** "BENTML 0.2" — any case, optional "v", optional wrapper tags glued in front. */
const VERSION_LINE_RE = /^[ \t]*(?:<[^<>\n]*>[ \t]*)*BENTML[ \t]+v?(\d+)\.(\d+)\b/i;
/** A META block opener — a keyword document that lost its version line. */
const META_LINE_RE = /^[ \t]*(?:<[^<>\n]*>[ \t]*)*META[ \t]*\{/i;

/** Wrapper tags a chat/UI puts AROUND a keyword document. Only these — a
 *  TEXT body never legitimately starts or ends with one of them. */
const LEAD_WRAP_RE = /^\s*(?:<\/?(?:html|body|pre|code|head|!doctype)\b[^<>]*>\s*)+/i;
const TRAIL_WRAP_RE = /(?:\s*<\/?(?:html|body|pre|code)\b[^<>]*>)+\s*$/i;

function normalizeText(text) {
  return String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(ZERO_WIDTH_RE, '');
}

/** A document whose every line ends in CRLF (a Windows checkout, a Windows
 *  editor) keeps its line endings — formatting is content, and the store
 *  must be able to write a clean file back byte-for-byte. Mixed endings are
 *  a paste artifact and normalize to LF. */
function usesCrlf(raw) {
  const s = String(raw == null ? '' : raw);
  return /\r\n/.test(s) && !/(^|[^\r])\n/.test(s);
}

function countLines(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

// ── entity-escaped markup (copied from a rendered code bubble) ────────────

function unescapeEntities(s) {
  return s
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x27;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&'); // last — so "&amp;lt;" stays the literal "&lt;"
}

/** True only when the WHOLE thing reads as escaped markup — never for a real
 *  document that merely carries an &lt; inside a bent-html attribute. */
function looksEscaped(s) {
  if (/<bent-[a-z]/i.test(s) || /<!DOCTYPE\s+html/i.test(s) || /<html[\s>]/i.test(s)) return false;
  if (/&lt;(?:bent-[a-z]|!DOCTYPE\s+html|html[\s&>])/i.test(s)) return true;
  // a keyword document copied out of a rendered page: every quote is &quot;
  if (/^[ \t]*BENTML[ \t]+v?\d+\.\d+/im.test(s) && /&quot;/i.test(s) && !/"/.test(s)) return true;
  return false;
}

// ── markdown fences (CommonMark rules, the way chat UIs render them) ──────

/**
 * @returns {Array<{ lang: string, start: number, end: number, bodyStart: number, body: string[], unclosed: boolean }>}
 *   line indexes: start = opener line, end = closer line (or lines.length when
 *   unclosed), bodyStart = first body line (the opener itself when the model
 *   glued the code onto it).
 */
function scanFences(lines) {
  const out = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!open) {
      const m = /^ {0,3}(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+.#-]*)[ \t]*(.*)$/.exec(line);
      if (!m) continue;
      const rest = m[3] || '';
      // "```html<!DOCTYPE html>" — the first line of code rode on the opener
      const glued = rest && (/</.test(rest) || /^BENTML\b/i.test(rest) || /^META\b/i.test(rest));
      open = { char: m[1][0], len: m[1].length, lang: (m[2] || '').toLowerCase(), start: i, body: [], bodyStart: glued ? i : i + 1 };
      if (glued) open.body.push(rest);
      continue;
    }
    const c = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
    if (c && c[1][0] === open.char && c[1].length >= open.len) {
      out.push({ lang: open.lang, start: open.start, end: i, bodyStart: open.bodyStart, body: open.body, unclosed: false });
      open = null;
      continue;
    }
    open.body.push(line);
  }
  if (open) out.push({ lang: open.lang, start: open.start, end: lines.length, bodyStart: open.bodyStart, body: open.body, unclosed: true });
  return out;
}

// ── the tag dialect (.pzn) ────────────────────────────────────────────────

/**
 * The document (or bare <bent-*> fragment) inside a region of text.
 * @returns {null | { dialect: 'pzn', source: string, modules: number, lineOffset: number, notes: string[] }}
 */
function pznCandidate(text, lineOffset) {
  const notes = [];
  const doctypeAt = text.search(/<!DOCTYPE\s+html/i);
  const htmlAt = text.search(/<html[\s>]/i);
  const hasBent = /<bent-[a-z]/i.test(text);
  let start = doctypeAt !== -1 ? doctypeAt : htmlAt;
  if (start === -1) {
    if (!hasBent) return null;
    start = text.search(/<bent-[a-z]/i);
    notes.push('FRAGMENT');
  }
  let end = -1;
  const lower = text.toLowerCase();
  const close = lower.lastIndexOf('</html>');
  if (close > start) end = close + '</html>'.length;
  if (end === -1) {
    // truncated document or a body-only fragment: end at the last bent tag
    let last = -1;
    const re = /<\/bent-[a-z][a-z0-9-]*\s*>|<bent-[^<>]*\/\s*>/gi;
    let m;
    while ((m = re.exec(text)) !== null) last = m.index + m[0].length;
    if (last <= start) {
      const gt = text.lastIndexOf('>');
      last = gt > start ? gt + 1 : text.length;
    }
    end = last;
    if (notes.indexOf('FRAGMENT') === -1) notes.push('TRUNCATED');
  }
  const before = text.slice(0, start);
  const after = text.slice(end);
  // when nothing but whitespace follows the document, keep the author's own
  // trailing newline — a clean file must pass through byte-for-byte
  const source = after.trim() ? text.slice(start, end).trim() : text.slice(start).replace(/^\s+/, '');
  if (before.trim() || after.trim()) notes.push('PROSE');
  const modules = (source.match(/<bent-[a-z]/gi) || []).length;
  // an <html> shell with no bent-* module and no bent-* head marker is just a
  // web page (the decompiler's business), not a .pzn document — except the
  // empty template (bent-version / bent-slug), which the doors must recognize
  // to say "you pasted the template, not the page"
  if (!modules && !/bent-(?:version|slug|tags)/i.test(source)) return null;
  return { dialect: 'pzn', source, modules, lineOffset: lineOffset + countLines(before), notes };
}

/** A tag document whose <html> forgot its <body> — the parser needs one. */
function ensureBody(src) {
  if (!/<html[\s>]/i.test(src) || /<body[\s>]/i.test(src) || !/<bent-[a-z]/i.test(src)) return { src, changed: false };
  const headClose = /<\/head\s*>/i.exec(src);
  const insertAt = headClose ? headClose.index + headClose[0].length : src.search(/<bent-[a-z]/i);
  let out = src.slice(0, insertAt).replace(/\s*$/, '') + '\n<body>\n' + src.slice(insertAt).replace(/^\s*/, '');
  const htmlClose = out.toLowerCase().lastIndexOf('</html>');
  out = htmlClose !== -1
    ? out.slice(0, htmlClose).replace(/\s*$/, '') + '\n</body>\n' + out.slice(htmlClose)
    : out.replace(/\s*$/, '') + '\n</body>';
  return { src: out, changed: true };
}

// ── the keyword dialect ("BENTML 0.2") ────────────────────────────────────

/** A line that can only be BenTML structure: KEYWORD(…) / KEYWORD { / a bare
 *  no-body keyword (SPACE, DIVIDER — upper-case only, so "Done" is prose). */
function isKeywordLine(t) {
  return /^[A-Za-z][A-Za-z0-9]*\s*[({]/.test(t) || /^[A-Z][A-Z0-9]*\s*$/.test(t);
}

/**
 * Walk a keyword document from its first line: strip the wrapper tags a chat
 * put around it, stop at the last line that is BenTML structure (a keyword
 * line, a closing brace, a comment, the }}} of a raw block). Everything after
 * that is chat, not page. Content INSIDE bodies is never touched — the cut
 * only ever happens after the last structural line, so a page cannot lose a
 * paragraph to it.
 */
function walkLineDoc(lines, startIdx) {
  const out = [];
  const wasBlank = []; // per out[] line: blank in the ORIGINAL (not a stripped wrapper)
  let inRaw = false;
  let lastKeep = -1;
  let modules = 0;
  let wrappers = 0;
  for (let i = startIdx; i < lines.length; i++) {
    let line = lines[i];
    if (inRaw) {
      out.push(line);
      wasBlank.push(!line.trim());
      if (line.trim() === '}}}') { inRaw = false; lastKeep = out.length - 1; }
      continue;
    }
    const stripped = line.replace(LEAD_WRAP_RE, '').replace(TRAIL_WRAP_RE, '');
    if (stripped !== line) { wrappers++; line = stripped; }
    const t = line.trim();
    out.push(line);
    wasBlank.push(stripped === lines[i] && !t);
    if (/^HTML\s*\{\{\{/i.test(t)) {
      const after = t.slice(t.indexOf('{{{') + 3);
      inRaw = after.indexOf('}}}') === -1;
      lastKeep = out.length - 1;
      modules++;
      continue;
    }
    if (t === '') continue;
    if (t.startsWith('//')) { lastKeep = out.length - 1; continue; }
    if (isKeywordLine(t)) { lastKeep = out.length - 1; modules++; continue; }
    if (t.endsWith('}')) { lastKeep = out.length - 1; continue; }
    // anything else is body content (kept if structure follows) or chat (cut)
  }
  if (lastKeep === -1) return { lines: [], modules: 0, wrappers, dropped: 0 };
  const tail = out.slice(lastKeep + 1);
  // a tail of ORIGINALLY blank lines is the author's own trailing newline —
  // keep it, so a clean document passes through byte-for-byte; a tail that
  // is blank only because </html></pre> was stripped off it is chat, cut it
  if (tail.length && wasBlank.slice(lastKeep + 1).every(Boolean)) return { lines: out, modules, wrappers, dropped: 0 };
  return { lines: out.slice(0, lastKeep + 1), modules, wrappers, dropped: tail.length };
}

function normalizeVersionLine(line) {
  const m = VERSION_LINE_RE.exec(line);
  return m ? `BENTML ${m[1]}.${m[2]}` : line;
}

/**
 * The keyword document inside a region of text.
 * @returns {null | { dialect: 'line', source: string, modules: number, lineOffset: number, notes: string[] }}
 */
function lineCandidate(text, lineOffset) {
  const lines = text.split('\n');
  let startIdx = -1;
  let versionMissing = false;
  for (let i = 0; i < lines.length; i++) {
    if (VERSION_LINE_RE.test(lines[i])) { startIdx = i; break; }
  }
  if (startIdx === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (META_LINE_RE.test(lines[i])) { startIdx = i; versionMissing = true; break; }
    }
    if (startIdx === -1) return null;
  }
  const walked = walkLineDoc(lines, startIdx);
  if (!walked.lines.length) return null;
  const notes = [];
  const out = walked.lines.slice();
  if (versionMissing) {
    out.unshift('BENTML 0.2');
    notes.push('VERSION_LINE');
  } else {
    const norm = normalizeVersionLine(out[0]);
    if (norm !== out[0].trim()) notes.push('VERSION_LINE');
    out[0] = norm;
  }
  if (walked.wrappers) notes.push('WRAPPER');
  const leading = lines.slice(0, startIdx).some((l) => l.trim());
  if (leading || walked.dropped) notes.push('PROSE');
  return {
    dialect: 'line',
    source: out.join('\n'),
    modules: walked.modules,
    lineOffset: lineOffset + startIdx - (versionMissing ? 1 : 0),
    notes
  };
}

// ── choosing ──────────────────────────────────────────────────────────────

function candidatesIn(text, lineOffset, fenced) {
  const out = [];
  const p = pznCandidate(text, lineOffset);
  const l = lineCandidate(text, lineOffset);
  if (p) { p.fenced = fenced; out.push(p); }
  if (l) { l.fenced = fenced; out.push(l); }
  return out;
}

/** Richest first: most modules, then fenced (explicit) over bare, then longer. */
function pickBest(cands) {
  return cands.slice().sort((a, b) =>
    (b.modules - a.modules) ||
    ((b.fenced ? 1 : 0) - (a.fenced ? 1 : 0)) ||
    (b.source.length - a.source.length))[0] || null;
}

const MESSAGES = {
  FENCE: 'taken out of a markdown code fence',
  PROSE: 'chat text around the document dropped',
  WRAPPER: 'HTML wrapper tags (<html>/<body>/<pre>/<code>) around the BenTML removed',
  UNESCAPE: 'HTML entities (&lt; &gt; &quot;) decoded back to markup',
  VERSION_LINE: 'version line normalized to "BENTML x.y"',
  BODY: '<body> added around the modules',
  TRUNCATED: 'no </html> — document cut at its last module',
  FRAGMENT: 'body-only <bent-*> fragment (no <html> shell)'
};

/**
 * Take only the BenTML out of `text`.
 * @param {string} text anything a model (or a human) pasted
 * @returns {{
 *   source: string,            the bare document (or the trimmed input when nothing was found)
 *   dialect: 'pzn'|'line'|'unknown',
 *   found: boolean,
 *   fenced: boolean,           came out of a markdown fence
 *   lineOffset: number,        lines dropped before line 1 of `source` (add to error lines)
 *   modules: number,           rough richness — <bent-*> tags or keyword lines
 *   changes: Array<{ code: string, message: string }>
 * }}
 */
function extractBentml(text) {
  const crlf = usesCrlf(text);
  let s = normalizeText(text);
  const changes = [];
  const note = (code) => { if (!changes.some((c) => c.code === code)) changes.push({ code, message: MESSAGES[code] || code }); };

  if (!s.trim()) return { source: '', dialect: 'unknown', found: false, fenced: false, lineOffset: 0, modules: 0, changes };

  if (looksEscaped(s)) { s = unescapeEntities(s); note('UNESCAPE'); }

  const startsWithDoc = /^\s*(?:<!DOCTYPE\s+html|<html[\s>]|<bent-[a-z]|BENTML[ \t]+v?\d+\.\d+)/i.test(s);
  let cands;
  if (startsWithDoc) {
    // a bare document (the common case — and every re-extraction of our own
    // output): no fence scan, so a ``` inside a raw HTML block stays content
    cands = candidatesIn(s, 0, false);
  } else {
    const lines = s.split('\n');
    const fences = scanFences(lines);
    cands = [];
    const fencedLine = new Array(lines.length).fill(false);
    for (const f of fences) {
      for (let i = f.start; i <= Math.min(f.end, lines.length - 1); i++) fencedLine[i] = true;
      for (const c of candidatesIn(f.body.join('\n'), f.bodyStart, true)) cands.push(c);
    }
    // the prose outside the fences, with fenced lines blanked so line numbers stay true
    const outside = lines.map((l, i) => (fencedLine[i] ? '' : l)).join('\n');
    for (const c of candidatesIn(outside, 0, false)) cands.push(c);
  }

  const best = pickBest(cands);
  if (!best) {
    return { source: s.trim(), dialect: 'unknown', found: false, fenced: false, lineOffset: 0, modules: 0, changes };
  }

  let source = best.source;
  if (best.fenced) note('FENCE');
  for (const n of best.notes) note(n);
  if (best.dialect === 'pzn') {
    const b = ensureBody(source);
    if (b.changed) { source = b.src; note('BODY'); }
  }
  if (crlf) source = source.replace(/\n/g, '\r\n');
  return {
    source,
    dialect: best.dialect,
    found: true,
    fenced: !!best.fenced,
    lineOffset: best.lineOffset,
    modules: best.modules,
    changes
  };
}

/** Which dialect a text carries — 'pzn' | 'line' | 'unknown'. */
function sniffDialect(text) {
  return extractBentml(text).dialect;
}

/** The tag dialect's old sniffer (kept for every caller that imported it). */
function looksLikePzn(source) {
  return /<bent-[a-z]/i.test(String(source || '')) || /bent-version/i.test(String(source || ''));
}

/** The keyword dialect's sniffer. */
function looksLikeLine(source) {
  return VERSION_LINE_RE.test(String(source || '')) || /^[ \t]*BENTML[ \t]+v?\d+\.\d+/im.test(String(source || ''));
}

module.exports = { extractBentml, sniffDialect, looksLikePzn, looksLikeLine, scanFences };
