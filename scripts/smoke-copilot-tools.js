'use strict';

/**
 * v1.59 QA — the copilot can act, and the gate that means it still can't act
 * ALONE.
 *
 * Giving a model tools reverses the guarantee the previous design rested on
 * ("the reply is a string; nothing executes it"). What replaces it is a single
 * rule: a mutating tool is never executed on the model's say-so. The loop
 * stops, hands a description to the owner, and only an explicit approval —
 * carrying an id the browser cannot forge into something else — lets it run.
 *
 * So this file's job is to try to get a write past the gate. If any of these
 * ever go green-to-red, the copilot has quietly become something that edits a
 * person's site without asking.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-tools-'));

const tools = require('../src/ai-tools');
const ai = require('../src/ai');
const { createPage } = require('../src/pages');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

// ── the tool surface: what exists, and what deliberately does not ─────────
const names = tools.TOOLS.map((t) => t.name).sort();
check('the copilot can look (list_pages, read_page)',
  names.includes('list_pages') && names.includes('read_page'));
check('the copilot can propose writes (create_page, edit_page)',
  names.includes('create_page') && names.includes('edit_page'));
for (const forbidden of ['publish_page', 'delete_page', 'save_theme', 'save_settings', 'run_sql', 'build_site']) {
  check(`NO tool named ${forbidden} exists`, !names.includes(forbidden));
}
// v2.43 — the menus (Ben: "the menu sorter is also included in the ai helper").
// One read, one gated write — and the way BACK is deliberately not a tool:
// putting a menu back is the owner's click, like publishing.
check('the copilot can look at the menus and propose a new one (read_menus, organize_menu)',
  names.includes('read_menus') && names.includes('organize_menu'));
for (const forbidden of ['undo_menu', 'restore_menu', 'delete_menu', 'save_menus', 'apply_menu']) {
  check(`NO tool named ${forbidden} exists (undo / restore stay the owner's)`, !names.includes(forbidden));
}
check('exactly six tools — a seventh arrives with its own gate checks, never quietly', names.length === 6);
check('reads are marked safe, writes are marked mutating',
  tools.getTool('list_pages').mutates === false &&
  tools.getTool('read_page').mutates === false &&
  tools.getTool('read_menus').mutates === false &&
  tools.getTool('create_page').mutates === true &&
  tools.getTool('edit_page').mutates === true &&
  tools.getTool('organize_menu').mutates === true);
check('every tool carries a description and a JSON schema',
  tools.TOOLS.every((t) => t.description && t.schema && t.schema.type === 'object'));
check('both provider envelopes are produced from the same schemas',
  tools.toolsForProvider('openai-chat').every((t) => t.type === 'function' && t.function.parameters) &&
  tools.toolsForProvider('anthropic-messages').every((t) => t.name && t.input_schema));

// ── the tools themselves do what they claim ──────────────────────────────
const PZN = (title, body, slug = 'tool-test') =>
  '<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n<head><meta charset="utf-8"/>' +
  `<title>${title}</title><meta name="bent-slug" content="${slug}"/></head>\n<body>\n` +
  `  <bent-heading id="h1" level="1">${body}</bent-heading>\n</body></html>`;

createPage({ title: 'דף קיים', slug: 'existing', status: 'published', blocks: [] });
check('list_pages sees the real site', tools.getTool('list_pages').run().pages.some((p) => p.slug === 'existing'));
check('read_page returns real .pzn source', /bent-version/.test(tools.getTool('read_page').run({ slug: 'existing' }).source));
check('read_page on a missing page is a clear error, not a crash', (() => {
  try { tools.getTool('read_page').run({ slug: 'nope' }); return false; } catch (e) { return /nope/.test(e.message); }
})());

const made = tools.getTool('create_page').run({ source: PZN('דף מהכלי', 'שלום') });
check('create_page makes a page', made.created && made.slug === 'tool-test');
check('create_page leaves it as a DRAFT — never published',
  require('../src/pages').getPageByFullPath('tool-test').status !== 'published');
check('create_page refuses to clobber an existing slug', (() => {
  try { tools.getTool('create_page').run({ source: PZN('שוב', 'x') }); return false; }
  catch (e) { return /כבר קיים/.test(e.message); }
})());
check('a document with no bent-* modules is refused', (() => {
  try { tools.getTool('create_page').run({ source: '<!DOCTYPE html><html><head><title>x</title></head><body></body></html>' }); return false; }
  catch (e) { return true; }
})());
// v2.20: the tools take only the BenTML — a model may answer in the keyword
// dialect, wrapped in a fence and chat; the page still lands as .pzn
const words = tools.getTool('create_page').run({
  source: 'Sure!\n```bentml\nBENTML 0.2\n\nMETA {\n  title: "דף מילים"\n  slug: "tool-words"\n}\n\nHEADING(level: 1) { שלום מהמילים }\n```\nEnjoy!'
});
check('create_page accepts a fenced keyword-dialect document', words.created && words.slug === 'tool-words' && words.moduleCount === 1);
check('…and stores it as a .pzn tag document',
  /<bent-heading[^>]*>שלום מהמילים/.test(require('../src/pages').getPageSource('tool-words', 'draft')) &&
  !/BENTML 0\.2|```/.test(require('../src/pages').getPageSource('tool-words', 'draft')));
const edited = tools.getTool('edit_page').run({ slug: 'existing', source: PZN('דף קיים', 'אחרי עריכה') });
check('edit_page rewrites the draft', edited.edited);
check('edit_page does NOT publish the change (the live page is untouched)', (() => {
  const p = require('../src/pages').getPageByFullPath('existing');
  const live = JSON.stringify(p.blocks || []);
  return !/אחרי עריכה/.test(live);
})());

// ── the gate: a write must never run without approval ────────────────────
// converse() is driven with a fake provider so the "model" can be as hostile
// as we like. Every path a write could take to execution is walked.
const providers = require('../src/providers');
providers.PROVIDERS.__fake = {
  id: '__fake', label: 'test', endpoint: 'http://127.0.0.1:1/v1/chat/completions',
  method: 'POST', authScheme: 'bearer', authHeader: 'Authorization', extraHeaders: {},
  defaultModel: 'm', models: [], openModel: true, keyOptional: true, maxTokens: 100,
  responsePath: ['choices', 0, 'message', 'content'],
  body: { style: 'openai-chat' }, baseUrlDefault: 'http://127.0.0.1:1/v1'
};

let scripted = [];
global.fetch = async () => ({
  ok: true, json: async () => scripted.shift() || { choices: [{ message: { content: 'done', tool_calls: null } }] }
});
ai.saveSettings({ provider: '__fake', baseUrl: 'http://127.0.0.1:1/v1' });

const wantsWrite = {
  choices: [{
    message: {
      content: 'אני אבנה', tool_calls: [{
        id: 'c1', type: 'function',
        // a FREE slug: 'tool-test' was created by the direct checks above, and
        // since v2.37 a proposal whose slug is taken is refused before the owner
        // is asked (it used to become a card that failed only after approval)
        function: { name: 'create_page', arguments: JSON.stringify({ source: PZN('לא מאושר', 'לא', 'pending-test') }) }
      }]
    }
  }]
};

(async () => {
  const before = require('../src/pages').listPages().length;
  scripted = [wantsWrite];
  const out = await ai.converse({ system: 's', user: 'בנה דף' });
  check('a proposed WRITE stops the loop and returns a pending approval',
    !!out.pending && out.pending.tool === 'create_page' && !!out.pending.id);
  check('the pending carries a human summary of what would happen',
    typeof out.pending.summary === 'string' && out.pending.summary.length > 3);
  check('NOTHING was written while waiting for approval',
    require('../src/pages').listPages().length === before);

  // v2.37: a proposal the write would refuse (here: its slug is taken) never
  // becomes a card — the model is answered with the reason and asked again
  scripted = [
    { choices: [{ message: { content: '', tool_calls: [{ id: 'dup1', type: 'function', function: { name: 'create_page', arguments: JSON.stringify({ source: PZN('כפול', 'כפול', 'existing') }) } }] } }] },
    { choices: [{ message: { content: 'הדף כבר קיים — אערוך אותו במקום.', tool_calls: null } }] }
  ];
  const dup = await ai.converse({ system: '<bent-heading>', user: 'צור דף existing' });
  check('a create_page on a taken slug is refused BEFORE approval (no pending; the model got the reason and answered)',
    !dup.pending && /כבר קיים/.test(dup.reply || '') && /לפני שתתבקשו לאשר/.test(dup.notice || ''));

  // refusing must not write, and must tell the model so
  scripted = [{ choices: [{ message: { content: 'הבנתי, לא אבצע', tool_calls: null } }] }];
  const refused = await ai.converse({ approve: { id: out.pending.id, ok: false } });
  check('a REFUSED proposal writes nothing',
    require('../src/pages').listPages().length === before);
  check('a refusal still returns the model a chance to respond', typeof refused.reply === 'string');
  check('a pending id is single-use — replaying it is rejected', await (async () => {
    try { await ai.converse({ approve: { id: out.pending.id, ok: true } }); return false; }
    catch (e) { return /פגה/.test(e.message); }
  })());
  check('an invented pending id is rejected', await (async () => {
    try { await ai.converse({ approve: { id: 'pend_deadbeef', ok: true } }); return false; }
    catch (e) { return /פגה/.test(e.message); }
  })());

  // approving DOES write — a slug nothing else in this file has claimed, so a
  // "already exists" refusal can't be mistaken for the gate holding
  scripted = [{
    choices: [{
      message: {
        content: 'אני אבנה', tool_calls: [{
          id: 'c2', type: 'function',
          function: { name: 'create_page', arguments: JSON.stringify({ source: PZN('מאושר', 'כן', 'approved-page') }) }
        }]
      }
    }]
  }];
  const again = await ai.converse({ system: 's', user: 'בנה דף' });
  scripted = [{ choices: [{ message: { content: 'נוצר', tool_calls: null } }] }];
  await ai.converse({ approve: { id: again.pending.id, ok: true } });
  check('an APPROVED proposal actually writes',
    !!require('../src/pages').getPageByFullPath('approved-page') &&
    require('../src/pages').listPages().length === before + 1);
  check('...and what it wrote is a DRAFT, not a live page',
    require('../src/pages').getPageByFullPath('approved-page').status !== 'published');

  // reads need no approval — a model forced to beg to look will guess instead
  scripted = [
    { choices: [{ message: { content: '', tool_calls: [{ id: 'r1', type: 'function', function: { name: 'list_pages', arguments: '{}' } }] } }] },
    { choices: [{ message: { content: 'יש לך כמה דפים', tool_calls: null } }] }
  ];
  const readOnly = await ai.converse({ system: 's', user: 'אילו דפים יש?' });
  check('a READ runs without asking and the answer comes back',
    !readOnly.pending && readOnly.used.includes('list_pages') && /דפים/.test(readOnly.reply));

  // a runaway tool loop terminates
  scripted = Array.from({ length: 12 }, () => ({
    choices: [{ message: { content: '', tool_calls: [{ id: 'x', type: 'function', function: { name: 'list_pages', arguments: '{}' } }] } }]
  }));
  const runaway = await ai.converse({ system: 's', user: 'loop' });
  check('a model that never stops calling tools is cut off, not left spinning',
    !runaway.pending && /עצרתי/.test(runaway.reply));

  // an unknown tool name is answered, not thrown
  scripted = [
    { choices: [{ message: { content: '', tool_calls: [{ id: 'u1', type: 'function', function: { name: 'drop_database', arguments: '{}' } }] } }] },
    { choices: [{ message: { content: 'אין לי כלי כזה', tool_calls: null } }] }
  ];
  const unknown = await ai.converse({ system: 's', user: 'x' });
  check('an invented tool name is refused as a tool error, never executed',
    !unknown.pending && typeof unknown.reply === 'string');

  // ── v2.32: a write AMONG reads — every call id answered, the gate held ──
  // A model may read a page and propose its edit in the same batch. The read
  // runs (free), the write waits; when the owner answers, the stored turn
  // must answer BOTH ids or the next request is rejected by the provider —
  // and the loop must say what it did in words when the model says nothing.
  let lastBody = null;
  const seenFetch = global.fetch;
  global.fetch = async (url, init) => { lastBody = JSON.parse(init.body); return seenFetch(url, init); };
  scripted = [{
    choices: [{
      message: {
        content: '', tool_calls: [
          { id: 'rd', type: 'function', function: { name: 'read_page', arguments: '{"slug":"existing"}' } },
          { id: 'wr', type: 'function', function: { name: 'edit_page', arguments: JSON.stringify({ slug: 'existing', source: PZN('דף קיים', 'בו זמנית', 'existing') }) } }
        ]
      }
    }]
  }];
  const mixed = await ai.converse({ system: 's', user: 'קרא וערוך' });
  check('a write among reads: the read ran, the write is only PROPOSED (memo says so)',
    mixed.used.includes('read_page') && mixed.reads.includes('existing') && mixed.pending && mixed.pending.tool === 'edit_page' && /הצעתי/.test(mixed.memo) &&
    !/בו זמנית/.test(require('../src/pages').getPageSource('existing', 'draft')));
  scripted = [{ choices: [{ message: { content: '', tool_calls: null } }] }];
  const mixedDone = await ai.converse({ approve: { id: mixed.pending.id, ok: true } });
  const answered = (lastBody.messages || []).filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
  check('on approval EVERY call id of the batch is answered (rd + wr)', answered.includes('rd') && answered.includes('wr'));
  check('an approved edit reports applied.edited and a memo even when the model answers nothing',
    mixedDone.applied && mixedDone.applied.edited === true && /בוצע/.test(mixedDone.memo) && mixedDone.reply === '' &&
    /בו זמנית/.test(require('../src/pages').getPageSource('existing', 'draft')));
  check('every converse result carries the window envelope (tier, source) and reads[]',
    mixedDone.window && typeof mixedDone.window.tier === 'string' && Array.isArray(mixedDone.reads));

  // ══ v2.43 — the menus: the organizer's door, behind the copilot's gate ══
  // Ben: "the menu sorter is also included in the ai helper that connects to
  // the api (lm studio or public doesn't matter they will work the same)".
  // Last in the file on purpose: it publishes pages and rewrites the menus.
  {
    const menusLib = require('../src/menus');
    const org = require('../src/menu-organizer');
    const FIX = path.join(__dirname, '..', 'test', 'fixtures', 'inject', 'menu-organizer', 'replies');
    for (const slug of ['home', 'about', 'contact']) createPage({ title: slug, slug, status: 'published', blocks: [] });
    menusLib.saveMenus({
      main: [
        { label: 'צור קשר', type: 'page', target: 'contact' },
        { label: 'אודות', type: 'page', target: 'about' },
        { label: 'הבית', type: 'page', target: 'home' }
      ],
      footer: []
    });
    const order = () => menusLib.loadMenus().main.map((i) => i.target || i.label).join(',');
    const backups = () => menusLib.listMenuBackups().length;
    const START = order();

    // ── read_menus: what the model gets ──
    const rm = tools.getTool('read_menus').run({});
    check('read_menus returns the menus as the <bent-menus> document — the organizer\'s own serialization',
      rm.document === org.serializeMenus({ knobs: require('../src/theme').menuKnobs(org.siteStateForMenus().overrides), menus: menusLib.loadMenus(), locations: menusLib.getMenuLocations() }) &&
      /<bent-link label="צור קשר" page="contact" \/>/.test(rm.document));
    check('…the ONE computed number, in the organizer\'s sentence (capacity is computed, never guessed)',
      /בשורה אחת נכנסים עד \d+ פריטים עליונים ועד \d+ תווים/.test(rm.capacity) && /היום: 3 פריטים/.test(rm.capacity));
    check('…the page table — the only place a legal page="…" comes from (drafts never get a row)',
      /\| about \|/.test(rm.pages) && /\| contact \|/.test(rm.pages) && !/\| tool-test \|/.test(rm.pages));
    check('…and the grammar a live menu may never show (nesting, groups, free targets, fold) — the ORGANIZER\'s lines, not a second grammar',
      rm.grammar === org.menuGrammar({ compact: true }) && /הורה בלי מאפיין יעד = קבוצה/.test(rm.grammar) && /tel=/.test(rm.grammar) && /fold=/.test(rm.grammar));
    check('the pack and the copilot teach ONE grammar: every compact line is a line of the pack\'s own',
      org.menuGrammar({ compact: true }).split('\n').filter((l) => !/bent-menu-layout/.test(l)).every((l) => org.menuGrammar().includes(l)));
    const tight = tools.getTool('read_menus').run({}, { maxSourceChars: 60 });
    check('read_menus over the allowance is REFUSED with a hint — never a sliced menu (organize_menu replaces whole menus)',
      tight.tooLong === true && tight.document === '' && tight.limitChars === 60 && /Context Length/.test(tight.hint) && /אל תציע\/י תפריט שלא קראת/.test(tight.hint));
    const roomy = rm.document.length + rm.capacity.length + rm.grammar.length + rm.how.length;
    const mid = tools.getTool('read_menus').run({}, { maxSourceChars: roomy + 150 });
    check('…when only the TABLE does not fit, the document stays whole and the table gives rows from the bottom, flagged',
      mid.document === rm.document && mid.truncated === true && mid.shownPages < mid.publishedPages);

    // ── preflight IS the organizer's door: its canned refusals, verbatim ──
    const canned = (re) => fs.readFileSync(path.join(FIX, fs.readdirSync(FIX).find((f) => re.test(f) && f.endsWith('.txt'))), 'utf8');
    const refusedAs = (doc) => { try { tools.preflight('organize_menu', { document: doc }, { brief: '' }); return 'PASSED'; } catch (e) { return e.code || 'NO_CODE'; } };
    for (const [file, code] of [[/theme-doc/, 'THEME_NOT_MENU'], [/page-doc/, 'PAGE_NOT_MENU'], [/31-nothing/, 'NO_MENU'], [/bad-menu-name/, 'BAD_MENU_NAME'], [/too-many-items/, 'TOO_MANY_ITEMS'], [/too-many-unknown/, 'TOO_MANY_UNKNOWN']]) {
      check(`preflight refuses the organizer's canned reply ${file.source} as ${code} — same door, same verdict`, refusedAs(canned(file)) === code);
    }
    check('an empty document is refused before the door is even asked', refusedAs('   ') === 'NO_CODE');
    const UNKNOWN = '<bent-menus version="1"><bent-menu name="main" location="main"><bent-link label="הבית" page="home"/><bent-link label="אודות" page="about"/><bent-link label="צור קשר" page="contact"/><bent-link label="מחירון" page="pricing"/></bent-menu></bent-menus>';
    check('a link to a page that does not exist is refused to the MODEL (HARD_WARNINGS) — an approval card only ever shows a document that will land',
      refusedAs(UNKNOWN) === 'HARD_WARNINGS');
    check('the current menu echoed back is refused (NO_CHANGE) — the owner is never asked to approve their own menu',
      refusedAs(rm.document) === 'NO_CHANGE');
    check('none of those refusals wrote anything or took a backup', order() === START && backups() === 0);

    // a model returns BARE documents, fenced ones, and sometimes names the
    // argument like the page tools do — all three are the same document
    const NEW = [
      '<bent-menus version="1" note="הבית ראשון, צור קשר אחרון">',
      '  <bent-menu name="main" location="main">',
      '    <bent-link label="הבית" page="home" />',
      '    <bent-link label="אודות" page="about" />',
      '    <bent-link label="צור קשר" page="contact" />',
      '  </bent-menu>',
      '</bent-menus>'
    ].join('\n');
    const pre = tools.preflight('organize_menu', { document: NEW }, { brief: 'סדר את התפריט' });
    check('a good document passes the door and the preflight hands back what it judged: the diff, the fit line, the framed header',
      pre && pre.preview && pre.preview.diff.main.moved.length > 0 && /✓|⚠/.test(pre.preview.fitLine) && /^\/admin\/menus\/preview\/mp_/.test(pre.preview.previewUrl) && Array.isArray(pre.warnings));
    check('fence optional (models return bare documents) and `source` tolerated as the argument name',
      refusedAs('בטח!\n```html\n' + NEW + '\n```') === 'PASSED' &&
      (() => { try { tools.preflight('organize_menu', { source: NEW }, {}); return true; } catch (e) { return false; } })());
    check('the approval line counts what the door will count, and says LIVE — never "draft"',
      /main: 3 קישורים/.test(tools.describeCall('organize_menu', { document: NEW })) && /האתר החי/.test(tools.describeCall('organize_menu', { document: NEW })) && !/טיוטה/.test(tools.describeCall('organize_menu', { document: NEW })));

    // ── through the loop, openai-chat shape ──
    const callMenu = (id, doc) => ({ choices: [{ message: { content: '', tool_calls: [{ id, type: 'function', function: { name: 'organize_menu', arguments: JSON.stringify({ document: doc }) } }] } }] });
    scripted = [
      { choices: [{ message: { content: '', tool_calls: [{ id: 'rm1', type: 'function', function: { name: 'read_menus', arguments: '{}' } }] } }] },
      callMenu('om1', NEW)
    ];
    const prop = await ai.converse({ system: 's', user: 'סדר את התפריט: הבית ראשון' });
    check('read_menus runs FREE, organize_menu STOPS the loop: a pending with the door\'s preview (diff + fit line + frame url)',
      prop.used.includes('read_menus') && prop.pending && prop.pending.tool === 'organize_menu' && !!prop.pending.id &&
      prop.pending.preview && prop.pending.preview.diff.main.moved.length > 0 && !!prop.pending.preview.fitLine && /^\/admin\/menus\/preview\/mp_/.test(prop.pending.preview.previewUrl));
    check('NOTHING was written and NO backup was taken while the proposal waits', order() === START && backups() === 0);
    check('the request carried both menu tools, declared in the openai envelope',
      (lastBody.tools || []).some((t) => t.type === 'function' && t.function.name === 'organize_menu' && t.function.parameters.required[0] === 'document') &&
      (lastBody.tools || []).some((t) => t.function.name === 'read_menus'));

    // REJECT — chat-only: nothing written, no backup, and the model is told
    scripted = [{ choices: [{ message: { content: 'הבנתי, לא שיניתי את התפריט.', tool_calls: null } }] }];
    const rej = await ai.converse({ approve: { id: prop.pending.id, ok: false } });
    const told = (lastBody.messages || []).filter((m) => m.role === 'tool' && m.tool_call_id === 'om1').pop();
    check('a REFUSED menu proposal writes nothing and takes NO backup', order() === START && backups() === 0 && !rej.applied);
    check('…and the model is told the owner declined, the same words a declined edit_page gets (done:false, do not claim it)',
      !!told && /"done":false/.test(told.content) && /שום דבר לא נשמר/.test(told.content) && /אל תכתוב\/י שביצעת/.test(told.content) && /דחה/.test(rej.memo));

    // a bad proposal never reaches the owner — and the fix line is the MENU's
    scripted = [callMenu('bad1', UNKNOWN), { choices: [{ message: { content: 'אין דף מחירון — אשאיר אותו בחוץ.', tool_calls: null } }] }];
    const bad = await ai.converse({ system: 's', user: 'הוסף מחירון לתפריט' });
    const badAnswer = (lastBody.messages || []).filter((m) => m.role === 'tool' && m.tool_call_id === 'bad1').pop();
    check('a document the door refuses → NO approval card; the model gets the door\'s own sentence back',
      !bad.pending && /לפני שתתבקשו לאשר/.test(bad.notice || '') && !!badAnswer && /מצביע על דף שלא קיים \(pricing\)/.test(badAnswer.content) && /"proposed":false/.test(badAnswer.content));
    check('…with the MENU\'s fix line (page="…" from read_menus), not the page tools\' advice about containers',
      !!badAnswer && /read_menus/.test(badAnswer.content) && !/Accepts children/.test(badAnswer.content) && order() === START && backups() === 0);

    // APPROVE — applies through applyMenuPlan: backup first, then the menus
    scripted = [callMenu('om2', NEW)];
    const again = await ai.converse({ system: 's', user: 'סדר את התפריט: הבית ראשון' });
    scripted = [{ choices: [{ message: { content: '', tool_calls: null } }] }];
    const done = await ai.converse({ approve: { id: again.pending.id, ok: true } });
    check('an APPROVED proposal applies: the menu is in the new order', order() === 'home,about,contact');
    check('…a backup of the OLD menu was taken first (config/menu-backups), reason copilot:organize_menu',
      backups() === 1 && menusLib.listMenuBackups()[0].reason === 'copilot:organize_menu' && done.applied.backupId === menusLib.listMenuBackups()[0].id &&
      fs.existsSync(path.join(menusLib.BACKUPS_DIR, done.applied.backupId + '.json')));
    check('…applied says organized (no slug, no draft), with the fit line; the memo says LIVE and that the way back exists',
      done.applied.organized === true && done.applied.tool === 'organize_menu' && done.applied.menus.join() === 'main' && !!done.applied.fitLine &&
      !done.applied.created && !done.applied.edited && /התפריט עודכן באתר החי/.test(done.memo) && /אפשר לבטל/.test(done.memo) && !/טיוטה/.test(done.memo));
    check('a menu pending id is single-use too', await (async () => {
      try { await ai.converse({ approve: { id: again.pending.id, ok: true } }); return false; } catch (e) { return /פגה/.test(e.message); }
    })());
    const undone = org.undoLast();
    check('undo stays reachable: undoLast restores the very backup the copilot\'s apply took', undone.restored === done.applied.backupId && order() === START);

    // ── the SAME loop in the anthropic shape ("lm studio or public doesn't
    //    matter they will work the same") ──
    providers.PROVIDERS.__fakeA = {
      id: '__fakeA', label: 'test-a', endpoint: 'http://127.0.0.1:1/v1/messages',
      method: 'POST', authScheme: 'x-api-key', authHeader: 'x-api-key', extraHeaders: {},
      defaultModel: 'm', models: [], openModel: true, keyOptional: true, maxTokens: 100,
      responsePath: ['content', 0, 'text'], body: { style: 'anthropic-messages' }
    };
    // (the endpoint policy is about where a KEY may go; this fake sends none)
    ai.saveSettings({ provider: '__fakeA', baseUrl: '' });
    const before2 = backups();
    scripted = [{ content: [{ type: 'text', text: 'מסדר' }, { type: 'tool_use', id: 'tu1', name: 'organize_menu', input: { document: NEW } }], stop_reason: 'tool_use' }];
    const aProp = await ai.converse({ system: 's', user: 'סדר את התפריט' });
    check('anthropic shape: the tools ride as {name, input_schema} and a tool_use block becomes the SAME pending',
      (lastBody.tools || []).some((t) => t.name === 'organize_menu' && t.input_schema && t.input_schema.required[0] === 'document') && typeof lastBody.system === 'string' &&
      aProp.pending && aProp.pending.tool === 'organize_menu' && !!aProp.pending.preview.fitLine && order() === START && backups() === before2);
    scripted = [{ content: [{ type: 'text', text: 'התפריט עודכן.' }], stop_reason: 'end_turn' }];
    const aDone = await ai.converse({ approve: { id: aProp.pending.id, ok: true } });
    const resultBlock = (((lastBody.messages || []).filter((m) => m.role === 'user' && Array.isArray(m.content)).pop() || {}).content || [])[0];
    check('anthropic shape: approve applies, and the write is answered as a tool_result for tu1',
      aDone.applied && aDone.applied.organized === true && order() === 'home,about,contact' && backups() === before2 + 1 &&
      !!resultBlock && resultBlock.type === 'tool_result' && resultBlock.tool_use_id === 'tu1' && /"organized":true/.test(resultBlock.content));
  }

  console.log('');
  console.log(fail ? 'SMOKE COPILOT-TOOLS: FAIL' : 'SMOKE COPILOT-TOOLS: PASS');
  process.exit(fail ? 1 : 0);
})();
