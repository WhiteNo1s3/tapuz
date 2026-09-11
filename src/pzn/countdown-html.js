'use strict';

/**
 * Shared countdown HTML — sale/launch timers (the Elementor countdown shape
 * the gap audit caught flattening into three meaningless text blocks).
 * The server renders real initial digits so the block is honest even before
 * JS runs; a tiny inline <script> (no external asset — export.js strips only
 * <style>, never <script>, so it survives static export) corrects and ticks.
 * When the target passes, the block swaps to the `done` message.
 */

const { escapeHtml, escapeAttr } = require('./language/escape');

const UNITS = [
  { key: 'days', he: 'ימים', ms: 86400000 },
  { key: 'hours', he: 'שעות', ms: 3600000 },
  { key: 'minutes', he: 'דקות', ms: 60000 },
  { key: 'seconds', he: 'שניות', ms: 1000 }
];

/** Remaining {days,hours,minutes,seconds} to target, all zeros when passed/invalid. */
function remainingTo(target, now = Date.now()) {
  const t = Date.parse(String(target || ''));
  let left = Number.isFinite(t) ? Math.max(0, t - now) : 0;
  const out = {};
  for (const u of UNITS) {
    out[u.key] = Math.floor(left / u.ms);
    left -= out[u.key] * u.ms;
  }
  return out;
}

const TICK_JS =
  '(function(){var s=document.currentScript,el=s&&s.previousElementSibling;if(!el)return;' +
  'var t=Date.parse(el.getAttribute("data-target")||"");if(!isFinite(t))return;' +
  'var ns=el.querySelectorAll(".bent-count-num");' +
  'function pad(n){return n<10?"0"+n:""+n}' +
  'function tick(){var d=t-Date.now();if(d<=0){var done=el.getAttribute("data-done");' +
  'if(done){el.innerHTML="";var m=document.createElement("p");m.className="bent-count-done";m.textContent=done;el.appendChild(m);}' +
  'else{for(var i=0;i<ns.length;i++)ns[i].textContent="00";}clearInterval(iv);return;}' +
  'var v=[Math.floor(d/864e5),Math.floor(d%864e5/36e5),Math.floor(d%36e5/6e4),Math.floor(d%6e4/1e3)];' +
  'for(var i=0;i<ns.length&&i<4;i++)ns[i].textContent=pad(v[i]);}' +
  'var iv=setInterval(tick,1000);tick();})();';

/** Whole countdown block. props: {target, label, done} */
function renderCountdown(props = {}, opts = {}) {
  const target = String(props.target || '').trim();
  const label = escapeHtml(props.label || '');
  const done = String(props.done || '').trim();
  const left = remainingTo(target);
  const passed = target && Date.parse(target) <= Date.now();
  const doneAttr = done ? ` data-done="${escapeAttr(done)}"` : '';
  let inner;
  if (passed && done) {
    inner = `<p class="bent-count-done">${escapeHtml(done)}</p>`;
  } else {
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    inner =
      (label ? `<p class="bent-count-label">${label}</p>` : '') +
      '<div class="bent-count-cells">' +
      UNITS.map((u) =>
        `<span class="bent-count-cell"><span class="bent-count-num">${pad(left[u.key])}</span>` +
        `<span class="bent-count-unit">${u.he}</span></span>`
      ).join('') +
      '</div>';
  }
  const el = `<div${opts.idAttr || ''} class="bent-countdown${opts.cls || ''}" data-target="${escapeAttr(target)}"${doneAttr}${opts.extra || ''}${opts.dir || ''}>${inner}</div>`;
  // no target (or already swapped to done) → static block, no script to ship
  return target && !passed ? el + `<script>${TICK_JS}</script>` : el;
}

/** Convenience for the renderer: whole countdown from block.data. */
function renderCountdownFromData(data = {}, dir = '', extra = '') {
  const dirAttr = dir ? ` dir="${escapeAttr(dir)}"` : '';
  return renderCountdown(data, { dir: dirAttr, extra });
}

module.exports = { renderCountdown, renderCountdownFromData, remainingTo };
