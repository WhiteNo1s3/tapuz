'use strict';

/**
 * v0.77 QA gate — BenTML is real, everywhere.
 *
 * 1. The browser engine bundle builds and runs in a BARE context (no require/
 *    module/process) — proves the compiler chain stays dependency-free.
 * 2. Bundle output is byte-identical to the server compiler (one language,
 *    not two dialects drifting).
 * 3. decompile(withMap) returns the same source as decompile() plus correct
 *    1-based line ranges for every top-level block (the builder⇄source dance
 *    depends on these being true).
 * 4. FULL VOCABULARY: every block type in src/block-registry.js decompiles to
 *    real BenTML (never an "unknown block type" comment) and compiles back to
 *    the same type — so live-apply can never silently drop a block.
 *
 * Exit 1 on any failure.
 */

const vm = require('vm');
const { buildBentmlEngine } = require('../src/bentml/browser-bundle');
const { compile } = require('../src/bentml/compile');
const { decompile, decompileBlock } = require('../src/bentml/decompile');
const { BLOCK_REGISTRY } = require('../src/block-registry');

let failures = 0;
function ok(label) { console.log('OK   ' + label); }
function fail(label, detail) {
  console.log('FAIL ' + label + (detail ? ' — ' + detail : ''));
  failures++;
}

// ── 1+2: the bundle runs bare and matches the server compiler ──
const SAMPLE = [
  'BENTML 0.1',
  '',
  'META {',
  '  title: "בדיקת מנוע"',
  '}',
  '',
  'HEADING(level: 1) { שלום }',
  '',
  'TEXT { עולם עם @B{הדגשה} ועם @LINK(url: "/x"){קישור} }',
  ''
].join('\n');

try {
  const js = buildBentmlEngine();
  const window = {};
  vm.runInNewContext(js, { window }); // deliberately bare
  const E = window.BentmlEngine;
  if (!E || typeof E.compile !== 'function' || typeof E.decompile !== 'function') {
    fail('engine exposes compile/decompile');
  } else {
    ok('engine bundle runs in a bare context (' + (js.length / 1024).toFixed(0) + ' KB)');

    const strip = (blocks) => JSON.stringify(blocks.map((b) => ({ t: b.type, d: b.data })));
    const browserOut = E.compile(SAMPLE);
    const serverOut = compile(SAMPLE);
    if (strip(browserOut.blocks) === strip(serverOut.blocks)) ok('browser compile ≡ server compile');
    else fail('browser compile ≡ server compile', 'outputs differ');

    try {
      E.compile('BENTML 0.1\n\nMETA { title: "x" }\n\nTEXTX { y }');
      fail('engine error shape', 'unknown keyword did not throw');
    } catch (e) {
      if (e.code === 'E201' && e.line === 5 && e.fix) ok('engine errors carry code/line/fix');
      else fail('engine errors carry code/line/fix', JSON.stringify({ code: e.code, line: e.line }));
    }
  }
} catch (e) {
  fail('engine bundle builds/runs', e.message);
}

// ── 3: decompile map is true ──
const mapPage = { title: 'מפה' };
const mapBlocks = [
  { type: 'heading', id: 'heading_1_a', data: { level: 1, text: 'ראש' } },
  {
    type: 'columns', id: 'columns_1_b',
    data: { columns: [{ blocks: [{ type: 'text', id: 'text_1_c', data: { content: 'ימין' } }] }, { blocks: [] }] }
  },
  { type: 'text', id: 'text_1_d', data: { content: 'פסקה\n\nשנייה' } }
];
const plain = decompile(mapPage, mapBlocks);
const withMap = decompile(mapPage, mapBlocks, { withMap: true });
if (plain === withMap.source) ok('decompile(withMap) source identical');
else fail('decompile(withMap) source identical');
{
  const lines = withMap.source.split('\n');
  let mapOk = withMap.map.length === mapBlocks.length;
  for (let i = 0; i < withMap.map.length; i++) {
    const m = withMap.map[i];
    if (m.id !== mapBlocks[i].id) mapOk = false;
    const first = (lines[m.start - 1] || '').trim();
    if (!/^[A-Z]/.test(first)) mapOk = false; // range starts on the keyword line
    if (m.end < m.start || m.end > lines.length) mapOk = false;
  }
  if (mapOk) ok('map ranges start on keyword lines, ids in order');
  else fail('map ranges', JSON.stringify(withMap.map));
}

// ── 4: the full vocabulary round-trips ──
const canon = (v) => Array.isArray(v)
  ? v.map(canon)
  : (v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
    : v);

