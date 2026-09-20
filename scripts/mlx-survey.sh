#!/usr/bin/env bash
# The MLX side of the model survey — one command for the Mac (128 GB unified memory, LM Studio, MLX engine).
#
#   bash scripts/mlx-survey.sh                 # sanity, then tiers A B C — the whole job
#   bash scripts/mlx-survey.sh sanity          # only the instrument check (3 scenarios, ~5 min)
#   bash scripts/mlx-survey.sh A               # one tier; tiers can be given in any combination
#   DRY=1 bash scripts/mlx-survey.sh           # print what would run, run nothing
#
# What it does per model: download (weights only, MLX) → load at 32K, --parallel 1, identifier tapuz-mlx-<tag>
# → verify the loaded window → the copilot DREAMS (D1–D14) → theme dreams → page dreams → unload → one TSV row.
# It never unloads a model it did not load, never touches the live site, and stops if somebody else's model is
# on the GPU. The model list is DECIDED — do not add, swap or reorder; if a row cannot run, the script records
# why and moves on. Orders and cluster rules: eval/battery/RUN-ON-MAC.md
#
# bash 3.2 compatible (macOS). Exit codes: 0 done · 2 preflight refused · 3 somebody else is on the GPU · 4 instrument broken.
set -u
cd "$(dirname "$0")/.." || exit 2

LMS="${LMS:-$HOME/.lmstudio/bin/lms}"
LLM="http://127.0.0.1:1234"
MIN_VERSION="2.48.0"
STAMP="$(date -u +%Y-%m-%d)"
OUT="eval/battery/mlx-$STAMP"
TSV="$OUT/results.tsv"
DRY="${DRY:-}"
mkdir -p "$OUT"

# tier | tag | Hugging Face repo | dreams runs | memory note (weights, GB — must stay under ~90 on a 128 GB Mac at 32K)
MODELS='
A|gemma-31b-8bit|lmstudio-community/gemma-4-31B-it-MLX-8bit|2|33
A|gemma-31b-4bit|lmstudio-community/gemma-4-31B-it-MLX-4bit|2|17
A|gemma-26b-a4b-8bit|lmstudio-community/gemma-4-26B-A4B-it-MLX-8bit|2|28
A|gemma-26b-a4b-4bit|lmstudio-community/gemma-4-26B-A4B-it-MLX-4bit|2|15
A|gemma-12b-8bit|lmstudio-community/gemma-4-12B-it-MLX-8bit|2|13
A|gemma-12b-4bit|lmstudio-community/gemma-4-12B-it-MLX-4bit|2|7
A|qwen38-27b-8bit|lmstudio-community/Qwen3.8-27B-MLX-8bit|2|29
B|qwen35-9b-8bit|lmstudio-community/Qwen3.5-9B-MLX-8bit|1|10
B|gemma-e4b-8bit|lmstudio-community/gemma-4-E4B-it-MLX-8bit|1|9
B|granite-30b-8bit|lmstudio-community/granite-4.2-30b-MLX-8bit|1|31
B|muse-glimmer-30b-8bit|mlx-community/Muse-Glimmer-30B-8bit|1|32
B|bonsai2-27b-2bit|prism-ml/Ternary-Bonsai-2-27B-mlx-2bit|1|8
C|gpt-oss-120b|lmstudio-community/gpt-oss-120b-MLX-8bit|1|65
C|mistral-small-4-119b-4bit|mlx-community/Mistral-Small-4-119B-2603-4bit|1|67
C|qwen3-coder-next-6bit|lmstudio-community/Qwen3-Coder-Next-MLX-6bit|1|65
'

say() { printf '%s\n' "$*"; }
run() { if [ -n "$DRY" ]; then say "   DRY: $*"; else "$@"; fi; }
strip() { sed 's/\x1b\[[0-9;?]*[A-Za-z]//g'; }
lms_ps() { "$LMS" ps 2>&1 | strip; }
mine() { lms_ps | awk '$1 ~ /^tapuz-mlx-/ {print $1}'; }
foreign() { [ -n "$DRY" ] && return 0; lms_ps | awk 'NR>1 && NF>2 && $1 !~ /^tapuz-mlx-/ && $1 !~ /^(IDENTIFIER|No)$/ {print $1}'; }
unload_mine() { for id in $(mine); do run "$LMS" unload "$id" >/dev/null 2>&1; done; }
key_for() { # the LM Studio model key whose path holds this repo's name
  "$LMS" ls --json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const f=process.argv[1].toLowerCase().split('/').pop();let j=[];try{j=JSON.parse(s)}catch(e){}const m=j.find(m=>m.type==='llm'&&((m.path||'').toLowerCase().includes(f)||(m.modelKey||'').toLowerCase().includes(f)));console.log(m?m.modelKey:'')})" "$1"
}
loaded_window() { # identifier → loaded_context_length (0 when not loaded)
  curl -s "$LLM/api/v0/models" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j={};try{j=JSON.parse(s)}catch(e){}const m=(j.data||[]).find(m=>m.id===process.argv[1]);console.log(m&&m.loaded_context_length||0)})" "$1"
}
last_line() { [ -f "$1" ] && strip < "$1" | grep -E "$2" | tail -1 | cut -c1-200; }

