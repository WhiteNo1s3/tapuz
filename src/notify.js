'use strict';

/**
 * SMTP mail (v0.94 leads, v1.80+ campaigns, v1.95 hardened).
 *
 * Credentials live in gitignored config/notify.json — never site.json, never
 * echoed by any API (hasPass only). Sending is best-effort: a bad SMTP setup
 * must never break form capture or freeze the admin request.
 *
 * Hardening (v1.95) — what separates "hobby SMTP" from a CRM that mails:
 *
 *   1. SPLIT GATES — lead inbox needs a `to`; campaigns only need a working
 *      transport (host/user/pass). One config, two readiness checks.
 *   2. TRANSPORT TIMEOUTS — connection / greeting / socket cannot hang forever.
 *   3. HEADER INJECTION — to/from/subject cannot carry CR/LF or raw junk.
 *   4. DAILY CAP — runaway campaign or loop cannot burn the owner's reputation
 *      (or a free Gmail account) past a configurable ceiling.
 *   5. ONE TRANSPORT BUILDER — credentials, TLS, test hook, all in one place.
 */

const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./paths');
const { FixedWindowLimiter } = require('./ratelimit');

const STORE_PATH = path.join(CONFIG_DIR, 'notify.json');
const USAGE_PATH = path.join(CONFIG_DIR, 'notify-usage.json');

const DEFAULT_MAX_PER_DAY = 500;
const DEFAULT_PORT = 587;

// Coarse flood guard: per-process, on top of the daily cap.
const sendLimiter = new FixedWindowLimiter({ windowMs: 60 * 1000, max: 120 });

function defaults() {
  return {
    enabled: false,
    to: '',
    from: '',
    host: '',
    port: DEFAULT_PORT,
    secure: false,
    user: '',
    pass: '',
    // Hardening knobs (safe defaults)
    maxPerDay: DEFAULT_MAX_PER_DAY,
    // Lab / broken relays only — production should leave this false.
    tlsAllowInsecure: false,
    connectionTimeoutMs: 15000,
    socketTimeoutMs: 30000
  };
}

function load() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (data && typeof data === 'object') return Object.assign(defaults(), data);
    }
  } catch (e) { /* fall through */ }
  return defaults();
}

function save(data) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

function clampPort(p) {
  const n = parseInt(p, 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

function clampMs(v, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 3000), 120000);
}

/** Public settings — NEVER includes the password itself. */
function getSettings() {
  const s = load();
  return {
    enabled: !!s.enabled,
    to: s.to || '',
    from: s.from || '',
    host: s.host || '',
    port: s.port || DEFAULT_PORT,
    secure: !!s.secure,
    user: s.user || '',
    hasPass: !!(s.pass && String(s.pass).length),
    maxPerDay: s.maxPerDay || DEFAULT_MAX_PER_DAY,
    tlsAllowInsecure: !!s.tlsAllowInsecure,
    // Split readiness: campaigns vs lead inbox alerts
    smtpReady: isSmtpReady(s),
    leadReady: isConfigured(s),
    sentToday: usageToday().count
  };
}

/**
 * @param {{enabled?, to?, from?, host?, port?, secure?, user?, pass?, maxPerDay?, tlsAllowInsecure?}} patch
 *  pass: undefined = keep current; '' = clear; value = replace.
 */
function saveSettings(patch = {}) {
  const s = load();
  if (patch.enabled !== undefined) s.enabled = !!patch.enabled;
  if (patch.to !== undefined) s.to = String(patch.to || '').trim().slice(0, 300);
  if (patch.from !== undefined) s.from = String(patch.from || '').trim().slice(0, 300);
  if (patch.host !== undefined) s.host = String(patch.host || '').trim().slice(0, 300);
  if (patch.port !== undefined) s.port = clampPort(patch.port);
  if (patch.secure !== undefined) s.secure = !!patch.secure;
  if (patch.user !== undefined) s.user = String(patch.user || '').trim().slice(0, 300);
  if (patch.pass !== undefined) s.pass = String(patch.pass || '');
  if (patch.maxPerDay !== undefined) {
    const m = parseInt(patch.maxPerDay, 10);
    s.maxPerDay = Number.isFinite(m) && m >= 1 ? Math.min(m, 50000) : DEFAULT_MAX_PER_DAY;
  }
  if (patch.tlsAllowInsecure !== undefined) s.tlsAllowInsecure = !!patch.tlsAllowInsecure;
  if (patch.connectionTimeoutMs !== undefined) {
    s.connectionTimeoutMs = clampMs(patch.connectionTimeoutMs, 15000);
  }
  if (patch.socketTimeoutMs !== undefined) {
    s.socketTimeoutMs = clampMs(patch.socketTimeoutMs, 30000);
  }
  save(s);
  // Force rebuild of any cached transport after settings change
  cachedTransport = null;
  cachedTransportKey = '';
  return getSettings();
}

