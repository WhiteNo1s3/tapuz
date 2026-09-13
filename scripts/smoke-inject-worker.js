'use strict';

/**
 * v2.30 QA — injection JOBS: the third courier, the one that needs nothing
 * open. The owner queues a pack in the admin; a worker process on the machine
 * that HAS the model claims it over /agent/v1, runs it, and posts the reply
 * back. The admin tab may be closed the whole time.
 *
 * Booted in-process like smoke-inject-route (same fake pack, whose door
 * refuses on REFUSE and raises the repairable UNKNOWN_PAGE on FIXME), with a
 * REAL agent token on the real bearer guard. No model is involved at all
 * here: this smoke plays the worker itself, which is the point — the server
 * must hold every piece of state and make every decision.
 *
 * What is pinned:
 *   • queue → claim → post → done, and the reply + preview land on the job
 *   • the ONE repair round: the server hands back the second prompt, the
 *     worker never composes anything, and the better reply wins
 *   • a job NEVER applies (the menus table is untouched throughout)
 *   • the bearer guard: no token 401, read-scope token cannot post 403
 *   • a claim is exclusive (a second worker gets nothing)
 *   • a worker's own failure ends the job 'failed' WITH a readable reason
 *   • a refusal after the repair round keeps the text for the owner to fix
 *   • cancel, unknown job 404, posting to a finished job 409
 *   • the heartbeat drives the admin's "worker online" flag
 *   • PACK_TOO_BIG is refused at queue time, before anything is stored
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-inject-worker-'));
process.env.TAPUZ_ROOT = ROOT;
const PORT = 3991;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { body, form, cookie, token, accept } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: accept || 'application/json', Origin: BASE };
    if (form != null) { data = new URLSearchParams(form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    else if (body != null) { data = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    if (cookie) headers['Cookie'] = cookie;
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (e) { /* non-json */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// ── the site ──
require('../src/db');
const { runSetup } = require('../src/setup');
runSetup({
  title: 'אתר בדיקה', description: 'inject-worker smoke',
  colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
  menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
});
require('../src/auth').createAdmin('owner', 'owner-pass-1');

const agentTokens = require('../src/agent-tokens');
const rw = agentTokens.mintToken({ name: 'worker', scopes: ['read', 'write'] });
const ro = agentTokens.mintToken({ name: 'reader', scopes: ['read'] });
const WORKER = rw.token || rw.secret || rw.value;
const READER = ro.token || ro.secret || ro.value;

// ── the FAKE pack (the smoke-inject-route one, verbatim in spirit) ──
const registry = require('../src/injections');
const FAKE = {
  id: 'worker-pack', kind: 'fake', family: 'site', title: '🧪 חבילת עובד', blurb: 'לבדיקה בלבד',
  budget: { lite: 9000, full: 14000 },
  buildPrompt({ brief = '', size = 'lite' } = {}) {
    const text = '# ⚠️ FRESH\nPROMPT ' + size + ' ' + brief;
    return { text, chars: text.length, meta: { size } };
  },
  parse(reply) {
    if (/REFUSE/.test(reply)) { const e = new Error('אין תפריט בתשובה'); e.code = 'NO_MENU'; throw e; }
    const warnings = /FIXME/.test(reply) ? [{ code: 'UNKNOWN_PAGE', message: 'דף לא קיים: nope — הקישור הושמט' }] : [];
    return {
      preview: { note: 'הערה', menus: { main: { location: 'main', tree: [], } }, diff: {}, knobs: { changed: [] }, fitLine: 'שורה אחת ✓' },
      warnings, warningTexts: warnings.map((w) => w.message), notes: [], hard: warnings.some((w) => w.code === 'BAD_TEL')
    };
  },
  apply() { throw new Error('a job must never apply'); },
  undo() { return { restored: null }; },
  hardCodes: ['BAD_TEL'],
  run: { enabled: true, maxTokens: 2048, timeoutMs: { local: 240000, cloud: 90000 }, repairable: ['UNKNOWN_PAGE'] },
  ui: { briefPlaceholder: '', sizes: ['lite', 'full'], applyLabel: 'החל', mount: [], canApply: true, renderPreview: () => '', hidden: false }
};
registry.register(FAKE);

const express = require('express');
const bodyParser = require('body-parser');
const app = express();
app.use(bodyParser.urlencoded({ extended: true, limit: '256kb' }));
app.use(bodyParser.json({ limit: '12mb' }));
app.use(require('../src/admin-gate').adminGate);
app.use(require('../src/routes/auth-screens'));
app.use(require('../src/routes/inject'));
app.use(require('../src/routes/agent-bridge'));
const server = app.listen(PORT);

const jobsStore = require('../src/inject-jobs');

