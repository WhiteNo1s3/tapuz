'use strict';

/**
 * Theme LIBRARY (v2.21) — the WordPress attitude, in BenTML land.
 *
 * Ben's call: a theme built with the AI roleplay (or by hand in the theme
 * editor) "should be saved as one — not as the new thing, but one of the
 * things available." Until now Tapuz had exactly ONE theme state: the live
 * config/theme-overrides.json. Import replaced it, the editor mutated it,
 * and whatever you had before was simply gone. A theme was an event, not an
 * artifact.
 *
 * This module makes themes artifacts: named override-sets in
 * config/theme-library.json, listed, applied, renamed, deleted, exported —
 * and the AI path lands a bot-built theme package IN THE LIBRARY, never on
 * the live site. Applying is the only door to the live overrides, and it
 * auto-backs-up unsaved live work first, so switching can never destroy a
 * design (the exact promise WordPress users arrive expecting).
 *
 * Trust boundary: entries store overrides as given, but the ONLY way an
 * entry reaches the live site is applyTheme → theme.saveOverrides, whose
 * mergeDeep drops every key outside DEFAULT_OVERRIDES' known shape — the
 * same guarantee importThemePackage has always relied on.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const theme = require('./theme');

const LIBRARY_PATH = path.join(require('./paths').CONFIG_DIR, 'theme-library.json');
const MAX_THEMES = 40;
const AUTO_BACKUP_NAME = 'לפני ההחלפה — גיבוי אוטומטי';

function loadLibrary() {
  try {
    if (fs.existsSync(LIBRARY_PATH)) {
      const data = JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8'));
      if (data && Array.isArray(data.themes)) return data;
    }
  } catch (e) { /* a corrupt library reads as empty, never crashes the admin */ }
  return { themes: [] };
}

function saveLibrary(lib) {
  fs.mkdirSync(path.dirname(LIBRARY_PATH), { recursive: true });
  fs.writeFileSync(LIBRARY_PATH, JSON.stringify(lib, null, 2), 'utf8');
}

function makeId() {
  return 'thm_' + crypto.randomBytes(6).toString('hex');
}

function cleanName(name, fallback) {
  const v = String(name == null ? '' : name).trim().slice(0, 120);
  return v || fallback;
}

/** The little color strip the library cards show — no full overrides dump. */
function paletteOf(overrides) {
  const c = (overrides && overrides.colors) || {};
  return ['primary', 'bg', 'lightBg', 'text']
    .map((k) => c[k])
    .filter((v) => typeof v === 'string' && v);
}

/**
 * Seed the built-in LOOKS into the library (v2.23 — "if we present a slim
 * choice of themes, what are we worth as a company?"). Each look becomes a
 * full library entry (look merged onto the defaults), so a fresh site opens
 * its theme screen to a REAL shelf. A per-key ledger keeps this honest:
 * a look seeds exactly once — an owner who deletes a preset is respected,
 * not overruled on the next listing — while looks added in future versions
 * still arrive, because only their key is missing from the ledger.
 */
function seedPresetLooks() {
  const lib = loadLibrary();
  const seeded = Array.isArray(lib.seededLooks) ? lib.seededLooks : [];
  const { LOOKS, DEFAULT_OVERRIDES } = theme;
  let changed = false;
  for (const [key, look] of Object.entries(LOOKS)) {
    if (seeded.includes(key)) continue;
    if (lib.themes.length < MAX_THEMES) {
      lib.themes.push({
        id: makeId(),
        name: `${look.emoji} ${look.label}`,
        source: 'preset',
        preset: key,
        createdAt: new Date().toISOString(),
        overrides: JSON.parse(JSON.stringify(mergeLook(DEFAULT_OVERRIDES, look.overrides)))
      });
    }
    seeded.push(key);
    changed = true;
  }
  if (changed) {
    lib.seededLooks = seeded;
    saveLibrary(lib);
  }
}

/** Local deep-merge (theme.js keeps its own private; same semantics). */
function mergeLook(base, extra) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!extra || typeof extra !== 'object') return out;
  for (const k of Object.keys(extra)) {
    if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) &&
        base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = mergeLook(base[k], extra[k]);
    } else if (extra[k] !== undefined) {
      out[k] = extra[k];
    }
  }
  return out;
}

/** Entries for the admin UI: identity + preview, overrides stay on disk. */
function listThemes() {
  seedPresetLooks();
  return loadLibrary().themes.map((t) => ({
    id: t.id,
    name: t.name,
    source: t.source || 'manual',
    createdAt: t.createdAt,
    palette: paletteOf(t.overrides)
  }));
}

