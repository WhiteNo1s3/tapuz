'use strict';

/**
 * v0.92 QA — builder keyboard truth: structural shortcuts never fire while
 * typing (form fields OR contenteditable inline editing), and the OS-grade
 * set is complete (Ctrl+S/Z/Y/D, Delete, Esc).
 */

const fs = require('fs');
const path = require('path');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

const builder = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-builder.js'), 'utf8');
const handler = builder.slice(builder.indexOf("document.addEventListener('keydown'"));

check('typing guard covers contenteditable (inline edit), not just form fields',
  /var inField = \/INPUT\|TEXTAREA\|SELECT\/[\s\S]{0,80}isContentEditable/.test(handler));
check('Delete uses the SHARED guard (no separate tagName-only check left)',
  /e\.key === 'Delete' && selectedId && !inField/.test(handler) &&
  !/Delete[\s\S]{0,120}INPUT\|TEXTAREA\|SELECT/.test(handler.slice(handler.indexOf("'Delete'"))));
check('undo/redo respect the guard (browser text-undo wins mid-typing)',
  /'z' \|\| e\.key === 'Z'\) && !inField/.test(handler) && /'y' \|\| e\.key === 'Y'\) && !inField/.test(handler));
check('Ctrl+D duplicates the selected block (guarded)',
  /\(e\.key === 'd' \|\| e\.key === 'D'\) && selectedId && !inField/.test(handler) &&
  /duplicateBlock\(selectedId\)/.test(handler));
check('Ctrl+S still saves', /e\.key === 's' && \(e\.ctrlKey \|\| e\.metaKey\)/.test(handler));
check('Esc still clears selection outside typing', /e\.key === 'Escape'/.test(handler));

try { new Function(builder); check('admin-builder.js parses', true); }
catch (e) { check('admin-builder.js parses (' + e.message + ')', false); }

console.log('');
console.log(fail ? 'SMOKE SHORTCUTS: FAIL' : 'SMOKE SHORTCUTS: PASS');
process.exit(fail ? 1 : 0);
