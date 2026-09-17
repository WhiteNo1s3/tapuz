'use strict';

/**
 * v2.42 QA — Bridge V2 survives a Reload WITH the tab that was open (0.5.5),
 * measured in a real Chrome, not a vm.
 *
 *   node scripts/smoke-bridge-reload.js            # finds google-chrome / chromium
 *   CHROME=/path/to/chrome node scripts/smoke-bridge-reload.js
 *
 * The bug this pins (HARD-BATTERY-v2, 2026-09-17, "reconnect is flaky after
 * extension sync"): ↻ Reload on chrome://extensions — or the Bridge folder
 * synced by `Update Bridge.command` and then reloaded — left the admin tab
 * that was open with an ORPHANED content script. Chrome invalidates that
 * script's extension context but leaves it running: `chrome.runtime.id` is
 * undefined there and `runtime.connect` / `sendMessage` throw "Extension
 * context invalidated" (measured on Chrome 148). The orphan still answered
 * pings, so the page believed the bridge was present, and then swallowed
 * every request — the model-list probe hung with no result at all, chat
 * came back "extension unavailable". Only a page refresh or a forced
 * connect from the popup helped.
 *
 * What is proven here, with the REAL worker, content bridge and page glue:
 *   1. a connected site's open tab talks to the bridge (hello, a relay)
 *   2. chrome.runtime.reload() — the dynamic registration is dropped by
 *      Chrome (that is why the record exists) and the record survives
 *   3. NOTHING is touched — no page refresh, no popup — and ~1.5 s later
 *      the same tab is on a NEW bridge instance: the worker injected it on
 *      boot, the orphan said bye and fell silent
 *   4. a relay through the revived tab works
 *   5. a request fired 50 ms after the Reload, while the orphan is alone,
 *      is answered too (the page glue re-posts what the orphan swallowed)
 *   6. exactly ONE result per request — the orphan never double-answers
 *
 * The extension is loaded over the CDP pipe (Extensions.loadUnpacked):
 * branded Chrome 137+ ignores --load-extension, which is why the battery
 * had to use Chrome for Testing. The site is `http://site.test:<port>` via
 * --host-resolver-rules (a non-loopback host, like the hosted site), wired
 * into the manifest the way the ZIP from /admin/ai-setup wires it — the
 * only way to hold the site's host permission in a headless Chrome, where
 * permissions.request shows a prompt nobody can click (measured: the
 * promise never settles). The dynamic record path is proven in the vm run
 * of smoke-extension-v2a. LM Studio is a fake on 127.0.0.1:1234 answering
 * /v1/models. Opt-in: skips with exit 0 when no Chrome is found.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execSync } = require('child_process');

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']) {
    try { return execSync('command -v ' + name, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; } catch (e) { /* next */ }
  }
  return null;
}
const CHROME = findChrome();
if (!CHROME) {
  console.log('SMOKE BRIDGE-RELOAD: SKIPPED (no Chrome found — set CHROME=/path/to/chrome to run the Reload scenario in a real browser)');
  process.exit(0);
}

const REPO = path.join(__dirname, '..');
const SITE_PORT = Number(process.env.SMOKE_SITE_PORT) || 4326;
const LM_PORT = 1234; // the extension's default endpoint — the fake LM Studio must sit there

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── a CDP client over --remote-debugging-pipe (fd 3 → Chrome, fd 4 ← Chrome, NUL-separated JSON) ── */
class CDP {
  constructor(input, output) {
    this.input = input;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = [];
    let buf = '';
    output.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\0')) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!raw) continue;
        let m;
        try { m = JSON.parse(raw); } catch (e) { continue; }
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id);
          this.pending.delete(m.id);
          if (m.error) reject(new Error(m.error.message + ' ' + (m.error.data || '')));
          else resolve(m.result);
        } else if (m.method) {
          for (const l of this.listeners) l(m);
        }
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.input.write(JSON.stringify(msg) + '\0');
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

/** The Chrome build of the bridge, wired to site.test — the bytes /admin/ai-setup
 *  serves. Plus the host grant for other.test WITHOUT a static script: the state
 *  an owner leaves behind by clicking "connect this site" in the popup (a grant
 *  and a dynamic registration), which a headless Chrome cannot produce itself. */
function buildExtension(dir) {
  const { extensionBuild, buildFiles } = require('../src/extension-build');
  const b = extensionBuild('bridge', 'chrome', 'site.test');
  b.manifest.host_permissions.push('http://other.test/*');
  b.manifestText = JSON.stringify(b.manifest, null, 2) + '\n';
  fs.mkdirSync(dir, { recursive: true });
  for (const f of buildFiles(b)) fs.writeFileSync(path.join(dir, f.rel), f.data);
  return b.manifest.version;
}

