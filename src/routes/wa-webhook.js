'use strict';

/**
 * WhatsApp Cloud API webhook (v1.87, phase W2) — the only PUBLIC WhatsApp
 * surface, and the only route in the CMS that must see the RAW request bytes.
 *
 * MOUNT ORDER IS LOAD-BEARING. server.js mounts this router before every
 * body parser (urlencoded AND json), because `X-Hub-Signature-256` is an HMAC
 * over the exact bytes Meta sent — a body that was parsed upstream reaches
 * express.raw already consumed, verification runs against nothing, and every
 * request 401s. That failure is silent in production (Meta just retries and
 * eventually unsubscribes), so smoke-wa-webhook.js posts a body with
 * NON-CANONICAL spacing and asserts it is accepted — a re-serialized body
 * would fail that check, catching any future reordering.
 *
 * No spend here: W2 receives. Status callbacks refine ledger rows (PMP
 * pricing lands at delivery); inbound messages are ledgered, which opens the
 * customer-service window. Sending is W3.
 */

const express = require('express');
const { FixedWindowLimiter } = require('../ratelimit');
const { clientIp } = require('../http-util');

const router = express.Router();

// Meta legitimately bursts (batched entries, delivery+read pairs, retries),
// so the cap is generous. TAPUZ_WA_HOOK_MAX overrides for smoke determinism.
const limiter = new FixedWindowLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.TAPUZ_WA_HOOK_MAX, 10) || 300
});

/**
 * The channel FLAGS only (config.crm.enabled AND config.crm.whatsapp.enabled)
 * — not full credential readiness, because during setup the verify token
 * exists before the access token does, and the GET handshake must work then.
 * Each verb still fail-closes on the credential IT needs.
 */
function channelOn() {
  try {
    const crm = require('../config').loadConfig().crm || {};
    return !!(crm.enabled && crm.whatsapp && crm.whatsapp.enabled);
  } catch (e) { return false; }
}

// ─── GET: Meta's subscription handshake ──────────────────────────────
router.get('/crm/wa/webhook', (req, res) => {
  if (!channelOn()) return res.status(404).type('text/plain').send('not found');
  const webhook = require('../crm/wa-webhook');
  const s = require('../crm/whatsapp')._load();
  const r = webhook.handleVerifyQuery(req.query, String(s.verifyToken || ''));
  if (!r.ok) return res.status(403).type('text/plain').send('forbidden');
  // Meta expects the challenge echoed back as plain text.
  res.status(200).type('text/plain').send(r.challenge);
});

// ─── POST: signed events ─────────────────────────────────────────────
// express.raw is scoped to THIS route; every other route still gets parsed
// bodies as usual. `type: '*/*'` so a mislabeled Content-Type cannot dodge
// the raw capture and reach us pre-parsed.
router.post('/crm/wa/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
  if (!channelOn()) return res.status(404).type('text/plain').send('not found');

  const ip = clientIp(req);
  if (!limiter.allow('wa-hook:' + ip)) {
    res.setHeader('Retry-After', String(limiter.retryAfter('wa-hook:' + ip)));
    return res.status(429).json({ ok: false });
  }

  const webhook = require('../crm/wa-webhook');
  const s = require('../crm/whatsapp')._load();
  const r = webhook.handlePost({
    rawBody: req.body,
    signatureHeader: req.headers['x-hub-signature-256'],
    appSecret: String(s.appSecret || '')
  });
  // Refusals stay uninformative — this endpoint sits on the open internet,
  // and a caller who fails the HMAC has no business learning why.
  if (!r.ok) return res.status(r.status || 401).json({ ok: false });
  res.status(200).json({ ok: true });
});

module.exports = router;
