/* Tapuziel Bridge V2 — popup. Three jobs, zero secrets:
 * 1. endpoint field (loopback-only, LM Studio default), saved to storage;
 * 2. "check connection" / test prompt — end-to-end through the background;
 * 3. "connect this site" — host permission for the ACTIVE tab's origin plus
 *    a persistent content-script registration. Opt-in per site, no wildcards.
 *
 * All promise-style: Firefox's `browser` namespace has no callbacks, and
 * Chrome MV3 returns promises when the callback is omitted. Firefox also
 * treats manifest host_permissions as user-approvable — so before any relay
 * we ensure the loopback grant, requesting it inside the click gesture. */
'use strict';

const B = typeof browser !== 'undefined' ? browser : chrome;

const $ = (id) => document.getElementById(id);
const status = (html, cls) => { $('status').innerHTML = html; $('status').className = cls || ''; };

const LOCAL_ORIGINS = ['http://localhost/*', 'http://127.0.0.1/*'];

/** Firefox: manifest host_permissions may be un-granted until the user says
 *  yes. Requesting inside the click keeps the gesture requirement happy.
 *  Chrome grants at install and answers true without any prompt. */
async function ensureLocalPermission() {
  try {
    if (await B.permissions.contains({ origins: LOCAL_ORIGINS })) return true;
    return await B.permissions.request({ origins: LOCAL_ORIGINS });
  } catch (e) {
    return true; // a probe failure must not block the attempt itself
  }
}

function sendBg(msg) {
  return Promise.resolve(B.runtime.sendMessage(msg));
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

// End-to-end smoke for the 5090: models → chat round-trip, timed. Proves the
// whole relay path (popup → worker → LM Studio) before the CMS side exists.
$('ask').addEventListener('click', async () => {
  const q = $('prompt').value.trim() || 'שלום! ענה במשפט אחד: מי אתה?';
  status('שולח למודל…');
  if (!(await ensureLocalPermission())) return status('לא אושרה גישה ל-localhost.', 'bad');
  const t0 = performance.now();
  try {
    const res = await sendBg({ type: 'tz-local-llm', path: '/v1/models' });
    const model = res && res.ok && res.data && res.data.data && res.data.data[0] && res.data.data[0].id;
    if (!model) return status('אין מודל טעון — טענו מודל ב-LM Studio והפעילו את ה-Server.', 'bad');
    const r = await sendBg({
      type: 'tz-local-llm',
      path: '/v1/chat/completions',
      body: { model, messages: [{ role: 'user', content: q }], stream: false }
    });
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

$('connect').addEventListener('click', async () => {
  try {
    const tabs = await B.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !/^https?:/.test(tab.url || '')) return status('פתחו את האתר שלכם בטאב הפעיל ונסו שוב.', 'bad');
    const origin = new URL(tab.url).origin + '/*';
    const granted = await B.permissions.request({ origins: [origin] });
    if (!granted) return status('לא אושרה גישה לאתר.', 'bad');
    const scriptId = 'tz-bridge-' + btoa(origin).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
    const existing = await B.scripting.getRegisteredContentScripts({ ids: [scriptId] }).catch(() => []);
    if (!existing.length) {
      await B.scripting.registerContentScripts([{
        id: scriptId,
        js: ['content-bridge.js'],
        matches: [origin],
        runAt: 'document_idle',
        persistAcrossSessions: true
      }]);
    }
    status('האתר חובר ✓ רעננו את דפי האדמין ותראו את האפשרות "מקומי (דרך הדפדפן)".', 'ok');
  } catch (e) {
    status('שגיאה: ' + e.message, 'bad');
  }
});
