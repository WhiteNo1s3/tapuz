'use strict';

/**
 * Injection jobs (v2.30) — the third way to run a pack, and the only one that
 * needs nothing open.
 *
 *   server-side provider  the CMS calls a model it can reach (local / cloud key)
 *   Bridge V2             the owner's BROWSER carries the call to their LM Studio
 *   a job (this file)     a worker process on the owner's machine pulls the
 *                         work, runs it, and posts the reply back
 *
 * A hosted Tapuziel cannot reach the owner's model, and a browser tab is a
 * fragile courier: both browsers evict an idle background script after ~30
 * seconds, and Chrome caps any single request at five minutes. A job has no
 * such ceiling. The owner queues it, closes the laptop, and the reply is
 * waiting when they come back.
 *
 * THE INVARIANT THAT DOES NOT MOVE: a job never applies. It ends as a reply
 * plus the door's preview, and apply is still a separate admin POST that
 * re-parses the text the owner can read (docs/INJECTIONS.md §0.9). The worker
 * is authenticated with the owner's own agent token, so trusting what it
 * posts is the same decision the paste tier already makes — and the approval
 * gate is downstream of both.
 *
 * Stored as a small gitignored JSON file under CONFIG_DIR, mirroring agent
 * tokens (src/agent-tokens.js) and missions (src/mission-store.js). Jobs are
 * ephemeral: only the newest MAX_JOBS are kept.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./paths');
const { hasBriefing } = require('./ai');

const STORE = path.join(CONFIG_DIR, 'inject-jobs.json');

const MAX_JOBS = 30;
/** A worker that has not asked for work in this long is not there any more. */
const WORKER_ONLINE_MS = 120 * 1000;
/** A job claimed and never answered is handed back to the next worker — a
 *  machine that went to sleep mid-pack must not strand it as 'running'. */
const CLAIM_STALE_MS = 30 * 60 * 1000;

const STATUSES = ['pending', 'running', 'done', 'failed', 'cancelled'];

function load() {
  try {
    if (fs.existsSync(STORE)) {
      const data = JSON.parse(fs.readFileSync(STORE, 'utf8'));
      if (Array.isArray(data.jobs)) {
        return { jobs: data.jobs, worker: data.worker && typeof data.worker === 'object' ? data.worker : null };
      }
    }
  } catch (e) {
    /* a corrupt store must never take the site down — start fresh */
  }
  return { jobs: [], worker: null };
}

function save(data) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const jobs = data.jobs.slice(-MAX_JOBS);
  fs.writeFileSync(STORE, JSON.stringify({ jobs, worker: data.worker || null }, null, 2), 'utf8');
}

function newId() {
  return 'job_' + crypto.randomBytes(12).toString('hex');
}

/** What the ADMIN may see: everything except the composed prompt, which is
 *  large, and which the pack's own prompt route already hands out. */
function publicView(job) {
  if (!job) return null;
  return {
    id: job.id,
    packId: job.packId,
    brief: job.brief,
    size: job.size,
    variant: job.variant,
    status: job.status,
    round: job.round,
    createdAt: job.createdAt,
    claimedAt: job.claimedAt || 0,
    finishedAt: job.finishedAt || 0,
    promptChars: job.promptChars,
    replyChars: (job.reply || '').length,
    usage: job.usage || null,
    result: job.result || null,
    error: job.error || null
  };
}

/**
 * Queue a pack that has ALREADY been composed by the caller — the job carries
 * the exact prompt the run route would have sent, so a job and a run are the
 * same request with a different courier.
 */
function createJob({ packId, brief = '', size = 'lite', variant = 'A', locale = 'he', prompt, promptChars = 0, maxTokens = 2048, model = '' }) {
  if (!packId) throw new Error('createJob needs a packId');
  if (!prompt) throw new Error('createJob needs the composed prompt');
  // The worker on the other end is always the owner's LOCAL model, and a
  // local model with no BenTML briefing invents its own dialect (v2.42,
  // HARD-BATTERY-v2 C1). A pack composed without its dialect is a bug in
  // the pack — refused at the queue, before a worker spends a GPU on it.
  if (!hasBriefing(prompt)) {
    const e = new Error('העבודה יצאה בלי תדריך BenTML — זו תקלה בחבילה, לא במודל; העבודה לא נוספה לתור');
    e.code = 'NO_BRIEFING';
    throw e;
  }
  const data = load();
  const job = {
    id: newId(),
    packId: String(packId),
    brief: String(brief || ''),
    size: String(size || 'lite'),
    variant: String(variant || 'A'),
    locale: String(locale || 'he'),
    status: 'pending',
    round: 1,
    createdAt: Date.now(),
    claimedAt: 0,
    finishedAt: 0,
    claimedBy: '',
    prompt: String(prompt),
    promptChars: Number(promptChars) || String(prompt).length,
    maxTokens: Number(maxTokens) || 2048,
    model: String(model || ''),
    history: [],
    reply: '',
    usage: null,
    result: null,
    error: null
  };
  data.jobs.push(job);
  save(data);
  return job;
}

