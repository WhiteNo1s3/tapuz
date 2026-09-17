'use strict';

/**
 * The Menu Organizer (v2.28) — "the menu breaks from the amount of content"
 * (Ben). An injection pack: the CMS hands a chat (or the owner's local model)
 * the site's page inventory, its current menus and ONE computed number —
 * how many top-level items fit a header row — and reads back a `<bent-menus>`
 * document (src/bentml/menu-dialect.js) through a door that never lets a
 * broken link through: unknown pages are dropped with a hard warning, the
 * result is previewed on the real header, and an apply is preceded by a
 * backup the owner can restore from /admin/menus.
 *
 *   siteStateForMenus() / ctxFromFixture(json)   → ctx (the site as the pack sees it)
 *   buildMenuPrompt({brief, size, locale, variant, ctx}) → { text, chars, meta }
 *   parseMenuReply(reply, ctx, {brief})          → { doc, plan, warnings, warningTexts, notes, hard, preview }
 *   buildMenuPreview(plan, ctx)                  → preview (tree, diff, knobs, fit, fitLine, previewUrl)
 *   applyMenuPlan(plan, {force, reason, ctx})    → { applied, backupId, changed, rebuildError, warnings }
 *   undoLast()                                   → { restored }
 *
 * The prompt is composed on src/injections/compose.js (the ten fixed
 * sections); the eval harness (scripts/eval-injections.js) and the injection
 * descriptor (src/injections/menu-organizer.js) call exactly these names.
 *
 * v2.43 — the copilot walks through the SAME door. Its `read_menus` /
 * `organize_menu` tools (src/ai-tools.js) call parseMenuReply and
 * applyMenuPlan as they are; what it needed beyond them is reuse, not a fork:
 *   menuGrammar({pageSource, compact})  the dialect lines, taught by the pack AND the briefing
 *   capacitySentence(fit, n)            the one computed number, as the model reads it
 *   pageTable(ctx, size, trim)          the page inventory (`page=` comes from nowhere else)
 *   currentMenuPreview(ctx)             today's menus in the preview's shape — the canvas
 */

const crypto = require('crypto');
const dialect = require('./bentml/menu-dialect');
const { composePack } = require('./injections/compose');

const { parseMenusDoc, serializeMenus, isMenuBent, stripBidi, KNOB_KEYS } = dialect;

const HARD = ['UNKNOWN_PAGE', 'UNSAFE_URL', 'BAD_TEL'];
const REPAIRABLE = ['UNKNOWN_PAGE', 'PAGES_MISSING', 'OVERFLOW_LIKELY', 'DEPTH_FLATTENED', 'LABEL_TRIMMED', 'NAV_VALUE_RESET', 'NO_CHANGE', 'LAYOUT_UNASKED', 'ARTICLE_LINKED', 'DRAFT_LINKED', 'EMPTY_GROUP'];
const MAX_ITEMS = 40;
const MAX_UNKNOWN_SHARE = 0.3;
// a 40-link document is < 10K chars; anything longer is a whole chat pasted
// back (or a hostile paste) — refused before the parser sees it
const MAX_REPLY_CHARS = 60000;
// did the brief ask for a layout change? Hebrew terms as whole words (an
// optional prefix letter allowed: במסילת צד, לפריסה) — `מצד שני` and
// `הצדקה` are not asks; English on word boundaries
const SEP = '[\\s,.;:!?"\'()\\-–—/]';
const LAYOUT_ASK_RE = new RegExp(
  `(?:^|${SEP})(?:ו?(?:בצד|לצד)|[בלהמושכ]{0,3}(?:(?:מסילת|תפריט)[\\s-]+(?:ה?צד|צדדי)|מסילה|גלילה|לגלול|מגירה|פריסה|אנכית?|אופקית?))(?=$|${SEP})` +
  '|\\b(?:side(?:bar|nav)?|rails?|scroll(?:ing|able|s)?|drawers?|layouts?|vertical|horizontal)\\b', 'i');
