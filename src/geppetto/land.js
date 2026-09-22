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
 * the crown and the title it replaced.
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

/**
 * Land a plan.
 * @param {object} plan  a stored plan (index.js)
 * @param {{ mode?: 'live'|'drafts', media?: boolean, theme?: boolean, menu?: boolean, homepage?: boolean, siteTitle?: boolean }} [choices]
 * @param {{ transport?: Function, rebuild?: boolean }} [opts]
 */
async function land(plan, choices = {}, opts = {}) {
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
    mediaFolder: '',
    videos: [],
    themeEntryId: null,
    themeApplied: false,
    themeBefore: null,
    menuBackupId: null,
    homepageBefore: null,
    homepageSet: false,
    titleBefore: null,
    logoBefore: null,
    siteTitleSet: false,
    undone: false
  };

  // 1. addresses still free on this site
  const taken = new Set(pagesLib.listPages().map((p) => p.full_path));
  const slugs = {};
  for (const p of plan.living.pages) {
    let s = p.slug;
    for (let n = 2; taken.has(s); n++) s = p.slug + '-' + n;
    taken.add(s);
    slugs[p.key] = s;
  }
  const done = life.finish(plan.living, { slugFor: (k) => slugs[k], homeIsRoot: want.homepage });

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

  // 3. pages, as BenTML
  const written = [];
  for (const p of done.pages) {
    const fullPath = slugs[p.key];
    const { source, errors } = blocksToSource(Object.assign({}, p, { slug: fullPath }));
    pagesLib.createPage({ title: p.title || fullPath, slug: fullPath, direction: p.dir === 'rtl' ? 'rtl' : 'ltr', blocks: [] });
    record.pagesCreated.push(fullPath);
    const meta = {};
    if (p.description) meta.description = String(p.description).slice(0, 300);
    if (p.home && record.socialImage) meta.ogImage = record.socialImage;
    meta.geppetto = { import: id, source: plan.source, from: p.path || '/' };
    try {
      pagesLib.savePageSource(fullPath, source, { publish: live, meta });
    } catch (e) {
      // never lose a page to a validator quibble — the repair pass takes the rest
      pagesLib.savePageSource(fullPath, source, { publish: live, meta, repair: true });
    }
    written.push({ key: p.key, fullPath, title: p.title, home: !!p.home, errors: errors.length });
  }

  // 4. the look — into the library, and (live) onto the site
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
      }
    } catch (e) {
      record.themeError = e.message;
    }
  }

  // 5. the menu — the design's, even when the design has none: an English
  //    Canva one-pager must not keep the old site's "דף הבית" in its header
  if (want.menu && done.menu) {
    const menus = require('../menus');
    const b = menus.backupMenus('ג׳פטו — לפני ייבוא ' + (plan.title || plan.source));
    record.menuBackupId = b.id;
    menus.saveMenus({ main: done.menu.map((it) => ({ label: it.label, url: it.url, type: 'custom' })) });
  }

  // 6. the crown and the name
  const config = loadConfig();
  const home = written.find((w) => w.home) || written[0];
  if (want.homepage && home) {
    record.homepageBefore = config.homepage || '';
    config.homepage = home.fullPath;
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
    menu: want.menu ? done.menu : [],
    theme: record.themeEntryId ? { id: record.themeEntryId, applied: record.themeApplied, error: record.themeError || '' } : null,
    media: mediaReport,
    homepage: record.homepageSet ? home.fullPath : '',
    rebuildError
  };
}

/** Take an import back: its pages, its media, and everything it replaced. */
function undo(importId, opts = {}) {
  const d = loadRecords();
  const rec = d.imports.find((r) => r.id === importId);
  if (!rec) { const e = new Error('ייבוא לא נמצא'); e.code = 'NOT_FOUND'; throw e; }
  if (rec.undone) { const e = new Error('הייבוא הזה כבר בוטל'); e.code = 'ALREADY'; throw e; }
  const out = { pagesRemoved: [], media: 0, theme: false, menu: false, homepage: false, title: false, errors: [] };
  const pagesLib = require('../pages');
  for (const fp of rec.pagesCreated || []) {
    try {
      const page = pagesLib.getPageByFullPath(fp);
      // only a page this import made — never a page the owner has since claimed
      if (page && page.meta && page.meta.geppetto && page.meta.geppetto.import === rec.id) {
        pagesLib.deletePage(fp);
        out.pagesRemoved.push(fp);
      }
    } catch (e) { out.errors.push(fp + ': ' + e.message); }
  }
  if (rec.mediaFolder) {
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
  if (rec.themeApplied && rec.themeBefore) {
    try { require('../theme').saveOverrides(rec.themeBefore); out.theme = true; } catch (e) { out.errors.push('theme: ' + e.message); }
  }
  if (rec.themeEntryId) {
    try { require('../theme-library').removeTheme(rec.themeEntryId); } catch (e) { /* the owner may have deleted it */ }
  }
  if (rec.menuBackupId) {
    try { require('../menus').restoreMenuBackup(rec.menuBackupId); out.menu = true; } catch (e) { out.errors.push('menu: ' + e.message); }
  }
  if (rec.homepageSet || rec.siteTitleSet) {
    const { loadConfig, saveConfig } = require('../config');
    const config = loadConfig();
    if (rec.homepageSet) { config.homepage = rec.homepageBefore || ''; out.homepage = true; }
    if (rec.siteTitleSet) {
      config.title = rec.titleBefore || config.title;
      if (rec.logoBefore) config.logo = rec.logoBefore;
      else if (config.logo && config.logo.image === rec.brandImage) delete config.logo;
      out.title = true;
    }
    saveConfig(config);
  }
  rec.undone = true;
  rec.undoneAt = new Date().toISOString();
  saveRecords(d);
  if (opts.rebuild !== false) out.rebuildError = require('../rebuild').rebuildSite('geppetto undo');
  return out;
}

module.exports = { land, undo, listImports, getImport, blocksToSource };
