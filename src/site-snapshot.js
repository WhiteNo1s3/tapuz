'use strict';

/**
 * Site snapshots — the way back from a site-package import.
 *
 * A package import writes pages, their .pzn files and uploads, and in its
 * full form the theme, the menus, the config and the store. So before a real
 * import writes anything, the site as it stands is kept here:
 *
 *   config/site-snapshots/<id>.json   (beside config/menu-backups/, the same
 *                                      id scheme, newest SNAPSHOTS_KEEP kept)
 *
 * A snapshot is always WHOLE: every row of `pages`, every .pzn file (drafts
 * and published), the menus and their locations, the theme overrides, the
 * site config, and the store's catalog tables. Restoring puts back the areas
 * the import it guards could write (`touches`): pages and uploads always;
 * theme, menus, config and the store only after a full import — a pages-only
 * import never touched them, and rolling them back would undo an owner's
 * later, unrelated work (a shop's stock, a menu edited since).
 *
 * Uploads: an import never overwrites a file (same bytes are reused, a
 * different file gets a new name), so a snapshot keeps the NAMES of the
 * uploads as they stood and the names the import was about to add. Restore
 * removes what imports added since (this one and every later one still on
 * the shelf) and that was not there at the snapshot — never a file the owner
 * uploaded in between — and the folders made for them.
 *
 * Never in a snapshot, never moved by a restore: orders, payments, customers
 * (records about people, not site content), page revisions (history — a
 * removed page's history goes with it, as deletePage does), secrets.
 *
 * A restore takes its own snapshot first ('pre-restore'), holding the bytes
 * of the files it is about to remove, so a restore can itself be undone.
 */

const fs = require('fs');
const path = require('path');
const { db } = require('./db');
const { CONFIG_DIR, PAGES_DIR, ASSETS_DIR } = require('./paths');
const jsonFile = require('./json-file');

const SNAPSHOTS_DIR = path.join(CONFIG_DIR, 'site-snapshots');
const SNAPSHOTS_KEEP = 10;
const SNAPSHOT_FORMAT = 'tapuz-site-snapshot';

const CHROME_FILES = { config: 'site.json', theme: 'theme-overrides.json', menusFile: 'menus.json' };
// the catalog only — never orders, payments or the store's own backup shelf
const STORE_TABLES = ['store_meta', 'store_shelves', 'store_products', 'store_variants', 'store_coupons'];
const PZN_KINDS = ['drafts', 'published'];

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function tableRows(name) {
  return tableExists(name) ? db.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all() : [];
}

/** Put a table back row for row (inside the caller's transaction). */
function replaceTable(name, rows) {
  if (!tableExists(name)) return;
  const known = new Set(db.prepare('PRAGMA table_info(' + name + ')').all().map((c) => c.name));
  db.prepare('DELETE FROM ' + name).run();
  for (const row of rows || []) {
    const cols = Object.keys(row).filter((c) => known.has(c));
    if (!cols.length) continue;
    db.prepare('INSERT INTO ' + name + ' (' + cols.map((c) => '"' + c + '"').join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')')
      .run(...cols.map((c) => row[c]));
  }
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
}

function pznFiles() {
  const out = {};
  for (const kind of PZN_KINDS) {
    out[kind] = {};
    let names = [];
    try { names = fs.readdirSync(path.join(PAGES_DIR, kind)); } catch (e) { names = []; }
    for (const name of names) {
      if (!name.endsWith('.pzn')) continue;
      const text = readText(path.join(PAGES_DIR, kind, name));
      if (text !== null) out[kind][name] = text;
    }
  }
  return out;
}

/** '/assets/a/b.png' → its file under the uploads folder, or null when the
 *  path would leave it. */
function assetDiskPath(urlPath) {
  const rel = String(urlPath || '').replace(/^\/assets\//, '');
  if (!rel || rel === String(urlPath || '')) return null;
  const file = path.resolve(ASSETS_DIR, ...rel.split('/'));
  return file.startsWith(path.resolve(ASSETS_DIR) + path.sep) ? file : null;
}

/** Every upload's path under the uploads folder ('a/b.png'), sorted. */
function assetListing() {
  const out = [];
  (function walk(dir, rel) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of ents) {
      const r = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) walk(path.join(dir, ent.name), r);
      else out.push(r);
    }
  })(ASSETS_DIR, '');
  return out.sort();
}

// ISO time made filesystem-safe; two in one millisecond get `_N` (the menu
// backups' scheme, and their ordering: by (time, N))
function idParts(id) {
  const m = /^(.*?)(?:_(\d+))?$/.exec(String(id || ''));
  return [m ? m[1] : String(id || ''), m && m[2] ? parseInt(m[2], 10) : 0];
}
function compareIds(a, b) {
  const [ab, an] = idParts(a);
  const [bb, bn] = idParts(b);
  return ab < bb ? -1 : ab > bb ? 1 : an - bn;
}
function snapshotIds() {
  let names = [];
  try { names = fs.readdirSync(SNAPSHOTS_DIR); } catch (e) { return []; }
  return names.filter((n) => n.endsWith('.json')).map((n) => n.replace(/\.json$/, '')).sort(compareIds);
}

