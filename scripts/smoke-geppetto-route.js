'use strict';

/**
 * v2.56 QA — Geppetto's door, end to end through a real server: the screen,
 * read → a plan (the JSON door, so no network), the framed preview in the
 * design's own theme, the page as BenTML, the theme as <bent-theme>, land
 * live → the page on the static export, the ledger, undo → gone; and the
 * refusals: nothing to read, a plain web page, an editor (admin only), a
 * cross-origin post (CSRF).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-geppetto-route-'));
const PORT = 3957;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond, extra) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (cond || extra === undefined ? '' : '  → ' + JSON.stringify(extra).slice(0, 300)));
  if (!cond) fail = true;
}

function req(method, urlPath, { body, form, cookie, origin = BASE } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'application/json' };
    if (origin) headers.Origin = origin;
    if (form != null) {
      data = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body != null) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (cookie) headers.Cookie = cookie;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text: buf });
      });
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

// A synthetic Figma Sites bundle index (the shape /_json/<bundle>/_index.json
// has): one page, a Desktop breakpoint stacking a hero frame and a cards grid.
const SOLID = (r, g, b) => [{ type: 'SOLID', color: { r, g, b, a: 1 }, opacity: 1, visible: true, blendMode: 'NORMAL' }];
function textNode(id, x, y, w, h, characters, size, color, tag) {
  return {
    type: 'TEXT', id, name: characters, characters, absoluteBoundingBox: { x, y, width: w, height: h },
    fills: SOLID(...color), strokes: [], effects: [], interactions: [], accessibleHTMLTag: tag || 'AUTO',
    style: { fontFamily: 'Inter', fontWeight: size > 30 ? 700 : 400, fontSize: size, textAlignHorizontal: 'LEFT', italic: false, textCase: 'ORIGINAL', textDecoration: 'NONE', lineHeightPx: size * 1.2 },
    characterStyleOverrides: [], styleOverrideTable: {}, lineTypes: ['NONE'], lineIndentations: [0]
  };
}
function card(i, x) {
  const id = 'c' + i;
  return {
    [id]: { type: 'FRAME', id, name: 'Card ' + i, absoluteBoundingBox: { x, y: 700, width: 360, height: 330 }, fills: [], strokes: [], effects: [], layoutMode: 'VERTICAL', itemSpacing: 12, interactions: [], children: [id + 'i', id + 't', id + 'p'] },
    [id + 'i']: { type: 'RECTANGLE', id: id + 'i', name: 'photo', absoluteBoundingBox: { x, y: 700, width: 360, height: 220 }, fills: [{ type: 'IMAGE', scaleMode: 'FILL', imageRef: 'abc12' + i, visible: true, opacity: 1 }], strokes: [], effects: [], interactions: [] },
    [id + 't']: textNode(id + 't', x, 932, 360, 34, ['Brand identity', 'Websites', 'Print'][i], 28, [0.1, 0.1, 0.15]),
    [id + 'p']: textNode(id + 'p', x, 978, 360, 48, 'A few honest words about this service.', 18, [0.35, 0.35, 0.4])
  };
}
const INDEX = {
  roots: ['0:3'],
  nodeById: Object.assign({
    '0:3': { type: 'WEBPAGE', id: '0:3', name: '/', absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1200 }, fills: SOLID(1, 1, 1), strokes: [], interactions: [], children: ['0:4'] },
    '0:4': { type: 'FRAME', id: '0:4', name: 'Desktop', isBreakpointFrame: true, absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1100 }, fills: SOLID(1, 1, 1), strokes: [], effects: [], layoutMode: 'VERTICAL', interactions: [], children: ['hero', 'svc'] },
    hero: { type: 'FRAME', id: 'hero', name: 'Hero', absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 560 }, fills: SOLID(0.18, 0.2, 0.26), strokes: [], effects: [], layoutMode: 'VERTICAL', primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER', itemSpacing: 24, paddingTop: 120, paddingBottom: 120, interactions: [], children: ['h1', 'sub'] },
    h1: Object.assign(textNode('h1', 320, 160, 800, 110, 'Studio Juniper makes brands bloom', 72, [0.95, 0.43, 0.51], 'H1'), { style: Object.assign(textNode('x', 0, 0, 0, 0, '', 72, [0, 0, 0]).style, { textAlignHorizontal: 'CENTER', fontWeight: 700 }) }),
    sub: Object.assign(textNode('sub', 420, 300, 600, 60, 'Identity, websites and print for small businesses that care.', 22, [0.96, 0.96, 0.96]), { style: Object.assign(textNode('y', 0, 0, 0, 0, '', 22, [0, 0, 0]).style, { textAlignHorizontal: 'CENTER' }) }),
    svc: { type: 'FRAME', id: 'svc', name: 'Services', absoluteBoundingBox: { x: 0, y: 560, width: 1440, height: 540 }, fills: SOLID(1, 1, 1), strokes: [], effects: [], layoutMode: 'VERTICAL', itemSpacing: 40, paddingTop: 80, interactions: [], children: ['svc-h', 'grid'] },
    'svc-h': textNode('svc-h', 520, 620, 400, 60, 'Services', 48, [0.1, 0.1, 0.15], 'H2'),
    grid: { type: 'FRAME', id: 'grid', name: 'Grid', absoluteBoundingBox: { x: 120, y: 700, width: 1200, height: 330 }, fills: [], strokes: [], effects: [], layoutMode: 'HORIZONTAL', itemSpacing: 60, interactions: [], children: ['c0', 'c1', 'c2'] }
  }, card(0, 120), card(1, 540), card(2, 960)),
  assetIdToGuid: {},
  guidToUrl: { '0:3': '/' },
  fonts: { 'Inter:Regular': { id: 'Inter', url: '/_woff/inter.woff2' } },
  assets: {},
  animateRootIds: [],
  siteSettings: { title: 'Studio Juniper', description: 'A small studio that makes brands bloom.', lang: 'en' }
};

(async () => {
  process.env.TAPUZ_ROOT = ROOT;
  require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'אתר בדיקה', description: 'geppetto-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const auth = require('../src/auth');
  auth.createAdmin('owner', 'owner-pass-1');
  auth.addTeamMember('writer', 'writer-pass-1', 'editor');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];
    const loginEd = await req('POST', '/admin/login', { form: { username: 'writer', password: 'writer-pass-1' } });
    const edCookie = String(loginEd.headers['set-cookie'] || '').split(';')[0];

    const screen = await req('GET', '/admin/geppetto', { cookie });
    check('GET /admin/geppetto → the screen (link / file / Figma file doors)', screen.status === 200 && /gp-read-url/.test(screen.text) && /gp-figma-token/.test(screen.text) && /admin-geppetto\.js/.test(screen.text));
    const imp = await req('GET', '/admin/import', { cookie });
    check('the import screen offers Geppetto', imp.status === 200 && /\/admin\/geppetto/.test(imp.text));

    const empty = await req('POST', '/admin/api/geppetto/read', { cookie, body: {} });
    check('nothing to read → 400 with a Hebrew reason', empty.status === 400 && empty.json && empty.json.ok === false && /חסרה/.test(empty.json.error), empty.json);
    const plain = await req('POST', '/admin/api/geppetto/read', { cookie, body: { html: '<!DOCTYPE html><html><body><h1>Just a page</h1></body></html>' } });
    check('a plain web page → 400 E_NOT_DESIGN (the general decompiler is pointed at)', plain.status === 400 && plain.json.code === 'E_NOT_DESIGN', plain.json);
    const editor = await req('POST', '/admin/api/geppetto/read', { cookie: edCookie, body: { json: INDEX } });
    check('an editor cannot read (admin only)', editor.status === 403, editor.status);
    const csrf = await req('POST', '/admin/api/geppetto/read', { cookie, body: { json: INDEX }, origin: 'https://evil.example' });
    check('a cross-origin post is refused (CSRF gate)', csrf.status === 403, csrf.status);

    // the SVG door: files the screen slimmed, one per page
    const svgText = fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'geppetto', 'figma-page.svg'), 'utf8');
    const svgRead = await req('POST', '/admin/api/geppetto/read', { cookie, body: { svg: [{ name: 'Home', text: svgText }] } });
    check('an SVG exported from a design tool is read through the screen', svgRead.status === 200 && svgRead.json.ok && svgRead.json.plan && svgRead.json.plan.pages.length === 1 && svgRead.json.plan.door === 'figma-svg', svgRead.json && (svgRead.json.error || Object.keys(svgRead.json.plan || {})));
    const outlinedText = fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'geppetto', 'figma-outlined.svg'), 'utf8');
    const outlined = await req('POST', '/admin/api/geppetto/read', { cookie, body: { svg: [{ name: 'Outlined', text: outlinedText }] } });
    check('an export whose words became outlines is refused with the fix in the message', outlined.status === 400 && outlined.json.code === 'E_SVG_OUTLINED' && /Outline text/.test(outlined.json.error), outlined.json);
    const mixed = await req('POST', '/admin/api/geppetto/read', { cookie, body: { svg: [{ name: 'Home', text: svgText }, { name: 'Contact', text: outlinedText }] } });
    check('…and with several files it says WHICH one to export again', mixed.status === 400 && mixed.json.code === 'E_SVG_OUTLINED' && /Contact/.test(mixed.json.error), mixed.json);

    const read = await req('POST', '/admin/api/geppetto/read', { cookie, body: { json: INDEX, url: 'https://studio-juniper.figma.site/' } });
    const plan = read.json && read.json.plan;
    check('the Figma bundle becomes a plan', read.status === 200 && plan && plan.format === 'figma-sites' && plan.pages.length === 1, read.json);
    if (!plan) throw new Error('no plan');
    check('the plan has its look and its words', plan.title === 'Studio Juniper' && plan.palette && plan.palette.primary && (plan.fontMap || []).some((f) => f.family === 'Inter'), [plan.title, plan.palette, plan.fontMap]);
    check('the plan read the cards and the opening screen', plan.pages[0].blocks.cards === 1 && (plan.pages[0].blocks.hero === 1 || plan.pages[0].blocks.section >= 1), plan.pages[0].blocks);
    const key = plan.pages[0].key;

    const prev = await req('GET', `/admin/geppetto/preview/${plan.id}/${encodeURIComponent(key)}`, { cookie });
    check('the preview is framed same-origin only', prev.status === 200 && prev.headers['x-frame-options'] === 'SAMEORIGIN' && /frame-ancestors 'self'/.test(prev.headers['content-security-policy'] || ''), prev.headers);
    check('the preview is the page in ITS theme', /Studio Juniper makes brands bloom/.test(prev.text) && prev.text.includes('"Inter"') && /bent-cards/.test(prev.text));
    const src = await req('GET', `/admin/api/geppetto/plan/${plan.id}/source/${encodeURIComponent(key)}`, { cookie });
    check('the page as BenTML (.pzn)', src.status === 200 && /<bent-cards/.test(src.text) && /<bent-heading[^>]*level="1"/.test(src.text), src.text.slice(0, 200));
    const bent = await req('GET', `/admin/api/geppetto/plan/${plan.id}/theme.bent`, { cookie });
    check('the look as <bent-theme>, as a download', bent.status === 200 && /<bent-theme/.test(bent.text) && /attachment/.test(bent.headers['content-disposition'] || ''));
    const stale = await req('GET', '/admin/geppetto/preview/pl_0000000000/x', { cookie });
    check('an unknown plan says so (no crash)', stale.status === 404);

    const landed = await req('POST', '/admin/api/geppetto/land', { cookie, body: { planId: plan.id, mode: 'live', media: false } });
    check('land live → ok, one page, crowned home', landed.status === 200 && landed.json.ok && landed.json.pages.length === 1 && !!landed.json.homepage && !landed.json.rebuildError, landed.json);
    const fullPath = landed.json.pages[0].fullPath;
    const live = await req('GET', '/', { origin: null });
    check('the live site (the static export) serves the imported home page', live.status === 200 && /Studio Juniper makes brands bloom/.test(live.text) && /bent-cards/.test(live.text), live.status);
    check('the live site wears the design’s font', /fonts\.googleapis\.com[^"]*Inter/.test(live.text));
    const ledger = await req('GET', '/admin/api/geppetto/imports', { cookie });
    check('the ledger lists the landing', ledger.status === 200 && ledger.json.imports.length === 1 && ledger.json.imports[0].pages[0] === fullPath && !ledger.json.imports[0].undone, ledger.json);

    const undo = await req('POST', '/admin/api/geppetto/undo', { cookie, body: { importId: landed.json.importId } });
    check('undo → the page is gone, the look and the crown are back', undo.status === 200 && undo.json.ok && undo.json.pagesRemoved[0] === fullPath && undo.json.theme && undo.json.homepage, undo.json);
    const after = await req('GET', '/' + fullPath + '.html', { origin: null });
    check('the imported address no longer serves the page', after.status === 404 || !/Studio Juniper makes brands bloom/.test(after.text), after.status);
    const again = await req('POST', '/admin/api/geppetto/undo', { cookie, body: { importId: landed.json.importId } });
    check('undo twice → 400 ALREADY', again.status === 400 && again.json.code === 'ALREADY', again.json);
    const noPlan = await req('POST', '/admin/api/geppetto/land', { cookie, body: { planId: 'pl_0000000000' } });
    check('landing a missing plan → 400 NO_PLAN', noPlan.status === 400 && noPlan.json.code === 'NO_PLAN', noPlan.json);

    // the screen's way: land as a background job and poll it (a big design
    // can outlast a hosting proxy's request timeout)
    const read2 = await req('POST', '/admin/api/geppetto/read', { cookie, body: { json: INDEX, url: 'https://studio-juniper.figma.site/' } });
    const started = await req('POST', '/admin/api/geppetto/land', { cookie, body: { planId: read2.json.plan.id, mode: 'drafts', media: false, wait: false } });
    check('land with wait:false → a job id at once', started.status === 200 && started.json.ok && /^job_[a-f0-9]{12}$/.test(started.json.job), started.json);
    let job = null;
    for (let i = 0; i < 60; i++) {
      job = await req('GET', '/admin/api/geppetto/job/' + started.json.job, { cookie });
      if (job.json && job.json.done) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    check('the job finishes with the landing’s own answer (drafts)', job && job.json && job.json.done === true && job.json.ok && job.json.mode === 'drafts' && job.json.pages.length === 1, job && job.json);
    const unknownJob = await req('GET', '/admin/api/geppetto/job/job_000000000000', { cookie });
    check('an unknown job → 404', unknownJob.status === 404);
    const undo2 = await req('POST', '/admin/api/geppetto/undo', { cookie, body: { importId: job.json.importId } });
    check('the job’s import undoes like any other', undo2.status === 200 && undo2.json.ok && undo2.json.pagesRemoved.length === 1, undo2.json);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE GEPPETTO-ROUTE: FAIL' : 'SMOKE GEPPETTO-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  console.log('SMOKE GEPPETTO-ROUTE: FAIL');
  process.exit(1);
});
