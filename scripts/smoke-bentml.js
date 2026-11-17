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

// 4ב. inline-mark braces must not close a text body (v2.13 — found live:
// `TEXT { @B{הטמעת YouTube} — מדביקים }` was cut at the mark's brace)
try {
  const doc = 'BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\n' +
    'TEXT { @B{הטמעת YouTube} — מדביקים קישור ציבורי: }\n';
  const r = compile(doc);
  const content = r.blocks[0].data.content;
  check('mark brace does not close a one-line TEXT body',
    content === '@B{הטמעת YouTube} — מדביקים קישור ציבורי:');
} catch (e) {
  check('mark brace does not close a one-line TEXT body', false, e.toString());
}

try {
  const doc = 'BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\n' +
    'TEXT {\n  @I{שלוש הסצנות צוירו על ידי הבינה.}\n}\n\nHEADING { אחרי }\n';
  const r = compile(doc);
  check('TEXT whose body is only a mark parses (no E102 on the next line)',
    r.blocks.length === 2 && r.blocks[0].data.content === '@I{שלוש הסצנות צוירו על ידי הבינה.}' &&
    r.blocks[1].type === 'heading');
} catch (e) {
  check('TEXT whose body is only a mark parses (no E102 on the next line)', false, e.toString());
}

try {
  const doc = 'BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\n' +
    'TEXT { לפני @LINK(url: "/הבינה.html"){הקישור} אחרי }\n';
  const r = compile(doc);
  check('@LINK(url){label} survives inside a one-line body',
    r.blocks[0].data.content === 'לפני @LINK(url: "/הבינה.html"){הקישור} אחרי');
} catch (e) {
  check('@LINK(url){label} survives inside a one-line body', false, e.toString());
}

// 4ג. SPACE carries an exact height (v2.13 — drag-resize wrote 106px and the
// code tab flattened it back to the size enum)
try {
  const doc = 'BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\nSPACE(height: 106px)\n';
  const r = compile(doc);
  check('SPACE(height: 106px) compiles to an exact spacer height',
    r.blocks[0].type === 'spacer' && r.blocks[0].data.height === '106px');
} catch (e) {
  check('SPACE(height: 106px) compiles to an exact spacer height', false, e.toString());
}

try {
  compile('BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\nSPACE(height: banana)\n');
  check('E305 on a nonsense SPACE height', false);
} catch (e) {
  check('E305 on a nonsense SPACE height', e instanceof BentmlError && e.code === 'E305');
}

try {
  const src = compile('BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\nSPACE(height: 106px)\n');
  const round = decompile({ title: 't' }, src.blocks);
  check('decompile emits SPACE(height: 106px) — lossless round-trip',
    /SPACE\(height: 106px\)/.test(round));
  const again = compile(round);
  check('height survives decompile → compile',
    again.blocks[0].data.height === '106px');
} catch (e) {
  check('SPACE height round-trip', false, e.toString());
}

// enum-height spacers keep decompiling to the size name, not a raw height
try {
  const src = compile('BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\nSPACE(size: lg)\n');
  const round = decompile({ title: 't' }, src.blocks);
  check('SPACE(size: lg) still decompiles to the size name',
    /SPACE\(size: lg\)/.test(round) && !/height:/.test(round));
} catch (e) {
  check('SPACE(size: lg) still decompiles to the size name', false, e.toString());
}

// 5. back-compat: 0.1 documents still compile after the 0.2 bump
try {
  const legacy = compile('BENTML 0.1\n\nMETA {\n  title: "ישן"\n}\n\nTEXT { עדיין עובד }\n');
  check('BENTML 0.1 doc still compiles', legacy.blocks.length === 1 && legacy.blocks[0].type === 'text');
} catch (e) {
  check('BENTML 0.1 doc still compiles', false, e.toString());
}

