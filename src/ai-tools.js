'use strict';

/**
 * Copilot tools (v1.59) — the copilot stops being blind.
 *
 * Until now the model could only emit text; a reply that happened to contain a
 * whole `.pzn` document offered a button the OWNER pressed. That made it safe
 * and useless in equal measure: it could not see a single page of the site it
 * was supposedly helping with, so "make the hero blue" was impossible and
 * every request rebuilt a page from nothing.
 *
 * Now it can look, and it can propose changes. Two rules keep that honest:
 *
 *   READ tools run on their own. list_pages / read_page have no side effects,
 *   so pausing to ask permission would be theatre — and a model that must beg
 *   to look at a page is one that will guess instead.
 *
 *   WRITE tools NEVER run on their own. create_page / edit_page return a
 *   description of what they WOULD do; the server stops the loop and hands it
 *   to the owner. Nothing touches the site until a human presses approve.
 *
 * What is deliberately absent is as much of the design as what is here:
 * no publish, no delete, no theme or settings writes. Every PAGE write lands
 * in a DRAFT, which the existing revision history already makes reversible,
 * and going live stays a human act on the publish button. A model that can put
 * words in front of the public without anyone reading them first is a
 * different product, and not one this commit is going to invent quietly.
 *
 * v2.43 adds the menus (read_menus / organize_menu — see "the menus" below).
 * It is the one write that is NOT a draft, because a site has no draft menu:
 * the same gate stands in front of it, the owner sees the proposal rendered
 * on the real header first, and a backup is taken before the apply. Nobody
 * reads a menu the owner did not approve.
 */

const MAX_SOURCE = 60000;

// The allowance a READ may take (v2.32 — the window). The tool loop passes
// `opts.maxSourceChars` = 70% of what is left in the model's window after
// the briefing, the tools and the history. A page that does not fit is
// REFUSED with a hint, never truncated: a model that edits half a page it
// never saw replaces the other half with nothing (edit_page takes the whole
// document), and LM Studio would silently discard the middle of an
// oversized prompt anyway (map.md, addendum 1). Infinity / absent = no cap.
function allowance(opts) {
  const n = opts && Number(opts.maxSourceChars);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : Infinity;
}

// ~120 chars per listed page once JSON-encoded (slug, title, status, flag)
const LIST_ROW_CHARS = 120;

/** A page list small enough to think with — titles, slugs, status. Over the
 *  allowance → the first K rows + { truncated:true, count } so the model
 *  knows there are more and can ask for a narrower list. */
function listPages(args, opts) {
  const pages = require('./pages').listPages();
  const limit = allowance(opts);
  const rows = pages.map((p) => ({
    slug: p.full_path,
    title: p.title,
    status: p.status,
    hasUnpublishedChanges: !!p.has_unpublished
  }));
  const k = limit === Infinity ? rows.length : Math.max(1, Math.floor(limit / LIST_ROW_CHARS));
  if (rows.length <= k) return { count: pages.length, pages: rows };
  return { count: pages.length, pages: rows.slice(0, k), truncated: true, shown: k };
}

/** One page as its real `.pzn` source — what the model needs to edit it. */
function readPage(args, opts) {
  const slug = String((args && args.slug) || '').trim();
  if (!slug) throw new Error('slug required');
  const { getPageByFullPath, getPageSource } = require('./pages');
  const page = getPageByFullPath(slug);
  if (!page) throw new Error('אין דף בשם "' + slug + '" — השתמש/י ב-list_pages כדי לראות מה קיים');
  // 'draft' is what the builder edits and what a follow-up edit_page replaces —
  // reading 'published' would hand the model a stale document.
  const source = getPageSource(slug, 'draft') || '';
  const limit = allowance(opts);
  if (source.length > limit) {
    return {
      slug,
      title: page.title,
      status: page.status,
      source: '',
      tooLong: true,
      chars: source.length,
      limitChars: limit,
      hint: require('./ai-window').HE.readTooLong(source.length, limit)
    };
  }
  return {
    slug,
    title: page.title,
    status: page.status,
    source
  };
}

