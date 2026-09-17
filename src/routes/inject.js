'use strict';

/**
 * The injection runner (v2.28) — ONE set of routes for every pack in
 * src/injections: hand out the prompt, take a pasted reply through the
 * pack's door, apply it, undo it, or run the whole thing against the
 * connected model. The menu organizer is the first pack written for it;
 * the theme designer rides the same six routes.
 *
 * The rules that shape every handler:
 *   • run NEVER applies (0.9). It answers with the reply text and a preview;
 *     apply is a second POST that re-parses the same text the owner saw.
 *   • apply / run / undo cost money or change the site → requireAdmin.
 *     prompt / paste are read-only and free — an editor may look.
 *   • one repair round at most: when the door refuses, or a warning the
 *     pack calls repairable comes back, the model gets the first exchange
 *     as history plus a "תיקונים נדרשים" turn — and the reply with fewer
 *     hard warnings wins (tie → the repaired one). Two refusals → 400 with
 *     the door's code AND the reply, so the owner can fix it by hand.
 *   • every action lands in config/inject-log.jsonl (never the reply text).
 *
 * Refusals answer {ok:false, error, code}: 400 for door codes, NO_PROVIDER,
 * BROWSER_RELAY, PACK_TOO_BIG (+ suggestSize:'lite'), REPLY_TOO_LONG (a
 * reply over 60K chars — a whole chat transcript pasted, not the document —
 * is refused here before ANY pack's door sees it); 502 PROVIDER_ERROR /
 * EMPTY_REPLY / NETWORK; 504 TIMEOUT; 409 HARD_WARNINGS; 404 unknown pack.
 */

const express = require('express');
const { requireAdmin } = require('../admin-guard');
const registry = require('../injections');
const { siteState } = require('../injections/site-state');
const { logRun } = require('../injections/log');
// the module object, not destructured: the smoke swaps contextBudget /
// generateDetailed on it, and a request must see the swap
const ai = require('../ai');

const router = express.Router();

const STATUS_BY_CODE = {
  NO_PROVIDER: 400, BROWSER_RELAY: 400, PACK_TOO_BIG: 400, NOT_READY: 400, RUN_DISABLED: 400,
  NO_BACKUP: 400, EMPTY_PASTE: 400, REPLY_TOO_LONG: 400,
  PROVIDER_ERROR: 502, EMPTY_REPLY: 502, NETWORK: 502,
  TIMEOUT: 504,
  HARD_WARNINGS: 409
};

// a full pack (≤ 14K chars) and a long reply (≤ ~14K chars) both ride the
// repair round as history turns — the chat's 12K cap would cut them
const REPAIR_TURN_CAP = 40000;

// the size gate at the generic door: the longest legitimate reply (a full
// theme with skin + effect) is ~20K chars; anything past 60K is a chat
// transcript or a runaway model, and no pack's parser should have to chew it
const MAX_REPLY_CHARS = 60000;

/** The REPLY_TOO_LONG error for a reply past the gate, or null. */
function replyTooLong(reply) {
  if (String(reply || '').length <= MAX_REPLY_CHARS) return null;
  const e = new Error('התשובה ארוכה מדי (מעל 60K תווים) — הדביקו רק את המסמך');
  e.code = 'REPLY_TOO_LONG';
  return e;
}

function refuse(res, e, extra) {
  const code = (e && e.code) || '';
  const status = STATUS_BY_CODE[code] || 400;
  return res.status(status).json(Object.assign({ ok: false, error: (e && e.message) || 'שגיאה', code }, extra || {}));
}

function packOr404(req, res) {
  const pack = registry.get(req.params.id);
  if (!pack) {
    res.status(404).json({ ok: false, error: 'חבילה לא מוכרת: ' + String(req.params.id || '').slice(0, 40), code: 'UNKNOWN_PACK' });
    return null;
  }
  return pack;
}

function notReady(pack) {
  const e = new Error('החבילה "' + pack.title + '" עדיין לא זמינה להרצה בשרת הזה');
  e.code = 'NOT_READY';
  return e;
}

