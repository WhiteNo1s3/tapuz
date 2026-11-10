'use strict';

/**
 * PayPal's public doors (v2.68). JSON only, same reason as checkout: a
 * cross-site HTML form is a "simple" request and must not be able to open
 * or capture a payment. The order token is the capability. Prices are not
 * accepted — src/store/paypal.js rebuilds the PayPal order from the database.
 *
 *   POST /api/store/paypal/create    { token }
 *   POST /api/store/paypal/capture   { token, orderId }
 *   POST /api/store/paypal/cancel    { token }
 */

const express = require('express');
const { FixedWindowLimiter } = require('../ratelimit');
const { clientIp } = require('../http-util');

const router = express.Router();
const smallJson = express.json({ limit: '32kb' });
const limiter = new FixedWindowLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.TAPUZ_STORE_PAYPAL_MAX, 10) || 30
});

function paypal() { return require('../store/paypal'); }

function gate(req, res, next) {
  const key = 'paypal:' + clientIp(req);
  if (limiter.allow(key)) return next();
  res.setHeader('Retry-After', String(limiter.retryAfter(key)));
  return res.status(429).json({ ok: false, code: 'RATE_LIMITED', message: 'יותר מדי בקשות — נסו שוב בעוד רגע' });
}

function jsonOnly(req, res, next) {
  if (req.is('application/json')) return next();
  return res.status(415).json({ ok: false, code: 'JSON_ONLY', message: 'בקשה לא נתמכת' });
}

function send(res, result) {
  const body = {
    ok: !!result.ok,
    code: result.code || '',
    message: result.message || '',
    status: result.status || '',
    orderId: result.orderId || '',
    sandbox: !!result.sandbox,
    test: !!result.test,
    already: !!result.already,
    cancelled: !!result.cancelled
  };
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(result.http || (result.ok ? 200 : 400)).json(body);
}

router.post('/api/store/paypal/create', gate, jsonOnly, smallJson, async (req, res) => {
  try {
    send(res, await paypal().createForOrder(req.body && req.body.token));
  } catch (e) {
    console.error('[store] paypal create crashed');
    res.status(500).json({ ok: false, code: 'ERROR', message: 'לא הצלחנו לפתוח תשלום. לא חויב כלום.' });
  }
});

router.post('/api/store/paypal/capture', gate, jsonOnly, smallJson, async (req, res) => {
  try {
    const body = req.body || {};
    send(res, await paypal().captureForOrder(body.token, body.orderId));
  } catch (e) {
    console.error('[store] paypal capture crashed');
    res.status(500).json({ ok: false, code: 'ERROR', message: 'לא הצלחנו לאשר את התשלום. רעננו את הדף לפני ניסיון נוסף.' });
  }
});

router.post('/api/store/paypal/cancel', gate, jsonOnly, smallJson, (req, res) => {
  try {
    send(res, paypal().cancelForOrder(req.body && req.body.token));
  } catch (e) {
    console.error('[store] paypal cancel crashed');
    res.status(500).json({ ok: false, code: 'ERROR', message: 'לא הצלחנו לרשום את הביטול. לא חויב כלום.' });
  }
});

module.exports = router;
