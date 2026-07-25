'use strict';

/**
 * v1.84 QA — WhatsApp phase W0: the switch and the credentials.
 *
 * The whole point of this phase is that the destination cannot be moved. The
 * lab accepted any `https://` host as a setting, which is a config key deciding
 * where a long-lived access token is sent. These tests exist to make sure that
 * cannot come back.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-wa-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const wa = require('../src/crm/whatsapp');
const config = require('../src/config');

// ── off by default, and under the CRM flag ───────────────────────────
check('WhatsApp is off in a fresh config', (() => {
  const c = config.loadConfig();
  return !(c.crm && c.crm.whatsapp && c.crm.whatsapp.enabled);
})());
check('nothing is configured yet', wa.isConfigured({}) === false);
check('the channel is disabled while the CRM is off',
  wa.isEnabled({ crm: { enabled: false, whatsapp: { enabled: true } } }) === false);
check('the channel is disabled while unconfigured, even when switched on',
  wa.isEnabled({ crm: { enabled: true, whatsapp: { enabled: true } } }) === false);

// ── THE DESTINATION CANNOT MOVE ──────────────────────────────────────
check('the Graph host is a constant', wa.GRAPH_HOST === 'https://graph.facebook.com');
check('a graphBase setting is REFUSED, not honoured', (() => {
  wa.saveSettings({ graphBase: 'https://evil.example', phoneNumberId: '123' });
  const s = wa.getSettings();
  const raw = wa._load();
  return s.graphHost === 'https://graph.facebook.com' &&
    raw.graphBase === undefined && raw.graphHost === undefined;
})());
check('a graphHost setting is also refused', (() => {
  wa.saveSettings({ graphHost: 'https://evil.example' });
  return wa._load().graphHost === undefined && wa.getSettings().graphHost === wa.GRAPH_HOST;
})());
check('every built endpoint starts at the constant host', (() => {
  wa.saveSettings({ phoneNumberId: '987654321' });
  const url = wa.endpointFor('messages');
  return url.startsWith('https://graph.facebook.com/') && url.endsWith('/987654321/messages');
})());
check('a hostile path suffix cannot climb out of the URL', (() => {
  const url = wa.endpointFor('../../me?access_token=');
  return url === 'https://graph.facebook.com/v21.0/987654321/me' ||
    (url.startsWith('https://graph.facebook.com/') && !url.includes('..') && !url.includes('?'));
})());
check('the source file has no configurable host', (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'crm', 'whatsapp.js'), 'utf8');
  // the only https:// literal is the constant, and nothing reads a host from input
  const literals = (src.match(/https:\/\/[^'"`\s]+/g) || []).filter((u) => u !== 'https://graph.facebook.com');
  return literals.length === 0 && !/graphBase\s*=\s*[^;]*patch/.test(src);
})());

// ── api version is a path segment, so it is whitelisted ──────────────
check('a known api version is kept', wa.normalizeApiVersion('v20.0') === 'v20.0');
check('an unknown api version falls back', wa.normalizeApiVersion('v99.0') === wa.DEFAULT_API_VERSION);
check('a path-traversal api version falls back',
  wa.normalizeApiVersion('../../evil') === wa.DEFAULT_API_VERSION);
check('an empty api version falls back', wa.normalizeApiVersion('') === wa.DEFAULT_API_VERSION);

// ── ids are sanitized ────────────────────────────────────────────────
check('ids keep digits only', (() => {
  const s = wa.saveSettings({ phoneNumberId: '12a3<script>4', wabaId: 'x9y9' });
  return s.phoneNumberId === '1234' && s.wabaId === '99';
})());

// ── secrets never come back ──────────────────────────────────────────
check('secrets are stored but never echoed', (() => {
  const s = wa.saveSettings({
    accessToken: 'EAAG-VERY-SECRET-TOKEN-1234',
    appSecret: 'APPSECRET-9876',
    verifyToken: 'verify-me-5555'
  });
  const json = JSON.stringify(s);
  return !json.includes('EAAG-VERY-SECRET-TOKEN-1234') &&
    !json.includes('APPSECRET-9876') &&
    !json.includes('verify-me-5555') &&
    s.hasToken === true && s.tokenTail === '1234' &&
    s.hasAppSecret === true && s.appSecretTail === '9876' &&
    s.hasVerifyToken === true;
})());
check('the secrets really were persisted', (() => {
  const raw = wa._load();
  return raw.accessToken === 'EAAG-VERY-SECRET-TOKEN-1234' && raw.appSecret === 'APPSECRET-9876';
})());
check('an omitted secret is KEPT, not wiped', (() => {
  wa.saveSettings({ phoneNumberId: '555' }); // no token in the patch
  return wa._load().accessToken === 'EAAG-VERY-SECRET-TOKEN-1234';
})());
check('an explicitly empty secret clears it', (() => {
  wa.saveSettings({ verifyToken: '' });
  return wa._load().verifyToken === '' && wa.getSettings().hasVerifyToken === false;
})());

// ── now fully configured ─────────────────────────────────────────────
check('with id + token + app secret it reports configured', (() => {
  wa.saveSettings({ phoneNumberId: '123456', accessToken: 'tok', appSecret: 'sec' });
  return wa.isConfigured() === true &&
    wa.isEnabled({ crm: { enabled: true, whatsapp: { enabled: true } } }) === true;
})());

// ── the credential file is gitignored ────────────────────────────────
check('config/whatsapp.json is gitignored', (() => {
  const gi = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  return /^config\/whatsapp\.json$/m.test(gi);
})());
check('nothing can send or spend in this phase', (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'crm', 'whatsapp.js'), 'utf8');
  return !/fetch\(/.test(src) && !/sendMessage|sendTemplate/.test(src);
})());

console.log('');
console.log(fail ? 'SMOKE WHATSAPP: FAIL' : 'SMOKE WHATSAPP: PASS');
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
process.exit(fail ? 1 : 0);