function liftSocketTimeout(req, res, ms) {
  const sock = req.socket;
  if (!sock || typeof sock.setTimeout !== 'function') return;
  const prev = Number(sock.timeout) > 0 ? Number(sock.timeout) : 0;
  try { sock.setTimeout(Math.max(prev, ms)); } catch (e) { return; }
  res.on('finish', () => { try { if (prev) sock.setTimeout(prev); } catch (e) { /* socket gone */ } });
}

function sizeFor(pack, raw) {
  return String(raw || 'lite') === 'full' && pack.ui.sizes.includes('full') ? 'full' : 'lite';
}
function localeFor(raw) { return String(raw || 'he') === 'en' ? 'en' : 'he'; }
function variantFor(raw) { return String(raw || 'A') === 'B' ? 'B' : 'A'; }
function briefFor(raw) { return String(raw || '').slice(0, 1500); }

function codesOf(warnings) {
  return (Array.isArray(warnings) ? warnings : []).map((w) => (w && w.code) || '').filter(Boolean);
}
function textsOf(parsed) {
  if (Array.isArray(parsed.warningTexts)) return parsed.warningTexts.map(String);
  return (parsed.warnings || []).map((w) => String((w && w.message) || ''));
}

// ── GET /admin/api/inject — the packs ───────────────────────────────────
router.get('/admin/api/inject', (req, res) => {
  res.json({ ok: true, packs: registry.list().filter((p) => !p.ui.hidden) });
});

// ── GET /admin/api/inject/:id/prompt — the pack text, for the clipboard ──
router.get('/admin/api/inject/:id/prompt', (req, res) => {
  const pack = packOr404(req, res);
  if (!pack) return;
  if (pack.buildPrompt === null || !registry.isReady(pack)) return refuse(res, notReady(pack));
  try {
    const built = pack.buildPrompt({
      brief: briefFor(req.query.brief),
      size: sizeFor(pack, req.query.size),
      locale: localeFor(req.query.locale),
      variant: variantFor(req.query.variant),
      ctx: siteState()
    });
    res.setHeader('X-Pack-Chars', String(built.chars));
    res.setHeader('X-Pack-Tokens-Est', String(ai.estimateTokens(built.chars)));
    res.type('text/markdown; charset=utf-8').send(built.text);
  } catch (e) {
    refuse(res, e);
  }
});

// ── POST /admin/api/inject/:id/paste — through the door, never writes ───
router.post('/admin/api/inject/:id/paste', (req, res) => {
  const pack = packOr404(req, res);
  if (!pack) return;
  const b = req.body || {};
  const reply = String(b.reply || '');
  const brief = briefFor(b.brief);
  const started = Date.now();
  const log = (fields) => logRun(Object.assign({ id: pack.id, action: 'paste', provider: 'paste', model: '', replyChars: reply.length, ms: Date.now() - started }, fields));
  if (!reply.trim()) {
    const e = new Error('הדביקו את תשובת ה-AI לפני התצוגה המקדימה');
    e.code = 'EMPTY_PASTE';
    log({ ok: false, code: e.code });
    return refuse(res, e);
  }
  const tooLong = replyTooLong(reply);
  if (tooLong) {
    log({ ok: false, code: tooLong.code });
    return refuse(res, tooLong);
  }
  let parsed;
  try {
    parsed = pack.parse(reply, siteState(), { brief });
  } catch (e) {
    log({ ok: false, code: e.code || 'BAD_REPLY' });
    return refuse(res, { message: e.message, code: e.code || 'BAD_REPLY' });
  }
  log({ ok: true, warningCodes: codesOf(parsed.warnings) });
  res.json({
    ok: true,
    preview: parsed.preview || null,
    warnings: parsed.warnings || [],
    warningTexts: textsOf(parsed),
    notes: parsed.notes || [],
    hard: !!parsed.hard,
    chars: reply.length
  });
});

