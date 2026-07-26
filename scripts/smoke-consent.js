'use strict';

/**
 * v2.10 QA — visitor consent, decoupled from the pixel vendors.
 *
 * THE BUG THIS SUITE EXISTS FOR: the consent bar shipped inside `pixels.js`
 * and only rendered when a BROWSER vendor was configured. A site running
 * server-side conversions (CAPI/GA4) and no browser pixel asked the visitor
 * nothing — then refused every conversion with `no-consent`. A gate with no
 * door. The headline check below is exactly that site.
 *
 * Also pinned: one writer (pixels.js must no longer write the decision),
 * DNT outranks a stored grant, the answer is withdrawable, hostile owner
 * text/policy links cannot break out of the markup, and the browser cookie
 * matches what the SERVER reads.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-consent-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const consent = require('../src/crm/consent');
const pixels = require('../src/crm/pixels');
const conversions = require('../src/crm/conversions');

const base = (crm) => ({ title: 'אתר', crm });

// ── when the bar appears at all ──────────────────────────────────────
check('CRM off → no consent runtime, byte-for-byte the old page',
  consent.renderConsent(base({ enabled: false })) === '');
check('CRM on but nothing gated → still nothing (auto mode asks for a reason)',
  consent.renderConsent(base({ enabled: true })) === '');

const pixelSite = base({
  enabled: true,
  pixels: { enabled: true, requireConsent: true, meta: { pixelId: '123456789012345' } }
});
check('a browser-pixel site gets the bar (the v1.79 behaviour, preserved)', (() => {
  const html = consent.renderConsent(pixelSite);
  return html.includes('id="tz-consent"') && html.includes('window.tapuzConsent');
})());

// ── THE GAP: server-side conversions, no browser vendor ──────────────
const capiOnlySite = base({
  enabled: true,
  conversions: {
    enabled: true,
    meta: { pixelId: '123456789012345', accessToken: 'EAAG-token' }
  }
});
check('server-side conversions need consent (they gate on the same answer)',
  conversions.needsConsent(capiOnlySite) === true);
check('THE GAP CLOSED: a CAPI-only site with no browser vendor now gets a bar',
  consent.renderConsent(capiOnlySite).includes('id="tz-consent"'));
check('…and that site renders NO pixel loader (nothing to load in the browser)',
  pixels.renderPixels(capiOnlySite) === '');

// ── owner switches ───────────────────────────────────────────────────
check('mode=always asks even when nothing is gated',
  consent.renderConsent(base({ enabled: true, consent: { mode: 'always' } })).includes('id="tz-consent"'));
check('mode=off ships nothing, even with pixels demanding consent',
  consent.renderConsent(base({
    enabled: true, consent: { mode: 'off' },
    pixels: { enabled: true, requireConsent: true, meta: { pixelId: '1' } }
  })) === '');
check('banner=false keeps the RUNTIME but drops our bar (own CMP)', (() => {
  const html = consent.renderConsent(base({
    enabled: true, consent: { mode: 'always', banner: false }
  }));
  return html !== '' && !html.includes('id="tz-consent"') && html.includes('window.tapuzConsent');
})());
check('the v1.79 key still works: crm.pixels.banner=false hides the bar', (() => {
  const html = consent.renderConsent(base({
    enabled: true,
    pixels: { enabled: true, requireConsent: true, banner: false, meta: { pixelId: '1' } }
  }));
  return html !== '' && !html.includes('id="tz-consent"');
})());

// ── ONE WRITER ───────────────────────────────────────────────────────
const pixelSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'crm', 'pixels.js'), 'utf8');
check('pixels.js no longer WRITES the decision (no localStorage/cookie write)',
  !/localStorage\.setItem/.test(pixelSrc) && !/document\.cookie\s*=/.test(pixelSrc));
check('pixels.js no longer owns a consent bar', !/id="tz-consent"/.test(pixelSrc));
check('the pixel loader defers to the runtime instead',
  /tapuzConsent\.onGrant\(fire\)/.test(pixels.renderPixels(pixelSite)));
check('a pixel that needs consent with NO runtime fails closed, and says so',
  /no consent runtime/.test(pixels.renderPixels(pixelSite)));
check('pixels with requireConsent=false still fire immediately (owner\'s call)',
  /if\(!NEED\)\{fire\(\);return\}/.test(pixels.renderPixels(base({
    enabled: true, pixels: { enabled: true, requireConsent: false, meta: { pixelId: '1' } }
  }))));

// ── the runtime's promises, read from the emitted source ─────────────
const runtime = consent.renderConsent(pixelSite);
check('DNT/GPC is checked before anything is granted',
  /doNotTrack/.test(runtime) && /globalPrivacyControl/.test(runtime));
check('the decision is WITHDRAWABLE (data-tz-consent="open" reopens)',
  /a==='open'/.test(runtime) && /reopen:function/.test(runtime));
check('refusing is one click, same row, same size as accepting',
  (runtime.match(/data-tz-consent="deny"/g) || []).length === 1 &&
  /padding:8px 16px/.test(runtime) && /padding:8px 18px/.test(runtime));
check('the cookie the browser writes is the one the SERVER reads', (() => {
  const writesTzConsent = /document\.cookie=KEY\+'='\+v/.test(runtime) &&
    runtime.includes(JSON.stringify(consent.CONSENT_KEY));
  const serverReads = conversions.consentFromRequest({
    headers: { cookie: consent.CONSENT_KEY + '=granted' }
  });
  return writesTzConsent && serverReads === 'granted';
})());
check('a11y: the bar is a labelled dialog with real buttons',
  /role="dialog"/.test(runtime) && /aria-label=/.test(runtime) &&
  (runtime.match(/<button type="button"/g) || []).length === 2);

// ── THE STATE MACHINE, actually executed ─────────────────────────────
// Grepping the emitted source proves it says the right words; running it
// proves it does the right thing. The withdraw-mid-session bug below was
// found live in a browser and could not have been caught by a string match.
function runRuntime(html, { dnt = false, stored = null } = {}) {
  const body = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const store = { tz_consent: stored };
  const listeners = {};
  const el = { style: { display: 'none' } };
  let cookie = stored ? 'tz_consent=' + stored : '';
  const doc = {
    readyState: 'complete',
    getElementById: () => el,
    addEventListener: (n, f) => { listeners[n] = f; },
    get cookie() { return cookie; },
    set cookie(v) { cookie = v.split(';')[0]; }
  };
  const win = {};
  const nav = dnt ? { globalPrivacyControl: true } : {};
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'navigator', 'localStorage', 'location', body)(
    win, doc, nav,
    { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } },
    { protocol: 'https:' }
  );
  return { api: win.tapuzConsent, el, store, cookieOf: () => cookie };
}

const barHtml = consent.renderConsent(pixelSite);

check('RUN: a fresh visitor sees the bar and nothing fires', (() => {
  const r = runRuntime(barHtml);
  let ran = false; r.api.onGrant(() => { ran = true; });
  return r.el.style.display === 'block' && ran === false && r.api.status() === 'unset';
})());
check('RUN: grant fires waiting consumers and writes both stores', (() => {
  const r = runRuntime(barHtml);
  let ran = false; r.api.onGrant(() => { ran = true; });
  r.api.grant();
  return ran && r.store.tz_consent === 'granted' && /tz_consent=granted/.test(r.cookieOf()) &&
    r.el.style.display === 'none';
})());
check('RUN: a returning granted visitor fires immediately, no bar', (() => {
  const r = runRuntime(barHtml, { stored: 'granted' });
  let ran = false; r.api.onGrant(() => { ran = true; });
  return ran && r.el.style.display !== 'block';
})());
check('RUN: a returning denied visitor never fires, and is not re-asked', (() => {
  const r = runRuntime(barHtml, { stored: 'denied' });
  let ran = false; r.api.onGrant(() => { ran = true; });
  return !ran && r.el.style.display !== 'block';
})());
check('RUN: WITHDRAWAL STOPS A LATE CONSUMER (found live — deny left consent in force)', (() => {
  const r = runRuntime(barHtml, { stored: 'granted' });
  let early = false; r.api.onGrant(() => { early = true; });   // fires, correctly
  r.api.deny();
  let late = false; r.api.onGrant(() => { late = true; });     // must NOT fire
  return early === true && late === false && r.store.tz_consent === 'denied';
})());
check('RUN: DNT never fires and never shows the bar, even with a stored grant', (() => {
  const r = runRuntime(barHtml, { dnt: true, stored: 'granted' });
  let ran = false; r.api.onGrant(() => { ran = true; });
  return !ran && r.el.style.display !== 'block' && r.api.status() === 'denied';
})());

// ── owner input cannot break out ─────────────────────────────────────
check('hostile banner text is escaped, not injected', (() => {
  const html = consent.renderConsent(base({
    enabled: true,
    consent: { mode: 'always', text: '<img src=x onerror=alert(1)>"' }
  }));
  return !/<img src=x/.test(html) && html.includes('&lt;img');
})());
check('a javascript: policy link is dropped, https and same-site pass',
  consent.safeUrl('javascript:alert(1)') === '' &&
  consent.safeUrl('//evil.example') === '' &&
  consent.safeUrl('http://plain.example') === '' &&
  consent.safeUrl('/מדיניות') === '/מדיניות' &&
  consent.safeUrl('https://ok.example/p') === 'https://ok.example/p');

// ── the page itself ──────────────────────────────────────────────────
check('renderPage puts consent BEFORE the pixel loader (registration order)', (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const iConsent = src.indexOf("require('./crm/consent').renderConsent(config)");
  const iPixels = src.indexOf("require('./crm/pixels').renderPixels(config)");
  return iConsent > 0 && iPixels > 0 && iConsent < iPixels;
})());

const { runSetup } = require('../src/setup');
runSetup({
  title: 'אתר בדיקה', description: 'consent smoke',
  colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
  menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
});
const cfgMod = require('../src/config');
const liveCfg = cfgMod.loadConfig();
liveCfg.crm = { enabled: true, conversions: { enabled: true, meta: { pixelId: '1', accessToken: 't' } } };
cfgMod.saveConfig(liveCfg);
const { renderPage } = require('../src/renderer');
const { getPageByFullPath } = require('../src/pages');
check('a real rendered page carries the bar for a CAPI-only site', (() => {
  const home = getPageByFullPath('/home') || require('../src/pages').listPages()[0];
  const html = renderPage(home, cfgMod.loadConfig());
  return html.includes('id="tz-consent"') && html.includes('window.tapuzConsent');
})());

console.log('');
console.log(fail ? 'SMOKE CONSENT: FAIL' : 'SMOKE CONSENT: PASS');
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
process.exit(fail ? 1 : 0);
