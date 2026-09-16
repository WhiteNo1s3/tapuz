'use strict';

/**
 * Agent bridge — the twenty-seventh route-group extraction: the public
 * /agent/v1 API surface ('agents are users too', the North Star pillar).
 * Bearer-token-authed read/write endpoints an AI (or the extension) uses
 * to read the site vocabulary and author pages, plus the CORS/preflight
 * middleware, the per-IP agentLimiter, and the requireAgent scope guard
 * they all share. The /agent JSON body-parser stays in server.js (mounted
 * before this router); the PUBLIC /pzn-schema.json also stays there — it
 * is unauthenticated and not agent-scoped, so it never belonged here.
 */

const express = require('express');
const { FixedWindowLimiter } = require('../ratelimit');
const { clientIp } = require('../http-util');
const agentTokens = require('../agent-tokens');
const { exportAll } = require('../export');
const { createPage, getPageByFullPath, savePageSource, listPages, applyPageOps } = require('../pages');

const router = express.Router();

// per-IP flood cap for the agent bridge (keyed by source IP, not token).
const agentLimiter = new FixedWindowLimiter({ windowMs: 60 * 1000, max: 120 });

function agentCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Vary', 'Origin');
  // NOTE: intentionally NO Access-Control-Allow-Credentials — bearer only.
}

router.use('/agent', (req, res, next) => {
  agentCors(res);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(204).end(); // CORS preflight
  next();
});

/** Bearer-token guard for /agent/v1/*. `scope` = 'read' | 'write' | null. */
function requireAgent(scope) {
  return (req, res, next) => {
    const ip = clientIp(req);
    const raw = /^Bearer\s+(.+)$/i.exec(String(req.headers['authorization'] || '').trim());
    const rawToken = raw ? raw[1].trim() : '';
    // Flood cap keyed by SOURCE IP, never by the attacker-supplied token
    // prefix — a bad-token flood must not exhaust a victim token's quota.
    const key = 'agent:' + ip;
    if (!agentLimiter.allow(key)) {
      res.setHeader('Retry-After', String(agentLimiter.retryAfter(key)));
      return res.status(429).json({ ok: false, error: 'rate limited' });
    }
    if (!rawToken) return res.status(401).json({ ok: false, error: 'missing bearer token' });
    const id = agentTokens.verifyAgentToken(rawToken);
    if (!id) return res.status(401).json({ ok: false, error: 'invalid token' });
    if (scope && !id.scopes.includes(scope)) {
      return res.status(403).json({ ok: false, error: `token lacks '${scope}' scope` });
    }
    req.agent = id;
    next();
  };
}

router.get('/agent/v1/ping', requireAgent('read'), (req, res) => {
  res.json({ ok: true, agent: req.agent.name, scopes: req.agent.scopes, version: require('../../package.json').version });
});

// BYOK provider constants (v0.73) — the CMS is the authority on WHERE each LLM
// supplier's API lives and HOW to shape a call. The extension fetches this and
// never hardcodes an endpoint/model. Read-scoped like the rest of /agent/v1;
// contains NO secret (the user's key lives only in the extension worker).
router.get('/agent/v1/providers', requireAgent('read'), (req, res) => {
  res.json({ ok: true, providers: require('../providers').listProviders() });
});


router.get('/agent/v1/primer', requireAgent('read'), (req, res) => {
  const { buildPznPrimer } = require('../pzn/agent-primer');
  res.type('text/markdown; charset=utf-8').send(buildPznPrimer());
});

router.get('/agent/v1/toolbox', requireAgent('read'), (req, res) => {
  const pznApi = require('../pzn/index');
  res.json({ ok: true, toolbox: pznApi.getToolbox(), schemas: pznApi.getAllSchemas() });
});

// Live syntax dictionary (the tool inventory) — md or json.
router.get('/agent/v1/dictionary', requireAgent('read'), (req, res) => {
  const { buildDictionary, toMarkdown, toAgentTools } = require('../pzn/syntax-dictionary');
  const format = String(req.query.format || 'json');
  if (format === 'md' || format === 'markdown') {
    return res.type('text/markdown; charset=utf-8').send(toMarkdown(buildDictionary()));
  }
  res.json({ ok: true, dictionary: buildDictionary(), tools: toAgentTools() });
});

