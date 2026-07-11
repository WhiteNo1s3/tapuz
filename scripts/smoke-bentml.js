'use strict';

/**
 * Smoke: BenTML compile → JSON blocks → renderer HTML → decompile.
 * Spec source of truth: docs/bentml-v0.md / docs/bentml-cheatsheet.md
 */

const { compile, decompile, preview, BentmlError } = require('../src/bentml');

const sample = `BENTML 0.2

META {
  title: "המתכונים של סבתא"
  slug: "מתכונים"
  description: "כל המתכונים המשפחתיים"
  tags: ["בישול", "משפחה"]
  status: draft
}

HEADING(level: 1) { המתכונים של סבתא }

TEXT {
  כל המתכונים כאן עוברים מדור לדור.

  פסקה חדשה אחרי שורה ריקה.
}

IMAGE(src: "/uploads/soup.jpg", alt: "מרק", caption: "יום שישי")

ROW {
  COL {
    HEADING(level: 2) { מנות חמות }
    TEXT { מרקים. }
  }
  COL {
    HEADING(level: 2) { מאפים }
    TEXT { חלה. }
  }
}

BUTTON(url: "/contact", style: primary) { שלחו מתכון }

HERO {
  HEADING(level: 1) { ברוכים הבאים }
  TEXT { תת כותרת }
  BUTTON(url: "/go") { CTA }
}

LIST {
  ITEM { - אחד }
  ITEM { - שניים }
}

QUOTE(author: "סבתא") { מרק טוב לא ממהרים. }

EMBED(url: "https://youtu.be/abc123def45")

MAP(address: "דיזנגוף 99, תל אביב", zoom: 14, height: lg)

ARTICLES(tag: "article", limit: 3, columns: 2)

SPACE(size: lg)
DIVIDER
`;

let fail = 0;
function check(name, cond, detail) {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (detail && !cond ? ' — ' + detail : ''));
  if (!cond) fail++;
}

// 1. compile
let result;
try {
  result = compile(sample);
  check('compile ok', true);
} catch (e) {
  check('compile ok', false, e.toString());
  process.exit(1);
}

check('page title', result.page.title === 'המתכונים של סבתא');
check('page slug', result.page.slug === 'מתכונים');
check('direction rtl', result.page.direction === 'rtl');
check('has heading block', result.blocks.some((b) => b.type === 'heading'));
check('has text block', result.blocks.some((b) => b.type === 'text'));
check('has image block', result.blocks.some((b) => b.type === 'image' && b.data.src.includes('soup')));
check('has columns', result.blocks.some((b) => b.type === 'columns' && b.data.columns?.length === 2));
check('has button', result.blocks.some((b) => b.type === 'button' && b.data.url === '/contact'));
check('has hero', result.blocks.some((b) => b.type === 'hero' && b.data.title));
check('has list', result.blocks.some((b) => b.type === 'list' && b.data.items?.length === 2));
check('has quote', result.blocks.some((b) => b.type === 'quote'));
check('has embed', result.blocks.some((b) => b.type === 'embed'));
check('has article-list', result.blocks.some((b) => b.type === 'article-list'));
check(
  'has map (BENTML 0.2)',
  result.blocks.some(
    (b) => b.type === 'map' && b.data.address.includes('דיזנגוף') && b.data.zoom === 14 && b.data.height === 'lg'
  )
);

// 2. preview HTML via renderer
try {
  const prev = preview(sample);
  check('preview html', typeof prev.html === 'string' && prev.html.includes('<h1'));
  check('preview no bent keyword leak', !prev.html.includes('HEADING('));
  check('preview has figure or img', prev.html.includes('<img') || prev.html.includes('<figure'));
  check('preview has btn', prev.html.includes('btn'));
  check('preview has map figure', prev.html.includes('class="map-embed map-lg"'));
  check(
    'preview map iframe escaped',
    prev.html.includes('https://www.google.com/maps?q=' + encodeURIComponent('דיזנגוף 99, תל אביב')) &&
      prev.html.includes('&amp;z=14&amp;output=embed&amp;hl=he')
  );
  check('preview map title', prev.html.includes('title="מפה: דיזנגוף 99, תל אביב"'));
} catch (e) {
  check('preview html', false, e.message);
}

// 3. decompile round-trip structure
const src2 = decompile(result.page, result.blocks);
check('decompile has BENTML 0.2', src2.startsWith('BENTML 0.2'));
check('decompile has META', src2.includes('META {'));
check('decompile has HEADING', /HEADING/i.test(src2));
check('decompile has MAP', src2.includes('MAP(address: "דיזנגוף 99, תל אביב"'));

let result2;
try {
  result2 = compile(src2);
  check('recompile decompiled', true);
  check(
    'block count stable-ish',
    result2.blocks.length === result.blocks.length,
    `${result2.blocks.length} vs ${result.blocks.length}`
  );
  check(
    'types match',
    result2.blocks.map((b) => b.type).join() === result.blocks.map((b) => b.type).join()
  );
} catch (e) {
  check('recompile decompiled', false, e.toString());
}

// 4. errors
try {
  compile('not bentml');
  check('E001 on bad version', false);
} catch (e) {
  check('E001 on bad version', e instanceof BentmlError && e.code === 'E001');
}

try {
  compile('BENTML 0.1\n\nTEXT { hi }\n');
  check('E111 missing META', false);
} catch (e) {
  check('E111 missing META', e instanceof BentmlError && e.code === 'E111');
}

try {
  compile('BENTML 0.1\n\nMETA {\n  title: "t"\n}\n\nIMAGE\n');
  check('E306 IMAGE src required', false);
} catch (e) {
  check('E306 IMAGE src required', e instanceof BentmlError && e.code === 'E306');
}

try {
  compile('BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\nMAP\n');
  check('E306 MAP address required', false);
} catch (e) {
  check('E306 MAP address required', e instanceof BentmlError && e.code === 'E306');
}

// 5. back-compat: 0.1 documents still compile after the 0.2 bump
try {
  const legacy = compile('BENTML 0.1\n\nMETA {\n  title: "ישן"\n}\n\nTEXT { עדיין עובד }\n');
  check('BENTML 0.1 doc still compiles', legacy.blocks.length === 1 && legacy.blocks[0].type === 'text');
} catch (e) {
  check('BENTML 0.1 doc still compiles', false, e.toString());
}

console.log(fail ? `\n${fail} failure(s)` : '\nAll bentml smoke checks passed');
process.exit(fail ? 1 : 0);
