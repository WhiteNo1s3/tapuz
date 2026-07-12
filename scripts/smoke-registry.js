'use strict';

/**
 * smoke-registry.js — validates src/block-registry.js:
 *   1. every entry matches the registry shape contract
 *   2. every registry type ⇄ src/renderer.js renderBlock switch cases
 *      ('map' may be pending renderer wiring — reported, not fatal)
 *   3. every registry entry ⇄ src/bentml/keywords.js (keyword exists, not
 *      reserved, jsonType/bodyClass/params/types/enums/defaults/required
 *      align; keyword params not covered by the registry fail unless
 *      explicitly known-uncovered)
 *   4. blocks.js BLOCK_TYPES coverage
 *   5. the MAP block contract (address/zoom/height)
 *   6. getBlockDef() / defaultDataFor() behavior
 *
 * Run: node scripts/smoke-registry.js  — exits non-zero on any failure.
 */

const fs = require('fs');
const path = require('path');

const {
  BLOCK_REGISTRY,
  BLOCK_CATEGORIES,
  UNIVERSAL_PARAMS,
  INTEGRATIONS_DEFAULTS,
  getBlockDef,
  defaultDataFor
} = require('../src/block-registry');
const { KEYWORDS, RESERVED } = require('../src/bentml/keywords');
const { BLOCK_TYPES } = require('../src/blocks');

const PARAM_TYPES = ['string', 'enum', 'integer', 'boolean', 'ratio', 'list', 'media', 'url', 'textarea'];
const BODY_CLASSES = ['text', 'blocks', 'none', 'raw'];
const BODY_CLASS_BY_KEYWORD_BODY = {
  'TEXT-BODY': 'text',
  'BLOCK-BODY': 'blocks',
  'NO-BODY': 'none',
  'HTML': 'raw'
};
// registry param type → keywords.js param type
const KEYWORD_TYPE_OF = {
  string: 'string', url: 'string', media: 'string', textarea: 'string', ratio: 'string',
  integer: 'integer', enum: 'enum', boolean: 'boolean'
};
// keyword params deliberately not surfaced in the registry (parsed by the
// compiler but never stored in JSON / rendered / decompiled today).
// v0.44 closed the last entries (HERO overlay/parallax) — keep this EMPTY;
// any new gap here is drift and must fail the smoke.
const KNOWN_UNCOVERED = {};
// registry types whose renderer / keywords wiring lands in the next phase
const PENDING_TYPES = ['map'];

let failures = 0;
let checks = 0;
const notes = [];

function fail(msg) {
  failures += 1;
  console.error('  FAIL  ' + msg);
}

function check(cond, msg) {
  checks += 1;
  if (!cond) fail(msg);
  return !!cond;
}

