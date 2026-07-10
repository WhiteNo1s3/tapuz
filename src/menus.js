// Menu entity — DB-backed, with JSON file bootstrap for existing installs.
const fs = require('fs');
const path = require('path');
const { db } = require('./db');

const MENUS_PATH = path.join(__dirname, '..', 'config', 'menus.json');

const DEFAULT_MENUS = {
  main: [{ label: 'דף הבית', url: '/' }],
  footer: []
};

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS menus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item, i) => ({
    id: item.id || `mi_${Date.now()}_${i}_${Math.floor(Math.random() * 1000)}`,
    label: String(item.label || '').trim() || 'פריט',
    url: String(item.url || '#').trim() || '#',
    children: normalizeItems(item.children || [])
  }));
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
      fileShape[k] = clean[k].map(({ label, url, children }) => {
        const item = { label, url };
        if (children && children.length) item.children = children.map(c => ({ label: c.label, url: c.url }));
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

module.exports = {
  ensureSchema,
  loadMenus,
  saveMenus,
  getMenu,
  saveMenu,
  listMenuNames,
  normalizeItems
};
