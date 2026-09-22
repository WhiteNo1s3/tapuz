#!/usr/bin/env bash
# The MLX side of the model survey — one command for the Mac (128 GB unified memory, LM Studio, MLX engine).
#
#   bash scripts/mlx-survey.sh                 # sanity, then tiers A B C — the whole job
#   bash scripts/mlx-survey.sh sanity          # only the instrument check (3 scenarios, ~5 min)
#   bash scripts/mlx-survey.sh A               # one tier; tiers can be given in any combination
#   DRY=1 bash scripts/mlx-survey.sh           # print what would run, run nothing
#   bash scripts/mlx-survey.sh variants        # READ-ONLY: which build of each model LM Studio would load — what to click BEFORE a run
#   bash scripts/mlx-survey.sh gemma-31b-4bit  # one model by its tag (after a click); tiers and tags can be mixed
#
# Per model: find it on disk (or download it, resuming while it grows) → load under tapuz-mlx-<tag> → check WHICH
# weights and WHICH window really loaded → the copilot DREAMS (D1–D14), the theme dreams, the page dreams, all
# budgeted at 32K by the CMS itself (LOCAL_LLM_WINDOW_CAP) → for the recommended models one more dreams run at the
# engine's own window → unload → TSV rows that say what ran, at what, and what the battery itself saw.
#
# WHY THE CAP. LM Studio's MLX engine overrides --context-length and loads at the model's maximum whenever memory
# allows ("configured=32,768 fitted=262,144" in its own log; on a 128 GB Mac: always). The first version of this
# script demanded loaded_context_length == 32768 — a check that could never pass, so it got shimmed from PATH and
# a night of rows printed a window they did not run at. Now the CMS budgets at 32K (same tier, same trimming, same
# prompts as a 32K owner), the check is `effective ≥ 32768`, and every row records configured, effective and what
# the BATTERY's own probe saw (node fetch — nothing on PATH can touch it). A disagreement is stamped WINDOW MISMATCH.
#
# It never unloads a model it did not load, never touches the live site, and stops if somebody else's model is on
# the GPU. The model list is DECIDED — do not add, swap or reorder. Do not wrap, alias or shadow anything this
# script calls (lms, curl, node): a refusal is a result — send it back. Orders: eval/battery/RUN-ON-MAC.md
#
# bash 3.2 compatible (macOS): no mapfile, no ${x,,}, no associative arrays.
# Exit codes: 0 done · 2 preflight refused · 3 somebody else is on the GPU · 4 instrument broken.
# Tested without MLX by scripts/smoke-mlx-survey.js (a fake lms + a fake /api/v0/models): MLX_SURVEY_LIB=1 sources
# the functions and runs nothing.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 2

LMS="${LMS:-$HOME/.lmstudio/bin/lms}"
LLM="${LLM:-http://127.0.0.1:1234}"
MIN_VERSION="2.50.0"
CONFIGURED=32768                       # what we ASK the runtime for — and what the CMS budgets at
STAMP="$(date -u +%Y-%m-%d)"
OUT="${MLX_OUT:-eval/battery/mlx-$STAMP}"
TSV="$OUT/results.tsv"
DRY="${DRY:-}"
PAUSE="${MLX_PAUSE:-5}"                 # seconds between download tries (the smoke sets 0)
MAX_GETS="${MLX_MAX_GETS:-12}"

