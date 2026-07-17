'use strict';

/**
 * v0.90 QA — responsive device preview: the REAL draft rendering at device
 * widths. renderPage's draft path is tested behaviorally; the route + modal
 * wiring are asserted on source (builder is a DOM IIFE).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-rsp-'));

const { renderPage } = require('../src/renderer');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

// ── the preview renders the DRAFT, not the published state ──
const page = {
  title: 'בדיקה', full_path: 'test', direction: 'rtl',
  blocks: [{ id: 'h1', type: 'heading', data: { level: 1, text: 'גרסה שפורסמה' } }],
  draft_blocks: [{ id: 'h1', type: 'heading', data: { level: 1, text: 'גרסת הטיוטה' } }],
  meta: {}
};
const draftHtml = renderPage(page, { useDraft: true });
const pubHtml = renderPage(page, {});
check('useDraft renders the draft blocks', draftHtml.includes('גרסת הטיוטה') && !draftHtml.includes('גרסה שפורסמה'));
check('default renders the published blocks', pubHtml.includes('גרסה שפורסמה') && !pubHtml.includes('גרסת הטיוטה'));
check('draft preview is a full real document (theme CSS riding along)',
  /<!DOCTYPE html>/i.test(draftHtml) && /<style|main\.css/.test(draftHtml));
check('no draft_blocks → draft falls back to published',
  renderPage({ ...page, draft_blocks: null }, { useDraft: true }).includes('גרסה שפורסמה'));

// ── route + builder wiring (source asserts) ──
const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
const builder = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-builder.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'admin.css'), 'utf8');

check('GET /admin/preview/:fullPath serves renderPage(useDraft)',
  /app\.get\('\/admin\/preview\/:fullPath'/.test(server) && /renderPage\(page, \{ useDraft: true \}\)/.test(server));
check('preview route overrides the global X-Frame-Options DENY with SAMEORIGIN (else the iframe is blank)',
  /admin\/preview[\s\S]{0,700}X-Frame-Options', 'SAMEORIGIN'/.test(server));
check('canvas header carries the 📱 רספונסיב button', /id="btn-responsive"/.test(server));
check('builder ships the four device widths',
  /width: 375/.test(builder) && /width: 768/.test(builder) && /width: 1024/.test(builder) && /width: 0/.test(builder));
check('preview saves the draft FIRST (no stale surprise)',
  /savePage\(\{ silent: true \}\)[\s\S]{0,120}iframe\.src = previewUrl/.test(builder));
check('iframe targets the admin preview route',
  /'\/admin\/preview\/' \+ encodeURIComponent\(currentPageFullPath\)/.test(builder));
check('device switch resizes the frame', /frame\.style\.width = d\.width \? d\.width \+ 'px' : '100%'/.test(builder));
check('modal styled by the dark-desk system', /\.rsp-overlay \{/.test(css) && /\.rsp-devices button\.active/.test(css));

try { new Function(builder); check('admin-builder.js parses', true); }
catch (e) { check('admin-builder.js parses (' + e.message + ')', false); }

try { fs.rmSync(process.env.TAPUZ_ROOT, { recursive: true, force: true }); } catch (e) {}
console.log('');
console.log(fail ? 'SMOKE RESPONSIVE: FAIL' : 'SMOKE RESPONSIVE: PASS');
process.exit(fail ? 1 : 0);
