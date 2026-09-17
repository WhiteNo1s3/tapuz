'use strict';

/**
 * v2.30 — the local worker: injection jobs that run with NO browser open.
 *
 * Ben: "build the local worker so it runs without a browser". Until this file
 * a pack could only reach a model two ways, and both needed something open:
 * the hosted server calling a model it can reach (a cloud key — ruled out as
 * a brand matter), or the owner's browser carrying the call to LM Studio
 * (Bridge V2 — a tab that must stay open, under Chrome's five-minute worker
 * cap). This is the third way: a process on the owner's machine that pulls
 * queued jobs from the hosted site over /agent/v1, runs them against the
 * local runtime, and posts the reply back. The admin tab can be closed the
 * whole time; the 5090 can chew for four minutes without anyone watching.
 *
 * The worker is a COURIER WITH A GPU. It composes nothing, parses nothing,
 * decides nothing: the server holds all the state, hands over a finished
 * prompt, and judges the reply. Even the one repair turn is the server's
 * call — the worker only runs the prompt it is handed. And the invariant
 * that does not move: a job NEVER applies. It ends as a reply plus the
 * door's preview, waiting for the owner to press apply in the admin.
 *
 *   TAPUZ_SITE=https://<live-site> \
 *   TAPUZ_TOKEN=<agent token with read+write> \
 *   LOCAL_LLM_BASE=http://127.0.0.1:1234/v1 \
 *   LOCAL_LLM_MODEL=tapuz-gemma \
 *   node scripts/tapuz-worker.js
 *
 * Flags: --once (claim at most one job, then exit — how a smoke drives it),
 *        --dry (run it and print it, never post), --verbose, --help.
 *
 * Why it is written the way it is:
 *  - It STREAMS (`stream:true` + `stream_options.include_usage`). Not for the
 *    pretty progress line: a four-minute non-streaming POST is exactly what a
 *    shared host's proxy kills, and a silent terminal is indistinguishable
 *    from a hung one. The SSE is assembled by hand through a streaming
 *    TextDecoder because a frame WILL arrive cut in half and Hebrew is
 *    multi-byte — a naive chunk.toString() corrupts a letter sooner or later.
 *  - Every timeout here measures SILENCE, never duration. A 31B model writing
 *    steadily for four minutes is healthy; two minutes of nothing is not.
 *  - It never exits on a transient failure. Site errors back off 1s → 60s and
 *    the loop carries on. Only a configuration error is fatal (exit 2).
 *  - A 429 from /agent/v1 is obeyed, not guessed at: the bridge caps a source
 *    IP at 120 requests a minute and says how long to wait in Retry-After, so
 *    the worker waits exactly that and does not treat being early as a fault.
 *  - A model failure is REPORTED to the site as {error:{code,message}} so the
 *    job ends `failed` with a reason the owner can read in the admin, instead
 *    of sitting `running` forever.
 *  - The token comes from the environment only — never a flag (it would land
 *    in the shell history), never logged beyond its first 6 characters, never
 *    inside an error message.
 *  - The model address must be loopback (localhost / 127.0.0.0/8 / [::1]),
 *    the same test the CMS makes in src/providers.js. A worker pointed at a
 *    public "local model" is a proxy, so it is refused before the first call.
 *
 * Node's stdlib only, on purpose: this is the one file a non-developer may be
 * asked to run on their own machine, and `npm install` is not part of that.
 */

const http = require('http');
const https = require('https');

// ── constants ───────────────────────────────────────────────────────────

const DEFAULT_MODEL_BASE = 'http://127.0.0.1:1234/v1';
// the BenTML briefing's fingerprint — byte for byte src/ai.js BRIEFING_MARK
// (this file requires nothing from the repo, so the rule is repeated here
// and smoke-no-briefing pins the two equal)
const BRIEFING_MARK = /<bent-|bent-\*/;
const DEFAULT_POLL_MS = 5000;
const DEFAULT_IDLE_MS = 120000;   // silence, not duration
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 60000;
const SITE_TIMEOUT_MS = 30000;
// /agent/v1 is capped per source IP (src/routes/agent-bridge.js: 120 requests
// a minute) and answers 429 + Retry-After when it bites. At the default 5s
// poll the worker spends 12/min and never sees it; a TAPUZ_POLL_MS of 200, or
// two workers behind one NAT, walks straight into it. So a 429 is its own
// case: obey what the site SAID instead of doubling a blind backoff, and do
// not count it as a failure — nothing failed, we were early.
const AGENT_RATE_LIMIT_PER_MIN = 120;
const RATE_LIMIT_MIN_MS = 1000;
const RATE_LIMIT_MAX_MS = 300000;
const RATE_LIMIT_MAX_WAITS = 10;    // a spell of 429s has to end somewhere
const RATE_LIMIT_SAY_EVERY_MS = 60000;
const HEARTBEAT_MS = 60000;       // the store calls a worker offline after 120s
const POST_ATTEMPTS = 5;          // delivering a finished reply is worth retrying
const MAX_ERROR_CHARS = 500;      // a runtime's HTML error page must not flood the job store
const PROGRESS_TTY_MS = 500;
const PROGRESS_LOG_MS = 15000;    // piped to a file: a line a quarter-minute, not thousands

const VERSION = (() => {
  try { return require('../package.json').version || '0.0.0'; } catch (e) { return '0.0.0'; }
})();
const UA = `tapuz-worker/${VERSION} (+node ${process.versions.node})`;

