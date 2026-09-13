'use strict';

/**
 * v2.27 QA — the effect GUARD, executed.
 *
 * Ben: "I run it in Firefox — it built a theme using bentml and made a
 * mouse; it freezes and looks sloppy, we cannot allow that." The guard
 * (theme.renderThemeEffectsJs) is the padded room a chat-written effect runs
 * in on every live page. Grepping the wrapper for markers proves nothing
 * about a freeze; this smoke RUNS it in a hand-driven fake window — events
 * with capture ordering, rAF and timers stepped by hand, performance.now
 * under test control — against the effects chats actually write:
 *   • a node per mousemove, never removed (the Firefox freeze)  → stopped
 *   • a pooled trail, one rAF loop                                → left alone
 *   • prefers-reduced-motion                                      → skipped
 *   • a throw, a slow handler, stalled frames, a 1ms interval     → caught
 *   • framed by the admin, written against parent/top (v2.29)     → kept
 *     on its own page, the management system untouched
 */

const vm = require('vm');
const theme = require('../src/theme');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function makeWindow(opts = {}) {
  let now = 0;
  let tid = 0;
  const logs = [];
  const posted = [];
  const listeners = { window: [], document: [] };
  const rafQueue = [];
  const timers = [];
  function el(tag) {
    return {
      tagName: String(tag).toUpperCase(), attrs: {}, parentNode: null, children: [], style: {}, className: '',
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k]; },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      classList: { add() {}, remove() {}, toggle() {} }
    };
  }
  function walk(n, out = []) { for (const c of n.children) { out.push(c); walk(c, out); } return out; }
  const body = el('body');
  const documentElement = el('html');
  const document = {
    hidden: false, body, documentElement,
    createElement: (t) => el(t),
    querySelectorAll: (sel) => (sel === '[data-tapuz-fx]' ? walk(body).filter((n) => 'data-tapuz-fx' in n.attrs) : []),
    querySelector: () => null,
    getElementById: () => null,
    addEventListener(type, fn, opt) { listeners.document.push({ type, fn, capture: opt === true || !!(opt && opt.capture) }); },
    removeEventListener(type, fn) { const i = listeners.document.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) listeners.document.splice(i, 1); }
  };
  const win = {
    document, location: { origin: 'http://fake.test', pathname: '/', search: '' },
    performance: { now: () => now },
    matchMedia: (q) => ({ matches: /reduce/.test(q) && !!opts.reduceMotion }),
    requestAnimationFrame(cb) { rafQueue.push(cb); return rafQueue.length; },
    cancelAnimationFrame() {},
    setTimeout(cb, ms) { const id = ++tid; timers.push({ id, cb, at: now + (Number(ms) || 0), every: 0 }); return id; },
    setInterval(cb, ms) { const id = ++tid; timers.push({ id, cb, at: now + (Number(ms) || 0), every: Number(ms) || 0 }); return id; },
    clearTimeout(id) { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    clearInterval(id) { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    addEventListener(type, fn, opt) { listeners.window.push({ type, fn, capture: opt === true || !!(opt && opt.capture) }); },
    removeEventListener(type, fn) { const i = listeners.window.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) listeners.window.splice(i, 1); },
    postMessage(msg) { posted.push(msg); },
    innerWidth: 1200, innerHeight: 800,
    __burn(ms) { now += ms; }
  };
  win.window = win; win.self = win; win.globalThis = win;
  // framed = inside an admin preview frame: the parent is the management
  // system, with a body of its own an effect must never reach (v2.29)
  const adminBody = el('body');
  win.parent = opts.framed ? { postMessage(msg) { posted.push(msg); }, document: { body: adminBody } } : win;
  if (opts.framed) { win.top = win.parent; win.frameElement = el('iframe'); win.opener = win.parent; document.defaultView = win; }
  function dispatch(type, extra) {
    const ev = { type, timeStamp: now, stopped: false, clientX: 1, clientY: 1, ...(extra || {}),
      stopImmediatePropagation() { this.stopped = true; }, stopPropagation() { this.stopped = true; }, preventDefault() {} };
    const run = (list, cap, target) => {
      for (const l of list.slice()) {
        if (l.type !== type || l.capture !== cap) continue;
        l.fn.call(target, ev);
        if (ev.stopped) return true;
      }
      return false;
    };
    if (run(listeners.window, true, win)) return ev;
    if (run(listeners.document, true, document)) return ev;
    if (run(listeners.document, false, document)) return ev;
    run(listeners.window, false, win);
    return ev;
  }
  function runTimers() {
    for (const t of timers.slice()) {
      if (t.at > now) continue;
      if (t.every) t.at = now + t.every; else timers.splice(timers.indexOf(t), 1);
      t.cb();
    }
  }
  function frame(dt = 16) { now += dt; const q = rafQueue.splice(0); for (const cb of q) cb(now); runTimers(); }
  const sandbox = {
    window: win, document, location: win.location, performance: win.performance,
    console: { warn: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)), log: (m) => logs.push(String(m)) },
    requestAnimationFrame: win.requestAnimationFrame, setTimeout: win.setTimeout, setInterval: win.setInterval,
    clearTimeout: win.clearTimeout, clearInterval: win.clearInterval
  };
  return { win, document, dispatch, frame, logs, posted, sandbox, adminBody, live: () => document.querySelectorAll('[data-tapuz-fx]').length,
    docListeners: () => listeners.document.length };
}

