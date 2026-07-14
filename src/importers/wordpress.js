'use strict';

/**
 * WordPress export-file importer (WXR) — the "build straight from the file"
 * path, the complement to the HTML reverse-engineer decompiler.
 *
 * A WXR is XML; each <item> of type page/post carries its body in
 * <content:encoded> as Gutenberg HTML — HTML annotated with block comments:
 *
 *     <!-- wp:heading {"level":3} --><h3>שלום</h3><!-- /wp:heading -->
 *     <!-- wp:columns --><!-- wp:column -->…<!-- /wp:column --><!-- /wp:columns -->
 *
 * Those comments ARE the structure the author built, so we map them straight
 * to Tapuz blocks (high fidelity, no guessing). Anything we don't model —
 * plugin blocks, classic/Elementor HTML with no wp: comments — falls back to
 * the decompiler, so nothing is ever lost.
 */

const { decompileHtml } = require('../pzn/decompile');
const { unescapeHtml } = require('../pzn/language/escape');

let _uid = 0;
const nid = (p) => `${p}-wp${++_uid}`;
const block = (type, data) => ({ type, id: nid(type), data });

// ── WXR → items ───────────────────────────────────────────────────────────

function cdata(raw) {
  // <![CDATA[ … ]]> is raw HTML (kept verbatim); a plain value is entity-decoded
  const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(raw);
  return m ? m[1] : unescapeHtml(raw.trim());
}
function tagValue(item, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(item);
  return m ? cdata(m[1]) : '';
}

/** Parse a WXR string into publishable items (pages + posts, published only). */
function parseWxr(xml) {
  const out = [];
  const items = String(xml).match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const item of items) {
    const type = tagValue(item, 'wp:post_type');
    if (type !== 'page' && type !== 'post') continue;
    const status = tagValue(item, 'wp:status');
    if (status && status !== 'publish') continue;
    const title = tagValue(item, 'title').trim();
    const content = tagValue(item, 'content:encoded');
    if (!title && !content.trim()) continue;
    out.push({
      title: title || 'ללא כותרת',
      slug: (tagValue(item, 'wp:post_name') || '').trim(),
      type,
      content,
      date: tagValue(item, 'wp:post_date') || ''
    });
  }
  return out;
}

// ── Gutenberg block comments → a tree ───────────────────────────────────────

/**
 * Split Gutenberg HTML into top-level segments, each either a wp: block (with
 * its raw inner HTML and any nested wp: blocks) or a run of freeform HTML.
 * Depth-tracked so nested columns/group parse correctly.
 * @returns {{wp:string|null, attrs:object, inner:string}[]}
 */
function splitGutenberg(html) {
  const token = /<!--\s*(\/?)wp:([a-z0-9/-]+)(\s+\{[\s\S]*?\})?\s*(\/?)-->/g;
  const segs = [];
  let depth = 0, openStart = -1, openName = '', openAttrs = {}, freeStart = 0, m;
  const pushFree = (end) => {
    const s = html.slice(freeStart, end);
    if (s.trim()) segs.push({ wp: null, attrs: {}, inner: s });
  };
  while ((m = token.exec(html))) {
    const [full, closing, name, attrRaw, selfClose] = m;
    if (selfClose) { // void block, e.g. <!-- wp:spacer {…} /-->
      if (depth === 0) { pushFree(m.index); segs.push({ wp: name, attrs: parseAttrs(attrRaw), inner: '' }); freeStart = m.index + full.length; }
      continue;
    }
    if (!closing) { // opener
      if (depth === 0) { pushFree(m.index); openStart = m.index + full.length; openName = name; openAttrs = parseAttrs(attrRaw); }
      depth++;
    } else { // closer
      depth--;
      if (depth === 0) { segs.push({ wp: openName, attrs: openAttrs, inner: html.slice(openStart, m.index) }); freeStart = m.index + full.length; }
    }
  }
  pushFree(html.length);
  return segs;
}
function parseAttrs(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw.trim()); } catch (e) { return {}; }
}

