'use strict';

/**
 * Swallowing a design site whole (v2.56) — the fetch layer in front of the
 * decoders.
 *
 * "swallow it whole with no salt": the owner pastes ONE address and gets the
 * whole site. For Canva that means following the design's own links to its
 * other pages (a Canva site is one design per address) and naming the fonts
 * the static export only calls by an id; for Figma Sites it means the bundle
 * JSON every published page boots from, and one JSON per other page of the
 * site; for a Figma design file it means the REST API with the owner's own
 * token (used for this one request, never stored).
 *
 * Every request goes through the decompiler's SSRF guard (public http(s)
 * hosts only, re-checked on every redirect hop), is size-capped and timed
 * out. The decoders stay pure: they never touch the network.
 *
 * Tests hand in `opts.transport(url, { accept, headers, maxBytes })` →
 * `{ status, contentType, buffer, url }` — a fake network, the whole guard
 * included, so a smoke never reaches the internet.
 */

const LIMITS = {
  htmlBytes: 6 * 1024 * 1024,
  jsonBytes: 16 * 1024 * 1024,
  fontBytes: 2 * 1024 * 1024,
  pages: 12,
  fonts: 12,
  timeoutMs: 15000,
  redirects: 4
};

const UA = 'Mozilla/5.0 (compatible; Tapuziel-Geppetto/1.0; +https://github.com/WhiteNo1s3/tapuz)';

function refuse(message, code) {
  const e = new Error(message);
  e.code = code || 'E_GEPPETTO';
  return e;
}

/**
 * A decoder that trips over a design it does not understand (valid JSON of
 * the wrong shape, a page Canva never published) is a refusal, not a server
 * error: the owner reads why in Hebrew, the stack goes to the log only.
 */
function decoded(door, fn) {
  try {
    return fn();
  } catch (e) {
    if (e && e.code) throw e;
    console.error('[geppetto] the ' + door + ' decoder could not read this design:', (e && e.stack) || e);
    throw refuse('העיצוב נקרא, אבל המבנה שלו אינו כמו של ' + (door === 'canva' ? 'אתר Canva' : door === 'svg' ? 'קובץ SVG של כלי עיצוב' : 'אתר Figma') + ' שאנחנו מכירים — לא ניתן לייבא אותו', 'E_DECODE');
  }
}

/** The real network: guarded, manual redirects, size-capped. */
async function realTransport(rawUrl, { accept, headers, maxBytes } = {}) {
  const { assertPublicUrl } = require('../pzn/decompile');
  let u = await assertPublicUrl(rawUrl);
  let res;
  for (let hop = 0; ; hop++) {
    res = await fetch(u.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(LIMITS.timeoutMs),
      headers: Object.assign({ 'User-Agent': UA, Accept: accept || '*/*' }, headers || {})
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc || hop >= LIMITS.redirects) throw refuse('יותר מדי הפניות (redirects)', 'E_REDIRECTS');
      u = await assertPublicUrl(new URL(loc, u).href);
      continue;
    }
    break;
  }
  const cap = maxBytes || LIMITS.htmlBytes;
  const chunks = [];
  let size = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > cap) {
        reader.cancel().catch(() => {});
        throw refuse('הקובץ גדול מדי (' + Math.round(cap / 1048576) + 'MB לכל היותר)', 'E_TOO_BIG');
      }
      chunks.push(value);
    }
  }
  return { status: res.status, contentType: String(res.headers.get('content-type') || ''), buffer: Buffer.concat(chunks), url: u.href };
}

function transportOf(opts) {
  return typeof (opts && opts.transport) === 'function' ? opts.transport : realTransport;
}

async function getText(t, url, accept, maxBytes) {
  const r = await t(url, { accept, maxBytes });
  if (!(r.status >= 200 && r.status < 300)) throw refuse('הבאת ' + url + ' נכשלה (HTTP ' + r.status + ')', 'E_HTTP');
  return { text: r.buffer.toString('utf8'), url: r.url || url, contentType: r.contentType };
}

