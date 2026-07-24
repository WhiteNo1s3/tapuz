'use strict';

/**
 * v1.79 QA — phase 3a: marketing pixels.
 *
 * This is the module where SOMEONE ELSE'S JavaScript runs on your visitors'
 * browsers, so the tests are mostly about restraint:
 *
 *   - the plan's acceptance bar: with pixels off, a rendered page is
 *     BYTE-IDENTICAL to what the CMS served before this feature existed,
 *   - consent is required by default, and until it is given the vendor code is
 *     not in the page at all,
 *   - Do-Not-Track outranks consent,
 *   - and no unvalidated id can escape into markup.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-pixels-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const pixels = require('../src/crm/pixels');

/** Build a config with pixels configured however the test needs. */
function cfg(over = {}, crmOn = true) {
  return {
    crm: {
      enabled: crmOn,
      pixels: Object.assign({
        enabled: true, requireConsent: true, banner: true,
        meta: { pixelId: '123456789012345' },
        googleAds: { conversionId: '', conversionLabel: '' },
        tiktok: { pixelId: '' },
        linkedin: { partnerId: '' }
      }, over)
    }
  };
}

// ── OFF means OFF ────────────────────────────────────────────────────
check('no config at all → nothing rendered', pixels.renderPixels({}) === '');
check('CRM off → nothing rendered, even with pixels configured',
  pixels.renderPixels(cfg({}, false)) === '');
check('pixels off → nothing rendered', pixels.renderPixels(cfg({ enabled: false })) === '');
check('pixels on but NO ids configured → nothing rendered',
  pixels.renderPixels(cfg({ meta: { pixelId: '' } })) === '');

// ── the plan's acceptance bar, measured on a real rendered page ──────
check('ACCEPTANCE: a rendered page with pixels off is byte-identical', (() => {
  const { renderPage } = require('../src/renderer');
  const page = {
    title: 'דף בדיקה', full_path: 'test', direction: 'rtl',
    blocks: [{ type: 'heading', data: { text: 'שלום' } }]
  };
  const before = renderPage(page);

  // turn pixels ON in the site config, then back off, and compare
  const config = require('../src/config');
  const base = config.loadConfig();
  config.saveConfig(Object.assign({}, base, {
    crm: { enabled: true, pixels: { enabled: true, requireConsent: true, banner: true, meta: { pixelId: '123456789012345' } } }
  }));
  const withPixels = renderPage(page);
  config.saveConfig(base);
  const after = renderPage(page);

  const changedWhenOn = withPixels !== before;
  const identicalWhenOff = after === before;
  if (!changedWhenOn) console.log('     (pixels did not change the page when ON — the test proves nothing)');
  if (!identicalWhenOff) console.log('     (page differs after toggling pixels off)');
  return changedWhenOn && identicalWhenOff;
})());

// ── consent ──────────────────────────────────────────────────────────
const gated = pixels.renderPixels(cfg());
check('with consent required, the vendor code is NOT live markup — it waits as data',
  gated.indexOf('<script>!function(f,b,e,v,n,t,s)') === -1 && gated.includes('fbq'));
check('the consent bar is rendered', gated.includes('id="tz-consent"') && gated.includes('אישור'));
check('a site with its own banner can suppress ours',
  !pixels.renderPixels(cfg({ banner: false })).includes('id="tz-consent"'));
check('consent can be waived deliberately (requireConsent false fires immediately)', (() => {
  const s = pixels.renderPixels(cfg({ requireConsent: false }));
  return s.includes('NEED=false') && !s.includes('id="tz-consent"');
})());
check('the loader exposes a public consent API for a custom banner',
  gated.includes('window.tapuzConsent') && gated.includes('grant:') && gated.includes('deny:'));
check('Do-Not-Track / GPC is checked before anything fires',
  gated.includes('doNotTrack') && gated.includes('globalPrivacyControl'));
check('consent is remembered between visits', gated.includes('localStorage'));

