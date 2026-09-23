'use strict';

/**
 * v1.35/v1.47 QA — proves src/routes/copilot.js works end-to-end as a mounted
 * Express Router: the whole AI copilot surface, both tiers. Started as
 * ai-paste coverage (the two BYOT paste-flow pages); grew with the module
 * when v1.47 absorbed the rest of the cluster.
 *
 * Covered: the four admin screens (/admin/agent, /admin/ai, /admin/inject,
 * /admin/chat) render behind the gate with their client scripts and mount
 * points intact and are unreachable unauthenticated; the packs they hand out
 * (inject-pack, syntax-dictionary[.md]) answer with the RIGHT dictionary; and
 * the BYOK key surface (/admin/api/ai/settings) never leaks the stored key.
 *
 * v2.32 adds the window and the canvas: the chat POST tiers its briefing to
 * the window the page reports (8K → compact, 32K → full, unknown → compact),
 * an exceed body relayed back becomes a shrink-and-retry with a notice, a
 * provider error is Hebrew with a code, the relay tool loop carries its
 * role:'tool' answers, an approved edit lands as a DRAFT and the published
 * page is untouched, and /admin/chat carries the builder in a frame with a
 * page dropdown, a proposal frame and a window chip.
 *
 * v2.43 adds the MENU and its acceptance gate, by number (search "GATE"):
 * the copilot reads the menus, proposes an order WITH the diff, and the
 * owner's confirm applies it — GET /admin/api/menus shows the new order with
 * no inject-card step, a backup exists; a reject leaves the menus
 * byte-identical with no backup and tells the model; a model that returns no
 * tool call can still only describe, and that does not break. Plus the menu
 * canvas: its markup, its sandbox, its one renderer, its state route.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-copilot-route-'));
const PORT = 3994;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

// ── static: provider choice is RADIOS with honest readiness (v1.70, Ben:
//    "options that are not working should be greyed out… make a radio") ──
{
  const copilotSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'copilot.js'), 'utf8');
  const chatJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-chat.js'), 'utf8');
  check('provider picker is a radio group, not a <select>',
    /id="ai-provider-radios"/.test(copilotSrc) && !/<select id="ai-provider">/.test(copilotSrc));
  check('not-ready providers are toned down (.is-off styled)',
    /\.provider-radio\.is-off \{ opacity:\.55; \}/.test(copilotSrc.replace(/\s+/g, ' ')) ||
    /provider-radio\.is-off/.test(copilotSrc));
  check('the checked row is never faded', /:has\(input:checked\)/.test(copilotSrc));
  check('client renders readiness chips (מוגדר/דורש מפתח/מקומי)',
    /דורש מפתח/.test(chatJs) && /מקומי · ללא מפתח/.test(chatJs) && /מוגדר ✓/.test(chatJs));
  // v2.52 — keys are kept PER supplier, so a row is ready when ITS key is on file (before: "the saved provider has a
  // key" — and one stored key followed the owner to whichever supplier she picked next)
  check('local runtime counts as ready without a key — and a supplier only with ITS OWN key on file', /p\.keyOptional \|\| !!tailOf\(p\)/.test(chatJs) && /settings\.keyTails/.test(chatJs));
  check('the page SHOWS the premium tier\'s meter (v2.51 sent `spend`, nothing displayed it): money when a quote is held, tokens and "no price list" when not, nothing for a local model',
    /d\.spend/.test(chatJs) && /עלות משוערת/.test(chatJs) && /אין בידינו מחירון/.test(chatJs) && /sp\.provider !== 'local' && sp\.provider !== 'browser'/.test(chatJs));
  check('off rows stay clickable (no disabled attr)', !/disabled/.test(chatJs.match(/renderSettings[\s\S]*?syncProviderUI\(\);\s*\}/)[0]));
  check('screen title dropped the Grokin label', !/Grokin/.test(copilotSrc.match(/adminNav\([^)]*\)/g).join(' ')));

  // ── the copilot drawer in the builder (v1.71, Ben: "grasp the situation…
  //    adding text to a selected item, help in the page builder") ──
  const panel = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-copilot-panel.js'), 'utf8');
  const builderRoute = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'pages-builder.js'), 'utf8');
  const builderJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-builder.js'), 'utf8');
  try { new Function(panel); check('admin-copilot-panel.js parses', true); }
  catch (e) { check('admin-copilot-panel.js parses (' + e.message + ')', false); }
  check('builder has the 🤖 button + loads the drawer',
    /id="btn-copilot"/.test(builderRoute) && /<script src="\/admin-copilot-panel\.js">/.test(builderRoute));
  check('chat route accepts builder context (page + selected item)',
    // v2.52 — the situation's head is ONE constant in ai.js (SITUATION_MARK): it is also where a billing supplier's
    // cache cuts the system text, so the route and the wire must not each own a copy of it. (Read from the source:
    // requiring src/ai up here would bind the whole CMS to the real checkout — TAPUZ_ROOT is set further down.)
    /b\.context/.test(copilotSrc) && /SITUATION_MARK \+ ' — /.test(copilotSrc) &&
    /const SITUATION_MARK = '[^']*## המצב עכשיו'/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'ai.js'), 'utf8')) && /הפריט המסומן/.test(copilotSrc));
  check('context strings are length-capped (no prompt-stuffing)',
    /slice\(0, 200\)/.test(copilotSrc) && /slice\(0, 280\)/.test(copilotSrc));
  check('drawer sends page + selection context each turn',
    /context: ctx/.test(panel) && /ctx\.selected = sel/.test(panel) && /pageFullPath\(\)/.test(panel));
  check('builder exposes the selection to the drawer',
    /_getSelected/.test(builderJs) && /_getSelected/.test(panel));
  check('canvas is autosaved BEFORE the copilot reads/edits',
    /savePage\(\{ silent: true \}\)/.test(panel));
  check('writes stop at the approve card; approval reloads the draft',
    /renderApproval/.test(panel) && /approve: \{ id: p\.id, ok: ok \}/.test(panel) && /location\.reload\(\)/.test(panel));
  check('drawer talks only to our own chat endpoint',
    !/https?:\/\//.test(panel) && /\/admin\/api\/ai\/chat/.test(panel));

  // ── v2.32: the copilot page carries the builder (Ben: "put pagebuilder
  //    also in the page… dropdown menu any of the current pages… update in
  //    realtime when we use the robot, it cannot be separated") ──
  try { new Function(chatJs); check('admin-chat.js parses', true); }
  catch (e) { check('admin-chat.js parses (' + e.message + ')', false); }
  const chatRoute = copilotSrc.slice(copilotSrc.indexOf("router.get('/admin/chat'"));
  const PAGE_IDS = ['cp-page-select', 'cp-window', 'btn-stage-preview', 'cp-open-full', 'cp-new-chat',
    'cp-canvas-empty', 'cp-canvas-frame', 'cp-proposal', 'cp-tabs', 'chat-settings',
    'ai-provider-radios', 'ai-model', 'ai-model-free', 'ai-local-row', 'ai-base', 'ai-key', 'ai-key-state',
    'ai-save', 'ai-settings-status', 'chat-log', 'chat-input', 'btn-send', 'chat-status'];
  check('/admin/chat markup carries every v2.32 id (canvas, proposal, chip, tabs) and every settings id it always had',
    PAGE_IDS.every((id) => new RegExp('id="' + id + '"').test(chatRoute)));
  check('the dropdown starts blank and groups drafts from published',
    /— קנבס ריק —/.test(chatRoute) && /label="טיוטות"/.test(chatJs) && /label="פורסמו"/.test(chatJs));
  check('the empty state tells the owner what the canvas is for',
    /הקנבס ריק\. בחרו דף מהרשימה למעלה — או תארו לקופיילוט דף חדש, והוא יופיע כאן לפני האישור ואחריו\./.test(chatRoute));
  check('the layout is chat (right) + canvas (left): the contract grid',
    /grid-template-columns:minmax\(340px,420px\) minmax\(0,1fr\)/.test(chatRoute) && /height:calc\(100vh - 110px\)/.test(chatRoute));
  check('the canvas is the REAL builder, embedded (?embed=copilot), never a look-alike',
    /\?embed=copilot/.test(chatJs) && /\/admin\/edit\/' \+ encodeURIComponent\(loadedPath\)/.test(chatJs));
  check('the proposal is rendered by the CMS compiler into a sandboxed frame — never painted into the builder',
    /\/admin\/api\/pzn\/preview/.test(chatJs) && /sandbox="allow-same-origin"/.test(chatRoute) && /srcdoc/.test(chatJs));
  check('a document that fails the check is refused with the fix line',
    /הקופיילוט הציע מסמך שלא עובר את הבדיקה — דחו ובקשו תיקון/.test(chatJs));
  check('👁 תצוגה חיה reuses the builder\'s own responsive preview', /openResponsivePreview/.test(chatJs));
  check('the canvas is autosaved BEFORE every send and every approve', /savePage\(\{ silent: true \}\)/.test(chatJs));
  check('the page NEVER saves or publishes on its own (writes stay behind the gate)',
    !/\/admin\/save/.test(chatJs) && !/\/admin\/api\/pzn\/source/.test(chatJs) && !/\/admin\/publish/.test(chatJs));
  check('history never gets an empty assistant turn (memo stands in; no `d.reply || \'\'` push)',
    /d\.reply \|\| d\.memo/.test(chatJs) && !/content: d\.reply \|\| ''/.test(chatJs));
  check('an unanswered proposal is told to the model, history is capped, a reset button exists',
    /\(הצעה קודמת לא נענתה\)/.test(chatJs) && /HISTORY_CAP = 40/.test(chatJs) && /cp-new-chat/.test(chatJs));
  // (pin updated in v2.43: the canvas has a third state — the menu)
  check('the page sends canvas + surface context and the bridge\'s window hint',
    /surface: 'copilot'/.test(chatJs) && /canvas: menuOpen \? 'menu' : \(loadedPath \? 'page' : 'blank'\)/.test(chatJs) && /bridge\.window/.test(chatJs));
  check('the window chip reads GET /admin/api/ai/window and follows d.window after every turn',
    /\/admin\/api\/ai\/window/.test(chatJs) && /הפנייה האחרונה/.test(chatJs) && /d\.window/.test(chatJs));
  check('errors print the fix line; an old bridge gets the 0.5.0 nudge',
    /e\.fix/.test(chatJs) && /צריך ' \+ BRIDGE_MIN/.test(chatJs) && /BRIDGE_MIN = '0\.5\.0'/.test(chatJs));
  check('one in-flight turn per page + beforeunload while driving or proposing',
    /inflight/.test(chatJs) && /beforeunload/.test(chatJs) && /הקופיילוט עובד על הדף/.test(chatRoute));
  check('the route composes systemFor(tier) — the door picks the tier from the window',
    /systemFor/.test(copilotSrc) && /tier/.test(copilotSrc) && /window: readWindowHint\(b\.window\)/.test(copilotSrc));
  check('the route knows a blank canvas and the copilot surface',
    /הקנבס ריק/.test(copilotSrc) && /רואה את הדף בקנבס לידך/.test(copilotSrc) && /surface === 'copilot'/.test(copilotSrc));
  check('GET /admin/api/ai/window exists behind the gate',
    /router\.get\('\/admin\/api\/ai\/window', requireAdmin/.test(copilotSrc));
  // one planner: the chip must read the SAME cache the turn plans against
  // (same key, same probe TTL, same hint-forgetting) — the route's own
  // planner serves only the setup screen's ?provider= override
  check('the saved provider\'s window is planned by the door itself (ai.planWindow), the override by the route',
    /override \? await planWindowAs\(hint, override\) : await require\('\.\.\/ai'\)\.planWindow\(\{ hint \}\)/.test(copilotSrc));
  check('the page treats a bridge probe that settled before it ran as settled (no 3 s stall, no empty chip)',
    /bridge\.window \|\| bridge\.windowSettled/.test(chatJs));
  // (pin updated in v2.43: an open MENU canvas is not an empty canvas)
  check('an empty canvas follows the first page the robot read — even when the same turn proposes',
    /if \(!loadedPath && !menuOpen && Array\.isArray\(d\.reads\) && d\.reads\[0\]\) \{/.test(chatJs));

  // ── v2.43: the canvas shows the MENU (Ben: "i want the copilot to show
  //    canvas of the menu when needed, it requires particular kind of
  //    programming") ──
  const MENU_IDS = ['cp-menu-canvas', 'cp-menu-preview', 'cp-menu-status', 'cp-menu-frame', 'cp-proposal-menu', 'cp-proposal-menu-preview', 'cp-proposal-menu-warn'];
  check('/admin/chat markup carries the menu canvas and the menu proposal strip', MENU_IDS.every((id) => new RegExp('id="' + id + '"').test(chatRoute)));
  check('the menu frame keeps the page proposal\'s sandbox — same-origin for the site\'s css, NO scripts',
    /<iframe id="cp-menu-frame" sandbox="allow-same-origin"/.test(chatRoute) && !/id="cp-menu-frame"[^>]*allow-scripts/.test(chatRoute));
  check('"🧭 תפריט האתר" sits in the dropdown beside the pages, under a key no page can carry (deriveSlug strips the colon)',
    /const MENU_KEY = '::menu::'/.test(chatJs) && /🧭 תפריט האתר/.test(chatJs) &&
    require('../src/pzn/intent').deriveSlug('::menu::') !== '::menu::' && require('../src/pzn/intent').deriveSlug('__menu__') === '__menu__');
  check('the menu canvas reads GET /admin/api/menus/state and frames the REAL header (a fresh preview id every load)',
    /\/admin\/api\/menus\/state/.test(chatJs) && /\$\('cp-menu-frame'\)\.src = /.test(chatJs) && /loadMenuCanvas/.test(chatJs));
  check('ONE renderer for the organizer\'s preview on both screens: the injection card\'s, loaded but never mounted here',
    /<script src="\/admin-inject-card\.js"><\/script>/.test(chatRoute) && /TapuzInjectCard\.renderPreview/.test(chatJs) && !/TapuzInjectCard\.mount/.test(chatJs));
  const cardJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-inject-card.js'), 'utf8');
  check('…which draws model-written labels with textContent only, and brings its own stylesheet when called unmounted',
    /function renderPreview\(box, preview\) \{[\s\S]{0,400}ensureCss\(\);/.test(cardJs) && !/innerHTML/.test(cardJs.slice(cardJs.indexOf('function renderTree'), cardJs.indexOf('function renderWarnings'))));
  check('a menu proposal is drawn from pending.preview — what the DOOR judged — never re-parsed in the browser\'s name',
    /function showMenuProposal\(p, answerable\)/.test(chatJs) && /const preview = p\.preview \|\| \{\}/.test(chatJs) && /proposalFrame\.src = String\(preview\.previewUrl\)/.test(chatJs));
  check('srcdoc is cleared before src is set (srcdoc wins over src) and both are cleared on hide',
    /proposalFrame\.removeAttribute\('srcdoc'\); \/\/ srcdoc wins over src/.test(chatJs) &&
    /function hideProposal\(\) \{\s*proposal\.hidden = true;\s*proposalFrame\.removeAttribute\('src'\);\s*proposalFrame\.removeAttribute\('srcdoc'\);/.test(chatJs));
  check('the approval says the TRUTH per tool: a page is a draft, a menu is LIVE with a backup (screen, overlay and drawer)',
    /אישור <b>מחיל את התפריט על האתר החי<\/b>/.test(chatJs) && /✓ אשר והחל על האתר/.test(chatJs) &&
    /אישור <b>מחיל את התפריט על האתר החי<\/b> — לא טיוטה/.test(chatRoute) &&
    /p\.tool === 'organize_menu'/.test(panel) && /✓ אשר — החל על האתר \(עם גיבוי\)/.test(panel));
  check('after a menu lands the drawer does NOT reload the builder (the page\'s draft never moved)',
    /if \(d\.applied && d\.applied\.organized\) \{[\s\S]{0,420}return;\s*\}/.test(panel));
  check('the way back is the OWNER\'s click (restore route, only inside undoMenu) — the copilot has no undo tool',
    (chatJs.match(/api\('\/admin\/api\/menus\/restore'/g) || []).length === 1 && /async function undoMenu\(backupId, btn\)[\s\S]{0,400}api\('\/admin\/api\/menus\/restore'/.test(chatJs) && /data-undo="1"/.test(chatJs));
  check('a mere read_menus opens the menu only into an EMPTY canvas; a menu PROPOSAL opens it under the overlay (the draft saved first)',
    /if \(!loadedPath && !menuOpen && fresh\.includes\('read_menus'\)\) selectPage\(MENU_KEY\);/.test(chatJs) &&
    /if \(!menuOpen\) saveCanvas\(\)\.then\(/.test(chatJs));
  check('the route knows the menu canvas ("סדר את זה" = the menu) and says the owner sees the MENU beside the chat',
    /ctx\.canvas === 'menu' \? 'menu'/.test(copilotSrc) && /התפריט של האתר פתוח בקנבס/.test(copilotSrc) && /רואה את התפריט בקנבס לידך/.test(copilotSrc));
  check('a window too small for the menu tools is SAID, once, where it matters (the menu open / a menu ask) — never a silent "cannot"',
    /function noteMenuToolsOff\(\)/.test(chatJs) && /if \(!menuOpen && !\/תפריט\|menu\/i\.test\(lastUserMessage\)\) return;/.test(chatJs) &&
    /החלון של המודל קטן מדי לכלי התפריט/.test(chatJs) && /d\.window\.menuTools === false/.test(chatJs) && /d\.menuTools === false/.test(chatJs));
  check('the route builds systemFor(tier, {menus}) — the door decides, the briefing AND the situation follow',
    /const systemFor = \(tier, o\) => \{/.test(copilotSrc) && /const menuLine = canvas === 'menu' \? \(menus \? MENU_ON : MENU_OFF\) : '';/.test(copilotSrc) &&
    /pickCopilotTier/.test(copilotSrc));
  // GATE 3 (the weaker mode must not break): a tool-less model PRINTS the
  // menu; before v2.43 the `<bent-` test took it for a page and lit "צור דף"
  check('GATE 3 — weaker mode: a <bent-menus> document in a plain reply is recognised as a MENU, judged by the never-writes preview route, shown closable — never offered as a page',
    /function carriesMenuDocument\(reply\)/.test(chatJs) && /if \(carriesMenuDocument\(reply\)\) \{\s*return '<div class="actions">'/.test(chatJs) &&
    /if \(!d\.pending && carriesMenuDocument\(d\.reply\)\) \{\s*previewMenuReply\(d\.reply\);\s*\} else if/.test(chatJs) &&
    /\/admin\/api\/menus\/preview/.test(chatJs) && /showMenuProposal\(\{ tool: 'organize_menu', preview: d\.preview, warnings: d\.warningTexts \|\| \[\] \}, false\)/.test(chatJs));
  {
    // run the two classifiers exactly as the page has them
    const grab = (name) => new Function('return (' + chatJs.slice(chatJs.indexOf('function ' + name + '(')).match(/^function [\s\S]*?\n  \}/)[0] + ')')();
    const isMenu = grab('carriesMenuDocument');
    const MENU_REPLY = 'הנה הסדר המוצע:\n<bent-menus version="1"><bent-menu name="main"><bent-link label="הבית" page="home" /></bent-menu></bent-menus>';
    check('…the classifier: a menu document is a menu, a page is not, prose is not',
      isMenu(MENU_REPLY) === true && isMenu('<!DOCTYPE html><html><body><bent-hero id="h"></bent-hero></body></html>') === false && isMenu('סדרו: הבית, אודות, צור קשר') === false);
  }
}

// the EXACT body LM Studio answers with when the prompt is ≥ 2× the window
// (map.md) — n_prompt_tokens / n_ctx are what the door learns from
const EXCEED = {
  error: {
    code: 400,
    message: 'request (17246 tokens) exceeds the available context size (8192 tokens), try increasing it',
    type: 'exceed_context_size_error', n_prompt_tokens: 17246, n_ctx: 8192
  }
};
const PROPOSED = '<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n<head><meta charset="utf-8"/>' +
  '<title>אתר בדיקה</title><meta name="bent-slug" content="home"/></head>\n<body>\n' +
  '  <bent-heading id="h1" level="1">שלום מהקופיילוט</bent-heading>\n</body></html>';
const toolCall = (id, name, args) => ({
  choices: [{
    finish_reason: 'tool_calls',
    message: { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
  }]
});
const parse = (r) => { try { return JSON.parse(r.text); } catch (e) { return null; } };

function req(method, urlPath, { form, json, cookie, host } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'text/html', Origin: BASE };
    if (form != null) {
      data = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (json != null) {
      data = JSON.stringify(json);
      headers['Content-Type'] = 'application/json';
    }
    if (cookie) headers['Cookie'] = cookie;
    if (host) headers['Host'] = host; // the site as the owner's browser named it
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      res.setEncoding('utf8'); // Hebrew bodies: don't let a chunk boundary split a multi-byte char
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: buf }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function waitUp(tries = 40) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      http.get(BASE + '/', () => resolve()).on('error', () => {
        if (n <= 0) return reject(new Error('server did not start'));
        setTimeout(() => tick(n - 1), 150);
      });
    };
    tick(tries);
  });
}

(async () => {
  process.env.TAPUZ_ROOT = ROOT;
  require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'אתר בדיקה', description: 'copilot-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    // three pages since v2.43: a menu needs something to re-order
    menuPlacement: 'top', pages: ['home', 'about', 'contact'], menuPages: ['home', 'about', 'contact'], external: []
  });
  const { createAdmin } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    // ── /admin/ai (the keyless paste flow) ──
    const ai = await req('GET', '/admin/ai', { cookie });
    check('GET /admin/ai → 200 with the paste-flow UI + client script', ai.status === 200 && /id="paste-box"/.test(ai.text) && /\/admin-ai\.js/.test(ai.text));

    // ── /admin/inject (the copy-the-pack screen) ──
    const inject = await req('GET', '/admin/inject', { cookie });
    check('GET /admin/inject → 200 with the pack-copy UI + client script', inject.status === 200 && /id="btn-roleplay"/.test(inject.text) && /\/admin-inject\.js/.test(inject.text));

    // ── the dictionary /admin/inject's "copy dictionary" button fetches ──
    // v1.37: this endpoint was registered TWICE in server.js, and Express's
    // first-match rule silently served the OLDER block-registry dictionary
    // while every other agent surface (inject-pack, agent-bridge, roleplay)
    // used the pzn one. Pin WHICH dictionary answers, so a re-added shadowing
    // registration can't quietly downgrade the pack again.
    const { buildDictionary, toMarkdown, toAgentTools } = require('../src/pzn/syntax-dictionary');
    const dictMd = await req('GET', '/admin/api/syntax-dictionary.md', { cookie });
    // the header carries a generation timestamp — normalize it away before comparing
    const stamp = (s) => s.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<ts>');
    check('GET /admin/api/syntax-dictionary.md → the pzn dictionary (not the block-registry one)',
      dictMd.status === 200 && stamp(dictMd.text) === stamp(toMarkdown(buildDictionary())));
    const dictJson = await req('GET', '/admin/api/syntax-dictionary', { cookie });
    let dict = null;
    try { dict = JSON.parse(dictJson.text); } catch (e) { /* leave null → check fails */ }
    check('GET /admin/api/syntax-dictionary → pzn JSON carrying the agent tools[]',
      dictJson.status === 200 && dict && dict.ok === true && Array.isArray(dict.tools) && dict.tools.length === toAgentTools().length);

    // ── v2.34: the bridge ZIP is wired to the site that served it ──
    // (a STORE zip: manifest.json sits in the body as plain JSON text)
    {
      const manifestOf = (r) => {
        const at = r.text.indexOf('{\n  "manifest_version"');
        try { return JSON.parse(r.text.slice(at, r.text.indexOf('\n}\n', at) + 2)); } catch (e) { return null; }
      };
      const hosted = await req('GET', '/admin/ai-setup/extension-bridge-chrome.zip', { cookie, host: 'owner-site.example.com' });
      const hm = manifestOf(hosted);
      check('bridge ZIP downloaded from a hosted name carries that site: content script + host permission',
        hosted.status === 200 && !!hm &&
        hm.host_permissions.includes('*://owner-site.example.com/*') &&
        hm.content_scripts.length === 1 && hm.content_scripts[0].matches.join() === '*://owner-site.example.com/*');
      const ff = await req('GET', '/admin/ai-setup/extension-bridge-firefox.zip', { cookie, host: 'owner-site.example.com:8443' });
      const fm = manifestOf(ff);
      check('the Firefox build is wired too, and the port never reaches the pattern',
        ff.status === 200 && !!fm && !!fm.browser_specific_settings &&
        fm.content_scripts[0].matches.join() === '*://owner-site.example.com/*' && !JSON.stringify(fm).includes('8443'));
      const local = await req('GET', '/admin/ai-setup/extension-bridge-chrome.zip', { cookie });
      const lm = manifestOf(local);
      check('a loopback download wires nothing (the popup connects a local site)',
        local.status === 200 && !!lm && !lm.content_scripts && lm.host_permissions.every((h) => /localhost|127\.0\.0\.1/.test(h)));
      const setupHosted = await req('GET', '/admin/ai-setup', { cookie, host: 'owner-site.example.com' });
      const setupLocal = await req('GET', '/admin/ai-setup', { cookie });
      check('the setup page tells a hosted site its ZIP arrives connected, and a local one to use the popup',
        setupHosted.status === 200 && setupHosted.text.includes('Bridge V2 מגיע מחובר לאתר הזה') &&
        setupLocal.status === 200 && setupLocal.text.includes('Bridge V2 באתר מקומי') && !setupLocal.text.includes('מגיע מחובר לאתר הזה'));
      const byot = await req('GET', '/admin/ai-setup/extension-byot-chrome.zip', { cookie, host: 'owner-site.example.com' });
      check('the copy companion is never wired to the site', byot.status === 200 && !byot.text.includes('owner-site.example.com'));
    }

    // ── /admin/agent (the extension pairing screen) ──
    const agent = await req('GET', '/admin/agent', { cookie });
    check('GET /admin/agent → 200 with the token UI + client script',
      agent.status === 200 && /id="tok-create"/.test(agent.text) && /\/admin-agent\.js/.test(agent.text));

    // ── /admin/chat (the BYOK copilot) ──
    const chat = await req('GET', '/admin/chat', { cookie });
    check('GET /admin/chat → 200 with the composer + key panel + client script',
      chat.status === 200 && /id="btn-send"/.test(chat.text) && /id="ai-key"/.test(chat.text) && /\/admin-chat\.js/.test(chat.text));

    // ── the pack /admin/inject's buttons fetch ──
    const pack = await req('GET', '/admin/api/inject-pack', { cookie });
    let bundle = null;
    try { bundle = JSON.parse(pack.text); } catch (e) { /* leave null → check fails */ }
    check('GET /admin/api/inject-pack → the JSON bundle the inject page renders',
      pack.status === 200 && bundle && typeof bundle === 'object');
    const packRoleplay = await req('GET', '/admin/api/inject-pack?format=roleplay', { cookie });
    check('inject-pack?format=roleplay → markdown, not JSON',
      packRoleplay.status === 200 && /markdown/.test(String(packRoleplay.headers['content-type'])) && packRoleplay.text.length > 500);

    // ── the BYOK key surface must never hand the key back ──
    const aiSettings = await req('GET', '/admin/api/ai/settings', { cookie });
    let s = null;
    try { s = JSON.parse(aiSettings.text); } catch (e) { /* leave null → check fails */ }
    check('GET /admin/api/ai/settings → ok, with providers and NO apiKey echoed back',
      aiSettings.status === 200 && s && s.ok === true && Array.isArray(s.providers) && !('apiKey' in s));

    // ── v2.52 — through the real routes: Gemini is on the list the screens draw themselves from, and a key is
    //    filed under the supplier it was pasted for — it does not follow the owner to the next one ──
    const gem = ((s && s.providers) || []).find((p) => p.id === 'gemini');
    check('the settings route lists Gemini with the page where a key is made and what its free tier means',
      !!gem && gem.keyUrl === 'https://aistudio.google.com/apikey' && /חינמית/.test(gem.note || '') && gem.models.includes(gem.defaultModel));
    const setGem = await req('POST', '/admin/api/ai/settings', { cookie, json: { provider: 'gemini', model: 'gemini-3.8-flash', apiKey: 'G-ROUTE-TEST-7777' } });
    const afterGem = JSON.parse(setGem.text);
    check('a key pasted for Gemini is filed under Gemini: the echo is tails only, never the key',
      setGem.status === 200 && afterGem.hasKey === true && afterGem.keyTails && afterGem.keyTails.gemini === '7777' && !/ROUTE-TEST/.test(setGem.text));
    const toClaude = JSON.parse((await req('POST', '/admin/api/ai/settings', { cookie, json: { provider: 'claude', model: 'claude-sonnet-5' } })).text);
    check('switching to Claude with an EMPTY key field (the card\'s "keep the stored key") leaves Claude without a key — Google\'s key stays Google\'s',
      toClaude.provider === 'claude' && toClaude.hasKey === false && toClaude.keyTail === '' && toClaude.keyTails.gemini === '7777' && !toClaude.keyTails.claude);
    const chatNoKey = await req('POST', '/admin/api/ai/chat', { cookie, json: { message: 'שלום', context: { canvas: 'blank', surface: 'copilot' } } });
    check('…and a turn on Claude is refused for want of ITS key (NO_PROVIDER) instead of leaving with another supplier\'s', chatNoKey.status === 400 && /"code":"NO_PROVIDER"/.test(chatNoKey.text));
    await req('POST', '/admin/api/ai/settings', { cookie, json: { provider: 'gemini', apiKey: '' } }); // leave no key behind for the checks below

    // ── all four screens are behind the admin gate ──
    const aiNoAuth = await req('GET', '/admin/ai', {});
    check('/admin/ai is not reachable unauthenticated', aiNoAuth.status !== 200 || !/id="paste-box"/.test(aiNoAuth.text));
    const injectNoAuth = await req('GET', '/admin/inject', {});
    check('/admin/inject is not reachable unauthenticated', injectNoAuth.status !== 200 || !/id="btn-roleplay"/.test(injectNoAuth.text));
    const agentNoAuth = await req('GET', '/admin/agent', {});
    check('/admin/agent is not reachable unauthenticated', agentNoAuth.status !== 200 || !/id="tok-create"/.test(agentNoAuth.text));
    const chatNoAuth = await req('GET', '/admin/chat', {});
    check('/admin/chat is not reachable unauthenticated', chatNoAuth.status !== 200 || !/id="ai-key"/.test(chatNoAuth.text));
    const settingsNoAuth = await req('GET', '/admin/api/ai/settings', {});
    check('/admin/api/ai/settings is not reachable unauthenticated', settingsNoAuth.status !== 200);

    // ── the browser-relay provider (extension-v2a): the tool loop pauses at
    //    each model call and resumes with the output the page relays back ──
    const setBrowser = await req('POST', '/admin/api/ai/settings', { cookie, json: { provider: 'browser' } });
    check('provider "browser" is saveable (no key, no baseUrl)',
      setBrowser.status === 200 && /"provider":"browser"/.test(setBrowser.text));

    const turn1 = await req('POST', '/admin/api/ai/chat', { cookie, json: { message: 'שלום', history: [] } });
    const call = (() => { try { return JSON.parse(turn1.text).modelCall; } catch (e) { return null; } })();
    check('a chat turn answers with a modelCall continuation (id + body)',
      !!(call && call.id && call.body));
    check('the relayed body is openai-chat shaped with the system briefing first',
      !!(call && call.body.messages && call.body.messages[0].role === 'system' &&
         /תפוזיאל|BenTML|bent-/i.test(call.body.messages[0].content)));
    check('the relayed body carries the tool definitions',
      !!(call && Array.isArray(call.body.tools) && call.body.tools.length));
    // the C1 lesson (gemma-4-31b, 2026-09-16): with no briefing the model
    // invents a ```bentml dialect with zero bent-* tags; with it, it builds
    // the page. The relayed system message is the FULL briefing — the leaf
    // rule included — never a bare user message.
    check('the relayed briefing teaches leaf modules (E_NOT_CONTAINER + the self-closing mediacard)',
      !!(call && /E_NOT_CONTAINER/.test(call.body.messages[0].content) &&
         call.body.messages[0].content.includes('<bent-mediacard id="c1" title="…" excerpt="…" />')));
    check('the relayed call carries reasoning_effort:none (hybrid-thinking models must answer)',
      !!(call && call.body.reasoning_effort === 'none'));
    check('a modelCall rides with the local model\'s 20-minute ceiling for the page (timeoutMs)',
      (() => { try { return JSON.parse(turn1.text).timeoutMs === 20 * 60 * 1000; } catch (e) { return false; } })());

    const turn2 = await req('POST', '/admin/api/ai/chat', {
      cookie,
      json: { step: { id: call ? call.id : 'x', result: { choices: [{ message: { content: 'שלום! אני המודל המקומי.' } }] } } }
    });
    const done = (() => { try { return JSON.parse(turn2.text); } catch (e) { return null; } })();
    check('handing the model output back completes the turn with the reply',
      !!(done && done.ok && /המודל המקומי/.test(done.reply || '')));

    const replay = await req('POST', '/admin/api/ai/chat', {
      cookie,
      json: { step: { id: call ? call.id : 'x', result: { choices: [] } } }
    });
    check('a step id is single-use (replay is refused)', replay.status !== 200);

    // server-initiated generation must refuse this provider honestly —
    // the visitor CS chat has no browser to relay through
    let genErr = '';
    try { await require('../src/ai').generate({ system: 'x', user: 'y' }); }
    catch (e) { genErr = e.message; }
    check('generate() refuses the browser provider with the honest error', /דרך הדפדפן/.test(genErr));

    // ── v2.32: the window. Ben's request died on `request (17246 tokens)
    //    exceeds the available context size (8192 tokens)` — the briefing
    //    alone is ~15K tokens and nothing asked the runtime what it loaded.
    //    Now the page's hint (the bridge probed LM Studio) picks the tier. ──
    const small = parse(await req('POST', '/admin/api/ai/chat', {
      cookie, json: { message: 'שלום', history: [], context: { canvas: 'blank', surface: 'copilot' }, window: { tokens: 8192, source: 'bridge' } }
    }));
    const smallCall = small && small.modelCall;
    check('an 8K window hint → the COMPACT briefing (< 12,000 chars) and a 2,048-token reply reserve',
      !!(smallCall && smallCall.body.messages[0].content.length < 12000 && smallCall.body.max_tokens === 2048));
    check('…and the response says so (window.tier compact)', !!(small && small.window && small.window.tier === 'compact'));
    check('the blank-canvas situation rides the compact briefing too',
      !!(smallCall && /הקנבס ריק/.test(smallCall.body.messages[0].content) && /רואה את הדף בקנבס לידך/.test(smallCall.body.messages[0].content)));

    const big = parse(await req('POST', '/admin/api/ai/chat', {
      cookie, json: { message: 'שלום', history: [], window: { tokens: 32768, source: 'bridge' } }
    }));
    const bigCall = big && big.modelCall;
    check('a 32K window hint → the FULL dictionary (> 40,000 chars) and a 4,096-token reserve',
      !!(bigCall && bigCall.body.messages[0].content.length > 40000 && bigCall.body.max_tokens === 4096));
    check('…window.tier full', !!(big && big.window && big.window.tier === 'full'));

    // v2.43 — a tool the window cannot answer is not declared: the 8K owner
    // keeps exactly what v2.42 gave them (the pair would have pushed this
    // very window to WINDOW_TOO_SMALL once the ratio recalibrated), and the
    // 32K owner gets the menus
    check('an 8K window → the four page tools only, a briefing with not a word about menus, window.menuTools false',
      !!(smallCall && smallCall.body.tools.map((t) => t.function.name).join() === 'list_pages,read_page,create_page,edit_page' &&
         !/read_menus|organize_menu/.test(smallCall.body.messages[0].content) && small.window.menuTools === false));
    check('a 32K window → all six tools, the briefing teaches the menus, window.menuTools true',
      !!(bigCall && bigCall.body.tools.length === 6 && /`organize_menu`/.test(bigCall.body.messages[0].content) && big.window.menuTools === true));
    const smallMenu = parse(await req('POST', '/admin/api/ai/chat', {
      cookie, json: { message: 'סדר את התפריט', history: [], context: { canvas: 'menu', surface: 'copilot' }, window: { tokens: 8192, source: 'bridge' } }
    }));
    const smallMenuSys = (smallMenu && smallMenu.modelCall && smallMenu.modelCall.body.messages[0].content) || '';
    check('…and with the MENU open at 8K the model is told the truth — it cannot touch the menu here, describe and point to Context Length / the editor — never to call a tool it was not given',
      /קטן מדי לכלי התפריט/.test(smallMenuSys) && /Context Length/.test(smallMenuSys) && !/read_menus ואז organize_menu/.test(smallMenuSys) &&
      smallMenu.modelCall.body.tools.length === 4 && smallMenuSys.length < 12000);
    const winSmall = parse(await req('GET', '/admin/api/ai/window?tokens=8192&source=bridge', { cookie }));
    const winBig = parse(await req('GET', '/admin/api/ai/window?tokens=32768&source=bridge', { cookie }));
    check('the window endpoint answers the same question for the chip: menuTools false at 8K, true at 32K',
      !!winSmall && winSmall.menuTools === false && winSmall.tier === 'compact' && !!winBig && winBig.menuTools === true);

    const none = parse(await req('POST', '/admin/api/ai/chat', { cookie, json: { message: 'שלום', history: [] } }));
    check('no hint → compact (an unknown window NEVER promotes to the full dictionary)',
      !!(none && none.modelCall && none.modelCall.body.messages[0].content.length < 12000 && none.window && none.window.tier === 'compact'));

    // the exceed error, relayed back as the step result → the door learns
    // 8,192, tiers down and hands the page a NEW call with a notice
    const shrunk = parse(await req('POST', '/admin/api/ai/chat', { cookie, json: { step: { id: bigCall ? bigCall.id : 'x', result: EXCEED } } }));
    check('the exact exceed body as a step → 200 with a NEW modelCall (shrink-and-retry, not an error)',
      !!(shrunk && shrunk.ok && shrunk.modelCall && shrunk.modelCall.id !== bigCall.id &&
         shrunk.modelCall.body.messages[0].content.length < 12000));
    check('…with the Hebrew notice ("מקצר… ומנסה שוב")', !!(shrunk && /מקצר/.test(shrunk.notice || '')));

    // any other provider error body → PROVIDER_ERROR in Hebrew, never a silent ''
    const boom = await req('POST', '/admin/api/ai/chat', { cookie, json: { step: { id: shrunk && shrunk.modelCall ? shrunk.modelCall.id : 'x', result: { error: { message: 'boom' } } } } });
    const boomD = parse(boom);
    check('a provider error body → 400 "שגיאת המודל המקומי: boom" with code PROVIDER_ERROR',
      boom.status === 400 && !!boomD && /שגיאת המודל המקומי: boom/.test(boomD.error || '') && boomD.code === 'PROVIDER_ERROR');

    // the tool loop over the relay: list_pages → the next call carries the
    // assistant tool_calls turn AND our role:'tool' answer
    const t1 = parse(await req('POST', '/admin/api/ai/chat', {
      cookie, json: { message: 'ערוך את דף הבית', history: [], context: { page: 'home', canvas: 'page', surface: 'copilot' }, window: { tokens: 8192, source: 'bridge' } }
    }));
    const t2 = parse(await req('POST', '/admin/api/ai/chat', { cookie, json: { step: { id: t1 && t1.modelCall ? t1.modelCall.id : 'x', result: toolCall('c1', 'list_pages', {}) } } }));
    const t2msgs = (t2 && t2.modelCall && t2.modelCall.body.messages) || [];
    check('a list_pages tool call → the next modelCall carries a role:"tool" answer',
      t2msgs.some((m) => m.role === 'tool') && t2msgs.some((m) => m.role === 'assistant' && Array.isArray(m.tool_calls)));

    // an edit_page call → a pending with the FULL proposed document (the
    // page renders it before the gate) and a memo the history can keep
    const publishedBefore = parse(await req('GET', '/admin/api/pzn/source?fullPath=home&kind=published', { cookie }));
    const t3 = parse(await req('POST', '/admin/api/ai/chat', { cookie, json: { step: { id: t2 && t2.modelCall ? t2.modelCall.id : 'x', result: toolCall('c2', 'edit_page', { slug: 'home', source: PROPOSED }) } } }));
    check('an edit_page call → pending with input.source (previewable) and the memo "הצעתי…"',
      !!(t3 && t3.pending && t3.pending.tool === 'edit_page' && t3.pending.input && t3.pending.input.source === PROPOSED && /הצעתי/.test(t3.memo || '')));

    // approval → the draft is written (applied.edited), the live page untouched
    const ok1 = parse(await req('POST', '/admin/api/ai/chat', { cookie, json: { approve: { id: t3 && t3.pending ? t3.pending.id : 'x', ok: true } } }));
    check('approve → applied.edited on the page "home"',
      !!(ok1 && ok1.ok && ok1.applied && ok1.applied.edited === true && ok1.applied.slug === 'home'));
    if (ok1 && ok1.modelCall) {
      // the model gets to comment after its write — finish that hop
      await req('POST', '/admin/api/ai/chat', { cookie, json: { step: { id: ok1.modelCall.id, result: { choices: [{ message: { content: 'עודכן.' } }] } } } });
    }
    const draftAfter = parse(await req('GET', '/admin/api/pzn/source?fullPath=home', { cookie }));
    const publishedAfter = parse(await req('GET', '/admin/api/pzn/source?fullPath=home&kind=published', { cookie }));
    // the draft is read back through the same serializer that wrote it, so
    // the comparison is whitespace-normalized — but the heading the copilot
    // wrote must be there verbatim, and must NOT be on the live page
    const norm = (s) => String(s || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
    check('the draft source is now the proposed document (with the copilot\'s heading)',
      !!(draftAfter && draftAfter.ok && norm(draftAfter.source) === norm(PROPOSED) && /שלום מהקופיילוט/.test(draftAfter.source)));
    check('the PUBLISHED blocks did not change (a copilot write is a draft, never a publish)',
      !!(publishedBefore && publishedBefore.ok && typeof publishedBefore.source === 'string' &&
         publishedAfter && publishedAfter.ok && publishedBefore.source === publishedAfter.source &&
         !/שלום מהקופיילוט/.test(publishedAfter.source)));

    // ══ v2.43 — THE MENU, and its acceptance gate ═══════════════════════════
    // Ben: "we must make sure that the menu sorter is also included in the ai
    // helper that connects to the api (lm studio or public doesn't matter
    // they will work the same), there are option to sort the menu using the
    // co-pilot". The tester's gap was "advise vs act": the copilot told the
    // order and changed nothing. The gate, pinned here by number on a REAL
    // server over the browser relay (the courier with the most seams):
    //   GATE 1  reads the menus → proposes the order WITH the diff → the
    //           owner's confirm APPLIES it
    //   GATE 2  reject stays chat-only: nothing written, no backup, the model
    //           is told the owner declined (as for a declined edit_page)
    //   GATE 4  after confirm GET /admin/api/menus reflects the new order —
    //           the inject card's separate apply path is never touched
    // (GATE 3, the weaker mode, is pinned statically above and on the wire below.)
    {
      const getMenus = async () => parse(await req('GET', '/admin/api/menus', { cookie }));
      const getBackups = async () => (parse(await req('GET', '/admin/api/menus/backups', { cookie })) || {}).backups || [];
      const targets = (m) => ((m && m.menus && m.menus.main) || []).map((i) => i.target || i.url).join(',');
      const say = (json) => req('POST', '/admin/api/ai/chat', { cookie, json });
      const big = { tokens: 262144, source: 'bridge' };
      const NEW_MENU = [
        '<bent-menus version="1" note="צור קשר לפני אודות">',
        '  <bent-menu name="main" location="main">',
        '    <bent-link label="הבית" page="home" />',
        '    <bent-link label="צרו קשר" page="contact" />',
        '    <bent-link label="אודות" page="about" />',
        '  </bent-menu>',
        '</bent-menus>'
      ].join('\n');

      const menusBefore = await getMenus();
      const rawBefore = JSON.stringify(menusBefore);
      check('(fixture) the site starts with home, about, contact in the header and no menu backups',
        targets(menusBefore) === 'home,about,contact' && (await getBackups()).length === 0);

      // the canvas's own read: today's menu in the PREVIEW's shape
      const stateRes = await req('GET', '/admin/api/menus/state', { cookie });
      const state = parse(stateRes);
      check('GET /admin/api/menus/state → the current menu as a preview: tree, empty diff, fit line, the framed-header url, the backups',
        stateRes.status === 200 && !!state && state.ok && state.preview.menus.main.tree.length === 3 && state.preview.diff.main.moved.length === 0 &&
        !!state.preview.fitLine && /^\/admin\/menus\/preview\/mp_/.test(state.preview.previewUrl) && Array.isArray(state.backups));
      // seen live while building it: a seeded `explore` menu sorted ahead of
      // `main`, and the one menu the owner came to look at was cut off below
      check('…the HEADER\'s menu comes first in the canvas, the footer\'s second, the rest after',
        !!state && Object.keys(state.preview.menus)[0] === 'main' && Object.keys(state.preview.menus)[1] === 'footer');
      check('/admin/api/menus/state is not reachable unauthenticated', (await req('GET', '/admin/api/menus/state', {})).status !== 200);
      check('…and reading it wrote nothing', JSON.stringify(await getMenus()) === rawBefore);

      // GATE 1 — read → propose with the diff
      const m1 = parse(await say({ message: 'סדר את התפריט: צור קשר לפני אודות', history: [], context: { canvas: 'menu', surface: 'copilot' }, window: big }));
      const m1sys = (m1 && m1.modelCall && m1.modelCall.body.messages[0].content) || '';
      check('the menu canvas rides the briefing ("the menu is open in the canvas" → read_menus, then organize_menu)',
        /התפריט של האתר פתוח בקנבס/.test(m1sys) && /read_menus ואז organize_menu/.test(m1sys) && /רואה את התפריט בקנבס לידך/.test(m1sys));
      check('the relayed body declares the menu tools beside the page tools (six, one loop for every courier)',
        !!(m1 && m1.modelCall) && ['list_pages', 'read_page', 'create_page', 'edit_page', 'read_menus', 'organize_menu']
          .every((n) => m1.modelCall.body.tools.some((t) => t.function.name === n)) && m1.modelCall.body.tools.length === 6);
      const m2 = parse(await say({ step: { id: m1 && m1.modelCall ? m1.modelCall.id : 'x', result: toolCall('rm', 'read_menus', {}) } }));
      const rmAnswer = ((m2 && m2.modelCall && m2.modelCall.body.messages) || []).filter((m) => m.role === 'tool' && m.tool_call_id === 'rm').pop();
      const rmOut = rmAnswer ? JSON.parse(rmAnswer.content) : null;
      check('GATE 1 — the copilot READS the current menus: read_menus ran free and answered with the document, the capacity and the page table',
        !!(m2 && m2.ok && !m2.pending && m2.modelCall && m2.used.includes('read_menus')) && !!rmOut &&
        /<bent-link label="[^"]*" page="about" \/>/.test(rmOut.document) && /בשורה אחת נכנסים עד/.test(rmOut.capacity) && /\| contact \|/.test(rmOut.pages));
      const m3 = parse(await say({ step: { id: m2 && m2.modelCall ? m2.modelCall.id : 'x', result: toolCall('om', 'organize_menu', { document: NEW_MENU }) } }));
      const pv = m3 && m3.pending && m3.pending.preview;
      check('GATE 1 — it PROPOSES the order with the DIFF: an approval envelope carrying what moved, what was renamed, the fit line and the frame url',
        !!(m3 && m3.ok && m3.pending && m3.pending.tool === 'organize_menu' && m3.pending.id && !m3.modelCall) && !!pv &&
        pv.diff.main.moved.length > 0 && pv.diff.main.relabeled.some((x) => x[1] === 'צרו קשר') && pv.diff.main.added.length === 0 && pv.diff.main.removed.length === 0 &&
        /✓|⚠/.test(pv.fitLine) && /^\/admin\/menus\/preview\/mp_/.test(pv.previewUrl));
      check('…the approval line says LIVE with a backup (never "draft"), and the memo is what history keeps',
        !!(m3 && m3.pending) && /האתר החי/.test(m3.pending.summary) && /גיבוי/.test(m3.pending.summary) && !/טיוטה/.test(m3.pending.summary) && /הצעתי/.test(m3.memo || ''));
      check('…and while the owner looks at it NOTHING is written and NO backup exists',
        JSON.stringify(await getMenus()) === rawBefore && (await getBackups()).length === 0);

      // the canvas's frame: the candidate on the REAL header, framable only by us
      const frame = await req('GET', pv ? pv.previewUrl : '/admin/menus/preview/none', { cookie });
      const navHtml = frame.text.slice(frame.text.indexOf('<nav'), frame.text.indexOf('</nav>'));
      check('the proposal frame renders the site\'s real page with the CANDIDATE menu, in the candidate order (צרו קשר before אודות)',
        frame.status === 200 && /<nav/.test(frame.text) && navHtml.indexOf('צרו קשר') > -1 && navHtml.indexOf('צרו קשר') < navHtml.indexOf('אודות'));
      check('…same-origin framing only (X-Frame-Options + frame-ancestors), like the theme preview',
        frame.headers['x-frame-options'] === 'SAMEORIGIN' && /frame-ancestors 'self'/.test(String(frame.headers['content-security-policy'] || '')));

      // GATE 2 — reject first: chat-only
      const rj = parse(await say({ approve: { id: m3 && m3.pending ? m3.pending.id : 'x', ok: false } }));
      const rjMsg = ((rj && rj.modelCall && rj.modelCall.body.messages) || []).filter((m) => m.role === 'tool' && m.tool_call_id === 'om').pop();
      check('GATE 2 — REJECT stays chat-only: the menus are byte-identical and NO backup was made',
        !!(rj && rj.ok && !rj.applied) && JSON.stringify(await getMenus()) === rawBefore && (await getBackups()).length === 0);
      check('GATE 2 — …and the model is told the owner declined, in the words a declined edit_page gets',
        !!rjMsg && /"refused":true/.test(rjMsg.content) && /"done":false/.test(rjMsg.content) && /שום דבר לא נשמר/.test(rjMsg.content) && /אל תכתוב\/י שביצעת/.test(rjMsg.content) && /דחה/.test(rj.memo || ''));
      if (rj && rj.modelCall) await say({ step: { id: rj.modelCall.id, result: { choices: [{ message: { content: 'בסדר, לא שיניתי את התפריט.' } }] } } });

      // GATE 4 — a second run, confirmed this time
      const c1 = parse(await say({ message: 'בכל זאת — סדר את התפריט: צור קשר לפני אודות', history: [], context: { canvas: 'menu', surface: 'copilot' }, window: big }));
      const c2 = parse(await say({ step: { id: c1 && c1.modelCall ? c1.modelCall.id : 'x', result: toolCall('om2', 'organize_menu', { document: NEW_MENU }) } }));
      const okM = parse(await say({ approve: { id: c2 && c2.pending ? c2.pending.id : 'x', ok: true } }));
      check('GATE 1 — on the owner\'s CONFIRM the menu ops are APPLIED (applied.organized, the backup\'s id, the fit line)',
        !!(okM && okM.ok && okM.applied && okM.applied.organized === true && okM.applied.tool === 'organize_menu' && okM.applied.backupId && okM.applied.fitLine && okM.applied.rebuildError === ''));
      check('…and the envelope that carries `applied` over the bridge is the one that lets the page show it NOW (v2.42 rule), memo says live + undoable',
        !!(okM && okM.modelCall) && /התפריט עודכן באתר החי/.test(okM.memo || '') && /אפשר לבטל/.test(okM.memo || ''));
      const menusAfter = await getMenus();
      check('GATE 4 — after confirm, /admin/menus (GET /admin/api/menus) reflects the new order WITHOUT the inject-card\'s separate apply path being needed for the happy path',
        targets(menusAfter) === 'home,contact,about' && menusAfter.menus.main[1].label === 'צרו קשר');
      const backupsAfter = await getBackups();
      check('GATE 4 — …and a backup of the old menu exists (reason copilot:organize_menu), the very id the chat\'s ↩ button holds',
        backupsAfter.length === 1 && backupsAfter[0].id === okM.applied.backupId && backupsAfter[0].reason === 'copilot:organize_menu' && backupsAfter[0].counts.main === 3);
      check('…the static site was rebuilt with it (the exported home carries the new order)', (() => {
        const home = fs.readFileSync(path.join(ROOT, 'public', 'home.html'), 'utf8');
        const nav = home.slice(home.indexOf('<nav'), home.indexOf('</nav>'));
        return nav.indexOf('צרו קשר') > -1 && nav.indexOf('צרו קשר') < nav.indexOf('אודות');
      })());
      if (okM && okM.modelCall) await say({ step: { id: okM.modelCall.id, result: { choices: [{ message: { content: 'התפריט עודכן.' } }] } } });

      // undo stays reachable — the route the chat's ↩ button calls
      const undo = parse(await req('POST', '/admin/api/menus/restore', { cookie, json: { backupId: okM && okM.applied ? okM.applied.backupId : 'x' } }));
      check('the ↩ the chat offers (POST /admin/api/menus/restore with that id) puts the old order back, and is itself undoable (pre-restore backup)',
        !!(undo && undo.ok) && targets(await getMenus()) === 'home,about,contact' && (await getBackups())[0].reason === 'pre-restore');

      // v2.58 — a chat template's own tokens leaked into the reply (Gemma 4 through the Bridge:
      // "<|channel>thought\n<channel|>I've created a draft…") never reach the owner; the words do
      const tk1 = parse(await say({ message: 'שלום', history: [], context: { canvas: 'blank', surface: 'copilot' }, window: big }));
      const tk2 = parse(await say({ step: { id: tk1 && tk1.modelCall ? tk1.modelCall.id : 'x', result: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '<|channel>thought\n<channel|>שלום! במה אפשר לעזור?' } }] } } }));
      check('a leaked chat-template token (<|channel>thought<channel|>) is stripped from the reply — the owner reads only the words',
        !!(tk2 && tk2.ok) && tk2.reply === 'שלום! במה אפשר לעזור?');

      // GATE 3 on the wire — the weaker mode: no tool call, the menu PRINTED
      const w1 = parse(await say({ message: 'סדר את התפריט', history: [], context: { canvas: 'menu', surface: 'copilot' }, window: big }));
      const rawMid = JSON.stringify(await getMenus());
      const w2 = parse(await say({ step: { id: w1 && w1.modelCall ? w1.modelCall.id : 'x', result: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'הנה הסדר המוצע:\n' + NEW_MENU } }] } } }));
      check('GATE 3 — a model that returns NO tool call can still only DESCRIBE: the turn completes with its words, no pending, nothing written',
        !!(w2 && w2.ok && !w2.pending && !w2.applied && !w2.modelCall) && /<bent-menus/.test(w2.reply || '') && JSON.stringify(await getMenus()) === rawMid);
      const wp = parse(await req('POST', '/admin/api/menus/preview', { cookie, json: { reply: w2 ? w2.reply : '', brief: 'סדר את התפריט' } }));
      check('GATE 3 — …the page previews that printed menu through the organizer\'s never-writes route (the door\'s diff), and it wrote nothing',
        !!(wp && wp.ok && wp.preview && wp.preview.diff.main.moved.length > 0) && JSON.stringify(await getMenus()) === rawMid);

      // the door refuses → the model is answered, the owner is never asked
      const b1 = parse(await say({ message: 'הוסף מחירון לתפריט', history: [], context: { canvas: 'menu', surface: 'copilot' }, window: big }));
      const b2 = parse(await say({ step: { id: b1 && b1.modelCall ? b1.modelCall.id : 'x', result: toolCall('bad', 'organize_menu', { document: NEW_MENU.replace('</bent-menu>', '  <bent-link label="מחירון" page="pricing" />\n  </bent-menu>') }) } }));
      const badMsg = ((b2 && b2.modelCall && b2.modelCall.body.messages) || []).filter((m) => m.role === 'tool' && m.tool_call_id === 'bad').pop();
      check('a menu linking a page that does not exist → NO approval card: the door\'s sentence goes back to the model with the menu\'s fix line',
        !!(b2 && b2.ok && !b2.pending && b2.modelCall) && /לפני שתתבקשו לאשר/.test(b2.notice || '') && !!badMsg &&
        /מצביע על דף שלא קיים \(pricing\)/.test(badMsg.content) && /read_menus/.test(badMsg.content) && JSON.stringify(await getMenus()) === rawMid);
    }

    // ── v2.37: a proposal the write would refuse never reaches the owner ──
    // Live on the Bridge challenges (Gemma 4 31B): a bent-faq holding
    // bent-fold was approved and only then failed E_CHILD. Now the errors go
    // back to the model as the call's answer, and only a document that will
    // land becomes an approval card; after two refusals the turn gives up.
    {
      const pageDoc = (slug, faqKids) => '<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n<head><meta charset="utf-8"/><title>מחירים</title><meta name="bent-slug" content="' + slug + '"/></head>\n<body>\n  <bent-heading id="h" level="1">מחירים</bent-heading>\n  <bent-faq id="faq">\n' + faqKids + '\n  </bent-faq>\n</body></html>';
      const BAD = pageDoc('preflight-page', '    <bent-fold id="f1" title="שאלה?">תשובה</bent-fold>\n    <bent-fold id="f2" title="עוד שאלה?">עוד תשובה</bent-fold>');
      const GOOD = pageDoc('preflight-page', '    <bent-qa id="q1" question="שאלה?">תשובה</bent-qa>\n    <bent-qa id="q2" question="עוד שאלה?">עוד תשובה</bent-qa>');
      const p1 = parse(await req('POST', '/admin/api/ai/chat', { cookie, json: { message: 'דף מחירים עם שאלות נפוצות', history: [], context: { canvas: 'blank', surface: 'copilot' }, window: { tokens: 262144, source: 'bridge' } } }));
      const p2 = parse(await req('POST', '/admin/api/ai/chat', { cookie, json: { step: { id: p1 && p1.modelCall ? p1.modelCall.id : 'x', result: toolCall('w1', 'create_page', { source: BAD }) } } }));
      check('an invalid create_page (bent-faq ⊃ bent-fold) → NO approval card, a new model call instead',
        !!(p2 && p2.ok && !p2.pending && p2.modelCall));
      check('…the owner is told, in Hebrew, with the codes counted (E_CHILD ×2)',
        !!(p2 && /לפני שתתבקשו לאשר/.test(p2.notice || '') && /E_CHILD ×2/.test(p2.notice || '')));
      const p2msgs = (p2 && p2.modelCall && p2.modelCall.body.messages) || [];
      const toolAnswer = p2msgs.filter((m) => m.role === 'tool').pop();
      check('…and the model gets the exact validator errors as the call\'s answer (not saved, not shown)',
        !!(toolAnswer && /E_CHILD: <bent-faq> cannot contain <bent-fold>/.test(toolAnswer.content) && /"proposed":false/.test(toolAnswer.content)));
      const pagesMid = parse(await req('GET', '/admin/api/pages', { cookie }));
      const listMid = Array.isArray(pagesMid) ? pagesMid : ((pagesMid && pagesMid.pages) || []);
      check('…and nothing was written (no page "preflight-page")', !listMid.some((pg) => pg.full_path === 'preflight-page'));
      const p3 = parse(await req('POST', '/admin/api/ai/chat', { cookie, json: { step: { id: p2 && p2.modelCall ? p2.modelCall.id : 'x', result: toolCall('w2', 'create_page', { source: GOOD }) } } }));
      check('the fixed proposal (bent-qa) → the approval card, with the document to preview',
        !!(p3 && p3.pending && p3.pending.tool === 'create_page' && p3.pending.input.source === GOOD));

      // v2.40 — refuse it: the model is told in so many words that nothing
      // happened (live, Gemma had claimed a refused edit was done)
      const r3 = parse(await req('POST', '/admin/api/ai/chat', { cookie, json: { approve: { id: p3 && p3.pending ? p3.pending.id : 'x', ok: false } } }));
      const refusalMsg = ((r3 && r3.modelCall && r3.modelCall.body.messages) || []).filter((m) => m.role === 'tool').pop();
      check('a refusal answers the model with done:false, "nothing was saved" and "do not say you did it"',
        !!(refusalMsg && /"done":false/.test(refusalMsg.content) && /שום דבר לא נשמר/.test(refusalMsg.content) && /אל תכתוב\/י שביצעת/.test(refusalMsg.content)));
      const pagesAfterRefusal = parse(await req('GET', '/admin/api/pages', { cookie }));
      check('…and the refused page was not written', !((Array.isArray(pagesAfterRefusal) ? pagesAfterRefusal : (pagesAfterRefusal && pagesAfterRefusal.pages) || []).some((pg) => pg.full_path === 'preflight-page')));
      const chatSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-chat.js'), 'utf8');
      const panelSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-copilot-panel.js'), 'utf8');
      check('the screen and the drawer both show the owner\'s own line after a refusal, before the model speaks',
        /if \(!ok\) bubble\('system', '✕ דחיתם את ההצעה — שום דבר לא נשמר\.'\)/.test(chatSrc) &&
        /if \(!ok\) bubble\('system', '✕ דחיתם את ההצעה — שום דבר לא נשמר\.'\)/.test(panelSrc));

      // the cap: three invalid proposals in one turn → the turn ends with the reason
      const g1 = parse(await req('POST', '/admin/api/ai/chat', { cookie, json: { message: 'שוב', history: [], context: { canvas: 'blank', surface: 'copilot' }, window: { tokens: 262144, source: 'bridge' } } }));
      let g = g1;
      for (let i = 0; i < 3; i++) {
        g = parse(await req('POST', '/admin/api/ai/chat', { cookie, json: { step: { id: g && g.modelCall ? g.modelCall.id : 'x', result: toolCall('b' + i, 'create_page', { source: BAD }) } } }));
        if (!g || !g.modelCall) break;
      }
      check('after two refusals the third invalid proposal ends the turn — no card, no endless loop, the reason in the memo',
        !!(g && g.ok && !g.pending && !g.modelCall && /לא הצליח להציע מסמך תקין/.test(g.memo || '')));
    }

    // the window endpoint the chip and the setup screen read
    const win = await req('GET', '/admin/api/ai/window?tokens=8192&source=bridge', { cookie });
    const winD = parse(win);
    check('GET /admin/api/ai/window?tokens=8192&source=bridge → compact, with the LM Studio click path',
      win.status === 200 && !!winD && winD.ok && winD.tier === 'compact' && winD.tierHe === 'מקוצר' &&
      /Context Length/.test(winD.message || '') && winD.recommended === 32768 && winD.window && winD.window.tokens === 8192);
    const winNoAuth = await req('GET', '/admin/api/ai/window?tokens=8192&source=bridge', {});
    check('/admin/api/ai/window is not reachable unauthenticated', winNoAuth.status !== 200);

    // the screen itself carries the canvas
    const chat2 = await req('GET', '/admin/chat', { cookie });
    check('GET /admin/chat carries the canvas, the dropdown, the proposal frame and the window chip',
      chat2.status === 200 && ['cp-page-select', 'cp-window', 'btn-stage-preview', 'cp-open-full', 'cp-new-chat',
        'cp-canvas-empty', 'cp-canvas-frame', 'cp-proposal', 'cp-tabs', 'chat-settings', 'ai-key', 'btn-send']
        .every((id) => new RegExp('id="' + id + '"').test(chat2.text)));
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE COPILOT-ROUTE: FAIL' : 'SMOKE COPILOT-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
