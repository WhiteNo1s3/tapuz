'use strict';

/**
 * The theme CANVAS (v2.25) — the studio's workbench, a specimen that is NOT
 * a page.
 *
 * Ben: "allow a canvas of nothing, and we paste modules to create the theme
 * manually or with the AI chatbot roleplay — it is not a page, so it needs
 * to be theme-wide." A theme is judged across modules, not on whatever the
 * home page happens to hold. So the canvas starts EMPTY (the theme's header
 * and footer around nothing) and fills with modules the owner puts there:
 *   • pasted BenTML / .pzn — from the builder, from the site-builder
 *     roleplay in their own chat, from anywhere ("take only the BenTML")
 *   • a module from the palette, with the showcase's sample data
 *   • the whole showcase in one click
 * ROWS (v2.25, Ben: "as we build a theme it's common to have 5 modules in
 * the same row — compete with Elementor"): a row is a `columns` block with
 * 1–6 cells; modules land in a cell (from the palette or a paste) and render
 * side by side, stacking on phones like every columns block in the theme.
 *
 * It is stored beside the theme (config/theme-canvas.json), NOT inside it:
 * the canvas is the bench, the theme is what is being built on it — switch
 * themes and the same modules stay on the bench.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// v2.26: the bench IS a BenTML document (config/theme-canvas.bent) — the
// source is the truth, blocks are compiled from it on every read and written
// back through the lossless bridge after every operation. A theme-canvas.json
// left by v2.25 is migrated on first read and removed.
const CANVAS_PATH = path.join(require('./paths').CONFIG_DIR, 'theme-canvas.bent');
const LEGACY_JSON_PATH = path.join(require('./paths').CONFIG_DIR, 'theme-canvas.json');
const MAX_BLOCKS = 120;
const CANVAS_TITLE = 'קנבס הערכה';

/** The bench's BenTML source ('' when there is no bench yet). */
function loadSource() {
  try {
    if (fs.existsSync(CANVAS_PATH)) return fs.readFileSync(CANVAS_PATH, 'utf8');
    if (fs.existsSync(LEGACY_JSON_PATH)) {
      const data = JSON.parse(fs.readFileSync(LEGACY_JSON_PATH, 'utf8'));
      if (data && Array.isArray(data.blocks)) {
        const src = blocksToSource(data.blocks);
        fs.writeFileSync(CANVAS_PATH, src, 'utf8');
        fs.unlinkSync(LEGACY_JSON_PATH);
        return src;
      }
    }
  } catch (e) { /* a corrupt bench reads as empty, never crashes the studio */ }
  return '';
}

/** Blocks → a complete BenTML document (the bridge is lossless both ways). */
function blocksToSource(blocks) {
  const pzn = require('./pzn/index');
  const doc = pzn.fromTapuzPage({ title: CANVAS_TITLE, slug: '__theme-canvas', blocks: (blocks || []).slice(0, MAX_BLOCKS) });
  return pzn.serialize(doc);
}

/** Source → blocks; a source with no modules (or none at all) is an empty bench. */
function sourceToBlocks(source) {
  const text = String(source || '');
  if (!/<bent-[a-z]/i.test(text)) return [];
  const { pznSourceToBlocks } = require('./pzn-source');
  try {
    return (pznSourceToBlocks(text).view.blocks || []).map(withId);
  } catch (e) {
    return [];
  }
}

function loadCanvas() {
  const source = loadSource();
  let updatedAt = '';
  try { updatedAt = fs.existsSync(CANVAS_PATH) ? fs.statSync(CANVAS_PATH).mtime.toISOString() : ''; } catch (e) { /* no stamp */ }
  return { blocks: sourceToBlocks(source), source, updatedAt };
}

function saveCanvas(blocks) {
  fs.mkdirSync(path.dirname(CANVAS_PATH), { recursive: true });
  const list = (blocks || []).slice(0, MAX_BLOCKS);
  const source = blocksToSource(list);
  fs.writeFileSync(CANVAS_PATH, source, 'utf8');
  // re-read through the compiler so what the caller holds is exactly what
  // the file says — the source is the truth, not the in-memory blocks
  return { blocks: sourceToBlocks(source), source, updatedAt: new Date().toISOString() };
}