// The BYOT "injection" (v0.55): ONE pack that primes any chat to roleplay
// BenTML — role + tool inventory + completion contract + full dictionary.
// v0.56: the pack now also carries the REAL media manifest, so the agent
// references images that exist instead of inventing paths (no key needed).
// The extension injects this into the user's own logged-in LLM composer.
router.get('/agent/v1/roleplay', requireAgent('read'), (req, res) => {
  const { buildRoleplayPack, buildInjectBundle } = require('../pzn/agent-roleplay');
  const media = require('../media').listAllMedia(40);
  const brief = req.query.brief ? String(req.query.brief) : '';
  const locale = req.query.locale === 'en' ? 'en' : 'he';
  // size=lite (v0.86): the free-tier pack — compact grammar + capped media,
  // sized to fit one message on a free chat plan (ChatGPT free etc.).
  const size = String(req.query.size || '') === 'lite' ? 'lite' : 'full';
  const opts = { playerBrief: brief, locale, media, size };
  if (String(req.query.format || '') === 'json') {
    return res.json({ ok: true, ...buildInjectBundle(opts) });
  }
  res.type('text/markdown; charset=utf-8').send(buildRoleplayPack(opts).text);
});

// The media library an agent may reference (read-only — reaching EXISTING media
// without a key; creating/uploading media is the BYOK tier).
router.get('/agent/v1/media', requireAgent('read'), (req, res) => {
  res.json({ ok: true, media: require('../media').listAllMedia() });
});

// Copilot missions — the extension pulls the latest pending one (bearer token),
// then reports progress back as it injects/publishes.
router.get('/agent/v1/mission', requireAgent('read'), (req, res) => {
  const missionStore = require('../mission-store');
  res.json({ ok: true, mission: missionStore.getLatestPending() });
});

router.post('/agent/v1/mission/:id/step', requireAgent('write'), (req, res) => {
  const missionStore = require('../mission-store');
  const m = missionStore.updateMission(req.params.id, {
    step: req.body && req.body.step,
    status: (req.body && req.body.status) || undefined,
    fullPath: (req.body && req.body.fullPath) || undefined
  });
  if (!m) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, mission: m });
});

router.get('/agent/v1/pages', requireAgent('read'), (req, res) => {
  const { listPages } = require('../pages');
  res.json({ ok: true, pages: listPages() });
});

router.get('/agent/v1/source', requireAgent('read'), (req, res) => {
  try {
    const fullPath = String(req.query.fullPath || '');
    const kind = req.query.kind === 'published' ? 'published' : 'draft';
    if (!fullPath) return res.status(400).json({ ok: false, error: 'fullPath required' });
    const { getPageSource } = require('../pages');
    const source = getPageSource(fullPath, kind);
    if (source == null) return res.status(404).json({ ok: false, error: 'Page not found' });
    res.json({ ok: true, fullPath, kind, source });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/agent/v1/source', requireAgent('write'), (req, res) => {
  try {
    const { fullPath, publish } = req.body || {};
    let { source } = req.body || {};
    if (!fullPath || typeof source !== 'string') {
      return res.status(400).json({ ok: false, error: 'fullPath and source required' });
    }
    // v2.20: `loose` is accepted but no longer needed — every reply is
    // extracted (fence, chat, <html> brackets) and a keyword-dialect document
    // ("BENTML 0.2") is compiled to .pzn before the strict save runs
    const ex = require('../pzn-source').toPznSource(source);
    source = ex.source;
    const { savePageSource } = require('../pages');
    let result;
    let repaired = false;
    const meta = ex.page && ex.page.meta; // a keyword document's META → page index
    try {
      result = savePageSource(fullPath, source, { publish: !!publish, meta });
      if (publish) exportAll();
    } catch (strictErr) {
      // forgiving retry (v0.49): auto-repair and save as a DRAFT — never
      // publish an auto-corrected page; the admin reviews it in the builder.
      result = savePageSource(fullPath, source, { publish: false, repair: true, meta });
      repaired = true;
    }
    res.json({
      ok: true,
      fullPath,
      blocks: result.blocks,
      warnings: result.warnings,
      repaired,
      changes: result.changes || [],
      published: !!publish && !repaired,
      dialect: ex.dialect,
      extracted: ex.extracted
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, code: e.code || 'E_PZN', line: e.line, fix: e.fix, issues: e.issues });
  }
});

router.post('/agent/v1/ops', requireAgent('write'), (req, res) => {
  try {
    const { fullPath, ops, publish } = req.body || {};
    if (!fullPath || !Array.isArray(ops)) {
      return res.status(400).json({ ok: false, error: 'fullPath and ops[] required' });
    }
    const { applyPageOps } = require('../pages');
    const result = applyPageOps(fullPath, ops, { publish: !!publish });
    if (publish) exportAll();
    res.json({ ok: true, fullPath, blocks: result.blocks, source: result.source, warnings: result.warnings });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, code: e.code || 'E_OPS' });
  }
});