const TEL_RE = /^\+?[\d\s()-]{5,20}$/;
const ROWS = { lite: 30, full: 80 };
const ROWS_MIN = 3;
const BUDGET = { lite: 9000, full: 14000 };
const BRIEF_MAX = 1500;
// a custom url: control chars and bidi marks stripped first (browsers drop
// tab/newline before reading the scheme, so `java\nscript:` is live), then
// a refused-scheme test, then an allowlist — everything else is UNSAFE_URL
const BAD_SCHEME_RE = /^(?:javascript|data|vbscript)\s*:/i;
const SAFE_URL_RE = /^(?:https?:\/\/|\/\/|\/|#|\.\.?\/|mailto:|tel:|[\p{L}\p{N}_-][^:/?#]*(?:[/?#]|$))/iu;

/** { ok, url } — url is the stripped probe (what gets stored). */
function safeUrl(raw) {
  const probe = stripBidi(String(raw == null ? '' : raw).replace(/[\x00-\x1f\x7f]/g, '')).trim();
  if (!probe) return { ok: true, url: '' };
  if (BAD_SCHEME_RE.test(probe) || !SAFE_URL_RE.test(probe)) return { ok: false, url: probe };
  return { ok: true, url: probe };
}

const PREVIEWS = new Map();
const PREVIEW_CAP = 40;

// ── messages the owner reads (Hebrew) ────────────────────────────────
const MESSAGES = {
  UNKNOWN_PAGE: (d) => `הקישור "${d.label}" מצביע על דף שלא קיים (${d.target}) — הוסר`,
  UNSAFE_URL: (d) => `הקישור "${d.label}" נושא כתובת לא בטוחה — הוסר`,
  BAD_TEL: (d) => `מספר טלפון לא תקין ב"${d.label}" (${d.target}) — הוסר`,
  PAGE_BY_TITLE: (d) => `"${d.label}": הדף זוהה לפי הכותרת (${d.from} → ${d.to})`,
  URL_TO_PAGE: (d) => `"${d.label}": הכתובת ${d.from} היא דף באתר — הומרה לקישור דף`,
  DUPLICATE_DROPPED: (d) => `"${d.label}" מופיע פעמיים באותו תפריט — נשמר הראשון`,
  DEPTH_FLATTENED: () => 'נמצאו תתי-תפריטים בעומק שני — הועלו לרמת ההורה (התפריט תומך ברמה אחת)',
  UNCLOSED_LINK: () => 'תג bent-link לא נסגר — נסגר אוטומטית',
  LABEL_TRIMMED: () => 'תווית ארוכה מ-40 תווים קוצרה',
  LABEL_EMPTY: () => 'פריט בלי תווית קיבל את השם "פריט"',
  NAV_VALUE_RESET: (d) => d.text,
  SUBMENU_HIDDEN_IN_SCROLL: () => 'ברצועת גלילה (flow="scroll") תתי-תפריטים לא נפתחים — קבצו רק בתפריט רגיל',
  FOLD_WITH_SIDE: () => 'קיפול (fold) לא פועל במסילת צד — יתעלמו ממנו',
  // sent back to the model verbatim as the repair instruction — so it names the fix
  OVERFLOW_LIKELY: (d) => `השורה העליונה ~${d.rowPx}px מתוך ~${d.availPx}px פנויים — צפויה לגלוש ל-${d.rowsNow} שורות (בשורה נכנסים ~${d.capacity} פריטים / ~${d.charBudget} תווים) — פתרון: קצרו תוויות, קבצו תחת הורה, או הוסיפו <bent-menu-layout fold="${Math.max(2, (Number(d.capacity) || 3) - 1)}" />`,
  PAGES_MISSING: (d) => `${d.count} דפים מפורסמים לא מופיעים באף תפריט: ${d.list}`,
  DRAFT_LINKED: (d) => `"${d.label}" מקשר לטיוטה (${d.target}) — הקישור יוביל ל-404 עד שהדף יפורסם`,
  ARTICLE_LINKED: (d) => `"${d.label}" מקשר למאמר (${d.target}) — מאמרים מגיעים מדף המאמרים`,
  NEW_MENU: (d) => `נוצר תפריט חדש בשם "${d.name}"`,
  NO_CHANGE: () => 'התוצאה זהה לתפריטים הנוכחיים — לא השתנה דבר',
  LAYOUT_UNASKED: (d) => `הפריסה שונתה (${d.what}) אף שהבקשה לא ביקשה זאת`,
  SEVERAL_DOCUMENTS: () => 'נמצאו כמה מסמכים בתשובה — נבחר העשיר ביותר',
  NO_WRAPPER: () => 'חסר העוטף <bent-menus> — נקרא בלעדיו',
  TAG_ALIAS: () => 'שמות תגים חלופיים (item/li/a) נקראו כ-bent-link',
  ATTR_ALIAS: () => 'שמות מאפיינים חלופיים (href/slug/title…) תורגמו',
  LABEL_FROM_TEXT: () => 'תווית נלקחה מהטקסט שבתוך התג',
  JSON_FALLBACK: () => 'התשובה הגיעה כ-JSON ולא כמסמך — נקראה בכל זאת',
  CURLY_QUOTES: () => 'מירכאות מסולסלות הוחלפו בישרות',
  TARGET_RETYPED: () => 'page= עם כתובת מלאה נקרא כ-url',
  LAYOUT_DUPLICATE: () => '<bent-menu-layout> הופיע פעמיים — האחרון קובע',
  MENU_NAME_DEFAULTED: () => '<bent-menu> בלי name — נקרא כ-main',
  EMPTY_GROUP: (d) => `"${d.label}" בלי יעד ובלי פריטי-משנה — הוסר`,
  PARENT_TO_GROUP: (d) => `ההורה "${d.label}" הפך לקבוצה — הדף נשאר כפריט משנה`,
  LOCATION_IGNORED: (d) => `התפריט "${d.name}" ביקש מיקום לא מוכר (${d.location}) — המיקום לא שונה (main/footer בלבד)`,
  EXTRA_TARGET_IGNORED: () => 'קישור עם יותר ממאפיין יעד אחד (page/url/tel/mailto/anchor) — נשמר הראשון'
};

const REFUSALS = {
  NO_MENU: () => 'לא נמצא תפריט בתשובה — צריך <bent-menu name="main"> עם קישורי <bent-link>',
  REPLY_TOO_LONG: (d) => `התשובה ארוכה מדי (${d.length} תווים; המקסימום ${MAX_REPLY_CHARS}) — הדביקו רק את מסמך <bent-menus>, לא את כל הצ׳אט`,
  PAGE_NOT_MENU: () => 'זה דף, לא תפריט — הדביקו אותו בבונה',
  THEME_NOT_MENU: () => 'זו ערכת נושא — הדביקו אותה בסטודיו',
  EMPTY_MENU: () => 'התפריט ריק — אף קישור לא שרד',
  TOO_MANY_ITEMS: (d) => `יותר מ-${MAX_ITEMS} קישורים (${d.count}) — זה כבר לא תפריט`,
  TOO_MANY_UNKNOWN: (d) => `${d.dropped} מתוך ${d.total} קישורים מצביעים על דפים שלא קיימים — התשובה נדחתה`,
  BAD_MENU_NAME: (d) => `שם תפריט לא תקין: "${d.name}" (אותיות לטיניות, ספרות, - ו-_ בלבד)`
};

function refuse(code, details) {
  const e = new Error(REFUSALS[code](details || {}));
  e.code = code;
  return e;
}

function warn(list, code, details) {
  const fn = MESSAGES[code] || (() => code);
  list.push({ code, message: fn(details || {}) });
}

// ── the site as the pack sees it ─────────────────────────────────────

function isArticle(p) { return Array.isArray(p.tags) && p.tags.includes('article'); }
function isPublished(p) { return p.status === 'published'; }
function isMenuPage(p) { return isPublished(p) && !isArticle(p); }

function cleanPath(v) { return stripBidi(v).trim().replace(/^\/+/, '').replace(/\.html$/i, '').replace(/\/+$/, ''); }

function resolveHome(pages, config) {
  const paths = new Set(pages.map((p) => p.full_path));
  const explicit = String((config && config.homepage) || '').trim();
  if (explicit && paths.has(explicit)) return explicit;
  if (paths.has('home')) return 'home';
  const first = pages.find(isPublished) || pages[0];
  return first ? first.full_path : '';
}

/** The pages a set of menus reaches (page links, and site-relative urls). */
function reachedPaths(menus, homePath) {
  const out = new Set();
  const walk = (items) => (items || []).forEach((it) => {
    if (!it) return;
    if (it.type === 'page' && it.target) out.add(cleanPath(it.target));
    else if (it.type === 'custom' || !it.type) {
      const url = String(it.url || it.target || '').trim();
      if (url === '/' || /^\/index\.html$/i.test(url)) { if (homePath) out.add(homePath); }
      else if (/^\/[^?#]+$/.test(url)) out.add(cleanPath(url));
    }
    walk(it.children);
  });
  Object.values(menus || {}).forEach((m) => walk(Array.isArray(m) ? m : (m && m.items)));
  return out;
}

function menusOfPages(menus, homePath) {
  const byPath = {};
  for (const name of Object.keys(menus || {})) {
    for (const p of reachedPaths({ [name]: menus[name] }, homePath)) (byPath[p] = byPath[p] || []).push(name);
  }
  return byPath;
}

function fitFor(ctx, menus, locations, overrides) {
  const menusLib = require('./menus');
  const main = (menus || {})[(locations || {}).main || 'main'] || [];
  return menusLib.estimateMenuFit(Array.isArray(main) ? main : (main.items || []), overrides, ctx.config);
}

/** The live site, DB-backed. */
function siteStateForMenus() {
  const theme = require('./theme');
  const menusLib = require('./menus');
  const { listPages } = require('./pages');
  const { db } = require('./db');
  const { loadConfig } = require('./config');
  const tagRows = {};
  try { db.prepare('SELECT full_path, tags FROM pages').all().forEach((r) => { tagRows[r.full_path] = r.tags; }); } catch (e) { /* tags stay [] */ }
  const pages = listPages().map((r) => {
    let tags = [];
    try { tags = JSON.parse(tagRows[r.full_path] || r.tags || '[]'); } catch (e) { tags = []; }
    let meta = {};
    try { meta = typeof r.meta === 'string' ? JSON.parse(r.meta || '{}') : (r.meta || {}); } catch (e) { meta = {}; }
    return { full_path: r.full_path, title: r.title, status: r.status, tags: Array.isArray(tags) ? tags : [], meta };
  });
  const config = loadConfig();
  const overrides = theme.loadOverrides();
  const menus = menusLib.loadMenus();
  const locations = menusLib.getMenuLocations();
  let orphans = [];
  try { orphans = require('./sitemap').buildSitemap().orphans; } catch (e) { orphans = []; }
  const homePath = resolveHome(pages, config);
  const ctx = { pages, config, overrides, menus, locations, orphans, homePath };
  ctx.fit = fitFor(ctx, menus, locations, overrides);
  return ctx;
}

/** A fixture site (test/fixtures/inject/menu-organizer/*.json) — same shape, no DB. */
function ctxFromFixture(json) {
  const theme = require('./theme');
  const menusLib = require('./menus');
  const j = json || {};
  const pages = (j.pages || []).map((p) => ({
    full_path: cleanPath(p.full_path), title: String(p.title || p.full_path || ''), status: p.status || 'published',
    tags: Array.isArray(p.tags) ? p.tags : [], meta: p.meta || {}
  }));
  const c = j.config || {};
  const config = {
    title: 'האתר', description: '', homepage: '', language: j.locale === 'en' ? 'en' : 'he', ...c,
    logo: { type: 'text', text: '', width: 160, ...(c.logo || {}) },
    header: { tagline: '', ctaLabel: '', ctaUrl: '', showLogo: true, ...(c.header || {}) }
  };
  const overrides = theme.mergeDeep(theme.DEFAULT_OVERRIDES, j.overrides || {});
  const menus = {};
  const src = j.menus || {};
  for (const name of Object.keys(src)) menus[name] = menusLib.normalizeItems(src[name]);
  if (!menus.main) menus.main = [];
  if (!menus.footer) menus.footer = [];
  const locations = { main: 'main', footer: 'footer', ...(j.locations || {}) };
  const homePath = j.homePath || resolveHome(pages, config);
  const reached = reachedPaths(menus, homePath);
  const orphans = pages.filter((p) => !reached.has(p.full_path)).map((p) => ({ full_path: p.full_path, title: p.title, status: p.status }));
  const ctx = { pages, config, overrides, menus, locations, orphans, homePath, brief: j.brief || '', expect: j.expect || {}, locale: j.locale || 'he' };
  ctx.fit = fitFor(ctx, menus, locations, overrides);
  return ctx;
}

// ── the prompt ───────────────────────────────────────────────────────

function hubOf(pages, articles) {
  const menuPages = pages.filter(isMenuPage);
  const prefixes = {};
  for (const a of articles) {
    const i = a.full_path.lastIndexOf('/');
    if (i > 0) { const pre = a.full_path.slice(0, i); prefixes[pre] = (prefixes[pre] || 0) + 1; }
  }
  const best = Object.keys(prefixes).sort((x, y) => prefixes[y] - prefixes[x])[0];
  if (best && menuPages.some((p) => p.full_path === best)) return best;
  const named = menuPages.find((p) => /^(articles|blog|posts|news|מאמרים|בלוג)$/i.test(p.full_path)) ||
    menuPages.find((p) => /מאמרים|בלוג|blog|articles/i.test(p.title || ''));
  return named ? named.full_path : '';
}

function cell(s) { return String(s == null ? '' : s).replace(/\|/g, '¦').replace(/\s+/g, ' ').trim(); }

/**
 * The page inventory as a table. `trim` (the budget pass): rowsCap below the
 * size's default drops rows from the bottom; dropDrafts/dropArticles omit
 * the two summary lines.
 */
function pageTable(ctx, size, trim = {}) {
  const pages = ctx.pages || [];
  const inMenu = menusOfPages(ctx.menus, ctx.homePath);
  const rowsCap = trim.rowsCap || ROWS[size] || ROWS.lite;
  const menuPages = pages.filter(isMenuPage);
  const ordered = menuPages.slice().sort((a, b) => (a.full_path === ctx.homePath ? -1 : b.full_path === ctx.homePath ? 1 : 0));
  const articles = pages.filter((p) => isPublished(p) && isArticle(p));
  const drafts = pages.filter((p) => !isPublished(p));
  const lines = ['| page | כותרת | מצב | בתפריט היום | סוג |', '|---|---|---|---|---|'];
  for (const p of ordered.slice(0, rowsCap)) {
    lines.push(`| ${cell(p.full_path)} | ${cell(p.title)} | מפורסם | ${(inMenu[p.full_path] || []).join('+') || '—'} | דף |`);
  }
  const extra = ordered.length - rowsCap;
  const after = [];
  if (extra > 0) after.push(`- ועוד ${extra} דפים מפורסמים שלא נכנסו לטבלה (חבילה מלאה מציגה יותר).`);
  if (articles.length && !trim.dropArticles) {
    const hub = hubOf(pages, articles);
    after.push(`- ${articles.length} מאמרים${hub ? ` תחת \`${hub}\`` : ''} — נשארים מחוץ לתפריט${hub ? ' (דף המאמרים עצמו בפנים)' : ''}.`);
  }
  if (drafts.length && !trim.dropDrafts) after.push(`- ${drafts.length} טיוטות (לא בתפריט).`);
  return { text: lines.concat(after.length ? [''].concat(after) : []).join('\n'), rows: Math.min(ordered.length, rowsCap), published: menuPages.length, articles: articles.length, drafts: drafts.length };
}

/** The current menus as labels only — the budget pass's stand-in for the full document. */
function menusLabelsOnly(ctx, knobs) {
  const menus = ctx.menus || {};
  const loc = ctx.locations || {};
  const label = (it) => String((it && it.label) || '').trim() || 'פריט';
  const lines = [];
  const names = ['main', 'footer'].filter((n) => menus[n]).concat(Object.keys(menus).filter((n) => n !== 'main' && n !== 'footer').sort());
  for (const name of names) {
    const slot = ['main', 'footer'].find((l) => loc[l] === name);
    const items = (menus[name] || []).map((it) => label(it) + (it.children && it.children.length ? ` › [${it.children.map(label).join(', ')}]` : ''));
    lines.push(`- ${name}${slot ? ` (${slot === 'main' ? 'הכותרת' : 'התחתית'})` : ''}: ${items.join(' · ') || '—'}`);
  }
  const k = knobs || {};
  lines.push(`- פריסה: placement=${k.placement} flow=${k.flow} fold=${k.fold} width=${k.width}`);
  lines.push('', '(מקוצר לתוויות בלבד כדי לעמוד בתקציב התווים; היעדים — בעמודת `page` בטבלה.)');
  return lines.join('\n');
}

function ladderText(fit, capacity) {
  const fold = Math.max(2, capacity - 1);
  return [
    'סולם ההחלטה — עוצרים בשלב הראשון שמספיק:',
    '1. נכנס בשורה → שומרים את הסדר, מהדקים תוויות.',
    '2. מקצרים תוויות ל-2–12 תווים; בלי אימוג׳י אלא אם התפריט הנוכחי משתמש בהם.',
    `3. מקבצים ל-≤${capacity} הורים עם 2–6 ילדים כל אחד.`,
    // the mechanism, spelled out: a model wrote "הוספתי fold=9" in its note and never emitted the tag
    `4. עדיין גולש → הוסיפו בראש המסמך את השורה \`<bent-menu-layout fold="${fold}" />\` (מה שאחרי ${fold} הפריטים נכנס תחת "עוד") או \`width="wide"\` — הבר נשאר.`,
    `5. \`placement="side"\` (מסילת צד מציגה ~${fit.sideFits}) / \`flow="scroll"\` (רק תפריט שטוח, בלי תתי-תפריטים) / \`flow="drawer"\` — **רק כשהבקשה של השחקן מבקשת זאת**.`
  ].join('\n');
}

/**
 * The dialect, one line per tag — the pack's "הדקדוק" section. Since v2.43
 * the copilot's briefing teaches the SAME lines (src/pzn/agent-roleplay.js):
 * one grammar, two readers, so a tag the door learns to accept is taught to
 * both by editing this list. `pageSource` names where a legal `page=` value
 * comes from — the pack has a table in the prompt, the copilot has the table
 * `read_menus` hands back.
 *
 * `compact` is what rides INSIDE read_menus' answer, beside the site's own
 * serialized document. That document already demonstrates the wrapper, the
 * `<bent-menu>` line and a page link — so the compact list keeps only what a
 * live menu may never show (a flat menu has no parent; few have a tel link;
 * fold is usually 0): the layout tag cut to the two knobs a sort reaches
 * for, the free targets, and nesting. Where it rides matters more than its
 * size: a briefing is paid on EVERY turn, a tool answer only on the turns
 * that touch the menu — and in an 8,192 window that difference is whether
 * the menu can be read back at all.
 * @param {{ pageSource?: string, compact?: boolean }} [opts]
 */
function menuGrammar(opts = {}) {
  const pageSource = opts.pageSource || 'הערך מעמודת `page` בטבלה';
  const wrapper = '- `<bent-menus version="1" note="משפט אחד לבעל האתר">` — העוטף, פעם אחת.';
  const layout = opts.compact
    ? '- `<bent-menu-layout fold="0..12" width="content|wide|full" />` — 0..1; `fold="N"` = מה שאחרי N הפריטים נכנס תחת "עוד".'
    : '- `<bent-menu-layout placement="top|side" flow="wrap|scroll|drawer" fold="0..12" collapse="sm|md|lg|never" width="content|wide|full" align="start|center|end|between" gap="sm|md|lg" size="sm|md|lg" current="underline|pill|bold|none" />` — 0..1, אותו תג כמו במסמך הערכה; מאפיין שלא כתבתם = ידית שלא משתנה.';
  const menu = '- `<bent-menu name="main|footer" location="main|footer">` — תפריט לכל שם; `main` = הכותרת, `footer` = התחתית.';
  const link = '- `<bent-link label="…" page="…" />` — קישור לדף; `page` = ' + pageSource + ', מועתק מילה במילה.';
  const free = '- `<bent-link label="…" url="…" />` · `tel="…"` · `mailto="…"` · `anchor="id"` — קישור חופשי / חיוג / מייל / עוגן. בדיוק מאפיין יעד אחד.';
  const parent = '- הורה: `<bent-link label="…" page="…">` … `</bent-link>` עוטף ילדים (רמה אחת בלבד). הורה בלי מאפיין יעד = קבוצה.';
  return (opts.compact ? [layout, free, parent] : [wrapper, layout, menu, link, free, parent]).join('\n');
}

/**
 * The ONE computed number, as the sentence the model reads: how many top
 * items fit a row, the character budget, and where the menu stands today.
 * The pack embeds it in its capacity block; `read_menus` (v2.43) returns it
 * verbatim — the CMS computes capacity, a model never guesses it.
 */
function capacitySentence(fit, itemCount) {
  return `**בשורה אחת נכנסים עד ${fit.capacity} פריטים עליונים ועד ${fit.charBudget} תווים בסך התוויות**. היום: ${itemCount} פריטים / ${fit.labelChars} תווים → ${fit.rowsNow} שורות.`;
}

const EXAMPLE_DOC = [
  '<bent-menus version="1" note="שירותים קובצו תחת הורה אחד כדי להיכנס בשורה">',
  '  <bent-menu-layout placement="top" flow="wrap" fold="0" width="wide" />',
  '  <bent-menu name="main" location="main">',
  '    <bent-link label="הבית" page="home" />',
  '    <bent-link label="שירותים" page="services">',
  '      <bent-link label="עיצוב" page="services/design" />',
  '      <bent-link label="בניית אתרים" page="services/web" />',
  '    </bent-link>',
  '    <bent-link label="מאמרים">',
  '      <bent-link label="מדריך RTL" page="blog/rtl-guide" />',
  '      <bent-link label="למה תפוז" page="blog/why-tapuz" />',
  '    </bent-link>',
  '    <bent-link label="מחירון" anchor="pricing" />',
  '    <bent-link label="חייגו" tel="+972501234567" />',
  '    <bent-link label="כתבו לנו" mailto="hi@studio.co.il" />',
  '    <bent-link label="צרו קשר" page="contact" />',
  '  </bent-menu>',
  '  <bent-menu name="footer" location="footer">',
  '    <bent-link label="פרטיות" page="privacy" />',
  '    <bent-link label="תנאים" page="terms" />',
  '  </bent-menu>',
  '</bent-menus>'
].join('\n');

const FORMAT_DOC = [
  '```html',
  '<bent-menus version="1" note="משפט אחד: מה שיניתם ולמה">',
  '  <bent-menu-layout fold="…" />',
  '  <bent-menu name="main" location="main">',
  '    <bent-link label="…" page="…" />',
  '    <bent-link label="…" page="…">',
  '      <bent-link label="…" page="…" />',
  '    </bent-link>',
  '  </bent-menu>',
  '  <bent-menu name="footer" location="footer">',
  '    <bent-link label="…" page="…" />',
  '  </bent-menu>',
  '</bent-menus>',
  '```',
  '`<bent-menu-layout>` — רק אם יש סיבה לשנות ידית; אחרת משמיטים את השורה כולה.'
].join('\n');

/**
 * The pack. lite ≤ 9,000 chars (30 table rows), full ≤ 14,000 (80 rows) —
 * ENFORCED: over budget, the brief is cut to 1,500 chars, then the current
 * menus collapse to labels only, then the drafts line, the articles line
 * and table rows (from the bottom) go, until the pack fits; meta.degraded
 * lists what was trimmed.
 * @param {{ brief?: string, size?: 'lite'|'full', locale?: 'he'|'en', variant?: 'A'|'B', ctx?: object }} opts
 */
function buildMenuPrompt(opts = {}) {
  const theme = require('./theme');
  const ctx = opts.ctx || siteStateForMenus();
  const size = opts.size === 'full' ? 'full' : 'lite';
  const variant = opts.variant === 'B' ? 'B' : 'A';
  const locale = opts.locale === 'en' || (!opts.locale && ctx.locale === 'en') ? 'en' : 'he';
  const briefFull = String(opts.brief == null ? (ctx.brief || '') : opts.brief).trim();
  const brief = briefFull.slice(0, BRIEF_MAX);
  const knobs = theme.menuKnobs(ctx.overrides);
  const fit = ctx.fit || fitFor(ctx, ctx.menus, ctx.locations, ctx.overrides);
  const mainItems = (ctx.menus || {})[(ctx.locations || {}).main || 'main'] || [];
  const r = (n) => Math.round(n);

  const current = serializeMenus({ knobs, menus: ctx.menus, locations: ctx.locations });
  const degraded = [];
  if (briefFull.length > BRIEF_MAX) degraded.push(`brief:${BRIEF_MAX}`);
  const trim = { rowsCap: ROWS[size] || ROWS.lite, dropDrafts: false, dropArticles: false, labelsOnly: false };
  let table = pageTable(ctx, size, trim);

  const stateFor = () => [
    {
      title: 'האתר',
      body: [
        `- שם האתר: **${String((ctx.config || {}).title || 'האתר').trim()}**`,
        (ctx.config || {}).description ? `- תיאור: ${String(ctx.config.description).trim().slice(0, 240)}` : null,
        locale === 'en' ? '- שפה וכיוון: **אנגלית, LTR** — התוויות באנגלית.' : '- שפה וכיוון: **עברית, RTL** — התוויות בעברית, קצרות.',
        `- דפים שאף תפריט לא מגיע אליהם היום: ${(ctx.orphans || []).filter((o) => o.status === 'published').length}`
      ].filter(Boolean)
    },
    { title: 'טבלת הדפים (הערך בעמודה `page` הוא היחיד שמותר ב-`page="…"`)', body: table.text },
    trim.labelsOnly
      ? { title: 'התפריטים היום (תוויות בלבד)', body: menusLabelsOnly(ctx, knobs) }
      : { title: 'התפריטים היום (המצב הנוכחי, באותה שפה בדיוק)', body: '```html\n' + current.replace(/\s+$/, '') + '\n```' }
  ];

  const capacityBlock = [
    '## כלל הקיבולת (חשבנו בשבילך)',
    '',
    `רוחב פנוי לשורת התפריט ~${r(fit.availPx)}px (כותרת ${knobs.width}, לוגו ${r(fit.logoPx)}px). פריט ממוצע ${r(fit.avgItemPx)}px + רווח ${r(fit.gapPx)}px ⇒ ${capacitySentence(fit, mainItems.length)} יש ${table.published} דפים מפורסמים, ${table.articles} מאמרים, ${table.drafts} טיוטות.`,
    '',
    ladderText(fit, fit.capacity)
  ].join('\n');

  const grammar = menuGrammar();

  const rules = [
    'המסמך הוא כל התשובה — גדר ```html מתקבלת בברכה, אבל שום דבר לפניה או אחריה.',
    '`page="…"` רק מהטבלה, מועתק מילה במילה — לעולם לא ממציאים ולא מנחשים. ערך שכתוב בשפה כ-`a|b|c` הוא רשימת אפשרויות — כותבים אחת בלבד, לא את הרשימה.',
    'כל דף מפורסם שאינו מאמר מופיע פעם אחת, ב-main או ב-footer, אלא אם הבקשה אומרת אחרת; מאמרים נשארים בחוץ (דף המאמרים שלהם בפנים); טיוטות נשארות בחוץ.',
    'רמת קינון אחת; עלה נגמר ב-`/>`; הורה בלי דף-אב לא נושא מאפיין יעד (קבוצה). הורה שמקבץ דפים ואין לו דף משלו — בלי מאפיין יעד; אל תחזרו על אותו דף גם כהורה וגם כילד.',
    'הבית ראשון, צרו קשר אחרון, דפים משפטיים ב-footer.',
    'תוויות 2–12 תווים.',
    'מירכאות ישרות בלבד.',
    'לעולם לא מחזירים את התפריט הנוכחי כמות שהוא — אם הוא כבר נכנס, עדיין מהדקים תוויות או סדר, ואומרים ב-`note` מה השתנה.',
    'משמיטים מ-`<bent-menu-layout>` מאפיינים שאין סיבה לשנות; `placement`/`flow` רק כשהבקשה מבקשת.',
    `שורה עליונה עם יותר מ-${fit.capacity} פריטים או ${fit.charBudget} תווים בלי \`fold\` היא תשובה שגויה — הקיפול הוא שורת התג \`<bent-menu-layout fold="${Math.max(2, fit.capacity - 1)}" />\` בראש המסמך, לא משפט ב-\`note\`.`,
    '"רק סדר / only reorder" → אותם קישורים ואותן קבוצות, סדר חדש (ואם הסדר כבר נכון — מהדקים תוויות ואומרים זאת ב-`note`), בלי להוסיף ובלי להסיר.'
  ];

  const role = {
    title: '# 🧭 משחק: מסדר/ת התפריטים של תפוזיאל (Menu Organizer Roleplay)',
    text: [
      'את/ה **מסדר/ת התפריטים** של אתר אמיתי — השחקן מנהל אותו ומקבל את מה שתכתבו ישר לתוך הכותרת. מקבלים את רשימת הדפים של האתר ואת התפריטים כפי שהם היום, יחד עם מספר אחד שחישבנו: כמה פריטים נכנסים בשורה. מחזירים תפריטים קצרים, מסודרים, בשורה אחת — כמסמך `<bent-menus>` אחד ולא שום דבר אחר.'
    ]
  };
  const notThis = 'לא דף ולא ערכת נושא. אין מודולים, אין CSS, אין `<bent-theme>`, אין `<!DOCTYPE>` — רק התגים שבדקדוק למטה. תפריט = תוויות + יעדים מהטבלה, לא תוכן.';

  const compose = () => composePack({
    locale,
    fresh: true,
    role,
    notThis,
    state: stateFor(),
    grammar,
    decision: capacityBlock,
    rules,
    rulesTail: variant === 'B' ? ladderText(fit, fit.capacity) : '',
    format: FORMAT_DOC,
    example: EXAMPLE_DOC,
    brief: brief ? brief + '\n\nהתשובה: המסמך בלבד.' : '',
    start: 'המשחק מתחיל עכשיו — סדרו את התפריט הנוכחי כך שייכנס בשורה ויהיה ברור לגולש.'
  });

  // the budget pass: cheapest loss first, stop at the first step that fits
  const budget = BUDGET[size];
  let pack = compose();
  if (pack.chars > budget) { trim.labelsOnly = true; degraded.push('menus:labels-only'); pack = compose(); }
  if (pack.chars > budget && table.drafts) { trim.dropDrafts = true; degraded.push('drafts-line'); table = pageTable(ctx, size, trim); pack = compose(); }
  if (pack.chars > budget && table.articles) { trim.dropArticles = true; degraded.push('articles-line'); table = pageTable(ctx, size, trim); pack = compose(); }
  const rowsBefore = table.rows;
  while (pack.chars > budget && trim.rowsCap > ROWS_MIN && table.rows > ROWS_MIN) {
    trim.rowsCap = Math.min(trim.rowsCap, table.rows) - 1;
    table = pageTable(ctx, size, trim);
    pack = compose();
  }
  if (table.rows < rowsBefore) degraded.push(`rows:${rowsBefore}→${table.rows}`);

  return {
    text: pack.text,
    chars: pack.chars,
    meta: { capacity: fit.capacity, charBudget: fit.charBudget, rowsNow: fit.rowsNow, pages: table.rows, items: mainItems.length, size, variant, budget, degraded }
  };
}

// ── the door: validate a reply against the site ──────────────────────

function resolvePlan(plan, ctx) {
  const theme = require('./theme');
  const menusLib = require('./menus');
  const menus = {};
  for (const name of Object.keys(ctx.menus || {})) menus[name] = menusLib.normalizeItems(ctx.menus[name]);
  const locations = { ...(ctx.locations || {}) };
  for (const name of Object.keys((plan && plan.menus) || {})) {
    menus[name] = menusLib.normalizeItems(plan.menus[name].items || []);
    if (plan.menus[name].location) locations[plan.menus[name].location] = name;
  }
  const frag = theme.knobsToOverrides((plan && plan.knobs) || {}).overrides;
  const overrides = theme.mergeDeep(JSON.parse(JSON.stringify(ctx.overrides || {})), frag);
  const knobsBefore = theme.menuKnobs(ctx.overrides);
  const knobsAfter = theme.menuKnobs(overrides);
  const mainItems = menus[locations.main || 'main'] || [];
  const fitBefore = ctx.fit || fitFor(ctx, ctx.menus, ctx.locations, ctx.overrides);
  const fitAfter = menusLib.estimateMenuFit(mainItems, overrides, ctx.config);
  return { menus, locations, overrides, knobsBefore, knobsAfter, mainItems, fitBefore, fitAfter };
}

/**
 * parseMenuReply(reply, ctx, {brief}) — the door. Throws Error{code} on a
 * refusal; otherwise the plan (what an apply would write), every warning
 * with a Hebrew message, and the preview.
 */
function parseMenuReply(reply, ctx = siteStateForMenus(), opts = {}) {
  const theme = require('./theme');
  const brief = String((opts && opts.brief) || '').trim();
  const text = String(reply || '');
  if (text.length > MAX_REPLY_CHARS) throw refuse('REPLY_TOO_LONG', { length: text.length });
  const warnings = [];

  const pages = ctx.pages || [];
  const byPath = {};
  const byTitle = {};
  for (const p of pages) {
    byPath[p.full_path] = p;
    const t = String(p.title || '').trim().toLowerCase();
    if (t && !byTitle[t]) byTitle[t] = p;
  }
  const homePath = ctx.homePath || resolveHome(pages, ctx.config);

  // several documents in one reply (a whole prompt echoed back carries the
  // worked example AND the site's current menus): the one whose page links
  // resolve on THIS site wins; the dialect's richness only breaks a tie
  const siteRank = (cand) => {
    let n = 0;
    const walk = (items) => (items || []).forEach((it) => {
      if (it.type === 'page' && it.target && it.target !== '…' && byPath[cleanPath(it.target)]) n++;
      walk(it.children);
    });
    Object.values(cand.menus || {}).forEach((m) => walk(m.items));
    return n;
  };
  const doc = parseMenusDoc(text, { rank: siteRank });

  if (!Object.keys(doc.menus).length) {
    if (/<bent-theme(?=[\s/>])/i.test(text)) throw refuse('THEME_NOT_MENU');
    if (/<!DOCTYPE|<bent-hero(?=[\s/>])|<bent-section(?=[\s/>])|<bent-text(?=[\s/>])|<bent-nav(?=[\s/>])/i.test(text)) throw refuse('PAGE_NOT_MENU');
    throw refuse('NO_MENU');
  }

  let total = 0;
  let dropped = 0;
  let survivors = 0;
  const droppedList = [];
  const keyFor = (it) => (it.type === 'custom' ? `custom|${it.url}` : `${it.type}|${it.target}`);
  const groupLike = (it) => it.type === 'custom' && (it.url === '#' || !it.url);

  // parent = the validated item whose children these are (a child that
  // repeats its parent's own target turns the parent into a group)
  const validateItems = (list, menuName, seen, parent) => {
    const out = [];
    let parentDemoted = false;
    for (const raw of list || []) {
      total++;
      const it = { label: raw.label, type: raw.type, target: raw.target || '', url: raw.url || '', children: [] };
      let keep = true;
      if (it.type === 'page') {
        let target = cleanPath(it.target);
        if (!target) target = homePath;
        let page = byPath[target];
        if (!page) {
          const byT = byTitle[stripBidi(raw.target).trim().toLowerCase()];
          if (byT) { warn(warnings, 'PAGE_BY_TITLE', { label: it.label, from: raw.target, to: byT.full_path }); page = byT; target = byT.full_path; }
        }
        if (!page) {
          warn(warnings, 'UNKNOWN_PAGE', { label: it.label, target: raw.target || '/' });
          dropped++;
          if (raw.children && raw.children.length) { it.type = 'custom'; it.target = ''; it.url = '#'; } else { keep = false; droppedList.push({ menu: menuName, label: it.label, code: 'UNKNOWN_PAGE' }); }
        } else {
          it.target = target;
          it.url = '';
          if (!isPublished(page)) warn(warnings, 'DRAFT_LINKED', { label: it.label, target });
          if (isArticle(page)) warn(warnings, 'ARTICLE_LINKED', { label: it.label, target });
        }
      } else if (it.type === 'custom') {
        const safe = safeUrl(it.url || it.target);
        const url = safe.url;
        if (!safe.ok) {
          warn(warnings, 'UNSAFE_URL', { label: it.label });
          dropped++; keep = false; droppedList.push({ menu: menuName, label: it.label, code: 'UNSAFE_URL' });
        } else {
          const m = url.match(/^\/([^?#]+?)(?:\.html)?\/?$/i);
          if (m && byPath[cleanPath(m[1])]) {
            warn(warnings, 'URL_TO_PAGE', { label: it.label, from: url });
            it.type = 'page'; it.target = cleanPath(m[1]); it.url = '';
            const page = byPath[it.target];
            if (!isPublished(page)) warn(warnings, 'DRAFT_LINKED', { label: it.label, target: it.target });
            if (isArticle(page)) warn(warnings, 'ARTICLE_LINKED', { label: it.label, target: it.target });
          } else { it.url = url || '#'; it.target = ''; }
        }
      } else if (it.type === 'tel') {
        if (!TEL_RE.test(it.target)) {
          warn(warnings, 'BAD_TEL', { label: it.label, target: it.target });
          dropped++; keep = false; droppedList.push({ menu: menuName, label: it.label, code: 'BAD_TEL' });
        }
      } else if (it.type === 'anchor') {
        it.target = String(it.target || '').replace(/^#/, '');
      }
      if (!keep) continue;
      const isGroup = groupLike(it);
      const key = keyFor(it);
      if (!isGroup && seen.has(key)) {
        // the parent links to a page AND repeats it as a child: the parent
        // becomes the group, the child keeps the page (the key is now its)
        if (parent && !parentDemoted && !groupLike(parent) && keyFor(parent) === key) {
          parent.type = 'custom'; parent.target = ''; parent.url = '#'; parentDemoted = true;
          warn(warnings, 'PARENT_TO_GROUP', { label: parent.label });
        } else { warn(warnings, 'DUPLICATE_DROPPED', { label: it.label }); continue; }
      } else if (!isGroup) seen.add(key);
      survivors++;
      it.children = validateItems(raw.children, menuName, seen, it);
      // no target and nothing left under it: a dead `#` link, not a group
      if (groupLike(it) && !it.children.length) {
        warn(warnings, 'EMPTY_GROUP', { label: it.label });
        survivors--; droppedList.push({ menu: menuName, label: it.label, code: 'EMPTY_GROUP' });
        continue;
      }
      out.push(it);
    }
    return out;
  };

  const planMenus = {};
  for (const name of Object.keys(doc.menus)) {
    if (!/^[a-z0-9_-]{1,40}$/.test(name)) throw refuse('BAD_MENU_NAME', { name });
    const entry = doc.menus[name];
    const location = ['main', 'footer'].includes(entry.location) ? entry.location : undefined;
    if (entry.location && !location) warn(warnings, 'LOCATION_IGNORED', { name, location: entry.location });
    const items = validateItems(entry.items, name, new Set(), null);
    planMenus[name] = location ? { location, items } : { items };
    if (!(ctx.menus || {})[name]) warn(warnings, 'NEW_MENU', { name });
  }
  if (total > MAX_ITEMS) throw refuse('TOO_MANY_ITEMS', { count: total });
  if (total && dropped / total > MAX_UNKNOWN_SHARE) throw refuse('TOO_MANY_UNKNOWN', { dropped, total });
  if (!survivors) throw refuse('EMPTY_MENU');

  // the layout knobs: only what the document touched AND changed
  const kt = theme.knobsToOverrides(doc.knobs || {});
  for (const t of kt.warnings) warn(warnings, 'NAV_VALUE_RESET', { text: t });
  const knobsBefore = theme.menuKnobs(ctx.overrides);
  const knobsTouched = theme.menuKnobs(theme.mergeDeep(JSON.parse(JSON.stringify(ctx.overrides || {})), kt.overrides));
  const knobs = {};
  for (const key of KNOB_KEYS) {
    if ((doc.knobs || {})[key] !== undefined && knobsTouched[key] !== knobsBefore[key]) knobs[key] = knobsTouched[key];
  }

  const plan = { menus: planMenus, knobs, placement: knobsTouched.placement, note: doc.note || '', dropped: droppedList };
  const res = resolvePlan(plan, ctx);
  plan.items = res.mainItems.map((it) => stripIds(it));

  // the dialect's tolerances, as warnings the owner sees
  for (const n of doc.notes) if (MESSAGES[n]) warn(warnings, n);

  const k = res.knobsAfter;
  if (k.flow === 'scroll' && res.mainItems.some((it) => it.children && it.children.length)) warn(warnings, 'SUBMENU_HIDDEN_IN_SCROLL');
  if (k.placement === 'side' && k.fold > 0) warn(warnings, 'FOLD_WITH_SIDE');
  if (res.fitAfter.mode === 'top' && k.fold === 0 && res.fitAfter.rowsNow > 1) {
    warn(warnings, 'OVERFLOW_LIKELY', { rowPx: Math.round(res.fitAfter.rowPx), availPx: Math.round(res.fitAfter.availPx), rowsNow: res.fitAfter.rowsNow, capacity: res.fitAfter.capacity, charBudget: res.fitAfter.charBudget });
  }
  const reached = reachedPaths(res.menus, homePath);
  const missing = pages.filter((p) => isMenuPage(p) && !reached.has(p.full_path));
  if (missing.length) warn(warnings, 'PAGES_MISSING', { count: missing.length, list: missing.slice(0, 8).map((p) => p.title || p.full_path).join(', ') + (missing.length > 8 ? '…' : '') });
  const beforeDoc = serializeMenus({ knobs: knobsBefore, menus: ctx.menus, locations: ctx.locations });
  const afterDoc = serializeMenus({ knobs: res.knobsAfter, menus: res.menus, locations: res.locations });
  if (beforeDoc === afterDoc) warn(warnings, 'NO_CHANGE');
  const layoutChanged = [];
  if (k.placement !== knobsBefore.placement) layoutChanged.push(`placement ${knobsBefore.placement}→${k.placement}`);
  if (k.flow !== knobsBefore.flow) layoutChanged.push(`flow ${knobsBefore.flow}→${k.flow}`);
  if (layoutChanged.length && !LAYOUT_ASK_RE.test(brief)) warn(warnings, 'LAYOUT_UNASKED', { what: layoutChanged.join(', ') });

  const hard = warnings.some((w) => HARD.includes(w.code));
  plan.hard = hard;
  plan.warnings = warnings;
  const preview = buildMenuPreview(plan, ctx, res);
  return { doc, plan, warnings, warningTexts: warnings.map((w) => w.message), notes: doc.notes.slice(), hard, preview };
}

function stripIds(it) {
  return { label: it.label, type: it.type, target: it.target, url: it.url, children: (it.children || []).map(stripIds) };
}

// ── preview ──────────────────────────────────────────────────────────

function px(n) { return Math.round(n).toLocaleString('en-US'); }

function keyOf(it) {
  const isGroup = it.type === 'custom' && (it.url === '#' || !it.url);
  if (isGroup) return `group|${it.label}`;
  return it.type === 'custom' ? `custom|${it.url}` : `${it.type}|${it.target}`;
}

function flatWithParents(items) {
  const out = [];
  (items || []).forEach((it, i) => {
    out.push({ key: keyOf(it), label: it.label, parent: null, index: i });
    (it.children || []).forEach((c, j) => out.push({ key: keyOf(c), label: c.label, parent: keyOf(it), index: j }));
  });
  return out;
}

function diffMenus(oldItems, newItems) {
  const a = flatWithParents(oldItems);
  const b = flatWithParents(newItems);
  const am = new Map(); a.forEach((e) => { if (!am.has(e.key)) am.set(e.key, e); });
  const bm = new Map(); b.forEach((e) => { if (!bm.has(e.key)) bm.set(e.key, e); });
  const added = b.filter((e) => !am.has(e.key)).map((e) => e.label);
  const removed = a.filter((e) => !bm.has(e.key)).map((e) => e.label);
  const common = a.filter((e) => bm.has(e.key)).map((e) => e.key);
  const orderB = b.filter((e) => am.has(e.key)).map((e) => e.key);
  const moved = [];
  const relabeled = [];
  common.forEach((key, i) => {
    const o = am.get(key); const n = bm.get(key);
    if (o.label !== n.label) relabeled.push([o.label, n.label]);
    if (o.parent !== n.parent || orderB.indexOf(key) !== i) moved.push(n.label);
  });
  return { added, removed, moved, relabeled };
}

function pickFit(f) {
  return { rowsNow: f.rowsNow, capacity: f.capacity, charBudget: f.charBudget, labelChars: f.labelChars, rowPx: Math.round(f.rowPx), availPx: Math.round(f.availPx) };
}

function fitLineOf(res, ctx) {
  const menusLib = require('./menus');
  const k = res.knobsAfter;
  const f = res.fitAfter;
  if (k.placement === 'side') return `מסילת צד: ${res.mainItems.length} פריטים (נראים ~${f.sideFits}) ✓`;
  if (k.flow === 'drawer') return 'מגירה: התפריט נפתח מכפתור בכל רוחב ✓';
  if (k.flow === 'scroll') return `רצועת גלילה: ${px(f.rowPx)}px בגלילה אופקית ✓`;
  if (f.rowsNow === 1) return `שורה אחת: ${px(f.rowPx)}px מתוך ${px(f.availPx)}px ✓`;
  if (k.fold >= 2 && res.mainItems.length > k.fold) {
    const folded = res.mainItems.slice(0, k.fold).concat([{ label: 'עוד', children: [{}] }]);
    const ff = menusLib.estimateMenuFit(folded, res.overrides, ctx.config);
    return ff.rowsNow === 1 ? `קיפול אחרי ${k.fold} פריטים ("עוד"): ${px(ff.rowPx)}px מתוך ${px(ff.availPx)}px ✓` : `⚠ גם עם קיפול אחרי ${k.fold}: ${px(ff.rowPx)}px — יגלוש; קיצור/קיבוץ מומלץ`;
  }
  return `⚠ ${px(f.rowPx)}px — יגלוש; קיצור/קיבוץ מומלץ`;
}

/** The candidate menus on the real header — registered for GET /admin/menus/preview/:id. */
function registerMenuPreview({ menus, overrides } = {}) {
  const id = 'mp_' + crypto.randomBytes(6).toString('hex');
  PREVIEWS.set(id, { menus: menus || {}, overrides: overrides || null, at: Date.now() });
  while (PREVIEWS.size > PREVIEW_CAP) PREVIEWS.delete(PREVIEWS.keys().next().value);
  return id;
}

function getMenuPreview(id) {
  return PREVIEWS.get(String(id || '')) || null;
}

function buildMenuPreview(plan, ctx = siteStateForMenus(), resolved) {
  const menusLib = require('./menus');
  const res = resolved || resolvePlan(plan, ctx);
  const pages = ctx.pages || [];
  const byPath = {};
  for (const p of pages) byPath[p.full_path] = p;

  const node = (it) => {
    const isGroup = it.type === 'custom' && (it.url === '#' || !it.url);
    let status = 'ok';
    if (isGroup) status = 'group';
    else if (it.type === 'page') { const p = byPath[cleanPath(it.target)]; status = p ? (isPublished(p) ? 'ok' : 'draft') : 'dropped'; }
    return { label: it.label, url: menusLib.resolveUrl(it.type, it.target, it.url), type: it.type, status, children: (it.children || []).map(node) };
  };

  const menus = {};
  const diff = {};
  for (const name of Object.keys((plan && plan.menus) || {})) {
    const items = res.menus[name] || [];
    const tree = items.map(node);
    for (const d of (plan.dropped || []).filter((x) => x.menu === name)) tree.push({ label: d.label, url: '', type: 'dropped', status: 'dropped', children: [] });
    const location = plan.menus[name].location || ['main', 'footer'].find((l) => (res.locations || {})[l] === name) || '';
    menus[name] = { location, tree };
    diff[name] = diffMenus((ctx.menus || {})[name] || [], items);
  }
  const changed = KNOB_KEYS.filter((key) => res.knobsBefore[key] !== res.knobsAfter[key]).map((key) => ({ key, from: res.knobsBefore[key], to: res.knobsAfter[key] }));
  // the renderer's options.menus is keyed by LOCATION (main/footer), not by
  // menu name: a `<bent-menu name="primary" location="main">` must show in
  // the frame's main slot — resolved after the plan's location changes
  const loc = res.locations || {};
  const id = registerMenuPreview({
    menus: { main: res.menus[loc.main || 'main'] || [], footer: res.menus[loc.footer || 'footer'] || [] },
    overrides: res.overrides
  });
  return {
    note: (plan && plan.note) || '',
    menus,
    diff,
    knobs: { changed },
    fit: { before: pickFit(res.fitBefore), after: pickFit(res.fitAfter) },
    fitLine: fitLineOf(res, ctx),
    previewUrl: '/admin/menus/preview/' + id
  };
}

/**
 * The menus as they ARE, in the preview's own shape (v2.43). The copilot's
 * canvas shows today's menu the way it shows a proposal — the same tree, the
 * same fit line, the same real header in a frame — so the owner compares like
 * with like. It is the identity plan (every menu, no knob touched) through
 * buildMenuPreview: the diff comes back empty and the fit's before === after,
 * which is the point. Never writes; registers one preview entry.
 */
function currentMenuPreview(ctx = siteStateForMenus()) {
  const plan = { menus: {}, knobs: {}, note: '', dropped: [] };
  // The HEADER's menu first, the footer's second, the rest after (seen live
  // while building this: a seeded `explore` menu sorted ahead of `main`, and
  // the one menu the owner came to look at was the one cut off below).
  const loc = ctx.locations || {};
  const lead = [loc.main || 'main', loc.footer || 'footer'];
  const names = Object.keys(ctx.menus || {});
  const ordered = lead.filter((n) => names.includes(n)).concat(names.filter((n) => !lead.includes(n)).sort());
  for (const name of ordered) plan.menus[name] = { items: ctx.menus[name] || [] };
  return buildMenuPreview(plan, ctx);
}

// ── apply / undo ─────────────────────────────────────────────────────

/**
 * Write the plan: backup → menus (ids kept for unchanged links) → locations
 * → the layout knobs merged over the live overrides → rebuild the export.
 */
function applyMenuPlan(plan, opts = {}) {
  const theme = require('./theme');
  const menusLib = require('./menus');
  const force = !!opts.force;
  const reason = String(opts.reason || 'inject:menu-organizer');
  if (!plan || typeof plan !== 'object') throw Object.assign(new Error('אין תוכנית להחלה'), { code: 'NO_PLAN' });
  if (plan.hard && !force) {
    const e = new Error('יש אזהרות קשות — אשרו החלה בכוח או תקנו את המסמך');
    e.code = 'HARD_WARNINGS';
    e.warnings = plan.warnings || [];
    throw e;
  }
  const current = menusLib.loadMenus();
  const backup = menusLib.backupMenus(reason);
  const changed = { menus: [], locations: [], knobs: [] };

  const toSave = {};
  for (const name of Object.keys(plan.menus || {})) {
    toSave[name] = menusLib.withStableIds(plan.menus[name].items || [], current[name] || []);
    changed.menus.push(name);
  }
  if (changed.menus.length) menusLib.saveMenus(toSave);

  const locMap = {};
  for (const name of Object.keys(plan.menus || {})) {
    const loc = plan.menus[name].location;
    if (loc && ['main', 'footer'].includes(loc)) { locMap[loc] = name; changed.locations.push(loc); }
  }
  if (changed.locations.length) menusLib.setMenuLocations(locMap);

  const knobs = plan.knobs || {};
  if (Object.keys(knobs).length) {
    const frag = theme.knobsToOverrides(knobs).overrides;
    theme.saveOverrides(theme.mergeDeep(theme.loadOverrides(), frag));
    changed.knobs = Object.keys(knobs);
  }

  const rebuildError = require('./rebuild').rebuildSite(reason);
  return { applied: true, backupId: backup.id, changed, rebuildError, warnings: plan.warnings || [] };
}

/** Put back the newest snapshot (the one an apply took). */
function undoLast() {
  const menusLib = require('./menus');
  const list = menusLib.listMenuBackups();
  if (!list.length) { const e = new Error('אין גיבוי לשחזר'); e.code = 'NO_BACKUP'; throw e; }
  const id = list[0].id;
  menusLib.restoreMenuBackup(id);
  const rebuildError = require('./rebuild').rebuildSite('menu-organizer undo');
  return { restored: id, rebuildError };
}

module.exports = {
  siteStateForMenus,
  ctxFromFixture,
  buildMenuPrompt,
  parseMenuReply,
  buildMenuPreview,
  currentMenuPreview,
  applyMenuPlan,
  undoLast,
  registerMenuPreview,
  getMenuPreview,
  // what the copilot reuses instead of forking (v2.43): the grammar lines the
  // briefing teaches, and the table + capacity sentence read_menus returns
  menuGrammar,
  capacitySentence,
  pageTable,
  REPAIRABLE,
  HARD,
  LAYOUT_ASK_RE,
  MAX_REPLY_CHARS,
  // the dialect, re-exported
  serializeMenus,
  parseMenusDoc,
  isMenuBent
};
