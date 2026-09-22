'use strict';

/**
 * Landing a breathed design on the site — and taking it back (v2.56).
 *
 * The plan (index.js) is a sandbox: nothing on the site changed while the
 * owner looked at the preview. Landing makes it real, in this order:
 *
 *   1. addresses — every page gets a slug still free on THIS site (an
 *      existing page is never overwritten), and the design's links are
 *      resolved against those final addresses (life.finish);
 *   2. media — every picture (and every clip) is downloaded into the
 *      site's own media library, one folder per import, so the site does
 *      not die with the design tool's hosting;
 *   3. pages — written as BenTML (.pzn) through the same bridge and the same
 *      savePageSource door as every other page;
 *   4. the look — the design's theme lands in the theme LIBRARY and is
 *      applied through the library's door (the live look is backed up);
 *   5. the menu — backed up, then replaced by the design's menu;
 *   6. the crown — the home page becomes the site's root, the brand its title.
 *
 * "live" mode publishes the pages and does all six; "drafts" mode writes the
 * pages as drafts, files the theme in the library WITHOUT applying it, and
 * leaves the menu, the crown and the title alone — a menu pointing at drafts
 * would send visitors to 404s.
 *
 * Every landing leaves a record (config/geppetto/imports.json). undo(id)
 * removes the pages and the media it made and puts back the look, the menu,
 * the crown and the title it replaced — never what the owner made since,
 * and never over a later import's changes (takeBack). One landing runs at a
 * time; its pages are reserved before the slow part, and a landing that
 * fails half-way takes itself back.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function recordsPath() {
  return path.join(require('../paths').CONFIG_DIR, 'geppetto', 'imports.json');
}

function loadRecords() {
  try {
    const p = recordsPath();
    if (fs.existsSync(p)) {
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (d && Array.isArray(d.imports)) return d;
    }
  } catch (e) { /* a broken ledger reads as empty — never blocks an import */ }
  return { imports: [] };
}

function saveRecords(d) {
  const p = recordsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  d.imports = d.imports.slice(-30);
  fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8');
}

function listImports() {
  return loadRecords().imports.slice().reverse();
}

function getImport(id) {
  return loadRecords().imports.find((r) => r.id === id) || null;
}

/** Tapuz blocks → a validated .pzn source (the same bridge every door uses). */
function blocksToSource(page) {
  const pzn = require('../pzn/index');
  const doc = pzn.fromTapuzPage({
    title: page.title || page.slug,
    slug: page.slug,
    lang: page.lang || (page.dir === 'rtl' ? 'he' : 'en'),
    direction: page.dir === 'rtl' ? 'rtl' : 'ltr',
    tags: [],
    meta: {},
    blocks: page.blocks
  });
  const source = pzn.serialize(doc);
  const errors = pzn.validate(pzn.parse(source), { strict: false }).filter((i) => i.severity === 'error');
  return { source, errors };
}

function eachBlock(list, fn) {
  for (const b of list || []) {
    fn(b);
    const d = b.data || {};
    if (Array.isArray(d.blocks)) eachBlock(d.blocks, fn);
    if (Array.isArray(d.columns)) d.columns.forEach((c) => eachBlock(c.blocks, fn));
  }
}

