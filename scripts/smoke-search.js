'use strict';

/**
 * v0.98 QA gate — published-site search: the static-export gap vs.
 * WordPress. `listSearchable()` (the index contract), `renderSearchWidget()`
 * (the gated client widget), and `exportAll()` actually writing/removing
 * search-index.json on a throwaway TAPUZ_ROOT. Exit 1 on any failure.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

// BEFORE any src require — src/paths.js resolves TAPUZ_ROOT at require time
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-search-'));
process.env.TAPUZ_ROOT = tmpRoot;

const { createPage, publishPage, listSearchable } = require('../src/pages');
const { renderSearchWidget } = require('../src/renderer');
const { loadConfig, saveConfig } = require('../src/config');
const { exportAll } = require('../src/export');

let failures = 0;
function check(cond, label) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

// ── listSearchable(): the index contract ──
createPage({
  title: 'עמוד ראשון',
  slug: 'first-page',
  meta: { description: 'תיאור ידני לעמוד' },
  blocks: [{ type: 'text', id: 't1', data: { content: 'תוכן שלא אמור להופיע כי יש תיאור ידני' } }],
  status: 'draft'
});
publishPage('first-page');

createPage({
  title: 'עמוד שני',
  slug: 'second-page',
  blocks: [{ type: 'text', id: 't2', data: { content: 'זהו תוכן ארוך מספיק כדי לשמש כתקציר אוטומטי לעמוד השני.' } }],
  status: 'draft'
});
publishPage('second-page');

createPage({ title: 'טיוטה בלבד', slug: 'draft-only', blocks: [], status: 'draft' });
// deliberately never published

const index = listSearchable();
check(index.length === 2, 'only published pages enter the index (draft excluded)');
const first = index.find((e) => e.url.includes('first-page'));
const second = index.find((e) => e.url.includes('second-page'));
check(!!first && first.title === 'עמוד ראשון', 'title carried through');
check(first.excerpt === 'תיאור ידני לעמוד', 'meta.description wins over block content when set');
check(!!second && second.excerpt.includes('תוכן ארוך מספיק'), 'falls back to auto-extracted teaser when no meta.description/teaser');
check(typeof first.url === 'string' && first.url.startsWith('/'), 'url is a site-relative path');

// ── renderSearchWidget(): gated by config, degrades to '' when off ──
check(renderSearchWidget({}) === '', 'no config → empty string, never throws');
check(renderSearchWidget({ integrations: {} }) === '', 'no search key → empty string');
check(renderSearchWidget({ integrations: { search: { enabled: false } } }) === '', 'explicitly disabled → empty string');
const widget = renderSearchWidget({ integrations: { search: { enabled: true } } });
check(widget.includes('tapuz-search-btn') && widget.includes('tapuz-search-panel'), 'enabled renders the button + panel markup');
check(widget.includes("fetch('/search-index.json')"), 'enabled widget fetches the index the export step writes');
check(widget.includes('<script>') && !widget.includes('<style'), 'ships inline script, no inline <style> (export.js only strips style tags)');

// ── exportAll(): actually writes/removes search-index.json ──
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-search-out-'));
const indexPath = path.join(outDir, 'search-index.json');

const cfgOff = loadConfig();
cfgOff.integrations = cfgOff.integrations || {};
cfgOff.integrations.search = { enabled: false };
saveConfig(cfgOff);
exportAll(outDir);
check(!fs.existsSync(indexPath), 'disabled: exportAll never writes search-index.json');

const cfgOn = loadConfig();
cfgOn.integrations.search = { enabled: true };
saveConfig(cfgOn);
exportAll(outDir);
check(fs.existsSync(indexPath), 'enabled: exportAll writes search-index.json');
const written = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
check(Array.isArray(written) && written.length === 2, 'written index matches listSearchable() output');
check(written.some((e) => e.title === 'עמוד ראשון'), 'written index content is the real page data, not a stub');

const cfgBack = loadConfig();
cfgBack.integrations.search = { enabled: false };
saveConfig(cfgBack);
exportAll(outDir);
check(!fs.existsSync(indexPath), 'toggled back off: a stale index left over from before is cleaned up, not left answering searches');

try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (e) {}

console.log('');
if (failures) {
  console.log('SMOKE SEARCH: FAIL (' + failures + ')');
  process.exit(1);
}
console.log('SMOKE SEARCH: PASS');
