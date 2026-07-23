'use strict';

/**
 * v1.62 QA — client navigation swaps content, keeps the shell.
 *
 * The failure this guards: a sidebar click used to reload the whole document,
 * tearing down and rebuilding the fixed rail identically — the "jump" Ben saw.
 * admin-nav.js swaps only #admin-main. The risks that come with that are all
 * checked here: the <main> wrapper must stay BALANCED (an unclosed tag on a
 * bare page would corrupt the login screen), the builder must stay OUT of
 * scope (it has no sidebar and must full-navigate), and any script that binds
 * a document-level listener must survive re-execution without stacking a
 * second one (the v1.50 "two pickers" bug, re-armed by navigation).
 */

const fs = require('fs');
const path = require('path');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

const root = path.join(__dirname, '..');
const { layout, adminNav } = require(path.join(root, 'src', 'admin-ui'));
const nav = fs.readFileSync(path.join(root, 'public', 'admin-nav.js'), 'utf8');
const picker = fs.readFileSync(path.join(root, 'public', 'admin-media-picker.js'), 'utf8');

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

// ── the navigation layer's safety rules ────────────────────────────────────
check('nav guards against its own re-execution during a swap',
  /window\.__tapuzNavInit/.test(nav));
check('nav no-ops when there is no #admin-main (not a sidebar screen)',
  /getElementById\('admin-main'\)/.test(nav) && /if \(!main\) return/.test(nav));
check('modified clicks (new-tab/download/middle) fall through to the browser',
  /metaKey|ctrlKey/.test(nav) && /button !== 0/.test(nav) && /'_blank'/.test(nav) &&
  /hasAttribute\('download'\)/.test(nav));
check('only same-origin /admin paths are intercepted',
  /url\.origin !== location\.origin/.test(nav) && /indexOf\('\/admin\/'\)/.test(nav));
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

// ── the media picker survives re-execution (the v1.50 bug, re-armed) ───────
check('the media picker guards its document listener against a second bind',
  /window\.__tapuzMediaPickerInit/.test(picker) &&
  picker.indexOf('__tapuzMediaPickerInit') < picker.indexOf("document.addEventListener('click'"));

try { new Function(nav); check('admin-nav.js parses', true); }
catch (e) { check('admin-nav.js parses (' + e.message + ')', false); }

console.log('');
console.log(fail ? 'SMOKE ADMIN-NAV: FAIL' : 'SMOKE ADMIN-NAV: PASS');
process.exit(fail ? 1 : 0);
