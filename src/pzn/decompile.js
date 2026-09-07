'use strict';

/**
 * BenTML decompiler — any HTML page → a Tapuz draft page + a toolGap report.
 *
 * The product thesis (Ben's Red Hat line, idea harvested from the grok lab):
 * every real homepage is a MAP OF MISSING TOOLS. Decompile it and you get
 *   - blocks we already speak (heading, text, image, button, embed, list…)
 *   - bent-html provisional leftovers (nothing is ever lost)
 *   - toolGap: the patterns we saw but have no module for (form, table, nav…)
 * The toolGap is the vocabulary backlog — we build those modules, the next
 * decompile maps cleaner, and every agent's dictionary gets richer. The
 * decompiler is not an importer feature; it is how the palette fills.
 *
 * Pipeline (v0.66): HTML → extract main/body + title/dir/lang → a SET of
 * strategies reads the page (flat stream v1, structure hunt v2) → a quality
 * scorer picks the winner → fromTapuzPage → serialize → validate.
 * decompileUrl() adds a fetch with an SSRF guard (unlike the lab's blind
 * fetch): the admin pasting a URL must not be able to make this server read
 * localhost, LAN hosts, or cloud metadata.
 */

const { htmlToBlocks } = require('./graduate');
const { deriveSlug } = require('./intent');

/** Pull the main content region from a full HTML page (best-effort).
 * The walla lesson (v0.67): a homepage has 111 <article> tags — the first-
 * article fallback ate the whole page down to one news item. An <article> is
 * the page only when it IS the page (a single post holding most of the text);
 * a tiny <main> is a client-rendered shell and the body is the truth. */
function extractBodyHtml(html) {
  const raw = String(html || '');
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(raw);
  const scope = body ? body[1] : raw;
  const scopeLen = sourceTextLen(scope);
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(raw);
  if (main && sourceTextLen(main[1]) >= scopeLen * 0.25) return main[1];
  const articleCount = (scope.match(/<article\b/gi) || []).length;
  if (articleCount === 1) {
    const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(scope);
    if (article && sourceTextLen(article[1]) >= scopeLen * 0.5) return article[1];
  }
  return scope;
}

/** The page's own idea of its address — for resolving relative URLs when
 * the HTML was pasted (saved/rendered DOM) rather than fetched. */
function extractBaseUrl(html) {
  const raw = String(html || '');
  const base = /<base\b[^>]*\shref=["']([^"']+)["']/i.exec(raw);
  if (base) return base[1];
  const canon = /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(raw) ||
    /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i.exec(raw);
  if (canon) return canon[1];
  const og = /<meta\b[^>]*property=["']og:url["'][^>]*content=["']([^"']+)["']/i.exec(raw) ||
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:url["']/i.exec(raw);
  if (og) return og[1];
  return '';
}

function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''));
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 120) : 'דף מיובא';
}

