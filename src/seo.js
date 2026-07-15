'use strict';

/**
 * SEO essentials — pure builders for sitemap.xml + robots.txt, kept out of the
 * route so they are unit-testable (scripts/smoke-seo.js). The routes in
 * server.js supply live data (published pages, base URL, admin path).
 */

/** XML-escape text for <loc> content (URLs mainly need & escaped). */
function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The published page that owns '/' (highest home score at/above threshold), or
 * null. `scoreHome` is injected (export.scoreHomeCandidate) so this stays pure.
 */
function pickHomePath(pages, scoreHome) {
  let homePath = null, best = -1;
  for (const p of pages || []) {
    const s = typeof scoreHome === 'function' ? scoreHome(p) : -1;
    if (s > best) { best = s; homePath = p.full_path; }
  }
  return best >= 20 ? homePath : null;
}

/**
 * Published pages → a sitemap.xml string. The home page is emitted once as '/',
 * every other page as /<full_path>. pages: [{ full_path, updated_at }].
 */
function buildSitemapXml(pages, base, homePath) {
  const b = String(base || '').replace(/\/+$/, '');
  const day = (d) => (d ? String(d).slice(0, 10) : '');
  const list = (pages || []).filter((p) => p && p.full_path);
  const urls = [];
  const home = list.find((p) => p.full_path === homePath);
  urls.push({ loc: b + '/', lastmod: home ? day(home.updated_at) : '' });
  for (const p of list) {
    if (p.full_path === homePath) continue;
    urls.push({ loc: b + '/' + encodeURI(p.full_path), lastmod: day(p.updated_at) });
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n') +
    '\n</urlset>\n';
}

/** robots.txt with the (configurable) admin path + agent API disallowed. */
function buildRobotsTxt(base, adminBase) {
  const b = String(base || '').replace(/\/+$/, '');
  const admin = adminBase || '/admin';
  return `User-agent: *\nAllow: /\nDisallow: ${admin}\nDisallow: /agent\n\nSitemap: ${b}/sitemap.xml\n`;
}

module.exports = { buildSitemapXml, buildRobotsTxt, pickHomePath, xmlEscape };