// ── the console: Hebrew for the owner, English for diagnostics ──────────

let lineOpen = false;   // a rewritten TTY progress line is waiting for its newline
let lineWidth = 0;

function closeLine() {
  if (lineOpen) { process.stdout.write('\n'); lineOpen = false; lineWidth = 0; }
}
/** Owner-facing. */
function say(msg) { closeLine(); console.log(msg); }
/** Owner-facing, something went wrong. */
function warn(msg) { closeLine(); console.error(msg); }
/** English diagnostic — only with --verbose. */
function note(msg) { if (FLAGS.verbose) { closeLine(); console.error('· ' + msg); } }
/** A configuration error: the one thing that is fatal. */
function die(msg, detail) {
  closeLine();
  console.error(msg);
  if (detail) console.error('  ' + detail);
  process.exit(2);
}

/** Hebrew counts: "1 אסימונים" is the kind of seam that makes a tool feel
 *  translated. one/many, and an explicit word for none where it reads better. */
function count(n, one, many, none) {
  const k = Number(n) || 0;
  if (!k && none) return none;
  return k === 1 ? one : `${k} ${many}`;
}

const sleepMs = (ms) => new Promise((resolve) => {
  const t = setTimeout(() => { wake = null; resolve(); }, ms);
  wake = () => { clearTimeout(t); wake = null; resolve(); };
});
let wake = null;   // set while the loop is sleeping, so a signal wakes it at once

// ── flags ───────────────────────────────────────────────────────────────

const KNOWN_FLAGS = ['--once', '--dry', '--verbose', '-v', '--help', '-h'];
const argv = process.argv.slice(2);
const FLAGS = {
  once: argv.includes('--once'),
  dry: argv.includes('--dry'),
  verbose: argv.includes('--verbose') || argv.includes('-v'),
  help: argv.includes('--help') || argv.includes('-h')
};

function usage() {
  return [
    `tapuz-worker ${VERSION} — מריץ עבודות הזרקה מול המודל המקומי, בלי דפדפן פתוח.`,
    '',
    '  node scripts/tapuz-worker.js [--once] [--dry] [--verbose]',
    '',
    'משתני סביבה:',
    '  TAPUZ_SITE       כתובת האתר המארח (חובה), למשל https://example.hostingersite.com',
    '  TAPUZ_TOKEN      טוקן סוכן עם הרשאות read+write (חובה) — מהסביבה בלבד, לא כדגל',
    `  LOCAL_LLM_BASE   כתובת המודל המקומי (ברירת מחדל ${DEFAULT_MODEL_BASE}) — חייבת להיות מקומית`,
    '  LOCAL_LLM_MODEL  שם המודל; ריק = מה שטעון כרגע ב-LM Studio',
    `  TAPUZ_POLL_MS    כל כמה זמן לשאול אם יש עבודה (ברירת מחדל ${DEFAULT_POLL_MS}) — לאתר יש תקרה של`,
    `                   ${AGENT_RATE_LIMIT_PER_MIN} בקשות לדקה לכל כתובת IP, אז אל תרדו הרבה מתחת ל-1000`,
    `  TAPUZ_IDLE_MS    כמה שתיקה של המודל נחשבת תקלה (ברירת מחדל ${DEFAULT_IDLE_MS}) — שתיקה, לא משך`,
    '',
    'דגלים:',
    '  --once     לקחת עבודה אחת לכל היותר ולצאת (כך בדיקת העשן מריצה אותו)',
    '  --dry      להריץ ולהדפיס, בלי לדווח לאתר',
    '  --verbose  פירוט טכני (באנגלית)',
    '  --help     המסך הזה',
    '',
    'קודי יציאה: 0 = הכול כשורה · 2 = שגיאת הגדרה (משתנה חסר, כתובת לא מקומית, אתר לא תקין).',
    '           ב---once בלבד: 1 = העבודה נכשלה או שלא הצלחתי לדווח עליה.',
    '',
    'העבודה לעולם אינה מחילה שינוי — היא מסתיימת כתשובה + תצוגה מקדימה, והבעלים מאשר באדמין.'
  ].join('\n');
}

// ── configuration ───────────────────────────────────────────────────────

/** Is this hostname (already URL-normalised) the local machine itself?
 *  Byte-for-byte the CMS's test (src/providers.js isLoopbackHost): the check
 *  runs AFTER URL parsing, which is what makes it safe — the parser
 *  normalises `127.1` and `[0:0:0:0:0:0:0:1]` to real loopback literals while
 *  `localhost.evil.com` and `http://user@evil.com` keep their true host. */
function isLoopbackHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (h === 'localhost' || h === '[::1]' || h === '::1') return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return false;
  return parts[0] === 127;   // the whole 127.0.0.0/8 range
}

/** LOCAL_LLM_BASE → the chat/completions URL, or null when it is not local.
 *  Mirrors src/providers.js resolveLocalEndpoint so the worker and the CMS
 *  can never disagree about which address is acceptable. */
function resolveModelEndpoint(baseUrl) {
  const raw = String(baseUrl || '').trim() || DEFAULT_MODEL_BASE;
  const base = raw.replace(/\/+$/, '');
  const url = /\/(chat\/)?completions$|\/v1\/.+/.test(base) ? base : base + '/chat/completions';
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return isLoopbackHost(u.hostname) ? u.toString() : null;
}