/** Lead-inbox notifications: need a destination address. */
function isConfigured(s) {
  const c = s || load();
  return !!(c.enabled && c.to && c.host && c.user && c.pass);
}

/** Campaign / arbitrary sendMail: transport only (no fixed `to`). */
function isSmtpReady(s) {
  const c = s || load();
  return !!(c.enabled && c.host && c.user && c.pass);
}

// ─── address / header hygiene ────────────────────────────────────────

/**
 * Reject header injection and obvious garbage. Not a full RFC 5322 parser —
 * enough to stop CR/LF and empty junk from reaching SMTP.
 */
function sanitizeAddress(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s || s.length > 320) return '';
  if (/[\r\n\0]/.test(s)) return '';
  // single mailbox, no comma lists for campaign to= (one recipient per send)
  if (s.indexOf(',') >= 0) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return '';
  return s;
}

function sanitizeHeaderValue(raw, max = 300) {
  return String(raw == null ? '' : raw)
    .replace(/[\r\n\0]+/g, ' ')
    .trim()
    .slice(0, max);
}

// ─── daily usage (reputation guard) ──────────────────────────────────

function todayKey() {
  return new Date().toISOString().slice(0, 10); // UTC day is fine for a soft cap
}

function usageToday() {
  try {
    if (fs.existsSync(USAGE_PATH)) {
      const u = JSON.parse(fs.readFileSync(USAGE_PATH, 'utf8'));
      if (u && u.day === todayKey()) return { day: u.day, count: Number(u.count) || 0 };
    }
  } catch (e) { /* */ }
  return { day: todayKey(), count: 0 };
}

function recordSendSuccess(n = 1) {
  const cur = usageToday();
  const next = { day: cur.day, count: cur.count + Math.max(1, n) };
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(USAGE_PATH, JSON.stringify(next, null, 2));
  } catch (e) { /* non-fatal */ }
  return next;
}

function remainingToday(s) {
  const c = s || load();
  const max = c.maxPerDay || DEFAULT_MAX_PER_DAY;
  const used = usageToday().count;
  return Math.max(0, max - used);
}

// ─── transport ───────────────────────────────────────────────────────

let transportFactory = null;
function _setTransportFactory(fn) {
  transportFactory = fn;
  cachedTransport = null;
  cachedTransportKey = '';
}

let cachedTransport = null;
let cachedTransportKey = '';

function transportKey(raw) {
  return [raw.host, raw.port, raw.secure, raw.user, raw.tlsAllowInsecure, !!raw.pass].join('|');
}

function buildTransportOptions(raw) {
  return {
    host: raw.host,
    port: raw.port || DEFAULT_PORT,
    secure: !!raw.secure,
    auth: { user: raw.user, pass: raw.pass },
    connectionTimeout: clampMs(raw.connectionTimeoutMs, 15000),
    greetingTimeout: clampMs(raw.connectionTimeoutMs, 15000),
    socketTimeout: clampMs(raw.socketTimeoutMs, 30000),
    tls: {
      // Default: verify certs. Lab can set tlsAllowInsecure for broken relays.
      rejectUnauthorized: !raw.tlsAllowInsecure
    },
    // Do not pool forever — short campaigns, clean close
    pool: false
  };
}