// ── POST /admin/api/inject/:id/apply — the one door that changes the site ─
router.post('/admin/api/inject/:id/apply', requireAdmin, (req, res) => {
  const pack = packOr404(req, res);
  if (!pack) return;
  const b = req.body || {};
  const reply = String(b.reply || '');
  const force = b.force === true || b.force === 'true' || b.force === 1;
  const brief = briefFor(b.brief);
  const started = Date.now();
  const log = (fields) => logRun(Object.assign({ id: pack.id, action: 'apply', provider: 'paste', model: '', replyChars: reply.length, ms: Date.now() - started }, fields));
  if (!reply.trim()) {
    const e = new Error('אין תשובה להחיל');
    e.code = 'EMPTY_PASTE';
    log({ ok: false, code: e.code });
    return refuse(res, e);
  }
  const tooLong = replyTooLong(reply);
  if (tooLong) {
    log({ ok: false, code: tooLong.code });
    return refuse(res, tooLong);
  }
  let r;
  try {
    r = pack.apply(reply, siteState(), { force, brief });
  } catch (e) {
    const code = e.code || 'BAD_REPLY';
    log({ ok: false, code, warningCodes: codesOf(e.warnings) });
    if (code === 'HARD_WARNINGS') {
      const warnings = Array.isArray(e.warnings) ? e.warnings : [];
      return res.status(409).json({
        ok: false, code, error: e.message || 'יש אזהרות קשות — אשרו החלה בכל זאת',
        warnings, warningTexts: warnings.map((w) => String((w && w.message) || w))
      });
    }
    return refuse(res, { message: e.message, code });
  }
  log({ ok: true, warningCodes: codesOf(r.warnings) });
  res.json({
    ok: true,
    applied: true,
    landed: r.landed || null,
    backupId: r.backupId == null ? null : r.backupId,
    changed: r.changed || {},
    rebuildError: r.rebuildError || '',
    warnings: r.warnings || []
  });
});

// ── POST /admin/api/inject/:id/undo ─────────────────────────────────────
router.post('/admin/api/inject/:id/undo', requireAdmin, (req, res) => {
  const pack = packOr404(req, res);
  if (!pack) return;
  const started = Date.now();
  try {
    const r = pack.undo(siteState());
    logRun({ id: pack.id, action: 'undo', provider: 'paste', model: '', ok: true, ms: Date.now() - started });
    res.json({ ok: true, restored: r && r.restored != null ? r.restored : null });
  } catch (e) {
    logRun({ id: pack.id, action: 'undo', provider: 'paste', model: '', ok: false, code: e.code || 'UNDO_FAILED', ms: Date.now() - started });
    refuse(res, e);
  }
});

// ── the door, as the closures BOTH run paths share ──────────────────────
// The server-side run and the browser-relay run judge a reply identically;
// only the courier differs. Everything that decides "is this reply good
// enough, and what does the repair round ask for" lives here once.
function doorFor(pack, ctx, brief) {
  const repairable = Array.isArray(pack.run.repairable) ? pack.run.repairable : [];
  const hardCodes = Array.isArray(pack.hardCodes) ? pack.hardCodes : [];

  // the same size gate as paste/apply, before the pack's door: a runaway
  // reply counts as a refusal, so the one repair round may ask for the
  // document alone (the history turn is capped, the model is not re-fed 60K)
  const attempt = (text) => {
    const tooLong = replyTooLong(text);
    if (tooLong) return { text, parsed: null, refusal: tooLong };
    try { return { text, parsed: pack.parse(text, ctx, { brief }), refusal: null }; }
    catch (e) { return { text, parsed: null, refusal: e }; }
  };
  // a refusal is worse than any warning; a hard reply counts its hard codes
  // (or 1 when the pack does not name them); a soft reply is 0
  const hardCount = (a) => {
    if (a.refusal) return Infinity;
    if (!a.parsed.hard) return 0;
    const n = (a.parsed.warnings || []).filter((w) => hardCodes.includes(w && w.code)).length;
    return n || 1;
  };
  const needsRepair = (a) => !!a.refusal || (a.parsed.warnings || []).some((w) => repairable.includes(w && w.code));
  /** What the second turn asks for, in the pack's own Hebrew. */
  const repairTurn = (a) => {
    const fixes = a.refusal
      ? [a.refusal.message]
      : (a.parsed.warnings || []).filter((w) => repairable.includes(w && w.code)).map((w) => String(w.message || w.code));
    return 'תיקונים נדרשים:\n' + fixes.map((f) => '- ' + String(f).replace(/\s+/g, ' ').trim()).join('\n') +
      '\nהחזירו את המסמך המלא, מתוקן.';
  };
  return { attempt, hardCount, needsRepair, repairTurn };
}