function readConfig() {
  const unknown = argv.filter((a) => a.startsWith('-') && !KNOWN_FLAGS.includes(a));
  if (unknown.length) die('דגל לא מוכר: ' + unknown.join(' '), 'run with --help for the list');

  const rawSite = String(process.env.TAPUZ_SITE || '').trim();
  if (!rawSite) die('חסר TAPUZ_SITE — כתובת האתר המארח.', 'e.g. TAPUZ_SITE=https://example.hostingersite.com');
  let siteUrl;
  try { siteUrl = new URL(rawSite); } catch (e) { siteUrl = null; }
  if (!siteUrl || (siteUrl.protocol !== 'https:' && siteUrl.protocol !== 'http:')) {
    die('TAPUZ_SITE אינו כתובת תקינה: ' + rawSite, 'expected http:// or https://');
  }
  // http is allowed so the worker can be driven against a localhost CMS; the
  // real site is https and everything (including the bearer) rides TLS there.
  const site = (siteUrl.origin + siteUrl.pathname).replace(/\/+$/, '');

  const token = String(process.env.TAPUZ_TOKEN || '').trim();
  if (!token) die('חסר TAPUZ_TOKEN — טוקן סוכן עם הרשאות read+write.', 'the token is read from the environment only, never a flag');

  const modelBase = String(process.env.LOCAL_LLM_BASE || '').trim() || DEFAULT_MODEL_BASE;
  const modelEndpoint = resolveModelEndpoint(modelBase);
  if (!modelEndpoint) {
    die('כתובת המודל חייבת להצביע על המחשב הזה (127.0.0.1 / localhost) — נדחתה: ' + modelBase,
      'a public address here would turn this worker into an open proxy');
  }

  const pollMs = Math.max(500, Number(process.env.TAPUZ_POLL_MS) || DEFAULT_POLL_MS);
  const idleMs = Math.max(5000, Number(process.env.TAPUZ_IDLE_MS) || DEFAULT_IDLE_MS);

  return {
    site,
    token,
    tokenHint: token.slice(0, 6) + '…',   // the ONLY form of the token that is ever printed
    modelBase,
    modelEndpoint,
    model: String(process.env.LOCAL_LLM_MODEL || '').trim(),
    pollMs,
    idleMs
  };
}

// ── talking to the site ─────────────────────────────────────────────────

/** One /agent/v1 round-trip. Resolves for every HTTP status (the caller reads
 *  it); rejects only when the wire failed. The bearer never appears in a URL,
 *  a log line or an error — it lives in this one header. */
