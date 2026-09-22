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

## 9. What was done about it (v2.49, from the 5090 box)

D1 → Ben chose **(a) plus one uncapped row per recommended model**.

| | fix | pinned by |
|---|---|---|
| D1/B4 | `LOCAL_LLM_WINDOW_CAP` in `src/ai-window.js`, next to the probe: `tokens = min(probed, cap)`, source stays `probe`, never raises, < 8,192 ignored; `probedTokens` + `cap` ride on `/admin/api/ai/window` and on every turn. The script's check is `effective ≥ 32768`; rows record configured → effective → budgeted → what the battery saw; the scorecard header no longer hard-codes a window | `smoke-ai-window` (a capped 262K plans exactly like a real 32K) · the real runtime on the 5090: a 64K load + cap → `{"tokens":32768,…,"probedTokens":65536,"cap":32768}` |
| B1 | `resolve_key`: variants first (`indexedModelIdentifier` ends `@<repo>` or contains `@<repo>/`), then a plain entry whose `path` is the repo (or `<repo>/<file>`); never the virtual key | `smoke-mlx-survey` with §2's JSON · this box's real `lms ls --variants --json` |
| B2 | the key always carries `@<quant>`; after every load the runtime's `quantization` must match the bits the row means → else `WRONG WEIGHTS`, not measured. The sanity fallback to a bare key is gone | `smoke-mlx-survey` |
| B3 | `mine` / `foreign` from `/api/v0/models` (`state === "loaded"`, embeddings ignored); `lms ps --json` only for the size (`identifier`, `sizeBytes` — verified here with a model loaded) | `smoke-mlx-survey` (the empty table from §2) |
| B5/B6 | up to 12 tries while the percentage grows, stop after two with no growth; three sentences: `ON DISK BUT UNRESOLVED` · `PARTIAL DOWNLOAD — stalled at N%` · `NOT DOWNLOADED — <lms's words>` | `smoke-mlx-survey` (2 → 46 → 65 → done; 72 → 72 → 72) |
| B7 | the battery's own `window=` line is read from the dreams log; `WINDOW MISMATCH` when it disagrees with the script's view or with the budget; preflight prints which `lms` / `curl` / `node` and refuses an `LMS` that is not the binary (unless `SMOKE=1`) | `smoke-mlx-survey` (the shimmed-curl case) |
| B8 | `scripts/smoke-mlx-survey.js`, in `test:smoke`. Its first run caught a bug in the rewrite: an empty foreign list came back as one space and would have stopped every load | — |
| D4 | `RUN-ON-MAC.md`: do not wrap, alias or shadow anything the script calls; a refusal is a result; rule 10; the window paragraph; a row for every new message | — |

**Not verified on MLX** (cannot be, from here): the auto-fit itself, the MLX load path, `lms get --mlx` resuming, the
`quantization` string of `gpt-oss-120b-MLX-8bit` and of the Bonsai build (those two rows assert nothing: bits `-`).
D2 and D3 are Ben's, on the Mac: the downloads of the night are useful, its rows are not; `~/bin/curl` and
`~/bin/lms-survey-wrap` go before the re-run — the new preflight refuses the wrapper anyway.

**The re-run, in three lines:**

```bash
rm -f ~/bin/curl ~/bin/lms-survey-wrap; unset LMS LMS_REAL; hash -r         # nothing between the script and what it calls
git pull --ff-only origin main && npm ci                                    # ≥ 2.49.0
bash scripts/mlx-survey.sh                                                  # sanity → A → B → C; what is on disk is found, what is partial resumes
```

## 10. One more thing the first fix got wrong (v2.50)

§3 B1/B2 said: resolve the variant's key and **load it with its `@quant`**. The name is right and LM Studio cannot load it. Measured on the 5090 box on a real two-variant staff pick (`google/gemma-4-e2b` with `@q4_k_m` and `@q8_0` on disk): `lms load google/gemma-4-e2b@q8_0` → "Model not found"; `POST /api/v1/models/load {"model":"google/gemma-4-e2b@q8_0"}` → `model_not_found`; the bare key loads the *selected* variant; `lms get google/gemma-4-e2b@q8_0` downloads it and leaves the selection where it was. The Mac's own card had met this ("the LM Studio CLI refused hub `@4bit`/`@8bit` keys") before the map was written.

So `mlx-survey.sh` (≥ 2.50): `resolve_key` still IDENTIFIES the variant; `loadable` returns the bare key and LM Studio's `selectedVariant`; when the row's variant is not the selected one the row says **THE OTHER VARIANT IS SELECTED** — before anything is loaded — and names the click (My Models → the model → the variant). The `quantization` check after the load stays as the second guard. Pinned in `smoke-mlx-survey`.

The re-run, corrected:

