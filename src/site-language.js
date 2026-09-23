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
 * keeps its own direction when it says one (`<html dir="rtl">` on an English
 * site is an RTL page, as before), and its `lang` follows: the site's
 * language when the page reads the site's way, the other one when it does
 * not — a Hebrew page on an English site is `lang="he" dir="rtl"`.
 */

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

/** The direction a language reads in. */
function directionFor(lang) {
  return (lang || siteLanguage()) === 'en' ? 'ltr' : 'rtl';
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

/** The chrome's words in a language (`he` for anything but `en`). */
function strings(lang) {
  return STRINGS[lang === 'en' ? 'en' : 'he'];
}

module.exports = { STRINGS, siteLanguage, siteDirection, directionFor, languageFor, strings };