/** The one answer shape every run path ends in — or the door's refusal WITH
 *  the text, so the owner can fix it by hand. */
function finishRun(res, { chosen, rounds, repaired, started, usage, provider, log }) {
  if (chosen.refusal) {
    const code = chosen.refusal.code || 'BAD_REPLY';
    log({ ok: false, code, rounds, repaired: false, replyChars: chosen.text.length });
    return res.status(STATUS_BY_CODE[code] || 400).json({
      ok: false, error: chosen.refusal.message, code,
      reply: chosen.text, rounds, repaired: false,
      timing: { ms: Date.now() - started }, usage, provider
    });
  }
  const p = chosen.parsed;
  log({ ok: true, rounds, repaired, replyChars: chosen.text.length, warningCodes: codesOf(p.warnings) });
  return res.json({
    ok: true,
    reply: chosen.text,
    rounds,
    repaired,
    preview: p.preview || null,
    warnings: p.warnings || [],
    warningTexts: textsOf(p),
    notes: p.notes || [],
    hard: !!p.hard,
    timing: { ms: Date.now() - started },
    usage,
    provider
  });
}

// ── the browser-relay runs (v2.29) ──────────────────────────────────────
//
// On a HOSTED CMS the server cannot reach the owner's LM Studio — but their
// BROWSER can, through the Bridge V2 extension (LM Studio answers with no
// CORS headers at all, so the page itself cannot call it either: the
// extension's background worker is the one context that may). So for the
// 'browser' provider a run is not one request. The server composes the call,
// the page relays it, and the page brings the raw model reply back to the
// SAME route as { step: { id, result } }.
//
// The run's whole state — the pack text, the site state it was built from,
// the first reply — stays on the SERVER keyed by an opaque id. The browser
// only ever carries that id and the model's own output, exactly like the
// copilot's relay (src/ai.js) and the approval pendings. Trusting the
// returned text is the decision the paste tier already makes: apply is still
// a separate POST, and it re-parses the text the owner can read.
const RUN_TTL_MS = 15 * 60 * 1000;
const relayRuns = new Map();

function putRelayRun(state) {
  const id = 'run_' + require('crypto').randomBytes(12).toString('hex');
  relayRuns.set(id, { ...state, at: Date.now() });
  for (const [k, v] of relayRuns) if (Date.now() - v.at > RUN_TTL_MS) relayRuns.delete(k);
  return id;
}
function takeRelayRun(id) {
  const st = relayRuns.get(String(id || ''));
  if (!st) return null;
  relayRuns.delete(id);
  if (Date.now() - st.at > RUN_TTL_MS) return null;
  return st;
}

/** The page's half of the contract: what to send, and how long to wait. */
function relayAnswer(res, { pack, id, body, provider, timeoutMs, stage, rounds }) {
  return res.json({
    ok: true, relay: true, stage, rounds,
    modelCall: { id, body },
    timeoutMs,
    provider,
    packId: pack.id
  });
}

