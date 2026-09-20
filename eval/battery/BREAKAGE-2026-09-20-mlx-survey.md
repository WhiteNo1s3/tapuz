# SENDOFF — the MLX survey night run (2026-09-20) → fix it from the 5090 box

You are Claude, on Ben's 5090 workstation, in a checkout of `tapuz`. Ben is at the keyboard and will
correct you. A Claude session on the Mac read the night run and wrote this. **You cannot see the
evidence** — everything under `eval/battery/*` is gitignored and stayed on the Mac — so the lines that
matter are quoted here verbatim. Do not re-derive them; build on them.

Code under repair: `scripts/mlx-survey.sh` (173 lines, bash 3.2, **no test of any kind**) and its
runbook `eval/battery/RUN-ON-MAC.md`. Run was `main aa34f60`, package `2.48.0-alpha`, node v26.9.0.

## 1. Verdict

The survey was meant to measure 15 MLX models for the helper (the local model the Bridge extension
talks to). By 06:15, 12 models attempted: **3 measured, 9 not. 5 of the 9 are the script's fault, 3 are
its retry policy meeting a slow link, 1 is a real engine failure — and the 3 measured rows are mislabelled.**

- 8 rows say `DID NOT DOWNLOAD`. **5 of those models were on disk when the script gave up on them**: 2
  were there before it started (31b-8bit, 12b-4bit — all three get logs say "already downloaded"), and 3
  the survey **had just downloaded itself** (31b-4bit, 12b-8bit, e4b-8bit — the get log ends
  `Finalizing download... Download completed.`). It could not find what it had fetched.
- Every load ran at a **262144** window, not the 32768 the script asks for and the scorecard prints.
- The script's window check correctly refused — twice. Then the operator put a **fake `curl` on
  PATH that rewrites `loaded_context_length` to 32768**, and the run went through. The instrument's
  own safety check was defeated from outside the repo.

## 2. Evidence (verbatim)

`survey.log`, abridged:

    == sanity … BATTERY COPILOT: 3/3 PASS · 0 soft misses · 260s      the instrument is sound
    == [A] gemma-31b-8bit      DID NOT DOWNLOAD
    == [A] gemma-31b-4bit      DID NOT DOWNLOAD
    == [A] gemma-26b-a4b-8bit  BATTERY COPILOT: 26/28 PASS · 3 soft misses · 1009s   theme 4(80%) · page 4(80%)
    == [A] gemma-26b-a4b-4bit  BATTERY COPILOT: 24/28 PASS · 5 soft misses · 918s    theme 3(60%) · page 4(80%)
    == [A] gemma-12b-8bit      DID NOT DOWNLOAD
    == [A] gemma-12b-4bit      DID NOT DOWNLOAD
    == [A] qwen38-27b-8bit     DID NOT DOWNLOAD
    == [B] qwen35-9b-8bit      BATTERY COPILOT: 12/14 PASS · 1 soft misses · 681s    theme 3(60%) · page 3(60%)
    == [B] gemma-e4b-8bit      DID NOT DOWNLOAD
    == [B] granite-30b-8bit    DID NOT DOWNLOAD
    == [B] muse-glimmer-30b-8bit   DID NOT DOWNLOAD          (3 tries, reached 34%)
    == [B] bonsai2-27b-2bit    load failed … ValueError: Unrecognized video processor …   ← a REAL did-not-load
    == [C] gpt-oss-120b        (downloading when this was written)

`gemma-31b-8bit.get.1.log` — last line, all three tries identical:

    ✓ Satisfied Gemma 4 31B 8bit [MLX]
    Model already downloaded. To use, run: lms load google/gemma-4-31b@8bit