/** Validate a document the way the create route does — same gate, one place. */
function checkSource(raw) {
  // v2.20: take only the BenTML — a fence, a chat sentence, <html> brackets
  // around the keyword dialect, all gone; a keyword document is compiled to
  // .pzn here, so the model may answer in either dialect
  const ex = require('./pzn-source').toPznSource(String(raw || ''));
  // v2.39: the copilot's writes are model-authored — no script in raw HTML
  // v2.45: a closer that is almost the open tag has one sane reading (pzn/repair.js
  // fixCloserTypos) — everything else about this door stays strict
  const source = require('./pzn/repair').fixCloserTypos(require('./ai-html-guard').scrubAiSource(ex.source).source).source;
  if (!source.trim()) throw new Error('source ריק');
  if (source.length > MAX_SOURCE) throw new Error('המסמך ארוך מדי');
  const pznApi = require('./pzn/index');
  const doc = pznApi.parse(source);
  const errors = pznApi.validate(doc, { strict: false }).filter((i) => i.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.code + ': ' + e.message).join('; '));
  const blocks = pznApi.toTapuzPage(doc).blocks;
  if (!blocks.length) throw new Error('המסמך לא מכיל אף מודול bent-*');
  return { source, doc, blocks, meta: ex.page && ex.page.meta };
}

/** The slug a create_page call would take — shared by the write and its preflight. */
function slugFor(args, doc) {
  const title = String((args && args.title) || doc.title || 'דף חדש');
  const { deriveSlug } = require('./pzn/intent');
  return { title, slug: deriveSlug(String((args && args.slug) || doc.slug || '').trim() || title) };
}

function createPage(args) {
  const { source, doc, blocks, meta } = checkSource(args && args.source);
  const { title, slug } = slugFor(args, doc);
  const { getPageByFullPath, createPage: create, savePageSource } = require('./pages');
  if (getPageByFullPath(slug)) {
    throw new Error('דף בשם "' + slug + '" כבר קיים — לעריכה השתמש/י ב-edit_page');
  }
  create({ title, slug, blocks: [] });
  const r = savePageSource(slug, source, { publish: false, meta });
  return { slug, title, created: true, blocks: r.blocks, warnings: r.warnings || [], moduleCount: blocks.length };
}

function editPage(args) {
  const slug = String((args && args.slug) || '').trim();
  if (!slug) throw new Error('slug required');
  const { getPageByFullPath, savePageSource } = require('./pages');
  const page = getPageByFullPath(slug);
  if (!page) throw new Error('אין דף בשם "' + slug + '"');
  const { source, blocks, meta } = checkSource(args && args.source);
  // publish:false — the edit lands in the DRAFT. The live page does not move
  // until the owner publishes it, and the previous draft is in the revisions.
  const r = savePageSource(slug, source, { publish: false, meta });
  return { slug, title: page.title, edited: true, blocks: r.blocks, warnings: r.warnings || [], moduleCount: blocks.length };
}

// ── the menus (v2.43) ────────────────────────────────────────────────────
//
// Ben: "we must make sure that the menu sorter is also included in the ai
// helper that connects to the api (lm studio or public doesn't matter they
// will work the same), there are option to sort the menu using the co-pilot".
//
// Until now "put the new page in the menu" had no tool: the copilot could
// only answer with a page, and a model that has one hammer proposed an
// edit_page holding a bent-nav. The Menu Organizer already had everything a
// menu change needs — a tolerant dialect, a door that never lets a broken
// link through, a preview on the real header, a backup before every apply —
// but only the injection card could reach it. These two tools are that SAME
// machinery behind the copilot's own rules, nothing forked:
//
//   read_menus     READ. The menus as the `<bent-menus>` document the pack
//                  shows a chat, the ONE computed number (how many items fit
//                  a row), and the page table — the only place a legal
//                  `page="…"` comes from. Runs on its own, like read_page.
//
//   organize_menu  WRITE. Takes the whole document back. preflight IS the
//                  organizer's door (parseMenuReply): a refusal — NO_MENU,
//                  TOO_MANY_UNKNOWN, a page that does not exist — goes back
//                  to the model as the call's answer, before the owner is
//                  asked (the v2.37 rule). What passes is shown on the
//                  canvas, rendered on the real header, and only ✓ applies.
//
// ONE HONEST DIFFERENCE from the page tools, and the UI says it in so many
// words: a page write lands in a DRAFT; a site has no "draft menu". An
// approved organize_menu is LIVE — so applyMenuPlan takes its backup first
// (config/menu-backups, newest 10) and the chat offers the undo the moment it
// lands. The gate is the same; what is behind it is not, and pretending
// otherwise would be the one lie in this file.