function hasHebrew(s) {
  return /[֐-׿]/.test(String(s || ''));
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function sameSet(a, b) {
  const sa = new Set(a.map(String));
  const sb = new Set(b.map(String));
  if (sa.size !== sb.size) return false;
  for (const v of sa) if (!sb.has(v)) return false;
  return true;
}

// ── 1. entry shape validation ───────────────────────────────────────────
console.log('1. entry shapes');
check(Array.isArray(BLOCK_REGISTRY) && BLOCK_REGISTRY.length > 0, 'BLOCK_REGISTRY is a non-empty array');

const seenTypes = new Set();
const seenKeywords = new Set();

for (const e of BLOCK_REGISTRY) {
  const id = e && e.type ? e.type : JSON.stringify(e).slice(0, 40);

  check(typeof e.type === 'string' && /^[a-z][a-z-]*$/.test(e.type), `${id}: type is a lowercase slug`);
  check(!seenTypes.has(e.type), `${id}: type is unique`);
  seenTypes.add(e.type);

  check(typeof e.keyword === 'string' && /^[A-Z][A-Z-]*$/.test(e.keyword), `${id}: keyword is UPPERCASE`);
  check(!seenKeywords.has(e.keyword), `${id}: keyword is unique`);
  seenKeywords.add(e.keyword);

  check(typeof e.labelHe === 'string' && hasHebrew(e.labelHe), `${id}: labelHe is Hebrew`);
  check(typeof e.icon === 'string' && e.icon.length > 0 && [...e.icon].length <= 2, `${id}: icon is a short emoji/char`);
  check(BLOCK_CATEGORIES.includes(e.category), `${id}: category '${e.category}' is one of ${BLOCK_CATEGORIES.join('/')}`);
  check(BODY_CLASSES.includes(e.bodyClass), `${id}: bodyClass '${e.bodyClass}' is valid`);
  check(e.childrenOf === null || typeof e.childrenOf === 'string', `${id}: childrenOf is string|null`);
  check(e.textField === null || typeof e.textField === 'string', `${id}: textField is string|null`);
  if (e.bodyClass === 'text') {
    check(typeof e.textField === 'string' && e.textField.length > 0, `${id}: TEXT-BODY block declares textField`);
  }
  if (e.childrenKey !== undefined) {
    check(['columns', 'blocks'].includes(e.childrenKey), `${id}: childrenKey is 'columns'|'blocks'`);
  }
  if (e.seed !== undefined) check(isPlainObject(e.seed), `${id}: seed is an object`);
  check(Array.isArray(e.params), `${id}: params is an array`);

  const seenParams = new Set();
  for (const p of e.params || []) {
    const pid = `${id}.${p && p.name}`;
    check(typeof p.name === 'string' && /^[a-zA-Z][a-zA-Z0-9]*$/.test(p.name), `${pid}: param name is an identifier`);
    check(!seenParams.has(p.name), `${pid}: param name is unique within entry`);
    seenParams.add(p.name);
    check(typeof p.labelHe === 'string' && hasHebrew(p.labelHe), `${pid}: labelHe is Hebrew`);
    check(PARAM_TYPES.includes(p.type), `${pid}: type '${p.type}' is one of ${PARAM_TYPES.join('/')}`);

    if (p.type === 'enum') {
      check(Array.isArray(p.enum) && p.enum.length > 0 && p.enum.every((v) => typeof v === 'string'),
        `${pid}: enum param carries a non-empty string values array`);
    } else {
      check(p.enum === undefined, `${pid}: non-enum param has no enum array`);
    }
    if (p.min !== undefined || p.max !== undefined) {
      check(p.type === 'integer', `${pid}: min/max only on integer params`);
      if (p.min !== undefined) check(Number.isInteger(p.min), `${pid}: min is an integer`);
      if (p.max !== undefined) check(Number.isInteger(p.max), `${pid}: max is an integer`);
      if (p.min !== undefined && p.max !== undefined) check(p.min <= p.max, `${pid}: min <= max`);
    }
    if (p.default !== undefined) {
      if (p.type === 'enum') check(p.enum.includes(p.default), `${pid}: default '${p.default}' is in enum`);
      else if (p.type === 'integer') {
        check(Number.isInteger(p.default), `${pid}: integer default`);
        if (p.min !== undefined) check(p.default >= p.min, `${pid}: default >= min`);
        if (p.max !== undefined) check(p.default <= p.max, `${pid}: default <= max`);
      } else if (p.type === 'boolean') check(typeof p.default === 'boolean', `${pid}: boolean default`);
      else if (p.type === 'list') check(Array.isArray(p.default), `${pid}: list default is an array`);
      else check(typeof p.default === 'string', `${pid}: string-family default`);
    }
    if (p.required !== undefined) check(typeof p.required === 'boolean', `${pid}: required is boolean`);
    if (p.hint !== undefined) check(typeof p.hint === 'string' && p.hint.length > 0, `${pid}: hint is a non-empty string`);
    if (p.bentmlParam !== undefined) {
      check(p.bentmlParam === null || typeof p.bentmlParam === 'string', `${pid}: bentmlParam is string|null`);
    }
    if (p.type === 'list') {
      check(p.bentmlParam === null, `${pid}: list params map to child blocks (bentmlParam: null)`);
      check(Array.isArray(p.itemFields) && p.itemFields.length > 0, `${pid}: list param declares itemFields`);
    }
    if (p.valueAliases !== undefined) check(isPlainObject(p.valueAliases), `${pid}: valueAliases is an object`);
  }

  if (typeof e.textField === 'string') {
    check(!seenParams.has(e.textField), `${id}: textField '${e.textField}' does not collide with a param name`);
  }
}

// ── 2. renderer.js switch-case cross-check ──────────────────────────────
console.log('2. renderer.js cross-check');
const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
const start = rendererSrc.indexOf('function renderBlock');
const end = rendererSrc.indexOf('function escapeHtml');
check(start !== -1 && end > start, 'renderer.js contains renderBlock before escapeHtml');
const switchBody = rendererSrc.slice(start, end);
const rendererCases = new Set();
for (const m of switchBody.matchAll(/case '([a-z][a-z-]*)':/g)) rendererCases.add(m[1]);
check(rendererCases.size > 0, 'extracted renderer switch cases');

for (const t of rendererCases) {
  check(seenTypes.has(t), `renderer case '${t}' has a registry entry`);
}
for (const e of BLOCK_REGISTRY) {
  if (rendererCases.has(e.type)) continue;
  if (PENDING_TYPES.includes(e.type)) {
    notes.push(`'${e.type}' is not in renderer.js yet — pending wiring (next phase), as planned`);
  } else {
    fail(`registry type '${e.type}' missing from renderer.js switch`);
  }
  checks += 1;
}

// ── 3. bentml/keywords.js cross-check ───────────────────────────────────
console.log('3. keywords.js cross-check');
for (const e of BLOCK_REGISTRY) {
  check(!RESERVED.has(e.keyword), `${e.type}: keyword ${e.keyword} is not RESERVED`);
  const kw = KEYWORDS[e.keyword];
  if (!kw) {
    if (PENDING_TYPES.includes(e.type)) {
      notes.push(`keyword ${e.keyword} is not in keywords.js yet — pending BenTML 0.2 wiring (next phase), as planned`);
      checks += 1;
      continue;
    }
    fail(`${e.type}: keyword ${e.keyword} missing from keywords.js`);
    checks += 1;
    continue;
  }

  check(BODY_CLASS_BY_KEYWORD_BODY[kw.body] === e.bodyClass,
    `${e.type}: bodyClass '${e.bodyClass}' matches keywords body '${kw.body}'`);
  check(kw.jsonType === e.type, `${e.type}: keywords jsonType '${kw.jsonType}' matches registry type`);

  const kwParams = kw.params || {};
  const covered = new Set();

  for (const p of e.params) {
    const bname = ('bentmlParam' in p) ? p.bentmlParam : p.name;
    if (bname === null) continue; // body/children/builder-derived field
    const pid = `${e.type}.${p.name}`;
    const kp = kwParams[bname];
    if (!check(!!kp, `${pid}: BenTML param '${bname}' exists on ${e.keyword}`)) continue;
    covered.add(bname);

    const aliases = p.valueAliases || null;
    if (aliases) {
      // spelled differently by design — verify the mapped value space instead
      const jsonValues = p.type === 'boolean' ? ['false', 'true'] : (p.enum || []);
      const mapped = jsonValues.map((v) => aliases[String(v)] !== undefined ? aliases[String(v)] : String(v));
      if (kp.values) {
        check(sameSet(mapped, kp.values),
          `${pid}: aliased values [${mapped}] match keywords values [${kp.values}]`);
      }
    } else {
      check(KEYWORD_TYPE_OF[p.type] === kp.type,
        `${pid}: type '${p.type}' maps to keywords type '${kp.type}'`);
      if (p.type === 'enum' && kp.values) {
        check(sameSet(p.enum, kp.values),
          `${pid}: enum [${p.enum}] matches keywords values [${kp.values}]`);
      }
    }
    if (p.default !== undefined && kp.default !== undefined) {
      const mappedDefault = aliases && aliases[String(p.default)] !== undefined
        ? aliases[String(p.default)] : p.default;
      check(String(mappedDefault) === String(kp.default),
        `${pid}: default '${p.default}' aligns with keywords default '${kp.default}'`);
    }
    check(!!p.required === !!kp.required,
      `${pid}: required flag matches keywords (${!!kp.required})`);
  }

  const allowedUncovered = KNOWN_UNCOVERED[e.keyword] || [];
  for (const name of Object.keys(kwParams)) {
    if (covered.has(name)) continue;
    if (allowedUncovered.includes(name)) {
      notes.push(`${e.keyword}.${name} intentionally not surfaced (not stored in JSON today)`);
      checks += 1;
      continue;
    }
    fail(`${e.type}: keywords param ${e.keyword}.${name} has no registry counterpart`);
    checks += 1;
  }
}

// ── 4. blocks.js BLOCK_TYPES coverage ───────────────────────────────────
console.log('4. blocks.js BLOCK_TYPES coverage');
for (const t of BLOCK_TYPES) {
  check(seenTypes.has(t), `BLOCK_TYPES '${t}' has a registry entry`);
}
for (const t of seenTypes) {
  if (!BLOCK_TYPES.includes(t)) {
    if (PENDING_TYPES.includes(t)) {
      notes.push(`'${t}' is not in blocks.js BLOCK_TYPES yet — pending wiring (next phase), as planned`);
      checks += 1;
    } else {
      fail(`registry type '${t}' missing from blocks.js BLOCK_TYPES`);
      checks += 1;
    }
  }
}

// ── 5. MAP block contract ───────────────────────────────────────────────
console.log('5. MAP block contract');
const map = getBlockDef('map');
if (check(!!map, "registry has a 'map' entry")) {
  check(map.keyword === 'MAP', 'map keyword is MAP');
  check(map.bodyClass === 'none', 'MAP is NO-BODY');
  check(!RESERVED.has('MAP'), 'MAP is not a reserved keyword');

  const byName = {};
  for (const p of map.params) byName[p.name] = p;
  const addr = byName.address;
  check(!!addr && addr.type === 'string' && addr.required === true,
    'map.address is a required string (E306 when missing)');
  const zoom = byName.zoom;
  check(!!zoom && zoom.type === 'integer' && zoom.min === 1 && zoom.max === 20 && zoom.default === 15,
    'map.zoom is integer 1-20 default 15');
  const height = byName.height;
  check(!!height && height.type === 'enum' && sameSet(height.enum, ['sm', 'md', 'lg']) && height.default === 'md',
    'map.height is enum sm|md|lg default md');

  const mapData = defaultDataFor('map');
  check(mapData.address === '' && mapData.zoom === 15 && mapData.height === 'md',
    `defaultDataFor('map') = { address:'', zoom:15, height:'md' } (got ${JSON.stringify(mapData)})`);
}

// ── 6. getBlockDef / defaultDataFor / integrations defaults ─────────────
console.log('6. getBlockDef / defaultDataFor');
check(getBlockDef('no-such-type') === null, 'getBlockDef(unknown) returns null');
for (const e of BLOCK_REGISTRY) {
  check(getBlockDef(e.type) === e, `getBlockDef('${e.type}') returns the entry`);
  const data = defaultDataFor(e.type);
  check(isPlainObject(data), `defaultDataFor('${e.type}') returns an object`);
  if (e.bodyClass === 'text') {
    check(typeof data[e.textField] === 'string',
      `defaultDataFor('${e.type}') seeds textField '${e.textField}'`);
  }
  for (const p of e.params) {
    if (p.required) {
      check(data[p.name] !== undefined,
        `defaultDataFor('${e.type}') provides required param '${p.name}'`);
    }
    if (p.type === 'enum' && data[p.name] !== undefined) {
      check(p.enum.includes(data[p.name]),
        `defaultDataFor('${e.type}').${p.name} '${data[p.name]}' is a valid enum value`);
    }
  }
  // defaults must be cloned, not shared references
  const again = defaultDataFor(e.type);
  for (const k of Object.keys(data)) {
    if (data[k] != null && typeof data[k] === 'object') {
      check(data[k] !== again[k], `defaultDataFor('${e.type}').${k} is cloned per call`);
    }
  }
}
check(isPlainObject(defaultDataFor('no-such-type')) && Object.keys(defaultDataFor('no-such-type')).length === 0,
  'defaultDataFor(unknown) returns {}');

const wa = INTEGRATIONS_DEFAULTS && INTEGRATIONS_DEFAULTS.whatsapp;
check(!!wa && wa.enabled === false && wa.phone === '' && wa.message === '' && ['start', 'end'].includes(wa.position),
  'INTEGRATIONS_DEFAULTS.whatsapp matches the contract (enabled:false, phone:"", message:"", position:start|end)');
check(Array.isArray(UNIVERSAL_PARAMS) && UNIVERSAL_PARAMS.some((p) => p.name === 'className' && p.bentmlParam === 'class')
  && UNIVERSAL_PARAMS.some((p) => p.name === 'id'),
  'UNIVERSAL_PARAMS covers className (BenTML class) and id');

// ── summary ─────────────────────────────────────────────────────────────
console.log('');
for (const n of notes) console.log('  NOTE  ' + n);
console.log('');
console.log(`registry entries: ${BLOCK_REGISTRY.length} | renderer cases: ${rendererCases.size} | checks: ${checks} | failures: ${failures}`);
if (failures > 0) {
  console.error('SMOKE REGISTRY: FAIL');
  process.exit(1);
}
console.log('SMOKE REGISTRY: PASS');
