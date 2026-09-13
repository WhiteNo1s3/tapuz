/* Tapuziel Bridge V2 — popup. Four jobs, zero secrets:
 * 1. endpoint field (loopback-only, LM Studio default), saved to storage;
 * 2. "check connection" / test prompt — end-to-end through the background;
 * 3. "connect this site" — host permission for the ACTIVE tab's host plus a
 *    persistent content-script registration, AND an immediate injection so
 *    the tab that is already open starts working without a reload;
 * 4. the list of connected sites, each with a disconnect that unregisters the
 *    script and hands the host permission back.
 *
 * The site is usually NOT local — it is the owner's hosted Tapuziel. Only the
 * model is local. That asymmetry is the whole point of the extension.
 *
 * All promise-style: Firefox's `browser` namespace has no callbacks, and
 * Chrome MV3 returns promises when the callback is omitted.
 *
 * GESTURE RULE (Firefox): permissions.request is bound to the tick of the
 * click that triggered it. Anything awaited BEFORE it loses the gesture and
 * the call throws — so every request below is the first await in its handler,
 * and the state it would have consulted (loopback grant, active tab) is
 * prefetched when the popup opens. */
'use strict';

const B = typeof browser !== 'undefined' ? browser : chrome;

const $ = (id) => document.getElementById(id);
const status = (html, cls) => { $('status').innerHTML = html; $('status').className = cls || ''; };

const LOCAL_ORIGINS = ['http://localhost/*', 'http://127.0.0.1/*'];
const SCRIPT_PREFIX = 'tz-bridge-';
const SITE_LABEL = 'חיבור AI → "מקומי — דרך הדפדפן (Bridge V2)"';
const PORT_NAME = 'tz-llm';
const CHAT_PATH = '/v1/chat/completions';

/* ── loopback grant ───────────────────────────────────────────────────────
 * Firefox: manifest host_permissions may be un-granted until the user says
 * yes. Chrome grants at install. We probe ONCE at popup open so the click
 * handlers can go straight to permissions.request without an await first. */
let localGranted = null;
Promise.resolve(B.permissions.contains({ origins: LOCAL_ORIGINS }))
  .then((v) => { localGranted = v; })
  .catch(() => { localGranted = true; }); // a probe failure must not block the attempt

function ensureLocalPermission() {
  if (localGranted) return Promise.resolve(true);
  // Already-granted permissions resolve true here with no prompt, so calling
  // request() straight away is safe as well as gesture-correct.
  return Promise.resolve(B.permissions.request({ origins: LOCAL_ORIGINS }))
    .then((ok) => { if (ok) localGranted = true; return ok; })
    .catch(() => true);
}

function sendBg(msg) {
  return Promise.resolve(B.runtime.sendMessage(msg));
}

/** The popup's own test takes the same streaming port the site uses, so what
 *  it proves is what the site will actually do — including that a long
 *  generation keeps reporting instead of falling silent. */
function chatViaPort(body, onProgress) {
  return new Promise((resolve) => {
    let port;
    try {
      port = B.runtime.connect({ name: PORT_NAME });
    } catch (e) {
      return resolve({ ok: false, error: 'extension unavailable' });
    }
    let settled = false;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      resolve(res);
      try { port.disconnect(); } catch (e) { /* already gone */ }
    };
    port.onMessage.addListener((m) => {
      if (!m) return;
      if (m.type === 'progress') return onProgress && onProgress(m);
      if (m.type === 'done') {
        finish(m.ok ? { ok: true, status: m.status, data: m.data }
          : { ok: false, status: m.status, error: m.error });
      }
    });
    port.onDisconnect.addListener(() => finish({ ok: false, error: 'extension unavailable' }));
    port.postMessage({ type: 'start', path: CHAT_PATH, body });
  });
}

/* ── site identity ────────────────────────────────────────────────────────
 * A match pattern may not carry a PORT — `https://site.com:8443/*` is
 * rejected outright, and `new URL(x).origin` keeps the port. So the pattern
 * is protocol + hostname (every port on that host), exactly how the worker
 * checks its loopback grant. */
function patternFor(url) {
  const u = new URL(url);
  return u.protocol + '//' + u.hostname + '/*';
}

/** Content-script id derived from the pattern. Deliberately NOT base64: btoa
 *  throws on any non-Latin1 code point, so a single unicode host would break
 *  connecting outright. FNV-1a over the code units + an ASCII slug — stable
 *  across sessions, which matters: the registration is persistAcrossSessions
 *  and has to be found again by the same id. */
