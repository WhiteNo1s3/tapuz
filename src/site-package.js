'use strict';

/**
 * Site packages (v1.06) — ".pzn is our RPM" applied to a whole site, not
 * just a theme (v0.99). Every page's canonical .pzn source (draft +
 * published), theme overrides, menus, and a safe non-secret config subset,
 * bundled into one portable, versioned, self-describing file — the same
 * shape as theme packages, one level up. Export/import a whole site
 * between Tapuz installs.
 *
 * Security: import NEVER overwrites an existing page by default (collision
 * = skipped, reported) and NEVER touches secrets (config.admin.path stays
 * local, no SMTP/AI keys are ever part of a site or theme package — those
 * live in gitignored config/*.json files this module never reads).
 *
 * Pages-only import (docs/BILINGUAL-SPEC.md): `mode: 'pages'` takes the
 * pages and nothing else — theme, menus, config and store are not read, let
 * alone written — so the English pages of a twin site can land in the Hebrew
 * site under a prefix, in their own language and direction, with their
 * uploads, paired to their Hebrew twins.
 *
 * Two rules hold for EVERY import, full or pages-only:
 *   - it is a DRY RUN unless the caller opts in (`apply: true`, or
 *     `dryRun: false`): the answer lists what would happen, nothing is
 *     written;
 *   - a real import first keeps the site as it stands (src/site-snapshot.js)
 *     and names that snapshot in its answer — no snapshot, no import.
 */

const fs = require('fs');
const path = require('path');
const pagesLib = require('./pages');
const { listPages, getPageByFullPath, getPageSource, createPage, updatePage, savePageSource } = pagesLib;
const { loadOverrides, saveOverrides } = require('./theme');
const { loadMenus, saveMenus } = require('./menus');
const { loadConfig, saveConfig } = require('./config');
const { ASSETS_DIR } = require('./paths');

const SITE_PACKAGE_FORMAT = 'tapuz-site';
const SITE_PACKAGE_VERSION = 1;

// Only these top-level config fields travel with a site package — never
// admin.path, agent tokens, or anything secret-adjacent.
const CONFIG_FIELDS = ['title', 'description', 'language', 'logo', 'seo', 'homepage'];

// ── uploads ──────────────────────────────────────────────────────────
// What the media library itself keeps: the image set of upload-validate.js
// and the two video containers of media.saveVideoBuffer. Nothing else is
// ever bundled, and nothing else is ever written by an import.
const ASSET_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm'
};
const VIDEO_EXT = new Set(['.mp4', '.webm']);
// one package's uploads, before base64 — a package is one request body
const ASSETS_TOTAL_CAP = 32 * 1024 * 1024;
// a reference to an upload, wherever it sits in a source or in a page's meta:
// an attribute, raw html kept as an escaped attribute, plain text
const ASSET_REF = /\/assets\/[^"'<>\\&()\n]*?\.(?:png|jpe?g|gif|webp|avif|svg|mp4|webm)(?![A-Za-z0-9])/gi;

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply every image rename to the text as it stands. One pass: a match is
 * replaced from the original text, never from the result of an earlier
 * rename. Sequential replaces walk a reference twice when one new name is
 * another's old name (`a.png` → `a-2.png`, and `a-2.png` → `a-2-2.png`
 * would otherwise turn the first reference into `a-2-2.png` too).
 * @param {string} text
 * @param {{ from: string, to: string }[]} renamed
 */