// ── POST /admin/api/inject/:id/run — prompt → model → door (→ one repair) ─
// With a server-side provider that is one request. With the browser relay it
// is a short conversation with the PAGE: {modelCall} → {step} → {modelCall}
// → {step} → the answer. Same door, same repair rule, same final shape.
router.post('/admin/api/inject/:id/run', requireAdmin, async (req, res) => {
  const pack = packOr404(req, res);
  if (!pack) return;
  const b = req.body || {};
  // a relay continuation carries no brief: it resumes state the server holds
  if (b.step && b.step.id) return resumeRelayRun(req, res, pack, b.step);
  const brief = briefFor(b.brief);
  const size = sizeFor(pack, b.size);
  const variant = variantFor(b.variant);
  const locale = localeFor(b.locale);
  const settings = ai.getSettings();
  const providerId = settings.provider;
  let provider = { id: providerId, model: settings.model || '' };
  const started = Date.now();
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  const addUsage = (u) => {
    if (!u) return;
    usage.prompt_tokens += Number(u.prompt_tokens) || 0;
    usage.completion_tokens += Number(u.completion_tokens) || 0;
    if (u.reasoning_tokens != null) usage.reasoning_tokens = (usage.reasoning_tokens || 0) + (Number(u.reasoning_tokens) || 0);
  };
  let promptChars = 0;
  const log = (fields) => logRun(Object.assign({
    id: pack.id, action: 'run', provider: provider.id, model: provider.model,
    ms: Date.now() - started, promptChars, usage
  }, fields));

  if (!pack.run.enabled) {
    const e = new Error('החבילה "' + pack.title + '" אינה ניתנת להרצה — העתיקו את הפרומפט והדביקו בצ׳אט');
    e.code = 'RUN_DISABLED';
    log({ ok: false, code: e.code });
    return refuse(res, e);
  }
  if (pack.buildPrompt === null || !registry.isReady(pack)) {
    log({ ok: false, code: 'NOT_READY' });
    return refuse(res, notReady(pack));
  }

  // 1. the pack
  let ctx;
  let built;
  try {
    ctx = siteState();
    built = pack.buildPrompt({ brief, size, locale, variant, ctx });
    promptChars = built.chars;
  } catch (e) {
    log({ ok: false, code: e.code || 'PROMPT_FAILED' });
    return refuse(res, e);
  }

  // 2. does it fit the model's window? (a pack that overflows comes back
  //    truncated, not refused — so refuse it here, and point at lite)
  //    The relayed model IS a local model: same window, same gate.
  const tokensEst = ai.estimateTokens(built.chars);
  const budget = ai.contextBudget(providerId);
  if (tokensEst + pack.run.maxTokens > budget) {
    log({ ok: false, code: 'PACK_TOO_BIG' });
    return res.status(400).json({
      ok: false, code: 'PACK_TOO_BIG',
      error: 'החבילה (~' + tokensEst.toLocaleString('en-US') + ' טוקנים + ' + pack.run.maxTokens.toLocaleString('en-US') +
        ' לתשובה) גדולה מחלון ההקשר של המודל (' + budget.toLocaleString('en-US') + ') — נסו חבילה לייט',
      suggestSize: 'lite', tokensEst, budget
    });
  }

  const timeoutMs = (providerId === 'local' || providerId === 'browser')
    ? pack.run.timeoutMs.local : pack.run.timeoutMs.cloud;

  // 2b. the relay: hand the first call to the page and stop here. Nothing is
  //     spent, nothing is written, and the socket is free again immediately —
  //     the minutes of waiting happen in the browser, not on a held
  //     connection through the host's proxy.
  if (ai.isRelayProvider()) {
    let call;
    try {
      call = ai.relayRequest({ system: '', user: built.text, maxTokens: pack.run.maxTokens });
    } catch (e) {
      log({ ok: false, code: e.code || 'NO_PROVIDER' });
      return refuse(res, e);
    }
    provider = call.provider || provider;
    const id = putRelayRun({ packId: pack.id, ctx, brief, packText: built.text, promptChars, started, usage, timeoutMs });
    log({ ok: true, code: 'RELAY_CALL', rounds: 1, repaired: false });
    return relayAnswer(res, { pack, id, body: call.body, provider, timeoutMs, stage: 'first', rounds: 1 });
  }

  // server.js caps idle sockets at 30 s (slow-loris, S4) — and a local model
  // legitimately says nothing for minutes. Lift the cap for THIS socket to
  // the provider ceiling (two rounds + margin) and put it back when the
  // response is out; headersTimeout/requestTimeout still guard the intake.
  liftSocketTimeout(req, res, 2 * timeoutMs + 30000);
  const door = doorFor(pack, ctx, brief);

  // 3. the call
  let r1;
  try {
    r1 = await ai.generateDetailed({ system: '', user: built.text, maxTokens: pack.run.maxTokens, timeoutMs });
  } catch (e) {
    log({ ok: false, code: e.code || 'PROVIDER_ERROR', rounds: 1, repaired: false });
    return refuse(res, e);
  }
  addUsage(r1.usage);
  provider = r1.provider || provider;
  const a1 = door.attempt(r1.text);
  let chosen = a1;
  let rounds = 1;
  let repaired = false;

  // 4. at most ONE repair round
  if (door.needsRepair(a1)) {
    rounds = 2;
    let r2 = null;
    try {
      r2 = await ai.generateDetailed({
        system: '',
        user: door.repairTurn(a1),
        history: [{ role: 'user', content: built.text }, { role: 'assistant', content: r1.text }],
        maxTokens: pack.run.maxTokens,
        timeoutMs,
        turnCap: REPAIR_TURN_CAP
      });
    } catch (e) {
      // the first reply is still there when it was not a refusal — keep it;
      // a refusal with a dead second call is the model's failure to report
      if (a1.refusal) {
        log({ ok: false, code: e.code || 'PROVIDER_ERROR', rounds, repaired: false });
        return refuse(res, e);
      }
    }
    if (r2) {
      addUsage(r2.usage);
      const a2 = door.attempt(r2.text);
      if (door.hardCount(a2) <= door.hardCount(a1)) { chosen = a2; repaired = true; }
    }
  }

  // 5. the answer
  return finishRun(res, { chosen, rounds, repaired, started, usage, provider, log });
});

