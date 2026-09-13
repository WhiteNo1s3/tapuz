'use strict';

/**
 * v2.29 QA — the theme stays on the site; the management system stays itself.
 *
 * Ben: "make the effects and fonts not interfere with the management system
 * … the theme leaked into the admin". On the live site the admin shell linked
 * the site's /css/main.css, so the owner's theme effect (`html { cursor: none }`,
 * a black `body … !important`, a fixed film-grain `body::before`), its base
 * size and its heading font dressed every admin screen; v2.27's
 * admin-theme.css still carried the base size, the fonts and the palette.
 *
 * This smoke installs a deliberately loud theme — a web font, a 21px base,
 * an Impact heading, a skin on h1/.btn/.card, an effect that hides the cursor
 * and paints an overlay, an effect script — then walks EVERY admin screen in
 * the sidebar (plus the builder, the studio, new-page and the login screen)
 * and pins:
 *   1. each screen links /css/admin.css and no other stylesheet; no web fonts,
 *      no effect script, no theme css inline
 *   2. admin.css reads no theme variable and carries none of the theme's values
 *   3. the site keeps all of it (the served page and the export)
 *   4. the preview frames — where the admin SHOWS the site — keep the theme and
 *      run the effect in the guard that keeps it off the framing admin page
 *   5. the export no longer writes admin-theme.css and removes a stale one
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-admin-isolation-'));
process.env.TAPUZ_ROOT = ROOT;
const PORT = 3981;
const BASE = 'http://127.0.0.1:' + PORT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

// the loud theme — every value below is a sentinel that must never reach an admin screen
const LOUD = {
  colors: { primary: '#e11d48', secondary: '#fbbf24', text: '#fef3c7', bg: '#050202', lightBg: '#140608', surface: '#1a0808', border: '#7f1d1d', muted: '#a8a29e' },
  fonts: { family: '"Frank Ruhl Libre", serif', headingFamily: '"Impact", "Arial Black", sans-serif', baseSize: '21px', google: ['Frank Ruhl Libre'] },
  skin: { css: 'h1, h2, h3 { text-transform: uppercase; letter-spacing: .31em; }\n.btn, .card { outline: 7px dashed #e11d48; }', note: 'loud skin' },
  effects: {
    css: 'html { cursor: none; }\nbody { background-color: #050202 !important; }\nbody::before { content: ""; position: fixed; inset: 0; z-index: 9997; pointer-events: none; }',
    js: '(function () { var d = document.createElement("div"); d.className = "tz-loud-fx"; document.body.appendChild(d); })();',
    note: 'loud effect'
  }
};
const SENTINELS = [/cursor:\s*none/, /21px/, /Frank Ruhl/, /Impact/, /9997/, /#e11d48/i, /#050202/, /\.31em/, /7px dashed/, /tz-loud-fx/, /tapuz-theme-effects/, /fonts\.googleapis\.com/];

function req(method, urlPath, { form, cookie } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Origin: BASE };
    if (form != null) { data = new URLSearchParams(form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    if (cookie) headers['Cookie'] = cookie;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: buf }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function waitUp(tries = 60) {
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

/** What an admin HTML document pulls in: stylesheets, inline css, scripts. */
function shellOf(html) {
  const head = html;
  return {
    sheets: [...head.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/gi)].map((m) => (m[0].match(/href="([^"]*)"/) || [])[1]),
    styles: [...head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n'),
    fontLinks: /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(head),
    effect: /tapuz-theme-effects/.test(head)
  };
}

(async () => {
  require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'בידוד', description: 'admin-isolation smoke',
    colors: { primary: '#0a66c2', bg: '#ffffff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home', 'about'], menuPages: ['home', 'about'], external: []
  });
  const theme = require('../src/theme');
  theme.saveOverrides(theme.mergeDeep(theme.loadOverrides(), LOUD));
  const { createAdmin } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');
  // a build from v2.27 left the admin's copy behind; this deploy's boot must rebuild
  fs.mkdirSync(path.join(ROOT, 'public', 'css'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'public', 'css', 'admin-theme.css'), ':root { --color-primary: #e11d48; } html { font-size: 21px; }');
  fs.rmSync(path.join(ROOT, 'public', '.built-by'), { force: true });

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();

    // ── 1. every admin screen: admin.css, and nothing of the theme ──────
    const loginScreen = await req('GET', '/admin/login');
    const ls = shellOf(loginScreen.text);
    check('the login screen (logged out) links /css/admin.css only — no theme stylesheet, font or effect',
      loginScreen.status === 200 && JSON.stringify(ls.sheets) === '["/css/admin.css"]' && !ls.fontLinks && !ls.effect && !SENTINELS.some((re) => re.test(ls.styles)));

    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];
    check('logged in', /tapuz_sess=/.test(cookie));

    const { ADMIN_NAV_GROUPS } = require('../src/admin-ui');
    const screens = ADMIN_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)).filter((h) => !/\.csv/.test(h));
    screens.push('/admin/edit/home', '/admin/theme', '/admin/new', '/admin/menus');
    const leaks = [];
    let seen = 0;
    for (const href of [...new Set(screens)]) {
      const r = await req('GET', href, { cookie });
      if (r.status !== 200 || !/^<!DOCTYPE html>/i.test(r.text.trim())) continue;
      seen++;
      const s = shellOf(r.text);
      const why = [];
      if (JSON.stringify(s.sheets) !== '["/css/admin.css"]') why.push('stylesheets ' + JSON.stringify(s.sheets));
      if (s.fontLinks) why.push('web font link');
      if (s.effect) why.push('effect script');
      const inline = SENTINELS.filter((re) => re.test(s.styles));
      if (inline.length) why.push('inline theme css ' + inline.join(' '));
      if (why.length) leaks.push(href + ': ' + why.join(', '));
    }
    check(`every admin screen (${seen} of them, the builder and the studio included) links /css/admin.css alone — no main.css, no admin-theme.css, no web fonts, no effect` +
      (leaks.length ? '\n     ' + leaks.join('\n     ') : ''), seen >= 20 && leaks.length === 0);

    // ── 2. admin.css is the admin's own ─────────────────────────────────
    const adminCss = await req('GET', '/css/admin.css');
    check('admin.css reads no theme variable (--color-* / --font-* / --radius-* / --accent-bg / --max-width)',
      adminCss.status === 200 && !/var\(--(color-|font-family|font-heading|radius-(sm|md|lg|pill)|accent-bg|max-width)/.test(adminCss.text));
    check('admin.css carries its own baseline — the 17px / 1.7 root it used to borrow from the site',
      /html \{ font-size: 17px; line-height: 1\.7;/.test(adminCss.text) && /\.btn \{ display: inline-block;/.test(adminCss.text));
    const oldCopy = await req('GET', '/css/admin-theme.css');
    check('the export removed the stale admin-theme.css (boot rebuild), and nothing serves it', oldCopy.status === 404 && !fs.existsSync(path.join(ROOT, 'public', 'css', 'admin-theme.css')));

    // ── 3. the site keeps every bit of the theme ────────────────────────
    const site = await req('GET', '/');
    const mainCss = fs.readFileSync(path.join(ROOT, 'public', 'css', 'main.css'), 'utf8');
    check('the site still carries the whole theme: web fonts and the guarded effect on the page, skin + effect css in main.css',
      /fonts\.googleapis\.com\/css2/.test(site.text) && /tapuz-theme-effects/.test(site.text) && /tz-loud-fx/.test(site.text) &&
      /7px dashed #e11d48/.test(mainCss) && /cursor: none/.test(mainCss) && /font-size: 21px/.test(mainCss));

    // ── 4. the preview frames show the site — in the theme, guarded ─────
    const studioFrame = await req('GET', '/admin/theme/preview/live?canvas=1', { cookie });
    const draftFrame = await req('GET', '/admin/preview/home', { cookie });
    check('the studio canvas and the builder device preview (frames) DO render the site in the theme, effect included',
      studioFrame.status === 200 && /tapuz-theme-effects/.test(studioFrame.text) && /7px dashed/.test(studioFrame.text) &&
      draftFrame.status === 200 && /tapuz-theme-effects/.test(draftFrame.text));
    check('…and the effect runs with parent / top shadowed, so a framed effect cannot reach the admin page around it',
      /setInterval, parent, top, opener, frameElement\) \{/.test(studioFrame.text) && /gInterval, winP, winP, null, null\);/.test(studioFrame.text));

    // ── 5. the export itself ────────────────────────────────────────────
    fs.writeFileSync(path.join(ROOT, 'public', 'css', 'admin-theme.css'), '/* stale */');
    require('../src/export').exportAll();
    check('exportAll writes main.css and removes a stale admin-theme.css', fs.existsSync(path.join(ROOT, 'public', 'css', 'main.css')) && !fs.existsSync(path.join(ROOT, 'public', 'css', 'admin-theme.css')));
  } catch (e) {
    check('smoke ran without throwing: ' + e.message, false);
  } finally {
    child.kill();
  }

  console.log(fail ? '\n❌ smoke-admin-isolation: FAILED' : '\n✅ smoke-admin-isolation: all checks passed');
  process.exit(fail ? 1 : 0);
})();
