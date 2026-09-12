'use strict';

/**
 * POST /_tapuz/collect — shared handler (native analytics + foreign pixel).
 *
 * Invariants (v1.99):
 *   1. No unauthenticated body may create or merge a contact.
 *   2. Foreign site_id must resolve through the site registry (else silent 204).
 *   3. Anonymous traffic (native or foreign) stays on the analytics spine
 *      (pageviews); only first-party progressive / linked browsers touch
 *      crm_events via capturePageview.
 *   4. identify-shaped payloads become identity claims, never upserts.
 *
 * Foreign stitching (v2.21): the loader sends a site-local pseudonymous `vid`
 * with every beacon. It is looked up, never stored, here — a browser is bound
 * to a person only by a form submission or an admin-approved claim
 * (visitors.linkToken). An unlinked `vid` is anonymous traffic exactly as
 * before; a linked one appends to that person's timeline, tagged with the
 * site, and still counts on the analytics spine like the native path does.
 */

const analytics = require('../analytics');
const { clientIp } = require('../http-util');
const sites = require('./sites');
const claims = require('./identity-claims');
const visitors = require('./visitors');
const events = require('./events');
const crm = require('./index');

// `track()` from a linked foreign browser lands as its own timeline type.
events.registerType('track', { label: 'אירוע' });

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // credentials deliberately omitted — identity rides the body as claims only
}

function handleOptions(req, res) {
  setCors(res);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Tapuziel-Pixel, X-Tapuziel-Event, X-Request-Id, X-Tapuziel-Site'
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  return res.status(204).end();
}

/**
 * Does this beacon come from the very site it is reporting on?
 *
 * Compares the Origin header's host against the request's own Host, so it
 * works unchanged behind a tunnel or reverse proxy (both carry the public
 * hostname). Used only to protect the NATIVE stream — the foreign path has
 * the site registry and its own per-site origin allowlist.
 */
function isSameOrigin(origin, req) {
  try {
    const host = String(req.headers.host || '').toLowerCase();
    return !!host && new URL(origin).host.toLowerCase() === host;
  } catch (e) {
    return false; // unparseable Origin is not our own
  }
}

/**
 * @param {object} req
 * @param {object} res
 * @param {{ limiter: { allow: Function, retryAfter: Function } }} deps
 */
