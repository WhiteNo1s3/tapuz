'use strict';

/**
 * v1.88 QA — WhatsApp phase W3: sending. Money leaves the building, so the
 * tests are mostly about when it must NOT.
 *
 * The acceptance list from docs/WHATSAPP-INTEGRATION.md:
 *   - free-form outside the window is refused locally,
 *   - marketing without opt-in is refused,
 *   - the tier ceiling refuses before Meta does,
 *   - a dead Graph endpoint cannot hold a request open.
 *
 * Every refusal is proven to happen BEFORE the network: the injected
 * transport records its calls, and on refusals the record stays empty.
 * Plus the two W3-specific books rules: a FAILED call consumes no tier
 * quota and is never billable, and spend is estimated from DELIVERED
 * billable rows only — because Meta charges at delivery.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-wa-send-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const { db } = require('../src/db');
const config = require('../src/config');
const wa = require('../src/crm/whatsapp');
const ledger = require('../src/crm/wa-ledger');
const sender = require('../src/crm/wa-send');

const TOKEN = 'EAAG-test-token-123';
const results = []; // everything sendMessage ever returned — checked for leaks
async function send(opts) { const r = await sender.sendMessage(opts); results.push(r); return r; }

(async () => {
  // ── off by default: nothing can send until the owner turns TWO keys ──
  const dead = [];
  const deadTransport = async (...a) => { dead.push(a); return { status: 200, json: {} }; };
  check('with the channel off, sending refuses without touching the network', (
    (await send({ phone: '050-123-4567', body: 'שלום', transport: deadTransport })).error === 'whatsapp_disabled'
  ) && dead.length === 0);

  config.saveConfig(Object.assign(config.loadConfig(), { crm: { enabled: true, whatsapp: { enabled: true } } }));
  check('with the flag on but NO credentials, still refused (isEnabled implies configured)', (
    (await send({ phone: '050-123-4567', body: 'שלום', transport: deadTransport })).error === 'whatsapp_disabled'
  ) && dead.length === 0);

  wa.saveSettings({ phoneNumberId: '123456789', accessToken: TOKEN, appSecret: 'sec', verifyToken: 'vt', messagingLimitTier: 'TIER_250' });

  // ── the gate runs BEFORE the transport, refusal by refusal ───────────
  check('free-form OUTSIDE the window: refused locally, zero network', (
    (await send({ phone: '052-111-2222', body: 'שלום', transport: deadTransport })).error === 'csw_closed_use_template'
  ) && dead.length === 0);
  check('marketing without opt-in: refused locally, zero network', (
    (await send({ phone: '054-222-3333', msgType: 'template', templateName: 'sale', templateCategory: 'MARKETING', transport: deadTransport })).error === 'marketing_opt_in_required'
  ) && dead.length === 0);
  check('an invalid phone never reaches the transport', (
    (await send({ phone: 'abc', body: 'x', transport: deadTransport })).error === 'invalid_phone'
  ) && dead.length === 0);

  ledger.recordMessage({ phone: '052-111-2222', direction: 'in', body: 'פתיחת חלון' }); // window opens
  check('an empty free-form body is invalid_message (gate passed, payload refused)', (
    (await send({ phone: '052-111-2222', body: '   ', transport: deadTransport })).error === 'invalid_message'
  ) && dead.length === 0);
  check('a template without a name is invalid_message', (
    (await send({ phone: '052-111-2222', msgType: 'template', templateName: '', transport: deadTransport })).error === 'invalid_message'
  ) && dead.length === 0);

  // ── a real send (fake Meta): free-form inside the window ─────────────
  const calls = [];
  let n = 0;
  const okTransport = async (url, payload, token, timeoutMs) => {
    calls.push({ url, payload, token, timeoutMs });
    n++; return { status: 200, json: { messages: [{ id: 'wamid.S' + n }] } };
  };
  const freeSend = await send({ phone: '052-111-2222', body: 'תשובה בחלון', transport: okTransport });
  check('free-form inside the window sends, free', freeSend.ok === true &&
    freeSend.pricing.billable === false && freeSend.pricing.pricing_type === 'free_customer_service' &&
    freeSend.outside_csw === false);
  check('the destination is the CONSTANT Graph host with our phone-number id',
    calls[0].url === 'https://graph.facebook.com/v21.0/123456789/messages');
  check('the bearer token reaches the transport; the payload is Cloud API shaped',
    calls[0].token === TOKEN && calls[0].payload.messaging_product === 'whatsapp' &&
    calls[0].payload.type === 'text' && calls[0].payload.to === '972521112222');
  const freeRow = db.prepare('SELECT * FROM crm_wa_messages WHERE wa_message_id = ?').get('wamid.S1');
  check('the ledger row: outbound, accepted, not billable, inside the window',
    freeRow && freeRow.direction === 'out' && freeRow.status === 'accepted' &&
    freeRow.billable === 0 && freeRow.outside_csw === 0);

  // ── outside the window: template goes, and the tier counter moves ────
  const tierBefore = ledger.outsideCswRecipients24h();
  const utilSend = await send({ phone: '053-000-1111', msgType: 'template', templateName: 'order_update', templateCategory: 'UTILITY', transport: okTransport });
  check('a utility template OUTSIDE the window sends, billable, and counts toward the tier',
    utilSend.ok === true && utilSend.pricing.billable === true && utilSend.outside_csw === true &&
    ledger.outsideCswRecipients24h() === tierBefore + 1);
  check('the template body is a marker, not content',
    db.prepare('SELECT body FROM crm_wa_messages WHERE wa_message_id = ?').get(utilSend.waMessageId).body === '[template:order_update]');

  ledger.grantOptIn('054-222-3333', 'marketing', 'בדיקת שליחה');
  const mkt = await send({ phone: '054-222-3333', msgType: 'template', templateName: 'sale', templateCategory: 'MARKETING', transport: okTransport });
  check('marketing WITH an opt-in sends — always billable', mkt.ok === true && mkt.pricing.billable === true);

  // ── the tier ceiling refuses BEFORE Meta does ────────────────────────
  const ins = db.prepare(`INSERT INTO crm_wa_messages (phone, direction, msg_type, outside_csw) VALUES (?, 'out', 'template', 1)`);
  db.transaction(() => { for (let i = 0; i < 250; i++) ins.run('97258' + String(1000000 + i)); })();
  const preCalls = calls.length;
  const capped = await send({ phone: '053-777-9999', msgType: 'template', templateName: 'x', templateCategory: 'UTILITY', transport: okTransport });
  check('at the ceiling, a NEW outside recipient is refused by US — the transport never fires',
    capped.error === 'messaging_limit_reached' && calls.length === preCalls);

  // age everything out so the failure checks start from a clean counter
  db.prepare("UPDATE crm_wa_messages SET created_at = datetime('now', '-2 days') WHERE outside_csw = 1").run();

  // ── failure: nothing left the building, so the books say so ──────────
  const failTransport = async () => ({ status: 500, json: { error: { message: 'boom from meta' } } });
  const failed = await send({ phone: '055-444-5555', msgType: 'template', templateName: 'x', templateCategory: 'UTILITY', transport: failTransport });
  const failRow = db.prepare("SELECT * FROM crm_wa_messages WHERE phone = '972554445555' ORDER BY id DESC").get();
  check('a failed call returns graph_error and records WHY', failed.ok === false &&
    failed.error === 'graph_error' && /boom from meta/.test(failRow.error || ''));
  check('A FAILED SEND BURNS NO TIER QUOTA and is never billable',
    failRow.outside_csw === 0 && failRow.billable === 0 && ledger.outsideCswRecipients24h() === 0);
  check('a 200 with no message id is also a failure, not a phantom success',
    (await send({ phone: '055-444-5555', msgType: 'template', templateName: 'x', transport: async () => ({ status: 200, json: {} }) })).error === 'graph_error');
  check('a transport returning garbage cannot make sendMessage throw',
    (await send({ phone: '055-444-5555', msgType: 'template', templateName: 'x', transport: async () => undefined })).error === 'graph_error');

  // ── money: spend is estimated from DELIVERED billable rows only ──────
  ledger.updateStatus(utilSend.waMessageId, { status: 'delivered', pricingType: 'regular', pricingCategory: 'utility', billable: true });
  const spend = ledger.spendEstimate();
  check('spend counts the DELIVERED billable row (charge at delivery)…',
    spend.total.n === 1 && spend.total.usd === ledger.PRICE_USD.utility && spend.month.n === 1);
  check('…and an accepted-but-undelivered or failed row costs nothing yet',
    db.prepare("SELECT COUNT(*) n FROM crm_wa_messages WHERE billable = 1 AND direction = 'out'").get().n > 1);

  // ── a dead endpoint cannot hold a request open ───────────────────────
  const gone = await new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port)); // bound then closed = guaranteed refusal
    });
  });
  const refused = await sender.postGraph(`http://127.0.0.1:${gone}/x`, {}, 't', 2000);
  check('a refused connection resolves to a small error, never a throw',
    refused.status === 0 && !!refused.error);

  const hang = http.createServer(() => { /* never answer */ });
  await new Promise((r) => hang.listen(0, '127.0.0.1', r));
  const t0 = Date.now();
  const hung = await sender.postGraph(`http://127.0.0.1:${hang.address().port}/x`, {}, 't', 300);
  const elapsed = Date.now() - t0;
  check('a HANGING endpoint is cut by the timeout, fast',
    hung.status === 0 && hung.error === 'timeout' && elapsed < 3000);
  if (hang.closeAllConnections) hang.closeAllConnections();
  hang.close();

  // ── secrets stay in the store ────────────────────────────────────────
  check('no result object ever carries the access token',
    !JSON.stringify(results).includes(TOKEN));
  check('wa-send holds NO URL of its own — the destination comes only from endpointFor', (() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'crm', 'wa-send.js'), 'utf8')
      .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    return !/https?:\/\//.test(src);
  })());

  console.log('');
  console.log(fail ? 'SMOKE WA-SEND: FAIL' : 'SMOKE WA-SEND: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
