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
const bentml = require('../src/bentml');

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
  const timeBlock = htmlToBlocks('<time class="DateDisplay" datetime="2026-09-07T19:11:07.322Z"></time>');
  check('<time datetime> (empty body, ynet DateDisplay) → text, not leftover html',
    timeBlock.blocks.some((b) => b.type === 'text' && b.data.content === '7.9.2026')
    && !timeBlock.blocks.some((b) => b.type === 'html'));
  const pageForm = htmlToBlocks(
    '<form id="aspnetForm" method="post">'
    + '<input type="hidden" name="__VIEWSTATE" value="x"/>'
    + '<h2>כותרת א</h2><p>גוף</p><h2>כותרת ב</h2><p>עוד</p><h2>כותרת ג</h2>'
    + '</form>'
  );
  check('page-wrapper ASP.NET form descends — headlines live, not one leftover html blob',
    pageForm.blocks.filter((b) => b.type === 'heading').length >= 3
    && !pageForm.blocks.some((b) => b.type === 'html' && /VIEWSTATE/.test(b.data.content || '')));
  const orphanFields = htmlToBlocks(
    '<label for="mail">אימייל</label><input id="mail" type="email" name="mail"/>'
    + '<label for="tel">טלפון</label><input id="tel" type="tel" name="tel"/>'
  );
  check('orphan label+input run → one form (bug.co.il leftovers)',
    orphanFields.blocks.some((b) => b.type === 'form' && (b.data.fields || []).length >= 2)
    && !orphanFields.blocks.some((b) => b.type === 'html'));
  const classedTeasers = htmlToBlocks(
    '<div class="cluster">'
    + '<div class="item"><div class="title">כתבה א</div><a href="/a">עוד</a></div>'
    + '<div class="item"><div class="title">כתבה ב</div><a href="/b">עוד</a></div>'
    + '<div class="item"><div class="title">כתבה ג</div><a href="/c">עוד</a></div>'
    + '</div>'
  );
  check('classed .title teasers → cards (globes/ynet cluster)',
    classedTeasers.blocks.some((b) => b.type === 'cards' && b.data.items.length === 3
      && b.data.items[0].title === 'כתבה א' && b.data.items[0].href === '/a'));
  const jsCrumbs = htmlToBlocks('<div><date2_end) leftover junk</date2_end)><p>גוף</p></div>');
  check('JS crumbs tokenized as tags are skipped, not leftover html',
    jsCrumbs.blocks.some((b) => b.type === 'text' && /גוף/.test(b.data.content))
    && !jsCrumbs.blocks.some((b) => b.type === 'html'));
  const menuNav = htmlToBlocks('<menu><a href="/a">בית</a><a href="/b">כלכלה</a></menu>');
  check('<menu> with links → nav',
    menuNav.blocks.some((b) => b.type === 'nav' && (b.data.items || []).length === 2));
  check('nav decompiles to a nav block (v0.60 closed this gap)',
    g.blocks.some((b) => b.type === 'nav') && !g.suggestedTools.includes('nav'));
  check('video decompiles to a video block (v0.62 closed this gap)',
    g.blocks.some((b) => b.type === 'video' && b.data.src === '/clip.mp4') && !g.suggestedTools.includes('video'));
  check('card cluster → ONE cards block (v0.65 closed this gap)',
    g.blocks.some((b) => b.type === 'cards' && b.data.items.length === 3 && b.data.items[0].title === 'כתבה א'));
  // v2.22: the decompiler caught up to its own language — table stopped being
  // a toolGap, a text table maps to the real module
  check('text table → the native table block (v2.22 closed this gap)',
    g.blocks.some((b) => b.type === 'table' && b.data.rows.length === 1 && b.data.rows[0].cells === '1') &&
    !g.suggestedTools.includes('table'));
  check('grid wrapper with children suggests columns', g.suggestedTools.includes('columns'));

  // the nothing-lost refusal: a table too rich for the module (image cells)
  // still ships verbatim AND still reports the gap
  const rich = htmlToBlocks('<table><tr><td><img src="/x.png"></td></tr></table>');
  check('a RICH table refuses the mapping — verbatim html + toolGap (nothing lost)',
    rich.blocks.some((b) => b.type === 'html' && /table/.test(b.data.content)) &&
    rich.suggestedTools.includes('table'));

  // v2.22 companions: audio, details-runs and maps embeds map to their modules
  const extra = htmlToBlocks(
    '<audio controls src="/pod.mp3"></audio>' +
    '<details><summary>שאלה א</summary><p>תשובה א</p></details>' +
    '<details><summary>שאלה ב</summary><p>תשובה ב</p></details>' +
    '<iframe src="https://www.google.com/maps?q=%D7%93%D7%99%D7%96%D7%A0%D7%92%D7%95%D7%A3+99&output=embed"></iframe>'
  );
  check('audio → the native audio block (v2.22 closed this gap)',
    extra.blocks.some((b) => b.type === 'audio' && b.data.src === '/pod.mp3') &&
    !extra.suggestedTools.includes('audio'));
  check('a run of sibling <details> → ONE accordion with every fold',
    extra.blocks.filter((b) => b.type === 'accordion').length === 1 &&
    extra.blocks.find((b) => b.type === 'accordion').data.items.length === 2 &&
    extra.blocks.find((b) => b.type === 'accordion').data.items[1].content === 'תשובה ב');
  check('a Google-Maps embed with an address → the map module, not a bare embed',
    extra.blocks.some((b) => b.type === 'map' && /דיזנגוף 99/.test(b.data.address)));

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
  check('import emits keyword BenTML', /^BENTML /.test(r.bentml || ''));
  check('keyword BenTML compiles back to the same types', (() => {
    try {
      const back = bentml.compile(r.bentml);
      const a = r.blocks.map((b) => b.type).sort().join(',');
      const c = back.blocks.map((b) => b.type).sort().join(',');
      return a === c && back.blocks.length === r.blocks.length;
    } catch (e) { return false; }
  })());

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

  const glued = coalesceButtonRuns([
    { type: 'button', id: 'b0', data: { text: 'כותרת ארוכה מאוד של כתבה חדשותית מספר אחת בעמוד', url: '/article/1' } },
    { type: 'text', id: 't0', data: { content: 'window.YITSiteWidgets.push(1)' } },
    { type: 'button', id: 'b1', data: { text: 'כותרת ארוכה מאוד של כתבה חדשותית מספר שתיים בעמוד', url: '/article/2' } },
    { type: 'text', id: 't1', data: { content: 'ליאור בן ארי|' } },
    { type: 'text', id: 't2', data: { content: '7.9.2026' } },
    { type: 'button', id: 'b2', data: { text: 'כותרת ארוכה מאוד של כתבה חדשותית מספר שלוש בעמוד', url: '/article/3' } }
  ]);
  check('headline buttons glued by JS/byline text still fuse into one cards wall',
    glued.length === 1 && glued[0].type === 'cards' && glued[0].data.items.length === 3);

  const layoutCols = decompileHtml(
    '<html><body><main><div class="layoutContainer">'
    + '<div class="layoutItem" style="width:610px"><p>ימין</p></div>'
    + '<div class="layoutItem" style="width:300px"><p>אמצע</p></div>'
    + '<div class="layoutItem" style="width:300px"><p>שמאל</p></div>'
    + '</div></main></body></html>'
  );
  check('px-width layoutItem row → columns module (not a flatten)',
    layoutCols.blocks.some((b) => b.type === 'columns' && (b.data.columns || []).length === 3)
    && !layoutCols.toolGap.includes('columns'));

  const flexTabs = htmlToBlocks(
    '<div class="mag-box">'
    + '<ul class="mag-box-filter-links is-flex-tabs">'
    + '<li><a class="block-ajax-term active" href="#">הכל</a></li>'
    + '<li><a class="block-ajax-term" href="#">בארץ</a></li>'
    + '</ul>'
    + '<div class="mag-box-container"><ul class="posts-items"><li>כתבה א</li><li>כתבה ב</li></ul></div>'
    + '</div>'
  );
  check('Jannah is-flex-tabs + posts → tabs module, not a silent flatten',
    flexTabs.blocks.some((b) => b.type === 'tabs' && b.data.items.length >= 2
      && b.data.items[0].label === 'הכל' && /כתבה א/.test(b.data.items[0].content))
    && !flexTabs.suggestedTools.includes('tabs'));

  const slick = htmlToBlocks(
    '<div class="tie-slick-slider-wrapper">'
    + '<div class="tie-slick-slider">'
    + '<div class="slide tie-slide-1" style="background-image:url(/a.jpg)"><a href="/1"><h2>שקופית א</h2></a></div>'
    + '<div class="slide tie-slide-2" style="background-image:url(/b.jpg)"><a href="/2"><h2>שקופית ב</h2></a></div>'
    + '</div></div>'
  );
  check('tie-slick slides with CSS backgrounds → carousel',
    slick.blocks.some((b) => b.type === 'carousel' && b.data.items.length === 2
      && b.data.items[0].title === 'שקופית א' && /a\.jpg/.test(b.data.items[0].image)));

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

  // ── inbound maps + guessed-and-lost toolGap (never a silent flatten) ──
  const swiper = htmlToBlocks(
    '<div class="swiper"><div class="swiper-wrapper">'
    + '<div class="swiper-slide"><img src="/a.jpg" alt=""><h3>שקופית א</h3></div>'
    + '<div class="swiper-slide"><img src="/b.jpg" alt=""><h3>שקופית ב</h3></div>'
    + '</div></div>'
  );
  check('Swiper → carousel (2 slides, pictures kept)',
    swiper.blocks.some((b) => b.type === 'carousel' && (b.data.items || []).length === 2
      && b.data.items[0].image === '/a.jpg' && b.data.items[0].title === 'שקופית א'));

  const swiperEmpty = htmlToBlocks('<div class="swiper"><div class="swiper-wrapper"></div></div>');
  check('empty Swiper flattens but still reports carousel toolGap',
    !swiperEmpty.blocks.some((b) => b.type === 'carousel') && swiperEmpty.suggestedTools.includes('carousel'));

  const bootTabs = htmlToBlocks(
    '<ul class="nav nav-tabs">'
    + '<li><a href="#one">אחד</a></li><li><a href="#two">שניים</a></li>'
    + '</ul>'
    + '<div class="tab-content">'
    + '<div class="tab-pane" id="one"><p>תוכן אחד</p></div>'
    + '<div class="tab-pane" id="two"><p>תוכן שניים</p></div>'
    + '</div>'
  );
  const bootTab = bootTabs.blocks.find((b) => b.type === 'tabs');
  check('Bootstrap tabs → tabs module (labels + pane text)',
    !!bootTab && bootTab.data.items.length === 2 && bootTab.data.items[0].label === 'אחד'
    && /תוכן אחד/.test(bootTab.data.items[0].content));

  const classedFaq = htmlToBlocks(
    '<section class="faq">'
    + '<div class="faq-item"><h3>איך מתחילים?</h3><p>יוצרים אתר.</p></div>'
    + '<div class="faq-item"><h3>כמה זה עולה?</h3><p>חינם.</p></div>'
    + '</section>'
  );
  const faqB = classedFaq.blocks.find((b) => b.type === 'faq');
  check('classed FAQ heading+p → faq module',
    !!faqB && faqB.data.items.length === 2 && faqB.data.items[0].question === 'איך מתחילים?'
    && faqB.data.items[1].answer === 'חינם.');

  const faqDl = htmlToBlocks(
    '<dl class="faq"><dt>שאלה א</dt><dd>תשובה א</dd><dt>שאלה ב</dt><dd>תשובה ב</dd></dl>'
  );
  check('classed <dl class="faq"> → faq, not a timeline',
    faqDl.blocks.some((b) => b.type === 'faq' && b.data.items[0].question === 'שאלה א')
    && !faqDl.blocks.some((b) => b.type === 'timeline'));

  const pricingHtml = htmlToBlocks(
    '<div class="pricing">'
    + '<article class="plan"><h3>בסיסי</h3><span class="price">$9</span>'
    + '<ul class="features"><li>אחת</li><li>שתיים</li></ul><a href="/s">התחילו</a></article>'
    + '<article class="plan featured"><h3>פרו</h3><span class="price">$29/mo</span>'
    + '<ul class="features"><li>הכל</li></ul><a href="/p">קדימה</a></article>'
    + '</div>'
  );
  const pr = pricingHtml.blocks.find((b) => b.type === 'pricing');
  check('classed pricing HTML → pricing (title, price, features, cta, highlight)',
    !!pr && pr.data.items.length === 2 && pr.data.items[0].title === 'בסיסי'
    && pr.data.items[0].price === '$9' && /אחת/.test(pr.data.items[0].features)
    && pr.data.items[0].ctaUrl === '/s' && pr.data.items[1].highlighted === true);

  const bgHero = htmlToBlocks(
    '<section class="hero" style="background-image:url(/hero.jpg)">'
    + '<h1>ברוכים הבאים</h1><p>הסטודיו</p><a href="/go">קדימה</a>'
    + '</section>'
  );
  check('hero with CSS background-image keeps the picture',
    bgHero.blocks.some((b) => b.type === 'hero' && b.data.title === 'ברוכים הבאים'
      && b.data.image === '/hero.jpg' && b.data.buttonUrl === '/go'));

  const bloatedHero = htmlToBlocks(
    '<div class="hero">'
    + [1, 2, 3, 4, 5, 6].map((n) => '<h2>סעיף ' + n + '</h2><p>תוכן ' + n + '</p>').join('')
    + '</div>'
  );
  check('page-sized hero-classed wrapper flattens AND reports hero toolGap',
    !bloatedHero.blocks.some((b) => b.type === 'hero')
    && bloatedHero.suggestedTools.includes('hero')
    && bloatedHero.blocks.filter((b) => b.type === 'heading').length >= 2);

  const ownPricing = htmlToBlocks(require('../src/pzn/pricing-html').renderPricingFromData({
    items: [
      { title: 'א', price: '10', features: 'x', ctaLabel: 'קנו', ctaUrl: '/a' },
      { title: 'ב', price: '20', features: 'y', highlighted: true }
    ]
  }, 'rtl'));
  check('our own bent-pricing HTML maps back to pricing',
    ownPricing.blocks.some((b) => b.type === 'pricing' && b.data.items.length === 2
      && b.data.items[0].title === 'א'));

  const classedStats = htmlToBlocks(
    '<section class="stats">'
    + '<div class="stat"><div class="stat-value">120+</div><div class="stat-label">לקוחות</div></div>'
    + '<div class="stat"><div class="stat-value">15</div><div class="stat-label">שנים</div></div>'
    + '<div class="stat"><div class="stat-value">98%</div><div class="stat-label">שביעות רצון</div></div>'
    + '</section>'
  );
  const st = classedStats.blocks.find((b) => b.type === 'stats');
  check('classed .stats → stats (value + label kept)',
    !!st && st.data.items.length === 3 && st.data.items[0].value === '120+'
    && st.data.items[2].label === 'שביעות רצון');

  const counters = htmlToBlocks(
    '<div class="counters">'
    + '<div><h3>10K</h3><p>Users</p></div>'
    + '<div><h3>4.9</h3><p>Rating</p></div>'
    + '</div>'
  );
  check('classed .counters heading+p → stats',
    counters.blocks.some((b) => b.type === 'stats' && b.data.items[0].value === '10K'
      && b.data.items[1].label === 'Rating'));

  const emptyStats = htmlToBlocks('<section class="stats"><p>coming soon</p></section>');
  check('classed stats without numbers flattens AND reports stats toolGap',
    !emptyStats.blocks.some((b) => b.type === 'stats') && emptyStats.suggestedTools.includes('stats'));

  const ownStats = htmlToBlocks(renderBlock({
    type: 'stats', id: 's', data: { columns: 3, items: [{ value: '9', label: 'A' }, { value: '8', label: 'B' }] }
  }, 'rtl'));
  check('our own stats-row HTML maps back to stats',
    ownStats.blocks.some((b) => b.type === 'stats' && b.data.items.length === 2 && b.data.items[0].value === '9'));

  const classedLogos = htmlToBlocks(
    '<div class="logos">'
    + '<img src="/a.svg" alt="Alpha">'
    + '<a href="https://b.example"><img src="/b.svg" alt="Beta"></a>'
    + '<div class="logo-cell"><img src="/c.svg" alt="Gamma"></div>'
    + '</div>'
  );
  const lg = classedLogos.blocks.find((b) => b.type === 'logos');
  check('classed .logos → logos (src, alt, optional url)',
    !!lg && lg.data.items.length === 3 && lg.data.items[0].src === '/a.svg'
    && lg.data.items[1].url === 'https://b.example' && lg.data.items[2].alt === 'Gamma');

  const clients = htmlToBlocks(
    '<ul class="clients">'
    + '<li><img src="/c1.png" alt="One"></li>'
    + '<li><img src="/c2.png" alt="Two"></li>'
    + '</ul>'
  );
  check('classed .clients list → logos',
    clients.blocks.some((b) => b.type === 'logos' && b.data.items.length === 2
      && b.data.items[0].src === '/c1.png'));

  const emptyLogos = htmlToBlocks('<div class="brands"><p>no marks yet</p></div>');
  check('classed brands without images flattens AND reports logos toolGap',
    !emptyLogos.blocks.some((b) => b.type === 'logos') && emptyLogos.suggestedTools.includes('logos'));

  const ownLogos = htmlToBlocks(renderBlock({
    type: 'logos', id: 'l', data: { items: [{ src: '/x.svg', alt: 'X' }, { src: '/y.svg', alt: 'Y', url: '/y' }] }
  }, 'rtl'));
  check('our own logos-strip HTML maps back to logos',
    ownLogos.blocks.some((b) => b.type === 'logos' && b.data.items.length === 2
      && b.data.items[1].url === '/y'));

  const elFaq = htmlToBlocks(
    '<div class="elementor-widget elementor-widget-stattic-faq dsm-faq">'
    + '<div class="e-loop-item faq type-faq">'
    + '<div class="dsm-faq--title"><div class="elementor-heading-title">קטגוריה</div></div>'
    + '<div class="dsm-faq--faq-content"><h3>איך מתחילים?</h3><p>יוצרים אתר.</p></div>'
    + '</div>'
    + '<div class="e-loop-item faq type-faq">'
    + '<div class="dsm-faq--title"><div class="elementor-heading-title">קטגוריה</div></div>'
    + '<div class="dsm-faq--faq-content"><h3>כמה זה עולה?</h3><p>חינם.</p></div>'
    + '</div>'
    + '</div>'
  );
  const elFaqB = elFaq.blocks.find((b) => b.type === 'faq');
  check('Elementor DSM FAQ loop → faq (real questions, not category titles)',
    !!elFaqB && elFaqB.data.items.length === 2
    && elFaqB.data.items[0].question === 'איך מתחילים?'
    && elFaqB.data.items[1].answer === 'חינם.'
    && !elFaq.suggestedTools.includes('faq'));

  const elQuote = htmlToBlocks(
    '<div class="elementor-testimonial-wrapper">'
    + '<div class="elementor-testimonial-content">“האתר עלה ביום.”</div>'
    + '<div class="elementor-testimonial-name">תמר כהן</div>'
    + '<div class="elementor-testimonial-job">מנהלת סטודיו</div>'
    + '</div>'
  );
  const elT = elQuote.blocks.find((b) => b.type === 'testimonial');
  check('Elementor testimonial widget → testimonial (quote, author, role)',
    !!elT && /האתר עלה/.test(elT.data.quote)
    && elT.data.author === 'תמר כהן' && elT.data.role === 'מנהלת סטודיו');

  const elSocial = htmlToBlocks(
    '<div class="elementor-widget-social-icons"><div class="elementor-social-icons-wrapper">'
    + '<a class="elementor-social-icon elementor-social-icon-wordpress" href="https://wordpress.org/plugins/x">WordPress</a>'
    + '<a class="elementor-social-icon elementor-social-icon-github" href="https://github.com/x">GitHub</a>'
    + '</div></div>'
  );
  const chromeH = htmlToBlocks(
    '<header class="site-header"><a href="/"><img src="/logo.png" alt="לוגו"/></a>'
    + '<nav><a href="/">בית</a><a href="/about">אודות</a></nav></header>'
  );
  check('<header> landmark → header module (not leftover chrome)',
    chromeH.blocks.some((b) => b.type === 'header' && (b.data.items || []).length >= 2)
    && !chromeH.suggestedTools.includes('header'));
  const chromeF = htmlToBlocks(
    '<footer class="site-footer"><a href="/p">פרטיות</a><a href="/t">תנאים</a>'
    + '<p class="copyright">© 2026</p></footer>'
  );
  check('<footer> landmark → footer module',
    chromeF.blocks.some((b) => b.type === 'footer' && /2026/.test(b.data.copy || ''))
    && !chromeF.suggestedTools.includes('footer'));

  check('Elementor social-icons widget → social module',
    elSocial.blocks.some((b) => b.type === 'social' && b.data.items.length === 2
      && b.data.items[0].network === 'wordpress'));

  console.log('');
  console.log(fail ? 'SMOKE DECOMPILE: FAIL' : 'SMOKE DECOMPILE: PASS');
  process.exit(fail ? 1 : 0);
})();
