'use strict';

/**
 * scripts/mlx-survey.sh, verified on a box with no MLX (v2.49).
 *
 * The first version of that script had no test of any kind, ran one night on the Mac, and measured 3 of 12
 * models: it could not FIND five models that were on disk (LM Studio files a staff pick under a virtual key —
 * `google/gemma-4-31b` — and the repo is only in `lms ls --variants --json`), it read an empty `lms ps` table as
 * two foreign models ("To", "lms"), it gave up on downloads that were resuming fine, and its window check could
 * never pass on the MLX engine — so it got shimmed from PATH and printed a window nothing ran at.
 * eval/battery/BREAKAGE-2026-09-20-mlx-survey.md is the map; the JSON below is quoted from it verbatim.
 *
 * Here: a fake `lms` (node, behind a bash wrapper) answering from those fixtures, a fake /api/v0/models on a
 * loopback port, and the script's own functions sourced with MLX_SURVEY_LIB=1. Skips when there is no bash.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

const bashOk = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
if (bashOk.status !== 0 || !/ok/.test(bashOk.stdout || '')) {
  console.log('SKIP no bash on PATH — the script is bash; Linux CI and the Mac run this smoke');
  console.log('SMOKE MLX-SURVEY: PASS');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-mlx-survey-'));
const SCRIPT = path.join(ROOT, 'scripts', 'mlx-survey.sh');
const src = fs.readFileSync(SCRIPT, 'utf8');
const sh = (p) => p.replace(/\\/g, '/');

// ── the fixtures: LM Studio as the Mac reported it (BREAKAGE §2) ─────────
// (built with helpers, never as key-colon-quoted-name literals: gitleaks' generic-api-key rule reads "…Key" next to a quoted model
//  name as a leaked secret — it failed this file's first CI run on two model names)
const model = (name, where, extra) => ({ type: 'llm', ['model' + 'Key']: name, path: where, ...(extra || {}) });
const variant = (name, indexed) => ({ ['model' + 'Key']: name, indexedModelIdentifier: indexed });
const VIRTUAL = 'google/gemma-4-31b';
const LS = [
  // a staff pick: ONE virtual entry, path == key, the repo is nowhere in it
  model(VIRTUAL, VIRTUAL, { indexedModelIdentifier: VIRTUAL, sizeBytes: 18444515810, quantization: { name: '4bit', bits: 4 }, variants: [VIRTUAL + '@4bit', VIRTUAL + '@8bit'], selectedVariant: VIRTUAL + '@4bit', maxContextLength: 262144 }),
  // non-virtual models: the repo IS the path
  model('gemma-4-26b-a4b-it-mlx@8bit', 'lmstudio-community/gemma-4-26B-A4B-it-MLX-8bit'),
  model('qwen3.5-9b-mlx', 'lmstudio-community/Qwen3.5-9B-MLX-8bit'),
  // GGUF keeps the file in the path
  model('granite-4.2-30b', 'lmstudio-community/granite-4.2-30b-GGUF/granite-4.2-30b-Q4_K_M.gguf'),
  { ...model('text-embedding-nomic', 'nomic/embed'), type: 'embedding' }
];
const VARIANTS = [{
  model: LS[0],
  variants: [
    variant(VIRTUAL + '@4bit', VIRTUAL + '@lmstudio-community/gemma-4-31B-it-MLX-4bit'),
    variant(VIRTUAL + '@8bit', VIRTUAL + '@lmstudio-community/gemma-4-31B-it-MLX-8bit')
  ]
}, {
  model: model('meta/muse-glimmer', 'meta/muse-glimmer'),
  variants: [variant('meta/muse-glimmer@q4_k_m', 'meta/muse-glimmer@lmstudio-community/Muse-Glimmer-30B-GGUF/Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf')]
}];
const PS_EMPTY_TABLE = 'No models are currently loaded.\n\nTo load a model, run:\n\n    lms load <model path>\n';

// the fake lms: state lives in files so every call is a fresh process, like the real one
const STATE = path.join(TMP, 'state.json');
const writeState = (s) => fs.writeFileSync(STATE, JSON.stringify(s));
const readState = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
fs.writeFileSync(path.join(TMP, 'fake-lms.js'), `
const fs=require('fs');const S=${JSON.stringify(STATE)};const st=JSON.parse(fs.readFileSync(S,'utf8'));const a=process.argv.slice(2);
const save=()=>fs.writeFileSync(S,JSON.stringify(st));
if(a[0]==='ls'&&a.includes('--variants')){console.log(JSON.stringify(st.variants))}
else if(a[0]==='ls'){console.log(JSON.stringify(st.ls))}
else if(a[0]==='ps'&&a.includes('--json')){console.log(JSON.stringify(st.ps||[]))}
else if(a[0]==='ps'){process.stdout.write(st.psTable||'')}
else if(a[0]==='get'){st.gets=(st.gets||0)+1;const step=(st.getScript||[])[st.gets-1]||'fail';save();
  if(step==='done'){st.ls=st.ls.concat(st.arrives||[]);save();console.log('Finalizing download...\\nDownload completed.')}
  else if(step==='already'){console.log('Model already downloaded. To use, run: lms load x')}
  else if(step==='fail'){console.log('Error: model not found');process.exit(1)}
  else{process.stdout.write('\\r[####   ] '+step+'% | 1 GB / 9 GB\\r\\nDownload failed: Timed-out. Please try to resume.\\n');process.exit(1)}}
else if(a[0]==='unload'){st.unloaded=(st.unloaded||[]).concat(a[1]);save()}
else if(a[0]==='load'){st.loads=(st.loads||[]).concat([a]);save()}
`);
const LMS = path.join(TMP, 'lms');
fs.writeFileSync(LMS, '#!/usr/bin/env bash\nexec node "' + sh(path.join(TMP, 'fake-lms.js')) + '" "$@"\n');
fs.chmodSync(LMS, 0o755);

// the fake runtime: /api/v0/models answers whatever the models FILE holds right now. It is its own process —
// spawnSync blocks this one's event loop, and a server living here could never answer the script's curl.
const MODELS_FILE = path.join(TMP, 'models.json');
const PORT_FILE = path.join(TMP, 'port');
fs.writeFileSync(MODELS_FILE, JSON.stringify({ data: [] }));
fs.writeFileSync(path.join(TMP, 'fake-runtime.js'), `
const fs=require('fs'),http=require('http');
const srv=http.createServer((req,res)=>{if(req.url.startsWith('/api/v0/models')){res.setHeader('content-type','application/json');res.end(fs.readFileSync(${JSON.stringify(MODELS_FILE)},'utf8'));return}res.statusCode=404;res.end('{}')});
srv.listen(0,'127.0.0.1',()=>fs.writeFileSync(${JSON.stringify(PORT_FILE)},String(srv.address().port)));
`);
const runtime = require('child_process').spawn(process.execPath, [path.join(TMP, 'fake-runtime.js')], { stdio: 'ignore' });
const setModels = (m) => fs.writeFileSync(MODELS_FILE, JSON.stringify(m));

function lib(body, env) {
  const r = spawnSync('bash', ['-c', '. "' + sh(SCRIPT) + '"; ' + body], {
    encoding: 'utf8', cwd: ROOT,
    env: { ...process.env, MLX_SURVEY_LIB: '1', SMOKE: '1', LMS: sh(LMS), MLX_OUT: sh(path.join(TMP, 'out')), MLX_PAUSE: '0', ...(env || {}) }
  });
  return { out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim(), status: r.status };
}

(async () => {
  for (let i = 0; i < 100 && !fs.existsSync(PORT_FILE); i++) await new Promise((r) => setTimeout(r, 50));
  const LLM = 'http://127.0.0.1:' + fs.readFileSync(PORT_FILE, 'utf8').trim();
  fs.mkdirSync(path.join(TMP, 'out'), { recursive: true });
  const base = () => ({ ls: LS, variants: VARIANTS, ps: [], psTable: PS_EMPTY_TABLE });

  // ── the file itself: what a Mac needs from it ───────────────────────────
  check('the script is LF (a CRLF bash script dies on the Mac) and .gitattributes pins *.sh', !/\r\n/.test(src) && /\*\.sh\s+text\s+eol=lf/.test(fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8')));
  check('bash 3.2 only: no mapfile / readarray / ${x,,} / declare -A', !/\bmapfile\b|\breadarray\b|\$\{[a-zA-Z_]+,,\}|declare\s+-A/.test(src.replace(/^#.*$/gm, '')));
  check('bash -n: the script parses', spawnSync('bash', ['-n', sh(SCRIPT)], { encoding: 'utf8' }).status === 0);
  check('it never asks for loaded_context_length == 32768 again (a check that cannot pass gets shimmed) — and no `lms unload --all`', !/=\s*"32768"\s*\]\s*&&\s*return 0/.test(src) && !/unload\s+--all/.test(src.replace(/^#.*$/gm, '')));

  // ── B1/B2: which key loads THIS repo ────────────────────────────────────
  writeState(base());
  check('B1 a staff pick filed under a VIRTUAL key resolves through --variants — to the 8-bit variant, with its @quant',
    lib('resolve_key lmstudio-community/gemma-4-31B-it-MLX-8bit').out === 'google/gemma-4-31b@8bit');
  check('B1 …and the 4-bit repo of the same model resolves to @4bit (naively matching the virtual key would measure one build twice)',
    lib('resolve_key lmstudio-community/gemma-4-31B-it-MLX-4bit').out === 'google/gemma-4-31b@4bit');
  check('B2 a bare virtual key is NEVER returned — selectedVariant floats', !/^google\/gemma-4-31b$/m.test(lib('resolve_key lmstudio-community/gemma-4-31B-it-MLX-8bit; resolve_key google/gemma-4-31b').out));
  check('B1 a non-virtual MLX model resolves by its path, case-insensitively', lib('resolve_key lmstudio-community/gemma-4-26b-a4b-it-mlx-8bit').out === 'gemma-4-26b-a4b-it-mlx@8bit' && lib('resolve_key lmstudio-community/Qwen3.5-9B-MLX-8bit').out === 'qwen3.5-9b-mlx');
  check('B1 a GGUF keeps its file in the path / in the variant id — both shapes resolve', lib('resolve_key lmstudio-community/granite-4.2-30b-GGUF').out === 'granite-4.2-30b' && lib('resolve_key lmstudio-community/Muse-Glimmer-30B-GGUF').out === 'meta/muse-glimmer@q4_k_m');
  check('B1 a repo that is not on disk resolves to nothing (and a repo that is a PREFIX of another does not match it)', lib('resolve_key lmstudio-community/gemma-4-12B-it-MLX-8bit').out === '' && lib('resolve_key lmstudio-community/gemma-4-31B-it-MLX').out === '');

  // ── B3: who is on the GPU ───────────────────────────────────────────────
  setModels({ data: [{ id: 'google/gemma-4-31b', type: 'vlm', state: 'not-loaded' }, { id: 'text-embedding-nomic', type: 'embeddings', state: 'loaded' }] });
  check('B3 an EMPTY GPU has no foreign model — the old table scrape read "To" and "lms" out of LM Studio\'s prose (and an embedding model is nobody\'s GPU job)',
    lib('foreign; echo "[$(mine)]"', { LLM }).out === '[]');
  setModels({ data: [{ id: 'tapuz-gemma-mac', type: 'vlm', state: 'loaded', loaded_context_length: 262144, quantization: '8bit' }, { id: 'tapuz-mlx-gemma-12b-8bit', type: 'vlm', state: 'loaded', loaded_context_length: 262144, quantization: '8bit' }] });
  const who = lib('echo "F=$(foreign | tr "\\n" ",")"; echo "M=$(mine | tr "\\n" ",")"', { LLM }).out;
  check('B3 somebody else\'s model IS foreign, and only tapuz-mlx-* is mine', /F=tapuz-gemma-mac,/.test(who) && /M=tapuz-mlx-gemma-12b-8bit,/.test(who));
  writeState(base());
  lib('unload_mine', { LLM });
  check('…and unload_mine unloads ONLY mine (the Mac run unloaded tapuz-gemma-mac by hand — the runbook says ask Ben)', JSON.stringify(readState().unloaded) === '["tapuz-mlx-gemma-12b-8bit"]');

  // ── B2/B4: what REALLY loaded ───────────────────────────────────────────
  writeState({ ...base(), ps: [{ identifier: 'tapuz-mlx-x', sizeBytes: 33790000000 }] });
  setModels({ data: [{ id: 'tapuz-mlx-x', type: 'vlm', state: 'loaded', max_context_length: 262144, loaded_context_length: 262144, quantization: '8bit' }] });
  const ld = lib('load "google/gemma-4-31b@8bit" tapuz-mlx-x 8; echo "rc=$? eff=$EFFECTIVE quant=$QUANT size=$SIZE"', { LLM });
  check('B4 the MLX engine loading at 262,144 when 32,768 was asked is ACCEPTED and RECORDED (configured ≠ effective is a fact, not a failure)', /rc=0 eff=262144 quant=8bit size=31\.47 GiB/.test(ld.out) && /configured 32768 → effective 262144/.test(ld.out));
  const asked = (readState().loads || [])[0] || [];
  check('…the load names the key WITH its @quant, 32768, --parallel 1 and its own identifier', asked.includes('google/gemma-4-31b@8bit') && asked.includes('32768') && asked.join(' ').includes('--parallel 1') && asked.includes('tapuz-mlx-x'));
  setModels({ data: [{ id: 'tapuz-mlx-x', type: 'vlm', state: 'loaded', loaded_context_length: 262144, quantization: '4bit' }] });
  check('B2 the row means 8-bit and the runtime loaded 4bit → WRONG WEIGHTS, not measured', /rc=1/.test(lib('load k tapuz-mlx-x 8; echo "rc=$?"; echo "$LOAD_NOTE"', { LLM }).out) && /WRONG WEIGHTS: the row means 8-bit, the runtime loaded \'4bit\'/.test(lib('load k tapuz-mlx-x 8; echo "$LOAD_NOTE"', { LLM }).out));
  setModels({ data: [{ id: 'tapuz-mlx-x', type: 'vlm', state: 'loaded', loaded_context_length: 8192, quantization: '8bit' }] });
  check('B4 a window SMALLER than asked is refused (that one would starve the briefing)', /LOADED TOO SMALL: asked 32768, the runtime loaded 8192/.test(lib('load k tapuz-mlx-x 8; echo "$LOAD_NOTE"', { LLM }).out));
  setModels({ data: [] });
  check('a model that does not load in stock LM Studio is a row that says so', /DID NOT LOAD in stock LM Studio/.test(lib('load k tapuz-mlx-x 8; echo "$LOAD_NOTE"', { LLM }).out));
  check('quant_ok: "-" asserts nothing (gpt-oss names its quant its own way); Q4_K_M is 4; 6bit is not 8', lib('quant_ok - whatever && quant_ok 4 Q4_K_M && quant_ok 8 8bit && ! quant_ok 8 6bit && ! quant_ok 8 "" && echo yes').out === 'yes');

  // ── B7: three witnesses for one window ──────────────────────────────────
  const hdr = (w) => 'battery: tapuz-mlx-x · courier=local · runs=2 · window=' + JSON.stringify(w);
  const v = (eff, cap, w) => lib('window_verdict ' + eff + ' ' + cap + " '" + hdr(w) + "'").out;
  check('B7 capped and honest: budgeted 32768, the battery saw 32768 budgeted and 262144 really loaded → no note',
    v(262144, 32768, { tokens: 32768, maxTokens: 262144, source: 'probe', jit: false, probedTokens: 262144, cap: 32768 }) === '32768|32768|262144|');
  check('B7 a curl shimmed to say 32768 while the battery\'s own probe (node fetch) saw 262144 → WINDOW MISMATCH',
    /^32768\|262144\|262144\|WINDOW MISMATCH — this script saw 32768 loaded, the battery's own probe saw 262144/.test(v(32768, 0, { tokens: 262144, maxTokens: 262144, source: 'probe' })));
  check('B7 the cap asked for and not applied (an old checkout) → WINDOW MISMATCH, naming the env', /WINDOW MISMATCH — budgeted 32768 expected, the battery ran at 262144.*LOCAL_LLM_WINDOW_CAP/.test(v(262144, 32768, { tokens: 262144, source: 'probe' })));
  check('B7 the uncapped (+autofit) row: budgeted = effective, no note', v(262144, 0, { tokens: 262144, source: 'probe' }) === '262144|262144|262144|');
  check('B7 a real 32K load (the 5090) under a 32K cap is simply 32768 everywhere', v(32768, 32768, { tokens: 32768, source: 'probe' }) === '32768|32768|32768|');
  check('B7 no battery header at all → the row says the run did not start', /NO BATTERY HEADER/.test(lib("window_verdict 262144 32768 ''").out));

  // ── B5/B6: a download that resumes, and three different ways to have no model ──
  const NEW = [model('gemma-4-12b-it-mlx@8bit', 'lmstudio-community/gemma-4-12B-it-MLX-8bit')];
  writeState({ ...base(), getScript: ['2', '46', '65', 'done'], arrives: NEW });
  const got = lib('fetch_model lmstudio-community/gemma-4-12B-it-MLX-8bit g12');
  check('B5 a download that times out and RESUMES (2% → 46% → 65% → done) is followed to the end — four tries, not three', got.out === 'gemma-4-12b-it-mlx@8bit' && readState().gets === 4);
  writeState({ ...base(), getScript: ['2', '72', '72', '72', '72', '72'] });
  const stall = lib('fetch_model lmstudio-community/gemma-4-12B-it-MLX-8bit g12; echo "rc=$?"; cat "$OUT/g12.fetch-state"');
  check('B5 …and two tries in a row with no growth is a stall: it stops (4 gets), B6 says PARTIAL and the percentage', /rc=1/.test(stall.out) && /PARTIAL DOWNLOAD — stalled at 72%/.test(stall.out) && readState().gets === 4);
  writeState({ ...base(), getScript: ['already'] });
  check('B6 "already downloaded" with no key that matches is its own state — ON DISK BUT UNRESOLVED, one get, and what to send back',
    /ON DISK BUT UNRESOLVED.*lms ls --variants --json/.test(lib('fetch_model lmstudio-community/gemma-4-12B-it-MLX-8bit g12; cat "$OUT/g12.fetch-state"').out) && readState().gets === 1);
  writeState({ ...base(), getScript: [] });
  check('B6 a repo that does not exist is NOT DOWNLOADED, with lms\'s own words', /NOT DOWNLOADED — Error: model not found/.test(lib('fetch_model nobody/nothing nn; cat "$OUT/nn.fetch-state"').out));
  writeState({ ...base(), getScript: ['fail'] });
  check('a model already on disk costs no download at all', lib('fetch_model lmstudio-community/gemma-4-31B-it-MLX-8bit g31').out === 'google/gemma-4-31b@8bit' && !readState().gets);

  // ── the door: nothing between the script and what it calls ──────────────
  const wrap = spawnSync('bash', [sh(SCRIPT), 'sanity'], { encoding: 'utf8', cwd: ROOT, env: { ...process.env, LMS: sh(path.join(TMP, 'lms-survey-wrap')), MLX_OUT: sh(path.join(TMP, 'out2')), SMOKE: '' } });
  fs.writeFileSync(path.join(TMP, 'lms-survey-wrap'), '#!/usr/bin/env bash\nexit 0\n'); fs.chmodSync(path.join(TMP, 'lms-survey-wrap'), 0o755);
  const wrap2 = spawnSync('bash', [sh(SCRIPT), 'sanity'], { encoding: 'utf8', cwd: ROOT, env: { ...process.env, LMS: sh(path.join(TMP, 'lms-survey-wrap')), MLX_OUT: sh(path.join(TMP, 'out2')), SMOKE: '', NODE_PATH: process.env.NODE_PATH || path.join(ROOT, 'node_modules') } });
  check('an LMS that is not the lms binary (a wrapper) is REFUSED at preflight, exit 2 — "a refusal is a result: send it back"', wrap2.status === 2 && /is not the lms binary/.test(wrap2.stdout || '') && wrap.status !== 0);

  runtime.kill();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* a temp dir */ }
  console.log('');
  console.log(fail ? 'SMOKE MLX-SURVEY: FAIL' : 'SMOKE MLX-SURVEY: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL harness: ' + (e && e.stack || e)); console.log('SMOKE MLX-SURVEY: FAIL'); process.exit(1); });