// 6. the builder's source panel routes the OTHER dialect to the server.
// The 🧠 prompt teaches AIs to answer in <bent-*> .pzn; pasting that reply
// into the panel used to die in the line engine ("Expected version line
// BENTML 0.2") without ever reaching the dual-dialect server compile —
// Grok/GPT/Gemini all "failed" identically. Pin the client-side gate.
{
  const fs = require('fs');
  const path = require('path');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-bentml-ui.js'), 'utf8');
  check('panel keeps the pzn sniffer as the no-engine fallback (looksLikePznSource)', ui.includes('function looksLikePznSource'));
  // v2.20: the bundled extractor runs FIRST (fence / chat / <html> brackets
  // gone), THEN the dialect chooses the engine — pzn to the server, line local
  check('panel extracts before choosing an engine (E.extract)', /E\.extract\s*\?\s*E\.extract\(source\)/.test(ui));
  check('panel routes the pzn dialect to the server compile', /dialect\s*!==\s*'pzn'/.test(ui));
  check('panel maps error lines back through lineOffset', /lineOffset/.test(ui));
  check('panel file is plain text (no NUL bytes — git diffs it)', ui.indexOf('\u0000') === -1);
  const { buildBentmlEngine } = require('../src/bentml/browser-bundle');
  check('engine bundle exposes extract + sniffDialect', /extract: __mods\.extract\.extractBentml/.test(buildBentmlEngine()));
  // the sniffer must match what AIs actually return: a <bent-*> tag document
  const sniff = /<bent-[a-z]/i;
  check('sniffer regex matches a bent-tag reply', sniff.test('<!DOCTYPE html>\n<html bent-version="0.1"><body><bent-hero id="h"></bent-hero></body></html>'));
  check('sniffer regex leaves line-dialect sources alone', !sniff.test('BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\nTEXT { hi }\n'));
}

