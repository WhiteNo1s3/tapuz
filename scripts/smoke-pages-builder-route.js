'use strict';

/**
 * v1.31 QA — proves src/routes/pages-builder.js works end-to-end as a
 * mounted Express Router: the whole page-builder lifecycle over real HTTP.
 * The new-page picker, create, the visual builder page, server-side
 * preview, save (draft), publish (draft → live), delete, and build. This is
 * the marquee "site builder" surface; prior coverage exercised the page
 * store and templates at the module level, but not this route cluster's own
 * request/response behavior through the mounted router.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-pages-builder-route-'));
const PORT = 3990;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { body, form, cookie } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'text/html', Origin: BASE };
    if (form != null) {
      data = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body != null) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Accept'] = 'application/json';
    }
    if (cookie) headers['Cookie'] = cookie;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (e) { /* non-json */ }
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

(async () => {
  process.env.TAPUZ_ROOT = ROOT;
  require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'אתר בדיקה', description: 'pages-builder-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
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

    // ── new-page picker renders the template chooser ──
    const newPage = await req('GET', '/admin/new', { cookie });
    check('GET /admin/new renders the template picker', newPage.status === 200 && /name="template"/.test(newPage.text));

    // ── create a page from a template ──
    const create = await req('POST', '/admin/create', { cookie, form: { title: 'עמוד חדש', template: 'basic' } });
    check('POST /admin/create makes a page and redirects to its editor', (create.status === 302 || create.status === 303) && /\/admin\/edit\//.test(create.headers.location || ''));
    const slug = decodeURIComponent((create.headers.location || '').replace('/admin/edit/', ''));
    check('the created page has a real slug', !!slug);

    // ── a hand-typed slug with spaces is normalized, not stored raw ──
    const spaced = await req('POST', '/admin/create', { cookie, form: { title: 'דף עם רווחים', slug: 'my cool page', template: 'basic' } });
    const spacedPath = decodeURIComponent((spaced.headers.location || '').replace('/admin/edit/', ''));
    const spacedPage = require('../src/pages').getPageByFullPath(spacedPath);
    check('a spaced slug becomes dashes in the URL', spacedPath === 'my-cool-page');
    check('the STORED slug matches its URL form (no spaces)', !!spacedPage && spacedPage.slug === 'my-cool-page');
    await req('POST', '/admin/delete', { cookie, form: { full_path: spacedPath } });

    // ── the article TEMPLATE tags the page (v2.12) — before this, "I added
    //    an article" produced a plain page no article cube would show ──
    const art = await req('POST', '/admin/create', { cookie, form: { title: 'מאמר בדיקה', template: 'article' } });
    const artPath = decodeURIComponent((art.headers.location || '').replace('/admin/edit/', ''));
    const artPage = require('../src/pages').getPageByFullPath(artPath);
    const artTags = artPage ? (Array.isArray(artPage.tags) ? artPage.tags : JSON.parse(artPage.tags || '[]')) : [];
    check('the article template lands TAGGED as an article', artTags.indexOf('article') !== -1);
    await req('POST', '/admin/delete', { cookie, form: { full_path: artPath } });

    // ── the visual builder page renders for that page ──
    const edit = await req('GET', '/admin/edit/' + encodeURIComponent(slug), { cookie });
    check('GET /admin/edit/:fullPath renders the builder (toolbox + canvas)', edit.status === 200 && /id="layers-fold"/.test(edit.text) && /admin-builder\.js/.test(edit.text));

    // ── ONE publish concept, nothing hides the side panels (v2.12, Ben) ──
    check('one publish button — the פרסם/פרסם+בנה split is gone',
      edit.text.indexOf('topbar-actions') !== -1 && edit.text.indexOf('פרסם + בנה') === -1);
    check('no bottom save-bar covering the side panels', edit.text.indexOf('save-bar') === -1);
    check('palette families ship OPEN — tools are never folded away',
      /<details class="tool-cat"[^>]* open>/.test(edit.text));

    // ── firm settings, live doors (the builder.io bar) — client statics ──
    const builderJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-builder.js'), 'utf8');
    check('url fields carry the page picker (tz-page-list datalist)',
      /list="tz-page-list"/.test(builderJs) && /ensurePageDatalist/.test(builderJs));
    check('an empty מאמרים module is a DOOR — create-first-article button',
      /data-new-article/.test(builderJs) && /createArticleAndGo/.test(builderJs));
    check('article cubes carry ✎ into their own editor', /cube-edit/.test(builderJs));
    const reg = fs.readFileSync(path.join(__dirname, '..', 'src', 'block-registry.js'), 'utf8');
    check('no href item field is a bare string — all are url (picker-eligible)',
      !/name: 'href', labelHe: 'קישור', type: 'string'/.test(reg));

    // ── per-device visibility (v2.12): full chain, builder → language → page ──
    check('the style form offers תצוגה לפי מכשיר', /data-style="hideOn"/.test(builderJs));
    const { compile } = require('../src/bentml/compile');
    const hideOut = compile('BENTML 0.1\n\nMETA {\n  title: "x"\n}\n\nHEADING(level: 2, hide: mobile) { כותרת }\n');
    const hideBlock = hideOut.blocks[0];
    check('hide: mobile compiles into style.hideOn', !!(hideBlock.data.style && hideBlock.data.style.hideOn === 'mobile'));
    check('the renderer emits the hide-on class', /hide-on-mobile/.test(require('../src/renderer').renderBlock(hideBlock, 'rtl')));
    const siteCss = fs.readFileSync(path.join(__dirname, '..', 'themes', 'default', 'css', 'main.css'), 'utf8');
    check('the theme CSS backs both hide-on classes with media queries',
      /hide-on-mobile/.test(siteCss) && /hide-on-desktop/.test(siteCss));

    // ── every leaf module draws a REAL canvas preview (v2.13, Ben: "many
    //    models are not rendered in live editor"). Containers render via
    //    childrenKey; everything else must have its own branch — a module
    //    that falls into the dashed generic box fails this check. ──
    const bodyRegion = builderJs.slice(builderJs.indexOf('function renderBlockBody'));
    const previewless = require('../src/block-registry').BLOCK_REGISTRY
      .filter((e) => !e.childrenOf && !e.childrenKey)
      .map((e) => e.type)
      .filter((t) => !new RegExp("type === '" + t + "'").test(bodyRegion));
    check('no leaf module falls back to the generic dashed box' +
      (previewless.length ? ' — missing: ' + previewless.join(', ') : ''), previewless.length === 0);

    // ── save a draft via the ops-based save endpoint ──
    const { getPageByFullPath } = require('../src/pages');
    // canonical block shape: heading renders data.text (not html), level 1-6.
    const blocks = [{ id: 'h1', type: 'heading', data: { level: 1, text: 'כותרת הבדיקה' } }];
    // the builder always sends the title alongside blocks (it's a NOT NULL
    // column) — match that so the save reflects a real editor request.
    const save = await req('POST', '/admin/save', { cookie, body: { full_path: slug, title: 'עמוד חדש', blocks } });
    check('POST /admin/save persists a draft', save.status === 200 && save.json && save.json.ok);

    // ── a raw-HTML block must not be able to break OUT of the builder ──
    // v1.51: the builder embeds the draft as JSON inside an inline <script>.
    // JSON.stringify does not escape '<', so an html block containing a literal
    // </script> closed the element early: the builder's JS died mid-parse and
    // the canvas rendered ZERO blocks, silently, with the draft intact on disk.
    // That is also an injection — anything after the breakout runs as script in
    // the ADMIN page. Not exotic input either: analytics snippets and embeds,
    // the exact things the raw-HTML tool exists for, all carry </script>.
    const nasty = '<div>widget</div>' + '<scr' + 'ipt>window.__PWNED=1;</scr' + 'ipt>';
    const withRaw = [
      { id: 'h2', type: 'heading', data: { level: 1, text: 'כותרת הבדיקה' } },
      { id: 'raw1', type: 'html', data: { content: nasty } }
    ];
    const saveRaw = await req('POST', '/admin/save', { cookie, body: { full_path: slug, title: 'עמוד חדש', blocks: withRaw } });
    check('POST /admin/save accepts a raw-HTML block carrying a close-script tag', saveRaw.status === 200 && saveRaw.json && saveRaw.json.ok);

    const reopened = await req('GET', '/admin/edit/' + encodeURIComponent(slug), { cookie });
    check('the builder still renders after saving that block', reopened.status === 200 && /admin-builder\.js/.test(reopened.text));
    check('the embedded draft does NOT contain a raw </script> breakout',
      !/window\.__PWNED=1;<\/script>/.test(reopened.text));
    check('the payload survives, escaped, so the author does not lose their code',
      /u003c\/script|u003cscript/i.test(reopened.text));
    // restore the simple draft for the publish assertions below
    await req('POST', '/admin/save', { cookie, body: { full_path: slug, title: 'עמוד חדש', blocks } });

    // ── server-side preview renders the DRAFT with SAMEORIGIN framing ──
    const preview = await req('GET', '/admin/preview/' + encodeURIComponent(slug), { cookie });
    check('GET /admin/preview/:fullPath renders the draft content', preview.status === 200 && /כותרת הבדיקה/.test(preview.text));
    check('preview allows same-origin framing (X-Frame-Options SAMEORIGIN, not DENY)', /sameorigin/i.test(preview.headers['x-frame-options'] || ''));

    // ── publish: draft → live, then it appears as static HTML ──
    const publish = await req('POST', '/admin/publish', { cookie, body: { full_path: slug } });
    check('POST /admin/publish publishes the draft', publish.status === 200 && publish.json && publish.json.ok);
    const live = await req('GET', '/' + encodeURIComponent(slug) + '.html', {});
    check('the published page is served as static HTML with the real content', live.status === 200 && /כותרת הבדיקה/.test(live.text));

    // ── build regenerates the whole static site ──
    const build = await req('POST', '/admin/build', { cookie, body: {} });
    check('POST /admin/build regenerates the site (count > 0)', build.status === 200 && build.json && build.json.ok && build.json.count > 0);

    // ── delete removes the page ──
    const del = await req('POST', '/admin/delete', { cookie, form: { full_path: slug } });
    check('POST /admin/delete removes the page (redirect)', del.status === 302 || del.status === 303 || del.status === 200);
    check('the deleted page is gone from the store', !getPageByFullPath(slug));
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE PAGES-BUILDER-ROUTE: FAIL' : 'SMOKE PAGES-BUILDER-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
