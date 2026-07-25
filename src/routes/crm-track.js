'use strict';

/**
 * CRM — public email tracking (v1.81, phase 3c).
 *
 * Three PUBLIC, unauthenticated endpoints that a recipient's mail client hits:
 * the open pixel, a tracked link, and one-click unsubscribe. Being public and
 * unauthenticated, each is deliberately dull:
 *
 *   - GET /crm/o/:token.gif  — always returns the same 1×1 gif, whether or not
 *     the token exists. An attacker cannot use response differences to test
 *     which tokens are real.
 *   - GET /crm/c/:token/:i   — redirects to campaign.links[i]. The destination
 *     comes from the campaign, never from the request, so this can never be
 *     borrowed as an open redirect.
 *   - GET|POST /crm/u/:token — clears marketing consent. POST exists because
 *     RFC 8058 one-click unsubscribe sends one.
 *
 * All three are inert when the CRM is off, and rate-limited per IP so a hostile
 * client cannot use them to hammer the database.
 */

const express = require('express');
const { FixedWindowLimiter } = require('../ratelimit');
const { clientIp } = require('../http-util');

const router = express.Router();

// generous — a mail client legitimately fetches several assets per message
const limiter = new FixedWindowLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.TAPUZ_TRACK_MAX, 10) || 120
});

// A transparent 1×1 GIF. Served for every request, valid token or not.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function sendPixel(res) {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', String(PIXEL.length));
  // never let a proxy or client cache the beacon away
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.status(200).end(PIXEL);
}

function crmOn() {
  try { return require('../crm').isEnabled(); } catch (e) { return false; }
}

// ─── open pixel ──────────────────────────────────────────────────────
router.get('/crm/o/:token.gif', (req, res) => {
  // The response is identical in every branch below — that is the point.
  try {
    if (crmOn() && limiter.allow('trk:' + clientIp(req))) {
      require('../crm').campaigns.recordOpen(req.params.token);
    }
  } catch (e) { /* a tracking failure must never show up as a broken image */ }
  sendPixel(res);
});

// ─── tracked link ────────────────────────────────────────────────────
router.get('/crm/c/:token/:index', (req, res) => {
  let url = null;
  try {
    if (crmOn() && limiter.allow('trk:' + clientIp(req))) {
      url = require('../crm').campaigns.resolveClick(req.params.token, req.params.index);
    }
  } catch (e) { url = null; }
  // Unknown token or index → home, never an error page that confirms the guess.
  if (!url) return res.redirect('/');
  return res.redirect(url);
});

// ─── one-click unsubscribe ───────────────────────────────────────────
function unsubscribeHandler(req, res) {
  let ok = false;
  try {
    if (crmOn()) ok = require('../crm').campaigns.unsubscribe(req.params.token).ok;
  } catch (e) { ok = false; }

  // RFC 8058: a One-Click POST wants a bare 200, not a page.
  if (req.method === 'POST') return res.status(200).end();

  const site = (() => {
    try { return require('../config').loadConfig().title || 'האתר'; } catch (e) { return 'האתר'; }
  })();
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  res.status(200).send(`<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>הסרה מרשימת הדיוור • ${esc(site)}</title>
<style>
  body { font-family: system-ui, sans-serif; background:#f8fafc; color:#0f172a;
         display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0 }
  .card { background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:40px 48px;
          text-align:center; box-shadow:0 10px 30px rgba(2,6,23,.06); max-width:420px }
  .ok { font-size:2.4rem } h1 { font-size:1.25rem; margin:12px 0 6px }
  p { color:#64748b; margin:0 0 18px; line-height:1.6 }
  a { display:inline-block; background:#ea580c; color:#fff; text-decoration:none;
      padding:10px 22px; border-radius:10px; font-weight:600 }
</style></head><body>
<div class="card"><div class="ok">${ok ? '✓' : 'ℹ'}</div>
<h1>${ok ? 'הוסרתם מרשימת הדיוור' : 'הקישור אינו בתוקף'}</h1>
<p>${ok
  ? 'לא נשלח אליכם עוד דיוור. הפרטים שלכם נשארים אצלנו רק לצורך הפנייה שכבר שלחתם.'
  : 'ייתכן שהקישור פג או שכבר השתמשתם בו. אם אתם ממשיכים לקבל מיילים, השיבו להודעה ונטפל בזה.'}</p>
<a href="/">חזרה לאתר</a></div>
</body></html>`);
}

router.get('/crm/u/:token', unsubscribeHandler);
router.post('/crm/u/:token', unsubscribeHandler);

module.exports = router;
