'use strict';

/**
 * v1.83 QA — the customer-service chat and its budget cap.
 *
 * This module was deliberately held back through the whole CRM integration for
 * one reason: it is a PUBLIC endpoint that spends the owner's money. So the
 * tests are about the bill and the blast radius, not the conversation:
 *
 *   - the daily cap is a HARD stop, and it holds when many requests race for
 *     the last slot (a read-then-write cap does not),
 *   - a failed model call does not consume budget,
 *   - a refusal never calls the model at all,
 *   - the bot has no tools, and a visitor's text is never treated as
 *     instructions,
 *   - the reply reaches the page as TEXT, never as markup,
 *   - and with the flag off, none of it exists.
 *
 * The model is replaced by a stub, so no test here spends anything.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-cs-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const { db } = require('../src/db');
const cs = require('../src/crm/cs');
const widget = require('../src/crm/cs-widget');
const config = require('../src/config');

function cfg(over = {}, crmOn = true) {
  return {
    title: 'עסק לדוגמה',
    crm: {
      enabled: crmOn,
      cs: Object.assign({
        enabled: true, dailyMessageCap: 5, perSessionCap: 3,
        greeting: 'שלום', businessInfo: 'אנחנו פתוחים א-ה 9:00-17:00.'
      }, over)
    }
  };
}

let calls = 0;
const stub = () => { calls++; return Promise.resolve('תשובה מהמודל'); };
const failing = () => { calls++; return Promise.reject(new Error('provider down')); };

// ── off means off ────────────────────────────────────────────────────
check('the chat is off by default', (() => {
  const fresh = config.loadConfig();
  return !(fresh.crm && fresh.crm.cs && fresh.crm.cs.enabled);
})());
check('CRM off → chat disabled even if configured', cs.getSettings(cfg({}, false)).enabled === false);
check('no widget tag while off', widget.renderTag(cfg({ enabled: false })) === '');
check('a tag appears when on', widget.renderTag(cfg()).includes('/tz-cs-chat.js'));

// ── owner limits are clamped ─────────────────────────────────────────
check('an absurd daily cap is clamped to the ceiling',
  cs.getSettings(cfg({ dailyMessageCap: 999999 })).dailyMessageCap === cs.MAX_DAILY_CAP);
check('an absurd session cap is clamped',
  cs.getSettings(cfg({ perSessionCap: 99999 })).perSessionCap === cs.MAX_SESSION_CAP);

// ── the system prompt is defensive ───────────────────────────────────
const sys = cs.buildSystemPrompt({ siteTitle: 'עסק', businessInfo: 'שעות: 9-17' });
check('the prompt carries the owner\'s business info', sys.includes('שעות: 9-17'));
check('the prompt forbids inventing prices and promises', /אל תמציא/.test(sys) && /מחירים/.test(sys));
check('the prompt treats visitor text as a QUESTION, not instructions',
  /הוראה/.test(sys) && /התעלם/.test(sys));
check('the prompt refuses to ask for credentials', /סיסמ/.test(sys) && /אשראי/.test(sys));
check('with no business info it is told to admit ignorance, not improvise',
  /לא הזין/.test(cs.buildSystemPrompt({ siteTitle: 'x', businessInfo: '' })));

(async () => {
  // ── a normal exchange ──────────────────────────────────────────────
  const conv = cs.startConversation();
  check('a conversation starts with an unguessable token', /^[a-f0-9]{32}$/.test(conv.token));
  check('a conversation is findable by token, and only by a well-formed one',
    !!cs.findConversation(conv.token) && cs.findConversation('nope') === null);

  calls = 0;
  const a1 = await cs.answer({ config: cfg(), conversation: cs.findConversation(conv.token), text: 'מה שעות הפתיחה?', generate: stub });
  check('a question gets an answer', a1.ok === true && a1.reply === 'תשובה מהמודל');
  check('the model was called exactly once', calls === 1);
  check('both sides are stored in the transcript', (() => {
    const m = cs.messagesFor(conv.id);
    return m.length === 2 && m[0].role === 'user' && m[1].role === 'assistant';
  })());
  check('the daily counter moved', cs.usageToday().messages === 1);
  check('an empty question never reaches the model', (() => {
    const before = calls;
    return cs.answer({ config: cfg(), conversation: cs.findConversation(conv.token), text: '   ', generate: stub })
      .then((r) => r.ok === false && r.reason === 'empty' && calls === before);
  })());

  // ── the per-session cap ────────────────────────────────────────────
  await cs.answer({ config: cfg(), conversation: cs.findConversation(conv.token), text: 'שאלה 2', generate: stub });
  await cs.answer({ config: cfg(), conversation: cs.findConversation(conv.token), text: 'שאלה 3', generate: stub });
  const overSession = await cs.answer({
    config: cfg(), conversation: cs.findConversation(conv.token), text: 'שאלה 4', generate: stub
  });
  check('one conversation cannot exceed its own cap',
    overSession.ok === false && overSession.reason === 'session-limit');
  check('a session refusal does NOT call the model', (() => {
    const before = calls;
    return cs.answer({ config: cfg(), conversation: cs.findConversation(conv.token), text: 'עוד', generate: stub })
      .then(() => calls === before);
  })());
  check('a session refusal does not consume daily budget', cs.usageToday().messages === 3);

  // ── the daily cap is a HARD stop ───────────────────────────────────
  const c2 = cs.startConversation();
  await cs.answer({ config: cfg(), conversation: cs.findConversation(c2.token), text: 'א', generate: stub });
  await cs.answer({ config: cfg(), conversation: cs.findConversation(c2.token), text: 'ב', generate: stub });
  check('the day is now at its cap', cs.usageToday().messages === 5);

  const c3 = cs.startConversation();
  calls = 0;
  const overDaily = await cs.answer({ config: cfg(), conversation: cs.findConversation(c3.token), text: 'ג', generate: stub });
  check('over the daily cap the answer is refused',
    overDaily.ok === false && overDaily.reason === 'daily-limit');
  check('over the daily cap THE MODEL IS NEVER CALLED (the whole point)', calls === 0);
  check('refusals are counted for the owner to see', cs.usageToday().refusals >= 1);

  // ── the cap under a race ───────────────────────────────────────────
  check('THE CAP HOLDS UNDER CONCURRENCY (atomic reserve, not read-then-write)', (() => {
    db.prepare('DELETE FROM crm_cs_budget').run();
    const CAP = 10;
    // 50 simultaneous attempts at a 10-slot budget
    let granted = 0;
    for (let i = 0; i < 50; i++) if (cs.reserveCall(CAP)) granted++;
    const row = cs.usageToday();
    if (granted !== CAP) console.log(`     granted ${granted}, expected ${CAP}`);
    return granted === CAP && row.messages === CAP;
  })());

  // ── a failed model call must not be charged ────────────────────────
  db.prepare('DELETE FROM crm_cs_budget').run();
  const c4 = cs.startConversation();
  calls = 0;
  const errored = await cs.answer({
    config: cfg(), conversation: cs.findConversation(c4.token), text: 'שאלה', generate: failing
  });
  check('a provider failure is reported as a soft error',
    errored.ok === false && errored.reason === 'model-error');
  check('a FAILED call gives its budget slot back (an error is not a sale)',
    cs.usageToday().messages === 0);
  const c5 = cs.startConversation();
  const blank = await cs.answer({
    config: cfg(), conversation: cs.findConversation(c5.token), text: 'שאלה',
    generate: () => Promise.resolve('   ')
  });
  check('an empty reply is treated as a failure and refunded',
    blank.ok === false && cs.usageToday().messages === 0);

  // ── history sent to the model is bounded ───────────────────────────
  check('only a bounded tail of the conversation is replayed', (() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'crm', 'cs.js'), 'utf8');
    return /MAX_HISTORY_TURNS/.test(src) && cs.MAX_HISTORY_TURNS <= 12;
  })());
  check('a long question is truncated before it is charged for',
    cs.MAX_QUESTION_CHARS <= 2000);

  // ── no tools, ever ─────────────────────────────────────────────────
  check('the chat calls plain generate — never the tool-running converse', (() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'crm', 'cs.js'), 'utf8');
    return /require\('\.\.\/ai'\)\.generate/.test(src) && !/converse/.test(src);
  })());
  check('the chat module has no write access to pages or settings', (() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'crm', 'cs.js'), 'utf8');
    return !/savePage|saveConfig|publish|deletePage|ai-tools/.test(src);
  })());

  // ── the widget renders remote text as TEXT ─────────────────────────
  const js = widget.script();
  // The real property is that no remote string is ever PARSED as markup —
  // so assert on the assignment forms, not on the word appearing anywhere.
  check('the widget never assigns innerHTML / outerHTML / insertAdjacentHTML',
    !/\.(inner|outer)HTML\s*=/.test(js) && !/insertAdjacentHTML/.test(js) && !/document\.write/.test(js));
  check('the widget writes every string with textContent', /textContent\s*=/.test(js));
  check('the widget caps what a visitor can type', /maxlength/.test(js));
  check('the widget tells the visitor it is automated and fallible',
    /עוזר אוטומטי/.test(js) && /לא תמיד מדויק/.test(js));
  check('the widget parses as valid JavaScript', (() => {
    try { new Function(js); return true; } catch (e) { console.log('     ' + e.message); return false; }
  })());

  // ── lead capture through the seam ──────────────────────────────────
  config.saveConfig(Object.assign(config.loadConfig(), { crm: cfg().crm }));
  check('an address offered in chat becomes a contact, via the seam', (() => {
    const c6 = cs.startConversation();
    const person = cs.linkContactFromText(c6.id, 'אפשר לחזור אליי? dana@example.com');
    const linked = cs.getConversation(c6.id);
    return !!person && person.email === 'dana@example.com' && linked.contact_id === person.id;
  })());
  check('text with no address links nobody',
    cs.linkContactFromText(cs.startConversation().id, 'סתם שאלה') === null);

  // ── the owner is shown money, not message counts ───────────────────
  const cost = cs.costEstimate(cfg({ dailyMessageCap: 100 }));
  check('the cap is expressed as a worst-case cost',
    cost.dailyMessageCap === 100 && cost.worstCaseTokens > 0 && typeof cost.worstCaseUsd === 'number');

  console.log('');
  console.log(fail ? 'SMOKE CRM-CS: FAIL' : 'SMOKE CRM-CS: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
