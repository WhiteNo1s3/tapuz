'use strict';

/**
 * v2.32 QA — the copilot fits the window it was given.
 *
 * Ben's Gemma was loaded at 8,192 tokens and the copilot sent it a 45K-char
 * briefing. LM Studio's honest answer was a 400 with the numbers in it —
 * and its DIShonest answer, measured live, was a 200 with the middle of the
 * prompt thrown away (n_ctx ≤ n_prompt < 2·n_ctx). Both are walked here with
 * a scripted provider: the 400 must teach the window and shrink the
 * briefing; the halved 200 must be caught by its own usage count and never
 * reach the owner; a window nobody measured must never get the full
 * dictionary. No model, no server — every number is the one from map.md.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-window-'));

const win = require('../src/ai-window');
const ai = require('../src/ai');
const tools = require('../src/ai-tools');
const { buildCopilotBriefing } = require('../src/pzn/agent-roleplay');
const { createPage } = require('../src/pages');

let probeChecks = Promise.resolve(); // the probe block below assigns it; the door run awaits it
let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };
const rejects = async (fn, code) => {
  try { await fn(); return null; } catch (e) { return (!code || e.code === code) ? e : { wrongCode: e.code, message: e.message }; }
};

// ── parseExceed: the EXACT body LM Studio sent Ben ────────────────────────
const EXCEED = {
  error: {
    code: 400,
    message: 'request (17246 tokens) exceeds the available context size (8192 tokens), try increasing it',
    type: 'exceed_context_size_error',
    n_prompt_tokens: 17246,
    n_ctx: 8192
  }
};
{
  const p = win.parseExceed(EXCEED);
  check('parseExceed reads n_prompt_tokens / n_ctx from the typed body', p && p.nPrompt === 17246 && p.nCtx === 8192);
  const q = win.parseExceed({ error: { message: 'request (17246 tokens) exceeds the available context size (8192 tokens), try increasing it' } });
  check('parseExceed reads the numbers out of a message-only body', q && q.nPrompt === 17246 && q.nCtx === 8192);
  check('parseExceed ignores other errors', win.parseExceed({ error: { message: 'model not found' } }) === null && win.parseExceed({ choices: [] }) === null);
}

// ── probeLocalWindow: LM Studio's native /api/v0/models, as measured ──────
{
  const V0 = {
    data: [
      { id: 'text-embedding-nomic', object: 'model', type: 'embeddings', state: 'loaded', max_context_length: 2048, loaded_context_length: 2048 },
      // as the live box reports it (2026-09-14): a vision-capable chat model is type 'vlm', NOT 'llm'
      { id: 'google/gemma-4-31b', object: 'model', type: 'vlm', state: 'loaded', max_context_length: 262144, loaded_context_length: 8192, capabilities: ['tool_use'] },
      { id: 'qwen/qwen3.6-35b-a3b', object: 'model', type: 'vlm', state: 'not-loaded', max_context_length: 262144 },
      { id: 'some/plain-llm', object: 'model', type: 'llm', state: 'not-loaded', max_context_length: 32768 }
    ]
  };
  const fake = (json, ok = true) => async (url) => ({ ok, json: async () => json, url });
  const probes = [];
  probeChecks = (async () => {
    const hit = await win.probeLocalWindow('http://127.0.0.1:1234/v1', 'gemma-4-31b', { fetch: async (url) => { probes.push(url); return { ok: true, json: async () => V0 }; } });
    check('probe: GET {origin}/api/v0/models (not /v1/…)', probes[0] === 'http://127.0.0.1:1234/api/v0/models');
    check('probe: matches the configured id loosely (gemma-4-31b ~ google/gemma-4-31b) and reads loaded_context_length',
      hit && hit.tokens === 8192 && hit.maxTokens === 262144 && hit.model === 'google/gemma-4-31b' && hit.jit === false);
    check('probe: the loaded list skips the embedding model', hit && hit.loaded.length === 1 && hit.loaded[0] === 'google/gemma-4-31b');
    check('probe: a "vlm" (vision-capable chat model — what gemma-4-31b really reports) is a chat model, not filtered out',
      hit && hit.model === 'google/gemma-4-31b' && hit.tokens === 8192 && hit.jit === false);
    const jit = await win.probeLocalWindow('http://127.0.0.1:1234/v1', 'qwen/qwen3.6-35b-a3b', { fetch: fake(V0) });
    check('probe: a configured model that is NOT loaded → jit:true, tokens null (LM Studio will JIT-load it at the GUI default)',
      jit && jit.jit === true && jit.tokens === null && jit.maxTokens === 262144);
    const any = await win.probeLocalWindow('http://localhost:1234/v1', '', { fetch: fake(V0) });
    check('probe: an empty model setting takes the loaded chat model', any && any.tokens === 8192 && any.model === 'google/gemma-4-31b');
    // the settings' placeholder / the bridge's fallback name: LM Studio does
    // not know it and serves the loaded model — so THAT window counts, and
    // it is not a JIT case (nothing named 'local-model' will ever be loaded)
    const placeholder = await win.probeLocalWindow('http://127.0.0.1:1234/v1', 'local-model', { fetch: fake(V0) });
    check('probe: a name LM Studio does not know (the "local-model" placeholder) → the loaded entry\'s window, jit:false',
      placeholder && placeholder.tokens === 8192 && placeholder.model === 'google/gemma-4-31b' && placeholder.jit === false);
    const nothing = await win.probeLocalWindow('http://127.0.0.1:1234/v1', 'local-model', { fetch: fake({ data: [V0.data[2], V0.data[3]] }) });
    check('probe: an unknown name with NOTHING loaded → jit:true, tokens null', nothing && nothing.jit === true && nothing.tokens === null);
    check('probe: a non-LM-Studio server (404) → null, never a throw', (await win.probeLocalWindow('http://127.0.0.1:11434/v1', 'x', { fetch: fake({}, false) })) === null);
    check('probe: a wire failure → null', (await win.probeLocalWindow('http://127.0.0.1:1234/v1', 'x', { fetch: async () => { throw new Error('ECONNREFUSED'); } })) === null);
    check('probe: a non-loopback address is refused before any fetch', (await win.probeLocalWindow('https://api.openai.com/v1', 'x', { fetch: fake(V0) })) === null);
  })();
}

// ── arithmetic ────────────────────────────────────────────────────────────
check('replyReserve: a quarter of the window, 1024..4096 (8192 → 2048, 32768 → 4096, Infinity → 4096)',
  win.replyReserve(8192) === 2048 && win.replyReserve(32768) === 4096 && win.replyReserve(Infinity) === 4096 && win.replyReserve(2048) === 1024);
check('promptBudgetTokens = window − reserve − 384 headroom',
  win.promptBudgetTokens(8192) === 8192 - 2048 - 384 && win.promptBudgetTokens(Infinity) === Infinity);
check('constants: FULL_MIN 32768, headroom 384, ratio 2.6, recommended 32768',
  win.FULL_MIN_WINDOW_TOKENS === 32768 && win.TEMPLATE_HEADROOM_TOKENS === 384 && win.DEFAULT_RATIO === 2.6 && win.RECOMMENDED_WINDOW === 32768);

// the briefing sizes as measured (full ≈ 45K chars, compact ≈ 9.5K) + the
// tool JSON and a short message
const SIZES = { full: 45356, compact: 9500 };
const FIXED = 1500;
const tier = (tokens, source) => win.pickTier({ tokens, source, ratio: 2.6, sizes: SIZES, fixedChars: FIXED }).tier;
check('pickTier: 8192 (probe) → compact', tier(8192, 'probe') === 'compact');
check('pickTier: 24576 (probe) → compact — under Ben\'s 32K floor', tier(24576, 'probe') === 'compact');
check('pickTier: 32768 (probe) → full', tier(32768, 'probe') === 'full');
check('pickTier: 32768 but only ADVISORY → compact (a guess never promotes)', tier(32768, 'advisory') === 'compact');
check('pickTier: unknown source with a number → compact', tier(65536, 'unknown') === 'compact');
check('pickTier: Infinity (cloud key) → full', tier(Infinity, 'cloud') === 'full' && tier(Infinity, 'probe') === 'full');
check('pickTier: 6000 → null (compact does not fit either)', tier(6000, 'probe') === null);
{
  const p = win.pickTier({ tokens: 32768, source: 'hint', ratio: 2.6, sizes: SIZES, fixedChars: FIXED });
  check('pickTier reports roomChars for history + read-backs and the estimated promptTokens',
    p.roomChars > 20000 && p.promptTokens === Math.ceil((SIZES.full + FIXED) / 2.6));
}

// ── the briefing tiers ────────────────────────────────────────────────────
{
  const media = Array.from({ length: 30 }, (_, i) => ({ url: '/uploads/w' + i + '.webp', alt: 'תיאור ארוך מאוד של תמונה '.repeat(6) }));
  // toMarkdown stamps a generation time — mask it before comparing bytes
  const mask = (t) => t.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, 'T');
  const plain = buildCopilotBriefing({ locale: 'he', media, siteTitle: 'אתר' });
  const full = buildCopilotBriefing({ locale: 'he', media, siteTitle: 'אתר', tier: 'full' });
  const compact = buildCopilotBriefing({ locale: 'he', media, siteTitle: 'אתר', tier: 'compact' });
  check('buildCopilotBriefing() with no tier === tier "full", byte for byte', mask(plain.text) === mask(full.text) && plain.tier === 'full');
  check('the full tier is today\'s ~45K text with the whole dictionary', full.chars > 40000 && /## Syntax Dictionary|מילון/.test(full.text));
  // 11,000 → 11,500 (v2.34): the leaf rule + a cards-of-leaves example cost
  // the compact tier ~530 chars (~200 tokens). An 8,192 window still leaves
  // 5,760 prompt tokens (≈ 15K chars) — and one mediacard with a heading
  // nested inside it is a whole page that renders empty cards.
  check(`compact.chars ≤ 11500 (${compact.chars}) and carries the compact grammar`, compact.chars <= 11500 && compact.text.includes('דקדוק מקוצר') && compact.tier === 'compact');
  check('compact caps the media manifest at 12 lines with trimmed alts',
    (compact.text.match(/- `\/uploads\/w\d+\.webp`/g) || []).length === 12 && compact.text.includes('+18 תמונות נוספות'));
  check('compact tells the model its window is small — build short, do not guess', compact.text.includes('החלון של המודל הזה קטן'));
  check('full does NOT carry the small-window line', !full.text.includes('החלון של המודל הזה קטן'));
  check('both tiers carry the same module count (one vocabulary)', compact.moduleCount === full.moduleCount && compact.moduleCount > 30);
  check('canvas is echoed back, never painted into the text', buildCopilotBriefing({ canvas: 'blank' }).canvas === 'blank' && mask(buildCopilotBriefing({ canvas: 'blank' }).text) === mask(buildCopilotBriefing({}).text));
}

// ── fitTurns (§0.7) ───────────────────────────────────────────────────────
{
  const hist = [
    { role: 'assistant', content: 'פתיחה שלא במקומה' },
    { role: 'user', content: 'ראשון' },
    { role: 'assistant', content: '' },
    { role: 'assistant', content: '   ' },
    { role: 'assistant', content: null },
    { role: 'user', content: 'שני' },
    { role: 'user', content: 'שלישי' },
    { role: 'assistant', content: 'תשובה' },
    { role: 'user', content: 'עכשיו' }
  ];
  const out = win.fitTurns(hist, Infinity);
  check('fitTurns drops empty / whitespace / non-string turns', out.every((t) => typeof t.content === 'string' && t.content.trim()));
  // once the empty assistant turns are gone, ראשון/שני/שלישי are consecutive
  // user turns — one message with blank lines, as the model should read it
  check('fitTurns never starts with an assistant turn', out[0].role === 'user' && out[0].content.startsWith('ראשון'));
  check('fitTurns merges consecutive same-role user turns with a blank line', out[0].content === 'ראשון\n\nשני\n\nשלישי' && out.length === 3);
  check('fitTurns keeps the current message last', out[out.length - 1].content === 'עכשיו');

  const unit = [
    { role: 'user', content: 'ישן מאוד' },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: 'ערוך את הבית' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_page', arguments: '{"slug":"home"}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ slug: 'home', source: 'x'.repeat(3000) }) },
    { role: 'user', content: 'עכשיו' }
  ];
  const roomy = win.fitTurns(unit, 100000);
  check('fitTurns keeps the assistant-with-tool_calls turn and its tool answer as one unit',
    roomy.some((t) => t.role === 'assistant' && t.tool_calls) && roomy.some((t) => t.role === 'tool'));
  const tight = win.fitTurns(unit, 2000);
  check('fitTurns in a tight room drops the whole unit (never a sliced tool JSON) and keeps the current message',
    !tight.some((t) => t.role === 'tool') && !tight.some((t) => t.tool_calls) && tight[tight.length - 1].content === 'עכשיו');
  const capped = win.fitTurns([{ role: 'user', content: 'y'.repeat(20000) }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'z'.repeat(30000) }], 100000);
  check('fitTurns caps a plain turn at 12,000 chars (the current message too)',
    capped[0].content.length === 12000 && capped[capped.length - 1].content.length === 12000);
  const orphan = win.fitTurns([{ role: 'tool', tool_call_id: 'x', content: '{}' }, { role: 'user', content: 'הי' }], Infinity);
  check('fitTurns drops an orphan tool answer', orphan.length === 1 && orphan[0].role === 'user');
}

// ── describeWindow — the Hebrew the pages reuse ───────────────────────────
{
  const full = win.describeWindow({ tokens: 32768, source: 'probe', tier: 'full', model: 'google/gemma-4-31b' });
  check('describeWindow ≥ 32K: the full-dictionary sentence with the number', /32,768/.test(full) && /המילון המלא/.test(full) && full.includes('google/gemma-4-31b'));
  const compact = win.describeWindow({ tokens: 8192, source: 'probe', tier: 'compact', model: 'google/gemma-4-31b', editMaxChars: 4200 });
  check('describeWindow compact: says compact, names editMaxChars, gives the Context Length click path + the lms line',
    /8,192/.test(compact) && /מצב מקוצר/.test(compact) && /4,200/.test(compact) && /Context Length/.test(compact) && /32768/.test(compact) && /lms load google\/gemma-4-31b --context-length 32768/.test(compact));
  const jit = win.describeWindow({ tokens: 8192, source: 'probe', tier: 'compact', model: 'm', jit: true });
  check('describeWindow jit: the auto-load prefix', /נטען אוטומטית/.test(jit) && /מצב מקוצר/.test(jit));
  const small = win.describeWindow({ tokens: 4096, source: 'probe', tier: null, minTokens: 8192 });
  check('describeWindow too small: the number, the minimum, Context Length', /4,096/.test(small) && /8,192/.test(small) && /Context Length/.test(small));
  const unknown = win.describeWindow({ tokens: null, source: 'unknown' });
  check('describeWindow unknown: names the old bridge / non-LM-Studio cause and the compact fallback', /0\.5\.0/.test(unknown) && /מצב מקוצר/.test(unknown));
  check('the WINDOW_TOO_SMALL fix and the bridge fix carry the click paths',
    /Context Length/.test(win.HE.fixWindow) && /32768/.test(win.HE.fixWindow) && /0\.5\.0/.test(win.HE.fixBridge) && /chrome:\/\/extensions/.test(win.HE.fixBridge));
}

// ── the door: converse through the scripted provider ──────────────────────
const providers = require('../src/providers');
providers.PROVIDERS.__fake = {
  id: '__fake', label: 'test', endpoint: 'http://127.0.0.1:1/v1/chat/completions',
  method: 'POST', authScheme: 'bearer', authHeader: 'Authorization', extraHeaders: {},
  defaultModel: 'm', models: [], openModel: true, keyOptional: true, maxTokens: 100,
  responsePath: ['choices', 0, 'message', 'content'],
  body: { style: 'openai-chat' }, baseUrlDefault: 'http://127.0.0.1:1/v1'
};
let scripted = [];
let seen = [];
global.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  seen.push(body);
  const next = scripted.shift() || { ok: true, json: { choices: [{ message: { content: 'done', tool_calls: null } }] } };
  return { ok: next.ok !== false, status: next.status || (next.ok === false ? 400 : 200), json: async () => next.json };
};
const ok = (json) => ({ ok: true, json });
const http400 = (json) => ({ ok: false, status: 400, json });
const text = (t, extra) => ok({ choices: [{ message: { content: t, tool_calls: null }, finish_reason: 'stop' }], ...(extra || {}) });

const PZN = (title, body, slug = 'w-page') =>
  '<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n<head><meta charset="utf-8"/>' +
  `<title>${title}</title><meta name="bent-slug" content="${slug}"/></head>\n<body>\n` +
  `  <bent-heading id="h1" level="1">${body}</bent-heading>\n</body></html>`;

let media = [];
const systemFor = (t) => buildCopilotBriefing({ locale: 'he', media, siteTitle: 'אתר הבדיקה', tier: t }).text;

createPage({ title: 'הבית', slug: 'home', status: 'published', blocks: [] });
require('../src/pages').savePageSource('home', PZN('הבית', 'שלום', 'home'), { publish: true });

(async () => {
  await probeChecks;
  // (a) the exceed body teaches the window and shrinks the briefing
  ai.saveSettings({ provider: '__fake', baseUrl: 'http://127.0.0.1:1/v1', model: 'm-a' });
  scripted = [http400(EXCEED), text('שלום! איך אפשר לעזור?', { usage: { prompt_tokens: 4200, completion_tokens: 12 } })];
  seen = [];
  const a = await ai.converse({ systemFor, user: 'שלום' });
  check('(a) a cloud-style provider starts at the FULL briefing', seen[0].messages[0].content.length > 40000);
  check('(a) after the exceed 400 the second request carries the COMPACT briefing (< 12,000 chars)',
    seen.length === 2 && seen[1].messages[0].content.length < 12000);
  check('(a) …with max_tokens = replyReserve(8192) = 2048', seen[1].max_tokens === 2048 && seen[0].max_tokens === 4096);
  check('(a) the turn completes with the retry\'s reply', a.reply === 'שלום! איך אפשר לעזור?');
  check('(a) notice says it shrank, with the numbers', /מקצר/.test(a.notice) && /8,192/.test(a.notice) && /17,246/.test(a.notice));
  check('(a) window.source === "error", tier compact, tokens 8192', a.window.source === 'error' && a.window.tier === 'compact' && a.window.tokens === 8192);
  check('(a) fetch was called exactly twice (a shrink does not consume a hop)', seen.length === 2);
  check('(a) usage calibrated the ratio for this model', a.window.ratio >= 2.0 && a.window.ratio <= 3.5);

  // (b) two exceeds → WINDOW_TOO_SMALL with a fix
  ai.saveSettings({ model: 'm-b' });
  scripted = [http400(EXCEED), http400({ error: { type: 'exceed_context_size_error', message: 'request (9000 tokens) exceeds the available context size (8192 tokens), try increasing it', n_prompt_tokens: 9000, n_ctx: 8192 } })];
  seen = [];
  const b = await rejects(() => ai.converse({ systemFor, user: 'שלום' }), 'WINDOW_TOO_SMALL');
  check('(b) two exceeds → rejects WINDOW_TOO_SMALL', b && b.code === 'WINDOW_TOO_SMALL');
  check('(b) …the message carries both numbers and .fix carries Context Length',
    b && /9,000/.test(b.message) && /8,192/.test(b.message) && /Context Length/.test(b.fix || ''));
  check('(b) exactly two requests went out', seen.length === 2);

  // (c) the silent band: a 200 whose usage exceeds the PROBED window is discarded
  ai.saveSettings({ model: 'm-c' });
  win.noteWindow(win.windowKey('__fake', 'm-c'), 8192, 'probe');
  scripted = [
    text('תשובה חלולה מהפרומפט החצוי', { usage: { prompt_tokens: 15179, completion_tokens: 40 } }),
    text('תשובה אמיתית', { usage: { prompt_tokens: 4100, completion_tokens: 10 } })
  ];
  seen = [];
  const c = await ai.converse({ systemFor, user: 'בנה דף בית' });
  check('(c) the halved reply is discarded and the retry\'s reply is returned', c.reply === 'תשובה אמיתית' && !/חלולה/.test(c.reply) && !/חלולה/.test(c.memo));
  check('(c) the retry went out at compact (a probed 8192 never gets full)', seen.length === 2 && seen[1].messages[0].content.length < 12000 && c.window.tier === 'compact');
  check('(c) notice names the halving numbers', /15,179/.test(c.notice) && /8,192/.test(c.notice));
  check('(c) the last usage is reported', c.window.promptTokens === 4100);
  // …and twice → WINDOW_TOO_SMALL with nPrompt = usage.prompt_tokens
  scripted = [
    text('חלול 1', { usage: { prompt_tokens: 15179, completion_tokens: 40 } }),
    text('חלול 2', { usage: { prompt_tokens: 15000, completion_tokens: 40 } })
  ];
  const c2 = await rejects(() => ai.converse({ systemFor, user: 'שוב' }), 'WINDOW_TOO_SMALL');
  check('(c) halved twice → WINDOW_TOO_SMALL with the usage count as nPrompt', c2 && /15,000/.test(c2.message) && /8,192/.test(c2.message));
  // …and from FULL the retry is one tier DOWN by rule: a probed 32,768 starts
  // full; a 200 counting 33,000 prompt tokens makes the raw ratio ≈ 1.4,
  // clamped to 2.0 — under which the full briefing still "fits" the estimate.
  // The tier-down must not depend on the estimate.
  ai.saveSettings({ model: 'm-c3' });
  win.noteWindow(win.windowKey('__fake', 'm-c3'), 32768, 'probe');
  scripted = [
    text('חלול מהמילון המלא', { usage: { prompt_tokens: 33000, completion_tokens: 40 } }),
    text('תשובה מקוצרת', { usage: { prompt_tokens: 9000, completion_tokens: 10 } })
  ];
  seen = [];
  const c3 = await ai.converse({ systemFor, user: 'בנה דף' });
  check('(c) a probed 32,768 starts at the FULL briefing', seen[0].messages[0].content.length > 40000);
  check('(c) a halved 200 at full → the ONE retry goes out at COMPACT even when the clamped ratio says full fits',
    seen.length === 2 && seen[1].messages[0].content.length < 12000 && c3.window.tier === 'compact' && c3.reply === 'תשובה מקוצרת');

  // (e) reply hygiene
  ai.saveSettings({ model: 'm-e' });
  scripted = [ok({ choices: [{ message: { content: 'חצי מסמך', tool_calls: [{ id: 'k1', type: 'function', function: { name: 'edit_page', arguments: '{"slug":"home","source":"<!DOCTYPE' } }] }, finish_reason: 'length' }] })];
  const e1 = await rejects(() => ai.converse({ systemFor, user: 'ערוך' }), 'REPLY_CUT');
  check('(e) finish "length" WITH tool_calls → REPLY_CUT (never a pending)', e1 && /נחתכה/.test(e1.message));
  scripted = [ok({ choices: [{ message: { content: 'טקסט שנחתך' }, finish_reason: 'length' }] })];
  const e2 = await ai.converse({ systemFor, user: 'ספר' });
  check('(e) finish "length" with text → the text + truncated:true', e2.reply === 'טקסט שנחתך' && e2.truncated === true);
  scripted = [ok({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] })];
  const e3 = await rejects(() => ai.converse({ systemFor, user: 'x' }), 'EMPTY_REPLY');
  check('(e) empty content and no calls → EMPTY_REPLY, never a silent ""', e3 && /ריקה/.test(e3.message));
  scripted = [ok({ choices: [{ message: { content: 'תשובה רגילה', tool_calls: [], reasoning_content: 'חשבתי' }, finish_reason: 'stop' }] })];
  const e4 = await ai.converse({ systemFor, user: 'x' });
  check('(e) non-streaming tool_calls: [] + reasoning_content = a plain reply', e4.reply === 'תשובה רגילה' && !e4.pending);
  scripted = [ok({ choices: [{ message: { content: '', tool_calls: [] }, finish_reason: 'tool_calls' }] })];
  const e5 = await rejects(() => ai.converse({ systemFor, user: 'x' }), 'BRIDGE_DROPPED_TOOLS');
  check('(e) finish "tool_calls" with no calls → BRIDGE_DROPPED_TOOLS + fix', e5 && /Bridge V2/.test(e5.message) && /0\.5\.0/.test(e5.fix || ''));
  scripted = [http400({ error: { message: 'boom' } })];
  const e6 = await rejects(() => ai.converse({ systemFor, user: 'x' }), 'PROVIDER_ERROR');
  check('(e) any other error body → PROVIDER_ERROR with the message', e6 && /boom/.test(e6.message));
  scripted = [http400({ error: { message: 'model "gemma" not found' } })];
  const e7 = await rejects(() => ai.converse({ systemFor, user: 'x' }), 'PROVIDER_ERROR');
  check('(e) "model not found" is translated to the LM Studio hint', e7 && /לא טעון ב-LM Studio/.test(e7.message));

  // (f) content-embedded tool calls
  scripted = [
    text('<tool_call>{"name":"list_pages","arguments":{}}</tool_call>'),
    text('יש דף אחד')
  ];
  seen = [];
  const f1 = await ai.converse({ systemFor, user: 'אילו דפים?' });
  check('(f) a whole-content <tool_call> block is ONE synthesized call (id emb_0) and the tool ran',
    f1.used.includes('list_pages') && f1.reply === 'יש דף אחד' && seen[1].messages.some((m) => m.role === 'assistant' && m.tool_calls && m.tool_calls[0].id === 'emb_0'));
  scripted = [text('```json\n{"name":"read_page","parameters":{"slug":"home"}}\n```'), text('קראתי')];
  const f2 = await ai.converse({ systemFor, user: 'קרא' });
  check('(f) a fenced JSON object with "parameters" is a call too', f2.used.includes('read_page') && f2.reads.includes('home'));
  scripted = [text('הנה מה שאעשה:\n```json\n{"name":"list_pages","arguments":{}}\n```\nבסדר?')];
  const f3 = await ai.converse({ systemFor, user: 'x' });
  check('(f) prose around a fence is prose — zero calls', !f3.used.length && /הנה מה שאעשה/.test(f3.reply));
  scripted = [text('{"name":"drop_database","arguments":{}}')];
  const f4 = await ai.converse({ systemFor, user: 'x' });
  check('(f) an unknown name is not a call', !f4.used.length && /drop_database/.test(f4.reply));

  // (i) a write among reads: every call id answered, memo on proposal
  scripted = [ok({
    choices: [{
      message: {
        content: '', tool_calls: [
          { id: 'r1', type: 'function', function: { name: 'read_page', arguments: '{"slug":"home"}' } },
          { id: 'w1', type: 'function', function: { name: 'edit_page', arguments: JSON.stringify({ slug: 'home', source: PZN('הבית', 'אחרי', 'home') }) } }
        ]
      }, finish_reason: 'tool_calls'
    }]
  })];
  const i1 = await ai.converse({ systemFor, user: 'ערוך את הבית' });
  check('(i) the write is proposed with its full source; memo /הצעתי/', i1.pending && i1.pending.tool === 'edit_page' && /<bent-heading/.test(i1.pending.input.source) && /הצעתי/.test(i1.memo));
  check('(i) the read in the same batch ran (reads[]) and nothing was written yet',
    i1.reads.includes('home') && !/אחרי/.test(require('../src/pages').getPageSource('home', 'draft')));
  scripted = [text('עודכן!')];
  seen = [];
  const i2 = await ai.converse({ approve: { id: i1.pending.id, ok: true } });
  const toolTurns = seen[0].messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
  check('(i) on approval EVERY call id of that batch is answered (r1 + w1), the assistant tool_calls turn kept',
    toolTurns.includes('r1') && toolTurns.includes('w1') && seen[0].messages.some((m) => m.role === 'assistant' && m.tool_calls && m.tool_calls.length === 2));
  check('(i) applied.edited + memo /בוצע/ + the draft changed, the live page untouched',
    i2.applied && i2.applied.edited === true && i2.applied.slug === 'home' && /בוצע/.test(i2.memo) &&
    /אחרי/.test(require('../src/pages').getPageSource('home', 'draft')) &&
    !/אחרי/.test(JSON.stringify(require('../src/pages').getPageByFullPath('home').blocks || [])));
  // refused → memo /דחה/
  scripted = [ok({ choices: [{ message: { content: '', tool_calls: [{ id: 'w2', type: 'function', function: { name: 'create_page', arguments: JSON.stringify({ source: PZN('חדש', 'x', 'w-new') }) } }] }, finish_reason: 'tool_calls' }] })];
  const i3 = await ai.converse({ systemFor, user: 'צור' });
  scripted = [ok({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] })];
  const i4 = await ai.converse({ approve: { id: i3.pending.id, ok: false } });
  check('(i) refused → memo /דחה/ and an empty model reply is NOT an error after an action', /דחה/.test(i4.memo) && i4.reply === '' && !i4.applied);
  // reads only + empty final text → memo 'קראתי'
  scripted = [ok({ choices: [{ message: { content: '', tool_calls: [{ id: 'l1', type: 'function', function: { name: 'list_pages', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }), ok({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] })];
  const i5 = await ai.converse({ systemFor, user: 'x' });
  check('(i) reads only + empty text → memo "קראתי: list_pages"', /קראתי: list_pages/.test(i5.memo));

  // (d) the browser courier: hint → tier; step → judgement
  ai.saveSettings({ provider: 'browser', model: '' });
  const hint = (tokens) => ({ tokens, maxTokens: 262144, model: 'google/gemma-4-31b', source: 'bridge', bridgeVersion: '0.5.0' });
  const d1 = await ai.converse({ systemFor, user: 'שלום', window: hint(8192) });
  check('(d) browser + hint 8192 → modelCall at COMPACT, max_tokens 2048',
    d1.modelCall && d1.modelCall.body.messages[0].content.length < 12000 && d1.modelCall.body.max_tokens === 2048 && d1.window.tier === 'compact' && d1.window.source === 'hint');
  const d2 = await ai.converse({ systemFor, user: 'שלום', window: hint(32768) });
  check('(d) browser + hint 32768 → FULL, max_tokens 4096, the tools ride the body',
    d2.modelCall && d2.modelCall.body.messages[0].content.length > 40000 && d2.modelCall.body.max_tokens === 4096 && Array.isArray(d2.modelCall.body.tools) && d2.window.tier === 'full');
  const d0 = await ai.converse({ systemFor, user: 'שלום' });
  check('(d) browser with NO hint → compact (unknown never full, a stale hint does not linger)',
    d0.modelCall && d0.modelCall.body.messages[0].content.length < 12000 && d0.window.source === 'unknown');
  // v2.35: the relayed call is the FULL briefing, never a bare request — C1
  // (gemma-4-31b with no briefing) invents a ```bentml dialect with zero
  // bent-* tags. A caller that hands the loop no BenTML briefing is refused
  // BEFORE any GPU minute is spent, with its own code.
  check('(d) every modelCall carries the leaf rule + the local ceiling for the page (timeoutMs = LOCAL_TIMEOUT_MS)',
    [d0, d1, d2].every((d) => /E_NOT_CONTAINER/.test(d.modelCall.body.messages[0].content) && d.timeoutMs === ai.LOCAL_TIMEOUT_MS));
  const nb1 = await rejects(() => ai.converse({ system: 'no briefing here', user: 'בנה דף' }), 'NO_BRIEFING');
  const nb2 = await rejects(() => ai.converse({ system: '', user: 'בנה דף' }), 'NO_BRIEFING');
  check('(d) a briefing-less request to the local model over the bridge is refused (NO_BRIEFING), never relayed',
    nb1 && nb1.code === 'NO_BRIEFING' && !nb1.modelCall && nb2 && nb2.code === 'NO_BRIEFING' && /BenTML/.test(nb1.message));
  // step: the exceed body → a NEW modelCall + notice
  const d3 = await ai.converse({ step: { id: d2.modelCall.id, result: EXCEED } });
  check('(d) step = the exceed body → a NEW modelCall (different id) at compact + notice',
    d3.modelCall && d3.modelCall.id !== d2.modelCall.id && d3.modelCall.body.messages[0].content.length < 12000 && /מקצר/.test(d3.notice) && d3.window.source === 'error');
  check('(d) the step id is single-use', !!(await rejects(() => ai.converse({ step: { id: d2.modelCall.id, result: EXCEED } }))));
  // the notice is told ONCE: the step that answers the shrunken call must not carry it again
  const d3b = await ai.converse({ step: { id: d3.modelCall.id, result: { choices: [{ message: { role: 'assistant', content: 'שלום לך' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3900, completion_tokens: 5 } } } });
  check('(d) the shrink notice rides once — the next response of the same turn carries none',
    d3b.reply === 'שלום לך' && d3b.notice === '' && d3b.window.source === 'error' && d3b.window.tokens === 8192);
  // relay_http_error twice → BRIDGE_TOO_OLD
  const d4 = await ai.converse({ systemFor, user: 'שלום', window: { ...hint(32768), bridgeVersion: '' } });
  const relayErr = { error: { type: 'relay_http_error', status: 400, message: 'HTTP 400', bridgeVersion: '0.4.0' } };
  const d5 = await ai.converse({ step: { id: d4.modelCall.id, result: relayErr } });
  check('(d) a bodiless 400 (0.4.0 bridge) → one blind tier-down: a new compact modelCall',
    d5.modelCall && d5.modelCall.body.messages[0].content.length < 12000 && /מקצר/.test(d5.notice));
  const d6 = await rejects(() => ai.converse({ step: { id: d5.modelCall.id, result: relayErr } }), 'BRIDGE_TOO_OLD');
  check('(d) …a second bodiless 400 → BRIDGE_TOO_OLD naming the bridge version, with the download fix',
    d6 && /0\.4\.0/.test(d6.message) && /ai-setup/.test(d6.fix || ''));
  // dropped tools
  const d7 = await ai.converse({ systemFor, user: 'אילו דפים?', window: hint(32768) });
  const d8 = await rejects(() => ai.converse({ step: { id: d7.modelCall.id, result: { choices: [{ message: { content: '', role: 'assistant' }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 18000 } } } }), 'BRIDGE_DROPPED_TOOLS');
  check('(d) step with finish "tool_calls" and no tool_calls → BRIDGE_DROPPED_TOOLS', !!d8 && /מאבד את הקריאה/.test(d8.message));
  // a real tool call → the next modelCall carries the unit
  const d9 = await ai.converse({ systemFor, user: 'אילו דפים?', window: hint(32768) });
  const d10 = await ai.converse({ step: { id: d9.modelCall.id, result: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'lp1', type: 'function', function: { name: 'list_pages', arguments: '{}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 18000, completion_tokens: 20 } } } });
  check('(d) step with tool_calls list_pages → next modelCall carries the assistant tool_calls turn AND a role:"tool" turn',
    d10.modelCall && d10.modelCall.body.messages.some((m) => m.role === 'assistant' && m.tool_calls && m.tool_calls[0].id === 'lp1') &&
    d10.modelCall.body.messages.some((m) => m.role === 'tool' && m.tool_call_id === 'lp1') && d10.used.includes('list_pages'));
  check('(d) usage from the step calibrates + reports promptTokens', d10.window.promptTokens === 18000);
  // an edit_page call → pending with the source, memo; approve → applied; then the model answers
  const d11 = await ai.converse({ step: { id: d10.modelCall.id, result: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'ed1', type: 'function', function: { name: 'edit_page', arguments: JSON.stringify({ slug: 'home', source: PZN('הבית', 'דרך הגשר', 'home') }) } }] }, finish_reason: 'tool_calls' }] } } });
  check('(d) an edit_page call → pending.input.source + memo /הצעתי/ + no modelCall', d11.pending && /דרך הגשר/.test(d11.pending.input.source) && /הצעתי/.test(d11.memo) && !d11.modelCall);
  const d12 = await ai.converse({ approve: { id: d11.pending.id, ok: true } });
  check('(d) approve ok → applied.edited + memo /בוצע/ ride the modelCall that lets the model answer',
    d12.applied && d12.applied.edited === true && /בוצע/.test(d12.memo) && d12.modelCall && d12.modelCall.body.messages.some((m) => m.role === 'tool' && m.tool_call_id === 'ed1'));
  const d13 = await ai.converse({ step: { id: d12.modelCall.id, result: { choices: [{ message: { role: 'assistant', content: 'עודכן' }, finish_reason: 'stop' }] } } });
  check('(d) …and the final reply still carries applied + memo', d13.reply === 'עודכן' && d13.applied && d13.applied.edited === true && /בוצע/.test(d13.memo));
  const d14 = await ai.converse({ systemFor, user: 'צור דף', window: hint(32768) });
  const d15 = await ai.converse({ step: { id: d14.modelCall.id, result: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'cr1', type: 'function', function: { name: 'create_page', arguments: JSON.stringify({ source: PZN('חדש', 'x', 'w-bridge') }) } }] }, finish_reason: 'tool_calls' }] } } });
  const d16 = await ai.converse({ approve: { id: d15.pending.id, ok: false } });
  check('(d) approve refused → memo /דחה/, nothing written', /דחה/.test(d16.memo) && !require('../src/pages').getPageByFullPath('w-bridge'));

  // (h) read_page with an allowance
  const big = PZN('גדול', 'x'.repeat(400), 'big');
  createPage({ title: 'גדול', slug: 'big', status: 'draft', blocks: [] });
  require('../src/pages').savePageSource('big', big, { publish: false });
  const h1 = tools.getTool('read_page').run({ slug: 'big' }, { maxSourceChars: 100 });
  check('(h) read_page over the allowance → tooLong:true, source "", hint mentions Context Length',
    h1.tooLong === true && h1.source === '' && h1.chars > 400 && h1.limitChars === 100 && /Context Length/.test(h1.hint));
  const h2 = tools.getTool('read_page').run({ slug: 'big' });
  check('(h) read_page without opts is unchanged (full source, no tooLong)', h2.tooLong === undefined && h2.source.length > 400);
  const h3 = tools.getTool('list_pages').run({}, { maxSourceChars: 130 });
  // the fixture holds two pages (home + big; every proposal above was refused)
  check('(h) list_pages over the allowance → first K + truncated:true + count', h3.truncated === true && h3.pages.length === 1 && h3.count === 2 && h3.shown === 1);
  check('(h) list_pages without opts lists everything', tools.getTool('list_pages').run().pages.length === 2 && tools.getTool('list_pages').run().truncated === undefined);
  // through the door: a page over the turn's allowance is refused in the tool
  // answer (never sliced), the model is told why, and reads[] does not claim
  // a read that did not happen (the canvas follows what the robot SAW)
  createPage({ title: 'ענק', slug: 'huge', status: 'draft', blocks: [] });
  require('../src/pages').savePageSource('huge', PZN('ענק', 'x'.repeat(30000), 'huge'), { publish: false });
  const hb1 = await ai.converse({ systemFor, user: 'קרא את הענק', window: hint(8192) });
  const hb2 = await ai.converse({ step: { id: hb1.modelCall.id, result: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'rb', type: 'function', function: { name: 'read_page', arguments: '{"slug":"huge"}' } }] }, finish_reason: 'tool_calls' }] } } });
  const hbTool = hb2.modelCall && hb2.modelCall.body.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'rb');
  const hbOut = hbTool ? JSON.parse(hbTool.content) : null;
  check('(h) in an 8,192 window read_page on a 30K page is REFUSED in the tool answer — tooLong, source "", the Context Length hint, the numbers',
    hbOut && hbOut.tooLong === true && hbOut.source === '' && hbOut.chars > 30000 && hbOut.limitChars < 30000 && /Context Length/.test(hbOut.hint));
  check('(h) …the tool counts as used, but reads[] does not list a page the model never saw',
    hb2.used.includes('read_page') && !hb2.reads.includes('huge'));

  // (g) contextBudget — last, in its own block: it changes process-wide state
  {
    check('(g) contextBudget("local") === 20000 before any learn', ai.contextBudget('local') === 20000);
    win.noteWindow(win.windowKey('local', 'google/gemma-4-31b'), 8192, 'probe');
    check('(g) …and === 8192 − 4000 after the runtime told us its window', ai.contextBudget('local') === 8192 - 4000);
    check('(g) cloud keys stay unbounded', ai.contextBudget('claude') === Infinity);
  }

  done();
})().catch((e) => { console.error(e); fail = true; done(); });

function done() {
  try { fs.rmSync(process.env.TAPUZ_ROOT, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  console.log('');
  console.log(fail ? 'SMOKE AI-WINDOW: FAIL' : 'SMOKE AI-WINDOW: PASS');
  process.exit(fail ? 1 : 0);
}