# tier | tag | Hugging Face repo | dreams runs | weights GB (must stay under ~90 on a 128 GB Mac) | bits the row MEANS ("-" = do not assert) | extra
#   extra = autofit → one more dreams run (x1) with the cap off: what a Mac owner gets today, never a 32K row
MODELS='
A|gemma-31b-8bit|lmstudio-community/gemma-4-31B-it-MLX-8bit|2|33|8|autofit
A|gemma-31b-4bit|lmstudio-community/gemma-4-31B-it-MLX-4bit|2|17|4|
A|gemma-26b-a4b-8bit|lmstudio-community/gemma-4-26B-A4B-it-MLX-8bit|2|28|8|autofit
A|gemma-26b-a4b-4bit|lmstudio-community/gemma-4-26B-A4B-it-MLX-4bit|2|15|4|
A|gemma-12b-8bit|lmstudio-community/gemma-4-12B-it-MLX-8bit|2|13|8|autofit
A|gemma-12b-4bit|lmstudio-community/gemma-4-12B-it-MLX-4bit|2|7|4|
A|qwen38-27b-8bit|lmstudio-community/Qwen3.8-27B-MLX-8bit|2|29|8|autofit
B|qwen35-9b-8bit|lmstudio-community/Qwen3.5-9B-MLX-8bit|1|10|8|
B|gemma-e4b-8bit|lmstudio-community/gemma-4-E4B-it-MLX-8bit|1|9|8|
B|granite-30b-8bit|lmstudio-community/granite-4.2-30b-MLX-8bit|1|31|8|
B|muse-glimmer-30b-8bit|mlx-community/Muse-Glimmer-30B-8bit|1|32|8|
B|bonsai2-27b-2bit|prism-ml/Ternary-Bonsai-2-27B-mlx-2bit|1|8|-|
C|gpt-oss-120b|lmstudio-community/gpt-oss-120b-MLX-8bit|1|65|-|
C|mistral-small-4-119b-4bit|mlx-community/Mistral-Small-4-119B-2603-4bit|1|67|4|
C|qwen3-coder-next-6bit|lmstudio-community/Qwen3-Coder-Next-MLX-6bit|1|65|6|
'

say() { printf '%s\n' "$*"; }
run() { if [ -n "$DRY" ]; then say "   DRY: $*"; else "$@"; fi; }
strip() { tr '\r' '\n' | sed 's/\x1b\[[0-9;?]*[A-Za-z]//g'; }
last_line() { [ -f "$1" ] && strip < "$1" | grep -E "$2" | tail -1 | cut -c1-260; }

# ── what is on the GPU: the runtime's own API, never a scraped table (an EMPTY `lms ps` prints prose) ──────────
loaded_json() { curl -s -m 5 "$LLM/api/v0/models" 2>/dev/null; }
loaded_ids() { # "mine" | "foreign" → ids of loaded chat models (an embedding model is nobody's GPU job)
  loaded_json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j={};try{j=JSON.parse(s)}catch(e){}const ids=(j.data||[]).filter(m=>m&&m.state==='loaded'&&!/^embed/i.test(String(m.type||''))).map(m=>String(m.id));const mine=process.argv[1]==='mine';const out=ids.filter(i=>/^tapuz-mlx-/.test(i)===mine);if(out.length)console.log(out.join('\n'))})" "$1"
}
mine() { loaded_ids mine; }
foreign() { [ -n "$DRY" ] && return 0; loaded_ids foreign; }
unload_mine() { for id in $(mine); do run "$LMS" unload "$id" >/dev/null 2>&1; done; }
loaded_field() { # identifier field → loaded_context_length | quantization | max_context_length ('' when not loaded)
  loaded_json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j={};try{j=JSON.parse(s)}catch(e){}const m=(j.data||[]).find(m=>m&&m.id===process.argv[1]&&m.state==='loaded');console.log(m&&m[process.argv[2]]!=null?String(m[process.argv[2]]):'')})" "$1" "$2"
}
loaded_gib() { # identifier → size in GiB from `lms ps --json` (fields verified: identifier, sizeBytes); '' when unknown
  "$LMS" ps --json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j=[];try{j=JSON.parse(s)}catch(e){}const m=(Array.isArray(j)?j:[]).find(m=>m&&m.identifier===process.argv[1]);console.log(m&&m.sizeBytes?(m.sizeBytes/1073741824).toFixed(2)+' GiB':'')})" "$1"
}