function handleCollect(req, res, { limiter } = {}) {
  setCors(res);
  try {
    if (req.headers['dnt'] === '1' || req.headers['sec-gpc'] === '1') {
      return res.status(204).end();
    }

    const ua = req.headers['user-agent'] || '';
    if (analytics.isBot(ua)) return res.status(204).end();

    const ip = clientIp(req);
    if (limiter && !limiter.allow('collect:' + ip)) {
      res.setHeader('Retry-After', String(limiter.retryAfter('collect:' + ip)));
      return res.status(429).end();
    }

    const b = req.body && typeof req.body === 'object' ? req.body : {};
    let p = typeof b.path === 'string' ? b.path : '';
    if (!p || p[0] !== '/') return res.status(204).end();
    if (p.length > 512) p = p.slice(0, 512);

    // Never track the admin surface.
    try {
      const auth = require('../auth');
      const base = auth.getAdminBase();
      if (p === '/admin' || p.startsWith('/admin/') || p === base || p.startsWith(base + '/')) {
        return res.status(204).end();
      }
    } catch (e) { /* */ }

    const ref = typeof b.ref === 'string' ? b.ref.slice(0, 1024) : '';
    const eventType = typeof b.type === 'string' ? String(b.type).toLowerCase() : 'pageview';
    const siteFromBody =
      (typeof b.site_id === 'string' && b.site_id) ||
      (req.headers['x-tapuziel-site'] ? String(req.headers['x-tapuziel-site']) : '') ||
      '';
    const siteSlug = sites.normalizeSlug(siteFromBody);
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';

    // ── foreign multi-tenant path ───────────────────────────────────
    if (siteSlug) {
      if (!sites.pixelEmbedEnabled()) return res.status(204).end();
      const resolved = sites.resolveForCollect(siteSlug, origin);
      if (!resolved.ok) return res.status(204).end();

      // The pixel's site-local visitor id, if any. '' unless it is a 32-hex
      // string; the token is site-scoped so it can never replay across sites
      // or masquerade as a first-party cookie token.
      const visitorToken = visitors.foreignToken(siteSlug, typeof b.vid === 'string' ? b.vid : '');
      const linkedId = visitorToken ? visitors.contactIdForToken(visitorToken) : null;

      // identify / claim — never upsertContact from this path
      const isIdentify =
        eventType === 'identify' ||
        eventType === 'identity' ||
        eventType === 'claim' ||
        b.identify === true ||
        b.name === 'identify';

      const email = typeof b.email === 'string' ? b.email : '';
      const phone = typeof b.phone === 'string' ? b.phone : '';
      // Prefer explicit person fields; body.name on identify is the person's name
      const claimName =
        typeof b.person_name === 'string'
          ? b.person_name
          : typeof b.full_name === 'string'
            ? b.full_name
            : isIdentify && typeof b.display_name === 'string'
              ? b.display_name
              : isIdentify && typeof b.name === 'string' && b.name !== 'identify'
                ? b.name
                : '';

      const hasIdentity = !!(email || phone);
      if (isIdentify || hasIdentity) {
        // Always stay quiet if claims are off — no contact, no claim row.
        if (resolved.site.claimsEnabled && hasIdentity) {
          const vh = analytics.visitorHash(ip, ua);
          claims.recordClaim({
            siteId: siteSlug,
            email,
            phone,
            name: claimName,
            path: p,
            visitorHash: vh,
            // remembered on the claim so approval can bind this browser;
            // NOT linked here — that would be the forge-email hole.
            visitorToken
          });
        }
        // Page context for identify may still count as analytics (anonymous)
        if (eventType === 'pageview' || !b.type) {
          analytics.recordPageview({ path: p, referrer: ref, ip, userAgent: ua, siteId: siteSlug });
        }
        return res.status(204).end();
      }

      // Foreign page / track → analytics spine (site_id tagged), as always.
      analytics.recordPageview({ path: p, referrer: ref, ip, userAgent: ua, siteId: siteSlug });

      // Anonymous foreign: intentionally NO capturePageview / crm_events.
      if (linkedId == null) return res.status(204).end();

      // Linked foreign browser (form or approved claim) → that person's
      // timeline. No req/res is passed, so this can never open a card.
      const isTrack = eventType === 'pixel' || eventType === 'track';
      const trackName = isTrack && typeof b.name === 'string' ? b.name.slice(0, 120) : '';
      try {
        crm.capturePageview({
          contactId: linkedId,
          visitorToken,
          siteId: siteSlug,
          path: p,
          type: isTrack ? 'track' : 'pageview',
          title: trackName
        });
      } catch (e) { /* never break the beacon */ }
      return res.status(204).end();
    }

    // ── native first-party path (no site_id) ────────────────────────
    // The native analytics stream belongs to THIS site. A beacon that
    // announces a foreign Origin and names no registered site is refused
    // (v2.02 — found by the live WordPress test: an unregistered id was
    // correctly dropped, but omitting site_id entirely let a foreign page
    // inject arbitrary paths into the owner's OWN analytics). A request
    // with no Origin at all (server-side callers, older clients) keeps the
    // previous behavior, so nothing first-party breaks.
    if (origin && !isSameOrigin(origin, req)) return res.status(204).end();

    // Ignore spoofed email/phone on the native collector too — identity for
    // first-party comes from forms (authenticated by human action), not from
    // a forgeable beacon field.
    if (eventType === 'pageview' || !b.type || eventType === 'pixel') {
      analytics.recordPageview({ path: p, referrer: ref, ip, userAgent: ua });
    }

    // Progressive cards / linked browsers only — guarded CRM seam.
    try {
      crm.capturePageview({ req, res, path: p });
    } catch (e) { /* never break the beacon */ }
  } catch (e) {
    // quiet
  }
  return res.status(204).end();
}

module.exports = { handleCollect, handleOptions, setCors };
