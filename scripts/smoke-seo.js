'use strict';

/**
 * v0.71 QA — SEO essentials (src/seo.js): sitemap.xml + robots.txt builders.
 */

const { buildSitemapXml, buildRobotsTxt, pickHomePath, xmlEscape } = require('../src/seo');

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

// no home match → '/' still emitted (with no lastmod), all pages listed
const noHome = buildSitemapXml(pages, 'https://x.io', null);
check('no-home: still emits root + all pages (4 urls)', (noHome.match(/<url>/g) || []).length === 4);

check('xmlEscape ampersand', xmlEscape('a&b') === 'a&amp;b');

const robots = buildRobotsTxt('https://site.example', '/manage-x7q');
check('robots has User-agent *', /User-agent: \*/.test(robots));
check('robots disallows the configured admin path', robots.includes('Disallow: /manage-x7q'));
check('robots disallows /agent', robots.includes('Disallow: /agent'));
check('robots points to the sitemap', robots.includes('Sitemap: https://site.example/sitemap.xml'));

console.log('');
console.log(fail ? 'SMOKE SEO: FAIL' : 'SMOKE SEO: PASS');
process.exit(fail ? 1 : 0);
