'use strict';

/**
 * QA — gap-audit wave 4: header / footer / whatsapp.
 * The hottest toolGaps the live decompile audit kept reporting on real
 * homepages (walla, mako, rest.co.il, doctor.co.il): the <header> and
 * <footer> landmarks the walk refused to invent, and the wa.me link every
 * Israeli business site hangs on everything. Each module is checked end to
 * end: registry + seed, render (own class names — never the master chrome's
 * .site-header/.site-footer), XSS, pzn round-trip, legacy BentML round-trip,
 * and both decompiler lenses mapping the real-world markup that used to
 * flatten — with the toolGap CLEARED when the map succeeds and still
 * reported when a band keeps provisional html (the rich-table rule).
 */

const pzn = require('../src/pzn/index');
const { renderBlock } = require('../src/renderer');
const { getBlockDef, defaultDataFor } = require('../src/block-registry');
const bentml = require('../src/bentml');
const { RESERVED } = require('../src/bentml/keywords');
const { htmlToBlocks } = require('../src/pzn/graduate');
const { huntBlocks } = require('../src/pzn/hunt');
const { decompileHtml } = require('../src/pzn/decompile');
const { parseWhatsappHref, phoneDigits, whatsappHref } = require('../src/pzn/whatsapp-html');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

/** Every block in a tree, header/footer/columns children included. */
function flat(blocks) {
  return (blocks || []).flatMap((b) => {
    const d = b.data || {};
    const kids = [...(d.blocks || []), ...(d.columns || []).flatMap((c) => c.blocks || [])];
    return [b, ...flat(kids)];
  });
}
const firstOf = (r, type) => flat(r.blocks).find((b) => b.type === type);

// ── shared: registry + seed + pzn round-trip for all three ──
const FIXTURES = {
  header: {
    tone: 'dark', layout: 'row',
    blocks: [
      { type: 'image', id: 'img_1', data: { src: '/uploads/logo.svg', alt: 'לוגו' } },
      { type: 'nav', id: 'nav_1', data: { items: [{ label: 'בית', href: '/' }, { label: 'אודות', href: '/about' }] } },
      { type: 'whatsapp', id: 'wa_0', data: { label: 'דברו איתנו', phone: '972501234567' } }
    ]
  },
  footer: {
    tone: 'light', credit: '© 2026 כל הזכויות שמורות',
    blocks: [
      { type: 'text', id: 'txt_1', data: { content: 'תחתית' } },
      { type: 'social', id: 'soc_1', data: { items: [{ network: 'facebook', url: 'https://facebook.com/x', label: 'פייסבוק' }] } }
    ]
  },
  whatsapp: { label: 'דברו איתנו בוואטסאפ', phone: '972501234567', message: 'שלום, אשמח לפרטים', note: 'מענה תוך דקות', align: 'center' }
};

for (const [type, data] of Object.entries(FIXTURES)) {
  check(`registry + seed: ${type}`, !!getBlockDef(type) && Object.keys(defaultDataFor(type) || {}).length > 0);
  const page = { title: 't', slug: 't', direction: 'rtl', tags: [], meta: {}, blocks: [{ type, id: type + '_1', data }] };
  const doc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)));
  check(`pzn validates clean: ${type}`, pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);
  const back = pzn.toTapuzPage(doc).blocks.find((b) => b.type === type);
  check(`pzn round-trips: ${type}`, !!back);
  if (back && data.blocks) {
    check(`pzn keeps every nested block: ${type}`,
      (back.data.blocks || []).map((b) => b.type).join(',') === data.blocks.map((b) => b.type).join(','));
  }
}
check('HEADER + FOOTER graduated from RESERVED', !RESERVED.has('HEADER') && !RESERVED.has('FOOTER'));
check('registry labels are Hebrew-first', /ראש עמוד/.test(getBlockDef('header').labelHe)
  && /תחתית עמוד/.test(getBlockDef('footer').labelHe) && /וואטסאפ/.test(getBlockDef('whatsapp').labelHe));
check('header/footer are blocks-containers (builder nests via childrenKey)',
  getBlockDef('header').childrenKey === 'blocks' && getBlockDef('footer').childrenKey === 'blocks');