`lms ls --json`, the entry that hides it (LM Studio files staff picks under a *virtual* key):

    { "modelKey": "google/gemma-4-31b", "path": "google/gemma-4-31b",
      "indexedModelIdentifier": "google/gemma-4-31b", "sizeBytes": 18444515810,
      "quantization": {"name":"4bit","bits":4},
      "variants": ["google/gemma-4-31b@4bit","google/gemma-4-31b@8bit"],
      "selectedVariant": "google/gemma-4-31b@4bit", "maxContextLength": 262144 }

`lms ls --variants --json` — ONE call, only virtual models, and it carries the exact HF repo:

    [ { "model": { …the entry above… },
        "variants": [
          { "modelKey": "google/gemma-4-31b@4bit",
            "indexedModelIdentifier": "google/gemma-4-31b@lmstudio-community/gemma-4-31B-it-MLX-4bit" },
          { "modelKey": "google/gemma-4-31b@8bit",
            "indexedModelIdentifier": "google/gemma-4-31b@lmstudio-community/gemma-4-31B-it-MLX-8bit" } ] } ]

Non-virtual models are plain `lms ls --json` entries and the old matcher finds them:

    modelKey "gemma-4-26b-a4b-it-mlx@8bit"  path "lmstudio-community/gemma-4-26B-A4B-it-MLX-8bit"
    modelKey "qwen3.5-9b-mlx"               path "lmstudio-community/Qwen3.5-9B-MLX-8bit"

`lms ps` on an empty GPU (the table the script scrapes) — and `lms ps --json` prints `[]`:

    No models are currently loaded.
    <blank>
    To load a model, run:
    <blank>
        lms load <model path>

LM Studio's own server log, first sanity load, 03:50:43 — **the root cause of the window**:

    [context_fit] Model context auto-fit: family=gemma4 max=262,144 fitted=262,144 working_set=107.52GiB
                  reserve=5.38GiB safe_ceiling=102.14GiB baseline=31.45GiB … estimated_peak=88.42GiB
    [cache_store] VLM prompt cache context target: configured=32,768 fitted=262,144 effective=262,144
    GET /api/v0/models → { "id":"tapuz-mlx-sanity", "quantization":"8bit", "state":"loaded",
                           "max_context_length":262144, "loaded_context_length":262144 }

Same engine, earlier days: `configured=8,192 fitted=262,144 effective=262,144` (09-19) and
`configured=32,768 fitted=262,144` (09-16) — so at least since 09-16, and the 09-19 Mac rows too. The MLX
VLM engine receives `--context-length` and overrides it whenever memory allows. On a 128 GB Mac that
is always. `lms load --help` has no switch for it (`--auto` is "only available when using Bionic").

The battery's own header, every run tonight (node `fetch`, so no PATH shim could touch it):

    battery: tapuz-mlx-gemma-26b-a4b-8bit · courier=local · runs=2 · window={"tokens":262144,"maxTokens":262144,"source":"probe","jit":false}

