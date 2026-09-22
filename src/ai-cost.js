'use strict';

/**
 * ai-cost (v2.51) — what a turn COSTS when the brain is a cloud key.
 *
 * The local tier is free: a model on the owner's own machine bills nothing, so
 * for two years the CMS counted tokens only to fit a window. The premium tier
 * inverts that — the owner pays per token, and the one question a battery run
 * has to answer before it is allowed to spend a night is "what will this cost".
 *
 * THE RULES HERE
 *
 * 1. A price is a QUOTE WITH A DATE, never a constant. Every entry carries the
 *    day it was read and the page it was read from; a price older than the run
 *    is still printed, with its date beside it, so nobody quotes a number as
 *    current that nobody checked.
 * 2. A model with NO price is not free and is not guessed. It reports `null`,
 *    and the caller that needed a number (a budget cap) refuses to start. Fail
 *    closed: a wrong price and a missing price both end in a surprise bill,
 *    and only one of them can be argued with.
 * 3. Tokens are counted even when the price is unknown. A run against a model
 *    we have no quote for still comes back with its token bill, which is what
 *    turns a pricing page into an answer afterwards.
 *
 * Prices are US dollars per MILLION tokens, the unit every provider publishes.
 */

// ── the quotes ──────────────────────────────────────────────────────────
//
// Anthropic's published list, read 2026-06-24. Cache reads and writes are
// multipliers on the input price, not separate numbers: a read is a tenth of
// an input token, a write is an input token and a quarter. (Claude Fable 5.1
// prices cache reads flat; it is not in this table, so the multiplier is not
// wrong here — it is simply not asked.)
const QUOTES = {
  claude: {
    asOf: '2026-06-24',
    source: 'https://www.anthropic.com/pricing',
    cacheRead: 0.1,
    cacheWrite: 1.25,
    models: {
      'claude-opus-5': { in: 5, out: 25 },
      'claude-opus-4-8': { in: 5, out: 25 },
      'claude-sonnet-5': { in: 2, out: 10 },
      'claude-sonnet-4-6': { in: 3, out: 15 },
      'claude-haiku-4-5': { in: 1, out: 5 }
    }
  },
  // v2.52 — read from each supplier's pricing page on 2026-09-20. Both cache a stable prefix by themselves and
  // bill a cached token at a tenth; neither charges for writing it (cacheWrite 1 = the plain input price).
  openai: {
    asOf: '2026-09-20',
    source: 'https://developers.openai.com/api/docs/pricing',
    cacheRead: 0.1,
    cacheWrite: 1,
    models: {
      'gpt-6-astra': { in: 10, out: 50 },
      'gpt-5.6-sol': { in: 4, out: 20 },
      'gpt-5.6-terra': { in: 2, out: 12 },
      'gpt-5.6-luna': { in: 0.2, out: 1.2 }
    }
  },
  gemini: {
    asOf: '2026-09-20',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
    cacheRead: 0.1,
    cacheWrite: 1,
    models: {
      // Google's launch price holds through 2026-12-31; `then` is the listed price after it — a quote that knows
      // its own end date does not silently halve the bill on New Year's Day
      'gemini-3.8-flash': { in: 0.75, out: 3.75, until: '2026-12-31', then: { in: 1.5, out: 7.5 } },
      'gemini-3.5-flash-lite': { in: 0.3, out: 2.5 }
    }
  }
  // xai / openrouter: no quote read by hand, so no quote here. The owner passes the two numbers from the
  // provider's own pricing page (--price-in / --price-out) and the run records them beside the result.
};

/** The price of one model, or null when nobody here has read one.
 *  @returns {{in:number, out:number, cacheRead:number, cacheWrite:number, asOf:string, source:string}|null} */
function priceFor(providerId, model, now) {
  const q = QUOTES[String(providerId || '')];
  if (!q) return null;
  let m = q.models[String(model || '').trim()];
  if (!m) return null;
  // v2.52 — a launch price with an end date: the day after it, the listed price applies
  if (m.until && m.then && new Date(now || Date.now()).toISOString().slice(0, 10) > m.until) m = m.then;
  return { in: m.in, out: m.out, cacheRead: q.cacheRead, cacheWrite: q.cacheWrite, asOf: q.asOf, source: q.source };
}

/** A price the caller supplied by hand (a pricing page we do not carry).
 *  Both numbers are required — half a price prices nothing. */
function priceFromNumbers(inPerMillion, outPerMillion, label) {
  // null and '' are ABSENT, not zero. Number(null) is 0, which would turn
  // "no price was given" into "this model is free" — the one arithmetic
  // mistake in this file that could cost real money.
  if (inPerMillion == null || outPerMillion == null || inPerMillion === '' || outPerMillion === '') return null;
  if (typeof inPerMillion === 'boolean' || typeof outPerMillion === 'boolean') return null;
  const i = Number(inPerMillion);
  const o = Number(outPerMillion);
  if (!Number.isFinite(i) || !Number.isFinite(o) || i < 0 || o < 0) return null;
  return { in: i, out: o, cacheRead: 0.1, cacheWrite: 1.25, asOf: 'given by the runner', source: label || 'the provider\'s pricing page' };
}

// ── the token bill ──────────────────────────────────────────────────────

/**
 * An empty accounting.
 *
 * `prompt_tokens` is the WHOLE prompt the provider saw — the number the window
 * arithmetic cares about. `billed_input_tokens` is the part of it charged at
 * the full input rate, which is not the same thing and cannot be derived from
 * it: Anthropic reports the cached part beside `input_tokens`, OpenAI-shaped
 * providers report it INSIDE `prompt_tokens`. readUsage resolves that
 * difference once, at the wire, and hands the billed number down. Money is
 * computed from `billed_input_tokens` only; mixing the two double-charges a
 * cached prefix on one provider and under-charges it on the other.
 */
