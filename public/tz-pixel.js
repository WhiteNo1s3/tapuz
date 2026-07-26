/**
 * Tapuziel enterprise pixel — universal loader (any CMS).
 *
 * Security (v1.99):
 *   - identify() only stores locally and POSTs a *claim* (type=identify).
 *     The server never auto-upserts a contact from this path.
 *   - credentials: 'omit' + CORS * — identity rides the body as claims only.
 *   - Simple-request mode: Content-Type text/plain (no custom headers) so
 *     most beacons skip CORS preflight. Custom headers remain optional debug.
 *   - DNT / GPC skip client-side; server re-checks.
 *
 * Embed (HTTPS required outside localhost — admin snippet builder enforces):
 *   <script src="https://CRM.HOST/tz-pixel.js"
 *     data-tz-pixel-base="https://CRM.HOST"
 *     data-tz-pixel-site="my-site-id"
 *     defer></script>
 *
 * API: TapuzielPixel.init | page | track | identify | setUtm
 */
(function (w, d) {
  'use strict';
  if (w.TapuzielPixel && w.TapuzielPixel.__boot) return;

  var script =
    d.currentScript ||
    d.querySelector('script[src*="tz-pixel"]') ||
    d.querySelector('script[data-tz-pixel-site]');

  function attr(name, fallback) {
    if (!script) return fallback || '';
    var v = script.getAttribute(name);
    return v == null || v === '' ? fallback || '' : v;
  }

  function scriptOrigin() {
    if (!script || !script.src) return '';
    try {
      return new URL(script.src).origin;
    } catch (e) {
      return '';
    }
  }

  var base = String(attr('data-tz-pixel-base', '') || scriptOrigin()).replace(/\/$/, '');
  var siteId = String(attr('data-tz-pixel-site', '') || attr('data-site-id', '') || '').slice(0, 80);
  var collect =
    attr('data-tz-pixel-collect', '') ||
    (base ? base + '/_tapuz/collect' : '/_tapuz/collect');
  var autoPage = attr('data-tz-pixel-auto-page', '1') !== '0';
  var spa = attr('data-tz-pixel-spa', '0') === '1';
  var debug = attr('data-tz-pixel-debug', '0') === '1';
  // Prefer simple requests (text/plain) — no preflight. Opt into full headers
  // only when debugging enterprise fields.
  var simple = attr('data-tz-pixel-simple', '1') !== '0';

  var q = [];
  var cfg = { collect: collect, siteId: siteId, debug: debug, simple: simple };
  var identity = {};
  var lastPath = '';

  function rid() {
    try {
      return crypto.randomUUID();
    } catch (e) {
      return String(Date.now()) + Math.random().toString(16).slice(2);
    }
  }

  function dnt() {
    return (
      navigator.doNotTrack === '1' ||
      w.doNotTrack === '1' ||
      navigator.globalPrivacyControl === true
    );
  }

  function utm() {
    var o = {};
    try {
      var s = new URLSearchParams(location.search);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
        var v = s.get(k);
        if (v) o[k] = v;
      });
    } catch (e) { /* */ }
    return o;
  }

  function pathNow() {
    try {
      return location.pathname + (location.search || '');
    } catch (e) {
      return '/';
    }
  }

  function send(payload) {
    if (dnt()) return;
    payload = payload || {};
    if (!payload.site_id && cfg.siteId) payload.site_id = cfg.siteId;
    if (!payload.event_id) payload.event_id = rid();
    if (!payload.path) {
      var p = pathNow();
      payload.path = p.charAt(0) === '/' ? p : '/' + p;
    }
    if (!payload.path || payload.path.charAt(0) !== '/') {
      payload.path = '/' + String(payload.path || '').replace(/^\/+/, '');
    }
    // Never auto-attach identity onto page/track — that would re-open the
    // "email on every pageview → auto contact" hole. identify() alone claims.

    var body = JSON.stringify(payload);
    var headers;
    if (cfg.simple) {
      // text/plain is a CORS "simple" Content-Type → no preflight
      headers = { 'Content-Type': 'text/plain' };
    } else {
      headers = {
        'Content-Type': 'application/json',
        'X-Tapuziel-Pixel': 'enterprise',
        'X-Tapuziel-Event': String(payload.name || payload.type || 'event').slice(0, 80),
        'X-Request-Id': String(payload.event_id),
        'X-Tapuziel-Site': String(cfg.siteId || '').slice(0, 80)
      };
    }

    var sent = false;
    try {
      fetch(cfg.collect, {
        method: 'POST',
        headers: headers,
        body: body,
        keepalive: true,
        credentials: 'omit',
        mode: 'cors'
      }).catch(function () {});
      sent = true;
    } catch (e) { /* */ }

    if (!sent) {
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(cfg.collect, new Blob([body], { type: 'text/plain' }));
        }
      } catch (e2) { /* */ }
    }

    if (cfg.debug && w.console) console.debug('[TapuzielPixel]', payload);
    return payload.event_id;
  }

  function flushQueue() {
    while (q.length) {
      var x = q.shift();
      try {
        api[x[0]].apply(api, x.slice(1));
      } catch (e) { /* */ }
    }
  }

  var api = {
    __boot: true,
    __ready: true,
    init: function (opts) {
      opts = opts || {};
      if (opts.collect) cfg.collect = String(opts.collect);
      if (opts.siteId) cfg.siteId = String(opts.siteId).slice(0, 80);
      if (opts.base) {
        var b = String(opts.base).replace(/\/$/, '');
        if (!opts.collect) cfg.collect = b + '/_tapuz/collect';
      }
      if (opts.debug != null) cfg.debug = !!opts.debug;
      if (opts.simple != null) cfg.simple = !!opts.simple;
      flushQueue();
      return api;
    },
    page: function (props) {
      props = props || {};
      var u = utm();
      var path = props.path || pathNow();
      if (path.charAt(0) !== '/') path = '/' + path;
      lastPath = path;
      return send({
        type: 'pageview',
        name: 'page_view',
        path: path,
        ref: document.referrer || '',
        event_id: props.event_id || rid(),
        utm_source: u.utm_source || '',
        utm_medium: u.utm_medium || '',
        utm_campaign: u.utm_campaign || '',
        site_id: cfg.siteId
      });
    },
    track: function (name, props) {
      props = props || {};
      var u = utm();
      return send({
        type: 'pixel',
        name: String(name || 'custom').slice(0, 120),
        path: props.path || pathNow(),
        ref: document.referrer || '',
        event_id: props.event_id || rid(),
        utm_source: u.utm_source || '',
        utm_medium: u.utm_medium || '',
        utm_campaign: u.utm_campaign || '',
        site_id: cfg.siteId,
        props: props
      });
    },
    /**
     * Claim identity. Server stores an *unverified claim* until admin approves.
     * Does NOT create a CRM contact by itself.
     */
    identify: function (who) {
      who = who || {};
      if (who.email) identity.email = String(who.email).slice(0, 300);
      if (who.phone) identity.phone = String(who.phone).slice(0, 60);
      if (who.name) identity.name = String(who.name).slice(0, 200);
      if (who.userId) identity.userId = String(who.userId).slice(0, 120);
      if (identity.email || identity.phone) {
        send({
          type: 'identify',
          name: 'identify',
          path: pathNow(),
          email: identity.email || undefined,
          phone: identity.phone || undefined,
          person_name: identity.name || undefined,
          site_id: cfg.siteId,
          event_id: rid()
        });
      }
      return identity;
    },
    setUtm: function () {
      return utm();
    },
    _cfg: function () {
      return { collect: cfg.collect, siteId: cfg.siteId, debug: cfg.debug, base: base, simple: cfg.simple };
    }
  };

  if (w.TapuzielPixel && Array.isArray(w.TapuzielPixel._q)) {
    q = w.TapuzielPixel._q.concat(q);
  }

  w.TapuzielPixel = api;

  if (autoPage && cfg.siteId) {
    try {
      api.page();
    } catch (e) { /* */ }
  }

  if (spa) {
    try {
      var _ps = history.pushState;
      var _rs = history.replaceState;
      function onRoute() {
        var p = pathNow();
        if (p !== lastPath) api.page();
      }
      history.pushState = function () {
        var r = _ps.apply(this, arguments);
        onRoute();
        return r;
      };
      history.replaceState = function () {
        var r = _rs.apply(this, arguments);
        onRoute();
        return r;
      };
      w.addEventListener('popstate', onRoute);
    } catch (e) { /* */ }
  }
})(window, document);
