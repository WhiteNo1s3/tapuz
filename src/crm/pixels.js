'use strict';

/**
 * CRM — marketing pixels (v1.79, phase 3).
 *
 * Third-party trackers in the site's <head>. This is the module where someone
 * else's JavaScript runs on your visitors' browsers, so three rules hold:
 *
 *   1. OFF unless asked. `crm.enabled` AND `crm.pixels.enabled` AND at least
 *      one configured id — otherwise this module returns the empty string and
 *      the rendered page is byte-for-byte what it was before pixels existed.
 *
 *   2. CONSENT FIRST, by default. With `requireConsent` on (the default) the
 *      vendor snippets are NOT in the markup at all — they are strings the
 *      loader injects only after the visitor agrees. A tracker that fires
 *      before consent is not a setting we ship enabled.
 *
 *   3. NOTHING UNVALIDATED REACHES A <script>. Every id is filtered to the
 *      charset its vendor actually uses and length-capped; the assembled
 *      payload is JSON-escaped into the page, and `</script` is neutralized so
 *      a hostile id can never close the tag it sits in.
 *
 * The owner-facing promise is in the admin copy: turning pixels off returns the
 * site to exactly what it served before.
 */

const CONSENT_KEY = 'tz_consent';

/** Read the pixel config with every vendor block guaranteed present. */
function getPixels(config) {
  const crm = (config && config.crm) || {};
  const p = crm.pixels || {};
  return {
    enabled: !!(crm.enabled && p.enabled),
    requireConsent: p.requireConsent !== false,
    banner: p.banner !== false,
    meta: String((p.meta && p.meta.pixelId) || '').replace(/\D/g, '').slice(0, 20),
    googleAdsId: String((p.googleAds && p.googleAds.conversionId) || '').replace(/[^\w-]/g, '').slice(0, 40),
    googleAdsLabel: String((p.googleAds && p.googleAds.conversionLabel) || '').replace(/[^\w-]/g, '').slice(0, 60),
    tiktok: String((p.tiktok && p.tiktok.pixelId) || '').replace(/[^\w]/g, '').slice(0, 40),
    linkedin: String((p.linkedin && p.linkedin.partnerId) || '').replace(/\D/g, '').slice(0, 20)
  };
}

/** True when at least one vendor is actually configured. */
function hasAnyPixel(p) {
  return !!(p.meta || p.googleAdsId || p.tiktok || p.linkedin);
}

/**
 * The vendor snippets, as an array of strings the loader will inject.
 * Ids here are already charset-filtered by getPixels.
 */
function vendorSnippets(p) {
  const out = [];

  if (p.meta) {
    out.push(
      `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?` +
      `n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;` +
      `n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;` +
      `t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}` +
      `(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');` +
      `fbq('init','${p.meta}');fbq('track','PageView');`
    );
  }

  if (p.googleAdsId) {
    // Accepts either "AW-123456" or a bare numeric id.
    const cid = /^AW-/.test(p.googleAdsId) ? p.googleAdsId : 'AW-' + p.googleAdsId;
    out.push(
      `var s=document.createElement('script');s.async=!0;` +
      `s.src='https://www.googletagmanager.com/gtag/js?id=${cid}';document.head.appendChild(s);` +
      `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}` +
      `gtag('js',new Date());gtag('config','${cid}');`
    );
  }

  if (p.tiktok) {
    out.push(
      `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];` +
      `ttq.methods=['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie'];` +
      `ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};` +
      `for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);` +
      `ttq.load=function(e){var i='https://analytics.tiktok.com/i18n/pixel/events.js';` +
      `ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e]=+new Date;` +
      `var o=d.createElement('script');o.type='text/javascript';o.async=!0;o.src=i+'?sdkid='+e;` +
      `var a=d.getElementsByTagName('script')[0];a.parentNode.insertBefore(o,a)};` +
      `ttq.load('${p.tiktok}');ttq.page()}(window,document,'ttq');`
    );
  }

  if (p.linkedin) {
    out.push(
      `window._linkedin_partner_id='${p.linkedin}';` +
      `window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];` +
      `window._linkedin_data_partner_ids.push('${p.linkedin}');` +
      `(function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}` +
      `var s=document.getElementsByTagName('script')[0];var b=document.createElement('script');` +
      `b.type='text/javascript';b.async=true;b.src='https://snap.licdn.com/li.lms-analytics/insight.min.js';` +
      `s.parentNode.insertBefore(b,s);})(window.lintrk);`
    );
  }

  return out;
}

