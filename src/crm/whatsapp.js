'use strict';

/**
 * CRM — WhatsApp Cloud API settings (v1.84, phase W0 of
 * docs/WHATSAPP-INTEGRATION.md).
 *
 * Phase W0 is deliberately only the switch and the credentials: no schema, no
 * webhook, no sending. Nothing here can send a message or spend money, so it is
 * safe to land ahead of the parts that can.
 *
 * THE ONE THING THIS FILE EXISTS TO GET RIGHT
 *
 * The lab made the Graph host a SETTING — any value beginning `https://` was
 * accepted. That is a configuration key which decides **where a long-lived
 * access token is sent**, and it is the same pattern refused in CRM phase 3b
 * (`conversions.js`) and in the AI layer's `ALLOWED_API_HOSTS`. A mistyped or
 * tampered config becomes credential exfiltration with no exploit required.
 *
 * So here the host is a CONSTANT. `apiVersion` stays configurable because it is
 * a path segment, not a destination — and it is charset-checked anyway, since a
 * value like `../../evil` would climb out of the intended path.
 */

const fs = require('fs');
const path = require('path');

const { CONFIG_DIR } = require('../paths');
const STORE_PATH = path.join(CONFIG_DIR, 'whatsapp.json');

/** NOT configurable. See the note above. */
const GRAPH_HOST = 'https://graph.facebook.com';

/** The versions we are willing to address. An unknown value falls back. */
const API_VERSIONS = ['v21.0', 'v20.0', 'v19.0'];
const DEFAULT_API_VERSION = 'v21.0';

function load() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (raw && typeof raw === 'object') return raw;
    }
  } catch (e) { /* unreadable store = unconfigured, never a crash */ }
  return {};
}

function save(data) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/** Is the channel switched on AND usable? */
function isEnabled(config) {
  const crm = (config && config.crm) || {};
  if (!(crm.enabled && crm.whatsapp && crm.whatsapp.enabled)) return false;
  return isConfigured(load());
}

/** Everything needed to actually talk to Meta is present. */
function isConfigured(s) {
  const raw = s || load();
  return !!(
    String(raw.phoneNumberId || '').trim() &&
    String(raw.accessToken || '').trim() &&
    String(raw.appSecret || '').trim()
  );
}

/**
 * Admin-facing settings. NEVER returns a secret — readiness plus a last-4 tail,
 * the pattern established by `ai.js` and `conversions.js`.
 */
function getSettings() {
  const s = load();
  const tail = (v) => (v ? String(v).slice(-4) : '');
  return {
    apiVersion: normalizeApiVersion(s.apiVersion),
    graphHost: GRAPH_HOST,            // shown so the owner can see where we send
    phoneNumberId: String(s.phoneNumberId || ''),
    wabaId: String(s.wabaId || ''),
    displayPhoneNumber: String(s.displayPhoneNumber || ''),
    hasToken: !!String(s.accessToken || '').trim(),
    tokenTail: tail(s.accessToken),
    hasAppSecret: !!String(s.appSecret || '').trim(),
    appSecretTail: tail(s.appSecret),
    hasVerifyToken: !!String(s.verifyToken || '').trim(),
    configured: isConfigured(s)
  };
}

function normalizeApiVersion(v) {
  const s = String(v || '').trim();
  return API_VERSIONS.includes(s) ? s : DEFAULT_API_VERSION;
}

/**
 * Write settings.
 *
 * Secret semantics match the rest of the CMS: `undefined` keeps what is stored,
 * `''` clears it. An empty form field must never silently wipe a credential the
 * owner cannot read back.
 *
 * @returns {object} the REDACTED settings (so even this path cannot echo a secret)
 */
function saveSettings(patch = {}) {
  const s = load();

  if (patch.apiVersion !== undefined) s.apiVersion = normalizeApiVersion(patch.apiVersion);
  // Ids are numeric strings at Meta; anything else is a typo or an attack.
  if (patch.phoneNumberId !== undefined) {
    s.phoneNumberId = String(patch.phoneNumberId || '').replace(/\D/g, '').slice(0, 32);
  }
  if (patch.wabaId !== undefined) {
    s.wabaId = String(patch.wabaId || '').replace(/\D/g, '').slice(0, 32);
  }
  if (patch.displayPhoneNumber !== undefined) {
    s.displayPhoneNumber = String(patch.displayPhoneNumber || '').replace(/[^\d+]/g, '').slice(0, 32);
  }
  // Secrets: keep-on-undefined, clear-on-empty-string.
  if (patch.accessToken !== undefined) s.accessToken = String(patch.accessToken || '').trim();
  if (patch.appSecret !== undefined) s.appSecret = String(patch.appSecret || '').trim();
  if (patch.verifyToken !== undefined) s.verifyToken = String(patch.verifyToken || '').trim().slice(0, 200);

  // NOTE: `graphBase`/`graphHost` are deliberately NOT accepted. If a caller
  // passes one it is dropped on the floor rather than honoured.
  delete s.graphBase;
  delete s.graphHost;

  save(s);
  return getSettings();
}

/**
 * The endpoint for a Cloud API call, built from the constant host.
 * Exported so a test can assert no input can move the destination.
 *
 * @param {string} pathSuffix e.g. 'messages'
 */
function endpointFor(pathSuffix) {
  const s = load();
  const id = String(s.phoneNumberId || '').replace(/\D/g, '');
  if (!id) return '';
  const suffix = String(pathSuffix || 'messages').replace(/[^a-z_]/gi, '');
  return `${GRAPH_HOST}/${normalizeApiVersion(s.apiVersion)}/${id}/${suffix}`;
}

module.exports = {
  GRAPH_HOST, API_VERSIONS, DEFAULT_API_VERSION, STORE_PATH,
  isEnabled, isConfigured, getSettings, saveSettings, normalizeApiVersion, endpointFor,
  _load: load
};