function withId(block) {
  const b = { ...block };
  if (!b.id) b.id = String(b.type || 'blk') + '_cv' + crypto.randomBytes(3).toString('hex');
  return b;
}

/** Compile whatever was pasted (fences, chat, either dialect) into blocks. */
function blocksFromSource(raw) {
  const text = String(raw || '');
  if (!text.trim()) throw new Error('אין מה להוסיף — הדביקו BenTML / ‎.pzn');
  const { pznSourceToBlocks } = require('./pzn-source');
  let result;
  try {
    result = pznSourceToBlocks(text);
  } catch (e) {
    const issues = (e.issues || []).slice(0, 3).map((i) => i && (i.message || i.msg || JSON.stringify(i))).filter(Boolean);
    throw new Error('לא הצלחתי לקרוא את המודולים שהודבקו' + (issues.length ? ': ' + issues.join(' · ') : '') + ' — ודאו שהעתקתם את כל התשובה');
  }
  const blocks = ((result.view && result.view.blocks) || []).map(withId);
  if (!blocks.length) throw new Error('לא נמצאו מודולים בטקסט שהודבק');
  return {
    blocks,
    warnings: result.repaired ? (result.changes || []).map((c) => String((c && c.message) || c)) : [],
    dialect: result.dialect
  };
}

/** A sample of one module: the showcase's own instance when it has one
 *  (real, filled-in content), else the registry's Hebrew defaults. */
function sampleBlock(type) {
  const t = String(type || '').trim();
  const { getBlockDef, defaultDataFor } = require('./block-registry');
  const def = getBlockDef(t);
  if (!def) throw new Error('מודול לא מוכר: ' + t);
  const { templateBlocks } = require('./templates');
  const fromShowcase = templateBlocks('showcase', CANVAS_TITLE).find((b) => b.type === t);
  if (fromShowcase) return withId({ ...fromShowcase, id: '' });
  return withId({ type: t, data: defaultDataFor(t) });
}

/** The palette: every authoring module, grouped for a <select>. */
function palette() {
  const { authoringBlocks } = require('./block-registry');
  return authoringBlocks().map((e) => ({ type: e.type, label: e.labelHe || e.type, icon: e.icon || '', category: e.category || '' }));
}

function summarize(blocks) {
  const { getBlockDef } = require('./block-registry');
  const one = (b) => {
    const def = getBlockDef(b.type);
    return { id: b.id, type: b.type, label: (def && def.labelHe) || b.type, icon: (def && def.icon) || '' };
  };
  return blocks.map((b) => {
    if (!isRow(b)) return one(b);
    const list = cells(b);
    return {
      id: b.id, type: 'columns', row: true,
      label: 'שורה (' + list.length + ' עמודות)', icon: '▦',
      ratio: b.data.ratio || '', width: b.data.width || 'content', gap: b.data.gap || 'md',
      valign: b.data.valign || 'top', collapse: b.data.collapse || 'md',
      columns: list.map((cell) => cell.map(one))
    };
  });
}

const MAX_COLS = 6;
const ROW_ENUMS = {
  width: ['content', 'wide', 'full'],
  gap: ['none', 'sm', 'md', 'lg'],
  valign: ['top', 'center', 'bottom', 'stretch'],
  collapse: ['sm', 'md', 'lg', 'never']
};

/** "2:1:1" → [2, 1, 1] (each part 0.2–12), or null when it is no ratio. */
function parseRatio(v) {
  if (Array.isArray(v)) v = v.join(':');
  const parts = String(v == null ? '' : v).trim().split(/\s*[:/ ]\s*/).filter(Boolean);
  if (!parts.length) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0.2 || n > 12)) return null;
  return nums;
}

/** A row: a columns block (the page builder's own shape — data.columns =
 *  [{ blocks }]) whose cells hold modules. Settings are the registry's
 *  params: ratio, width, gap, valign, collapse. */
function rowBlock(opts) {
  const o = opts && typeof opts === 'object' ? opts : { count: opts };
  const ratio = parseRatio(o.ratio);
  const n = Math.min(MAX_COLS, Math.max(1, Math.round(Number(o.count)) || (ratio ? ratio.length : 3)));
  const data = { columns: Array.from({ length: n }, () => ({ blocks: [] })), gap: 'md', valign: 'stretch' };
  applyRowSettings({ data }, o);
  return withId({ type: 'columns', data });
}

