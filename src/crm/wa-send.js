'use strict';

/**
 * CRM — WhatsApp sending (v1.88, phase W3). Money leaves the building HERE
 * and nowhere else.
 *
 * The design is the sum of everything the earlier phases prepared:
 *
 *   - Every refusal happens LOCALLY, before any network: `decideSend` (W1's
 *     pure gate) runs first, so free-form outside the window, marketing
 *     without an opt-in, and the tier ceiling are refused by us — never
 *     discovered as a rejection (or a blocked number) at Meta's end.
 *   - The destination is NOT configurable: the URL comes from
 *     `whatsapp.endpointFor()`, built on the hardcoded Graph host. This
 *     module contains no URL of its own — the test greps it to keep it so.
 *   - The call is timeout-bounded and never throws (the conversions.js
 *     pattern): a dead or hanging Graph endpoint resolves to a small error
 *     object; it cannot hold a request open past the deadline.
 *   - A FAILED call sent nothing, so its audit row is written with
 *     `outside_csw = 0` and no pricing — a failure must not consume tier
 *     quota (the counter reads `outside_csw = 1` rows) and must not count
 *     as billable. Pricing truth arrives later anyway: the W2 webhook
 *     refines billable/category at delivery, which is when Meta charges.
 */

const wa = require('./whatsapp');
const ledger = require('./wa-ledger');

/** A hanging endpoint resolves, not hangs — see postGraph. */
const TIMEOUT_MS = 8000;

// ── the transport ────────────────────────────────────────────────────

/**
 * POST to Graph with a hard timeout. Resolves to {status, json} or
 * {status: 0, error}; NEVER throws — a network failure is Meta's problem
 * to report, not ours to crash on.
 */
async function postGraph(url, payload, token, timeoutMs = TIMEOUT_MS) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  } catch (e) {
    return { status: 0, error: e.name === 'TimeoutError' ? 'timeout' : String(e.message || e) };
  }
}

// ── the payload ──────────────────────────────────────────────────────

/**
 * W3 sends the two shapes the spec gates actually distinguish: free-form
 * text (window-only, free) and a named template. Template variable
 * components are a later phase — a variable-less template sends fine.
 */
function buildPayload(waId, { msgType, body, templateName, templateLanguage } = {}) {
  if (msgType === 'template') {
    const name = String(templateName || '').trim().slice(0, 512);
    if (!name) return null;
    return {
      messaging_product: 'whatsapp', recipient_type: 'individual', to: waId,
      type: 'template',
      template: { name, language: { code: String(templateLanguage || 'he').trim().slice(0, 10) || 'he' } }
    };
  }
  const text = String(body || '').trim();
  if (!text) return null;
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: waId,
    type: 'text', text: { preview_url: false, body: text.slice(0, 4096) }
  };
}

// ── the send ─────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.phone            any spelling normalizeToWaId accepts
 * @param {'text'|'template'} [opts.msgType]
 * @param {string} [opts.body]           free-form text
 * @param {string} [opts.templateName]
 * @param {string} [opts.templateLanguage]
 * @param {string} [opts.templateCategory] MARKETING|UTILITY|AUTHENTICATION
 * @param {function} [opts.transport]    test seam: (url, payload, token, timeoutMs) → {status, json}
 * @returns {Promise<object>} never throws; {ok:false, error} on every refusal
 */
async function sendMessage({
  phone, msgType = 'text', body = '', templateName = '',
  templateLanguage = 'he', templateCategory = 'UTILITY', transport
} = {}) {
  // the switch and the credentials — off by default, fail closed
  if (!wa.isEnabled(require('../config').loadConfig())) {
    return { ok: false, error: 'whatsapp_disabled' };
  }

  const type = msgType === 'template' ? 'template' : 'text';
  const tcat = String(templateCategory || 'UTILITY').toUpperCase();

  // THE GATE — every spec refusal, locally, before any network
  const decision = ledger.decideSend({ phone, msgType: type, templateCategory: tcat });
  if (!decision.ok) return decision;

  const payload = buildPayload(decision.phone, { msgType: type, body, templateName, templateLanguage });
  if (!payload) return { ok: false, error: 'invalid_message' };

  const url = wa.endpointFor('messages');
  if (!url) return { ok: false, error: 'whatsapp_disabled' }; // belt-and-braces: isEnabled implies configured

  const bodyText = type === 'template' ? '[template:' + payload.template.name + ']' : payload.text.body;
  const doPost = transport || postGraph;
  const res = (await doPost(url, payload, wa._load().accessToken, TIMEOUT_MS)) || { status: 0, error: 'no_response' };

  const wamid = res.json && res.json.messages && res.json.messages[0] && res.json.messages[0].id
    ? String(res.json.messages[0].id) : null;

  if (res.status !== 200 || !wamid) {
    // Nothing left the building. The audit row carries the WHY, but no
    // pricing and outside_csw=0 — a failure is not billable and must not
    // consume tier quota.
    const errMsg = res.error ||
      (res.json && res.json.error && res.json.error.message) || ('HTTP ' + res.status);
    const id = ledger.recordMessage({
      phone: decision.phone, direction: 'out', msgType: type,
      templateCategory: type === 'template' ? tcat : null,
      body: bodyText, status: 'failed', error: String(errMsg)
    });
    return { ok: false, error: 'graph_error', id, status: res.status };
  }

  const id = ledger.recordMessage({
    phone: decision.phone, direction: 'out', msgType: type,
    templateCategory: type === 'template' ? tcat : null,
    pricing: decision.pricing,
    outsideCsw: decision.outside_csw,
    body: bodyText, waMessageId: wamid, status: 'accepted'
  });
  return { ok: true, id, waMessageId: wamid, pricing: decision.pricing, outside_csw: decision.outside_csw };
}

module.exports = { sendMessage, buildPayload, postGraph, TIMEOUT_MS };