/** The built-in consent bar. RTL, no external asset, survives static export. */
function bannerMarkup() {
  return (
    `<div id="tz-consent" dir="rtl" style="position:fixed;inset-inline:0;bottom:0;z-index:2147483000;` +
    `display:none;background:#0f172a;color:#e2e8f0;padding:14px 18px;font:500 14px/1.5 system-ui,sans-serif;` +
    `box-shadow:0 -4px 24px rgba(0,0,0,.3)">` +
    `<div style="max-width:900px;margin:0 auto;display:flex;gap:14px;align-items:center;flex-wrap:wrap">` +
    `<span style="flex:1;min-width:220px">האתר משתמש בכלי מדידה כדי להבין מה עוזר לכם. אפשר לאשר או לדחות — האתר עובד אותו דבר.</span>` +
    `<button type="button" data-tz-consent="deny" style="border:1px solid #475569;background:transparent;` +
    `color:#e2e8f0;border-radius:8px;padding:8px 16px;cursor:pointer;font:inherit">דחייה</button>` +
    `<button type="button" data-tz-consent="grant" style="border:none;background:#f97316;color:#fff;` +
    `border-radius:8px;padding:8px 18px;cursor:pointer;font:600 14px system-ui">אישור</button>` +
    `</div></div>`
  );
}

/**
 * The full <head> payload. Empty string when pixels are off or unconfigured —
 * which is what makes "off is byte-identical" true rather than aspirational.
 *
 * @param {object} config site config
 * @returns {string} markup to append to <head>
 */
function renderPixels(config) {
  const p = getPixels(config);
  if (!p.enabled) return '';
  const snippets = vendorSnippets(p);
  if (!snippets.length) return '';

  // The snippets travel as a JSON array literal, so no vendor string is ever
  // parsed as markup. `</script` is the one sequence that could still close
  // our wrapper tag from inside a string — neutralize it.
  const payload = JSON.stringify(snippets).replace(/<\/script/gi, '<\\/script');
  const needConsent = p.requireConsent ? 'true' : 'false';

  const loader =
    `<script>(function(){` +
    `var KEY=${JSON.stringify(CONSENT_KEY)},NEED=${needConsent},SNIPS=${payload},fired=false;` +
    // Do-Not-Track / GPC is an explicit refusal — never load a tracker over it.
    `function dnt(){try{return navigator.doNotTrack=='1'||window.doNotTrack=='1'||navigator.msDoNotTrack=='1'||navigator.globalPrivacyControl===true}catch(e){return false}}` +
    // The decision is mirrored into a cookie as well as localStorage, because
    // the SERVER has to honour the same answer: phase 3b sends conversions
    // server-side, and a visitor who refused here must be refused there too.
    // localStorage stays the source of truth for the browser (survives cookie
    // clearing policies); the cookie is how the server learns the answer.
    `function read(){try{var v=localStorage.getItem(KEY);if(v)return v}catch(e){}` +
    `try{var m=document.cookie.match(/(?:^|;\\s*)tz_consent=([^;]*)/);return m?m[1]:null}catch(e){return null}}` +
    `function write(v){try{localStorage.setItem(KEY,v)}catch(e){}` +
    `try{document.cookie=KEY+'='+v+';Path=/;Max-Age=31536000;SameSite=Lax'+(location.protocol==='https:'?';Secure':'')}catch(e){}}` +
    // Vendor code is injected as a real <script> element, NOT eval'd. Our CSP
    // allows 'unsafe-inline' (the analytics beacon needs it) but deliberately
    // withholds 'unsafe-eval' — so an eval-based loader is silently blocked on
    // exactly the sites that took security seriously. Element injection is
    // both the standard consent-manager technique and the one that works here.
    // A vendor that throws must not take the page down, but must not vanish
    // either: a silent catch is hours of "why is my pixel not firing".
    `function fire(){if(fired||dnt())return;fired=true;` +
    `for(var i=0;i<SNIPS.length;i++){try{` +
    `var el=document.createElement('script');el.text=SNIPS[i];` +
    `(document.head||document.documentElement).appendChild(el);` +
    `}catch(e){if(window.console&&console.warn)console.warn('[tapuziel] pixel '+i+' failed:',e&&e.message)}}}` +
    `function hide(){var b=document.getElementById('tz-consent');if(b)b.style.display='none'}` +
    `function show(){var b=document.getElementById('tz-consent');if(b)b.style.display='block'}` +
    `window.tapuzConsent={` +
    `status:function(){return read()||'unset'},` +
    `grant:function(){write('granted');hide();fire()},` +
    `deny:function(){write('denied');hide()}};` +
    `function boot(){` +
    `var b=document.getElementById('tz-consent');` +
    `if(b)b.addEventListener('click',function(e){var a=e.target&&e.target.getAttribute('data-tz-consent');` +
    `if(a==='grant')window.tapuzConsent.grant();else if(a==='deny')window.tapuzConsent.deny()});` +
    `if(dnt())return;` +
    `if(!NEED){fire();return}` +
    `var s=read();if(s==='granted'){fire();return}if(s==='denied')return;show()}` +
    `if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();` +
    `})();</script>`;

  const banner = p.requireConsent && p.banner ? bannerMarkup() : '';
  return banner + loader;
}

