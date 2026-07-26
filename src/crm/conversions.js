'use strict';

/**
 * CRM — server-side conversions (v1.80, phase 3b).
 *
 * A browser pixel is blocked by ad-blockers, ITP and flaky networks; a
 * server-to-server event is not. So a conversion fires twice — once from the
 * browser, once from here — carrying the SAME `eventId` so the vendor
 * deduplicates them into one. That is the whole point of the pairing: better
 * measurement, not double counting.
 *
 * This is the module where a visitor's personal details leave the building, so
 * the rules are strict:
 *
 *   1. OFF by default, and only for vendors that are fully configured.
 *   2. CONSENT DECIDES. The browser writes its consent answer to a cookie, and
 *      nothing is sent for a visitor who refused — a refusal that only stops
 *      the pixel while the server keeps reporting is not consent, it is theatre.
 *   3. PII IS HASHED, never sent in the clear (Meta's spec: trim → lowercase →
 *      SHA-256; phones digits-only first).
 *   4. THE DESTINATION IS HARDCODED. Config supplies credentials and ids —
 *      never a URL — so no setting can redirect an access token somewhere new.
 *   5. IT CANNOT COST A CONVERSION. Every call is timeout-bounded and
 *      fire-and-forget: the visitor's form submission never waits on Meta.
 */

const crypto = require('crypto');

// The only hosts this module will ever talk to. Deliberately not configurable
// — a redirectable endpoint is a credential-exfiltration bug waiting to happen.
const META_HOST = 'https://graph.facebook.com';
const GA4_HOST = 'https://www.google-analytics.com';
const META_API_VERSION = 'v21.0';

// A dead vendor endpoint must never hold a request open.
const TIMEOUT_MS = 4000;

/** Meta's normalization for hashed identifiers: trim, lowercase, SHA-256 hex. */
function sha256Norm(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (!v) return '';
  return crypto.createHash('sha256').update(v).digest('hex');
}

/** Phones normalize to digits only before hashing (Meta's rule). */
function sha256Phone(value) {
  const digits = String(value == null ? '' : value).replace(/\D/g, '');
  if (!digits) return '';
  return crypto.createHash('sha256').update(digits).digest('hex');
}

/** A per-conversion id, shared with the browser pixel so the vendor dedupes. */
function newEventId() {
  return crypto.randomBytes(16).toString('hex');
}

function getConfig(config) {
  const crm = (config && config.crm) || {};
  const c = crm.conversions || {};
  const meta = c.meta || {};
  const ga4 = c.ga4 || {};
  return {
    enabled: !!(crm.enabled && c.enabled),
    // consent is required whenever the pixel layer requires it
    requireConsent: !((crm.pixels || {}).requireConsent === false),
    meta: {
      ready: !!(String(meta.pixelId || '').trim() && String(meta.accessToken || '').trim()),
      pixelId: String(meta.pixelId || '').replace(/\D/g, '').slice(0, 20),
      accessToken: String(meta.accessToken || '').trim(),
      testEventCode: String(meta.testEventCode || '').replace(/[^\w-]/g, '').slice(0, 40)
    },
    ga4: {
      ready: !!(String(ga4.measurementId || '').trim() && String(ga4.apiSecret || '').trim()),
      measurementId: String(ga4.measurementId || '').replace(/[^\w-]/g, '').slice(0, 40),
      apiSecret: String(ga4.apiSecret || '').trim()
    }
  };
}

/** The visitor's consent answer, as mirrored into a cookie by the pixel loader. */
function consentFromRequest(req) {
  const raw = req && req.headers && req.headers.cookie;
  if (!raw) return 'unset';
  const m = String(raw).match(/(?:^|;\s*)tz_consent=([^;]*)/);
  return m ? decodeURIComponent(m[1]).trim() : 'unset';
}

/** Do-Not-Track / GPC is a refusal, and outranks everything. */
function refusesTracking(req) {
  const h = (req && req.headers) || {};
  return h.dnt === '1' || h['sec-gpc'] === '1';
}

/** GA4's client_id lives in the _ga cookie: GA1.1.<cid>. Absent → null. */
function gaClientId(req) {
  const raw = req && req.headers && req.headers.cookie;
  if (!raw) return null;
  const m = String(raw).match(/(?:^|;\s*)_ga=GA\d+\.\d+\.([\d.]+)/);
  return m ? m[1] : null;
}

/** POST JSON with a hard timeout. Resolves to a small result; never throws. */
async function postJson(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    // A timeout, DNS failure or refused connection is the vendor's problem,
    // not the visitor's. Report it for the admin; never propagate.
    return { ok: false, status: 0, error: e.name === 'TimeoutError' ? 'timeout' : e.message };
  }
}

/**
 * Build Meta's Conversions API payload.
 * Exported so the hashing can be asserted against Meta's published spec.
 */