/** Create a new page from a bot's raw .pzn reply (the extension's main path). */
router.post('/agent/v1/create-from-source', requireAgent('write'), (req, res) => {
  try {
    const { publish } = req.body || {};
    let { source } = req.body || {};
    if (typeof source !== 'string' || !source.trim()) {
      return res.status(400).json({ ok: false, error: 'source required' });
    }
    // v2.20: take only the BenTML — fence, chat, <html> brackets gone — and
    // accept BOTH dialects (a "BENTML 0.2" reply is compiled to .pzn here)
    const ex = require('../pzn-source').toPznSource(source);
    // v2.39: an agent's document is model-authored — raw HTML loses its script
    const guard = require('../ai-html-guard').scrubAiSource(ex.source);
    source = guard.source;
    const pznApi = require('../pzn/index');
    let doc;
    let repaired = false;
    let changes = [];
    try {
      doc = pznApi.parse(source);
      const errors = pznApi.validate(doc, { strict: false }).filter((i) => i.severity === 'error');
      if (errors.length) { const err = new Error('invalid'); err.issues = errors; throw err; }
    } catch (parseErr) {
      // repair-first (v0.49): an imperfect reply becomes a clean DRAFT the admin
      // reviews, rather than a hard failure. Needed here because slug derivation
      // itself requires a parseable document.
      const { repair } = require('../pzn/repair');
      const r = repair(source);
      if (!r.ok || r.remaining.length) {
        return res.status(400).json({ ok: false, error: r.error || 'could not build a valid page from the reply', issues: r.remaining || parseErr.issues });
      }
      source = r.source;
      doc = pznApi.parse(source);
      repaired = true;
      changes = r.changes;
    }
    // telemetry (v1.85): this is the extension's publish path — the richest
    // stream of model-authored documents. Clean parses count too (denominator).
    require('../pzn-repair-stats').record({ changes, repaired });
    // same empty-template guard as the admin paste route (v0.72): an agent
    // reply with zero modules must not create a placeholder-titled page.
    if (!pznApi.toTapuzPage(doc).blocks.length) {
      return res.status(400).json({ ok: false, error: 'empty page — the reply carries no bent-* modules (looks like the bare template)' });
    }
    const title = doc.title || 'דף חדש';
    const { deriveSlug } = require('../pzn/intent');
    const slug = deriveSlug((doc.slug || '').trim() || title);
    const { createPage, getPageByFullPath, savePageSource } = require('../pages');
    if (getPageByFullPath(slug) && !(req.body && req.body.update)) {
      return res.status(409).json({ ok: false, error: `page "${slug}" already exists — pass update:true`, fullPath: slug });
    }
    const existed = !!getPageByFullPath(slug);
    if (!existed) createPage({ title, slug, blocks: [] });
    const doPublish = !!publish && !repaired; // never auto-publish a repaired page
    const result = savePageSource(slug, source, { publish: doPublish, meta: ex.page && ex.page.meta });
    if (doPublish) exportAll();
    res.json({ ok: true, fullPath: slug, created: !existed, blocks: result.blocks, warnings: result.warnings, repaired, changes, published: doPublish, dialect: ex.dialect, extracted: ex.extracted, scrubbed: guard.scrubbed });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, code: e.code || 'E_PZN', line: e.line, fix: e.fix, issues: e.issues });
  }
});

/** The Grokin trick: model emits INTENT, server owns the .pzn. */
router.post('/agent/v1/build', requireAgent('write'), (req, res) => {
  try {
    const { intent, publish } = req.body || {};
    const { intentToPzn, deriveSlug } = require('../pzn/intent');
    const source = intentToPzn(intent); // throws on invalid intent
    const pznApi = require('../pzn/index');
    const doc = pznApi.parse(source);
    const title = doc.title || 'דף חדש';
    // deriveSlug hardens against path traversal; run BOTH the bot-supplied
    // bent-slug and the title through it so lookup/create/save agree.
    const slug = deriveSlug((doc.slug || '').trim() || title);
    const { createPage, getPageByFullPath, savePageSource } = require('../pages');
    const existed = !!getPageByFullPath(slug);
    // Don't silently clobber a DIFFERENT existing page — require explicit intent.
    if (existed && !(req.body && req.body.update)) {
      return res.status(409).json({
        ok: false,
        error: `page "${slug}" already exists — pass update:true to overwrite it`,
        fullPath: slug
      });
    }
    if (!existed) createPage({ title, slug, blocks: [] });
    const result = savePageSource(slug, source, { publish: !!publish });
    if (publish) exportAll();
    res.json({ ok: true, fullPath: slug, created: !existed, blocks: result.blocks, source, warnings: result.warnings });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, code: e.code || 'E_BUILD', issues: e.issues });
  }
});

