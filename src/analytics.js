// First-party, privacy-respecting analytics (S6).
//
// ZERO external deps — Node's built-in `crypto` + the existing better-sqlite3.
//
// PRIVACY MODEL (never negotiable):
//   * We NEVER store a raw IP address or a full User-Agent.
//   * Each visit stores only: path, referrer HOST (not the full URL, so query
//     strings / PII never land in the DB), a coarse device class, and a
//     visitor hash = HMAC-SHA256(daily-rotating salt, ip + '|' + userAgent),
//     truncated to 16 hex chars. The salt rotates every UTC day and prior
//     days' salts are discarded, so a hash is non-reversible and cannot be
//     linked across days — "unique-ish daily visitors" without identifying
//     anyone.
//
// The collector route (server.js POST /_tapuz/collect) derives the IP + UA
// SERVER-SIDE and calls recordPageview() — the client beacon never sends an IP.

const crypto = require('crypto');
const { db } = require('./db');

// ---------------------------------------------------------------------------
// Daily-rotating salt for the visitor hash
// ---------------------------------------------------------------------------
function todayUTC() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function getDailySalt() {
  const day = todayUTC();
  const row = db.prepare('SELECT salt FROM analytics_salt WHERE day = ?').get(day);
  if (row && row.salt) return row.salt;
  const salt = crypto.randomBytes(32).toString('hex');
  try {
    db.prepare('INSERT INTO analytics_salt (day, salt) VALUES (?, ?)').run(day, salt);
  } catch (e) {
    // Race: another writer inserted first — re-read the winner.
    const r2 = db.prepare('SELECT salt FROM analytics_salt WHERE day = ?').get(day);
    if (r2 && r2.salt) return r2.salt;
  }
  // Discard every salt that is not today's so yesterday's hashes can't be
  // recomputed (forward-secrecy for the pseudonymous visitor id).
  try { db.prepare('DELETE FROM analytics_salt WHERE day <> ?').run(day); } catch (e) {}
  return salt;
}