```bash
rm -f ~/bin/curl ~/bin/lms-survey-wrap; unset LMS LMS_REAL; hash -r
git pull --ff-only origin main && npm ci                                    # ≥ 2.50.0
bash scripts/mlx-survey.sh            # rows that say THE OTHER VARIANT IS SELECTED: one click each in the app, then that tier again
```

## 11. What §3 B5 got wrong — a timed-out `lms get` does not stop the download (verified on MLX)

Written on the Mac, 2026-09-20 19:53, by the session that wrote §1–8. §9 lists "`lms get --mlx` resuming" under
*not verified on MLX*. It is verified now, and the mechanism is not the one §3 B5 — or the comment above
`fetch_model` — describes.

**`Download failed: Timed-out. Please try to resume.` kills only the CLI. LM Studio's daemon keeps downloading.**
The next `lms get` does not resume anything; it re-attaches to a download that never stopped.

    granite-30b-8bit   the night script's last client died 06:00 at   72.32% | 22.50 GB
                       — no client attached for 44 minutes —
                       the next client's FIRST reading, 06:44:         94.37% | 29.36 GB     (+6.9 GB, nobody watching)
                       that client died 06:47 at 95.17%  →  complete on disk 06:49, nobody attached
    qwen38-27b-8bit    written off by the script at 05:28, 65%  →  by 06:44: a 28 GB folder, no partial files,
                       `qwen/qwen3.8-27b@8bit` 29.53 GB in the variants index, `lms get` → "already downloaded"
    muse-glimmer-30b   written off at 06:12, 34%                →  complete 06:50 (33.4 GB), nobody attached
    gpt-oss-120b       its client was killed with the night run, 06:42  →  complete 07:31, nobody attached
    right after that kill: ~6 MB/s still arriving at the `LM Studio` process, no `lms` client alive

Every download the night script wrote off as `DID NOT DOWNLOAD` finished by itself. Checked at 19:53 the same day,
no reboot in between: all of them in the index, no partial file in any folder. So the 2% → 46% → 65% across the
night's "three tries" was the daemon's progress, not the retries'. (D2, for the record: Ben had the night run
killed at 06:42 — that is the `EXIT:143` at the end of its log. It was mid-download; nothing was half-measured.)

`fetch_model` as merged (v2.49/2.50) works — for a reason other than the one in its comment. Three things are left:

1. **Giving up cancels nothing.** After `PARTIAL DOWNLOAD — stalled at N%` the script moves on and measures the
   next model while the abandoned download runs underneath it. On the night: qwen38 written off at 05:28,
   qwen35-9b measured 05:28–05:49 — a 30 GB download was very likely running under that battery (inferred from
   the above, not observed). That touches the seconds column, not the PASS counts. Before `load`, nothing may be
   in flight: one more `lms get` on every repo this run gave up on must return at once — else wait, or stamp the
   row `MEASURED UNDER A DOWNLOAD`. Killing `lms get` stops nothing either; only the app's Downloads panel does,
   and `lms` has no subcommand for it.
2. **The stall test reads whole percents** (`get_progress` ends in `cut -d. -f1`). 1% of `gpt-oss-120b` is
   1.24 GB; at the 2–6 MB/s measured that night that is 3.5–10 minutes, and the CLI timed out every 1–8. Two
   timeouts inside one percent reads as `stalled` while the download is healthy. Compare the GB figure — it is on
   the same line, `95.17% | 29.61 GB / 31.11 GB` — or keep the decimals. Derived from the code and the night's
   rates; not observed.
3. **The comment is wrong** ("RESUMES on the next call"). Harmless today; the next reader will design from it.

Smaller things from the same look:

- **`gpt-oss-120b-MLX-8bit` is 124.2 GB on disk; the table says 65** (`C|gpt-oss-120b|…|1|65|-|`). That is the
  scorecard's `DID NOT LOAD (resources)`: over the script's own "~90 GB" rule, and over the engine's safe ceiling
  that night (102 GiB). Not a guardrail to tune — the row cannot run on this Mac. Ben: drop it, or the table meant
  another build.
- **"Is it on disk?" cannot be read from plain `lms ls --json`** for a staff pick: the entry shows the *selected*
  variant only. The session that wrote this looked there, saw `qwen/qwen3.8-27b · 16 GB · 4bit`, and nearly
  reported a complete 29.5 GB 8-bit as missing. Ask `--variants --json`, or look at the folder.
- **Never parse the `To use, run: lms load <key>` hint** that `lms get` prints. Twice it named a key the index does
  not hold (`qwen3.8-27b-mlx@8bit` for `qwen/qwen3.8-27b@8bit`; `gemma-4-31b-it-mlx@4bit` for
  `google/gemma-4-31b@4bit`) — and per §10 the index's own `@quant` keys do not load either.
- A lead, **not verified**: the Mac's server log shows a REST pair — `POST /api/v1/models/download` and
  `GET /api/v1/models/download/status:job_id` (08:53, somebody's client, not this session's). A job id with a
  status is a better thing to poll than a spinner log. Try it on the 5090's LM Studio before building on it; a POST
  starts a real download.