function buildMetaPayload({ contact, eventId, eventName, url, ip, userAgent, country }) {
  const user_data = {};
  const em = sha256Norm(contact && contact.email);
  const ph = sha256Phone(contact && contact.phone);
  if (em) user_data.em = [em];
  if (ph) user_data.ph = [ph];
  if (country) user_data.country = [sha256Norm(country)];
  // These two are NOT hashed — Meta requires them raw for match quality.
  if (ip) user_data.client_ip_address = ip;
  if (userAgent) user_data.client_user_agent = userAgent;

  return {
    data: [
      {
        event_name: eventName || 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'website',
        event_source_url: url || undefined,
        user_data
      }
    ]
  };
}

/** Build the GA4 Measurement Protocol payload. */
function buildGa4Payload({ clientId, eventId, eventName, page }) {
  return {
    client_id: clientId,
    events: [
      {
        name: eventName || 'generate_lead',
        params: {
          event_id: eventId,
          page_location: page || undefined,
          engagement_time_msec: 1
        }
      }
    ]
  };
}

/**
 * Send one conversion to every configured vendor.
 *
 * Fire-and-forget by design: the caller does NOT await this, so a slow vendor
 * cannot delay the visitor's redirect. Returns a promise anyway so tests can.
 *
 * @returns {Promise<{sent:string[], skipped:string[], reason?:string}>}
 */
async function sendConversion({ config, contact, eventId, req, page, eventName } = {}) {
  const c = getConfig(config);
  const out = { sent: [], skipped: [] };

  if (!c.enabled) { out.reason = 'disabled'; return out; }
  if (refusesTracking(req)) { out.reason = 'dnt'; return out; }
  if (c.requireConsent && consentFromRequest(req) !== 'granted') {
    out.reason = 'no-consent';
    return out;
  }

  const ip = req && (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    (req && req.socket && req.socket.remoteAddress) || '';
  const userAgent = (req && req.headers && req.headers['user-agent']) || '';
  const url = page || '';

  const jobs = [];

  if (c.meta.ready) {
    const payload = buildMetaPayload({
      contact, eventId, eventName, url, ip, userAgent,
      country: contact && contact.country
    });
    if (c.meta.testEventCode) payload.test_event_code = c.meta.testEventCode;
    const endpoint =
      `${META_HOST}/${META_API_VERSION}/${encodeURIComponent(c.meta.pixelId)}/events` +
      `?access_token=${encodeURIComponent(c.meta.accessToken)}`;
    jobs.push(
      postJson(endpoint, payload).then((r) => {
        (r.ok ? out.sent : out.skipped).push('meta');
        if (!r.ok) out.metaError = r.error || ('HTTP ' + r.status);
      })
    );
  } else {
    out.skipped.push('meta');
  }

  if (c.ga4.ready) {
    const clientId = gaClientId(req) || eventId; // no _ga cookie → a stable stand-in
    const endpoint =
      `${GA4_HOST}/mp/collect` +
      `?measurement_id=${encodeURIComponent(c.ga4.measurementId)}` +
      `&api_secret=${encodeURIComponent(c.ga4.apiSecret)}`;
    jobs.push(
      postJson(endpoint, buildGa4Payload({ clientId, eventId, eventName, page })).then((r) => {
        (r.ok ? out.sent : out.skipped).push('ga4');
        if (!r.ok) out.ga4Error = r.error || ('HTTP ' + r.status);
      })
    );
  } else {
    out.skipped.push('ga4');
  }

  await Promise.all(jobs);
  return out;
}

/** Admin-facing view of the settings — secrets are NEVER echoed back. */
function describeSettings(config) {
  const c = getConfig(config);
  return {
    enabled: c.enabled,
    meta: {
      pixelId: c.meta.pixelId,
      testEventCode: c.meta.testEventCode,
      hasToken: !!c.meta.accessToken,
      tokenTail: c.meta.accessToken ? c.meta.accessToken.slice(-4) : '',
      ready: c.meta.ready
    },
    ga4: {
      measurementId: c.ga4.measurementId,
      hasSecret: !!c.ga4.apiSecret,
      secretTail: c.ga4.apiSecret ? c.ga4.apiSecret.slice(-4) : '',
      ready: c.ga4.ready
    }
  };
}

/**
 * Does the SERVER-SIDE layer gate on consent? Asked by `consent.js` (v2.10).
 *
 * This is the case the old pixel-owned bar missed entirely: a site sending
 * CAPI/GA4 from the server with no browser vendor configured showed no bar,
 * so `consentFromRequest` never saw 'granted' and every conversion was
 * refused with `no-consent` — a gate with no door.
 */
function needsConsent(config) {
  const c = getConfig(config);
  return !!(c.enabled && c.requireConsent && (c.meta.ready || c.ga4.ready));
}

module.exports = {
  META_HOST, GA4_HOST, TIMEOUT_MS,
  sha256Norm, sha256Phone, newEventId,
  getConfig, consentFromRequest, refusesTracking, gaClientId, needsConsent,
  buildMetaPayload, buildGa4Payload,
  sendConversion, describeSettings
};