# ── which key loads THIS repo. A staff pick is filed under a VIRTUAL key (google/gemma-4-31b) whose `path` is the key
#    itself and whose variants (@4bit, @8bit) share it: the repo is only in `lms ls --variants --json`, as
#    indexedModelIdentifier "virtual@<repo>" (MLX) or "virtual@<repo>/<file>.gguf" (GGUF). A bare virtual key FLOATS
#    (it loads whatever selectedVariant is today) — so a virtual model is only ever IDENTIFIED with its @quant.
#    And it cannot be LOADED by that name: measured 2026-09-20 on a real two-variant model, `lms load
#    google/gemma-4-e2b@q8_0` and POST /api/v1/models/load both answer "Model not found"; only the bare key loads,
#    and `lms get …@q8_0` does not change the selection. So: `loadable` says which key to load and which variant
#    LM Studio has selected — and when that is the other one the row says so BEFORE anything is loaded. ───────────
resolve_key() { # repo → modelKey ('' when it is not on disk)
  { "$LMS" ls --json 2>/dev/null; printf '\n@@VARIANTS@@\n'; "$LMS" ls --variants --json 2>/dev/null; } | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const repo=process.argv[1].toLowerCase(); const parts=s.split('@@VARIANTS@@');
      const parse=(t)=>{try{const j=JSON.parse(t);return Array.isArray(j)?j:[]}catch(e){return[]}};
      const plain=parse(parts[0]||''); const virt=parse(parts[1]||'');
      for(const e of virt) for(const v of (e&&e.variants)||[]){const id=String(v.indexedModelIdentifier||'').toLowerCase();
        if(id.endsWith('@'+repo)||id.includes('@'+repo+'/')){console.log(v.modelKey||'');return}}
      const virtualKeys=new Set(virt.map(e=>e&&e.model&&String(e.model.modelKey||'').toLowerCase()));
      const hit=plain.find(m=>m&&m.type==='llm'&&!virtualKeys.has(String(m.modelKey||'').toLowerCase())&&(()=>{const p=String(m.path||'').toLowerCase();return p===repo||p.startsWith(repo+'/')})());
      console.log(hit?hit.modelKey:'')})" "$1"
}

loadable() { # resolved key → "<key lms can load>|<the selected variant, when the model is virtual>"
  "$LMS" ls --json 2>/dev/null | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const k=process.argv[1]; let j=[]; try{j=JSON.parse(s)}catch(e){}
      const virt=(Array.isArray(j)?j:[]).find(m=>m&&Array.isArray(m.variants)&&m.variants.indexOf(k)>=0&&m.modelKey!==k);
      console.log(virt?virt.modelKey+'|'+(virt.selectedVariant||''):k+'|')})" "$1"
}
other_variant_note() { # wanted selected → the sentence for the row
  say "THE OTHER VARIANT IS SELECTED — LM Studio would load ${2:-another build} for this key, and neither lms nor its API can ask for $1. In the app: My Models → this model → choose the ${1##*@} variant, then run this tier again"
}
variants_report() { # READ-ONLY — nothing is downloaded, loaded or unloaded. What Ben clicks BEFORE a run, not after a night.
  local tier tag repo runs gb bits extra key lk sel
  say "== variants: which build would LM Studio load for each model on the list? (read-only)"
  printf '%s\n' "$MODELS" | while IFS='|' read -r tier tag repo runs gb bits extra; do
    [ -n "$tag" ] || continue
    key="$(resolve_key "$repo")"
    if [ -z "$key" ]; then say "   $tag — not on disk yet (the run downloads it; a download can move the selection — the row will say)"; continue; fi
    lk="$(loadable "$key")"; sel="${lk#*|}"
    if [ -n "$sel" ] && [ "$sel" != "$key" ]; then say "   $tag — CLICK NEEDED: ${sel##*@} is selected, this row needs ${key##*@}. In the app: My Models → the model → choose ${key##*@}"
    else say "   $tag — ready ($key)"; fi
  done
}
known() { # is this argument a step, a tier or a tag on the list? A typo must not be a run that silently does nothing.
  case "$1" in sanity|variants) return 0 ;; esac
  printf '%s\n' "$MODELS" | awk -F'|' -v a="$1" '$1==a || $2==a {f=1} END{exit f?0:1}'
}
card_rows() { # the TSV → the rows the card shows: a row that was NOT measured is dropped once a later row of the same tag exists
  awk -F'\t' 'NR==FNR { last[$1]=FNR; next } !($10=="-" && FNR<last[$1])' "$1" "$1"
}