// realistic data per type — the seed shape the builder itself creates
const VOCAB_DATA = {
  heading: { level: 2, text: 'כותרת' },
  text: { content: 'פסקה' },
  image: { src: '/uploads/a.jpg', alt: 'תמונה' },
  button: { text: 'לחצו', url: '/x', variant: 'primary' },
  columns: { columns: [{ blocks: [] }, { blocks: [] }], gap: 'md', collapse: 'md', valign: 'top' },
  spacer: { size: 'lg' },
  html: { content: '<div class="custom"><p>raw</p></div>' },
  divider: { bentStyle: 'dots' },
  list: { ordered: false, items: [{ text: 'פריט' }] },
  quote: { text: 'ציטוט', author: 'מישהו' },
  card: { blocks: [] },
  section: { blocks: [], size: 'lg' },
  hero: { title: 'גיבור', subtitle: 'משנה', buttonText: 'קדימה', buttonUrl: '/go' },
  testimonial: { quote: 'מעולה', author: 'לקוחה', role: 'בעלים' },
  gallery: { images: [{ src: '/uploads/a.jpg', alt: 'א' }], columns: 2 },
  features: { items: [{ title: 'מהיר', icon: '⚡', description: 'תיאור' }], columns: 3 },
  embed: { url: 'https://youtu.be/abc' },
  'article-list': { tag: 'בלוג', limit: 3, columns: 3 },
  map: { address: 'תל אביב', zoom: 15, height: 'md' },
  cta: { title: 'קריאה', text: '', buttonText: 'לפרטים', url: '/x', variant: 'primary', tone: 'brand', align: 'start' },
  stats: { columns: 3, items: [{ value: '120', label: 'לקוחות' }] },
  logos: { items: [{ src: '/uploads/logo.svg', alt: 'לוגו' }] },
  social: { items: [{ network: 'instagram', url: 'https://instagram.com/x', label: 'Instagram' }] },
  faq: { items: [{ question: 'כמה?', answer: 'חינם.' }] },
  'contact-info': { phone: '03-1234567', email: 'a@b.co' },
  banner: { text: 'הודעה', tone: 'brand', align: 'start' },
  marquee: { text: 'נע' },
  parallax: { image: '/uploads/bg.jpg', blocks: [] },
  tabs: { items: [{ label: 'א', content: 'תוכן' }] },
  accordion: { items: [{ title: 'ב', content: 'תוכן' }] },
  form: {
    action: '/api', method: 'post', submit: 'שליחה',
    fields: [{ label: 'שם', name: 'name', required: true }, { label: 'נושא', name: 't', type: 'select', options: ['א', 'ב'] }]
  },
  cards: { items: [{ title: 'כרטיס', image: '/uploads/a.jpg', tag: 'תג', excerpt: 'תקציר', href: '/a' }] },
  carousel: { height: 'lg', peek: false, items: [{ title: 'שקופית', image: '/uploads/s.jpg', excerpt: 'תקציר', href: '/s' }] },
  nav: { items: [{ label: 'בית', href: '/' }], background: '#111', color: '#fff', align: 'center' },
  ticker: { label: 'מבזק', speed: 'fast', items: [{ text: 'ידיעה', href: '/n' }] },
  newspop: { label: 'מבזקים', items: [{ time: '12:00', text: 'עדכון', href: '/u' }] },
  video: { src: '/uploads/clip.mp4', controls: true },
  audio: { src: '/uploads/episode.mp3', caption: 'פרק 1', loop: false },
  table: { header: true, rows: [{ cells: 'יום | שעות' }, { cells: 'ראשון | 9:00–17:00' }] },
  category: { slug: 'ספורט', limit: 6, showheader: true },
  pricing: { items: [{ title: 'מקצועי', price: '99', period: '/חודש', features: 'תכונה\nעוד תכונה', ctaLabel: 'התחילו', ctaUrl: '/signup', highlighted: true }] },
  steps: { items: [{ title: 'מתארים', text: 'מה האתר צריך.' }, { title: 'בונים', text: 'מודולים על הקנבס.' }] },
  timeline: { items: [{ time: '2024', title: 'ההתחלה', text: 'פתחנו.' }, { time: '2026', title: 'היום', text: 'ממשיכים.', image: '/uploads/now.jpg' }] },
  crumbs: { items: [{ label: 'בית', url: '/' }, { label: 'הדף הזה' }] },
  social: { items: [{ network: 'facebook', url: 'https://facebook.com/tapuz', label: 'פייסבוק' }, { network: 'instagram', url: 'https://instagram.com/tapuz' }] },
  team: { items: [{ name: 'דנה לוי', role: 'מנכ"לית', image: '/uploads/dana.jpg', bio: 'מובילה מהיום הראשון.' }, { name: 'יוסי כהן', role: 'סמנכ"ל' }] },
  countdown: { target: '2027-01-01T00:00', label: 'עד סוף המבצע', done: 'המבצע הסתיים' },
  pricelist: { items: [{ name: 'חומוס מלא', price: '32 ₪', desc: 'עם פטריות' }, { name: 'שקשוקה', price: '44 ₪' }] },
  progress: { items: [{ label: 'עיצוב', value: 90 }, { label: 'פיתוח', value: 75, color: '#38bdf8' }] },
  rating: { value: 4.5, max: 5, text: '4.5 מתוך 5 — 213 ביקורות' },
  hours: { items: [{ day: 'ראשון–חמישי', hours: '9:00–19:00' }, { day: 'שבת', hours: 'סגור' }] },
  toc: { title: 'תוכן עניינים', items: [{ label: 'הקדמה', anchor: '#intro' }, { label: 'שאלות', anchor: '#faq' }] },
  author: { name: 'דנה לוי', image: '/uploads/dana.jpg', bio: 'כותבת על טכנולוגיה.', url: '/author/dana', linkLabel: 'לכל הכתבות' },
  compare: { before: '/uploads/before.jpg', after: '/uploads/after.jpg', beforeLabel: 'לפני', afterLabel: 'אחרי' },
  flipbox: { title: 'אחריות מלאה', icon: '🛡️', backText: 'שלוש שנות אחריות.', buttonText: 'לפרטים', buttonUrl: '/warranty' },
  header: { tone: 'dark', layout: 'row', blocks: [{ type: 'image', id: 'image_1', data: { src: '/uploads/logo.svg', alt: 'לוגו' } }, { type: 'nav', id: 'nav_1', data: { items: [{ label: 'בית', href: '/' }] } }] },
  footer: { tone: 'dark', credit: '© 2026 כל הזכויות שמורות', blocks: [{ type: 'text', id: 'text_1', data: { content: 'תחתית' } }] },
  whatsapp: { label: 'דברו איתנו בוואטסאפ', phone: '972501234567', message: 'שלום, אשמח לפרטים', note: 'מענה תוך דקות' },
  products: { columns: 3, items: [{ title: 'מוצר', price: '₪99', image: '/demo/tile-1.svg', url: '/p/1' }] },
  code: { lang: 'css', source: '.hero { color: inherit; }' },
  tags: { items: [{ label: 'עיצוב', url: '/tag/design' }, { label: 'קוד', url: '/tag/code' }] },
  search: { placeholder: 'חיפוש…', action: '/search', name: 'q', submit: 'חיפוש' },
  newsletter: { title: 'הישארו מעודכנים', text: 'קבלו עדכונים למייל.', placeholder: 'האימייל שלכם', submit: 'הרשמה', action: '/api/form' },
  pager: { items: [{ label: '1', url: '/p/1' }, { label: '2' }] },
  consent: { text: 'אתר זה משתמש בעוגיות.', accept: 'אישור', reject: 'סירוב', policy: '/privacy', policyLabel: 'מדיניות פרטיות' },
  related: { title: 'כתבות נוספות', items: [{ title: 'כתבה', excerpt: 'תקציר', href: '/a' }] },
  comments: { title: 'תגובות', items: [{ author: 'דנה', time: 'אתמול', text: 'כתבה מצוינת.' }] },
  slot: { label: 'פרסומת', src: '/demo/tile-1.svg', url: '/ad', advertiser: 'מותג' },
  auth: { login: 'כניסה', loginurl: '/login', register: 'הרשמה', registerurl: '/signup' }
};

