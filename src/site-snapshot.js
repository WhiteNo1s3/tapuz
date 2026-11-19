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
 * A snapshot still KEEPS the whole site (every page row, every .pzn file, the
 * menus, the theme, the config, the store catalog), because the undo of a
 * restore needs those bytes. Restoring does not put the whole site back.
 * It rolls back only what the import it guards wrote, recorded as `written`:
 *
 *   - pages the import created are deleted; pages it overwrote return to
 *     the copy kept here. Every other page — edited or created afterwards —
 *     is left byte for byte.
 *   - images the import added are removed (and images a later restore of
 *     this snapshot removed are put back, from the bytes kept with it).
 *   - theme, menus, config and the store catalog move only when this import
 *     was a full one (`touches`). A pages-only import never wrote them.
 *
 * Page revision history is never deleted. A page this restore removes keeps
 * its history (deletePage is a different door, and that one does clear it).
 *
 * A restore takes its own snapshot first ('pre-restore'), holding the bytes
 * of the files it is about to remove and the page list it is about to change,
 * so a restore can itself be undone without touching anything else.
 */

const fs = require('fs');
const path = require('path');
const { db } = require('./db');
const { CONFIG_DIR, PAGES_DIR, ASSETS_DIR } = require('./paths');
const jsonFile = require('./json-file');
const pznStore = require('./pzn-store');
const { removePageHtml } = require('./export');

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
 *           writtenPages?: { path: string, existed: boolean }[],
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
    // the pages THIS operation will write. Restore touches these and no others.
    // `existed` means the page was already there, so restore puts this
    // snapshot's copy back; otherwise restore deletes it.
    written: { pages: cleanWritten(info.writtenPages) },
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
    out.push({
      id: s.id, at: s.at || '', reason: s.reason || '', mode: s.mode || 'full',
      pages: s.pages.rows.length, summary: s.summary || {}, rollback: describeRollback(s)
    });
  }
  return out;
}

function writeIfDifferent(file, text) {
  if (readText(file) === text) return;
  jsonFile.writeAtomic(file, text);
}

/** The pages an operation recorded as its own writes, de-duplicated. */
function cleanWritten(list) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item.path !== 'string') continue;
    const fullPath = item.path;
    if (!fullPath || seen.has(fullPath)) continue;
    seen.add(fullPath);
    out.push({ path: fullPath, existed: !!item.existed });
  }
  return out;
}

function writtenPagesOf(snap) {
  return cleanWritten(snap && snap.written && snap.written.pages);
}

/** What a restore of this snapshot will move — for the warning before it runs. */
function describeRollback(snap) {
  const touches = (snap && snap.touches) || {};
  const assets = (snap && snap.assets) || {};
  return {
    pages: writtenPagesOf(snap).map((p) => ({ path: p.path, action: p.existed ? 'restore' : 'delete' })),
    theme: !!touches.chrome,
    menus: !!touches.chrome,
    config: !!touches.chrome,
    store: !!touches.store,
    assetsRemoved: Array.isArray(assets.added) ? assets.added.length : 0,
    assetsRestored: Array.isArray(assets.restore) ? assets.restore.length : 0
  };
}

/** Uploads this snapshot itself added, and files it kept bytes for. */
function assetChanges(snap) {
  const assets = (snap && snap.assets) || {};
  const toRemove = [];
  for (const p of assets.added || []) {
    const file = assetDiskPath(p);
    if (file && fs.existsSync(file)) toRemove.push({ path: p, file });
  }
  const toWrite = [];
  for (const a of assets.restore || []) {
    if (!a || typeof a.path !== 'string' || typeof a.base64 !== 'string') continue;
    const file = assetDiskPath(a.path);
    if (!file || fs.existsSync(file)) continue;
    toWrite.push({ path: a.path, file, base64: a.base64 });
  }
  const dirs = [];
  for (const d of assets.dirs || []) {
    const dir = assetDiskPath('/assets/' + String(d).replace(/^\/+/, ''));
    if (dir) dirs.push(dir);
  }
  dirs.sort((a, b) => b.length - a.length);
  return { toRemove, toWrite, dirs };
}

function pageColumns() {
  return db.prepare('PRAGMA table_info(pages)').all().map((c) => c.name);
}

/** Put one saved page row back. Keeps the live row's id when the page is
 *  still there, so revision rows that name it stay attached. Never inserts
 *  the old id: a page created since may own it now. */
function upsertPageRow(row) {
  if (!row || !row.full_path) return;
  const known = new Set(pageColumns());
  const cols = Object.keys(row).filter((c) => c !== 'id' && known.has(c) && Object.prototype.hasOwnProperty.call(row, c));
  if (!cols.length) return;
  const existing = db.prepare('SELECT id FROM pages WHERE full_path = ?').get(row.full_path);
  if (existing) {
    db.prepare('UPDATE pages SET ' + cols.map((c) => '"' + c + '" = ?').join(', ') + ' WHERE full_path = ?')
      .run(...cols.map((c) => row[c]), row.full_path);
  } else {
    db.prepare('INSERT INTO pages (' + cols.map((c) => '"' + c + '"').join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')')
      .run(...cols.map((c) => row[c]));
  }
}

/** Drop the page row only. Revision history stays. */
function deletePageRowOnly(fullPath) {
  db.prepare('DELETE FROM pages WHERE full_path = ?').run(fullPath);
}

/**
 * Write each rolled-back page's .pzn back through a temp name, and return
 * the files that should not exist once the database says so. Writes happen
 * before the caller's transaction; deletes happen after it commits, so a
 * crash mid-way leaves a whole file rather than a half-written one, and an
 * orphan file rather than a page whose file vanished first.
 * @returns {string[]} files to remove after the database update
 */