preflight() {
  say "== preflight"
  command -v node >/dev/null || { say "REFUSED: node is not on PATH (need ≥ 24)"; exit 2; }
  node -e "process.exit(Number(process.versions.node.split('.')[0])>=24?0:1)" || { say "REFUSED: node $(node -v) — need ≥ 24"; exit 2; }
  node -e "const v=require('./package.json').version.split('-')[0].split('.').map(Number),m='$MIN_VERSION'.split('.').map(Number);process.exit((v[0]-m[0]||v[1]-m[1]||v[2]-m[2])>=0?0:1)" \
    || { say "REFUSED: this checkout is $(node -e "console.log(require('./package.json').version)") — need ≥ $MIN_VERSION (v2.47's door bounced a legal attribute). git pull --ff-only origin main"; exit 2; }
  [ -d node_modules ] || [ -n "${NODE_PATH:-}" ] || { say "REFUSED: no node_modules — run: npm ci"; exit 2; }
  [ -x "$LMS" ] || { say "REFUSED: no lms CLI at $LMS (set LMS=/path/to/lms)"; exit 2; }
  if [ -n "$(git status --porcelain -- docs/INJECTION-EVAL.md docs/injection-eval.json)" ]; then say "REFUSED: docs/INJECTION-EVAL.md is modified — the eval rewrites it and this script restores it; commit or restore it first"; exit 2; fi
  if curl -s -m 2 -o /dev/null "http://127.0.0.1:${BATTERY_PORT:-3948}/"; then say "REFUSED: something answers on port ${BATTERY_PORT:-3948} — an interrupted battery left its server. Kill it: lsof -ti :${BATTERY_PORT:-3948} | xargs kill"; exit 2; fi
  run "$LMS" server start --port 1234 >/dev/null 2>&1
  [ -n "$DRY" ] || curl -s -m 5 -o /dev/null "$LLM/v1/models" || { say "REFUSED: LM Studio's server does not answer on $LLM"; exit 2; }
  local f; f="$(foreign | tr '\n' ' ')"
  if [ -n "$f" ]; then say "STOP: a model that is not mine is loaded ($f). Somebody is using this machine — ask Ben, do not unload it."; exit 3; fi
  say "   ok · $(node -e "console.log(require('./package.json').version)") · $(git rev-parse --short HEAD) · node $(node -v)"
}

load() { # key identifier → 0 when loaded at 32768
  unload_mine
  local f; f="$(foreign | tr '\n' ' ')"
  if [ -n "$f" ]; then say "STOP: a model that is not mine appeared on the GPU ($f) — ask Ben."; exit 3; fi
  run "$LMS" load "$1" --gpu max --context-length 32768 --parallel 1 --identifier "$2" -y > "$OUT/$2.load.log" 2>&1
  [ -n "$DRY" ] && return 0
  local w; w="$(loaded_window "$2")"
  [ "$w" = "32768" ] && return 0
  say "   load failed or wrong window ($w): $(strip < "$OUT/$2.load.log" | grep -v '^\s*$' | tail -1 | cut -c1-160)"
  return 1
}

sanity() {
  say "== sanity: is the INSTRUMENT sound on this machine? (gemma 31B, three scenarios, expect 3/3)"
  local repo="lmstudio-community/gemma-4-31B-it-MLX-8bit" key id="tapuz-mlx-sanity"
  key="$(key_for "$repo")"; [ -z "$key" ] && key="$(key_for "google/gemma-4-31b")"
  if [ -z "$key" ]; then run "$LMS" get "https://huggingface.co/$repo" --mlx -y > "$OUT/sanity.get.log" 2>&1; key="$(key_for "$repo")"; fi
  [ -z "$key" ] && [ -z "$DRY" ] && { say "sanity: no Gemma 4 31B on this machine and the download failed — see $OUT/sanity.get.log"; exit 4; }
  load "${key:-gemma-4-31b}" "$id" || exit 4
  LOCAL_LLM_BASE="$LLM/v1" LOCAL_LLM_MODEL="$id" run node scripts/battery-copilot.js --only=T2,T4,T13 > "$OUT/sanity.log" 2>&1
  [ -n "$DRY" ] && return 0
  local line; line="$(last_line "$OUT/sanity.log" 'BATTERY COPILOT')"
  say "   $line"
  case "$line" in *"3/3 PASS"*) say "   the instrument is sound" ;; *)
    say "INSTRUMENT BROKEN OR MODEL MISLOADED — do not measure anything. Send back: $OUT/sanity.log and the newest eval/battery/*-$id-local.json"
    say "(the signature of a broken instrument: 'applied…= true' in the .json next to a failed draft check)"; exit 4 ;; esac
}