// "take it off the menu", in the owner's words (he + en). Loose on purpose:
// a false "asked" only skips one repair round — the card still warns.
const REMOVE_ASK_RE = /(?:הסר|תסיר|הסיר|להסיר|מחק|תמחק|למחוק|מחיק|הורד|תוריד|להוריד|הוצא|תוציא|להוציא|העלם|תעלים|להעלים|הסתר|תסתיר|להסתיר|בלי |ללא |השאר רק|רק את |remove|delete|drop|hide|without|only keep|keep only)/i;

// ── pictures and links that do not exist (v2.46) ─────────────────────────
//
// The dreams battery (an owner's own words, a brand-new site): one page came
// back with NINE invented image paths and three links to sub-pages nobody
// made. A page is a draft, so nothing broke in public — but the owner was
// asked to approve broken pictures, and a draft is one click from live.
//
//   a NEW local image path the site does not have  → back to the model, once
//                                                    (the model is right here
//                                                    and can build without it);
//                                                    a model that insists
//                                                    reaches the card, and the
//                                                    owner is told which ones
//   a link to a page that does not exist           → the same, in the same
//                                                    message, with the list of
//                                                    real pages ("/contact" on
//                                                    a site whose contact page
//                                                    is "/צרו-קשר" is a CTA
//                                                    that 404s)
// "New" = not already in the page being edited: an owner's own broken path is
// not the model's to answer for. External (https:) pictures are not judged.
const IMAGE_ATTR_RE = /\b(?:src|image|poster|avatar|photo|logo|cardimage|ogimage)="([^"]+)"/gi;
const LINK_ATTR_RE = /\b(?:href|ctaurl|url|link)="([^"]+)"/gi;
const isLocalPath = (v) => /^\/(?!\/)/.test(v) || (!/^[a-z][a-z0-9+.-]*:/i.test(v) && !v.startsWith('#') && /\.(?:jpe?g|png|webp|gif|svg|avif)$/i.test(v));
function attrValues(source, re) {
  const out = new Set();
  for (const m of String(source || '').matchAll(re)) out.add(m[1].trim());
  return out;
}
function fileIsServed(p) {
  const fs = require('fs');
  const path = require('path');
  const rel = decodeURIComponent(String(p).split(/[?#]/)[0]).replace(/^\/+/, '');
  if (!rel || rel.includes('..')) return false;
  let roots = [path.join(__dirname, '..', 'public')];
  try { const paths = require('./paths'); roots = [paths.PUBLIC_DIR, paths.ASSETS_DIR && path.dirname(paths.ASSETS_DIR), ...roots].filter(Boolean); } catch (e) { /* defaults */ }
  return roots.some((root) => { try { return fs.statSync(path.join(root, rel)).isFile(); } catch (e) { return false; } });
}
/** Image paths in `source` that are local, NEW (absent from `baseline`) and exist nowhere. */
function missingImages(source, baseline) {
  let known = new Set();
  try { known = new Set(require('./media').listAllMedia(0).map((m) => m.url)); } catch (e) { /* no library */ }
  const before = attrValues(baseline, IMAGE_ATTR_RE);
  return [...attrValues(source, IMAGE_ATTR_RE)].filter((v) => v && isLocalPath(v) && !before.has(v) && !known.has(v) && !fileIsServed(v));
}
/** Internal links in `source` that are NEW and lead to no page of this site. */
function deadLinks(source, baseline) {
  const { getPageByFullPath } = require('./pages');
  const before = attrValues(baseline, LINK_ATTR_RE);
  return [...attrValues(source, LINK_ATTR_RE)].filter((v) => {
    if (!v || before.has(v) || !/^\/(?!\/)/.test(v) || v === '/') return false;
    const slug = decodeURIComponent(v.split(/[?#]/)[0]).replace(/^\/+|\/+$/g, '').replace(/\.html$/i, '');
    if (!slug || /^(?:admin|assets|uploads|css|js|demo)\b/.test(slug) || /\.[a-z0-9]{2,5}$/i.test(slug)) return false;
    return !getPageByFullPath(slug);
  });
}
const listed = (arr) => arr.slice(0, 6).join(', ') + (arr.length > 6 ? '…' : '');

/** The door, for both the preflight and the write — one parse, one verdict.
 *  `opts.brief` is the owner's own message: the door judges LAYOUT_UNASKED
 *  against what the OWNER asked, never against the model's account of it. */
function checkMenuDoc(args, opts) {
  const org = require('./menu-organizer');
  // `source` is tolerated: a model that just used edit_page reaches for the
  // argument name it knows, and refusing a good document over its key would
  // burn one of the turn's two repair rounds on nothing
  const doc = String((args && (args.document || args.source)) || '');
  if (!doc.trim()) throw new Error('document ריק — צריך מסמך <bent-menus> שלם (קרא/י read_menus קודם)');
  const ctx = org.siteStateForMenus();
  const parsed = org.parseMenuReply(doc, ctx, { brief: String((opts && opts.brief) || '') });
  // A HARD warning means the door DROPPED a link (a page that does not exist,
  // an unsafe url, a bad phone). The card lets an owner force that through;
  // the copilot has a better move — the model is right here and can fix it —
  // and an approval card must only ever show a document that will land.
  if (parsed.hard) {
    const hard = parsed.warnings.filter((w) => org.HARD.includes(w.code)).map((w) => w.message);
    throw Object.assign(new Error(hard.join(' · ')), { code: 'HARD_WARNINGS' });
  }
  // the degenerate answer: asking the owner to approve their own menu
  const echo = parsed.warnings.find((w) => w.code === 'NO_CHANGE');
  if (echo) throw Object.assign(new Error(echo.message), { code: 'NO_CHANGE' });
  return { parsed, ctx };
}

/**
 * The menus as the model needs them to re-sort them. The document is handed
 * over WHOLE or not at all (organize_menu replaces every menu it names, so a
 * model that saw half a menu deletes the other half — the read_page rule);
 * the page table is what gives when room is short, from the bottom, and says
 * how many rows it left out (pageTable's own line).
 */
function readMenus(args, opts) {
  const org = require('./menu-organizer');
  const theme = require('./theme');
  const ctx = org.siteStateForMenus();
  const knobs = theme.menuKnobs(ctx.overrides);
  const document = org.serializeMenus({ knobs, menus: ctx.menus, locations: ctx.locations });
  const mainItems = (ctx.menus || {})[(ctx.locations || {}).main || 'main'] || [];
  const capacity = org.capacitySentence(ctx.fit, mainItems.length);
  // The dialect rides HERE, not in the compact briefing: `document` is the
  // site's own menu in the language (a worked example), and these are the
  // organizer's lines for what a live menu may never show — nesting, groups,
  // free targets, fold. Paid only on a turn that touches the menu.
  const grammar = org.menuGrammar({ compact: true });
  // (the bent-nav warning lives here, not in the compact briefing: a model
  // that learned the PAGE language reaches for the page's nav module)
  const how = 'לשינוי: organize_menu עם מסמך <bent-menus> שלם, באותה שפה — לא bent-nav ולא bent-item (אלה מודולים של דף). page="…" רק מעמודת page בטבלה. יותר פריטים עליונים ממה שנכנס בשורה → קבצו תחת הורה, או <bent-menu-layout fold="' + Math.max(2, ctx.fit.capacity - 1) + '" />.';
  const limit = allowance(opts);
  const fixed = document.length + capacity.length + grammar.length + how.length;
  if (fixed > limit) {
    return {
      document: '',
      tooLong: true,
      chars: fixed,
      limitChars: limit,
      hint: require('./ai-window').HE.readMenusTooLong(fixed, limit)
    };
  }
  let table = org.pageTable(ctx, 'full');
  let truncated = false;
  if (limit !== Infinity) {
    let rowsCap = table.rows;
    while (fixed + table.text.length > limit && rowsCap > 1) {
      rowsCap = Math.max(1, Math.floor(rowsCap * 0.7));
      table = org.pageTable(ctx, 'full', { rowsCap, dropDrafts: true, dropArticles: true });
      truncated = true;
    }
  }
  return {
    document,
    capacity,
    grammar,
    pages: table.text,
    ...(truncated ? { truncated: true, shownPages: table.rows, publishedPages: table.published } : {}),
    how
  };
}

function organizeMenu(args, opts) {
  const org = require('./menu-organizer');
  // parsed AGAIN at the moment of writing, against the site as it is NOW: the
  // owner may have unpublished a page between the proposal and the click
  const { parsed, ctx } = checkMenuDoc(args, opts);
  const r = org.applyMenuPlan(parsed.plan, { reason: 'copilot:organize_menu', ctx });
  return {
    organized: true,
    menus: r.changed.menus,
    knobs: r.changed.knobs,
    backupId: r.backupId,
    fitLine: parsed.preview.fitLine,
    note: parsed.plan.note || '',
    warnings: parsed.warningTexts,
    rebuildError: r.rebuildError || ''
  };
}

/** "main: 7 קישורים, footer: 2" — read from the document with the dialect's
 *  own parser, so the approval line counts what the door will count. */
function menuSummary(a) {
  let what = '';
  try {
    const doc = require('./bentml/menu-dialect').parseMenusDoc(String((a && (a.document || a.source)) || ''));
    const count = (items) => (items || []).reduce((n, it) => n + 1 + count(it.children), 0);
    what = Object.keys(doc.menus).map((name) => name + ': ' + count(doc.menus[name].items) + ' קישורים').join(', ');
  } catch (e) { /* an unreadable document still gets a truthful line */ }
  return 'לעדכן את תפריטי האתר' + (what ? ' (' + what + ')' : '') + ' — חל על האתר החי, עם גיבוי';
}

/**
 * Everything a write would refuse, checked BEFORE the owner is asked (v2.37).
 * Seen live on the Bridge challenges: Gemma proposed a pricing page whose
 * bent-faq held bent-fold (the accordion's child) — the owner clicked
 * approve, and only then did create_page throw E_CHILD. The same checks the
 * write runs (the source validates, the slug is free / the page exists), with
 * no side effect; a throw carries the message the write would have thrown.
 *
 * v2.43: for organize_menu the check IS the organizer's door, and what it
 * learned on the way rides back — `{ preview, warnings }`. The tool loop puts
 * them on the pending, so the canvas renders the very plan the door judged
 * (the tree, the diff, the fit line, the real header's frame) instead of
 * parsing the document a second time in the browser's name. `opts.brief` is
 * the owner's message. The page tools still return nothing.
 */
function preflight(name, args, opts) {
  if (name === 'organize_menu') {
    const { parsed } = checkMenuDoc(args, opts);
    // v2.44 — a menu that LOSES pages nobody asked to remove goes back to the
    // model, once. Battery T9 (nemotron-3-nano, 2026-09-18): asked to GROUP a
    // ten-item row, the model returned five links. Every link was legal, so
    // the door had nothing hard to say; the card carried PAGES_MISSING as one
    // soft line, and ✓ took five published pages off the LIVE header. The
    // injection runner already gives the model a repair round for this
    // (org.REPAIRABLE) — the copilot did not. Judged like LAYOUT_UNASKED,
    // against the OWNER's own words: "הסר / תוריד / remove" gets what it asked
    // for. And only once (`opts.lostAsked`): a model that insists reaches the
    // card, warning and all — the owner is the judge; the door only makes
    // sure they are asked a clean question first.
    const lost = parsed.lost || [];
    if (lost.length && !(opts && opts.lostAsked) && !REMOVE_ASK_RE.test(String((opts && opts.brief) || ''))) {
      const names = lost.slice(0, 8).map((p) => p.title).join(', ') + (lost.length > 8 ? '…' : '');
      throw Object.assign(new Error(
        lost.length + ' דפים שהיו בתפריט נעלמו ממנו: ' + names + '. בעל/ת האתר לא ביקש/ה להסיר דפים — ' +
        'החזר/י אותם (אפשר כפריטי משנה תחת קבוצה) והצע/י שוב את המסמך השלם. אם ההסרה מכוונת — הצע/י שוב את אותו מסמך ואמור/י זאת במילים.'
      ), { code: 'PAGES_LOST' });
    }
    return { preview: parsed.preview, warnings: parsed.warningTexts };
  }
  if (name === 'create_page') {
    const { doc, source } = checkSource(args && args.source);
    const { slug } = slugFor(args, doc);
    if (require('./pages').getPageByFullPath(slug)) {
      throw new Error('דף בשם "' + slug + '" כבר קיים — לעריכה השתמש/י ב-edit_page');
    }
    return pageInventions(source, '', opts);
  }
  if (name === 'edit_page') {
    const slug = String((args && args.slug) || '').trim();
    if (!slug) throw new Error('slug required');
    if (!require('./pages').getPageByFullPath(slug)) throw new Error('אין דף בשם "' + slug + '"');
    const { source } = checkSource(args && args.source);
    return pageInventions(source, require('./pages').getPageSource(slug, 'draft') || '', opts);
  }
}

/** v2.46 — what a page proposal invented. Pictures and dead links go back to
 *  the model ONCE, together (`opts.inventionsAsked`) — it is right here, it has
 *  the page list, and "/contact" on a site whose contact page is "/צרו-קשר" is a
 *  call-to-action that 404s. Whatever a model insists on becomes a line for
 *  the owner beside the card: a dream page may well point at a page that comes
 *  next, and that is the owner's call, not the door's. */
function pageInventions(source, baseline, opts) {
  const images = missingImages(source, baseline);
  const links = deadLinks(source, baseline);
  if ((images.length || links.length) && !(opts && opts.inventionsAsked)) {
    const parts = [];
    if (images.length) {
      parts.push(images.length + ' תמונות במסמך לא קיימות באתר: ' + listed(images) + '. אל תמציא/י נתיבי תמונה — כל אחד מהם יהיה תמונה שבורה מול הגולשים. ' +
        'השתמש/י רק בנתיבים מרשימת המדיה; אם אין תמונה מתאימה — בנה/י את החלק הזה בלי תמונה (טקסט, כרטיסים, יתרונות).');
    }
    if (links.length) {
      let real = [];
      try { real = require('./pages').listPages().map((pg) => '/' + pg.full_path).slice(0, 30); } catch (e) { /* no list */ }
      parts.push(links.length + ' קישורים מובילים לדפים שלא קיימים באתר: ' + listed(links) + '. ' +
        (real.length ? 'הדפים הקיימים: ' + real.join(' · ') + '. ' : '') +
        'קשר/י רק לדף קיים (או לעוגן #… בתוך הדף); אם הדף עוד לא נבנה — השמט/י את הקישור ואמור/י לבעל/ת האתר שכדאי ליצור אותו.');
    }
    throw Object.assign(new Error(parts.join(' ') + ' הצע/י שוב את המסמך המלא.'), { code: 'PAGE_INVENTIONS' });
  }
  const notes = [];
  if (images.length) notes.push(images.length + ' תמונות בהצעה לא קיימות באתר (' + listed(images) + ') — הן יוצגו שבורות עד שתבחרו תמונות בבונה.');
  if (links.length) notes.push(links.length + ' קישורים מובילים לדפים שעדיין לא קיימים (' + listed(links) + ') — צרו אותם, או שנו את הקישור בבונה לפני הפרסום.');
  return notes.length ? { notes } : undefined;
}

const TOOLS = [
  {
    name: 'list_pages',
    mutates: false,
    description: 'רשימת כל הדפים באתר — slug, כותרת וסטטוס. השתמש/י בזה לפני עריכה כדי למצוא את הדף הנכון.',
    schema: { type: 'object', properties: {}, required: [] },
    run: listPages
  },
  {
    name: 'read_page',
    mutates: false,
    description: 'קריאת דף קיים כמקור BenTML (.pzn) מלא. חובה לקרוא דף לפני שעורכים אותו.',
    schema: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'ה-slug של הדף, כפי שהוחזר מ-list_pages' } },
      required: ['slug']
    },
    run: readPage
  },
  {
    name: 'create_page',
    mutates: true,
    description: 'יצירת דף חדש כטיוטה ממסמך BenTML שלם. הדף לא מתפרסם — הוא נוצר כטיוטה בלבד.',
    schema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'מסמך .pzn שלם, מ-<!DOCTYPE html> ועד </html>' },
        title: { type: 'string', description: 'כותרת הדף (אופציונלי — נלקחת מהמסמך אם חסרה)' },
        slug: { type: 'string', description: 'כתובת הדף (אופציונלי)' }
      },
      required: ['source']
    },
    summary: (a) => 'ליצור דף חדש: ' + String((a && (a.title || a.slug)) || 'דף חדש'),
    run: createPage
  },
  {
    name: 'edit_page',
    mutates: true,
    description: 'החלפת התוכן של דף קיים במסמך BenTML חדש. השינוי נשמר כטיוטה — הדף החי לא משתנה עד שמפרסמים.',
    schema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'הדף לעריכה' },
        source: { type: 'string', description: 'המסמך המלא אחרי השינוי (לא רק החלק ששונה)' }
      },
      required: ['slug', 'source']
    },
    summary: (a) => 'לערוך את הדף "' + String((a && a.slug) || '?') + '" (נשמר כטיוטה)',
    run: editPage
  },
  // The descriptions are SHORT on purpose: every declared tool rides in every
  // request, and in an 8,192 window a sentence here is a sentence of page the
  // model cannot read back. The grammar is taught once, in the briefing.
  {
    name: 'read_menus',
    mutates: false,
    description: 'תפריטי האתר כמסמך <bent-menus> + כמה פריטים נכנסים בשורה + טבלת הדפים לקישור. חובה לפני organize_menu.',
    schema: { type: 'object', properties: {}, required: [] },
    run: readMenus
  },
  {
    name: 'organize_menu',
    mutates: true,
    description: 'החלפת תפריטי האתר במסמך <bent-menus> שלם. דורש אישור; אחריו חל על האתר החי, עם גיבוי.',
    schema: {
      type: 'object',
      properties: { document: { type: 'string', description: 'המסמך המלא אחרי השינוי' } },
      required: ['document']
    },
    summary: menuSummary,
    // what the model is told when the door refuses its document (the page
    // tools' line talks about containers and children — wrong advice here)
    fixHint: 'התפריט לא הוחל ולא הוצג לבעל/ת האתר. תקן/י בדיוק את מה שכתוב למעלה — page="…" רק מעמודת page של read_menus, מועתק מילה במילה — והצע/י את מסמך <bent-menus> המלא שוב.',
    run: organizeMenu
  }
];

