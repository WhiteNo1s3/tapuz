'use strict';

/**
 * Shared before/after comparison HTML — the twentytwenty / image-compare
 * slider renovation, beauty and design sites ship (the gap audit caught
 * it flattening to two loose images). The "after" picture sets the frame,
 * the "before" picture is clipped to a width the range input drives. A
 * tiny inline <script> (survives static export, same contract as
 * countdown) binds the input; without it the block still shows both
 * pictures side by side at the halfway cut.
 */

const { escapeHtml, escapeAttr } = require('./language/escape');
const { blockOpts } = require('./block-attrs');

const SLIDE_JS =
  '(function(){var s=document.currentScript,el=s&&s.previousElementSibling;if(!el)return;' +
  'var r=el.querySelector(".bent-compare-range"),c=el.querySelector(".bent-compare-clip"),d=el.querySelector(".bent-compare-divider");' +
  'if(!r||!c)return;r.addEventListener("input",function(){var v=r.value+"%";c.style.width=v;if(d)d.style.insetInlineStart=v;});})();';

/** Whole compare block. props: {before, after, beforeLabel, afterLabel} */
function renderCompare(props = {}, opts = {}) {
  const before = String(props.before || '').trim();
  const after = String(props.after || '').trim();
  const beforeLabel = escapeHtml(props.beforeLabel || 'לפני');
  const afterLabel = escapeHtml(props.afterLabel || 'אחרי');
  const el = `<div${opts.idAttr || ''} class="bent-compare${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>` +
    '<div class="bent-compare-frame">' +
    (after ? `<img class="bent-compare-after" src="${escapeAttr(after)}" alt="${afterLabel}" loading="lazy">` : '') +
    `<div class="bent-compare-clip" style="width:50%">` +
    (before ? `<img class="bent-compare-before" src="${escapeAttr(before)}" alt="${beforeLabel}" loading="lazy">` : '') +
    '</div>' +
    '<span class="bent-compare-divider" aria-hidden="true" style="inset-inline-start:50%"></span>' +
    `<span class="bent-compare-badge bent-compare-badge-before">${beforeLabel}</span>` +
    `<span class="bent-compare-badge bent-compare-badge-after">${afterLabel}</span>` +
    `<input type="range" class="bent-compare-range" min="0" max="100" value="50" aria-label="${beforeLabel} / ${afterLabel}">` +
    '</div></div>';
  return before && after ? el + `<script>${SLIDE_JS}</script>` : el;
}

/** Convenience for the renderer: whole compare block from block.data. */
function renderCompareFromData(data = {}, dir = '', attrs = {}) {
  return renderCompare(data, blockOpts(dir, attrs));
}

module.exports = { renderCompare, renderCompareFromData };
