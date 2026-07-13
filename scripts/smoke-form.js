'use strict';

/**
 * v0.58 QA — the form module (the decompiler's #1 tool gap, now first-class).
 * Round-trips block⇄BenTML, validates, proves the pzn compile and renderer.js
 * paths emit identical form HTML (shared form-html.js), the javascript: action
 * guard, field-name sanitization, and — the payoff — that a <form> now
 * DECOMPILES into a form block instead of a provisional bent-html blob.
 */

const pzn = require('../src/pzn/index');
const { renderBlock } = require('../src/renderer');
const { getBlockDef, defaultDataFor } = require('../src/block-registry');
const { htmlToBlocks } = require('../src/pzn/graduate');
const { renderField } = require('../src/pzn/form-html');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const page = {
  title: 't', slug: 't', direction: 'rtl', tags: [], meta: {},
  blocks: [{
    type: 'form', id: 'f1',
    data: {
      action: '/contact', method: 'post', submit: 'שלח',
      fields: [
        { label: 'שם', name: 'name', type: 'text', required: true, placeholder: 'שמך' },
        { label: 'מייל', name: 'email', type: 'email', required: true },
        { label: 'נושא', name: 'topic', type: 'select', options: 'מכירות, תמיכה, אחר' },
        { label: 'מנוי', name: 'sub', type: 'checkbox' },
        { label: 'הודעה', name: 'msg', type: 'textarea' }
      ]
    }
  }]
};

// ── round-trip block ⇄ BenTML ────────────────────────────────────────
const doc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)));
const back = pzn.toTapuzPage(doc);
const f = back.blocks.find((b) => b.type === 'form');
check('form round-trips (5 fields + form props)',
  f && f.data.fields.length === 5 && f.data.action === '/contact' && f.data.submit === 'שלח');
check('field props survive round-trip (required/options/type)',
  f.data.fields[0].required === true && f.data.fields[2].options === 'מכירות, תמיכה, אחר' && f.data.fields[3].type === 'checkbox');
check('validates clean', pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

// ── compile (pzn) + renderer (published) parity ──────────────────────
const compiled = pzn.compile(doc);
const rendered = renderBlock(page.blocks[0], 'rtl');
const shapes = [
  ['<form method=post', /<form[^>]*method="post"/],
  ['required text input', /<input type="text"[^>]*name="name"[^>]*required/],
  ['email input', /<input type="email"[^>]*name="email"/],
  ['select with options', /<select[^>]*name="topic"[^>]*>\s*<option/],
  ['checkbox', /<input type="checkbox"[^>]*name="sub"/],
  ['textarea', /<textarea[^>]*name="msg"/],
  ['submit button', /class="bent-form-submit">שלח<\/button>/]
];
for (const [name, re] of shapes) {
  check('compile: ' + name, re.test(compiled));
  check('render: ' + name, re.test(rendered));
}

// ── security ─────────────────────────────────────────────────────────
const evil = { type: 'form', id: 'e', data: { action: 'javascript:alert(1)', method: 'post', submit: 'x', fields: [{ label: 'a', name: 'a', type: 'text' }] } };
const evilDoc = pzn.parse(pzn.serialize(pzn.fromTapuzPage({ title: 'e', slug: 'e', direction: 'rtl', tags: [], meta: {}, blocks: [evil] })));
check('javascript: action stripped (compile)', !/javascript:/i.test(pzn.compile(evilDoc)));
check('javascript: action stripped (render)', !/javascript:/i.test(renderBlock(evil, 'rtl')));
check('field name reduced to a safe token', / name="ab"/.test(renderField({ name: 'a b<>"', type: 'text', label: 'x' })));

// ── block-registry seed ──────────────────────────────────────────────
check('form has a registry entry + seeded fields', !!getBlockDef('form') && (defaultDataFor('form').fields || []).length >= 1);

// ── the payoff: decompile loop closed ────────────────────────────────
const g = htmlToBlocks('<form action="/r" method="post"><label>Name</label><input name="n" type="text" required/><select name="s"><option>A</option><option>B</option></select><textarea name="m"></textarea><input type="submit" value="Go"/></form>');
const gf = g.blocks.find((b) => b.type === 'form');
check('decompile: <form> → a form block', !!gf);
check('decompile: fields parsed (input+select+textarea, submit skipped)', gf && gf.data.fields.length === 3);
check('decompile: label + required + select options captured',
  gf && gf.data.fields[0].label === 'Name' && gf.data.fields[0].required === true && gf.data.fields[1].options === 'A, B');
check('decompile: form is no longer a toolGap', !g.suggestedTools.includes('form'));

console.log('');
console.log(fail ? 'SMOKE FORM: FAIL' : 'SMOKE FORM: PASS');
process.exit(fail ? 1 : 0);