one() { # tier tag repo runs gb
  local tag="$2" repo="$3" runs="$4" id="tapuz-mlx-$2" key dreams theme page mem
  say "== [$1] $tag  ($repo, dreams x$runs, ~$5 GB)  $(date +%T)"
  key="$(key_for "$repo")"
  if [ -z "$key" ]; then
    for try in 1 2 3; do run "$LMS" get "https://huggingface.co/$repo" --mlx -y > "$OUT/$tag.get.$try.log" 2>&1; key="$(key_for "$repo")"; [ -n "$key" ] && break; [ -n "$DRY" ] || sleep 5; done
  fi
  if [ -z "$key" ] && [ -z "$DRY" ]; then say "   DID NOT DOWNLOAD — see $OUT/$tag.get.*.log"; printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$tag" "$repo" "-" "did not download" "-" "-" "-" >> "$TSV"; return; fi
  if ! load "${key:-$tag}" "$id"; then
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$tag" "$repo" "$key" "DID NOT LOAD in stock LM Studio: $(strip < "$OUT/$id.load.log" | grep -v '^\s*$' | tail -1 | cut -c1-120)" "-" "-" "-" >> "$TSV"; unload_mine; return
  fi
  mem="$(lms_ps | awk -v id="$id" '$1==id {print $4, $5}')"
  for attempt in 1 2; do
    LOCAL_LLM_BASE="$LLM/v1" LOCAL_LLM_MODEL="$id" run node scripts/battery-copilot.js --track=dreams --runs="$runs" > "$OUT/$tag.dreams.log" 2>&1
    grep -q "Model unloaded\|Model is unloaded" "$OUT/$tag.dreams.log" 2>/dev/null || break
    if [ -n "$(foreign)" ]; then say "STOP: the model was unloaded under the run and somebody else's is loaded — ask Ben."; exit 3; fi
    say "   the engine dropped the model — reloading once"; mv "$OUT/$tag.dreams.log" "$OUT/$tag.dreams.crashed.log"; load "$key" "$id" || break
  done
  dreams="$(last_line "$OUT/$tag.dreams.log" 'BATTERY COPILOT' | sed 's/ → .*//')"; say "   $dreams"
  EVAL_BASE="$LLM/v1" LOCAL_LLM_BASE="$LLM/v1" EVAL_MODEL="$id" run node scripts/eval-injections.js theme-designer 1 --briefs=dreams > "$OUT/$tag.theme-dreams.log" 2>&1
  [ -n "$DRY" ] || cp docs/INJECTION-EVAL.md "$OUT/$tag.theme-dreams.md" 2>/dev/null
  EVAL_BASE="$LLM/v1" LOCAL_LLM_BASE="$LLM/v1" EVAL_MODEL="$id" run node scripts/eval-injections.js site-builder-lite 1 --briefs=dreams > "$OUT/$tag.page-dreams.log" 2>&1
  [ -n "$DRY" ] || cp docs/INJECTION-EVAL.md "$OUT/$tag.page-dreams.md" 2>/dev/null
  run git checkout -q docs/INJECTION-EVAL.md docs/injection-eval.json
  theme="$(last_line "$OUT/$tag.theme-dreams.log" '^\| theme-designer \|' | awk -F'|' '{gsub(/ /,"",$5); print $5}')"
  page="$(last_line "$OUT/$tag.page-dreams.log" '^\| site-builder-lite \|' | awk -F'|' '{gsub(/ /,"",$5); print $5}')"
  say "   theme dreams PASS $theme · page dreams PASS $page"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$tag" "$repo" "$key" "$mem" "$dreams" "$theme" "$page" >> "$TSV"
  unload_mine
}

scorecard() {
  local f="$OUT/SCORECARD-draft.md"
  {
    say "# SCORECARD — $STAMP — Mac MLX, dreams first"
    say ""
    say "code: \`$(git rev-parse --short HEAD)\` · package \`$(node -e "console.log(require('./package.json').version)")\` · LM Studio MLX engine · 32768 ctx · \`--parallel 1\` · live model runs · 128 GB unified memory"
    say ""
    say "| model | MLX repo | size in memory | copilot dreams D1–D14 | theme dreams /5 | page dreams /5 |"
    say "|---|---|---|---|---|---|"
    [ -f "$TSV" ] && awk -F'\t' '{printf "| %s | `%s` | %s | %s | %s | %s |\n", $1, $2, $4, $5, $6, $7}' "$TSV"
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

TIERS="${*:-sanity A B C}"
preflight
for t in $TIERS; do
  if [ "$t" = "sanity" ]; then sanity; unload_mine; continue; fi
  printf '%s\n' "$MODELS" | while IFS='|' read -r tier tag repo runs gb; do
    [ "$tier" = "$t" ] && one "$tier" "$tag" "$repo" "$runs" "$gb"
    true
  done
  rc=$?; [ $rc -ne 0 ] && exit $rc
done
unload_mine
scorecard
say "== done $(date +%T)"