function extractDir(html) {
  const m = /<html[^>]*\sdir=["'](rtl|ltr)["']/i.exec(String(html || ''));
  if (m) return m[1].toLowerCase();
  // no declared dir — Hebrew characters anywhere means rtl
  return /[֐-׿]/.test(String(html || '')) ? 'rtl' : 'ltr';
}

function extractLang(html) {
  const m = /<html[^>]*\slang=["']([^"']+)["']/i.exec(String(html || ''));
  if (m) return m[1].slice(0, 12);
  return extractDir(html) === 'rtl' ? 'he' : 'en';
}

// ── the safety guard (v0.66) ───────────────────────────────────────────
// A SET of decompilers reads the same page — the flat stream (v1) and the
// structure hunt (v2) — and a quality scorer picks the winner. A page the
// hunt reads badly still ships with the flat map; a page with real shape
// (halves, heroes, card walls) gets the modular read. toolGap is the union:
// the vocabulary engine keeps every missing-tool sighting from every lens.

const STRUCTURAL_TYPES = new Set(['columns', 'cards', 'hero', 'nav', 'form', 'video', 'embed', 'gallery', 'steps', 'timeline']);

/** Walk a block tree (columns/cards/card children included). */
function eachBlock(blocks, fn) {
  for (const b of blocks || []) {
    fn(b);
    const d = b.data || {};
    if (Array.isArray(d.columns)) d.columns.forEach((c) => eachBlock(c.blocks, fn));
    if (Array.isArray(d.blocks)) eachBlock(d.blocks, fn);
  }
}

/** Visible text a block tree carries (the content the admin would keep).
 * Provisional html blobs do NOT count — a 356KB <script> dump kept "as raw"
 * is preserved, not READ, and must never buy coverage points (v0.68). */
function blockTextLen(blocks) {
  let n = 0;
  eachBlock(blocks, (b) => {
    if (b.type === 'html') return;
    const d = b.data || {};
    n += String(d.text || '').length + String(d.content || '').length;
    n += String(d.title || '').length + String(d.subtitle || '').length + String(d.buttonText || '').length;
    for (const it of d.items || []) {
      if (typeof it === 'string') n += it.length;
      else n += String(it.text || '').length + String(it.label || '').length + String(it.title || '').length + String(it.excerpt || '').length;
    }
  });
  return n;
}

/** Visible text in the source HTML (tags and script/style stripped). */
function sourceTextLen(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/**
 * Score one strategy's read of the page. Bigger is better. The weights say:
 * losing content is worst (coverage), leftover raw HTML is bad, duplicated
 * twins are bad, real structure is good.
 */
function scoreBlocks(blocks, srcTextLen) {
  let total = 0, provisional = 0, structural = 0, empty = 0;
  const keys = new Map();
  eachBlock(blocks, (b) => {
    total += 1;
    const d = b.data || {};
    if (b.type === 'html') provisional += 1;
    if (STRUCTURAL_TYPES.has(b.type)) structural += 1;
    const text = String(d.text || d.content || d.src || d.url || '').trim();
    if (!text && !STRUCTURAL_TYPES.has(b.type) && b.type !== 'divider' && b.type !== 'columns') empty += 1;
    if ((b.type === 'heading' || b.type === 'text' || b.type === 'image' || b.type === 'button') && text) {
      const k = b.type + '|' + text;
      keys.set(k, (keys.get(k) || 0) + 1);
    }
  });
  if (!total) return -1; // nothing read — never beats a real map
  let dups = 0;
  for (const c of keys.values()) dups += c - 1;
  const coverage = Math.min(1, blockTextLen(blocks) / Math.max(srcTextLen, 1));
  return (
    coverage * 50 +
    Math.min(structural, 8) * 4 -
    (provisional / total) * 30 -
    (dups / total) * 20 -
    (empty / total) * 15
  );
}

// ── URL absolutization (v0.67) ─────────────────────────────────────────
// A decompiled walla card says image="/media/123.jpg" — meaningless off
// walla's own host. With the page's base URL every media/link reference
// becomes absolute, so the ingest step can fetch it and the admin's links
// keep working.

const REL_SKIP = /^(https?:|data:|#|mailto:|tel:|javascript:)/i;

function absolutize(v, base) {
  const s = String(v || '').trim();
  if (!s || REL_SKIP.test(s)) return s;
  try { return new URL(s, base).href; } catch (e) { return s; }
}

/** Resolve every media src + link href in a block tree against baseUrl. */
function absolutizeBlockUrls(blocks, baseUrl) {
  if (!baseUrl) return;
  eachBlock(blocks, (b) => {
    const d = b.data || {};
    if (d.src != null) d.src = absolutize(d.src, baseUrl);
    if (d.image != null) d.image = absolutize(d.image, baseUrl);
    if (d.poster != null) d.poster = absolutize(d.poster, baseUrl);
    if (d.url != null) d.url = absolutize(d.url, baseUrl);
    if (d.buttonUrl != null) d.buttonUrl = absolutize(d.buttonUrl, baseUrl);
    if (d.backdrop && d.backdrop.image != null) d.backdrop.image = absolutize(d.backdrop.image, baseUrl);
    for (const it of d.items || []) {
      if (it && typeof it === 'object') {
        if (it.image != null) it.image = absolutize(it.image, baseUrl);
        if (it.href != null) it.href = absolutize(it.href, baseUrl);
      }
    }
    for (const im of d.images || []) {
      if (im && typeof im === 'object' && im.src != null) im.src = absolutize(im.src, baseUrl);
    }
  });
}

/**
 * Decompile an HTML page (or fragment) into a Tapuz page draft.
 * @param {string} html
 * @param {{ title?: string, slug?: string, lang?: string, dir?: string,
 *           strategy?: 'auto'|'hunt'|'flat' }} [opts]
 * @returns {{ source: string, blocks: object[], mapped: number, leftover: number,
 *             toolGap: string[], issues: object[], meta: object,
 *             strategy: string, strategies: object[] }}
 */
function decompileHtml(html, opts = {}) {
  const pznApi = require('./index');
  const { huntBlocks } = require('./hunt');
  const { classBgMap } = require('./graduate');
  const bodyHtml = extractBodyHtml(html);
  // class → CSS background URL, from the FULL page's <style> blocks (emotion/
  // styled-components put card pictures there, invisible in the body alone)
  const bgMap = classBgMap(html);
  const title = (opts.title || '').trim() || extractTitle(html);
  const dir = opts.dir || extractDir(html);
  const lang = opts.lang || extractLang(html);
  const slug = deriveSlug((opts.slug || '').trim() || title);

  const wanted = opts.strategy === 'hunt' || opts.strategy === 'flat' ? opts.strategy : 'auto';
  const runners = [
    { name: 'hunt', run: huntBlocks },
    { name: 'flat', run: htmlToBlocks }
  ].filter((s) => wanted === 'auto' || s.name === wanted);

  const srcLen = sourceTextLen(bodyHtml);
  const attempts = runners.map((s) => {
    const r = s.run(bodyHtml, { bgMap });
    return { name: s.name, r, score: scoreBlocks(r.blocks, srcLen) };
  });
  // hunt is listed first: on a tie the structured read wins
  let best = attempts[0];
  for (const a of attempts) if (a.score > best.score) best = a;

  const r = best.r;
  const blocks = r.blocks.length
    ? r.blocks
    : [{ type: 'text', id: 'empty-decompile', data: { content: 'הדף לא הניב מודולים — ייתכן שהוא בנוי בעיקר מסקריפטים.' } }];
  const baseUrl = opts.baseUrl || extractBaseUrl(html);
  if (baseUrl) absolutizeBlockUrls(blocks, baseUrl);

  const doc = pznApi.fromTapuzPage({ title, slug, lang, direction: dir, tags: [], meta: {}, blocks });
  let source = '';
  let issues = [];
  try {
    source = pznApi.serialize(doc);
    issues = pznApi.validate(pznApi.parse(source), { strict: false }).filter((i) => i.severity === 'error');
  } catch (e) {
    issues = [{ severity: 'error', message: e.message }];
  }

  // toolGap = union across every strategy — the vocabulary engine keeps all
  // sightings even from the read that lost
  const toolGap = [...new Set(attempts.flatMap((a) => a.r.suggestedTools || []))];

  return {
    source,
    blocks,
    mapped: r.mapped,
    leftover: r.leftover,
    toolGap,
    issues,
    meta: { title, slug, lang, dir },
    strategy: best.name,
    strategies: attempts.map((a) => ({
      name: a.name,
      score: Math.round(a.score * 10) / 10,
      mapped: a.r.mapped,
      leftover: a.r.leftover,
      blocks: a.r.blocks.length
    })),
    roles: r.roles || []
  };
}

// ── SSRF guard ─────────────────────────────────────────────────────────
// The decompile endpoint takes a URL from the admin and fetches it SERVER-
// side. Without a guard that is a textbook SSRF: http://localhost:3000/admin,
// http://192.168.1.1/, http://169.254.169.254/latest/meta-data (cloud creds).
// We allow only http(s) to publicly-routable addresses: scheme check, hostname
// denylist, and a DNS resolve with every returned address checked against
// private/reserved ranges. Redirects are followed manually and re-validated
// per hop. (Known limitation: resolve-then-fetch has a DNS-rebinding TOCTOU
// window; acceptable for an authed, rate-limited admin endpoint.)

function isPrivateIpv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true; // unparseable → refuse
  return (
    p[0] === 0 || p[0] === 10 || p[0] === 127 ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||       // CGNAT 100.64/10
    (p[0] === 169 && p[1] === 254) ||                     // link-local / cloud metadata
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 192 && p[1] === 0) ||                       // 192.0.0/24 + 192.0.2/24 doc
    (p[0] === 198 && (p[1] === 18 || p[1] === 19)) ||     // benchmarking
    p[0] >= 224                                           // multicast + reserved
  );
}

function isPrivateIp(ip) {
  const s = String(ip || '').toLowerCase();
  if (s.includes(':')) {
    // IPv6: loopback, unspecified, ULA fc00::/7, link-local fe80::/10, v4-mapped
    if (s === '::1' || s === '::') return true;
    if (/^f[cd]/.test(s)) return true;
    if (/^fe[89ab]/.test(s)) return true;
    const v4 = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (v4) return isPrivateIpv4(v4[1]);
    return false;
  }
  return isPrivateIpv4(s);
}

/** Throws unless the URL is http(s) to a publicly-routable host. */
async function assertPublicUrl(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl));
  } catch (e) {
    throw new Error('כתובת לא תקינה');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('רק כתובות http/https נתמכות');
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('כתובת פנימית חסומה');
  }
  // literal IP → check directly; hostname → resolve and check every address
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (isPrivateIp(host)) throw new Error('כתובת פנימית חסומה');
    return u;
  }
  const dns = require('dns').promises;
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch (e) {
    throw new Error('לא ניתן לפתור את הכתובת');
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error('כתובת פנימית חסומה');
  }
  return u;
}