function applyAssetRenames(text, renamed) {
  const map = new Map();
  for (const r of Array.isArray(renamed) ? renamed : []) {
    if (!r || typeof r.from !== 'string' || !r.from || typeof r.to !== 'string') continue;
    map.set(r.from, r.to);
  }
  const source = String(text == null ? '' : text);
  if (!map.size) return source;
  const alts = [...map.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  const re = new RegExp('(?:' + alts.join('|') + ')(?![A-Za-z0-9._-])', 'g');
  return source.replace(re, (m) => map.get(m));
}

/** '/assets/a/b.png' → { rel, file } under the uploads folder, or null when
 *  the path is not a plain media path inside it. */
function safeAssetPath(urlPath) {
  const raw = String(urlPath == null ? '' : urlPath);
  if (!raw.startsWith('/assets/') || raw.length > 400 || /[\\\0]/.test(raw)) return null;
  let rel = raw.slice('/assets/'.length);
  try { rel = decodeURIComponent(rel); } catch (e) { /* keep it as written */ }
  if (/[\\\0]/.test(rel)) return null;
  const parts = rel.split('/');
  if (!parts.length || parts.some((s) => !s || s === '.' || s === '..' || s.trim() !== s)) return null;
  const ext = path.extname(parts[parts.length - 1]).toLowerCase();
  if (!ASSET_MIME[ext]) return null;
  const file = path.resolve(ASSETS_DIR, ...parts);
  if (!file.startsWith(path.resolve(ASSETS_DIR) + path.sep)) return null;
  return { rel: parts.join('/'), file, ext };
}

function collectAssetRefs(text, into) {
  for (const m of String(text || '').match(ASSET_REF) || []) into.add(m);
  return into;
}

function entryTexts(entry) {
  return [entry.draftSource, entry.publishedSource, entry.meta ? JSON.stringify(entry.meta) : ''];
}

/** The uploads the exported pages reference, as { path, mime, base64 }. */
function bundleAssets(pageEntries) {
  const refs = new Set();
  for (const entry of pageEntries) for (const text of entryTexts(entry)) collectAssetRefs(text, refs);
  const assets = [];
  const skipped = [];
  let bytes = 0;
  for (const ref of [...refs].sort()) {
    const safe = safeAssetPath(ref);
    if (!safe) { skipped.push({ path: ref, reason: 'unsafe' }); continue; }
    let buf;
    try { buf = fs.readFileSync(safe.file); } catch (e) { skipped.push({ path: ref, reason: 'missing' }); continue; }
    if (bytes + buf.length > ASSETS_TOTAL_CAP) { skipped.push({ path: ref, reason: 'cap' }); continue; }
    bytes += buf.length;
    assets.push({ path: ref, mime: ASSET_MIME[safe.ext], base64: buf.toString('base64') });
  }
  return { assets, manifest: { count: assets.length, bytes, cap: ASSETS_TOTAL_CAP, skipped } };
}

/**
 * The whole site as a portable, versioned, self-describing package.
 * @param {string} name
 * @param {{ assets?: boolean }} [opts] `assets: true` also bundles the
 *   uploads the pages reference (`assets` + `assetsManifest`).
 */
function exportSitePackage(name, opts = {}) {
  const config = loadConfig();
  const configSubset = {};
  for (const f of CONFIG_FIELDS) {
    if (config[f] !== undefined) configSubset[f] = config[f];
  }

  const pages = listPages().map((p) => {
    const entry = { fullPath: p.full_path, title: p.title, status: p.status };
    const draftSource = getPageSource(p.full_path, 'draft');
    if (draftSource) entry.draftSource = draftSource;
    if (p.status === 'published') {
      const publishedSource = getPageSource(p.full_path, 'published');
      if (publishedSource) entry.publishedSource = publishedSource;
    }
    // what the .pzn head has no home for (description, og:image, page
    // background…) — read by a pages-only import; a full import ignores it
    let meta = {};
    try { meta = JSON.parse(p.meta || '{}') || {}; } catch (e) { meta = {}; }
    if (meta && typeof meta === 'object' && Object.keys(meta).length) entry.meta = meta;
    return entry;
  });

  // The store (v2.53) travels as what it IS — one <bent-store> BenTML
  // document (catalog, shelves, shipping, payment, coupons). Orders are
  // records about people, not site content: they travel in the database
  // .pzn (storage → ייצוא ‎.pzn), never in a package meant to be shared.
  let store = null;
  try {
    const st = require('./store');
    const counts = st.catalog.countProducts();
    if (counts.total || st.isOpen()) store = { format: 'bent-store', source: st.document.exportDocument() };
  } catch (e) { store = null; }

  const bundle = opts.assets === true ? bundleAssets(pages) : null;

  return {
    format: SITE_PACKAGE_FORMAT,
    version: SITE_PACKAGE_VERSION,
    name: String(name || '').trim().slice(0, 120) || 'האתר שלי',
    exportedAt: new Date().toISOString(),
    config: configSubset,
    theme: loadOverrides(),
    menus: loadMenus(),
    pages,
    ...(store ? { store } : {}),
    ...(bundle ? { assets: bundle.assets, assetsManifest: bundle.manifest } : {})
  };
}

// ── import options ───────────────────────────────────────────────────

// a page read right to left; every other language reads left to right
const RTL_LANGS = new Set(['he', 'ar', 'fa', 'ur']);

function directionForLang(lang) {
  return RTL_LANGS.has(String(lang || '').toLowerCase().split('-')[0]) ? 'rtl' : 'ltr';
}

/** 'en', 'en/', '/en/' → 'en'. Throws (a Hebrew sentence) on anything that is
 *  not one slug-safe word, or that sits on a reserved address. */
function cleanPrefix(raw) {
  const p = String(raw == null ? '' : raw).trim().replace(/^\/+/, '').replace(/[/-]+$/, '');
  if (!p) return '';
  if (p.length > 40 || p.includes('..') || !/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(p)) {
    throw new Error('קידומת הכתובת אינה תקינה: מילה אחת של אותיות, ספרות ומקף (למשל en)');
  }
  if (pagesLib.isReservedPath(p)) throw new Error('הקידומת "' + p + '" שמורה למערכת — בחרו קידומת אחרת');
  return p;
}

function cleanLang(raw) {
  const l = String(raw == null ? '' : raw).trim();
  if (!l) return '';
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(l)) throw new Error('קוד השפה אינו תקין (למשל en או he)');
  const [primary, region] = l.split('-');
  return primary.toLowerCase() + (region ? '-' + region : '');
}

