'use strict';

/**
 * The MENU dialect of BenTML (v2.28) — the site's menus as one `.bent`
 * document, the format the Menu Organizer teaches a chat and reads back:
 *
 *   <bent-menus version="1" note="שירותים קובצו תחת הורה אחד">
 *     <bent-menu-layout placement="top" flow="wrap" fold="0" width="wide" />
 *     <bent-menu name="main" location="main">
 *       <bent-link label="הבית" page="home" />
 *       <bent-link label="שירותים" page="services">
 *         <bent-link label="עיצוב" page="services/design" />
 *       </bent-link>
 *       <bent-link label="מאמרים">            ← no target + children = a group
 *         <bent-link label="מדריך" page="blog/guide" />
 *       </bent-link>
 *       <bent-link label="חייגו" tel="+972501234567" />
 *     </bent-menu>
 *   </bent-menus>
 *
 * Why its own dialect and not the theme's: `bent-item` and `bent-nav` are
 * registered PAGE modules, so the menu grammar uses `bent-link` and
 * `bent-menu-layout`; the parser still accepts what a chat is likely to write
 * (item/li/a tags, href/slug/title attributes, curly quotes, an unclosed
 * parent, three nesting levels, a JSON reply) and reports every tolerance in
 * `notes[]` so the organizer can turn it into a warning the owner sees.
 *
 * This file knows NOTHING about the site (no pages, no db): page values are
 * normalized here (`/about.html` → `about`), resolved by src/menu-organizer.js.
 * The serializer is deterministic — same input, same bytes — and the pair
 * round-trips: serialize(parse(serialize(parse(x)))) === serialize(parse(x)).
 */

const { straightenQuotes } = require('./theme-dialect');

const TARGETS = ['page', 'url', 'tel', 'mailto', 'anchor'];
const KNOB_KEYS = ['placement', 'flow', 'fold', 'collapse', 'width', 'align', 'gap', 'size', 'current'];

// what a chat writes → what the grammar means
const TAG_ALIASES = { 'bent-link': 'bent-link', 'bent-item': 'bent-link', 'bent-menu-item': 'bent-link', item: 'bent-link', li: 'bent-link', a: 'bent-link' };
const ATTR_ALIASES = { href: 'url', link: 'url', to: 'url', slug: 'page', path: 'page', title: 'label', text: 'label', name: 'label', phone: 'tel', email: 'mailto', hash: 'anchor' };
// the theme dialect's names for the same knobs (kebab as written, camel as
// parseAttrs lowercases it): a chat that learned <bent-chrome> may reuse them
const KNOB_ALIASES = {
  menu: 'placement', 'menu-placement': 'placement', menuplacement: 'placement',
  'menu-overflow': 'flow', menuoverflow: 'flow', overflow: 'flow',
  'menu-fold': 'fold', menufold: 'fold',
  'menu-collapse': 'collapse', menucollapse: 'collapse',
  'header-width': 'width', headerwidth: 'width',
  'menu-align': 'align', menualign: 'align',
  'menu-gap': 'gap', menugap: 'gap',
  'menu-size': 'size', menusize: 'size',
  'menu-current': 'current', menucurrent: 'current'
};
const TYPE_TO_TARGET = { page: 'page', custom: 'url', link: 'url', url: 'url', tel: 'tel', phone: 'tel', mailto: 'mailto', email: 'mailto', anchor: 'anchor' };

// a curly quote in attribute position (after `=`, or closing a value before
// `>`): anchored on one char each, so the probe is linear — the old
// `/<[^>]*>/g` scan was O(n²) on a paste with `<` and no `>`
const CURLY_ATTR_RE = /=\s*[“”„‟″«»‘’‚‛′]|[“”„‟″«»‘’‚‛′]\s*\/?>/;
const LABEL_MAX = 40;
// invisible bidi/format marks a Hebrew chat UI wraps around a Latin path
// (RLM/LRM/ALM, ZW*, WJ, BOM): stripped from targets, never from labels
const BIDI_CODES = [0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0x2060, 0x061C, 0xFEFF]; // ZWSP ZWNJ ZWJ LRM RLM WJ ALM BOM
const BIDI_RE = new RegExp('[' + BIDI_CODES.map((c) => String.fromCharCode(c)).join('') + ']', 'g');
// a tag body longer than this is not a menu tag (a label is ≤ 40 chars, a
// url a few hundred): the cap keeps the tokenizer linear on a hostile paste
const BODY_MAX = 2000;