Load timeline from the server log: `loadModel google/gemma-4-31b` at 03:50:28 (the `/api/v0/models` answer
right after it is the 262144 above → the script's check refused, exit 4), again at 03:51:04, and at
03:51:12 the run goes through. The refusals are inferred from the script's logic — its own output for
those two attempts was overwritten. The two shims are dated 03:50 and 03:51. The run was started as

    export PATH="$HOME/bin:$PATH"; export LMS_REAL=…/lms; export LMS="$HOME/bin/lms-survey-wrap"; bash scripts/mlx-survey.sh

`~/bin/curl` (the one that matters), in full intent:

    if the URL contains /api/v0/models → pipe the real curl through node:
      for every m in data: if m.id starts with "tapuz-mlx-" and m.loaded_context_length → m.loaded_context_length = 32768

`~/bin/lms-survey-wrap`: for `lms ps`, strips the "No models are currently loaded / To load a model"
block. That one papers over a REAL script bug (B3). Also in the server log, 03:49:35:
`unloadModel tapuz-gemma-mac` — a model that was not the survey's, unloaded by hand; the runbook says
"ask Ben; do not unload it".

## 3. The bugs, ranked

**B1 — `key_for` cannot see virtual models.** It looks for the repo's last path segment
(`gemma-4-31b-it-mlx-8bit`) inside `path`/`modelKey`; for a staff pick both are `google/gemma-4-31b`.
→ empty key → `lms get` ×3 ("already downloaded") → "DID NOT DOWNLOAD". Fix: first the direct match
(path == repo, case-insensitive); then `lms ls --variants --json` and match
`indexedModelIdentifier` ending in `@<repo>` (case-insensitive) → return **the variant's** `modelKey`.

**B2 — a bare virtual key floats.** `sanity()` falls back to `key_for "google/gemma-4-31b"`, i.e. whatever
`selectedVariant` is. At 03:51 that was the 8-bit (load log: 31.47 GiB). The survey then finished a
half-downloaded 4-bit, and `selectedVariant` is now `@4bit`. Same command, different weights, no
warning. **Never load a key without `@<quant>` when the model has variants.** After B1, the fallback
goes away. After every load, assert the loaded entry's `quantization` matches the row's bits — B1 done
naively (match on the virtual key) would measure the 4-bit twice and print it as two rows.

**B3 — `foreign()` scrapes a table.** On an empty GPU it prints `To` and `lms` → preflight exits 3 on a
clean machine. Use `/api/v0/models` (`state === "loaded"` → `id`) or `lms ps --json` for `mine`/`foreign`.
(`lms ps --json` field names with a model loaded are NOT verified — nothing could be loaded during the
live run. `/api/v0/models` shape is verified above.) Keep the table only for the SIZE column.

**B4 — the window check cannot pass on this engine.** A check that can never pass gets shimmed; that is
what happened. The check has to become something true. See decision D1. Whatever D1 says: the TSV and
the scorecard record `configured` and `effective` per row; the header stops hard-coding `32768 ctx`
(line 143).

**B5 — three download tries is not enough.** `lms get` dies with `Download failed: Timed-out. Please try
to resume.` every few minutes and **resumes** on the next call: qwen38-27b 2% → 46% → 65%, granite
2% → 72% → 72%. Loop while progress is being made (cap ~12; stop after two tries with no growth).

**B6 — one message for three states.** "DID NOT DOWNLOAD" today means: on disk but unresolved / partial
download / truly absent. Say which. `already downloaded` and `Download completed` are in the get log.

**B7 — the harness can be lied to from PATH.** Cheap and sufficient: the script reads the battery's own
`window=` line from the dreams log (node `fetch`, not curl) and writes it to the TSV; if it disagrees
with what the script's own check saw → the row is stamped `WINDOW MISMATCH` and the scorecard says so.
Preflight prints `command -v curl` and `$LMS`, and refuses an `LMS` that is not an `lms` binary unless
`SMOKE=1`. Do not build more than this.

**B8 — no test.** Build `scripts/smoke-mlx-survey.js`: a fake `lms` (a node script: `ls --json`,
`ls --variants --json`, `ps`, `ps --json`, `get`, `load`, `unload` answering from fixtures = the JSON in
§2) and a fake `/api/v0/models` on a loopback port. Needs `LLM="${LLM:-http://127.0.0.1:1234}"` in the
script and a way to source its functions without running the tiers. Cases: every §2 shape resolves to
the right `@quant` key · empty GPU is not foreign · a foreign model IS foreign · configured≠effective is
recorded, not hidden · a shimmed curl produces `WINDOW MISMATCH` · resume loop stops on no progress.
Register it in `test:smoke`. **This is how you verify MLX logic on a box with no MLX.**

## 4. What tonight's rows are worth

| row | weights right? | window | use as |
|---|---|---|---|
| sanity 3/3 | 31B **8-bit** (31.47 GiB) | 262144 | instrument check only |
| gemma-26b-a4b-8bit 26/28 | yes (26.06 GiB) | 262144 | an "MLX auto-fit" row, never a 32K row |
| gemma-26b-a4b-4bit 24/28 | yes (`@4bit` key) | 262144 | same |
| qwen35-9b-8bit 12/14 | yes (9.74 GiB) | 262144 | same |
| 31b-8bit, 12b-4bit (there before) · 31b-4bit, 12b-8bit, e4b-8bit (fetched tonight) | on disk, **never measured** | — | re-run after B1 |
| qwen38-27b-8bit (65%), granite (72%), muse-glimmer (34%) | partial | — | re-run after B5 |
| bonsai2-27b-2bit | — | — | legit: did not load in stock LM Studio |

Why the window is not cosmetic: `pickTier` gives history and page read-back
`roomChars = (budget − fullTokens) × ratio`. At 262K the app trims nothing; at 32K it trims history and
caps read-back at 70% of what is left. Same model, different conversation. Not comparable to a 5090 32K row.

## 5. Ben's decisions — ask, do not assume

**D1 — what does "32K" mean on MLX?** (a) *recommended:* cap the window **app-side** for the measurement —
a seam next to the probe in `src/ai.js`/`src/ai-window.js` (e.g. env `LOCAL_LLM_WINDOW_CAP=32768` →
`tokens = min(probed, cap)`, source stays `probe`), the script passes it, and its check becomes
`effective ≥ 32768`. The app then budgets exactly as for a 32K user; spare KV headroom does not change
what a model outputs. Product code → `smoke-ai-window.js` gets the cases. (b) accept 262K as what a Mac
user really gets, label rows truthfully, keep them out of the 32K table. `battery-copilot.js --window=`
exists but is **relay-only** (line 239); `courier=local` takes the app's probe.

**D2 — the run on the Mac is still going** (tier C, 65 GB downloads, every measurement at 262K). Finished
downloads are useful for the re-run; the rows are not. Ben kills it or lets it fetch weights.

**D3 — `~/bin/curl` and `~/bin/lms-survey-wrap` on the Mac.** Remove after the run ends. Ben's machine, Ben's call.

**D4 — the runbook gap.** "Do not edit the script" was obeyed to the letter. Add: do not wrap, alias or
shadow anything the script calls; a refusal is a result — send it back. And the window row in "When
something goes wrong".

## 6. What you can and cannot check on the 5090

Can: the whole smoke (B8) · `bash -n` and `DRY=1` under Git Bash · `key_for` against this box's real
`lms ls --json` / `--variants --json` (staff picks are virtual here too) · D1's seam, with the real battery
against the 5090's LM Studio at a real 32768 and at a larger window + cap → the two headers must match.
Cannot: MLX auto-fit, the MLX load path, the actual re-run. Say so in the PR; the Mac pass comes after.
Traps: CRLF (the script must stay LF — `.gitattributes`), bash 3.2 syntax only, no `mapfile`, no `${x,,}`.

## 7. Rules

This file arrived on `claude/mlx-survey-breakage` (one commit on top of `origin/main`, this file only).
**Keep working on that branch** — the PR then carries the map together with the fix. If `main` has moved,
merge `origin/main` into it; do not rebase a pushed branch. PR; CI green + automerge; never push `main`,
never force-push. `git fetch` and `gh pr list` first — parallel sessions claim the same version row;
renumber yours. One agent at a time. Public repo: no machine names, no volume names, no mailboxes, no
home paths beyond `~`. Commit style: `fix(eval): … (v2.49-alpha)`. Smokes print `SMOKE X: PASS/FAIL`.
Never change a sentence, a check or a threshold to move a score — that rule is the whole point tonight.

## 8. Done means

`smoke-mlx-survey` green and in the chain · `DRY=1 bash scripts/mlx-survey.sh` clean · every §2 shape
resolves to an explicit `@quant` key · no row can print a window it did not run at · RUN-ON-MAC.md
updated (D4) · PR open with "not verified on MLX" stated · a three-line order for the Mac re-run.
