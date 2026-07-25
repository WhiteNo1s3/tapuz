'use strict';

/**
 * v1.80 QA — phase 3b: server-side conversions (Meta CAPI + GA4 MP).
 *
 * This is the module where a visitor's personal details leave the building, so
 * the tests are about restraint and correctness in equal measure:
 *
 *   - PII is hashed to Meta's published normalization, checked against hashes
 *     computed INDEPENDENTLY with openssl (not with the same code under test),
 *   - a visitor who refused consent has nothing sent about them — from either
 *     side — and Do-Not-Track outranks even a granted consent,
 *   - the destination is hardcoded, so no setting can redirect an access token,
 *   - secrets are never echoed back to the browser,
 *   - and the browser + server halves share one event id, which is the whole
 *     point of the pairing.
 *
 * No test here performs a real network call: every path is either gated before
 * the request or lacks credentials, so the suite is deterministic offline.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-conv-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const conv = require('../src/crm/conversions');
const pixels = require('../src/crm/pixels');

// Reference digests computed with `openssl dgst -sha256`, independently of the
// implementation under test.
const SHA_EMAIL = '973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b';
const SHA_PHONE = 'b975ee37e3b75ffd98139193110f3505d7336fb6d50cf772ba50b40f8bd5fde0';

function cfg(over = {}, crmOn = true) {
  return {
    crm: {
      enabled: crmOn,
      pixels: { enabled: true, requireConsent: true, meta: { pixelId: '123' } },
      conversions: Object.assign({
        enabled: true,
        meta: { pixelId: '999', accessToken: 'SECRET-TOKEN-1234', testEventCode: '' },
        ga4: { measurementId: 'G-ABC123', apiSecret: 'SECRET-GA-9876' }
      }, over)
    }
  };
}
const consented = { headers: { cookie: 'tz_consent=granted', 'user-agent': 'UA' } };

// ── PII hashing: Meta's spec, verified against openssl ───────────────
check('email hashes to the openssl reference', conv.sha256Norm('test@example.com') === SHA_EMAIL);
check('email is trimmed and lowercased before hashing (normalization, not luck)',
  conv.sha256Norm('  TEST@Example.COM  ') === SHA_EMAIL);
check('phone strips every non-digit before hashing',
  conv.sha256Phone('+972-50-111-2222') === SHA_PHONE &&
  conv.sha256Phone('972 50 111 2222') === SHA_PHONE);
check('an empty identifier hashes to nothing (never a hash of "")',
  conv.sha256Norm('') === '' && conv.sha256Phone('') === '' && conv.sha256Norm(null) === '');

// ── the Meta payload ─────────────────────────────────────────────────
const payload = conv.buildMetaPayload({
  contact: { email: 'test@example.com', phone: '+972-50-111-2222', country: 'IL' },
  eventId: 'abc123', eventName: 'Lead', url: '/contact',
  ip: '203.0.113.9', userAgent: 'Mozilla/5.0'
});
const ev = payload.data[0];
check('the payload carries hashed email + phone as arrays (Meta\'s shape)',
  Array.isArray(ev.user_data.em) && ev.user_data.em[0] === SHA_EMAIL &&
  ev.user_data.ph[0] === SHA_PHONE);
check('NO raw email or phone appears anywhere in the payload', (() => {
  const s = JSON.stringify(payload);
  return !s.includes('test@example.com') && !s.includes('0501112222') && !s.includes('972501112222');
})());
check('ip and user-agent are sent RAW — Meta requires them unhashed for matching',
  ev.user_data.client_ip_address === '203.0.113.9' && ev.user_data.client_user_agent === 'Mozilla/5.0');
check('the event carries the shared event_id and a website action source',
  ev.event_id === 'abc123' && ev.action_source === 'website' && typeof ev.event_time === 'number');
check('a contact with no identifiers produces no user identifiers', (() => {
  const p = conv.buildMetaPayload({ contact: {}, eventId: 'x' });
  return !p.data[0].user_data.em && !p.data[0].user_data.ph;
})());

// ── the GA4 payload ──────────────────────────────────────────────────
const ga = conv.buildGa4Payload({ clientId: '111.222', eventId: 'abc123', page: '/contact' });
check('the GA4 payload carries client_id and the shared event_id',
  ga.client_id === '111.222' && ga.events[0].params.event_id === 'abc123');
check('GA4 defaults to the generate_lead event', ga.events[0].name === 'generate_lead');
check('the GA4 client id is read from the _ga cookie when present',
  conv.gaClientId({ headers: { cookie: '_ga=GA1.1.1234567890.9876543210; x=1' } }) === '1234567890.9876543210');
check('no _ga cookie → null, and the sender substitutes a stable stand-in',
  conv.gaClientId({ headers: {} }) === null);

// ── CONSENT DECIDES, on the server too ───────────────────────────────
check('consent is read from the cookie the pixel loader writes',
  conv.consentFromRequest(consented) === 'granted' &&
  conv.consentFromRequest({ headers: { cookie: 'tz_consent=denied' } }) === 'denied' &&
  conv.consentFromRequest({ headers: {} }) === 'unset');

(async () => {
  const noConsent = await conv.sendConversion({ config: cfg(), contact: {}, eventId: 'e1', req: { headers: {} } });
  check('a visitor who never answered has NOTHING sent about them',
    noConsent.reason === 'no-consent' && !noConsent.sent.length);

  const denied = await conv.sendConversion({
    config: cfg(), contact: {}, eventId: 'e1', req: { headers: { cookie: 'tz_consent=denied' } }
  });
  check('a REFUSAL stops the server side too (not just the pixel)',
    denied.reason === 'no-consent' && !denied.sent.length);

  const dnt = await conv.sendConversion({
    config: cfg(), contact: {}, eventId: 'e1',
    req: { headers: { cookie: 'tz_consent=granted', dnt: '1' } }
  });
  check('Do-Not-Track outranks even a granted consent', dnt.reason === 'dnt' && !dnt.sent.length);

  const gpc = await conv.sendConversion({
    config: cfg(), contact: {}, eventId: 'e1',
    req: { headers: { cookie: 'tz_consent=granted', 'sec-gpc': '1' } }
  });
  check('Global Privacy Control is honoured the same way', gpc.reason === 'dnt');

  const off = await conv.sendConversion({ config: cfg({ enabled: false }), contact: {}, eventId: 'e1', req: consented });
  check('disabled → nothing sent', off.reason === 'disabled' && !off.sent.length);

  const crmOff = await conv.sendConversion({ config: cfg({}, false), contact: {}, eventId: 'e1', req: consented });
  check('CRM off → nothing sent even if conversions are configured', crmOff.reason === 'disabled');

  // No credentials → skipped without any network call (keeps this suite offline)
  const bare = await conv.sendConversion({
    config: cfg({ enabled: true, meta: { pixelId: '', accessToken: '' }, ga4: { measurementId: '', apiSecret: '' } }),
    contact: { email: 'a@b.com' }, eventId: 'e1', req: consented
  });
  check('an unconfigured vendor is skipped, never called',
    bare.skipped.includes('meta') && bare.skipped.includes('ga4') && !bare.sent.length);

  // ── the destination cannot be moved ────────────────────────────────
  check('vendor hosts are hardcoded constants, not config',
    conv.META_HOST === 'https://graph.facebook.com' && conv.GA4_HOST === 'https://www.google-analytics.com');
  check('no config key can supply a URL', (() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'crm', 'conversions.js'), 'utf8');
    // the only fetch target is built from the two constants above
    return !/endpoint\s*=\s*[^;]*config/i.test(src) && src.includes('META_HOST') && src.includes('GA4_HOST');
  })());
  check('outbound calls are timeout-bounded', (() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'crm', 'conversions.js'), 'utf8');
    return /AbortSignal\.timeout\(TIMEOUT_MS\)/.test(src) && conv.TIMEOUT_MS > 0 && conv.TIMEOUT_MS <= 10000;
  })());

  // ── secrets never travel back ──────────────────────────────────────
  const described = conv.describeSettings(cfg());
  check('describeSettings reports readiness, never the secret', (() => {
    const s = JSON.stringify(described);
    return !s.includes('SECRET-TOKEN-1234') && !s.includes('SECRET-GA-9876') &&
      described.meta.hasToken === true && described.meta.tokenTail === '1234' &&
      described.ga4.hasSecret === true;
  })());

  // ── the dedup pair ─────────────────────────────────────────────────
  const eid = conv.newEventId();
  check('an event id is long random hex', /^[a-f0-9]{32}$/.test(eid));
  const browserHalf = pixels.renderConversionPixel(cfg(), eid);
  check('the browser half fires the SAME event id (that is what dedupes them)',
    browserHalf.includes(eid) && browserHalf.includes("fbq('track','Lead'") && browserHalf.includes('eventID'));
  check('a hand-typed / forged event id renders nothing',
    pixels.renderConversionPixel(cfg(), 'not-hex') === '' &&
    pixels.renderConversionPixel(cfg(), '<script>alert(1)</script>') === '');
  check('with pixels off there is no browser half at all',
    pixels.renderConversionPixel({ crm: { enabled: true, pixels: { enabled: false } } }, eid) === '');

  // ── the seam still cannot break a form ─────────────────────────────
  const crm = require('../src/crm');
  const config = require('../src/config');
  config.saveConfig(Object.assign(config.loadConfig(), cfg().crm ? { crm: cfg().crm } : {}));
  check('captureForm returns an eventId for the thank-you page', (() => {
    const r = crm.captureForm({ fields: { email: 'lead@example.com' }, page: '/c' });
    return r && /^[a-f0-9]{32}$/.test(r.eventId);
  })());
  check('a broken conversions module still cannot break form capture', (() => {
    const original = conv.sendConversion;
    conv.sendConversion = () => { throw new Error('vendor exploded'); };
    let threw = false, r;
    try { r = crm.captureForm({ fields: { email: 'lead2@example.com' }, page: '/c' }); }
    catch (e) { threw = true; }
    conv.sendConversion = original;
    return !threw && r && r.contact;
  })());

  console.log('');
  console.log(fail ? 'SMOKE CRM-CONVERSIONS: FAIL' : 'SMOKE CRM-CONVERSIONS: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