function siteRequest(cfg, method, path, body, opts = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(cfg.site + path); } catch (e) { return reject(new Error('bad site url: ' + path)); }
    const mod = url.protocol === 'http:' ? http : https;
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const headers = {
      Authorization: 'Bearer ' + cfg.token,
      Accept: 'application/json',
      'User-Agent': UA
    };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(payload.length);
    }
    const req = mod.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* a proxy's HTML error page */ }
        resolve({ status: res.statusCode || 0, headers: res.headers || {}, json, text });
      });
      res.on('error', reject);
    });
    const ms = Number(opts.timeoutMs) || SITE_TIMEOUT_MS;
    req.setTimeout(ms, () => req.destroy(new Error(`the site did not answer within ${Math.round(ms / 1000)}s`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** An English one-liner for a non-2xx site answer — never the token, never
 *  more of the body than fits a log line. */
function siteError(res) {
  const msg = (res.json && (res.json.error || res.json.message)) || res.text.replace(/\s+/g, ' ').trim();
  return `HTTP ${res.status}` + (msg ? ': ' + String(msg).slice(0, 200) : '');
}

/** Retry-After, in ms: the header is seconds or an HTTP-date. Clamped, because
 *  a bogus value must not park the worker for an afternoon. */
function retryAfterMs(res) {
  const raw = String((res.headers && res.headers['retry-after']) || '').trim();
  let ms = 0;
  if (/^\d+$/.test(raw)) ms = Number(raw) * 1000;
  else if (raw) { const at = Date.parse(raw); if (at) ms = at - Date.now(); }
  return Math.min(RATE_LIMIT_MAX_MS, Math.max(RATE_LIMIT_MIN_MS, ms || RATE_LIMIT_MIN_MS));
}

/** One vocabulary for every non-2xx answer from the site. */
function siteFailure(res) {
  const e = new Error(siteError(res));
  e.status = res.status;
  e.auth = res.status === 401 || res.status === 403;
  e.rateLimited = res.status === 429;
  if (e.rateLimited) e.retryAfterMs = retryAfterMs(res);
  return e;
}

async function ping(cfg) {
  const res = await siteRequest(cfg, 'GET', '/agent/v1/inject/ping');
  if (res.status !== 200 || !res.json || !res.json.ok) throw siteFailure(res);
  return res.json;
}

/** Claim the oldest pending job (and stamp the heartbeat). null = nothing to do. */
async function claimNext(cfg) {
  const res = await siteRequest(cfg, 'GET', '/agent/v1/inject/next');
  if (res.status !== 200 || !res.json || !res.json.ok) throw siteFailure(res);
  return res.json.job || null;
}

/** Post a reply (or a failure) for a job. Returns the site's answer, which is
 *  either {repair:{…}} — the one repair turn the SERVER decided on — or
 *  {done:true, status, warnings, hard}. */
async function postJob(cfg, jobId, payload) {
  const res = await siteRequest(cfg, 'POST', '/agent/v1/inject/' + encodeURIComponent(jobId), payload);
  if (res.status !== 200 || !res.json || !res.json.ok) throw siteFailure(res);
  return res.json;
}

/** Give a claimed job back to the queue. Best effort by design: a worker
 *  that cannot reach the site must not hang on to a job it is not running,
 *  and the server's stale-claim sweep is the backstop either way. */
async function releaseJob(cfg, jobId) {
  try {
    const r = await siteRequest(cfg, 'POST', `/agent/v1/inject/${encodeURIComponent(jobId)}/release`, {});
    return !!(r && r.json && r.json.ok);
  } catch (e) {
    note('release failed: ' + e.message);
    return false;
  }
}

/** A finished reply is expensive — a GPU already paid for it — so its delivery
 *  is retried before the worker gives up. A 429 is not a failed attempt: the
 *  site said "not yet", so the worker waits it out without spending one. */
async function postJobWithRetry(cfg, jobId, payload, attempts) {
  let waitMs = BACKOFF_MIN_MS;
  let paused = 0;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await postJob(cfg, jobId, payload);
    } catch (e) {
      if (e.rateLimited && paused < RATE_LIMIT_MAX_WAITS) {
        paused++;
        const ms = Math.max(e.retryAfterMs || 0, waitMs);
        slowDown(ms);
        await sleepMs(ms);
        i--;            // the site asked us to wait, it did not refuse us
        continue;
      }
      if (i === attempts) throw e;
      warn(`הדיווח לאתר נכשל (ניסיון ${i}/${attempts}) — מנסה שוב בעוד ${Math.round(waitMs / 1000)} שנ׳. [${e.message}]`);
      await sleepMs(waitMs);
      waitMs = Math.min(BACKOFF_MAX_MS, waitMs * 2);
    }
  }
  return null; // unreachable
}

/** "The site asked me to slow down" is not an error and must not read like
 *  one — but saying it every few seconds would be its own kind of noise, so
 *  it is said once per spell. */
let slowedAt = 0;
function slowDown(ms) {
  const now = Date.now();
  if (now - slowedAt > RATE_LIMIT_SAY_EVERY_MS) {
    slowedAt = now;
    say(`האתר ביקש להאט (מגבלת קצב) — ממתין ${Math.round(ms / 1000)} שנ׳ ומנסה שוב. שקלו להעלות את TAPUZ_POLL_MS.`);
  } else {
    note(`rate limited; waiting ${ms}ms`);
  }
}

// ── talking to the model ────────────────────────────────────────────────

// Set while a model turn is in flight, so a second Ctrl+C can cut it short.
// It is a KILLER, not the request: destroying a socket makes several events
// race (the request's 'error', the response's 'aborted'), and the owner must
// read the reason we chose — "the model went silent" — not whichever event
// Node happened to emit first.
let activeKill = null;

function abortModel(reason) {
  if (activeKill) activeKill(coded(reason || 'הריצה בוטלה.', 'ABORTED'));
}

function coded(message, code) {
  const e = new Error(message);
  e.modelCode = code;
  return e;
}

/**
 * One streamed turn against the local runtime.
 *
 * `stream_options.include_usage` is what makes the final frame carry the token
 * counts — without it a streamed run reports no usage at all and the job's
 * numbers are blank. A runtime old enough to 400 on that key is retried once
 * without it by the caller.
 *
 * `reasoning_effort:'none'` is the same switch src/ai.js sends to the local
 * provider: hybrid-thinking models (Qwen3.*) otherwise burn the whole budget
 * on reasoning and return empty content. Runtimes that don't know the key
 * ignore it. Nothing else is sent — no temperature, no sampler knobs — so the
 * worker's request stays the one the doors were tuned against.
 */
function chatOnce(cfg, { messages, maxTokens, model, streamOptions }) {
  return new Promise((resolve, reject) => {
    const url = new URL(cfg.modelEndpoint);
    const mod = url.protocol === 'http:' ? http : https;
    const body = { messages, max_tokens: maxTokens, stream: true, reasoning_effort: 'none' };
    if (model) body.model = model;                       // '' = whatever is loaded
    if (streamOptions) body.stream_options = { include_usage: true };
    const payload = Buffer.from(JSON.stringify(body), 'utf8');

    const started = Date.now();
    let text = '';
    let usage = null;
    let servedModel = model || '';
    let finishReason = '';
    let deltas = 0;
    let badFrames = 0;
    let reasoningChars = 0;
    let sawDone = false;
    let settled = false;
    let idleTimer = null;
    let lastProgressAt = 0;
    let deliberate = null;   // the reason WE cut the connection, if we did

    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      activeKill = null;
      closeLine();
      fn(arg);
    };
    const fail = (e) => done(reject, deliberate || e);
    const killWith = (e) => { if (!deliberate) deliberate = e; req.destroy(e); };
    const bumpIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        killWith(coded(`המודל שתק יותר מ-${Math.round(cfg.idleMs / 1000)} שניות — בדקו ש-LM Studio עדיין מריץ את המודל ושאין משהו אחר שתופס את ה-GPU.`, 'TIMEOUT'));
      }, cfg.idleMs);
    };
    const progress = (force) => {
      const now = Date.now();
      const every = process.stdout.isTTY ? PROGRESS_TTY_MS : PROGRESS_LOG_MS;
      if (!force && now - lastProgressAt < every) return;
      lastProgressAt = now;
      const secs = Math.round((now - started) / 1000);
      const line = `…  ${count(deltas, 'אסימון אחד', 'אסימונים')} · ${count(text.length, 'תו אחד', 'תווים')} · ${secs} שנ׳`;
      if (process.stdout.isTTY) {
        process.stdout.write('\r' + line + ' '.repeat(Math.max(0, lineWidth - line.length)));
        lineWidth = line.length;
        lineOpen = true;
      } else {
        console.log(line);
      }
    };

    const req = mod.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(payload.length),
        Accept: 'text/event-stream',
        'User-Agent': UA
      }
    }, (res) => {
      bumpIdle();
      const status = res.statusCode || 0;
      const ctype = String(res.headers['content-type'] || '');
      const streamed = /event-stream/i.test(ctype);

      // ── the error path: read the body whole, it is short and it explains ──
      if (status < 200 || status >= 300) {
        const chunks = [];
        res.on('data', (c) => { bumpIdle(); chunks.push(c); });
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let msg = raw.replace(/\s+/g, ' ').trim();
          try {
            const j = JSON.parse(raw);
            msg = String((j.error && (j.error.message || j.error)) || j.message || msg);
          } catch (e) { /* not json */ }
          const e = coded(`המודל המקומי החזיר שגיאה (HTTP ${status}): ${msg.slice(0, MAX_ERROR_CHARS)}`, 'PROVIDER_ERROR');
          // an old runtime that does not know stream_options — worth one retry
          if (status === 400 && /stream[_\s-]?options/i.test(raw)) e.retryWithoutStreamOptions = true;
          fail(e);
        });
        return;
      }

      // ── a runtime that ignored stream:true and answered one JSON body ──
      if (!streamed) {
        note(`the model answered ${ctype || 'an unknown content-type'} — reading it whole instead of as a stream`);
        const chunks = [];
        res.on('data', (c) => { bumpIdle(); chunks.push(c); progress(false); });
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let j = null;
          try { j = JSON.parse(raw); } catch (e) { /* fall through */ }
          if (!j) return fail(coded('המודל המקומי החזיר תשובה שאינה JSON: ' + raw.replace(/\s+/g, ' ').slice(0, MAX_ERROR_CHARS), 'PROVIDER_ERROR'));
          const choice = (j.choices && j.choices[0]) || {};
          text = String((choice.message && choice.message.content) || choice.text || '');
          usage = j.usage || null;
          servedModel = j.model || servedModel;
          finishReason = choice.finish_reason || '';
          progress(true);
          done(resolve, { text, usage, model: servedModel, finishReason, deltas, ms: Date.now() - started, streamed: false });
        });
        return;
      }

      // ── the stream: lines, assembled across chunks ──
      // A frame arrives cut in half often enough that assuming otherwise is a
      // bug with a schedule; Hebrew is multi-byte, so the decoder must carry
      // a half character across reads too. Hence: no setEncoding, a streaming
      // TextDecoder, and a buffer that only ever gives up COMPLETE lines.
      const decoder = new TextDecoder('utf-8');
      let buf = '';

      const handleLine = (rawLine) => {
        const line = rawLine.replace(/\r$/, '');
        if (!line) return;                       // frame separator
        if (line.startsWith(':')) return;        // a keep-alive comment
        if (!line.startsWith('data:')) return;   // event: / id: / retry:
        const data = line.slice(5).trim();
        if (!data) return;
        if (data === '[DONE]') { sawDone = true; return; }
        let frame;
        try { frame = JSON.parse(data); } catch (e) { badFrames++; return; }
        if (frame.error) {
          const msg = String((frame.error.message || frame.error)).slice(0, MAX_ERROR_CHARS);
          return fail(coded('המודל המקומי עצר באמצע: ' + msg, 'PROVIDER_ERROR'));
        }
        if (frame.model) servedModel = frame.model;
        if (frame.usage) usage = frame.usage;    // the include_usage frame, last and choice-less
        const choice = frame.choices && frame.choices[0];
        if (choice) {
          const delta = choice.delta || {};
          const piece = typeof delta.content === 'string' ? delta.content
            : (typeof choice.text === 'string' ? choice.text : '');
          if (piece) { text += piece; deltas++; }
          if (typeof delta.reasoning_content === 'string') reasoningChars += delta.reasoning_content.length;
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
      };

      res.on('data', (chunk) => {
        bumpIdle();
        buf += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          handleLine(line);
          if (settled) return;
        }
        progress(false);
      });
      res.on('aborted', () => fail(coded('החיבור למודל המקומי נותק באמצע התשובה.', 'NETWORK')));
      res.on('error', (e) => fail(coded('שגיאה בקריאת התשובה מהמודל: ' + e.message, 'NETWORK')));
      res.on('end', () => {
        buf += decoder.decode();                 // flush a trailing half-character
        if (buf.trim()) handleLine(buf);
        if (settled) return;
        progress(true);
        if (badFrames) note(`${badFrames} SSE frame(s) could not be parsed and were skipped`);
        if (reasoningChars) note(`the model emitted ${reasoningChars} chars of reasoning_content (not part of the reply)`);
        if (!sawDone) note('the stream ended without a [DONE] frame');
        done(resolve, { text, usage, model: servedModel, finishReason, deltas, ms: Date.now() - started, streamed: true });
      });
    });

    activeKill = killWith;
    // Belt and braces: Node's own socket timeout is also idle-based (it fires
    // on inactivity, not on elapsed time), so a stalled connection still dies
    // if the timer above is somehow not armed.
    req.setTimeout(cfg.idleMs, () => killWith(coded(`המודל שתק יותר מ-${Math.round(cfg.idleMs / 1000)} שניות.`, 'TIMEOUT')));
    req.on('error', (e) => {
      if (e && e.modelCode) return fail(e);
      fail(coded('לא הצלחתי להתחבר למודל המקומי ב-' + cfg.modelEndpoint +
        ' — ודאו ש-LM Studio (או Ollama) רץ ושהשרת המקומי דולק. פרטים: ' + e.message, 'NETWORK'));
    });
    bumpIdle();
    req.write(payload);
    req.end();
  });
}