/**
 * Keep the site as it stands. Throws when the snapshot cannot be written —
 * and the import it guards must then not start.
 * @param {{ reason?: string, mode?: string, touches?: { chrome?: boolean, store?: boolean },
 *           assetsAdded?: string[], assetDirs?: string[], assetsRestore?: { path: string, base64: string }[], summary?: object }} info
 * @returns {{ id: string, file: string }}
 */
function takeSnapshot(info = {}) {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  // the store's tables exist once its module has loaded; a site that never
  // opened the store screen still gets its (empty) catalog kept
  try { require('./store'); } catch (e) { /* no store on this install */ }
  const at = new Date().toISOString();
  const base = at.replace(/[:.]/g, '-');
  let id = base;
  for (let n = 1; fs.existsSync(path.join(SNAPSHOTS_DIR, id + '.json')); n++) id = base + '_' + n;

  const store = {};
  for (const t of STORE_TABLES) store[t] = tableRows(t);
  const snapshot = {
    format: SNAPSHOT_FORMAT,
    version: 1,
    id,
    at,
    reason: String(info.reason || '').slice(0, 120),
    mode: info.mode === 'pages' ? 'pages' : 'full',
    touches: { chrome: !!(info.touches && info.touches.chrome), store: !!(info.touches && info.touches.store) },
    summary: info.summary || {},
    pages: { rows: tableRows('pages'), files: pznFiles() },
    menus: { rows: tableRows('menus'), locations: tableRows('menu_locations'), file: readText(path.join(CONFIG_DIR, CHROME_FILES.menusFile)) },
    theme: { file: readText(path.join(CONFIG_DIR, CHROME_FILES.theme)) },
    config: { file: readText(path.join(CONFIG_DIR, CHROME_FILES.config)) },
    store,
    assets: {
      listing: assetListing(),
      added: (info.assetsAdded || []).slice(),
      dirs: (info.assetDirs || []).slice(),
      restore: (info.assetsRestore || []).slice()
    }
  };
  const file = path.join(SNAPSHOTS_DIR, id + '.json');
  jsonFile.writeAtomic(file, JSON.stringify(snapshot));

  const all = snapshotIds();
  while (all.length > SNAPSHOTS_KEEP) {
    const old = all.shift();
    try { fs.unlinkSync(path.join(SNAPSHOTS_DIR, old + '.json')); } catch (e) { /* best effort */ }
  }
  return { id, file };
}

function readSnapshot(id) {
  const safe = String(id || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!safe || safe !== String(id)) return null;
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(SNAPSHOTS_DIR, safe + '.json'), 'utf8')); } catch (e) { return null; }
  if (!data || data.format !== SNAPSHOT_FORMAT || !data.pages || !Array.isArray(data.pages.rows)) return null;
  return data;
}

/** Newest first: [{ id, at, reason, mode, pages, summary }]. */
function listSnapshots() {
  const out = [];
  for (const id of snapshotIds().reverse()) {
    const s = readSnapshot(id);
    if (!s) continue;
    out.push({ id: s.id, at: s.at || '', reason: s.reason || '', mode: s.mode || 'full', pages: s.pages.rows.length, summary: s.summary || {} });
  }
  return out;
}

function writeIfDifferent(file, text) {
  if (readText(file) === text) return;
  jsonFile.writeAtomic(file, text);
}

/**
 * Put a snapshot back — after keeping the site as it stands now, so the
 * restore can itself be undone. The caller rebuilds the static export.
 * @returns {{ id: string, preRestoreId: string, pages: number, removedPages: string[], assetsRemoved: number }}
 */
