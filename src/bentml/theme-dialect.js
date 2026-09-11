'use strict';

/**
 * The theme DIALECT of BenTML (v2.26) — a theme as a `.bent` document.
 *
 * Ben: "engineer BenTML to be precise and the end result for all our UI …
 * we are not to stay like JSON, we are working as .bent." Until now a theme
 * travelled as a JSON package (tapuz-theme v1/v2) while pages travelled as
 * BenTML. Now a theme is a BenTML document too — one file a person can read,
 * edit, share, inherit and ask a chat to write:
 *
 *   <bent-theme name="פריז" version="2">
 *     <bent-colors primary="#7c2d12" secondary="#b45309" text="#292524" muted="#6b5d52"
 *                  border="#dccbb0" bg="#f6efe3" light-bg="#efe4d0" surface="#fbf7ef" />
 *     <bent-fonts family='"David Libre", serif' heading='"Frank Ruhl Libre", serif'
 *                 base-size="17px" google="Frank Ruhl Libre, David Libre" />
 *     <bent-style radius="sharp" shadow="flat" accent="solid" buttons="outline" />
 *     <bent-layout max-width="1100px" menu="top" />
 *     <bent-background kind="lines" angle="135" />
 *     <bent-chrome menu-hover="underline" header-bg="" header-text="" header-glass="false"
 *                  footer-bg="#292524" footer-text="#dccbb0" />
 *     <bent-skin note="קווים כפולים"><style>…css…</style></bent-skin>
 *     <bent-effect note="עקבת עכבר"><style>…css…</style><script>…js…</script></bent-effect>
 *     <bent-canvas>…the bench: bent-* modules…</bent-canvas>
 *   </bent-theme>
 *
 * Every section is optional; an absent section keeps the defaults. The
 * parser is deliberately tolerant (single or double quotes, kebab or camel
 * attribute names, any order, chat prose or a fence around the document)
 * and the serializer is deterministic, so a document round-trips exactly.
 * The JSON package stays readable for old files; this is the format that is
 * written, exported, and asked of a chat from here on.
 */

const FORMAT = 'tapuz-theme';
const VERSION = 2;

// section tag → overrides key → [attribute, dataKey] pairs
const SECTIONS = {
  colors: ['primary', 'secondary', 'text', 'muted', 'border', 'bg', ['light-bg', 'lightBg'], 'surface'],
  fonts: ['family', ['heading', 'headingFamily'], ['base-size', 'baseSize'], 'google'],
  style: ['radius', 'shadow', 'accent', 'buttons'],
  layout: [['max-width', 'maxWidth'], ['menu', 'menuPlacement']],
  background: ['kind', 'angle'],
  chrome: [['menu-hover', 'menuHover'], ['menu-hover-color', 'menuHoverColor'], ['menu-weight', 'menuWeight'],
    ['header-bg', 'headerBg'], ['header-text', 'headerText'], ['header-glass', 'headerGlass'],
    ['footer-bg', 'footerBg'], ['footer-text', 'footerText']]
};

function pairs(section) {
  return SECTIONS[section].map((p) => (Array.isArray(p) ? p : [p, p]));
}

function escAttr(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function unescAttr(v) {
  return String(v == null ? '' : v).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** `<bent-x a="1" b='2' c>` → { a: '1', b: '2', c: '' }, kebab kept as written. */
function parseAttrs(tagOpen) {
  const out = {};
  const re = /([A-Za-z][\w-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>\/]+)))?/g;
  const body = tagOpen.replace(/^<[A-Za-z][\w-]*/, '').replace(/\/?>$/, '');
  let m;
  while ((m = re.exec(body))) {
    out[m[1].toLowerCase()] = unescAttr(m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : '');
  }
  return out;
}

/** The whole tag `<bent-x …>…</bent-x>` or `<bent-x … />` → { attrs, inner }. */
function findSection(source, name) {
  const re = new RegExp('<bent-' + name + '\\b([^>]*)>', 'i');
  const m = source.match(re);
  if (!m) return null;
  const open = m[0];
  const attrs = parseAttrs(open);
  if (/\/\s*>$/.test(open)) return { attrs, inner: '' };
  const start = m.index + open.length;
  const close = source.slice(start).search(new RegExp('</bent-' + name + '\\s*>', 'i'));
  return { attrs, inner: close === -1 ? source.slice(start) : source.slice(start, start + close) };
}

function innerTag(html, tag) {
  const m = String(html || '').match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '\\s*>', 'i'));
  // the serializer defuses a closer inside the payload as <\/script; undo it
  return m ? dedent(m[1]).replace(/<\\\/(script|style)/gi, '</$1') : '';
}

/** Strip the common leading indentation (the serializer indents nested
 *  content; a parse must hand back what was put in). */
