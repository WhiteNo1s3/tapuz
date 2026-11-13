'use strict';

/**
 * Public SEO files — the twenty-first route-group extraction. sitemap.xml
 * and robots.txt, derived live from the published pages (v0.71). These are
 * PUBLIC, unauthenticated, and — critically — must be registered BEFORE the
 * express.static mounts so they always answer (a static file must never
 * shadow them). server.js therefore mounts this router at the exact same
 * pre-static position the inline routes held; only the code moved, never
 * the registration order (the same discipline as the v1.11 auth-gate cut).
 * Absolute URLs come from config.baseUrl, falling back to the request host.
 */

const express = require('express');
const { loadConfig } = require('../config');
const { requestOrigin } = require('../http-util');

const router = express.Router();

// The configured base URL as the owner wrote it (it may carry a path); with
// none set, the origin the visitor is really on. That fallback used to be
// req.protocol — always "http" behind a proxy that terminates TLS, so an
// https site's sitemap listed http:// addresses (seen live). requestOrigin
// reads the scheme the trusted proxy reports (v2.69, src/http-util.js).
function siteBaseUrl(req) {
  let base = '';
  try { base = String((loadConfig().baseUrl || '')).trim().replace(/\/+$/, ''); } catch (e) {}
  return base || requestOrigin(req);
}
router.get('/sitemap.xml', (req, res) => {
  try {
    const seo = require('../seo');
    // Crown the home over ALL published pages FIRST, then filter eligibility
    // (redirects + robots-noindex stay out). Crowning after filtering would
    // let a lookalike page inherit '/' when the real home is excluded.
    const all = require('../pages').listPages({ status: 'published' });
    const homePath = seo.resolveHomePath(all, loadConfig().homepage);
    const pages = all.filter((p) => seo.sitemapEligible(p.meta));
    res.type('application/xml').send(seo.buildSitemapXml(pages, siteBaseUrl(req), homePath));
  } catch (e) {
    res.status(500).type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>\n');
  }
});
router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(require('../seo').buildRobotsTxt(siteBaseUrl(req), require('../auth').getAdminBase()));
});

module.exports = router;