function stagePageFiles(snap, items) {
  const files = (snap.pages && snap.pages.files) || {};
  const removals = [];
  for (const item of items) {
    for (const kind of PZN_KINDS) {
      let target;
      try { target = pznStore.pznPathFor(item.path, kind === 'published' ? 'published' : 'draft'); }
      catch (e) { continue; }
      const name = pznStore.safeName(item.path) + '.pzn';
      const bucket = files[kind] || {};
      const prior = item.existed && Object.prototype.hasOwnProperty.call(bucket, name) ? bucket[name] : null;
      if (typeof prior === 'string') jsonFile.writeAtomic(target, prior, { durable: false });
      else removals.push(target);
    }
  }
  return removals;
}

/**
 * Put a snapshot back — after keeping the site as it stands now, so the
 * restore can itself be undone. The caller rebuilds the static export.
 * @returns {{ id: string, preRestoreId: string, pages: number, removedPages: string[], restoredPages: string[], assetsRemoved: number, rollback: object }}
 */
function restoreSnapshot(id) {
  const snap = readSnapshot(id);
  if (!snap) {
    const e = new Error('תמונת המצב לא נמצאה');
    e.code = 'NO_SNAPSHOT';
    throw e;
  }
  const touches = snap.touches || {};
  const priorRows = new Map((snap.pages.rows || []).filter((r) => r && r.full_path).map((r) => [r.full_path, r]));
  // `existed` without a saved row cannot be put back — treat it as a delete
  const scope = writtenPagesOf(snap).map((item) => ({ path: item.path, existed: item.existed && priorRows.has(item.path) }));
  const { toRemove, toWrite, dirs } = assetChanges(snap);
  const liveNow = new Set(tableRows('pages').map((r) => r.full_path));

  // the way back from this restore: the same pages, as they stand now, and
  // the bytes of the files it is about to remove
  const pre = takeSnapshot({
    reason: 'pre-restore:' + snap.id,
    mode: snap.mode,
    touches,
    writtenPages: scope.map((p) => ({ path: p.path, existed: liveNow.has(p.path) })),
    assetsAdded: toWrite.map((a) => a.path),
    assetsRestore: toRemove.map((a) => ({ path: a.path, base64: fs.readFileSync(a.file).toString('base64') }))
  });

  // files first, each via a temp name, so a crash does not leave a half page
  const fileRemovals = stagePageFiles(snap, scope);
  const removedPages = [];
  const restoredPages = [];
  db.transaction(() => {
    for (const item of scope) {
      if (item.existed && priorRows.has(item.path)) {
        upsertPageRow(priorRows.get(item.path));
        restoredPages.push(item.path);
      } else {
        // created by the import, or an overwrite whose saved row is gone:
        // the page leaves. Its revision history does not.
        deletePageRowOnly(item.path);
        removedPages.push(item.path);
      }
    }
    if (touches.chrome) {
      replaceTable('menus', (snap.menus && snap.menus.rows) || []);
      replaceTable('menu_locations', (snap.menus && snap.menus.locations) || []);
    }
    if (touches.store && snap.store) {
      for (const t of STORE_TABLES.slice().reverse()) if (tableExists(t)) db.prepare('DELETE FROM ' + t).run();
      for (const t of STORE_TABLES) replaceTable(t, snap.store[t] || []);
    }
  })();
  for (const file of fileRemovals) fs.rmSync(file, { force: true });

  if (touches.chrome) {
    const texts = { config: snap.config && snap.config.file, theme: snap.theme && snap.theme.file, menusFile: snap.menus && snap.menus.file };
    for (const key of Object.keys(CHROME_FILES)) {
      const file = path.join(CONFIG_DIR, CHROME_FILES[key]);
      if (typeof texts[key] === 'string') writeIfDifferent(file, texts[key]);
      else fs.rmSync(file, { force: true });
    }
  }

  // uploads this operation added. A folder goes only when nothing else uses it.
  for (const a of toRemove) {
    fs.rmSync(a.file, { force: true });
    try { db.prepare('DELETE FROM media WHERE path = ?').run(a.path); } catch (e) { /* the library re-syncs from disk anyway */ }
  }
  for (const dir of dirs) {
    const rel = path.relative(ASSETS_DIR, dir).split(path.sep).join('/');
    try { fs.rmdirSync(dir); } catch (e) { /* not empty (a later import still uses it) or already gone */ }
    if (fs.existsSync(dir)) continue;
    try { db.prepare('DELETE FROM media_folders WHERE path = ?').run(rel); } catch (e) { /* no folders table yet */ }
  }
  for (const a of toWrite) {
    jsonFile.writeAtomic(a.file, Buffer.from(a.base64, 'base64'), { durable: false });
  }

  // a page that left the published site must stop serving from public/.
  // Pages this restore did not write are not in `scope`, so their files stay.
  for (const item of scope) {
    const prior = priorRows.get(item.path);
    const published = item.existed && prior && prior.status === 'published';
    if (!published) {
      try { removePageHtml(item.path); } catch (e) { /* the rebuild reconciles */ }
    }
  }

  return {
    id: snap.id,
    preRestoreId: pre.id,
    pages: tableRows('pages').length,
    removedPages,
    restoredPages,
    assetsRemoved: toRemove.length,
    rollback: describeRollback(snap)
  };
}

module.exports = {
  SNAPSHOTS_DIR,
  SNAPSHOTS_KEEP,
  takeSnapshot,
  listSnapshots,
  restoreSnapshot
};