// ── injection jobs (v2.30) — the worker that needs no browser ───────────
//
// A hosted Tapuziel cannot reach the owner's LM Studio, and a browser tab is
// a fragile courier (both browsers evict an idle background script after ~30
// seconds; Chrome caps a single request at five minutes). So the owner can
// instead run `node scripts/tapuz-worker.js` on the machine that HAS the
// model: it claims queued jobs here, runs them, and posts the reply back.
//
// The worker composes nothing. The server holds the prompt, decides whether
// the one repair turn is needed and what it asks for, and judges every reply
// with the pack's own door — exactly as the run route does. The worker is a
// courier with a GPU, authenticated with the owner's own agent token.
//
// And a job NEVER applies: it ends as a reply plus a preview, waiting for the
// owner's second click. See src/inject-jobs.js.

/** The job as the worker sees it — the prompt it must run, nothing else.
 *  `system` is carried explicitly (and is '') because src/ai.js ALWAYS sends
 *  a system turn: a pack whose chat template notices the difference would
 *  otherwise answer differently through a worker than through /run, for no
 *  reason the owner could ever see. The worker composes nothing, not even
 *  an empty message. */
function workerView(job) {
  return {
    id: job.id,
    packId: job.packId,
    round: job.round,
    system: '',
    prompt: job.prompt,
    history: job.history || [],
    maxTokens: job.maxTokens,
    model: job.model || '',
    promptChars: job.promptChars
  };
}

router.get('/agent/v1/inject/ping', requireAgent('read'), (req, res) => {
  const jobs = require('../inject-jobs');
  jobs.noteWorkerSeen(req.agent && req.agent.id);
  let site = '';
  try { site = require('../config').loadConfig().title || ''; } catch (e) { /* a fresh site */ }
  res.json({
    ok: true,
    site,
    version: require('../../package.json').version || '',
    pending: jobs.countPending()
  });
});

// 'write', not 'read': this route CLAIMS — it marks the job running and
// stamps who took it. A read-only token must not be able to change state,
// however convenient it would be to let one poll.
router.get('/agent/v1/inject/next', requireAgent('write'), (req, res) => {
  const jobs = require('../inject-jobs');
  const job = jobs.claimNext(req.agent && req.agent.id);
  res.json({ ok: true, job: job ? workerView(job) : null });
});

/** Give a claimed job back — a dry run, or a worker shutting down mid-job.
 *  Without this a job the worker only looked at would sit 'running' until it
 *  went stale. */
router.post('/agent/v1/inject/:jobId/release', requireAgent('write'), (req, res) => {
  const jobs = require('../inject-jobs');
  jobs.noteWorkerSeen(req.agent && req.agent.id);
  const job = jobs.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'unknown job', code: 'NO_JOB' });
  if (job.status !== 'running') return res.json({ ok: true, status: job.status });
  jobs.updateJob(job.id, { status: 'pending', claimedBy: '', claimedAt: 0, round: 1, history: [], firstReply: '' });
  res.json({ ok: true, status: 'pending' });
});

router.post('/agent/v1/inject/:jobId', requireAgent('write'), (req, res) => {
  const jobs = require('../inject-jobs');
  const { judgeJobReply } = require('./inject');
  jobs.noteWorkerSeen(req.agent && req.agent.id);
  const job = jobs.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'unknown job', code: 'NO_JOB' });
  // the owner cancelled it while the GPU was busy. That is their decision,
  // not an error: the work is dropped and the worker moves on quietly.
  if (job.status === 'cancelled') {
    return res.json({ ok: true, done: true, status: 'cancelled' });
  }
  if (job.status !== 'running') {
    return res.status(409).json({ ok: false, error: `job is ${job.status}, not running`, code: 'NOT_RUNNING' });
  }
  const b = req.body || {};
  // the worker reporting its own failure: end the job with a reason the
  // owner can read, rather than leaving it stuck 'running'
  if (b.error) {
    const e = { code: String(b.error.code || 'WORKER_ERROR').slice(0, 40), message: String(b.error.message || '').slice(0, 500) };
    jobs.finishJob(job.id, { status: 'failed', reply: '', error: e });
    return res.json({ ok: true, done: true, status: 'failed' });
  }
  try {
    const out = judgeJobReply(job, String(b.reply || ''), b.usage || null);
    return res.json(out);
  } catch (e) {
    jobs.finishJob(job.id, { status: 'failed', error: { code: e.code || 'DOOR_FAILED', message: e.message } });
    return res.status(500).json({ ok: false, error: e.message, code: e.code || 'DOOR_FAILED' });
  }
});

module.exports = router;