# ── download: `lms get` dies with "Timed-out. Please try to resume." every few minutes on a slow link and RESUMES on
#    the next call — so loop while it grows; two tries in a row with no growth is a stall. ─────────────────────────
get_progress() { [ -f "$1" ] && strip < "$1" | grep -oE '[0-9]+(\.[0-9]+)?%' | tail -1 | tr -d '%' | cut -d. -f1; }
fetch_model() { # repo tag → prints the key; when there is none, WHY is left in $OUT/<tag>.fetch-state (this runs in a subshell)
  local repo="$1" tag="$2" key best=-1 stalls=0 try=1 pct log state="$OUT/$2.fetch-state"
  rm -f "$state"
  key="$(resolve_key "$repo")"; [ -n "$key" ] && { printf '%s' "$key"; return 0; }
  while [ "$try" -le "$MAX_GETS" ]; do
    log="$OUT/$tag.get.$try.log"
    run "$LMS" get "https://huggingface.co/$repo" --mlx -y > "$log" 2>&1
    key="$(resolve_key "$repo")"; [ -n "$key" ] && { printf '%s' "$key"; return 0; }
    if strip < "$log" | grep -qiE 'already downloaded|download completed'; then
      say "ON DISK BUT UNRESOLVED — lms says it is downloaded and no key matches $repo (send back: lms ls --variants --json)" > "$state"; return 1
    fi
    pct="$(get_progress "$log")"; pct="${pct:-0}"
    if [ "$pct" -gt "$best" ]; then best="$pct"; stalls=0; else stalls=$((stalls + 1)); fi
    [ "$stalls" -ge 2 ] && break
    try=$((try + 1)); [ -n "$DRY" ] || sleep "$PAUSE"
  done
  if [ "$best" -gt 0 ]; then say "PARTIAL DOWNLOAD — stalled at ${best}% after $try tries (run the tier again: lms resumes)" > "$state"
  else say "NOT DOWNLOADED — $(strip < "$log" 2>/dev/null | grep -v '^\s*$' | tail -1 | cut -c1-120)" > "$state"; fi
  return 1
}

# ── the window a row ran at, judged from three witnesses: what we asked for, what the runtime says (curl), and what the
#    BATTERY's own probe printed (node fetch). cap=0 → the row ran at the engine's own window. ──────────────────────
window_verdict() { # effective cap battery_header_line → "budgeted|batteryTokens|batteryProbed|note"
  node -e "
    const eff=Number(process.argv[1])||0, cap=Number(process.argv[2])||0, line=process.argv[3]||'';
    const m=/window=(\{.*\})/.exec(line); let w={}; try{w=m?JSON.parse(m[1]):{}}catch(e){}
    const bTok=Number(w.tokens)||0, bReal=Number(w.probedTokens)||bTok;
    const budget=cap&&eff>cap?cap:eff; let note='';
    if(!m) note='NO BATTERY HEADER — the run did not start';
    else if(bReal!==eff) note='WINDOW MISMATCH — this script saw '+eff+' loaded, the battery\'s own probe saw '+bReal+' (something between them is lying)';
    else if(bTok!==budget) note='WINDOW MISMATCH — budgeted '+budget+' expected, the battery ran at '+bTok+(cap?' (is this checkout ≥ 2.49? the cap is LOCAL_LLM_WINDOW_CAP)':'');
    console.log([budget,bTok||'-',bReal||'-',note].join('|'))" "$1" "$2" "$3"
}
quant_ok() { # wanted bits ("-" = anything) · loaded quantization string → 0 when they agree
  [ "$1" = "-" ] && return 0
  local got; got="$(printf '%s' "$2" | grep -oE '[0-9]+' | head -1)"
  [ -n "$got" ] && [ "$got" = "$1" ]
}