/**
 * The BROWSER half of a deduplicated conversion (v1.80).
 *
 * The server already reported this conversion via the Conversions API with
 * `eventId`; firing the same event here with the same id lets Meta collapse the
 * two into one. Consent still governs — this waits for `tapuzConsent` just like
 * the pageview pixel, so a refused visitor reports nothing from either side.
 *
 * @param {object} config site config
 * @param {string} eventId the id the server used — hex, from newEventId()
 * @returns {string} markup, or '' when pixels are off / the id is not ours
 */
function renderConversionPixel(config, eventId) {
  const p = getPixels(config);
  if (!p.enabled || !p.meta) return '';
  if (!/^[a-f0-9]{16,64}$/.test(String(eventId || ''))) return '';
  const id = JSON.stringify(String(eventId));
  return (
    `<script>(function(){function go(){try{` +
    `if(window.fbq)fbq('track','Lead',{},{eventID:${id}})` +
    `}catch(e){}}` +
    // the loader may not have run yet; poll briefly rather than race it
    `var n=0,t=setInterval(function(){if(window.fbq||n++>40){clearInterval(t);go()}},100);` +
    `})();</script>`
  );
}

/**
 * The CSP origins each CONFIGURED vendor needs — nothing more.
 *
 * The public site ships a strict Content-Security-Policy, and that policy is
 * why a naive pixel loader fails here: third-party script hosts are not on the
 * allow-list. Rather than loosening the policy for everyone, we widen it by
 * exactly the vendors this site actually turned on, and only while pixels are
 * enabled. A site with no pixels keeps the original policy byte-for-byte.
 *
 * @returns {{script:string[], img:string[], connect:string[], frame:string[]}}
 */
function cspSources(config) {
  const p = getPixels(config);
  const out = { script: [], img: [], connect: [], frame: [] };
  if (!p.enabled) return out;

  if (p.meta) {
    out.script.push('https://connect.facebook.net');
    out.img.push('https://www.facebook.com');
    out.connect.push('https://www.facebook.com');
  }
  if (p.googleAdsId) {
    // googletagmanager is already on the base policy for GA4; the ad-serving
    // and conversion origins are not.
    out.script.push('https://www.googletagmanager.com', 'https://www.googleadservices.com');
    out.img.push('https://www.google.com', 'https://googleads.g.doubleclick.net');
    out.frame.push('https://td.doubleclick.net');
  }
  if (p.tiktok) {
    out.script.push('https://analytics.tiktok.com');
    out.connect.push('https://analytics.tiktok.com');
  }
  if (p.linkedin) {
    out.script.push('https://snap.licdn.com');
    out.img.push('https://px.ads.linkedin.com');
  }
  return out;
}

module.exports = {
  CONSENT_KEY, getPixels, hasAnyPixel, vendorSnippets,
  renderPixels, renderConversionPixel, cspSources
};