async function getJson(t, url, headers) {
  const r = await t(url, { accept: 'application/json', headers, maxBytes: LIMITS.jsonBytes });
  if (r.status === 403 || r.status === 401) throw refuse('הגישה נדחתה (HTTP ' + r.status + ') — הטוקן שגוי או שאין לו גישה לקובץ', 'E_AUTH');
  if (r.status === 404) throw refuse('לא נמצא (HTTP 404): ' + url, 'E_NOT_FOUND');
  if (!(r.status >= 200 && r.status < 300)) throw refuse('הבאת ' + url + ' נכשלה (HTTP ' + r.status + ')', 'E_HTTP');
  try { return JSON.parse(r.buffer.toString('utf8')); } catch (e) { throw refuse('התשובה אינה JSON תקין: ' + url, 'E_JSON'); }
}

function originOf(url) {
  try { return new URL(url).origin; } catch (e) { return ''; }
}

// ── Canva: the pasted page, the pages it links to, the fonts it names ─────

async function swallowCanva(t, first, opts, notes) {
  const canva = require('./canva');
  const docs = [first];
  const seen = new Set([normPage(first.url)]);
  const queue = canva.pageLinks(first.html, first.url).filter((u) => originOf(u) === originOf(first.url));
  const maxPages = Math.max(1, Math.min(LIMITS.pages, Number(opts.maxPages) || LIMITS.pages));
  while (queue.length && docs.length < maxPages && opts.crawl !== false) {
    const next = queue.shift();
    const key = normPage(next);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const page = await getText(t, next, 'text/html,application/xhtml+xml');
      if (!canva.detect(page.text)) { notes.push('דף מקושר אינו דף קנבה — דולג: ' + next); continue; }
      docs.push({ url: page.url, html: page.text });
      for (const u of canva.pageLinks(page.text, page.url)) {
        if (originOf(u) === originOf(first.url) && !seen.has(normPage(u))) queue.push(u);
      }
    } catch (e) {
      notes.push('דף מקושר לא נקרא (' + e.message + '): ' + next);
    }
  }
  if (queue.length && docs.length >= maxPages) notes.push('נקראו ' + docs.length + ' דפים — יתר הדפים המקושרים לא יובאו (תקרה)');

  // the static export names a font only by an opaque id — its name lives in the file
  const fontNames = {};
  const faces = [];
  for (const d of docs) for (const f of canva.fontFaces(d.html, d.url) || []) if (!faces.some((x) => x.key === f.key)) faces.push(f);
  if (faces.length) {
    const { familyFromFontBytes } = require('./font-name');
    for (const face of faces.slice(0, LIMITS.fonts)) {
      if (fontNames[face.key]) continue;
      try {
        const r = await t(face.url, { accept: 'font/woff2,font/woff,*/*', maxBytes: LIMITS.fontBytes });
        if (r.status >= 200 && r.status < 300) {
          const fam = familyFromFontBytes(r.buffer);
          if (fam) fontNames[face.key] = fam;
        }
      } catch (e) { /* an unnamed font falls back to its category — never fatal */ }
    }
  }
  const puppet = decoded('canva', () => canva.decode(docs, { fontNames }));
  return { puppet, fetched: docs.map((d) => d.url) };
}

function normPage(url) {
  try {
    const u = new URL(url);
    return u.origin + (u.pathname.replace(/\/+$/, '') || '/');
  } catch (e) { return String(url); }
}

// ── Figma Sites: the bundle behind every published page ───────────────────

