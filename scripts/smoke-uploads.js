'use strict';

/**
 * v0.47 QA — media upload validation (security phase).
 * Runs on a throwaway TAPUZ_ROOT; exercises media.saveBase64 end to end.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

if (!process.env.TAPUZ_ROOT) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-uploads-'));
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, TAPUZ_ROOT: tmp }, stdio: 'inherit' });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  process.exit(r.status == null ? 1 : r.status);
}

require('../src/db');
const media = require('../src/media');
const { validateUpload, sniffType } = require('../src/upload-validate');

let fail = false;
function check(name, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name); if (!cond) fail = true; }

function dataUrl(mime, buf) { return `data:${mime};base64,` + buf.toString('base64'); }

// a minimal valid PNG header + padding
const pngBuf = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

// 1. a real PNG saves, forced .png extension
const ok = media.saveBase64({ filename: 'photo.png', data: dataUrl('image/png', pngBuf), folder: '' });
check('valid PNG saved', ok && /\.png$/.test(ok.url) && fs.existsSync(path.join(media.ASSETS_DIR, path.basename(ok.url))));

// 2. HTML disguised as PNG (mime lies) → rejected by magic bytes
let threw = null;
try { media.saveBase64({ filename: 'x.png', data: dataUrl('image/png', Buffer.from('<html><script>alert(1)</script>')) }); } catch (e) { threw = e; }
check('HTML-in-PNG rejected (magic-byte sniff)', threw && threw.code === 'E_UPLOAD_TYPE');

// 3. .html filename with text/html data → cannot create an .html file in assets
threw = null;
try { media.saveBase64({ filename: 'evil.html', data: dataUrl('text/html', Buffer.from('<script>alert(document.cookie)</script>')) }); } catch (e) { threw = e; }
check('text/html upload rejected (no arbitrary-HTML hosting)', threw && threw.code === 'E_UPLOAD_TYPE');

// 4. SVG with script → saved but sanitized on disk
const evilSvg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="10" height="10"/></svg>';
const svgRes = media.saveBase64({ filename: 'logo.svg', data: dataUrl('image/svg+xml', Buffer.from(evilSvg)) });
const onDisk = fs.readFileSync(path.join(media.ASSETS_DIR, path.basename(svgRes.url)), 'utf8');
check('SVG saved as .svg', /\.svg$/.test(svgRes.url));
check('stored SVG has no <script>', !/<script/i.test(onDisk));
check('stored SVG has no onload', !/onload/i.test(onDisk));
check('stored SVG kept legit <rect>', /<rect/.test(onDisk));

// 4b. SVG sanitizer bypasses (from the v0.47 adversarial review) — the stored
//     bytes must not carry live script. (The serve layer is the real guarantee,
//     asserted in smoke-agent-bridge; this checks the best-effort scrubber.)
const nested = media.saveBase64({ filename: 'n.svg', data: dataUrl('image/svg+xml',
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><scr<script></script>ipt>alert(1)</script></svg>')) });
check('nested <script> bypass neutralized', !/<script[\s>]/i.test(fs.readFileSync(path.join(media.ASSETS_DIR, path.basename(nested.url)), 'utf8')));
const slashOn = media.saveBase64({ filename: 's.svg', data: dataUrl('image/svg+xml',
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/onload=alert(1)><rect/></svg>')) });
check('/onload (slash-separated) neutralized', !/onload/i.test(fs.readFileSync(path.join(media.ASSETS_DIR, path.basename(slashOn.url)), 'utf8')));
const smil = media.saveBase64({ filename: 'm.svg', data: dataUrl('image/svg+xml',
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><set attributeName="onbegin" to="alert(1)"/></svg>')) });
check('SMIL <set> removed', !/<set/i.test(fs.readFileSync(path.join(media.ASSETS_DIR, path.basename(smil.url)), 'utf8')));

// 5. oversized rejected
threw = null;
const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(6 * 1024 * 1024)]);
try { media.saveBase64({ filename: 'big.png', data: dataUrl('image/png', big) }); } catch (e) { threw = e; }
check('oversized upload rejected', threw && threw.code === 'E_UPLOAD_SIZE');

// 6. sniff unit checks
check('sniff jpeg', sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])) === 'jpeg');
check('sniff gif', sniffType(Buffer.from('GIF89a-----------')) === 'gif');
check('sniff rejects plain text', sniffType(Buffer.from('just some text, not an image at all')) === null);

console.log('');
console.log(fail ? 'SMOKE UPLOADS: FAIL' : 'SMOKE UPLOADS: PASS');
process.exit(fail ? 1 : 0);
