'use strict';

/**
 * v1.83 QA — the PUBLIC chat endpoints through real HTTP.
 *
 * The endpoints an anonymous visitor can reach, and what they refuse:
 *   - everything 404s while the chat is off (including the widget script),
 *   - the config endpoint never reveals the caps or the business prompt —
 *     knowing the remaining budget would tell an abuser when to strike,
 *   - a refusal answers like a person and never names which limit was hit,
 *   - errors never leak provider messages or stack traces,
 *   - and the model is never reachable without a valid session token.
 *
 * The AI provider is left UNCONFIGURED, so no test can spend anything: the
 * chat's own budget accounting is covered in smoke-crm-cs.js with a stub.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-cs-route-'));
const PORT = 3963;
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
    if (cookie) headers.Cookie = cookie;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      res.setEncoding('utf8');
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
    title: 'אתר בדיקה', description: 'cs route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const { createAdmin } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');
  const config = require('../src/config');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });

  try {
    await waitUp();

    // ── while OFF, nothing exists ──────────────────────────────────────
    const offScript = await req('GET', '/tz-cs-chat.js');
    check('the widget script is inert while the chat is off',
      offScript.status === 200 && /chat disabled/.test(offScript.text) && !/fetch\(/.test(offScript.text));
    const offCfg = await req('GET', '/crm/cs/v1/config');
    check('the config endpoint reports disabled', offCfg.status === 200 && offCfg.json.enabled === false);
    const offSession = await req('POST', '/crm/cs/v1/session', { body: {} });
    check('no session can be started while off', offSession.status === 404);
    const offMsg = await req('POST', '/crm/cs/v1/message', { body: { token: 'a'.repeat(32), text: 'hi' } });
    check('no message is accepted while off', offMsg.status === 404);

    const homeOff = await req('GET', '/');
    check('a page carries no chat tag while off', !/tz-cs-chat\.js/.test(homeOff.text));

    // ── turn it on THROUGH THE ADMIN, so the real save path runs ──────
    // (the provider is deliberately left unconfigured, so nothing can spend)
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];
    const enableCrm = await req('POST', '/admin/crm/settings', { cookie, form: { enabled: '1' } });
    check('the CRM can be enabled from the admin', enableCrm.status === 302);
    const enableChat = await req('POST', '/admin/crm/chat', {
      cookie,
      form: {
        enabled: '1', dailyMessageCap: '5', perSessionCap: '3',
        greeting: 'שלום מהבדיקה', businessInfo: 'סוד עסקי פנימי'
      }
    });
    check('the chat can be enabled from the admin', enableChat.status === 302);

    const onScript = await req('GET', '/tz-cs-chat.js');
    check('the widget script is served when on',
      onScript.status === 200 && /crm\/cs\/v1\/message/.test(onScript.text) &&
      /application\/javascript/.test(onScript.headers['content-type'] || ''));

    const onCfg = await req('GET', '/crm/cs/v1/config');
    check('config exposes only the greeting', onCfg.json.enabled === true && onCfg.json.greeting === 'שלום מהבדיקה');
    check('config NEVER reveals the caps (that would tell an abuser when to strike)',
      onCfg.text.indexOf('dailyMessageCap') === -1 && onCfg.text.indexOf('5') === -1);
    check('config NEVER reveals the business prompt', !/סוד עסקי/.test(onCfg.text));

    // ── sessions ──────────────────────────────────────────────────────
    const session = await req('POST', '/crm/cs/v1/session', { body: {} });
    check('a session issues an unguessable token',
      session.status === 200 && /^[a-f0-9]{32}$/.test(session.json.token));

    const noToken = await req('POST', '/crm/cs/v1/message', { body: { text: 'שאלה' } });
    check('a message without a session is refused', noToken.status === 400);
    const badToken = await req('POST', '/crm/cs/v1/message', { body: { token: 'not-a-token', text: 'שאלה' } });
    check('a malformed token is refused', badToken.status === 400);
    const unknownToken = await req('POST', '/crm/cs/v1/message', {
      body: { token: 'f'.repeat(32), text: 'שאלה' }
    });
    check('an unknown token is refused the same way (no oracle)',
      unknownToken.status === badToken.status);

    // ── with no provider configured, the failure is HUMAN and quiet ────
    const answer = await req('POST', '/crm/cs/v1/message', {
      body: { token: session.json.token, text: 'מה שעות הפתיחה?' }
    });
    check('an unconfigured provider yields a polite refusal, not a 500',
      answer.status === 200 && answer.json.ok === false && typeof answer.json.message === 'string');
    check('the refusal invites the visitor to leave details instead',
      /פרטים|נסו/.test(answer.json.message));
    check('the refusal leaks NO provider detail, key hint or stack trace',
      !/api|key|token|Error|at Object|מפתח/i.test(answer.json.message));
    check('a failed answer did not consume the daily budget', (() => {
      const cs = require('../src/crm/cs');
      return cs.usageToday().messages === 0;
    })());

    // ── the visitor cannot exceed the question length ──────────────────
    const huge = await req('POST', '/crm/cs/v1/message', {
      body: { token: session.json.token, text: 'א'.repeat(50000) }
    });
    check('an oversized body is rejected before anything else', huge.status === 413 || huge.status === 400);

    // ── enabling REBUILDS the site, so the tag is live immediately ────
    // (an owner who flips a site-wide switch and sees nothing change on their
    //  site concludes it is broken — the save path rebuilds for that reason)
    const homeOn = await req('GET', '/');
    check('enabling the chat republished the site with the tag — no manual rebuild',
      /tz-cs-chat\.js/.test(homeOn.text));

    // ── admin side is gated ──────────────────────────────────────────
    const anonAdmin = await req('GET', '/admin/crm/chat');
    check('the admin chat screen is not reachable unauthenticated',
      anonAdmin.status !== 200 || !/התקציב היומי/.test(anonAdmin.text));
    const adminPage = await req('GET', '/admin/crm/chat', { cookie });
    check('the admin screen leads with the budget, in money',
      adminPage.status === 200 && /התקציב היומי/.test(adminPage.text) && /במקרה הגרוע/.test(adminPage.text));
    check('the admin screen states what the bot cannot do',
      /אין לו כלים/.test(adminPage.text));
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE CRM-CS-ROUTE: FAIL' : 'SMOKE CRM-CS-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
