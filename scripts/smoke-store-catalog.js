'use strict';

/**
 * v2.69 QA — the catalog model, its <bent-store> document, and CSV.
 *
 * What it holds the store to:
 *   schema     the new columns are on a fresh database AND on an upgraded
 *              2.68 one (same columns, same order, data intact); opening it
 *              again changes nothing
 *   shelves    categories: one level of nesting and every refusal in
 *              Hebrew; a save that sends only a name wipes nothing; order,
 *              depth and the three counts; delete moves products
 *   products   every new field's validation; tags; the strict whole-number
 *              reader; filters, sorts, bulk actions; the shopper's view never
 *              carries the owner's cost
 *   document   every new attribute round-trips byte for byte; a 2.68
 *              document still applies exactly as it did; a merge keeps what
 *              it does not mention, a whole document clears it; `cost` is
 *              never in a document and never moved by one
 *   integrity  the store's own export always comes back (long tags, line
 *              breaks, curly quotes, 500+ products, 400,000+ characters); a
 *              backup is checked before the apply it protects; a SKU of
 *              digits is a SKU, not a row number
 *   CSV        export → import is lossless and lands through the document
 *              door; other shops' headers and Hebrew headers map; formula
 *              cells are guarded; a bad row is named by its line
 *   undo       a backup also keeps what its document leaves unsaid — rules
 *              at their defaults, an empty name, empty lists, the coupons —
 *              and an undo or a restore puts exactly that state back
 *
 * Run: node scripts/smoke-store-catalog.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-store-catalog-'));
process.env.TAPUZ_ROOT = ROOT;

// The throwaway root has no site, and the store rebuilds the site after
// every apply — the exporter's "no published pages" notice is expected here.
const realWarn = console.warn;
console.warn = (...a) => { if (!/^\[export\] no published pages/.test(String(a[0]))) realWarn(...a); };

let failed = 0;
function ok(cond, label) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + label);
  if (!cond) failed++;
}
function throws(fn, re) {
  try { fn(); } catch (e) { return re.test(String(e && e.message)); }
  return false;
}

const Database = require('better-sqlite3');
const { db } = require('../src/db');
const { initializeStore, STORE_TABLES } = require('../src/store/schema');
const store = require('../src/store');
const { catalog, settings, document: doc } = store;
const dialect = require('../src/bentml/store-dialect');
const csvIo = require('../src/store/csv-io');
const SRC = path.join(__dirname, '..', 'src');

// The 2.68 shapes of the three tables v2.69 adds columns to.
const TABLES_268 = `
  CREATE TABLE store_shelves (
    slug TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE store_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL DEFAULT 0,
    compare_at INTEGER,
    stock INTEGER,
    images TEXT NOT NULL DEFAULT '[]',
    shelf TEXT NOT NULL DEFAULT '',
    badge TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'hidden', 'draft')),
    delivery INTEGER NOT NULL DEFAULT 1,
    max_per_order INTEGER,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE store_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'new'
      CHECK(status IN ('new', 'processing', 'shipped', 'completed', 'cancelled')),
    paid_at TEXT,
    payment_method TEXT NOT NULL DEFAULT '',
    payment_label TEXT NOT NULL DEFAULT '',
    shipping_method TEXT NOT NULL DEFAULT '',
    shipping_label TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'ILS',
    subtotal INTEGER NOT NULL DEFAULT 0,
    discount INTEGER NOT NULL DEFAULT 0,
    shipping INTEGER NOT NULL DEFAULT 0,
    vat INTEGER NOT NULL DEFAULT 0,
    vat_rate REAL NOT NULL DEFAULT 0,
    vat_included INTEGER NOT NULL DEFAULT 1,
    total INTEGER NOT NULL DEFAULT 0,
    coupon TEXT NOT NULL DEFAULT '',
    customer_name TEXT NOT NULL DEFAULT '',
    customer_email TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '{}',
    note TEXT NOT NULL DEFAULT '',
    admin_note TEXT NOT NULL DEFAULT '',
    tracking TEXT NOT NULL DEFAULT '',
    contact_id INTEGER,
    erased INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;

// The demo shop's document exactly as 2.68 shipped it (frozen here: the
// seed may grow, this is the proof that an OLD document still lands the same).
const DEMO_268 = `
<bent-store version="1" name="חנות הדברים שאינם" currency="ILS">
  <bent-store-rules vat="18" vat-included="true" thanks="תודה. זו הדגמה: אם אישרתם בארגז החול, לא עבר כסף." />
  <bent-shelf id="small" label="דברים קטנים" />
  <bent-shelf id="huge" label="דברים גדולים מדי" />
  <bent-shelf id="quiet" label="שקט" />
  <bent-sku id="left-sock" title="גרב שמאלית יחידה, חגיגית" price="0.13" was="40" stock="40"
            shelf="small" image="/assets/demo-left-sock.svg" badge="כמעט חינם" summary="שמאל בלבד. הימנית יצאה לטיול.">
    גרב אחת, רקומה בחוט שלא קיים, לאירועים שבהם מספיק רגל אחת.

    מגיעה בקופסה גדולה מהגרב.
  </bent-sku>
  <bent-sku id="named-cloud" title="עננה עם שם פרטי" price="1000001" stock="2"
            shelf="huge" image="/assets/demo-named-cloud.svg" badge="מוגזם" summary="השם נבחר אחרי התשלום, בארגז החול.">
    עננה קטנה שמרחפת מעל השולחן ומסרבת להוריד גשם בתוך הבית.

    המחיר עגול בכוונה, ועוד שקל, כדי שאי אפשר יהיה להתעלם ממנו.
  </bent-sku>
  <bent-sku id="mountain-air" title="שקית אוויר הררית, ריקה" price="4.20" stock="80"
            shelf="small" image="/assets/demo-mountain-air.svg" summary="נארזה בפסגה. נפתחה בדרך למטה.">
    שקית נייר ובה הרוח שהייתה אמורה להישאר בהר.

    אם שומעים משהו כשפותחים — זו הייתה משלוח של מישהו אחר.
  </bent-sku>
  <bent-sku id="pet-stone" title="אבן מחמד מאולפת למחצה" price="42000" stock="6"
            shelf="huge" image="/assets/demo-pet-stone.svg" badge="רגועה" summary="יושבת. זה כל התרגיל.">
    אבן חלקה שלמדה לשבת בלי לזוז, ומתמידה בזה כבר כמה עידנים.

    אוכל לא כלול, כי היא לא אוכלת.
  </bent-sku>
  <bent-sku id="bottled-quiet" title="דממה בבקבוק, 500 מ״ל" price="777777.77" stock="3"
            shelf="quiet" image="/assets/demo-bottled-quiet.svg" badge="שקט" summary="לנער בעדינות. לא לשמוע כלום.">
    חצי ליטר של שקט שנאסף בחדר אחרי שכולם יצאו.

    הפקק נשאר סגור. זה כל המוצר.
  </bent-sku>
  <bent-sku id="blank-card" title="כרטיס ביקור לבן משני הצדדים" price="0.50" stock="500"
            shelf="small" image="/assets/demo-blank-card.svg" summary="השם שלכם לא מופיע, וגם לא שלנו.">
    כרטיס עבה, נקי, בלי אות. מתאים למי שכבר אמרו הכול.

    אין לוגו, אין טלפון, אין כתובת אתר.
  </bent-sku>
  <bent-sku id="chair-manual" title="הוראות הרכבה לכיסא שכבר הורכב" price="999.99" was="1000000" stock="1"
            shelf="quiet" image="/assets/demo-chair-manual.svg" badge="מאוחר" summary="שלב 1: לשבת. אין שלב 2.">
    חוברת מסודרת לכיסא שעומד בחדר ומחכה שלא יפרקו אותו בטעות.

    הציורים מקדימים את הברגים.
  </bent-sku>
  <bent-sku id="nowhere-map" title="מפה אל מקום שלא קיים" price="15" stock="0"
            shelf="quiet" image="/assets/demo-nowhere-map.svg" badge="אזל" summary="הקו מקווקו כי היעד לא הסכים.">
    מפה מצוירת ביד אל נקודה שהקרטוגרף מחק ברגע האחרון.

    אזלה, וזה מתאים לה: אי אפשר להגיע גם כשהיא במלאי.
  </bent-sku>
  <bent-ship id="pickup" label="איסוף מהמחסן הדמיוני" price="0" address="false" note="המחסן נמצא מאחורי הדלת שכבר פתחתם." />
  <bent-ship id="thought" label="משלוח על גבי מחשבה" price="250" free-over="500000" note="יוצא לדרך כשחושבים עליו חזק. כתובת כן נדרשת, בשביל הנימוס." />
  <bent-pay id="paypal" kind="paypal" label="PayPal — ארגז חול">כפתור הבדיקה של PayPal. לא נגבה שקל אמיתי.</bent-pay>
  <bent-coupon code="HALFJOKE" percent="50" min="1" note="חצי הנחה על בדיחה שלמה" />
</bent-store>
`.trim();

/** Apply a document on a second, empty install (its own process, its own root) and report what it holds. */
function onAnotherInstall(text, applyOpts) {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-store-catalog-b-'));
  const file = path.join(other, 'in.bent');
  fs.writeFileSync(file, text, 'utf8');
  const script = `
    const store = require(${JSON.stringify(path.join(SRC, 'store'))});
    const text = require('fs').readFileSync(process.argv[1], 'utf8');
    const r = store.document.applyDocument(text, ${JSON.stringify(applyOpts || {})});
    const exported = store.document.exportDocument();
    const again = store.document.planDocument(exported);
    process.stdout.write('\\n' + JSON.stringify({
      ok: r.ok, code: r.code || '', warnings: (r.warnings || []).map((w) => w.code),
      exported,
      products: store.catalog.listProducts({ status: 'all', limit: 100000 }).map((p) => ({ slug: p.slug, price: p.price, sort: p.sort, shelf: p.shelf, cost: p.cost })),
      shelves: store.catalog.listShelves().map((s) => s.slug),
      again: again.preview ? { added: again.preview.added.length, changed: again.preview.changed.length, hidden: again.preview.hidden.length, shelvesChanged: again.preview.shelvesChanged.length, settings: again.preview.settings.length } : null
    }));
  `;
  const run = spawnSync(process.execPath, ['-e', script, file], { env: { ...process.env, TAPUZ_ROOT: other }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(run.stdout.trim().split('\n').pop()); } catch (e) { return { raw: run.stdout + run.stderr }; }
}

/**
 * Run `facts(SRC)` on one more empty install (its own process, its own
 * root) and hand back the flat facts it reports. The function is sent as
 * text, so it can use nothing from this file but its one argument; a fact
 * that threw is the string "threw: …", never a crash of the whole smoke.
 */
function onFreshInstall(facts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-store-catalog-c-'));
  const env = { ...process.env, TAPUZ_ROOT: root };
  // an armed demo seed is one of the things under test
  delete env.TAPUZ_DEMO_STORE;
  const script = `process.stdout.write('\\n' + JSON.stringify((${facts.toString()})(${JSON.stringify(SRC)})));`;
  const run = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(run.stdout.trim().split('\n').pop()); } catch (e) { return { raw: run.stdout + run.stderr }; }
}