/** The effect as the page carries it, run in the fake window. */
function run(js, opts) {
  const w = makeWindow(opts);
  const tag = theme.renderThemeEffectsJs({ effects: { js } });
  const code = tag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
  vm.runInNewContext(code, w.sandbox, { filename: 'effect-guard.js' });
  return w;
}

const RUNAWAY = `(function () {
  document.addEventListener('mousemove', function (e) {
    var d = document.createElement('div'); d.className = 'dot';
    d.style.left = e.clientX + 'px'; document.body.appendChild(d);
  });
})();`;

const POOLED = `(function () {
  var dots = [], N = 20, x = 0, y = 0;
  for (var i = 0; i < N; i++) { var d = document.createElement('span'); d.className = 'tz-dot'; document.body.appendChild(d); dots.push(d); }
  document.addEventListener('mousemove', function (e) { x = e.clientX; y = e.clientY; });
  function loop() { for (var i = 0; i < dots.length; i++) dots[i].style.transform = 'translate(' + x + 'px,' + y + 'px)'; requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
})();`;

const SLOW = `(function () {
  document.addEventListener('mousemove', function () { window.__burn(80); });
})();`;

const TICKER = `(function () {
  window.__ticks = 0;
  setInterval(function () { window.__ticks++; }, 1);
})();`;

