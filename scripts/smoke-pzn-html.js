'use strict';

/**
 * v0.49 QA — the bent-html escape hatch across every layer.
 *
 * Proves: (1) raw HTML round-trips block⇄.pzn losslessly (attribute-encoded),
 * (2) it validates as a real registered module, (3) the pzn compile path and
 * (4) the renderer.js published-site path both SANITIZE it (script/handler/
 * scheme vectors gone, legit markup kept). The sanitizer is the guarantee, so
 * the adversarial cases are the point of this file.
 */

const pzn = require('../src/pzn/index');
const { fromTapuzPage, toTapuzPage } = pzn;
const { renderBlock } = require('../src/renderer');
const { sanitizeHtmlFragment } = require('../src/html-sanitize');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

// ── round-trip: page → .pzn → parse → page ──────────────────────────
const rawHtml = '<div class="promo" style="padding:2rem">\n  <h2>מבצע</h2>\n  <p>עד 50% הנחה</p>\n</div>';
const page = {
  title: 'בדיקה', slug: 'test-html', direction: 'rtl', tags: [], meta: {},
  blocks: [
    { type: 'heading', id: 'h1', data: { level: 1, text: 'שלום' } },
    { type: 'html', id: 'raw1', data: { content: rawHtml, provisional: true, note: 'promo' } }
  ]
};
const doc = pzn.parse(pzn.serialize(fromTapuzPage(page)));
const back = toTapuzPage(doc).blocks.find((b) => b.type === 'html');
check('round-trip content identical', back && back.data.content === rawHtml);
check('round-trip provisional survived', back && back.data.provisional === true);
check('round-trip note survived', back && back.data.note === 'promo');

// ── validate: html is a first-class registered module ───────────────
const errs = pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error');
check('validate: zero errors (html is registered)', errs.length === 0);

// ── compile (pzn path) sanitizes ────────────────────────────────────
const compiled = pzn.compile(doc);
check('compile: bent-html div present', /class="bent-html/.test(compiled));
check('compile: kept legit <h2>', /<h2>מבצע<\/h2>/.test(compiled));

// ── renderer.js (published-site path) emits AUTHORED html RAW ───────
// v1.49 INVERTED these three assertions on purpose. They used to prove the
// render path stripped script; the product decision is now that an author —
// human or agent — gets a real escape hatch, so authored markup goes out
// verbatim, script included, exactly like WordPress's Custom HTML block.
// They are kept (not deleted) and flipped, so the file still PINS the
// behaviour rather than going quiet about it: if a future change silently
// re-introduces sanitizing here, these fail and someone has to make the
// product call again on purpose.
const dangerous = {
  type: 'html', id: 'x',
  data: { content: '<div>hi</div><script>alert(1)</script><a href="javascript:alert(1)">c</a><img src=x onerror=alert(1)>' }
};
const rendered = renderBlock(dangerous, 'rtl');
check('render: authored <script> passes through RAW (deliberate, v1.49)', /<script>alert\(1\)<\/script>/.test(rendered));
check('render: authored onerror survives', /onerror/i.test(rendered));
check('render: authored javascript: href survives', /javascript:alert\(1\)/i.test(rendered));
check('render: kept legit <div>hi', /<div>hi<\/div>/.test(rendered));
check('render: wrapper carries bent-html class', /class="bent-html/.test(rendered));

// ── but the OUTSIDE-facing path is still scrubbed ───────────────────
// The line v1.49 drew: trusted AUTHOR raw, untrusted SOURCE scrubbed. The
// importer faces real third-party markup (its own comment cites yahoo.com), so
// when graduation cannot decompose a page it parks a SANITIZED fragment. That
// is a different trust context from an author typing into the HTML tool, and it
// must not follow the raw decision above.
const { htmlToBlocks } = require('../src/pzn/graduate');
if (typeof htmlToBlocks === 'function') {
  const imported = htmlToBlocks('<div><script>alert("from the web")</script><p>hi</p></div>');
  const parked = (imported.blocks || []).filter((b) => b.type === 'html');
  const anyScript = parked.some((b) => /<script/i.test((b.data && b.data.content) || ''));
  check('import: third-party <script> is NOT parked raw (scrubbed on ingestion)', !anyScript);
} else {
  check('import: graduate exposes htmlToBlocks to test the ingestion path', false);
}

// ── sanitizer adversarial battery (the real guarantee) ──────────────
const battery = [
  ['nested script', '<scr<script>ipt>alert(1)</scr</script>ipt>', /<script/i],
  ['entity js href', '<a href="java&#115;cript:alert(1)">c</a>', /javascript:/i],
  ['tab js href', '<a href="java\tscript:x">c</a>', /javascript:/i],
  ['svg onload', '<svg onload=alert(1)></svg>', /onload/i],
  ['iframe', '<iframe src="//evil"></iframe>', /<iframe/i],
  ['style expression', '<div style="width:expression(alert(1))">x</div>', /expression\(/i],
  ['css @import', '<style>@import url(//evil)</style>', /@import/i],
  ['data:text/html', '<a href="data:text/html,<b>x">c</a>', /data:text\/html/i],
  // scrubCss also neutralizes the legacy binding vectors and CSS url() schemes
  // in an inline style — distinct from expression()/@import, so each is pinned:
  ['style behavior (IE HTC)', '<div style="behavior:url(#x)">x</div>', /(^|[;\s"])behavior\s*:/i],
  ['style -moz-binding (XBL)', '<div style="-moz-binding:url(//evil.xml)">x</div>', /-moz-binding\s*:/i],
  ['style url(javascript:)', '<div style="background:url(javascript:alert(1))">x</div>', /url\(\s*["\x27]?\s*javascript:/i]
];
for (const [name, input, leakRe] of battery) {
  const out = sanitizeHtmlFragment(input);
  check('sanitize: ' + name, !leakRe.test(out));
}
// legit design must survive untouched enough to be useful
const legit = sanitizeHtmlFragment('<div class="hero" style="color:red;padding:1rem"><h1>כותרת</h1></div>');
check('sanitize: keeps legit class+style+heading', /class="hero"/.test(legit) && /color:red/.test(legit) && /<h1>כותרת<\/h1>/.test(legit));

console.log('');
console.log(fail ? 'SMOKE PZN-HTML: FAIL' : 'SMOKE PZN-HTML: PASS');
process.exit(fail ? 1 : 0);