/** The AI catalog writer on a store too big for its prompt: 90 products that have everything a view can leave out. */
function aiWriterFacts(SRC) {
  const path = require('path');
  console.warn = () => {};
  const store = require(path.join(SRC, 'store'));
  const pack = require(path.join(SRC, 'injections', 'store-catalog'));
  const { catalog, document: doc } = store;
  const out = {};
  const fact = (name, fn) => { try { out[name] = fn(); } catch (e) { out[name] = 'threw: ' + (e && e.message); } };

  const lines = [
    '<bent-store version="1" name="חנות גדולה" currency="ILS">',
    '  <bent-store-rules vat="18" vat-included="true" thanks="תודה שקניתם אצלנו. ההזמנה בדרך אליכם, ואנחנו כאן לכל שאלה." />',
    '  <bent-shelf id="home" label="לבית" image="/assets/home.webp" summary="כל מה שהבית צריך" seo-title="מוצרים לבית" seo-description="מבחר לבית" />',
    '  <bent-shelf id="kitchen" label="מטבח" parent="home" summary="כלים למטבח" />'
  ];
  for (let i = 1; i <= 90; i++) {
    lines.push(`  <bent-sku id="p-${i}" title="מוצר מספר ${i}" price="${10 + i}" stock="${i}" shelf="${i % 2 ? 'home' : 'kitchen'}" brand="מותג הבית" tags="בית, מתנה" barcode="72900${1000 + i}"` +
      ` weight="250" image="/assets/p-${i}.webp" images="/assets/p-${i}-b.webp /assets/p-${i}-c.webp" badge="חדש" summary="תקציר קצר של מוצר ${i}" seo-title="כותרת לגוגל ${i}" seo-description="תיאור לגוגל של מוצר ${i}">`,
    `    פסקה ראשונה של מוצר ${i}: נכתבה ביד, ואין לה עותק בשום מקום אחר.`, '', `    פסקה שנייה של מוצר ${i}.`, '  </bent-sku>');
  }
  lines.push('  <bent-ship id="pickup" label="איסוף עצמי" price="0" address="false" />', '  <bent-pay id="bank" kind="bank" label="העברה בנקאית">בנק לדוגמה, חשבון 12345</bent-pay>',
    '  <bent-coupon code="TEN" percent="10" />', '</bent-store>');
  fact('seeded', () => doc.applyDocument(lines.join('\n')).ok && catalog.countProducts().total);
  catalog.setCosts({ 'p-1': 7654321, 'p-2': 1234567 });

  const snap = () => JSON.stringify(catalog.listProducts({ status: 'all', sort: 'manual', limit: 100000 }).map((p) => [p.slug, p.title, p.price, p.stock, p.shelf, p.status, p.description, p.summary,
    p.images, p.brand, p.tags, p.barcode, p.weight, p.badge, p.seoTitle, p.seoDescription, p.cost]));
  const shelfSnap = () => JSON.stringify(catalog.listShelves().map((s) => [s.slug, s.label, s.parent, s.image, s.summary, s.seoTitle, s.seoDescription]));
  const before = snap();
  const shelvesBefore = shelfSnap();
  const media = Array.from({ length: 30 }, (_, i) => ({ url: `/assets/p-${i + 1}.webp`, alt: `מוצר מספר ${i + 1}` }));
  // "the store today" as the prompt prints it: the first <bent-store> after the first section line
  const viewOf = (text) => {
    const from = text.indexOf('<bent-store', text.indexOf('──'));
    return text.slice(from, text.indexOf('</bent-store>', from) + '</bent-store>'.length);
  };
  const codes = (planned) => (planned.warnings || []).map((w) => w.code + (w.hard ? '!' : '')).join(',');
  const lost = (planned) => planned.plan.products.filter((p) => {
    const ex = catalog.getProductBySlug(p.slug);
    return !!ex && (ex.description !== p.description || ex.summary !== p.summary || JSON.stringify(ex.images) !== JSON.stringify(p.images) ||
      ex.brand !== p.brand || JSON.stringify(ex.tags) !== JSON.stringify(p.tags) || ex.seoTitle !== p.seoTitle || ex.barcode !== p.barcode);
  }).length;

  for (const [key, size, locale] of [['he', 'lite', 'he'], ['en', 'lite', 'en'], ['full', 'full', 'he']]) {
    let built = null;
    let view = '';
    let echo = null;
    fact(key + 'Chars', () => { built = pack.buildPrompt({ brief: '', size, locale, ctx: { media } }); view = viewOf(built.text); return built.chars; });
    fact(key + 'Budget', () => built.meta.budget);
    fact(key + 'Degraded', () => built.meta.degraded.join(','));
    fact(key + 'Root', () => view.slice(0, view.indexOf('>') + 1));
    fact(key + 'Shown', () => (view.match(/<bent-sku /g) || []).length);
    fact(key + 'Says', () => /keep/.test(built.text.replace(view, '')) && /mode="merge"/.test(built.text.slice(built.text.lastIndexOf('──'))));
    // the products the view had no room for are counted in that line, not passed over
    fact(key + 'Unseen', () => { const n = 90 - (view.match(/<bent-sku /g) || []).length; return n === 0 || new RegExp('\\b' + n + '\\b').test(built.text.replace(view, '')); });
    fact(key + 'Echo', () => { echo = doc.planDocument(view); return echo.ok; });
    fact(key + 'EchoMode', () => echo.preview.mode);
    fact(key + 'EchoHard', () => echo.hard);
    fact(key + 'EchoMoves', () => echo.preview.changed.length + echo.preview.added.length + echo.preview.hidden.length + echo.preview.shelvesAdded.length + echo.preview.shelvesChanged.length +
      echo.preview.settings.length + echo.preview.coupons.added.length + echo.preview.coupons.changed.length + echo.preview.coupons.off.length);
    fact(key + 'EchoFields', () => [...new Set(echo.preview.changed.reduce((all, c) => all.concat(c.fields), []))].join(','));
    fact(key + 'EchoSame', () => echo.preview.unchanged === (view.match(/<bent-sku /g) || []).length);
    fact(key + 'NoCost', () => !/cost\s*=|7654321|76543\.21|1234567|12345\.67/.test(built.text));
    fact(key + 'Grammar', () => ['parent="', 'hidden="true"', 'brand', 'tags="', 'featured="true"', 'barcode', 'weight', 'seo-title', 'seo-description', 'cost', 'demo', '| card', 'max-payments']
      .filter((word) => built.text.slice(0, built.text.indexOf('──')).indexOf(word) < 0).join(','));
  }

  let view = '';
  fact('view', () => { view = viewOf(pack.buildPrompt({ brief: '', size: 'lite', ctx: { media } }).text); return view.length > 0; });
  // the echo, really applied
  fact('echoApplied', () => doc.applyDocument(view).ok);
  fact('echoAppliedSame', () => snap() === before && shelfSnap() === shelvesBefore);
  // a model that rewrote the root as a whole catalog but kept the keep list
  let keepOnly = null;
  fact('keepOnlyMode', () => { keepOnly = doc.planDocument(view.replace(' mode="merge"', '')); return keepOnly.preview.mode; });
  fact('keepOnlyLost', () => lost(keepOnly));
  fact('keepOnlyShelves', () => keepOnly.preview.shelvesChanged.length);
  fact('keepOnlyCodes', () => codes(keepOnly));
  fact('keepOnlyHidden', () => keepOnly.preview.hidden.length);
  // …and one that dropped both: a whole-catalog document without the descriptions — what 2.68 handed out
  const bare = () => view.replace(' mode="merge"', '').replace(/ keep="[^"]*"/, '');
  let bared = null;
  fact('bareHard', () => { bared = doc.planDocument(bare()); return bared.hard; });
  fact('bareCodes', () => codes(bared));
  fact('bareMessage', () => (bared.warnings.find((w) => w.code === 'BLANKED') || {}).message || '');
  fact('barePackHard', () => { const p = pack.parse(bare()); return p.hard && p.warnings.some((w) => w.code === 'BLANKED' && w.hard) && p.warningTexts.some((t) => t.indexOf('⚠ ') === 0); });
  fact('barePackApply', () => { try { pack.apply(bare(), {}, {}); return 'applied'; } catch (e) { return e.code + ':' + (e.warnings || []).map((w) => w.code).join(','); } });
  fact('bareRefusedSame', () => snap() === before);
  fact('hardCodes', () => pack.hardCodes.join(','));

  // how many is "several": two products may lose their words in one apply, three ask first — in either mode
  const whole = doc.exportDocument();
  const without = (n) => { let t = whole; for (let i = 1; i <= n; i++) t = t.replace(new RegExp('(<bent-sku id="p-' + i + '"[^>]*>)[\\s\\S]*?(\\n  </bent-sku>)'), '$1$2'); return t; };
  fact('wholeMoves', () => doc.planDocument(whole).preview.changed.length);
  fact('twoCodes', () => { const p = doc.planDocument(without(2)); return p.preview.changed.length + ':' + p.hard + ':' + codes(p); });
  fact('threeCodes', () => { const p = doc.planDocument(without(3)); return p.preview.changed.length + ':' + p.hard + ':' + codes(p); });
  const merge = (n, attrs) => '<bent-store mode="merge">' + Array.from({ length: n }, (_, i) => `<bent-sku id="p-${i + 1}" ${attrs} />`).join('') + '</bent-store>';
  fact('mergeSilent', () => { const p = doc.planDocument(merge(5, 'badge="מבצע"')); return p.preview.changed.length + ':' + p.hard + ':' + codes(p); });
  fact('mergeSummaries', () => { const p = doc.planDocument(merge(3, 'summary=""')); return p.hard + ':' + codes(p); });
  fact('mergePictures', () => { const p = doc.planDocument(merge(3, 'image="" images=""')); return p.hard + ':' + codes(p); });
  fact('mergeOnePicture', () => { const p = doc.planDocument(merge(3, 'image=""')); return p.hard + ':' + codes(p); });
  fact('mergeTwo', () => { const p = doc.planDocument(merge(2, 'description=""')); return p.hard + ':' + codes(p); });
  // two of ninety left out of a whole document: an edit — unless the root says the document is partial
  const missingTwo = whole.replace(/  <bent-sku id="p-(89|90)"[\s\S]*?\n  <\/bent-sku>\n/g, '');
  fact('plainHides', () => { const p = doc.planDocument(missingTwo); return p.preview.hidden.length + ':' + p.hard + ':' + codes(p); });
  fact('keepHides', () => { const p = doc.planDocument(missingTwo.replace('<bent-store ', '<bent-store keep="seo-title" ')); return p.preview.hidden.length + ':' + p.hard + ':' + codes(p); });

  // keep, said by hand
  const kept = (text) => { const p = doc.planDocument(text).plan.products[0]; return [p.title, p.description, p.summary, p.images.join(' '), p.brand, p.badge].join('|'); };
  const was = catalog.getProductBySlug('p-7');
  fact('keepReplace', () => kept('<bent-store keep="description,summary"><bent-sku id="p-7" title="שם חדש" price="17" /></bent-store>') ===
    ['שם חדש', was.description, was.summary, '', '', ''].join('|'));
  fact('keepStated', () => kept('<bent-store keep="description,summary"><bent-sku id="p-7" title="שם חדש" price="17" summary="">תיאור חדש</bent-sku></bent-store>') ===
    ['שם חדש', 'תיאור חדש', '', '', '', ''].join('|'));
  fact('keepCleared', () => kept('<bent-store mode="merge" keep="description"><bent-sku id="p-7" description="" /></bent-store>') ===
    [was.title, '', was.summary, was.images.join(' '), was.brand, was.badge].join('|'));
  fact('keepNew', () => kept('<bent-store mode="merge" keep="description,summary"><bent-sku id="brand-new" title="חדש לגמרי" price="5" /></bent-store>') === 'חדש לגמרי|||||');
  fact('keepShelf', () => {
    const p = doc.planDocument('<bent-store keep="summary,image"><bent-shelf id="home" label="לבית" seo-title="מוצרים לבית" seo-description="מבחר לבית" /><bent-shelf id="kitchen" label="מטבח" parent="home" />' +
      '<bent-sku id="p-7" title="מוצר מספר 7" price="17" /></bent-store>');
    return p.preview.shelvesChanged.length + ':' + p.plan.shelves.map((s) => s.image + '|' + s.summary).join(',');
  });
  fact('untouched', () => snap() === before && shelfSnap() === shelvesBefore);
  return out;
}

/** What a backup remembers of the owner's cost prices, and a demo payment outside a demo shop. */
function backupCostFacts(SRC) {
  const fs = require('fs');
  const path = require('path');
  console.warn = () => {};
  const store = require(path.join(SRC, 'store'));
  const { db } = require(path.join(SRC, 'db'));
  const csvIo = require(path.join(SRC, 'store', 'csv-io'));
  const pack = require(path.join(SRC, 'injections', 'store-catalog'));
  const { catalog, settings, document: doc } = store;
  const out = {};
  const fact = (name, fn) => { try { out[name] = fn(); } catch (e) { out[name] = 'threw: ' + (e && e.message); } };
  const cost = (slug) => { const p = catalog.getProductBySlug(slug); return p ? p.cost : 'gone'; };
  const price = (slug) => { const p = catalog.getProductBySlug(slug); return p ? p.price : 'gone'; };

  doc.applyDocument('<bent-store version="1" name="עלויות" currency="ILS">' +
    ['a', 'b', 'c', 'd'].map((id, i) => `<bent-sku id="${id}" title="מוצר ${id}" price="${50 + i}" stock="5">תיאור של ${id}</bent-sku>`).join('') +
    '<bent-pay id="bank" kind="bank" label="העברה בנקאית" /></bent-store>');
  catalog.setCosts({ a: 2000, b: 7654321 });

  // the CSV import, step for step as its route runs it: the document, then the costs beside it
  const sheet = csvIo.csvToDocument('sku,price,cost\na,60,31.50\nc,52,7\n');
  fact('csvLanded', () => doc.applyDocument(sheet.source, { trusted: true, reason: 'csv' }).ok && catalog.setCosts(sheet.costs).changed === 2 && [price('a'), cost('a'), cost('c')].join(','));
  let undone = null;
  fact('csvUndo', () => { undone = doc.undoLast(); return undone.ok && [price('a'), cost('a'), cost('b'), cost('c'), cost('d')].join(','); });
  fact('csvUndoCount', () => undone.costs);
  fact('csvRedo', () => doc.undoLast().ok && [price('a'), cost('a'), cost('c')].join(','));
  fact('csvBack', () => doc.undoLast().ok && [price('a'), cost('a'), cost('c')].join(','));

  // a bulk delete, as the admin's route runs it: the catalog on the backups shelf, then the delete
  fact('deleted', () => {
    doc.backup('admin:bulk-delete');
    const gone = catalog.bulkUpdate([catalog.getProductBySlug('a').id, catalog.getProductBySlug('b').id], { delete: true });
    return gone.deleted.slice().sort().join(',') + ':' + cost('a') + ':' + cost('b');
  });
  fact('deleteUndo', () => doc.undoLast().ok && [price('a'), cost('a'), cost('b'), cost('c')].join(','));

  // a backup by its id; a product that came after it; one that had no cost when it was taken
  fact('restore', () => {
    const id = doc.backup('before');
    catalog.createProduct({ slug: 'late', title: 'מוצר מאוחר', price: '9', cost: '4' });
    catalog.setCosts({ a: 1, d: 444 });
    const r = doc.restoreBackup(id);
    return r.ok && [cost('a'), cost('d'), cost('late'), r.costs].join(',');
  });
  // a backup taken before this release kept no costs
  fact('column', () => db.prepare('PRAGMA table_info(store_backups)').all().some((c) => c.name === 'costs'));
  fact('older', () => {
    const id = doc.backup('older');
    db.prepare('UPDATE store_backups SET costs = NULL WHERE id = ?').run(id);
    catalog.setCosts({ a: 999, d: 444 });
    const r = doc.restoreBackup(id);
    return r.ok && [cost('a'), cost('d'), r.costs].join(',');
  });
  fact('unreadable', () => {
    const id = doc.backup('unreadable');
    db.prepare("UPDATE store_backups SET costs = 'not json' WHERE id = ?").run(id);
    return doc.restoreBackup(id).ok && cost('a');
  });

  // …and none of it is ever in a text that leaves the store
  const secret = /cost|7654321|76543\.21/i;
  fact('noteKept', () => db.prepare('SELECT costs FROM store_backups ORDER BY id DESC LIMIT 1').get().costs.indexOf('7654321') > 0);
  fact('leaks', () => [
    secret.test(doc.exportDocument()) && 'export',
    db.prepare('SELECT source FROM store_backups').all().some((b) => secret.test(b.source)) && 'backup document',
    doc.listBackups().some((b) => secret.test(JSON.stringify(b))) && 'backup list',
    secret.test(JSON.stringify(require(path.join(SRC, 'site-package')).exportSitePackage('חבילה').store || {})) && 'site package',
    /cost\s*=|7654321|76543\.21/.test(pack.buildPrompt({ brief: '', size: 'full' }).text) && 'AI prompt'
  ].filter(Boolean).join(','));

  // a `demo` payment in a document: said at the door of a real shop, quiet in a demo shop
  const demoDoc = '<bent-store mode="merge"><bent-pay id="bank" kind="bank" label="העברה בנקאית" /><bent-pay id="pretend" kind="demo" label="כסף של משחק" /></bent-store>';
  const demoWarn = () => { const w = doc.planDocument(demoDoc).warnings.find((x) => x.code === 'DEMO_NOT_OFFERED'); return w ? (w.hard ? 'hard' : 'soft') : 'none'; };
  fact('demoReal', demoWarn);
  fact('demoSetting', () => { settings.saveSettings({ demoPayments: true }); const w = demoWarn(); settings.saveSettings({ demoPayments: false }); return w + ',' + demoWarn(); });
  fact('demoArmed', () => { process.env.TAPUZ_DEMO_STORE = '1'; const w = demoWarn(); delete process.env.TAPUZ_DEMO_STORE; return w + ',' + demoWarn(); });
  fact('demoSite', () => {
    const { CONFIG_DIR } = require(path.join(SRC, 'paths'));
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(path.join(CONFIG_DIR, 'seeded.json'), JSON.stringify({ [require(path.join(SRC, 'store', 'demo-seed')).DEMO_MARKER_ID]: new Date().toISOString() }));
    // the answer is demo-pay's alone: where it says "a demo site", the door is quiet
    return require(path.join(SRC, 'store', 'demo-pay')).isDemoSite() ? demoWarn() : 'none';
  });
  fact('demoNoAttr', () => {
    const p = doc.planDocument('<bent-store mode="merge"><bent-store-rules demo-payments="true" hold-hours="1" /><bent-sku id="c" price="52" /></bent-store>');
    return p.ok && p.preview.settings.length === 0 && !('demoPayments' in p.plan.patch) && !('holdHours' in p.plan.patch) &&
      p.warnings.filter((w) => w.code === 'ATTR_UNKNOWN').length === 2;
  });
  return out;
}

