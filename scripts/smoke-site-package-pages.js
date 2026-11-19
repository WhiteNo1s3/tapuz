'use strict';

/**
 * QA gate — the "pages only" site-package import (docs/BILINGUAL-SPEC.md,
 * feature 1): English pages built on a twin site arrive in the Hebrew site
 * without touching its theme, menus, config or store.
 *
 * Three throwaway sites, each a separate process with its own temp
 * TAPUZ_ROOT (the modules bind their paths when they load):
 *   --role=source-en   an English site → exports a package WITH its uploads
 *   (no role)          the Hebrew site → every import/restore check + routes
 *   --role=target-en   an English site → takes a Hebrew page (rtl end to end)
 *
 * Pinned here: dry run is the default (library AND route), a snapshot is
 * taken before any real import and puts the site back byte for byte, the
 * prefix + internal link rewrite, no clobber / overwrite, the reserved
 * suffix, the asset round trip (dedupe + rename + traversal guard),
 * direction follows the language both ways (live render and static export),
 * and the translation pairing.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ROLE = (process.argv.find((a) => a.startsWith('--role=')) || '').replace('--role=', '');
const ARG_FILE = process.argv.filter((a) => !a.startsWith('--')).slice(2)[0] || '';

// SAFETY: this smoke writes pages, assets and a database, then deletes and
// restores them. It only ever runs on a temp root of its own.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-pagesonly-' + (ROLE || 'he') + '-'));
process.env.TAPUZ_ROOT = ROOT;
delete process.env.TAPUZ_PIN_FILE;

const paths = require('../src/paths');
function real(p) { try { return fs.realpathSync(p); } catch (e) { return path.resolve(p); } }
function isUnder(child, parent) {
  const rel = path.relative(real(parent), real(child));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
if (!isUnder(paths.SITE_ROOT, os.tmpdir()) || real(paths.SITE_ROOT) === real(paths.PACKAGE_ROOT) || isUnder(paths.SITE_ROOT, paths.PACKAGE_ROOT)) {
  console.log('FAIL the smoke must run on a temp data root, never the repo\'s own data (TAPUZ_ROOT=' + paths.SITE_ROOT + ')');
  process.exit(1);
}

let failures = 0;
const results = [];
function check(cond, label, detail) {
  results.push([label, !!cond]);
  if (ROLE) return;
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (!cond && detail ? '\n       ' + String(detail).slice(0, 900) : ''));
  if (!cond) failures++;
}

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (label) => Buffer.concat([PNG_HEAD, Buffer.from('tapuz-smoke:' + label)]);
const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

function writeAsset(rel, buf) {
  const file = path.join(paths.ASSETS_DIR, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}
function assetBytes(rel) {
  try { return fs.readFileSync(path.join(paths.ASSETS_DIR, ...rel.split('/'))); } catch (e) { return null; }
}

// markup only: the theme stylesheet names [dir="rtl"] in its selectors, and
// scripts carry their own strings — neither is the page's direction
function markup(html) {
  return String(html).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
}

// ═════════════════════════════════════════════════════════════════════
// role: the English twin — builds pages + uploads, exports the package
// ═════════════════════════════════════════════════════════════════════
function roleSourceEn(outFile) {
  require('../src/db');
  const { createPage, publishPage } = require('../src/pages');
  const { loadConfig, saveConfig } = require('../src/config');
  const cfg = loadConfig();
  cfg.language = 'en';
  cfg.title = 'English Twin';
  cfg.description = 'The English working copy';
  cfg.homepage = 'home';
  saveConfig(cfg);
  require('../src/theme').saveOverrides({ colors: { primary: '#ff0000' } });
  require('../src/menus').saveMenus({ main: [{ type: 'custom', label: 'Bridge', url: '/bridge' }] });
  require('../src/store').catalog.createProduct({ title: 'Mug', price: '30' });

  for (const name of ['hero.png', 'pic.png', 'folder/tile.png', 'og.png', 'card.png', 'same.png', 'clash.png', 'gep.png']) {
    writeAsset(name, png('source:' + name));
  }
  writeAsset('same.png', png('shared-bytes'));
  fs.writeFileSync(path.join(paths.ASSETS_DIR, 'notes.txt'), 'not media');

  createPage({
    title: 'Home', slug: 'home', status: 'draft',
    blocks: [
      { type: 'hero', id: 'hero', data: { title: 'The English twin', image: '/assets/hero.png', buttonText: 'The bridge', buttonUrl: '/bridge' } },
      { type: 'text', id: 'intro', data: { content: 'Read about @LINK(url: "/geppetto"){Geppetto} too.' } }
    ]
  });
  publishPage('home');

  createPage({
    title: 'Bridge', slug: 'bridge', status: 'draft',
    meta: { description: 'How the bridge works', ogImage: '/assets/og.png' },
    blocks: [
      { type: 'heading', id: 'h', data: { text: 'The Bridge', level: 1 } },
      { type: 'text', id: 't', data: { content: 'See @LINK(url: "/geppetto"){Geppetto}, go @LINK(url: "/"){home}, or read @LINK(url: "https://example.com/geppetto"){the outside one}.' } },
      { type: 'button', id: 'b1', data: { text: 'Geppetto', url: '/geppetto.html#top' } },
      { type: 'button', id: 'b2', data: { text: 'Elsewhere', url: '/not-in-package' } },
      { type: 'image', id: 'img', data: { src: '/assets/pic.png', alt: 'a picture', link: '/geppetto' } },
      { type: 'image', id: 'same', data: { src: '/assets/same.png', alt: 'shared' } },
      { type: 'image', id: 'clash', data: { src: '/assets/clash.png', alt: 'clashing' } },
      { type: 'image', id: 'ghost', data: { src: '/assets/ghost.png', alt: 'never uploaded' } },
      { type: 'gallery', id: 'gal', data: { images: [{ src: '/assets/folder/tile.png' }] } },
      { type: 'cards', id: 'cards', data: { items: [{ title: 'A card', image: '/assets/card.png' }] } },
      { type: 'html', id: 'raw', data: { content: '<a href="/geppetto?x=1">raw link</a> <a href="notes.html">relative</a>' } }
    ]
  });
  publishPage('bridge');

  createPage({
    title: 'Geppetto', slug: 'geppetto', status: 'draft',
    blocks: [
      { type: 'heading', id: 'h', data: { text: 'Geppetto, the English one', level: 1 } },
      { type: 'image', id: 'img', data: { src: '/assets/gep.png', alt: 'gep' } },
      { type: 'button', id: 'b', data: { text: 'Back', url: '/bridge' } }
    ]
  });
  publishPage('geppetto');

  createPage({ title: 'Notes', slug: 'notes', status: 'draft', blocks: [{ type: 'text', id: 't', data: { content: 'A draft only' } }] });

  const sitePkg = require('../src/site-package');
  fs.writeFileSync(outFile, JSON.stringify(sitePkg.exportSitePackage('twin', { assets: true })));
  fs.writeFileSync(outFile + '.plain', JSON.stringify(sitePkg.exportSitePackage('twin')));
}

// ═════════════════════════════════════════════════════════════════════
// role: an English site that takes a Hebrew page — rtl end to end
// ═════════════════════════════════════════════════════════════════════
function roleTargetEn(pkgFile) {
  require('../src/db');
  const pages = require('../src/pages');
  const { loadConfig, saveConfig } = require('../src/config');
  const cfg = loadConfig();
  cfg.language = 'en';
  cfg.title = 'English Site';
  saveConfig(cfg);
  pages.createPage({ title: 'About', slug: 'about', status: 'draft', blocks: [{ type: 'heading', id: 'h', data: { text: 'About us', level: 1 } }] });
  pages.publishPage('about');

  const sitePkg = require('../src/site-package');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  const dry = sitePkg.importSitePackage(pkg, { mode: 'pages', prefix: 'he', lang: 'he' });
  check(dry.dryRun === true && !pages.getPageByFullPath('he-עברי'), 'en site: the default is a dry run here too');
  const r = sitePkg.importSitePackage(pkg, { apply: true, mode: 'pages', prefix: 'he', lang: 'he' });
  check(r.dryRun === false && r.created.some((c) => c.path === 'he-עברי'), 'en site: the Hebrew page is created at he-עברי', JSON.stringify(r.created));

  const { renderPage } = require('../src/renderer');
  const he = pages.getPageByFullPath('he-עברי');
  check(he && he.direction === 'rtl' && he.meta.lang === 'he', 'en site: the imported Hebrew page is stored rtl with meta.lang he');
  const wasLtr = pages.getPageByFullPath('he-כיוון-הפוך');
  check(wasLtr && wasLtr.direction === 'rtl', 'en site: a page whose SOURCE said dir="ltr" becomes rtl when imported as Hebrew (the language wins)',
    wasLtr && wasLtr.direction);

  const live = markup(renderPage(he));
  check(/<html lang="he" dir="rtl">/.test(live), 'en site: live render of the Hebrew page is <html lang="he" dir="rtl">');
  check(!/dir="ltr"/.test(live), 'en site: no dir="ltr" left anywhere in the Hebrew page\'s markup', (live.match(/[^\n]*dir="ltr"[^\n]*/) || [''])[0]);
  check(live.includes('דלג לתוכן') && live.includes('ניווט ראשי') && !live.includes('Skip to content') && !live.includes('Main navigation'),
    'en site: the Hebrew page\'s chrome speaks Hebrew (skip link, nav label)');

  require('../src/export').exportAll();
  const file = path.join(paths.PUBLIC_DIR, 'he-עברי.html');
  const exported = fs.existsSync(file) ? markup(fs.readFileSync(file, 'utf8')) : '';
  check(/<html lang="he" dir="rtl">/.test(exported) && !/dir="ltr"/.test(exported) && exported.includes('דלג לתוכן'),
    'en site: the static export of the Hebrew page is rtl end to end too');
  const about = markup(fs.readFileSync(path.join(paths.PUBLIC_DIR, 'about.html'), 'utf8'));
  check(/<html lang="en" dir="ltr">/.test(about) && !/dir="rtl"/.test(about), 'en site: the site\'s own English page stays ltr');

  process.stdout.write('\n@@RESULTS@@' + JSON.stringify(results) + '\n');
}