/**
 * The relay continuation: the page brings back what the local model said for
 * one modelCall. Round 1 either finishes or asks for the repair round (a
 * second modelCall); round 2 always finishes.
 */
async function resumeRelayRun(req, res, pack, step) {
  const st = takeRelayRun(step.id);
  if (!st || st.packId !== pack.id) {
    return res.status(400).json({
      ok: false, code: 'RELAY_EXPIRED',
      error: 'ההרצה פגה (או שייכת לחבילה אחרת) — לחצו "הרץ" שוב'
    });
  }
  const { ctx, brief, packText, promptChars, started, usage, timeoutMs } = st;
  const addUsage = (u) => {
    if (!u) return;
    usage.prompt_tokens += Number(u.prompt_tokens) || 0;
    usage.completion_tokens += Number(u.completion_tokens) || 0;
    if (u.reasoning_tokens != null) usage.reasoning_tokens = (usage.reasoning_tokens || 0) + (Number(u.reasoning_tokens) || 0);
  };
  let provider = { id: 'browser', model: (ai.getSettings() || {}).model || '' };
  const log = (fields) => logRun(Object.assign({
    id: pack.id, action: 'run', provider: provider.id, model: provider.model,
    ms: Date.now() - started, promptChars, usage
  }, fields));

  let r;
  try {
    r = ai.readRelayReply(step.result, { ms: Date.now() - started, model: provider.model });
  } catch (e) {
    log({ ok: false, code: e.code || 'PROVIDER_ERROR', rounds: st.first ? 2 : 1, repaired: false });
    return refuse(res, e);
  }
  addUsage(r.usage);
  provider = r.provider || provider;
  const door = doorFor(pack, ctx, brief);
  const a = door.attempt(r.text);

  // round 1: good enough, or ask for the repair round through the page again
  if (!st.first) {
    if (!door.needsRepair(a)) {
      return finishRun(res, { chosen: a, rounds: 1, repaired: false, started, usage, provider, log });
    }
    let call;
    try {
      call = ai.relayRequest({
        system: '',
        user: door.repairTurn(a),
        history: [{ role: 'user', content: packText }, { role: 'assistant', content: r.text }],
        maxTokens: pack.run.maxTokens,
        turnCap: REPAIR_TURN_CAP
      });
    } catch (e) {
      // no second turn to be had — the first reply still stands on its own
      return finishRun(res, { chosen: a, rounds: 1, repaired: false, started, usage, provider, log });
    }
    const id = putRelayRun({ packId: pack.id, ctx, brief, packText, promptChars, started, usage, timeoutMs, first: a });
    log({ ok: true, code: 'RELAY_REPAIR', rounds: 2, repaired: false });
    return relayAnswer(res, { pack, id, body: call.body, provider, timeoutMs, stage: 'repair', rounds: 2 });
  }

  // round 2: the reply with fewer hard warnings wins (tie → the repaired one)
  const a1 = st.first;
  const better = door.hardCount(a) <= door.hardCount(a1);
  return finishRun(res, {
    chosen: better ? a : a1, rounds: 2, repaired: better, started, usage, provider, log
  });
}

