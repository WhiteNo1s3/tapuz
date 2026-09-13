'use strict';

/**
 * v2.28 QA — the Menu Organizer (Ben: "the menu breaks from the amount of
 * content … an organizer injection … 99.9% effectiveness"). This pins the
 * whole path from a chat's reply to the live menus without a model:
 *   • the CAPACITY rule on the live-10 fixture (the real ten-item site):
 *     capacity ∈ [7,9], rowsNow === 2, availPx ∈ [760,830], deterministic
 *   • the menu dialect: a deterministic serializer that round-trips
 *   • the DRIFT MATRIX — every canned reply under test/fixtures/inject/
 *     menu-organizer/replies/ against its .expect.json sidecar (bare, fenced,
 *     prose, curly quotes, aliases, JSON, unclosed, grandchildren, refusals…)
 *   • the PROMPT: the FRESH first line is the theme prompt's, the role line,
 *     the capacity number inside the pack, the size budgets (lite ≤ 9000 on
 *     30 pages, full ≤ 14000 on 80), articles collapsed, rule 2 verbatim,
 *     the brief embedded, variant B repeating the ladder after the rules
 *   • APPLY in a throwaway TAPUZ_ROOT: a backup file, the menus saved with
 *     ids kept for unchanged links, the knobs merged, undo restoring it all;
 *     HARD_WARNINGS without force; NO_CHANGE on an echo; the depth cap
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-menu-organizer-'));

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

require('../src/db');
const org = require('../src/menu-organizer');
const menusLib = require('../src/menus');
const theme = require('../src/theme');
const dialect = require('../src/bentml/menu-dialect');

const FIX = path.join(__dirname, '..', 'test', 'fixtures', 'inject', 'menu-organizer');
const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name + '.json'), 'utf8'));
const live10 = org.ctxFromFixture(loadFixture('live-10'));

// ── capacity ──────────────────────────────────────────────────────────
const fit = live10.fit;
check(`capacity on live-10 is 7..9 (got ${fit.capacity})`, fit.capacity >= 7 && fit.capacity <= 9);
check(`the ten live labels take two rows today (rowsNow ${fit.rowsNow})`, fit.rowsNow === 2);
check(`the free row is ~796px (availPx ${Math.round(fit.availPx)})`, fit.availPx >= 760 && fit.availPx <= 830);
check('the estimate is deterministic (same input, same numbers)',
  JSON.stringify(menusLib.estimateMenuFit(live10.menus.main, live10.overrides, live10.config)) === JSON.stringify(fit));
check('a side rail / scroll strip / drawer always fits',
  menusLib.estimateMenuFit(live10.menus.main, theme.mergeDeep(live10.overrides, { layout: { menuPlacement: 'side' } }), live10.config).fits === true &&
  menusLib.estimateMenuFit(live10.menus.main, theme.mergeDeep(live10.overrides, { chrome: { menuOverflow: 'scroll' } }), live10.config).mode === 'scroll');
check('an emoji is wider than a letter and a parent carries the caret',
  menusLib.estimateMenuFit([{ label: '🍊' }], {}, {}).itemsPx[0] > menusLib.estimateMenuFit([{ label: 'a' }], {}, {}).itemsPx[0] &&
  menusLib.estimateMenuFit([{ label: 'a', children: [{ label: 'b' }] }], {}, {}).itemsPx[0] > menusLib.estimateMenuFit([{ label: 'a' }], {}, {}).itemsPx[0]);

// ── the dialect ───────────────────────────────────────────────────────
const messy = 'הנה:\n```html\n<bent-menus version="1" note="n">\n<bent-menu-layout fold="6" placement="top"/>\n<bent-menu name="footer" location="footer"><bent-item title="תנאים" slug="/terms.html"/></bent-menu>\n<bent-menu name="main" location="main">\n  <bent-link label="הבית" page="home" />\n  <bent-link label="שירותים" page="services"><bent-link label="עיצוב" page="services/design"><bent-link label="נכד" page="x"/></bent-link></bent-link>\n  <bent-link label="קבוצה"><bent-link label="א" url="https://x.co"/></bent-link>\n  <bent-link label="חייגו" tel="+972501234567" />\n</bent-menu>\n</bent-menus>\n```';
const once = org.serializeMenus(org.parseMenusDoc(messy));
const twice = org.serializeMenus(org.parseMenusDoc(once));
check('serializeMenus(parseMenusDoc(x)) is a fixed point (round trip)', once === twice);
check('serialization is deterministic: layout first, main before footer, label before the target',
  /^<bent-menus version="1" note="n">\n  <bent-menu-layout placement="top" fold="6" \/>\n  <bent-menu name="main" location="main">/.test(once) &&
  once.indexOf('name="main"') < once.indexOf('name="footer"') && /<bent-link label="תנאים" page="terms" \/>/.test(once));
check('a grandchild is lifted after its parent, a group has no target attribute',
  /<bent-link label="שירותים" page="services">\n      <bent-link label="עיצוב" page="services\/design" \/>\n      <bent-link label="נכד" page="x" \/>\n    <\/bent-link>/.test(once) && /<bent-link label="קבוצה">\n      <bent-link label="א" url="https:\/\/x.co" \/>/.test(once));
check('isMenuBent sees a menu document or a JSON reply, not a theme', dialect.isMenuBent(messy) && dialect.isMenuBent('[{"label":"a","page":"home"}]') && !dialect.isMenuBent('<bent-theme name="x"></bent-theme>'));

// ── the drift matrix ──────────────────────────────────────────────────
const REPLIES = path.join(FIX, 'replies');
const files = fs.readdirSync(REPLIES).filter((f) => f.endsWith('.txt')).sort();
check(`the drift matrix has at least 30 canned replies (${files.length})`, files.length >= 30);
const ctxCache = { 'live-10': live10 };
const ctxFor = (name) => (ctxCache[name] = ctxCache[name] || org.ctxFromFixture(loadFixture(name)));
function itemsMatch(expected, actual, problems, where) {
  (expected || []).forEach((e, i) => {
    const a = (actual || [])[i];
    if (!a) { problems.push(`${where}[${i}] missing`); return; }
    for (const k of ['label', 'type', 'target', 'url']) if (e[k] !== undefined && a[k] !== e[k]) problems.push(`${where}[${i}].${k} "${a[k]}" ≠ "${e[k]}"`);
    if (e.children) itemsMatch(e.children, a.children, problems, `${where}[${i}].children`);
  });
}
for (const f of files) {
  const name = f.replace(/\.txt$/, '');
  const text = fs.readFileSync(path.join(REPLIES, f), 'utf8');
  const expect = JSON.parse(fs.readFileSync(path.join(REPLIES, name + '.expect.json'), 'utf8'));
  const ctx = ctxFor(expect.fixture || 'live-10');
  const brief = expect.brief !== undefined ? expect.brief : (ctx.brief || '');
  let r = null;
  let err = null;
  try { r = org.parseMenuReply(text, ctx, { brief }); } catch (e) { err = e; }
  if (expect.refusal) {
    check(`reply ${name} → refused ${expect.refusal}${err && err.code !== expect.refusal ? ` (got ${err.code || err.message})` : ''}`, !!err && err.code === expect.refusal);
    continue;
  }
  const problems = [];
  if (err) problems.push(`refused ${err.code || ''}: ${err.message}`);
  else {
    const codes = r.warnings.map((w) => w.code);
    for (const c of expect.warningCodes || []) if (!codes.includes(c)) problems.push(`missing warning ${c}`);
    for (const c of expect.absentCodes || []) if (codes.includes(c)) problems.push(`unexpected warning ${c}`);
    for (const n of expect.notes || []) if (!r.notes.includes(n)) problems.push(`missing note ${n}`);
    if (expect.hard !== undefined && r.hard !== expect.hard) problems.push(`hard ${r.hard} ≠ ${expect.hard}`);
    const menu = expect.menu || 'main';
    const items = (r.plan.menus[menu] || {}).items || [];
    if (expect.itemCount !== undefined && items.length !== expect.itemCount) problems.push(`${menu} has ${items.length} top items ≠ ${expect.itemCount}`);
    if (expect.items) itemsMatch(expect.items, items, problems, menu);
    if (expect.knobs) {
      for (const k of Object.keys(expect.knobs)) if (r.plan.knobs[k] !== expect.knobs[k]) problems.push(`knob ${k} ${JSON.stringify(r.plan.knobs[k])} ≠ ${JSON.stringify(expect.knobs[k])}`);
      if (!Object.keys(expect.knobs).length && Object.keys(r.plan.knobs).length) problems.push(`knobs expected empty, got ${JSON.stringify(r.plan.knobs)}`);
    }
    if (expect.menuLocations) for (const m of Object.keys(expect.menuLocations)) if (!r.plan.menus[m] || r.plan.menus[m].location !== expect.menuLocations[m]) problems.push(`menu ${m} location ≠ ${expect.menuLocations[m]}`);
    if (r.warnings.some((w) => !w.code || !w.message)) problems.push('a warning without code/message');
    if (r.warningTexts.length !== r.warnings.length) problems.push('warningTexts out of step');
    if (!r.preview || !/^\/admin\/menus\/preview\/mp_/.test(r.preview.previewUrl)) problems.push('no previewUrl');
    if (!r.preview.fit || !r.preview.fit.after || typeof r.preview.fit.after.rowsNow !== 'number') problems.push('preview.fit.after missing');
    if (typeof r.preview.fitLine !== 'string' || !r.preview.fitLine) problems.push('no fitLine');
    if (!Array.isArray(r.plan.items)) problems.push('plan.items missing');
  }
  check(`reply ${name}: ${problems.length ? problems.join('; ') : 'as expected'}`, !problems.length);
}

// ── the review fixes: the url gate, the size gate, preview keying, ranking ──
{
  const readReply = (re) => fs.readFileSync(path.join(REPLIES, files.find((f) => re.test(f))), 'utf8');
  const urlsOf = (plan) => { const out = []; const walk = (items) => (items || []).forEach((it) => { out.push(String(it.url || '')); walk(it.children); }); Object.values(plan.menus).forEach((m) => walk(m.items)); return out; };
  // ten good page links around the probe keep the unknown share under 30% (one bad link of eleven)
  const tenGood = live10.pages.map((p) => `<bent-link label="${p.title}" page="${p.full_path}" />`).join('');
  const wrap = (links) => `<bent-menus version="1"><bent-menu name="main" location="main">${tenGood}${links}</bent-menu></bent-menus>`;

  // 1. UNSAFE_URL: a scheme split by tab / LF / CR is a live javascript: link once a browser strips them
  const pageLinks = live10.pages.map((p) => ({ label: p.title, page: p.full_path })); // ten good links keep the unknown share under 30%
  const viaJson = org.parseMenuReply(JSON.stringify(pageLinks.concat([{ label: 'x', url: 'java\nscript:alert(1)' }, { label: 'y', url: 'vb\rscript:msgbox' }])), live10, { brief: '' });
  check('a LF/CR inside the scheme (JSON reply) is UNSAFE_URL, hard, and no `script:` url survives in the plan',
    viaJson.hard && viaJson.warnings.filter((w) => w.code === 'UNSAFE_URL').length === 2 && urlsOf(viaJson.plan).every((u) => !/script/i.test(u)));
  for (const [what, sep] of [['tab', '\t'], ['LF', '\n'], ['CR', '\r'], ['CRLF', '\r\n'], ['NUL', String.fromCharCode(0)], ['RLM', String.fromCharCode(0x200F)]]) {
    const r = org.parseMenuReply(wrap(`<bent-link label="הפתעה" url="java${sep}script:alert(1)" />`), live10, { brief: '' });
    check(`a document url with ${what} inside "javascript:" never reaches the plan`, urlsOf(r.plan).every((u) => !/script/i.test(u)) && r.plan.menus.main.items.some((i) => i.target === 'home'));
  }
  const allow = ['https://x.co/a b', 'HTTP://x.co', '//cdn.x.co/y', '/about.html', '#top', './rel', '../up', 'mailto:hi@x.co', 'tel:+972501234567', 'bare-path/sub?x=1:2', 'מדריך/עברי'];
  const refuse = ['javascript:alert(1)', 'JavaScript :alert(1)', 'data:text/html,hi', 'vbscript:x', 'ftp://x.co', 'file:///etc/passwd', 'blob:https://x.co/1', 'foo:bar', '?q=1'];
  const kept = allow.map((u) => org.parseMenuReply(wrap(`<bent-link label="ק" url="${u}" />`), live10, { brief: '' })).map((r) => !r.warnings.some((w) => w.code === 'UNSAFE_URL') && r.plan.menus.main.items.length === 11);
  const gone = refuse.map((u) => org.parseMenuReply(wrap(`<bent-link label="ק" url="${u}" />`), live10, { brief: '' })).map((r) => r.hard && r.warnings.some((w) => w.code === 'UNSAFE_URL') && r.plan.menus.main.items.length === 10);
  check(`the url allowlist keeps https/http/protocol-relative/site/anchor/relative/mailto/tel/bare paths (${kept.filter(Boolean).length}/${allow.length})`, kept.every(Boolean));
  check(`… and refuses every other scheme as UNSAFE_URL (${gone.filter(Boolean).length}/${refuse.length})`, gone.every(Boolean));

  // 3. the size gate and the linear tokenizer
  let tooLong = null;
  try { org.parseMenuReply(wrap('<bent-link label="x" url="/x" />') + ' '.repeat(70000), live10, { brief: '' }); } catch (e) { tooLong = e; }
  check(`a 70K reply is refused REPLY_TOO_LONG with a Hebrew message (max ${org.MAX_REPLY_CHARS})`, !!tooLong && tooLong.code === 'REPLY_TOO_LONG' && /ארוכה מדי/.test(tooLong.message) && org.MAX_REPLY_CHARS === 60000);
  const t0 = process.hrtime.bigint();
  const hostile = dialect.parseMenusDoc('<a "'.repeat(30000));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  check(`120 KB of \`<a "\` parses in under 300 ms (${ms.toFixed(1)} ms, no menu found)`, ms < 300 && Object.keys(hostile.menus).length === 0);
  const t1 = process.hrtime.bigint();
  dialect.parseMenusDoc('<a "'.repeat(250000) + '<bent-menus>'.repeat(40000) + '<b'.repeat(200000));
  const ms1 = Number(process.hrtime.bigint() - t1) / 1e6;
  check(`1.8 MB of hostile paste stays linear (${ms1.toFixed(0)} ms < 2000)`, ms1 < 2000);
  check('a quoted `>` still lives inside a label; an unbalanced quote fails only its own tag',
    dialect.parseMenusDoc(wrap('<bent-link label="a>b" page="x" />')).menus.main.items[10].label === 'a>b' &&
    dialect.parseMenusDoc('<bent-menu name="main"><bent-link label="x page="home" />\n<bent-link label="y" page="about" /></bent-menu>').menus.main.items.map((i) => i.label).join(',') === 'y');

  // 2. the preview store is keyed by LOCATION (the renderer's options.menus / GET /admin/menus/preview/:id)
  const reloc = org.ctxFromFixture(loadFixture('relocated-main'));
  check('relocated-main fixture: the header shows "primary", not "main"', reloc.locations.main === 'primary' && reloc.menus.primary.length === 4);
  const idOfPreview = (r) => r.preview.previewUrl.replace('/admin/menus/preview/', '');
  const rr = org.parseMenuReply(fs.readFileSync(path.join(REPLIES, '55-relocated-main.txt'), 'utf8'), reloc, { brief: '' });
  const entry = org.getMenuPreview(idOfPreview(rr));
  check('a candidate `<bent-menu name="primary" location="main">` fills the frame\'s MAIN slot with the candidate, not the stale "main" menu',
    !!entry && entry.menus.main.map((i) => i.label).join(',') === 'ראשי,שירותים' && Array.isArray(entry.menus.footer) && entry.menus.footer.length === 0 && Object.keys(entry.menus).sort().join(',') === 'footer,main');
  const other = org.parseMenuReply('<bent-menus version="1"><bent-menu name="footer" location="footer"><bent-link label="הבית" page="home" /></bent-menu></bent-menus>', reloc, { brief: '' });
  const e2 = org.getMenuPreview(idOfPreview(other));
  check('a reply that leaves the header alone previews the header\'s ASSIGNED menu (primary) in the main slot',
    !!e2 && e2.menus.main.map((i) => i.label).join(',') === 'הבית,אודות,שירותים,צור קשר' && e2.menus.footer.map((i) => i.label).join(',') === 'הבית');

  // 4. an echoed prompt: the site's own current-state document outranks the fictional worked example
  const echoedPrompt = org.parseMenuReply(org.buildMenuPrompt({ brief: '', size: 'lite', ctx: live10 }).text, live10, { brief: '' });
  check('the whole lite prompt pasted back → NO_CHANGE (the current-state document wins), no refusal, nothing hard',
    echoedPrompt.warnings.some((w) => w.code === 'NO_CHANGE') && !echoedPrompt.hard && !echoedPrompt.warnings.some((w) => w.code === 'UNKNOWN_PAGE') && echoedPrompt.plan.menus.main.items.length === 10);
  const exampleFirst = EXAMPLE_LIKE() + '\n\n' + org.serializeMenus({ menus: live10.menus, locations: live10.locations });
  check('ranking is site-aware even when the richer fictional document comes first', org.parseMenuReply(exampleFirst, live10, { brief: '' }).plan.menus.main.items.length === 10);
  function EXAMPLE_LIKE() { return '<bent-menus version="1"><bent-menu name="main" location="main">' + Array.from({ length: 13 }, (_, i) => `<bent-link label="פיקטיבי ${i}" page="fake/${i}" />`).join('') + '</bent-menu></bent-menus>'; }

  // 8. LAYOUT_ASK_RE anchors Hebrew terms as words
  const sideReply = readReply(/side-unasked/);
  const asks = (brief) => !org.parseMenuReply(sideReply, live10, { brief }).warnings.some((w) => w.code === 'LAYOUT_UNASKED');
  check('brief "מצד שני, קצרו את התוויות" + a placement flip → LAYOUT_UNASKED fires (צד inside a word is not an ask)', !asks('מצד שני, קצרו את התוויות') && !asks('הצדקה לשינוי אין') && !asks('consider the labels'));
  check('brief "תפריט צד בבקשה" / "במסילת צד" / "sidebar" → no LAYOUT_UNASKED', asks('תפריט צד בבקשה') && asks('שימו את התפריט במסילת צד') && asks('make it a sidebar please') && asks('בצד ימין') && org.LAYOUT_ASK_RE.test('לפריסה אנכית'));

  // 10 / 13. messages the model or the owner reads
  const draftFile = files.find((f) => /draft-page-linked/.test(f));
  const draftExpect = JSON.parse(fs.readFileSync(path.join(REPLIES, draftFile.replace(/\.txt$/, '.expect.json')), 'utf8'));
  const draft = org.parseMenuReply(fs.readFileSync(path.join(REPLIES, draftFile), 'utf8'), ctxFor(draftExpect.fixture || 'live-10'), { brief: draftExpect.brief || '' });
  check('DRAFT_LINKED is honest: the link 404s until the page is published', draft.warnings.some((w) => w.code === 'DRAFT_LINKED' && /404/.test(w.message) && /עד שהדף יפורסם/.test(w.message)));
  const fifteen = org.parseMenuReply(readReply(/fifteen-top-items/), live10, { brief: '' });
  const overflow = fifteen.warnings.find((w) => w.code === 'OVERFLOW_LIKELY');
  const foldFix = Math.max(2, fifteen.preview.fit.after.capacity - 1);
  check(`OVERFLOW_LIKELY names the fix with the candidate's computed number: <bent-menu-layout fold="${foldFix}" />`,
    !!overflow && overflow.message.includes(`פתרון: קצרו תוויות, קבצו תחת הורה, או הוסיפו <bent-menu-layout fold="${foldFix}" />`));
  const parentToGroup = org.parseMenuReply(readReply(/parent-repeats-child/), live10, { brief: '' }).warnings.find((w) => w.code === 'PARENT_TO_GROUP');
  check('EMPTY_GROUP is soft and repairable; PARENT_TO_GROUP names the parent in Hebrew', org.REPAIRABLE.includes('EMPTY_GROUP') && !org.HARD.includes('EMPTY_GROUP') &&
    !!parentToGroup && parentToGroup.message === 'ההורה "פלטפורמה" הפך לקבוצה — הדף נשאר כפריט משנה');
}

// ── the preview object ────────────────────────────────────────────────
{
  const good = fs.readFileSync(path.join(REPLIES, files.find((f) => /bare-document/.test(f))), 'utf8');
  const r = org.parseMenuReply(good, live10, { brief: '' });
  const p = r.preview;
  const statuses = [];
  const walk = (t) => t.forEach((n) => { statuses.push(n.status); walk(n.children || []); });
  walk(p.menus.main.tree);
  check('preview tree: groups are "group", pages are "ok", every node has a url', statuses.includes('group') && statuses.includes('ok') && p.menus.main.tree.every((n) => typeof n.url === 'string'));
  check('preview diff by type+target: the seven-item regroup relabels 🍊 הבית and moves the grouped pages',
    p.diff.main.relabeled.some((x) => x[0] === '🍊 הבית' && x[1] === 'הבית') && p.diff.main.moved.length > 0 && p.diff.main.removed.length === 0);
  check('preview fit before/after: two rows → one row, with the fitLine ✓', p.fit.before.rowsNow === 2 && p.fit.after.rowsNow === 1 && /^שורה אחת: [\d,]+px מתוך [\d,]+px ✓$/.test(p.fitLine));
  const bad = org.parseMenuReply(fs.readFileSync(path.join(REPLIES, files.find((f) => /fifteen-top-items/.test(f))), 'utf8'), live10, { brief: '' });
  check('an overflowing candidate gets the ⚠ fitLine', /^⚠ [\d,]+px — יגלוש; קיצור\/קיבוץ מומלץ$/.test(bad.preview.fitLine));
  const knobbed = org.parseMenuReply(good.replace('<bent-menus version="1"', '<bent-menus version="1"').replace('<bent-menu name="main"', '<bent-menu-layout fold="6" width="full" />\n  <bent-menu name="main"'), live10, { brief: '' });
  check('preview knobs diff lists what changed (fold, width) with from/to',
    knobbed.preview.knobs.changed.some((c) => c.key === 'fold' && c.from === 0 && c.to === 6) && knobbed.preview.knobs.changed.some((c) => c.key === 'width' && c.from === 'wide' && c.to === 'full'));
  check('registerMenuPreview keeps the candidate for the preview route and caps the store', (() => {
    const id = org.registerMenuPreview({ menus: { main: [] }, overrides: {} });
    const entry = org.getMenuPreview(id);
    for (let i = 0; i < 45; i++) org.registerMenuPreview({ menus: {}, overrides: {} });
    return !!entry && !org.getMenuPreview(id);
  })());
}

// ── the prompt ────────────────────────────────────────────────────────
const themeFirst = require('../src/theme-roleplay').buildThemePrompt({}).text.split('\n')[0];
const lite = org.buildMenuPrompt({ brief: '', size: 'lite', ctx: live10 });
check('the FRESH first line is byte-identical to the theme prompt\'s first line', lite.text.split('\n')[0] === themeFirst && /FRESH/.test(themeFirst));
check('the role line', lite.text.includes('# 🧭 משחק: מסדר/ת התפריטים של תפוזיאל (Menu Organizer Roleplay)'));
check('the ten sections come in the contract order', (() => {
  const marks = ['# 🧭 משחק', '## מה זה **לא**', '## טבלת הדפים', '## התפריטים היום', '## הדקדוק', '## כלל הקיבולת (חשבנו בשבילך)', '## חוקים קשיחים', '## מבנה התשובה', '## דוגמה מלאה', '## המשחק מתחיל עכשיו'];
  const idx = marks.map((m) => lite.text.indexOf(m));
  return idx.every((i, k) => i >= 0 && (k === 0 || i > idx[k - 1]));
})());
check(`the capacity block carries the number (${lite.meta.capacity}) and the char budget (${lite.meta.charBudget})`,
  lite.text.includes(`בשורה אחת נכנסים עד ${lite.meta.capacity} פריטים עליונים ועד ${lite.meta.charBudget} תווים`) && typeof lite.meta.capacity === 'number' && lite.meta.rowsNow === 2);
check('the ladder ends in placement/flow ONLY when the brief asks, and rule 10 repeats the numbers',
  lite.text.includes('**רק כשהבקשה של השחקן מבקשת זאת**') && lite.text.includes(`10. שורה עליונה עם יותר מ-${lite.meta.capacity} פריטים או ${lite.meta.charBudget} תווים בלי \`fold\``));
check('rule 2 — page="…" only from the table, copied verbatim', lite.text.includes('2. `page="…"` רק מהטבלה, מועתק מילה במילה'));
{
  // 12 / 14b. the mechanism is explicit: a model wrote "הוספתי fold=9" in its note and never emitted the tag
  const ladder = lite.text.slice(lite.text.indexOf('סולם ההחלטה'), lite.text.indexOf('## חוקים קשיחים'));
  const fold = Math.max(2, lite.meta.capacity - 1);
  check(`ladder step 4 spells out the tag line: <bent-menu-layout fold="${fold}" /> at the top of the document`,
    ladder.includes(`4. עדיין גולש → הוסיפו בראש המסמך את השורה \`<bent-menu-layout fold="${fold}" />\``) && ladder.includes('<bent-menu-layout fold="'));
  check('hard rule 10 says the fold is that tag line, not a sentence in the note', new RegExp(`10\\. [^\\n]*הקיפול הוא שורת התג \`<bent-menu-layout fold="${fold}" />\` בראש המסמך, לא משפט ב-\`note\``).test(lite.text));
  check('hard rule 4 forbids the same page as parent AND child', /4\. [^\n]*הורה שמקבץ דפים ואין לו דף משלו — בלי מאפיין יעד; אל תחזרו על אותו דף גם כהורה וגם כילד/.test(lite.text));
}
check('the current menus are embedded as the site\'s own serialized document', lite.text.includes('<bent-link label="🍊 הבית" page="home" />') && lite.text.includes('<bent-menu-layout placement="top" flow="wrap" fold="0"'));
check('the worked example is one ```html fence with the fictional nine-page site', /```html\n<bent-menus version="1" note="שירותים קובצו[\s\S]*?<\/bent-menus>\n```/.test(lite.text) && lite.text.includes('page="blog/rtl-guide"'));
check('no brief → "the game starts now"', lite.text.includes('המשחק מתחיל עכשיו — סדרו את התפריט הנוכחי כך שייכנס בשורה ויהיה ברור לגולש.') && !lite.text.includes('## המשימה של השחקן'));
const briefed = org.buildMenuPrompt({ brief: 'הדגש את יצירת הקשר ותקצר תוויות', ctx: live10 });
check('a brief is embedded under "the player\'s task" and closes with "the document only"',
  briefed.text.includes('## המשימה של השחקן') && briefed.text.includes('הדגש את יצירת הקשר ותקצר תוויות') && briefed.text.includes('התשובה: המסמך בלבד') && !briefed.text.includes('## המשחק מתחיל עכשיו'));
const b = org.buildMenuPrompt({ brief: '', variant: 'B', ctx: live10 });
check('variant B repeats the ladder after the rules; A states it once',
  (lite.text.match(/סולם ההחלטה/g) || []).length === 1 && (b.text.match(/סולם ההחלטה/g) || []).length === 2 && b.text.lastIndexOf('סולם ההחלטה') > b.text.indexOf('## חוקים קשיחים') && b.meta.variant === 'B');
check('meta carries capacity/charBudget/rowsNow/pages/items/size/variant', ['capacity', 'charBudget', 'rowsNow', 'pages', 'items', 'size', 'variant'].every((k) => lite.meta[k] !== undefined) && lite.meta.pages === 10 && lite.meta.items === 10);

// budgets on synthetic sites
const synth = (n, articles) => {
  const pages = [];
  for (let i = 1; i <= n; i++) pages.push({ full_path: 'section-' + i + '/page-' + i, title: 'עמוד ארוך במיוחד מספר ' + i, status: 'published', tags: [] });
  for (let i = 1; i <= (articles || 0); i++) pages.push({ full_path: 'blog/post-' + i, title: 'מאמר ' + i, status: 'published', tags: ['article'] });
  pages.push({ full_path: 'blog', title: 'הבלוג', status: 'published', tags: [] });
  pages.push({ full_path: 'draft-1', title: 'טיוטה', status: 'draft', tags: [] });
  const main = pages.slice(0, 12).map((p) => ({ label: p.title, type: 'page', target: p.full_path }));
  return org.ctxFromFixture({ config: { title: 'אתר בדיקה גדול', description: 'תיאור ארוך למדי של אתר עם הרבה מאוד דפים ומאמרים', logo: { type: 'text', text: 'אתר בדיקה' }, header: { ctaLabel: 'הצטרפו', tagline: '' } }, overrides: {}, pages, menus: { main, footer: [] } });
};
const lite30 = org.buildMenuPrompt({ brief: 'x'.repeat(200), size: 'lite', ctx: synth(30, 5) });
check(`lite pack ≤ 9000 chars on a 30-page site (${lite30.chars})`, lite30.chars <= 9000 && lite30.meta.pages === 30);
const full80 = org.buildMenuPrompt({ brief: 'x'.repeat(200), size: 'full', ctx: synth(80, 10) });
check(`full pack ≤ 14000 chars on an 80-page site (${full80.chars})`, full80.chars <= 14000 && full80.meta.pages === 80);
const lite80 = org.buildMenuPrompt({ brief: '', size: 'lite', ctx: synth(80, 0) });
check('lite caps the table at 30 rows and says how many were left out', lite80.meta.pages === 30 && lite80.text.includes('ועוד 51 דפים מפורסמים שלא נכנסו לטבלה'));
// 9. the budget is ENFORCED: the worst case — 30 pages with 35-char titles, 20 top items, a 1,500-char brief
{
  const worst = (() => {
    const pages = [];
    for (let i = 1; i <= 30; i++) pages.push({ full_path: 'section-' + i + '/page-' + i, title: ('כותרת ארוכה מאוד לדף מספר ' + i).padEnd(35, 'א').slice(0, 35), status: 'published', tags: [] });
    pages.push({ full_path: 'blog/post-1', title: 'מאמר', status: 'published', tags: ['article'] });
    pages.push({ full_path: 'draft-1', title: 'טיוטה', status: 'draft', tags: [] });
    const main = pages.slice(0, 20).map((p) => ({ label: p.title, type: 'page', target: p.full_path }));
    return org.ctxFromFixture({ config: { title: 'אתר בדיקה גדול', description: 'תיאור ארוך למדי של אתר עם הרבה מאוד דפים ומאמרים', logo: { type: 'text', text: 'אתר בדיקה' }, header: { ctaLabel: 'הצטרפו', tagline: '' } }, overrides: {}, pages, menus: { main, footer: [] } });
  })();
  const raw = org.buildMenuPrompt({ brief: 'ב'.repeat(1700), size: 'lite', ctx: worst });
  const worstLite = raw;
  const worstFull = org.buildMenuPrompt({ brief: 'ב'.repeat(1500), size: 'full', ctx: worst });
  check(`lite ≤ 9000 on the worst case (${worstLite.chars}); degraded = ${JSON.stringify(worstLite.meta.degraded)}`,
    worstLite.chars <= 9000 && worstLite.meta.budget === 9000 && worstLite.meta.degraded.length > 0 && worstLite.meta.degraded[0] === 'brief:1500' && worstLite.meta.degraded.includes('menus:labels-only') && worstLite.text.includes('## התפריטים היום (תוויות בלבד)') && !worstLite.text.includes('<bent-link label="כותרת'));
  check(`rows go last and from the bottom: the trimmed table keeps the home row and says how many were left out (pages ${worstLite.meta.pages})`,
    worstLite.meta.pages >= 3 && worstLite.meta.pages < 30 && worstLite.text.includes(`ועוד ${30 - worstLite.meta.pages} דפים מפורסמים שלא נכנסו לטבלה`) && worstLite.text.includes('| section-1/page-1 |') && worstLite.meta.degraded.some((d) => /^rows:30→\d+$/.test(d)));
  check(`full ≤ 14000 on the same input (${worstFull.chars})`, worstFull.chars <= 14000 && worstFull.meta.budget === 14000);
  check('under budget nothing is degraded (live-10 lite) and meta says so', Array.isArray(lite.meta.degraded) && lite.meta.degraded.length === 0 && lite.meta.budget === 9000);
}
const blog = org.buildMenuPrompt({ brief: '', size: 'lite', ctx: org.ctxFromFixture(loadFixture('blog-30')) });
check('articles collapse into one line under their hub page; drafts into one line', blog.text.includes('18 מאמרים תחת `blog`') && !blog.text.includes('| blog/post-1 |') && blog.meta.pages === 12);
const drafts = org.buildMenuPrompt({ brief: '', size: 'lite', ctx: org.ctxFromFixture(loadFixture('drafts-mixed')) });
check('drafts collapse into "N טיוטות (לא בתפריט)" and never get a row', drafts.text.includes('4 טיוטות (לא בתפריט)') && !drafts.text.includes('| wholesale |'));
const en = org.buildMenuPrompt({ brief: '', ctx: org.ctxFromFixture(loadFixture('english-ltr')) });
check('an English fixture flips the language line and the FRESH note, keeps the same first line', en.text.split('\n')[0] === themeFirst && en.text.includes('**אנגלית, LTR**'));

// ── apply / undo against a real (throwaway) site ──────────────────────
const { runSetup } = require('../src/setup');
runSetup({ title: 'אתר בדיקה', description: 'organizer smoke', colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' }, menuPlacement: 'top', pages: ['home', 'about', 'contact'], menuPages: ['home', 'about', 'contact'], external: [] });
let ctx = org.siteStateForMenus();
check('siteStateForMenus reads the DB: pages, menus, locations, fit, homePath', ctx.pages.length >= 3 && Array.isArray(ctx.menus.main) && ctx.locations.main === 'main' && typeof ctx.fit.capacity === 'number' && ctx.homePath === 'home');
const before = menusLib.loadMenus();
const idOf = (items, target) => (items.find((it) => it.type === 'page' && it.target === target) || items.find((it) => /about/.test(it.url || '')) || {}).id;
const aboutIdBefore = idOf(before.main, 'about');
const echo = org.serializeMenus({ menus: ctx.menus, locations: ctx.locations });
const echoed = org.parseMenuReply(echo, ctx, { brief: 'רק סדר' });
check('an echo of the current state warns NO_CHANGE (the degenerate answer) and nothing hard', echoed.warnings.some((w) => w.code === 'NO_CHANGE') && !echoed.hard);

const hardReply = '<bent-menus version="1"><bent-menu name="main" location="main"><bent-link label="הבית" page="home"/><bent-link label="אודות" page="about"/><bent-link label="צור קשר" page="contact"/><bent-link label="מחירון" page="pricing"/></bent-menu></bent-menus>';
const hard = org.parseMenuReply(hardReply, ctx, { brief: '' });
check('an unknown page is a HARD warning, the link is dropped, the rest survive', hard.hard && hard.warnings.some((w) => w.code === 'UNKNOWN_PAGE') && hard.plan.menus.main.items.length === 3);
let thrown = null;
try { org.applyMenuPlan(hard.plan, { ctx }); } catch (e) { thrown = e; }
check('applyMenuPlan throws HARD_WARNINGS without force (and carries the warnings)', !!thrown && thrown.code === 'HARD_WARNINGS' && Array.isArray(thrown.warnings) && thrown.warnings.length > 0);
check('nothing was written by the refused apply', JSON.stringify(menusLib.loadMenus()) === JSON.stringify(before) && menusLib.listMenuBackups().length === 0);

const goodReply = [
  '<bent-menus version="1" note="הבית ראשון, יצירת קשר אחרונה, קיפול אחרי שלושה">',
  '  <bent-menu-layout fold="3" width="full" />',
  '  <bent-menu name="main" location="main">',
  '    <bent-link label="הבית" page="home" />',
  '    <bent-link label="צור קשר" page="contact" />',
  '    <bent-link label="אודות" page="about" />',
  '    <bent-link label="חייגו" tel="+972501234567" />',
  '  </bent-menu>',
  '</bent-menus>'
].join('\n');
const good = org.parseMenuReply(goodReply, ctx, { brief: '' });
check('a good reply: no hard warning, knobs = {fold:3, width:"full"}, plan.items mirrors main', !good.hard && good.plan.knobs.fold === 3 && good.plan.knobs.width === 'full' && good.plan.items.length === 4 && good.plan.placement === 'top');
const applied = org.applyMenuPlan(good.plan, { ctx, reason: 'smoke apply' });
const backupFile = path.join(menusLib.BACKUPS_DIR, applied.backupId + '.json');
check('apply → backup file under config/menu-backups/<id>.json with the pre-apply menus, locations and knobs',
  applied.applied === true && fs.existsSync(backupFile) && (() => { const b = JSON.parse(fs.readFileSync(backupFile, 'utf8')); return b.reason === 'smoke apply' && b.menus.main.length === before.main.length && b.knobs.fold === 0 && b.locations.main === 'main'; })());
const after = menusLib.loadMenus();
check('apply → the main menu is saved in the new order, with the new tel link', after.main.length === 4 && after.main[1].target === 'contact' && after.main[3].type === 'tel' && applied.changed.menus.includes('main'));
check('apply → an unchanged link keeps its id (stable ids by type+target)', !!aboutIdBefore && idOf(after.main, 'about') === aboutIdBefore);
check('apply → the knobs are merged over the live overrides (fold 3, header full), the rest untouched',
  theme.loadOverrides().chrome.menuFold === 3 && theme.loadOverrides().layout.headerWidth === 'full' && theme.loadOverrides().layout.menuPlacement === 'top' && applied.changed.knobs.includes('fold'));
check(`apply → the site was rebuilt (rebuildError "${applied.rebuildError}")`, applied.rebuildError === '' && fs.existsSync(path.join(process.env.TAPUZ_ROOT, 'public', 'home.html')));
check('apply → the exported home carries the candidate menu', /צור קשר/.test(fs.readFileSync(path.join(process.env.TAPUZ_ROOT, 'public', 'home.html'), 'utf8')) && /tel:\+972501234567/.test(fs.readFileSync(path.join(process.env.TAPUZ_ROOT, 'public', 'home.html'), 'utf8')));
check('listMenuBackups lists the apply backup newest first with counts', (() => { const l = menusLib.listMenuBackups(); return l.length === 1 && l[0].id === applied.backupId && l[0].counts.main === before.main.length && !!l[0].at; })());

const undone = org.undoLast();
check('undoLast restores the apply backup (menus, order, knobs) and leaves a pre-restore snapshot on top',
  undone.restored === applied.backupId && JSON.stringify(menusLib.loadMenus().main.map((i) => [i.type, i.target || i.url])) === JSON.stringify(before.main.map((i) => [i.type, i.target || i.url])) &&
  theme.loadOverrides().chrome.menuFold === 0 && theme.loadOverrides().layout.headerWidth === 'wide' && menusLib.listMenuBackups()[0].reason === 'pre-restore');
const forced = org.applyMenuPlan(hard.plan, { ctx: org.siteStateForMenus(), force: true });
check('force applies a plan with hard warnings (the unknown link stays dropped)', forced.applied && menusLib.loadMenus().main.length === 3 && menusLib.loadMenus().main.every((i) => i.target !== 'pricing'));
org.undoLast();
for (let i = 0; i < 12; i++) menusLib.backupMenus('churn ' + i);
check('the backup store keeps the newest 10', menusLib.listMenuBackups().length === 10 && fs.readdirSync(menusLib.BACKUPS_DIR).length === 10);
let noBackup = null;
try { menusLib.restoreMenuBackup('nope'); } catch (e) { noBackup = e; }
check('restoring an unknown backup throws NO_BACKUP', !!noBackup && noBackup.code === 'NO_BACKUP');
// 6. two snapshots in one millisecond: the suffix must sort AFTER the base (`-N` sorted before it, so undo restored the older one)
{
  const RealDate = Date;
  const frozen = RealDate.now() + 5000; // a tick no earlier snapshot shares
  global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [frozen])); } static now() { return frozen; } };
  let b1 = null;
  let b2 = null;
  try {
    menusLib.saveMenu('main', [{ type: 'custom', label: 'ראשון', url: '/first' }]);
    b1 = menusLib.backupMenus('tick-1');
    menusLib.saveMenu('main', [{ type: 'custom', label: 'שני', url: '/second' }]);
    b2 = menusLib.backupMenus('tick-2');
  } finally { global.Date = RealDate; }
  menusLib.saveMenu('main', [{ type: 'custom', label: 'שלישי', url: '/third' }]);
  const listed = menusLib.listMenuBackups();
  const undone2 = org.undoLast();
  check(`two backups in one tick: the second is ${b2 && b2.id} (base_1), listed first, and undoLast restores IT`,
    !!b1 && !!b2 && b2.id === b1.id + '_1' && listed[0].id === b2.id && listed[1].id === b1.id && undone2.restored === b2.id && menusLib.loadMenus().main.map((i) => i.url).join(',') === '/second');
}

// ── normalizeItems depth cap + stable ids ─────────────────────────────
const deep = menusLib.normalizeItems([{ label: 'a', type: 'custom', url: '#', children: [{ label: 'b', type: 'page', target: 'b', children: [{ label: 'c', type: 'page', target: 'c', children: [{ label: 'd', type: 'page', target: 'd' }] }] }] }]);
check('normalizeItems lifts grandchildren to their parent\'s level, never drops them', deep.length === 1 && deep[0].children.map((c) => c.label).join(',') === 'b,c,d' && deep[0].children.every((c) => c.children.length === 0));
const grafted = menusLib.withStableIds([{ label: 'x', type: 'page', target: 'about' }, { label: 'new', type: 'custom', url: '/new' }], [{ id: 'mi_1', label: 'אודות', type: 'page', target: 'about' }]);
check('withStableIds grafts the id of a link with the same type+target and leaves new links id-less', grafted[0].id === 'mi_1' && grafted[1].id === undefined);
check('REPAIRABLE lists the codes a repair round may fix', Array.isArray(org.REPAIRABLE) && org.REPAIRABLE.includes('UNKNOWN_PAGE') && org.REPAIRABLE.includes('NO_CHANGE') && org.REPAIRABLE.includes('LAYOUT_UNASKED'));

console.log(fail ? '\nSMOKE MENU-ORGANIZER: FAIL' : '\nSMOKE MENU-ORGANIZER: PASS');
try { fs.rmSync(process.env.TAPUZ_ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
process.exit(fail ? 1 : 0);
