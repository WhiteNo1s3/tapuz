'use strict';

/**
 * v1.62/63 QA — client navigation swaps content, keeps the shell.
 *
 * The failure this guards: a sidebar click used to reload the whole document,
 * tearing down and rebuilding the fixed rail identically — the "jump" Ben saw.
 * admin-nav.js swaps only #admin-main. The risks that come with that are all
 * checked here: the <main> wrapper must stay BALANCED (an unclosed tag on a
 * bare page would corrupt the login screen), the builder must stay OUT of
 * scope (it has no sidebar and must full-navigate), and any script that binds
 * a document-level listener must survive re-execution without stacking a
 * second one (the v1.50 "two pickers" bug, re-armed by navigation).
 *
 * v1.63 widened the swap from the sidebar to EVERY in-shell anchor. That makes
 * one function — swappableUrl() — the load-bearing judge of "screen we can swap"
 * vs "must leave the shell" (download, API endpoint, the shell-less builder).
 * So here we don't just regex it: we LOAD admin-nav.js against a stubbed global
 * and run swappableUrl over a battery of real routes. A wrong answer there is
 * the difference between a smooth swap and a wasted fetch (or a broken click).
 */

const fs = require('fs');
const path = require('path');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

const root = path.join(__dirname, '..');
const { layout, adminNav } = require(path.join(root, 'src', 'admin-ui'));
const nav = fs.readFileSync(path.join(root, 'public', 'admin-nav.js'), 'utf8');
const picker = fs.readFileSync(path.join(root, 'public', 'admin-media-picker.js'), 'utf8');
const inbox = fs.readFileSync(path.join(root, 'src', 'routes', 'inbox.js'), 'utf8');

// ── the shell wrapper is balanced, and only where a sidebar exists ─────────
const page = layout(adminNav('pages', 'דפים', '<a class="btn">+ דף</a>') +
  '<div class="container page-body">content</div>', 'דפים', '#2563eb');
check('adminNav opens a #admin-main swap target',
  /<main id="admin-main"[^>]*data-admin-main/.test(page));
check('layout closes exactly one <main> for a sidebar page',
  (page.match(/<main /g) || []).length === 1 && (page.match(/<\/main>/g) || []).length === 1);
check('the shell (sidebar + topbar) sits OUTSIDE #admin-main',
  page.indexOf('admin-side') < page.indexOf('id="admin-main"') &&
  page.indexOf('class="topbar"') < page.indexOf('id="admin-main"'));
check('the per-screen actions get a replaceable .topbar-actions wrapper',
  /<span class="topbar-actions"><a class="btn">\+ דף<\/a><\/span>/.test(page));
check('a sidebar page loads the navigation layer', page.includes('/admin-nav.js'));

const bare = layout('<div>login</div>', 'כניסה', '#f97316', { bare: true });
check('a BARE page (auth) opens no <main> and loads no nav layer',
  !bare.includes('<main') && !bare.includes('admin-nav.js'));

// a non-adminNav, non-bare page (builder / wizard shape) must also stay clean:
// no sentinel → no stray </main>, no nav layer
const builderish = layout('<div class="builder live-page">no sidebar here</div>',
  'עריכה', '#f97316', { bodyClass: 'builder-screen' });
check('a page without adminNav gets no stray </main> and no nav layer',
  !builderish.includes('</main>') && !builderish.includes('admin-nav.js'));

// ── the navigation layer's safety rules (structure) ────────────────────────
check('nav guards against its own re-execution during a swap',
  /window\.__tapuzNavInit/.test(nav));
check('nav no-ops when there is no #admin-main (not a sidebar screen)',
  /getElementById\('admin-main'\)/.test(nav) && /if \(!main\) return/.test(nav));
check('modified clicks (new-tab/download/middle) fall through to the browser',
  /metaKey|ctrlKey/.test(nav) && /button !== 0/.test(nav) && /'_blank'/.test(nav) &&
  /hasAttribute\('download'\)/.test(nav));