/** A claim older than CLAIM_STALE_MS goes back in the queue. */
function reviveStale(data) {
  const now = Date.now();
  let changed = false;
  for (const j of data.jobs) {
    if (j.status === 'running' && j.claimedAt && now - j.claimedAt > CLAIM_STALE_MS) {
      changed = true;
      if (j.round > 1) {
        // A stale REPAIR starts over from round 1 — so from the PACK. askRepair
        // put the repair instructions in `prompt`; revived as they were, the
        // worker got "fix these, return the whole document" with no pack and
        // no briefing: a model that invents a dialect (v2.42 review; the
        // worker now refuses it as NO_BRIEFING). The pack is `packPrompt`, or
        // — for a job asked to repair before that field existed — the first
        // turn of the repair history.
        const first = Array.isArray(j.history) && j.history[0] && j.history[0].role === 'user' ? j.history[0].content : '';
        const pack = String(j.packPrompt || first || '');
        if (!pack) {
          j.status = 'failed';
          j.finishedAt = now;
          j.error = { code: 'STALE_REPAIR', message: 'סבב התיקון נתקע והחבילה המקורית לא נשמרה — הריצו את החבילה מחדש.' };
          continue;
        }
        j.prompt = pack;
        delete j.packPrompt;
      }
      j.status = 'pending';
      j.claimedBy = '';
      j.claimedAt = 0;
      j.round = 1;
      j.history = [];
    }
  }
  return changed;
}

/**
 * The oldest pending job, marked running. Also stamps the heartbeat: asking
 * for work is how a worker says it is alive.
 * @returns {object|null} the full job (the worker needs the prompt)
 */
function claimNext(agentId = '') {
  const data = load();
  reviveStale(data);
  data.worker = { agentId: String(agentId || ''), seenAt: Date.now() };
  const job = data.jobs.filter((j) => j.status === 'pending').sort((a, b) => a.createdAt - b.createdAt)[0];
  if (!job) { save(data); return null; }
  job.status = 'running';
  job.claimedAt = Date.now();
  job.claimedBy = String(agentId || '');
  save(data);
  return job;
}

function noteWorkerSeen(agentId = '') {
  const data = load();
  data.worker = { agentId: String(agentId || ''), seenAt: Date.now() };
  save(data);
  return data.worker;
}

function workerStatus() {
  const w = load().worker;
  if (!w || !w.seenAt) return { online: false, seenAt: 0, agentId: '' };
  return { online: Date.now() - w.seenAt < WORKER_ONLINE_MS, seenAt: w.seenAt, agentId: w.agentId || '' };
}

function getJob(id) {
  return load().jobs.find((j) => j.id === String(id || '')) || null;
}

function listJobs({ packId = '', limit = 20 } = {}) {
  const jobs = load().jobs
    .filter((j) => !packId || j.packId === packId)
    .sort((a, b) => b.createdAt - a.createdAt);
  return jobs.slice(0, Math.max(1, Math.min(MAX_JOBS, Number(limit) || 20)));
}

function countPending() {
  return load().jobs.filter((j) => j.status === 'pending').length;
}

/** Write a patch onto one job. Unknown ids are a no-op, never a throw: a
 *  worker posting about a pruned job must get a clean refusal upstream. */
function updateJob(id, patch = {}) {
  const data = load();
  const job = data.jobs.find((j) => j.id === String(id || ''));
  if (!job) return null;
  Object.assign(job, patch);
  if (patch.status && !STATUSES.includes(patch.status)) job.status = 'failed';
  save(data);
  return job;
}

/** Hand the worker a second turn: the door asked for a repair. The pack the
 *  first turn ran is kept aside (`packPrompt`): `prompt` becomes the repair
 *  instructions, and a repair that goes stale must start over from the pack. */
function askRepair(id, { history, prompt }) {
  const job = getJob(id);
  if (!job) return null;
  return updateJob(id, {
    round: 2, history: history || [], prompt: String(prompt || ''),
    packPrompt: job.packPrompt || job.prompt, claimedAt: Date.now()
  });
}

function finishJob(id, { status = 'done', reply = '', usage = null, result = null, error = null }) {
  return updateJob(id, {
    status, reply: String(reply || ''), usage, result, error, finishedAt: Date.now()
  });
}

function cancelJob(id) {
  const job = getJob(id);
  if (!job) return null;
  if (job.status === 'done' || job.status === 'failed') return job;
  return updateJob(id, { status: 'cancelled', finishedAt: Date.now() });
}

/** Test seam only — drops every job and the heartbeat. */
function resetAll() {
  save({ jobs: [], worker: null });
}

module.exports = {
  STORE,
  MAX_JOBS,
  WORKER_ONLINE_MS,
  CLAIM_STALE_MS,
  STATUSES,
  createJob,
  claimNext,
  noteWorkerSeen,
  workerStatus,
  getJob,
  listJobs,
  countPending,
  updateJob,
  askRepair,
  finishJob,
  cancelJob,
  publicView,
  resetAll
};