/** One turn, with the single stream_options retry a stubborn runtime earns. */
async function runTurn(cfg, { messages, maxTokens, model }) {
  let out;
  try {
    out = await chatOnce(cfg, { messages, maxTokens, model, streamOptions: true });
  } catch (e) {
    if (!e || !e.retryWithoutStreamOptions) throw e;
    note('the runtime refused stream_options — retrying once without it (usage will be missing)');
    out = await chatOnce(cfg, { messages, maxTokens, model, streamOptions: false });
  }
  if (!out.text || !out.text.trim()) throw coded('המודל המקומי החזיר תשובה ריקה.', 'EMPTY_REPLY');
  return out;
}

/** The server hands over a finished prompt and, for a repair turn, the history
 *  it belongs to. The worker composes NOTHING — it only shapes the messages
 *  array around what it was given.
 *
 *  The system turn comes from the job too (and is ''). src/ai.js always sends
 *  one, so a pack whose chat template notices an absent system block would
 *  answer differently through a worker than through the admin's own run
 *  button — a difference the owner could never see or explain. An older site
 *  that does not send the field still gets the empty turn. */
function messagesFor(prompt, history, system) {
  const turns = (Array.isArray(history) ? history : [])
    .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content)
    .map((t) => ({ role: t.role, content: t.content }));
  return [{ role: 'system', content: typeof system === 'string' ? system : '' }]
    .concat(turns, [{ role: 'user', content: String(prompt || '') }]);
}

