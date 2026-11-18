'use strict';

/**
 * Per-language menus, and the direction that follows the page's language.
 * A Hebrew site keeps `main` / `footer`. An English page (meta.lang en)
 * renders `main@en` / `footer@en` inside an LTR page, and falls back to the
 * site menu when that row was never saved. The whole chrome — html, body,
 * header, logo, menu, footer, floats — reads with the page, both ways, even
 * when the stored direction disagrees. The language switch sits in the
 * header (zero JS) and the floating pill is hidden unless the theme asks
 * for it. Static export matches the live render.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-menu-lang-'));
const PORT = 3973;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { body, form, cookie } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'application/json', Origin: BASE };
    if (form != null) {
      data = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body != null) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (cookie) headers['Cookie'] = cookie;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (e) { /* text */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function waitUp(tries = 40) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      http.get(BASE + '/', () => resolve()).on('error', () => {
        if (n <= 0) return reject(new Error('server did not start'));
        setTimeout(() => tick(n - 1), 150);
      });
    };
    tick(tries);
  });
}

function navOf(h) {
  const i = h.indexOf('<nav class="main-nav"');
  return i < 0 ? '' : h.slice(i, h.indexOf('</nav>', i));
}
function headerOf(h) {
  const i = h.indexOf('<header');
  return i < 0 ? '' : h.slice(i, h.indexOf('</header>', i));
}
function footerOf(h) {
  const i = h.indexOf('<footer');
  return i < 0 ? '' : h.slice(i, h.indexOf('</footer>', i) + '</footer>'.length);
}
function stripEmbedded(h) {
  return String(h || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
}
function tagOf(h, re) {
  const m = String(h || '').match(re);
  return m ? m[0] : '';
}

require('../src/db');
const menus = require('../src/menus');
const theme = require('../src/theme');
const { renderPage, renderMenuItems } = require('../src/renderer');
const { createPage, linkTranslations, getPageByFullPath } = require('../src/pages');
const { loadConfig, saveConfig } = require('../src/config');
const { exportAll } = require('../src/export');
const { serializeMenus, parseMenusDoc } = require('../src/bentml/menu-dialect');
const siteLanguage = require('../src/site-language');
const { PUBLIC_DIR } = require('../src/paths');

(async () => {
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'אתר בדיקה', description: 'menu-lang smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const cfg = loadConfig();
  cfg.homepage = 'home';
  cfg.language = 'he';
  saveConfig(cfg);
  check('a language reads its own way: he/ar/fa/ur are rtl, en and every other language are ltr',
    siteLanguage.directionFor('he') === 'rtl' && siteLanguage.directionFor('ar') === 'rtl' &&
    siteLanguage.directionFor('fa') === 'rtl' && siteLanguage.directionFor('ur') === 'rtl' &&
    siteLanguage.directionFor('en') === 'ltr' && siteLanguage.directionFor('fr') === 'ltr' &&
    siteLanguage.directionFor('en-us') === 'ltr' && siteLanguage.directionFor('') === 'rtl');

  createPage({ title: 'Home', slug: 'home-en', direction: 'ltr', status: 'published', meta: { lang: 'en' }, blocks: [] });
  createPage({ title: 'צור קשר', slug: 'contact', direction: 'rtl', status: 'published', blocks: [] });
  linkTranslations('home', 'he', 'home-en', 'en');

  const bare = '<bent-menus version="1" note="n">\n  <bent-menu name="main" location="main">\n    <bent-link label="א" url="/" />\n  </bent-menu>\n</bent-menus>\n';
  const parsedBare = parseMenusDoc(bare);
  check('a menu document without lang omits the attribute and round-trips',
    parsedBare.lang === '' && serializeMenus(parsedBare) === serializeMenus(parseMenusDoc(serializeMenus(parsedBare))) &&
    serializeMenus(parsedBare).startsWith('<bent-menus version="1" note="n">'));
  const withLang = serializeMenus({ knobs: { placement: 'top' }, menus: { main: [{ label: 'Hi', type: 'custom', url: '/hi' }] }, locations: { main: 'main' }, note: 'n', lang: 'en' });
  check('lang is written after note and parsed back',
    withLang.startsWith('<bent-menus version="1" note="n" lang="en">') && parseMenusDoc(withLang).lang === 'en' && parseMenusDoc(withLang).menus.main.items[0].label === 'Hi');

  const siteMain = [{ label: 'ראשי', type: 'custom', url: '/home.html', children: [{ label: 'אודות', type: 'custom', url: '/about' }] }];
  const siteFooter = [{ label: 'תחתית', type: 'custom', url: '/home.html' }];
  menus.saveMenus({ main: siteMain, footer: siteFooter });
  const hePage = getPageByFullPath('home');
  const enPage = getPageByFullPath('home-en');
  const alone = renderPage(hePage);
  check('a site with only the unsuffixed menu renders that menu, dir=rtl, and the same list renderMenuItems builds',
    /dir="rtl"/.test(headerOf(alone)) && navOf(alone).includes('ראשי') && navOf(alone).includes(renderMenuItems(menus.getMenu('main'), '/home.html')) &&
    /<footer class="site-footer" dir="rtl">/.test(alone) &&
    /<nav class="footer-nav" aria-label="[^"]*"(?: dir="(?:ltr|rtl)")?>/.test(alone));

  menus.saveMenus({
    'main@en': [{ label: 'English', type: 'custom', url: '/home-en.html', children: [{ label: 'About', type: 'custom', url: '/about-en' }] }],
    'footer@en': [{ label: 'Footer EN', type: 'custom', url: '/home-en.html' }]
  });
  const he = renderPage(hePage);
  const en = renderPage(enPage);
  check('adding an English menu does not change the Hebrew page menu', navOf(he) === navOf(alone) && he.includes('תחתית') && !navOf(he).includes('English'));
  check('the English page renders the English menu in an LTR header and nav, with the submenu',
    /<header class="site-header[^"]*" dir="ltr"/.test(en) && /<nav class="main-nav" dir="ltr"/.test(en) &&
    navOf(en).includes('English') && navOf(en).includes('About') && navOf(en).includes('sub-menu') &&
    !navOf(en).includes('ראשי') && /<footer class="site-footer" dir="ltr">/.test(en) && en.includes('Footer EN'));
  const enHeader = headerOf(en);
  const enSwitch = enHeader.slice(enHeader.indexOf('<div class="header-lang">'), enHeader.indexOf('</div></div>') + '</div></div>'.length);
  check('paired pages carry one header language switch, zero JS, linking each sibling path',
    enSwitch.startsWith('<div class="header-lang"><div class="tapuz-lang-switch" dir="ltr">') &&
    headerOf(he).includes('<div class="tapuz-lang-switch" dir="rtl">') &&
    !enHeader.includes('<script') &&
    /href="\/home"/.test(enSwitch) && /href="\/home-en"/.test(enSwitch) &&
    !/\.html/.test(enSwitch) &&
    (en.match(/<div class="tapuz-lang-switch" dir="ltr">/g) || []).length === 1);
  const contact = renderPage(getPageByFullPath('contact'));
  check('an unlinked page has no language switch', !contact.includes('<div class="tapuz-lang-switch"'));

  menus.deleteMenu('main@en');
  const fallen = renderPage(enPage);
  check('an English page with no main@en falls back to the site menu and stays LTR',
    navOf(fallen).includes('ראשי') && !navOf(fallen).includes('>English<') &&
    /<header class="site-header[^"]*" dir="ltr"/.test(fallen) && /<nav class="main-nav" dir="ltr"/.test(fallen));
  check('the footer still uses footer@en, and deleting the language menu did not delete main',
    fallen.includes('Footer EN') && menus.getMenu('main')[0].label === 'ראשי' && !menus.menuExists('main@en'));
  menus.saveMenus({ 'main@en': [{ label: 'English', type: 'custom', url: '/home-en.html', children: [{ label: 'About', type: 'custom', url: '/about-en' }] }] });

  const snap = menus.backupMenus('smoke-lang');
  check('a menu backup counts the language menu', snap && snap.id && menus.listMenuBackups()[0].counts['main@en'] >= 1);
  menus.deleteMenu('main@en');
  menus.restoreMenuBackup(snap.id);
  check('restore puts the language menu back and leaves the site menu',
    menus.menuExists('main@en') && menus.getMenu('main@en')[0].label === 'English' && menus.getMenu('main')[0].label === 'ראשי');

  theme.saveOverrides(theme.mergeDeep(theme.loadOverrides(), { chrome: { langSwitch: 'float' } }));
  const floated = renderPage(enPage);
  check('float mode keeps the pill and hides the header switch',
    !headerOf(floated).includes('tapuz-lang-switch') && floated.includes('<div class="tapuz-lang-switch" dir="ltr">'));
  theme.saveOverrides(theme.mergeDeep(theme.loadOverrides(), { chrome: { langSwitch: 'header' } }));
  const headed = renderPage(enPage);
  check('header mode hides the pill', (headed.match(/<div class="tapuz-lang-switch" dir="ltr">/g) || []).length === 1 && headerOf(headed).includes('header-lang'));

  const placementBefore = theme.menuKnobs(theme.loadOverrides()).placement;
  const org = require('../src/menu-organizer');
  org.applyMenuPlan({
    menus: { main: { items: [{ label: 'From AI', type: 'custom', url: '/ai' }] } },
    knobs: { placement: 'side' }
  }, { lang: 'en', reason: 'smoke-menu-lang' });
  check('an English organizer apply writes main@en, not the site menu, and does not restyle the site',
    menus.getMenu('main')[0].label === 'ראשי' && menus.getMenu('main@en')[0].label === 'From AI' &&
    theme.menuKnobs(theme.loadOverrides()).placement === placementBefore);
  menus.saveMenus({ 'main@en': [{ label: 'English', type: 'custom', url: '/home-en.html', children: [{ label: 'About', type: 'custom', url: '/about-en' }] }] });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-menu-lang-out-'));
  exportAll(outDir);
  const expHe = fs.readFileSync(path.join(outDir, 'home.html'), 'utf8');
  const expEn = fs.readFileSync(path.join(outDir, 'home-en.html'), 'utf8');
  const liveHe = renderPage(getPageByFullPath('home'), { isHome: true });
  const liveEn = renderPage(getPageByFullPath('home-en'), { isHome: false });
  check('static export matches the live render for both languages',
    navOf(expHe) === navOf(liveHe) && navOf(expEn) === navOf(liveEn) &&
    headerOf(expHe).includes('dir="rtl"') && headerOf(expEn).includes('dir="ltr"') &&
    navOf(expHe).includes('ראשי') && navOf(expEn).includes('English') &&
    expEn.includes('href="/home"') && expHe.includes('href="/home-en"'));

  const css = fs.readFileSync(path.join(__dirname, '..', 'themes', 'default', 'css', 'main.css'), 'utf8');
  const shippedCss = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'main.css'), 'utf8');
  function logoCss(src) {
    return /\.header-inner \{[^}]*display: flex;\s*flex-direction: row/.test(src) &&
      !/\.header-inner \{[^}]*flex-direction:\s*row-reverse/.test(src) &&
      !/\.header-brand \{[^}]*float:\s*(left|right)/.test(src) &&
      !/\.site-logo \{[^}]*float:\s*(left|right)/.test(src) &&
      /\.main-nav ul \{[^}]*display: flex;\s*flex-direction: row/.test(src) &&
      /\.footer-inner \{[^}]*display: flex;\s*flex-direction: row/.test(src) &&
      /\.bent-header-inner \{[^}]*display: flex;\s*flex-direction: row/.test(src) &&
      /\.main-nav \.sub-menu \{[^}]*inset-inline-start: 0/.test(src) &&
      /\.main-nav \.sub-menu \.sub-menu \{[^}]*inset-inline-start: 100%/.test(src) &&
      /\.nav-burger \{[^}]*margin-inline-start: auto/.test(src) &&
      /html body\.nav-overlay \.nav-toggle:checked ~ ul \{[^}]*inset-inline-end: 0/.test(src) &&
      /@keyframes nav-overlay-in \{ from \{ inset-inline-end: -100%; \} to \{ inset-inline-end: 0; \} \}/.test(src) &&
      !/\[dir="rtl"\] body\.nav-overlay/.test(src) &&
      !/:has\(\.site-header\[dir/.test(src) &&
      /\.whatsapp-float\.pos-start \{[^}]*inset-inline-start:/.test(src) &&
      /\.header-lang \{[^}]*justify-content: end/.test(src) &&
      /\.header-lang \.tapuz-lang-switch \{[^}]*position: static/.test(src);
  }
  check('the logo sits at the inline start and the overlay slides from the inline end (source and shipped css)',
    logoCss(css) && logoCss(shippedCss));

  // Direction follows the page language even when the stored direction and
  // the site disagree. Nothing is rewritten in the database.
  const liveCfg = loadConfig();
  liveCfg.integrations.whatsapp = { enabled: true, phone: '972501234567', message: '', position: 'start' };
  liveCfg.integrations.search = { enabled: true };
  saveConfig(liveCfg);
  createPage({
    title: 'Americans', slug: 'americans', direction: 'rtl', status: 'published',
    meta: { lang: 'en' }, blocks: [{ type: 'text', id: 't', data: { content: 'Hello' } }]
  });
  createPage({
    title: 'עברית', slug: 'ivrit-page', direction: 'ltr', status: 'published',
    meta: { lang: 'he' }, blocks: [{ type: 'text', id: 't', data: { content: 'שלום' } }]
  });
  menus.saveMenus({
    'main@en': [
      { label: 'First', type: 'custom', url: '/americans.html' },
      { label: 'Second', type: 'custom', url: '/second' }
    ],
    'footer@en': [
      { label: 'Foot A', type: 'custom', url: '/americans.html' },
      { label: 'Foot B', type: 'custom', url: '/second' }
    ]
  });

  function assertReading(name, live, exported, spec) {
    const dir = spec.dir;
    const other = dir === 'ltr' ? 'rtl' : 'ltr';
    const liveClean = stripEmbedded(live);
    const expClean = stripEmbedded(exported);
    const header = headerOf(live);
    const nav = navOf(live);
    const footer = footerOf(live);
    check(name + ': html lang and dir',
      tagOf(live, /<html[^>]*>/).includes('lang="' + spec.lang + '"') &&
      tagOf(live, /<html[^>]*>/).includes('dir="' + dir + '"'));
    check(name + ': body, skip-link, header, nav and footer use the page dir',
      tagOf(live, /<body[^>]*>/).includes('dir="' + dir + '"') &&
      /<a class="skip-link"[^>]*dir="/.test(live) && tagOf(live, /<a class="skip-link"[^>]*>/).includes('dir="' + dir + '"') &&
      /<header class="site-header[^"]*" dir="/.test(header) && header.includes('dir="' + dir + '"') &&
      /<nav class="main-nav" dir="/.test(nav) && nav.includes('dir="' + dir + '"') &&
      /<footer class="site-footer"[^>]*dir="/.test(footer) && footer.includes('<footer class="site-footer" dir="' + dir + '">') &&
      /<nav class="footer-nav"[^>]*dir="/.test(footer) &&
      footer.includes('dir="' + dir + '"') && !footer.includes('dir="' + other + '"'));
    check(name + ': no opposite dir attribute left in the page',
      !liveClean.includes('dir="' + other + '"') && !expClean.includes('dir="' + other + '"'));
    check(name + ': built-in chrome strings are the page language',
      spec.present.every((s) => live.includes(s) && exported.includes(s)) &&
      spec.absent.every((s) => !liveClean.includes(s) && !expClean.includes(s)));
    const labels = spec.labels.map((label) => nav.indexOf('>' + label + '<'));
    const feet = spec.feet.map((label) => footer.indexOf('>' + label + '<'));
    check(name + ': menu item order matches that language',
      labels.every((p, i) => p >= 0 && (i === 0 || p > labels[i - 1])) &&
      feet.every((p, i) => p >= 0 && (i === 0 || p > feet[i - 1])));
    check(name + ': the logo is the inline-start item (brand before the nav)',
      header.indexOf('class="header-brand"') >= 0 &&
      header.indexOf('class="header-brand"') < header.indexOf('class="main-nav"'));
    check(name + ': whatsapp, search and the text block follow the page',
      live.includes('class="whatsapp-float pos-start" dir="' + dir + '"') &&
      /<div class="tapuz-search-float"[^>]*dir="/.test(live) &&
      tagOf(live, /<div class="tapuz-search-float"[^>]*>/).includes('dir="' + dir + '"') &&
      tagOf(live, /<div class="tapuz-search-panel"[^>]*>/).includes('dir="' + dir + '"') &&
      live.includes('<p dir="' + dir + '">' + spec.text + '</p>'));
    check(name + ': live render and static export are the same chrome',
      tagOf(live, /<html[^>]*>/) === tagOf(exported, /<html[^>]*>/) &&
      tagOf(live, /<body[^>]*>/) === tagOf(exported, /<body[^>]*>/) &&
      tagOf(live, /<a class="skip-link"[^>]*>[^<]*<\/a>/) === tagOf(exported, /<a class="skip-link"[^>]*>[^<]*<\/a>/) &&
      header === headerOf(exported) && nav === navOf(exported) && footer === footerOf(exported) &&
      tagOf(live, /<a class="whatsapp-float[^>]*>/) === tagOf(exported, /<a class="whatsapp-float[^>]*>/) &&
      tagOf(live, /<div class="tapuz-search-float"[^>]*>/) === tagOf(exported, /<div class="tapuz-search-float"[^>]*>/) &&
      tagOf(live, /<div class="tapuz-search-panel"[^>]*>/) === tagOf(exported, /<div class="tapuz-search-panel"[^>]*>/) &&
      tagOf(live, /<p dir="[^"]*">[^<]*<\/p>/) === tagOf(exported, /<p dir="[^"]*">[^<]*<\/p>/));
  }

  const enDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-menu-lang-en-'));
  exportAll(enDir);
  const americans = getPageByFullPath('americans');
  const liveEnPage = renderPage(americans, { isHome: false });
  const expEnPage = fs.readFileSync(path.join(enDir, 'americans.html'), 'utf8');
  check('the stored direction of the English page is still rtl (no migration)', americans.direction === 'rtl');
  assertReading('en page on a he site', liveEnPage, expEnPage, {
    lang: 'en', dir: 'ltr', text: 'Hello',
    labels: ['First', 'Second'], feet: ['Foot A', 'Foot B'],
    present: ['Skip to content', 'Main navigation', 'aria-label="Menu"', 'Footer navigation', 'Built with Tapuziel', 'Search this site'],
    absent: ['דלג לתוכן', 'ניווט ראשי', 'aria-label="תפריט"', 'ניווט תחתון', 'נבנה עם Tapuziel', 'חיפוש באתר']
  });

  const enSite = loadConfig();
  enSite.language = 'en';
  saveConfig(enSite);
  menus.saveMenus({
    'main@he': [
      { label: 'ראשון', type: 'custom', url: '/ivrit-page.html' },
      { label: 'שני', type: 'custom', url: '/sheni' }
    ],
    'footer@he': [
      { label: 'תחתית א', type: 'custom', url: '/ivrit-page.html' },
      { label: 'תחתית ב', type: 'custom', url: '/sheni' }
    ]
  });
  const heDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-menu-lang-he-'));
  exportAll(heDir);
  const ivrit = getPageByFullPath('ivrit-page');
  const liveHePage = renderPage(ivrit, { isHome: false });
  const expHePage = fs.readFileSync(path.join(heDir, 'ivrit-page.html'), 'utf8');
  check('the stored direction of the Hebrew page is still ltr (no migration)', ivrit.direction === 'ltr');
  assertReading('he page on an en site', liveHePage, expHePage, {
    lang: 'he', dir: 'rtl', text: 'שלום',
    labels: ['ראשון', 'שני'], feet: ['תחתית א', 'תחתית ב'],
    present: ['דלג לתוכן', 'ניווט ראשי', 'aria-label="תפריט"', 'ניווט תחתון', 'נבנה עם Tapuziel', 'חיפוש באתר'],
    absent: ['Skip to content', 'Main navigation', 'aria-label="Menu"', 'Footer navigation', 'Built with Tapuziel', 'Search this site']
  });

  const restored = loadConfig();
  restored.language = 'he';
  restored.integrations.whatsapp.enabled = false;
  restored.integrations.search.enabled = false;
  saveConfig(restored);
  exportAll();

  const { createAdmin } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    const page = await req('GET', '/admin/menus', { cookie });
    check('the menus page has a language selector', page.status === 200 && page.text.includes('id="menu-lang"'));

    const siteBefore = await req('GET', '/admin/api/menus', { cookie });
    const saved = await req('POST', '/admin/api/menus', {
      cookie,
      body: { lang: 'en', menus: { main: [{ label: 'Hello', type: 'custom', url: '/hello' }], footer: [{ label: 'Foot', type: 'custom', url: '/foot' }] } }
    });
    check('POST /admin/api/menus {lang:en} saves the English menu',
      saved.status === 200 && saved.json.ok && saved.json.menus.main[0].label === 'Hello' && saved.json.inherited.main === false);
    const siteAfter = await req('GET', '/admin/api/menus', { cookie });
    check('saving English does not change the site menu',
      siteAfter.json.menus.main[0].label === siteBefore.json.menus.main[0].label && !siteAfter.json.menus['main@en']);
    const loaded = await req('GET', '/admin/api/menus?lang=en', { cookie });
    check('GET ?lang=en loads the English menu', loaded.status === 200 && loaded.json.menus.main[0].label === 'Hello' && loaded.json.lang === 'en');

    const kept = await req('POST', '/admin/api/menus', {
      cookie,
      body: { lang: 'he', menus: { main: siteAfter.json.menus.main, footer: siteAfter.json.menus.footer }, locations: siteAfter.json.locations }
    });
    check('a site-language save does not delete the English menu',
      kept.status === 200 && (await req('GET', '/admin/api/menus?lang=en', { cookie })).json.menus.main[0].label === 'Hello');

    const bentEn = await req('GET', '/admin/api/menus/export.bent?lang=en', { cookie });
    const bentSite = await req('GET', '/admin/api/menus/export.bent', { cookie });
    check('export.bent?lang=en is a language document with base names',
      bentEn.status === 200 && bentEn.text.startsWith('<bent-menus version="1" lang="en">') &&
      bentEn.text.includes('name="main"') && bentEn.text.includes('Hello') && !bentEn.text.includes('main@en'));
    check('export.bent without lang stays the unsuffixed document',
      /^<bent-menus version="1">\n  <bent-menu-layout placement="top"/.test(bentSite.text) &&
      !/ lang=/.test(bentSite.text) && !bentSite.text.includes('main@en') && !bentSite.text.includes('Hello'));

    const round = bentEn.text.replace('Hello', 'Howdy');
    const imported = await req('POST', '/admin/api/menus', { cookie, body: { bent: round, lang: 'en' } });
    const afterImport = await req('GET', '/admin/api/menus?lang=en', { cookie });
    const siteStill = await req('GET', '/admin/api/menus', { cookie });
    check('.bent import per language round-trips and does not clobber the site menu',
      imported.status === 200 && afterImport.json.menus.main[0].label === 'Howdy' &&
      siteStill.json.menus.main[0].label === siteBefore.json.menus.main[0].label);
    const empty = await req('POST', '/admin/api/menus', { cookie, body: { bent: 'no menus here', lang: 'en' } });
    check('a bent import with no menu document is refused', empty.status === 400 && /לא נמצא מסמך תפריטים/.test(empty.json.error || ''));

    const removed = await req('POST', '/admin/api/menus/' + encodeURIComponent('main@en') + '/delete', { cookie });
    const afterDelete = await req('GET', '/admin/api/menus?lang=en', { cookie });
    check('deleting main@en restores the fallback and keeps the site menu',
      removed.status === 200 && afterDelete.json.inherited.main === true &&
      afterDelete.json.menus.main[0].label === siteBefore.json.menus.main[0].label &&
      (await req('GET', '/admin/api/menus', { cookie })).json.menus.main[0].label === siteBefore.json.menus.main[0].label);

    const preview = await req('GET', '/admin/menus/preview/live?lang=en', { cookie });
    check('the organizer preview for en follows the page direction',
      preview.status === 200 && /<header class="site-header[^"]*" dir="ltr"/.test(preview.text));
  } catch (e) {
    check('menu-lang http (' + (e && e.message) + ')', false);
  } finally {
    child.kill('SIGTERM');
  }

  if (fail) process.exit(1);
  console.log('menu-lang smoke passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