/** Validate + apply ratio/width/gap/valign/collapse onto a row. */
function applyRowSettings(row, o) {
  const d = row.data;
  const n = cells(row).length;
  if (o.ratio !== undefined) {
    const raw = String(o.ratio == null ? '' : o.ratio).trim();
    if (!raw) delete d.ratio;
    else {
      const parts = parseRatio(raw);
      if (!parts) throw new Error('יחס לא תקין — למשל 2:1:1 (מספרים בין 0.2 ל-12)');
      if (parts.length !== n) throw new Error(`היחס צריך ${n} חלקים כמספר העמודות בשורה (קיבלתי ${parts.length})`);
      d.ratio = parts.join(':');
    }
  }
  for (const k of Object.keys(ROW_ENUMS)) {
    if (o[k] === undefined) continue;
    const v = String(o[k] || '');
    if (!v) { delete d[k]; continue; }
    if (!ROW_ENUMS[k].includes(v)) throw new Error(`ערך לא מוכר ל-${k}: ${v}`);
    d[k] = v;
  }
  return row;
}

function isRow(b) {
  return !!(b && b.type === 'columns' && b.data && (Array.isArray(b.data.columns) || Array.isArray(b.data.children)));
}

/** The cells of a row as an array of block lists — the canonical
 *  data.columns[i].blocks, or the legacy data.children[i]. */
function cells(row) {
  const d = row.data;
  if (Array.isArray(d.columns)) {
    d.columns.forEach((c, i) => {
      if (!c || typeof c !== 'object') d.columns[i] = { blocks: [] };
      else if (!Array.isArray(c.blocks)) c.blocks = [];
    });
    return d.columns.map((c) => c.blocks);
  }
  d.children.forEach((c, i) => { if (!Array.isArray(c)) d.children[i] = []; });
  return d.children;
}

/** Change the number of cells: grows with empty cells, shrinks only past
 *  empty trailing cells — a module is never dropped by resizing. */
function resizeRow(row, count) {
  const n = Math.min(MAX_COLS, Math.max(1, Math.round(Number(count)) || 1));
  // cells() maps a fresh array each call — re-read the length every step
  while (cells(row).length < n) {
    if (Array.isArray(row.data.columns)) row.data.columns.push({ blocks: [] }); else row.data.children.push([]);
  }
  while (cells(row).length > n) {
    const last = cells(row)[cells(row).length - 1];
    if (last.length) throw new Error('אי אפשר לצמצם שורה שהעמודה האחרונה שלה מלאה — הסירו קודם את המודולים');
    if (Array.isArray(row.data.columns)) row.data.columns.pop(); else row.data.children.pop();
  }
  const parts = parseRatio(row.data.ratio);
  if (parts && parts.length !== n) delete row.data.ratio;
  return row;
}

/** The list a target points at: the top level, or one cell of a row. */
function targetList(blocks, target) {
  if (!target || !target.rowId) return blocks;
  const row = blocks.find((b) => b.id === String(target.rowId));
  if (!isRow(row)) throw new Error('השורה לא נמצאה על הקנבס');
  const col = Math.round(Number(target.col));
  const list = cells(row);
  if (!(col >= 0 && col < list.length)) throw new Error('עמודה לא קיימת בשורה');
  return list[col];
}

/** The list (top level or a cell) that holds the block with this id. */
function listHolding(blocks, id) {
  if (blocks.some((b) => b.id === id)) return blocks;
  for (const b of blocks) {
    if (!isRow(b)) continue;
    for (const cell of cells(b)) {
      if (cell.some((x) => x.id === id)) return cell;
    }
  }
  return null;
}