// ═════════════════════════════════════════════════════════════════════
// the Hebrew site
// ═════════════════════════════════════════════════════════════════════
const STORE_TABLES = ['store_meta', 'store_shelves', 'store_products', 'store_variants', 'store_coupons'];

function tree(dir) {
  const out = {};
  (function walk(d, rel) {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) walk(path.join(d, ent.name), r);
      else out[r] = sha(fs.readFileSync(path.join(d, ent.name)));
    }
  })(dir, '');
  return out;
}
function rawFile(f) { try { return fs.readFileSync(f).toString('base64'); } catch (e) { return null; } }

/** A canonical dump of everything an import may touch — compared as text. */
function dump() {
  const { db } = require('../src/db');
  const all = (sql) => { try { return db.prepare(sql).all(); } catch (e) { return 'ERR ' + e.message; } };
  return {
    pages: JSON.stringify({ rows: all('SELECT * FROM pages ORDER BY id'), files: tree(paths.PAGES_DIR) }),
    menus: JSON.stringify({
      rows: all('SELECT * FROM menus ORDER BY name'), locations: all('SELECT * FROM menu_locations ORDER BY location'),
      file: rawFile(path.join(paths.CONFIG_DIR, 'menus.json'))
    }),
    theme: JSON.stringify(rawFile(path.join(paths.CONFIG_DIR, 'theme-overrides.json'))),
    config: JSON.stringify(rawFile(path.join(paths.CONFIG_DIR, 'site.json'))),
    store: JSON.stringify(STORE_TABLES.map((t) => all('SELECT * FROM ' + t + ' ORDER BY 1'))),
    assets: JSON.stringify(tree(paths.ASSETS_DIR)),
    html: JSON.stringify(Object.keys(tree(paths.PUBLIC_DIR)).filter((f) => f.endsWith('.html') && !f.includes('/')))
  };
}
const AREAS = ['pages', 'menus', 'theme', 'config', 'store', 'assets', 'html'];
function diff(a, b, areas) {
  return (areas || AREAS).filter((k) => a[k] !== b[k]);
}

function request(base, method, urlPath, { body, form, cookie, noOrigin } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'application/json' };
    if (!noOrigin) headers.Origin = base;
    if (form != null) {
      data = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body != null) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (data != null) headers['Content-Length'] = Buffer.byteLength(data);
    if (cookie) headers.Cookie = cookie;
    const r = http.request(base + urlPath, { method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text: buf });
      });
    });
    r.on('error', reject);
    if (data != null) r.write(data);
    r.end();
  });
}