// types the language deliberately folds into another keyword's JSON
const TYPE_FOLDS = { marquee: 'marquee', parallax: 'parallax' };

let vocabFails = 0;
for (const entry of BLOCK_REGISTRY) {
  const type = entry.type;
  const data = VOCAB_DATA[type];
  if (!data) {
    fail('vocabulary covers ' + type, 'no fixture — add one to VOCAB_DATA');
    vocabFails++;
    continue;
  }
  const block = { type, id: type.replace(/[^a-z]/g, '') + '_1_zz', data };
  const src = decompileBlock(block, 0);
  if (src.indexOf('unknown block type') !== -1) {
    fail('decompile covers ' + type, 'emits unknown-type comment');
    vocabFails++;
    continue;
  }
  const doc = 'BENTML 0.2\n\nMETA {\n  title: "x"\n}\n\n' + src + '\n';
  let out;
  try {
    out = compile(doc);
  } catch (e) {
    fail('compile accepts decompiled ' + type, e.code + ': ' + e.message);
    vocabFails++;
    continue;
  }
  const back = out.blocks[0];
  const expectType = TYPE_FOLDS[type] || type;
  if (!back || back.type !== expectType) {
    fail('round-trip type ' + type, '→ ' + (back && back.type));
    vocabFails++;
  }
}
if (!vocabFails) ok('full vocabulary round-trips: ' + BLOCK_REGISTRY.length + ' types');

console.log('');
if (failures) {
  console.log('SMOKE BENTML-ENGINE: FAIL (' + failures + ')');
  process.exit(1);
}
console.log('SMOKE BENTML-ENGINE: PASS');
