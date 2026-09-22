'use strict';

/**
 * v2.51 QA — the premium tier's meter.
 *
 * The free tier could be wrong about tokens and cost nothing. This tier bills
 * the owner for every one, so the arithmetic is a promise: a run that says
 * $0.84 must have spent $0.84, and a run that says "price unknown" must never
 * quietly say "free". Three things are pinned here, and all three have already
 * been wrong once in this session's own drafts:
 *
 *  1. A MISSING PRICE IS NOT ZERO. `Number(null)` is 0, and a price of $0 per
 *     million tokens turns a cap into a no-op. Every door into a price refuses
 *     absence explicitly.
 *  2. THE TWO CACHE CONVENTIONS AGREE. Anthropic reports the cached part
 *     BESIDE the input count; OpenAI-shaped providers report it INSIDE. The
 *     same physical prompt must cost the same either way, or one provider is
 *     silently billed twice for its cache.
 *  3. A TURN'S BILL IS COUNTED ONCE. The envelope reports a DELTA and clears
 *     the meter, because a relayed turn answers the page many times from one
 *     state — a cumulative number would be added again on every hop.
 *
 * No key, no network, no model: the fetch seam is scripted. This runs in CI.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-cost-'));

const cost = require('../src/ai-cost');
const providers = require('../src/providers');
const ai = require('../src/ai');
require('../src/pages'); // the tool loop below reads the pages table

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };
const near = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-9;

// ── 1. the quotes ───────────────────────────────────────────────────────
const sonnet = cost.priceFor('claude', 'claude-sonnet-5');
check('a quote we hold carries its price, the day it was read and where from',
  !!sonnet && sonnet.in === 2 && sonnet.out === 10 && /^\d{4}-\d{2}-\d{2}$/.test(sonnet.asOf) && /^https:/.test(sonnet.source));
check('every model this CMS lists for Claude has a quote',
  providers.getProvider('claude').models.every((m) => !!cost.priceFor('claude', m)));
check('a model nobody read a price for returns null — never a guess', cost.priceFor('claude', 'claude-sonnet-9') === null);
check('a provider with no quotes at all returns null (xai / openrouter publish their own)',
  cost.priceFor('xai', 'grok-4') === null && cost.priceFor('openrouter', 'x-ai/grok-4') === null);

// the one arithmetic mistake in this file that could cost real money
check('an ABSENT hand-given price is null, not $0 (null / undefined / empty / a bare flag)',
  cost.priceFromNumbers(null, null) === null &&
  cost.priceFromNumbers(undefined, 5) === null &&
  cost.priceFromNumbers('', '') === null &&
  cost.priceFromNumbers(true, true) === null);
check('a negative or unreadable price is refused', cost.priceFromNumbers(-1, 5) === null && cost.priceFromNumbers('cheap', 5) === null);
check('two real numbers make a price, and zero is a legitimate one (a free tier)',
  !!cost.priceFromNumbers(0.2, 0.5) && cost.priceFromNumbers(0, 0).in === 0);

// ── 2. the arithmetic ───────────────────────────────────────────────────
check('an empty accounting is empty, and reports nothing', cost.isEmpty(cost.zero()) && cost.report('claude', 'claude-sonnet-5', cost.zero()) === null);

const oneCall = cost.add(cost.zero(), { prompt_tokens: 1000, completion_tokens: 100 });
check('one call: the tokens land and the call is counted',
  oneCall.calls === 1 && oneCall.prompt_tokens === 1000 && oneCall.completion_tokens === 100);
check('with no billed count of its own, the whole prompt is what is billed', oneCall.billed_input_tokens === 1000);

const million = cost.add(cost.zero(), { prompt_tokens: 1e6, completion_tokens: 1e6 });
check('a million in and a million out at $2/$10 is $12', near(cost.costOf(million, sonnet), 12));
check('no price → no cost, and no cost is null (not 0)', cost.costOf(million, null) === null);

// a cached prefix: read at a tenth, written at a quarter more
const cached = cost.add(cost.zero(), { prompt_tokens: 1e6, billed_input_tokens: 0, cache_read_tokens: 9e5, cache_write_tokens: 1e5, completion_tokens: 0 });
check('a cache read costs a tenth of an input token, a cache write a quarter more',
  near(cost.costOf(cached, sonnet), (9e5 * 2 * 0.1 + 1e5 * 2 * 1.25) / 1e6));
check('the same tokens with no cache would have cost the full input price',
  near(cost.costWithoutCache(cached, sonnet), 1e6 * 2 / 1e6));
check('so the cache saved money, and the run can say how much', cost.costWithoutCache(cached, sonnet) > cost.costOf(cached, sonnet));

check('two accountings merge field by field',
  cost.merge(oneCall, oneCall).calls === 2 && cost.merge(oneCall, oneCall).prompt_tokens === 2000);
check('a real run does not round to $0.00', cost.usd(0.0004) === '$0.00040' && cost.usd(12) === '$12.00');
check('a report carries the price it used and the day that price was read',
  cost.report('claude', 'claude-sonnet-5', million).priceAsOf === sonnet.asOf &&
  near(cost.report('claude', 'claude-sonnet-5', million).usd, 12));
const unpriced = cost.report('xai', 'grok-4', million);
check('a report for an unpriced model still carries the tokens — usd null, the bill intact',
  unpriced.usd === null && unpriced.prompt_tokens === 1e6 && unpriced.completion_tokens === 1e6 && unpriced.priceAsOf === '');

// ── 3. the two cache conventions, on the wire ───────────────────────────
//
// One physical prompt: 10,000 tokens, 9,000 of them served from cache. The
// two providers describe it in incompatible ways; priced, they must agree.
providers.PROVIDERS.__costAnthropic = {
  ...providers.getProvider('claude'), id: '__costAnthropic', endpoint: 'http://127.0.0.1:1/v1/messages', keyOptional: true
};
providers.PROVIDERS.__costOpenai = {
  ...providers.getProvider('openai'), id: '__costOpenai', endpoint: 'http://127.0.0.1:1/v1/chat/completions', keyOptional: true, openModel: true
};
// …and a quote for the fake, so the lookup path is exercised end to end
// (the stubbed provider id is the key, exactly as a real one would be).
cost.QUOTES.__costAnthropic = { asOf: '2026-09-20', source: 'the smoke', cacheRead: 0.1, cacheWrite: 1.25, models: { 'claude-sonnet-5': { in: 2, out: 10 } } };
let next = null;
global.fetch = async (url, init) => ({ ok: true, status: 200, json: async () => next });

(async () => {
  ai.saveSettings({ provider: '__costAnthropic', model: 'claude-sonnet-5', apiKey: '' });
  next = { content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 1000, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0, output_tokens: 50 } };
  const a = await ai.generateDetailed({ system: 'S', user: 'U' });
  check('anthropic: the whole prompt is the sum of the three counts (1,000 + 9,000)', a.usage.prompt_tokens === 10000);
  check('anthropic: only the uncached part is billed at the full rate', a.usage.billed_input_tokens === 1000 && a.usage.cache_read_tokens === 9000);

  ai.saveSettings({ provider: '__costOpenai', model: 'gpt-4o', apiKey: '' });
  next = { choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 10000, prompt_tokens_details: { cached_tokens: 9000 }, completion_tokens: 50 } };
  const o = await ai.generateDetailed({ system: 'S', user: 'U' });
  check('openai-chat: prompt_tokens is already the whole prompt', o.usage.prompt_tokens === 10000);
  check('openai-chat: the cached part is taken OUT of what is billed at the full rate',
    o.usage.billed_input_tokens === 1000 && o.usage.cache_read_tokens === 9000);

  const priced = (u) => cost.costOf(cost.add(cost.zero(), u), sonnet);
  check('the same physical prompt costs the same whichever way its provider describes it',
    near(priced(a.usage), priced(o.usage)));

  // ── 4. the cached prefix in the request ───────────────────────────────
  const claude = providers.getProvider('claude');
  const long = 'ש'.repeat(6000);
  const big = ai.buildRequest(claude, 'k', long, 'U', 'claude-sonnet-5');
  check('a briefing worth caching rides as one system block with a cache breakpoint',
    Array.isArray(big.body.system) && big.body.system.length === 1 &&
    big.body.system[0].type === 'text' && big.body.system[0].text === long &&
    big.body.system[0].cache_control.type === 'ephemeral');
  const small = ai.buildRequest(claude, 'k', 'SYSTEM', 'U', 'claude-sonnet-5');
  check('a system prompt too short to cache keeps the plain-string shape (a breakpoint under the minimum is ignored anyway)',
    small.body.system === 'SYSTEM');
  const oai = ai.buildRequest(providers.getProvider('openai'), 'k', long, 'U', 'gpt-4o');
  check('an openai-chat provider is never sent cache_control — it caches on its own side',
    !JSON.stringify(oai.body).includes('cache_control'));
  const composed = ai.composeBody(claude, { model: 'claude-sonnet-5' }, long, [{ role: 'user', content: 'U' }], [], 1024, '');
  check('the tool loop\'s body caches the same prefix the one-shot body does',
    Array.isArray(composed.system) && composed.system[0].cache_control.type === 'ephemeral');

  // ── 5. a turn's bill is counted ONCE ──────────────────────────────────
  //
  // Three model calls in one turn (two reads, then an answer) is ONE envelope
  // carrying all three; the turn after it starts from zero. A meter that
  // carried over would bill the second turn for the first turn's work.
  ai.saveSettings({ provider: '__costAnthropic', model: 'claude-sonnet-5', apiKey: '' });
  const scripted = [
    { content: [{ type: 'tool_use', id: 't1', name: 'list_pages', input: {} }], stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 10 } },
    { content: [{ type: 'tool_use', id: 't2', name: 'list_pages', input: {} }], stop_reason: 'tool_use', usage: { input_tokens: 200, output_tokens: 20 } },
    { content: [{ type: 'text', text: 'יש לך דפים.' }], stop_reason: 'end_turn', usage: { input_tokens: 300, output_tokens: 30 } }
  ];
  global.fetch = async () => ({ ok: true, status: 200, json: async () => scripted.shift() || { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' } });
  const turn = await ai.converse({ system: 'S', user: 'מה יש לי באתר?' });
  check('every model call of a turn is on that turn\'s bill (3 calls, 600 in, 60 out)',
    !!turn.spend && turn.spend.calls === 3 && turn.spend.prompt_tokens === 600 && turn.spend.completion_tokens === 60);
  check('the bill names the provider and the model that answered',
    turn.spend.provider === '__costAnthropic' && turn.spend.model === 'claude-sonnet-5');
  check('a turn with a price we hold reports the money too', near(turn.spend.usd, (600 * 2 + 60 * 10) / 1e6));

  const turn2 = await ai.converse({ system: 'S', user: 'ושוב?' });
  check('the next turn starts from zero — a bill is never counted twice',
    !!turn2.spend && turn2.spend.calls === 1 && turn2.spend.prompt_tokens === 0);

  // ── 6. where a key may go ─────────────────────────────────────────────
  // v2.52 widened this list by ONE host, on purpose and by hand: Google's, for the owner's own AI Studio key.
  check('the five hosts this CMS ships are the only ones a key may reach',
    [...providers.ALLOWED_API_HOSTS].sort().join(',') === 'api.anthropic.com,api.openai.com,api.x.ai,generativelanguage.googleapis.com,openrouter.ai');
  check('every fetching provider\'s endpoint is on that list',
    providers.listProviders().filter((p) => p.endpoint).every((p) => providers.endpointAllowed(p.endpoint)));
  check('a lookalike host is refused, and so is plain http to a real one',
    !providers.endpointAllowed('https://api.x.ai.evil.com/v1/chat/completions') &&
    !providers.endpointAllowed('https://openrouter.ai.evil.com/api/v1/chat/completions') &&
    !providers.endpointAllowed('https://generativelanguage.googleapis.com.evil.com/v1beta/openai/chat/completions') &&
    !providers.endpointAllowed('http://api.anthropic.com/v1/messages'));
  check('the new providers carry no secret and name where their ids are listed',
    ['xai', 'openrouter'].every((id) => {
      const p = providers.getProvider(id);
      return p && p.apiKey === undefined && p.openModel === true && /^https:/.test(p.modelsUrl);
    }));

  console.log(fail ? '\nSMOKE AI-COST: FAIL' : '\nSMOKE AI-COST: PASS');
  try { fs.rmSync(process.env.TAPUZ_ROOT, { recursive: true, force: true }); } catch (e) { /* windows */ }
  process.exit(fail ? 1 : 0);
})();