// ── injection jobs (v2.30): queue a pack for the owner's own worker ─────
//
// Same builder and the same context gate as /run — a job and a run are the
// same request with a different courier. The model on the other end is always
// the owner's LOCAL one, so the pack is held to the local window whatever the
// site's provider happens to be set to.

/** The one place a pack is composed for either courier. Throws with .code. */
function composePack(pack, { brief, size, variant, locale }) {
  const ctx = siteState();
  const built = pack.buildPrompt({ brief, size, locale, variant, ctx });
  return { ctx, built };
}

/**
 * The door for a JOB reply — the counterpart of resumeRelayRun, for a courier
 * that may answer hours later. The site state is rebuilt FRESH here on
 * purpose: a job queued last night must be judged against the site as it is
 * now, not as it was when the prompt was composed.
 * @returns {{ok, repair?:{prompt,history,maxTokens}, done?:true, status?, warnings?, hard?}}
 */
function judgeJobReply(job, replyText, usage) {
  const jobs = require('../inject-jobs');
  const pack = registry.get(job.packId);
  if (!pack || !registry.isReady(pack)) {
    const e = new Error('החבילה "' + job.packId + '" אינה זמינה בשרת הזה');
    e.code = 'NOT_READY';
    throw e;
  }
  const ctx = siteState();
  const door = doorFor(pack, ctx, job.brief);
  const a = door.attempt(replyText);

  // round 1: good enough, or ask the worker for the one repair turn
  if (job.round === 1 && door.needsRepair(a)) {
    const repairPrompt = door.repairTurn(a);
    const history = [
      { role: 'user', content: String(job.prompt).slice(0, REPAIR_TURN_CAP) },
      { role: 'assistant', content: String(replyText).slice(0, REPAIR_TURN_CAP) }
    ];
    jobs.updateJob(job.id, { firstReply: replyText, usage: usage || job.usage || null });
    jobs.askRepair(job.id, { history, prompt: repairPrompt });
    return { ok: true, repair: { prompt: repairPrompt, history, maxTokens: job.maxTokens } };
  }

  // round 2: the reply with fewer hard warnings wins (tie → the repaired one).
  // The first reply is re-judged against today's ctx so the comparison is fair.
  let chosen = a;
  let repaired = false;
  let rounds = job.round;
  if (job.round === 2 && job.firstReply) {
    const a1 = door.attempt(job.firstReply);
    if (door.hardCount(a) <= door.hardCount(a1)) { chosen = a; repaired = true; }
    else chosen = a1;
  }

  const sumUsage = (x, y) => {
    if (!x && !y) return null;
    const out = { prompt_tokens: 0, completion_tokens: 0 };
    for (const u of [x, y]) {
      if (!u) continue;
      out.prompt_tokens += Number(u.prompt_tokens) || 0;
      out.completion_tokens += Number(u.completion_tokens) || 0;
      if (u.reasoning_tokens != null) out.reasoning_tokens = (out.reasoning_tokens || 0) + (Number(u.reasoning_tokens) || 0);
    }
    return out;
  };
  const totalUsage = sumUsage(job.usage, usage);

  if (chosen.refusal) {
    // the reply is kept: the owner can still read it, fix it and paste it
    jobs.finishJob(job.id, {
      status: 'failed', reply: chosen.text, usage: totalUsage,
      error: { code: chosen.refusal.code || 'BAD_REPLY', message: chosen.refusal.message }
    });
    logRun({
      id: job.packId, action: 'job', provider: 'worker', model: job.model || '',
      ok: false, code: chosen.refusal.code || 'BAD_REPLY', rounds, repaired: false,
      promptChars: job.promptChars, replyChars: chosen.text.length, usage: totalUsage, ms: Date.now() - job.createdAt
    });
    return { ok: true, done: true, status: 'failed', code: chosen.refusal.code || 'BAD_REPLY', error: chosen.refusal.message };
  }

  const p = chosen.parsed;
  jobs.finishJob(job.id, {
    status: 'done', reply: chosen.text, usage: totalUsage,
    result: {
      rounds, repaired,
      preview: p.preview || null,
      warnings: p.warnings || [],
      warningTexts: textsOf(p),
      notes: p.notes || [],
      hard: !!p.hard
    }
  });
  logRun({
    id: job.packId, action: 'job', provider: 'worker', model: job.model || '',
    ok: true, rounds, repaired, promptChars: job.promptChars, replyChars: chosen.text.length,
    usage: totalUsage, warningCodes: codesOf(p.warnings), ms: Date.now() - job.createdAt
  });
  return { ok: true, done: true, status: 'done', warnings: codesOf(p.warnings), hard: !!p.hard };
}