/** What a backup puts back of the things its document leaves unsaid: rules at their defaults, an empty name, empty lists, the coupons. */
function backupStateFacts(SRC) {
  const path = require('path');
  console.warn = () => {};
  const store = require(path.join(SRC, 'store'));
  const { db } = require(path.join(SRC, 'db'));
  const { settings, coupons, document: doc } = store;
  const out = {};
  const fact = (name, fn) => { try { out[name] = fn(); } catch (e) { out[name] = 'threw: ' + (e && e.message); } };
  const rules = () => {
    const s = settings.loadSettings();
    return [s.minOrder, s.lowStock, s.requireEmail, s.vatExempt, s.thanks === settings.DEFAULTS.thanks ? 'default' : s.thanks, s.terms || '-'].join(',');
  };
  const lists = () => {
    const s = settings.loadSettings();
    return [s.name || '-', s.shipping.map((m) => m.id).join('+') || 'none', s.payments.map((m) => m.id).join('+') || 'none'].join('|');
  };
  const codes = () => coupons.listCoupons().map((c) => c.code + ':' + (c.active ? 'on' : 'off')).sort().join(',') || 'none';
  const all = () => [rules(), lists(), codes()].join(' / ');

  doc.applyDocument('<bent-store version="1"><bent-sku id="a" title="א" price="10" /></bent-store>');
  settings.saveSettings({ name: '', shipping: [] });
  const exported = doc.exportDocument();
  // the export is the file people share: a default rule, an empty name, an empty list and "no coupons" are simply not in it
  fact('exportSaysNone', () => !/min-order|low-stock|require-email|vat-exempt|thanks|terms|bent-coupon|bent-ship|name=/.test(exported));

  // every rule at its default, no name, no shipping method — and one document that sets them all
  const RULES = '<bent-store mode="merge" name="שם מהמסמך"><bent-store-rules min-order="100" low-stock="9" require-email="true" vat-exempt="true" thanks="תודה אחרת" terms="takanon" />' +
    '<bent-ship id="courier" label="שליח" price="20" /></bent-store>';
  fact('before', all);
  fact('set', () => doc.applyDocument(RULES, { force: true }).ok && all());
  fact('undone', () => doc.undoLast().ok && all());
  fact('exportBack', () => doc.exportDocument() === exported);
  fact('redone', () => doc.undoLast().ok && all());
  fact('undoneAgain', () => doc.undoLast().ok && all() + ' / ' + (doc.exportDocument() === exported));

  // a store with NO coupons gets its first from a document
  fact('couponSet', () => doc.applyDocument('<bent-store mode="merge"><bent-coupon code="HALF" percent="50" /></bent-store>').ok && codes());
  fact('couponUndone', () => doc.undoLast().ok && codes());
  fact('couponRedone', () => doc.undoLast().ok && codes());
  fact('couponBack', () => doc.undoLast().ok && codes());

  // …and among coupons that exist: one a document switches off, one that was off, one that is new
  coupons.saveCoupon({ code: 'TEN', kind: 'percent', value: 10 });
  coupons.saveCoupon({ code: 'OLD', kind: 'percent', value: 5, active: false });
  fact('couponsSet', () => doc.applyDocument('<bent-store mode="merge"><bent-coupon code="TEN" percent="10" active="false" /><bent-coupon code="NEW" amount="5" /></bent-store>').ok && codes());
  fact('couponsUndone', () => doc.undoLast().ok && codes());

  // a backup by its id, after changes nobody made through a document (the settings screen, the coupons screen)
  fact('restore', () => {
    const id = doc.backup('before');
    settings.saveSettings({ minOrder: 5000, vatExempt: true, terms: 'other', name: 'שם אחר', shipping: [{ id: 'post', label: 'דואר', price: 1500 }], payments: [] });
    coupons.saveCoupon({ code: 'LATE', kind: 'percent', value: 20 });
    const changed = all();
    return doc.restoreBackup(id).ok && changed + ' => ' + all();
  });

  // what is NOT a backup's to put back
  fact('outside', () => {
    const id = doc.backup('outside');
    settings.saveSettings({ holdHours: 5, demoPayments: true, notifyEmail: 'owner@shop.example', open: true });
    const s = doc.restoreBackup(id).ok && settings.loadSettings();
    settings.saveSettings({ open: false });
    return s && [s.holdHours, s.demoPayments, s.notifyEmail, s.open].join(',');
  });
  fact('stateKeys', () => Object.keys(JSON.parse(db.prepare('SELECT state FROM store_backups ORDER BY id DESC LIMIT 1').get().state).settings).sort().join(','));

  // a backup taken before the snapshot existed (or one whose snapshot cannot be read) says no more than its document
  fact('older', () => {
    const id = doc.backup('older');
    db.prepare('UPDATE store_backups SET state = NULL WHERE id = ?').run(id);
    settings.saveSettings({ minOrder: 7000 });
    return doc.restoreBackup(id).ok && settings.loadSettings().minOrder;
  });
  fact('unreadable', () => {
    settings.saveSettings({ minOrder: 0 });
    const id = doc.backup('unreadable');
    db.prepare("UPDATE store_backups SET state = 'not json' WHERE id = ?").run(id);
    settings.saveSettings({ minOrder: 8000 });
    return doc.restoreBackup(id).ok && settings.loadSettings().minOrder;
  });

  // the snapshot sits beside the document: a backup's own text, and the list of backups, are as they were
  fact('beside', () => {
    const id = doc.backup('beside');
    const row = doc.getBackup(id);
    return row.source === doc.exportDocument() && typeof row.state === 'string' && !/"settings"|"coupons"/.test(row.source) && !doc.listBackups().some((b) => 'state' in b);
  });
  return out;
}

const slugsOf = (list) => list.map((p) => p.slug).sort().join(',');
const sku = (slug) => catalog.getProductBySlug(slug);

