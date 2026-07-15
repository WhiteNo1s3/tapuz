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
    <video src="/clip.mp4" poster="/p.jpg" controls></video>
    <nav><a href="/a">A</a></nav>
    <div class="grid cols-2"><p>right</p><p>left</p></div>
    <div class="cubes">
      <article><figure><img src="/c1.jpg"></figure><h3>כתבה א</h3><a href="/c1">עוד</a></article>
      <article><figure><img src="/c2.jpg"></figure><h3>כתבה ב</h3><a href="/c2">עוד</a></article>
      <article><figure><img src="/c3.jpg"></figure><h3>כתבה ג</h3><a href="/c3">עוד</a></article>
    </div>
  `);
  check('iframe → embed block', g.blocks.some((b) => b.type === 'embed' && /youtube/.test(b.data.url)));
  check('youtube link → embed block', g.blocks.filter((b) => b.type === 'embed').length >= 2);
  check('whatsapp link stays a button + suggests a whatsapp tool',
    g.blocks.some((b) => b.type === 'button' && /wa\.me/.test(b.data.url)) && g.suggestedTools.includes('whatsapp'));
  check('form decompiles to a real form block (v0.58 closed this gap)',
    g.blocks.some((b) => b.type === 'form' && (b.data.fields || []).length >= 1) && !g.suggestedTools.includes('form'));
  check('nav decompiles to a nav block (v0.60 closed this gap)',
    g.blocks.some((b) => b.type === 'nav') && !g.suggestedTools.includes('nav'));
  check('video decompiles to a video block (v0.62 closed this gap)',
    g.blocks.some((b) => b.type === 'video' && b.data.src === '/clip.mp4') && !g.suggestedTools.includes('video'));
  check('card cluster → ONE cards block (v0.65 closed this gap)',
    g.blocks.some((b) => b.type === 'cards' && b.data.items.length === 3 && b.data.items[0].title === 'כתבה א'));
  check('table still reported as toolGap', g.suggestedTools.includes('table'));
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

  // ── v0.67: the decompiler SEES the page — image sight + menu sight ──
  const { imageSrcOf, classBgMap, coalesceButtonRuns } = require('../src/pzn/graduate');
  const { extractBaseUrl } = require('../src/pzn/decompile');

  // the walla page-eater: a homepage with MANY <article>s must never
  // collapse to the first article (v0.66 shipped one button from 679KB)
  const wall = '<html><body><div><h1>פורטל</h1>'
    + Array.from({ length: 5 }, (_, n) => `<article><h3>כתבה ${n}</h3><a href="/${n}">עוד</a></article>`).join('')
    + '</div></body></html>';
  const wallBody = extractBodyHtml(wall);
  check('multi-article page keeps the whole body (the page-eater fix)', /פורטל/.test(wallBody) && /כתבה 4/.test(wallBody));
  const single = '<html><body><nav><a href="/">בית</a></nav><article><h1>פוסט</h1>'
    + '<p>' + 'תוכן ארוך מאוד '.repeat(30) + '</p></article></body></html>';
  check('single dominant article still extracts (a blog post is the article)',
    !/בית/.test(extractBodyHtml(single)) && /פוסט/.test(extractBodyHtml(single)));

  // image sight: srcset / data-src beat a placeholder src
  check('imageSrcOf reads srcset when src is a data: placeholder',
    imageSrcOf({ src: 'data:image/gif;base64,x', srcset: '/s.jpg 320w, /l.jpg 1280w' }) === '/l.jpg');
  check('imageSrcOf prefers data-src over nothing', imageSrcOf({ 'data-src': '/lazy.jpg' }) === '/lazy.jpg');

  // CSS-in-JS background sight: emotion-style <style> class → card picture
  const emotion = '<html><head><style>.css-abc{width:100%;background-image:url(/photo1.jpg);}</style></head><body><div>'
    + '<article><div class="css-abc"></div><h3>כרטיס א</h3><a href="/a">עוד</a></article>'
    + '<article><div class="css-abc"></div><h3>כרטיס ב</h3><a href="/b">עוד</a></article>'
    + '<article><div class="css-abc"></div><h3>כרטיס ג</h3><a href="/c">עוד</a></article>'
    + '</div></body></html>';
  check('classBgMap reads <style> background rules', classBgMap(emotion).get('css-abc') === '/photo1.jpg');
  const em = decompileHtml(emotion);
  check('emotion-class background becomes the card picture',
    em.blocks.some((b) => b.type === 'cards' && (b.data.items || []).every((it) => it.image === '/photo1.jpg')));

  // menu sight: a ul of short links keeps its hrefs as a nav (not a text list)
  const menuHtml = '<div><ul><li><a href="/a">חדשות</a></li><li><a href="/b">ספורט</a></li>'
    + '<li><a href="/c">תרבות</a></li><li><a href="/d">אוכל</a></li></ul></div>';
  const menu = htmlToBlocks(menuHtml);
  check('ul of short links → nav with hrefs kept',
    menu.blocks.some((b) => b.type === 'nav' && b.data.items.length === 4 && b.data.items[0].href === '/a'));

  // wrapper-blind menus: single-anchor wrappers coalesce into one nav
  const wrapped = htmlToBlocks('<div>'
    + ['בית', 'אודות', 'צור קשר', 'בלוג'].map((t, n) => `<div><a href="/${n}">${t}</a></div>`).join('')
    + '</div>');
  check('4 wrapped sibling links coalesce into one nav',
    wrapped.blocks.some((b) => b.type === 'nav' && b.data.items.length === 4));

  // headline stacks: ≥3 consecutive LONG links are an article wall (cards)
  const headlines = coalesceButtonRuns(Array.from({ length: 3 }, (_, n) => ({
    type: 'button', id: 'b' + n,
    data: { text: 'כותרת ארוכה מאוד של כתבה חדשותית עם הרבה מאוד מילים מספר ' + n, url: '/item/' + n }
  })));
  check('3 consecutive headline-length links → one cards wall',
    headlines.length === 1 && headlines[0].type === 'cards' && headlines[0].data.items.length === 3);

  // icon links: a textless anchor never becomes a "קישור" button; its picture survives
  const icon = htmlToBlocks('<p>לפני</p><a href="/home"><img src="/logo.png" alt="לוגו"/></a><p>אחרי</p>');
  check('textless picture link → image block, no nameless button',
    icon.blocks.some((b) => b.type === 'image' && b.data.src === '/logo.png')
    && !icon.blocks.some((b) => b.type === 'button'));

  // base-url resolution: pasted HTML resolves relative media via canonical
  const canon = '<html><head><link rel="canonical" href="https://site.example/page"/></head>'
    + '<body><img src="/pic.jpg" alt=""/></body></html>';
  check('extractBaseUrl finds the canonical link', extractBaseUrl(canon) === 'https://site.example/page');
  const abs = decompileHtml(canon);
  check('pasted HTML absolutizes image srcs against its canonical',
    abs.blocks.some((b) => b.type === 'image' && b.data.src === 'https://site.example/pic.jpg'));

  // ingestion plumbing (offline): every image field in a tree is found + rewritten
  const { imageRefs } = require('../src/media-ingest');
  const tree = [
    { type: 'image', data: { src: 'https://x.example/a.jpg' } },
    { type: 'hero', data: { image: 'https://x.example/b.jpg', title: 'x' } },
    { type: 'cards', data: { items: [{ title: 'c', image: 'https://x.example/c.jpg' }] } },
    { type: 'columns', data: { columns: [{ blocks: [{ type: 'image', data: { src: 'https://x.example/d.jpg' } }] }] } }
  ];
  const refs = imageRefs(tree);
  check('imageRefs finds every image field in a nested tree', refs.length === 4);
  refs.forEach((r) => r.set('/assets/local.webp'));
  check('imageRefs rewrites through to the blocks',
    tree[0].data.src === '/assets/local.webp' && tree[2].data.items[0].image === '/assets/local.webp'
    && tree[3].data.columns[0].blocks[0].data.src === '/assets/local.webp');

  // ── v0.68: the brains merge — lab fidelity ideas rebuilt on Tapuz ──
  const { pickFromSrcset } = require('../src/pzn/graduate');

  // CDN URLs carry bare commas — srcset must be read by width descriptors
  check('pickFromSrcset survives CDN commas and picks the largest',
    pickFromSrcset('https://c.dn/f_auto,q_auto,w_300/a.jpg 300w,https://c.dn/f_auto,q_auto,w_900/a.jpg 900w')
      === 'https://c.dn/f_auto,q_auto,w_900/a.jpg');
  check('imageSrcOf reads React-dump camelCase srcSet',
    imageSrcOf({ srcSet: '/small.jpg 1x, /big.jpg 2x' }) === '/big.jpg');
  check('imageSrcOf upgrades protocol-relative CDN urls',
    imageSrcOf({ 'data-src': '//cdn.x/pic.jpg' }) === 'https://cdn.x/pic.jpg');

  // a teaser link (picture+headline inside <a>) becomes a card, picture kept
  const teaser = htmlToBlocks('<div>'
    + '<a href="/story"><picture><source srcset="/tease.jpg 600w"/></picture><h2>כותרת הכתבה המלאה</h2></a>'
    + '</div>');
  const teaserCards = teaser.blocks.find((b) => b.type === 'cards');
  check('picture+headline link → card with the picture kept',
    !!teaserCards && teaserCards.data.items[0].image === '/tease.jpg' && /כותרת/.test(teaserCards.data.items[0].title));

  // sibling teaser links fuse into ONE card wall
  const wall2 = htmlToBlocks('<div>'
    + ['א', 'ב', 'ג'].map((t, n) => `<a href="/${n}"><img src="/${n}.jpg"/><h3>כתבה ${t}</h3></a>`).join('')
    + '</div>');
  check('adjacent teaser links fuse into one card wall',
    wall2.blocks.filter((b) => b.type === 'cards').length === 1
    && wall2.blocks.find((b) => b.type === 'cards').data.items.length === 3);

  // a walla-class <script> state dump must never become a provisional blob
  const scripty = htmlToBlocks('<div><script>window.state="' + 'x'.repeat(5000) + '"</script><p>תוכן אמיתי</p></div>');
  check('script tags are skipped, never kept as provisional blobs',
    !scripty.blocks.some((b) => b.type === 'html') && scripty.blocks.some((b) => b.type === 'text' && /אמיתי/.test(b.data.content)));

  // icon links with an aria name become labeled links, not dropped
  const aria = htmlToBlocks('<p>לפני</p><a href="/mail" aria-label="דואר"><i class="ico"></i></a><p>אחרי</p>');
  check('textless link with aria-label keeps its name',
    aria.blocks.some((b) => b.type === 'button' && b.data.text === 'דואר'));

  // q/cite and bare buttons map instead of leaking to leftovers
  const extras = htmlToBlocks('<div><q>ציטוט קצר</q><button type="button">הרשמה</button><button></button></div>');
  check('q → quote, texty bare button → button, textless button dropped',
    extras.blocks.some((b) => b.type === 'quote' && /ציטוט/.test(b.data.text))
    && extras.blocks.some((b) => b.type === 'button' && b.data.text === 'הרשמה')
    && extras.blocks.filter((b) => b.type === 'button').length === 1);

  console.log('');
  console.log(fail ? 'SMOKE DECOMPILE: FAIL' : 'SMOKE DECOMPILE: PASS');
  process.exit(fail ? 1 : 0);
})();
