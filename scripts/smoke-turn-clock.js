'use strict';

/**
 * The turn clock (v2.36) — Ben: "a comment from llm thinking in every 45s".
 * A local 31B model reads the whole briefing before its first token, and the
 * copilot sat silent for minutes. public/admin-turn-clock.js posts one line
 * every 45 s while a turn runs: still reading / writing N / gone quiet.
 *
 * Run in a vm with a fake interval and a fake clock — the lines a turn
 * actually produces, phase by phase — plus the wiring on both copilot
 * surfaces (the screen and the builder drawer).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'public', 'admin-turn-clock.js'), 'utf8');
const ctx = { window: {}, setInterval: () => 0, clearInterval: () => {} };
vm.runInNewContext(src, ctx, { filename: 'admin-turn-clock.js' });
const TC = ctx.window.TapuzTurnClock;
check('admin-turn-clock.js defines window.TapuzTurnClock with start/line', !!TC && typeof TC.start === 'function' && typeof TC.line === 'function');
check('the tick is 45 seconds', TC && TC.TICK_MS === 45000);

// a fake interval that we fire by hand, and a clock we move by hand
function harness() {
  const posted = [];
  let now = 1000000;
  let fn = null;
  let ms = 0;
  let cleared = 0;
  const h = TC.start((t) => posted.push(t), {
    now: () => now,
    setInterval: (f, m) => { fn = f; ms = m; return 7; },
    clearInterval: (id) => { if (id === 7) cleared++; }
  });
  return {
    h, posted,
    tick: (sec) => { now += sec * 1000; fn(); },
    get ms() { return ms; },
    get cleared() { return cleared; }
  };
}

// ── a relayed turn (bridge 0.5.3): reading → a tool call → text → quiet → the next call ──
{
  const t = harness();
  check('start arms ONE interval at 45 s', t.ms === 45000);
  t.h.progress({ chars: 0, tokens: 0, started: false, tool: '' }); // heartbeat: nothing arrived yet
  t.tick(45);
  check('45 s, not started → "still reading the briefing" with the time and why it is normal',
    /^⏳ המודל עדיין קורא את התדריך והשיחה — 0:45\./.test(t.posted[0]) && /וזה תקין/.test(t.posted[0]));
  t.tick(45);
  check('90 s, still not started → the short form, not the whole explanation again', t.posted[1] === '⏳ עדיין קורא — 1:30');
  t.h.progress({ chars: 0, tokens: 0, started: true, tool: 'create_page' }); // the tool call's first frame: name, empty arguments
  t.tick(45);
  check('started into create_page, nothing counted → "writing the new page, it arrives whole" (not "reading")',
    /^✍ המודל כותב את הדף החדש — 2:15\./.test(t.posted[2]) && /בבת אחת/.test(t.posted[2]));
  t.tick(45);
  check('still inside the same tool call → the short form', t.posted[3] === '✍ עדיין כותב את הדף החדש — 3:00');
  t.h.progress({ chars: 1200, tokens: 310, started: true, tool: '' });
  t.tick(45);
  check('the count grew → "writing" with tokens so far', t.posted[4] === '✍ המודל כותב — 310 טוקנים עד עכשיו · 3:45');
  t.h.progress({ chars: 5400, tokens: 0, started: true, tool: 'edit_page' });
  t.tick(45);
  check('a count in characters when the text went into a tool call (tokens 0)', t.posted[5] === '✍ המודל כותב — 5,400 תווים עד עכשיו · 4:30');
  t.tick(45);
  check('no growth for a whole tick → "gone quiet, check LM Studio"',
    /^⏸ המודל לא כתב כלום ב-45 השניות האחרונות — 5:15\./.test(t.posted[6]) && /LM Studio/.test(t.posted[6]));
  t.h.progress({ chars: 0, tokens: 0, started: false, tool: '' }); // the next relayed call of the same turn
  t.tick(45);
  check('the next call (count dropped, not started) → reading again, explained again', /^⏳ המודל עדיין קורא את התדריך והשיחה — 6:00\./.test(t.posted[7]));
  t.h.stop();
  t.h.stop();
  check('stop clears the interval exactly once (twice is harmless)', t.cleared === 1);
}

// ── an older bridge (no `started`): nothing streamed claims neither reading nor writing ──
{
  const t = harness();
  t.h.progress({ chars: 0, tokens: 0 });
  t.tick(45);
  t.tick(45);
  check('0.5.2 bridge, nothing streamed → "still working", naming both possibilities once, then short',
    /^⏳ המודל עדיין עובד — 0:45\./.test(t.posted[0]) && /קורא את התדריך/.test(t.posted[0]) && /בבת אחת/.test(t.posted[0]) &&
    t.posted[1] === '⏳ עדיין עובד — 1:30');
  t.h.stop();
}

// ── the live status line: reading is not "writing 0 tokens" ──
check('status: not started → READING', TC.status({ chars: 0, tokens: 0, started: false }) === '⏳ המודל שלכם קורא את התדריך…');
check('status: started into create_page → writing the page, arriving whole', TC.status({ chars: 0, tokens: 0, started: true, tool: 'create_page' }) === '✍ המודל שלכם כותב את הדף החדש… (מגיע בבת אחת בסוף)');
check('status: an older bridge (no started) → only "working"', TC.status({ chars: 0, tokens: 0 }) === '⏳ המודל שלכם עובד…');
check('status: writing counts tokens, or characters when the text goes into a tool call',
  TC.status({ chars: 900, tokens: 240 }) === '✍ המודל שלכם כותב… 240 טוקנים' && TC.status({ chars: 5400, tokens: 0 }) === '✍ המודל שלכם כותב… 5,400 תווים');

// ── a server-side call: no progress channel, no invented detail ──
{
  const t = harness();
  t.tick(45);
  t.tick(45);
  check('no progress events → only "still working" with the time',
    t.posted[0] === '⏳ עדיין עובד על התשובה — 0:45' && t.posted[1] === '⏳ עדיין עובד על התשובה — 1:30');
  t.h.stop();
}

// ── a UI that throws must not break the turn ──
{
  let fired = null;
  const h = TC.start(() => { throw new Error('ui'); }, { setInterval: (f) => { fired = f; return 1; }, clearInterval: () => {} });
  let threw = false;
  try { fired(); } catch (e) { threw = true; }
  check('a throwing post() is swallowed by the tick', !threw);
  h.stop();
}

// ── wiring: both copilot surfaces load it and run it around every turn ──
{
  const copilotRoute = fs.readFileSync(path.join(root, 'src', 'routes', 'copilot.js'), 'utf8');
  const builderRoute = fs.readFileSync(path.join(root, 'src', 'routes', 'pages-builder.js'), 'utf8');
  const chat = fs.readFileSync(path.join(root, 'public', 'admin-chat.js'), 'utf8');
  const panel = fs.readFileSync(path.join(root, 'public', 'admin-copilot-panel.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'css', 'admin.css'), 'utf8');

  check('/admin/chat loads the clock before admin-chat.js',
    /<script src="\/admin-turn-clock\.js"><\/script>\s*<script src="\/admin-chat\.js">/.test(copilotRoute));
  check('the builder loads the clock before the drawer (and not in the embedded builder)',
    /\$\{embed \? '' : '<script src="\/admin-turn-clock\.js"><\/script>'\}\s*\$\{embed \? '' : '<script src="\/admin-copilot-panel\.js"><\/script>'\}/.test(builderRoute));
  check('the screen: every turn (send and approval ride chatTurn) starts the clock, feeds it progress, stops it in finally',
    /async function chatTurn[\s\S]*?TapuzTurnClock\.start\([\s\S]*?clock\.progress\(p\)[\s\S]*?finally \{\s*if \(clock\) clock\.stop\(\);/.test(chat));
  check('the drawer: send and answerApproval start the clock; every exit stops it; progress feeds it',
    (panel.match(/startClock\(\);/g) || []).length === 2 &&
    (panel.match(/stopClock\(\);/g) || []).length >= 4 &&
    /if \(turnClock\) turnClock\.progress\(p\);/.test(panel));
  const card = fs.readFileSync(path.join(root, 'public', 'admin-inject-card.js'), 'utf8');
  check('no surface says "writing… 0 tokens" while the model reads (screen, drawer, pack cards)',
    /TapuzTurnClock\.status\(p\)/.test(chat) && /TapuzTurnClock\.status\(p\)/.test(panel) && /p\.started === false \? '⏳ המודל שלכם קורא את החבילה…'/.test(card));
  check('the lines are styled quiet on both surfaces',
    /\.bubble\.system\.clock \{/.test(copilotRoute) && /#copilot-drawer \.cp-clock \{/.test(css));
  check('the clock never cancels or retries anything (it reports)', !/abort|reject|\.call\(|fetch\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
}

console.log('');
console.log(fail ? 'SMOKE TURN-CLOCK: FAIL' : 'SMOKE TURN-CLOCK: PASS');
process.exit(fail ? 1 : 0);
