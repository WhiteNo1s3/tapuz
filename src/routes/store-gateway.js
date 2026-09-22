'use strict';

/**
 * The card gateway's PUBLIC doors (src/store/gateway) — what a shopper's
 * browser and the provider's server call:
 *
 *   POST /api/store/pay/:token                  open (or reuse) the hosted
 *                                               page for an order → { url }
 *   POST|GET /api/store/gateway/:provider/hook  the provider's callback
 *
 * MOUNT ORDER IS LOAD-BEARING. server.js mounts this router right after
 * the WhatsApp webhook and BEFORE every body parser: the hook reads the
 * raw bytes with its own small express.raw (any content type, 64 KB) and
 * parses them itself — JSON, urlencoded or multipart, whatever the
 * provider really sends — so the site's 256 KB extended urlencoded parser
 * never gets to read a webhook, and no provider can push a megabyte at an
 * unauthenticated door. The pay door is JSON only (a cross-site form
 * cannot post application/json without a preflight) with its own 32 KB
 * parser, exactly like the checkout in store-public.js.
 *
 * The hook believes a callback only as far as its trust anchor goes. It
 * hands the driver the request; the driver returns the provider's SESSION
 * id (never our reference — that is only a correlation check), the
 * gateway finds our row by it, and then: Cardcom's callback is a hint —
 * the verdict is our own GetLpResult with the stored keys; Grow's is
 * token-anchored — settled when the sha256 of the processToken it carries
 * equals the hash we stored at creation (constant time), plus processId,
 * statusCode and cField1. A forged body claiming "paid" therefore does
 * nothing; a real one settles or makes us ask. Refusals are uninformative —
 * a caller with no matching row gets the same reply as one with — and
 * nothing here can return a stack, an id or a key.
 */

const express = require('express');
const { FixedWindowLimiter } = require('../ratelimit');
const { clientIp } = require('../http-util');

const router = express.Router();
const smallJson = express.json({ limit: '32kb' });
const rawBody = express.raw({ type: '*/*', limit: '64kb' });

const limit = (env, max) => new FixedWindowLimiter({ windowMs: 60 * 1000, max: parseInt(process.env[env], 10) || max });
const payLimiter = limit('TAPUZ_STORE_PAY_MAX', 12);
const hookLimiter = limit('TAPUZ_STORE_HOOK_MAX', 120);

function store() { return require('../store'); }
function gateway() { return require('../store/gateway'); }

function jsonOnly(req, res, next) {
  if (req.is('application/json')) return next();
  return res.status(415).json({ ok: false, code: 'JSON_ONLY', message: 'בקשה לא נתמכת' });
}

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

// ── the pay door ──────────────────────────────────────────────────────

router.post('/api/store/pay/:token', jsonOnly, smallJson, async (req, res) => {
  noStore(res);
  const key = 'pay:' + clientIp(req);
  if (!payLimiter.allow(key)) {
    res.setHeader('Retry-After', String(payLimiter.retryAfter(key)));
    return res.status(429).json({ ok: false, code: 'RATE_LIMITED', message: 'יותר מדי בקשות — נסו שוב בעוד רגע' });
  }
  try {
    const order = store().orders.getOrderByToken(req.params.token);
    if (!order) return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'ההזמנה לא נמצאה' });
    const r = await gateway().startSession({ order, req });
    if (!r.ok) {
      // the admin-facing reason goes to the server log (redacted upstream); the shopper gets the sentence
      if (r.admin) console.error('[store] pay refused for #' + order.number + ' (' + r.code + '): ' + r.admin);
      const status = r.code === 'TOO_MANY' ? 429
        : (r.code === 'NOT_READY' || r.code === 'NO_BASE' || r.code === 'PROVIDER') ? 503
          : 409;
      return res.status(status).json({ ok: false, code: r.code, message: r.message });
    }
    return res.json({ ok: true, url: r.url });
  } catch (e) {
    console.error('[store] pay failed:', e.message);
    return res.status(500).json({ ok: false, code: 'ERROR', message: 'משהו השתבש — נסו שוב בעוד רגע' });
  }
});

