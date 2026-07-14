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
 * Pipeline: HTML → extract main/body + title/dir/lang → htmlToBlocks →
 * fromTapuzPage → serialize → validate. decompileUrl() adds a fetch with an
 * SSRF guard (unlike the lab's blind fetch): the admin pasting a URL must not
 * be able to make this server read localhost, LAN hosts, or cloud metadata.
 */

const { htmlToBlocks } = require('./graduate');
const { deriveSlug } = require('./intent');

/** Pull the main content region from a full HTML page (best-effort). */
function extractBodyHtml(html) {
  const raw = String(html || '');
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(raw);
  if (main) return main[1];
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(raw);
  if (article) return article[1];
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(raw);
  if (body) return body[1];
  return raw;
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

/**
 * Decompile an HTML page (or fragment) into a Tapuz page draft.
 * @param {string} html
 * @param {{ title?: string, slug?: string, lang?: string, dir?: string }} [opts]
 * @returns {{ source: string, blocks: object[], mapped: number, leftover: number,
 *             toolGap: string[], issues: object[], meta: object }}
 */
function decompileHtml(html, opts = {}) {
  const pznApi = require('./index');
  const bodyHtml = extractBodyHtml(html);
  const title = (opts.title || '').trim() || extractTitle(html);
  const dir = opts.dir || extractDir(html);
  const lang = opts.lang || extractLang(html);
  const slug = deriveSlug((opts.slug || '').trim() || title);

  const r = htmlToBlocks(bodyHtml);
  const blocks = r.blocks.length
    ? r.blocks
    : [{ type: 'text', id: 'empty-decompile', data: { content: 'הדף לא הניב מודולים — ייתכן שהוא בנוי בעיקר מסקריפטים.' } }];

  const doc = pznApi.fromTapuzPage({ title, slug, lang, direction: dir, tags: [], meta: {}, blocks });
  let source = '';
  let issues = [];
  try {
    source = pznApi.serialize(doc);
    issues = pznApi.validate(pznApi.parse(source), { strict: false }).filter((i) => i.severity === 'error');
  } catch (e) {
    issues = [{ severity: 'error', message: e.message }];
  }

  return {
    source,
    blocks,
    mapped: r.mapped,
    leftover: r.leftover,
    toolGap: [...new Set(r.suggestedTools || [])],
    issues,
    meta: { title, slug, lang, dir }
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
  const result = decompileHtml(html, opts);
  result.fromUrl = u.href;
  return result;
}

module.exports = {
  decompileHtml,
  decompileUrl,
  extractBodyHtml,
  extractTitle,
  extractDir,
  extractLang,
  assertPublicUrl,
  isPrivateIp
};