function fmtUsage(usage) {
  if (!usage) return 'ללא נתוני אסימונים';
  const p = usage.prompt_tokens || 0;
  const c = usage.completion_tokens || 0;
  return `${p} אסימוני פרומפט · ${c} אסימוני תשובה`;
}

// ── one job ─────────────────────────────────────────────────────────────

let stopping = false;   // a signal arrived: finish what is running, then leave
let aborting = false;   // a second signal: cut the run short and report it
let inFlight = null;    // the job being worked on right now

/**
 * Claim → run → post → (the server's one repair turn) → post. Returns
 * 'done' | 'failed' | 'dry'. Never throws for a model failure: that is
 * reported to the site so the job ends `failed` with a readable reason
 * instead of sitting `running` forever.
 */
async function runJob(cfg, job) {
  const title = job.title || job.packId || job.id;
  say(`▶ עבודה ${job.id} · ${title}${job.round > 1 ? ' (סבב תיקון)' : ''} · ${count(String(job.prompt || '').length, 'תו אחד', 'תווים')} בפרומפט`);
  const model = job.model || cfg.model || '';
  note(`job ${job.id}: pack=${job.packId || '?'} round=${job.round || 1} maxTokens=${job.maxTokens || 'default'} model=${model || '(whatever is loaded)'}`);

  if (!job.prompt || !String(job.prompt).trim()) {
    // nothing to run — say so rather than sending an empty turn
    await reportFailure(cfg, job.id, 'BAD_JOB', 'העבודה הגיעה בלי פרומפט — אין מה להריץ.');
    return 'failed';
  }
  // The last hop before the GPU (v2.42): a local model with no BenTML
  // briefing invents its own dialect (HARD-BATTERY-v2, C1), so a job whose
  // system text and prompt carry no `<bent-` / `bent-*` at all is refused
  // here too — the same rule the CMS applies at the queue (src/ai.js
  // assertBriefed), for a site older than that rule.
  if (!BRIEFING_MARK.test(String(job.system || '') + '\n' + String(job.prompt || ''))) {
    warn('✖ העבודה הגיעה בלי תדריך BenTML — לא נשלחת למודל.');
    await reportFailure(cfg, job.id, 'NO_BRIEFING', 'העבודה הגיעה בלי תדריך BenTML — זו תקלה בחבילה, לא במודל; לא נשלחה למודל.');
    return 'failed';
  }

  const maxTokens = Math.min(32768, Math.max(256, Number(job.maxTokens) || 4096));
  let turn;
  try {
    turn = await runTurn(cfg, { messages: messagesFor(job.prompt, job.history, job.system), maxTokens, model });
  } catch (e) {
    const code = (e && e.modelCode) || 'NETWORK';
    warn(`✖ המודל נכשל (${code}): ${e.message}`);
    await reportFailure(cfg, job.id, code, e.message);
    return 'failed';
  }
  say(`✓ תשובה: ${count(turn.text.length, 'תו אחד', 'תווים')} · ${Math.round(turn.ms / 1000)} שנ׳ · ${fmtUsage(turn.usage)}${turn.finishReason === 'length' ? ' · נעצרה בתקרת האסימונים' : ''}`);
  if (turn.finishReason === 'length') warn('שימו לב: התשובה נקטעה בתקרת האסימונים — ייתכן שהדלת תסרב לה.');

  if (FLAGS.dry) {
    say('— ריצה יבשה: התשובה לא נשלחת לאתר —');
    say(turn.text);
    // …but the claim IS real: /next marks the job running. Hand it back, so a
    // dry run leaves the queue exactly as it found it.
    const freed = await releaseJob(cfg, job.id);
    say(freed
      ? '— סוף התשובה. העבודה הוחזרה לתור. —'
      : '— סוף התשובה. לא הצלחתי להחזיר את העבודה לתור — בטלו אותה באדמין, או המתינו שהתפיסה תתיישן. —');
    return 'dry';
  }

  // ── post, and honour the server's one repair turn ──
  let answer;
  try {
    answer = await postJobWithRetry(cfg, job.id, { reply: turn.text, usage: turn.usage || undefined }, POST_ATTEMPTS);
  } catch (e) {
    warn(`✖ לא הצלחתי לדווח את התשובה לאתר: ${e.message}`);
    return 'undelivered';
  }

  if (answer && answer.repair && answer.repair.prompt) {
    say('↻ האתר ביקש סבב תיקון אחד — מריץ אותו.');
    const repair = answer.repair;
    const repairTokens = Math.min(32768, Math.max(256, Number(repair.maxTokens) || maxTokens));
    let second;
    try {
      second = await runTurn(cfg, { messages: messagesFor(repair.prompt, repair.history, job.system), maxTokens: repairTokens, model });
    } catch (e) {
      const code = (e && e.modelCode) || 'NETWORK';
      warn(`✖ סבב התיקון נכשל (${code}): ${e.message}`);
      await reportFailure(cfg, job.id, code, e.message);
      return 'failed';
    }
    say(`✓ תיקון: ${count(second.text.length, 'תו אחד', 'תווים')} · ${Math.round(second.ms / 1000)} שנ׳ · ${fmtUsage(second.usage)}`);
    try {
      // the usage of THIS reply, as the contract's {reply, usage} reads; the
      // server owns the arithmetic across rounds
      answer = await postJobWithRetry(cfg, job.id, { reply: second.text, usage: second.usage || undefined }, POST_ATTEMPTS);
    } catch (e) {
      warn(`✖ לא הצלחתי לדווח את התיקון לאתר: ${e.message}`);
      return 'undelivered';
    }
    // At most ONE repair turn. If the site asks again, that is the site's bug
    // (or a race) — the worker refuses rather than looping a GPU forever.
    if (answer && answer.repair) {
      warn('האתר ביקש סבב תיקון נוסף — סבב אחד הוא המקסימום, מתעלם.');
      note('second repair request ignored (cap is one); the job stays as the site recorded it');
      return 'done';
    }
  }

  const warnings = (answer && answer.warnings) || [];
  const hard = !!(answer && answer.hard);
  say(`■ העבודה הסתיימה: ${(answer && answer.status) || 'done'} · ${count(warnings.length, 'הערה אחת', 'הערות', 'ללא הערות')}${hard ? ' · יש הערה חמורה' : ''} — התשובה ממתינה לאישור באדמין.`);
  return (answer && answer.status === 'failed') ? 'failed' : 'done';
}

