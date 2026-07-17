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
check('basic is first (the default = the old single-hero seed)',
  metas[0].key === 'basic' && templateBlocks('basic', 'שלום')[0].type === 'hero' &&
  templateBlocks('basic', 'שלום')[0].data.title === 'שלום');
check('unknown key falls back to basic, never crashes',
  templateBlocks('nope-nope', 'כותרת')[0].type === 'hero');
check('blank is truly empty', templateBlocks('blank', 'x').length === 0);

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

// wiring
const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
check('/admin/new shows the picker + /admin/create honors it',
  /listTemplates\(\)/.test(server) && /name="template"/.test(server) &&
  /templateBlocks\(req\.body\.template, title\)/.test(server));

try { fs.rmSync(process.env.TAPUZ_ROOT, { recursive: true, force: true }); } catch (e) {}
console.log('');
console.log(fail ? 'SMOKE TEMPLATES: FAIL' : 'SMOKE TEMPLATES: PASS');
process.exit(fail ? 1 : 0);