preflight() {
  say "== preflight"
  [ -x "$LMS" ] || { say "REFUSED: no lms CLI at $LMS (set LMS=/path/to/lms)"; exit 2; }
  case "$(basename "$LMS")" in lms|lms.exe) ;; *) [ -n "${SMOKE:-}" ] || { say "REFUSED: LMS=$LMS is not the lms binary. Do not wrap, alias or shadow what this script calls — a refusal is a result: send it back."; exit 2; } ;; esac
  command -v node >/dev/null || { say "REFUSED: node is not on PATH (need ≥ 24)"; exit 2; }
  node -e "process.exit(Number(process.versions.node.split('.')[0])>=24?0:1)" || { say "REFUSED: node $(node -v) — need ≥ 24"; exit 2; }
  node -e "const v=require('./package.json').version.split('-')[0].split('.').map(Number),m='$MIN_VERSION'.split('.').map(Number);process.exit((v[0]-m[0]||v[1]-m[1]||v[2]-m[2])>=0?0:1)" \
    || { say "REFUSED: this checkout is $(node -e "console.log(require('./package.json').version)") — need ≥ $MIN_VERSION (the 32K cap lives in the CMS). git pull --ff-only origin main"; exit 2; }
  [ -d node_modules ] || [ -n "${NODE_PATH:-}" ] || { say "REFUSED: no node_modules — run: npm ci"; exit 2; }
  say "   lms:  $LMS"
  say "   curl: $(command -v curl)   node: $(command -v node)"
  if [ -n "$(git status --porcelain -- docs/INJECTION-EVAL.md docs/injection-eval.json 2>/dev/null)" ]; then say "REFUSED: docs/INJECTION-EVAL.md is modified — the eval rewrites it and this script restores it; commit or restore it first"; exit 2; fi
  if curl -s -m 2 -o /dev/null "http://127.0.0.1:${BATTERY_PORT:-3948}/"; then say "REFUSED: something answers on port ${BATTERY_PORT:-3948} — an interrupted battery left its server. Kill it: lsof -ti :${BATTERY_PORT:-3948} | xargs kill"; exit 2; fi
  run "$LMS" server start --port 1234 >/dev/null 2>&1
  [ -n "$DRY" ] || curl -s -m 5 -o /dev/null "$LLM/v1/models" || { say "REFUSED: LM Studio's server does not answer on $LLM"; exit 2; }
  local f; f="$(foreign | tr '\n' ' ')"
  if [ -n "$f" ]; then say "STOP: a model that is not mine is loaded ($f). Somebody is using this machine — ask Ben, do not unload it."; exit 3; fi
  say "   ok · $(node -e "console.log(require('./package.json').version)") · $(git rev-parse --short HEAD) · node $(node -v)"
}

# load KEY under IDENTIFIER, then say what REALLY loaded. Sets EFFECTIVE, QUANT, SIZE. → 0 loaded and usable
load() { # key identifier wanted_bits
  EFFECTIVE=""; QUANT=""; SIZE=""; LOAD_NOTE=""
  unload_mine
  local f; f="$(foreign | tr '\n' ' ')"
  if [ -n "$f" ]; then say "STOP: a model that is not mine appeared on the GPU ($f) — ask Ben."; exit 3; fi
  run "$LMS" load "$1" --gpu max --context-length "$CONFIGURED" --parallel 1 --identifier "$2" -y > "$OUT/$2.load.log" 2>&1
  [ -n "$DRY" ] && { EFFECTIVE="$CONFIGURED"; return 0; }
  EFFECTIVE="$(loaded_field "$2" loaded_context_length)"; QUANT="$(loaded_field "$2" quantization)"; SIZE="$(loaded_gib "$2")"
  if [ -z "$EFFECTIVE" ]; then LOAD_NOTE="DID NOT LOAD in stock LM Studio: $(strip < "$OUT/$2.load.log" | grep -v '^\s*$' | tail -1 | cut -c1-140)"; return 1; fi
  if [ "$EFFECTIVE" -lt "$CONFIGURED" ]; then LOAD_NOTE="LOADED TOO SMALL: asked $CONFIGURED, the runtime loaded $EFFECTIVE — not measured"; return 1; fi
  if ! quant_ok "$3" "$QUANT"; then LOAD_NOTE="WRONG WEIGHTS: the row means ${3}-bit, the runtime loaded '$QUANT' under key $1 — not measured"; return 1; fi
  say "   loaded: $QUANT · $SIZE · configured $CONFIGURED → effective $EFFECTIVE"
  return 0
}

