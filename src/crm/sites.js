'use strict';

/**
 * CRM site registry (v1.99) — multi-tenant foreign pixel embeds.
 *
 * A `site_id` is public (like a GA measurement id). Security is the registry:
 * sites are created in the admin; an unknown / inactive slug is dropped with
 * a silent 204. Optional origin allowlist tightens further when set.
 */

const { db } = require('../db');

function normalizeSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parseOrigins(raw) {
  if (Array.isArray(raw)) {
    return raw.map((o) => String(o || '').trim()).filter(Boolean).slice(0, 40);
  }
  const s = String(raw || '').trim();
  if (!s) return [];
  if (s[0] === '[') {
    try {
      const j = JSON.parse(s);
      if (Array.isArray(j)) return j.map((o) => String(o || '').trim()).filter(Boolean).slice(0, 40);
    } catch (e) { /* fall through */ }
  }
  return s.split(/[\n,]+/).map((o) => o.trim()).filter(Boolean).slice(0, 40);
}

function serializeOrigins(list) {
  return JSON.stringify(parseOrigins(list));
}

function rowToSite(row) {
  if (!row) return null;
  return {
    slug: row.slug,
    label: row.label || '',
    allowedOrigins: parseOrigins(row.allowed_origins),
    active: !!row.active,
    claimsEnabled: !!row.claims_enabled,
    created_at: row.created_at
  };
}

function getSite(slug) {
  const s = normalizeSlug(slug);
  if (!s) return null;
  return rowToSite(db.prepare('SELECT * FROM crm_sites WHERE slug = ?').get(s));
}

function listSites() {
  return db
    .prepare('SELECT * FROM crm_sites ORDER BY label, slug')
    .all()
    .map(rowToSite);
}

function createSite({ slug, label, allowedOrigins, active, claimsEnabled } = {}) {
  const s = normalizeSlug(slug);
  if (!s) throw new Error('slug required');
  if (getSite(s)) throw new Error('site exists');
  db.prepare(
    `INSERT INTO crm_sites (slug, label, allowed_origins, active, claims_enabled)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    s,
    String(label || s).trim().slice(0, 200),
    serializeOrigins(allowedOrigins),
    active === false ? 0 : 1,
    claimsEnabled ? 1 : 0
  );
  return getSite(s);
}

function updateSite(slug, patch = {}) {
  const existing = getSite(slug);
  if (!existing) return null;
  const label = patch.label !== undefined ? String(patch.label || '').trim().slice(0, 200) : existing.label;
  const allowed = patch.allowedOrigins !== undefined ? patch.allowedOrigins : existing.allowedOrigins;
  const active = patch.active !== undefined ? !!patch.active : existing.active;
  const claims = patch.claimsEnabled !== undefined ? !!patch.claimsEnabled : existing.claimsEnabled;
  db.prepare(
    `UPDATE crm_sites SET label = ?, allowed_origins = ?, active = ?, claims_enabled = ?
     WHERE slug = ?`
  ).run(label, serializeOrigins(allowed), active ? 1 : 0, claims ? 1 : 0, existing.slug);
  return getSite(existing.slug);
}

function deleteSite(slug) {
  const s = normalizeSlug(slug);
  if (!s) return false;
  return db.prepare('DELETE FROM crm_sites WHERE slug = ?').run(s).changes > 0;
}

/**
 * Resolve a foreign beacon's site_id + Origin.
 * @returns {{ok:true, site:object}|{ok:false, reason:string}}
 */
function resolveForCollect(siteId, origin) {
  const site = getSite(siteId);
  if (!site) return { ok: false, reason: 'unknown' };
  if (!site.active) return { ok: false, reason: 'inactive' };
  if (site.allowedOrigins.length) {
    const o = String(origin || '').trim();
    if (!o || !site.allowedOrigins.includes(o)) {
      return { ok: false, reason: 'origin' };
    }
  }
  return { ok: true, site };
}

/** Pixel embed product flag — under CRM, default off. */
function pixelEmbedEnabled() {
  try {
    const cfg = require('../config').loadConfig();
    if (!(cfg && cfg.crm && cfg.crm.enabled)) return false;
    const pe = (cfg.crm && cfg.crm.pixelEmbed) || {};
    return pe.enabled === true;
  } catch (e) {
    return false;
  }
}

/**
 * Public snippet base URL must be HTTPS (or localhost for dev).
 * Returns '' when refused so the admin never ships an insecure embed.
 */
function sanitizeSnippetBase(raw) {
  const s = String(raw || '').trim().replace(/\/$/, '');
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch (e) { return ''; }
  const host = (u.hostname || '').toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  if (u.protocol === 'https:') return u.origin;
  if (u.protocol === 'http:' && local) return u.origin;
  return '';
}

function buildSnippet({ base, siteId } = {}) {
  const origin = sanitizeSnippetBase(base);
  const slug = normalizeSlug(siteId);
  if (!origin || !slug) return '';
  return (
    '<script src="' + origin + '/tz-pixel.js"\n' +
    '  data-tz-pixel-base="' + origin + '"\n' +
    '  data-tz-pixel-site="' + slug + '"\n' +
    '  defer></script>'
  );
}

module.exports = {
  normalizeSlug,
  parseOrigins,
  getSite,
  listSites,
  createSite,
  updateSite,
  deleteSite,
  resolveForCollect,
  pixelEmbedEnabled,
  sanitizeSnippetBase,
  buildSnippet
};
