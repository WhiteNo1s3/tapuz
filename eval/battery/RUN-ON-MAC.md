# Copilot battery — run it on the Mac (the official instrument)

The instrument for "did the FIXED v2.44 copilot do the right thing?" is
`scripts/battery-copilot.js` (`npm run battery:copilot`, docs/LOCAL-LLM.md §3א):
thirteen owner sentences in Hebrew, POSTed through `/admin/api/ai/chat` with the
page's own envelopes, judged from the **pages and menus tables** — never from
the model's words. A Direct `chat/completions` harness against LM Studio with no
system briefing measures nothing about the product (§1ב: a naked call is
`FAIL_INVENT` by design and stays so — the briefing *is* the product).

A Cursor Cloud Agent VM cannot run it: its `127.0.0.1:1234` is not this Mac's
LM Studio, and the `local` provider is loopback-only (`src/providers.js`). So
this file is the run, ready to paste, for the machine that has the model.

## 0. Rules

- **Never `lms unload --all`.** With LM Link on it unloads the model on every
  linked device, including the 5090 someone is chatting with (§5, "Two
  machines, one LM Studio"). Unload by identifier only: `lms unload tapuz-gemma`.
- **One GPU job at a time** (§1ד). No `eval-injections`, no second admin tab,
  no worker while the battery runs — with `--parallel 1` a neighbour queues
  instead of killing both, but it still slows the clock.
- **32K context, `--parallel 1`** (§1, §1א, §1ד).
- Node ≥ 24 (`package.json` engines). The battery spawns its own scratch CMS on
  `BATTERY_PORT` (default 3948) under a temp root and deletes it afterwards —
  it never touches this checkout's `config/`, `db/` or the live site.

## 1. Load the model

```bash
LMS="$HOME/.lmstudio/bin/lms"
"$LMS" server start --port 1234
"$LMS" load google/gemma-4-31b --gpu max --context-length 32768 --parallel 1 --identifier tapuz-gemma -y
"$LMS" ps
curl -s http://127.0.0.1:1234/api/v0/models | grep -o '"loaded_context_length":[0-9]*'   # expect 32768
```

The Mac's copy is the MLX build under `~/.lmstudio/hub/models/google/gemma-4-31b`
(more bits than the 5090's Q4_K_M GGUF, §5) — a different build of the same
model, so a score here is a new row, not a re-measurement of the 5090 row.

## 2. Run the battery (latest `main`)

```bash
cd /path/to/your/tapuz-checkout && git fetch origin main && git checkout main && git pull --ff-only origin main
git rev-parse --short HEAD && node -e "console.log(require('./package.json').version)"   # note both for the scorecard
npm ci

# the official run — server-side courier, one full pass of T1..T13
LOCAL_LLM_BASE=http://127.0.0.1:1234/v1 LOCAL_LLM_MODEL=tapuz-gemma \
  npm run battery:copilot -- --courier=local --runs=1

# the hosted path (the battery plays Bridge V2, no extension needed)
LOCAL_LLM_BASE=http://127.0.0.1:1234/v1 LOCAL_LLM_MODEL=tapuz-gemma \
  npm run battery:copilot -- --courier=relay --runs=1

# optional, to reproduce docs/LOCAL-LLM.md §5 exactly: ×3 local, and the 8K rung
LOCAL_LLM_BASE=http://127.0.0.1:1234/v1 LOCAL_LLM_MODEL=tapuz-gemma npm run battery:copilot -- --courier=local --runs=3
LOCAL_LLM_BASE=http://127.0.0.1:1234/v1 LOCAL_LLM_MODEL=tapuz-gemma npm run battery:copilot -- --courier=relay --window=8192
```

Use `--only=T3,T9` to re-run a single scenario. `LOCAL_LLM_MODEL` may also be
the runtime id (`google/gemma-4-31b`); the artifact name sanitises it.

**`LOCAL_LLM_MODEL` empty = whatever is loaded.** A name that does not match a
loaded identifier makes LM Studio JIT-load another copy at its default window
(§1א) or answer with an error — which the CMS reports as `PROVIDER_ERROR`. If
the model was loaded under a different identifier than `tapuz-gemma`, leave
the variable out: the `local` provider then sends the placeholder
`local-model` and LM Studio answers with the loaded model. The artifact is
then named `<stamp>-model-local.json/.md` (2026-09-19 Mac run):

```bash
LOCAL_LLM_BASE=http://127.0.0.1:1234/v1 npm run battery:copilot -- --courier=local --runs=1
```

The `local` courier goes through the CMS's loopback rule, so `LOCAL_LLM_BASE`
must be `127.0.0.1` / `localhost`. The `relay` courier calls the runtime from
the battery process itself, so from a *second* machine on the LAN
`LOCAL_LLM_BASE=http://<mac-ip>:1234/v1 … --courier=relay` also works.

## 3. What comes out

Console: one line per scenario —

```
battery: tapuz-gemma · courier=local · runs=1 · window={"tokens":32768,"source":"probe",...}
PASS T1#1 9s · no tools — a hello is answered in Hebrew and writes nothing
PASS T2#1 12s · list_pages — a question about the site is answered from a READ, not from a guess
…
BATTERY COPILOT: 13/13 PASS · 0 soft misses · 250s → eval/battery/<stamp>-tapuz-gemma-local.json
```

`✗` lines are hard misses (the scenario FAILS), `~` lines soft misses (wording
only), `·` notes, `!` transport/route errors. Exit code 0 = every scenario
passed, 1 = at least one FAIL, 2 = the harness itself crashed.

Artifacts (git-ignored, keep them beside this file):

| file | what |
|---|---|
| `eval/battery/<stamp>-tapuz-gemma-local.json` | every turn: what was sent, the card, the reply, `used[]`, `reads[]`, notices, the window, seconds, tokens; `passed/total/softMisses` at the top |
| `eval/battery/<stamp>-tapuz-gemma-local.md` | the 13-row table the scorecard is built from |
| `…-tapuz-gemma-relay.json/.md` | same, hosted path |
| `…-relay-8192.json/.md` | the 8K rung (`--window=8192`) |

`<stamp>` is `YYYY-MM-DDTHH-MM-SS` UTC.

## 4. What to expect (docs/LOCAL-LLM.md §5, v2.44 code, 5090 GGUF Q4_K_M)

| courier / window | expected |
|---|---|
| local, 32K | 13/13 per run (39/39 over ×3, 1 soft miss total), ≈ 250 s per run |
| relay, 32K | 13/13, ≈ 270 s |
| local or relay, 8K (`--window=8192` on relay) | 13/13 — T9–T12 pass in the **lean** mode (`menuTools:false`, the menu byte-identical, the reply points at Context Length → 32768) |

Anything below 13/13 at 32K on Gemma 4 31B is a regression against §5 or a
build difference (MLX vs GGUF) — read the `✗` line and the turn in the `.json`
before deciding which. The habits §5 names for other models (printing the
document instead of calling `create_page`, `PZN_READY` as a reply, dropping
pages from a menu) show up as `~ it CALLED create_page …`, `✗ approve →
applied.created`, or the `lost` preflight note.

## 5. Then

Copy the `.md` table into a `SCORECARD-<date>-<who>.md` beside this file (that
pattern is tracked; the raw artifacts are not), with the git SHA and package
version from step 2 and whether the numbers are **live model runs** or
**harness-only**.
