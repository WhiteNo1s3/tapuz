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

const CANVAS_PATH = path.join(require('./paths').CONFIG_DIR, 'theme-canvas.json');
const MAX_BLOCKS = 120;
const CANVAS_TITLE = 'קנבס הערכה';

function loadCanvas() {
  try {
    if (fs.existsSync(CANVAS_PATH)) {
      const data = JSON.parse(fs.readFileSync(CANVAS_PATH, 'utf8'));
      if (data && Array.isArray(data.blocks)) return { blocks: data.blocks, updatedAt: data.updatedAt || '' };
    }
  } catch (e) { /* a corrupt bench reads as empty, never crashes the studio */ }
  return { blocks: [], updatedAt: '' };
}

function saveCanvas(blocks) {
  fs.mkdirSync(path.dirname(CANVAS_PATH), { recursive: true });
  const out = { blocks: blocks.slice(0, MAX_BLOCKS), updatedAt: new Date().toISOString() };
  fs.writeFileSync(CANVAS_PATH, JSON.stringify(out, null, 2), 'utf8');
  return out;
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
    return {
      id: b.id, type: 'columns', row: true,
      label: 'שורה (' + b.data.children.length + ' עמודות)', icon: '▦',
      columns: b.data.children.map((cell) => (Array.isArray(cell) ? cell : []).map(one))
    };
  });
}

const MAX_COLS = 6;

/** A row: a columns block whose cells hold modules. */
function rowBlock(count) {
  const n = Math.min(MAX_COLS, Math.max(1, Math.round(Number(count)) || 3));
  return withId({ type: 'columns', data: { children: Array.from({ length: n }, () => []), gap: 'md', valign: 'stretch' } });
}

function isRow(b) {
  return b && b.type === 'columns' && b.data && Array.isArray(b.data.children);
}

/** The list a target points at: the top level, or one cell of a row. */
function targetList(blocks, target) {
  if (!target || !target.rowId) return blocks;
  const row = blocks.find((b) => b.id === String(target.rowId));
  if (!isRow(row)) throw new Error('השורה לא נמצאה על הקנבס');
  const col = Math.round(Number(target.col));
  if (!(col >= 0 && col < row.data.children.length)) throw new Error('עמודה לא קיימת בשורה');
  if (!Array.isArray(row.data.children[col])) row.data.children[col] = [];
  return row.data.children[col];
}

/** The list (top level or a cell) that holds the block with this id. */
function listHolding(blocks, id) {
  if (blocks.some((b) => b.id === id)) return blocks;
  for (const b of blocks) {
    if (!isRow(b)) continue;
    for (const cell of b.data.children) {
      if (Array.isArray(cell) && cell.some((x) => x.id === id)) return cell;
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
      blocks.push(rowBlock(arg && typeof arg === 'object' ? arg.count : arg)); added = 1;
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
  return { blocks: saved.blocks, modules: summarize(saved.blocks), count: countModules(saved.blocks), added, warnings };
}

/** Every module on the bench — rows count their cells' modules, not themselves. */
function countModules(blocks) {
  return blocks.reduce((n, b) => n + (isRow(b) ? b.data.children.reduce((m, cell) => m + (Array.isArray(cell) ? cell.length : 0), 0) : 1), 0);
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
      // rows keep their modules in cells (data.children = [[…], …])
      if (isRow(b)) b.data.children.forEach((cell) => walk(cell));
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
  loadCanvas,
  saveCanvas,
  apply,
  palette,
  summarize,
  countModules,
  sampleBlock,
  blocksFromSource,
  canvasPage,
  moduleTypes
};