const BY_NAME = {};
TOOLS.forEach((t) => { BY_NAME[t.name] = t; });

function getTool(name) { return BY_NAME[String(name || '')] || null; }

/** Human-readable one-liner for the approval prompt. */
function describeCall(name, input) {
  const t = getTool(name);
  if (!t) return String(name);
  return t.summary ? t.summary(input || {}) : t.description;
}

// The menu pair, by name — what a window too small to answer them leaves out.
const MENU_TOOLS = ['read_menus', 'organize_menu'];

/** Provider-shaped tool declarations. The two APIs disagree on the wrapper
 *  but agree on JSON Schema, so only the envelope differs.
 *
 *  `opts.menus === false` (v2.43) leaves the menu pair OUT. Every declared
 *  tool rides in every request, and the pair costs ~530 chars of schema; in
 *  an 8,192 window that is the difference between the compact tier fitting
 *  and WINDOW_TOO_SMALL — for two tools whose answer (a whole menu read back)
 *  could not fit in what is left anyway. src/ai.js decides (pickCopilotTier):
 *  a tool the window cannot answer is not declared. Absent/true = all six. */
function toolsForProvider(style, opts) {
  const list = opts && opts.menus === false ? TOOLS.filter((t) => !MENU_TOOLS.includes(t.name)) : TOOLS;
  if (style === 'openai-chat') {
    return list.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.schema }
    }));
  }
  return list.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
}

module.exports = { TOOLS, MENU_TOOLS, getTool, describeCall, toolsForProvider, preflight, MAX_SOURCE, missingImages, deadLinks };
