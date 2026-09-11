'use strict';

/**
 * QA — page-surface modules (SEARCH, NEWSLETTER, PAGER, CONSENT, RELATED,
 * COMMENTS, SLOT, AUTH). Human-fillable chrome that used to flatten into
 * form/nav/html leftovers.
 */

const pzn = require('../src/pzn/index');
const { renderBlock } = require('../src/renderer');
const { getBlockDef, defaultDataFor } = require('../src/block-registry');
const bentml = require('../src/bentml');
const { htmlToBlocks } = require('../src/pzn/graduate');
const { huntBlocks } = require('../src/pzn/hunt');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const searchBlock = {
  type: 'search', id: 's1',
  data: { placeholder: 'חיפוש באתר', action: '/search', name: 'q', submit: 'חיפוש' }
};
const newsBlock = {
  type: 'newsletter', id: 'n1',
  data: { title: 'הישארו מעודכנים', text: 'קבלו עדכונים.', placeholder: 'האימייל שלכם', submit: 'הרשמה', action: '/api/form' }
};
const pagerBlock = {
  type: 'pager', id: 'p1',
  data: { items: [{ label: '1', url: '/p/1' }, { label: '2', url: '/p/2' }, { label: '3', current: true }] }
};
const consentBlock = {
  type: 'consent', id: 'c1',
  data: { text: 'אתר זה משתמש בעוגיות.', accept: 'אישור', reject: 'סירוב', policy: '/privacy', policyLabel: 'מדיניות פרטיות' }
};
const relatedBlock = {
  type: 'related', id: 'r1',
  data: { title: 'כתבות נוספות', items: [{ title: 'א', href: '/a', excerpt: 'תקציר' }, { title: 'ב', href: '/b' }] }
};
const commentsBlock = {
  type: 'comments', id: 'cm1',
  data: { title: 'תגובות', items: [{ author: 'דנה', time: 'אתמול', text: 'כתבה מצוינת.' }] }
};
const slotBlock = {
  type: 'slot', id: 'sl1',
  data: { label: 'פרסומת', src: '/demo/ad.svg', url: 'https://example.com/ad', advertiser: 'מותג' }
};
const authBlock = {
  type: 'auth', id: 'a1',
  data: { login: 'כניסה', loginurl: '/login', register: 'הרשמה', registerurl: '/signup', text: 'שלום' }
};

const page = {
  title: 't', slug: 't', direction: 'rtl', tags: [], meta: {},
  blocks: [searchBlock, newsBlock, pagerBlock, consentBlock, relatedBlock, commentsBlock, slotBlock, authBlock]
};