function zero() {
  return {
    calls: 0,
    prompt_tokens: 0,
    billed_input_tokens: 0,
    completion_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0
  };
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** What this call is charged at the full input rate — the provider's own
 *  number when it gave one, the whole prompt when it did not. */
function billedInput(u) {
  return u.billed_input_tokens != null ? num(u.billed_input_tokens) : num(u.prompt_tokens);
}

/**
 * Add one call's usage (the shape readUsage returns) to an accounting.
 * Returns a NEW object — nothing here mutates what it was handed.
 */
function add(acc, usage) {
  const a = acc && typeof acc === 'object' ? acc : zero();
  const u = usage && typeof usage === 'object' ? usage : {};
  return {
    calls: num(a.calls) + 1,
    prompt_tokens: num(a.prompt_tokens) + num(u.prompt_tokens),
    billed_input_tokens: num(a.billed_input_tokens) + billedInput(u),
    completion_tokens: num(a.completion_tokens) + num(u.completion_tokens),
    cache_read_tokens: num(a.cache_read_tokens) + num(u.cache_read_tokens),
    cache_write_tokens: num(a.cache_write_tokens) + num(u.cache_write_tokens)
  };
}

/** Two accountings into one (a run over many turns). */
function merge(a, b) {
  const x = a && typeof a === 'object' ? a : zero();
  const y = b && typeof b === 'object' ? b : zero();
  const out = zero();
  Object.keys(out).forEach((k) => { out[k] = num(x[k]) + num(y[k]); });
  return out;
}

/** Did anything at all happen? (an empty accounting is not reported) */
function isEmpty(acc) {
  if (!acc || typeof acc !== 'object') return true;
  return !num(acc.calls) && !num(acc.prompt_tokens) && !num(acc.completion_tokens) &&
    !num(acc.cache_read_tokens) && !num(acc.cache_write_tokens);
}

/**
 * What that accounting costs at that price, in US dollars — or null when
 * there is no price. The four lines are disjoint by construction (see zero()),
 * so they add instead of overlapping.
 */
function costOf(acc, price) {
  if (!price || !acc) return null;
  const million = 1e6;
  const inRate = num(price.in) / million;
  const outRate = num(price.out) / million;
  const cacheRead = Number.isFinite(Number(price.cacheRead)) ? Number(price.cacheRead) : 0.1;
  const cacheWrite = Number.isFinite(Number(price.cacheWrite)) ? Number(price.cacheWrite) : 1.25;
  return num(acc.billed_input_tokens) * inRate +
    num(acc.completion_tokens) * outRate +
    num(acc.cache_read_tokens) * inRate * cacheRead +
    num(acc.cache_write_tokens) * inRate * cacheWrite;
}

/** What the same tokens would have cost with no cache at all — the saving,
 *  made visible. Cached reads are charged as full input tokens, and the
 *  write premium disappears. */
function costWithoutCache(acc, price) {
  if (!price || !acc) return null;
  const inRate = num(price.in) / 1e6;
  return (num(acc.billed_input_tokens) + num(acc.cache_read_tokens) + num(acc.cache_write_tokens)) * inRate +
    num(acc.completion_tokens) * (num(price.out) / 1e6);
}

/** Dollars, at a precision that does not round a real run to $0.00. */
function usd(v) {
  if (v == null || !Number.isFinite(Number(v))) return '';
  const n = Number(v);
  if (n === 0) return '$0';
  if (n < 0.01) return '$' + n.toFixed(5);
  if (n < 1) return '$' + n.toFixed(4);
  return '$' + n.toFixed(2);
}

/** One line a human reads: the tokens, the money, and the cache's share. */
function line(acc, price) {
  if (isEmpty(acc)) return '';
  const parts = [
    acc.calls + ' calls',
    num(acc.billed_input_tokens).toLocaleString('en-US') + ' in',
    num(acc.completion_tokens).toLocaleString('en-US') + ' out'
  ];
  if (acc.cache_read_tokens) parts.push(acc.cache_read_tokens.toLocaleString('en-US') + ' cached');
  if (acc.cache_write_tokens) parts.push(acc.cache_write_tokens.toLocaleString('en-US') + ' cache-written');
  const c = costOf(acc, price);
  if (c == null) return parts.join(' · ') + ' · price unknown';
  const plain = costWithoutCache(acc, price);
  const saved = plain != null && plain > c ? ' (saved ' + usd(plain - c) + ' on cache)' : '';
  return parts.join(' · ') + ' · ' + usd(c) + saved;
}

/**
 * The report that rides in the chat envelope: the tokens of THIS response,
 * the price we hold and what it comes to. `price: null` is an answer, not a
 * gap — the page shows the tokens and says the money is unknown.
 */
function report(providerId, model, acc, price) {
  if (isEmpty(acc)) return null;
  const p = price || priceFor(providerId, model);
  const c = costOf(acc, p);
  return {
    provider: String(providerId || ''),
    model: String(model || ''),
    calls: num(acc.calls),
    prompt_tokens: num(acc.prompt_tokens),
    billed_input_tokens: num(acc.billed_input_tokens),
    completion_tokens: num(acc.completion_tokens),
    cache_read_tokens: num(acc.cache_read_tokens),
    cache_write_tokens: num(acc.cache_write_tokens),
    usd: c,
    priceAsOf: p ? p.asOf : '',
    priceSource: p ? p.source : ''
  };
}

module.exports = {
  QUOTES,
  priceFor,
  priceFromNumbers,
  zero,
  add,
  merge,
  isEmpty,
  costOf,
  costWithoutCache,
  usd,
  line,
  report
};