/** '/en-bridge.html' → 'en-bridge' — how a person writes a page in the mapping. */
function cleanPathRef(raw) {
  let s = String(raw == null ? '' : raw).trim().replace(/^\/+/, '').replace(/\.html$/i, '');
  try { s = decodeURIComponent(s); } catch (e) { /* as written */ }
  return s;
}

// ── internal links ───────────────────────────────────────────────────
// A link lives in a source as an attribute value (href="/x"), as raw html
// kept in an escaped attribute (href=&quot;/x&quot;), or inside an inline
// mark (@LINK(url: &quot;/x&quot;)) — always a whole quoted value.
const QUOTE = '"|\'|&quot;|&#34;|&#39;|&apos;|&#x22;|&#x27;';

/**
 * @param {Object<string,string>} map   source full_path → final full_path
 * @param {string} homeTarget           final full_path '/' now means, or ''
 * @returns {(text: string) => { text: string, count: number }}
 */
function buildLinkRewriter(map, homeTarget) {
  const forms = new Map();
  for (const from of Object.keys(map)) {
    forms.set(from, map[from]);
    const enc = encodeURI(from);
    if (enc !== from) forms.set(enc, encodeURI(map[from]));
  }
  if (!forms.size && !homeTarget) return (text) => ({ text: String(text == null ? '' : text), count: 0 });
  const alt = [...forms.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  const end = '(?=[#?]|' + QUOTE + ')';
  // "/bridge", "/bridge.html", "/bridge#top" — and the relative "bridge.html"
  const abs = alt ? new RegExp('(' + QUOTE + ')\\/(' + alt + ')(\\.html)?' + end, 'g') : null;
  const rel = alt ? new RegExp('(' + QUOTE + ')(' + alt + ')(\\.html)' + end, 'g') : null;
  // "/" alone is the home only where a link is written (href= / url: / link=),
  // never a lone slash in some other attribute (a breadcrumb separator)
  const home = homeTarget
    ? new RegExp('((?:href|url|link)[A-Za-z-]*(?:' + QUOTE + ')?\\s*[=:]\\s*(?:' + QUOTE + '))\\/' + end, 'gi')
    : null;
  return (text) => {
    let count = 0;
    let out = String(text == null ? '' : text);
    if (abs) out = out.replace(abs, (m, q, p, html) => { count++; return q + '/' + forms.get(p) + (html || ''); });
    if (rel) out = out.replace(rel, (m, q, p, html) => { count++; return q + forms.get(p) + html; });
    if (home) out = out.replace(home, (m, lead) => { count++; return lead + '/' + homeTarget; });
    return { text: out, count };
  };
}

/** Every string inside a page's meta, through `fn`. */
function mapStrings(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) if (k !== '__proto__') out[k] = mapStrings(value[k], fn);
    return out;
  }
  return value;
}

