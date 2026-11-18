'use strict';

/**
 * The site's language and direction (v2.58) — one place that answers two
 * questions every door used to answer for itself: which way does THIS site
 * read, and what do its own words say (the skip link, the menu's labels,
 * the credit line, the contact labels).
 *
 * Ben (2026-09-23), on an English site that came out Hebrew: "lets make it
 * not rtl automatically when it selects english … I think it's fair to
 * assume our system will handle this." Before this module every page was
 * born `rtl`, a BenTML document with no `dir` compiled to `rtl`, the copilot
 * was told "Hebrew and RTL by default" whatever the settings said, and the
 * layout carried its Hebrew words into an English site.
 *
 * The rule: the SITE's language (config.language, `he` | `en`) sets the
 * default direction (he → rtl, en → ltr) and the words of the chrome. A PAGE
 * that names a language (`meta.lang`) reads THAT way, both directions, even
 * when the stored `direction` or the site disagree: he/ar/fa/ur → rtl, en
 * and every other language → ltr. Writing English inside an rtl frame is
 * not the product. A page that names no language keeps its own direction
 * when it says one, and the site's when it never said — and its `lang`
 * follows (`languageFor`).
 */

const RTL_LANGS = { he: 1, ar: 1, fa: 1, ur: 1 };

/** `en` from `en-US`. Empty when the value is not a language tag. */
function langCode(lang) {
  const code = String(lang || '').trim().toLowerCase().split('-')[0];
  return /^[a-z]{2,3}$/.test(code) ? code : '';
}

const STRINGS = {
  he: {
    skip: 'דלג לתוכן',
    mainNav: 'ניווט ראשי',
    menu: 'תפריט',
    footerNav: 'ניווט תחתון',
    more: 'עוד',
    credit: 'נבנה עם Tapuziel',
    search: 'חיפוש באתר',
    searchTitle: 'חיפוש',
    searchPlaceholder: 'חיפוש באתר…',
    noResults: 'אין תוצאות',
    phone: 'טלפון',
    email: 'אימייל',
    address: 'כתובת',
    hours: 'שעות',
    tab: 'טאב',
    map: 'מפה',
    redirecting: 'ממשיכים לדף החדש…'
  },
  en: {
    skip: 'Skip to content',
    mainNav: 'Main navigation',
    menu: 'Menu',
    footerNav: 'Footer navigation',
    more: 'More',
    credit: 'Built with Tapuziel',
    search: 'Search this site',
    searchTitle: 'Search',
    searchPlaceholder: 'Search this site…',
    noResults: 'No results',
    phone: 'Phone',
    email: 'Email',
    address: 'Address',
    hours: 'Hours',
    tab: 'Tab',
    map: 'Map',
    redirecting: 'Taking you to the new page…'
  }
};

/** `he` | `en` — the site's configured language (`he` for anything else). */
function siteLanguage() {
  let lang = 'he';
  try { lang = require('./config').loadConfig().language; } catch (e) { /* no config yet: Hebrew */ }
  return lang === 'en' ? 'en' : 'he';
}

/** The direction a language reads in. he/ar/fa/ur → rtl; en and every other
 *  named language → ltr. An empty value is the site's language. */
function directionFor(lang) {
  const code = langCode(lang) || langCode(siteLanguage()) || 'he';
  return RTL_LANGS[code] ? 'rtl' : 'ltr';
}

/** `en` or `he` — the chrome copy we actually have for a language.
 *  An empty value is the site's language. RTL languages without their own
 *  copy use Hebrew; every other language uses English. */
function chromeLanguage(lang) {
  const code = langCode(lang);
  if (!code) return siteLanguage();
  return directionFor(code) === 'ltr' ? 'en' : 'he';
}

/** `rtl` | `ltr` — the direction a new page of this site is born with. */
function siteDirection() {
  return directionFor(siteLanguage());
}

/** The language a page of THIS site speaks, given its direction: the site's
 *  own when the page reads the site's way, the other one when it does not. */
function languageFor(direction) {
  const site = siteLanguage();
  const dir = direction === 'ltr' ? 'ltr' : 'rtl';
  if (dir === directionFor(site)) return site;
  return dir === 'rtl' ? 'he' : 'en';
}

/** The chrome's words. No argument stays Hebrew (every old caller). A named
 *  language uses `chromeLanguage` — English for ltr, Hebrew for rtl. */
function strings(lang) {
  if (lang == null || String(lang).trim() === '') return STRINGS.he;
  return STRINGS[chromeLanguage(lang)];
}

module.exports = { STRINGS, RTL_LANGS, siteLanguage, siteDirection, directionFor, languageFor, chromeLanguage, strings, langCode };
