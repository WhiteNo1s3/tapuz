'use strict';

/**
 * v1.06 QA gate — site packages: the ".pzn is our RPM" pillar one level up
 * from theme packages (v0.99) — a whole site (pages + theme + menus +
 * safe config) as one portable file. Round-trip on a throwaway TAPUZ_ROOT,
 * the collision-safe import (never overwrites without opt-in), and the
 * draft-vs-published divergence case: a page can have unpublished draft
 * changes sitting on top of what's live, and import must restore BOTH
 * states correctly, not collapse them into one.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-sitepkg-'));

const { createPage, publishPage, getPageByFullPath, savePageSource } = require('../src/pages');
const { saveOverrides } = require('../src/theme');
const { saveMenus } = require('../src/menus');
const { loadConfig, saveConfig } = require('../src/config');
const sitePkg = require('../src/site-package');

let failures = 0;
function check(cond, label) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

// ── build a real site: a published page, a draft-only page, and a
//    published page with UNPUBLISHED changes on top (the divergence case) ──
createPage({ title: 'עמוד בטיוטה', slug: 'draft-only', blocks: [{ type: 'text', id: 't1', data: { content: 'טיוטה' } }], status: 'draft' });

createPage({ title: 'עמוד ראשון', slug: 'first-page', blocks: [{ type: 'text', id: 't2', data: { content: 'תוכן ראשון' } }], status: 'draft' });
publishPage('first-page');

createPage({ title: 'עמוד עם שינויים', slug: 'has-changes', blocks: [{ type: 'text', id: 't3', data: { content: 'גרסה חיה' } }], status: 'draft' });
publishPage('has-changes');
// now diverge: edit the draft WITHOUT publishing — the live version must stay old
savePageSource('has-changes', getDraftEdited(), { publish: false });
function getDraftEdited() {
  const src = require('../src/pages').getPageSource('has-changes', 'draft');
  return src.replace('גרסה חיה', 'גרסה חדשה שעוד לא פורסמה');
}

saveOverrides({ colors: { primary: '#123456' } });
saveMenus({ main: [{ type: 'custom', label: 'קישור', url: '/first-page' }] });
const cfg = loadConfig();
cfg.title = 'האתר לבדיקה';
cfg.description = 'תיאור לבדיקה';
saveConfig(cfg);

// ── export ──
const pkg = sitePkg.exportSitePackage('גיבוי');
check(pkg.format === 'tapuz-site', 'package carries the format tag');
check(pkg.version === sitePkg.SITE_PACKAGE_VERSION, 'package carries the current version number');
check(pkg.pages.length === 3, 'every page is in the export (draft-only + 2 published)');
check(pkg.config.title === 'האתר לבדיקה', 'config subset carries the site title');
check(pkg.config.admin === undefined, 'config subset never includes admin.path or other non-listed fields');
check(pkg.theme.colors.primary === '#123456', 'theme overrides are captured');
check(pkg.menus.main[0].label === 'קישור', 'menus are captured');

const hasChangesEntry = pkg.pages.find((p) => p.fullPath === 'has-changes');
check(!!hasChangesEntry, 'the diverged page is in the export');
check(hasChangesEntry.draftSource.includes('גרסה חדשה שעוד לא פורסמה'), 'export captures the unpublished DRAFT content');
check(hasChangesEntry.publishedSource.includes('גרסה חיה') && !hasChangesEntry.publishedSource.includes('חדשה'),
  'export captures the still-live PUBLISHED content separately — draft and published genuinely differ in the package');

// ── wipe the site clean, then import ──
const fs2 = require('fs');
const { PAGES_DIR } = require('../src/paths');
for (const p of ['draft-only', 'first-page', 'has-changes']) {
  try { require('../src/pages').deletePage(p); } catch (e) {}
}
saveOverrides({ colors: { primary: '#000000' } });
saveConfig({ ...loadConfig(), title: 'משהו אחר' });

const result = sitePkg.importSitePackage(pkg);
check(result.pagesCreated.length === 3, 'all 3 pages created on import into an empty site');
check(result.pagesSkipped.length === 0, 'nothing skipped when nothing collides');
check(loadConfig().title === 'האתר לבדיקה', 'config title restored');
check(require('../src/theme').loadOverrides().colors.primary === '#123456', 'theme restored');
check(require('../src/menus').loadMenus().main[0].label === 'קישור', 'menus restored');

const restoredDraftOnly = getPageByFullPath('draft-only');
check(restoredDraftOnly && restoredDraftOnly.status === 'draft', 'the draft-only page comes back as a draft, not published');

const restored = getPageByFullPath('has-changes');
check(restored && restored.status === 'published', 'the diverged page comes back published');
const restoredDraftSrc = require('../src/pages').getPageSource('has-changes', 'draft');
const restoredPublishedSrc = require('../src/pages').getPageSource('has-changes', 'published');
check(restoredDraftSrc.includes('גרסה חדשה שעוד לא פורסמה'),
  'THE KEY CHECK: restored draft has the unpublished edit');
check(restoredPublishedSrc.includes('גרסה חיה') && !restoredPublishedSrc.includes('חדשה'),
  'THE KEY CHECK: restored published is STILL the old live version — draft/published were not collapsed together');

// ── collision safety: import again without overwrite ──
const secondImport = sitePkg.importSitePackage(pkg);
check(secondImport.pagesCreated.length === 0 && secondImport.pagesUpdated.length === 0,
  're-importing over an existing site creates/updates nothing by default');
check(secondImport.pagesSkipped.length === 3, 'every page is reported as skipped (collision), not silently clobbered');

// ── overwrite:true actually overwrites ──
const thirdImport = sitePkg.importSitePackage(pkg, { overwrite: true });
check(thirdImport.pagesUpdated.length === 3, 'overwrite:true updates every colliding page instead of skipping');

// ── validation: malformed/foreign packages are rejected, nothing touched ──
const beforeBadImport = loadConfig().title;
function rejects(label, badPkg) {
  let threw = false;
  try { sitePkg.importSitePackage(badPkg); } catch (e) { threw = true; }
  check(threw, label);
}
rejects('rejects null', null);
rejects('rejects a plain string', 'nope');
rejects('rejects the wrong format tag', { format: 'some-other-thing', version: 1, pages: [] });
rejects('rejects a version newer than this Tapuz understands', { format: 'tapuz-site', version: 999, pages: [] });
check(loadConfig().title === beforeBadImport, 'every rejected import left the site config untouched');

console.log('');
if (failures) {
  console.log('SMOKE SITE-PACKAGE: FAIL (' + failures + ')');
  process.exit(1);
}
console.log('SMOKE SITE-PACKAGE: PASS');