// ── segment tree → Tapuz blocks ─────────────────────────────────────────────

const HEADING_RE = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/i;
const strip = (h) => unescapeHtml(String(h).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const attr = (h, name) => { const m = new RegExp(`${name}="([^"]*)"`, 'i').exec(h); return m ? unescapeHtml(m[1]) : ''; };

/** One Gutenberg segment → zero or more blocks. Unknown → decompiler fallback. */
function segToBlocks(seg) {
  if (seg.wp === null) return fallback(seg.inner);
  const core = seg.wp.replace(/^core\//, '');
  const h = seg.inner;
  switch (core) {
    case 'paragraph': {
      const text = strip(h);
      return text ? [block('text', { content: text })] : [];
    }
    case 'heading': {
      const m = HEADING_RE.exec(h);
      const level = seg.attrs.level || (m ? Number(m[1]) : 2);
      const text = strip(m ? m[2] : h);
      return text ? [block('heading', { level, text })] : [];
    }
    case 'image':
    case 'cover': {
      const src = attr(h, 'src') || seg.attrs.url || '';
      return src ? [block('image', { src, alt: attr(h, 'alt') })] : fallback(h);
    }
    case 'quote':
    case 'pullquote':
      return [block('quote', { text: strip(h) })];
    case 'list': {
      const items = (h.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || []).map((li) => ({ text: strip(li) })).filter((it) => it.text);
      return items.length ? [block('list', { ordered: /^<ol/i.test(h.trim()) || seg.attrs.ordered === true, items })] : [];
    }
    case 'separator':
      return [block('divider', {})];
    case 'button': {
      const label = strip(h);
      return label ? [block('button', { text: label, url: attr(h, 'href') || '#' })] : [];
    }
    case 'buttons':
      return splitGutenberg(h).flatMap(segToBlocks);
    case 'columns': {
      const cols = splitGutenberg(h).filter((s) => (s.wp || '').replace(/^core\//, '') === 'column')
        .map((s) => ({ blocks: splitGutenberg(s.inner).flatMap(segToBlocks) }))
        .filter((c) => c.blocks.length);
      if (cols.length >= 2) {
        const ratio = cols.map(() => Math.round(100 / cols.length)).join(':');
        return [block('columns', { columns: cols, gap: 'md', ratio })];
      }
      return cols.flatMap((c) => c.blocks);
    }
    case 'group':
    case 'column':
      return splitGutenberg(h).flatMap(segToBlocks);
    case 'embed':
    case 'video':
      return [block('embed', { url: seg.attrs.url || attr(h, 'src') || '' })];
    case 'spacer':
      return [block('spacer', { size: 'md' })];
    default:
      return fallback(h); // plugin/unknown block → reverse-engineer its HTML
  }
}

/** Reverse-engineer a fragment we don't model structurally. */
function fallback(html) {
  if (!html || !html.trim()) return [];
  try {
    const r = decompileHtml(html);
    return (r.blocks || []).filter((b) => b.type !== 'html' || (b.data && b.data.content && b.data.content.trim()));
  } catch (e) {
    const text = strip(html);
    return text ? [block('text', { content: text })] : [];
  }
}

/** WXR item body → Tapuz blocks. */
function contentToBlocks(content) {
  if (!content || !content.trim()) return [];
  if (/<!--\s*wp:/.test(content)) return splitGutenberg(content).flatMap(segToBlocks);
  return fallback(content); // classic / Elementor / no Gutenberg → decompiler
}

/** Public: a WXR string → normalized pages the framework turns into .pzn. */
function wordpressToPages(xml) {
  return parseWxr(xml).map((item) => ({
    title: item.title,
    slug: item.slug,
    blocks: contentToBlocks(item.content)
  }));
}

module.exports = { wordpressToPages, parseWxr, contentToBlocks, splitGutenberg };