const doc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)));
const back = pzn.toTapuzPage(doc);
check('search round-trips', back.blocks.find((b) => b.type === 'search') && back.blocks.find((b) => b.type === 'search').data.action === '/search');
check('newsletter round-trips body text', /עדכונים/.test((back.blocks.find((b) => b.type === 'newsletter') || { data: {} }).data.text || ''));
check('pager round-trips 3 pages', (back.blocks.find((b) => b.type === 'pager') || { data: {} }).data.items.length === 3);
check('consent round-trips policy', (back.blocks.find((b) => b.type === 'consent') || { data: {} }).data.policy === '/privacy');
check('related round-trips cards', (back.blocks.find((b) => b.type === 'related') || { data: {} }).data.items.length === 2);
check('comments round-trips author', (back.blocks.find((b) => b.type === 'comments') || { data: {} }).data.items[0].author === 'דנה');
check('slot round-trips advertiser', (back.blocks.find((b) => b.type === 'slot') || { data: {} }).data.advertiser === 'מותג');
check('auth round-trips loginurl', (back.blocks.find((b) => b.type === 'auth') || { data: {} }).data.loginurl === '/login');
check('validates clean', pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

const compiled = pzn.compile(doc);
check('compile: bent-search', /class="bent-search/.test(compiled) && /role="search"/.test(compiled));
check('compile: bent-newsletter', /class="bent-newsletter/.test(compiled));
check('compile: bent-pager', /class="bent-pager/.test(compiled) && /aria-current="page"/.test(compiled));
check('compile: bent-consent', /class="bent-consent/.test(compiled) && /bent-consent-toggle/.test(compiled));
check('compile: bent-related', /class="bent-related/.test(compiled));
check('compile: bent-comments', /class="bent-comments/.test(compiled) && /דנה/.test(compiled));
check('compile: bent-slot', /class="bent-slot/.test(compiled) && /rel="noopener noreferrer sponsored"/.test(compiled));
check('compile: bent-auth', /class="bent-auth/.test(compiled) && /\/login/.test(compiled));
check('no <script> in output', !/<script/i.test(compiled));
check('javascript: url neutralized on slot', !/javascript:/i.test(renderBlock({
  type: 'slot', id: 'e', data: { url: 'javascript:alert(1)', label: 'x' }
}, 'rtl')));
check('registry + seed', !!getBlockDef('search') && !!getBlockDef('newsletter')
  && !!getBlockDef('pager') && !!getBlockDef('consent')
  && !!getBlockDef('related') && !!getBlockDef('comments')
  && !!getBlockDef('slot') && !!getBlockDef('auth')
  && (defaultDataFor('pager').items || []).length >= 2);

const kw = bentml.compile(`BENTML 0.2

META {
  title: "משטח"
}

SEARCH(placeholder: "חפש", action: "https://search.walla.co.il", name: "q", submit: "חיפוש")

NEWSLETTER(title: "ניוזלטר", submit: "הרשמה") {
  קבלו עדכונים.
}

PAGER {
  PAGE(url: "/p/1") { 1 }
  PAGE { 2 }
}

CONSENT(accept: "אישור", policy: "/privacy") {
  עוגיות כאן.
}

RELATED(title: "עוד") {
  RELCARD(title: "א", url: "/a") { תקציר }
  RELCARD(title: "ב", url: "/b") { }
}

COMMENTS {
  COMMENT(author: "דנה", time: "אתמול") { שלום }
}

SLOT(label: "פרסומת", url: "https://example.com")

AUTH(login: "כניסה", loginurl: "/login", register: "הרשמה", registerurl: "/signup") {
  שלום
}
`);
check('keyword compiles all surface types',
  kw.blocks.map((b) => b.type).join(',') === 'search,newsletter,pager,consent,related,comments,slot,auth');

const src = bentml.decompile({ title: 'x' }, page.blocks);
check('decompile emits SEARCH/NEWSLETTER/PAGER/CONSENT/RELATED/COMMENTS/SLOT/AUTH',
  /SEARCH/.test(src) && /NEWSLETTER/.test(src) && /PAGER/.test(src)
  && /CONSENT/.test(src) && /RELATED/.test(src) && /COMMENTS/.test(src)
  && /SLOT/.test(src) && /AUTH/.test(src));
const round = bentml.compile(src);
check('keyword surface round-trip', round.blocks[0].type === 'search'
  && round.blocks[1].type === 'newsletter'
  && round.blocks[2].data.items.length === 3);

const searchHtml = htmlToBlocks(
  '<form role="search" action="https://search.walla.co.il">'
  + '<input type="search" name="q" placeholder="חיפוש">'
  + '<button type="submit">חיפוש</button></form>'
);
check('decompile role=search → search module',
  searchHtml.blocks.some((b) => b.type === 'search' && b.data.name === 'q')
  && !searchHtml.blocks.some((b) => b.type === 'form'));

const newsHtml = htmlToBlocks(
  '<section class="newsletter">'
  + '<h2>הישארו מעודכנים</h2>'
  + '<form action="/api/form"><input type="email" name="email" placeholder="מייל">'
  + '<button>הרשמה</button></form></section>'
);
check('decompile newsletter class → newsletter module',
  newsHtml.blocks.some((b) => b.type === 'newsletter'));

const pagerHtml = htmlToBlocks(
  '<nav class="pagination" aria-label="pagination">'
  + '<a href="?p=1">1</a><a href="?p=2">2</a><span class="current">3</span></nav>'
);
check('decompile pagination → pager, not nav',
  pagerHtml.blocks.some((b) => b.type === 'pager' && (b.data.items || []).length >= 2)
  && !pagerHtml.blocks.some((b) => b.type === 'nav'));

const consentHtml = htmlToBlocks(
  '<div class="cookie-banner"><p>We use cookies to improve the experience.</p>'
  + '<button>Accept</button><a href="/privacy">Privacy</a></div>'
);
check('decompile cookie-banner → consent',
  consentHtml.blocks.some((b) => b.type === 'consent' && /cookies/i.test(b.data.text || '')));

const relatedHtml = htmlToBlocks(
  '<section class="related-posts"><h2>עוד כתבות</h2>'
  + '<article><a href="/a"><h3>כתבה א</h3></a></article>'
  + '<article><a href="/b"><h3>כתבה ב</h3></a></article></section>'
);
check('decompile related-posts → related',
  relatedHtml.blocks.some((b) => b.type === 'related' && (b.data.items || []).length >= 2));

const commentsHtml = htmlToBlocks(
  '<section class="comments" id="comments"><h2>תגובות</h2>'
  + '<article class="comment"><b class="comment-author">דנה</b><p class="comment-body">שלום עולם</p></article>'
  + '</section>'
);
check('decompile comments → comments module',
  commentsHtml.blocks.some((b) => b.type === 'comments' && (b.data.items || []).length >= 1));

const slotHtml = htmlToBlocks('<aside class="ad-slot" aria-label="פרסומת"><a href="/ad"><img src="/ad.gif" alt=""></a></aside>');
check('decompile ad-slot → slot',
  slotHtml.blocks.some((b) => b.type === 'slot'));

const authHtml = htmlToBlocks(
  '<nav class="account-menu"><a href="/login">כניסה</a><a href="/signup">הרשמה</a></nav>'
);
check('decompile login+register → auth, not nav',
  authHtml.blocks.some((b) => b.type === 'auth' && /login/.test(b.data.loginurl || ''))
  && !authHtml.blocks.some((b) => b.type === 'nav'));

const hunted = huntBlocks(
  '<form class="search-form" action="/search"><input name="q"><button>חיפוש</button></form>'
);
check('hunt maps search-form → search',
  (hunted.blocks || []).some((b) => b.type === 'search'));

// a post's own <header class="entry-header"> is section furniture, not the
// page chrome (main's landmark rule: a bare <header>/role=banner with a
// title IS the chrome — see smoke-gap-chrome)
const sectionHeader = htmlToBlocks(
  '<article><header class="entry-header"><h2>חדשות</h2></header><h3>כתבה</h3></article>'
);
check('<header class="entry-header"> inside a post is not a header module',
  !sectionHeader.blocks.some((b) => b.type === 'header')
  && sectionHeader.blocks.some((b) => b.type === 'heading'));

const own = htmlToBlocks(renderBlock(searchBlock, 'rtl'));
check('our own bent-search HTML maps back',
  own.blocks.some((b) => b.type === 'search'));

const wrapped = htmlToBlocks(
  '<form action="https://search.walla.co.il"><input name="q">'
  + '<article><h3>כתבה א</h3><a href="/a">עוד</a></article>'
  + '<article><h3>כתבה ב</h3><a href="/b">עוד</a></article>'
  + '<article><h3>כתבה ג</h3><a href="/c">עוד</a></article></form>'
);
check('page-wrapper search form does not swallow articles',
  wrapped.blocks.some((b) => b.type === 'cards' || b.type === 'heading')
  && !wrapped.blocks.every((b) => b.type === 'search'));

console.log('');
console.log(fail ? 'SMOKE SURFACE: FAIL' : 'SMOKE SURFACE: PASS');
process.exit(fail ? 1 : 0);