function getTheme(id) {
  return loadLibrary().themes.find((t) => t.id === id) || null;
}

function addEntry(name, overrides, source) {
  if (!overrides || typeof overrides !== 'object') {
    throw new Error('ערכת נושא בלי overrides אינה ערכה');
  }
  const lib = loadLibrary();
  if (lib.themes.length >= MAX_THEMES) {
    throw new Error(`הספרייה מלאה (${MAX_THEMES} ערכות) — מחקו ערכה לפני שמירה`);
  }
  const entry = {
    id: makeId(),
    name: cleanName(name, 'ערכת נושא ללא שם'),
    source: source === 'ai' || source === 'import' || source === 'auto' ? source : 'manual',
    createdAt: new Date().toISOString(),
    overrides: JSON.parse(JSON.stringify(overrides))
  };
  lib.themes.push(entry);
  saveLibrary(lib);
  return entry;
}

/** Snapshot the LIVE overrides into the library under a name. */
function saveCurrentAsTheme(name) {
  return addEntry(name, theme.loadOverrides(), 'manual');
}

/**
 * A theme package (the v0.99 export format — also what an AI builds) lands
 * in the LIBRARY, not on the live site. Same validation gate as the direct
 * import; the difference is where it goes.
 */
function importPackageToLibrary(pkg) {
  // v2.24: the same tolerant door as the live import — a package object,
  // its JSON text, a fenced/chatted reply, or a bare theme JSON
  const valid = theme.validateThemePackage(typeof pkg === 'string' ? theme.parseThemePackage(pkg) : pkg);
  return addEntry(valid.name, valid.overrides, 'import');
}

/** An AI-designed theme (the theme-designer roleplay's move) lands in the
 *  library under its own name — never on the live site by itself. */
function saveAiTheme(name, overrides) {
  return addEntry(name, overrides, 'ai');
}

/** An entry back out as a portable package (share it, feed it to another site). */
function exportTheme(id) {
  const t = getTheme(id);
  if (!t) throw new Error('ערכת נושא לא נמצאה');
  return {
    format: theme.THEME_PACKAGE_FORMAT,
    version: theme.THEME_PACKAGE_VERSION,
    name: t.name,
    exportedAt: new Date().toISOString(),
    overrides: t.overrides
  };
}

/** Is the live state already represented (verbatim) by some library entry? */
function liveIsSaved(lib, live) {
  const liveJson = JSON.stringify(live);
  return lib.themes.some((t) => JSON.stringify(t.overrides) === liveJson);
}

/**
 * Make a library entry the live theme. The WordPress promise: switching
 * never destroys a design — if the live overrides aren't saved anywhere in
 * the library, they're auto-snapshotted first (source 'auto', one rolling
 * entry: a new auto-backup replaces the previous one instead of silting up
 * the library).
 */
function applyTheme(id) {
  const lib = loadLibrary();
  const entry = lib.themes.find((t) => t.id === id);
  if (!entry) throw new Error('ערכת נושא לא נמצאה');

  const live = theme.loadOverrides();
  let backedUp = false;
  if (!liveIsSaved(lib, live)) {
    const prevAuto = lib.themes.findIndex((t) => t.source === 'auto');
    if (prevAuto !== -1) lib.themes.splice(prevAuto, 1);
    lib.themes.push({
      id: makeId(),
      name: AUTO_BACKUP_NAME,
      source: 'auto',
      createdAt: new Date().toISOString(),
      overrides: JSON.parse(JSON.stringify(live))
    });
    saveLibrary(lib);
    backedUp = true;
  }

  const overrides = theme.saveOverrides(entry.overrides);
  return { ok: true, applied: entry.id, name: entry.name, backedUp, overrides };
}

function removeTheme(id) {
  const lib = loadLibrary();
  const idx = lib.themes.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  lib.themes.splice(idx, 1);
  saveLibrary(lib);
  return true;
}

function renameTheme(id, name) {
  const lib = loadLibrary();
  const t = lib.themes.find((x) => x.id === id);
  if (!t) throw new Error('ערכת נושא לא נמצאה');
  t.name = cleanName(name, t.name);
  saveLibrary(lib);
  return { id: t.id, name: t.name };
}

module.exports = {
  LIBRARY_PATH,
  MAX_THEMES,
  AUTO_BACKUP_NAME,
  listThemes,
  getTheme,
  saveCurrentAsTheme,
  importPackageToLibrary,
  saveAiTheme,
  exportTheme,
  applyTheme,
  removeTheme,
  renameTheme
};
