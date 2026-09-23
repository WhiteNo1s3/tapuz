'use strict';

/**
 * v2.58 QA — an English site IS English: LTR by default, English chrome,
 * an English copilot; a Hebrew site does not move by a byte.
 *
 * Ben (2026-09-23), on the new English site rendering right-to-left with
 * Hebrew words in its header: "lets make it not rtl automatically when it
 * selects english, we can do rtl jobs in english interface, we can also do
 * the same with hebrew to english — I think it's fair to assume our system
 * will handle this."
 *
 * What was wrong: every new page was born `rtl` (pages.createPage, the
 * builder's create route), a BenTML document with no `dir` compiled to `rtl`
 * (tapuz-json, pzn-source), the exported <html> followed the PAGE only and
 * so said `he`/`rtl` whatever the settings said, the layout's own words —
 * the skip link, the menu's aria labels, the credit line, a contact card's
 * labels, the search box — were Hebrew, and the copilot's briefing told
 * every model "Hebrew and RTL by default", so an English site got Hebrew
 * pages from its own assistant.
 *
 * Pinned here (src/site-language.js):
 *   1. a Hebrew site (the default) renders exactly as before — he/rtl, the
 *      Hebrew chrome, and the copilot's Hebrew default line
 *   2. flip the site to English: a new page is born ltr; a document with no
 *      direction lands ltr/en; the export says lang="en" dir="ltr" with
 *      English chrome and no Hebrew word of the layout's; og:locale en_US
 *   3. a page that SAYS dir="rtl" on the English site keeps it, with
 *      lang="he" and Hebrew chrome words — "we can do rtl jobs" either way
 *   4. the modules' own words follow the page: Phone/Email on an ltr page
 *   5. the copilot briefing on an English site names the site's language,
 *      shows an English example document, and drops the Hebrew default
 *   6. the settings screen's language switch rebuilds the live export
 *      (the words of every page's chrome moved) — over HTTP, the real route
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-site-language-'));
process.env.TAPUZ_ROOT = ROOT;
const PORT = 3956;
const BASE = 'http://127.0.0.1:' + PORT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

require('../src/db');
const { runSetup } = require('../src/setup');
runSetup({ title: 'Night City', description: 'a test site', colors: { primary: '#7c3aed', bg: '#0b0a10', lightBg: '#16131f', text: '#f4efff' }, menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: [] });
require('../src/auth').createAdmin('owner', 'owner-pass-1');

const config = require('../src/config');
const pages = require('../src/pages');
const { exportAll } = require('../src/export');
const { PUBLIC_DIR } = require('../src/paths');
const lang = require('../src/site-language');
const { renderBlock, renderSearchWidget } = require('../src/renderer');
const { buildCopilotBriefing } = require('../src/pzn/agent-roleplay');

const read = (f) => fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
const HEBREW_CHROME = /דלג לתוכן|ניווט ראשי|aria-label="תפריט"|ניווט תחתון|נבנה עם Tapuziel/;
const ENGLISH_CHROME = /Skip to content|Main navigation|aria-label="Menu"|Footer navigation|Built with Tapuziel/;
const noDirDoc = (title, slug, body) => '<!DOCTYPE html>\n<html bent-version="0.1">\n<head><meta charset="utf-8"/><title>' + title + '</title><meta name="bent-slug" content="' + slug + '"/></head>\n<body>\n' + body + '\n</body></html>';

// ── 1. the Hebrew site: nothing moved ──
check('a fresh site is Hebrew: siteLanguage he, siteDirection rtl', lang.siteLanguage() === 'he' && lang.siteDirection() === 'rtl');
exportAll();
const heHome = read('index.html');
check('1. the Hebrew site exports lang="he" dir="rtl" with its Hebrew chrome (skip link, nav labels, credit) and og:locale he_IL',
  /<html lang="he" dir="rtl">/.test(heHome) && HEBREW_CHROME.test(heHome) && /דלג לתוכן/.test(heHome) && /aria-label="ניווט ראשי"/.test(heHome) && /נבנה עם Tapuziel/.test(heHome) && /og:locale" content="he_IL"/.test(heHome));
check('1. no placeholder leaks into the page ({{t.…}})', !/\{\{t\./.test(heHome));
pages.createPage({ title: 'עמוד', slug: 'he-page', blocks: [] });
check('1. a page created on the Hebrew site is born rtl', pages.getPageByFullPath('he-page').direction === 'rtl');
pages.savePageSource('he-page', noDirDoc('עמוד', 'he-page', '  <bent-text id="t">שלום</bent-text>'), { publish: true });
check('1. a document with no direction lands rtl on the Hebrew site', pages.getPageByFullPath('he-page').direction === 'rtl');
const heBrief = buildCopilotBriefing({ locale: 'he', tier: 'full', siteLanguage: 'he' }).text;
check('1. the Hebrew site\'s briefing keeps "עברית ו‑RTL כברירת מחדל" and the Hebrew example document', /עברית ו‑RTL כברירת מחדל/.test(heBrief) && /<html lang="he" dir="rtl" bent-version="0.1">/.test(heBrief) && !/האתר הזה באנגלית/.test(heBrief));
const noOpt = buildCopilotBriefing({ locale: 'he', tier: 'full' });
check('1. a briefing with no siteLanguage given is the Hebrew one (every existing caller)', noOpt.siteLanguage === 'he' && /עברית ו‑RTL כברירת מחדל/.test(noOpt.text) && !/האתר הזה באנגלית/.test(noOpt.text));
check('1. modules on an rtl page speak Hebrew (contact labels)', /טלפון/.test(renderBlock({ type: 'contact-info', data: { phone: '03-5550101' } }, 'rtl')));

// ── 2. flip to English ──
const cfg = config.loadConfig();
cfg.language = 'en';
config.saveConfig(cfg);
// the switch turns the site around: the home page was born rtl on the Hebrew site
const flippedPaths = pages.flipSiteDirection('rtl', 'ltr');
check('2. flipping the site flips the pages that read the old way (home, he-page)', flippedPaths.includes('home') && flippedPaths.includes('he-page') && pages.getPageByFullPath('home').direction === 'ltr');
check('2. …and the flipped page\'s canonical source carries the new head', /<html lang="en" dir="ltr"/.test(pages.getPageSource('he-page', 'draft') || ''));
check('2. siteLanguage en → siteDirection ltr; languageFor(ltr) en, languageFor(rtl) he', lang.siteLanguage() === 'en' && lang.siteDirection() === 'ltr' && lang.languageFor('ltr') === 'en' && lang.languageFor('rtl') === 'he');
pages.createPage({ title: 'About', slug: 'about', blocks: [] });
check('2. a page created on the English site is born ltr (createPage default)', pages.getPageByFullPath('about').direction === 'ltr');
pages.savePageSource('about', noDirDoc('About', 'about', '  <bent-heading id="h" level="1">About us</bent-heading>\n  <bent-contact-info id="c" phone="03-5550101" email="hi@night.city" />'), { publish: true });
check('2. a document with no direction lands ltr on the English site', pages.getPageByFullPath('about').direction === 'ltr');
// the other compilers: a keyword document, and the JSON bridge itself
const { pznSourceToBlocks } = require('../src/pzn-source');
const kw = pznSourceToBlocks('BENTML 0.1\nMETA { title: "Kw" }\nTEXT { hello }\n');
check('2. a keyword document that never said its direction compiles ltr/en on the English site', kw.view.direction === 'ltr' && kw.doc.dir === 'ltr' && kw.doc.lang === 'en');
const kwRtl = pznSourceToBlocks('BENTML 0.1\nMETA {\n  title: "Kw"\n  direction: rtl\n}\nTEXT { שלום }\n');
check('2. …and one that SAID rtl keeps rtl/he', kwRtl.view.direction === 'rtl' && kwRtl.doc.lang === 'he');
const tj = require('../src/pzn/bridge/tapuz-json');
check('2. the JSON bridge gives a page with no direction the site\'s (ltr/en)', tj.toTapuzPage(tj.fromTapuzPage({ title: 'x', slug: 'x', blocks: [] })).direction === 'ltr');
exportAll();
const enHome = read('index.html');
const enAbout = read('about.html');
check('2. the export says lang="en" dir="ltr" on the home page and the new page', /<html lang="en" dir="ltr">/.test(enHome) && /<html lang="en" dir="ltr">/.test(enAbout));
check('2. the chrome speaks English: skip link, nav labels, the credit — and no Hebrew word of the layout\'s', ENGLISH_CHROME.test(enAbout) && /Skip to content/.test(enAbout) && /aria-label="Main navigation"/.test(enAbout) && /aria-label="Menu"/.test(enAbout) && /Built with Tapuziel/.test(enAbout) && !HEBREW_CHROME.test(enAbout));
check('2. og:locale en_US', /og:locale" content="en_US"/.test(enAbout));
check('2. no placeholder leaks into the page ({{t.…}})', !/\{\{t\./.test(enAbout) && !/\{\{t\./.test(enHome));

// ── 3. an RTL page on the English site keeps its way ──
pages.createPage({ title: 'עברית', slug: 'ivrit', blocks: [], meta: { lang: 'he' } });
pages.savePageSource('ivrit', '<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n<head><meta charset="utf-8"/><title>עברית</title><meta name="bent-slug" content="ivrit"/></head>\n<body>\n  <bent-text id="t">דף בעברית באתר אנגלי</bent-text>\n</body></html>', { publish: true });
check('3. a page that says dir="rtl" keeps it on the English site', pages.getPageByFullPath('ivrit').direction === 'rtl');
exportAll();
const enIvrit = read('ivrit.html');
check('3. …and exports as lang="he" dir="rtl" with the Hebrew chrome words — the page\'s language, not the site\'s', /<html lang="he" dir="rtl">/.test(enIvrit) && /דלג לתוכן/.test(enIvrit) && !/Skip to content/.test(enIvrit));
check('3. the English pages beside it are still English', /<html lang="en" dir="ltr">/.test(read('about.html')));

// ── 4. the modules' own words ──
check('4. a contact card on an ltr page says Phone / Email', /Phone/.test(enAbout) && /Email/.test(enAbout) && !/טלפון/.test(enAbout));
check('4. the search box speaks the page\'s language', /Search this site/.test(renderSearchWidget({ integrations: { search: { enabled: true } } }, 'en')) && /חיפוש באתר/.test(renderSearchWidget({ integrations: { search: { enabled: true } } }, 'he')));
const { renderConsent } = require('../src/crm/consent');
const consentEn = renderConsent({ crm: { enabled: true, pixels: { enabled: true, requireConsent: true, banner: true, meta: { pixelId: '1' } } } });
check('4. the consent bar\'s default words follow the site language (Accept / Decline)', !consentEn || (/Accept/.test(consentEn) && !/אישור/.test(consentEn)));

// ── 5. the copilot knows which site it drives ──
const enBrief = buildCopilotBriefing({ locale: 'he', tier: 'full', siteLanguage: 'en' });
check('5. the Hebrew-language briefing for an English site says so, shows an English example, and drops the Hebrew default',
  enBrief.siteLanguage === 'en' && /האתר הזה באנגלית, LTR/.test(enBrief.text) && /<html lang="en" dir="ltr" bent-version="0.1">/.test(enBrief.text) && /Studio Light/.test(enBrief.text) && !/עברית ו‑RTL כברירת מחדל/.test(enBrief.text));
check('5. …and asks for English answers to the owner', /ענה\/י באנגלית/.test(enBrief.text));
const enBriefEn = buildCopilotBriefing({ locale: 'en', tier: 'full', siteLanguage: 'en' }).text;
check('5. the English-language briefing says "This site is English, LTR" and not "Hebrew and RTL by default"', /This site is English, LTR/.test(enBriefEn) && !/Hebrew and RTL by default/.test(enBriefEn));
check('5. the compact tier carries the same site line', /האתר הזה באנגלית, LTR/.test(buildCopilotBriefing({ locale: 'he', tier: 'compact', siteLanguage: 'en' }).text));

// ── 6. the switch on the settings screen rebuilds the live export ──
function req(method, urlPath, { form, json, cookie } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'application/json', Origin: BASE };
    if (form) { data = new URLSearchParams(form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    else if (json) { data = JSON.stringify(json); headers['Content-Type'] = 'application/json'; }
    if (cookie) headers.Cookie = cookie;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch (e) { /* html */ } resolve({ status: res.statusCode, headers: res.headers, json: j, text: buf }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function waitUp(tries = 50) {
  return new Promise((resolve, reject) => {
    const tick = (n) => http.get(BASE + '/', (res) => { res.resume(); resolve(); }).on('error', () => (n <= 0 ? reject(new Error('server did not start')) : setTimeout(() => tick(n - 1), 200)));
    tick(tries);
  });
}
(async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) }, stdio: 'ignore' });
  try {
    await waitUp();
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];
    const toHe = await req('POST', '/admin/api/settings', { cookie, json: { language: 'he' } });
    check('6. POST /admin/api/settings language=he answers ok', toHe.status === 200 && toHe.json && toHe.json.ok === true);
    check('6. …and the live export is Hebrew again at once (dir="rtl", Hebrew chrome) — the pages turned around with the site', /<html lang="he" dir="rtl">/.test(read('index.html')) && /דלג לתוכן/.test(read('index.html')) && Array.isArray(toHe.json.flipped) && toHe.json.flipped.includes('about'));
    check('6. a page that declares its own language (meta.lang, a paired translation) is not turned around', pages.getPageByFullPath('ivrit').direction === 'rtl');
    const toEn = await req('POST', '/admin/api/settings', { cookie, json: { language: 'en' } });
    check('6. POST language=en answers ok and the export is English again (dir="ltr", English chrome)', toEn.status === 200 && /<html lang="en" dir="ltr">/.test(read('index.html')) && /Skip to content/.test(read('index.html')));
    const live = await req('GET', '/about');
    check('6. the served page (express.static, the live door) carries the English chrome', live.status === 200 && /Skip to content/.test(live.text) && /dir="ltr"/.test(live.text));
  } catch (e) {
    check('6. the server scenario ran (' + e.message + ')', false);
  } finally {
    child.kill();
    try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* windows */ }
  }
  console.log('');
  console.log(fail ? 'SMOKE SITE-LANGUAGE: FAIL' : 'SMOKE SITE-LANGUAGE: PASS');
  process.exit(fail ? 1 : 0);
})();