const FETCH_TIMEOUT_MS = 10000;
const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2MB of HTML is plenty for any homepage
const MAX_REDIRECTS = 3;

/** Fetch a public URL (guarded, manual redirects, size-capped) and decompile it. */
async function decompileUrl(rawUrl, opts = {}) {
  let u = await assertPublicUrl(rawUrl);
  let res;
  for (let hop = 0; ; hop++) {
    res = await fetch(u.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Tapuziel-Decompiler/0.1 (+https://github.com/WhiteNo1s3/tapuz)',
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc || hop >= MAX_REDIRECTS) throw new Error('יותר מדי הפניות (redirects)');
      u = await assertPublicUrl(new URL(loc, u).href); // re-validate EVERY hop
      continue;
    }
    break;
  }
  if (!res.ok) throw new Error('הבאת הדף נכשלה (HTTP ' + res.status + ')');
  const ct = String(res.headers.get('content-type') || '');
  if (ct && !/text\/html|application\/xhtml/i.test(ct)) {
    throw new Error('הכתובת אינה דף HTML (' + ct.split(';')[0] + ')');
  }
  // size-capped read — a huge/endless body must not exhaust memory
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_HTML_BYTES) {
      reader.cancel().catch(() => {});
      throw new Error('הדף גדול מדי לייבוא (מעל 2MB)');
    }
    chunks.push(value);
  }
  const html = Buffer.concat(chunks).toString('utf8');
  const result = decompileHtml(html, { ...opts, baseUrl: u.href });
  result.fromUrl = u.href;
  return result;
}

module.exports = {
  decompileHtml,
  decompileUrl,
  absolutizeBlockUrls,
  eachBlock,
  extractBodyHtml,
  extractBaseUrl,
  extractTitle,
  extractDir,
  extractLang,
  assertPublicUrl,
  isPrivateIp
};