/** Best effort: a job the owner can read a reason for beats a job stuck at
 *  `running`. If even this POST fails, say so and carry on — the loop matters
 *  more than this one report. */
async function reportFailure(cfg, jobId, code, message) {
  if (FLAGS.dry) { note('dry run: not reporting the failure'); return; }
  const body = { error: { code: String(code || 'ERROR'), message: String(message || '').slice(0, MAX_ERROR_CHARS) } };
  try {
    await postJobWithRetry(cfg, jobId, body, 2);
    say('דיווחתי לאתר שהעבודה נכשלה — הסיבה תופיע באדמין.');
  } catch (e) {
    warn(`לא הצלחתי לדווח על הכישלון (${e.message}) — העבודה עשויה להישאר במצב "רצה" עד שתבטלו אותה באדמין.`);
  }
}

// ── the loop ────────────────────────────────────────────────────────────

/** The store calls a worker offline after 120s of silence, and /next is the
 *  only thing that stamps it — so a four-minute job would look dead in the
 *  admin. A quiet ping every minute keeps the light on while the GPU works. */
function startHeartbeat(cfg) {
  const t = setInterval(() => {
    ping(cfg).then(
      () => note('heartbeat'),
      (e) => note('heartbeat failed: ' + e.message)
    );
  }, HEARTBEAT_MS);
  if (t.unref) t.unref();
  return () => clearInterval(t);
}

