'use strict';

/**
 * v1.87 QA — WhatsApp phase W2: the HMAC-gated webhook, through real HTTP.
 *
 * The acceptance list from docs/WHATSAPP-INTEGRATION.md, verbatim:
 *   - a valid signature is accepted,
 *   - a forged one is 401,
 *   - a RE-SERIALIZED body is 401 (proving raw-body handling — and with it
 *     the mount order, because a body parsed upstream can never verify),
 *   - a short header does not throw,
 *   - a missing app secret refuses everything.
 *
 * Plus what the events must DO once verified: a delivery status refines the
 * ledger row (PMP pricing lands at delivery), an inbound message opens the
 * window and joins a known contact's timeline, and a Meta RETRY of the same
 * wamid stays one row.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-wa-webhook-'));
const PORT = 3995;
const BASE = `http://127.0.0.1:${PORT}`;
const HOOK = '/crm/wa/webhook';
const SECRET = 'wh-secret-1';
const VERIFY = 'vt-tapuz';

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const sign = (body, secret) =>
  'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

function req(method, urlPath, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const h = Object.assign({}, headers);
    if (body != null) {
      h['Content-Type'] = h['Content-Type'] || 'application/json';
      h['Content-Length'] = Buffer.byteLength(body);
    }
    const r = http.request(BASE + urlPath, { method, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        text: Buffer.concat(chunks).toString('utf8')
      }));
    });
    r.on('error', reject);
    r.end(body != null ? body : undefined);
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
    title: 'אתר בדיקה', description: 'wa webhook smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });

  const config = require('../src/config');
  const wa = require('../src/crm/whatsapp');
  const ledger = require('../src/crm/wa-ledger');
  const webhook = require('../src/crm/wa-webhook');
  const contacts = require('../src/crm/contacts');
  const { db } = require('../src/db');

  // ── the signature, as a pure function ────────────────────────────────
  const RAW = '{ "object": "whatsapp_business_account",   "entry": [] }'; // non-canonical on purpose
  check('a valid signature verifies',
    webhook.verifySignature256(RAW, sign(RAW, SECRET), SECRET) === true);
  check('a forged signature is refused',
    webhook.verifySignature256(RAW, sign(RAW, 'wrong'), SECRET) === false);
  check('a SHORT header is a false, not a throw', (() => {
    try { return webhook.verifySignature256(RAW, 'sha256=ab', SECRET) === false; }
    catch (e) { return false; }
  })());
  check('a missing header is refused',
    webhook.verifySignature256(RAW, undefined, SECRET) === false);
  check('a missing app secret refuses even a "valid" signature',
    webhook.verifySignature256(RAW, sign(RAW, ''), '') === false);
  check('a NON-RAW body (the mount-order mistake) is refused, not a crash',
    webhook.verifySignature256({ parsed: true }, sign(RAW, SECRET), SECRET) === false);

  // ── mount order, asserted at the source too ──────────────────────────
  check('server.js mounts the webhook BEFORE both body parsers', (() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    const hook = src.indexOf("routes/wa-webhook");
    return hook > 0 &&
      hook < src.indexOf('bodyParser.urlencoded(') &&
      hook < src.indexOf('bodyParser.json(');
  })());

  // ── the live server ──────────────────────────────────────────────────
  wa.saveSettings({ appSecret: SECRET, verifyToken: VERIFY, phoneNumberId: '123456789', messagingLimitTier: 'TIER_250' });
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT), TAPUZ_WA_HOOK_MAX: '30' },
    stdio: 'ignore'
  });

  try {
    await waitUp();

    // ── flags off: the endpoint does not exist ─────────────────────────
    const offGet = await req('GET', HOOK + `?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1`);
    const offPost = await req('POST', HOOK, { body: RAW, headers: { 'X-Hub-Signature-256': sign(RAW, SECRET) } });
    check('with the channel off, GET is 404', offGet.status === 404);
    check('with the channel off, POST is 404 — even correctly signed', offPost.status === 404);

    config.saveConfig(Object.assign(config.loadConfig(), { crm: { enabled: true, whatsapp: { enabled: true } } }));

    // ── the GET handshake ──────────────────────────────────────────────
    const hs = await req('GET', HOOK + `?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1685417958`);
    check('the right verify token gets the challenge echoed back',
      hs.status === 200 && hs.text === '1685417958');
    const hsBad = await req('GET', HOOK + `?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=1`);
    check('a wrong verify token is 403', hsBad.status === 403);
    wa.saveSettings({ verifyToken: '' });
    const hsNone = await req('GET', HOOK + `?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1`);
    check('no verify token stored = handshake refused (fail closed)', hsNone.status === 403);
    wa.saveSettings({ verifyToken: VERIFY });

    // ── the POST gate — and THE mount-order proof ──────────────────────
    const okPost = await req('POST', HOOK, { body: RAW, headers: { 'X-Hub-Signature-256': sign(RAW, SECRET) } });
    check('a valid signature over a NON-CANONICALLY spaced body is accepted ' +
      '(raw bytes reached us — the mount order is right)', okPost.status === 200);
    const reser = await req('POST', HOOK, {
      body: RAW,
      headers: { 'X-Hub-Signature-256': sign(JSON.stringify(JSON.parse(RAW)), SECRET) }
    });
    check('a signature over the RE-SERIALIZED body is 401', reser.status === 401);
    const forged = await req('POST', HOOK, { body: RAW, headers: { 'X-Hub-Signature-256': sign(RAW, 'wrong') } });
    check('a forged signature is 401', forged.status === 401);
    const short = await req('POST', HOOK, { body: RAW, headers: { 'X-Hub-Signature-256': 'sha256=ab' } });
    check('a short header is 401, not a 500', short.status === 401);
    const noSig = await req('POST', HOOK, { body: RAW });
    check('a missing header is 401', noSig.status === 401);
    const badJson = await req('POST', HOOK, { body: '{oops', headers: { 'X-Hub-Signature-256': sign('{oops', SECRET) } });
    check('unparseable JSON with a VALID signature is 400 (verified before parsed)',
      badJson.status === 400);

    const before = db.prepare('SELECT COUNT(*) n FROM crm_wa_messages').get().n;
    const foreign = JSON.stringify({ object: 'page', entry: [{ changes: [{ value: { messages: [{ from: '972501112222', id: 'wamid.X' }] } }] }] });
    const skip = await req('POST', HOOK, { body: foreign, headers: { 'X-Hub-Signature-256': sign(foreign, SECRET) } });
    check('a foreign object is 200 and IGNORED — nothing is ledgered',
      skip.status === 200 && db.prepare('SELECT COUNT(*) n FROM crm_wa_messages').get().n === before);

    // ── a delivery status refines the ledger (PMP: priced at delivery) ──
    ledger.recordMessage({
      phone: '050-123-4567', direction: 'out', msgType: 'template',
      templateCategory: 'UTILITY', waMessageId: 'wamid.OUT1',
      pricing: ledger.classifyPricing('template', { templateCategory: 'UTILITY', windowOpen: true })
    });
    const statusBody = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: '1', changes: [{ field: 'messages', value: {
        statuses: [{ id: 'wamid.OUT1', status: 'delivered', recipient_id: '972501234567',
          pricing: { billable: true, pricing_model: 'PMP', category: 'utility' } }]
      } }] }]
    });
    const st = await req('POST', HOOK, { body: statusBody, headers: { 'X-Hub-Signature-256': sign(statusBody, SECRET) } });
    const outRow = db.prepare('SELECT * FROM crm_wa_messages WHERE wa_message_id = ?').get('wamid.OUT1');
    check('a delivered status lands on the row: delivered_at + billable + pricing, from Meta',
      st.status === 200 && outRow.status === 'delivered' && outRow.delivered_at != null &&
      outRow.billable === 1 && outRow.pricing_type === 'regular' && outRow.pricing_category === 'utility');

    ledger.recordMessage({ phone: '050-123-4567', direction: 'out', msgType: 'template', templateCategory: 'MARKETING', waMessageId: 'wamid.OUT2' });
    const failBody = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: {
        statuses: [{ id: 'wamid.OUT2', status: 'failed',
          errors: [{ code: 131047, title: 'Re-engagement message' }] }]
      } }] }]
    });
    await req('POST', HOOK, { body: failBody, headers: { 'X-Hub-Signature-256': sign(failBody, SECRET) } });
    const failRow = db.prepare('SELECT * FROM crm_wa_messages WHERE wa_message_id = ?').get('wamid.OUT2');
    check('a failed status records WHY in the error column',
      failRow.status === 'failed' && /131047/.test(failRow.error || ''));

    // ── an inbound message: ledgered, window opened, timeline joined ────
    const person = contacts.upsertContact({ phone: '052-999-8888', name: 'לקוח וואצאפ' }).contact;
    const inBody = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: {
        contacts: [{ wa_id: '972529998888', profile: { name: 'לקוח' } }],
        messages: [{ from: '972529998888', id: 'wamid.IN1', timestamp: '1753000000',
          type: 'text', text: { body: 'שלום מהוובהוק' } }]
      } }] }]
    });
    const inbound = await req('POST', HOOK, { body: inBody, headers: { 'X-Hub-Signature-256': sign(inBody, SECRET) } });
    const inRow = db.prepare('SELECT * FROM crm_wa_messages WHERE wa_message_id = ?').get('wamid.IN1');
    check('the inbound message is ledgered with its text, linked to the known contact',
      inbound.status === 200 && inRow && inRow.direction === 'in' &&
      inRow.body === 'שלום מהוובהוק' && inRow.contact_id === person.id);
    check('the inbound message OPENED the 24h customer-service window',
      ledger.getWindow('052-999-8888').open === true);
    check('the inbound message joined the contact\'s CRM timeline',
      require('../src/crm/events').listForContact(person.id)
        .some((e) => e.type === 'chat' && e.path === 'whatsapp'));

    // ── Meta retries until it sees a 2xx — a retry must be ONE row ─────
    const retry = await req('POST', HOOK, { body: inBody, headers: { 'X-Hub-Signature-256': sign(inBody, SECRET) } });
    check('a RETRY of the same wamid is 200 and deduped to one row',
      retry.status === 200 &&
      db.prepare('SELECT COUNT(*) n FROM crm_wa_messages WHERE wa_message_id = ?').get('wamid.IN1').n === 1);

    // ── no app secret stored = everything refused ──────────────────────
    wa.saveSettings({ appSecret: '' });
    const noSecret = await req('POST', HOOK, { body: RAW, headers: { 'X-Hub-Signature-256': sign(RAW, SECRET) } });
    check('with NO app secret stored, a correctly signed request is still 401', noSecret.status === 401);
    wa.saveSettings({ appSecret: SECRET });

    // ── the flood cap (kept last: it poisons the per-IP window) ────────
    let got429 = false;
    for (let i = 0; i < 35 && !got429; i++) {
      const r = await req('POST', HOOK, { body: RAW });
      if (r.status === 429) got429 = true;
    }
    check('a flood hits the rate limit (429) before it hits the HMAC', got429);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE WA-WEBHOOK: FAIL' : 'SMOKE WA-WEBHOOK: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
