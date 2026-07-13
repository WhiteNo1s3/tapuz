'use strict';

/**
 * v0.57 QA — the HTML→BenTML decompiler (the vocabulary engine).
 * Proves: whole-page decompile → valid .pzn; the upgraded graduate mappings
 * (iframe/youtube→embed, whatsapp hint); the toolGap report; and the SSRF
 * guard that keeps the URL fetch away from private addresses.
 */

const { decompileHtml, extractBodyHtml, extractDir, assertPublicUrl, isPrivateIp } = require('../src/pzn/decompile');
const { htmlToBlocks } = require('../src/pzn/graduate');
const pzn = require('../src/pzn/index');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}
async function checkRejects(name, fn) {
  try { await fn(); check(name + ' (should have thrown)', false); }
  catch (e) { check(name, true); }
}

(async () => {
  // ── upgraded graduate mappings ─────────────────────────────────────
  const g = htmlToBlocks(`
    <h1>Title</h1><p>Body</p>
    <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
    <a href="https://youtu.be/abc123xyz">סרטון</a>
    <a href="https://wa.me/972501234567">ווטסאפ</a>
    <form action="/x"><input name="q"/></form>
    <table><tr><td>1</td></tr></table>
    <nav><a href="/a">A</a></nav>
    <div class="grid cols-2"><p>right</p><p>left</p></div>
  `);
  check('iframe → embed block', g.blocks.some((b) => b.type === 'embed' && /youtube/.test(b.data.url)));
  check('youtube link → embed block', g.blocks.filter((b) => b.type === 'embed').length >= 2);
  check('whatsapp link stays a button + suggests a whatsapp tool',
    g.blocks.some((b) => b.type === 'button' && /wa\.me/.test(b.data.url)) && g.suggestedTools.includes('whatsapp'));
  check('form decompiles to a real form block (v0.58 closed this gap)',
    g.blocks.some((b) => b.type === 'form' && (b.data.fields || []).length >= 1) && !g.suggestedTools.includes('form'));
  check('table/nav still reported as toolGap',
    ['table', 'nav'].every((t) => g.suggestedTools.includes(t)));
  check('grid wrapper with children suggests columns', g.suggestedTools.includes('columns'));
  check('remaining unmapped patterns preserved as provisional html (nothing lost)',
    g.blocks.some((b) => b.type === 'html' && /table/.test(b.data.content)));

  // ── whole-page decompile → valid .pzn ──────────────────────────────
  const page = `<!DOCTYPE html>
<html lang="he" dir="rtl"><head><title>  חדשות   היום </title></head>
<body>
<header><p>skip-chrome</p></header>
<main>
  <h1>כותרת ראשית</h1>
  <p>פסקה ראשונה עם טקסט.</p>
  <img src="/pic.jpg" alt="תמונה" />
  <a href="/more">קראו עוד</a>
</main>
</body></html>`;
  const r = decompileHtml(page);
  check('title extracted + whitespace collapsed', r.meta.title === 'חדשות היום');
  check('dir/lang extracted', r.meta.dir === 'rtl' && r.meta.lang === 'he');
  check('slug derived from title', r.meta.slug.length > 0 && !/\s/.test(r.meta.slug));
  check('main preferred over body (header chrome skipped)', !JSON.stringify(r.blocks).includes('skip-chrome'));
  check('mapped h1+p+img+a', r.mapped >= 4);
  check('source is a complete document', /<!DOCTYPE html>/i.test(r.source) && /<\/html>/i.test(r.source));
  check('source parses + validates clean', (() => {
    try { return pzn.validate(pzn.parse(r.source), { strict: false }).filter((i) => i.severity === 'error').length === 0; }
    catch (e) { return false; }
  })());
  check('decompile reports no issues on a clean page', r.issues.length === 0);

  // Hebrew-content page WITHOUT declared dir → rtl heuristic
  check('undeclared dir + Hebrew text → rtl', extractDir('<html><body><p>שלום</p></body></html>') === 'rtl');
  check('extractBodyHtml falls back to fragment', extractBodyHtml('<p>frag</p>') === '<p>frag</p>');

  // scripted/empty page still yields a page (never a hard failure)
  const empty = decompileHtml('<html><body><script>app()</script></body></html>');
  check('script-only page yields a placeholder page', empty.blocks.length >= 1 && /<\/html>/i.test(empty.source));

  // malformed HTML (a bare / between attributes) throws the tokenizer — the
  // decompiler must DEGRADE, never crash. Real sites (yahoo.com) hit this.
  const malformed = decompileHtml('<html><body><main><h1>ok</h1><div a=b / c>x</div></main></body></html>');
  check('malformed HTML degrades to a page instead of throwing',
    malformed.blocks.length >= 1 && /<\/html>/i.test(malformed.source));

  // ── SSRF guard ─────────────────────────────────────────────────────
  check('private IPv4 ranges detected', ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.9', '169.254.169.254', '0.0.0.0', '100.64.0.1'].every(isPrivateIp));
  check('public IPv4 allowed', !isPrivateIp('93.184.216.34') && !isPrivateIp('8.8.8.8'));
  check('private IPv6 detected', ['::1', 'fc00::1', 'fe80::1', '::ffff:192.168.1.1'].every(isPrivateIp));
  await checkRejects('blocks localhost', () => assertPublicUrl('http://localhost:3000/admin'));
  await checkRejects('blocks 127.0.0.1', () => assertPublicUrl('http://127.0.0.1/'));
  await checkRejects('blocks cloud metadata IP', () => assertPublicUrl('http://169.254.169.254/latest/meta-data'));
  await checkRejects('blocks .internal hostnames', () => assertPublicUrl('http://metadata.google.internal/'));
  await checkRejects('blocks file: scheme', () => assertPublicUrl('file:///etc/passwd'));
  await checkRejects('blocks ftp: scheme', () => assertPublicUrl('ftp://example.com/x'));
  await checkRejects('blocks IPv6 loopback literal', () => assertPublicUrl('http://[::1]/'));

  // ── self-decompile: our own renderer output round-trips ────────────
  const { renderBlock } = require('../src/renderer');
  const ownHtml = '<html lang="he" dir="rtl"><head><title>עצמי</title></head><body><main>'
    + renderBlock({ type: 'heading', id: 'h1', data: { level: 2, text: 'שלום' } }, 'rtl')
    + renderBlock({ type: 'text', id: 't1', data: { content: 'תוכן' } }, 'rtl')
    + '</main></body></html>';
  const self = decompileHtml(ownHtml);
  check('self-decompile: rendered Tapuz HTML maps back to blocks',
    self.blocks.some((b) => b.type === 'heading') && self.mapped >= 2);

  console.log('');
  console.log(fail ? 'SMOKE DECOMPILE: FAIL' : 'SMOKE DECOMPILE: PASS');
  process.exit(fail ? 1 : 0);
})();
