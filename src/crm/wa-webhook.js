'use strict';

/**
 * CRM — WhatsApp Cloud API webhook processing (v1.87, phase W2).
 *
 * Pure logic, no express: the signature check, the GET handshake, and turning
 * a VERIFIED event body into ledger updates. The route module
 * (src/routes/wa-webhook.js) owns HTTP; this module owns correctness, so the
 * hard part is testable without a socket.
 *
 * The signature contract (Meta): `X-Hub-Signature-256` is
 * `'sha256=' + HMAC_SHA256(app_secret, raw_body_bytes)` — computed over the
 * RAW BYTES as sent. A body that was parsed and re-serialized produces a
 * different digest, which is why the route mounts before every body parser
 * in server.js. Ported from the lab essentially as-is: it got all four
 * classic failure modes right (raw body, mount order, length check before
 * timingSafeEqual, fail closed).
 */

const crypto = require('crypto');
const ledger = require('./wa-ledger');

// ── the signature ────────────────────────────────────────────────────

/**
 * Fail closed on every edge: no secret → false, no header → false, a body
 * that is not raw bytes → false. That last one is the runtime tripwire for
 * the mount-order mistake — if a JSON parser upstream consumed the body,
 * req.body is an object and every request 401s loudly instead of a silent
 * "signatures never match" mystery.
 */
function verifySignature256(rawBody, headerValue, appSecret) {
  if (appSecret == null || appSecret === '') return false;
  if (headerValue == null || headerValue === '') return false;
  if (rawBody == null || (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string')) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(headerValue));
  // timingSafeEqual THROWS on length mismatch — compare lengths first so a
  // short forged header is a false, not a 500.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── the GET handshake ────────────────────────────────────────────────

/**
 * Meta's subscription challenge. Express's default query parser keeps the
 * literal `hub.mode` keys; the underscore forms are accepted too.
 */
function handleVerifyQuery(query, verifyToken) {
  const q = query || {};
  const mode = q['hub.mode'] || q.hub_mode;
  const token = q['hub.verify_token'] || q.hub_verify_token;
  const challenge = q['hub.challenge'] || q.hub_challenge;
  if (mode === 'subscribe' && token && verifyToken && token === verifyToken) {
    return { ok: true, challenge: String(challenge == null ? '' : challenge) };
  }
  return { ok: false, status: 403, error: 'verify_token_mismatch' };
}

// ── event processing (body already verified) ─────────────────────────

/** A human-readable line for the ledger; media become markers, not blobs. */
function extractTextBody(msg) {
  if (!msg || typeof msg !== 'object') return '';
  if (msg.type === 'text' && msg.text) return String(msg.text.body || '');
  if (msg.type === 'button' && msg.button) return String(msg.button.text || msg.button.payload || '');
  if (msg.type === 'interactive' && msg.interactive) {
    const i = msg.interactive;
    if (i.button_reply) return String(i.button_reply.title || i.button_reply.id || '');
    if (i.list_reply) return String(i.list_reply.title || i.list_reply.id || '');
  }
  if (['image', 'audio', 'video', 'document', 'sticker', 'location'].includes(msg.type)) {
    return '[' + msg.type + ']';
  }
  return msg.type ? '[' + msg.type + ']' : '';
}

/** The sender's display name, from the webhook's contacts[] sidecar. */
function profileNameFor(from, value) {
  const arr = Array.isArray(value && value.contacts) ? value.contacts : [];
  const hit = arr.find((c) => c && ledger.normalizeToWaId(c.wa_id) === from);
  return hit && hit.profile && hit.profile.name ? String(hit.profile.name) : '';
}

/**
 * One inbound message → one ledger row — and (W4) one PERSON. The phone is
 * resolved to a contact first, created from the WhatsApp profile if unknown,
 * so recordMessage links the row and joins the timeline in the same breath:
 * a WhatsApp conversation and a web enquiry sit on one person's history.
 * recordMessage still does W1's work: wamid dedup (Meta retries until it
 * sees a 2xx) and opening the customer-service window.
 */
function processInbound(msg, value) {
  const from = ledger.normalizeToWaId(msg && (msg.from || msg.wa_id));
  if (!from) return { ok: false, error: 'invalid_from' };
  const contactId = ledger.ensureContact(from, profileNameFor(from, value));
  const id = ledger.recordMessage({
    phone: from,
    direction: 'in',
    body: extractTextBody(msg),
    waMessageId: msg.id ? String(msg.id) : null
  });
  return { ok: id != null, id, contactId };
}

/**
 * One status callback → refine the ledger row it names. This is where PMP
 * "charge at delivery" lands: Meta's pricing object arrives with the
 * `delivered` status, and billable/pricing are corrected from it.
 */
function processStatus(st) {
  const wamid = st && st.id ? String(st.id) : '';
  const status = String((st && st.status) || '').toLowerCase();
  if (!wamid || !['sent', 'delivered', 'read', 'failed'].includes(status)) {
    return { ok: false, error: 'unknown_status' };
  }
  const patch = { status };
  if (st.pricing && typeof st.pricing === 'object') {
    if (st.pricing.billable !== undefined) {
      patch.billable = !!st.pricing.billable;
      patch.pricingType = st.pricing.billable ? 'regular' : 'free_customer_service';
    }
    if (st.pricing.category) patch.pricingCategory = String(st.pricing.category);
  }
  if (Array.isArray(st.errors) && st.errors[0]) {
    const e = st.errors[0];
    patch.error = String(e.code || '') + ' ' + String(e.title || e.message || '');
  }
  // an unknown wamid is a no-op, not an error — Meta may replay history
  return { ok: ledger.updateStatus(wamid, patch), wamid, status };
}

/** Walk the verified body. Anything that is not ours is skipped, never a 4xx. */
function processWebhookBody(body) {
  let inbound = 0;
  let statuses = 0;
  if (!body || body.object !== 'whatsapp_business_account') {
    return { ok: true, inbound, statuses, skipped: true };
  }
  const entries = Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry && entry.changes) ? entry.changes : [];
    for (const ch of changes) {
      if (ch.field && ch.field !== 'messages') continue;
      const value = (ch && ch.value) || {};
      if (Array.isArray(value.messages)) {
        for (const msg of value.messages) if (processInbound(msg, value).ok) inbound++;
      }
      if (Array.isArray(value.statuses)) {
        for (const st of value.statuses) if (processStatus(st).ok) statuses++;
      }
    }
  }
  return { ok: true, inbound, statuses };
}

/**
 * The whole POST, as a pure function of (bytes, header, secret).
 * Refusal order: bad signature → 401 (before the body is even parsed),
 * unparseable JSON with a VALID signature → 400, everything else → 200.
 */
function handlePost({ rawBody, signatureHeader, appSecret } = {}) {
  if (!verifySignature256(rawBody, signatureHeader, appSecret)) {
    return { ok: false, status: 401, error: 'invalid_signature' };
  }
  let body;
  try {
    body = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
  } catch (e) {
    return { ok: false, status: 400, error: 'invalid_json' };
  }
  return { status: 200, ...processWebhookBody(body) };
}

module.exports = {
  verifySignature256, handleVerifyQuery, extractTextBody,
  processInbound, processStatus, processWebhookBody, handlePost
};