function visitorHash(ip, userAgent) {
  const salt = getDailySalt();
  return crypto
    .createHmac('sha256', salt)
    .update(String(ip || '') + '|' + String(userAgent || ''))
    .digest('hex')
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// Coarse device class (a bucket, NOT a fingerprint)
// ---------------------------------------------------------------------------
function deviceClass(userAgent) {
  const s = String(userAgent || '').toLowerCase();
  // Tablets first (an Android tablet lacks "mobile"; iPad is explicit).
  if (/ipad|tablet|playbook|silk|kindle|(android(?!.*mobile))/.test(s)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry|bb10|opera mini/.test(s)) return 'mobile';
  return 'desktop';
}

// ---------------------------------------------------------------------------
// Cheap bot filter (best-effort; keeps obvious crawlers out of human stats)
// ---------------------------------------------------------------------------
const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest|vkshare|whatsapp|telegram|headless|phantom|puppeteer|playwright|python-requests|curl\/|wget|axios|node-fetch|go-http|libwww|okhttp|scrapy|semrush|ahrefs|mj12|dotbot|petalbot|gptbot|ccbot|claudebot|amazonbot/i;
function isBot(userAgent) {
  return BOT_RE.test(String(userAgent || ''));
}

// ---------------------------------------------------------------------------
// Referrer HOST only (drop path + query so no PII / query strings are stored)
// ---------------------------------------------------------------------------
function referrerHost(ref) {
  const r = String(ref || '').trim();
  if (!r) return '';
  try {
    const u = new URL(r);
    return (u.host || '').slice(0, 255);
  } catch (e) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Record a pageview (privacy-safe columns only)
// ---------------------------------------------------------------------------
function recordPageview({ path, referrer, ip, userAgent } = {}) {
  let cleanPath = String(path || '');
  if (!cleanPath || cleanPath[0] !== '/') return null; // only same-site absolute paths
  if (cleanPath.length > 512) cleanPath = cleanPath.slice(0, 512);
  const host = referrerHost(referrer);
  const device = deviceClass(userAgent);
  const vh = visitorHash(ip, userAgent);
  const info = db
    .prepare('INSERT INTO pageviews (path, referrer_host, device_class, visitor_hash) VALUES (?, ?, ?, ?)')
    .run(cleanPath, host, device, vh);
  return info.lastInsertRowid;
}

// ---------------------------------------------------------------------------
// Dashboard aggregations (all server-rendered; no chart library)
// ---------------------------------------------------------------------------
function clampDays(days) {
  const n = parseInt(days, 10);
  if (!Number.isFinite(n)) return 30;
  return Math.min(Math.max(n, 1), 365);
}

// SQLite modifier for "N-1 days ago" so [since .. today] spans `days` calendar days.
function sinceModifier(days) {
  return `-${clampDays(days) - 1} days`;
}

function totals(days = 30) {
  const since = sinceModifier(days);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS views,
              COUNT(DISTINCT visitor_hash) AS visitors
       FROM pageviews
       WHERE date(created_at) >= date('now', ?)`
    )
    .get(since);
  return { views: row.views || 0, visitors: row.visitors || 0 };
}

// Views + unique-ish visitors per calendar day, gap-filled with zeros.
function pageviewsByDay(days = 30) {
  const d = clampDays(days);
  const since = sinceModifier(d);
  const rows = db
    .prepare(
      `SELECT date(created_at) AS day,
              COUNT(*) AS views,
              COUNT(DISTINCT visitor_hash) AS visitors
       FROM pageviews
       WHERE date(created_at) >= date('now', ?)
       GROUP BY date(created_at)`
    )
    .all(since);
  const byDay = new Map(rows.map(r => [r.day, r]));
  const out = [];
  const today = new Date();
  for (let i = d - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const key = dt.toISOString().slice(0, 10);
    const hit = byDay.get(key);
    out.push({ day: key, views: hit ? hit.views : 0, visitors: hit ? hit.visitors : 0 });
  }
  return out;
}

function topPages(days = 30, limit = 10) {
  const since = sinceModifier(days);
  return db
    .prepare(
      `SELECT path, COUNT(*) AS views
       FROM pageviews
       WHERE date(created_at) >= date('now', ?)
       GROUP BY path
       ORDER BY views DESC, path ASC
       LIMIT ?`
    )
    .all(since, Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100));
}

function topReferrers(days = 30, limit = 10) {
  const since = sinceModifier(days);
  return db
    .prepare(
      `SELECT referrer_host AS host, COUNT(*) AS views
       FROM pageviews
       WHERE date(created_at) >= date('now', ?)
         AND referrer_host IS NOT NULL AND referrer_host <> ''
       GROUP BY referrer_host
       ORDER BY views DESC, host ASC
       LIMIT ?`
    )
    .all(since, Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100));
}

function deviceBreakdown(days = 30) {
  const since = sinceModifier(days);
  return db
    .prepare(
      `SELECT COALESCE(NULLIF(device_class, ''), 'unknown') AS device, COUNT(*) AS views
       FROM pageviews
       WHERE date(created_at) >= date('now', ?)
       GROUP BY device
       ORDER BY views DESC`
    )
    .all(since);
}

/** '/%D7%A6…-page.html' ⇄ 'צור-קשר' — one key for both stores. Pageviews
 *  hold the raw percent-encoded pathname; the forms inbox holds the decoded
 *  slug without slash/suffix. */
function normalizePagePath(p) {
  let s = String(p || '');
  try { s = decodeURIComponent(s); } catch (e) { /* malformed % — keep raw */ }
  return s.replace(/^\/+/, '').replace(/\.html$/, '');
}

/**
 * Conversions (v0.84): form submissions against pageviews, per page — the
 * metric an SMB actually acts on ("does my contact page work?"). Computed
 * entirely from data both stores already hold; nothing new is tracked.
 */
function conversions(days = 30) {
  const d = clampDays(days);
  let subs = [];
  try {
    subs = db
      .prepare(
        "SELECT page, COUNT(*) AS submissions FROM form_submissions WHERE created_at >= datetime('now', ?) GROUP BY page"
      )
      .all(sinceModifier(d));
  } catch (e) {
    return { total: 0, rate: null, pages: [] }; // inbox table not created yet
  }
  const views = db
    .prepare(
      "SELECT path, COUNT(*) AS views FROM pageviews WHERE created_at >= datetime('now', ?) GROUP BY path"
    )
    .all(sinceModifier(d));
  const viewsByPage = new Map();
  let totalViews = 0;
  for (const v of views) {
    const key = normalizePagePath(v.path);
    viewsByPage.set(key, (viewsByPage.get(key) || 0) + v.views);
    totalViews += v.views;
  }
  const pages = subs
    .map((s) => {
      const key = normalizePagePath(s.page);
      const pv = viewsByPage.get(key) || 0;
      return {
        page: key || '(דף הבית)',
        views: pv,
        submissions: s.submissions,
        rate: pv ? s.submissions / pv : null
      };
    })
    .sort((a, b) => b.submissions - a.submissions)
    .slice(0, 10);
  const total = subs.reduce((sum, s) => sum + s.submissions, 0);
  return { total, rate: totalViews ? total / totalViews : null, pages };
}

function dashboardData(days = 30) {
  const d = clampDays(days);
  return {
    days: d,
    totals: totals(d),
    byDay: pageviewsByDay(d),
    topPages: topPages(d, 10),
    topReferrers: topReferrers(d, 10),
    devices: deviceBreakdown(d),
    conversions: conversions(d)
  };
}

module.exports = {
  // collector
  recordPageview,
  isBot,
  deviceClass,
  referrerHost,
  visitorHash,
  getDailySalt,
  // dashboard
  dashboardData,
  totals,
  pageviewsByDay,
  topPages,
  topReferrers,
  deviceBreakdown,
  conversions,
  normalizePagePath,
  clampDays
};
