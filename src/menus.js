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

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item, i) => {
    const type = ITEM_TYPES.indexOf(item.type) >= 0 ? item.type : 'custom';
    const target = String(item.target || '').trim();
    return {
      id: item.id || `mi_${Date.now()}_${i}_${Math.floor(Math.random() * 1000)}`,
      label: String(item.label || '').trim() || 'פריט',
      type: type,
      target: target,
      url: resolveUrl(type, target, item.url),
      children: normalizeItems(item.children || [])
    };
  });
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
  ITEM_TYPES
};
