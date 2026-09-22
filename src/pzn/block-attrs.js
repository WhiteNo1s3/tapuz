'use strict';

/**
 * A block's chrome, handed over as PIECES (v2.54) — the one seam between
 * renderer.js renderBlock() and the shared *-html renderers' *FromData
 * helpers.
 *
 * renderBlock() owns the chrome every block can wear: className, the
 * universal animate (v1.97) and per-device hideOn (v2.12) as class TOKENS
 * (` promo anim-fade hide-on-mobile`), the anchor as ` id="…"`, the paint as
 * ` style="…"`. Until v2.54 it glued the three into one `extra` string, and
 * every helper pasted that string AFTER its own class="…" — so the tokens
 * landed as bogus bare attributes (`<form class="bent-search" … promo
 * anim-fade id="x">`) and never applied. A custom class, an entrance
 * animation or "hide on mobile" silently did nothing on most modules.
 *
 * The pzn registry path always passed { idAttr, cls } apart. Now the
 * renderer path says the same thing: renderBlock hands every helper
 * `attrs = { cls, idAttr, style }` (the shape the v2.53 store renderers take)
 * and blockOpts() turns it into the opts every render*(props, …, opts)
 * already reads — cls INSIDE class="", the id once, the style attribute
 * trailing as opts.extra. Both paths emit the same element.
 * Pinned by scripts/smoke-extra-attrs.js, over every block type.
 */

const { escapeAttr } = require('./language/escape');

/** dir + renderBlock's { cls, idAttr, style } → { dir, idAttr, cls, extra }. */
function blockOpts(dir, attrs) {
  const a = attrs || {};
  return {
    dir: dir ? ` dir="${escapeAttr(dir)}"` : '',
    idAttr: a.idAttr || '',
    cls: a.cls || '',
    extra: a.style || ''
  };
}

module.exports = { blockOpts };
