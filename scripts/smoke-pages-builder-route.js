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

    // ── the visual builder page renders for that page ──
    const edit = await req('GET', '/admin/edit/' + encodeURIComponent(slug), { cookie });
    check('GET /admin/edit/:fullPath renders the builder (toolbox + canvas)', edit.status === 200 && /id="layers-fold"/.test(edit.text) && /admin-builder\.js/.test(edit.text));

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