// ── id validation: nothing unvalidated reaches a script ──────────────
check('a Meta id survives as digits ONLY (every markup character is stripped)', (() => {
  const p = pixels.getPixels(cfg({ meta: { pixelId: '123</script><script>alert(1)</script>456' } }));
  // note: the digit inside alert(1) legitimately survives — what matters is
  // that nothing which could form markup does.
  return /^\d+$/.test(p.meta);
})());
check('an injected id keeps NO character that could form markup or break a string', (() => {
  const hostile = 'abc</script><img src=x onerror=alert(1)>';
  const p = pixels.getPixels(cfg({ meta: { pixelId: hostile }, tiktok: { pixelId: hostile } }));
  const dangerous = /[<>/="'`\\\s]/;
  return !dangerous.test(p.meta) && !dangerous.test(p.tiktok);
})());
check('a hostile id cannot add a script tag to the page', (() => {
  const clean = pixels.renderPixels(cfg({ meta: { pixelId: '999' } }));
  const hostile = pixels.renderPixels(cfg({
    meta: { pixelId: '999</script><script>alert(1)</script>' }
  }));
  const count = (s) => (s.match(/<script>/g) || []).length;
  return count(hostile) === count(clean);
})());
check('every vendor id is length-capped', (() => {
  const p = pixels.getPixels(cfg({
    meta: { pixelId: '1'.repeat(999) },
    linkedin: { partnerId: '9'.repeat(999) }
  }));
  return p.meta.length === 20 && p.linkedin.length === 20;
})());
check('a Google Ads id accepts AW- form and bare digits', (() => {
  const a = pixels.getPixels(cfg({ googleAds: { conversionId: 'AW-12345', conversionLabel: 'abc' } }));
  const b = pixels.getPixels(cfg({ googleAds: { conversionId: '12345', conversionLabel: '' } }));
  return a.googleAdsId === 'AW-12345' && b.googleAdsId === '12345';
})());

// ── all four vendors ─────────────────────────────────────────────────
check('all four vendors can run together', (() => {
  const snips = pixels.vendorSnippets(pixels.getPixels(cfg({
    meta: { pixelId: '111' },
    googleAds: { conversionId: 'AW-222', conversionLabel: 'lab' },
    tiktok: { pixelId: 'TT333' },
    linkedin: { partnerId: '444' }
  })));
  return snips.length === 4 &&
    snips[0].includes('fbq') && snips[1].includes('gtag') &&
    snips[2].includes('ttq') && snips[3].includes('lintrk');
})());

// ── the payload is data, not markup ──────────────────────────────────
check('the vendor payload is JSON-encoded (a string, never parsed as markup)',
  gated.includes('SNIPS=[') || gated.includes('SNIPS=["'));
check('any </script inside the payload is neutralized', (() => {
  const out = pixels.renderPixels(cfg({ meta: { pixelId: '1' } }));
  // our own wrapper closes exactly once at the end
  return (out.match(/<\/script>/g) || []).length === 1;
})());

// ── CSP: the policy is why a naive loader fails, so both halves are pinned ──
// (found live: the site's CSP withholds 'unsafe-eval', so an eval-based
//  loader is silently blocked — and the vendor hosts were not allow-listed
//  either. DevTools is exempt from CSP, which nearly hid both.)
check('the loader injects a <script> ELEMENT and never eval()s', (() => {
  const s = pixels.renderPixels(cfg());
  return s.includes("createElement('script')") && !s.includes('(0,eval)') && !s.includes('eval(');
})());
check('a failing vendor is reported, not silently swallowed',
  pixels.renderPixels(cfg()).includes('console.warn'));
check('CSP sources are empty when pixels are off', (() => {
  const off = pixels.cspSources(cfg({ enabled: false }));
  return !off.script.length && !off.img.length && !off.connect.length && !off.frame.length;
})());
check('CSP is widened by ONLY the configured vendor', (() => {
  const meta = pixels.cspSources(cfg());
  return meta.script.includes('https://connect.facebook.net') &&
    !meta.script.some((s) => /tiktok|licdn|googleadservices/.test(s));
})());
check('each vendor brings its own origins', (() => {
  const all = pixels.cspSources(cfg({
    meta: { pixelId: '1' }, googleAds: { conversionId: 'AW-2', conversionLabel: '' },
    tiktok: { pixelId: 'T3' }, linkedin: { partnerId: '4' }
  }));
  return all.script.includes('https://analytics.tiktok.com') &&
    all.script.includes('https://snap.licdn.com') &&
    all.img.includes('https://px.ads.linkedin.com');
})());
check('pixels NEVER ask for unsafe-eval', (() => {
  const all = pixels.cspSources(cfg({
    meta: { pixelId: '1' }, googleAds: { conversionId: 'AW-2', conversionLabel: '' },
    tiktok: { pixelId: 'T3' }, linkedin: { partnerId: '4' }
  }));
  return !JSON.stringify(all).includes('unsafe-eval');
})());

console.log('');
console.log(fail ? 'SMOKE CRM-PIXELS: FAIL' : 'SMOKE CRM-PIXELS: PASS');
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
process.exit(fail ? 1 : 0);
