'use strict';

/**
 * SEO library — pure builders, no IO, no db (unit-testable in
 * scripts/smoke-seo.js). Callers (server routes, renderer.renderPage,
 * export) supply live data:
 *   - sitemap.xml + robots.txt (v0.69 essentials)
 *   - canonical / og:url / og:site_name / og:locale + twitter cards +
 *     article times (v0.71 head tags)
 *   - JSON-LD structured data: Article / WebPage / WebSite (v0.71)
 *
 * Absolute URLs come only from config.baseUrl — when it is empty the
 * URL-dependent tags are omitted entirely: a wrong canonical is worse
 * than none.
 */

/** XML/attribute-escape (& < > ") — shared by sitemap and head tags. */
function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── home detection (single source of truth; export.js re-exports) ─────────

const HOME_SCORE_MIN = 20;

/** How home-like is this page? (moved from export.js — one scorer everywhere) */
function scoreHomeCandidate(page) {
  if (!page) return -1;
  const title = (page.title || '').toLowerCase();
  const fullPath = page.full_path || '';
  let score = 0;
  if (fullPath === 'amvd-hbyt') score += 100;
  if (fullPath === 'home') score += 40;
  if (title.includes('whiteno1se') && title.includes('עמוד הבית')) score += 80;
  if (title === 'עמוד הבית' || title.includes('דף הבית')) score += 50;
  if (title === 'home') score += 20;
  try {
    const blocks = typeof page.blocks === 'string' ? JSON.parse(page.blocks) : page.blocks || [];
    score += Math.min((blocks || []).length, 40);
  } catch (e) {}
  return score;
}

/**
 * The homepage, resolved (v0.78): an explicit choice (config.homepage) wins
 * whenever that page is in the candidate set; otherwise fall back to the
 * ranked heuristic. One resolver for export, sitemap, and the admin UI —
 * a renamed article can never steal '/' from a page the user crowned.
 * @param {object[]} pages   candidate pages (published set)
 * @param {string} [explicit] config.homepage — a full_path, or '' for auto
 * @returns {string|null}
 */
function resolveHomePath(pages, explicit) {
  const list = pages || [];
  const want = String(explicit || '').trim();
  if (want && list.some((p) => p.full_path === want)) return want;
  return pickHomePath(list);
}

/**
 * The published page that owns '/' (highest home score at/above threshold), or
 * null. `scoreHome` is injectable for tests; defaults to the real scorer.
 */
function pickHomePath(pages, scoreHome) {
  const scorer = typeof scoreHome === 'function' ? scoreHome : scoreHomeCandidate;
  let homePath = null, best = -1;
  for (const p of pages || []) {
    const s = scorer(p);
    if (s > best) { best = s; homePath = p.full_path; }
  }
  return best >= HOME_SCORE_MIN ? homePath : null;
}

// ── URL + date helpers ─────────────────────────────────────────────────────

/** Root-relative URL + configured base → absolute; anything else unchanged. */
function absolutize(url, base) {
  const u = String(url == null ? '' : url);
  const b = String(base || '').replace(/\/+$/, '');
  return b && u.startsWith('/') && !u.startsWith('//') ? b + u : u;
}

/** The page's absolute URL, or '' when no base ('' path = the home page). */
function pageUrl(base, path) {
  const b = String(base || '').replace(/\/+$/, '');
  if (!b) return '';
  return path ? b + '/' + encodeURI(path) : b + '/';
}

/** sqlite 'YYYY-MM-DD HH:MM:SS' (UTC) → ISO8601; ISO passes through; else ''. */
function toIsoDate(ts) {
  const s = String(ts == null ? '' : ts).trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(s);
  if (!m) return '';
  return s.includes('T') && /[Z+]/.test(s.slice(19)) ? s : `${m[1]}T${m[2]}Z`;
}

// ── sitemap.xml + robots.txt (v0.69) ──────────────────────────────────────

/**
 * Published pages → a sitemap.xml string. The home page is emitted once as '/',
 * every other page as /<full_path>. pages: [{ full_path, updated_at }].
 */
