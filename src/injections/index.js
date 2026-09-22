'use strict';

/**
 * The injection registry (v2.28) — one table of every "pack" the CMS can
 * hand to an AI and take an answer back from: the menu organizer, the theme
 * designer, and the stubs waiting for their turn (effects, site builder).
 *
 * WHY a registry: until now each pack grew its own routes, its own paste
 * door, its own card (the theme studio has three of them). The organizer
 * would have been the fourth copy. Instead every pack is one DESCRIPTOR with
 * the same six verbs — buildPrompt / parse / apply / undo + run + ui — and
 * ONE router (src/routes/inject.js) plus ONE card (public/admin-inject-card.js)
 * serve all of them. A new pack is a new file in this folder and nothing else.
 *
 * Validation happens at BOOT, not at request time: a descriptor that is
 * missing a verb is a programming error, and the server should refuse to
 * start rather than 500 on the owner's first click.
 *
 * Descriptor shape — docs/INJECTIONS.md and the v2.28 contract:
 *   { id, kind, family:'site'|'theme'|'pages', title, blurb,
 *     budget:{lite, full},
 *     buildPrompt({brief,size,locale,variant,ctx}) → {text, chars, meta} | null (stub),
 *     parse(reply, ctx, {brief}) → {preview, warnings:[{code,message}], warningTexts, notes, hard} | throws Error{code},
 *     apply(reply, ctx, {force, brief}) → {landed:{type,id,url}, backupId, changed, rebuildError, warnings},
 *     undo(ctx) → {restored},
 *     run:{enabled, maxTokens, timeoutMs:{local, cloud}, repairable:[codes]},
 *     ui:{briefPlaceholder, sizes, applyLabel, mount, renderPreview(preview) → html, canApply, hidden?},
 *     ready?() → boolean   // optional: false while a module the pack wires is absent
 *   }
 */

const FAMILIES = ['site', 'theme', 'pages'];
const ID_RE = /^[a-z][a-z0-9-]{1,40}$/;

const packs = new Map();

function fail(id, what) {
  throw new Error('injection descriptor ' + (id ? '"' + id + '"' : '') + ': ' + what);
}

function isFn(v) { return typeof v === 'function'; }
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/** Validate the contract shape; throw on anything a route would trip over. */
function validate(d) {
  if (!isObj(d)) fail('', 'not an object');
  const id = d.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) fail(String(id), 'id must match ' + ID_RE);
  if (packs.has(id)) fail(id, 'duplicate id');
  if (typeof d.kind !== 'string' || !d.kind) fail(id, 'kind required');
  if (!FAMILIES.includes(d.family)) fail(id, 'family must be one of ' + FAMILIES.join('|'));
  if (typeof d.title !== 'string' || !d.title.trim()) fail(id, 'title required');
  if (typeof d.blurb !== 'string') fail(id, 'blurb required (string)');
  if (!isObj(d.budget) || !Number.isFinite(d.budget.lite) || !Number.isFinite(d.budget.full)) fail(id, 'budget {lite, full} required');
  // a stub ships buildPrompt: null — the routes answer NOT_READY for it
  if (d.buildPrompt !== null && !isFn(d.buildPrompt)) fail(id, 'buildPrompt must be a function or null');
  for (const verb of ['parse', 'apply', 'undo']) if (!isFn(d[verb])) fail(id, verb + '() required');
  if (!isObj(d.run) || typeof d.run.enabled !== 'boolean') fail(id, 'run.enabled (boolean) required');
  if (d.run.enabled) {
    if (!Number.isFinite(d.run.maxTokens) || d.run.maxTokens <= 0) fail(id, 'run.maxTokens required when run is enabled');
    if (!isObj(d.run.timeoutMs) || !Number.isFinite(d.run.timeoutMs.local) || !Number.isFinite(d.run.timeoutMs.cloud)) fail(id, 'run.timeoutMs {local, cloud} required');
  }
  // repairable may be a lazy getter (the organizer reads C's REPAIRABLE at
  // call time) — it only has to be an array when read
  if (d.run.repairable !== undefined && !Array.isArray(d.run.repairable)) fail(id, 'run.repairable must be an array');
  if (!isObj(d.ui)) fail(id, 'ui required');
  if (!Array.isArray(d.ui.sizes) || !d.ui.sizes.length || !d.ui.sizes.every((s) => s === 'lite' || s === 'full')) fail(id, 'ui.sizes must list lite|full');
  if (!Array.isArray(d.ui.mount)) fail(id, 'ui.mount must be an array of admin paths');
  if (!isFn(d.ui.renderPreview)) fail(id, 'ui.renderPreview() required');
  if (d.ready !== undefined && !isFn(d.ready)) fail(id, 'ready must be a function when present');
  return d;
}

function register(descriptor) {
  const d = validate(descriptor);
  packs.set(d.id, d);
  return d;
}

function get(id) {
  return packs.get(String(id || '')) || null;
}