dreams_run() { # identifier logfile runs cap(0|N) [battery flags…]
  local id="$1" log="$2" runs="$3" cap="$4"; shift 4
  if [ "$cap" -gt 0 ]; then LOCAL_LLM_WINDOW_CAP="$cap" LOCAL_LLM_BASE="$LLM/v1" LOCAL_LLM_MODEL="$id" run node scripts/battery-copilot.js "$@" --runs="$runs" > "$log" 2>&1
  else env -u LOCAL_LLM_WINDOW_CAP LOCAL_LLM_BASE="$LLM/v1" LOCAL_LLM_MODEL="$id" node scripts/battery-copilot.js "$@" --runs="$runs" > "$log" 2>&1; fi
}
row() { printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$@" >> "$TSV"; }
#         tag repo key quant size configured effective budgeted batteryTokens dreams theme page note

sanity() {
  say "== sanity: is the INSTRUMENT sound on this machine? (gemma 31B, whichever variant is selected; three scenarios, expect 3/3)"
  local repo="lmstudio-community/gemma-4-31B-it-MLX-8bit" key id="tapuz-mlx-sanity" v
  key="$(fetch_model "$repo" sanity)" || { [ -n "$DRY" ] || { say "sanity: $(cat "$OUT/sanity.fetch-state" 2>/dev/null)"; exit 4; }; }
  local lk; lk="$(loadable "${key:-gemma-4-31b}")"; lk="${lk%%|*}"   # whichever 31B variant is selected: this step checks the INSTRUMENT
  load "${lk:-gemma-4-31b}" "$id" - || { say "sanity: $LOAD_NOTE"; exit 4; }
  dreams_run "$id" "$OUT/sanity.log" 1 "$CONFIGURED" --only=T2,T4,T13
  [ -n "$DRY" ] && return 0
  local line; line="$(last_line "$OUT/sanity.log" 'BATTERY COPILOT')"; say "   $line"
  v="$(window_verdict "$EFFECTIVE" "$CONFIGURED" "$(last_line "$OUT/sanity.log" '^battery: ')")"
  [ -n "$(printf '%s' "$v" | cut -d'|' -f4)" ] && { say "INSTRUMENT BROKEN — $(printf '%s' "$v" | cut -d'|' -f4). Measure nothing; send back $OUT/sanity.log"; exit 4; }
  case "$line" in *"3/3 PASS"*) say "   the instrument is sound · budgeted $(printf '%s' "$v" | cut -d'|' -f1) of $EFFECTIVE loaded" ;; *)
    say "INSTRUMENT BROKEN OR MODEL MISLOADED — do not measure anything. Send back: $OUT/sanity.log and the newest eval/battery/*-$id-local.json"
    say "(the signature of a broken instrument: 'applied…= true' in the .json next to a failed draft check)"; exit 4 ;; esac
}

