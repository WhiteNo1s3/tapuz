'use strict';

/**
 * Visitor consent (v2.10) — the ONE place that asks, records and answers.
 *
 * THE GAP THIS CLOSES
 *
 * The consent bar shipped in v1.79 as part of `pixels.js`, and it only
 * rendered when a BROWSER pixel vendor was configured. But `tz_consent` is
 * read in three places — the pixel loader, `conversions.js` (server-side
 * CAPI/GA4) and the CRM — so a site running server-side conversions and no
 * browser vendor asked the visitor NOTHING, then refused every conversion
 * with `no-consent`. The gate was real; the question was never posed.
 *
 * So consent moves here and stops being a pixel feature:
 *   - it renders whenever ANYTHING on the site gates on it (or always, if the
 *     owner says so), regardless of which vendors exist;
 *   - it is the single WRITER of the decision — `pixels.js` now consumes
 *     `window.tapuzConsent.onGrant()` instead of keeping its own copy of the
 *     read/write/boot logic. Two mechanisms for one decision is one too many;
 *   - the decision is WITHDRAWABLE, which a consent UI that cannot be reopened
 *     is not: any element with `data-tz-consent="open"` reopens the bar.
 *
 * Privacy order of precedence, unchanged: DNT/GPC is an explicit refusal and
 * outranks everything — over it we never show the bar and never grant.
 */

const CONSENT_KEY = 'tz_consent';
const MODES = ['auto', 'always', 'off'];

const DEFAULTS = {
  text: 'האתר משתמש בכלי מדידה כדי להבין מה עוזר לכם. אפשר לאשר או לדחות — האתר עובד אותו דבר.',
  grantLabel: 'אישור',
  denyLabel: 'דחייה',
  policyLabel: 'מדיניות הפרטיות'
};

/** A link we are willing to put in front of a visitor: same-site or https. */
function safeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s[0] === '/' && s[1] !== '/') return s.slice(0, 300);   // same-site path
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s.slice(0, 300);
  return ''; // javascript:, data:, protocol-relative, plain http → dropped
}

function getConsent(config) {
  const crm = (config && config.crm) || {};
  const c = crm.consent || {};
  const px = crm.pixels || {};
  const str = (v, d, max) => {
    const s = String(v == null ? '' : v).trim();
    return (s || d).slice(0, max);
  };
  return {
    mode: MODES.includes(c.mode) ? c.mode : 'auto',
    // `crm.pixels.banner` was the v1.79 switch ("hide our bar, I have my own").
    // Honour it as the fallback so existing installs keep their behaviour.
    banner: c.banner !== undefined ? !!c.banner : px.banner !== false,
    text: str(c.text, DEFAULTS.text, 400),
    grantLabel: str(c.grantLabel, DEFAULTS.grantLabel, 40),
    denyLabel: str(c.denyLabel, DEFAULTS.denyLabel, 40),
    policyLabel: str(c.policyLabel, DEFAULTS.policyLabel, 60),
    policyUrl: safeUrl(c.policyUrl)
  };
}

/**
 * Does anything on this site actually gate on consent right now?
 *
 * Asks each consumer for itself (lazily, so the require graph stays acyclic
 * — `pixels.js` requires this module back). A consumer that cannot answer is
 * treated as "does not need it" rather than crashing a page render.
 */
function consentRequired(config) {
  const crm = (config && config.crm) || {};
  if (!crm.enabled) return false;
  for (const mod of ['./pixels', './conversions']) {
    try {
      const m = require(mod);
      if (typeof m.needsConsent === 'function' && m.needsConsent(config)) return true;
    } catch (e) { /* a consumer that cannot answer does not get a banner */ }
  }
  return false;
}

/** Should this page carry the consent runtime at all? */
function consentActive(config) {
  const c = getConsent(config);
  if (c.mode === 'off') return false;
  if (c.mode === 'always') return !!(config && config.crm && config.crm.enabled);
  return consentRequired(config);
}

function bannerMarkup(c) {
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const policy = c.policyUrl
    ? ` <a href="${esc(c.policyUrl)}" style="color:#93c5fd">${esc(c.policyLabel)}</a>`
    : '';
  return (
    `<div id="tz-consent" role="dialog" aria-modal="false" aria-label="${esc(c.text).slice(0, 120)}" dir="rtl" ` +
    `style="position:fixed;inset-inline:0;bottom:0;z-index:2147483000;` +
    `display:none;background:#0f172a;color:#e2e8f0;padding:14px 18px;font:500 14px/1.5 system-ui,sans-serif;` +
    `box-shadow:0 -4px 24px rgba(0,0,0,.3)">` +
    `<div style="max-width:900px;margin:0 auto;display:flex;gap:14px;align-items:center;flex-wrap:wrap">` +
    `<span style="flex:1;min-width:220px">${esc(c.text)}${policy}</span>` +
    // Refusing must be exactly as easy as accepting: same size, same row, one
    // click each. Only the fill differs.
    `<button type="button" data-tz-consent="deny" style="border:1px solid #475569;background:transparent;` +
    `color:#e2e8f0;border-radius:8px;padding:8px 16px;cursor:pointer;font:inherit">${esc(c.denyLabel)}</button>` +
    `<button type="button" data-tz-consent="grant" style="border:none;background:#f97316;color:#fff;` +
    `border-radius:8px;padding:8px 18px;cursor:pointer;font:600 14px system-ui">${esc(c.grantLabel)}</button>` +
    `</div></div>`
  );
}

