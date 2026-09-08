'use strict';

/**
 * v1.14 QA — proves src/routes/pzn-pages.js works end-to-end as a mounted
 * Express Router: the four page-MUTATING pzn/BenTML endpoints (source
 * GET/POST, decompile, ops, create-from-source) through real HTTP against a
 * real server — completing the two-part split of the page-builder/pzn API
 * surface (v1.13 did the stateless half). Every route here writes a real
 * page file on disk, so this test checks actual draft/published divergence
 * and slug-collision handling, not just response shapes.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-pzn-pages-route-'));
const PORT = 3974;
const BASE = `http://127.0.0.1:${PORT}`;

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

const GOOD_PZN = `<bent-heading level="1">שלום</bent-heading>\n<bent-text>תוכן לדוגמה כאן.</bent-text>`;
const BROKEN_BUT_REPAIRABLE = `<bent-paragraph>זה אמור להפוך לטקסט</bent-paragraph>`; // alias, not a real tag
const RAW_HTML = `<html><body><h1>כותרת מיובאת</h1><p>פסקה מיובאת.</p></body></html>`;

// full .pzn documents — required by create-from-source, which calls the real
// parser directly (unlike to-blocks/repair, which tolerate bare fragments).
function fullDoc({ title, slug, body }) {
  return `<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n<head><meta charset="utf-8"/><title>${title}</title><meta name="bent-slug" content="${slug}"/></head>\n<body>${body}</body>\n</html>`;
}
const BOT_DOC = fullDoc({ title: 'דף מהבוט', slug: 'from-bot', body: '<bent-hero id="h"><bent-heading id="hh" level="1">שלום מהבוט</bent-heading></bent-hero>' });
const EMPTY_PLACEHOLDER_DOC = fullDoc({ title: 'כותרת הדף', slug: 'my-page', body: '\n  <!-- bent-* modules here -->\n' });

(async () => {
  process.env.TAPUZ_ROOT = ROOT;
  require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'אתר בדיקה', description: 'pzn-pages-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const { createAdmin } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');
  const { createPage } = require('../src/pages');
  createPage({ title: 'דף מקור', slug: 'source-target', blocks: [] });

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    // ── source GET (draft of a fresh page is empty/near-empty) ──
    const srcGet404 = await req('GET', '/admin/api/pzn/source?fullPath=nope', { cookie });
    check('GET source of unknown page → 404', srcGet404.status === 404 && srcGet404.json.ok === false);

    // ── source POST — save draft only, no publish ──
    const saveDraft = await req('POST', '/admin/api/pzn/source', { cookie, body: { fullPath: 'source-target', source: GOOD_PZN } });
    check('POST source saves a real draft, returns parsed blocks', saveDraft.status === 200 && saveDraft.json.ok && saveDraft.json.blocks.some((b) => b.type === 'heading'));

    const draftBack = await req('GET', '/admin/api/pzn/source?fullPath=source-target&kind=draft', { cookie });
    check('draft round-trips the exact saved source', draftBack.status === 200 && draftBack.json.source.includes('שלום'));

    const pubBack = await req('GET', '/admin/api/pzn/source?fullPath=source-target&kind=published', { cookie });
    check('unpublished save does NOT touch the published copy (draft/published diverge)', pubBack.status === 200 && !String(pubBack.json.source || '').includes('שלום'));

    // ── source POST with publish:true — draft and published converge ──
    const savePublish = await req('POST', '/admin/api/pzn/source', { cookie, body: { fullPath: 'source-target', source: GOOD_PZN, publish: true } });
    check('POST source with publish:true succeeds', savePublish.status === 200 && savePublish.json.ok);
    const pubAfter = await req('GET', '/admin/api/pzn/source?fullPath=source-target&kind=published', { cookie });
    check('publish:true actually publishes — published now matches draft', pubAfter.json.source.includes('שלום'));

    // ── source POST with loose:true — extracts .pzn out of a prose-wrapped AI reply ──
    const looseWrapped = 'הנה התשובה:\n```\n' + GOOD_PZN + '\n```\nזהו.';
    const saveLoose = await req('POST', '/admin/api/pzn/source', { cookie, body: { fullPath: 'source-target', source: looseWrapped, loose: true } });
    check('POST source with loose:true extracts real .pzn from a wrapped AI reply', saveLoose.status === 200 && saveLoose.json.ok);

    // ── source POST strict-save failure → repair suggestion, no save happens ──
    const beforeBadSave = await req('GET', '/admin/api/pzn/source?fullPath=source-target&kind=draft', { cookie });
    const badSave = await req('POST', '/admin/api/pzn/source', { cookie, body: { fullPath: 'source-target', source: BROKEN_BUT_REPAIRABLE } });
    check('POST source with an unrecognized tag → 400 with a repair suggestion, not a crash', badSave.status === 400 && badSave.json.ok === false && badSave.json.repairable === true && /bent-text/.test(badSave.json.repairedSource));
    const afterBadSave = await req('GET', '/admin/api/pzn/source?fullPath=source-target&kind=draft', { cookie });
    check('a failed strict save never touches the existing draft', afterBadSave.json.source === beforeBadSave.json.source);

    // ── decompile — raw HTML input, no create, assets skipped (no network) ──
    const decompHtml = await req('POST', '/admin/api/pzn/decompile', { cookie, body: { html: RAW_HTML, assets: false } });
    check('decompile of raw HTML → real blocks, no page created (create not set)', decompHtml.status === 200 && decompHtml.json.ok && decompHtml.json.blocks > 0 && decompHtml.json.fullPath === null);
    check('decompile assets:false skips ingestion entirely', decompHtml.json.assets === null);

    // ── decompile — a BenTML-looking paste routes through the forgiving pipeline, not the HTML shredder ──
    const decompBentml = await req('POST', '/admin/api/pzn/decompile', { cookie, body: { html: GOOD_PZN, assets: false, create: true, title: 'מיובא מבנטיאמאל' } });
    check('decompile detects a BenTML paste and uses the forgiving pipeline (strategy bentml*)', decompBentml.status === 200 && decompBentml.json.ok && /bentml/.test(decompBentml.json.strategy));
    check('decompile with create:true actually creates the page', decompBentml.json.fullPath && decompBentml.json.created !== false);
    const decompPage = await req('GET', `/admin/api/pzn/source?fullPath=${decompBentml.json.fullPath}&kind=draft`, { cookie });
    check('the created page draft carries the decompiled source', decompPage.status === 200 && decompPage.json.source.includes('שלום'));

    // ── decompile — url/html both missing → 400 ──
    const decompBad = await req('POST', '/admin/api/pzn/decompile', { cookie, body: {} });
    check('decompile with neither url nor html → 400', decompBad.status === 400 && decompBad.json.ok === false);

    // ── ops — apply a real AST mutation to the existing draft ──
    const opsRes = await req('POST', '/admin/api/pzn/ops', {
      cookie,
      body: { fullPath: 'source-target', ops: [{ op: 'insert', type: 'text', overrides: { text: 'נוסף דרך ops' } }] }
    });
    check('POST ops applies a real insert to the draft', opsRes.status === 200 && opsRes.json.ok && opsRes.json.source.includes('נוסף דרך ops'));
    const opsMissing = await req('POST', '/admin/api/pzn/ops', { cookie, body: { fullPath: 'source-target' } });
    check('POST ops with no ops[] → 400, not a crash', opsMissing.status === 400 && opsMissing.json.ok === false);
    const opsUnknownPage = await req('POST', '/admin/api/pzn/ops', { cookie, body: { fullPath: 'does-not-exist', ops: [{ op: 'insert', type: 'text' }] } });
    check('POST ops against an unknown page → 400', opsUnknownPage.status === 400 && opsUnknownPage.json.ok === false);

    // ── create-from-source — happy path ──
    const createOk = await req('POST', '/admin/api/pzn/create-from-source', { cookie, body: { source: BOT_DOC } });
    check('create-from-source makes a brand-new page from bot-authored .pzn', createOk.status === 200 && createOk.json.ok && createOk.json.created === true && createOk.json.fullPath === 'from-bot');
    const createdLive = await req('GET', '/admin/api/pzn/source?fullPath=from-bot&kind=draft', { cookie });
    check('the created page draft carries the bot-authored source', createdLive.status === 200 && createdLive.json.source.includes('שלום מהבוט'));

    // ── create-from-source — empty source rejected ──
    const createEmpty = await req('POST', '/admin/api/pzn/create-from-source', { cookie, body: { source: '' } });
    check('create-from-source with empty source → 400', createEmpty.status === 400 && createEmpty.json.ok === false);

    // ── create-from-source — an empty document (title-only placeholder) is rejected with the Hebrew guidance message ──
    const createPlaceholder = await req('POST', '/admin/api/pzn/create-from-source', { cookie, body: { source: EMPTY_PLACEHOLDER_DOC } });
    check('create-from-source rejects a zero-block placeholder paste (v0.72 guard survived the move)', createPlaceholder.status === 400 && createPlaceholder.json.ok === false);

    // ── create-from-source — slug collision → 409 ──
    const createDup = await req('POST', '/admin/api/pzn/create-from-source', { cookie, body: { source: BOT_DOC } });
    check('create-from-source colliding with an existing slug → 409', createDup.status === 409 && createDup.json.ok === false);

    // ── v2.20: every door takes only the BenTML — either dialect, any wrapping ──
    const LINE_DOC = 'BENTML 0.2\n\nMETA {\n  title: "דף מילים"\n  slug: "from-words"\n  description: "תיאור לגוגל"\n}\n\nHEADING(level: 1) { שלום מהמילים }\n\nTEXT { פסקה }';
    const createLine = await req('POST', '/admin/api/pzn/create-from-source', { cookie, body: { source: 'Sure!\n```bentml\n' + LINE_DOC + '\n```\nEnjoy!' } });
    check('create-from-source builds a page from a fenced keyword-dialect reply', createLine.status === 200 && createLine.json.ok && createLine.json.fullPath === 'from-words' && createLine.json.dialect === 'line');
    const lineSrc = await req('GET', '/admin/api/pzn/source?fullPath=from-words&kind=draft', { cookie });
    check('the stored draft is the .pzn dialect — no fence, no chat, no BENTML header',
      lineSrc.status === 200 && /<bent-heading[^>]*>שלום מהמילים/.test(lineSrc.json.source) && !/```|BENTML 0\.2|Enjoy/.test(lineSrc.json.source));
    const linePage = await req('GET', '/admin/api/pages', { cookie });
    const fromWords = ((linePage.json && linePage.json.pages) || []).find((p) => p.full_path === 'from-words');
    const fromWordsMeta = fromWords && (typeof fromWords.meta === 'string' ? JSON.parse(fromWords.meta || '{}') : (fromWords.meta || {}));
    check('META description of a keyword document lands in the page index', !!fromWords && fromWordsMeta.description === 'תיאור לגוגל', JSON.stringify(fromWords && fromWords.meta));
    const chattyPzn = 'הנה הדף:\n```html\n' + fullDoc({ title: 'דף עם פטפוט', slug: 'chatty', body: '<bent-text id="c">תוכן</bent-text>' }) + '\n```\nPZN_READY\nמקווה שזה עוזר!';
    const createChatty = await req('POST', '/admin/api/pzn/create-from-source', { cookie, body: { source: chattyPzn } });
    check('create-from-source strips the fence and the chat around a .pzn reply', createChatty.status === 200 && createChatty.json.ok && createChatty.json.fullPath === 'chatty');
    const chattySrc = await req('GET', '/admin/api/pzn/source?fullPath=chatty&kind=draft', { cookie });
    check('the stored draft starts at <!DOCTYPE and ends at </html>',
      /^<!DOCTYPE html>/.test(chattySrc.json.source.trim()) && /<\/html>\s*$/.test(chattySrc.json.source) && !/PZN_READY|```/.test(chattySrc.json.source));
    const saveNoLoose = await req('POST', '/admin/api/pzn/source', { cookie, body: { fullPath: 'source-target', source: 'תשובה:\n```\n' + GOOD_PZN + '\n```\nסוף' } });
    check('POST source extracts even without loose:true', saveNoLoose.status === 200 && saveNoLoose.json.ok && Array.isArray(saveNoLoose.json.extracted) && saveNoLoose.json.extracted.length > 0);
    const saveLineDoc = await req('POST', '/admin/api/pzn/source', { cookie, body: { fullPath: 'source-target', source: '<html>\n' + LINE_DOC + '\n</html>' } });
    check('POST source accepts an <html>-wrapped keyword document', saveLineDoc.status === 200 && saveLineDoc.json.ok && saveLineDoc.json.dialect === 'line');
    const lineDraft = await req('GET', '/admin/api/pzn/source?fullPath=source-target&kind=draft', { cookie });
    check('…and stores it as a real tag document', /<bent-heading/.test(lineDraft.json.source) && !/BENTML 0\.2/.test(lineDraft.json.source));
    const brokenSave = await req('POST', '/admin/api/pzn/source', { cookie, body: { fullPath: 'source-target', source: '```\nBENTML 0.2\n\nMETA {\n  title: "x"\n}\n\nTEXTX { y }\n```' } });
    check('a broken keyword document fails the save with code + line + fix', brokenSave.status === 400 && brokenSave.json.code === 'E201' && brokenSave.json.line === 7 && !!brokenSave.json.fix);
    const decompLine = await req('POST', '/admin/api/pzn/decompile', { cookie, body: { html: 'Sure:\n```\n' + LINE_DOC + '\n```', assets: false } });
    check('decompile routes a fenced keyword-dialect paste through the forgiving pipeline', decompLine.status === 200 && decompLine.json.ok && /bentml/.test(decompLine.json.strategy) && decompLine.json.mapped === 2);
    const decompReal = await req('POST', '/admin/api/pzn/decompile', { cookie, body: { html: RAW_HTML, assets: false } });
    check('a plain HTML page still goes to the HTML decompiler, never mistaken for BenTML', decompReal.status === 200 && decompReal.json.ok && !/bentml/.test(decompReal.json.strategy));
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE PZN-PAGES-ROUTE: FAIL' : 'SMOKE PZN-PAGES-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
