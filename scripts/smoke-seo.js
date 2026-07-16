'use strict';

/**
 * v0.71 QA — SEO essentials (src/seo.js): sitemap.xml + robots.txt builders.
 */

const {
  buildSitemapXml, buildRobotsTxt, pickHomePath, xmlEscape, sitemapEligible,
  buildSeoHeadTags, buildJsonLd, jsonLdScript, absolutize, pageUrl, toIsoDate,
  scoreHomeCandidate, HOME_SCORE_MIN
} = require('../src/seo');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const pages = [
  { full_path: 'home', updated_at: '2026-07-11 10:00:00' },
  { full_path: 'about', updated_at: '2026-07-12 09:00:00' },
  { full_path: 'צור-קשר', updated_at: '2026-07-13 08:00:00' }
];
// stub scorer: 'home' owns '/'
const scoreHome = (p) => (p.full_path === 'home' ? 100 : 0);

const homePath = pickHomePath(pages, scoreHome);
check('pickHomePath finds the home', homePath === 'home');
check('pickHomePath returns null below threshold', pickHomePath(pages, () => 0) === null);

const xml = buildSitemapXml(pages, 'https://site.example', homePath);
check('valid urlset envelope', xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>') && xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
check('home is emitted once as /', (xml.match(/<loc>https:\/\/site\.example\/<\/loc>/g) || []).length === 1);
check('home NOT also emitted as /home', !xml.includes('/home</loc>'));
check('other pages at /<full_path>', xml.includes('<loc>https://site.example/about</loc>'));
check('hebrew slug is percent-encoded', xml.includes('/%D7%A6%D7%95%D7%A8-%D7%A7%D7%A9%D7%A8</loc>'));
check('lastmod is YYYY-MM-DD', xml.includes('<lastmod>2026-07-12</lastmod>'));
check('exactly 3 urls', (xml.match(/<url>/g) || []).length === 3);
check('trailing slash on base is normalized', buildSitemapXml(pages, 'https://site.example/', homePath).includes('<loc>https://site.example/</loc>'));

// no crowned home → NO root entry ('/' would 404 or serve nothing crowned)
const noHome = buildSitemapXml(pages, 'https://x.io', null);
check('no-home: NO root entry, pages only (3 urls)', (noHome.match(/<url>/g) || []).length === 3 && !noHome.includes('<loc>https://x.io/</loc>'));
// crowned home filtered OUT (noindex/redirect) → no root, others keep their own entries
const filteredHome = buildSitemapXml(pages.filter((p) => p.full_path !== 'home'), 'https://x.io', 'home');
check('filtered-out home: no root, no swallowed page (2 urls, about intact)',
  (filteredHome.match(/<url>/g) || []).length === 2 && !filteredHome.includes('<loc>https://x.io/</loc>') && filteredHome.includes('/about</loc>'));

check('xmlEscape ampersand', xmlEscape('a&b') === 'a&amp;b');

const robots = buildRobotsTxt('https://site.example', '/manage-x7q');
check('robots has User-agent *', /User-agent: \*/.test(robots));
check('robots disallows the configured admin path', robots.includes('Disallow: /manage-x7q'));
check('robots disallows /agent', robots.includes('Disallow: /agent'));
check('robots points to the sitemap', robots.includes('Sitemap: https://site.example/sitemap.xml'));

// ── sitemap eligibility (v0.71): redirects + noindex stay out ────────
check('normal page is eligible', sitemapEligible('{}') === true);
check('redirect page is NOT eligible', sitemapEligible('{"redirect":"/x"}') === false);
check('noindex page is NOT eligible', sitemapEligible({ robots: 'noindex, nofollow' }) === false);
check('broken meta JSON → eligible (never drops silently)', sitemapEligible('{oops') === true);

// ── URL + date helpers (v0.71) ───────────────────────────────────────
check('absolutize root-relative', absolutize('/img/a.jpg', 'https://x.io/') === 'https://x.io/img/a.jpg');
check('absolutize keeps absolute URLs', absolutize('https://cdn.io/a.jpg', 'https://x.io') === 'https://cdn.io/a.jpg');
check('absolutize keeps protocol-relative', absolutize('//cdn.io/a.jpg', 'https://x.io') === '//cdn.io/a.jpg');
check('absolutize no base → unchanged', absolutize('/a.jpg', '') === '/a.jpg');
check('pageUrl home', pageUrl('https://x.io', '') === 'https://x.io/');
check('pageUrl hebrew path encoded', pageUrl('https://x.io', 'צור-קשר') === 'https://x.io/' + encodeURI('צור-קשר'));
check('pageUrl no base → empty', pageUrl('', 'about') === '');
check('toIsoDate sqlite → ISO Z', toIsoDate('2026-07-15 08:30:00') === '2026-07-15T08:30:00Z');
check('toIsoDate ISO passthrough', toIsoDate('2026-07-15T08:30:00Z') === '2026-07-15T08:30:00Z');
check('toIsoDate garbage → empty', toIsoDate('not a date') === '');

// ── head tags (v0.71) ────────────────────────────────────────────────
const head = buildSeoHeadTags({
  base: 'https://x.io', path: 'about', title: 'אודות', description: 'תיאור',
  image: 'https://x.io/share.jpg', siteName: 'האתר', lang: 'he',
  isArticle: true, publishedIso: '2026-07-01T10:00:00Z', modifiedIso: '2026-07-15T08:30:00Z'
});
check('canonical emitted with base', head.includes('<link rel="canonical" href="https://x.io/about">'));
check('og:url matches canonical', head.includes('<meta property="og:url" content="https://x.io/about">'));
check('og:site_name emitted', head.includes('og:site_name" content="האתר"'));
check('og:locale he → he_IL', head.includes('og:locale" content="he_IL"'));
check('twitter card is summary_large_image with image', head.includes('twitter:card" content="summary_large_image"'));
check('article times emitted for articles', head.includes('article:published_time" content="2026-07-01T10:00:00Z"') && head.includes('article:modified_time'));
const headNoBase = buildSeoHeadTags({ base: '', path: 'about', title: 'א', description: 'ב', image: '', siteName: 'ס', lang: 'he', isArticle: false });
check('NO canonical/og:url without base', !headNoBase.includes('canonical') && !headNoBase.includes('og:url'));
check('twitter card falls back to summary without image', headNoBase.includes('twitter:card" content="summary"'));
check('no article times for non-articles', !headNoBase.includes('article:published_time'));
check('head values are escaped', buildSeoHeadTags({ base: 'https://x.io', path: 'p', title: 'a"b<c', siteName: '', lang: '' }).includes('twitter:title" content="a&quot;b&lt;c"'));

// ── JSON-LD (v0.71) ──────────────────────────────────────────────────
const art = buildJsonLd({
  title: 'כותרת המאמר', description: 'ת', image: 'https://x.io/a.jpg', isArticle: true, isHome: false,
  siteName: 'האתר', logo: 'https://x.io/logo.png', base: 'https://x.io', path: 'my-post',
  datePublished: '2026-07-01T10:00:00Z', dateModified: '2026-07-15T08:30:00Z'
});
check('article → one Article object', art.length === 1 && art[0]['@type'] === 'Article');
check('Article carries headline/dates/publisher.logo/mainEntityOfPage',
  art[0].headline === 'כותרת המאמר' && art[0].datePublished === '2026-07-01T10:00:00Z' &&
  art[0].publisher.logo.url === 'https://x.io/logo.png' && art[0].mainEntityOfPage === 'https://x.io/my-post');
check('headline capped at 110 chars', buildJsonLd({ title: 'א'.repeat(200), isArticle: true })[0].headline.length === 110);
const web = buildJsonLd({ title: 'דף', description: 'ת', isArticle: false, isHome: true, siteName: 'האתר', base: 'https://x.io', path: '' });
check('home page → WebPage + WebSite', web.length === 2 && web[0]['@type'] === 'WebPage' && web[1]['@type'] === 'WebSite' && web[1].url === 'https://x.io/');
const noBaseLd = buildJsonLd({ title: 'ד', isArticle: false, isHome: false, siteName: 'ס', base: '', path: 'x' });
check('no base → WebPage without url (never a wrong URL)', noBaseLd[0].url === undefined);
const script = jsonLdScript([{ '@type': 'WebPage', name: 'a</script><script>alert(1)' }]);
const scriptBody = script.replace(/^<script type="application\/ld\+json">/, '').replace(/<\/script>$/, '');
check('jsonLdScript neutralizes </script> breakout (no raw < in body)', !scriptBody.includes('<') && scriptBody.includes('\\u003c'));
check('jsonLdScript output still parses as the same JSON', JSON.parse(scriptBody).name === 'a</script><script>alert(1)');
check('jsonLdScript empty input → empty string', jsonLdScript([]) === '');

// ── home scorer lives here now (moved from export.js) ────────────────
check('scoreHomeCandidate exported + scores home', scoreHomeCandidate({ full_path: 'home', title: 'home', blocks: [] }) >= HOME_SCORE_MIN);

console.log('');
console.log(fail ? 'SMOKE SEO: FAIL' : 'SMOKE SEO: PASS');
process.exit(fail ? 1 : 0);