/** The hosted "admin" page: the real page glue, and a log of every bridge message. */
function startSite(port) {
  const glue = fs.readFileSync(path.join(REPO, 'public', 'admin-bridge.js'), 'utf8');
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>admin</title></head><body>' +
    '<script>window.__tzLog=[];window.addEventListener("message",function(ev){var m=ev.data;if(!m||m.source!=="tapuziel-bridge")return;' +
    'window.__tzLog.push({type:m.type,id:m.id||"",ok:m.ok,instance:m.instance||""});});</script>' +
    '<script src="/admin-bridge.js"></script></body></html>';
  const srv = http.createServer((req, res) => {
    if (req.url === '/admin-bridge.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(glue); }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  });
  return new Promise((resolve, reject) => { srv.on('error', reject); srv.listen(port, '127.0.0.1', () => resolve(srv)); });
}

/** A fake LM Studio: /v1/models only — the relay is what is measured, not a model. */
function startFakeLm(port) {
  const srv = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'smoke-model' }] }));
  });
  return new Promise((resolve, reject) => { srv.on('error', reject); srv.listen(port, '127.0.0.1', () => resolve(srv)); });
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-bridge-reload-'));
  const ext = path.join(tmp, 'extension');
  const profile = path.join(tmp, 'profile');
  const version = buildExtension(ext);
  const site = await startSite(SITE_PORT);
  let lm;
  try {
    lm = await startFakeLm(LM_PORT);
  } catch (e) {
    console.log('SMOKE BRIDGE-RELOAD: SKIPPED (127.0.0.1:' + LM_PORT + ' is taken — probably a real LM Studio; stop it to run the Reload scenario)');
    site.close();
    process.exit(0);
  }

  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-pipe', '--user-data-dir=' + profile,
    '--host-resolver-rules=MAP site.test 127.0.0.1',
    '--enable-unsafe-extension-debugging',
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const cdp = new CDP(proc.stdio[3], proc.stdio[4]);
  const finish = async () => {
    await cdp.send('Browser.close').catch(() => {});
    proc.kill();
    site.close();
    lm.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  const bail = setTimeout(async () => { console.log('FAIL the scenario did not finish in 90 s'); await finish(); process.exit(1); }, 90000);

  const ver = await cdp.send('Browser.getVersion');
  console.log('chrome: ' + ver.product + ' · bridge ' + version);
  const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: ext });
  check('the wired Chrome build loads over the CDP pipe (Extensions.loadUnpacked)', /^[a-p]{32}$/.test(extId));

  await cdp.send('Target.setDiscoverTargets', { discover: true });
  const targets = async () => (await cdp.send('Target.getTargets')).targetInfos;
  async function findWorker(not) {
    for (let i = 0; i < 100; i++) {
      const t = (await targets()).find((x) => x.type === 'service_worker' && /background\.js/.test(x.url) && x.targetId !== not);
      if (t) return t;
      await sleep(100);
    }
    throw new Error('no worker target');
  }
  async function attach(targetId) {
    const r = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, r.sessionId).catch(() => {});
    return r.sessionId;
  }
  async function evalIn(sid, expression) {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid);
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  }

  let worker = await findWorker();
  let ws = await attach(worker.targetId);
  // a dynamic registration beside the manifest's static one: proves Chrome drops it on Reload and the record brings it back
  await evalIn(ws, `(async () => {
    await chrome.scripting.registerContentScripts([{ id: 'tz-bridge-other-test-smoke', js: ['content-bridge.js'], matches: ['http://other.test/*'], runAt: 'document_idle', persistAcrossSessions: true }]);
    await chrome.storage.local.set({ sites: [{ id: 'tz-bridge-other-test-smoke', pattern: 'http://other.test/*' }] });
    return 'ok';
  })()`);
  const regsBefore = await evalIn(ws, `chrome.scripting.getRegisteredContentScripts().then(r => JSON.stringify(r.map(s => s.id)))`);
  check('a recorded dynamic registration is live before the Reload', regsBefore === '["tz-bridge-other-test-smoke"]');

  // ── 1. the open tab ──
  const tab = await cdp.send('Target.createTarget', { url: 'http://site.test:' + SITE_PORT + '/admin/chat' });
  const ss = await attach(tab.targetId);
  await sleep(1500);
  const state = () => evalIn(ss, `JSON.stringify({ present: !!(window.TapuzBridge && window.TapuzBridge.present), instance: window.TapuzBridge.instance, version: window.TapuzBridge.version, models: window.TapuzBridge.models })`).then(JSON.parse);
  const relay = async (waitMs) => {
    await evalIn(ss, `window.__tzLog = []; window.__tzOut = null; window.TapuzBridge.call('/v1/models', null, 8000).then(function (d) { window.__tzOut = { ok: true, ids: d.data.map(function (x) { return x.id; }) }; }, function (e) { window.__tzOut = { ok: false, error: e.message }; }); 'sent'`);
    await sleep(waitMs || 1200);
    return evalIn(ss, `JSON.stringify({ out: window.__tzOut, results: window.__tzLog.filter(function (m) { return m.type === 'tz-local-llm-result'; }).length })`).then(JSON.parse);
  };
  const s1 = await state();
  check('1. the open admin tab hears the bridge (hello with version ' + version + ' and an instance id)',
    s1.present === true && s1.version === version && typeof s1.instance === 'string' && s1.instance.length > 0);
  const r1 = await relay();
  check('1. a relay through the tab reaches the fake LM Studio', r1.out && r1.out.ok === true && r1.out.ids[0] === 'smoke-model' && r1.results === 1);

  // ── 2. Reload ──
  const oldWorker = worker.targetId;
  const t0 = Date.now();
  cdp.send('Runtime.evaluate', { expression: 'chrome.runtime.reload()' }, ws).catch(() => {});
  worker = await findWorker(oldWorker);
  ws = await attach(worker.targetId);
  await sleep(1500);
  const afterReload = await evalIn(ws, `(async () => ({
    regs: (await chrome.scripting.getRegisteredContentScripts()).map(s => s.id),
    sites: (await chrome.storage.local.get(['sites'])).sites || null
  }))()`);
  check('2. after the Reload the record survived and the recorded site is registered again by the new worker',
    Array.isArray(afterReload.sites) && afterReload.sites[0].pattern === 'http://other.test/*' &&
    afterReload.regs.includes('tz-bridge-other-test-smoke'));

  // ── 3. nothing touched ──
  const s3 = await state();
  const elapsed = Date.now() - t0;
  check('3. ~' + elapsed + ' ms after the Reload, with no refresh and no popup, the SAME tab is on a NEW bridge instance',
    s3.present === true && s3.instance && s3.instance !== s1.instance && s3.version === version);
  const byes = await evalIn(ss, `JSON.stringify(window.__tzLog.filter(function (m) { return m.type === 'tz-bridge-bye'; }).map(function (m) { return m.instance; }))`).then(JSON.parse);
  check('3. the orphaned copy said bye under its OLD instance id and went silent', byes.length === 1 && byes[0] === s1.instance);

  // ── 4. a relay works again ──
  const r4 = await relay();
  check('4. a relay through the revived tab works — exactly one result, from the fresh copy',
    r4.out && r4.out.ok === true && r4.results === 1);

  // ── 5. a request in the gap: fired 50 ms after the Reload, before the worker could revive the tab ──
  const oldWorker2 = worker.targetId;
  cdp.send('Runtime.evaluate', { expression: 'chrome.runtime.reload()' }, ws).catch(() => {});
  await sleep(50);
  const r5 = await relay(3000);
  worker = await findWorker(oldWorker2);
  ws = await attach(worker.targetId);
  const s5 = await state();
  check('5. a request fired while the orphan was alone is still answered (re-posted to the fresh copy) — once',
    r5.out && r5.out.ok === true && r5.results === 1 && s5.instance !== s3.instance);

  // ── 6. the popup reports the revived tab ──
  const popup = await cdp.send('Target.createTarget', { url: 'chrome-extension://' + extId + '/popup.html' });
  const ps = await attach(popup.targetId);
  await sleep(1200);
  const status = await evalIn(ps, `document.getElementById('status').textContent`);
  check('6. the popup, opened after the Reload, says the bridge is active in the open tab', /הגשר פעיל ב-1 טאב פתוח/.test(status));

  clearTimeout(bail);
  await finish();
  console.log('');
  console.log(fail ? 'SMOKE BRIDGE-RELOAD: FAIL' : 'SMOKE BRIDGE-RELOAD: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('FAIL scenario threw: ' + (e && e.stack || e));
  console.log('');
  console.log('SMOKE BRIDGE-RELOAD: FAIL');
  process.exit(1);
});