// ── the provider's callback ───────────────────────────────────────────

function scalar(v) {
  if (Array.isArray(v)) return scalar(v[0]);
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? '' : String(v).slice(0, 2000);
}

/** `data[customFields][cField1]` → { data: { customFields: { cField1 } } } — the bracket keys Grow sends, unflattened by us. */
function unflatten(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) {
    const m = /^([^[\]]+)((?:\[[^[\]]*\])*)$/.exec(key);
    if (!m) continue;
    const path = [m[1]].concat([...m[2].matchAll(/\[([^[\]]*)\]/g)].map((x) => x[1]));
    if (path.some((p) => p === '__proto__' || p === 'constructor' || p === 'prototype')) continue;
    let cur = out;
    for (let i = 0; i < path.length - 1; i++) {
      const p = path[i];
      if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
      cur = cur[p];
    }
    cur[path[path.length - 1]] = value;
  }
  return out;
}

/**
 * The webhook's body, read by US from the raw bytes: urlencoded via
 * URLSearchParams, multipart via the platform's own Response.formData()
 * (no dependency added), JSON via JSON.parse of the text whatever the
 * Content-Type says (Cardcom). The result: a flat map of string fields,
 * the same keys unflattened (`nested`), the JSON when it was JSON, and the
 * query string on top — a driver's parseHook / hookVerdict look there and
 * nowhere else.
 */
async function parseHookBody(req) {
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const ct = String(req.headers['content-type'] || '');
  const type = ct.toLowerCase();
  const text = buf.toString('utf8');
  const out = { type, text, json: null, fields: {}, nested: {} };
  const takeJson = () => {
    try { out.json = text ? JSON.parse(text) : null; } catch (e) { out.json = null; }
    if (out.json && typeof out.json === 'object' && !Array.isArray(out.json)) {
      for (const [k, v] of Object.entries(out.json)) out.fields[k] = scalar(v);
    } else {
      out.json = null;
    }
  };
  const takeForm = () => { for (const [k, v] of new URLSearchParams(text)) out.fields[k] = v.slice(0, 2000); };
  if (type.includes('multipart/form-data')) {
    try {
      const fd = await new Response(buf, { headers: { 'content-type': ct } }).formData();
      let n = 0;
      for (const [k, v] of fd) {
        if (n++ >= 200) break;
        if (typeof v === 'string') out.fields[k] = v.slice(0, 2000); // a file is never an identifier
      }
    } catch (e) { /* not multipart after all — the text checks below still run */ }
  } else if (type.includes('application/x-www-form-urlencoded')) {
    takeForm();
  } else if (type.includes('application/json')) {
    takeJson();
  }
  if (!Object.keys(out.fields).length && !out.json) {
    if (/^\s*[{[]/.test(text)) takeJson();
    else if (/^[^=&\s]+=/.test(text)) takeForm();
  }
  for (const [k, v] of Object.entries(req.query || {})) if (!(k in out.fields)) out.fields[k] = scalar(v);
  out.nested = unflatten(out.fields);
  if (out.json) out.nested = { ...out.json, ...out.nested };
  return out;
}

async function hook(req, res) {
  noStore(res);
  const key = 'hook:' + clientIp(req);
  if (!hookLimiter.allow(key)) {
    res.setHeader('Retry-After', String(hookLimiter.retryAfter(key)));
    return res.status(429).type('text/plain').send('too many requests');
  }
  const provider = String(req.params.provider || '').toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,19}$/.test(provider)) return res.status(404).type('text/plain').send('not found');
  try {
    req.hookBody = await parseHookBody(req);
    const r = await gateway().handleHook(provider, req);
    return res.status(r.status).type(r.type).send(r.body);
  } catch (e) {
    // never a stack, never a reason
    return res.status(500).type('text/plain').send('error');
  }
}

router.post('/api/store/gateway/:provider/hook', rawBody, hook);
router.get('/api/store/gateway/:provider/hook', hook);

module.exports = router;
module.exports.parseHookBody = parseHookBody;
module.exports.unflatten = unflatten;