function runRole(role, file) {
  return spawnSync(process.execPath, [__filename, '--role=' + role, file], { encoding: 'utf8', env: { ...process.env, TAPUZ_ROOT: '' }, maxBuffer: 64 * 1024 * 1024 });
}

async function roleHebrew() {
  // ── the English twin exports its package (another process, another root) ──
  const pkgFile = path.join(ROOT, 'twin-package.json');
  const built = runRole('source-en', pkgFile);
  if (built.status !== 0 || !fs.existsSync(pkgFile)) {
    console.log('FAIL the English source site could not export its package\n' + (built.stderr || built.stdout || '').slice(-1500));
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  const plainPkg = JSON.parse(fs.readFileSync(pkgFile + '.plain', 'utf8'));

  // ── the Hebrew site as it stands before any import ──
  require('../src/db');
  const pages = require('../src/pages');
  const { loadConfig, saveConfig } = require('../src/config');
  const theme = require('../src/theme');
  const menus = require('../src/menus');
  const store = require('../src/store');
  const sitePkg = require('../src/site-package');
  let snapshots = null;
  try { snapshots = require('../src/site-snapshot'); } catch (e) { snapshots = null; }
  const { renderPage } = require('../src/renderer');
  const exportLib = require('../src/export');

  const cfg = loadConfig();
  cfg.title = 'האתר העברי';
  cfg.description = 'אתר לבדיקה';
  cfg.language = 'he';
  cfg.baseUrl = 'https://example.test';
  saveConfig(cfg);
  theme.saveOverrides({ colors: { primary: '#123456' } });
  menus.saveMenus({ main: [{ type: 'custom', label: 'הגשר', url: '/הגשר' }], footer: [{ type: 'custom', label: 'צור קשר', url: '/contact' }] });
  store.catalog.createProduct({ title: 'נר לבנדר', price: '45' });

  writeAsset('same.png', png('shared-bytes'));
  writeAsset('clash.png', png('the-hebrew-site-own-clash'));

  pages.createPage({ title: 'דף הבית', slug: 'בית', status: 'draft', blocks: [{ type: 'heading', id: 'h', data: { text: 'ברוכים הבאים', level: 1 } }] });
  pages.publishPage('בית');
  pages.createPage({
    title: 'הגשר', slug: 'הגשר', status: 'draft',
    blocks: [{ type: 'heading', id: 'h', data: { text: 'הגשר', level: 1 } }, { type: 'image', id: 'i', data: { src: '/assets/same.png', alt: 'משותף' } }]
  });
  pages.publishPage('הגשר');
  pages.createPage({ title: 'Old Geppetto', slug: 'en-geppetto', status: 'draft', blocks: [{ type: 'text', id: 't', data: { content: 'the page that was already here' } }] });
  pages.publishPage('en-geppetto');
  exportLib.exportAll();

  // ── export: the package carries its uploads only when asked ──
  check(plainPkg.assets === undefined, 'export without the option carries no assets (as before)');
  check(Array.isArray(pkg.assets) && pkg.assets.every((a) => a && typeof a.path === 'string' && typeof a.mime === 'string' && typeof a.base64 === 'string'),
    'export with assets: every bundled file is { path, mime, base64 }');
  const bundled = new Set((pkg.assets || []).map((a) => a.path));
  check(['/assets/hero.png', '/assets/pic.png', '/assets/folder/tile.png', '/assets/og.png', '/assets/card.png', '/assets/same.png', '/assets/clash.png', '/assets/gep.png'].every((p) => bundled.has(p)),
    'export with assets: hero background, image, gallery tile, card and og:image are all bundled', JSON.stringify([...bundled]));
  check(!bundled.has('/assets/notes.txt') && !bundled.has('/assets/ghost.png'), 'export with assets: only files the pages reference, and only ones that exist');
  const manifest = pkg.assetsManifest || {};
  check(manifest.count === (pkg.assets || []).length && manifest.bytes > 0 && Array.isArray(manifest.skipped) && manifest.skipped.some((s) => s.path === '/assets/ghost.png'),
    'export with assets: a manifest counts the files and names the one that could not be bundled', JSON.stringify(manifest));
  const pic = (pkg.assets || []).find((a) => a.path === '/assets/pic.png');
  check(pic && Buffer.from(pic.base64, 'base64').equals(png('source:pic.png')) && pic.mime === 'image/png', 'export with assets: the bytes and the mime are the file\'s own');
  const bridgeEntry = pkg.pages.find((p) => p.fullPath === 'bridge');
  check(bridgeEntry && bridgeEntry.meta && bridgeEntry.meta.ogImage === '/assets/og.png', 'export: a page\'s meta (description, og:image) travels with it');

  const before = dump();
  const opts = { mode: 'pages', prefix: 'en/', lang: 'en', translations: { 'en-bridge': 'הגשר', 'en/home': 'בית', 'en-notes': 'אין-דף-כזה' } };

  // ── EXTRA SAFETY 1: dry run is the default ──
  const dry = sitePkg.importSitePackage(pkg, opts);
  const afterDry = dump();
  check(dry.dryRun === true, 'no opt-in → the answer says it was a dry run');
  check(diff(before, afterDry).length === 0, 'DRY RUN (the default) writes nothing: pages, .pzn files, menus, theme, config, store, assets, export',
    'changed: ' + diff(before, afterDry).join(', '));
  check(!snapshots || snapshots.listSnapshots().length === 0, 'a dry run takes no snapshot either');
  const paths_ = (list) => (list || []).map((x) => x.path).sort();
  check(JSON.stringify(paths_(dry.created)) === JSON.stringify(['en-bridge', 'en-home', 'en-notes']), 'dry run lists what WOULD be created, with final paths', JSON.stringify(dry.created));
  check((dry.skipped || []).length === 1 && dry.skipped[0].path === 'en-geppetto' && dry.skipped[0].reason === 'exists', 'dry run lists the page that would be skipped, and why', JSON.stringify(dry.skipped));
  check((dry.overwritten || []).length === 0 && (dry.renamed || []).length === 0, 'dry run: nothing overwritten, nothing renamed in this import');
  const dryT = dry.translations || {};
  check((dryT.linked || []).length === 2 && dryT.linked.some((l) => l.path === 'en-bridge' && l.target === 'הגשר' && l.lang === 'en') && dryT.linked.some((l) => l.path === 'en-home' && l.target === 'בית'),
    'dry run lists the translation pairs it would link (a prefixed path, or the spec\'s en/home spelling)', JSON.stringify(dryT));
  check((dryT.missing || []).length === 1 && dryT.missing[0].target === 'אין-דף-כזה', 'dry run reports the unknown translation target — not fatal', JSON.stringify(dryT.missing));
  const dryA = dry.assets || {};
  check(JSON.stringify((dryA.added || []).slice().sort()) === JSON.stringify(['/assets/card.png', '/assets/folder/tile.png', '/assets/hero.png', '/assets/og.png', '/assets/pic.png']),
    'dry run: assets to add — only what the imported pages reference (the skipped page\'s picture is not among them)', JSON.stringify(dryA.added));
  check(JSON.stringify(dryA.reused) === JSON.stringify(['/assets/same.png']), 'dry run: same name + same bytes → reuse', JSON.stringify(dryA.reused));
  check((dryA.renamed || []).length === 1 && dryA.renamed[0].from === '/assets/clash.png' && dryA.renamed[0].to === '/assets/clash-2.png', 'dry run: same name + different bytes → a new name', JSON.stringify(dryA.renamed));
  check((dryA.missing || []).includes('/assets/ghost.png'), 'dry run: a picture the package does not carry is named as missing', JSON.stringify(dryA.missing));
  check(dry.linkRewrites >= 6, 'dry run counts the internal links it would rewrite', String(dry.linkRewrites));

  for (const variant of [{ ...opts, dryRun: true, apply: true }, { ...opts, apply: 'yes' }, { ...opts, dryRun: 0 }]) {
    sitePkg.importSitePackage(pkg, variant);
  }
  check(diff(before, dump()).length === 0, 'only apply:true / dryRun:false opts in — dryRun:true wins over apply, and truthy look-alikes do not count');

  // ── prefix + language validation ──
  const refuses = (o) => { try { sitePkg.importSitePackage(pkg, { mode: 'pages', ...o }); return false; } catch (e) { return true; } };
  check(['../x', 'en/../x', 'admin', 'api/', 'en us', 'en/us', 'a'.repeat(60), 'assets', '<b>'].every((p) => refuses({ prefix: p })),
    'a prefix that is not slug-safe, has "..", nests, or starts at a reserved address is refused');
  check(!refuses({ prefix: 'en' }) && !refuses({ prefix: '/en/' }) && !refuses({ prefix: '' }), 'en, en/ and /en/ are the same prefix; none is fine too');
  check(refuses({ lang: 'english!' }) && refuses({ lang: '../he' }) && !refuses({ lang: 'en' }) && !refuses({ lang: 'pt-BR' }), 'the language must look like a language code');
  check(diff(before, dump()).length === 0, 'a refused import wrote nothing');

  // ── EXTRA SAFETY 2: no snapshot, no import ──
  const snapDir = path.join(paths.CONFIG_DIR, 'site-snapshots');
  fs.writeFileSync(snapDir, 'in the way'); // the snapshots folder cannot be made
  let threw = false;
  try { sitePkg.importSitePackage(pkg, { ...opts, apply: true }); } catch (e) { threw = true; }
  fs.rmSync(snapDir, { force: true });
  check(threw && diff(before, dump()).length === 0, 'when the snapshot cannot be written the import refuses and changes nothing');

  // ── the real pages-only import ──
  const done = sitePkg.importSitePackage(pkg, { ...opts, apply: true });
  const afterImport = dump();
  check(done.dryRun === false && typeof done.snapshotId === 'string' && done.snapshotId.length > 0, 'apply:true → a real import, and it names the snapshot it took first');
  check(diff(before, afterImport, ['menus', 'theme', 'config', 'store']).length === 0,
    'ACCEPTANCE 1: a pages-only import leaves theme, menus, config and store byte-identical', 'changed: ' + diff(before, afterImport, ['menus', 'theme', 'config', 'store']).join(', '));
  check(loadConfig().title === 'האתר העברי' && loadConfig().language === 'he' && menus.loadMenus().main[0].label === 'הגשר' && theme.loadOverrides().colors.primary === '#123456',
    '…the Hebrew site keeps its own name, language, menu and colours');
  check(JSON.stringify(paths_(done.created)) === JSON.stringify(paths_(dry.created)) && JSON.stringify(done.skipped) === JSON.stringify(dry.skipped) &&
    JSON.stringify(done.assets) === JSON.stringify(dry.assets) && done.linkRewrites === dry.linkRewrites && JSON.stringify(done.translations) === JSON.stringify(dry.translations),
    'ACCEPTANCE 5: the real import did exactly what the dry run said it would', JSON.stringify({ dry: dry.created, done: done.created }));

  const enBridge = pages.getPageByFullPath('en-bridge');
  check(enBridge && enBridge.status === 'published' && enBridge.path_prefix === 'en' && enBridge.slug === 'bridge', 'the page lands at en-bridge through the page\'s own path_prefix + slug', enBridge && (enBridge.path_prefix + ' / ' + enBridge.slug));
  check(pages.getPageByFullPath('en-notes') && pages.getPageByFullPath('en-notes').status === 'draft', 'a draft arrives as a draft');
  check(!pages.getPageByFullPath('bridge') && !pages.getPageByFullPath('home'), 'nothing lands at the unprefixed addresses');

  // ── ACCEPTANCE 2: prefix + link rewrite ──
  for (const kind of ['draft', 'published']) {
    const src = String(pages.getPageSource('en-bridge', kind));
    check(src.includes('&quot;/en-geppetto&quot;') && src.includes('href="/en-geppetto.html#top"') && src.includes('link="/en-geppetto"') && src.includes('/en-geppetto?x=1'),
      kind + ': links between imported pages point at the prefixed pages (inline link, button, image link, raw html)', src);
    check(!/(["']|&quot;)\/geppetto/.test(src), kind + ': no link to the unprefixed /geppetto is left');
    check(src.includes('&quot;/en-home&quot;'), kind + ': a link to the source site\'s home (/) goes to the imported home');
    check(src.includes('https://example.com/geppetto') && src.includes('"/not-in-package"'), kind + ': an external link and a link to a page that is not in the package stay untouched');
    check(src.includes('en-notes.html'), kind + ': a relative link (notes.html) follows its page too');
  }
  const enHome = String(pages.getPageSource('en-home', 'published'));
  check(enHome.includes('href="/en-bridge"') && enHome.includes('&quot;/en-geppetto&quot;'), 'the imported home links to the prefixed pages');

  // ── no clobber without overwrite ──
  check(String(pages.getPageSource('en-geppetto', 'published')).includes('the page that was already here') && pages.getPageByFullPath('en-geppetto').title === 'Old Geppetto',
    'the page that already existed is untouched (no overwrite asked)');

  // ── ACCEPTANCE 3: the asset round trip ──
  check(['hero.png', 'pic.png', 'folder/tile.png', 'og.png', 'card.png'].every((n) => { const b = assetBytes(n); return b && b.equals(png('source:' + n)); }),
    'the bundled uploads exist on the Hebrew site with the source\'s bytes (a sub-folder included)');
  check(assetBytes('clash.png').equals(png('the-hebrew-site-own-clash')) && assetBytes('clash-2.png') && assetBytes('clash-2.png').equals(png('source:clash.png')),
    'same name, different bytes: the site\'s own file is untouched and the import\'s lands beside it under a new name');
  check(!assetBytes('same-2.png') && !assetBytes('gep.png'), 'same name + same bytes is reused, and the skipped page\'s picture was not written');
  const bridgeSrc = String(pages.getPageSource('en-bridge', 'published'));
  check(bridgeSrc.includes('src="/assets/clash-2.png"') && !bridgeSrc.includes('"/assets/clash.png"') && bridgeSrc.includes('src="/assets/same.png"'), 'the page references the renamed file; the reused one keeps its path');
  check(enBridge.meta.ogImage === '/assets/og.png' && enBridge.meta.description === 'How the bridge works', 'the page\'s description and og:image arrive with it');
  const liveBridge = renderPage(pages.getPageByFullPath('en-bridge'));
  const refs = [...new Set((markup(liveBridge).match(/\/assets\/[A-Za-z0-9._\/-]+/g) || []))];
  const broken = refs.filter((r) => r !== '/assets/ghost.png' && !fs.existsSync(path.join(paths.ASSETS_DIR, ...r.replace('/assets/', '').split('/'))));
  check(refs.length >= 6 && broken.length === 0, 'the rendered page has no broken image src (but the one the source never had)', JSON.stringify({ refs, broken }));

  // ── direction follows language: an English page on the Hebrew site ──
  check(enBridge.direction === 'ltr' && enBridge.meta.lang === 'en', 'the imported page is stored ltr with meta.lang en');
  const liveMarkup = markup(liveBridge);
  check(/<html lang="en" dir="ltr">/.test(liveMarkup), 'live render: <html lang="en" dir="ltr">');
  check(!/dir="rtl"/.test(liveMarkup), 'live render: no dir="rtl" left anywhere in the markup — every block, the header, the footer', (liveMarkup.match(/[^\n]*dir="rtl"[^\n]*/) || [''])[0]);
  check(liveMarkup.includes('Skip to content') && liveMarkup.includes('aria-label="Main navigation"') && liveMarkup.includes('aria-label="Menu"') && liveMarkup.includes('aria-label="Footer navigation"') && liveMarkup.includes('Built with Tapuziel'),
    'live render: the chrome\'s own words are English (skip link, nav labels, credit)');
  // the menu's labels and the site's name are CONTENT (per-language menus are
  // the parallel PR) — everything else on an English page must be English
  const ownWords = liveMarkup
    .replace(/<ul>[\s\S]*?<\/ul>/, '').replace(/<nav class="footer-nav"[\s\S]*?<\/nav>/, '')
    .split('האתר העברי').join('').replace(/<a class="tapuz-lang-switch[\s\S]*?<\/div>/, '');
  const hebrewLeft = ownWords.match(/[^\n]*[\u0590-\u05FF][^\n]*/g) || [];
  check(hebrewLeft.every((l) => /hreflang|tapuz-lang-switch/.test(l)), 'live render: no Hebrew chrome words on the English page', hebrewLeft.join(' ⏎ '));

  exportLib.exportAll();
  const exportedFile = path.join(paths.PUBLIC_DIR, 'en-bridge.html');
  const exported = fs.existsSync(exportedFile) ? markup(fs.readFileSync(exportedFile, 'utf8')) : '';
  check(/<html lang="en" dir="ltr">/.test(exported) && !/dir="rtl"/.test(exported) && exported.includes('Skip to content') && exported.includes('aria-label="Main navigation"'),
    'static export: the English page is ltr end to end, same as the live render');
  const heExported = markup(fs.readFileSync(path.join(paths.PUBLIC_DIR, 'הגשר.html'), 'utf8'));
  check(/<html lang="he" dir="rtl">/.test(heExported) && !/dir="ltr"/.test(heExported) && heExported.includes('דלג לתוכן'), 'static export: the Hebrew page beside it is still rtl, in Hebrew');

  // a source page that says rtl/he in its head becomes ltr when imported as English
  const wrongWay = {
    format: 'tapuz-site', version: 1, name: 'direction',
    pages: [{ fullPath: 'turned', title: 'Turned', status: 'published',
      draftSource: '<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n  <head>\n    <meta charset="utf-8" />\n    <title>Turned</title>\n    <meta name="bent-slug" content="turned" />\n  </head>\n  <body>\n    <bent-heading level="1">Written in English</bent-heading>\n  </body>\n</html>\n',
      publishedSource: '<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n  <head>\n    <meta charset="utf-8" />\n    <title>Turned</title>\n    <meta name="bent-slug" content="turned" />\n  </head>\n  <body>\n    <bent-heading level="1">Written in English</bent-heading>\n  </body>\n</html>\n' },
    { fullPath: 'bare', title: 'Bare', status: 'draft', draftSource: '<bent-heading level="1">No head at all</bent-heading>' }]
  };
  sitePkg.importSitePackage(wrongWay, { apply: true, mode: 'pages', prefix: 'en', lang: 'en' });
  const turned = pages.getPageByFullPath('en-turned');
  check(turned && turned.direction === 'ltr' && turned.meta.lang === 'en' && /<html lang="en" dir="ltr"/.test(String(pages.getPageSource('en-turned', 'published'))) &&
    /<html lang="en" dir="ltr">/.test(renderPage(turned)) && !/dir="rtl"/.test(markup(renderPage(turned))),
    'the language overrides the source page\'s own direction: an rtl source imported as English is ltr (row, source head and render)');
  const bare = pages.getPageByFullPath('en-bare');
  check(bare && bare.direction === 'ltr' && bare.meta.lang === 'en', 'a source with no <html> head at all gets the language\'s direction too');
  check(/content="en-turned"/.test(String(pages.getPageSource('en-turned', 'draft'))), 'the source\'s own slug note follows the page\'s new address');

  // ── ACCEPTANCE 4: translations ──
  const sibOfEn = pages.getTranslations('en-bridge');
  const sibOfHe = pages.getTranslations('הגשר');
  check(sibOfEn.some((s) => s.full_path === 'הגשר' && s.lang === 'he') && sibOfHe.some((s) => s.full_path === 'en-bridge' && s.lang === 'en'),
    'the mapping links the imported page to its Hebrew twin (getTranslations shows the pair, both ways)', JSON.stringify({ sibOfEn, sibOfHe }));
  check(pages.getTranslations('en-home').some((s) => s.full_path === 'בית'), 'the home pair is linked too');
  const heLive = renderPage(pages.getPageByFullPath('הגשר'));
  const enLive = renderPage(pages.getPageByFullPath('en-bridge'));
  check(/tapuz-lang-switch/.test(heLive) && /tapuz-lang-switch/.test(enLive), 'both pages show the language switcher');
  check(/hreflang="en" href="https:\/\/example\.test\/en-bridge/.test(heLive) && /hreflang="he" href="https:\/\/example\.test\//.test(heLive) && /hreflang="he"/.test(enLive) && /hreflang="en"/.test(enLive),
    'both pages carry hreflang for the pair');
  check(pages.getPageByFullPath('הגשר').direction === 'rtl' && /<html lang="he" dir="rtl">/.test(heLive), 'the Hebrew twin keeps its own direction after the link');
  check(done.translations.missing.length === 1 && pages.getPageByFullPath('en-notes'), 'the unknown target was reported and the import went on');

  // ── overwrite ──
  const again = sitePkg.importSitePackage(pkg, { ...opts, apply: true });
  check(again.created.length === 0 && again.overwritten.length === 0 && again.skipped.length === 4 && again.skipped.every((s) => s.reason === 'exists'),
    'importing the same package again creates nothing and overwrites nothing', JSON.stringify(again.skipped));
  const over = sitePkg.importSitePackage(pkg, { ...opts, apply: true, overwrite: true });
  check(over.overwritten.length === 4 && over.created.length === 0 && over.skipped.length === 0, 'with overwrite the existing pages are reported as overwritten', JSON.stringify(over.overwritten));
  check(String(pages.getPageSource('en-geppetto', 'published')).includes('Geppetto, the English one') && pages.getPageByFullPath('en-geppetto').title === 'Geppetto',
    'overwrite replaces the page that was already there');
  check(JSON.stringify(over.assets.added) === '["/assets/gep.png"]' && over.assets.renamed.length === 1 && over.assets.renamed[0].to === '/assets/clash-2.png' && !assetBytes('clash-3.png') && assetBytes('gep.png'),
    'a second import reuses the file it renamed the first time (no clash-3), and the overwritten page\'s picture arrives', JSON.stringify(over.assets));
  check(pages.getTranslations('en-bridge').length === 1, 'linking the same pair twice keeps one pair');

  // ── reserved addresses keep the suffix rule; unsafe assets are refused ──
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  const crafted = {
    format: 'tapuz-site', version: 1, name: 'crafted',
    pages: [
      { fullPath: 'account', title: 'Account', status: 'draft', draftSource: '<bent-heading level="1">An account page from another site</bent-heading>' },
      { fullPath: 'linker', title: 'Linker', status: 'draft',
        draftSource: '<bent-button href="/account">To the account</bent-button><bent-image src="/assets/x.html" alt="a" /><bent-image src="/assets/fake.png" alt="b" /><bent-image src="/assets/../../evil.png" alt="c" /><bent-image src="/assets/good.png" alt="d" />' },
      { fullPath: 'shop-item', title: 'A product page', status: 'draft', meta: { store: 'product', storeSku: 'mug' }, draftSource: '<bent-heading level="1">Mug</bent-heading>' }
    ],
    assets: [
      { path: '/assets/../../evil.png', mime: 'image/png', base64: png('evil').toString('base64') },
      { path: '/assets/x.html', mime: 'text/html', base64: html.toString('base64') },
      { path: '/assets/fake.png', mime: 'image/png', base64: html.toString('base64') },
      { path: '/assets/good.png', mime: 'image/png', base64: png('good').toString('base64') },
      { path: 'C:\\windows\\evil.png', mime: 'image/png', base64: png('evil').toString('base64') }
    ]
  };
  const craftedDry = sitePkg.importSitePackage(crafted, { mode: 'pages' });
  check(craftedDry.renamed.length === 1 && craftedDry.renamed[0].from === 'account' && craftedDry.renamed[0].path === 'account-2' && craftedDry.renamed[0].reason === 'reserved',
    'dry run: a page at a reserved address is listed as renamed (-2)', JSON.stringify(craftedDry.renamed));
  const craftedDone = sitePkg.importSitePackage(crafted, { mode: 'pages', apply: true });
  check(pages.getPageByFullPath('account-2') && !pages.getPageByFullPath('account'), 'a page at a reserved address lands at account-2 — the suffix rule used elsewhere');
  check(String(pages.getPageSource('linker', 'draft')).includes('href="/account-2"'), 'and the link to it follows the rename');
  check(craftedDone.skipped.some((s) => s.from === 'shop-item' && s.reason === 'store') && !pages.getPageByFullPath('shop-item'), 'a store\'s own product page is not a page a pages-only import takes');
  const rejected = (craftedDone.assets.rejected || []).map((r) => r.path);
  check(['/assets/../../evil.png', '/assets/x.html', '/assets/fake.png', 'C:\\windows\\evil.png'].every((p) => rejected.includes(p)),
    'path traversal, a non-media extension and a file that is not the image it claims to be are all rejected', JSON.stringify(craftedDone.assets.rejected));
  const strays = [path.join(ROOT, 'evil.png'), path.join(paths.PUBLIC_DIR, 'evil.png'), path.join(path.dirname(ROOT), 'evil.png'), path.join(paths.ASSETS_DIR, 'x.html'), path.join(paths.ASSETS_DIR, 'fake.png')];
  check(strays.every((f) => !fs.existsSync(f)) && assetBytes('good.png') && assetBytes('good.png').equals(png('good')), 'nothing was written outside the uploads folder, and the honest file beside them arrived');

  // ── EXTRA SAFETY 2: snapshot → import → restore, byte for byte ──
  const list = snapshots ? snapshots.listSnapshots() : [];
  check(list.length >= 1 && list.some((s) => s.id === done.snapshotId) && list.every((s) => s.id && s.at), 'every real import left a snapshot in the list', JSON.stringify(list.map((s) => s.id)));
  check(fs.existsSync(path.join(paths.CONFIG_DIR, 'site-snapshots')) && isUnder(path.join(paths.CONFIG_DIR, 'site-snapshots'), ROOT), 'snapshots live under the site\'s data root, beside the menu backups');
  const beforeRestore = dump();
  const restored = snapshots.restoreSnapshot(done.snapshotId);
  const afterRestore = dump();
  check(diff(before, afterRestore).length === 0,
    'RESTORE puts the site back byte for byte: pages (rows + .pzn), menus, theme, config, store, asset files and the exported pages',
    'still different: ' + diff(before, afterRestore).join(', '));
  check(!pages.getPageByFullPath('en-bridge') && !pages.getPageByFullPath('account-2') && !assetBytes('clash-2.png') && !assetBytes('folder/tile.png') && !fs.existsSync(path.join(paths.ASSETS_DIR, 'folder')),
    '…the imported pages, the added files and the folder made for them are gone');
  check(pages.getTranslations('הגשר').length === 0 && String(pages.getPageSource('en-geppetto', 'published')).includes('the page that was already here'),
    '…the Hebrew twin is unpaired again and the overwritten page has its old words back');
  check(restored && typeof restored.preRestoreId === 'string', 'a restore takes its own snapshot first');
  snapshots.restoreSnapshot(restored.preRestoreId);
  check(diff(beforeRestore, dump(), ['pages', 'menus', 'theme', 'config', 'store', 'assets']).length === 0 && pages.getPageByFullPath('en-bridge') && assetBytes('clash-2.png'),
    '…so the restore itself can be undone: the imported pages and their files are back', 'different: ' + diff(beforeRestore, dump()).join(', '));
  snapshots.restoreSnapshot(done.snapshotId);
  exportLib.exportAll();
  check(diff(before, dump()).length === 0, 'and back again to the site as it was before the first import');

  // ── the full import (theme + menus + config + store) round-trips too ──
  const fullDry = sitePkg.importSitePackage(pkg);
  check(fullDry.dryRun === true && diff(before, dump()).length === 0, 'a FULL import is a dry run by default as well');
  const full = sitePkg.importSitePackage(pkg, { apply: true });
  const afterFull = dump();
  check(loadConfig().title === 'English Twin' && menus.loadMenus().main[0].label === 'Bridge' && theme.loadOverrides().colors.primary === '#ff0000' && full.store && full.store.ok,
    'a full import (opted in) still replaces theme, menus and config and merges the store — as it always did');
  check(diff(before, afterFull, ['menus', 'theme', 'config', 'store', 'pages']).length === 5, 'the full import changed all of them');
  snapshots.restoreSnapshot(full.snapshotId);
  exportLib.exportAll();
  check(diff(before, dump()).length === 0, 'RESTORE after a full import: theme, menus, config and store are back byte for byte too', 'still different: ' + diff(before, dump()).join(', '));
  check(snapshots.listSnapshots().length <= snapshots.SNAPSHOTS_KEEP, 'old snapshots are pruned (newest ' + snapshots.SNAPSHOTS_KEEP + ' kept)');

  // ── a Hebrew page into an English site (another process) ──
  const hePkg = {
    format: 'tapuz-site', version: 1, name: 'hebrew pages',
    pages: [
      { fullPath: 'עברי', title: 'עמוד עברי', status: 'published', draftSource: pages.getPageSource('הגשר', 'draft'), publishedSource: pages.getPageSource('הגשר', 'published') },
      { fullPath: 'כיוון-הפוך', title: 'כיוון הפוך', status: 'draft',
        draftSource: String(pages.getPageSource('הגשר', 'draft')).replace('<html lang="he" dir="rtl"', '<html lang="en" dir="ltr"') }
    ]
  };
  const hePkgFile = path.join(ROOT, 'hebrew-package.json');
  fs.writeFileSync(hePkgFile, JSON.stringify(hePkg));
  const enSite = runRole('target-en', hePkgFile);
  const m = /@@RESULTS@@(.*)/.exec(enSite.stdout || '');
  const enResults = m ? JSON.parse(m[1]) : [];
  check(enSite.status === 0 && enResults.length >= 8, 'the English target site ran its checks', (enSite.stderr || enSite.stdout || '').slice(-800));
  for (const [label, ok] of enResults) check(ok, label);

  // ── the routes: dry run by default, the admin gate, CSRF, restore ──
  const { createAdmin, addTeamMember } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');
  addTeamMember('editor1', 'editor-pass-1', 'editor');
  const PORT = 3951;
  const BASE = 'http://127.0.0.1:' + PORT;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) }, stdio: 'ignore' });
  try {
    await new Promise((resolve, reject) => {
      const tick = (n) => http.get(BASE + '/', () => resolve()).on('error', () => (n <= 0 ? reject(new Error('server did not start')) : setTimeout(() => tick(n - 1), 150)));
      tick(60);
    });
    const login = await request(BASE, 'POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const admin = String(login.headers['set-cookie'] || '').split(';')[0];
    const editorLogin = await request(BASE, 'POST', '/admin/login', { form: { username: 'editor1', password: 'editor-pass-1' } });
    const editor = String(editorLogin.headers['set-cookie'] || '').split(';')[0];
    const routeOpts = { package: pkg, mode: 'pages', prefix: 'r', lang: 'en' };
    const beforeRoutes = dump();

    const page = await request(BASE, 'GET', '/admin/settings', { cookie: admin });
    check(page.status === 200 && ['sp-pages-only', 'sp-prefix', 'sp-lang', 'sp-overwrite', 'sp-translations', 'sp-preview', 'sp-confirm', 'sp-import-apply', 'sp-snapshots'].every((id) => page.text.includes('id="' + id + '"')),
      'settings screen: pages-only, prefix, language, overwrite, mapping, preview, confirm and the snapshots list are all there');
    check(/ייבוא דפים בלבד/.test(page.text) && /תצוגה מקדימה/.test(page.text) && /אני מאשר\/ת ייבוא אמיתי/.test(page.text) && /id="sp-import-apply"[^>]*\sdisabled/.test(page.text),
      'settings screen: preview is the default action — the import button waits, disabled, for the explicit confirm');

    const exp = await request(BASE, 'GET', '/admin/api/site-package/export?assets=1', { cookie: admin });
    check(exp.status === 200 && exp.json && Array.isArray(exp.json.assets) && exp.json.assets.some((a) => a.path === '/assets/same.png') && exp.json.assetsManifest,
      'GET …/export?assets=1 bundles the uploads the pages reference');
    const expPlain = await request(BASE, 'GET', '/admin/api/site-package/export', { cookie: admin });
    check(expPlain.status === 200 && expPlain.json && expPlain.json.assets === undefined, 'GET …/export without it is the package as before');

    const dryRoute = await request(BASE, 'POST', '/admin/api/site-package/import', { cookie: admin, body: routeOpts });
    check(dryRoute.status === 200 && dryRoute.json.ok && dryRoute.json.dryRun === true && dryRoute.json.created.some((c) => c.path === 'r-bridge') && !pages.getPageByFullPath('r-bridge'),
      'POST …/import with no opt-in is a dry run: it answers the preview and creates nothing');
    check(diff(beforeRoutes, dump()).length === 0, '…and the site is byte-identical after it');
    const big = await request(BASE, 'POST', '/admin/api/site-package/import', { cookie: admin, body: { ...routeOpts, package: { ...pkg, padding: 'x'.repeat(13 * 1024 * 1024) } } });
    check(big.status === 200 && big.json && big.json.dryRun === true, 'a package bigger than the usual 12 MB admin body is still read (bundled uploads are big)', String(big.status));

    const noOrigin = await request(BASE, 'POST', '/admin/api/site-package/import', { cookie: admin, body: { ...routeOpts, apply: true }, noOrigin: true });
    const asEditor = await request(BASE, 'POST', '/admin/api/site-package/import', { cookie: editor, body: { ...routeOpts, apply: true } });
    const anon = await request(BASE, 'POST', '/admin/api/site-package/import', { body: { ...routeOpts, apply: true } });
    check(noOrigin.status === 403 && asEditor.status === 403 && anon.status >= 400 && !pages.getPageByFullPath('r-bridge'),
      'a real import is refused without the same-origin proof (CSRF), for an editor, and for a visitor', [noOrigin.status, asEditor.status, anon.status].join('/'));

    const real = await request(BASE, 'POST', '/admin/api/site-package/import', { cookie: admin, body: { ...routeOpts, apply: true } });
    check(real.status === 200 && real.json.ok && real.json.dryRun === false && real.json.snapshotId && pages.getPageByFullPath('r-bridge') && pages.getPageByFullPath('r-bridge').direction === 'ltr',
      'POST …/import with apply:true imports for real and names its snapshot', JSON.stringify(real.json).slice(0, 300));
    const served = await request(BASE, 'GET', '/r-bridge', {});
    check(served.status === 200 && /<html lang="en" dir="ltr">/.test(served.text) && !/dir="rtl"/.test(markup(served.text)), 'the imported page is live at /r-bridge, ltr (the site was rebuilt)');
    const heServed = await request(BASE, 'GET', '/' + encodeURIComponent('הגשר'), {});
    check(heServed.status === 200 && /<html lang="he" dir="rtl">/.test(heServed.text), 'and the Hebrew page beside it is still served rtl');

    const snaps = await request(BASE, 'GET', '/admin/api/site-package/snapshots', { cookie: admin });
    check(snaps.status === 200 && snaps.json.ok && snaps.json.snapshots.some((s) => s.id === real.json.snapshotId), 'GET …/snapshots lists it');
    const editorSnaps = await request(BASE, 'GET', '/admin/api/site-package/snapshots', { cookie: editor });
    const editorRestore = await request(BASE, 'POST', '/admin/api/site-package/restore', { cookie: editor, body: { snapshotId: real.json.snapshotId } });
    const csrfRestore = await request(BASE, 'POST', '/admin/api/site-package/restore', { cookie: admin, body: { snapshotId: real.json.snapshotId }, noOrigin: true });
    check(editorSnaps.status === 403 && editorRestore.status === 403 && csrfRestore.status === 403 && pages.getPageByFullPath('r-bridge'), 'the snapshot routes sit behind the same admin gate and CSRF check');
    const badRestore = await request(BASE, 'POST', '/admin/api/site-package/restore', { cookie: admin, body: { snapshotId: '../../etc/passwd' } });
    check(badRestore.status === 404 && badRestore.json.ok === false && pages.getPageByFullPath('r-bridge'), 'a snapshot id that names no snapshot is a 404 — and nothing is restored');

    const restore = await request(BASE, 'POST', '/admin/api/site-package/restore', { cookie: admin, body: { snapshotId: real.json.snapshotId } });
    check(restore.status === 200 && restore.json.ok && !pages.getPageByFullPath('r-bridge'), 'POST …/restore puts the site back — one click', JSON.stringify(restore.json).slice(0, 300));
    const gone = await request(BASE, 'GET', '/r-bridge', {});
    check(gone.status === 404 && diff(beforeRoutes, dump()).length === 0, 'the imported page is no longer served, and the site is byte-identical to before the import', 'different: ' + diff(beforeRoutes, dump()).join(', '));
  } finally {
    child.kill();
  }

  console.log('');
  if (failures) {
    console.log('SMOKE SITE-PACKAGE-PAGES: FAIL (' + failures + ')');
    process.exit(1);
  }
  console.log('SMOKE SITE-PACKAGE-PAGES: PASS');
}

if (ROLE === 'source-en') roleSourceEn(ARG_FILE);
else if (ROLE === 'target-en') roleTargetEn(ARG_FILE);
else roleHebrew().catch((e) => { console.error(e); console.log('SMOKE SITE-PACKAGE-PAGES: FAIL (crashed)'); process.exit(1); });
