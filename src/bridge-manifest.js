'use strict';

/**
 * Bridge V2 — the downloaded ZIP arrives already connected to the site it was
 * downloaded from (v2.34).
 *
 * Before this, a hosted site needed the popup's "connect this site" click, and
 * testers who could not click a browser permission prompt (an automated
 * Chromium) patched `extension-v2a/manifest.json` by hand with their live
 * host. That patch lived in the git tree, so every `git pull` wiped it and the
 * bridge went dark on the live site. It could not be committed either: the
 * repo is public and carries no real hostname.
 *
 * So the host is written where it belongs — into the one copy that is made FOR
 * that site: the ZIP served by `/admin/ai-setup` (admin-only), whose request
 * names the site. The source folder stays loopback-only; the popup's connect
 * button still wires any other site.
 *
 * What the wiring grants is exactly what "connect this site" grants: the
 * content bridge on that one host (every path, both schemes). The model side
 * does not move — the worker still reaches loopback only.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * The match pattern for a site host, or null when the host should not be
 * wired: empty, not a plain DNS name / IPv4 address, or loopback. A loopback
 * site is left to the popup on purpose — `*://localhost/*` would put the
 * bridge on every dev server on the machine, not just this CMS.
 * @param {string} hostname
 * @returns {string|null}
 */
function siteMatchPattern(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253 || LOOPBACK.has(host)) return null;
  // DNS labels or dotted IPv4 only — nothing that could bend the pattern
  // (no `*`, `/`, `:`, spaces, brackets)
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(host)) return null;
  // match patterns take no port and `*` covers http + https: the pattern the
  // popup would build for either scheme, in one line
  return '*://' + host + '/*';
}

/**
 * Wire a Bridge V2 manifest (already tailored per browser) to one site.
 * Returns the pattern it wired, or null when it left the manifest alone.
 * @param {object} manifest mutated in place
 * @param {string} hostname the host the admin downloaded the ZIP from
 */
function wireBridgeToSite(manifest, hostname) {
  const pattern = siteMatchPattern(hostname);
  if (!pattern || !manifest) return null;
  const hosts = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  if (!hosts.includes(pattern)) hosts.push(pattern);
  manifest.host_permissions = hosts;
  // document_idle, like the popup's own registration — the page pings on load
  // and the bridge announces on arrival, so either order meets
  manifest.content_scripts = [{ matches: [pattern], js: ['content-bridge.js'], run_at: 'document_idle' }];
  return pattern;
}

module.exports = { siteMatchPattern, wireBridgeToSite };