/** Is the module this pack wires actually present? (group C's organizer
 *  lands beside this file; the registry must boot without it.) */
function isReady(d) {
  if (!isFn(d.ready)) return true;
  try { return d.ready() !== false; } catch (e) { return false; }
}

/** Public summaries — what GET /admin/api/inject and the card see. */
function list() {
  return Array.from(packs.values()).map((d) => {
    const ready = isReady(d);
    return {
      id: d.id,
      kind: d.kind,
      title: d.title,
      blurb: d.blurb,
      family: d.family,
      budget: { lite: d.budget.lite, full: d.budget.full },
      run: { enabled: !!d.run.enabled && ready && d.buildPrompt !== null },
      notReady: !ready,
      ui: {
        sizes: d.ui.sizes.slice(),
        mount: d.ui.mount.slice(),
        briefPlaceholder: String(d.ui.briefPlaceholder || ''),
        applyLabel: String(d.ui.applyLabel || '✅ החל'),
        canApply: d.ui.canApply !== false,
        hidden: d.ui.hidden === true
      }
    };
  });
}

// ── the generic preview renderer (server-side twin of the card's) ────────
// A descriptor's ui.renderPreview may just delegate here: the preview JSON
// is the contract, and this turns it into the same nested list / diff strips
// / knob diff / fit line the card draws — for a no-JS glance or a test.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STATUS_MARK = { ok: '✓', draft: '⚠', dropped: '✗', group: '▸' };

function renderTree(items) {
  if (!Array.isArray(items) || !items.length) return '';
  return '<ul class="inject-tree">' + items.map((it) => {
    const mark = STATUS_MARK[it && it.status] || '·';
    const url = it && it.url ? ' <small dir="ltr">' + esc(it.url) + '</small>' : '';
    return '<li data-status="' + esc((it && it.status) || '') + '"><span class="inject-mark">' + mark + '</span> ' +
      esc((it && it.label) || '') + url + renderTree(it && it.children) + '</li>';
  }).join('') + '</ul>';
}

function genericPreviewHtml(preview) {
  const p = isObj(preview) ? preview : {};
  const out = [];
  if (p.note) out.push('<p class="inject-note">' + esc(p.note) + '</p>');
  if (p.fitLine) out.push('<p class="inject-fit">' + esc(p.fitLine) + '</p>');
  if (isObj(p.menus)) {
    for (const name of Object.keys(p.menus)) {
      const m = p.menus[name] || {};
      out.push('<h4 class="inject-menu-name">' + esc(name) + (m.location ? ' <small>(' + esc(m.location) + ')</small>' : '') + '</h4>');
      out.push(renderTree(m.tree));
      const d = isObj(p.diff) ? p.diff[name] : null;
      if (d) {
        const strip = [];
        (d.added || []).forEach((l) => strip.push('<span class="pill ok">+ ' + esc(l) + '</span>'));
        (d.removed || []).forEach((l) => strip.push('<span class="pill danger">− ' + esc(l) + '</span>'));
        (d.moved || []).forEach((l) => strip.push('<span class="pill info">↕ ' + esc(l) + '</span>'));
        (d.relabeled || []).forEach((pair) => strip.push('<span class="pill warn">' + esc(pair && pair[0]) + ' → ' + esc(pair && pair[1]) + '</span>'));
        if (strip.length) out.push('<div class="inject-diff">' + strip.join(' ') + '</div>');
      }
    }
  }
  if (isObj(p.knobs) && Array.isArray(p.knobs.changed) && p.knobs.changed.length) {
    out.push('<ul class="inject-knobs">' + p.knobs.changed.map((k) =>
      '<li><code>' + esc(k.key) + '</code>: ' + esc(k.from) + ' → <strong>' + esc(k.to) + '</strong></li>').join('') + '</ul>');
  }
  if (Array.isArray(p.sections) && p.sections.length) {
    out.push('<div class="inject-diff">' + p.sections.map((s) => '<span class="pill accent">' + esc(s) + '</span>').join(' ') + '</div>');
  }
  if (p.previewUrl) {
    out.push('<iframe src="' + esc(p.previewUrl) + '" sandbox="allow-same-origin" title="תצוגה מקדימה" style="width:100%;height:260px;border:1px solid var(--line, #ddd)"></iframe>');
  } else if (p.previewHtml) {
    out.push('<iframe srcdoc="' + esc(p.previewHtml) + '" sandbox="allow-same-origin" title="תצוגה מקדימה" style="width:100%;height:260px;border:1px solid var(--line, #ddd)"></iframe>');
  }
  return out.join('\n');
}

// ── boot: the shipped packs ──────────────────────────────────────────────
register(require('./menu-organizer'));
register(require('./theme-designer'));
register(require('./theme-effects'));
register(require('./site-builder'));
register(require('./store-catalog'));

module.exports = { register, get, list, isReady, genericPreviewHtml, FAMILIES };
