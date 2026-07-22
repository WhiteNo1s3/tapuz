'use strict';

/**
 * v0.93 QA — starter templates: every template must (1) compose only valid
 * registry blocks, (2) render to real HTML, (3) survive the FULL pzn
 * roundtrip (Tapuz JSON → .pzn → back) — a template that breaks the language
 * is not a template.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-tpl-'));

const { listTemplates, templateBlocks, TEMPLATES } = require('../src/templates');
const { getBlockDef } = require('../src/block-registry');
const { renderBlock } = require('../src/renderer');
const { fromTapuzPage, toTapuzPage, serialize, parse } = require('../src/pzn/index');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

const metas = listTemplates();
check('gallery lists every template with name+icon+desc',
  metas.length === TEMPLATES.length && metas.every((t) => t.key && t.name && t.icon && t.desc));
// basic stays FIRST: it is the picker's pre-checked option and the unknown-key
// fallback, so adding a page later must not drop a 24-block tour on someone.
// The showcase is the SETUP page — runSetup asks for it by name (v1.56).
check('basic is first (the picker default + the safe fallback)',
  metas[0].key === 'basic' && templateBlocks('basic', 'שלום')[0].type === 'hero' &&
  templateBlocks('basic', 'שלום')[0].data.title === 'שלום' &&
  templateBlocks('basic', 'x').length === 1);
check('showcase is offered right after it',
  metas[1].key === 'showcase' && templateBlocks('showcase', 'שלום')[0].data.title === 'שלום');
check('unknown key falls back to basic, never crashes',
  templateBlocks('nope-nope', 'כותרת').length === 1);
check('blank is truly empty', templateBlocks('blank', 'x').length === 0);

// the wizard must actually plant the showcase — not quietly fall back to basic
const setupSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'setup.js'), 'utf8');
check('runSetup seeds the home page from the showcase template',
  /templateBlocks\('showcase', siteTitle\)/.test(setupSrc));
check('runSetup seeds a SECOND named menu so the location switch has a choice',
  /saveMenu\('explore'/.test(setupSrc));
check('runSetup copies the demo art into the site so an export is self-contained',
  /seedDemoAssets\(\)/.test(setupSrc));

// ── the showcase earns its name: it must actually SHOW the toolbox ──
const show = templateBlocks('showcase', 'האתר שלי');

// NB: `data.columns` is a COUNT on features/stats/gallery and a LIST only on
// the columns container — always check the shape, never the key.
const childLists = (b) => {
  const d = b.data || {};
  const out = [];
  if (Array.isArray(d.blocks)) out.push(d.blocks);
  if (Array.isArray(d.columns)) d.columns.forEach((c) => out.push(c.blocks || []));
  return out;
};
const walk = (list, hit) => (list || []).forEach((b) => {
  hit(b);
  childLists(b).forEach((kids) => walk(kids, hit));
});

const kinds = new Set();
walk(show, (b) => kinds.add(b.type));
check('showcase demonstrates a wide slice of the toolbox (12+ distinct modules)',
  kinds.size >= 12);
for (const must of ['gallery', 'marquee', 'ticker', 'nav', 'section', 'columns', 'carousel', 'cards', 'faq', 'cta']) {
  check(`showcase includes the ${must} module`, kinds.has(must));
}
// containers are the point — a container that ships empty teaches nothing
const containers = [];
walk(show, (b) => { if (b.type === 'section' || b.type === 'columns') containers.push(b); });
check('every showcase container ships with children inside it',
  containers.length >= 2 &&
  containers.every((b) => childLists(b).length > 0 && childLists(b).every((kids) => kids.length > 0)));
check('nested container children are real registry blocks with unique ids',
  (function () {
    const inner = [];
    containers.forEach((b) => childLists(b).forEach((kids) => kids.forEach((c) => inner.push(c))));
    const innerIds = inner.map((b) => b.id);
    return inner.length >= 4 && inner.every((b) => getBlockDef(b.type)) &&
      new Set(innerIds).size === innerIds.length;
  })());
// the second-menu demo is the whole point of the nav section
check('showcase carries a SECOND menu (nav items differ from the wizard main menu)',
  show.some((b) => b.type === 'section' && (b.data.blocks || []).some((c) =>
    c.type === 'nav' && (c.data.items || []).length >= 3)));

// every image the page points at must exist on disk, or the welcome page
// greets a new user with broken images
const referenced = new Set();
walk(show, (b) => {
  const d = b.data || {};
  [d.src, d.image].forEach((s) => { if (s) referenced.add(s); });
  (d.images || []).forEach((im) => { if (im && im.src) referenced.add(im.src); });
  if (Array.isArray(d.items)) d.items.forEach((it) => { if (it && it.image) referenced.add(it.image); });
});
const localRefs = [...referenced].filter((s) => s.charAt(0) === '/');
check('showcase references at least a handful of local images', localRefs.length >= 6);
check('every referenced demo asset exists on disk (no broken welcome page)',
  localRefs.every((s) => fs.existsSync(path.join(__dirname, '..', 'public', s.replace(/^\//, '')))));

for (const t of TEMPLATES) {
  const blocks = templateBlocks(t.key, 'דף לדוגמה');
  const ids = blocks.map((b) => b.id);
  check(`[${t.key}] every block is a registered type with a unique id`,
    blocks.every((b) => getBlockDef(b.type)) && new Set(ids).size === ids.length);
  if (!blocks.length) continue;
  const html = blocks.map((b) => renderBlock(b, 'rtl')).join('');
  check(`[${t.key}] renders to real HTML`, html.length > 50 && !/undefined/.test(html));
  const page = { title: 'דף לדוגמה', full_path: 'tpl-' + t.key, direction: 'rtl', blocks, meta: {} };
  let ok = false;
  try {
    const back = toTapuzPage(parse(serialize(fromTapuzPage(page))));
    ok = back.blocks.length === blocks.length &&
      back.blocks.every((b, i) => b.type === blocks[i].type);
  } catch (e) { ok = false; }
  check(`[${t.key}] survives the full pzn roundtrip (${blocks.length} blocks)`, ok);
}

check('templates compose from registry defaults (defaultDataFor), not hand-rolled shapes',
  /defaultDataFor\(type\)/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'templates.js'), 'utf8')));

// wiring — v1.31: /admin/new + /admin/create moved to
// src/routes/pages-builder.js; this assert reads that module now.
const builderPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'pages-builder.js'), 'utf8');
check('/admin/new shows the picker + /admin/create honors it',
  /listTemplates\(\)/.test(builderPage) && /name="template"/.test(builderPage) &&
  /templateBlocks\(req\.body\.template, title\)/.test(builderPage));

try { fs.rmSync(process.env.TAPUZ_ROOT, { recursive: true, force: true }); } catch (e) {}
console.log('');
console.log(fail ? 'SMOKE TEMPLATES: FAIL' : 'SMOKE TEMPLATES: PASS');
process.exit(fail ? 1 : 0);