function scriptIdFor(pattern) {
  let h = 2166136261;
  for (let i = 0; i < pattern.length; i++) {
    h ^= pattern.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const slug = pattern.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28);
  return SCRIPT_PREFIX + (slug || 'site') + '-' + (h >>> 0).toString(36);
}

// endpoint field ⇄ storage
B.storage.local.get(['llm_base']).then((r) => { $('base').value = r.llm_base || 'http://127.0.0.1:1234'; });
$('base').addEventListener('change', () => {
  const v = $('base').value.trim().replace(/\/+$/, '');
  try {
    const u = new URL(v);
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname.toLowerCase())) {
      return status('הכתובת חייבת להיות loopback — ‏localhost או 127.0.0.1. כתובת רשת לא תתקבל.', 'bad');
    }
  } catch (e) {
    return status('כתובת לא תקינה', 'bad');
  }
  B.storage.local.set({ llm_base: v }).then(() => status('נשמר ✓', 'ok'));
});

$('check').addEventListener('click', async () => {
  status('בודק…');
  if (!(await ensureLocalPermission())) return status('לא אושרה גישה ל-localhost.', 'bad');
  try {
    const res = await sendBg({ type: 'tz-local-llm', path: '/v1/models' });
    if (!res) return status('אין תשובה מה-worker', 'bad');
    if (!res.ok) return status('המודל לא זמין: ' + (res.error || res.status) + '<br>ודאו ש-LM Studio רץ ושה-Server מופעל.', 'bad');
    const models = ((res.data && res.data.data) || []).map((m) => m.id);
    status('מחובר ✓ ' + (models.length ? models.length + ' מודלים:' : 'אין מודלים טעונים.') +
      (models.length ? '<div class="models">' + models.join('<br>') + '</div>' : ''), 'ok');
  } catch (e) {
    status('אין תשובה מה-worker: ' + e.message, 'bad');
  }
});

