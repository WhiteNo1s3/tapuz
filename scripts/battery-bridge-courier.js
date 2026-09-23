'use strict';

/**
 * The extension courier (v2.58) — the battery drives the REAL Bridge V2 in a
 * real headless Chrome, through the copilot's REAL screen.
 *
 * Ben (2026-09-23): "make the check for the functionality of the provided
 * extension for the lm studio bridge to happen." The relay courier plays
 * the Bridge in twelve lines of Node; it proves the protocol, not the
 * extension. This courier proves the extension: the wired Chrome build
 * (the bytes /admin/ai-setup serves, wired to `site.test` the way the ZIP is
 * wired to the owner's host) is loaded over the CDP pipe into a headless
 * Chrome, the scratch CMS is reached as `http://site.test:<port>` — a
 * non-loopback host, like the hosted site — and every owner sentence is
 * TYPED into /admin/chat and SENT with the page's own button. The page
 * glue (admin-bridge.js) hands each model call to the content script, the
 * worker streams it from LM Studio on loopback, the page posts the step
 * back, and the approval is a CLICK on the card. The battery reads nothing
 * from the model's words: the site's tables judge, as always.
 *
 * What is recorded per call, from inside the page: which model answered
 * (the reply's `model` — the battery refuses a stranger), how many
 * progress frames the bridge streamed (proof it streamed, not buffered),
 * seconds, and completion tokens. Per turn: every envelope the page
 * received from /admin/api/ai/chat, in order — the same envelopes the relay
 * courier sees, so the judges and the transcript do not change.
 *
 * Chrome is found like scripts/smoke-bridge-reload.js finds it (CHROME=…,
 * PATH, or the Mac's /Applications). No Chrome = the courier refuses before
 * anything is spawned.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const MENU_KEY = '::menu::'; // public/admin-chat.js — the dropdown's value for the menu canvas

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']) {
    try { const p = execSync('command -v ' + name, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); if (p) return p; } catch (e) { /* next */ }
  }
  for (const p of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The recorder, installed in the chat page after it loads: every envelope
 *  from /admin/api/ai/chat, every relayed call with who answered it and how
 *  many frames it streamed. Plain ES5 — it runs inside the page. */
const RECORDER = `(function () {
  if (window.__tz) return 'already';
  window.__tz = { turns: [], calls: [], progress: 0 };
  var of = window.fetch;
  window.fetch = function (u, o) {
    var p = of.apply(this, arguments);
    if (String(u).indexOf('/admin/api/ai/chat') >= 0) {
      p.then(function (r) { r.clone().json().then(function (j) { window.__tz.turns.push(j); }).catch(function () {}); }).catch(function () {});
    }
    return p;
  };
  var B = window.TapuzBridge;
  var oc = B.call;
  B.call = function (path, body, timeoutMs, onProgress) {
    var t0 = Date.now();
    var rec = { path: path, model: '', tokens: 0, seconds: 0, progress: 0, status: 'pending' };
    if (path === '/v1/chat/completions') window.__tz.calls.push(rec);
    var on2 = function (x) { rec.progress++; window.__tz.progress++; if (onProgress) onProgress(x); };
    return oc.call(this, path, body, timeoutMs, on2).then(function (r) {
      rec.seconds = (Date.now() - t0) / 1000; rec.model = (r && r.model) || ''; rec.tokens = (r && r.usage && r.usage.completion_tokens) || 0; rec.status = 'ok'; return r;
    }, function (e) { rec.seconds = (Date.now() - t0) / 1000; rec.status = 'error: ' + ((e && e.message) || e); throw e; });
  };
  return 'installed';
})()`;

class BridgeCourier {
  /**
   * @param {{ port: number, cookie: { name: string, value: string }, llmBase?: string, model?: string, siteHost?: string, log?: (s: string) => void }} opts
   */
  constructor(opts) {
    this.port = opts.port;
    this.cookie = opts.cookie;
    this.llmBase = String(opts.llmBase || '').replace(/\/v1\/?$/, '').replace(/\/+$/, '');
    this.model = opts.model || '';
    this.siteHost = opts.siteHost || 'site.test';
    this.say_ = opts.log || (() => {});
    this.base = 'http://' + this.siteHost + ':' + this.port;
    this.chrome = '';
    this.version = '';
    this.window = null;
    this.calls = 0;
  }

  async start() {
    const chromePath = findChrome();
    if (!chromePath) throw new Error('no Chrome found — set CHROME=/path/to/chrome');
    this.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-battery-bridge-'));
    const ext = path.join(this.tmp, 'extension');
    const profile = path.join(this.tmp, 'profile');
    const { extensionBuild, buildFiles } = require('../src/extension-build');
    const b = extensionBuild('bridge', 'chrome', this.siteHost);
    fs.mkdirSync(ext, { recursive: true });
    for (const f of buildFiles(b)) fs.writeFileSync(path.join(ext, f.rel), f.data);
    this.version = b.manifest.version;
    this.proc = spawn(chromePath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-pipe', '--user-data-dir=' + profile,
      '--host-resolver-rules=MAP ' + this.siteHost + ' 127.0.0.1',
      '--enable-unsafe-extension-debugging',
      '--window-size=1280,900',
      'about:blank'
    ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    this.cdp = new CDP(this.proc.stdio[3], this.proc.stdio[4]);
    const ver = await this.cdp.send('Browser.getVersion');
    this.chrome = ver.product;
    const { id: extId } = await this.cdp.send('Extensions.loadUnpacked', { path: ext });
    this.extId = extId;
    await this.cdp.send('Target.setDiscoverTargets', { discover: true });
    // the worker: point it at a runtime on another port (the extension's default is :1234)
    const defaultBase = 'http://127.0.0.1:1234';
    if (this.llmBase && this.llmBase !== defaultBase && this.llmBase !== 'http://localhost:1234') {
      const worker = await this.findWorker();
      const ws = await this.attach(worker.targetId);
      await this.evalIn(ws, `chrome.storage.local.set(${JSON.stringify({ llm_base: this.llmBase })}).then(function () { return 'ok'; })`);
    }
    // the page — the owner's cookie, set before the first navigation
    const tab = await this.cdp.send('Target.createTarget', { url: 'about:blank' });
    this.sid = await this.attach(tab.targetId);
    await this.cdp.send('Network.enable', {}, this.sid);
    await this.cdp.send('Page.enable', {}, this.sid);
    await this.cdp.send('Network.setCookie', { name: this.cookie.name, value: this.cookie.value, domain: this.siteHost, path: '/', httpOnly: true }, this.sid);
    await this.open('');
  }

  async findWorker() {
    for (let i = 0; i < 100; i++) {
      const t = (await this.cdp.send('Target.getTargets')).targetInfos.find((x) => x.type === 'service_worker' && x.url === 'chrome-extension://' + this.extId + '/background.js');
      if (t) return t;
      await sleep(100);
    }
    throw new Error('the extension worker never appeared');
  }
  async attach(targetId) {
    const r = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await this.cdp.send('Runtime.enable', {}, r.sessionId).catch(() => {});
    return r.sessionId;
  }
  async evalIn(sid, expression) {
    const r = await this.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid);
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  }
  page(expression) { return this.evalIn(this.sid, expression); }

  /** A fresh chat page (a new conversation): `qs` names the canvas the way the
   *  page's own URL does (`?page=<slug>` / `?canvas=menu`), then the recorder
   *  goes in and the bridge is awaited — present, and its window probe settled. */
  async open(qs) {
    await this.cdp.send('Page.navigate', { url: this.base + '/admin/chat' + (qs || '') }, this.sid);
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      await sleep(200);
      ready = await this.page(`document.readyState === 'complete' && !!window.TapuzBridge && !!document.getElementById('chat-input')`).catch(() => false);
    }
    if (!ready) throw new Error('the chat page did not load at ' + this.base + '/admin/chat');
    await this.page(RECORDER);
    let state = null;
    for (let i = 0; i < 150; i++) {
      state = JSON.parse(await this.page(`JSON.stringify({ present: !!(window.TapuzBridge && window.TapuzBridge.present), settled: !!window.TapuzBridge.windowSettled, window: window.TapuzBridge.window, version: window.TapuzBridge.version, models: window.TapuzBridge.models })`));
      if (state.present && state.settled) break;
      await sleep(200);
    }
    if (!state || !state.present) throw new Error('the Bridge never announced itself on the chat page (no hello in 30 s)');
    this.window = state.window;
    this.models = state.models || [];
    if (state.version && state.version !== this.version) this.version = state.version;
    // the page's own probe reports the loaded window; give the settings chip a moment
    await sleep(500);
    this.canvasNow = await this.page(`document.getElementById('cp-page-select').value`).catch(() => '');
    return state;
  }

  /** Put the scenario's canvas in front of the copilot the way the owner does: the dropdown. */
  async canvas(context) {
    const want = context && context.canvas === 'menu' ? MENU_KEY : (context && context.canvas === 'page' ? String(context.page || '') : '');
    if (want === this.canvasNow) return;
    // a page made after the dropdown was filled is not in it — reload the page with the URL naming it
    const listed = await this.page(`!!Array.from(document.getElementById('cp-page-select').options).find(function (o) { return o.value === ${JSON.stringify(want)}; })`);
    if (!listed && want && want !== MENU_KEY) {
      await this.open('?page=' + encodeURIComponent(want));
    } else {
      await this.page(`(function () { var s = document.getElementById('cp-page-select'); s.value = ${JSON.stringify(want)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
    }
    // a page canvas loads the builder in a frame; give it a moment to be there (the copilot saves it before every turn)
    for (let i = 0; i < 40; i++) {
      const ok = await this.page(`(function () { var s = document.getElementById('cp-page-select'); if (s.value !== ${JSON.stringify(want)}) return false; if (!${JSON.stringify(want)} || ${JSON.stringify(want)} === ${JSON.stringify(MENU_KEY)}) return true; var f = document.getElementById('cp-canvas-frame'); try { return !f.hidden && !!f.contentDocument && f.contentDocument.readyState === 'complete' && !!f.contentWindow.TapuzBuilder; } catch (e) { return false; } })()`).catch(() => false);
      if (ok) break;
      await sleep(250);
    }
    this.canvasNow = want;
  }

  /** Type the sentence into the composer and press the page's Send. Resolves
   *  with every envelope the page received for this turn, in order. */
  async say(message, context) {
    await this.canvas(context || { canvas: 'blank' });
    const before = await this.page(`window.__tz.turns.length`);
    await this.page(`(function () { var i = document.getElementById('chat-input'); i.value = ${JSON.stringify(message)}; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('btn-send').click(); return 'sent'; })()`);
    return this.waitTurn(before);
  }

  /** Click ✓ (or ✕) on the open card — the owner's own gate. */
  async answer(pendingId, ok) {
    const before = await this.page(`window.__tz.turns.length`);
    const clicked = await this.page(`(function () {
      var btns = Array.from(document.querySelectorAll('#chat-log .bubble [data-ok="${ok ? 1 : 0}"]')).filter(function (b) { return !b.disabled; });
      if (!btns.length) return 'no open card';
      btns[btns.length - 1].click(); return 'clicked';
    })()`);
    if (clicked !== 'clicked') throw new Error('bridge courier: ' + clicked + ' to answer (pending ' + pendingId + ')');
    return this.waitTurn(before);
  }

  /** The turn is over when the composer is unlocked again and the last
   *  envelope carries no continuation. A local model may read for minutes. */
  async waitTurn(before, maxMs = 25 * 60 * 1000) {
    const t0 = Date.now();
    for (;;) {
      await sleep(1200);
      const s = JSON.parse(await this.page(`JSON.stringify({ n: window.__tz.turns.length, busy: document.getElementById('chat-input').disabled, last: (function () { var t = window.__tz.turns; var l = t[t.length - 1]; return l ? { ok: l.ok, cont: !!l.modelCall } : null; })() })`));
      if (s.n > before && !s.busy && s.last && !s.last.cont) break;
      if (s.n > before && !s.busy && s.last && s.last.ok === false) break;
      if (Date.now() - t0 > maxMs) throw new Error('bridge courier: the turn did not end in ' + Math.round(maxMs / 60000) + ' minutes');
    }
    const seq = JSON.parse(await this.page(`JSON.stringify(window.__tz.turns.slice(${before}))`));
    return seq;
  }

  /** What the bridge relayed since the last time it was asked. */
  async drain() {
    const calls = JSON.parse(await this.page(`JSON.stringify(window.__tz.calls.splice(0))`));
    this.calls += calls.length;
    return calls;
  }

  async stop() {
    try { if (this.cdp) await this.cdp.send('Browser.close'); } catch (e) { /* closing */ }
    try { if (this.proc) this.proc.kill(); } catch (e) { /* gone */ }
    try { if (this.tmp) fs.rmSync(this.tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { /* profile still writing */ }
  }
}

module.exports = { BridgeCourier, findChrome, MENU_KEY };