function getTransport(raw) {
  if (transportFactory) return transportFactory(raw);
  const key = transportKey(raw);
  if (cachedTransport && cachedTransportKey === key) return cachedTransport;
  const nodemailer = require('nodemailer');
  cachedTransport = nodemailer.createTransport(buildTransportOptions(raw));
  cachedTransportKey = key;
  return cachedTransport;
}

/**
 * Pure — the message a lead notification would send. No I/O.
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

/**
 * Fire on a new lead. Never throws — always resolves {ok, error?}.
 */
async function sendLeadNotification(lead) {
  const raw = load();
  if (!isConfigured(raw)) return { ok: false, error: 'not configured' };
  const msg = buildMessage(getSettings(), lead || {});
  return sendMail(msg);
}

/**
 * Send one message through the configured SMTP transport.
 * Never throws. Used by campaigns and lead notify.
 *
 * @param {{to:string, subject:string, html?:string, text?:string, headers?:object, from?:string}} message
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
async function sendMail(message) {
  const raw = load();
  if (!isSmtpReady(raw)) return { ok: false, error: 'smtp not ready' };
  if (!message) return { ok: false, error: 'no message' };

  const to = sanitizeAddress(message.to);
  if (!to) return { ok: false, error: 'invalid recipient' };

  const from = sanitizeAddress(message.from || raw.from || raw.user);
  if (!from) return { ok: false, error: 'invalid from' };

  const subject = sanitizeHeaderValue(message.subject || '(no subject)', 300);

  if (!sendLimiter.allow('smtp')) {
    return { ok: false, error: 'rate limited' };
  }

  if (remainingToday(raw) < 1) {
    return { ok: false, error: 'daily send cap reached' };
  }

  // Strip CR/LF from custom headers
  const headers = {};
  if (message.headers && typeof message.headers === 'object') {
    for (const [k, v] of Object.entries(message.headers)) {
      const key = String(k).replace(/[\r\n\0:]+/g, '').slice(0, 80);
      if (!key) continue;
      headers[key] = sanitizeHeaderValue(v, 1000);
    }
  }

  try {
    const transport = getTransport(raw);
    const payload = {
      from,
      to,
      subject,
      headers
    };
    if (message.html) payload.html = String(message.html);
    if (message.text) payload.text = String(message.text);
    if (!payload.html && !payload.text) payload.text = '';

    await transport.sendMail(payload);
    recordSendSuccess(1);
    return { ok: true };
  } catch (e) {
    // Drop cached transport after failure — next send rebuilds cleanly
    cachedTransport = null;
    cachedTransportKey = '';
    const err = String(e && e.message ? e.message : e).slice(0, 300);
    // Never echo credentials if nodemailer ever includes them (it shouldn't)
    return { ok: false, error: err.replace(raw.pass || '___', '[redacted]') };
  }
}

/**
 * Admin: verify SMTP can connect (optional true send is still /notify/test).
 * Uses nodemailer verify() when available; never throws.
 */
async function verifyConnection() {
  const raw = load();
  if (!isSmtpReady(raw)) {
    return { ok: false, error: 'smtp not ready — host, user, password, and enabled required' };
  }
  try {
    const transport = getTransport(raw);
    if (typeof transport.verify === 'function') {
      await transport.verify();
    }
    return { ok: true };
  } catch (e) {
    cachedTransport = null;
    cachedTransportKey = '';
    return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 300) };
  }
}

/** How many campaign recipients can we still accept today? */
function canQueue(n) {
  const need = Math.max(0, parseInt(n, 10) || 0);
  const left = remainingToday();
  return { ok: need <= left, remaining: left, maxPerDay: load().maxPerDay || DEFAULT_MAX_PER_DAY };
}

module.exports = {
  getSettings,
  saveSettings,
  isConfigured,
  isSmtpReady,
  buildMessage,
  sendLeadNotification,
  sendMail,
  verifyConnection,
  sanitizeAddress,
  sanitizeHeaderValue,
  remainingToday,
  canQueue,
  usageToday,
  recordSendSuccess,
  buildTransportOptions,
  _setTransportFactory,
  STORE_PATH,
  USAGE_PATH,
  DEFAULT_MAX_PER_DAY
};