/** One canvas operation → the new state. */
function apply(op, arg) {
  const cur = loadCanvas();
  let blocks = cur.blocks.slice();
  let warnings = [];
  let added = 0;
  switch (String(op || '')) {
    case 'append-source': {
      const r = blocksFromSource(arg && typeof arg === 'object' ? arg.source : arg);
      const list = targetList(blocks, arg && typeof arg === 'object' ? arg : null);
      list.push(...r.blocks); warnings = r.warnings; added = r.blocks.length;
      break;
    }
    case 'replace-source': {
      const r = blocksFromSource(arg);
      blocks = r.blocks; warnings = r.warnings; added = r.blocks.length;
      break;
    }
    case 'add-module': {
      const type = arg && typeof arg === 'object' ? arg.type : arg;
      const list = targetList(blocks, arg && typeof arg === 'object' ? arg : null);
      list.push(sampleBlock(type)); added = 1;
      break;
    }
    case 'add-row': {
      blocks.push(rowBlock(arg)); added = 1;
      break;
    }
    case 'set-row': {
      // ratio / width / gap / valign / collapse / cells — the row's registry
      // params, the same ones a <bent-columns> carries in BenTML
      const o = arg && typeof arg === 'object' ? arg : {};
      const row = blocks.find((x) => x.id === String(o.id || ''));
      if (!isRow(row)) throw new Error('השורה לא נמצאה על הקנבס');
      if (o.cells !== undefined) resizeRow(row, o.cells);
      applyRowSettings(row, o);
      break;
    }
    case 'showcase': {
      blocks = require('./templates').templateBlocks('showcase', CANVAS_TITLE).map(withId); added = blocks.length;
      break;
    }
    case 'remove': {
      const id = String(arg || '');
      const list = listHolding(blocks, id);
      if (!list) throw new Error('המודול לא נמצא על הקנבס');
      list.splice(list.findIndex((b) => b.id === id), 1);
      break;
    }
    case 'move': {
      const { id, dir } = arg || {};
      const list = listHolding(blocks, String(id || ''));
      if (!list) throw new Error('המודול לא נמצא על הקנבס');
      const i = list.findIndex((b) => b.id === String(id || ''));
      const j = dir === 'up' ? i - 1 : i + 1;
      if (j >= 0 && j < list.length) { const t = list[i]; list[i] = list[j]; list[j] = t; }
      break;
    }
    case 'clear': {
      blocks = [];
      break;
    }
    default:
      throw new Error('פעולה לא מוכרת: ' + op);
  }
  if (blocks.length > MAX_BLOCKS) throw new Error(`הקנבס מוגבל ל-${MAX_BLOCKS} מודולים`);
  const saved = saveCanvas(blocks);
  return { blocks: saved.blocks, source: saved.source, modules: summarize(saved.blocks), count: countModules(saved.blocks), added, warnings };
}

/** Every module on the bench — rows count their cells' modules, not themselves. */
function countModules(blocks) {
  return blocks.reduce((n, b) => n + (isRow(b) ? cells(b).reduce((m, cell) => m + cell.length, 0) : 1), 0);
}

/** The canvas as a renderable page object — a page-shaped thing that is
 *  not a page: no slug in the site, never exported, never in the menu. */
function canvasPage() {
  const { blocks } = loadCanvas();
  return {
    title: CANVAS_TITLE,
    slug: '__theme-canvas',
    full_path: '__theme-canvas',
    direction: 'rtl',
    status: 'published',
    tags: [],
    meta: { robots: 'noindex, nofollow' },
    blocks
  };
}

/** The module types on the bench, in order, deduped — for the designer
 *  prompt ("the skin must dress these"). */
function moduleTypes() {
  const seen = new Set();
  const out = [];
  const walk = (list) => {
    for (const b of list || []) {
      if (b && b.type && !seen.has(b.type)) { seen.add(b.type); out.push(b.type); }
      if (b && b.data && Array.isArray(b.data.blocks)) walk(b.data.blocks);
      // rows keep their modules in cells
      if (isRow(b)) cells(b).forEach((cell) => walk(cell));
    }
  };
  walk(loadCanvas().blocks);
  return out;
}

module.exports = {
  CANVAS_PATH,
  CANVAS_TITLE,
  MAX_BLOCKS,
  MAX_COLS,
  ROW_ENUMS,
  parseRatio,
  loadCanvas,
  loadSource,
  saveCanvas,
  blocksToSource,
  sourceToBlocks,
  apply,
  palette,
  summarize,
  countModules,
  sampleBlock,
  blocksFromSource,
  canvasPage,
  moduleTypes
};