// ── the wrapper itself ───────────────────────────────────────────────
const tag = theme.renderThemeEffectsJs({ effects: { js: 'throw new Error("boom")' } });
check('the effect script is one identified tag, guarded (try/catch, error parked, findable log tag)',
  /^<script id="tapuz-theme-effects">/.test(tag) && /try \{/.test(tag) && /__tapuzThemeEffectError/.test(tag) && /\[tapuz-theme-effects\]/.test(tag));
check('the guard shadows the globals the effect reaches for (window, document, rAF, timers, listeners)',
  /\(function \(window, document, self, globalThis, addEventListener, removeEventListener, requestAnimationFrame, setTimeout, setInterval, parent, top, opener, frameElement\)/.test(tag));
check('no effect → no script at all', theme.renderThemeEffectsJs({}) === '');

// ── 1. the runaway creator (the Firefox freeze) ──────────────────────
{
  const w = run(RUNAWAY);
  for (let i = 0; i < 10; i++) w.dispatch('mousemove');
  check('the pace: ten mousemoves in one frame reach the effect once', w.live() === 1);
  for (let i = 0; i < 700; i++) { w.frame(16); w.dispatch('mousemove'); }
  w.frame(16);
  check('a node-per-mousemove effect is stopped by the live-node budget and its nodes are removed',
    !!w.win.__tapuzFx.killed && /400/.test(w.win.__tapuzFx.killed) && w.live() === 0);
  const before = w.live();
  for (let i = 0; i < 20; i++) { w.frame(16); w.dispatch('mousemove'); }
  check('after the stop, motion events no longer reach the effect', w.live() === before);
  check('the stop is logged under the findable tag', w.logs.some((l) => /\[tapuz-theme-effects\]/.test(l)));
  check('G.stop() is exposed for the studio', typeof w.win.__tapuzFx.stop === 'function');
}

// ── 2. a well-behaved pooled trail lives forever ─────────────────────
{
  const w = run(POOLED);
  for (let i = 0; i < 3000; i++) { w.frame(16); if (i % 2) w.dispatch('mousemove', { clientX: i, clientY: i }); }
  check('a pooled trail (20 nodes, one rAF loop) is never stopped', !w.win.__tapuzFx.killed && w.live() === 20);
}

// ── 3. reduced motion ────────────────────────────────────────────────
{
  const w = run(POOLED, { reduceMotion: true });
  check('prefers-reduced-motion: the effect is skipped entirely (no nodes, no listeners)',
    w.win.__tapuzFx.skipped === 'reduced-motion' && w.live() === 0 && w.docListeners() === 0);
}

// ── 4. a throw at load ───────────────────────────────────────────────
{
  const w = run('throw new Error("boom")');
  check('a throw at load is caught, tagged and parked for the canvas',
    w.win.__tapuzThemeEffectError === 'boom' && w.logs.some((l) => /\[tapuz-theme-effects\]/.test(l)));
}

// ── 5. a slow handler ────────────────────────────────────────────────
{
  const w = run(SLOW, { framed: true });
  for (let i = 0; i < 6; i++) { w.frame(16); w.dispatch('mousemove'); }
  check('a handler that keeps taking >50ms stops the effect and tells the framing studio',
    /50ms/.test(w.win.__tapuzFx.killed || '') && w.posted.some((m) => m && m.type === 'tapuz-theme-preview' && m.killed));
}

// ── 6. stalled frames — the watchdog ─────────────────────────────────
{
  const w = run(POOLED);
  for (let i = 0; i < 5; i++) w.frame(400);
  check('four stalled frames (>250ms) inside ten seconds stop the effect', /קפא/.test(w.win.__tapuzFx.killed || ''));
  const w2 = run(POOLED);
  w2.frame(16); w2.frame(6000); w2.frame(16);
  check('a single long gap (a hidden tab coming back) is NOT a freeze', !w2.win.__tapuzFx.killed);
}

// ── 7. intervals are paced ───────────────────────────────────────────
{
  const w = run(TICKER);
  for (let i = 0; i < 10; i++) w.frame(16);
  check('setInterval(fn, 1) is paced to 16ms (≈10 ticks in 160ms, not 160)', w.win.__ticks >= 8 && w.win.__ticks <= 12);
}

// ── 8. its own page — framed by the admin (v2.29) ────────────────────
// Ben: "make the effects … not interfere with the management system". The
// studio canvas, the builder's device preview and the menu preview frame the
// site inside the admin; an overlay written against parent/top landed there.
{
  const ESCAPE = `(function () {
    var host = (window.parent && window.parent.document) || document;
    host.body.appendChild(document.createElement('div'));
    top.document.body.appendChild(document.createElement('i'));
    parent.document.body.appendChild(document.createElement('u'));
    document.defaultView.parent.document.body.appendChild(document.createElement('b'));
    window.__fx = { frameElement: window.frameElement, opener: window.opener, selfTop: window.top === window };
  })();`;
  const w = run(ESCAPE, { framed: true });
  check('framed: an effect that writes to parent / top / document.defaultView.parent stays on its own page — the admin gets nothing',
    w.adminBody.children.length === 0 && w.document.body.children.length === 4);
  check('framed: opener and frameElement read null, and top is the page itself',
    w.win.__fx && w.win.__fx.frameElement === null && w.win.__fx.opener === null && w.win.__fx.selfTop === true);
  const s = run(SLOW, { framed: true });
  for (let i = 0; i < 6; i++) { s.frame(16); s.dispatch('mousemove'); }
  check('framed: the guard itself still tells the studio when it stops an effect (its own line to the real parent)',
    s.posted.some((m) => m && m.type === 'tapuz-theme-preview' && m.killed) && s.adminBody.children.length === 0);
}

// ── the lint says up front what the guard will do ────────────────────
const lint = theme.lintEffect(RUNAWAY, '');
check('lintEffect names the node-per-mousemove pattern, the missing reduced-motion and pointer-events',
  lint.some((w) => /תזוזת עכבר/.test(w)) && lint.some((w) => /prefers-reduced-motion/.test(w)) && lint.some((w) => /pointer-events/.test(w)));
check('lintEffect is quiet on a clean pooled effect that respects motion and pointer-events',
  theme.lintEffect(POOLED.replace('(function () {', '(function () { if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;'), '.tz-dot { pointer-events: none; }').length === 0);
check('lintEffect flags a 1ms interval and an infinite loop',
  theme.lintEffect(TICKER, '').some((w) => /16ms/.test(w)) && theme.lintEffect('while (true) {}', '').some((w) => /while/.test(w)));

console.log(fail ? '\n❌ smoke-theme-guard: FAILED' : '\n✅ smoke-theme-guard: all checks passed');
process.exit(fail ? 1 : 0);