async function swallowFigmaSites(t, first, hit, opts, notes) {
  const figma = require('./figma');
  const origin = originOf(first.url);
  if (!origin) throw refuse('כדי לקרוא אתר Figma צריך גם את כתובת האתר', 'E_NEED_URL');
  const index = await getJson(t, origin + hit.indexPath);
  const pages = {};
  const paths = figma.sitesPagePaths(index);
  const maxPages = Math.max(1, Math.min(LIMITS.pages, Number(opts.maxPages) || LIMITS.pages));
  let taken = 0;
  for (const p of paths) {
    if (opts.crawl === false) break;
    if (taken >= maxPages - 1) { notes.push('נקראו ' + (taken + 1) + ' דפים — יתר הדפים לא יובאו (תקרה)'); break; }
    try {
      pages[p] = await getJson(t, origin + figma.sitesPageJsonPath(hit.bundleId, p));
      taken += 1;
    } catch (e) {
      notes.push('הדף ' + p + ' לא נקרא (' + e.message + ')');
    }
  }
  if (hit.isFigmake) notes.push('זה אתר Figma Make — רכיבי הקוד שלו אינם עיצוב שאפשר לייבא; מה שנקרא הוא הטקסט והתמונות שמחוץ לקוד');
  const puppet = decoded('figma-sites', () => figma.fromSites({ origin, index, pages, assetsVersion: hit.assetsVersion, videosVersion: hit.videosVersion }));
  return { puppet, fetched: [first.url, origin + hit.indexPath, ...Object.keys(pages).map((p) => origin + p)] };
}

// ── a Figma design file, with the owner's token ───────────────────────────

async function swallowFigmaFile(t, ref, token, notes) {
  const figma = require('./figma');
  if (!token || !String(token).trim()) {
    throw refuse('קובץ עיצוב של Figma נקרא עם טוקן אישי (Personal access token) — או דרך התוסף של תפוזיאל, או פרסום כ-Figma Site', 'E_NEED_TOKEN');
  }
  const headers = { 'X-Figma-Token': String(token).trim() };
  const q = ref.nodeId ? '?ids=' + encodeURIComponent(ref.nodeId) : '';
  const file = await getJson(t, 'https://api.figma.com/v1/files/' + encodeURIComponent(ref.key) + q, headers);
  let images = {};
  try {
    const im = await getJson(t, 'https://api.figma.com/v1/files/' + encodeURIComponent(ref.key) + '/images', headers);
    images = (im && im.meta && im.meta.images) || (im && im.images) || {};
  } catch (e) {
    notes.push('כתובות התמונות של הקובץ לא נקראו (' + e.message + ') — התמונות ידלגו');
  }
  const puppet = decoded('figma-file', () => figma.fromFile(file, { images, key: ref.key, nodeId: ref.nodeId || null }));
  return { puppet, fetched: ['https://api.figma.com/v1/files/' + ref.key] };
}

// ── the door ──────────────────────────────────────────────────────────────

/**
 * Read a design from whatever the owner handed over.
 * @param {{ url?: string, html?: string, json?: object|string, token?: string }} input
 * @param {{ transport?: Function, crawl?: boolean, maxPages?: number }} [opts]
 * @returns {Promise<{ puppet: object, fetched: string[], notes: string[], door: string }>}
 */