try {
  // ── schema ───────────────────────────────────────────────────────────
  const names = (h, t) => h.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const shape = (h, t) => h.prepare(`PRAGMA table_info(${t})`).all().map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk].join('|')).join('\n');
  ok(['parent', 'summary', 'image', 'hidden', 'seo_title', 'seo_description'].every((c) => names(db, 'store_shelves').includes(c)),
    'schema: a fresh database has the category columns (parent, summary, image, hidden, seo_title, seo_description)');
  ok(['brand', 'tags', 'featured', 'barcode', 'weight', 'cost', 'seo_title', 'seo_description'].every((c) => names(db, 'store_products').includes(c)),
    'schema: …and the product columns (brand, tags, featured, barcode, weight, cost, seo_title, seo_description)');
  ok(names(db, 'store_orders').includes('payment_kind'), 'schema: …and store_orders.payment_kind');
  const everything = () => STORE_TABLES.map((t) => t + '\n' + shape(db, t)).join('\n\n') + '\n' +
    db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%store_%' ORDER BY name").all().map((r) => r.name).join(',');
  const shapeBefore = everything();
  initializeStore(db);
  initializeStore(db);
  ok(everything() === shapeBefore, 'schema: opening the store again (twice) changes no table, column or index');

  const old = new Database(':memory:');
  old.exec(TABLES_268);
  old.prepare("INSERT INTO store_shelves (slug, label, sort) VALUES ('candles', 'נרות', 4)").run();
  old.prepare("INSERT INTO store_products (slug, title, price, stock, images, shelf) VALUES ('lavender', 'נר לבנדר', 8990, 3, '[\"/a.png\"]', 'candles')").run();
  old.prepare("INSERT INTO store_orders (number, token, total, payment_method) VALUES ('1001', 'tok-1', 8990, 'bank')").run();
  initializeStore(old);
  ok(['store_shelves', 'store_products', 'store_orders'].every((t) => shape(old, t) === shape(db, t)),
    'schema: a 2.68 database ends with the same columns, types and defaults, in the same order, as a fresh one');
  const oldProduct = old.prepare("SELECT * FROM store_products WHERE slug = 'lavender'").get();
  const oldShelf = old.prepare("SELECT * FROM store_shelves WHERE slug = 'candles'").get();
  const oldOrder = old.prepare("SELECT * FROM store_orders WHERE number = '1001'").get();
  ok(oldProduct.title === 'נר לבנדר' && oldProduct.price === 8990 && oldProduct.stock === 3 && oldProduct.images === '["/a.png"]' &&
    oldProduct.brand === '' && oldProduct.tags === '[]' && oldProduct.featured === 0 && oldProduct.barcode === '' &&
    oldProduct.weight === null && oldProduct.cost === null && oldProduct.seo_title === '' && oldProduct.seo_description === '',
  'schema: the upgraded product keeps its data and gains the defaults (no brand, no tags, not featured, no weight, no cost)');
  ok(oldShelf.label === 'נרות' && oldShelf.sort === 4 && oldShelf.parent === '' && oldShelf.hidden === 0 && oldShelf.image === '' &&
    oldOrder.total === 8990 && oldOrder.payment_method === 'bank' && oldOrder.payment_kind === '',
  'schema: the upgraded shelf and order keep theirs (top-level, visible; payment_kind empty)');
  ok(!!old.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_store_shelves_parent'").get() &&
    (initializeStore(old), shape(old, 'store_products') === shape(db, 'store_products')),
  'schema: the parent index is there, and a second upgrade pass adds nothing');
  old.close();

  // ── shelves (categories) ─────────────────────────────────────────────
  catalog.saveShelf({ slug: 'gifts', label: 'מתנות', image: '/assets/gifts.webp', summary: 'כל המתנות', seoTitle: 'מתנות לכל אירוע', seoDescription: 'מתנות בעבודת יד', sort: 5 });
  catalog.saveShelf({ slug: 'home', label: 'לבית' });
  catalog.saveShelf({ slug: 'her', label: 'בשבילה', parent: 'gifts' });
  catalog.saveShelf({ slug: 'him', label: 'בשבילו', parent: 'gifts' });
  ok(throws(() => catalog.saveShelf({ slug: 'x', label: '' }), /חסר שם/), 'shelf: no name is refused in Hebrew');
  ok(throws(() => catalog.saveShelf({ slug: '!!!', label: '???' }), /מזהה/), 'shelf: an id that cannot be an address is refused');
  ok(throws(() => catalog.saveShelf({ slug: 'home', label: 'לבית', parent: 'home' }), /של עצמה/), 'shelf: cannot be its own parent');
  ok(throws(() => catalog.saveShelf({ slug: 'home', label: 'לבית', parent: 'nope' }), /האב לא נמצאה/), 'shelf: a parent that does not exist is refused');
  ok(throws(() => catalog.saveShelf({ slug: 'home', label: 'לבית', parent: 'her' }), /רמה אחת/), 'shelf: a parent that is itself a child is refused (one level only)');
  ok(throws(() => catalog.saveShelf({ slug: 'gifts', label: 'מתנות', parent: 'home' }), /יש תת-קטגוריות/), 'shelf: a shelf that has children cannot be given a parent');
  ok(throws(() => catalog.saveShelf({ slug: 'home', label: 'לבית', image: '//evil.example/x.png' }), /התמונה/) && catalog.getShelf('home').parent === '' && catalog.getShelf('home').image === '',
    'shelf: a picture address that is not a picture address is refused, and a refusal writes nothing');
  const renamed = catalog.saveShelf({ slug: 'gifts', label: 'מתנות ושי' });
  ok(renamed.label === 'מתנות ושי' && renamed.image === '/assets/gifts.webp' && renamed.summary === 'כל המתנות' && renamed.seoTitle === 'מתנות לכל אירוע' &&
    renamed.seoDescription === 'מתנות בעבודת יד' && renamed.sort === 5,
  'shelf: saveShelf({ slug, label }) keeps the picture, the text, the SEO and the ORDER (sort is no longer reset to 0)');
  ok(catalog.saveShelf({ slug: 'her', label: 'בשבילה' }).parent === 'gifts' && catalog.saveShelf({ slug: 'gifts', label: 'מתנות ושי', summary: '' }).summary === '' &&
    catalog.getShelf('gifts').image === '/assets/gifts.webp',
  'shelf: …and the parent; a field that IS sent empty is cleared, the others stay');
  catalog.saveShelf({ slug: 'gifts', label: 'מתנות ושי', summary: 'כל המתנות' });
  catalog.saveShelf({ slug: 'him', label: 'בשבילו', hidden: 'on' });
  ok(catalog.getShelf('him').hidden === true && catalog.getShelf('him').parent === 'gifts' && catalog.getShelf('nope') === null, 'shelf: hidden is a switch; getShelf of nothing is null');

  // products for the counts
  catalog.createProduct({
    slug: 'lavender', title: 'נר לבנדר', price: '89.90', compareAt: '120', stock: 2, shelf: 'her',
    brand: 'נועה', tags: 'סויה, בעבודת יד, סויה', featured: 'on', barcode: '7290 0012-345', weight: '320', cost: '31.37',
    seoTitle: 'נר לבנדר בעבודת יד', seoDescription: 'נר סויה טבעי', summary: 'נר סויה', description: 'שורה ראשונה.\n\nפסקה שנייה.',
    images: ['/assets/lav-1.webp', '/assets/lav-2.webp'], badge: 'מבצע', maxPerOrder: 3
  });
  catalog.createProduct({ slug: 'soap', title: 'סבון זית', price: '25', stock: 0, shelf: 'him', brand: 'Acme', tags: ['Soap', 'gift'] });
  catalog.createProduct({ slug: 'card', title: 'כרטיס ברכה', price: '12', shelf: 'gifts', brand: 'acme' });
  catalog.createProduct({ slug: 'mug', title: 'ספל', price: '40', shelf: 'home', tags: 'gift', variants: [{ label: 'S', stock: 0 }, { label: 'M', stock: 0 }] });
  catalog.createProduct({ slug: 'shirt', title: 'חולצה', price: '100', shelf: 'home', variants: [{ label: 'S', stock: 1 }, { label: 'M', price: '120' }] });
  catalog.createProduct({ slug: 'sketch', title: 'סקיצה', price: '9', shelf: 'him', status: 'draft' });
  const tree = catalog.listShelves();
  const node = (slug) => tree.find((s) => s.slug === slug);
  ok(tree.map((s) => s.slug + ':' + s.depth).join(' ') === 'gifts:0 her:1 him:1 home:0',
    'shelves: parents first, each parent\'s children right after it, with depth');
  ok(node('gifts').count === 1 && node('gifts').total === 3 && node('her').count === 1 && node('her').total === 1 && node('him').count === 1 && node('home').count === 2,
    'shelves: count = active products on the shelf; total = count + its children\'s');
  ok(node('him').all === 2 && node('gifts').all === 1 && node('home').all === 2, 'shelves: all = products of ANY status on the shelf (what a delete would move)');
  ok(node('her').parent === 'gifts' && node('gifts').image === '/assets/gifts.webp' && node('him').hidden === true && node('gifts').seoTitle === 'מתנות לכל אירוע',
    'shelves: every row carries parent, summary, image, hidden and the SEO fields');
  ok(catalog.listShelves({ visible: true }).map((s) => s.slug).join(',') === 'gifts,her,home', 'shelves: { visible: true } leaves a hidden shelf out');
  catalog.saveShelf({ slug: 'gifts', label: 'מתנות ושי', hidden: true });
  ok(catalog.listShelves({ visible: true }).map((s) => s.slug).join(',') === 'home', 'shelves: …and the children of a hidden shelf with it');
  catalog.saveShelf({ slug: 'gifts', label: 'מתנות ושי', hidden: false });
  ok(catalog.reorderShelves(['home', 'gifts', 'him', 'her']).map((s) => s.slug).join(',') === 'home,gifts,him,her' && catalog.getShelf('home').sort === 0 && catalog.getShelf('her').sort === 3,
    'shelves: reorderShelves writes sort = index (children keep their place under the parent)');
  ok(catalog.shelfFamily('gifts').join(',') === 'gifts,him,her' && catalog.shelfFamily('her').join(',') === 'her' && catalog.shelfFamily('nope').join(',') === 'nope',
    'shelves: shelfFamily = the shelf and its children');
  ok(JSON.stringify(catalog.shelfPath('her')) === JSON.stringify([{ slug: 'gifts', label: 'מתנות ושי' }, { slug: 'her', label: 'בשבילה' }]) &&
    catalog.shelfPath('gifts').length === 1 && catalog.shelfPath('nope').length === 0,
  'shelves: shelfPath runs from the top-level shelf down ([] for no such shelf)');
  db.prepare("INSERT INTO store_shelves (slug, label, sort, parent) VALUES ('orphan', 'יתום', 9, 'ghost')").run();
  ok(catalog.listShelves().some((s) => s.slug === 'orphan' && s.depth === 0 && s.parent === '') && catalog.getShelf('orphan').parent === '',
    'shelves: a child whose parent row is missing is top-level — never lost');
  catalog.deleteShelf('orphan');

  // ── products: the new fields ─────────────────────────────────────────
  const lav = sku('lavender');
  ok(lav.brand === 'נועה' && JSON.stringify(lav.tags) === JSON.stringify(['סויה', 'בעבודת יד']) && lav.featured === true && lav.barcode === '72900012-345' &&
    lav.weight === 320 && lav.cost === 3137 && lav.seoTitle === 'נר לבנדר בעבודת יד' && lav.seoDescription === 'נר סויה טבעי',
  'product: brand, tags (no doubles), featured, barcode (spaces out), weight in grams, cost in minor units, SEO');
  const messy = catalog.normalizeProduct({
    title: 'שם\nבשתי שורות', price: '10', brand: 'ב'.repeat(80), tags: Array.from({ length: 15 }, (_, i) => 'tag' + i),
    barcode: 'אבג#123456', weight: '12.5', cost: 'abc', seoTitle: 'x'.repeat(100), seoDescription: 'y'.repeat(200),
    summary: 'a\r\nb\tc', badge: 'x\ny', stock: '12.5', maxPerOrder: '0', featured: 'yes'
  });
  ok(messy.product.title === 'שם בשתי שורות' && messy.product.summary === 'a b c' && messy.product.badge === 'x y',
    'product: a one-line field (title, summary, badge) turns a line break or a tab into one space');
  ok(messy.product.brand.length === 60 && messy.product.seoTitle.length === 70 && messy.product.seoDescription.length === 160,
    'product: brand ≤ 60, SEO title ≤ 70, SEO description ≤ 160');
  ok(messy.product.tags.length === 12 && messy.warnings.some((w) => /תגיות/.test(w)), 'product: at most 12 tags, and the cut is said');
  ok(messy.product.barcode === '123456' && messy.warnings.some((w) => /הברקוד/.test(w)), 'product: a barcode keeps digits, Latin letters and a dash only — and says it was cleaned');
  ok(messy.product.weight === null && messy.warnings.some((w) => /המשקל/.test(w)) && messy.product.cost === null && messy.warnings.some((w) => /העלות/.test(w)),
    'product: a weight that is not whole grams, and a cost that is not money, are dropped with a sentence');
  ok(messy.product.stock === null && messy.warnings.some((w) => /המלאי/.test(w)), 'integrity: stock "12.5" is refused by name — it used to become 125');
  ok(messy.product.maxPerOrder === null && catalog.normalizeProduct({ title: 't', price: '1', maxPerOrder: '' }).product.maxPerOrder === null &&
    catalog.normalizeProduct({ title: 't', price: '1', maxPerOrder: 5 }).product.maxPerOrder === 5,
  'integrity: max per order 0 or empty is "no limit", not 1');
  ok(messy.product.featured === false && [true, 'true', 1, '1', 'on'].every((v) => catalog.normalizeProduct({ title: 't', price: '1', featured: v }).product.featured === true) &&
    [false, 'false', 0, '', undefined].every((v) => catalog.normalizeProduct({ title: 't', price: '1', featured: v }).product.featured === false),
  'product: featured is on for true / "true" / 1 / "1" / "on" and nothing else');
  const tagsOf = (tags) => JSON.stringify(catalog.normalizeProduct({ title: 't', price: '1', tags }).product.tags);
  ok(tagsOf('a, b,,c ') === '["a","b","c"]' && tagsOf(['a', ' b ', 'c']) === '["a","b","c"]' && tagsOf(['Red', 'red', 'RED ', 'blue']) === '["Red","blue"]' &&
    tagsOf(['x'.repeat(40)]) === JSON.stringify(['x'.repeat(30)]) && tagsOf(['one,two']) === '["one","two"]',
  'product: tags from a comma string or an array — trimmed, ≤ 30 chars, no doubles whatever the case, order kept');
  const numbers = (o) => catalog.normalizeProduct({ title: 't', price: '1', ...o }).product;
  ok(numbers({ weight: '1,200' }).weight === 1200 && numbers({ weight: 2000000 }).weight === 1000000 && numbers({ stock: ' 7 ' }).stock === 7 &&
    numbers({ cost: 450 }).cost === 450 && numbers({ cost: '4.50' }).cost === 450 && numbers({ cost: '' }).cost === null,
  'product: whole numbers allow spaces and a thousands comma; cost reads like a price (typed "4.50" or 450 minor)');
  ok(catalog.cleanImage('//evil.example/x.png') === '' && catalog.cleanImage('/\\evil.example/x.png') === '' && catalog.cleanImage('/a.png') === '/a.png' &&
    catalog.cleanImage('https://cdn.example.com/a.png') === 'https://cdn.example.com/a.png',
  'integrity: a protocol-relative picture address (//host/…) is not a site path');
  ok(throws(() => catalog.setStock('lavender', '', '12.5'), /מספר שלם/) && sku('lavender').stock === 2 && catalog.setStock('lavender', '', '').stock === null &&
    catalog.setStock('lavender', '', 2).stock === 2,
  'integrity: the quick stock edit refuses "12.5" (a typo must not turn counting off); empty still does');

  const kept = catalog.updateProduct('card', { price: '14' }).product;
  catalog.updateProduct('card', { brand: 'Paper Co', tags: ['נייר'], featured: true, barcode: 'CARD-1', weight: 15, cost: '3', seoTitle: 'כרטיס', seoDescription: 'כרטיס ברכה' });
  const kept2 = catalog.updateProduct('card', { price: '12' }).product;
  ok(kept.brand === 'acme' && kept.price === 1400 && kept2.brand === 'Paper Co' && kept2.tags[0] === 'נייר' && kept2.featured === true && kept2.barcode === 'CARD-1' &&
    kept2.weight === 15 && kept2.cost === 300 && kept2.seoTitle === 'כרטיס' && kept2.seoDescription === 'כרטיס ברכה' && kept2.price === 1200,
  'product: an update that sends one field keeps every other one — the new fields too');
  const cleared = catalog.updateProduct('card', { brand: 'acme', tags: [], featured: false, barcode: '', weight: '', cost: '', seoTitle: '', seoDescription: '' }).product;
  ok(cleared.brand === 'acme' && cleared.tags.length === 0 && cleared.featured === false && cleared.barcode === '' && cleared.weight === null && cleared.cost === null,
    'product: …and a field sent empty is cleared');
  ok(sku('lavender').sort === 0 && sku('soap').sort === 10 && sku('sketch').sort === 50, 'integrity: a new product goes LAST in the owner\'s order (sort = max + 10), not second');
  const taken = catalog.createProduct({ slug: 'lavender', title: 'נר אחר', price: '5' });
  const twin = catalog.createProduct({ title: 'נר לבנדר', price: '5', slug: '' });
  ok(taken.product.slug === 'lavender-2' && taken.warnings.some((w) => /"lavender" תפוס — נשמר כ-"lavender-2"/.test(w)),
    'product: a taken id the owner asked for is suffixed AND said ("lavender" → "lavender-2")');
  ok(twin.product.slug !== 'lavender' && !twin.warnings.some((w) => /תפוס/.test(w)), 'product: …an id made from the title is nobody\'s request — no warning');
  const free = catalog.createProduct({ slug: 'freebie', title: 'חינם', price: '0' });
  ok(free.warnings.includes('המחיר הוא 0 — בכוונה?') && catalog.updateProduct('freebie', { summary: 'x' }).warnings.includes('המחיר הוא 0 — בכוונה?') &&
    !catalog.updateProduct('card', { summary: '' }).warnings.length,
  'product: a price of 0 is asked about on create and on update');
  const copy = catalog.duplicateProduct('lavender').product;
  ok(copy.slug === 'lavender-copy' && copy.status === 'draft' && copy.featured === false && copy.brand === 'נועה' && copy.tags.length === 2 && copy.barcode === lav.barcode &&
    copy.weight === 320 && copy.cost === 3137 && copy.seoTitle === lav.seoTitle && copy.images.length === 2,
  'product: a duplicate carries every new field — but is a draft and not featured');
  for (const p of [taken.product, twin.product, free.product, copy]) catalog.deleteProduct(p.id);

  const numeric = catalog.createProduct({ slug: '1', title: 'מק"ט של ספרות', price: '7' }).product;
  ok(numeric.id !== 1 && catalog.getProduct('1').slug === '1' && catalog.getProduct(1).slug === 'lavender' && catalog.getProductBySlug('1').id === numeric.id &&
    catalog.getProductBySlug('2') === null && catalog.getProduct('2').slug === 'soap',
  'integrity: a SKU of digits is a SKU first (getProduct("1") is the product "1", not row #1); getProductBySlug never reads a row id');
  catalog.deleteProduct(numeric.id);

  // ── products: lists ──────────────────────────────────────────────────
  ok(slugsOf(catalog.listProducts({ shelf: 'gifts' })) === 'card,lavender,soap' && slugsOf(catalog.listProducts({ shelf: 'gifts', shelfExact: true })) === 'card' &&
    slugsOf(catalog.listProducts({ shelf: 'her' })) === 'lavender' && catalog.listProducts({ shelf: 'nope' }).length === 0,
  'list: a parent shelf shows its children\'s products; shelfExact shows its own only');
  ok(slugsOf(catalog.listProducts({ tag: 'GIFT' })) === 'mug,soap' && slugsOf(catalog.listProducts({ tag: 'סויה' })) === 'lavender' && catalog.listProducts({ tag: 'gif' }).length === 0,
    'list: tag is an exact tag, whatever the case (json_each over the tags column)');
  db.prepare("UPDATE store_products SET tags = 'not json' WHERE slug = 'sketch'").run();
  ok(slugsOf(catalog.listProducts({ tag: 'gift', status: 'all' })) === 'mug,soap' && sku('sketch').tags.length === 0, 'list: a row whose tags are not JSON breaks nothing');
  db.prepare("UPDATE store_products SET tags = '[]' WHERE slug = 'sketch'").run();
  ok(slugsOf(catalog.listProducts({ brand: 'ACME' })) === 'card,soap' && slugsOf(catalog.listProducts({ featured: true })) === 'lavender', 'list: brand (exact, any case) and featured');
  ok(slugsOf(catalog.listProducts({ stock: 'out' })) === 'mug,soap' && slugsOf(catalog.listProducts({ stock: 'low' })) === 'lavender,shirt',
    'list: stock "out" (nothing left, every option included) and "low" (at or under the store\'s lowStock)');
  settings.saveSettings({ lowStock: 0 });
  ok(catalog.listProducts({ stock: 'low' }).length === 0, 'list: with lowStock 0 nothing is "low"');
  settings.saveSettings({ lowStock: 3 });
  db.prepare("UPDATE store_products SET updated_at = '2099-01-01 00:00:00' WHERE slug = 'mug'").run();
  ok(catalog.listProducts({ sort: 'featured' })[0].slug === 'lavender' && catalog.listProducts({ sort: 'updated' })[0].slug === 'mug', 'list: the featured and updated sorts');
  ok(slugsOf(catalog.listProducts({ q: 'acme' })) === 'card,soap' && slugsOf(catalog.listProducts({ q: '7290' })) === 'lavender' && slugsOf(catalog.listProducts({ q: 'gift' })) === 'mug,soap',
    'list: q also searches brand, barcode and tags');
  ok(catalog.listProducts({ status: 'all', limit: 3 }).length === 3 && catalog.listProducts({ status: 'all' }).length === 6, 'list: limit, and status "all"');

  // ── the shopper's view ───────────────────────────────────────────────
  const pub = catalog.publicProduct(sku('lavender'));
  const KEYS_268 = ['sku', 'title', 'summary', 'description', 'price', 'priceText', 'compareAt', 'compareText', 'currency', 'images', 'image', 'shelf', 'shelfLabel',
    'badge', 'delivery', 'available', 'stockState', 'stockLeft', 'maxQty', 'hasVariants', 'variants'];
  ok(Object.keys(pub).slice(0, KEYS_268.length).join(',') === KEYS_268.join(',') && pub.priceText === '₪89.90' && pub.compareText === '₪120' && pub.shelfLabel === 'בשבילה' &&
    pub.stockState === 'low' && pub.stockLeft === 2 && pub.maxQty === 2,
  'public: everything the cart and the checkout already read is where it was, unchanged');
  ok(!('cost' in pub) && !/cost/i.test(JSON.stringify(pub)) && !JSON.stringify(pub).includes('3137'), 'public: the owner\'s cost is NOT in the shopper\'s view');
  ok(pub.salePercent === 25 && pub.brand === 'נועה' && pub.tags.length === 2 && pub.featured === true && pub.barcode === '72900012-345' && pub.weight === 320 &&
    pub.seoTitle === 'נר לבנדר בעבודת יד' && pub.seoDescription === 'נר סויה טבעי',
  'public: salePercent (120 → 89.90 is 25%), brand, tags, featured, barcode, weight, SEO');
  ok(JSON.stringify(pub.shelfPath) === JSON.stringify([{ slug: 'gifts', label: 'מתנות ושי' }, { slug: 'her', label: 'בשבילה' }]) && pub.shelves.join(',') === 'her,gifts' &&
    catalog.publicProduct(sku('card')).shelves.join(',') === 'gifts',
  'public: shelfPath (parent → shelf) and shelves (own + parent, for a parent\'s chip)');
  ok(catalog.publicProduct(sku('shirt')).salePercent === null && catalog.publicProduct(sku('card')).salePercent === null &&
    catalog.publicProduct({ ...sku('lavender'), price: 1, compareAt: 100000000 }).salePercent === 99 &&
    catalog.publicProduct({ ...sku('lavender'), price: 9996, compareAt: 10000 }).salePercent === 1,
  'public: no salePercent with options or without a higher "was"; it stays within 1–99');

  // ── bulk, brands, tags, order, costs ─────────────────────────────────
  const idOf = (slug) => sku(slug).id;
  const hid = catalog.bulkUpdate([idOf('soap'), idOf('card'), 999999], { status: 'hidden' });
  ok(hid.changed === 2 && hid.products.every((p) => p.status === 'hidden') && hid.deleted.length === 0 && catalog.bulkUpdate([idOf('soap')], { status: 'hidden' }).changed === 0,
    'bulk: status — unknown ids are skipped, a product already there is not reported');
  catalog.bulkUpdate([idOf('soap'), idOf('card')], { status: 'active' });
  ok(catalog.bulkUpdate([idOf('card')], { shelf: 'home' }).products[0].shelf === 'home' && catalog.bulkUpdate([idOf('card')], { shelf: '' }).products[0].shelf === '' &&
    throws(() => catalog.bulkUpdate([idOf('card')], { shelf: 'nope' }), /הקטגוריה לא נמצאה/),
  'bulk: shelf — move, take off every shelf, and a shelf that is not there is refused');
  catalog.bulkUpdate([idOf('card')], { shelf: 'gifts' });
  ok(catalog.bulkUpdate([idOf('soap'), idOf('card'), idOf('lavender')], { featured: true }).changed === 2 && sku('soap').featured === true &&
    catalog.bulkUpdate([idOf('soap'), idOf('card')], { featured: false }).changed === 2,
  'bulk: featured on and off');
  ok(catalog.bulkUpdate([idOf('soap'), idOf('card')], { addTag: 'חדש' }).changed === 2 && sku('card').tags.includes('חדש') &&
    catalog.bulkUpdate([idOf('soap'), idOf('card')], { addTag: 'חדש' }).changed === 0 &&
    catalog.bulkUpdate([idOf('soap'), idOf('card'), idOf('mug')], { removeTag: 'חדש' }).changed === 2 && !sku('card').tags.includes('חדש'),
  'bulk: addTag and removeTag');
  const doomed = catalog.createProduct({ slug: 'doomed', title: 'למחיקה', price: '1' }).product;
  const gone = catalog.bulkUpdate([doomed.id], { delete: true });
  ok(gone.changed === 1 && gone.deleted.join(',') === 'doomed' && sku('doomed') === null, 'bulk: delete returns the slugs it removed (so their pages can be retired)');
  ok(throws(() => catalog.bulkUpdate([idOf('card')], {}), /אינה מוכרת/) && throws(() => catalog.bulkUpdate([idOf('card')], { status: 'gone' }), /סטטוס/) &&
    throws(() => catalog.bulkUpdate([idOf('card')], { status: 'hidden', featured: true }), /אינה מוכרת/) && sku('card').status === 'active',
  'bulk: an unknown action, a bad status or two actions at once are refused before anything is written');
  ok(JSON.stringify(catalog.listBrands()) === JSON.stringify([{ brand: 'Acme', count: 2 }, { brand: 'נועה', count: 1 }]), 'listBrands: every brand with its count, most used first (Acme = acme)');
  ok(JSON.stringify(catalog.listTags()[0]) === JSON.stringify({ tag: 'gift', count: 2 }) && catalog.listTags().length === 4, 'listTags: every tag with its count, most used first');
  ok(catalog.reorderProducts([idOf('card'), idOf('lavender'), 999999]).changed === 2 && sku('card').sort === 0 && sku('lavender').sort === 10,
    'integrity: reorderProducts writes sort = index × 10 for the ids given');
  ok(catalog.setCosts({ soap: 1234, card: null, nope: 5, lavender: 'x' }).changed === 1 && sku('soap').cost === 1234 && sku('lavender').cost === 3137 &&
    catalog.setCosts({ soap: null }).changed === 1 && sku('soap').cost === null,
  'setCosts: costs by SKU (minor units, null clears); unknown SKUs and non-numbers are skipped');

  const payload = require('../src/routes/store-public').catalogPayload();
  const wire = JSON.stringify(payload);
  ok(!/"cost"/.test(wire) && !/cost/i.test(wire) && !wire.includes('3137'), 'GET /api/store/catalog: the word "cost" and the cost itself appear nowhere in the payload');
  ok(payload.shelves.map((s) => s.slug).join(',') === 'home,gifts,her' && payload.shelves[1].image === '/assets/gifts.webp' && payload.shelves[1].summary === 'כל המתנות' &&
    payload.shelves[2].parent === 'gifts' && payload.shelves[1].total === 3 && payload.products.some((p) => p.sku === 'lavender' && p.brand === 'נועה' && p.salePercent === 25),
  'GET /api/store/catalog: visible shelves with parent, image, summary and total; products carry the new public fields');

  // ── deleting a shelf ─────────────────────────────────────────────────
  catalog.saveShelf({ slug: 'seasonal', label: 'עונתי' });
  catalog.saveShelf({ slug: 'winter', label: 'חורף', parent: 'seasonal' });
  catalog.createProduct({ slug: 'scarf', title: 'צעיף', price: '60', shelf: 'winter' });
  catalog.createProduct({ slug: 'gloves', title: 'כפפות', price: '45', shelf: 'seasonal', status: 'hidden' });
  const moved = catalog.deleteShelf('seasonal', { moveTo: 'home' });
  ok(moved.deleted === true && moved.moved === 1 && moved.movedTo === 'home' && sku('gloves').shelf === 'home' && catalog.getShelf('seasonal') === null,
    'deleteShelf({ moveTo }): its products (any status) move to the shelf named');
  ok(catalog.getShelf('winter').parent === '' && sku('scarf').shelf === 'winter', 'deleteShelf: its children become top-level and keep their products');
  const dropped = catalog.deleteShelf('winter', { moveTo: 'winter' });
  ok(dropped.movedTo === '' && sku('scarf').shelf === '' && catalog.deleteShelf('nope', { moveTo: 'home' }).deleted === false,
    'deleteShelf: with no shelf to move to (none, itself, one that is not there) the products go to no shelf');
  catalog.deleteProduct('scarf');
  catalog.deleteProduct('gloves');

  // ── the document: every new attribute, byte for byte ─────────────────
  settings.saveSettings({ thanks: 'תודה רבה!\nנחזור אליכם בהקדם.' });
  const exported = doc.exportDocument();
  ok(!/cost/i.test(exported) && !exported.includes('31.37'), 'document: the export never says "cost" (the site package carries it verbatim)');
  ok(exported.includes('<bent-shelf id="gifts" label="מתנות ושי" image="/assets/gifts.webp" summary="כל המתנות" seo-title="מתנות לכל אירוע" seo-description="מתנות בעבודת יד" />') &&
    exported.includes('<bent-shelf id="him" label="בשבילו" parent="gifts" hidden="true" />') && exported.includes('<bent-shelf id="home" label="לבית" />'),
  'document: <bent-shelf> writes id label parent image summary hidden seo-title seo-description — only what is not the default');
  ok(/<bent-sku id="lavender" title="נר לבנדר" price="89\.90" was="120" stock="2" shelf="her" brand="נועה" tags="סויה, בעבודת יד" featured="true" barcode="72900012-345" weight="320" image="\/assets\/lav-1\.webp" images="\/assets\/lav-2\.webp" badge="מבצע" summary="נר סויה" max="3" seo-title="נר לבנדר בעבודת יד" seo-description="נר סויה טבעי">/.test(exported),
    'document: <bent-sku> writes the new attributes in the agreed order');
  ok(exported.indexOf('id="home"') < exported.indexOf('id="gifts"') && exported.indexOf('id="gifts"') < exported.indexOf('id="him"') && exported.indexOf('id="him"') < exported.indexOf('id="her"'),
    'document: shelves are written in listShelves() order (a parent, then its children)');
  const reparsed = dialect.parseStoreDoc(exported).doc;
  ok(dialect.serializeStore(reparsed) === exported, 'document: export → parse → serialize is the same text, rules and shelves included');
  ok(dialect.serializeStore({ ...doc.currentState(), shelves: reparsed.shelves.map((x) => ({ ...x })), products: reparsed.products.map((x) => ({ ...x })) }) === exported,
    'document: …also when the parsed objects are copied (what was present is recorded out of sight, not as a field)');
  ok(dialect.serializeStore(dialect.parseStoreDoc(dialect.serializeStore(reparsed), { trusted: true }).doc) === exported, 'document: …and again through the trusted reader');
  const own = doc.planDocument(exported);
  ok(own.ok && !own.hard && own.preview.changed.length === 0 && own.preview.added.length === 0 && own.preview.hidden.length === 0 && own.preview.unchanged === 6 &&
    own.preview.shelvesAdded.length === 0 && own.preview.shelvesChanged.length === 0 && own.preview.settings.length === 0,
  'document: the store\'s own export plans to change nothing');
  const twinInstall = onAnotherInstall(exported, { trusted: true });
  ok(twinInstall.ok === true && twinInstall.exported === exported, 'document: applied to an empty second install, it exports the very same document');
  ok(twinInstall.products && twinInstall.products.every((p) => p.cost === null), 'document: …where no product has a cost (the document did not carry one)');

  const demo = onAnotherInstall(DEMO_268, {});
  ok(demo.ok === true && demo.products && demo.products.length === 8 && demo.products.find((p) => p.slug === 'left-sock').price === 13 &&
    demo.products.find((p) => p.slug === 'named-cloud').price === 100000100,
  'document: the 2.68 demo document applies as it did (8 products, the sock at 13 agorot, the cloud at 100000100)');
  ok(demo.exported === dialect.serializeStore(dialect.parseStoreDoc(DEMO_268).doc) && !/ (brand|tags|featured|barcode|weight|seo-title|seo-description|parent|hidden|mode)="/.test(demo.exported || '') &&
    !/unlimited/.test(demo.exported || ''),
  'document: …and exports as that same document — not one new attribute in it');
  ok(demo.shelves && demo.shelves.join(',') === 'small,huge,quiet' && demo.again && demo.again.changed === 0 && demo.again.added === 0 && demo.again.shelvesChanged === 0,
    'integrity: shelf order is the document\'s order now (small, huge, quiet — it used to fall back to the alphabet)');

  // ── cost never moves through the document door ───────────────────────
  catalog.setCosts({ soap: 777, card: 55 });
  const costs = () => catalog.listProducts({ status: 'all' }).map((p) => p.slug + ':' + p.cost).join(',');
  const costsBefore = costs();
  const repriced = doc.applyDocument(exported.replace('price="25"', 'price="27"'));
  ok(repriced.ok && sku('soap').price === 2700 && costs() === costsBefore, 'cost: an apply leaves every product\'s cost exactly as it was');
  const undone = doc.undoLast();
  ok(undone.ok && sku('soap').price === 2500 && costs() === costsBefore && !/cost/i.test(doc.exportDocument()), 'cost: …and so does an undo; no export ever says the word');
  const withCost = doc.planDocument('<bent-sku id="soap" cost="1" />');
  ok(withCost.ok && withCost.warnings.some((w) => w.code === 'ATTR_UNKNOWN' && /cost/.test(w.message)) && withCost.preview.changed.length === 0,
    'cost: a document that tries cost="…" is told the attribute is not read');

  // ── merge keeps, a whole document clears ─────────────────────────────
  const lavBefore = sku('lavender');
  const onePrice = doc.planDocument('<bent-sku id="lavender" price="59" />');
  ok(onePrice.ok && onePrice.preview.changed.length === 1 && onePrice.preview.changed[0].fields.length === 1 && /₪89.90 → ₪59/.test(onePrice.preview.changed[0].fields[0]),
    'merge: <bent-sku id price> plans ONE change — the price');
  doc.applyDocument('<bent-sku id="lavender" price="59" />');
  const lavAfter = sku('lavender');
  const sameBut = (a, b, skip) => Object.keys(a).filter((k) => !skip.includes(k)).every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
  ok(lavAfter.price === 5900 && sameBut(lavBefore, lavAfter, ['price', 'updatedAt', 'variants']) && lavAfter.sort === lavBefore.sort,
    'merge: an attribute the tag does not carry keeps its value — title, shelf, pictures, badge, brand, tags, SEO, status, place in the order');
  doc.applyDocument('<bent-sku id="lavender" badge="" featured="false" tags="" image="/assets/new.webp" price="89.90" />');
  ok(sku('lavender').badge === '' && sku('lavender').featured === false && sku('lavender').tags.length === 0 &&
    sku('lavender').images.join(',') === '/assets/new.webp,/assets/lav-2.webp' && sku('lavender').brand === 'נועה',
  'merge: an attribute that IS there and empty clears; image alone swaps the first picture and keeps the rest');
  doc.applyDocument('<bent-sku id="shirt" badge="חדש" />');
  ok(sku('shirt').badge === 'חדש' && sku('shirt').variants.map((v) => v.code + ':' + v.price + ':' + v.stock).join(',') === 's:null:1,m:12000:null',
    'merge: a tag with no <bent-variant> child keeps the product\'s options');
  doc.applyDocument('<bent-sku id="shirt"><bent-variant id="m" stock="4" /><bent-variant id="s" /></bent-sku>');
  ok(sku('shirt').variants.map((v) => v.code + ':' + v.label + ':' + v.price + ':' + v.stock).join(',') === 'm:M:12000:4,s:S:null:1',
    'merge: an option that is named keeps the label, price and stock its tag does not carry');
  doc.applyDocument('<bent-sku id="soap" status="hidden" /><bent-sku id="mug" title="ספל גדול" />');
  ok(sku('soap').status === 'hidden' && sku('mug').status === 'active' && sku('mug').title === 'ספל גדול' && sku('card').status === 'active',
    'merge: status is kept too (a hidden product is not un-hidden by a tag that does not mention it), and nothing is hidden');
  doc.applyDocument('<bent-sku id="soap" status="active" /><bent-sku id="lavender" badge="מבצע" featured="true" tags="סויה, בעבודת יד" image="/assets/lav-1.webp" />');

  const whole = exported.replace(/<bent-sku id="lavender"[^>]*>/, '<bent-sku id="lavender" title="נר לבנדר" price="89.90">');
  const wholePlan = doc.planDocument(whole);
  doc.applyDocument(whole, { force: true });
  const bare = sku('lavender');
  ok(wholePlan.preview.changed.some((c) => c.id === 'lavender' && ['מותג', 'תגיות', 'מומלץ', 'ברקוד', 'משקל', 'SEO'].every((l) => c.fields.some((f) => f.indexOf(l) === 0))),
    'replace: the preview names the new fields a whole document would clear (מותג, תגיות, מומלץ, ברקוד, משקל, SEO)');
  ok(bare.brand === '' && bare.tags.length === 0 && bare.featured === false && bare.barcode === '' && bare.weight === null && bare.seoTitle === '' && bare.badge === '' &&
    bare.shelf === '' && bare.images.length === 0 && bare.stock === 2 && bare.cost === 3137,
  'replace: in a whole-catalog document an absent attribute IS cleared — except stock (kept) and cost (never the document\'s)');
  doc.undoLast();
  ok(sku('lavender').brand === 'נועה' && sku('lavender').weight === 320 && sku('lavender').shelf === 'her' && sku('lavender').featured === true, 'replace: …and the undo puts every one of them back');

  // ── shelves through the document ─────────────────────────────────────
  const nest = doc.applyDocument('<bent-store mode="merge"><bent-shelf id="kid" label="ילד" parent="elder" picture="/assets/kid.webp" description="שורת טקסט" /><bent-shelf id="elder" label="אב" /></bent-store>');
  ok(nest.ok && catalog.getShelf('kid').parent === 'elder' && catalog.getShelf('kid').image === '/assets/kid.webp' && catalog.getShelf('kid').summary === 'שורת טקסט' &&
    nest.preview.shelvesAdded.join(',') === 'ילד,אב',
  'shelves: a child may come BEFORE its parent in a document; picture → image and description → summary are read');
  ok(catalog.getShelf('kid').sort > catalog.getShelf('her').sort && catalog.getShelf('home').sort === 0, 'integrity: a merge puts new shelves after the ones that exist and leaves their order alone');
  const deep = doc.planDocument('<bent-store mode="merge"><bent-shelf id="grandkid" label="נכד" parent="kid" /><bent-shelf id="lost" label="אבוד" parent="ghost" /><bent-shelf id="elder" label="אב קדמון" /></bent-store>');
  ok(deep.warnings.some((w) => w.code === 'SHELF_TOO_DEEP' && !w.hard) && deep.warnings.some((w) => w.code === 'SHELF_PARENT_MISSING' && !w.hard) &&
    deep.plan.shelves.find((s) => s.slug === 'grandkid').parent === '' && deep.plan.shelves.find((s) => s.slug === 'lost').parent === '',
  'shelves: a second level (SHELF_TOO_DEEP) and a missing parent (SHELF_PARENT_MISSING) are flattened to top-level, softly');
  ok(deep.preview.shelvesChanged.join(',') === 'אב קדמון' && deep.preview.shelvesAdded.join(',') === 'נכד,אבוד', 'shelves: the preview lists the existing shelves whose fields change (shelvesChanged) beside the new ones');
  const kidKept = doc.applyDocument('<bent-store mode="merge"><bent-shelf id="kid" label="ילדון" /></bent-store>');
  ok(kidKept.ok && catalog.getShelf('kid').label === 'ילדון' && catalog.getShelf('kid').parent === 'elder' && catalog.getShelf('kid').image === '/assets/kid.webp',
    'shelves: a merge keeps the shelf fields its tag does not carry');
  const reordered = doc.exportDocument().replace(/  <bent-shelf id="elder"[^\n]*\n/, '').replace('  <bent-shelf id="home"', '  <bent-shelf id="elder" label="אב" />\n  <bent-shelf id="home"');
  const reorderPlan = doc.applyDocument(reordered, { force: true });
  ok(reorderPlan.ok && catalog.listShelves().filter((s) => s.depth === 0).map((s) => s.slug).join(',') === 'elder,home,gifts' && catalog.getShelf('kid').parent === 'elder',
    'integrity: a whole document\'s shelf order becomes the shelves\' sort');
  doc.undoLast();
  catalog.deleteShelf('kid');
  catalog.deleteShelf('elder');

  // ── product order ────────────────────────────────────────────────────
  const orderBefore = catalog.listProducts({ status: 'all' }).map((p) => p.slug).join(',');
  doc.applyDocument('<bent-sku id="shirt" badge="" /><bent-sku id="newcomer" title="חדש בחנות" price="3" />');
  const orderAfter = catalog.listProducts({ status: 'all' }).map((p) => p.slug).join(',');
  ok(orderAfter === orderBefore + ',newcomer', 'integrity: a merge keeps the place of the products it updates and puts a new one LAST (a fragment used to throw its product to the top)');
  const flipped = dialect.parseStoreDoc(doc.exportDocument()).doc;
  flipped.products.reverse();
  doc.applyDocument(dialect.serializeStore(flipped), { force: true });
  ok(catalog.listProducts({ status: 'all' }).map((p) => p.slug).join(',') === orderAfter.split(',').reverse().join(','), 'integrity: a whole document\'s product order is the order');
  doc.undoLast();
  catalog.deleteProduct('newcomer');

  // ── a SKU of digits ──────────────────────────────────────────────────
  const rowOne = catalog.getProduct(1);
  const digits = doc.applyDocument('<bent-sku id="1" title="מוצר שהמק״ט שלו 1" price="5" />');
  ok(digits.ok && digits.preview.added.length === 1 && catalog.getProduct(1).title === rowOne.title && catalog.getProduct(1).price === rowOne.price && sku('1').title === 'מוצר שהמק״ט שלו 1',
    'integrity: <bent-sku id="1"> ADDS a product "1" — it used to overwrite whatever sat in database row #1');
  catalog.deleteProduct(sku('1').id);

  // ── the store's own export always comes back ─────────────────────────
  const longUrls = Array.from({ length: 12 }, (_, i) => 'https://cdn.example.com/' + 'p'.repeat(440) + i + '.webp');
  catalog.createProduct({ slug: 'gallery', title: 'ספר “הנסיך” הקטן', price: '70', images: longUrls, summary: 'מהדורת ג’ינס', description: 'ציטוט: “כל המבוגרים היו פעם ילדים”.' });
  const big = doc.exportDocument();
  const galleryTag = /  <bent-sku id="gallery"[^\n]*/.exec(big)[0];
  const bigPlan = doc.planDocument(big);
  ok(galleryTag.length > 4000 && bigPlan.ok && !bigPlan.hard && bigPlan.preview.hidden.length === 0 && bigPlan.preview.changed.length === 0 && bigPlan.preview.unchanged === 7,
    'integrity: a product whose tag passes 4000 characters (12 long picture addresses) comes back — it used to be dropped, then HIDDEN');
  ok(sku('gallery').title === 'ספר “הנסיך” הקטן' && !/[“”’]/.test(galleryTag) && dialect.parseStoreDoc(big).doc.products.find((p) => p.id === 'gallery').title === 'ספר “הנסיך” הקטן',
    'integrity: curly quotes inside a title survive a paste (they used to be straightened and cut the title short)');
  const rules = dialect.parseStoreDoc(big).doc.rules;
  ok(/thanks="תודה רבה!&#10;נחזור אליכם בהקדם\."/.test(big) && rules && rules.thanks === 'תודה רבה!\nנחזור אליכם בהקדם.' && rules.vat === '18',
    'integrity: a two-line "thanks" travels as &#10; and comes back two lines — it used to cost the document its whole rules tag');
  ok(dialect.parseStoreDoc('<bent-sku id="x" title="a&#10;b &#x5d0; &#8362; &#7; &amp;lt;" price="1" />').doc.products[0].title === 'a\nb א ₪ &#7; &lt;',
    'dialect: numeric entities are read (decimal and hex) — a control character is not, and &amp;lt; stays the text "&lt;"');
  const legacy = '<bent-store version="1">\n  <bent-store-rules vat="17" thanks="שורה אחת\nשורה שתיים" />\n  <bent-sku id="old" title="ישן “מאוד”" price="5" />\n</bent-store>\n';
  const legacyStrict = dialect.parseStoreDoc(legacy);
  const legacyTrusted = dialect.parseStoreDoc(legacy, { trusted: true });
  ok(legacyStrict.doc.rules === null && legacyStrict.notes.some((n) => n.code === 'TAG_SKIPPED') && legacyTrusted.doc.rules.thanks === 'שורה אחת\nשורה שתיים' &&
    legacyTrusted.doc.products[0].title === 'ישן “מאוד”' && !legacyTrusted.notes.some((n) => n.code === 'CURLY_QUOTES'),
  'integrity: a backup an older build wrote (a raw line break inside thanks="…", raw curly quotes) is read whole by the trusted reader — and a paste that loses the tag now SAYS so');
  const broken = doc.planDocument('<bent-store><bent-sku id="lavender" title="נר\nלבנדר" price="89.90" /><bent-sku id="card" title="כרטיס ברכה" price="12" /></bent-store>');
  ok(broken.warnings.some((w) => w.code === 'TAG_SKIPPED' && w.hard) && broken.hard, 'integrity: in a whole-catalog document a product tag that could not be read needs a confirmation (TAG_SKIPPED), not a silent hide');
  const notes = dialect.parseStoreDoc('<bent-store version="7"><bent-sku id="a" title="א" price="1" vendor="מותג" supplier-code="zz" /><bent-shelf id="s" label="ש" colour="red" /></bent-store>');
  ok(notes.notes.some((n) => n.code === 'VERSION_NEWER') && notes.notes.some((n) => n.code === 'ATTR_UNKNOWN' && /supplier-code/.test(n.message)) &&
    notes.notes.some((n) => n.code === 'ATTR_UNKNOWN' && /colour/.test(n.message)) && notes.doc.products[0].brand === 'מותג' && notes.notes.some((n) => n.code === 'ATTR_ALIAS'),
  'integrity: an attribute nobody reads is said (ATTR_UNKNOWN), a newer version is said (VERSION_NEWER); vendor → brand is an alias');
  const aliases = dialect.parseStoreDoc('<bent-sku id="a" title="א" price="1" manufacturer="מ" gtin="729" keywords="x,y" meta-title="ט" meta_description="ד" featured weight="1.2kg" />').doc.products[0];
  ok(aliases.brand === 'מ' && aliases.barcode === '729' && aliases.tags === 'x, y' && aliases.seoTitle === 'ט' && aliases.seoDescription === 'ד' && aliases.featured === 'true' &&
    doc.planDocument('<bent-sku id="a" title="א" price="1" weight="1.2kg" />').plan.products[0].weight === 1200,
  'dialect: manufacturer, gtin/ean/upc, keywords, meta-title, meta-description; a bare `featured` is on; weight reads "1.2kg" as 1200 grams');

  // ── a backup is checked before the apply it protects ─────────────────
  const alone = doc.backup('admin:delete:gallery');
  ok(alone > 0 && doc.listBackups()[0].reason === 'admin:delete:gallery' && /^<bent-store/.test(doc.getBackup(alone).source), 'backup(reason) works on its own, outside an apply (the admin\'s delete calls it)');
  catalog.deleteProduct('gallery');
  const back = doc.undoLast();
  ok(back.ok && !!sku('gallery') && sku('gallery').images.length === 12 && sku('gallery').title === 'ספר “הנסיך” הקטן', 'backup: …and an undo brings the deleted product back whole');
  db.prepare("INSERT INTO store_products (slug, title, price) VALUES (' untrimmed ', 'מזהה שאי אפשר לקרוא חזרה', 100)").run();
  const backupsBefore = doc.listBackups().length;
  const refused = doc.applyDocument('<bent-sku id="card" price="13" />');
  ok(throws(() => doc.backup('x'), /לא נקרא חזרה/) && refused.ok === false && refused.code === 'BACKUP_FAILED' && /לא נקרא חזרה/.test(refused.message) &&
    sku('card').price === 1200 && doc.listBackups().length === backupsBefore,
  'integrity: a backup that does not read back product for product THROWS, and the apply it was for writes nothing (BACKUP_FAILED)');
  db.prepare("DELETE FROM store_products WHERE slug = ' untrimmed '").run();

  // ── "not counted" comes back ─────────────────────────────────────────
  ok(/<bent-sku id="card"[^>]* stock="unlimited"/.test(doc.exportDocument()) && /<bent-variant id="m"[^>]* stock="4"/.test(doc.exportDocument()), 'document: stock that is not counted is written stock="unlimited"');
  const uncounted = doc.backup('before-count');
  catalog.setStock('card', '', 5);
  const recount = doc.restoreBackup(uncounted);
  ok(recount.ok && sku('card').stock === null, 'integrity: a backup taken while stock was "not counted" puts "not counted" back (it used to leave the 5)');
  catalog.deleteProduct('gallery');

  // ── CSV ──────────────────────────────────────────────────────────────
  catalog.createProduct({ slug: 'formula', title: '=HYPERLINK("https://evil.example","לחצו")', price: '1', summary: '-10% היום', badge: '+1', brand: '@home' });
  catalog.updateProduct('shirt', { variants: [{ code: 's', label: 'S | קטן; צר 100%', stock: 1 }, { code: 'm', label: 'M', price: '120' }] });
  const csv = csvIo.exportCsv();
  ok(csv.charCodeAt(0) === 0xfeff && csv.indexOf('"sku","title","price","compare_at","cost","stock","category","brand","tags","status","featured","barcode","weight","badge","summary","description","image","images","delivery","max_per_order","seo_title","seo_description","variants"\r\n') === 1,
    'csv: BOM, the agreed header, CRLF, every cell quoted (src/csv.js wrote it)');
  ok(csv.includes('"\'=HYPERLINK(""https://evil.example"",""לחצו"")"') && csv.includes('"\'-10% היום"') && csv.includes('"\'+1"') && csv.includes('"\'@home"'),
    'csv: a cell that starts with = + - @ is guarded — data, never a formula');
  ok(csv.includes('"lavender","נר לבנדר","89.90","120","31.37","2","מתנות ושי > בשבילה","נועה","סויה, בעבודת יד","active","true","72900012-345","320"') && csv.includes('"/assets/lav-1.webp","/assets/lav-2.webp","true","3"') &&
    csv.includes('"s|S %7C קטן%3B צר 100%25||1;m|M|120|"'),
  'csv: money in major units, the owner\'s cost, "parent > child" by name, tags, pictures, options as code|label|price|stock');
  const sheet = csvIo.csvToDocument(csv);
  const sheetPlan = doc.planDocument(sheet.source, { trusted: true });
  ok(sheet.ok && sheet.count === 7 && sheet.errors.length === 0 && /^<bent-store version="1" mode="merge">/.test(sheet.source) && !/cost/i.test(sheet.source),
    'csv → document: a <bent-store mode="merge"> document with every row — and no cost in it');
  ok(sheetPlan.ok && !sheetPlan.hard && sheetPlan.preview.mode === 'merge' && sheetPlan.preview.changed.length === 0 && sheetPlan.preview.added.length === 0 && sheetPlan.preview.unchanged === 7 &&
    sheetPlan.preview.shelvesAdded.length === 0 && sheetPlan.preview.shelvesChanged.length === 0 && sheetPlan.preview.hidden.length === 0,
  'csv: export → csvToDocument → planDocument changes NOTHING on the same store (formula guards come back off, options and shelves resolve)');
  ok(JSON.stringify(sheet.costs) === JSON.stringify({ card: 55, lavender: 3137, soap: 777 }) || (sheet.costs.lavender === 3137 && sheet.costs.soap === 777 && sheet.costs.card === 55 && Object.keys(sheet.costs).length === 3),
    'csv: costs come back beside the document, by SKU, only where the cell was filled');

  const woo = String.fromCharCode(0xfeff) + [
    'ID;Type;SKU;Name;Regular price;Sale price;Categories;Images;Published;Stock;Vendor;Weight (kg);Body (HTML);Variant SKU;Mystery',
    '501;simple;W-100;"Wool hat";120;90;"Winter > Hats, Sale";"https://cdn.example.com/hat-1.webp, https://cdn.example.com/hat-2.webp";1;4;Woolly;0.3;"<p>Warm &amp; soft.</p><p>Hand made<br>in a small shop.</p>";ignored;?',
    '502;simple;W-200;"Plain scarf";60;;Winter;;0;;;;;;'
  ].join('\r\n') + '\r\n';
  const wooDoc = csvIo.csvToDocument(woo);
  const wooPlan = doc.planDocument(wooDoc.source, { trusted: true });
  const hat = wooPlan.plan.products.find((p) => p.slug === 'w-100');
  const scarf = wooPlan.plan.products.find((p) => p.slug === 'w-200');
  ok(wooDoc.ok && wooDoc.count === 2 && !!hat && hat.title === 'Wool hat' && hat.price === 9000 && hat.compareAt === 12000 && hat.stock === 4 && hat.brand === 'Woolly' &&
    hat.images.join(' ') === 'https://cdn.example.com/hat-1.webp https://cdn.example.com/hat-2.webp' && hat.status === 'active',
  'csv: a WooCommerce sheet maps (BOM, semicolons, SKU/Name/Regular price/Sale price/Vendor/Images) — sale < regular makes price = sale, was = regular');
  ok(!!scarf && scarf.price === 6000 && scarf.compareAt === null && scarf.status === 'hidden' && scarf.stock === null && hat.shelf === 'hats' && scarf.shelf === 'winter' &&
    wooPlan.plan.shelves.map((s) => s.slug + '<' + s.parent).join(',') === 'winter<,hats<winter' && wooPlan.preview.shelvesAdded.join(',') === 'Winter,Hats',
  'csv: "Winter > Hats" creates both shelves, the child under its parent; Published 0 is hidden; empty stock is "not counted"');
  ok(!wooPlan.plan.products.some((p) => p.slug === '501' || p.shelf === 'simple') && hat.weight === 300 && hat.description === 'Warm & soft.\n\nHand made\nin a small shop.',
    'csv: the better-named column wins wherever it sits (SKU over ID, Categories over Type); Weight (kg) becomes grams; Body (HTML) becomes text');
  ok(wooDoc.warnings.some((w) => /Mystery/.test(w.message)) && !wooDoc.warnings.some((w) => /Variant SKU/i.test(w.message)), 'csv: a column nobody reads is named once; "Variant SKU" is known and ignored');

  const hebrew = 'מזהה,שם,מחיר,מחיר לפני,עלות,מלאי,קטגוריה,מותג,תגיות,סטטוס\n' +
    'he-1,"נר וניל",59,79,"21.5",8,לבית,נועה,"וניל, סויה",טיוטה\n' +
    'he-2,,10,,,,,,,\n' +
    'he-3,"נר עם\nשתי שורות",15,,,,,,,פעיל\n' +
    ',,,,,,,,,\n' +
    'he-4,"",20,,,,,,,\n';
  const heDoc = csvIo.csvToDocument(hebrew);
  const hePlan = doc.planDocument(heDoc.source, { trusted: true });
  const vanilla = hePlan.plan.products.find((p) => p.slug === 'he-1');
  ok(heDoc.ok && heDoc.count === 2 && vanilla.title === 'נר וניל' && vanilla.price === 5900 && vanilla.compareAt === 7900 && vanilla.stock === 8 && vanilla.shelf === 'home' &&
    vanilla.brand === 'נועה' && vanilla.tags.join('|') === 'וניל|סויה' && vanilla.status === 'draft' && heDoc.costs['he-1'] === 2150,
  'csv: Hebrew headers map (מזהה, שם, מחיר, מחיר לפני, עלות, מלאי, קטגוריה, מותג, תגיות, סטטוס) and a category is found by its name');
  ok(heDoc.errors.map((e) => e.line).join(',') === '3,6,7' && heDoc.errors.every((e) => /שם/.test(e.message)) && hePlan.plan.products.some((p) => p.slug === 'he-3' && p.title === 'נר עם שתי שורות'),
    'csv: a row without a title is reported by its line in the file (a quoted cell that spans two lines is counted) and skipped');

  const priceOnly = csvIo.csvToDocument('sku\tprice\nlavender\t95\ncard\t\n');
  const pricePlan = doc.planDocument(priceOnly.source, { trusted: true });
  ok(priceOnly.ok && pricePlan.preview.changed.length === 1 && pricePlan.preview.changed[0].id === 'lavender' && pricePlan.preview.changed[0].fields.length === 1 && pricePlan.preview.unchanged === 1,
    'csv: a sheet with only sku and price (tabs) changes prices and nothing else — a column the file does not have is left alone, and so is an empty price');
  const landed = doc.applyDocument(priceOnly.source, { trusted: true });
  ok(landed.ok && sku('lavender').price === 9500 && sku('lavender').brand === 'נועה' && doc.undoLast().ok && sku('lavender').price === 8990, 'csv: the import lands through the document door — backup first, and an undo takes it back');
  const stripped = csvIo.csvToDocument('sku,title,price,summary\nx1,"\'=1+1",5,"\'+972"\n');
  ok(doc.planDocument(stripped.source, { trusted: true }).plan.products[0].title === '=1+1' && doc.planDocument(stripped.source, { trusted: true }).plan.products[0].summary === '+972',
    'csv: the one guard apostrophe comes back off on import');
  ok(csvIo.csvToDocument('').ok === false && csvIo.csvToDocument('colour,size\nred,L\n').ok === false &&
    csvIo.csvToDocument('sku,title,price\n' + Array.from({ length: 501 }, (_, i) => 'r' + i + ',row,1').join('\n')).ok === false &&
    csvIo.csvToDocument('sku,title,price\na,"' + 'x'.repeat(2 * 1024 * 1024) + '",1\n').ok === false,
  'csv: an empty file, a sheet with no sku or title column, more than 500 rows and more than 2 MB are refused whole');
  catalog.deleteProduct('formula');

  // ── a catalog past every old ceiling ─────────────────────────────────
  const filler = 'מילים '.repeat(150).trim();
  db.transaction(() => {
    for (let i = 0; i < 520; i++) catalog.createProduct({ slug: 'bulk-' + i, title: 'מוצר ' + i, price: '10', stock: i % 7, description: filler });
  })();
  const total = catalog.countProducts().total;
  const huge = doc.exportDocument();
  ok(total === 526 && catalog.listProducts({ status: 'all', limit: 100000 }).length === total && (huge.match(/<bent-sku /g) || []).length === total && huge.length > dialect.MAX_CHARS,
    'integrity: the export holds EVERY product (526 — it used to stop at 500) however long it gets (' + huge.length + ' characters)');
  const hugeStrict = doc.planDocument(huge);
  const hugeTrusted = doc.planDocument(huge, { trusted: true });
  ok(hugeStrict.ok === false && hugeStrict.errors[0].code === 'REPLY_TOO_LONG' && hugeTrusted.ok && hugeTrusted.preview.unchanged === total && hugeTrusted.preview.hidden.length === 0,
    'integrity: a stranger\'s paste keeps its ceilings; the store\'s own text ({ trusted: true }) is read whole');
  const hugeBackup = doc.backup('before-big-change');
  catalog.updateProduct('bulk-519', { title: 'שונה' });
  const hugeRestore = doc.restoreBackup(hugeBackup);
  ok(hugeBackup > 0 && hugeRestore.ok && sku('bulk-519').title === 'מוצר 519' && catalog.countProducts().active === total - 1,
    'integrity: a 526-product, ' + Math.round(huge.length / 1000) + 'K backup is taken and restored (it used to answer REPLY_TOO_LONG / TOO_MANY_PRODUCTS)');

  // ── keep: a document written from a partial view says so ─────────────
  const keepDoc = dialect.parseStoreDoc('<bent-store mode="merge" keep="Description, summary picture nonsense id seo_title description"><bent-sku id="a" title="א" price="1" /></bent-store>');
  ok(keepDoc.doc && Array.isArray(keepDoc.doc.keep) && keepDoc.doc.keep.join(',') === 'description,summary,image,seo-title',
    'keep: the root\'s keep="…" is a list of attribute names (commas or spaces, any case, aliases settle: picture → image)');
  ok(keepDoc.notes.filter((n) => n.code === 'KEEP_UNKNOWN').length === 2 && keepDoc.notes.some((n) => n.code === 'KEEP_UNKNOWN' && /nonsense/.test(n.message)) &&
    !keepDoc.notes.some((n) => n.code === 'ATTR_UNKNOWN'),
  'keep: a word that names no attribute — and `id`, which can never be kept — is said (KEEP_UNKNOWN), and keep itself is a known attribute of the root');
  const keepText = dialect.serializeStore({ name: 'חנות', currency: 'ILS', mode: 'merge', keep: ['description', 'images'], products: [{ id: 'a', title: 'א', price: '1' }] });
  ok(/^<bent-store version="1" name="חנות" currency="ILS" mode="merge" keep="description,images">\n/.test(keepText) &&
    dialect.serializeStore(dialect.parseStoreDoc(keepText).doc) === keepText && !/ keep=/.test(doc.exportDocument()),
  'keep: the serializer writes it after mode, it round-trips, and the store\'s own export never carries one');

  // ── the AI catalog writer and a store that does not fit its prompt ───
  const ai = onFreshInstall(aiWriterFacts);
  ok(ai.seeded === 90, 'ai: (a second install with 90 products that have descriptions, summaries, pictures, brands, tags, SEO and two cost prices)');
  for (const [key, name] of [['he', 'the Hebrew lite prompt'], ['en', 'the English lite prompt'], ['full', 'the full prompt']]) {
    ok(typeof ai[key + 'Chars'] === 'number' && ai[key + 'Chars'] <= ai[key + 'Budget'] && ai[key + 'Budget'] === (key === 'full' ? 16000 : 9000),
      'ai: ' + name + ' stays inside its budget (' + ai[key + 'Chars'] + ' of ' + ai[key + 'Budget'] + ' characters, ' + ai[key + 'Shown'] + ' of 90 products shown, left out: ' + ai[key + 'Degraded'] + ')');
    ok(/descriptions/.test(String(ai[key + 'Degraded'])) && / mode="merge" keep="description[",]/.test(String(ai[key + 'Root'])),
      'ai: ' + name + ' — a view that left anything out is rooted mode="merge" keep="description,…" (it was a whole-catalog root over products with no descriptions)');
    ok(ai[key + 'Says'] === true && ai[key + 'Unseen'] === true, 'ai: ' + name + ' — one line says the view is partial (and how many products it had no room for), and the last line asks for the merge document');
    ok(ai[key + 'Echo'] === true && ai[key + 'EchoMode'] === 'merge' && ai[key + 'EchoHard'] === false && ai[key + 'EchoMoves'] === 0 && ai[key + 'EchoFields'] === '' && ai[key + 'EchoSame'] === true,
      'ai: ' + name + ' — echoing "the store today" back plans ZERO changes: nothing changed, hidden, added or switched off (it planned "תיאור" on every product it showed)');
    ok(ai[key + 'Grammar'] === '', 'ai: ' + name + ' teaches the new vocabulary — parent, hidden, brand, tags, featured, barcode, weight, seo-title, seo-description, demo, and that there is no cost' +
      (ai[key + 'Grammar'] ? ' — missing: ' + ai[key + 'Grammar'] : ''));
    ok(ai[key + 'NoCost'] === true, 'ai: ' + name + ' carries no cost price');
  }
  ok(ai.heShown >= 30 && ai.heShown < 90 && ai.enShown >= ai.heShown && ai.fullShown === 90 && /products/.test(String(ai.heDegraded)) && !/products/.test(String(ai.fullDegraded)),
    'ai: the view drops fields before it drops products, and products only when it must (lite: ' + ai.heShown + ' and ' + ai.enShown + ' of 90 on a line each; the full prompt shows all 90; the old lite view kept 9 of the demo\'s 24)');
  ok(ai.view === true && ai.echoApplied === true && ai.echoAppliedSame === true, 'ai: …and really applying the echo leaves every product and category exactly as it was — descriptions, summaries, pictures, SEO, cost');
  ok(ai.keepOnlyMode === 'replace' && ai.keepOnlyLost === 0 && ai.keepOnlyShelves === 0 && !/BLANKED/.test(String(ai.keepOnlyCodes)),
    'keep: a reply that kept the keep list but dropped mode="merge" still blanks nothing — a kept attribute a tag does not carry stays, in either mode, on products and categories');
  ok(ai.keepOnlyHidden === 90 - ai.heShown && ai.keepOnlyHidden > 0 && /MANY_HIDDEN!/.test(String(ai.keepOnlyCodes)),
    'keep: …and the ' + ai.keepOnlyHidden + ' products the view had no room for are not hidden without a yes');
  ok(ai.plainHides === '2:false:' && ai.keepHides === '2:true:MANY_HIDDEN!',
    'keep: a document that says keep is partial by its own word — even two hidden products are a hard warning there (two of ninety in a plain whole document are an edit)');
  ok(ai.bareHard === true && /BLANKED!/.test(String(ai.bareCodes)) && /מוצרים יישארו בלי/.test(String(ai.bareMessage)),
    'BLANKED: a reply that dropped both (a whole-catalog document without the descriptions — what 2.68 planned without a word) is HARD: ' + String(ai.bareMessage).slice(0, 60) + '…');
  ok(ai.barePackHard === true && /^HARD_WARNINGS:.*BLANKED/.test(String(ai.barePackApply)) && ai.bareRefusedSame === true,
    'BLANKED: the AI door shows it as a hard warning and refuses to apply without a yes — nothing was written');
  ok(/(^|,)BLANKED(,|$)/.test(String(ai.hardCodes)) && /(^|,)TAG_SKIPPED(,|$)/.test(String(ai.hardCodes)), 'ai: BLANKED and TAG_SKIPPED are among the pack\'s hard codes (the chat door asks too)');
  ok(ai.wholeMoves === 0 && ai.twoCodes === '2:false:' && ai.threeCodes === '3:true:BLANKED!',
    'BLANKED: a whole document that empties TWO descriptions is an edit; one that empties THREE needs a yes');
  ok(ai.mergeSilent === '5:false:' && ai.mergeTwo === 'false:' && ai.mergeSummaries === 'true:BLANKED!' && ai.mergePictures === 'true:BLANKED!' && ai.mergeOnePicture === 'false:',
    'BLANKED: whatever the mode — three summaries cleared, or three whole picture sets, in a merge; an ordinary five-product edit, or one picture of three, does not ask');
  ok(ai.keepReplace === true && ai.keepStated === true, 'keep: in a whole document a kept attribute the tag does not carry stays (description, summary) while the rest is cleared as before; one the tag DOES carry is what it says');
  ok(ai.keepCleared === true && ai.keepNew === true, 'keep: description="" still clears under keep, and a new product is not touched by it');
  ok(ai.keepShelf === '0:/assets/home.webp|כל מה שהבית צריך,|כלים למטבח', 'keep: a category keeps a listed attribute (picture, summary) the same way');
  ok(ai.untouched === true, 'ai: (none of those plans wrote anything)');

  // ── a backup remembers what products cost ────────────────────────────
  ok(names(db, 'store_backups').join(',') === 'id,reason,source,created_at,costs,state', 'schema: store_backups has the costs column and, after it, the state snapshot');
  const oldBackups = new Database(':memory:');
  oldBackups.exec("CREATE TABLE store_backups (id INTEGER PRIMARY KEY AUTOINCREMENT, reason TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  oldBackups.prepare("INSERT INTO store_backups (reason, source) VALUES ('apply', '<bent-store version=\"1\"></bent-store>')").run();
  initializeStore(oldBackups);
  initializeStore(oldBackups);
  const oldRow = oldBackups.prepare('SELECT * FROM store_backups').get();
  ok(shape(oldBackups, 'store_backups') === shape(db, 'store_backups') && oldRow.reason === 'apply' && oldRow.source === '<bent-store version="1"></bent-store>' && oldRow.costs === null,
    'schema: a 2.68 backups table gains the column once (same shape as a fresh one) and its backups keep NO cost note');
  oldBackups.close();

  const bk = onFreshInstall(backupCostFacts);
  ok(bk.csvLanded === '6000,3150,700', 'backup: (a CSV import lands a price and two cost prices: ₪60, cost ₪31.50 and ₪7)');
  ok(bk.csvUndo === '5000,2000,7654321,,' && bk.csvUndoCount === 2,
    'backup: "ביטול החלה אחרונה" after a CSV import puts the cost prices back with the price — 2000 again, and none where there was none (it left the imported 3150 standing)');
  ok(bk.csvRedo === '6000,3150,700' && bk.csvBack === '5000,2000,', 'backup: an undo can itself be undone, cost prices and all — and undone again');
  ok(bk.deleted === 'a,b:gone:gone' && bk.deleteUndo === '5000,2000,7654321,',
    'backup: a bulk delete is backed up first, and undoing it brings the products back WITH their cost prices (they came back with none)');
  ok(bk.restore === '2000,,400,2', 'backup: restoring a backup by its id does the same — a cost that was changed goes back, one that did not exist is cleared, and a product made after the backup keeps its own');
  ok(bk.column === true && bk.older === '999,444,0' && bk.unreadable === 999,
    'backup: a backup taken before this release has no cost note (nor one that cannot be read) — restoring it leaves every cost price as it is');
  ok(bk.noteKept === true && bk.leaks === '',
    'cost: the note sits beside the document, never in it — the export, every backup\'s document, the backup list, the site package and the AI prompt hold no cost' + (bk.leaks ? ' — LEAK: ' + bk.leaks : ''));

  // ── a demo payment outside a demo shop ───────────────────────────────
  ok(bk.demoReal === 'soft', 'demo: a document that lists a `demo` payment in a real shop is told it will not be offered (DEMO_NOT_OFFERED, soft)');
  ok(bk.demoSetting === 'none,soft' && bk.demoArmed === 'none,soft' && bk.demoSite === 'none',
    'demo: …and is not told so where it IS offered — the store setting on, a host armed for the demo seed, a demo site');
  ok(bk.demoNoAttr === true, 'demo: no document can switch demo payments on, or set the auto-cancel hours — neither is an attribute (both are said as unread)');

  // ── an undo must undo: what the document leaves unsaid ───────────────
  const upgraded = new Database(':memory:');
  upgraded.exec("CREATE TABLE store_backups (id INTEGER PRIMARY KEY AUTOINCREMENT, reason TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, costs TEXT)");
  upgraded.prepare("INSERT INTO store_backups (reason, source, costs) VALUES ('apply', '<bent-store version=\"1\"></bent-store>', '{}')").run();
  initializeStore(upgraded);
  initializeStore(upgraded);
  ok(shape(upgraded, 'store_backups') === shape(db, 'store_backups') && names(upgraded, 'store_backups').includes('state') && upgraded.prepare('SELECT * FROM store_backups').get().state === null,
    'schema: a backups table from before the snapshot gains the `state` column once (same shape as a fresh one) and its backups keep NO snapshot');
  upgraded.close();

  const st = onFreshInstall(backupStateFacts);
  const DEFAULT_RULES = '0,3,false,false,default,-';
  const DOC_RULES = '10000,9,true,true,תודה אחרת,takanon';
  ok(st.exportSaysNone === true && st.before === DEFAULT_RULES + ' / -|none|phone / none',
    'undo: (a store with every rule at its default, no name, no shipping method and no coupon — and its export says none of them)');
  ok(st.set === DOC_RULES + ' / שם מהמסמך|courier|phone / none', 'undo: (one document sets a minimum order, the low-stock mark, require-email, VAT-exempt, the thanks line, a terms page, a name and a shipping method)');
  ok(st.undone === DEFAULT_RULES + ' / -|none|phone / none',
    'undo: "ביטול החלה אחרונה" puts every rule back to its default, clears the terms page and the name, and empties the shipping list (all of them stayed as the document set them)');
  ok(st.exportBack === true, 'undo: …and the store\'s export is again the text it was, byte for byte');
  ok(st.redone === DOC_RULES + ' / שם מהמסמך|courier|phone / none' && st.undoneAgain === DEFAULT_RULES + ' / -|none|phone / none / true',
    'undo: the undo can itself be undone — the document\'s rules return — and undone again');
  ok(st.couponSet === 'HALF:on' && st.couponUndone === 'HALF:off',
    'undo: the FIRST coupon of a store that had none is switched off by the undo (it stayed active: the backup had no coupon section)');
  ok(st.couponRedone === 'HALF:on' && st.couponBack === 'HALF:off', 'undo: …on again when the undo is undone, and off again after that');
  ok(st.couponsSet === 'HALF:off,NEW:on,OLD:off,TEN:off' && st.couponsUndone === 'HALF:off,NEW:off,OLD:off,TEN:on',
    'undo: among coupons that exist, each gets the on/off it had — one a document switched off is on again, one that was off stays off, a new one is off');
  ok(st.restore === '5000,3,false,true,default,other / שם אחר|post|none / HALF:off,LATE:on,NEW:off,OLD:off,TEN:on => ' + DEFAULT_RULES + ' / -|none|phone / HALF:off,LATE:off,NEW:off,OLD:off,TEN:on',
    'restore: a backup by its id puts the same state back over changes made on the settings and coupons screens — rules, name, both lists, coupons');
  ok(st.outside === '5,true,owner@shop.example,true' &&
    st.stateKeys === 'currency,lowStock,minOrder,name,orderStart,payments,pricesIncludeVat,requireEmail,shipping,terms,thanks,vatExempt,vatRate',
    'restore: NOT a backup\'s to move — the open switch, demoPayments, holdHours, the owner\'s mail: a restore leaves them, and the snapshot does not hold them');
  ok(st.older === 7000 && st.unreadable === 8000,
    'restore: a backup taken before the snapshot existed (or one whose snapshot cannot be read) says no more than its document — as it always did');
  ok(st.beside === true, 'backup: the snapshot sits beside the document, never in it — a backup\'s own text is still the export, and the backups list does not carry it');
} catch (e) {
  console.error(e);
  failed++;
}

console.log('\nSMOKE STORE-CATALOG: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