async function main() {
  if (FLAGS.help) { console.log(usage()); process.exit(0); }
  const cfg = readConfig();

  say(`tapuz-worker ${VERSION} · אתר: ${cfg.site} · מודל: ${cfg.modelEndpoint} (${cfg.model || 'מה שטעון'}) · טוקן: ${cfg.tokenHint}` +
    (FLAGS.dry ? ' · ריצה יבשה' : '') + (FLAGS.once ? ' · עבודה אחת' : ''));

  // ── the boot ping: the one place a bad token is treated as fatal ──
  // A 401 here means the worker was started wrong, and a daemon that retries
  // a wrong token every minute forever hides that. Once the worker IS running,
  // a 401 is transient (the owner may be rotating the token) and backs off.
  for (let attempt = 1; ; attempt++) {
    try {
      const pong = await ping(cfg);
      say(`מחובר. גרסת האתר ${pong.version || '?'} · ${count(pong.pending, 'עבודה אחת בתור', 'עבודות בתור', 'אין עבודות בתור')}.`);
      break;
    } catch (e) {
      if (e.auth) {
        die('האתר דחה את הטוקן (' + cfg.tokenHint + ') — ודאו שהוא טוקן סוכן עם הרשאות read+write.', e.message);
      }
      if (e.rateLimited && attempt <= 3) {
        const ms = e.retryAfterMs || RATE_LIMIT_MIN_MS;
        slowDown(ms);
        await sleepMs(ms);
        continue;
      }
      warn(`לא הצלחתי להגיע לאתר: ${e.message}`);
      if (FLAGS.once) { say('אין מה לעשות — יוצא.'); process.exit(1); }
      say('ממשיך לנסות ברקע.');
      break;
    }
  }

  const stopHeartbeat = startHeartbeat(cfg);
  let backoff = 0;
  let didJob = false;
  let lastOutcome = '';
  let idleLogged = false;

  while (!stopping) {
    let job = null;
    try {
      job = await claimNext(cfg);
      backoff = 0;
    } catch (e) {
      // 429 is the site pacing us, not a fault: wait what it asked (or the
      // backoff already standing, whichever is longer), and leave the backoff
      // and the --once give-up counter exactly where they were.
      if (e.rateLimited) {
        const ms = Math.max(e.retryAfterMs || 0, backoff || RATE_LIMIT_MIN_MS);
        slowDown(ms);
        await sleepMs(ms);
        continue;
      }
      backoff = backoff ? Math.min(BACKOFF_MAX_MS, backoff * 2) : BACKOFF_MIN_MS;
      warn(`האתר לא זמין (${e.message}) — מנסה שוב בעוד ${Math.round(backoff / 1000)} שנ׳.`);
      if (e.auth) warn('האתר דוחה את הטוקן. אם החלפתם טוקן — עדכנו את TAPUZ_TOKEN והפעילו מחדש.');
      if (FLAGS.once && backoff >= 4 * BACKOFF_MIN_MS) { stopHeartbeat(); say('לא הצלחתי לקבל עבודה — יוצא.'); process.exit(1); }
      await sleepMs(backoff);
      continue;
    }

    if (!job) {
      if (FLAGS.once) { stopHeartbeat(); say('אין עבודות בתור — אין מה לעשות. להתראות!'); process.exit(0); }
      if (!idleLogged) { note('nothing pending; polling every ' + cfg.pollMs + 'ms'); idleLogged = true; }
      await sleepMs(cfg.pollMs);
      continue;
    }
    idleLogged = false;

    inFlight = job;
    try {
      lastOutcome = await runJob(cfg, job);
      didJob = true;
    } catch (e) {
      // a bug in the worker itself, not a model or a site failure: report it
      // so the job does not hang, then keep the loop alive
      warn(`✖ תקלה פנימית בעובד: ${e && e.message}`);
      note((e && e.stack) || String(e));
      await reportFailure(cfg, job.id, 'WORKER', 'תקלה פנימית בעובד המקומי: ' + (e && e.message));
      lastOutcome = 'failed';
    } finally {
      inFlight = null;
      aborting = false;
    }

    if (FLAGS.once) break;
    if (!stopping) await sleepMs(Math.min(cfg.pollMs, 1000));   // a queue worth draining is drained
  }

  stopHeartbeat();
  say('העובד נסגר. להתראות!');
  // --once is a command, not a daemon: its exit code reports the outcome so a
  // smoke can assert on it. The daemon loop never exits non-zero (a transient
  // failure must not kill a worker the owner left running overnight).
  if (FLAGS.once && didJob) process.exit(lastOutcome === 'done' || lastOutcome === 'dry' ? 0 : 1);
  process.exit(0);
}

// ── signals: finish the job in flight, then leave ───────────────────────

function onSignal(sig) {
  if (!stopping) {
    stopping = true;
    if (inFlight) say(`\nהתקבל ${sig} — מסיים את העבודה הנוכחית ואז נסגר. (Ctrl+C נוסף יבטל אותה)`);
    else say(`\nהתקבל ${sig} — נסגר.`);
    if (wake) wake();
    return;
  }
  if (inFlight && !aborting) {
    aborting = true;
    say('מבטל את הריצה ומדווח לאתר…');
    abortModel('העבודה בוטלה — העובד נסגר.');
    return;
  }
  closeLine();
  process.exit(130);
}
process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));

// A worker that dies on an unhandled rejection is a worker that is not there
// at 3am. Log it and let the loop carry on.
process.on('unhandledRejection', (e) => {
  warn('תקלה לא מטופלת בעובד: ' + (e && e.message ? e.message : String(e)));
  note((e && e.stack) || '');
});

main().catch((e) => {
  warn('העובד נעצר: ' + (e && e.message ? e.message : String(e)));
  note((e && e.stack) || '');
  process.exit(1);
});
