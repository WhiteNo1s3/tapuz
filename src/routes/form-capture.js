'use strict';

/**
 * Public form capture — the twenty-second route-group extraction, second
 * public (non-admin) cut. The FORM module's default action
 * (POST /api/form → forms inbox, v0.81) and its RTL thank-you page
 * (GET /form-sent). PUBLIC + rate-limited + honeypot-guarded; the
 * per-IP formLimiter (used nowhere else) moved here with the routes.
 * ORDER matters: mounted AFTER the global urlencoded body-parser (so the
 * POST body is parsed) and BEFORE the static mounts — server.js keeps the
 * mount at exactly that position.
 */

const express = require('express');
const { FixedWindowLimiter } = require('../ratelimit');
const { clientIp } = require('../http-util');
const { loadConfig } = require('../config');
const { escapeAdmin } = require('../admin-ui');

const router = express.Router();

// per-IP form flood cap (configurable via TAPUZ_FORM_MAX, default 10/min).
const formLimiter = new FixedWindowLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.TAPUZ_FORM_MAX, 10) || 10
});

// ─── Forms inbox capture (v0.81) — PUBLIC, like /_tapuz/collect ───
// The FORM module's default action. Rate-limited, honeypot-guarded,
// size-capped in src/forms.js. Page attribution: explicit _page field if the
// author set one, else the Referer path (static pages can't inject context).
router.post('/api/form', (req, res) => {
  const wantsJsonReply = (req.headers.accept || '').includes('application/json');
  if (!formLimiter.allow('form:' + clientIp(req))) {
    res.setHeader('Retry-After', String(formLimiter.retryAfter('form:' + clientIp(req))));
    if (wantsJsonReply) return res.status(429).json({ ok: false, error: 'rate limited' });
    return res.status(429).send('יותר מדי שליחות. נסו שוב בעוד רגע.');
  }
  const body = req.body || {};
  // honeypot tripped → pretend success, store nothing (bots learn nothing)
  if (String(body._hp || '').trim()) {
    if (wantsJsonReply) return res.json({ ok: true });
    return res.redirect('/form-sent');
  }
  let page = String(body._page || '').slice(0, 300);
  if (!page) {
    try {
      // browsers percent-encode the Referer; a raw-bytes Hebrew path (curl,
      // odd clients) arrives latin1-mangled — recover it before parsing
      let refStr = String(req.headers.referer || '');
      if (/[^\x00-\x7f]/.test(refStr)) refStr = Buffer.from(refStr, 'latin1').toString('utf8');
      const ref = new URL(refStr, 'http://x');
      page = decodeURIComponent(ref.pathname).replace(/^\/+/, '').replace(/\.html$/, '').slice(0, 300);
    } catch (e) { /* no referer — the submission still lands, unattributed */ }
  }
  const result = require('../forms').saveSubmission({ page, fields: body });
  if (!result.ok) {
    if (wantsJsonReply) return res.status(400).json(result);
    return res.status(400).send('השליחה נדחתה: ' + result.error);
  }
  // Fire-and-forget: a misconfigured/unreachable SMTP server must never
  // delay or break form capture — the submission is already saved above.
  try {
    require('../notify').sendLeadNotification({ id: result.id, page, fields: body }).catch(() => {});
  } catch (e) { /* notify module itself must never break the form endpoint */ }
  if (wantsJsonReply) return res.json({ ok: true, id: result.id });
  return res.redirect('/form-sent');
});

// The thanks page — minimal, RTL, works for every static page on the site.
router.get('/form-sent', (req, res) => {
  const site = loadConfig().title || 'האתר';
  res.send(`<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>ההודעה נשלחה • ${escapeAdmin(site)}</title>
<style>
  body { font-family: system-ui, sans-serif; background:#f8fafc; color:#0f172a;
         display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0 }
  .card { background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:40px 48px;
          text-align:center; box-shadow:0 10px 30px rgba(2,6,23,.06) }
  .ok { font-size:2.4rem } h1 { font-size:1.3rem; margin:12px 0 6px } p { color:#64748b; margin:0 0 18px }
  a { display:inline-block; background:#ea580c; color:#fff; text-decoration:none;
      padding:10px 22px; border-radius:10px; font-weight:600 }
</style></head><body>
<div class="card"><div class="ok">✓</div><h1>ההודעה נשלחה</h1>
<p>תודה! נחזור אליכם בהקדם.</p>
<a href="/">חזרה לאתר</a></div>
</body></html>`);
});

module.exports = router;
