'use strict';

/**
 * v2.01 QA — the CMS wrappers (pixel P4), enforced statically.
 *
 * THE ONE RULE: a wrapper only INJECTS the universal loader. It never
 * reimplements collect logic — no HTTP calls of its own, no event handling,
 * no identity. These checks are the rule made executable, plus a drift
 * guard: a wrapper may only use data-* attributes the loader actually reads.
 */

const fs = require('fs');
const path = require('path');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const wp = read('integrations/wordpress/tapuziel-pixel/tapuziel-pixel.php');
const wpReadme = read('integrations/wordpress/tapuziel-pixel/readme.txt');
const builder = read('integrations/builder.io/README.md');
const loader = read('public/tz-pixel.js');

// ── inject-only: the WP plugin makes NO requests of its own ──────────
check('WP plugin performs no HTTP of its own (wp_remote_* / curl / streams)',
  !/wp_remote_/.test(wp) && !/curl_(init|exec)/.test(wp) &&
  !/file_get_contents\s*\(\s*['"]https?:/.test(wp) && !/fsockopen/.test(wp));
check('WP plugin ships no client JS beyond the loader tag (no fetch/XHR/sendBeacon)',
  !/fetch\s*\(/.test(wp) && !/XMLHttpRequest/.test(wp) && !/sendBeacon/.test(wp));
check('WP plugin never names the collect endpoint in CODE (only the loader knows it)',
  !/collect/.test(wp.replace(/\/\*[\s\S]*?\*\/|^\s*\*.*$|<p class="description">[\s\S]*?<\/p>/gm, '')));

// ── the injection itself ─────────────────────────────────────────────
check('WP plugin enqueues OUR loader path from the configured base',
  wp.includes("'/tz-pixel.js'") && /wp_enqueue_script/.test(wp));
check('WP plugin rebuilds a clean tag with base + site attributes, escaped',
  /data-tz-pixel-base="%s"/.test(wp) && /data-tz-pixel-site="%s"/.test(wp) &&
  /esc_url\(\$base\)/.test(wp) && /esc_attr\(\$site\)/.test(wp));
check('WP plugin injects NOTHING until base AND site id are set',
  /\$base === '' \|\| \$site === ''/.test(wp));

// ── the four-findings discipline carried into the wrapper ────────────
check('WP plugin enforces HTTPS-only base (loopback exception)',
  wp.includes('#^https://#i') && wp.includes('^http://(localhost|127'));
check('WP plugin sanitizes site id with the registry\'s own normalization',
  /\[\^a-z0-9\._-\]\+/.test(wp));
check('WP settings + readme both point at the SITE REGISTRY (unregistered = dropped)',
  /לקוחות → אתרים/.test(wp) && /לקוחות → אתרים/.test(wpReadme));
check('the readme states identify() is a CLAIM, never an auto-contact',
  /claim/i.test(wpReadme) && /never\s+creates or merges/.test(wpReadme));

// ── Builder wrapper ──────────────────────────────────────────────────
check('Builder README carries the paste snippet with site + SPA attributes',
  /data-tz-pixel-site/.test(builder) && /data-tz-pixel-spa="1"/.test(builder) &&
  /tz-pixel\.js/.test(builder));
check('Builder README points at the registry and states HTTPS-only',
  /לקוחות → אתרים/.test(builder) && /HTTPS/.test(builder));

// ── drift guard: wrappers may only speak attributes the loader reads ──
check('every data-tz-pixel-* attribute the wrappers use exists in the loader', (() => {
  const used = new Set([...(wp + builder).matchAll(/data-tz-pixel-[a-z-]+/g)].map((m) => m[0]));
  const known = new Set([...loader.matchAll(/data-tz-pixel-[a-z-]+/g)].map((m) => m[0]));
  const unknown = [...used].filter((a) => !known.has(a));
  if (unknown.length) console.log('     unknown attrs: ' + unknown.join(', '));
  return used.size > 0 && unknown.length === 0;
})());

// ── the endpoints the wrappers rely on actually exist ────────────────
check('the CMS serves /tz-pixel.js (the wrappers point at a real endpoint)',
  /['"]\/tz-pixel\.js['"]/.test(read('src/server.js')));
check('the loader itself ships (public/tz-pixel.js, with the transport lesson)',
  /keepalive/.test(loader) && /sendBeacon/.test(loader));

// ── the admin tells the owner the wrappers exist ─────────────────────
check('the sites screen points at the WordPress + Builder wrappers',
  /integrations\/wordpress/.test(read('src/routes/crm.js')) &&
  /builder\.io/i.test(read('src/routes/crm.js')));

console.log('');
console.log(fail ? 'SMOKE WRAPPERS: FAIL' : 'SMOKE WRAPPERS: PASS');
process.exit(fail ? 1 : 0);