/** The document head says which way the page reads: make it say `lang`. */
function setHeadLanguage(source, lang, dir) {
  return String(source).replace(/<html\b([^>]*)>/i, (m, attrs) => {
    const rest = attrs.replace(/\s(?:lang|dir)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return '<html lang="' + lang + '" dir="' + dir + '"' + rest + '>';
  });
}

function setHeadSlug(source, fullPath) {
  const safe = String(fullPath).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return String(source).replace(/(<meta\s+name="bent-slug"\s+content=")[^"]*(")/i, (m, a, b) => a + safe + b);
}

/** Why savePageSource would refuse this source — or '' when it would not. */
function sourceProblem(source) {
  try {
    const pzn = require('./pzn/index');
    const doc = pzn.parse(require('./pzn-source').toPznSource(source).source);
    const errors = pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error');
    return errors.length ? errors.map((e) => `${e.code}: ${e.message}`).join('; ') : '';
  } catch (e) {
    return e.message || 'מקור לא תקין';
  }
}

// a page's meta that is about WHERE it lives, not what it says: its pairing
// is decided by this import's own mapping, and a store's page is the store's
// (the last three are never a page's own keys — a package is a stranger's file)
const META_STAYS_HOME = new Set(['translationGroup', 'lang', 'store', 'storeSku', '__proto__', 'constructor', 'prototype']);

// ── the plan: everything an import would do, nothing written ─────────

function planImport(pkg, opts) {
  if (!pkg || typeof pkg !== 'object') throw new Error('קובץ האתר אינו תקין (לא JSON)');
  if (pkg.format !== SITE_PACKAGE_FORMAT) {
    throw new Error('זה לא קובץ אתר של Tapuziel (format שגוי)');
  }
  if (typeof pkg.version !== 'number' || pkg.version > SITE_PACKAGE_VERSION) {
    throw new Error('גרסת קובץ האתר חדשה מדי לגרסת Tapuziel הזו');
  }
  const mode = opts.mode === 'pages' ? 'pages' : 'full';
  const pagesOnly = mode === 'pages';
  const overwrite = opts.overwrite === true;
  const prefix = cleanPrefix(opts.prefix);
  const lang = cleanLang(opts.lang);
  const dir = lang ? directionForLang(lang) : '';

  const existing = new Set(listPages().map((p) => p.full_path));
  const items = [];       // pages this import writes
  const skipped = [];
  const renamed = [];
  const claimed = new Set();
  // source path → the page it is (or already was) on this site. No
  // prototype: the keys are a package's words ("constructor" is a fine slug)
  const landsAt = Object.create(null);

  for (const entry of (Array.isArray(pkg.pages) ? pkg.pages : [])) {
    if (!entry || !entry.fullPath || !entry.draftSource) continue;
    const from = String(entry.fullPath);
    let slug = from;
    let final = pagesLib.generateFullPath(prefix, slug);
    if (pagesOnly && entry.meta && entry.meta.store) {
      skipped.push({ from, path: final, reason: 'store' });
      continue;
    }
    if (pagesOnly) {
      // a living site's reserved addresses stay free: the suffix rule every
      // other importer uses (-2, -3 …)
      for (let n = 2; pagesLib.isReservedPath(final); n++) {
        slug = from + '-' + n;
        final = pagesLib.generateFullPath(prefix, slug);
      }
      if (slug !== from) renamed.push({ from, path: final, reason: 'reserved' });
    } else if (pagesLib.isAdminAddress(final)) {
      // a whole site moved by package keeps a page that lived at a
      // now-reserved address (createPage's allowReserved) — never the admin's
      skipped.push({ from, path: final, reason: 'reserved', message: pagesLib.reservedPathMessage(final) });
      continue;
    }
    if (claimed.has(final)) {
      skipped.push({ from, path: final, reason: 'duplicate' });
      continue;
    }
    claimed.add(final);
    const exists = existing.has(final);
    if (exists) landsAt[from] = final;
    if (exists && !overwrite) {
      skipped.push({ from, path: final, reason: 'exists' });
      continue;
    }
    const problem = sourceProblem(entry.draftSource) ||
      (entry.status === 'published' && entry.publishedSource ? sourceProblem(entry.publishedSource) : '');
    if (problem) {
      skipped.push({ from, path: final, reason: 'error', message: problem });
      continue;
    }
    landsAt[from] = final;
    items.push({ entry, from, slug, final, exists });
  }

  // links between the package's pages follow them to where they land
  const linkMap = Object.create(null);
  for (const from of Object.keys(landsAt)) if (landsAt[from] !== from) linkMap[from] = landsAt[from];
  let sourceHome = String((pkg.config && pkg.config.homepage) || '');
  if (!sourceHome || !landsAt[sourceHome]) {
    sourceHome = require('./seo').resolveHomePath(
      (pkg.pages || []).filter((e) => e && e.fullPath && e.status === 'published').map((e) => ({ full_path: String(e.fullPath), title: e.title || '', blocks: [] })), ''
    ) || '';
  }
  const rewrite = buildLinkRewriter(linkMap, linkMap[sourceHome] || '');
  let linkRewrites = 0;
  const neededAssets = new Set();
  for (const item of items) {
    const prepare = (source) => {
      if (!source) return '';
      const r = rewrite(source);
      linkRewrites += r.count;
      let out = r.text;
      if (lang) out = setHeadLanguage(out, lang, dir);
      if (item.final !== item.from) out = setHeadSlug(out, item.final);
      return out;
    };
    item.draftSource = prepare(item.entry.draftSource);
    item.publishedSource = item.entry.status === 'published' && item.entry.publishedSource ? prepare(item.entry.publishedSource) : '';
    item.meta = {};
    if (pagesOnly && item.entry.meta && typeof item.entry.meta === 'object') {
      for (const k of Object.keys(item.entry.meta)) {
        if (META_STAYS_HOME.has(k)) continue;
        item.meta[k] = mapStrings(item.entry.meta[k], (s) => {
          const r = rewrite('"' + s + '"');
          linkRewrites += r.count;
          return r.text.slice(1, -1);
        });
      }
    }
    if (lang) item.meta.lang = lang;
    for (const text of [item.draftSource, item.publishedSource, JSON.stringify(item.meta)]) collectAssetRefs(text, neededAssets);
  }

  const assets = planAssets(pkg, neededAssets, opts.assets !== false);
  if (assets.renamed.length) {
    const swap = (text) => applyAssetRenames(text, assets.renamed);
    for (const item of items) {
      item.draftSource = swap(item.draftSource);
      if (item.publishedSource) item.publishedSource = swap(item.publishedSource);
      item.meta = mapStrings(item.meta, swap);
    }
  }

  // translation pairs: an imported page (by its final path, its source path,
  // or the spec's prefix/path spelling) → a page of this site
  const linked = [];
  const missing = [];
  const willExist = new Set([...existing, ...items.map((i) => i.final)]);
  const imported = new Set(items.map((i) => i.final));
  const siteLang = require('./site-language').siteLanguage();
  const map = opts.translations && typeof opts.translations === 'object' ? opts.translations : {};
  for (const rawKey of Object.keys(map)) {
    const key = cleanPathRef(rawKey);
    const target = cleanPathRef(map[rawKey]);
    if (!key || !target) continue;
    let own = '';
    if (Object.values(landsAt).includes(key)) own = key;
    else if (landsAt[key]) own = landsAt[key];
    else if (prefix && key.startsWith(prefix + '/')) {
      const spelled = key.slice(prefix.length + 1);
      own = landsAt[spelled] || '';
    }
    if (!own) { missing.push({ source: key, target, reason: 'source' }); continue; }
    if (!willExist.has(target)) { missing.push({ source: own, target, reason: 'target' }); continue; }
    if (target === own) { missing.push({ source: own, target, reason: 'self' }); continue; }
    let targetLang = siteLang;
    if (imported.has(target)) targetLang = lang || siteLang;
    else {
      const t = getPageByFullPath(target);
      if (t && t.meta && t.meta.lang) targetLang = t.meta.lang;
    }
    linked.push({ path: own, lang, target, targetLang });
  }

  return { mode, pagesOnly, overwrite, prefix, lang, dir, items, skipped, renamed, linkRewrites, assets, translations: { linked, missing } };
}

/** Which bundled uploads the imported pages need, and what becomes of each. */
function planAssets(pkg, needed, enabled) {
  const plan = { added: [], reused: [], renamed: [], rejected: [], missing: [], writes: [], dirs: [] };
  const byPath = new Map();
  for (const a of (enabled && Array.isArray(pkg.assets) ? pkg.assets : [])) {
    const p = a && typeof a.path === 'string' ? a.path : '';
    if (!a || !safeAssetPath(p) || typeof a.base64 !== 'string') {
      plan.rejected.push({ path: String((a && a.path) || '').slice(0, 200), reason: 'unsafe' });
      continue;
    }
    if (!byPath.has(p)) byPath.set(p, a);
  }
  const taken = new Set();
  const dirs = new Set();
  for (const ref of [...needed].sort()) {
    const safe = safeAssetPath(ref);
    if (!safe) continue;
    const bundled = byPath.get(ref);
    const onDisk = fs.existsSync(safe.file) ? fs.readFileSync(safe.file) : null;
    if (!bundled) {
      if (!onDisk) plan.missing.push(ref);
      continue;
    }
    let buf;
    try {
      buf = checkedAssetBytes(Buffer.from(bundled.base64, 'base64'), safe.ext);
    } catch (e) {
      plan.rejected.push({ path: ref, reason: e.code || e.message });
      if (!onDisk) plan.missing.push(ref);
      continue;
    }
    if (!onDisk) {
      plan.added.push(ref);
      plan.writes.push({ path: ref, file: safe.file, buf });
    } else if (onDisk.equals(buf)) {
      plan.reused.push(ref);
      continue;
    } else {
      // same name, another file: the site's own stays, this one gets a name
      const dirRel = path.posix.dirname(safe.rel);
      const base = path.basename(safe.rel, path.extname(safe.rel));
      for (let n = 2; ; n++) {
        const rel = (dirRel === '.' ? '' : dirRel + '/') + base + '-' + n + path.extname(safe.rel);
        const cand = safeAssetPath('/assets/' + rel);
        if (!cand) { plan.rejected.push({ path: ref, reason: 'unsafe' }); break; }
        if (taken.has(cand.file)) continue;
        const there = fs.existsSync(cand.file) ? fs.readFileSync(cand.file) : null;
        if (there && !there.equals(buf)) continue;
        plan.renamed.push({ from: ref, to: '/assets/' + rel });
        if (!there) plan.writes.push({ path: '/assets/' + rel, file: cand.file, buf });
        taken.add(cand.file);
        break;
      }
      continue;
    }
    taken.add(safe.file);
  }
  // folders that do not exist yet — a restore removes them with the files
  for (const w of plan.writes) {
    let d = path.dirname(w.file);
    while (d.startsWith(path.resolve(ASSETS_DIR) + path.sep) && !fs.existsSync(d)) {
      dirs.add(path.relative(ASSETS_DIR, d).split(path.sep).join('/'));
      d = path.dirname(d);
    }
  }
  plan.dirs = [...dirs];
  return plan;
}

/** The bytes as the media library would keep them (an SVG scrubbed), or a
 *  throw when the file is not the kind its name says. */
function checkedAssetBytes(buf, ext) {
  const fail = (code) => { const e = new Error(code); e.code = code; return e; };
  if (VIDEO_EXT.has(ext)) {
    const kind = require('./media').sniffVideo(buf);
    if (!kind || kind.ext !== ext) throw fail('E_UPLOAD_TYPE');
    return buf;
  }
  const v = require('./upload-validate').validateUpload(buf); // E_UPLOAD_EMPTY | _SIZE | _TYPE
  const want = ext === '.jpeg' ? '.jpg' : ext;
  if (v.ext !== want) throw fail('E_UPLOAD_TYPE');
  return v.buf;
}

// ── import ───────────────────────────────────────────────────────────

/**
 * Validate + plan an uploaded/pasted site package, and — only when the
 * caller opts in — apply it. Never trusts the input shape (same
 * format/version guards as theme packages). Existing pages are NEVER
 * overwritten unless opts.overwrite is explicitly true — a collision is
 * skipped and reported, not silently clobbered.
 *
 * @param {object} pkg
 * @param {object} [opts]
 * @param {boolean} [opts.apply]     true = import for real. Absent = DRY RUN.
 * @param {boolean} [opts.dryRun]    false = import for real; true always wins.
 * @param {'full'|'pages'} [opts.mode]  'pages' skips theme, menus, config, store.
 * @param {string} [opts.prefix]     'en' → bridge lands at en-bridge (the
 *                                   page's own path_prefix), links follow.
 * @param {string} [opts.lang]       sets meta.lang AND the page's direction.
 * @param {boolean} [opts.overwrite]
 * @param {boolean} [opts.assets]    false = leave bundled uploads alone.
 * @param {Object<string,string>} [opts.translations]  imported path → this site's page.
 * @returns {object} dryRun, mode, created / overwritten / skipped / renamed,
 *   translations { linked, missing }, assets { added, reused, renamed,
 *   rejected, missing }, linkRewrites, snapshotId (real imports) — plus the
 *   fields this function always returned (config, theme, menus,
 *   pagesCreated, pagesUpdated, pagesSkipped, store).
 */
function importSitePackage(pkg, opts = {}) {
  const dryRun = opts.dryRun === true || !(opts.apply === true || opts.dryRun === false);
  const plan = planImport(pkg, opts);
  const { pagesOnly } = plan;

  const created = [];
  const overwritten = [];
  const skipped = plan.skipped.slice();
  const translations = { linked: plan.translations.linked.slice(), missing: plan.translations.missing.slice() };
  const storeDoc = !pagesOnly && pkg.store && typeof pkg.store === 'object' && typeof pkg.store.source === 'string' && pkg.store.source.trim()
    ? pkg.store.source : '';
  let storeResult = null;
  let snapshotId = '';

  if (dryRun) {
    for (const item of plan.items) (item.exists ? overwritten : created).push({ from: item.from, path: item.final });
  } else {
    // the way back first: the site as it stands, and the names of the files
    // this import is about to add. A snapshot that cannot be written throws,
    // and nothing below runs.
    snapshotId = require('./site-snapshot').takeSnapshot({
      reason: 'site-package:' + String(pkg.name || '').slice(0, 80),
      mode: plan.mode,
      touches: { chrome: !pagesOnly, store: !!storeDoc },
      writtenPages: plan.items.map((i) => ({ path: i.final, existed: !!i.exists })),
      assetsAdded: plan.assets.writes.map((w) => w.path),
      assetDirs: plan.assets.dirs,
      summary: { pages: plan.items.length, assets: plan.assets.writes.length, prefix: plan.prefix, lang: plan.lang }
    }).id;

    if (!pagesOnly) {
      if (pkg.theme && typeof pkg.theme === 'object') saveOverrides(pkg.theme);
      if (pkg.menus && typeof pkg.menus === 'object') saveMenus(pkg.menus);

      if (pkg.config && typeof pkg.config === 'object') {
        const config = loadConfig();
        for (const f of CONFIG_FIELDS) {
          if (pkg.config[f] !== undefined) config[f] = pkg.config[f];
        }
        saveConfig(config);
      }
    }

    for (const w of plan.assets.writes) {
      fs.mkdirSync(path.dirname(w.file), { recursive: true });
      fs.writeFileSync(w.file, w.buf);
    }

    for (const item of plan.items) {
      const { entry, final } = item;
      const meta = Object.keys(item.meta).length ? item.meta : null;
      try {
        if (!item.exists) {
          createPage({
            title: entry.title || entry.fullPath, slug: item.slug, path_prefix: plan.prefix, blocks: [],
            // a whole site keeps a page that lived at a now-reserved address
            // (sitemap, account, 404…); /admin itself never travels
            allowReserved: !pagesOnly,
            ...(plan.dir ? { direction: plan.dir } : {}),
            ...(meta ? { meta } : {})
          });
        } else if (plan.dir && (getPageByFullPath(final) || {}).direction !== plan.dir) {
          updatePage(final, { direction: plan.dir });
        }
        // publish FIRST (savePageSource's publish:true writes the same source to
        // BOTH draft and published) so a subsequent draft-only write can safely
        // diverge the draft again — the correct order to end up with
        // published=publishedSource AND draft=draftSource (they can differ: a
        // page can have unpublished changes sitting on top of what's live).
        if (item.publishedSource) savePageSource(final, item.publishedSource, { publish: true, meta });
        savePageSource(final, item.draftSource, { publish: false, meta });
        (item.exists ? overwritten : created).push({ from: item.from, path: final });
      } catch (e) {
        skipped.push({ from: item.from, path: final, reason: 'error', message: e.message });
      }
    }

    // the store's document (v2.53): applied through the store's own door —
    // validated, backed up first — and only ever ADDED to an existing shop
    // (merge) unless the import overwrites, so a package never hides products
    if (storeDoc) {
      try {
        let source = storeDoc;
        if (!plan.overwrite) source = source.replace(/<bent-store\b([^>]*)>/i, (m, attrs) => '<bent-store' + attrs.replace(/\smode="[^"]*"/i, '') + ' mode="merge">');
        // `trusted`: a package's store document was written by the store's own
        // serializer, so it is read without the paste door's size caps — a big
        // shop's own export used to be refused here ("the text is too long").
        // Every product still goes through the same validation as a paste.
        const r = require('./store').document.applyDocument(source, { force: true, trusted: true, reason: 'site-package' });
        storeResult = r.ok ? { ok: true, products: (r.changed && r.changed.products) || 0, backupId: r.backupId } : { ok: false, error: r.message || r.code };
      } catch (e) {
        storeResult = { ok: false, error: e.message };
      }
    }

    // pair each imported page with its twin on this site
    const siteLanguage = require('./site-language');
    translations.linked = [];
    for (const pair of plan.translations.linked) {
      try {
        const own = getPageByFullPath(pair.path);
        const ownLang = pair.lang || (own && own.meta && own.meta.lang) || siteLanguage.languageFor(own && own.direction);
        pagesLib.linkTranslations(pair.path, ownLang, pair.target, pair.targetLang);
        translations.linked.push(pair);
      } catch (e) {
        translations.missing.push({ source: pair.path, target: pair.target, reason: 'error', message: e.message });
      }
    }
  }

  const { added, reused, renamed, rejected, missing } = plan.assets;
  return {
    dryRun,
    mode: plan.mode,
    prefix: plan.prefix,
    lang: plan.lang,
    created,
    overwritten,
    skipped,
    renamed: plan.renamed,
    translations,
    assets: { added, reused, renamed, rejected, missing },
    linkRewrites: plan.linkRewrites,
    ...(snapshotId ? { snapshotId } : {}),
    config: loadConfig(), theme: loadOverrides(), menus: loadMenus(),
    pagesCreated: created.map((c) => c.path),
    pagesUpdated: overwritten.map((c) => c.path),
    pagesSkipped: skipped.map((s) => (s.message ? s.path + ' (' + s.message + ')' : s.path)),
    ...(storeResult ? { store: storeResult } : {})
  };
}

module.exports = {
  SITE_PACKAGE_FORMAT,
  SITE_PACKAGE_VERSION,
  CONFIG_FIELDS,
  ASSETS_TOTAL_CAP,
  directionForLang,
  exportSitePackage,
  importSitePackage,
  applyAssetRenames
};
