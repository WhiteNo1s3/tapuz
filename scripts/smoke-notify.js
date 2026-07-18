'use strict';

/**
 * v0.94 QA gate — lead email notifications: the forms inbox stops being
 * silent. Settings CRUD (password never echoed, undefined/''/value semantics)
 * on a THROWAWAY root via TAPUZ_ROOT, the pure message builder, and the
 * send path with a fake transport (no real SMTP — captures what would have
 * been sent). Exit 1 on any failure.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

// BEFORE any src require — src/paths.js resolves TAPUZ_ROOT at require time
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-notify-'));
process.env.TAPUZ_ROOT = tmpRoot;

const notify = require('../src/notify');

let failures = 0;
function check(cond, label) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

// ── settings: defaults, save, password never echoed ──
const defaults = notify.getSettings();
check(defaults.enabled === false, 'disabled by default');
check(defaults.hasPass === false, 'no password by default');
check(!('pass' in defaults), 'raw password key never present on the public shape');

notify.saveSettings({
  enabled: true,
  to: 'owner@example.com',
  host: 'smtp.example.com',
  port: '465',
  secure: true,
  user: 'bot@example.com',
  pass: 's3cret'
});
let s = notify.getSettings();
check(s.enabled === true, 'enabled saved');
check(s.to === 'owner@example.com', 'recipient saved');
check(s.port === 465, 'port coerced to a number');
check(s.secure === true, 'secure saved');
check(s.hasPass === true, 'hasPass true once a password is set');
check(!('pass' in s), 'password never echoed back once set');
check(JSON.parse(fs.readFileSync(notify.STORE_PATH, 'utf8')).pass === 's3cret',
  'the raw password does persist to disk (just never through getSettings)');

// undefined = keep current password
notify.saveSettings({ to: 'other@example.com' });
check(notify.getSettings().hasPass === true, 'omitting pass keeps the stored one');
check(notify.getSettings().to === 'other@example.com', 'other fields save independently');

// '' = explicit clear
notify.saveSettings({ pass: '' });
check(notify.getSettings().hasPass === false, 'empty-string pass clears it');

// bad port falls back to 587
notify.saveSettings({ port: 'not-a-number' });
check(notify.getSettings().port === 587, 'invalid port falls back to 587');

// ── isConfigured gate ──
check(notify.isConfigured({ enabled: true, to: 'a@b.co', host: 'h', user: 'u', pass: '' }) === false,
  'not configured without a password');
check(notify.isConfigured({ enabled: false, to: 'a@b.co', host: 'h', user: 'u', pass: 'p' }) === false,
  'not configured while disabled');
check(notify.isConfigured({ enabled: true, to: 'a@b.co', host: 'h', user: 'u', pass: 'p' }) === true,
  'configured once every field is present and enabled');

// ── pure message builder — no I/O, deterministic ──
const msg = notify.buildMessage(
  { to: 'owner@example.com', from: '', user: 'bot@example.com' },
  { page: 'צור-קשר', fields: { שם: 'דנה', אימייל: 'dana@example.com' } }
);
check(msg.to === 'owner@example.com', 'message addressed to the configured recipient');
check(msg.from === 'bot@example.com', 'from falls back to the SMTP user when unset');
check(msg.subject.includes('צור-קשר'), 'subject names the source page');
check(msg.text.includes('שם: דנה') && msg.text.includes('אימייל: dana@example.com'),
  'body lists every submitted field');

const msgNoFields = notify.buildMessage({ to: 'x@y.co', user: 'x@y.co' }, { fields: {} });
check(msgNoFields.text.includes('(אין שדות)'), 'empty fields degrade gracefully, never crash');

// ── send path: unconfigured is a graceful no-op ──
notify.saveSettings({ enabled: false });
notify.sendLeadNotification({ page: 'x', fields: { a: '1' } }).then((r) => {
  check(r.ok === false, 'send is a no-op when not enabled/configured');
  runSendTest();
});

function runSendTest() {
  // Re-configure fully, then intercept the transport so no real SMTP is hit.
  notify.saveSettings({
    enabled: true,
    to: 'owner@example.com',
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    user: 'bot@example.com',
    pass: 's3cret'
  });

  let captured = null;
  let shouldThrow = false;
  notify._setTransportFactory(() => ({
    sendMail: async (message) => {
      if (shouldThrow) throw new Error('boom');
      captured = message;
      return { messageId: 'fake' };
    }
  }));

  notify.sendLeadNotification({ page: 'צור-קשר', fields: { שם: 'רות' } }).then((r) => {
    check(r.ok === true, 'send succeeds through the injected transport');
    check(captured && captured.to === 'owner@example.com', 'the real message reached the transport');
    check(captured && captured.text.includes('שם: רות'), 'field data survives into the sent message');

    shouldThrow = true;
    notify.sendLeadNotification({ page: 'x', fields: { a: '1' } }).then((r2) => {
      check(r2.ok === false && r2.error === 'boom', 'a transport failure is caught, never thrown');

      try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}

      console.log('');
      if (failures) {
        console.log('SMOKE NOTIFY: FAIL (' + failures + ')');
        process.exit(1);
      }
      console.log('SMOKE NOTIFY: PASS');
    });
  });
}