/**
 * The consent runtime + (optionally) our bar. Empty string when nothing on
 * this site gates on consent — so a plain site renders exactly what it did.
 *
 * Registered BEFORE `renderPixels` in the body-end extras, because the pixel
 * loader registers itself against `window.tapuzConsent`.
 *
 * @param {object} config site config
 * @returns {string} markup for the body-end extras
 */
function renderConsent(config) {
  if (!consentActive(config)) return '';
  const c = getConsent(config);
  const bar = c.banner ? bannerMarkup(c) : '';

  const script =
    `<script>(function(){` +
    `var KEY=${JSON.stringify(CONSENT_KEY)},queue=[],fired=false;` +
    // DNT / GPC: an explicit refusal that outranks any stored answer.
    `function dnt(){try{return navigator.doNotTrack=='1'||window.doNotTrack=='1'||` +
    `navigator.msDoNotTrack=='1'||navigator.globalPrivacyControl===true}catch(e){return false}}` +
    // localStorage is the browser's source of truth (survives cookie policies);
    // the cookie is how the SERVER learns the same answer for CAPI/GA4.
    `function read(){try{var v=localStorage.getItem(KEY);if(v)return v}catch(e){}` +
    `try{var m=document.cookie.match(/(?:^|;\\s*)tz_consent=([^;]*)/);return m?m[1]:null}catch(e){return null}}` +
    `function write(v){try{localStorage.setItem(KEY,v)}catch(e){}` +
    `try{document.cookie=KEY+'='+v+';Path=/;Max-Age=31536000;SameSite=Lax'+` +
    `(location.protocol==='https:'?';Secure':'')}catch(e){}}` +
    `function bar(){return document.getElementById('tz-consent')}` +
    `function hide(){var b=bar();if(b)b.style.display='none'}` +
    `function show(){var b=bar();if(b)b.style.display='block'}` +
    // Consumers (the pixel loader, an owner's own script) register here and are
    // called once, only on a real grant. Never over DNT. `fired` records that
    // consent is in force, so a LATE registrant runs immediately instead of
    // waiting for a grant that already happened.
    // `read()==='denied'` is re-checked HERE, not only at boot: a visitor can
    // withdraw mid-session, and a consumer that registers after that must not
    // inherit the earlier grant. (Found live: deny left `fired` true, so a
    // late-registering pixel still ran until the next page load.)
    `function run(){if(dnt()||read()==='denied')return;fired=true;` +
    `while(queue.length){var f=queue.shift();try{f()}catch(e){}}}` +
    `window.tapuzConsent={` +
    `status:function(){return dnt()?'denied':(read()||'unset')},` +
    `grant:function(){write('granted');hide();run()},` +
    // withdrawal takes effect NOW: forget that consent was ever in force.
    `deny:function(){write('denied');fired=false;hide()},` +
    `reopen:function(){show()},` +
    `onGrant:function(f){if(typeof f!=='function')return;queue.push(f);` +
    `if(fired||(!dnt()&&read()==='granted'))run()}};` +
    `function boot(){` +
    // Delegated so the bar can be re-rendered, and so an owner's own
    // "change my choice" link works from anywhere on the page.
    `document.addEventListener('click',function(e){` +
    `var t=e.target&&e.target.closest?e.target.closest('[data-tz-consent]'):null;if(!t)return;` +
    `var a=t.getAttribute('data-tz-consent');` +
    `if(a==='grant')window.tapuzConsent.grant();` +
    `else if(a==='deny')window.tapuzConsent.deny();` +
    `else if(a==='open'){e.preventDefault();window.tapuzConsent.reopen()}});` +
    `if(dnt())return;` +
    `var s=read();if(s==='granted'){run();return}if(s==='denied')return;show()}` +
    `if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();` +
    `})();</script>`;

  return bar + script;
}

module.exports = {
  CONSENT_KEY, MODES, DEFAULTS,
  getConsent, consentRequired, consentActive, renderConsent, safeUrl
};