async function readDesign(input = {}, opts = {}) {
  const t = transportOf(opts);
  const notes = [];
  const url = String(input.url || '').trim();

  // SVG files exported from a design tool: one file per page, the first is home
  if (Array.isArray(input.svg) && input.svg.length) {
    const svg = require('./svg');
    const files = input.svg
      .filter((f) => f && typeof f.text === 'string' && f.text.trim())
      .map((f) => ({ name: String(f.name || '').slice(0, 120), text: f.text }));
    if (!files.length) throw refuse('לא נמצא קובץ SVG לקרוא', 'E_NOT_DESIGN');
    // every file must be readable: an export whose words became outlines is the
    // owner's to fix in Figma, and saying which file it was saves the guesswork
    for (const f of files) {
      const seen = svg.detect(f.text);
      if (!seen.ok) throw refuse((files.length > 1 ? '‏' + (f.name || 'הקובץ') + ': ' : '') + seen.message, seen.code);
      if (seen.note) notes.push((files.length > 1 ? (f.name || '') + ': ' : '') + seen.note);
    }
    const puppet = decoded('svg', () => svg.fromSvg(files, { origin: url }));
    return { puppet, fetched: [], notes, door: puppet.door || 'figma-svg' };
  }

  // a JSON file: the plugin's export, a saved REST file, a saved Sites bundle
  if (input.json) {
    const figma = require('./figma');
    let json = input.json;
    if (typeof json === 'string') {
      try { json = JSON.parse(json); } catch (e) { throw refuse('קובץ ה-JSON אינו תקין', 'E_JSON'); }
    }
    if (figma.isPluginExport(json)) return { puppet: decoded('figma-plugin', () => figma.fromPluginExport(json)), fetched: [], notes, door: 'figma-plugin' };
    if (json && json.document && Array.isArray(json.document.children)) {
      notes.push('קובץ Figma שנשמר ידנית — בלי טוקן אין כתובות לתמונות, והן ידלגו');
      return { puppet: decoded('figma-file', () => figma.fromFile(json, { images: {}, key: '' })), fetched: [], notes, door: 'figma-file' };
    }
    if (json && json.nodeById && Array.isArray(json.roots)) {
      const origin = originOf(url);
      if (!origin) notes.push('בלי כתובת האתר אין מאיפה להביא את התמונות — הן ידלגו');
      return { puppet: decoded('figma-sites', () => figma.fromSites({ origin, index: json, pages: {}, assetsVersion: 'v11', videosVersion: 'v1' })), fetched: [], notes, door: 'figma-sites' };
    }
    throw refuse('ה-JSON הזה אינו ייצוא של Figma שאנחנו מכירים', 'E_UNKNOWN');
  }

  // a Figma design-file address → the REST API
  if (url) {
    const figma = require('./figma');
    const ref = figma.parseFileUrl(url);
    if (ref) {
      const r = await swallowFigmaFile(t, ref, input.token, notes);
      return { puppet: r.puppet, fetched: r.fetched, notes, door: 'figma-file' };
    }
  }

  // an HTML page: fetched from the address, or saved and uploaded
  let first;
  if (input.html) {
    first = { url: url || '', html: String(input.html) };
  } else if (url) {
    let page;
    try {
      page = await getText(t, url, 'text/html,application/xhtml+xml');
    } catch (e) {
      throw refuse(e.message, e.code);
    }
    first = { url: page.url, html: page.text };
  } else {
    throw refuse('חסרה כתובת או קובץ', 'E_EMPTY');
  }

  const canva = require('./canva');
  const figma = require('./figma');
  if (canva.detect(first.html)) {
    if (!first.url) notes.push('בלי כתובת האתר אי אפשר לעקוב אחרי הדפים המקושרים ולהביא תמונות יחסיות');
    const r = await swallowCanva(t, first, opts, notes);
    return { puppet: r.puppet, fetched: r.fetched, notes, door: 'canva' };
  }
  const hit = figma.detectSites(first.html);
  if (hit) {
    const r = await swallowFigmaSites(t, first, hit, opts, notes);
    return { puppet: r.puppet, fetched: r.fetched, notes, door: 'figma-sites' };
  }
  if (typeof figma.detectMakeApp === 'function' && figma.detectMakeApp(first.html)) {
    throw refuse('זה אתר Figma Make — תוכנה שנכתבה בקוד, לא עיצוב — ואין בו עיצוב לקרוא. אתר שנבנה ב-Figma Sites, או קובץ העיצוב עצמו, כן ייקראו.', 'E_FIGMA_MAKE');
  }
  throw refuse('זה לא אתר של Canva או Figma. לדף אינטרנט רגיל יש את "ייבוא מכתובת" בבונה הדפים (הפענוח הכללי).', 'E_NOT_DESIGN');
}

module.exports = { readDesign, realTransport, LIMITS, normPage };