// 7. A hero's authored children survive the code tab (decompile → compile).
//    The flat title/subtitle/button mirrors stay, and a legacy hero does not
//    grow a data.blocks array.
{
  const { heroChildren } = require('../src/pzn/hero-children');
  const anchorOf = (b) => (b.data && b.data.id) || b.id;
  // key order is not data: TEXT writes align before size on the way back in
  const sortKeys = (v) => Array.isArray(v)
    ? v.map(sortKeys)
    : (v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
      : v);
  const norm = (b) => {
    const data = Object.assign({}, b.data || {});
    delete data.id;
    return sortKeys({ type: b.type, id: anchorOf(b), data });
  };
  const page = { title: 'פוסטר' };

  const rich = {
    type: 'hero',
    id: 'hero_rich',
    data: {
      image: '/uploads/bg.jpg',
      height: 'lg',
      title: 'כותרת',
      subtitle: 'שורה ראשונה',
      buttonText: 'קדימה',
      buttonUrl: '/go',
      blocks: [
        { type: 'heading', id: 'h_title', data: { level: 2, text: 'כותרת', align: 'center' } },
        { type: 'text', id: 't_lead', data: { content: 'שורה ראשונה', size: 'lg', align: 'center' } },
        { type: 'button', id: 'b_primary', data: { text: 'קדימה', url: '/go', variant: 'primary' } },
        { type: 'button', id: 'button_2_zz', data: { text: 'עוד', url: '/more', variant: 'secondary' } },
        { type: 'spacer', id: 'sp_gap', data: { size: 'xl', height: '4rem' } },
        { type: 'image', id: 'img_poster', data: { src: '/uploads/poster.jpg', alt: 'פוסטר', caption: '', width: 'full' } },
        { type: 'stats', id: 'st_row', data: { columns: 3, items: [{ value: '12', label: 'פרקים' }] } },
        { type: 'banner', id: 'bn_badge', data: { text: 'חדש', tone: 'brand', align: 'start' } },
        { type: 'text', id: 't_note', data: { content: 'שורה עם מזהה' } }
      ]
    }
  };
  const richSrc = decompile(page, [rich]);
  const richBack = compile(richSrc).blocks[0];
  const richAgain = decompile(page, [richBack]);
  check('rich hero decompile shows every child id',
    ['h_title', 't_lead', 'b_primary', 'button_2_zz', 'sp_gap', 'img_poster', 'st_row', 'bn_badge', 't_note']
      .every((id) => richSrc.includes('id: "' + id + '"')));
  check('rich hero decompile keeps the spacer and the second button',
    /SPACE\(size: xl, id: "sp_gap"\)/.test(richSrc) && /style: secondary, id: "button_2_zz"\) \{ עוד \}/.test(richSrc));
  check('compile(decompile(rich hero)) keeps every child type, id and data',
    JSON.stringify((richBack.data.blocks || []).map(norm)) === JSON.stringify(rich.data.blocks.map(norm)));
  check('a generated child id stays the block id',
    richBack.data.blocks[3].id === 'button_2_zz' && !richBack.data.blocks[3].data.id);
  check('flat fields mirror the first heading, text and button only',
    richBack.data.title === 'כותרת' && richBack.data.subtitle === 'שורה ראשונה' &&
    richBack.data.buttonText === 'קדימה' && richBack.data.buttonUrl === '/go');
  check('those mirrors do not rewrite the other children',
    JSON.stringify(heroChildren(richBack.data).map(norm)) === JSON.stringify(richBack.data.blocks.map(norm)));
  check('rich hero source is stable across a second decompile', richSrc === richAgain);

  // the live poster: pre-title text, title, subtitle, a 4rem gap, credits
  const poster = {
    type: 'hero',
    id: 'poster_hero',
    data: {
      title: 'שם הסרט',
      subtitle: 'בקרוב',
      buttonText: '',
      buttonUrl: '',
      blocks: [
        { type: 'text', id: 'poster_pre', data: { content: 'בקרוב' } },
        { type: 'heading', id: 'poster_title', data: { level: 1, text: 'שם הסרט' } },
        { type: 'text', id: 'poster_subtitle', data: { content: 'דרמה · 2026' } },
        { type: 'spacer', id: 'poster_gap', data: { size: 'xl', height: '4rem' } },
        { type: 'text', id: 'poster_credits', data: { content: 'במאי · שחקנים' } }
      ]
    }
  };
  const posterSrc = decompile(page, [poster]);
  check('poster_hero code tab shows the ids, the spacer and the credits',
    ['poster_pre', 'poster_title', 'poster_subtitle', 'poster_gap', 'poster_credits']
      .every((id) => posterSrc.includes('id: "' + id + '"')) &&
    /SPACE\(size: xl, id: "poster_gap"\)/.test(posterSrc) &&
    posterSrc.includes('במאי · שחקנים'));
  const posterBack = compile(posterSrc).blocks[0];
  check('poster_hero round trip keeps all five children',
    JSON.stringify((posterBack.data.blocks || []).map(norm)) === JSON.stringify(poster.data.blocks.map(norm)));
  check('poster_hero subtitle mirror is the first text (poster_pre), not the later ones',
    posterBack.data.subtitle === 'בקרוב' && posterBack.data.title === 'שם הסרט' &&
    posterBack.data.blocks.filter((b) => b.type === 'text').length === 3);

  // typing the spacer and credits into the code tab must not be discarded
  let typed;
  try {
    typed = compile('BENTML 0.2\n\nMETA {\n  title: "פוסטר"\n}\n\nHERO(id: "poster_hero") {\n  TEXT(id: "poster_pre") { בקרוב }\n  HEADING(level: 1, id: "poster_title") { שם הסרט }\n  TEXT(id: "poster_subtitle") { דרמה · 2026 }\n  SPACE(size: xl, id: "poster_gap")\n  TEXT(id: "poster_credits") { במאי · שחקנים }\n}\n');
    const kids = typed.blocks[0].data.blocks || [];
    check('a poster typed in the code tab compiles to five children',
      kids.map((b) => b.type).join(',') === 'text,heading,text,spacer,text' &&
      kids.map(anchorOf).join(',') === 'poster_pre,poster_title,poster_subtitle,poster_gap,poster_credits' &&
      kids[3].data.height === '4rem' && kids[3].data.size === 'xl');
  } catch (e) {
    check('a poster typed in the code tab compiles to five children', false, e.toString());
  }

  const legacy = {
    type: 'hero',
    id: 'hero_1_ab',
    data: { title: 'ברוכים הבאים', subtitle: 'תת כותרת', buttonText: 'CTA', buttonUrl: '/go', image: '/uploads/h.jpg', height: 'lg' }
  };
  const legacySrc = decompile(page, [legacy]);
  const legacyBack = compile(legacySrc).blocks[0];
  const legacyAgain = decompile(page, [legacyBack]);
  check('legacy hero decompiles to the flat trio, with no child ids',
    legacySrc.includes('HERO(image: "/uploads/h.jpg", height: lg) {\n  HEADING(level: 1) { ברוכים הבאים }\n  TEXT { תת כותרת }\n  BUTTON(url: "/go") { CTA }\n}') &&
    !legacySrc.includes('id:'));
  check('legacy hero round trip stores no data.blocks',
    !('blocks' in legacyBack.data) &&
    legacyBack.data.title === 'ברוכים הבאים' && legacyBack.data.subtitle === 'תת כותרת' &&
    legacyBack.data.buttonText === 'CTA' && legacyBack.data.buttonUrl === '/go' &&
    legacyBack.data.image === '/uploads/h.jpg' && legacyBack.data.height === 'lg');
  check('legacy hero source is unchanged by a round trip', legacySrc === legacyAgain);

  // the code tab runs the browser bundle, not the server require
  const { buildBentmlEngine } = require('../src/bentml/browser-bundle');
  const vm = require('vm');
  const window = {};
  vm.runInNewContext(buildBentmlEngine(), { window });
  const bundled = window.BentmlEngine.decompile(page, [poster], { withMap: true });
  check('browser engine decompiles poster_hero with its children',
    bundled.source === posterSrc && bundled.map.length === 1 && bundled.map[0].type === 'hero');
}

console.log(fail ? `\n${fail} failure(s)` : '\nAll bentml smoke checks passed');
process.exit(fail ? 1 : 0);