// ── header ──
const hdHtml = renderBlock({ type: 'header', id: 'h1', data: FIXTURES.header }, 'rtl');
check('header render: <header class="bent-header tone-dark layout-row"> + nested blocks',
  /^<header[^>]*class="bent-header tone-dark layout-row/.test(hdHtml)
  && /bent-header-inner/.test(hdHtml) && /bent-image/.test(hdHtml) && /bent-nav/.test(hdHtml) && /bent-whatsapp/.test(hdHtml));
check('header render never borrows the master chrome (.site-header)', !/site-header|main-nav/.test(hdHtml));
check('header render: bad tone/layout fall back to defaults', /tone-light layout-row/.test(renderBlock({
  type: 'header', id: 'h2', data: { tone: 'purple', layout: 'diagonal', blocks: [] }
}, 'rtl')));

// ── footer ──
const ftHtml = renderBlock({ type: 'footer', id: 'f1', data: FIXTURES.footer }, 'rtl');
check('footer render: <footer class="bent-footer tone-light"> + nested blocks + credit',
  /^<footer[^>]*class="bent-footer tone-light/.test(ftHtml) && /bent-footer-inner/.test(ftHtml)
  && /bent-social/.test(ftHtml) && /bent-footer-credit">© 2026 כל הזכויות שמורות</.test(ftHtml));
check('footer render never borrows the master chrome (.site-footer)', !/site-footer|footer-columns/.test(ftHtml));
check('footer render: credit is XSS-escaped', /&lt;s&gt;/.test(renderBlock({
  type: 'footer', id: 'f2', data: { credit: '<s>x</s>', blocks: [] }
}, 'rtl')));
check('footer render: no credit → no credit line', !/bent-footer-credit/.test(renderBlock({
  type: 'footer', id: 'f3', data: { blocks: [] }
}, 'rtl')));

// ── whatsapp ──
const waHtml = renderBlock({ type: 'whatsapp', id: 'w1', data: FIXTURES.whatsapp }, 'rtl');
check('whatsapp render: styled CTA (pill + glyph + label + note), not a plain button',
  /class="bent-whatsapp/.test(waHtml) && /bent-wa-icon/.test(waHtml) && /<svg/.test(waHtml)
  && /bent-wa-label">דברו איתנו בוואטסאפ</.test(waHtml) && /bent-wa-note">מענה תוך דקות</.test(waHtml)
  && !/class="btn/.test(waHtml));
check('whatsapp render: wa.me href with the message encoded, opens a new tab',
  /href="https:\/\/wa\.me\/972501234567\?text=%D7%A9%D7%9C%D7%95%D7%9D/.test(waHtml)
  && /target="_blank"/.test(waHtml) && /rel="noopener noreferrer"/.test(waHtml));
check('whatsapp render: align rides the universal style slot', /text-align:center/.test(waHtml));
check('whatsapp render: Israeli local number → 972 international', /wa\.me\/972501234567/.test(renderBlock({
  type: 'whatsapp', id: 'w2', data: { phone: '050-1234567' }
}, 'rtl')));
check('whatsapp render: url fallback for phone-less links (wa.me/message, groups)',
  /href="https:\/\/chat\.whatsapp\.com\/ABC"/.test(renderBlock({ type: 'whatsapp', id: 'w3', data: { url: 'https://chat.whatsapp.com/ABC' } }, 'rtl')));
check('whatsapp render: javascript: url is refused, label XSS-escaped', (() => {
  const h = renderBlock({ type: 'whatsapp', id: 'w4', data: { url: 'javascript:alert(1)', label: '<b>x</b>' } }, 'rtl');
  return /href="#"/.test(h) && /&lt;b&gt;/.test(h) && !/<b>x/.test(h);
})());
check('whatsapp render: empty label falls back to the Hebrew default', /דברו איתנו בוואטסאפ/.test(renderBlock({
  type: 'whatsapp', id: 'w5', data: { phone: '972501234567' }
}, 'rtl')));

// the link parser (shared by renderer + decompiler)
check('parseWhatsappHref: wa.me/<digits>?text=', (() => {
  const p = parseWhatsappHref('https://wa.me/972501234567?text=%D7%A9%D7%9C%D7%95%D7%9D');
  return p && p.phone === '972501234567' && p.message === 'שלום';
})());
check('parseWhatsappHref: api.whatsapp.com/send?phone=&text=', (() => {
  const p = parseWhatsappHref('https://api.whatsapp.com/send?phone=+972-50-1234567&text=hi+there');
  return p && p.phone === '972501234567' && p.message === 'hi there';
})());
check('parseWhatsappHref: wa.me/message/<code> keeps the url (no phone to invent)', (() => {
  const p = parseWhatsappHref('https://wa.me/message/ABCDEF');
  return p && !p.phone && p.url === 'https://wa.me/message/ABCDEF';
})());
check('parseWhatsappHref: non-WhatsApp links are null', parseWhatsappHref('https://example.com/wa.me-guide') === null
  && parseWhatsappHref('https://whatsapp-tips.co.il') === null && parseWhatsappHref('/contact') === null);
check('phoneDigits: 00-prefix dropped, too-short refused', phoneDigits('00 972 50 1234567') === '972501234567' && phoneDigits('12') === '');
check('whatsappHref: no phone and no url → #', whatsappHref({}) === '#');

// ── legacy BentML (line dialect) round-trips ──
const legacy = bentml.compile(`BENTML 0.2

META {
  title: "כרום"
}

HEADER(tone: dark) {
  IMAGE(src: "/uploads/logo.svg", alt: "לוגו")
  NAV {
    NAVITEM(url: "/") { בית }
    NAVITEM(url: "/about") { אודות }
  }
  WHATSAPP(phone: "972501234567", message: "שלום", note: "מענה מהיר") { דברו איתנו }
}

TEXT { גוף הדף }

FOOTER(tone: light, credit: "© 2026") {
  TEXT { תחתית }
}
`);
const lTypes = legacy.blocks.map((b) => b.type);
check('legacy compiles HEADER / FOOTER / WHATSAPP', lTypes.join(',') === 'header,text,footer');
const lHd = legacy.blocks.find((b) => b.type === 'header');
check('legacy HEADER: tone + nested image/nav/whatsapp', lHd.data.tone === 'dark' && lHd.data.layout === 'row'
  && lHd.data.blocks.map((b) => b.type).join(',') === 'image,nav,whatsapp'
  && lHd.data.blocks[2].data.phone === '972501234567' && lHd.data.blocks[2].data.label === 'דברו איתנו');
const lFt = legacy.blocks.find((b) => b.type === 'footer');
check('legacy FOOTER: tone + credit + nested text', lFt.data.tone === 'light' && lFt.data.credit === '© 2026' && lFt.data.blocks[0].type === 'text');

const src = bentml.decompile({ title: 'x' }, Object.entries(FIXTURES).map(([type, data], n) => ({ type, id: type + '_' + n, data })));
check('legacy decompile writes the new keywords', /^HEADER\(tone: dark\) \{/m.test(src) && /^FOOTER\(tone: light, credit: "© 2026 כל הזכויות שמורות"\) \{/m.test(src)
  && /^WHATSAPP\(phone: "972501234567", message: "שלום, אשמח לפרטים", note: "מענה תוך דקות", align: center\) \{ דברו איתנו בוואטסאפ \}/m.test(src));
const round = bentml.compile(src);
check('legacy decompile → recompile keeps all three (nested blocks included)',
  round.blocks.map((b) => b.type).join(',') === 'header,footer,whatsapp'
  && round.blocks[0].data.blocks.length === 3 && round.blocks[1].data.blocks.length === 2);

// ── the decompiler maps what used to be a refused landmark ──
const SITE_HEADER = `
<header class="site-header" role="banner">
  <div class="header-inner">
    <a class="logo" href="/"><img src="/img/logo.svg" alt="וואלה"></a>
    <nav class="main-nav"><ul>
      <li><a href="/news">חדשות</a></li><li><a href="/sport">ספורט</a></li><li><a href="/tech">טכנולוגיה</a></li><li><a href="/food">אוכל</a></li>
    </ul></nav>
    <a class="btn" href="https://wa.me/972501234567?text=%D7%A9%D7%9C%D7%95%D7%9D">דברו איתנו</a>
  </div>
</header>`;
const SITE_FOOTER = `
<footer id="footer" class="site-footer">
  <div class="row">
    <div class="col-md-4"><h4>אודות</h4><ul><li><a href="/about">מי אנחנו</a></li><li><a href="/team">הצוות</a></li></ul></div>
    <div class="col-md-4"><h4>שירות</h4><ul><li><a href="/contact">צור קשר</a></li><li><a href="/faq">שאלות</a></li></ul></div>
    <div class="col-md-4"><div class="social-icons"><a href="https://facebook.com/x">פייסבוק</a><a href="https://instagram.com/x">אינסטגרם</a></div></div>
  </div>
  <p class="copyright">© 2026 כל הזכויות שמורות למסעדה</p>
</footer>`;

for (const [lens, run] of [['flat', htmlToBlocks], ['hunt', huntBlocks]]) {
  const h = run(SITE_HEADER);
  const hd = firstOf(h, 'header');
  check(`${lens}: <header class="site-header"> → header module with logo + nav + whatsapp inside (was: toolGap)`,
    h.blocks.length === 1 && !!hd && hd.data.blocks.map((b) => b.type).join(',') === 'image,nav,whatsapp'
    && hd.data.blocks[1].data.items.length === 4 && hd.data.blocks[2].data.phone === '972501234567');
  check(`${lens}: header + whatsapp no longer on toolGap`, !h.suggestedTools.includes('header') && !h.suggestedTools.includes('whatsapp'));

  const f = run(SITE_FOOTER);
  const ft = firstOf(f, 'footer');
  check(`${lens}: <footer class="site-footer"> → footer module (was: toolGap)`, f.blocks.length === 1 && !!ft && !f.suggestedTools.includes('footer'));
  check(`${lens}: footer copyright line lifted into credit`, ft && ft.data.credit === '© 2026 כל הזכויות שמורות למסעדה'
    && !flat(ft.data.blocks).some((b) => b.type === 'text' && /©/.test(b.data.content || '')));
  check(`${lens}: footer link lists stay LINKS (nav), not a text list`,
    ft && flat(ft.data.blocks).filter((b) => b.type === 'nav').length === 2
    && !flat(ft.data.blocks).some((b) => b.type === 'list')
    && flat(ft.data.blocks).some((b) => b.type === 'social'));
}
const hunted = huntBlocks(SITE_FOOTER);
check('hunt: the footer row keeps its columns cut INSIDE the band',
  hunted.blocks[0].data.blocks[0].type === 'columns' && hunted.blocks[0].data.blocks[0].data.columns.length === 3);

// landmark spellings: bare <header>, id/class tokens, ARIA roles
check('flat: bare <header> / <footer> tags map', (() => {
  const r = htmlToBlocks('<header><h1>לוגו</h1><a href="/">בית</a><a href="/x">עוד</a></header><footer><p>תחתית</p></footer>');
  return r.blocks.map((b) => b.type).join(',') === 'header,footer' && r.suggestedTools.length === 0;
})());
check('flat: <div id="header"> / <div class="footer-wrap"> map (old Israeli sites)', (() => {
  const r = htmlToBlocks('<div id="header"><img src="/l.png" alt="לוגו"></div><div class="footer-wrap"><p>© 2026</p></div>');
  return r.blocks.map((b) => b.type).join(',') === 'header,footer' && r.blocks[1].data.credit === '© 2026';
})());
check('flat: role="banner" / role="contentinfo" map', (() => {
  const r = htmlToBlocks('<div role="banner"><h1>לוגו</h1></div><div role="contentinfo"><p>תחתית</p></div>');
  return r.blocks.map((b) => b.type).join(',') === 'header,footer';
})());
check('flat: card-header / entry-header are NOT the page chrome', (() => {
  const r = htmlToBlocks('<div class="card-header"><h3>כותרת כרטיס</h3></div><div class="entry-header"><h2>כותרת רשומה</h2></div>');
  return !flat(r.blocks).some((b) => b.type === 'header') && r.blocks.filter((b) => b.type === 'heading').length === 2;
})());

// nesting + twins: header-in-header markup is ONE band; the mobile twin dedupes against it
const twins = huntBlocks(`
  <header class="desktop"><div class="header"><h1>לוגו</h1><nav><a href="/">בית</a><a href="/x">עוד</a></nav></div></header>
  <div class="mobile-menu"><h1>לוגו</h1><nav><a href="/">בית</a><a href="/x">עוד</a></nav></div>`);
check('hunt: nested header markup → exactly ONE header band; mobile twin deduped against its children',
  twins.blocks.length === 1 && twins.blocks[0].type === 'header'
  && flat(twins.blocks).filter((b) => b.type === 'header').length === 1
  && flat(twins.blocks).filter((b) => b.type === 'heading').length === 1);
check('flat: nested header markup → exactly ONE header band, no nested toolGap', (() => {
  const r = htmlToBlocks('<header class="site-header"><div class="header"><h1>לוגו</h1></div></header>');
  return flat(r.blocks).filter((b) => b.type === 'header').length === 1 && r.suggestedTools.length === 0;
})());

// nothing lost: a band too rich to read keeps the html AND still reports
const rich = htmlToBlocks('<header><table><tr><td><img src="/x.png"></td></tr></table><h1>לוגו</h1></header>');
check('a header with structure we cannot read keeps provisional html INSIDE the band AND still reports header (rich-table rule)',
  rich.blocks.length === 1 && rich.blocks[0].type === 'header'
  && rich.blocks[0].data.blocks.some((b) => b.type === 'html' && /<table/.test(b.data.content))
  && rich.blocks[0].data.blocks.some((b) => b.type === 'heading')
  && rich.suggestedTools.includes('header'));
check('an empty (script-only) landmark is dropped without noise', (() => {
  const r = htmlToBlocks('<header><script>app()</script></header><p>x</p>');
  return !r.blocks.some((b) => b.type === 'header') && !r.suggestedTools.includes('header');
})());

// whatsapp spellings — every one maps, none suggests
const waMix = htmlToBlocks(`
  <a href="https://api.whatsapp.com/send?phone=972501234567&text=hi+there">ווטסאפ</a>
  <a href="https://wa.me/message/ABCDEF" aria-label="WhatsApp"><img src="/wa.png"></a>
  <a href="whatsapp://send?phone=972501234567"></a>
  <a href="https://web.whatsapp.com/send?phone=0501234567">צ׳אט</a>`);
check('flat: every WhatsApp spelling → whatsapp module (api./web./whatsapp:// and icon-only links)',
  waMix.blocks.filter((b) => b.type === 'whatsapp').length === 4
  && waMix.blocks[0].data.message === 'hi there' && waMix.blocks[1].data.url === 'https://wa.me/message/ABCDEF'
  && waMix.blocks[1].data.label === 'WhatsApp' && waMix.blocks[2].data.label === 'דברו איתנו בוואטסאפ'
  && waMix.blocks[3].data.phone === '972501234567');
check('flat: whatsapp no longer on toolGap', !waMix.suggestedTools.includes('whatsapp'));
check('a wa.me handle inside a social strip stays a social handle (no double module)', (() => {
  const r = htmlToBlocks('<div class="social-icons"><a href="https://facebook.com/x">פייסבוק</a><a href="https://wa.me/972501234567">וואטסאפ</a></div>');
  return r.blocks.length === 1 && r.blocks[0].type === 'social' && r.blocks[0].data.items[1].network === 'whatsapp';
})());

// ── the whole page: the mako/walla-style body decompiles to a valid .pzn with the gaps gone ──
const page = decompileHtml(`<!DOCTYPE html><html lang="he" dir="rtl"><head><title>אתר</title></head><body>
${SITE_HEADER}
<div class="content"><h1>כותרת</h1><p>גוף הדף</p></div>
${SITE_FOOTER}
</body></html>`);
check('whole-page decompile: header + footer modules bracket the content', page.blocks[0].type === 'header'
  && page.blocks[page.blocks.length - 1].type === 'footer');
check('whole-page decompile: header/footer/whatsapp are gone from toolGap',
  !page.toolGap.includes('header') && !page.toolGap.includes('footer') && !page.toolGap.includes('whatsapp'));
check('whole-page decompile: source validates clean and round-trips the bands', (() => {
  try {
    const doc = pzn.parse(page.source);
    if (pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length) return false;
    const rt = pzn.toTapuzPage(doc).blocks;
    return rt[0].type === 'header' && rt[0].data.blocks.length === 3 && rt[rt.length - 1].type === 'footer';
  } catch (e) { return false; }
})());

console.log('');
console.log(fail ? 'SMOKE GAP-CHROME: FAIL' : 'SMOKE GAP-CHROME: PASS');
process.exit(fail ? 1 : 0);
