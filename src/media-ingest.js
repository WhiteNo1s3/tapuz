'use strict';

/**
 * Media ingestion (v0.67) — make a decompiled page's pictures OURS.
 *
 * A decompiled page points at someone else's CDN: hotlinks break (referer
 * blocks), pages die when the source dies, and nothing shows in our media
 * library. This walks a block tree, downloads every remote image (same SSRF
 * guard as the decompiler's fetch), converts to webp when sharp is present
 * (original bytes kept when it isn't, or for SVG), saves through the media
 * library's magic-byte gate into /assets/<folder>/, and rewrites the blocks
 * to the local paths — so the decompiled page looks like the page, served
 * entirely by us.
 */

const { assertPublicUrl, eachBlock } = require('./pzn/decompile');

const FETCH_TIMEOUT_MS = 10000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // master download cap (webp shrinks it after)
const DEFAULT_LIMIT = 40;
const WEBP_QUALITY = 82;

let sharpMod; // lazy — sharp is optional; without it originals are kept
function getSharp() {
  if (sharpMod === undefined) {
    try { sharpMod = require('sharp'); } catch (e) { sharpMod = null; }
  }
  return sharpMod;
}

/** Every image reference in a block tree as a {get, set} handle. */
function imageRefs(blocks) {
  const refs = [];
  const add = (obj, key) => {
    const v = obj && obj[key];
    // v2.56: an inline data:image/… (a design plugin's export) is an image
    // that has to become a file too — a 2 MB base64 string in a page is not
    if (typeof v === 'string' && (/^https?:\/\//i.test(v) || /^data:image\/[a-z0-9.+-]+;base64,/i.test(v))) {
      refs.push({ url: v, set: (nv) => { obj[key] = nv; } });
    }
  };
  eachBlock(blocks, (b) => {
    const d = b.data || {};
    if (b.type === 'image') add(d, 'src');
    if (d.image != null) add(d, 'image'); // hero / parallax / backdrop-style
    if (d.poster != null) add(d, 'poster'); // video poster (never the video itself)
    if (d.backdrop) add(d.backdrop, 'image');
    for (const it of d.items || []) {
      if (!it || typeof it !== 'object') continue;
      add(it, 'image');
      if (b.type === 'logos') add(it, 'src'); // a logo strip's pictures (v2.56 — were left hotlinked)
    }
    for (const im of d.images || []) if (im && typeof im === 'object') add(im, 'src');
  });
  return refs;
}

/** Download one image (guarded, capped). Returns a Buffer. */
async function fetchImage(rawUrl) {
  const u = await assertPublicUrl(rawUrl);
  const res = await fetch(u.href, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Tapuziel-Ingest/0.1',
      Accept: 'image/*,*/*;q=0.5',
      Referer: u.origin + '/'
    }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  if (!res.body) throw new Error('empty body');
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_IMAGE_BYTES) {
      reader.cancel().catch(() => {});
      throw new Error('over ' + MAX_IMAGE_BYTES + ' bytes');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** webp when we can, original bytes when we can't (SVG stays SVG). */
async function toWebp(buf) {
  if (buf.slice(0, 64).toString('utf8').trimStart().startsWith('<')) {
    return { buf, ext: null }; // svg/xml — the media gate sanitizes it as-is
  }
  const sharp = getSharp();
  if (!sharp) return { buf, ext: null };
  try {
    // animated:true keeps gif/webp animations alive through the conversion
    const out = await sharp(buf, { animated: true }).rotate().webp({ quality: WEBP_QUALITY }).toBuffer();
    return { buf: out, ext: '.webp' };
  } catch (e) {
    return { buf, ext: null }; // unreadable by sharp — keep the master
  }
}

function nameFromUrl(rawUrl) {
  try {
    const base = decodeURIComponent(new URL(rawUrl).pathname.split('/').filter(Boolean).pop() || '');
    const stem = base.replace(/\.[a-z0-9]+$/i, '').slice(0, 60);
    return stem || 'img';
  } catch (e) { return 'img'; }
}

/**
 * Download every remote image a block tree references and rewrite the blocks
 * to local /assets/ paths. Mutates `blocks` in place. Never throws — a page
 * with three dead images still imports; the report says what failed.
 *
 * @param {object[]} blocks
 * @param {{ folder?: string, limit?: number, fetchImage?: (url: string) => Promise<Buffer> }} [opts]
 *   fetchImage replaces the guarded network (a smoke's fake transport)
 * @returns {Promise<{ found:number, saved:number, failed:{url:string,reason:string}[], skipped:number }>}
 */
async function ingestBlockImages(blocks, opts = {}) {
  const media = require('./media');
  const folder = opts.folder || 'imported';
  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : DEFAULT_LIMIT;

  const getImage = typeof opts.fetchImage === 'function' ? opts.fetchImage : fetchImage;
  const refs = imageRefs(blocks);
  const byUrl = new Map();
  for (const r of refs) {
    if (!byUrl.has(r.url)) byUrl.set(r.url, []);
    byUrl.get(r.url).push(r.set);
  }
  const urls = [...byUrl.keys()];
  const work = urls.slice(0, limit);
  const failed = [];
  let saved = 0;

  // modest parallelism — be a polite guest on the source's CDN
  const CONCURRENCY = 4;
  let next = 0;
  async function worker() {
    for (;;) {
      const idx = next++;
      if (idx >= work.length) return;
      const url = work[idx];
      try {
        const inline = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/i.exec(url);
        const master = inline ? Buffer.from(inline[1], 'base64') : await getImage(url);
        const { buf, ext } = await toWebp(master);
        const stem = inline ? 'design' : nameFromUrl(url);
        const rec = media.saveBuffer({
          filename: ext ? stem + ext : stem,
          buffer: buf,
          folder
        });
        for (const set of byUrl.get(url)) set(rec.url);
        saved += 1;
      } catch (e) {
        failed.push({ url, reason: String(e && e.message || e).slice(0, 120) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, worker));

  return { found: urls.length, saved, failed, skipped: Math.max(0, urls.length - work.length) };
}

module.exports = { ingestBlockImages, imageRefs, fetchImage, toWebp };