one() { # tier tag repo runs gb bits extra
  local tag="$2" repo="$3" runs="$4" bits="$6" extra="${7:-}" id="tapuz-mlx-$2" key dreams theme page v hdr FETCH_STATE lk sel
  say "== [$1] $tag  ($repo, dreams x$runs, ~$5 GB)  $(date +%T)"
  key="$(fetch_model "$repo" "$tag")"
  FETCH_STATE="$(cat "$OUT/$tag.fetch-state" 2>/dev/null)"
  if [ -z "$key" ] && [ -z "$DRY" ]; then say "   $FETCH_STATE"; row "$tag" "$repo" "-" "-" "-" "$CONFIGURED" "-" "-" "-" "-" "-" "-" "$FETCH_STATE"; return; fi
  lk="$(loadable "${key:-$tag}")"; sel="${lk#*|}"; lk="${lk%%|*}"
  if [ -n "$sel" ] && [ "$sel" != "$key" ] && [ -z "$DRY" ]; then
    LOAD_NOTE="$(other_variant_note "$key" "$sel")"; say "   $LOAD_NOTE"
    row "$tag" "$repo" "$key" "-" "-" "$CONFIGURED" "-" "-" "-" "-" "-" "-" "$LOAD_NOTE"; return
  fi
  if ! load "${lk:-$tag}" "$id" "$bits"; then say "   $LOAD_NOTE"; row "$tag" "$repo" "$key" "${QUANT:--}" "${SIZE:--}" "$CONFIGURED" "${EFFECTIVE:--}" "-" "-" "-" "-" "-" "$LOAD_NOTE"; unload_mine; return; fi
  for attempt in 1 2; do
    dreams_run "$id" "$OUT/$tag.dreams.log" "$runs" "$CONFIGURED" --track=dreams
    grep -q "Model unloaded\|Model is unloaded" "$OUT/$tag.dreams.log" 2>/dev/null || break
    if [ -n "$(foreign)" ]; then say "STOP: the model was unloaded under the run and somebody else's is loaded — ask Ben."; exit 3; fi
    say "   the engine dropped the model — reloading once"; mv "$OUT/$tag.dreams.log" "$OUT/$tag.dreams.crashed.log"; load "$lk" "$id" "$bits" || break
  done
  dreams="$(last_line "$OUT/$tag.dreams.log" 'BATTERY COPILOT' | sed 's/ → .*//')"; hdr="$(last_line "$OUT/$tag.dreams.log" '^battery: ')"
  v="$(window_verdict "$EFFECTIVE" "$CONFIGURED" "$hdr")"; [ -n "$DRY" ] && v="$CONFIGURED|-|-|(dry run — nothing was measured)"
  say "   $dreams   $(printf '%s' "$v" | cut -d'|' -f4)"
  LOCAL_LLM_WINDOW_CAP="$CONFIGURED" EVAL_BASE="$LLM/v1" LOCAL_LLM_BASE="$LLM/v1" EVAL_MODEL="$id" run node scripts/eval-injections.js theme-designer 1 --briefs=dreams > "$OUT/$tag.theme-dreams.log" 2>&1
  [ -n "$DRY" ] || cp docs/INJECTION-EVAL.md "$OUT/$tag.theme-dreams.md" 2>/dev/null
  LOCAL_LLM_WINDOW_CAP="$CONFIGURED" EVAL_BASE="$LLM/v1" LOCAL_LLM_BASE="$LLM/v1" EVAL_MODEL="$id" run node scripts/eval-injections.js site-builder-lite 1 --briefs=dreams > "$OUT/$tag.page-dreams.log" 2>&1
  [ -n "$DRY" ] || cp docs/INJECTION-EVAL.md "$OUT/$tag.page-dreams.md" 2>/dev/null
  run git checkout -q docs/INJECTION-EVAL.md docs/injection-eval.json
  theme="$(last_line "$OUT/$tag.theme-dreams.log" '^\| theme-designer \|' | awk -F'|' '{gsub(/ /,"",$5); print $5}')"
  page="$(last_line "$OUT/$tag.page-dreams.log" '^\| site-builder-lite \|' | awk -F'|' '{gsub(/ /,"",$5); print $5}')"
  say "   theme dreams PASS $theme · page dreams PASS $page"
  row "$tag" "$repo" "$key" "$QUANT" "$SIZE" "$CONFIGURED" "$EFFECTIVE" "$(printf '%s' "$v" | cut -d'|' -f1)" "$(printf '%s' "$v" | cut -d'|' -f2)" "$dreams" "$theme" "$page" "$(printf '%s' "$v" | cut -d'|' -f4)"
  if [ "$extra" = "autofit" ] && [ -z "$DRY" ] && [ "$EFFECTIVE" -gt "$CONFIGURED" ]; then
    say "   …and once at the engine's own window ($EFFECTIVE) — what a Mac owner gets today; never a 32K row"
    dreams_run "$id" "$OUT/$tag.dreams-autofit.log" 1 0 --track=dreams
    dreams="$(last_line "$OUT/$tag.dreams-autofit.log" 'BATTERY COPILOT' | sed 's/ → .*//')"; hdr="$(last_line "$OUT/$tag.dreams-autofit.log" '^battery: ')"
    v="$(window_verdict "$EFFECTIVE" 0 "$hdr")"; say "   $dreams   $(printf '%s' "$v" | cut -d'|' -f4)"
    row "$tag+autofit" "$repo" "$key" "$QUANT" "$SIZE" "$CONFIGURED" "$EFFECTIVE" "$(printf '%s' "$v" | cut -d'|' -f1)" "$(printf '%s' "$v" | cut -d'|' -f2)" "$dreams" "-" "-" "$(printf '%s' "$v" | cut -d'|' -f4)"
  fi
  unload_mine
}