check('a fetched page with no #admin-main hands off to a full navigation',
  /if \(!data\)\s*{\s*location\.href/.test(nav));
check('any fetch failure falls back to a full navigation',
  /\.catch\(function \(\) { location\.href/.test(nav));
check('swapped scripts are re-created so they actually execute',
  /createElement\('script'\)/.test(nav) && /replaceChild/.test(nav));
check('src scripts are kept synchronous so a data script wins the race',
  /\.async = false/.test(nav));
check('the accent, title, section and active state all update on swap',
  /--admin-accent/.test(nav) && /document\.title =/.test(nav) &&
  /section-title/.test(nav) && /setActive/.test(nav));
check('back/forward is handled via popstate',
  /addEventListener\('popstate'/.test(nav));
check('the builder body class is never carried into a swap',
  /!== 'builder-screen'/.test(nav));

// ── v1.63: the swap reaches in-content links, gated by swappableUrl ─────────
check('the click listener is widened from the sidebar to every anchor',
  /closest\('a'\)/.test(nav) && !/closest\('\.admin-side a/.test(nav));
check('an explicit data-nav-full opt-out leaves the shell',
  /closest\('\[data-nav-full\]'\)/.test(nav));
check('server redirects are followed into the address bar',
  /r\.url \|\| full/.test(nav) && /res\.landed/.test(nav));
check('a programmatic nav hook (TapuzNav) is exposed for non-anchor navigations',
  /window\.TapuzNav = /.test(nav) && /navigate:/.test(nav));
check('the inbox status filter routes through TapuzNav (with a full-nav fallback)',
  /window\.TapuzNav\?TapuzNav\.navigate\(u\):location\.href=u/.test(inbox));

// ── v1.63: swappableUrl BEHAVIOUR — load the module, run the real routing ──
// Stub just enough global for the IIFE to install without a DOM: a truthy
// #admin-main so it doesn't early-return, no-op listeners, and a location it
// treats as same-origin. URL is native in Node; DOMParser is only touched on a
// real fetch, never at load.
//
// v2.69 widens the stub just enough to DRIVE a swap end to end (further down):
// a sidebar of three links, a topbar of a known height, a fake fetch and a fake
// DOMParser. Everything the swappableUrl battery needs is unchanged.
const O = 'http://localhost:3000';
const seen = { fetched: [], pushed: [], scrolled: [] };
const sideLinks = ['/admin/dashboard', '/admin/store/products', '/admin/store/settings'].map((href) => ({
  href: O + href,
  active: false,
  classList: { toggle(cls, on) { if (cls === 'active') this.owner.active = !!on; } }
}));
sideLinks.forEach((l) => { l.classList.owner = l; });
const mainStub = {
  innerHTML: '', style: {}, offsetWidth: 0,
  querySelectorAll() { return []; }
};
const parts = {};   // id → element of the "page", for the #fragment landing
const onWindow = {};   // the window listeners the file registers, by event
global.window = {
  addEventListener: function (type, fn) { onWindow[type] = fn; },
  pageYOffset: 0,
  scrollTo(x, y) { seen.scrolled.push([x, y]); }
};
global.document = {
  title: '',
  body: { className: '', classList: { toggle() {} } },
  documentElement: { style: { setProperty() {} } },
  getElementById(id) { return id === 'admin-main' ? mainStub : (parts[id] || null); },
  querySelector(sel) {
    if (sel === '.topbar') return { getBoundingClientRect: () => ({ height: 70 }) };
    return { textContent: '', innerHTML: '' };
  },
  querySelectorAll(sel) { return sel === '.admin-nav a' ? sideLinks : []; },
  addEventListener: function () {}
};
global.location = {
  origin: O,
  href: O + '/admin/dashboard',
  pathname: '/admin/dashboard', search: '', hash: ''
};
global.history = { pushState(state, title, url) { seen.pushed.push(url); } };
// what the "server" answers per path: { active: the sidebar link it marks, landed?: a redirect }
const screens = {};
global.fetch = function (url) {
  seen.fetched.push(url);
  const s = screens[url] || {};
  return Promise.resolve({ ok: true, url: O + (s.landed || url), text: () => Promise.resolve('<html>--admin-accent: #123456;' + url + '</html>') });
};
global.DOMParser = function () {};
global.DOMParser.prototype.parseFromString = function (text) {
  const url = text.slice(text.indexOf(';') + 1, text.indexOf('</html>'));
  const s = screens[url] || {};
  return {
    body: { className: '' },
    getElementById(id) { return id === 'admin-main' ? { innerHTML: '<p>' + url + '</p>' } : null; },
    querySelector(sel) {
      if (sel === '.admin-nav a.active') return s.active ? { getAttribute: () => s.active } : null;
      if (sel === 'title') return { textContent: 't' };
      return { textContent: '', innerHTML: '' };
    }
  };
};
let sw = null;
try {
  new Function(nav)();                    // runs the IIFE against the stubbed globals
  sw = global.window.TapuzNav && global.window.TapuzNav.swappable;
  check('admin-nav.js installs and exposes swappableUrl', typeof sw === 'function');
} catch (e) {
  check('admin-nav.js installs (' + e.message + ')', false);
}

if (typeof sw === 'function') {
  const O = 'http://localhost:3000';
  const cases = [
    // real SCREENS — swap in place
    ['/admin', true],
    ['/admin/theme', true],
    ['/admin/dashboard', true],
    ['/admin/analytics?days=7', true],        // in-content range tab
    ['/admin/inbox?status=new', true],        // in-content filter
    ['/admin/media-library', true],
    ['/admin/storage', true],
    // API endpoints — never a screen
    ['/admin/api/theme/export', false],
    ['/admin/api/site-package/export', false],
    ['/admin/api/syntax-dictionary.md', false],
    // downloads — an extension means a file, not a screen
    ['/admin/analytics.csv?what=daily&days=7', false],
    ['/admin/inbox.csv', false],
    // the shell-less builder — must full-navigate, no wasted fetch
    ['/admin/new', false],
    ['/admin/edit/home', false],
    ['/admin/edit/blog%2Fpost', false],
    ['/admin/preview/home', false],
    // off the admin surface entirely
    ['/settings', false],
    ['/', false]
  ];
  cases.forEach(c => {
    const got = sw(new URL(O + c[0]));
    check(`swappableUrl ${c[0]} → ${c[1]}`, got === c[1]);
  });
  check('swappableUrl rejects a cross-origin /admin look-alike',
    sw(new URL('https://evil.example/admin/theme')) === false);
}

try { new Function(nav); check('admin-nav.js parses', true); }
catch (e) { check('admin-nav.js parses (' + e.message + ')', false); }

// ── v2.69: the #fragment survives a swap, and the sidebar keeps its highlight ──
// Two holes the store screens fell into. (1) The hub's "להגדרה" buttons lead to
// /admin/store/settings#payments; the swap requested and pushed the path
// without the fragment and scrolled to 0,0 — the top of a long page. (2) The
// active sidebar link was matched by path equality, so after a swap to
// /admin/store/products/<id> (or /bentml, /gateway) NOTHING was highlighted,
// while a full load of the same address highlighted correctly.
check('the fragment is read from the clicked URL and never sent to the server',
  /var hash = requestUrl\.hash \|\| '';/.test(nav) && /fetch\(full, /.test(nav));
check('the fragment is pushed into the address with the landed path',
  /history\.pushState\(\{ tapuz: true \}, '', landedFull \+ keepHash\)/.test(nav));
check('a redirect to another screen drops the fragment',
  /var keepHash = url\.pathname === requestUrl\.pathname \? hash : '';/.test(nav));
check('the swap lands on the fragment, else the top',
  /if \(!reveal\(hash\)\) window\.scrollTo\(0, 0\);/.test(nav));
check('the active link is read from the FETCHED document',
  /doc\.querySelector\('\.admin-nav a\.active'\)/.test(nav) && /setActive\(pathname, data\.activeHref\)/.test(nav));

/** One swap through the real code: navigate, let the promise chain settle. */
async function swapTo(href) {
  seen.fetched.length = 0; seen.pushed.length = 0; seen.scrolled.length = 0;
  global.window.TapuzNav.navigate(href);
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
}
const activeNow = () => sideLinks.filter((l) => l.active).map((l) => l.href.replace(O, ''));
const moveTo = (url) => {   // what the browser's address bar holds after a pushState
  const u = new URL(O + url);
  Object.assign(global.location, { href: u.href, pathname: u.pathname, search: u.search, hash: u.hash });
};

(async () => {
  if (typeof sw === 'function') {
    // (1) a link to a PART of another screen
    screens['/admin/store/settings'] = { active: '/admin/store/settings' };
    parts.payments = { getBoundingClientRect: () => ({ top: 900 }) };
    await swapTo('/admin/store/settings#payments');
    check('settings#payments: the request carries no fragment',
      seen.fetched.length === 1 && seen.fetched[0] === '/admin/store/settings');
    check('settings#payments: the address keeps the fragment',
      seen.pushed.length === 1 && seen.pushed[0] === '/admin/store/settings#payments');
    check('settings#payments: the view lands on #payments, below the 70px topbar (not at 0,0)',
      seen.scrolled.length === 1 && seen.scrolled[0][0] === 0 && seen.scrolled[0][1] === 900 - 70 - 12);
    check('settings#payments: its sidebar link is the active one', activeNow().join() === '/admin/store/settings');
    moveTo('/admin/store/settings#payments');

    // (2) a screen whose address is NOT a sidebar link
    screens['/admin/store/products/7'] = { active: '/admin/store/products' };
    await swapTo('/admin/store/products/7');
    check('products/7: the document\'s own active mark wins — "מוצרים" is highlighted',
      activeNow().join() === '/admin/store/products');
    check('products/7: no fragment, so the swap resets to the top',
      seen.scrolled.length === 1 && seen.scrolled[0][1] === 0);
    moveTo('/admin/store/products/7');

    // a document that marks nothing falls back to path equality
    screens['/admin/dashboard'] = {};
    await swapTo('/admin/dashboard');
    check('no active mark in the document → path equality still highlights', activeNow().join() === '/admin/dashboard');
    moveTo('/admin/dashboard');

    // a redirect (lapsed session → another screen) drops the fragment
    screens['/admin/store/orders'] = { landed: '/admin/dashboard', active: '/admin/dashboard' };
    await swapTo('/admin/store/orders#latest');
    check('a redirected swap pushes the landed path without the stale fragment',
      seen.pushed.length === 1 && seen.pushed[0] === '/admin/dashboard');
    moveTo('/admin/dashboard');

    // a fragment that names nothing on the page is harmless
    screens['/admin/store/settings'] = { active: '/admin/store/settings' };
    delete parts.payments;
    await swapTo('/admin/store/settings#nowhere');
    check('an unknown fragment still swaps, keeps the address and lands at the top',
      seen.pushed[0] === '/admin/store/settings#nowhere' && seen.scrolled.length === 1 && seen.scrolled[0][1] === 0);
    moveTo('/admin/store/settings#nowhere');

    // (3) a link to a part of the screen ALREADY shown: no fetch at all
    parts.shipping = { getBoundingClientRect: () => ({ top: 400 }) };
    await swapTo('/admin/store/settings#shipping');
    check('same screen + fragment: no request, the address notes it, the part comes into view',
      seen.fetched.length === 0 && seen.pushed[0] === '/admin/store/settings#shipping' &&
      seen.scrolled.length === 1 && seen.scrolled[0][1] === 400 - 70 - 12);
    moveTo('/admin/store/settings#shipping');
    await swapTo('/admin/store/settings');
    check('same screen, no fragment: nothing happens (no reload, no history entry)',
      seen.fetched.length === 0 && seen.pushed.length === 0 && seen.scrolled.length === 0);
    check('none of these swaps fell back to a full navigation',
      global.location.href === O + '/admin/store/settings#shipping');

    // (4) the two moves the BROWSER makes by itself — a history step between
    // two parts of one screen, a full load of an address with a fragment. It
    // puts the part flush against the top of the window, under the sticky
    // topbar (measured in Chrome: the section's top at -4px behind a 79px
    // bar); the file lands it where a swap does.
    for (const ev of ['hashchange', 'load']) {
      seen.scrolled.length = 0;
      check('a "' + ev + '" listener is registered', typeof onWindow[ev] === 'function');
      if (typeof onWindow[ev] === 'function') onWindow[ev]();
      check(ev + ': the part named in the address lands below the topbar',
        seen.scrolled.length === 1 && seen.scrolled[0][1] === 400 - 70 - 12);
    }
    moveTo('/admin/store/settings');
    seen.scrolled.length = 0;
    if (typeof onWindow.load === 'function') onWindow.load();
    check('load without a fragment moves nothing', seen.scrolled.length === 0);
  }

  console.log('');
  console.log(fail ? 'SMOKE ADMIN-NAV: FAIL' : 'SMOKE ADMIN-NAV: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('FAIL the swap drive threw: ' + (e && e.stack || e));
  console.log('');
  console.log('SMOKE ADMIN-NAV: FAIL');
  process.exit(1);
});