/** Clips a design plays, kept by the site (capped; a clip that fails stays linked). */
async function ingestVideos(blocks, folder, opts, report) {
  const media = require('../media');
  const refs = [];
  eachBlock(blocks, (b) => {
    if (b.type === 'video' && typeof b.data.src === 'string' && /^https?:\/\//i.test(b.data.src) && !/youtube\.com|youtu\.be|vimeo\.com/i.test(b.data.src)) refs.push(b.data);
  });
  const done = new Map();
  let total = 0;
  for (const d of refs.slice(0, 12)) {
    const url = d.src;
    if (done.has(url)) { d.src = done.get(url); continue; }
    try {
      const buf = await fetchBytes(url, 80 * 1024 * 1024, opts);
      total += buf.length;
      if (total > 240 * 1024 * 1024) throw new Error('תקרת הווידאו של ייבוא אחד');
      const rec = media.saveVideoBuffer({ filename: nameFromUrl(url), buffer: buf, folder });
      done.set(url, rec.url);
      d.src = rec.url;
      report.videos += 1;
    } catch (e) {
      report.failed.push({ url, reason: String(e.message || e).slice(0, 120) });
    }
  }
}

async function fetchBytes(url, cap, opts) {
  if (opts && typeof opts.transport === 'function') {
    const r = await opts.transport(url, { accept: '*/*', maxBytes: cap });
    if (!(r.status >= 200 && r.status < 300)) throw new Error('HTTP ' + r.status);
    return r.buffer;
  }
  const r = await require('./fetch').realTransport(url, { accept: '*/*', maxBytes: cap });
  if (!(r.status >= 200 && r.status < 300)) throw new Error('HTTP ' + r.status);
  return r.buffer;
}

function nameFromUrl(u) {
  try { return decodeURIComponent(new URL(u).pathname.split('/').pop() || 'media').replace(/\.[a-z0-9]+$/i, '').slice(0, 50) || 'media'; } catch (e) { return 'media'; }
}

/** A page as the owner would see it: its title and its latest blocks (a
 *  publish alone does not change it — an edit does). */
function pageMark(page) {
  if (!page) return '';
  const blocks = page.draft_blocks != null ? page.draft_blocks : page.blocks;
  return markOf([page.title || '', blocks || []]);
}

function markOf(v) {
  return crypto.createHash('sha1').update(JSON.stringify(v == null ? null : v)).digest('hex');
}

function lookInLibrary(lib, live) {
  const j = JSON.stringify(live);
  try {
    return lib.listThemes().some((t) => { const e = lib.getTheme(t.id); return !!e && JSON.stringify(e.overrides) === j; });
  } catch (e) { return false; }
}

// one landing at a time in this process: two in flight would reserve the
// same free addresses, and the loser would die half-landed, its files and
// pages on the site with no record to undo them by
let landing = false;

/**
 * Land a plan.
 * @param {object} plan  a stored plan (index.js)
 * @param {{ mode?: 'live'|'drafts', media?: boolean, theme?: boolean, menu?: boolean, homepage?: boolean, siteTitle?: boolean }} [choices]
 * @param {{ transport?: Function, rebuild?: boolean }} [opts]
 */
async function land(plan, choices = {}, opts = {}) {
  if (landing) {
    const e = new Error('ייבוא אחר נוחת עכשיו — חכו שיסתיים ונסו שוב');
    e.code = 'BUSY';
    throw e;
  }
  landing = true;
  try {
    return await landNow(plan, choices, opts);
  } finally {
    landing = false;
  }
}

async function landNow(plan, choices, opts) {
  const life = require('./life');
  const pagesLib = require('../pages');
  const { loadConfig, saveConfig } = require('../config');
  const live = choices.mode !== 'drafts';
  const want = {
    media: choices.media !== false,
    theme: choices.theme !== false,
    menu: live && choices.menu !== false,
    homepage: live && choices.homepage !== false,
    siteTitle: live && choices.siteTitle !== false
  };
  const id = 'gp_' + crypto.randomBytes(5).toString('hex');
  const record = {
    id,
    at: new Date().toISOString(),
    planId: plan.id,
    source: plan.source,
    format: plan.format,
    origin: plan.origin || '',
    title: plan.title || '',
    mode: live ? 'live' : 'drafts',
    pagesCreated: [],
    pageMarks: {},
    mediaFolder: '',
    videos: [],
    themeEntryId: null,
    themeApplied: false,
    themeBefore: null,
    themeSetTo: null,
    menuBackupId: null,
    menuBefore: null,
    homepageBefore: null,
    homepageSetTo: null,
    homepageSet: false,
    titleBefore: null,
    titleSetTo: null,
    logoBefore: null,
    logoSetTo: null,
    siteTitleSet: false,
    undone: false
  };

  // 1. addresses still free on this site, RESERVED at once — empty drafts
  //    wearing this import's stamp — before anything slow lets another
  //    writer take them
  const taken = new Set(pagesLib.listPages().map((p) => p.full_path));
  const slugs = {};
  for (const p of plan.living.pages) {
    let s = p.slug;
    for (let n = 2; taken.has(s); n++) s = p.slug + '-' + n;
    taken.add(s);
    slugs[p.key] = s;
  }
  const done = life.finish(plan.living, { slugFor: (k) => slugs[k], homeIsRoot: want.homepage });
  const stampOf = (p) => ({ import: id, source: plan.source, from: p.path || '/' });
  try {
    for (const p of done.pages) {
      const fullPath = slugs[p.key];
      pagesLib.createPage({ title: p.title || fullPath, slug: fullPath, direction: p.dir === 'rtl' ? 'rtl' : 'ltr', blocks: [], meta: { geppetto: stampOf(p) }, status: 'draft' });
      record.pagesCreated.push(fullPath);
    }
    return await landRest(plan, done, slugs, want, live, record, opts, stampOf);
  } catch (e) {
    // a landing that fails half-way takes itself back: no orphan pages,
    // files or look — and nothing the history could not undo
    try { takeBack(record, [], { rollback: true }); } catch (e2) { /* the first failure is the one to report */ }
    throw e;
  }
}

async function landRest(plan, done, slugs, want, live, record, opts, stampOf) {
  const life = require('./life');
  const pagesLib = require('../pages');
  const { loadConfig, saveConfig } = require('../config');
  const id = record.id;

  // 2. media — one folder per import, so undo can take it all back
  const mediaReport = { found: 0, saved: 0, failed: [], videos: 0 };
  const siteSlug = life.slugify(plan.title || plan.living.pages[0].slug || 'design', 'design').slice(0, 30);
  const folder = 'geppetto/' + siteSlug + '-' + id.slice(3, 7);
  if (want.media) {
    record.mediaFolder = folder;
    const all = done.pages.flatMap((p) => p.blocks);
    // the brand picture rides along as a pseudo-block so it becomes a file too
    const brandHolder = plan.living.brand && plan.living.brand.image ? [{ type: 'image', data: { src: plan.living.brand.image } }] : [];
    // the design's own share picture (Figma's social image, Canva's og:image) → the home page's og:image
    const socialHolder = plan.site && /^https?:\/\//.test(plan.site.socialImage || '') ? [{ type: 'image', data: { src: plan.site.socialImage } }] : [];
    const { ingestBlockImages } = require('../media-ingest');
    const fetchImage = opts.transport ? (url) => fetchBytes(url, 8 * 1024 * 1024, opts) : undefined;
    const r = await ingestBlockImages(all.concat(brandHolder, socialHolder), { folder, limit: 400, fetchImage });
    mediaReport.found = r.found;
    mediaReport.saved = r.saved;
    mediaReport.failed = r.failed.slice(0, 50);
    if (brandHolder.length) record.brandImage = brandHolder[0].data.src;
    if (socialHolder.length && /^\/assets\//.test(socialHolder[0].data.src)) record.socialImage = socialHolder[0].data.src;
    await ingestVideos(all, folder, opts, mediaReport);
  }

  // 3. pages, as BenTML, into the addresses reserved for them
  const written = [];
  for (const p of done.pages) {
    const fullPath = slugs[p.key];
    const { source, errors } = blocksToSource(Object.assign({}, p, { slug: fullPath }));
    const meta = {};
    if (p.description) meta.description = String(p.description).slice(0, 300);
    if (p.home && record.socialImage) meta.ogImage = record.socialImage;
    meta.geppetto = stampOf(p);
    try {
      pagesLib.savePageSource(fullPath, source, { publish: live, meta });
    } catch (e) {
      // never lose a page to a validator quibble — the repair pass takes the rest
      pagesLib.savePageSource(fullPath, source, { publish: live, meta, repair: true });
    }
    // what the page looked like when it landed: undo takes back only a page still like this
    record.pageMarks[fullPath] = pageMark(pagesLib.getPageByFullPath(fullPath));
    written.push({ key: p.key, fullPath, title: p.title, home: !!p.home, errors: errors.length });
  }

  // 4. the menu as it is — snapshotted BEFORE the look changes: the look
  //    carries the menu's knobs, and undo hands back the owner's, not the design's
  const menus = require('../menus');
  if (want.menu && done.menu) {
    record.menuBefore = { main: menus.loadMenus().main || [] };
    record.menuBackupId = menus.backupMenus('ג׳פטו — לפני ייבוא ' + (plan.title || plan.source)).id;
  }

  // 5. the look — into the library, and (live) onto the site
  if (want.theme && plan.theme && plan.theme.bent) {
    const themeLib = require('../theme-library');
    const theme = require('../theme');
    try {
      const entry = themeLib.importPackageToLibrary(plan.theme.bent);
      record.themeEntryId = entry.id;
      if (live) {
        record.themeBefore = theme.loadOverrides();
        themeLib.applyTheme(entry.id);
        record.themeApplied = true;
        record.themeSetTo = markOf(theme.loadOverrides());
      }
    } catch (e) {
      record.themeError = e.message;
    }
  }

  // 6. the menu — the design's, even when the design has none: an English
  //    Canva one-pager must not keep the old site's "דף הבית" in its header
  if (record.menuBefore) {
    menus.saveMenus({ main: done.menu.map((it) => ({ label: it.label, url: it.url, type: 'custom' })) });
  }

  // 7. the crown and the name
  const config = loadConfig();
  const home = written.find((w) => w.home) || written[0];
  if (want.homepage && home) {
    record.homepageBefore = config.homepage || '';
    config.homepage = home.fullPath;
    record.homepageSetTo = home.fullPath;
    record.homepageSet = true;
  }
  if (want.siteTitle && plan.living.brand) {
    const brand = plan.living.brand;
    record.titleBefore = config.title || '';
    record.logoBefore = config.logo ? JSON.parse(JSON.stringify(config.logo)) : null;
    if (brand.text) config.title = brand.text.slice(0, 80);
    if (record.brandImage && /^\/assets\//.test(record.brandImage)) {
      config.logo = Object.assign({}, config.logo || {}, { type: 'image', image: record.brandImage });
    }
    record.titleSetTo = config.title || '';
    record.logoSetTo = config.logo ? JSON.parse(JSON.stringify(config.logo)) : null;
    record.siteTitleSet = true;
  }
  if (record.homepageSet || record.siteTitleSet) saveConfig(config);

  const d = loadRecords();
  d.imports.push(record);
  saveRecords(d);

  let rebuildError = '';
  if (opts.rebuild !== false) rebuildError = require('../rebuild').rebuildSite('geppetto import');

  return {
    ok: true,
    importId: id,
    mode: record.mode,
    pages: written,
    menu: record.menuBefore ? done.menu : [],
    theme: record.themeEntryId ? { id: record.themeEntryId, applied: record.themeApplied, error: record.themeError || '' }
      : record.themeError ? { id: null, applied: false, error: record.themeError } : null,
    media: mediaReport,
    homepage: record.homepageSet ? home.fullPath : '',
    rebuildError
  };
}

/**
 * Take an import back — its pages, its media, and what it replaced.
 *
 * `later` are the live imports landed after it and not yet undone. Where one
 * of them changed the same thing since (the look, the menu, the crown, the
 * name), this import is spliced out of the chain: the later one will put
 * back what was there before THIS one, and the live value stays — undoing
 * an older import never dresses the site in a ghost of itself.
 *
 * Nothing the owner made since is destroyed: an imported page edited after
 * the landing is kept (with the pictures it shows), a look changed since is
 * filed in the theme library before the old look returns, the menu as it is
 * goes to the menu backups first, a renamed site keeps its name, and the
 * crown moves only off a page that is going away.
 */
function takeBack(rec, later, opts = {}) {
  const out = { pagesRemoved: [], pagesKept: [], media: 0, mediaKept: false, theme: false, themeSaved: '', menu: false, homepage: false, title: false, left: [], errors: [] };
  const pagesLib = require('../pages');
  const first = (has) => later.find(has) || null;
  // the crown as it is NOW — deleting the crowned page clears it, so it is
  // read before any page goes
  const crownWas = (require('../config').loadConfig().homepage || '');

  const removed = new Set();
  for (const fp of rec.pagesCreated || []) {
    try {
      const page = pagesLib.getPageByFullPath(fp);
      // only a page this import made — never a page the owner has since claimed
      if (!page || !page.meta || !page.meta.geppetto || page.meta.geppetto.import !== rec.id) continue;
      const mark = rec.pageMarks && rec.pageMarks[fp];
      if (!opts.rollback && mark && pageMark(page) !== mark) { out.pagesKept.push(fp); continue; }
      pagesLib.deletePage(fp);
      removed.add(fp);
      out.pagesRemoved.push(fp);
    } catch (e) { out.errors.push(fp + ': ' + e.message); }
  }

  if (rec.mediaFolder && out.pagesKept.length) out.mediaKept = true; // a kept page still shows them
  else if (rec.mediaFolder) {
    try {
      const media = require('../media');
      const list = media.listMedia(rec.mediaFolder, { accept: 'all' });
      for (const f of (list && list.files) || []) {
        if (f.id == null) continue;
        try { media.deleteFile(f.id); out.media += 1; } catch (e) { /* already gone */ }
      }
      try { media.deleteFolder(rec.mediaFolder); } catch (e) { /* not empty or already gone */ }
      const parent = rec.mediaFolder.split('/')[0];
      try { media.deleteFolder(parent); } catch (e) { /* other imports still there */ }
    } catch (e) { out.errors.push('media: ' + e.message); }
  }
  const mediaGone = !!rec.mediaFolder && !out.mediaKept;

  if (rec.themeApplied && rec.themeBefore) {
    const next = first((r) => r.themeApplied && r.themeBefore);
    if (next) { next.themeBefore = rec.themeBefore; out.left.push('theme'); }
    else {
      try {
        const theme = require('../theme');
        const lib = require('../theme-library');
        const live = theme.loadOverrides();
        let safe = !rec.themeSetTo || markOf(live) === rec.themeSetTo || lookInLibrary(lib, live);
        if (!safe) {
          try { out.themeSaved = lib.saveCurrentAsTheme('ג׳פטו — המראה לפני ביטול ' + (rec.title || rec.source || '')).name; safe = true; }
          catch (e) { out.errors.push('theme: ' + e.message); }
        }
        if (safe) { theme.saveOverrides(rec.themeBefore); out.theme = true; } else out.left.push('theme');
      } catch (e) { out.errors.push('theme: ' + e.message); }
    }
  }
  if (rec.themeEntryId) {
    try { require('../theme-library').removeTheme(rec.themeEntryId); } catch (e) { /* the owner may have deleted it */ }
  }

  if (rec.menuBefore || rec.menuBackupId) {
    const next = first((r) => r.menuBefore || r.menuBackupId);
    if (next) { next.menuBefore = rec.menuBefore; next.menuBackupId = rec.menuBackupId; out.left.push('menu'); }
    else {
      try {
        const menus = require('../menus');
        if (rec.menuBefore) {
          menus.backupMenus('ג׳פטו — לפני ביטול ' + (rec.title || rec.source || '')); // the menu as it is stays recoverable
          menus.saveMenus({ main: rec.menuBefore.main || [] }); // the items only: the knobs came back with the look
        } else menus.restoreMenuBackup(rec.menuBackupId);
        out.menu = true;
      } catch (e) { out.errors.push('menu: ' + e.message); }
    }
  }

  if (rec.homepageSet || rec.siteTitleSet) {
    try {
      const { loadConfig, saveConfig } = require('../config');
      const config = loadConfig();
      let changed = false;
      if (rec.homepageSet) {
        const next = first((r) => r.homepageSet);
        if (next) {
          if (next.homepageBefore === (rec.homepageSetTo || '')) next.homepageBefore = rec.homepageBefore;
          out.left.push('homepage');
        } else if (removed.has(crownWas)) {
          const back = rec.homepageBefore && pagesLib.getPageByFullPath(rec.homepageBefore) ? rec.homepageBefore : '';
          config.homepage = back;
          changed = true;
          out.homepage = true;
        }
      }
      if (rec.siteTitleSet) {
        const next = first((r) => r.siteTitleSet);
        if (next) {
          if (next.titleBefore === rec.titleSetTo) next.titleBefore = rec.titleBefore;
          if (JSON.stringify(next.logoBefore || null) === JSON.stringify(rec.logoSetTo || null)) next.logoBefore = rec.logoBefore;
          out.left.push('title');
        } else {
          if (rec.titleSetTo == null || (config.title || '') === rec.titleSetTo) {
            config.title = rec.titleBefore || '';
            changed = true;
            out.title = true;
          }
          const logoOurs = rec.logoSetTo === undefined || JSON.stringify(config.logo || null) === JSON.stringify(rec.logoSetTo || null);
          const logoDead = mediaGone && !!config.logo && !!rec.brandImage && config.logo.image === rec.brandImage;
          if (logoOurs || logoDead) {
            if (rec.logoBefore) config.logo = rec.logoBefore;
            else delete config.logo;
            changed = true;
          }
        }
      }
      if (changed) saveConfig(config);
    } catch (e) { out.errors.push('config: ' + e.message); }
  }
  return out;
}

/** Undo an import by its record (see takeBack). */
function undo(importId, opts = {}) {
  const d = loadRecords();
  const i = d.imports.findIndex((r) => r.id === importId);
  if (i < 0) { const e = new Error('ייבוא לא נמצא'); e.code = 'NOT_FOUND'; throw e; }
  const rec = d.imports[i];
  if (rec.undone) { const e = new Error('הייבוא הזה כבר בוטל'); e.code = 'ALREADY'; throw e; }
  const later = d.imports.slice(i + 1).filter((r) => !r.undone && r.mode === 'live');
  const out = takeBack(rec, later, opts);
  rec.undone = true;
  rec.undoneAt = new Date().toISOString();
  if (out.pagesKept.length) rec.pagesKept = out.pagesKept;
  saveRecords(d);
  if (opts.rebuild !== false) out.rebuildError = require('../rebuild').rebuildSite('geppetto undo');
  return out;
}

module.exports = { land, undo, listImports, getImport, blocksToSource };
