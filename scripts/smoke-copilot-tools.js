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

    // ── v2.44: a menu that LOSES pages nobody asked to remove goes back to the
    //    model, once. Battery T9 (nemotron-3-nano): asked to GROUP ten items,
    //    it returned five — every link legal, so the door had nothing hard to
    //    say, and ✓ took five published pages off the live header. ──
    const LOSSY = [
      '<bent-menus version="1" note="קיצרתי">',
      '  <bent-menu name="main" location="main">',
      '    <bent-link label="הבית" page="home" />',
      '    <bent-link label="אודות" page="about" />',
      '  </bent-menu>',
      '</bent-menus>'
    ].join('\n');
    const lossy =(opts) => { try { tools.preflight('organize_menu', { document: LOSSY }, opts); return 'PASSED'; } catch (e) { return (e.code || 'NO_CODE') + ' ' + e.message; } };
    check('a document that drops a page the menu HAD is sent back to the model (PAGES_LOST), naming the page and saying the owner never asked',
      /^PAGES_LOST /.test(lossy({ brief: 'קבץ את התפריט כדי שייכנס בשורה' })) && /צור קשר|contact/.test(lossy({ brief: 'קבץ' })) && /לא ביקש/.test(lossy({ brief: 'קבץ' })));
    check('…judged against the OWNER’s words: "הסר את צור קשר מהתפריט" / "remove contact" pass straight to the card',
      lossy({ brief: 'הסר את צור קשר מהתפריט' }) === 'PASSED' && lossy({ brief: 'תוריד את צור קשר' }) === 'PASSED' && lossy({ brief: 'please remove contact from the menu' }) === 'PASSED');
    check('…and only ONCE: a model that insists reaches the card (lostAsked) — the owner is the judge, PAGES_MISSING still on the card',
      lossy({ brief: 'קבץ', lostAsked: true }) === 'PASSED' &&
      tools.preflight('organize_menu', { document: LOSSY }, { brief: 'קבץ', lostAsked: true }).warnings.some((w) => /לא מופיעים באף תפריט/.test(w)));
    check('a page that was NEVER in a menu is not "lost" (the door’s own PAGES_MISSING covers it; nothing is sent back)',
      (() => { const r = require('../src/menu-organizer').parseMenuReply(NEW, require('../src/menu-organizer').siteStateForMenus(), { brief: '' }); return Array.isArray(r.lost) && r.lost.length === 0; })());
    check('none of that wrote anything or took a backup', order() === START && backups() === 0);

    // ── through the loop, openai-chat shape ──
    const callMenu = (id, doc) => ({ choices: [{ message: { content: '', tool_calls: [{ id, type: 'function', function: { name: 'organize_menu', arguments: JSON.stringify({ document: doc }) } }] } }] });
    // the lossy proposal first: NO card — the model hears why and tries again; its second try is the card
    scripted = [callMenu('lo1', LOSSY), callMenu('lo2', LOSSY)];
    const lo = await ai.converse({ system: 's', user: 'קבץ את התפריט' });
    const loTold = (lastBody.messages || []).filter((m) => m.role === 'tool' && m.tool_call_id === 'lo1').pop();
    check('through the loop: the FIRST lossy proposal never reaches the owner — the model is told which pages vanished (proposed:false)',
      !!loTold && /"proposed":false/.test(loTold.content) && /נעלמו ממנו/.test(loTold.content) && /לפני שתתבקשו לאשר/.test(lo.notice || ''));
    check('…the SECOND one does (a deliberate removal is the owner’s call): a card, with the door’s warning on it, nothing written',
      !!(lo.pending && lo.pending.tool === 'organize_menu') && (lo.pending.warnings || []).some((w) => /לא מופיעים באף תפריט/.test(w)) && order() === START && backups() === 0);
    scripted = [{ choices: [{ message: { content: 'לא שיניתי.', tool_calls: null } }] }];
    await ai.converse({ approve: { id: lo.pending.id, ok: false } });
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

  // ── v2.45: a document the model PRINTED is adopted as the write it was meant
  //    to be. The battery, Gemma 4 12B (2026-09-19): it read the menus,
  //    regrouped them well — and printed the <bent-menus> document in a fence.
  //    The chat has nothing to press for a printed menu, and only "create" for
  //    a printed page. Adopted, it walks the same road: preflight → the card. ──
  {
    ai.saveSettings({ provider: '__fake', baseUrl: 'http://127.0.0.1:1/v1' });
    const pagesLib = require('../src/pages');
    const menusLib2 = require('../src/menus');
    const says = (content, finish) => ({ choices: [{ message: { content, tool_calls: [] }, finish_reason: finish || 'stop' }] });
    const calls = (id, name, args) => ({ choices: [{ message: { content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
    const fenced = (doc, before = 'בניתי את הדף:', after = 'מקווה שזה מתאים.') => before + '\n\n```html\n' + doc + '\n```\n\n' + after;
    const count = () => pagesLib.listPages().length;

    // (1) a NEW page, printed → a create_page card; the prose stays words, the document is gone from it
    const n0 = count();
    scripted = [says(fenced(PZN('מודפס', 'דף שהודפס', 'printed-new')))];
    const p1 = await ai.converse({ system: '<bent-heading>', user: 'בנה דף קצר' });
    check('a printed NEW page becomes a create_page card — same gate, nothing written',
      !!(p1.pending && p1.pending.tool === 'create_page' && /printed-new/.test(p1.pending.input.source)) && count() === n0);
    check('…the reply keeps the model’s words and loses the document (the page never sees two offers for one page)',
      /בניתי את הדף/.test(p1.reply) && /מקווה/.test(p1.reply) && !/<bent-|<!DOCTYPE|```/.test(p1.reply));
    check('…and the owner is told what happened, once', /הדפיס את המסמך/.test(p1.notice || ''));
    scripted = [says('נוצר.')];
    const p1ok = await ai.converse({ approve: { id: p1.pending.id, ok: true } });
    check('…approve lands it as a draft, and the write is answered under the adopted call’s id',
      !!(p1ok.applied && p1ok.applied.created && p1ok.applied.slug === 'printed-new') && (pagesLib.getPageByFullPath('printed-new') || {}).status === 'draft' &&
      (lastBody.messages || []).some((m) => m.role === 'tool' && m.tool_call_id === 'doc_0' && /"created":true/.test(m.content)));

    // (2) an EDIT: read_page this turn, then the whole page printed → an edit_page card for that page
    scripted = [calls('r1', 'read_page', { slug: 'printed-new' }), says(fenced(PZN('מודפס', 'כותרת חדשה', 'printed-new'), 'עדכנתי את הכותרת:'))];
    const p2 = await ai.converse({ system: '<bent-heading>', user: 'שנה את הכותרת', context: { page: 'printed-new' } });
    check('a page the model READ this turn, printed back → an edit_page card for that page (hop 1 → doc_1)',
      !!(p2.pending && p2.pending.tool === 'edit_page' && p2.pending.input.slug === 'printed-new' && /כותרת חדשה/.test(p2.pending.input.source)));
    scripted = [says('לא שיניתי.')];
    await ai.converse({ approve: { id: p2.pending.id, ok: false } });
    check('…refused → the draft is untouched', !/כותרת חדשה/.test(pagesLib.getPageSource('printed-new', 'draft') || ''));

    // (3) the doc carries no slug → the OPEN page is the target, under the same read rule
    const NOSLUG = PZN('מודפס', 'בלי סלאג', 'x').replace(/<meta name="bent-slug"[^>]*\/>/, '');
    scripted = [calls('r2', 'read_page', { slug: 'printed-new' }), says(fenced(NOSLUG))];
    const p3 = await ai.converse({ system: '<bent-heading>', user: 'ערוך', context: { page: 'printed-new' } });
    check('a printed page with no bent-slug belongs to the OPEN page — when the model read it', !!(p3.pending && p3.pending.tool === 'edit_page' && p3.pending.input.slug === 'printed-new'));
    scripted = [says('בסדר.')];
    await ai.converse({ approve: { id: p3.pending.id, ok: false } });

    // (4) NOT adopted: an existing page the model never read (an edit replaces the whole page)
    scripted = [says(fenced(PZN('מודפס', 'עריכה עיוורת', 'printed-new')))];
    const p4 = await ai.converse({ system: '<bent-heading>', user: 'שנה משהו', context: { page: 'printed-new' } });
    check('an existing page the model did NOT read this turn is never adopted — the reply stays a reply', !p4.pending && /עריכה עיוורת/.test(p4.reply));

    // (5) NOT adopted: the owner asked to SEE the code
    scripted = [says(fenced(PZN('חדש', 'רק להראות', 'printed-show')))];
    const p5 = await ai.converse({ system: '<bent-heading>', user: 'תראה לי את הקוד של דף כזה' });
    check('"תראה לי את הקוד" → printing is what the owner asked for: no card', !p5.pending && /רק להראות/.test(p5.reply));

    // (6) NOT adopted: a reply that hit max_tokens
    scripted = [says(fenced(PZN('חדש', 'חתוך', 'printed-cut')), 'length')];
    const p6 = await ai.converse({ system: '<bent-heading>', user: 'בנה דף' });
    check('a reply cut at max_tokens is never adopted (half a document must not become a card)', !p6.pending && p6.truncated === true);

    // (7) a MENU: read_menus, then the <bent-menus> document printed → an organize_menu card with the door's preview
    const orderNow = () => (menusLib2.loadMenus().main || []).map((i) => i.target).join();
    const startOrder = orderNow();
    const backups0 = menusLib2.listMenuBackups().length;
    const MENU = ['<bent-menus version="1" note="צור קשר שני">', '  <bent-menu name="main" location="main">',
      '    <bent-link label="הבית" page="home" />', '    <bent-link label="צור קשר" page="contact" />', '    <bent-link label="אודות" page="about" />',
      '  </bent-menu>', '</bent-menus>'].join('\n');
    scripted = [calls('m1', 'read_menus', {}), says(fenced(MENU, 'סידרתי את התפריט:', ''))];
    const p7 = await ai.converse({ system: '<bent-heading>', user: 'העבר את צור קשר למקום השני' });
    check('a printed <bent-menus> document becomes an organize_menu card WITH the door’s preview (diff, fit line) — and nothing moved',
      !!(p7.pending && p7.pending.tool === 'organize_menu' && p7.pending.preview && p7.pending.preview.diff && p7.pending.preview.fitLine) &&
      orderNow() === startOrder && menusLib2.listMenuBackups().length === backups0);
    check('…the owner is told the document was printed and adopted — on a LATER hop too (the read came first)', /הדפיס את המסמך/.test(p7.notice || ''));
    scripted = [says('התפריט עודכן.')];
    const p7ok = await ai.converse({ approve: { id: p7.pending.id, ok: true } });
    check('…approve applies it live with a backup, exactly like a called organize_menu',
      !!(p7ok.applied && p7ok.applied.organized) && orderNow() === 'home,contact,about' && menusLib2.listMenuBackups().length === backups0 + 1);

    // (8) a printed menu that the DOOR refuses goes back to the model, not to the owner
    const BADMENU = MENU.replace('page="about"', 'page="no-such-page"').replace('צור קשר שני', 'שבור');
    scripted = [calls('m2', 'read_menus', {}), says(fenced(BADMENU, '', '')), says('לא הצלחתי.')];
    const p8 = await ai.converse({ system: '<bent-heading>', user: 'סדר את התפריט' });
    check('an adopted document is judged like a called one: the door’s refusal goes back to the MODEL under the adopted id, no card',
      !p8.pending && (lastBody.messages || []).some((m) => m.role === 'tool' && m.tool_call_id === 'doc_1' && /"proposed":false/.test(m.content)));

    // (8b) the v2.43 weaker mode stays what it was: a model that never READ the menus only describes
    scripted = [says(fenced(MENU.replace('צור קשר שני', 'בלי קריאה'), 'הנה תפריט:', ''))];
    const p8b = await ai.converse({ system: '<bent-heading>', user: 'סדר את התפריט' });
    check('a printed menu from a model that never called read_menus is NOT adopted — describe-only, as the tester’s gate 3 says',
      !p8b.pending && /<bent-menus/.test(p8b.reply));

    // (8c) a refused proposal followed by WORDS: the model's sentence stays, the truth goes beside it
    //      (battery T3, Gemma 4 12B: "עדכנתי את כותרת ההירו" — after a refusal, with nothing proposed)
    const BADPAGE = '<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n<head><meta charset="utf-8"/><title>שבור</title><meta name="bent-slug" content="printed-bad"/></head>\n<body>\n  <bent-faq id="f"><bent-fold id="x" title="שאלה">תשובה</bent-fold></bent-faq>\n</body></html>';
    scripted = [calls('w9', 'create_page', { source: BADPAGE }), says('עדכנתי את הדף, הכול מוכן.')];
    const p8c = await ai.converse({ system: '<bent-heading>', user: 'בנה דף שאלות' });
    check('a refusal followed by plain words: no card, the model\'s sentence is kept — and the notice says nothing was saved, whatever the reply claims',
      !p8c.pending && !p8c.applied && /הכול מוכן/.test(p8c.reply) && /שום דבר לא נשמר/.test(p8c.notice || '') && !pagesLib.getPageByFullPath('printed-bad'));
    scripted = [says('שלום!')];
    const p8d = await ai.converse({ system: '<bent-heading>', user: 'שלום' });
    check('…and an ordinary reply carries no such notice', !/שום דבר לא נשמר/.test(p8d.notice || ''));

    // (8e) a closer that is almost the open tag does not cost the owner a round trip (battery: `</bent/heading>`,
    //      repeated by the 26B when the door sent it back) — and the card holds what the write will save
    const TYPO = PZN('מודפס', 'כותרת עם טעות', 'printed-typo').replace('</bent-heading>', '</bent/heading>');
    scripted = [calls('w10', 'create_page', { source: TYPO })];
    const p8e = await ai.converse({ system: '<bent-heading>', user: 'בנה דף' });
    check('a create_page whose closer is `</bent/heading>` reaches the owner as a card, already corrected — no refusal, no second model call',
      !!(p8e.pending && p8e.pending.tool === 'create_page') && /<\/bent-heading>/.test(p8e.pending.input.source) && !/bent\/heading/.test(p8e.pending.input.source) && !/לפני שתתבקשו לאשר/.test(p8e.notice || ''));
    scripted = [says('נוצר.')];
    const p8eOk = await ai.converse({ approve: { id: p8e.pending.id, ok: true } });
    check('…and it lands', !!(p8eOk.applied && p8eOk.applied.created) && /כותרת עם טעות/.test(pagesLib.getPageSource('printed-typo', 'draft') || ''));

    // (9) the unit: a tool the request did not declare is never adopted (the lean 8K request has no menu tools)
    check('adoptPrintedDocument: an undeclared tool is never adopted; prose with no document is left alone',
      ai.adoptPrintedDocument(fenced(MENU), { declared: ['list_pages', 'read_page', 'create_page', 'edit_page'] }) === null &&
      ai.adoptPrintedDocument('סתם תשובה במילים.', { declared: ['create_page'] }) === null &&
      ai.adoptPrintedDocument(fenced(MENU), { declared: ['organize_menu'], used: [] }) === null &&
      ai.adoptPrintedDocument(fenced(MENU), { declared: ['organize_menu'], used: ['read_menus'] }).calls[0].name === 'organize_menu');
  }

  // ── v2.46: pictures and links that do not exist. The dreams battery (an
  //    owner's own words, a brand-new site, Gemma 4 31B): one page came back
  //    with NINE invented image paths and three links to sub-pages nobody made. ──
  {
    ai.saveSettings({ provider: '__fake', baseUrl: 'http://127.0.0.1:1/v1' });
    const pagesLib = require('../src/pages');
    const says = (content) => ({ choices: [{ message: { content, tool_calls: [] }, finish_reason: 'stop' }] });
    const calls = (id, name, args) => ({ choices: [{ message: { content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
    const withBody = (slug, body) => '<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n<head><meta charset="utf-8"/><title>חלום</title><meta name="bent-slug" content="' + slug + '"/></head>\n<body>\n' + body + '\n</body></html>';
    const PIC = withBody('dream-pic', '  <bent-heading id="h" level="1">סטודיו</bent-heading>\n  <bent-image id="i" src="/uploads/ceramics-hero.jpg" alt="סטודיו" />');
    const NOPIC = withBody('dream-pic', '  <bent-heading id="h" level="1">סטודיו</bent-heading>\n  <bent-text id="t">חם וביתי</bent-text>');

    check('missingImages: a local path the site does not have is missing; an external picture, an anchor and a served file are not',
      tools.missingImages(PIC, '').join() === '/uploads/ceramics-hero.jpg' &&
      tools.missingImages(PIC.replace('/uploads/ceramics-hero.jpg', 'https://example.org/a.jpg'), '').length === 0 &&
      tools.missingImages(PIC.replace('/uploads/ceramics-hero.jpg', '/demo/logo-tapuziel.svg'), '').length === 0);
    check('…and a path that was ALREADY in the page being edited is the owner\'s, not the model\'s', tools.missingImages(PIC, PIC).length === 0);

    // the first proposal goes back to the MODEL with the list; its corrected page is the card
    scripted = [calls('i1', 'create_page', { source: PIC }), calls('i2', 'create_page', { source: NOPIC })];
    const q1 = await ai.converse({ system: '<bent-heading>', user: 'אני פותחת סטודיו לקרמיקה' });
    const told = (lastBody.messages || []).filter((m) => m.role === 'tool' && m.tool_call_id === 'i1').pop();
    check('an invented picture never reaches the owner on the first try: the model is told which path, and that it is a broken picture (proposed:false)',
      !!told && /"proposed":false/.test(told.content) && /ceramics-hero\.jpg/.test(told.content) && /תמונה שבורה/.test(told.content));
    check('…its second, picture-free page IS the card — with no warning on it',
      !!(q1.pending && q1.pending.tool === 'create_page' && !/bent-image/.test(q1.pending.input.source)) && !/בהצעה לא קיימות באתר/.test(q1.notice || ''));
    scripted = [says('בסדר.')];
    await ai.converse({ approve: { id: q1.pending.id, ok: false } });

    // a model that INSISTS reaches the card — and the owner is told which pictures are broken
    scripted = [calls('i3', 'create_page', { source: PIC }), calls('i4', 'create_page', { source: PIC })];
    const q2 = await ai.converse({ system: '<bent-heading>', user: 'אני פותחת סטודיו לקרמיקה' });
    check('a model that insists reaches the card (once asked, never looped) — and the owner reads which pictures will show broken',
      !!(q2.pending && q2.pending.tool === 'create_page') && /1 תמונות בהצעה לא קיימות באתר/.test(q2.notice || '') && /ceramics-hero\.jpg/.test(q2.notice || ''));
    scripted = [says('בסדר.')];
    await ai.converse({ approve: { id: q2.pending.id, ok: false } });

    // a link to a page that does not exist is never refused — a dream page may point at what comes next — but the owner is told
    const LINKY = withBody('dream-links', '  <bent-heading id="h" level="1">סדנאות</bent-heading>\n  <bent-button id="b1" href="/workshops/beginners">למתחילים</bent-button>\n  <bent-button id="b2" href="/existing">קיים</bent-button>\n  <bent-button id="b3" href="#top">למעלה</bent-button>');
    check('deadLinks: only an internal path that names no page (a real page, an anchor and an asset are fine)', tools.deadLinks(LINKY, '').join() === '/workshops/beginners');
    // a dead link goes back ONCE too — with the list of real pages, so "/contact" can become the page that exists
    const FIXED = LINKY.replace('/workshops/beginners', '/existing');
    scripted = [calls('l1', 'create_page', { source: LINKY }), calls('l2', 'create_page', { source: FIXED })];
    const q3 = await ai.converse({ system: '<bent-heading>', user: 'דף סדנאות' });
    const toldLink = (lastBody.messages || []).filter((m) => m.role === 'tool' && m.tool_call_id === 'l1').pop();
    check('a dead internal link goes back to the model once — naming the link AND the pages that do exist',
      !!toldLink && /"proposed":false/.test(toldLink.content) && /\/workshops\/beginners/.test(toldLink.content) && /הדפים הקיימים: .*\/existing/.test(toldLink.content));
    check('…the corrected page is the card, with nothing to warn about',
      !!(q3.pending && q3.pending.tool === 'create_page' && !/workshops/.test(q3.pending.input.source)) && !/עדיין לא קיימים/.test(q3.notice || ''));
    scripted = [says('בסדר.')];
    await ai.converse({ approve: { id: q3.pending.id, ok: false } });
    // …and a model that insists reaches the card: a dream page may point at a page that comes next — the owner is told
    scripted = [calls('l3', 'create_page', { source: LINKY }), calls('l4', 'create_page', { source: LINKY })];
    const q4 = await ai.converse({ system: '<bent-heading>', user: 'דף סדנאות' });
    check('a model that insists on the link reaches the card, and the owner reads which links lead nowhere yet',
      !!(q4.pending && q4.pending.tool === 'create_page') && /1 קישורים מובילים לדפים שעדיין לא קיימים/.test(q4.notice || '') && /\/workshops\/beginners/.test(q4.notice || ''));
    scripted = [says('בסדר.')];
    await ai.converse({ approve: { id: q4.pending.id, ok: false } });
    check('none of that wrote a page', !pagesLib.getPageByFullPath('dream-pic') && !pagesLib.getPageByFullPath('dream-links'));

    // the cause: an EMPTY library is a fact the briefing states (the copilot only — the paste packs keep their bytes)
    const rp = require('../src/pzn/agent-roleplay');
    const brief = (tier, media) => rp.buildCopilotBriefing({ locale: 'he', media, siteTitle: 'x', tier }).text;
    check('an empty media library is SAID: the full tier has the section, both tiers change the rule line, and neither promises "a list follows"',
      /הספרייה ריקה/.test(brief('full', [])) && /אין תמונות באתר/.test(brief('full', [])) && /אין תמונות באתר/.test(brief('compact', [])) &&
      !/יש רשימת מדיה אמיתית למטה/.test(brief('full', [])) && !/יש רשימת מדיה אמיתית למטה/.test(brief('compact', [])));
    check('…with pictures in the library the briefing is what it always was',
      /יש רשימת מדיה אמיתית למטה/.test(brief('full', [{ url: '/uploads/a.webp', alt: 'a' }])) && !/הספרייה ריקה|אין תמונות באתר/.test(brief('full', [{ url: '/uploads/a.webp', alt: 'a' }])));
    check('…and the paste packs are untouched by it', !/הספרייה ריקה|אין תמונות באתר/.test(rp.buildRoleplayPack({ locale: 'he', size: 'lite', playerBrief: 'x', media: [] }).text));
  }

  // ── v2.47: styling that does nothing here. Dreams D10 (gemma-4-31B): "warm, the side in purple, a
  //    background that stays still" came back as Tailwind classes + <body style=…>, and the reply told
  //    the owner the colours and the fixed background were DONE. ──
  {
    ai.saveSettings({ provider: '__fake', baseUrl: 'http://127.0.0.1:1/v1' });
    const pagesLib = require('../src/pages');
    const says = (content) => ({ choices: [{ message: { content, tool_calls: [] }, finish_reason: 'stop' }] });
    const calls = (id, name, args) => ({ choices: [{ message: { content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
    const page = (bodyAttr, body) => '<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n<head><meta charset="utf-8"/><title>חלום</title><meta name="bent-slug" content="dream-look"/></head>\n<body' + bodyAttr + '>\n' + body + '\n</body></html>';
    const TAILWIND = page(' style="background-attachment: fixed;"', '  <bent-marquee id="m" speed="md" class="bg-purple-600 text-white py-2">הודעה ✦</bent-marquee>\n  <bent-heading id="h" level="1" class="text-purple-900">שלום</bent-heading>');
    const CLEAN = page('', '  <bent-marquee id="m" speed="md">הודעה ✦</bent-marquee>\n  <bent-heading id="h" level="1">שלום</bent-heading>');
    const OWN = page('', '  <bent-heading id="h" level="1" class="hero-dark wedding">שלום</bent-heading>');

    const dead = tools.deadStyling(TAILWIND, '');
    check('deadStyling: an inline style and utility-framework classes are named (' + dead.length + ')', dead.length === 3 && /background-attachment/.test(dead.join()) && /bg-purple-600/.test(dead.join()) && /text-purple-900/.test(dead.join()));
    check('…an owner\'s own hook for the theme skin (class="hero-dark wedding") is none of the door\'s business', tools.deadStyling(OWN, '').length === 0);
    check('…nor is styling that was ALREADY on the page being edited', tools.deadStyling(TAILWIND, TAILWIND).length === 0);
    check('…and a clean page has none', tools.deadStyling(CLEAN, '').length === 0);

    scripted = [calls('s1', 'create_page', { source: TAILWIND }), calls('s2', 'create_page', { source: CLEAN })];
    const q1 = await ai.converse({ system: '<bent-heading>', user: 'אני רוצה שהאתר ירגיש חם, ואת הצד בסגול' });
    const told = (lastBody.messages || []).filter((m) => m.role === 'tool' && m.tool_call_id === 's1').pop();
    check('dead styling goes back to the MODEL once: what is dead, that the look is the THEME, where the theme lives, and not to claim it',
      !!told && /"proposed":false/.test(told.content) && /bg-purple-600/.test(told.content) && /Tailwind/.test(told.content) && /עיצוב ← ערכת נושא/.test(told.content) && /admin\/theme/.test(told.content) && /אל תכתוב/.test(told.content));
    check('…its clean page is the card, with nothing to warn about', !!(q1.pending && q1.pending.tool === 'create_page' && !/class=|style=/.test(q1.pending.input.source)) && !/אין להם משמעות/.test(q1.notice || ''));
    scripted = [says('בסדר.')];
    await ai.converse({ approve: { id: q1.pending.id, ok: false } });

    scripted = [calls('s3', 'create_page', { source: TAILWIND }), calls('s4', 'create_page', { source: TAILWIND })];
    const q2 = await ai.converse({ system: '<bent-heading>', user: 'אני רוצה שהאתר ירגיש חם, ואת הצד בסגול' });
    check('a model that insists reaches the card — and the OWNER is told the styling changes nothing, whatever the reply says, and where colours live',
      !!(q2.pending && q2.pending.tool === 'create_page') && /אין להם משמעות באתר/.test(q2.notice || '') && /גם אם התשובה אומרת אחרת/.test(q2.notice || '') && /עיצוב ← ערכת נושא/.test(q2.notice || ''));
    scripted = [says('בסדר.')];
    await ai.converse({ approve: { id: q2.pending.id, ok: false } });
    check('none of that wrote a page', !pagesLib.getPageByFullPath('dream-look'));

    // v2.48 — `style` is ALSO a real BenTML attribute (bent-divider style="solid|dashed|none"). v2.47 bounced it:
    // the first survey caught gemma-4-26B-A4B losing whole scenarios to `style="dashed"`.
    const DIVIDER = page('', '  <bent-heading id="h" level="1">שלום</bent-heading>\n  <bent-divider id="d" style="dashed" />\n  <bent-text id="t">טקסט</bent-text>');
    check('a module\'s own style= (bent-divider style="dashed") is NOT dead styling — only a CSS declaration is',
      tools.deadStyling(DIVIDER, '').length === 0 && tools.deadStyling(DIVIDER.replace('style="dashed"', 'style="border-top: 2px dashed purple"'), '').length === 1);
    scripted = [calls('s5', 'create_page', { source: DIVIDER })];
    const q3 = await ai.converse({ system: '<bent-heading>', user: 'דף עם קו מפריד' });
    const bounced = (lastBody.messages || []).some((m) => m.role === 'tool' && m.tool_call_id === 's5' && /"proposed":false/.test(m.content));
    check('…and such a page reaches the card on the FIRST try, with nothing sent back and nothing to warn about',
      !!(q3.pending && q3.pending.tool === 'create_page') && !bounced && !/אין להם משמעות/.test(q3.notice || ''));
    scripted = [says('בסדר.')];
    await ai.converse({ approve: { id: q3.pending.id, ok: false } });

    const rp = require('../src/pzn/agent-roleplay');
    const full = rp.buildCopilotBriefing({ locale: 'he', media: [], siteTitle: 'x', tier: 'full' }).text;
    const compact = rp.buildCopilotBriefing({ locale: 'he', media: [], siteTitle: 'x', tier: 'compact' }).text;
    check('the full briefing says WHERE the look lives (עיצוב ← ערכת נושא, /admin/theme), that Tailwind and style= do nothing, and that facts survive a shortening',
      /עיצוב ← ערכת נושא/.test(full) && /admin\/theme/.test(full) && /Tailwind/.test(full) && /לקצר או לשכתב ≠ למחוק עובדות/.test(full) && /מילה במילה/.test(full));
    check('…the compact tier pays nothing for it (the door teaches it there, when it happens)', !/Tailwind/.test(compact) && !/לקצר או לשכתב/.test(compact));
    check('…and the paste packs keep their bytes', !/Tailwind|לקצר או לשכתב/.test(rp.buildRoleplayPack({ locale: 'he', size: 'lite', playerBrief: 'x', media: [] }).text));
  }

  // ── v2.50: a THINKING model and the answer's budget. The survey (Muse-Glimmer 30B on LM Studio): the runtime
  //    ignores reasoning_effort "none", every reply starts with 2,000–4,000 reasoning tokens, and a budget spent
  //    on thinking came back as finish=length + content "" — which the owner read as "empty reply". ──
  {
    ai.saveSettings({ provider: '__fake', baseUrl: 'http://127.0.0.1:1/v1' });
    const says = (content) => ({ choices: [{ message: { content, tool_calls: [] }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 40 } });
    const thoughtAway = (spent) => ({
      choices: [{ finish_reason: 'length', message: { role: 'assistant', content: '', reasoning_content: 'We need to parse the request. The owner pasted a document…', tool_calls: [] } }],
      usage: { prompt_tokens: 900, completion_tokens: spent, completion_tokens_details: { reasoning_tokens: spent - 5 } }
    });
    const bodies = [];
    const realFetch = global.fetch;
    global.fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return realFetch(url, init); };

    check('thoughtOut: finish=length + empty content + reasoning behind it — and nothing else (a plain empty reply, a cut ANSWER, a tool call, another dialect)',
      ai.thoughtOut('openai-chat', thoughtAway(4096)) === true &&
      ai.thoughtOut('openai-chat', { choices: [{ finish_reason: 'stop', message: { content: '' } }] }) === false &&
      ai.thoughtOut('openai-chat', { choices: [{ finish_reason: 'length', message: { content: '' } }], usage: {} }) === false &&
      ai.thoughtOut('openai-chat', { choices: [{ finish_reason: 'length', message: { content: 'חצי תשובה', reasoning_content: 'x' } }] }) === false &&
      ai.thoughtOut('openai-chat', { choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'x', tool_calls: [{ id: 'a' }] } }] }) === false &&
      ai.thoughtOut('anthropic-messages', thoughtAway(4096)) === false);
    check('biggerBudget: three times the first, at most 12,288, never more than the window has left — and 0 when that is not worth a call',
      ai.biggerBudget(2048, Infinity, 0) === 6144 && ai.biggerBudget(4096, 32768, 20000) === 12288 && ai.biggerBudget(4096, 32768, 24000) === 8384 &&
      ai.biggerBudget(4096, 32768, 27000) === 0 && ai.biggerBudget(8192, NaN, 0) === 12288 && ai.biggerBudget(12288, Infinity, 0) === 0);

    // the copilot: one more call with a larger budget, and the owner is told why it took longer
    bodies.length = 0;
    scripted = [thoughtAway(100), says('הנה מה שאני מציע: …')];
    const t1 = await ai.converse({ system: '<bent-heading>', user: 'מה אתה מציע לדף הבית?' });
    check('the copilot: a reply that thought its budget away is asked ONCE more with a larger max_tokens (' + (bodies[0] || {}).max_tokens + ' → ' + (bodies[1] || {}).max_tokens + '), the same conversation',
      bodies.length === 2 && bodies[1].max_tokens >= bodies[0].max_tokens * 1.5 && JSON.stringify(bodies[1].messages) === JSON.stringify(bodies[0].messages));
    check('…the answer arrives, and the notice says what happened', t1.ok !== false && /הנה מה שאני מציע/.test(t1.reply || '') && /חשב עד שלא נשאר לו מקום לתשובה/.test(t1.notice || ''));

    bodies.length = 0;
    scripted = [thoughtAway(100), thoughtAway(300), says('לא אמור להישלח')];
    let twice = null;
    try { await ai.converse({ system: '<bent-heading>', user: 'מה אתה מציע לדף הבית?' }); } catch (e) { twice = e; }
    check('thought away TWICE → THOUGHT_OUT with the way out — two calls, never a third, never "empty reply"',
      !!twice && twice.code === 'THOUGHT_OUT' && /חשיבה/.test(twice.message) && /Gemma 4/.test(twice.fix || '') && bodies.length === 2);
    scripted = [];

    bodies.length = 0;
    scripted = [{ choices: [{ finish_reason: 'stop', message: { content: '', tool_calls: [] } }], usage: { prompt_tokens: 900, completion_tokens: 0 } }];
    let silent = null;
    try { await ai.converse({ system: '<bent-heading>', user: 'שלום' }); } catch (e) { silent = e; }
    check('plain silence (finish=stop, nothing thought) stays what it was: EMPTY_REPLY, one call', !!silent && silent.code === 'EMPTY_REPLY' && bodies.length === 1);

    // the one-shot packs (the organizer's ▶ gives the answer 2,048 tokens). A model of its own: the copilot cases above
    // already taught the door that THAT model thinks — which is the very memory the second check below pins
    ai.saveSettings({ provider: '__fake', baseUrl: 'http://127.0.0.1:1/v1', model: 'a-thinker-not-seen-yet' });
    bodies.length = 0;
    scripted = [thoughtAway(2048), says('<bent-menus version="1"></bent-menus>')];
    const g1 = await ai.generateDetailed({ system: '', user: '# pack\n<bent-menus> — הדיאלקט', maxTokens: 2048 });
    check('a one-shot pack: 2,048 thought away → one more call at 6,144 → the answer; usage counts BOTH calls; the result says it retried',
      bodies.length === 2 && bodies[0].max_tokens === 2048 && bodies[1].max_tokens === 6144 && /bent-menus/.test(g1.text) && g1.thoughtRetry === true && g1.usage.completion_tokens === 2048 + 40);
    bodies.length = 0;
    scripted = [says('<bent-menus version="1"></bent-menus>')];
    await ai.generateDetailed({ system: '', user: '# pack\n<bent-menus> — הדיאלקט', maxTokens: 2048 });
    check('…and a model SEEN thinking starts with the larger budget the next time (no wasted first call)', bodies.length === 1 && bodies[0].max_tokens === 6144);
    bodies.length = 0;
    scripted = [thoughtAway(6144), thoughtAway(6144)];
    let g2 = null;
    try { await ai.generateDetailed({ system: '', user: '# pack\n<bent-menus> — הדיאלקט', maxTokens: 2048 }); } catch (e) { g2 = e; }
    check('…a thinker that cannot finish even then → THOUGHT_OUT (the runner answers 502 with the fix), never a loop', !!g2 && g2.code === 'THOUGHT_OUT' && bodies.length <= 2 && /Context Length/.test(g2.fix || ''));
    scripted = [];
    global.fetch = realFetch;
    ai.saveSettings({ provider: '__fake', baseUrl: 'http://127.0.0.1:1/v1', model: '' });
  }

  console.log('');
  console.log(fail ? 'SMOKE COPILOT-TOOLS: FAIL' : 'SMOKE COPILOT-TOOLS: PASS');
  process.exit(fail ? 1 : 0);
})();
