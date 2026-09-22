'use strict';

/**
 * Geppetto (v2.56) — a Canva website or a Figma site, swallowed whole and
 * given a life as a Tapuziel site.
 *
 * Ben: "we need to get canva sites and make them our own in BenTML … swallow
 * it whole with no salt … if I think on it we can handle figma? … they are
 * imported nonsense, we make a life in them, like pinocchio and jeppetto."
 *
 *   swallow(input)  →  a PLAN: the design read (fetch.js + the decoders →
 *                      the puppet), given its life (life.js), dressed in its
 *                      look (look.js) — pages as BenTML, a theme as
 *                      <bent-theme>, a menu, a report of every choice made.
 *                      Nothing on the site changes; the plan waits on disk
 *                      (config/geppetto/plans/) for the owner's word.
 *   preview(plan)   →  a page of the plan rendered with its candidate theme
 *                      and menu, exactly as it would look live.
 *   land(planId)    →  the plan made real (land.js), with a record…
 *   undo(importId)  →  …that takes it all back.
 *
 * docs/bent-geppetto.md is the owner-facing story.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_NODES = 20000;

const PLAN_TTL_MS = 24 * 60 * 60 * 1000;
const PLANS_KEEP = 12;

function plansDir() {
  return path.join(require('../paths').CONFIG_DIR, 'geppetto', 'plans');
}

function planFile(id) {
  if (!/^pl_[a-f0-9]{10}$/.test(String(id || ''))) return null;
  return path.join(plansDir(), id + '.json');
}

function savePlan(plan) {
  const dir = plansDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(planFile(plan.id), JSON.stringify(plan), 'utf8');
  // keep the shelf small: old or surplus plans go
  const files = fs.readdirSync(dir).filter((f) => /^pl_[a-f0-9]{10}\.json$/.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  files.forEach((x, i) => {
    if (i >= PLANS_KEEP || Date.now() - x.t > PLAN_TTL_MS) {
      try { fs.unlinkSync(path.join(dir, x.f)); } catch (e) { /* best effort */ }
    }
  });
}