function dedent(text) {
  const lines = String(text || '').replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length);
  const n = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(Math.min(n, l.match(/^[ \t]*/)[0].length))).join('\n').trim();
}

/** Is this text a theme document (anywhere inside prose or a fence)? */
function isThemeBent(text) {
  return /<bent-theme\b/i.test(String(text || ''));
}

/**
 * Parse a `.bent` theme out of anything that contains one.
 * @returns {{ name: string, version: number, overrides: object, canvas: string }}
 */
function parseTheme(text) {
  const src = String(text || '').replace(/[​⁠﻿]/g, '');
  const root = findSection(src, 'theme');
  if (!root) throw new Error('לא נמצא מסמך <bent-theme> בטקסט');
  const overrides = {};
  for (const section of Object.keys(SECTIONS)) {
    const sec = findSection(root.inner, section);
    if (!sec) continue;
    const out = {};
    for (const [attr, key] of pairs(section)) {
      const camel = key.toLowerCase();
      const v = sec.attrs[attr] !== undefined ? sec.attrs[attr] : sec.attrs[camel];
      if (v === undefined) continue;
      if (key === 'google') out.google = String(v).split(',').map((s) => s.trim()).filter(Boolean);
      else if (key === 'headerGlass') out.headerGlass = /^(true|1|yes|on)$/i.test(v);
      else if (key === 'angle') out.angle = Number(v) || 160;
      else out[key] = String(v);
    }
    if (Object.keys(out).length) overrides[section] = out;
  }
  const skin = findSection(root.inner, 'skin');
  if (skin) {
    const css = innerTag(skin.inner, 'style') || skin.inner.trim();
    overrides.skin = { css, note: skin.attrs.note || '' };
  }
  const effect = findSection(root.inner, 'effect') || findSection(root.inner, 'effects');
  if (effect) {
    overrides.effects = {
      css: innerTag(effect.inner, 'style'),
      js: innerTag(effect.inner, 'script'),
      note: effect.attrs.note || ''
    };
  }
  const canvas = findSection(root.inner, 'canvas');
  return {
    name: String(root.attrs.name || '').trim().slice(0, 120),
    version: Number(root.attrs.version) || VERSION,
    overrides,
    canvas: canvas ? dedent(canvas.inner) : ''
  };
}

/**
 * Serialize a theme (name + overrides + optional bench source) as a `.bent`
 * document. Deterministic: same input, same bytes.
 */
function serializeTheme({ name, overrides, canvas } = {}) {
  const o = overrides || {};
  const lines = [`<bent-theme name="${escAttr(name || 'ערכת נושא')}" format="${FORMAT}" version="${VERSION}">`];
  for (const section of Object.keys(SECTIONS)) {
    const data = o[section];
    if (!data || typeof data !== 'object') continue;
    const attrs = [];
    for (const [attr, key] of pairs(section)) {
      if (data[key] === undefined || data[key] === null) continue;
      const v = key === 'google' ? (Array.isArray(data.google) ? data.google.join(', ') : String(data.google)) : String(data[key]);
      attrs.push(`${attr}="${escAttr(v)}"`);
    }
    if (attrs.length) lines.push(`  <bent-${section} ${attrs.join(' ')} />`);
  }
  const skin = o.skin && String(o.skin.css || '').trim();
  if (skin) {
    lines.push(`  <bent-skin${o.skin.note ? ` note="${escAttr(o.skin.note)}"` : ''}>`);
    lines.push('    <style>');
    lines.push(skin.replace(/<\/style/gi, '<\\/style'));
    lines.push('    </style>');
    lines.push('  </bent-skin>');
  }
  const fx = o.effects || {};
  const fxCss = String(fx.css || '').trim();
  const fxJs = String(fx.js || '').trim();
  if (fxCss || fxJs) {
    lines.push(`  <bent-effect${fx.note ? ` note="${escAttr(fx.note)}"` : ''}>`);
    if (fxCss) { lines.push('    <style>'); lines.push(fxCss.replace(/<\/style/gi, '<\\/style')); lines.push('    </style>'); }
    if (fxJs) { lines.push('    <script>'); lines.push(fxJs.replace(/<\/script/gi, '<\\/script')); lines.push('    </script>'); }
    lines.push('  </bent-effect>');
  }
  const bench = String(canvas || '').trim();
  if (bench) {
    lines.push('  <bent-canvas>');
    lines.push(bench.split('\n').map((l) => '    ' + l).join('\n'));
    lines.push('  </bent-canvas>');
  }
  lines.push('</bent-theme>');
  return lines.join('\n') + '\n';
}

module.exports = { FORMAT, VERSION, SECTIONS, isThemeBent, parseTheme, serializeTheme, parseAttrs, dedent };