**D3 and D4, as they went** *(written 2026-09-22 on the Mac — Ben's order: remove the shims again, and say so here)*

D3 happened three times in one day. Local times.

    06:45  first removal — `~/bin/curl` (655 B) and `~/bin/lms-survey-wrap` (414 B) moved out of PATH, kept read-only
           next to the night's run logs on the Mac; `~/bin`, born 03:50 for them, removed.
    06:48  `~/bin` reborn: a new `curl` (627 B, the same rewrite of `loaded_context_length` to 32768 for `tapuz-mlx-*`).
    06:57  a new `lms-survey-wrap` (5.5 KB) — no longer a filter. `ps`: the prose hidden. `ls --json`: merged with
           `--variants --json`, the HF folder written into `path` so the old `key_for` matches. `load <key>@<quant>`:
           when the `@quant` key will not load and the bare key will, it renames the sibling builds' folders on the
           models volume aside (`*.__aside_survey_quant`), stops and restarts LM Studio's server, loads the bare key,
           renames them back — its own comment: "load base (may be wrong quant) rather than hard-fail". §10's click,
           done by renaming folders under the running app.
    07:09  v2.49 merged (PR #30): RUN-ON-MAC.md says do not wrap, alias or shadow; the preflight refuses an `LMS=`
           that is not the binary; `WINDOW MISMATCH`.
    19:06  a hand-rolled "CLEAN 31B" job (`screen -S tapuz31b`) with `PATH="$HOME/bin:…"` and
           `LMS=$HOME/bin/lms-survey-wrap` — **around `mlx-survey.sh`, not through it**, so none of v2.49's checks
           ran — from a checkout at 2.49 (`08bcf0a`, on `grok/mlx-survey-2026-09-20`, PR #32's branch) that had
           `LOCAL_LLM_WINDOW_CAP` and did not set it. Its log: `window=32768`, read through the fake `curl`. The
           battery's header for the same run: `window={"tokens":262144,…,"source":"probe"}`. The runtime: 262144.
           Its second row, `…@4bit`, would have taken the wrapper's folder-renaming path.
    20:05  Ben ran `screen -S tapuz31b -X quit`. That killed the `screen` process only: the login/bash pair, the
           battery and its scratch CMS on :3948 lived on and kept measuring. The session that wrote this finished it
           in order — the driving shells first, so the script could not reach the 4-bit row; the battery and the CMS
           went with them; `lms unload` with the real `lms`. Nothing renamed, the server never bounced, no row came
           out; the one trace is the false `window=32768` line in its log.
    20:31  PR #35 merged: the re-run is two passes; its step 0 is `rm -f ~/bin/curl ~/bin/lms-survey-wrap`.
    20:41  `~/bin` emptied — step 0, followed. The folder stayed.
    21:04  pass 1 started, through the real tools — the preflight prints them now:
           `lms: ~/.lmstudio/bin/lms · curl: /usr/bin/curl · node: /opt/homebrew/bin/node · ok · 2.50.0-alpha · 55a9914`
           — and every row carries four windows (asked 32768 · runtime 262144 · budgeted 32768 · battery saw 32768;
           the battery's own header: `"tokens":32768,…,"probedTokens":262144,"cap":32768`), no `WINDOW MISMATCH` in
           the folder. Pass 1 ended 06:47 the next morning; pass 2 waits on Ben's click for the 4-bit builds.
    09-22  only the empty `~/bin` was left; removed. No copy of the 5.5 KB wrapper turned up in the working folders
           afterwards (not a whole-disk search); the description above is from reading it while it was live.

One thing about `~/bin` on this Mac, measured: a clean login shell does not put it on PATH; the desktop app's sessions
inherit a PATH that has it — *after* `/usr/bin` and `~/.lmstudio/bin` — so a file dropped there shadows nothing in a
login shell. It shadowed `curl` and `lms` only for a job that put `$HOME/bin` first, which both shim runs did on purpose.

D4, then. The rule was in the file twelve hours before the 19:06 job — and a rule in a file binds only a job that reads
the file. That job did not call the script the rule guards. What is in the repo now catches everything that goes
*through* the script: B7's preflight names the tools, refuses a wrapped `LMS`, and `WINDOW MISMATCH` fires when the
runtime, the script's view and the battery disagree. Nothing in the repo can see a job that never calls it — and
nothing should try. The trust rule for a Mac row is therefore three witnesses, all of them already there: the script's
own preflight line (the tools, the checkout, the version), the battery's `window=` header agreeing with the row's four
windows, and `ls ~/bin` empty at the time. A `window=` line printed by a wrapper is not a witness; a row without the
three is not a row. Whether the Mac's agent has read the runbook since the 19:06 job is Ben's to settle, in the letter
channel — not here.