function loadPlan(id) {
  const f = planFile(id);
  if (!f || !fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}

function countBlocks(blocks) {
  const tally = {};
  const walk = (list) => (list || []).forEach((b) => {
    tally[b.type] = (tally[b.type] || 0) + 1;
    const d = b.data || {};
    if (Array.isArray(d.blocks)) walk(d.blocks);
    if (Array.isArray(d.columns)) d.columns.forEach((c) => walk(c.blocks));
  });
  walk(blocks);
  return tally;
}

/**
 * Read a design and give it a life — a plan, stored, nothing landed.
 * @param {{ url?: string, html?: string, json?: object|string, token?: string }} input
 * @param {{ transport?: Function, crawl?: boolean, maxPages?: number }} [opts]
 */
async function swallow(input, opts = {}) {
  const { readDesign } = require('./fetch');
  const read = await readDesign(input, opts);
  return planFromPuppet(read.puppet, { door: read.door, fetched: read.fetched, notes: read.notes, url: input.url || '' });
}

/**
 * A puppet → a stored plan: validated, breathed, dressed, serialized. The
 * seam every door shares (and the smoke's way in without a network).
 */
function planFromPuppet(puppet, meta = {}) {
  const P = require('./puppet');
  const life = require('./life');
  const { extractLook } = require('./look');
  const { blocksToSource } = require('./land');
  const issues = P.validatePuppet(puppet);
  if (issues.length) {
    const e = new Error('העיצוב נקרא אבל לא נבנה ממנו אתר תקין: ' + issues.slice(0, 3).join('; '));
    e.code = 'E_PUPPET';
    e.issues = issues;
    throw e;
  }
  // the life pass runs in the request: a design far past any real site (the
  // biggest real sample has ~430 boxes) is refused, not breathed
  const nodes = P.countNodes(puppet);
  if (nodes > MAX_NODES) {
    const e = new Error('העיצוב גדול מדי לייבוא (' + nodes.toLocaleString('he-IL') + ' רכיבים; עד ' + MAX_NODES.toLocaleString('he-IL') + ') — פצלו אותו לכמה אתרים או ייבאו דף אחד בכל פעם');
    e.code = 'E_TOO_BIG';
    throw e;
  }
  return breathed(puppet, meta, P, life, extractLook, blocksToSource);
}

/** The life pass itself — a throw inside it is a refusal the owner can read, its stack goes to the log. */
function breathed(puppet, meta, P, life, extractLook, blocksToSource) {
  try {
    return breathedNow(puppet, meta, P, life, extractLook, blocksToSource);
  } catch (err) {
    if (err && err.code) throw err;
    console.error('[geppetto] the life pass could not build a site from this design:', (err && err.stack) || err);
    const e = new Error('העיצוב נקרא, אבל בניית האתר ממנו נכשלה — העיצוב חריג מדי. נסו דף אחד בכל פעם, או ספרו לנו על הכתובת');
    e.code = 'E_LIFE';
    throw e;
  }
}

function breathedNow(puppet, meta, P, life, extractLook, blocksToSource) {
  const living = life.breathe(puppet);
  if (!living.pages.length || !living.pages.some((p) => p.blocks.length)) {
    // say WHY when a decoder knows (a Figma Make app is code, not a design)
    const why = (meta.notes || []).concat(puppet.notes || []).find((n) => /Figma Make|קוד/.test(n));
    const e = new Error('לא נמצא בעיצוב תוכן לייבא' + (why ? ' — ' + why : ''));
    e.code = 'E_EMPTY_DESIGN';
    throw e;
  }
  const look = extractLook(living, puppet);
  const finished = life.finish(living);
  const pages = finished.pages.map((p) => {
    const { source, errors } = blocksToSource(p);
    return {
      key: p.key,
      slug: p.slug,
      title: p.title,
      path: p.path,
      home: p.home,
      dir: p.dir,
      lang: p.lang,
      description: p.description,
      blocks: countBlocks(p.blocks),
      sections: p.blocks.length,
      source,
      errors: errors.map((x) => x.message).slice(0, 5)
    };
  });
  const title = (living.brand && living.brand.text) || puppet.site.title || pages[0].title || '';
  const fetched = meta.fetched || [];
  const plan = {
    id: 'pl_' + crypto.randomBytes(5).toString('hex'),
    createdAt: new Date().toISOString(),
    source: puppet.source,
    format: puppet.format,
    door: meta.door || puppet.format,
    origin: puppet.origin || meta.url || '',
    title,
    site: puppet.site,
    brand: living.brand,
    pages,
    menu: finished.menu,
    theme: { name: look.name, bent: look.bent, overrides: look.overrides },
    fontMap: look.fontMap,
    palette: look.palette,
    report: Object.assign({}, living.report, { links: finished.links, fetched: fetched.length }),
    notes: [...(meta.notes || []), ...(puppet.notes || []), ...finished.notes],
    fetched: fetched.slice(0, 40),
    living
  };
  savePlan(plan);
  return plan;
}

/** What the admin screen needs of a plan (no sources, no living tree). */
function summarize(plan) {
  return {
    id: plan.id,
    source: plan.source,
    format: plan.format,
    door: plan.door,
    origin: plan.origin,
    title: plan.title,
    brand: plan.brand,
    pages: plan.pages.map((p) => ({ key: p.key, slug: p.slug, title: p.title, path: p.path, home: p.home, dir: p.dir, sections: p.sections, blocks: p.blocks, errors: p.errors })),
    menu: plan.menu,
    theme: { name: plan.theme.name, bent: plan.theme.bent },
    fontMap: plan.fontMap,
    palette: plan.palette,
    report: plan.report,
    notes: plan.notes
  };
}

/**
 * One page of a plan, rendered with the plan's own theme and menu — what the
 * live site would show, before anything lands. Pictures still load from the
 * design's hosting here; landing copies them in.
 */
function previewHtml(plan, key) {
  const page = plan.living.pages.find((p) => p.key === key) || plan.living.pages[0];
  const life = require('./life');
  const finished = life.finish(plan.living);
  const done = finished.pages.find((p) => p.key === page.key) || finished.pages[0];
  const { renderPage } = require('../renderer');
  const pageLike = {
    title: done.title || done.slug,
    full_path: done.slug,
    direction: done.dir === 'rtl' ? 'rtl' : 'ltr',
    blocks: done.blocks,
    meta: { description: done.description || '' },
    status: 'published'
  };
  const main = finished.menu.map((it) => ({ label: it.label, url: it.url, type: 'custom' }));
  return renderPage(pageLike, {
    overrides: plan.theme.overrides,
    menus: { main },
    previewBrand: (plan.brand && plan.brand.text) || '', // none → the site's own logo, as it will stay
    isHome: !!done.home
  });
}

async function landPlan(planId, choices, opts) {
  const plan = loadPlan(planId);
  if (!plan) { const e = new Error('התוכנית פגה או לא נמצאה — קראו את העיצוב שוב'); e.code = 'NO_PLAN'; throw e; }
  return require('./land').land(plan, choices, opts);
}

module.exports = {
  swallow,
  planFromPuppet,
  summarize,
  previewHtml,
  loadPlan,
  landPlan,
  undo: (id, opts) => require('./land').undo(id, opts),
  isLanding: () => require('./land').isLanding(),
  currentLanding: () => require('./land').currentLanding(),
  listImports: () => require('./land').listImports()
};
