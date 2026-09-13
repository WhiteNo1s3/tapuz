// Menu entity — DB-backed, with JSON file bootstrap for existing installs.
const fs = require('fs');
const path = require('path');
const { db } = require('./db');

const MENUS_PATH = path.join(require('./paths').CONFIG_DIR, 'menus.json');

const DEFAULT_MENUS = {
  main: [{ label: 'דף הבית', url: '/' }],
  footer: []
};

// Render slots on the site chrome. Menus are named entities (any number);
// each location gets one assigned — the WordPress model.
const MENU_LOCATIONS = ['main', 'footer'];

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS menus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS menu_locations (
      location TEXT PRIMARY KEY,
      menu TEXT NOT NULL
    )
  `);
  seedIfEmpty();
}

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM menus').get().c;
  if (count > 0) return;

  let seed = DEFAULT_MENUS;
  try {
    if (fs.existsSync(MENUS_PATH)) {
      seed = { ...DEFAULT_MENUS, ...JSON.parse(fs.readFileSync(MENUS_PATH, 'utf8')) };
    }
  } catch (e) {}

  const insert = db.prepare(`
    INSERT INTO menus (name, items) VALUES (?, ?)
  `);
  const tx = db.transaction((menus) => {
    Object.keys(menus).forEach((name) => {
      insert.run(name, JSON.stringify(normalizeItems(menus[name])));
    });
  });
  tx(seed);
}

const ITEM_TYPES = ['page', 'custom', 'tel', 'mailto', 'anchor'];

/** Resolve the final href from a typed menu item. */
function resolveUrl(type, target, rawUrl) {
  const t = String(target || '').trim();
  if (type === 'page') {
    if (!t) return '#';
    const clean = t.replace(/^\/+/, '').replace(/\.html$/i, '');
    return '/' + clean + '.html';
  }
  if (type === 'tel') return t ? 'tel:' + t.replace(/[^+\d]/g, '') : '#';
  if (type === 'mailto') return t ? 'mailto:' + t : '#';
  if (type === 'anchor') return t ? (t.charAt(0) === '#' ? t : '#' + t) : '#';
  return String(rawUrl || t || '#').trim() || '#';
}

/**
 * Menu items, cleaned: typed, with an id and a resolved href. ONE nesting
 * level (v2.28): the theme renders a dropdown under a top item and nothing
 * under a child, so a grandchild is lifted to its parent's level — right
 * after its parent, never dropped. The editor, the API and the file mirror
 * agree on this shape because they all pass through here.
 */
function normalizeItems(items, depth = 0, maxDepth = 1) {
  if (!Array.isArray(items)) return [];
  const out = [];
  items.forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    const type = ITEM_TYPES.indexOf(item.type) >= 0 ? item.type : 'custom';
    const target = String(item.target || '').trim();
    const kids = Array.isArray(item.children) ? item.children : [];
    out.push({
      id: item.id || `mi_${Date.now()}_${depth}_${i}_${Math.floor(Math.random() * 100000)}`,
      label: String(item.label || '').trim() || 'פריט',
      type: type,
      target: target,
      url: resolveUrl(type, target, item.url),
      children: depth < maxDepth ? normalizeItems(kids, depth + 1, maxDepth) : []
    });
    if (depth >= maxDepth && kids.length) out.push(...normalizeItems(kids, depth, maxDepth));
  });
  return out;
}

/**
 * Keep ids stable across an organizer apply (v2.28): a link whose type+target
 * (or type+url) already exists in the current menu keeps its id, so anything
 * keyed on the id (analytics, a future per-item setting) survives a reorder.
 * New links get a fresh id from normalizeItems.
 */
function withStableIds(newItems, currentItems) {
  const keyOf = (it) => `${it.type || 'custom'}|${it.type === 'custom' || !it.type ? String(it.url || it.target || '') : String(it.target || '')}`;
  const pool = new Map();
  const collect = (list) => (list || []).forEach((it) => {
    if (it && it.id && !pool.has(keyOf(it))) pool.set(keyOf(it), it.id);
    collect(it && it.children);
  });
  collect(currentItems);
  const used = new Set();
  const graft = (list) => (list || []).map((it) => {
    const copy = { ...it, children: graft(it.children) };
    const id = pool.get(keyOf(it));
    if (id && !used.has(id)) { copy.id = id; used.add(id); } else delete copy.id;
    return copy;
  });
  return graft(newItems);
}

// ── capacity (v2.28) ─────────────────────────────────────────────────
// "The menu breaks from the amount of content" — the CMS computes how many
// top-level items fit ONE header row so the organizer prompt can state a
// number instead of a formula, the validator can warn before apply, and the
// studio hint can say "~8 items". A heuristic (±15% with web fonts/emoji):
// the preview iframe shows the real header before anything is applied.
const FONT_EM = { sm: 0.85, md: 0.95, lg: 1.08 };
const GAP_REM = { sm: 1, md: 1.75, lg: 2.5 };
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

function chars(s) { return Array.from(String(s == null ? '' : s)).length; }

/**
 * estimateMenuFit(items, overrides, config) — deterministic (no Date, no
 * random). Returns px numbers, the capacity N (items per row), the char
 * budget C (label chars per row at N items) and rowsNow (a greedy line break
 * of today's labels). mode side/scroll/drawer always "fits".
 */
function estimateMenuFit(items, overrides, config) {
  const theme = require('./theme'); // lazy — theme.js may read menus for its studio hint
  const o = theme.mergeDeep(theme.DEFAULT_OVERRIDES, overrides || {});
  const cfg = config || {};
  const k = theme.menuKnobs(o);
  const list = Array.isArray(items) ? items : [];

  const rootPx = parseFloat((o.fonts || {}).baseSize) || 17;
  const fontPx = (FONT_EM[k.size] || FONT_EM.md) * rootPx;
  const charPx = 0.55 * fontPx;
  const emojiPx = 1.35 * fontPx;
  const pill = (o.chrome || {}).menuHover === 'pill' ? 24 : 0;
  const itemsPx = list.map((it) => {
    const label = String((it && it.label) || '');
    const emoji = (label.match(EMOJI_RE) || []).length;
    const plain = chars(label.replace(EMOJI_RE, ''));
    const caret = it && Array.isArray(it.children) && it.children.length ? 0.9 * fontPx : 0;
    return plain * charPx + emoji * emojiPx + caret + pill;
  });
  const gapPx = (GAP_REM[k.gap] || GAP_REM.md) * rootPx;
  const maxWidthPx = parseFloat((o.layout || {}).maxWidth) || 900;
  const headerPx = (k.width === 'content' ? maxWidthPx : k.width === 'wide' ? Math.max(maxWidthPx, 1140) : 1280) - 2 * 1.25 * rootPx;
  const logo = cfg.logo || {};
  const header = cfg.header || {};
  let logoPx = logo.type === 'image'
    ? (parseFloat(logo.width) || 160)
    : chars(logo.text || cfg.title || '') * 0.6 * 1.45 * rootPx;
  if (header.tagline) logoPx += chars(header.tagline) * 0.5 * 0.9 * rootPx;
  const ctaPx = header.ctaLabel ? chars(header.ctaLabel) * charPx + 32 : 0;
  const availPx = headerPx - logoPx - ctaPx - 1.5 * rootPx;

  const n = itemsPx.length;
  const sum = itemsPx.reduce((a, b) => a + b, 0);
  const rowPx = sum + Math.max(0, n - 1) * gapPx;
  const avgItemPx = n ? sum / n : 6 * charPx;
  const capacity = Math.max(1, Math.floor((availPx + gapPx) / (avgItemPx + gapPx)));
  const charBudget = Math.floor((availPx - (capacity - 1) * gapPx) / charPx);
  const labelChars = list.reduce((a, it) => a + chars((it && it.label) || ''), 0);

  let rows = 1;
  let x = 0;
  for (const w of itemsPx) {
    if (x > 0 && x + gapPx + w > availPx) { rows++; x = w; } else x += (x ? gapPx : 0) + w;
  }
  const rowsNow = n ? rows : 1;
  const mode = k.placement === 'side' ? 'side' : (k.flow === 'scroll' || k.flow === 'drawer') ? k.flow : 'top';
  const sideFits = Math.floor(600 / (2.1 * fontPx + 0.7 * rootPx));

  return {
    mode, rootPx, fontPx, charPx, gapPx, headerPx, logoPx, ctaPx, availPx,
    itemsPx, rowPx, avgItemPx, capacity, charBudget, labelChars, rowsNow,
    fits: mode !== 'top' || rowsNow === 1,
    sideFits
  };
}

// ── backups (v2.28) ──────────────────────────────────────────────────
// The organizer rewrites whole menus in one go, so every apply is preceded
// by a snapshot the owner can list and restore: config/menu-backups/<id>.json
// = { at, reason, menus, locations, knobs }, newest 10 kept. The id is the
// ISO time made filesystem-safe (Windows refuses ':' in a name).
const BACKUPS_DIR = path.join(path.dirname(MENUS_PATH), 'menu-backups');
const BACKUPS_KEEP = 10;

/**
 * Two snapshots in one millisecond share the ISO base; the second gets a
 * `_N` suffix. Ordering is by (base, N) — a plain string sort put `-N`
 * BEFORE the base (`-` < `Z`), so undoLast restored the older one.
 */
function backupIdParts(id) {
  const m = /^(.*?)(?:_(\d+))?$/.exec(String(id || ''));
  return [m ? m[1] : String(id || ''), m && m[2] ? parseInt(m[2], 10) : 0];
}
function compareBackupIds(a, b) {
  const [ab, an] = backupIdParts(a);
  const [bb, bn] = backupIdParts(b);
  return ab < bb ? -1 : ab > bb ? 1 : an - bn;
}

function backupMenus(reason) {
  const theme = require('./theme');
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const at = new Date().toISOString();
  const base = at.replace(/[:.]/g, '-');
  let id = base;
  let n = 1;
  while (fs.existsSync(path.join(BACKUPS_DIR, id + '.json'))) id = base + '_' + (n++);
  const file = path.join(BACKUPS_DIR, id + '.json');
  const snapshot = {
    at,
    reason: String(reason || '').slice(0, 120),
    menus: loadMenus(),
    locations: getMenuLocations(),
    knobs: theme.menuKnobs(theme.loadOverrides())
  };
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), 'utf8');
  // keep the newest N
  const all = fs.readdirSync(BACKUPS_DIR).filter((f) => f.endsWith('.json')).sort((a, b) => compareBackupIds(a.replace(/\.json$/, ''), b.replace(/\.json$/, '')));
  while (all.length > BACKUPS_KEEP) {
    const old = all.shift();
    try { fs.unlinkSync(path.join(BACKUPS_DIR, old)); } catch (e) { /* best effort */ }
  }
  return { id, path: file, reason: snapshot.reason };
}

function readBackup(id) {
  const safe = String(id || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!safe) return null;
  const file = path.join(BACKUPS_DIR, safe + '.json');
  if (!fs.existsSync(file)) return null;
  try { return { id: safe, file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) { return null; }
}

/** Newest first: [{ id, at, reason, counts:{[name]: n} }]. */
function listMenuBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  const out = [];
  const ids = fs.readdirSync(BACKUPS_DIR).filter((n) => n.endsWith('.json')).map((n) => n.replace(/\.json$/, ''));
  for (const f of ids.sort(compareBackupIds).reverse()) {
    const b = readBackup(f.replace(/\.json$/, ''));
    if (!b) continue;
    const counts = {};
    Object.keys(b.data.menus || {}).forEach((name) => { counts[name] = (b.data.menus[name] || []).length; });
    out.push({ id: b.id, at: b.data.at || '', reason: b.data.reason || '', counts });
  }
  return out;
}

/** Put a snapshot back (menus, locations AND the layout knobs) — after
 *  taking a fresh 'pre-restore' snapshot, so a restore is itself undoable. */
function restoreMenuBackup(id) {
  const b = readBackup(id);
  if (!b) { const e = new Error('גיבוי לא נמצא'); e.code = 'NO_BACKUP'; throw e; }
  backupMenus('pre-restore');
  const theme = require('./theme');
  const menus = saveMenus(b.data.menus || {});
  const locations = setMenuLocations(b.data.locations || {});
  if (b.data.knobs && typeof b.data.knobs === 'object') {
    const frag = theme.knobsToOverrides(b.data.knobs).overrides;
    theme.saveOverrides(theme.mergeDeep(theme.loadOverrides(), frag));
  }
  return { menus, locations };
}

function loadMenus() {
  ensureSchema();
  const rows = db.prepare('SELECT name, items FROM menus ORDER BY name').all();
  const out = {};
  rows.forEach((row) => {
    try {
      out[row.name] = normalizeItems(JSON.parse(row.items || '[]'));
    } catch (e) {
      out[row.name] = [];
    }
  });
  if (!out.main) out.main = normalizeItems(DEFAULT_MENUS.main);
  if (!out.footer) out.footer = normalizeItems(DEFAULT_MENUS.footer);
  return out;
}

function saveMenus(menus) {
  ensureSchema();
  const upsert = db.prepare(`
    INSERT INTO menus (name, items, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      items = excluded.items,
      updated_at = CURRENT_TIMESTAMP
  `);
  const tx = db.transaction((data) => {
    Object.keys(data || {}).forEach((name) => {
      const key = String(name || '').trim();
      if (!key) return;
      upsert.run(key, JSON.stringify(normalizeItems(data[key])));
    });
  });
  tx(menus);

  // Keep file mirror for agents / git visibility
  try {
    const dir = path.dirname(MENUS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const clean = loadMenus();
    const fileShape = {};
    Object.keys(clean).forEach((k) => {
      fileShape[k] = clean[k].map(({ label, url, type, target, children }) => {
        const item = { label, url, type, target };
        if (children && children.length) {
          item.children = children.map(c => ({ label: c.label, url: c.url, type: c.type, target: c.target }));
        }
        return item;
      });
    });
    fs.writeFileSync(MENUS_PATH, JSON.stringify(fileShape, null, 2), 'utf8');
  } catch (e) {}

  return loadMenus();
}

function getMenu(name = 'main') {
  const menus = loadMenus();
  return menus[name] || [];
}

function saveMenu(name, items) {
  const menus = loadMenus();
  menus[name] = normalizeItems(items);
  return saveMenus(menus);
}

function listMenuNames() {
  ensureSchema();
  return db.prepare('SELECT name, updated_at FROM menus ORDER BY name').all();
}

/** Delete a named menu. The built-in defaults (main/footer) are permanent —
 *  loadMenus() would resurrect them empty anyway. Locations pointing at the
 *  deleted menu fall back to their same-named default. */
function deleteMenu(name) {
  ensureSchema();
  const key = String(name || '').trim();
  if (!key || key === 'main' || key === 'footer') {
    throw new Error('תפריטי ברירת המחדל (main/footer) קבועים');
  }
  db.prepare('DELETE FROM menus WHERE name = ?').run(key);
  MENU_LOCATIONS.forEach((loc) => {
    const row = db.prepare('SELECT menu FROM menu_locations WHERE location = ?').get(loc);
    if (row && row.menu === key) {
      db.prepare('UPDATE menu_locations SET menu = ? WHERE location = ?').run(loc, loc);
    }
  });
  return loadMenus();
}

/** location → assigned menu name (defaults: each location's own name). */
function getMenuLocations() {
  ensureSchema();
  const out = {};
  MENU_LOCATIONS.forEach((loc) => { out[loc] = loc; });
  db.prepare('SELECT location, menu FROM menu_locations').all().forEach((row) => {
    if (MENU_LOCATIONS.includes(row.location)) out[row.location] = row.menu;
  });
  return out;
}

function setMenuLocations(map) {
  ensureSchema();
  const upsert = db.prepare(`
    INSERT INTO menu_locations (location, menu) VALUES (?, ?)
    ON CONFLICT(location) DO UPDATE SET menu = excluded.menu
  `);
  MENU_LOCATIONS.forEach((loc) => {
    const menu = String((map || {})[loc] || '').trim();
    if (menu) upsert.run(loc, menu);
  });
  return getMenuLocations();
}

/** The menu a site-chrome slot should render — location-aware getMenu. */
function getMenuForLocation(location) {
  const map = getMenuLocations();
  return getMenu(map[location] || location);
}

module.exports = {
  ensureSchema,
  loadMenus,
  saveMenus,
  getMenu,
  saveMenu,
  deleteMenu,
  listMenuNames,
  getMenuLocations,
  setMenuLocations,
  getMenuForLocation,
  MENU_LOCATIONS,
  normalizeItems,
  resolveUrl,
  ITEM_TYPES,
  // the organizer's layer (v2.28)
  estimateMenuFit,
  withStableIds,
  backupMenus,
  listMenuBackups,
  restoreMenuBackup,
  BACKUPS_DIR
};