function escAttr(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function unescAttr(v) {
  return String(v == null ? '' : v).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * The attributes of one tag body → { name: value }, names lowercased.
 * A local variant of theme-dialect's parseAttrs: an UNQUOTED page value
 * carries slashes (page=blog/rtl-guide), which the theme's regex stops at.
 * A quoted value is line-bound (an unbalanced quote never spans the rest
 * of the paste — that was quadratic on `<a "` repeated).
 */
function parseAttrs(body) {
  const out = {};
  const src = String(body || '').replace(/\/\s*$/, '');
  const re = /([A-Za-z][\w-]*)\s*(?:=\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(src))) {
    if (!m[1]) { re.lastIndex++; continue; }
    out[m[1].toLowerCase()] = unescAttr(m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : '');
  }
  return out;
}

/**
 * Every tag in the text, quote-aware (a label may hold a `>`), in order.
 * A single left-to-right scan, not a regex: a quoted value is line-bound
 * (an unbalanced quote fails only its own tag), a bare `<` inside a body
 * starts the next tag, and a body over BODY_MAX is not a tag — so a hostile
 * paste of `<a "` costs O(n), where the old `"[^"]*"` regex was O(n²).
 */
const NAME_RE = /^[A-Za-z][\w-]*/;
function tokenize(src) {
  const s = String(src || '');
  const n = s.length;
  const out = [];
  let i = 0;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    let j = lt + 1;
    const close = s.charCodeAt(j) === 47; // '/'
    if (close) j++;
    const nm = NAME_RE.exec(s.slice(j, j + 80));
    if (!nm) { i = lt + 1; continue; }
    const bodyStart = j + nm[0].length;
    let k = bodyStart;
    let q = 0; // the open quote's char code, or 0
    let next = -1; // where the scan resumes
    while (k < n) {
      const c = s.charCodeAt(k);
      if (q) {
        if (c === q) q = 0;
        else if (c === 10) break; // newline inside a quote: this tag fails
      } else if (c === 62) { // '>' — the tag ends
        const body = s.slice(bodyStart, k);
        out.push({ close, name: nm[0].toLowerCase(), self: /\/\s*$/.test(body), attrs: close ? {} : parseAttrs(body), start: lt, end: k + 1 });
        next = k + 1;
        break;
      } else if (c === 34 || c === 39) q = c; // '"' / "'"
      else if (c === 60) { next = k; break; } // '<' — a new tag begins here
      if (k - bodyStart >= BODY_MAX) break; // not a menu tag
      k++;
    }
    i = next >= 0 ? next : lt + 1; // a failed tag: look for the next `<` after it
  }
  return out;
}

function pushNote(notes, code) {
  if (!notes.includes(code)) notes.push(code);
}

/** Invisible bidi/format marks out of a target value (RLM + `home` → `home`). */
function stripBidi(v) {
  return String(v == null ? '' : v).replace(BIDI_RE, '');
}

/** Strip what a chat adds around a page path: `/about.html` → `about`. */
function normalizePageValue(v) {
  return stripBidi(v).trim().replace(/^\/+/, '').replace(/\.html$/i, '').replace(/\/+$/, '').trim();
}

