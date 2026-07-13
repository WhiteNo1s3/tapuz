'use strict';

/**
 * Graduation (v0.51) — turn a provisional bent-html block's raw HTML into real
 * Tapuz modules (blocks), best-effort. This is the reverse of the repair
 * engine's quarantine: repair wraps off-vocabulary HTML into bent-html so a
 * page never fails to save; graduation lifts that HTML back into first-class,
 * visually-editable modules once the admin is ready.
 *
 * It is deliberately best-effort (a real page's markup is messy). Anything it
 * can confidently map becomes a module; anything left over stays in a smaller
 * bent-html block so nothing is lost. The admin approves the result.
 */

const { tokenize } = require('./language/parse');
const { unescapeHtml } = require('./language/escape');

/** Reconstruct a token's HTML (for leftover fragments). */
function tokenToHtml(t) {
  if (t.kind === 'text') return t.value;
  if (t.kind === 'doctype') return t.value;
  if (t.kind === 'close') return `</${t.name}>`;
  if (t.kind === 'open') {
    const attrs = Object.entries(t.attrs || {})
      .map(([k, v]) => (v === '' ? k : `${k}="${v}"`))
      .join(' ');
    return `<${t.name}${attrs ? ' ' + attrs : ''}${t.selfClosing ? ' /' : ''}>`;
  }
  return '';
}

/** Collect visible text from a token slice (drops tags, keeps text). */
function textOf(tokens, from, to) {
  let s = '';
  for (let i = from; i < to; i++) {
    if (tokens[i].kind === 'text') s += tokens[i].value;
  }
  return s.replace(/\s+/g, ' ').trim();
}

// HTML void elements never have a close tag, slash or not.
const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);

/** Find the index just after the element opened at `open` (matched close). */
function matchClose(tokens, openIdx) {
  const name = tokens[openIdx].name;
  if (tokens[openIdx].selfClosing || VOID.has(name)) return openIdx + 1;
  let depth = 1;
  let i = openIdx + 1;
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'open' && t.name === name && !t.selfClosing) depth++;
    else if (t.kind === 'close' && t.name === name) { depth--; if (depth === 0) return i + 1; }
  }
  return i;
}

let uid = 0;
function nid(p) { uid += 1; return `${p}-g${uid}`; }

const HEADING = /^h([1-6])$/;
// tags we descend INTO (their children become blocks) rather than map directly
const CONTAINERS = new Set(['div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'figure']);
const INLINE = new Set(['strong', 'b', 'em', 'i', 'u', 'small', 'span', 'code', 'mark', 'br', 'sup', 'sub']);

/**
 * @param {string} html
 * @returns {{ blocks: object[], mapped: number, leftover: number }}
 */
function htmlToBlocks(html) {
  uid = 0;
  const tokens = tokenize(String(html == null ? '' : html));
  const out = [];
  let mapped = 0;
  let leftover = 0;

  function flushRaw(buf) {
    const trimmed = buf.trim();
    if (!trimmed) return;
    leftover += 1;
    out.push({ type: 'html', id: nid('html'), data: { content: trimmed, provisional: true } });
  }

  function walk(from, to, sink) {
    let raw = '';
    let i = from;
    while (i < to) {
      const t = tokens[i];
      if (t.kind === 'text') {
        // bare text that isn't only whitespace becomes a text block
        if (t.value.trim()) { raw += t.value; }
        i++;
        continue;
      }
      if (t.kind !== 'open') { i++; continue; }

      const name = t.name;
      const end = matchClose(tokens, i);

      if (INLINE.has(name)) { raw += textOf(tokens, i, end) + ' '; i = end; continue; }

      // any pending raw text becomes a text block before we emit a real module
      if (raw.trim()) { sink.push({ type: 'text', id: nid('t'), data: { content: unescapeHtml(raw).replace(/\s+/g, ' ').trim() } }); mapped += 1; raw = ''; }

      const hm = HEADING.exec(name);
      if (hm) {
        sink.push({ type: 'heading', id: nid('h'), data: { level: Number(hm[1]), text: unescapeHtml(textOf(tokens, i + 1, end - 1)) } });
        mapped += 1; i = end; continue;
      }
      if (name === 'p') {
        sink.push({ type: 'text', id: nid('t'), data: { content: unescapeHtml(textOf(tokens, i + 1, end - 1)) } });
        mapped += 1; i = end; continue;
      }
      if (name === 'blockquote') {
        sink.push({ type: 'quote', id: nid('q'), data: { text: unescapeHtml(textOf(tokens, i + 1, end - 1)) } });
        mapped += 1; i = end; continue;
      }
      if (name === 'img') {
        sink.push({ type: 'image', id: nid('img'), data: { src: t.attrs.src || '', alt: t.attrs.alt || '' } });
        mapped += 1; i = end; continue;
      }
      if (name === 'a') {
        sink.push({ type: 'button', id: nid('b'), data: { text: unescapeHtml(textOf(tokens, i + 1, end - 1)) || 'קישור', url: t.attrs.href || '#' } });
        mapped += 1; i = end; continue;
      }
      if (name === 'hr') { sink.push({ type: 'divider', id: nid('d'), data: {} }); mapped += 1; i = end; continue; }
      if (name === 'ul' || name === 'ol') {
        const items = [];
        for (let j = i + 1; j < end - 1; j++) {
          if (tokens[j].kind === 'open' && tokens[j].name === 'li') {
            const liEnd = matchClose(tokens, j);
            items.push({ text: unescapeHtml(textOf(tokens, j + 1, liEnd - 1)) });
            j = liEnd - 1;
          }
        }
        if (items.length) { sink.push({ type: 'list', id: nid('list'), data: { ordered: name === 'ol', items } }); mapped += 1; }
        i = end; continue;
      }
      if (CONTAINERS.has(name)) {
        // descend: its children become blocks (the wrapper itself is dropped)
        walk(i + 1, end - 1, sink);
        i = end; continue;
      }

      // unmappable element → keep verbatim as leftover raw HTML
      let frag = '';
      for (let j = i; j < end; j++) frag += tokenToHtml(tokens[j]);
      raw += frag;
      i = end;
    }
    if (raw.trim()) {
      // trailing raw: text if it's plain, else a small html block
      if (/<[a-z]/i.test(raw)) flushRaw(raw);
      else { sink.push({ type: 'text', id: nid('t'), data: { content: unescapeHtml(raw).replace(/\s+/g, ' ').trim() } }); mapped += 1; }
    }
  }

  walk(0, tokens.length, out);
  return { blocks: out, mapped, leftover };
}

module.exports = { htmlToBlocks };
