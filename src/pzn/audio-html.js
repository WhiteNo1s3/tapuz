'use strict';

/**
 * Shared audio HTML (v0.80) — one renderer for both the compile path and
 * renderer.js (the video-html/card-html can't-diverge contract).
 *
 * The last media graduation: a native self-hosted <audio> player (podcast
 * episodes, music clips, radio segments). Forgiving like VIDEO: a src that
 * IS a YouTube URL degrades to the same iframe embed rather than a broken
 * <audio> — podcasts often live on YouTube.
 *
 * Security: src through safeHref (no javascript:/data: URLs).
 * Correctness: controls are ALWAYS on (a controls-less audio element is
 * invisible and unplayable without JS); sound-on autoplay is blocked by
 * every browser, so the language simply doesn't offer autoplay here.
 * preload="metadata" — duration shows, bandwidth doesn't burn.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');

// same detection as embed/video — keep them in lockstep
const YT_RE = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/;

function truthy(v) {
  return v === true || v === 'true' || v === '' || v === 1;
}

/** Whole audio figure from block.data. data: {src, caption, loop}.
 *  opts: {idAttr, cls, extra, dir}. */
function renderAudio(data = {}, opts = {}) {
  const idAttr = opts.idAttr || '';
  const cls = opts.cls || '';        // class SUFFIX (goes inside class="")
  const extra = opts.extra || '';    // trailing raw attrs (id/style)
  const dir = opts.dir || '';
  const rawSrc = String(data.src || '');
  const caption = data.caption
    ? `<figcaption class="bent-audio-caption">${escapeHtml(data.caption)}</figcaption>`
    : '';

  // YouTube URL → the embed iframe (forgiving fallback, matches video/embed)
  const yt = rawSrc.match(YT_RE);
  if (yt) {
    return `<figure${idAttr} class="bent-audio video-embed${cls}"${extra}${dir}>` +
      `<iframe src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen loading="lazy" title="YouTube audio"></iframe>` +
      `${caption}</figure>`;
  }

  const src = safeHref(rawSrc);
  if (!src || src === '#') {
    return `<figure${idAttr} class="bent-audio bent-audio-empty${cls}"${extra}${dir}>` +
      `<span>🎧 שמע — בחרו קובץ</span>${caption}</figure>`;
  }

  const loop = truthy(data.loop) ? ' loop' : '';
  return `<figure${idAttr} class="bent-audio${cls}"${extra}${dir}>` +
    `<audio src="${escapeAttr(src)}" controls preload="metadata"${loop}></audio>` +
    `${caption}</figure>`;
}

module.exports = { renderAudio };