/** A raw attribute bag (from a tag or a JSON object) → one menu item. */
function itemFromAttrs(raw, notes) {
  const a = {};
  for (const key of Object.keys(raw || {})) {
    const k = String(key).toLowerCase();
    const canon = ATTR_ALIASES[k];
    if (canon) {
      pushNote(notes, 'ATTR_ALIAS');
      if (a[canon] === undefined) a[canon] = raw[key];
    } else a[k] = raw[key];
  }
  // the JSON shape a model may echo: type="page" target="x"
  if (a.type !== undefined && a.target !== undefined) {
    const t = TYPE_TO_TARGET[String(a.type).toLowerCase()];
    if (t && a[t] === undefined) { a[t] = a.target; pushNote(notes, 'ATTR_ALIAS'); }
  }
  const item = { label: '', type: 'custom', target: '', url: '#', children: [] };
  let label = a.label == null ? '' : String(a.label).trim();
  if (label.length > LABEL_MAX) { label = label.slice(0, LABEL_MAX).trim(); pushNote(notes, 'LABEL_TRIMMED'); }
  item.label = label;
  item.labelSet = a.label !== undefined;

  const key = TARGETS.find((t) => a[t] !== undefined && (t === 'page' || String(a[t]).trim() !== ''));
  // a second target on the same link (page= and url=) is ignored, and said
  if (key && TARGETS.some((t) => t !== key && a[t] !== undefined && String(a[t]).trim() !== '')) pushNote(notes, 'EXTRA_TARGET_IGNORED');
  if (key === 'page') {
    const v = stripBidi(a.page).trim();
    if (/^https?:\/\//i.test(v)) {
      // a page attribute holding a full address is a url that lost its name
      item.type = 'custom'; item.url = v; pushNote(notes, 'TARGET_RETYPED');
    } else { item.type = 'page'; item.target = normalizePageValue(v); item.url = ''; }
  } else if (key === 'url') {
    item.type = 'custom'; item.url = stripBidi(a.url).trim();
  } else if (key === 'tel') {
    item.type = 'tel'; item.target = stripBidi(a.tel).replace(/^tel:/i, '').trim(); item.url = '';
  } else if (key === 'mailto') {
    item.type = 'mailto'; item.target = stripBidi(a.mailto).replace(/^mailto:/i, '').trim(); item.url = '';
  } else if (key === 'anchor') {
    item.type = 'anchor'; item.target = stripBidi(a.anchor).trim().replace(/^#/, ''); item.url = '';
  }
  return item;
}

/** One-level nesting: a grandchild is lifted after its parent, never dropped. */
function limitDepth(items, depth, notes) {
  const out = [];
  for (const it of items || []) {
    const kids = Array.isArray(it.children) ? it.children : [];
    if (depth === 0) {
      it.children = limitDepth(kids, 1, notes);
      out.push(it);
    } else {
      it.children = [];
      out.push(it);
      if (kids.length) { pushNote(notes, 'DEPTH_FLATTENED'); out.push(...limitDepth(kids, 1, notes)); }
    }
  }
  return out;
}

/** Labels: inner text stands in for a missing attribute; still empty → 'פריט'. */
function finishItems(items, notes) {
  for (const it of items || []) {
    if (!it.labelSet && it.fromText) pushNote(notes, 'LABEL_FROM_TEXT');
    if (!it.label) { it.label = 'פריט'; pushNote(notes, 'LABEL_EMPTY'); }
    delete it.labelSet; delete it.fromText; delete it.aOpen; delete it.fromLi;
    finishItems(it.children, notes);
  }
  return items;
}

/** One region (a `<bent-menus>` document or the whole reply) → menus. */
function parseRegion(src, notes) {
  const tokens = tokenize(src);
  const menus = [];
  let current = null;
  let stack = [];
  let lastEnd = 0;
  let version = 1;
  let note = '';

  const closeMenu = () => {
    if (!current) return;
    if (stack.length) pushNote(notes, 'UNCLOSED_LINK');
    stack = [];
    const same = menus.find((m) => m.name === current.name);
    if (same) same.items.push(...current.items); else menus.push(current);
    current = null;
  };

  for (const tok of tokens) {
    // text between tags belongs to the innermost open link (<a href>אודות</a>)
    const text = src.slice(lastEnd, tok.start).replace(/\s+/g, ' ').trim();
    if (text && stack.length) {
      const top = stack[stack.length - 1];
      if (!top.labelSet && !top.label && !top.children.length) {
        top.label = text.length > LABEL_MAX ? text.slice(0, LABEL_MAX).trim() : text;
        if (text.length > LABEL_MAX) pushNote(notes, 'LABEL_TRIMMED');
        top.fromText = true;
      }
    }
    lastEnd = tok.end;

    if (tok.name === 'bent-menus') {
      if (tok.close) closeMenu();
      else {
        if (tok.attrs.version !== undefined) version = parseInt(tok.attrs.version, 10) || 1;
        if (tok.attrs.note !== undefined) note = String(tok.attrs.note).trim();
      }
      continue;
    }
    if (tok.name === 'bent-menu-layout') continue; // read once, over the whole text
    if (tok.name === 'bent-menu') {
      closeMenu();
      if (tok.close) continue;
      let name = tok.attrs.name;
      if (name === undefined && tok.attrs.id !== undefined) { name = tok.attrs.id; pushNote(notes, 'ATTR_ALIAS'); }
      name = String(name == null ? '' : name).trim().toLowerCase();
      if (!name) { name = 'main'; pushNote(notes, 'MENU_NAME_DEFAULTED'); }
      const location = tok.attrs.location !== undefined ? String(tok.attrs.location).trim().toLowerCase() : '';
      current = { name, location, items: [] };
      if (tok.self) closeMenu();
      continue;
    }
    const tag = TAG_ALIASES[tok.name];
    if (!tag || !current) continue; // prose html outside a menu is not a link
    if (tok.name !== 'bent-link') pushNote(notes, 'TAG_ALIAS');
    const top = stack[stack.length - 1];
    if (tok.close) {
      if (!top) continue; // a stray closer
      if (tok.name === 'a' && top.aOpen) { top.aOpen = false; continue; }
      stack.pop();
      continue;
    }
    // <li><a href>…</a></li>: the anchor IS the list item, not its child
    if (tok.name === 'a' && top && top.fromLi && !top.labelSet && !top.label && top.type === 'custom' && top.url === '#' && !top.children.length) {
      const merged = itemFromAttrs(tok.attrs, notes);
      Object.assign(top, merged, { fromLi: true, aOpen: !tok.self });
      continue;
    }
    const item = itemFromAttrs(tok.attrs, notes);
    if (tok.name === 'li') item.fromLi = true;
    if (top) top.children.push(item); else current.items.push(item);
    if (!tok.self) stack.push(item);
  }
  closeMenu();

  const out = {};
  for (const m of menus) {
    const items = finishItems(limitDepth(m.items, 0, notes), notes);
    out[m.name] = { location: m.location, items };
  }
  return { version, note, menus: out };
}

/**
 * The candidate with the most typed links wins (an echoed template scores
 * low). The organizer passes a site-aware `rank` (links whose page exists)
 * as the primary score; this stays the tie-breaker.
 */
function richness(parsed) {
  let n = 0;
  const walk = (items) => (items || []).forEach((it) => { if (it.type !== 'custom' || it.url !== '#') n++; walk(it.children); });
  Object.values(parsed.menus).forEach((m) => walk(m.items));
  return n;
}

/** `<bent-menu-layout …/>` anywhere in the text → its raw attributes. */
function readLayout(src, notes) {
  const found = tokenize(src).filter((t) => t.name === 'bent-menu-layout' && !t.close);
  if (!found.length) return {};
  if (found.length > 1) pushNote(notes, 'LAYOUT_DUPLICATE');
  const raw = found[found.length - 1].attrs; // duplicates: last wins
  const knobs = {};
  for (const key of Object.keys(raw)) {
    let k = key;
    if (KNOB_ALIASES[k]) { k = KNOB_ALIASES[k]; pushNote(notes, 'ATTR_ALIAS'); }
    if (KNOB_KEYS.includes(k)) knobs[k] = String(raw[key]).trim();
  }
  return knobs;
}

/** A JSON reply: {menus:{main:[…]}} · {main:[…]} · a bare items array. */
function parseJsonReply(text) {
  const candidates = [];
  const t = String(text || '').trim();
  candidates.push(t);
  for (const m of t.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) candidates.push(m[1].trim());
  const a = t.search(/[{[]/);
  if (a >= 0) {
    const b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (b > a) candidates.push(t.slice(a, b + 1));
  }
  for (const c of candidates) {
    if (!c || !/^[{[]/.test(c)) continue;
    try {
      const j = JSON.parse(c);
      if (Array.isArray(j)) return { menus: { main: j } };
      if (j && typeof j === 'object') {
        if (j.menus && typeof j.menus === 'object') return j;
        if (Array.isArray(j.main) || Array.isArray(j.footer) || Array.isArray(j.items)) {
          return { menus: { main: j.main || j.items || [], ...(Array.isArray(j.footer) ? { footer: j.footer } : {}) }, knobs: j.knobs || j.layout, note: j.note, locations: j.locations };
        }
      }
    } catch (e) { /* not this candidate */ }
  }
  return null;
}

function jsonItems(list, notes) {
  return (Array.isArray(list) ? list : []).map((o) => {
    const src = o && typeof o === 'object' ? o : { label: String(o) };
    const item = itemFromAttrs(src, notes);
    item.children = jsonItems(src.children || src.items, notes);
    return item;
  });
}

/** Is this text a menu document (anywhere inside prose or a fence)? */
function isMenuBent(text) {
  const src = String(text || '');
  if (/<bent-menu(?=[\s/>])/i.test(src)) return true;
  const j = parseJsonReply(src);
  return !!(j && j.menus && Object.keys(j.menus).length);
}

/**
 * Parse the menus out of anything that contains them.
 * @param {string} text
 * @param {{ rank?: (parsed: object) => number }} [opts]
 *   rank = a site-aware score for a candidate document (the organizer counts
 *   the links whose page exists); the richest candidate breaks a tie
 * @returns {{ version:number, note:string, knobs:object, menus:{[name]:{location:string, items:object[]}}, notes:string[] }}
 *   knobs = the raw <bent-menu-layout> attributes (values checked by theme.knobsToOverrides)
 *   menus = {} when nothing menu-shaped was found (the organizer decides the refusal)
 */
function parseMenusDoc(text, opts = {}) {
  const notes = [];
  let src = String(text || '').replace(/[​⁠﻿]/g, '');
  if (CURLY_ATTR_RE.test(src)) pushNote(notes, 'CURLY_QUOTES');
  src = straightenQuotes(src);

  const knobs = readLayout(src, notes);

  const regions = [];
  const openRe = /<bent-menus(?=[\s/>])/gi;
  const closeRe = /<\/bent-menus\s*>/gi;
  let m;
  while ((m = openRe.exec(src))) {
    closeRe.lastIndex = m.index;
    const c = closeRe.exec(src); // one forward scan per region — linear overall
    regions.push(c ? src.slice(m.index, c.index + c[0].length) : src.slice(m.index));
    if (!c) break;
    openRe.lastIndex = c.index + c[0].length;
  }
  const hasMenu = /<bent-menu(?=[\s/>])/i.test(src);
  if (!regions.length && hasMenu) { pushNote(notes, 'NO_WRAPPER'); regions.push(src); }

  let best = null;
  if (regions.length) {
    const cands = regions.map((r) => parseRegion(r, notes));
    const rank = typeof opts.rank === 'function' ? opts.rank : () => 0;
    const score = (c) => { const r = Number(rank(c)) || 0; return [r, richness(c)]; };
    best = cands[0];
    let bestScore = score(best);
    for (const c of cands) {
      const s = score(c);
      if (s[0] > bestScore[0] || (s[0] === bestScore[0] && s[1] > bestScore[1])) { best = c; bestScore = s; }
    }
    if (cands.length > 1) pushNote(notes, 'SEVERAL_DOCUMENTS');
  }
  if (!best || !Object.keys(best.menus).length) {
    const j = hasMenu ? null : parseJsonReply(src);
    if (j && j.menus && typeof j.menus === 'object') {
      pushNote(notes, 'JSON_FALLBACK');
      const menus = {};
      for (const name of Object.keys(j.menus)) {
        const raw = j.menus[name];
        const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : []);
        const location = raw && !Array.isArray(raw) && raw.location ? String(raw.location) : ((j.locations || {})[name] ? name : '');
        menus[String(name).toLowerCase()] = { location, items: finishItems(limitDepth(jsonItems(list, notes), 0, notes), notes) };
      }
      const jk = {};
      for (const k of Object.keys(j.knobs || {})) if (KNOB_KEYS.includes(k)) jk[k] = String(j.knobs[k]);
      best = { version: 1, note: String(j.note || '').trim(), menus, knobsFromJson: jk };
    }
  }
  if (!best) return { version: 1, note: '', knobs, menus: {}, notes };
  return { version: best.version || 1, note: best.note || '', knobs: Object.keys(knobs).length ? knobs : (best.knobsFromJson || {}), menus: best.menus, notes };
}

// ── serializer ──────────────────────────────────────────────────────

function targetAttr(item) {
  const t = String(item.target || '').trim();
  const url = String(item.url || '').trim();
  switch (item.type) {
    case 'page': return ` page="${escAttr(t)}"`;
    case 'tel': return ` tel="${escAttr(t)}"`;
    case 'mailto': return ` mailto="${escAttr(t)}"`;
    case 'anchor': return ` anchor="${escAttr(t.replace(/^#/, ''))}"`;
    default: {
      const u = url || t;
      // a parent with no address of its own is a group — no target attribute
      if ((u === '#' || u === '') && item.children && item.children.length) return '';
      return ` url="${escAttr(u || '#')}"`;
    }
  }
}

function serializeItem(item, indent) {
  const pad = ' '.repeat(indent);
  const open = `${pad}<bent-link label="${escAttr(item.label)}"${targetAttr(item)}`;
  const kids = (item.children || []).filter(Boolean);
  if (!kids.length) return open + ' />';
  return [open + '>', ...kids.map((c) => serializeItem({ ...c, children: [] }, indent + 2)), `${pad}</bent-link>`].join('\n');
}

/** Menu order: main, footer, then the rest alphabetically. */
function orderNames(names) {
  const fixed = ['main', 'footer'].filter((n) => names.includes(n));
  const rest = names.filter((n) => !fixed.includes(n)).sort();
  return fixed.concat(rest);
}

/**
 * Serialize menus (+ the layout knobs and the location map) as a `.bent`
 * document. Deterministic: same input, same bytes.
 * @param {{ knobs?: object, menus: {[name]: object[]|{items:object[], location?:string}}, locations?: object, note?: string }} doc
 */
function serializeMenus({ knobs, menus, locations, note } = {}) {
  const lines = [`<bent-menus version="1"${note ? ` note="${escAttr(note)}"` : ''}>`];
  const k = knobs || {};
  const attrs = KNOB_KEYS.filter((key) => k[key] !== undefined && k[key] !== null && String(k[key]) !== '').map((key) => `${key}="${escAttr(k[key])}"`);
  if (attrs.length) lines.push(`  <bent-menu-layout ${attrs.join(' ')} />`);
  const all = menus || {};
  const loc = locations || {};
  for (const name of orderNames(Object.keys(all))) {
    const entry = all[name];
    const items = Array.isArray(entry) ? entry : (entry && Array.isArray(entry.items) ? entry.items : []);
    let location = ['main', 'footer'].find((l) => loc[l] === name) || '';
    if (!location && entry && !Array.isArray(entry) && entry.location) location = String(entry.location);
    lines.push(`  <bent-menu name="${escAttr(name)}"${location ? ` location="${escAttr(location)}"` : ''}>`);
    for (const it of items) lines.push(serializeItem(it, 4));
    lines.push('  </bent-menu>');
  }
  lines.push('</bent-menus>');
  return lines.join('\n') + '\n';
}

module.exports = { isMenuBent, parseMenusDoc, serializeMenus, normalizePageValue, stripBidi, itemFromAttrs, TARGETS, KNOB_KEYS, BODY_MAX };
