'use strict';

/**
 * v1.08 QA gate — multilingual pairing: "a fraction of WPML's surface"
 * (Ben). No per-string translation, no URL routing — just linking two
 * existing pages as translations of each other, hreflang tags, and a
 * visible language switcher. Pure-logic checks (pages.js/seo.js/
 * renderer.js) on a throwaway TAPUZ_ROOT.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-i18n-'));

const { createPage, publishPage, getPageByFullPath, getTranslations, linkTranslations, unlinkTranslation } = require('../src/pages');
const { buildHreflangTags } = require('../src/seo');
const { renderLangSwitcher, renderPage } = require('../src/renderer');
const { saveConfig, loadConfig } = require('../src/config');

let failures = 0;
function check(cond, label) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

createPage({ title: 'אודות', slug: 'about', blocks: [{ type: 'text', id: 't1', data: { content: 'עלינו' } }], status: 'draft' });
publishPage('about');
createPage({ title: 'About', slug: 'about-en', blocks: [{ type: 'text', id: 't2', data: { content: 'about us' } }], status: 'draft' });
publishPage('about-en');
createPage({ title: 'צור קשר', slug: 'contact', blocks: [], status: 'draft' });
publishPage('contact');

// ── an unlinked page has no translations ──
check(getTranslations('contact').length === 0, 'an unlinked page has no translations');

// ── linking ──
const group = linkTranslations('about', 'he', 'about-en', 'en');
check(typeof group === 'string' && group.length > 0, 'linkTranslations returns a group id');
check(getPageByFullPath('about').meta.lang === 'he', 'lang meta stored on page A');
check(getPageByFullPath('about-en').meta.lang === 'en', 'lang meta stored on page B');
check(getPageByFullPath('about').meta.translationGroup === getPageByFullPath('about-en').meta.translationGroup,
  'both pages share the same translation group');

const fromA = getTranslations('about');
check(fromA.length === 1 && fromA[0].full_path === 'about-en' && fromA[0].lang === 'en', 'getTranslations from A finds B (excludes self)');
const fromB = getTranslations('about-en');
check(fromB.length === 1 && fromB[0].full_path === 'about' && fromB[0].lang === 'he', 'getTranslations from B finds A (symmetric)');

check(getTranslations('contact').length === 0, 'an unrelated page still has no translations after others are linked');

// ── linking a third page joins the SAME group (not a fork) ──
createPage({ title: 'Über uns', slug: 'about-de', blocks: [], status: 'draft' });
const group2 = linkTranslations('about', 'he', 'about-de', 'de');
check(group2 === group, 'linking a third page into an existing pair reuses the group, does not fork it');
check(getTranslations('about-en').some((t) => t.full_path === 'about-de'), 'the third page is now visible from every existing sibling');

// ── existing meta is preserved, not wiped, by linking ──
createPage({ title: 'עם מטא', slug: 'has-meta', blocks: [], meta: { description: 'תיאור קיים' }, status: 'draft' });
createPage({ title: 'With meta', slug: 'has-meta-en', blocks: [], status: 'draft' });
linkTranslations('has-meta', 'he', 'has-meta-en', 'en');
check(getPageByFullPath('has-meta').meta.description === 'תיאור קיים', 'linking does not wipe pre-existing meta fields');

// ── error handling ──
let threw = false;
try { linkTranslations('about', 'he', 'about', 'he'); } catch (e) { threw = true; }
check(threw, 'linking a page to itself is rejected');
threw = false;
try { linkTranslations('does-not-exist', 'he', 'about', 'en'); } catch (e) { threw = true; }
check(threw, 'linking a missing page is rejected');

// ── unlinking ──
unlinkTranslation('about-de');
check(getTranslations('about-de').length === 0, 'unlinked page sees no translations');
check(getTranslations('about').length === 1, 'the remaining pair still sees each other after a third page leaves');
check(getPageByFullPath('about-de').meta.translationGroup === undefined, 'unlink actually removes the group key, not just empties it');

// ── hreflang tags (pure) ──
check(buildHreflangTags('https://example.com', []) === '', 'no translations → no hreflang tags');
check(buildHreflangTags('https://example.com', [{ lang: 'he', full_path: 'about' }]) === '',
  'a single entry (no real siblings) → no hreflang tags (a half-set is worse than none)');
const tags = buildHreflangTags('https://example.com', [{ lang: 'he', full_path: 'about' }, { lang: 'en', full_path: 'about-en' }]);
check(tags.includes('hreflang="he"') && tags.includes('hreflang="en"') && tags.includes('https://example.com/about-en'),
  'two-entry hreflang set includes both languages with real absolute URLs');
check(buildHreflangTags('', [{ lang: 'he', full_path: 'a' }, { lang: 'en', full_path: 'b' }]) === '',
  'no baseUrl → no hreflang tags (never emit a relative hreflang href)');

// ── the visible switcher (pure) ──
check(renderLangSwitcher([]) === '' && renderLangSwitcher([{ lang: 'he', full_path: 'a' }]) === '',
  'the switcher renders nothing for 0 or 1 entries');
const switcherHtml = renderLangSwitcher([
  { lang: 'he', full_path: 'about', isCurrent: true },
  { lang: 'en', full_path: 'about-en', isCurrent: false }
]);
check(switcherHtml.includes('href="/about-en"') && switcherHtml.includes('>EN<'), 'switcher links to the real sibling URL, language uppercased');
check(/class="active"[^>]*>HE</.test(switcherHtml), 'the current page\'s own entry is marked active');

// ── end-to-end through renderPage: hreflang in <head>, switcher in the body ──
const cfg = loadConfig();
cfg.baseUrl = 'https://example.co.il';
saveConfig(cfg);
const aboutPage = getPageByFullPath('about');
const html = renderPage(aboutPage, { siteTitle: 'אתר בדיקה' });
check(html.includes('hreflang="en"') && html.includes('example.co.il/about-en'), 'renderPage embeds the hreflang link for the sibling');
check(html.includes('<div class="tapuz-lang-switch">'), 'renderPage embeds the visible language switcher element');
const contactHtml = renderPage(getPageByFullPath('contact'), { siteTitle: 'אתר בדיקה' });
// note: the theme's inline <style> block (live-serve, pre-static-export)
// always mentions the CSS class name — check for the rendered ELEMENT, not
// the bare class-name substring, which the stylesheet itself contains.
check(!contactHtml.includes('<div class="tapuz-lang-switch">'), 'an unlinked page renders NO switcher element at all');
check(!contactHtml.includes('hreflang'), 'an unlinked page renders NO hreflang tags at all');

console.log('');
if (failures) {
  console.log('SMOKE TRANSLATIONS: FAIL (' + failures + ')');
  process.exit(1);
}
console.log('SMOKE TRANSLATIONS: PASS');