router.get('/admin/api/inject/jobs', requireAdmin, (req, res) => {
  const jobs = require('../inject-jobs');
  res.json({
    ok: true,
    jobs: jobs.listJobs({ packId: String(req.query.packId || ''), limit: Number(req.query.limit) || 20 }).map(jobs.publicView),
    worker: jobs.workerStatus()
  });
});

router.get('/admin/api/inject/jobs/:jobId', requireAdmin, (req, res) => {
  const jobs = require('../inject-jobs');
  const job = jobs.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'עבודה לא נמצאה', code: 'NO_JOB' });
  // the finished text rides along — it is what the card puts in the textarea
  res.json({ ok: true, job: Object.assign(jobs.publicView(job), { reply: job.reply || '' }) });
});

router.post('/admin/api/inject/jobs/:jobId/cancel', requireAdmin, (req, res) => {
  const jobs = require('../inject-jobs');
  const job = jobs.cancelJob(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'עבודה לא נמצאה', code: 'NO_JOB' });
  res.json({ ok: true, job: jobs.publicView(job) });
});

router.post('/admin/api/inject/:id/job', requireAdmin, (req, res) => {
  const pack = packOr404(req, res);
  if (!pack) return;
  const jobs = require('../inject-jobs');
  const b = req.body || {};
  const brief = briefFor(b.brief);
  const size = sizeFor(pack, b.size);
  const variant = variantFor(b.variant);
  const locale = localeFor(b.locale);
  if (!pack.run.enabled) {
    const e = new Error('החבילה "' + pack.title + '" אינה ניתנת להרצה');
    e.code = 'RUN_DISABLED';
    return refuse(res, e);
  }
  if (pack.buildPrompt === null || !registry.isReady(pack)) return refuse(res, notReady(pack));
  let built;
  try {
    ({ built } = composePack(pack, { brief, size, variant, locale }));
  } catch (e) {
    return refuse(res, e);
  }
  // the worker always runs a LOCAL model, whatever the site's provider says
  const tokensEst = ai.estimateTokens(built.chars);
  const budget = ai.contextBudget('local');
  if (tokensEst + pack.run.maxTokens > budget) {
    return res.status(400).json({
      ok: false, code: 'PACK_TOO_BIG',
      error: 'החבילה (~' + tokensEst.toLocaleString('en-US') + ' טוקנים + ' + pack.run.maxTokens.toLocaleString('en-US') +
        ' לתשובה) גדולה מחלון ההקשר של המודל (' + budget.toLocaleString('en-US') + ') — נסו חבילה לייט',
      suggestSize: 'lite', tokensEst, budget
    });
  }
  const settings = ai.getSettings();
  const model = (settings.provider === 'local' || settings.provider === 'browser') ? (settings.model || '') : '';
  let job;
  try {
    job = jobs.createJob({
      packId: pack.id, brief, size, variant, locale,
      prompt: built.text, promptChars: built.chars, maxTokens: pack.run.maxTokens, model
    });
  } catch (e) {
    // NO_BRIEFING: the queue refused a pack composed without its dialect (v2.42)
    logRun({ id: pack.id, action: 'job', provider: 'worker', model, ok: false, code: e.code || 'QUEUE_FAILED', promptChars: built.chars, ms: 0 });
    return refuse(res, e);
  }
  logRun({
    id: pack.id, action: 'job', provider: 'worker', model, ok: true, code: 'QUEUED',
    promptChars: built.chars, ms: 0
  });
  res.json({ ok: true, job: jobs.publicView(job), worker: jobs.workerStatus() });
});

module.exports = router;
module.exports.judgeJobReply = judgeJobReply;