(async () => {
  try {
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' }, accept: 'text/html' });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];
    const menusBefore = JSON.stringify(require('../src/menus').loadMenus());
    check('owner session issued and both agent tokens minted', !!cookie && !!WORKER && !!READER);

    // ── the bearer guard ──
    check('no token → 401 on the worker API', (await req('GET', '/agent/v1/inject/next')).status === 401);
    // claiming MUTATES (running + claimedBy), so it is a write however much
    // it looks like a read — a read-only token must not change state
    check('a read-scope token may NOT claim work (403) — /next is a write',
      (await req('GET', '/agent/v1/inject/next', { token: READER })).status === 403);
    check('a read-scope token may still ping (that one really is a read)',
      (await req('GET', '/agent/v1/inject/ping', { token: READER })).status === 200);
    check('a read-scope token may NOT post a reply (403)',
      (await req('POST', '/agent/v1/inject/job_nope', { token: READER, body: { reply: 'x' } })).status === 403);
    check('a read-scope token may NOT release a job (403)',
      (await req('POST', '/agent/v1/inject/job_nope/release', { token: READER })).status === 403);

    // ── the heartbeat ──
    const ping = await req('GET', '/agent/v1/inject/ping', { token: WORKER });
    check('ping answers and stamps the heartbeat',
      ping.status === 200 && ping.json.ok === true && typeof ping.json.pending === 'number' && jobsStore.workerStatus().online === true);

    // ── queue → claim → done ──
    const queued = await req('POST', '/admin/api/inject/worker-pack/job', { cookie, body: { brief: 'סדר', size: 'lite' } });
    const job = queued.json && queued.json.job;
    check('the admin queues a job (pending, with the pack already composed)',
      queued.status === 200 && queued.json.ok === true && job && job.status === 'pending' && job.promptChars > 0 && /^job_[0-9a-f]{24}$/.test(job.id));
    check('the queue answer reports whether a worker is around', !!queued.json.worker && typeof queued.json.worker.online === 'boolean');

    const claim = await req('GET', '/agent/v1/inject/next', { token: WORKER });
    const w = claim.json && claim.json.job;
    check('the worker claims it and receives the PROMPT, not a recipe to build one',
      claim.status === 200 && w && w.id === job.id && /^PROMPT lite/m.test(w.prompt) && w.maxTokens === 2048 && w.round === 1);
    // src/ai.js always sends a system turn; a job carries one too, so the same
    // pack cannot answer differently through a worker than through /run
    check('the claim carries the system turn explicitly (empty, like ai.js sends)', w.system === '');
    check('a second worker gets nothing — a claim is exclusive',
      (await req('GET', '/agent/v1/inject/next', { token: WORKER })).json.job === null);
    check('the admin sees it running', (await req('GET', '/admin/api/inject/jobs/' + job.id, { cookie })).json.job.status === 'running');

    const posted = await req('POST', '/agent/v1/inject/' + job.id, { token: WORKER, body: { reply: 'DOC CLEAN', usage: { prompt_tokens: 900, completion_tokens: 120 } } });
    check('a clean reply finishes the job in one round', posted.status === 200 && posted.json.ok === true && posted.json.done === true && posted.json.status === 'done');
    const done = (await req('GET', '/admin/api/inject/jobs/' + job.id, { cookie })).json.job;
    check('the finished job carries the reply, the preview and the warnings for the admin',
      done.status === 'done' && done.reply === 'DOC CLEAN' && done.result && done.result.preview && Array.isArray(done.result.warnings) &&
      done.usage.prompt_tokens === 900);
    check('posting again to a finished job is refused (409)',
      (await req('POST', '/agent/v1/inject/' + job.id, { token: WORKER, body: { reply: 'DOC CLEAN' } })).status === 409);

    // ── the one repair round, driven entirely by the server ──
    const q2 = await req('POST', '/admin/api/inject/worker-pack/job', { cookie, body: { brief: '', size: 'lite' } });
    const j2 = q2.json.job;
    await req('GET', '/agent/v1/inject/next', { token: WORKER });
    const r1 = await req('POST', '/agent/v1/inject/' + j2.id, { token: WORKER, body: { reply: 'DOC FIXME', usage: { prompt_tokens: 100, completion_tokens: 10 } } });
    check('a repairable warning asks the worker for a SECOND turn, prompt included',
      r1.status === 200 && r1.json.ok === true && !r1.json.done && r1.json.repair &&
      /תיקונים נדרשים/.test(r1.json.repair.prompt) && /nope/.test(r1.json.repair.prompt) &&
      Array.isArray(r1.json.repair.history) && r1.json.repair.history.length === 2 &&
      r1.json.repair.history[1].content === 'DOC FIXME');
    check('the job is still running, now on round 2', (await req('GET', '/admin/api/inject/jobs/' + j2.id, { cookie })).json.job.round === 2);
    const r2 = await req('POST', '/agent/v1/inject/' + j2.id, { token: WORKER, body: { reply: 'DOC CLEAN', usage: { prompt_tokens: 200, completion_tokens: 20 } } });
    check('the repaired reply wins and the job finishes', r2.status === 200 && r2.json.done === true && r2.json.status === 'done');
    const done2 = (await req('GET', '/admin/api/inject/jobs/' + j2.id, { cookie })).json.job;
    check('rounds:2 repaired:true, with the usage of BOTH turns summed',
      done2.result.rounds === 2 && done2.result.repaired === true && done2.reply === 'DOC CLEAN' &&
      done2.usage.prompt_tokens === 300 && done2.usage.completion_tokens === 30);

    // ── a reply the door refuses even after the repair round ──
    const q3 = await req('POST', '/admin/api/inject/worker-pack/job', { cookie, body: { brief: '', size: 'lite' } });
    const j3 = q3.json.job;
    await req('GET', '/agent/v1/inject/next', { token: WORKER });
    const bad1 = await req('POST', '/agent/v1/inject/' + j3.id, { token: WORKER, body: { reply: 'REFUSE' } });
    check('a refusal on the first reply also earns the repair turn', !!bad1.json.repair);
    const bad2 = await req('POST', '/agent/v1/inject/' + j3.id, { token: WORKER, body: { reply: 'REFUSE again' } });
    check('two refusals end the job failed — WITH the text, so the owner can fix it by hand',
      bad2.json.done === true && bad2.json.status === 'failed');
    const failed = (await req('GET', '/admin/api/inject/jobs/' + j3.id, { cookie })).json.job;
    check('the failed job names the door code and keeps the reply',
      failed.status === 'failed' && failed.error && failed.error.code === 'NO_MENU' && /REFUSE again/.test(failed.reply));

    // ── the worker reporting its OWN failure ──
    const q4 = await req('POST', '/admin/api/inject/worker-pack/job', { cookie, body: { brief: '', size: 'lite' } });
    const j4 = q4.json.job;
    await req('GET', '/agent/v1/inject/next', { token: WORKER });
    const errPost = await req('POST', '/agent/v1/inject/' + j4.id, { token: WORKER, body: { error: { code: 'MODEL_DOWN', message: 'LM Studio לא עונה' } } });
    check('a worker error ends the job failed rather than leaving it stuck running',
      errPost.status === 200 && errPost.json.status === 'failed');
    const failed2 = (await req('GET', '/admin/api/inject/jobs/' + j4.id, { cookie })).json.job;
    check('the reason reaches the owner verbatim', failed2.error.code === 'MODEL_DOWN' && /LM Studio/.test(failed2.error.message));

    // ── release: a dry run, or a worker shutting down, hands the job back ──
    const q7 = await req('POST', '/admin/api/inject/worker-pack/job', { cookie, body: { brief: '', size: 'lite' } });
    const claimed7 = await req('GET', '/agent/v1/inject/next', { token: WORKER });
    check('a job can be claimed then released back to pending',
      claimed7.json.job.id === q7.json.job.id &&
      (await req('POST', '/agent/v1/inject/' + q7.json.job.id + '/release', { token: WORKER })).json.status === 'pending');
    const reclaimed = await req('GET', '/agent/v1/inject/next', { token: WORKER });
    check('a released job is handed straight to the next worker', reclaimed.json.job && reclaimed.json.job.id === q7.json.job.id);
    check('releasing a job that is not running is a no-op, not an error',
      (await req('POST', '/agent/v1/inject/' + job.id + '/release', { token: WORKER })).json.ok === true);

    // ── the owner cancels while the GPU is busy ──
    const q8 = await req('POST', '/admin/api/inject/worker-pack/job', { cookie, body: { brief: '', size: 'lite' } });
    await req('GET', '/agent/v1/inject/next', { token: WORKER });
    await req('POST', '/admin/api/inject/jobs/' + q8.json.job.id + '/cancel', { cookie });
    const intoCancelled = await req('POST', '/agent/v1/inject/' + q8.json.job.id, { token: WORKER, body: { reply: 'DOC CLEAN' } });
    check('posting into a cancelled job is answered calmly, not as an error',
      intoCancelled.status === 200 && intoCancelled.json.ok === true && intoCancelled.json.status === 'cancelled');
    check('the cancelled job stays cancelled — a late reply does not revive it',
      (await req('GET', '/admin/api/inject/jobs/' + q8.json.job.id, { cookie })).json.job.status === 'cancelled');

    // ── the heartbeat ticks while the worker is BUSY, not only while idle ──
    const before = require('../src/inject-jobs').workerStatus().seenAt;
    await new Promise((r) => setTimeout(r, 15));
    await req('POST', '/agent/v1/inject/' + q8.json.job.id, { token: WORKER, body: { reply: 'x' } });
    check('posting stamps the heartbeat too (a long job must not look offline)',
      require('../src/inject-jobs').workerStatus().seenAt > before);

    // ── cancel, and the unknown id ──
    const q5 = await req('POST', '/admin/api/inject/worker-pack/job', { cookie, body: { brief: '', size: 'lite' } });
    const cancelled = await req('POST', '/admin/api/inject/jobs/' + q5.json.job.id + '/cancel', { cookie });
    check('the owner can cancel a queued job', cancelled.status === 200 && cancelled.json.job.status === 'cancelled');
    check('a cancelled job is not handed to a worker', (await req('GET', '/agent/v1/inject/next', { token: WORKER })).json.job === null);
    // hand the re-claimed one back so the queue ends the run settled: nothing
    // may be left 'running' by a smoke that finished every job it started
    await req('POST', '/agent/v1/inject/' + q7.json.job.id + '/release', { token: WORKER });
    await req('POST', '/admin/api/inject/jobs/' + q7.json.job.id + '/cancel', { cookie });
    check('no job is left stranded in running when every one has been answered or given back',
      (await req('GET', '/admin/api/inject/jobs?packId=worker-pack&limit=30', { cookie })).json.jobs
        .filter((j) => j.status === 'running').length === 0);
    check('an unknown job id → 404 on both sides',
      (await req('GET', '/admin/api/inject/jobs/job_' + '0'.repeat(24), { cookie })).status === 404 &&
      (await req('POST', '/agent/v1/inject/job_' + '0'.repeat(24), { token: WORKER, body: { reply: 'x' } })).status === 404);

    // ── the gates ──
    const ai = require('../src/ai');
    const realBudget = ai.contextBudget;
    ai.contextBudget = () => 10;
    const tooBig = await req('POST', '/admin/api/inject/worker-pack/job', { cookie, body: { brief: '', size: 'full' } });
    ai.contextBudget = realBudget;
    check('a pack over the local window is refused at QUEUE time, before anything is stored',
      tooBig.status === 400 && tooBig.json.code === 'PACK_TOO_BIG' && tooBig.json.suggestSize === 'lite');
    check('the admin job list is admin-gated', (await req('GET', '/admin/api/inject/jobs')).status === 401);
    check('queueing is admin-gated', (await req('POST', '/admin/api/inject/worker-pack/job', { body: {} })).status === 401);

    // ── the list the card reads ──
    const listed = await req('GET', '/admin/api/inject/jobs?packId=worker-pack&limit=10', { cookie });
    check('the list comes back newest-first with the worker status',
      listed.status === 200 && listed.json.jobs.length >= 5 && listed.json.jobs[0].createdAt >= listed.json.jobs[1].createdAt &&
      listed.json.worker && listed.json.worker.online === true);
    check('the list never ships the composed prompt (it is large, and /prompt already serves it)',
      listed.json.jobs.every((j) => !('prompt' in j)));

    // ── a stale claim goes back in the queue ──
    const q6 = await req('POST', '/admin/api/inject/worker-pack/job', { cookie, body: { brief: '', size: 'lite' } });
    await req('GET', '/agent/v1/inject/next', { token: WORKER });
    jobsStore.updateJob(q6.json.job.id, { claimedAt: Date.now() - (jobsStore.CLAIM_STALE_MS + 1000) });
    const revived = await req('GET', '/agent/v1/inject/next', { token: WORKER });
    check('a worker that vanished mid-job does not strand it — the claim goes stale and is re-issued',
      revived.json.job && revived.json.job.id === q6.json.job.id);

    // ── the invariant ──
    check('NOTHING was ever applied (the menus table is untouched)',
      JSON.stringify(require('../src/menus').loadMenus()) === menusBefore);
    check('the job store lives under TAPUZ_ROOT/config and is a single JSON file',
      jobsStore.STORE.startsWith(ROOT) && /config[\\/]inject-jobs\.json$/.test(jobsStore.STORE));
    const ledger = require('../src/injections/log').LOG_PATH;
    const entries = (fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean) : []).map((l) => JSON.parse(l));
    check('every job action is in the ledger, attributed to the worker',
      entries.some((e) => e.action === 'job' && e.code === 'QUEUED') &&
      entries.some((e) => e.action === 'job' && e.ok === true && e.provider === 'worker'));
    check('the ledger still never holds the reply text', !entries.some((e) => JSON.stringify(e).includes('DOC CLEAN')));
  } catch (e) {
    check('smoke ran without an exception: ' + e.message + '\n' + e.stack, false);
  } finally {
    server.close();
  }
  console.log(fail ? '\nSMOKE INJECT-WORKER: FAIL' : '\nSMOKE INJECT-WORKER: PASS');
  process.exit(fail ? 1 : 0);
})();