function restoreSnapshot(id) {
  const snap = readSnapshot(id);
  if (!snap) {
    const e = new Error('תמונת המצב לא נמצאה');
    e.code = 'NO_SNAPSHOT';
    throw e;
  }
  const touches = snap.touches || {};
  const assets = snap.assets || {};
  // uploads: undo what this import AND every later one still on the shelf
  // added, as far as it was not there when this snapshot was taken; and put
  // back a file a later restore removed that WAS there
  const stood = new Set(assets.listing || []);
  const relOf = (p) => String(p || '').replace(/^\/assets\//, '');
  const since = snapshotIds().filter((other) => compareIds(other, snap.id) >= 0).map((other) => (other === snap.id ? snap : readSnapshot(other))).filter(Boolean);
  const addedSince = new Set();
  const dirsSince = new Set();
  const bytesKept = new Map();
  for (const s of since) {
    for (const p of (s.assets && s.assets.added) || []) addedSince.add(p);
    for (const d of (s.assets && s.assets.dirs) || []) dirsSince.add(d);
    for (const a of (s.assets && s.assets.restore) || []) if (a && typeof a.base64 === 'string' && !bytesKept.has(a.path)) bytesKept.set(a.path, a.base64);
  }
  const toRemove = [...addedSince].filter((p) => !stood.has(relOf(p))).map((p) => ({ path: p, file: assetDiskPath(p) })).filter((a) => a.file && fs.existsSync(a.file));
  const toWrite = [...bytesKept.keys()].filter((p) => stood.has(relOf(p)) && assetDiskPath(p) && !fs.existsSync(assetDiskPath(p))).map((p) => ({ path: p, base64: bytesKept.get(p) }));

  // the way back from this restore: the files it removes travel with their
  // bytes, the files it writes are the ones an undo would remove
  const pre = takeSnapshot({
    reason: 'pre-restore:' + snap.id,
    mode: snap.mode,
    touches,
    assetsAdded: toWrite.map((a) => a.path),
    assetsRestore: toRemove.map((a) => ({ path: a.path, base64: fs.readFileSync(a.file).toString('base64') }))
  });

  const pagesBefore = tableRows('pages').map((r) => ({ full_path: r.full_path, status: r.status }));
  db.transaction(() => {
    replaceTable('pages', snap.pages.rows);
    if (tableExists('page_revisions')) db.prepare('DELETE FROM page_revisions WHERE full_path NOT IN (SELECT full_path FROM pages)').run();
    if (touches.chrome) {
      replaceTable('menus', (snap.menus && snap.menus.rows) || []);
      replaceTable('menu_locations', (snap.menus && snap.menus.locations) || []);
    }
    if (touches.store && snap.store) {
      for (const t of STORE_TABLES.slice().reverse()) if (tableExists(t)) db.prepare('DELETE FROM ' + t).run();
      for (const t of STORE_TABLES) replaceTable(t, snap.store[t] || []);
    }
  })();

  // the canonical page files: exactly the snapshot's set
  const files = (snap.pages && snap.pages.files) || {};
  for (const kind of PZN_KINDS) {
    const dir = path.join(PAGES_DIR, kind);
    const want = files[kind] || {};
    let have = [];
    try { have = fs.readdirSync(dir); } catch (e) { have = []; }
    for (const name of have) {
      if (name.endsWith('.pzn') && !Object.prototype.hasOwnProperty.call(want, name)) fs.rmSync(path.join(dir, name), { force: true });
    }
    for (const name of Object.keys(want)) {
      if (path.basename(name) !== name || !name.endsWith('.pzn')) continue;
      fs.mkdirSync(dir, { recursive: true });
      if (readText(path.join(dir, name)) !== want[name]) fs.writeFileSync(path.join(dir, name), want[name], 'utf8');
    }
  }

  if (touches.chrome) {
    const texts = { config: snap.config && snap.config.file, theme: snap.theme && snap.theme.file, menusFile: snap.menus && snap.menus.file };
    for (const key of Object.keys(CHROME_FILES)) {
      const file = path.join(CONFIG_DIR, CHROME_FILES[key]);
      if (typeof texts[key] === 'string') writeIfDifferent(file, texts[key]);
      else fs.rmSync(file, { force: true });
    }
  }

  // uploads: the files the import added go, the folders made for them too
  for (const a of toRemove) {
    fs.rmSync(a.file, { force: true });
    try { db.prepare('DELETE FROM media WHERE path = ?').run(a.path); } catch (e) { /* the library re-syncs from disk anyway */ }
  }
  for (const d of [...dirsSince].sort((a, b) => b.length - a.length)) {
    const dir = assetDiskPath('/assets/' + d);
    try { if (dir) fs.rmdirSync(dir); } catch (e) { /* not empty (someone uses it now) or already gone */ }
    try { db.prepare('DELETE FROM media_folders WHERE path = ?').run(d); } catch (e) { /* no folders table yet */ }
  }
  for (const a of toWrite) {
    const file = assetDiskPath(a.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(a.base64, 'base64'));
  }

  // a page that left the published site must stop serving from public/
  const live = new Set(snap.pages.rows.filter((r) => r.status === 'published').map((r) => r.full_path));
  const removedPages = [];
  const still = new Set(snap.pages.rows.map((r) => r.full_path));
  for (const p of pagesBefore) {
    if (!still.has(p.full_path)) removedPages.push(p.full_path);
    if (!live.has(p.full_path)) {
      try { require('./export').removePageHtml(p.full_path); } catch (e) { /* the rebuild reconciles */ }
    }
  }

  return { id: snap.id, preRestoreId: pre.id, pages: snap.pages.rows.length, removedPages, assetsRemoved: toRemove.length };
}

module.exports = {
  SNAPSHOTS_DIR,
  SNAPSHOTS_KEEP,
  takeSnapshot,
  listSnapshots,
  restoreSnapshot
};
