'use strict';

/**
 * v0.91 QA — symbols: saved reusable blocks (Builder.io parity, unsynced
 * copies). Store contract behaviorally on a throwaway site; builder/route
 * wiring asserted on source.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// BEFORE any src require — paths resolve TAPUZ_ROOT at require time
process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-sym-'));

const symbols = require('../src/symbols');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

// ── store contract ──
const hero = {
  id: 'hero_1', type: 'hero',
  data: { title: 'הירו שמור', blocks: [{ id: 'h_1', type: 'heading', data: { text: 'בפנים' } }] }
};
const saved = symbols.saveSymbol({ name: '  הירו פתיחה  ', block: hero });
check('save works, name trimmed', saved.ok && saved.symbol.name === 'הירו פתיחה');
check('symbol carries the block type for the library badge', saved.symbol.type === 'hero');
check('nested children preserved in the snapshot',
  saved.symbol.block.data.blocks[0].data.text === 'בפנים');

hero.data.title = 'שונה אחרי השמירה';
check('snapshot is DETACHED — later mutations do not leak in',
  symbols.listSymbols()[0].block.data.title === 'הירו שמור');

check('persisted to content/symbols.json under TAPUZ_ROOT',
  symbols.SYMBOLS_PATH.startsWith(process.env.TAPUZ_ROOT) && fs.existsSync(symbols.SYMBOLS_PATH));
check('nameless save rejected with Hebrew guidance',
  symbols.saveSymbol({ name: '   ', block: hero }).ok === false);
check('typeless block rejected', symbols.saveSymbol({ name: 'x', block: { data: {} } }).ok === false);
check('oversized block rejected',
  symbols.saveSymbol({ name: 'big', block: { type: 'text', data: { content: 'א'.repeat(120000) } } }).ok === false);

const second = symbols.saveSymbol({ name: 'כרטיס', block: { id: 'c1', type: 'card', data: {} } });
check('list is newest-first', symbols.listSymbols()[0].id === second.symbol.id);
check('delete removes exactly the one', symbols.deleteSymbol(second.symbol.id) === true &&
  symbols.listSymbols().length === 1 && symbols.deleteSymbol('sym_nope') === false);

// ── wiring (source asserts) ──
const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
const builder = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-builder.js'), 'utf8');

check('symbols API routes exist (list/save/delete)',
  /app\.get\('\/admin\/api\/symbols'/.test(server) &&
  /app\.post\('\/admin\/api\/symbols'/.test(server) &&
  /app\.post\('\/admin\/api\/symbols\/delete'/.test(server));
check('toolbox carries the symbols fold', /id="symbols-fold"/.test(server) && /id="symbols-list"/.test(server));
check('block toolbar has the 💠 save action',
  /data-act="sym"/.test(server + builder) && /saveAsSymbol\(block\.id\)/.test(builder));
check('insert = deep copy + freshIds (shared with duplicate — no id collisions)',
  /freshIds\(JSON\.parse\(JSON\.stringify\(sym\.block\)\)\)/.test(builder) &&
  /freshIds\(JSON\.parse\(JSON\.stringify\(n\.block\)\)\)/.test(builder));
check('insert lands after the selection, else at page end',
  /n\.list\.splice\(n\.index \+ 1, 0, copy\); \/\/ lands right after the selection/.test(builder));
check('insert is undoable + selects the copy',
  /function insertSymbol[\s\S]{0,200}pushHistory\(\)/.test(builder));
check('library rows render via textContent (no markup injection)',
  /name\.textContent = sym\.name/.test(builder));
check('delete asks first and reassures pages are untouched', /דפים שכבר משתמשים בו לא ייפגעו/.test(builder));

try { new Function(builder); check('admin-builder.js parses', true); }
catch (e) { check('admin-builder.js parses (' + e.message + ')', false); }

try { fs.rmSync(process.env.TAPUZ_ROOT, { recursive: true, force: true }); } catch (e) {}
console.log('');
console.log(fail ? 'SMOKE SYMBOLS: FAIL' : 'SMOKE SYMBOLS: PASS');
process.exit(fail ? 1 : 0);