scorecard() {
  local f="$OUT/SCORECARD-draft.md"
  {
    say "# SCORECARD — $STAMP — Mac MLX, dreams first"
    say ""
    say "code: \`$(git rev-parse --short HEAD)\` · package \`$(node -e "console.log(require('./package.json').version)")\` · LM Studio MLX engine · \`--parallel 1\` · live model runs · 128 GB unified memory"
    say ""
    say "Windows are per row: **configured** = what the script asked the runtime for · **effective** = what the runtime loaded (the MLX engine auto-fits to memory) · **budgeted** = what the CMS planned at (\`LOCAL_LLM_WINDOW_CAP\`) · **battery saw** = the battery's own probe. A \`+autofit\` row ran uncapped — what a Mac owner gets today; it is never a 32K row."
    say ""
    say "| model | MLX repo | loaded | configured → effective | budgeted | battery saw | copilot dreams D1–D14 | theme /5 | page /5 | note |"
    say "|---|---|---|---|---|---|---|---|---|---|"
    [ -f "$TSV" ] && card_rows "$TSV" | awk -F'\t' '{printf "| %s | `%s` | %s · %s | %s → %s | %s | %s | %s | %s | %s | %s |\n", $1, $2, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13}'
    say ""
    say "## Per model — every ✗, with the owner's sentence and what landed"
    say ""
    say "## Habits (RUN-ON-MAC.md, Send back): which survive 8 bits, which are new"
    say ""
    say "## Anything the judge got wrong — with the turn from the .json"
    say ""
    say "## What did not download or load, and what LM Studio said"
  } > "$f"
  say "== draft scorecard: $f   (raw logs and the per-turn .json files: $OUT/ and eval/battery/)"
}

[ -n "${MLX_SURVEY_LIB:-}" ] && return 0 2>/dev/null   # sourced by the smoke: functions only

mkdir -p "$OUT"
TIERS="${*:-sanity A B C}"
for t in $TIERS; do known "$t" || { say "REFUSED: \"$t\" is not a step (sanity, variants), a tier (A B C) or a tag on the list"; exit 2; }; done
if [ "$TIERS" = "variants" ]; then   # read-only: works while Ben's own model is loaded, needs only the lms CLI
  [ -x "$LMS" ] || { say "REFUSED: no lms CLI at $LMS (set LMS=/path/to/lms)"; exit 2; }
  variants_report; exit 0
fi
preflight
for t in $TIERS; do
  if [ "$t" = "sanity" ]; then sanity; unload_mine; continue; fi
  if [ "$t" = "variants" ]; then variants_report; continue; fi
  printf '%s\n' "$MODELS" | while IFS='|' read -r tier tag repo runs gb bits extra; do
    { [ "$tier" = "$t" ] || [ "$tag" = "$t" ]; } && one "$tier" "$tag" "$repo" "$runs" "$gb" "$bits" "$extra"
    true
  done
  rc=$?; [ $rc -ne 0 ] && exit $rc
done
unload_mine
scorecard
say "== done $(date +%T)"
