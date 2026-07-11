'use strict';

/**
 * Smoke: MAP block renderer output + site-wide WhatsApp click-to-chat float.
 * Runs against an isolated TAPUZ_ROOT so the repo's real config/db stay untouched.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Isolate BEFORE requiring any src module — paths.js reads TAPUZ_ROOT at require time.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-smoke-map-'));
process.env.TAPUZ_ROOT = root;
fs.mkdirSync(path.join(root, 'config'), { recursive: true });

function writeSiteConfig(whatsapp) {
  fs.writeFileSync(
    path.join(root, 'config', 'site.json'),
    JSON.stringify(
      {
        title: 'אתר בדיקה',
        description: 'בדיקת אינטגרציות',
        setupDone: true,
        integrations: { whatsapp }
      },
      null,
      2
    ),
    'utf8'
  );
}

const { renderPage, renderBlock } = require('../src/renderer');

let fail = 0;
function check(name, cond, detail) {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (detail && !cond ? ' — ' + detail : ''));
  if (!cond) fail++;
}

// ---------------------------------------------------------------------------
// 1. MAP block renderer — escaped iframe embed, no API key
// ---------------------------------------------------------------------------
const address = 'דיזנגוף 99, ת"א & <סניף ראשי>';
const mapHtml = renderBlock(
  { type: 'map', id: 'map_test', data: { address, zoom: 14, height: 'lg' } },
  'rtl'
);

check('map: figure with height class', mapHtml.includes('<figure class="map-embed map-lg"'));
check(
  'map: iframe src URI-encoded + HTML-escaped',
  mapHtml.includes('https://www.google.com/maps?q=' + encodeURIComponent(address)) &&
    mapHtml.includes('&amp;z=14&amp;output=embed&amp;hl=he')
);
check('map: lazy loading', mapHtml.includes('loading="lazy"'));
check('map: allowfullscreen', mapHtml.includes('allowfullscreen'));
check(
  'map: title escaped (quote + angle brackets)',
  mapHtml.includes('title="מפה: דיזנגוף 99, ת&quot;א &amp; &lt;סניף ראשי&gt;"')
);
check('map: no raw unescaped markup from address', !mapHtml.includes('<סניף'));

const mapDefaults = renderBlock({ type: 'map', id: 'map_d', data: { address: 'חיפה' } }, 'rtl');
check('map: defaults zoom 15 / height md', mapDefaults.includes('map-md') && mapDefaults.includes('&amp;z=15&amp;'));

const mapZoomClamp = renderBlock({ type: 'map', id: 'map_z', data: { address: 'חיפה', zoom: 99 } }, 'rtl');
check('map: zoom clamped to 20', mapZoomClamp.includes('&amp;z=20&amp;'));

// ---------------------------------------------------------------------------
// 2. WhatsApp float — enabled: link present on rendered page
// ---------------------------------------------------------------------------
const page = {
  title: 'דף בדיקה',
  blocks: [{ type: 'text', id: 't1', data: { content: 'שלום' } }]
};

writeSiteConfig({ enabled: true, phone: '+972-50-123-4567', message: 'שלום מהאתר', position: 'end' });
const htmlOn = renderPage(page);

check('whatsapp on: float link present', htmlOn.includes('class="whatsapp-float pos-end"'));
check(
  'whatsapp on: digits-only phone + encoded message',
  htmlOn.includes('https://wa.me/972501234567?text=' + encodeURIComponent('שלום מהאתר'))
);
check('whatsapp on: rel noopener + target blank', htmlOn.includes('rel="noopener"') && htmlOn.includes('target="_blank"'));
check('whatsapp on: aria-label', htmlOn.includes('aria-label="WhatsApp"'));
check('whatsapp on: no leftover placeholder', !htmlOn.includes('{{site_extras}}'));

// position start (logical — right on RTL) + no message → no ?text=
writeSiteConfig({ enabled: true, phone: '0501234567', message: '', position: 'start' });
const htmlStart = renderPage(page);
check('whatsapp on: pos-start class', htmlStart.includes('class="whatsapp-float pos-start"'));
check('whatsapp on: no empty text param', htmlStart.includes('https://wa.me/0501234567"') && !htmlStart.includes('?text='));

// ---------------------------------------------------------------------------
// 3. WhatsApp float — disabled / no phone: absent
// ---------------------------------------------------------------------------
// NOTE: match the anchor markup, not the bare string — the theme CSS inlined
// into <head> in serve mode legitimately contains ".whatsapp-float" rules.
const FLOAT_MARKUP = '<a class="whatsapp-float';

writeSiteConfig({ enabled: false, phone: '+972501234567', message: 'x', position: 'start' });
const htmlOff = renderPage(page);
check('whatsapp off: no float', !htmlOff.includes(FLOAT_MARKUP));
check('whatsapp off: no leftover placeholder', !htmlOff.includes('{{site_extras}}'));

writeSiteConfig({ enabled: true, phone: '  --  ', message: 'x', position: 'start' });
const htmlNoPhone = renderPage(page);
check('whatsapp enabled but no phone digits: no float', !htmlNoPhone.includes(FLOAT_MARKUP));

// no integrations key at all in site.json (legacy config) → no float, no crash
fs.writeFileSync(
  path.join(root, 'config', 'site.json'),
  JSON.stringify({ title: 'ישן', description: '', setupDone: true }, null, 2),
  'utf8'
);
const htmlLegacy = renderPage(page);
check('legacy config without integrations: renders, no float', htmlLegacy.includes('<p') && !htmlLegacy.includes(FLOAT_MARKUP));

// ---------------------------------------------------------------------------
// cleanup (best effort — sqlite WAL handles may keep the temp dir locked on Windows)
// ---------------------------------------------------------------------------
try {
  fs.rmSync(root, { recursive: true, force: true });
} catch (e) {}

console.log(fail ? `\n${fail} failure(s)` : '\nAll map/whatsapp smoke checks passed');
process.exit(fail ? 1 : 0);
