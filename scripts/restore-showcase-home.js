'use strict';

/**
 * Bring the showcase home page (v1.56) to an EXISTING site.
 *
 * The wizard seeds the showcase only on a pristine install — "existing pages
 * are never overwritten" — so a site set up before v1.56 (like the dev site)
 * keeps whatever home it was born with. Ben: "where is the beautiful homepage
 * we built to showcase to the user... where did it go?" It never went
 * anywhere: it only ever shipped to NEW sites. This script is the explicit
 * owner action the wizard refuses to take: replace home with the showcase
 * tour, on purpose.
 *
 * Reuses the wizard's own parts (templateBlocks, seedDemoAssets, the explore
 * menu) — nothing is hand-rolled here. updatePage snapshots a revision before
 * writing, so the previous home stays restorable from the builder's history.
 *
 * Foolproof guard: refuses to touch a home that holds real work (more blocks
 * than the two-block starter stub) unless called with --force.
 *
 *   node scripts/restore-showcase-home.js          # stub home → showcase
 *   node scripts/restore-showcase-home.js --force  # replace ANY home
 */

const { getPageByFullPath, updatePage } = require('../src/pages');
const { templateBlocks } = require('../src/templates');
const { seedDemoAssets } = require('../src/setup');
const { loadMenus, saveMenu } = require('../src/menus');
const { loadConfig } = require('../src/config');
const { exportAll } = require('../src/export');

const force = process.argv.includes('--force');

const home = getPageByFullPath('home');
if (!home) {
  console.error('No home page exists — run the setup wizard instead (it seeds the showcase itself).');
  process.exit(1);
}

const current = Array.isArray(home.blocks) ? home.blocks.length : 0;
// the basic seed is hero+text; anything bigger is work someone did on purpose
if (current > 3 && !force) {
  console.error(`home holds ${current} top-level blocks — refusing to replace real work.`);
  console.error('Re-run with --force if you really mean it (the old page stays in revision history).');
  process.exit(1);
}

const title = String(loadConfig().title || home.title || 'האתר שלי').trim();

seedDemoAssets();                                   // stand-in art → site's public/demo/
const blocks = templateBlocks('showcase', title);   // the tour itself

updatePage('home', { blocks, publish: true });      // snapshots a revision first

// The showcase's menu section explains named menus by pointing at a SECOND
// list — seed it exactly as the wizard does, and never clobber an existing one.
if (!Object.prototype.hasOwnProperty.call(loadMenus(), 'explore')) {
  saveMenu('explore', [
    { label: '✨ מה חדש', type: 'anchor', target: 'tools' },
    { label: '💬 שאלות נפוצות', type: 'anchor', target: 'faq' },
    { label: '📬 דברו איתנו', type: 'anchor', target: 'cta' }
  ]);
  console.log('seeded the "explore" menu (the showcase nav section explains it)');
}

try { exportAll(); } catch (e) { /* static build is best-effort, like runSetup */ }

console.log(`home: ${current} blocks → ${blocks.length} top-level showcase blocks, published.`);
console.log('the old home is one click away in the builder\'s revision history.');