function buildSitemapXml(pages, base, homePath) {
  const b = String(base || '').replace(/\/+$/, '');
  const day = (d) => (d ? String(d).slice(0, 10) : '');
  const list = (pages || []).filter((p) => p && p.full_path);
  const urls = [];
  // '/' appears ONLY when the crowned home page is itself in the (eligible)
  // list — a noindex/redirect home, or no home at all, means no root entry
  // (the root would serve exactly the page we are excluding, or a 404).
  const home = homePath ? list.find((p) => p.full_path === homePath) : undefined;
  if (home) urls.push({ loc: b + '/', lastmod: day(home.updated_at) });
  for (const p of list) {
    if (home && p.full_path === homePath) continue;
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

/** True when a published page belongs in the sitemap (no redirects, no noindex). */
function sitemapEligible(metaJsonOrObj) {
  let m = metaJsonOrObj;
  if (typeof m === 'string') { try { m = JSON.parse(m || '{}'); } catch (e) { m = {}; } }
  m = m || {};
  if (m.redirect) return false;
  if (/noindex/i.test(String(m.robots || ''))) return false;
  return true;
}

// ── head tags: canonical + og extras + twitter + article times (v0.71) ────

/**
 * @returns {string} newline-joined <link>/<meta> tags (may be '').
 */
function buildSeoHeadTags({ base, path, title, description, image, siteName, lang, isArticle, publishedIso, modifiedIso } = {}) {
  const tags = [];
  const url = pageUrl(base, path);
  if (url) {
    tags.push(`<link rel="canonical" href="${xmlEscape(url)}">`);
    tags.push(`<meta property="og:url" content="${xmlEscape(url)}">`);
  }
  if (siteName) tags.push(`<meta property="og:site_name" content="${xmlEscape(siteName)}">`);
  const locale = lang === 'he' ? 'he_IL' : lang === 'en' ? 'en_US' : '';
  if (locale) tags.push(`<meta property="og:locale" content="${locale}">`);
  tags.push(`<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`);
  if (title) tags.push(`<meta name="twitter:title" content="${xmlEscape(title)}">`);
  if (description) tags.push(`<meta name="twitter:description" content="${xmlEscape(description)}">`);
  if (image) tags.push(`<meta name="twitter:image" content="${xmlEscape(image)}">`);
  if (isArticle && publishedIso) tags.push(`<meta property="article:published_time" content="${xmlEscape(publishedIso)}">`);
  if (isArticle && modifiedIso) tags.push(`<meta property="article:modified_time" content="${xmlEscape(modifiedIso)}">`);
  return tags.join('\n  ');
}

/**
 * hreflang alternate links (v1.08 — multilingual pairing). One tag per
 * translation (self included, the standard SEO practice — Google's own
 * guidance) so search engines offer readers the page in their language.
 * Silently empty when there's no baseUrl or fewer than 2 language pages —
 * a half-set of hreflang tags is worse than none (implies siblings that
 * don't resolve).
 * @param {string} base site baseUrl
 * @param {{lang:string, full_path:string}[]} translations every page in the
 *   group INCLUDING the current page itself
 */
function buildHreflangTags(base, translations) {
  const withLang = (translations || []).filter((t) => t && t.lang && t.full_path);
  if (withLang.length < 2) return '';
  return withLang
    .map((t) => {
      const url = pageUrl(base, t.full_path);
      return url ? `<link rel="alternate" hreflang="${xmlEscape(t.lang)}" href="${xmlEscape(url)}">` : '';
    })
    .filter(Boolean)
    .join('\n  ');
}

// ── JSON-LD structured data (v0.71) ───────────────────────────────────────

/**
 * schema.org objects for the page: Article (tagged 'article') or WebPage,
 * plus WebSite on the home page. Fields are omitted when unknown — never
 * invented. All URLs are expected pre-absolutized (or '' to omit).
 * @returns {object[]}
 */
function buildJsonLd({ title, description, image, isArticle, isHome, siteName, logo, base, path, datePublished, dateModified } = {}) {
  const url = pageUrl(base, path);
  const graph = [];
  if (isArticle) {
    const a = { '@context': 'https://schema.org', '@type': 'Article', headline: String(title || '').slice(0, 110) };
    if (description) a.description = description;
    if (image) a.image = [image];
    if (datePublished) a.datePublished = datePublished;
    if (dateModified) a.dateModified = dateModified;
    if (siteName) {
      a.author = { '@type': 'Organization', name: siteName };
      a.publisher = { '@type': 'Organization', name: siteName };
      if (logo) a.publisher.logo = { '@type': 'ImageObject', url: logo };
    }
    if (url) a.mainEntityOfPage = url;
    graph.push(a);
  } else {
    const w = { '@context': 'https://schema.org', '@type': 'WebPage', name: String(title || '') };
    if (description) w.description = description;
    if (url) w.url = url;
    graph.push(w);
  }
  if (isHome && siteName) {
    const s = { '@context': 'https://schema.org', '@type': 'WebSite', name: siteName };
    const root = pageUrl(base, '');
    if (root) s.url = root;
    graph.push(s);
  }
  return graph;
}

/**
 * Serialize JSON-LD objects into <script> tags. Every '<' in the JSON becomes
 * < (still valid JSON) so a value can never break out via "</script>".
 */
function jsonLdScript(objects) {
  if (!Array.isArray(objects) || !objects.length) return '';
  return objects
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`)
    .join('\n  ');
}

module.exports = {
  // essentials
  buildSitemapXml, buildRobotsTxt, pickHomePath, resolveHomePath, xmlEscape, sitemapEligible,
  // home detection
  scoreHomeCandidate, HOME_SCORE_MIN,
  // head + structured data
  buildSeoHeadTags, buildJsonLd, jsonLdScript, buildHreflangTags,
  // helpers
  absolutize, pageUrl, toIsoDate
};