// End-to-end smoke for the GPU: models → chat round-trip, timed. Proves the
// whole relay path (popup → worker → LM Studio) without involving the site.
$('ask').addEventListener('click', async () => {
  const q = $('prompt').value.trim() || 'שלום! ענה במשפט אחד: מי אתה?';
  status('שולח למודל…');
  if (!(await ensureLocalPermission())) return status('לא אושרה גישה ל-localhost.', 'bad');
  const t0 = performance.now();
  try {
    const res = await sendBg({ type: 'tz-local-llm', path: '/v1/models' });
    const model = res && res.ok && res.data && res.data.data && res.data.data[0] && res.data.data[0].id;
    if (!model) return status('אין מודל טעון — טענו מודל ב-LM Studio והפעילו את ה-Server.', 'bad');
    // No streaming flags here on purpose: the worker owns that decision and
    // hands back the ordinary non-streaming shape either way.
    const r = await chatViaPort(
      { model, messages: [{ role: 'user', content: q }] },
      (p) => status('המודל כותב… ' + p.chars + ' תווים')
    );
    if (!r) return status('אין תשובה מה-worker', 'bad');
    if (!r.ok) return status('שגיאה מהמודל: ' + (r.error || r.status), 'bad');
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const answer = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message
      ? r.data.choices[0].message.content : JSON.stringify(r.data).slice(0, 300);
    const usage = r.data && r.data.usage
      ? ' · ' + r.data.usage.completion_tokens + ' טוקנים' : '';
    status('<b>' + model + '</b> ענה תוך ' + secs + ' שניות' + usage +
      ':<div class="models" style="direction:rtl;text-align:right;max-height:140px">' +
      String(answer).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</div>', 'ok');
  } catch (e) {
    status('שגיאה: ' + e.message, 'bad');
  }
});

/* ── connected sites ──────────────────────────────────────────────────────
 * getRegisteredContentScripts REJECTS in some builds when a filtered id is
 * unknown instead of answering [] — every call keeps the .catch(() => []). */
function listBridgeScripts() {
  return Promise.resolve(B.scripting.getRegisteredContentScripts())
    .then((all) => (all || []).filter((s) => s && typeof s.id === 'string' && s.id.indexOf(SCRIPT_PREFIX) === 0))
    .catch(() => []);
}

async function disconnectSite(id, matches) {
  status('מנתק…');
  try {
    await B.scripting.unregisterContentScripts({ ids: [id] });
  } catch (e) {
    /* already gone — keep going and drop the permission anyway */
  }
  // Never hand loopback back. A Tapuziel served from localhost produces the
  // very pattern the relay itself runs on, and dropping it would silently
  // cut the model off along with the site.
  const origins = matches.filter((m) => !LOCAL_ORIGINS.includes(m));
  try {
    if (origins.length) await B.permissions.remove({ origins });
  } catch (e) {
    /* Chrome refuses to drop a required permission — harmless */
  }
  await renderSites();
  status('האתר נותק ✓ רעננו את דפי האדמין שלו כדי לסגור את הגשר שכבר רץ בהם.', 'ok');
}

async function renderSites() {
  const box = $('sites');
  const scripts = await listBridgeScripts();
  box.textContent = '';
  if (!scripts.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'אין עדיין אתר מחובר.';
    box.appendChild(p);
    return;
  }
  for (const s of scripts) {
    const origins = (s.matches || []).slice();
    const row = document.createElement('div');
    row.className = 'site';
    const name = document.createElement('span');
    name.textContent = origins.map((m) => m.replace(/\/\*$/, '')).join(', ') || s.id;
    name.title = name.textContent;
    const btn = document.createElement('button');
    btn.textContent = 'נתק';
    btn.addEventListener('click', () => disconnectSite(s.id, origins));
    row.appendChild(name);
    row.appendChild(btn);
    box.appendChild(row);
  }
}

/* The active tab, read when the popup opens. tab.url is only populated with
 * the activeTab grant (opening the popup IS the invocation that grants it) or
 * a matching host permission — which a not-yet-connected site does not have. */
let activeSite = null;
let activeSiteWhy = 'פתחו את האתר שלכם (http/https) בטאב הפעיל ונסו שוב.';

async function loadActiveSite() {
  $('connect').disabled = true;
  try {
    const tabs = await B.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    const url = (tab && tab.url) || '';
    if (!tab || !/^https?:/i.test(url)) {
      $('connect-hint').textContent = activeSiteWhy;
      return;
    }
    const pattern = patternFor(url);
    activeSite = { tabId: tab.id, pattern, label: pattern.replace(/\/\*$/, '') };
    $('connect').disabled = false;
    $('connect-hint').textContent = activeSite.label;
  } catch (e) {
    activeSiteWhy = 'לא ניתן לקרוא את הטאב הפעיל: ' + e.message;
    $('connect-hint').textContent = activeSiteWhy;
  }
}

/** Register once. A second connect on a live site is a no-op that SUCCEEDS:
 *  if the probe says it exists we skip, and if registering still throws on a
 *  duplicate id we re-probe — an id that is now there means someone else won
 *  the race, which is the outcome we wanted anyway. */
async function ensureRegistered(pattern) {
  const id = scriptIdFor(pattern);
  const existing = await B.scripting.getRegisteredContentScripts({ ids: [id] }).catch(() => []);
  if (existing && existing.length) return 'already';
  try {
    await B.scripting.registerContentScripts([{
      id,
      js: ['content-bridge.js'],
      matches: [pattern],
      runAt: 'document_idle',
      persistAcrossSessions: true
    }]);
    return 'registered';
  } catch (e) {
    const again = await B.scripting.getRegisteredContentScripts({ ids: [id] }).catch(() => []);
    if (again && again.length) return 'already';
    throw e;
  }
}

/** Registration only fires on the NEXT load, so the tab the owner is looking
 *  at would stay dead until a reload. Inject it now. Refusal is normal on a
 *  privileged or half-loaded page — we fall back to asking for a reload. */
async function injectNow(tabId) {
  try {
    await B.scripting.executeScript({ target: { tabId }, files: ['content-bridge.js'] });
    return true;
  } catch (e) {
    return false;
  }
}

$('connect').addEventListener('click', async () => {
  const site = activeSite;
  if (!site) return status(activeSiteWhy, 'bad');
  status('מבקש הרשאה לאתר…');
  let granted;
  try {
    // The gesture rule at the top of this file: nothing may precede this call.
    granted = await B.permissions.request({ origins: [site.pattern] });
  } catch (e) {
    return status('בקשת ההרשאה נכשלה: ' + e.message, 'bad');
  }
  if (!granted) return status('לא אושרה גישה לאתר.', 'bad');
  try {
    const mode = await ensureRegistered(site.pattern);
    const live = await injectNow(site.tabId);
    await renderSites();
    const head = mode === 'already' ? 'האתר כבר מחובר ✓' : 'האתר חובר ✓';
    status(head + (live
      ? ' הטאב הזה פעיל כבר עכשיו — באתר: ' + SITE_LABEL + '.'
      : ' רעננו את הטאב כדי להפעיל את הגשר, ואז באתר: ' + SITE_LABEL + '.'), 'ok');
  } catch (e) {
    status('שגיאה: ' + e.message, 'bad');
  }
});

loadActiveSite();
renderSites();
