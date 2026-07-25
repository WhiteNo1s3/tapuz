'use strict';

/**
 * Lead email notifications (v0.94) — the forms inbox stops being silent.
 *
 * Mirrors the ai.js pattern: SMTP credentials live in gitignored
 * config/notify.json (never site.json, never echoed by any API — hasPass
 * only). Sending is best-effort and fire-and-forget from the caller's POV:
 * a misconfigured or unreachable SMTP server must never break form capture.
 */

const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./paths');

const STORE_PATH = path.join(CONFIG_DIR, 'notify.json');

function load() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (data && typeof data === 'object') return data;
    }
  } catch (e) { /* fall through */ }
  return { enabled: false, to: '', from: '', host: '', port: 587, secure: false, user: '', pass: '' };
}

function save(data) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

/** Public settings — NEVER includes the password itself. */
function getSettings() {
  const s = load();
  return {
    enabled: !!s.enabled,
    to: s.to || '',
    from: s.from || '',
    host: s.host || '',
    port: s.port || 587,
    secure: !!s.secure,
    user: s.user || '',
    hasPass: !!(s.pass && String(s.pass).length)
  };
}

/**
 * @param {{enabled?, to?, from?, host?, port?, secure?, user?, pass?}} patch
 *  pass: undefined = keep current; '' = clear; value = replace.
 */
function saveSettings(patch = {}) {
  const s = load();
  if (patch.enabled !== undefined) s.enabled = !!patch.enabled;
  if (patch.to !== undefined) s.to = String(patch.to || '').trim().slice(0, 300);
  if (patch.from !== undefined) s.from = String(patch.from || '').trim().slice(0, 300);
  if (patch.host !== undefined) s.host = String(patch.host || '').trim().slice(0, 300);
  if (patch.port !== undefined) {
    const p = parseInt(patch.port, 10);
    s.port = Number.isFinite(p) && p > 0 && p < 65536 ? p : 587;
  }
  if (patch.secure !== undefined) s.secure = !!patch.secure;
  if (patch.user !== undefined) s.user = String(patch.user || '').trim().slice(0, 300);
  if (patch.pass !== undefined) s.pass = String(patch.pass || '');
  save(s);
  return getSettings();
}

function isConfigured(s) {
  return !!(s.enabled && s.to && s.host && s.user && s.pass);
}

/**
 * Pure — the message a lead notification would send. No I/O, so it's
 * unit-testable without SMTP. `lead`: {id, page, fields}.
 */
function buildMessage(publicSettings, lead) {
  const fields = lead && lead.fields && typeof lead.fields === 'object' ? lead.fields : {};
  const fieldLines = Object.entries(fields).map(([k, v]) => k + ': ' + v).join('\n') || '(אין שדות)';
  const page = (lead && lead.page) || '(לא ידוע)';
  return {
    from: publicSettings.from || publicSettings.user,
    to: publicSettings.to,
    subject: 'פנייה חדשה מהאתר' + (lead && lead.page ? ' — ' + lead.page : ''),
    text: 'התקבלה פנייה חדשה דרך טופס באתר.\n\nעמוד: ' + page + '\n\n' + fieldLines
      + '\n\nלצפייה בכל הפניות: /admin/inbox'
  };
}

// Test hook — lets smoke tests capture the sent message without real SMTP.
let transportFactory = null;
function _setTransportFactory(fn) { transportFactory = fn; }

/**
 * Fire on a new lead. Never throws — always resolves {ok, error?}.
 * No-op (ok:false) when notifications aren't fully configured.
 */
async function sendLeadNotification(lead) {
  const raw = load();
  if (!isConfigured(raw)) return { ok: false, error: 'not configured' };
  try {
    const transport = transportFactory
      ? transportFactory(raw)
      : require('nodemailer').createTransport({
          host: raw.host,
          port: raw.port,
          secure: !!raw.secure,
          auth: { user: raw.user, pass: raw.pass }
        });
    const message = buildMessage(getSettings(), lead || {});
    await transport.sendMail(message);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Send an arbitrary message through the configured SMTP transport (v1.80).
 *
 * SMTP belongs to exactly one module, and this is it — the CRM's campaign
 * sender goes through here rather than reaching for nodemailer itself, so
 * credentials, transport construction and the test hook all stay in one place.
 *
 * @param {{to:string, subject:string, html?:string, text?:string, headers?:object}} message
 * @returns {Promise<{ok:boolean, error?:string}>} never throws
 */
async function sendMail(message) {
  const raw = load();
  if (!isConfigured(raw)) return { ok: false, error: 'not configured' };
  if (!message || !message.to) return { ok: false, error: 'no recipient' };
  try {
    const transport = transportFactory
      ? transportFactory(raw)
      : require('nodemailer').createTransport({
          host: raw.host,
          port: raw.port,
          secure: !!raw.secure,
          auth: { user: raw.user, pass: raw.pass }
        });
    await transport.sendMail(Object.assign({ from: raw.from || raw.user }, message));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  getSettings,
  saveSettings,
  isConfigured,
  buildMessage,
  sendLeadNotification,
  sendMail,
  _setTransportFactory,
  STORE_PATH
};
