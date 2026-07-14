'use strict';

/**
 * Shared video HTML (v0.62) — one renderer for both the compile path and
 * renderer.js (like form-html.js / card-html.js / ticker-html.js), so they
 * can't diverge.
 *
 * Batch item 4, "video": a native self-hosted <video> player (the gap — the
 * `embed` module already covers YouTube iframes). To be forgiving, a src that
 * IS a YouTube URL degrades to the same iframe embed rather than a broken
 * <video> — the "we map iframe→embed already" behavior, reused here.
 *
 * Security: src/poster go through safeHref (no javascript:/data: URLs).
 * Correctness: autoplay is IMPOSSIBLE without muted (every browser blocks
 * sound-on autoplay), so autoplay forces muted + playsinline.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');

// same detection as the embed module — keep them in lockstep
const YT_RE = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/;

function truthy(v) {
  return v === true || v === 'true' || v === '' || v === 1;
}

/** Whole video figure from block.data. data: {src, poster, caption,
 *  controls, autoplay, loop, muted}. opts: {idAttr, cls, extra, dir}. */
function renderVideo(data = {}, opts = {}) {
  const idAttr = opts.idAttr || '';
  const cls = opts.cls || '';        // class SUFFIX (goes inside class="")
  const extra = opts.extra || '';    // trailing raw attrs (id/style)
  const dir = opts.dir || '';
  const rawSrc = String(data.src || '');
  const caption = data.caption
    ? `<figcaption class="bent-video-caption">${escapeHtml(data.caption)}</figcaption>`
    : '';

  // YouTube URL → the embed iframe (forgiving fallback, matches `embed`)
  const yt = rawSrc.match(YT_RE);
  if (yt) {
    return `<figure${idAttr} class="bent-video video-embed${cls}"${extra}${dir}>` +
      `<iframe src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen loading="lazy" title="YouTube video"></iframe>` +
      `${caption}</figure>`;
  }

  const src = safeHref(rawSrc);
  const poster = data.poster ? ` poster="${escapeAttr(safeHref(data.poster))}"` : '';
  const controls = truthy(data.controls) ? ' controls' : '';
  const loop = truthy(data.loop) ? ' loop' : '';
  const autoplay = truthy(data.autoplay);
  // autoplay REQUIRES muted (browser policy) — force it, and playsinline so
  // mobile Safari doesn't hijack to fullscreen
  const muted = (autoplay || truthy(data.muted)) ? ' muted' : '';
  const auto = autoplay ? ' autoplay playsinline' : '';
  const videoTag = src && src !== '#'
    ? `<video src="${escapeAttr(src)}"${poster}${controls}${auto}${muted}${loop} preload="metadata">` +
      'הדפדפן שלך אינו תומך בתגית וידאו.</video>'
    : '<div class="bent-video-empty">אין וידאו</div>';
  return `<figure${idAttr} class="bent-video${cls}"${extra}${dir}>${videoTag}${caption}</figure>`;
}

/** Convenience for the renderer: cls = className suffix, extra = id+style. */
function renderVideoFromData(data = {}, dir = '', cls = '', extra = '') {
  const dirAttr = dir ? ` dir="${escapeAttr(dir)}"` : '';
  return renderVideo(data, { cls, extra, dir: dirAttr });
}

module.exports = { renderVideo, renderVideoFromData, YT_RE };
