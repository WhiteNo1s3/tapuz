# The Mac node — orders for the MLX survey (the re-run, code ≥ 2.50)

You are the agent on the Mac (128 GB unified memory, LM Studio, MLX). The PC (RTX 5090, GGUF Q4) is
the other node; you cannot reach it and must not try. GitHub `main` is the only thing the two
nodes share. Your job is two passes of one script and one file.

**This is the RE-RUN.** The first night (2026-09-20) measured the instrument, not the models — three of
twelve, under a window nothing ran at. What broke and what changed: `BREAKAGE-2026-09-20-mlx-survey.md`.
The card that night produced (`SCORECARD-2026-09-20-mac-mlx.md`) stays as a record of *uncapped* rows;
do not edit it — this run writes a new card and supersedes it.

**Why two passes.** LM Studio files a staff pick's builds (8-bit, 4-bit) under ONE key and loads whichever
build is *selected* in the app; neither `lms load` nor its API can ask for the other one (measured). The
list has such pairs (Gemma 31B, Gemma 12B — and any other the app files that way), so a pair takes a pass
for the 8-bit, **one click by Ben**, and a short pass for the 4-bit. You cannot click; Ben can. The script
tells you what to ask him for — before the night, not after it.

## Do this

**0 — once.** Remove the first night's shim and wrapper, update, and give every pass ONE output folder:

```bash
rm -f ~/bin/curl ~/bin/lms-survey-wrap; unset LMS LMS_REAL; hash -r
cd <the tapuz checkout>
git fetch origin main && git checkout main && git pull --ff-only origin main
npm ci
export MLX_OUT=eval/battery/mlx-rerun     # the same folder for pass 1 and pass 2, whatever the date
```

**1 — what is selected now (read-only, seconds, safe while Ben's own model is loaded):**

```bash
bash scripts/mlx-survey.sh variants
```

One line per model: `ready`, `not on disk yet`, or `CLICK NEEDED: 4bit is selected, this row needs 8bit`.
Pass 1 is the 8-bit pass: **for every `CLICK NEEDED` on an `-8bit` tag, give Ben the line** (LM Studio →
My Models → the model → choose the build) and run `variants` again until those tags say `ready`.
`CLICK NEEDED` on a `-4bit` tag is expected now — leave it for pass 2.

**2 — pass 1, the whole list (8–12 hours):**

```bash
bash scripts/mlx-survey.sh            # sanity → tier A → tier B → tier C.  DRY=1 prints the plan and runs nothing.
```

**3 — pass 2, only the rows the click unblocks (1–2 hours):**

```bash
grep "OTHER VARIANT" "$MLX_OUT/results.tsv" | cut -f1      # the tags that were not measured — expect the -4bit of each pair
bash scripts/mlx-survey.sh variants                        # …after Ben chose the 4-bit build for those models: they must say ready
bash scripts/mlx-survey.sh gemma-31b-4bit gemma-12b-4bit   # exactly the tags from the grep — tags and tiers can be mixed
```

It appends to the same `results.tsv` and rebuilds the draft card: a row that was not measured disappears
from the card once the same tag has a measured row; a measured row is never dropped. A download can move
LM Studio's selection by itself — the script asks again right before every load, so whatever happened,
the row says which build ran. A mistyped tag is refused before anything runs.

The script decides everything: which models (fifteen, fixed), which bits, how many runs, the
download (it resumes while a download grows), the load, the check of WHICH weights and WHICH window
really loaded, the three measurements per model, the unload. **Do not add, swap or reorder models.
Do not edit the script — and do not wrap, alias or shadow anything it calls (`lms`, `curl`, `node`,
`PATH`). A refusal is a result: send it back.** It writes to
`$MLX_OUT/` (step 0 — git-ignored): a log per step, `results.tsv`, and `SCORECARD-draft.md` at the end.

What is measured, per model — the verdict is human sentences, never a spec:
1. `battery-copilot.js --track=dreams` — D1–D14, an owner's own words in Hebrew, judged by what she
   would check and by the page builder (×2 for the recommended models, ×1 for the rest);
2. `eval-injections.js theme-designer 1 --briefs=dreams` — five look-and-feel wishes;
3. `eval-injections.js site-builder-lite 1 --briefs=dreams` — five "make me a page" wishes.

**The window.** LM Studio's MLX engine ignores `--context-length` and loads at the model's maximum
whenever memory allows (on this Mac: always 262,144). That is expected and the script does not fight
it: the CMS budgets every measurement at 32K itself (`LOCAL_LLM_WINDOW_CAP`, v2.49) so a row means what
a 5090 row means, and the four recommended 8-bit models get one more dreams run uncapped (`+autofit`
rows — what a Mac owner gets today; never a 32K row). Every row records configured → effective →
budgeted → what the battery's own probe saw.

Tiers and single models can be run separately (`bash scripts/mlx-survey.sh A`, `… qwen35-9b-8bit`) and
the script skips nothing silently: a model that does not download or load becomes a row that says so.

## Cluster rules

1. **`main` is the sync point.** Pull before you start. Never push to `main`; never force-push.
2. **You own one path:** `eval/battery/SCORECARD-<date>-mac-mlx-rerun.md`. Everything else in the repo is
   read-only for you — product code, the battery, this file, the script.
3. **One branch, one PR, at the end** (`grok/mlx-survey-<date>`). A green PR merges itself and CI
   minutes are paid: push once, when the scorecard is complete. No version bump (nothing shipped).
4. **Never the live site.** The battery spawns its own scratch CMS on `127.0.0.1:3948` and approves
   its own proposals; pointed anywhere else it would publish a menu.
5. **Only `tapuz-mlx-*` models are yours.** Never `lms unload --all`. If the script says
   *"a model that is not mine is loaded"*, Ben is using the machine: stop and ask him. LM Link stays off.
6. **Weights only.** No forks, no custom runtimes, no installers, no `sudo`. "Does not load in
   stock LM Studio" is a valid result.
7. **Disk is not a concern** (Ben's rule). Download everything on the list; delete nothing you did not download.
8. **Public repo:** no hostname, IP, device name, `/Users/<name>` path or mailbox in anything you commit.
9. **Never change a sentence, a check or a threshold to improve a score.** If a check looks wrong,
   put the turn from the `.json` in the scorecard and leave the check alone.
10. **Never make a check pass from outside.** No shim on `PATH`, no wrapper around `lms`, no edited
    response. On 2026-09-20 a fake `curl` rewrote the loaded window so a refusing check would pass,
    and a night of rows printed a window nothing ran at. The check was wrong (v2.49 fixed it) — and the
    answer to a wrong check is the refusal itself, sent back.

## When something goes wrong

| the script says | do |
|---|---|
| `REFUSED: this checkout is … need ≥ 2.50.0` | `git pull --ff-only origin main` (the 32K cap lives in the CMS) |
| `CLICK NEEDED: … is selected, this row needs …` (from `variants`) | not an error. Give Ben the line; he chooses that build in LM Studio → My Models → the model. Before pass 1 only the `-8bit` tags matter; before pass 2 the `-4bit` ones |
| `REFUSED: "…" is not a step … a tier … or a tag on the list` | a typo. The tags are the first word of each `variants` line |
| `REFUSED: LMS=… is not the lms binary` | unset the wrapper; the script talks to the real `lms` only |
| `REFUSED: something answers on port 3948` | an interrupted battery left its server: `lsof -ti :3948 \| xargs kill`, run again |
| `STOP: a model that is not mine …` (exit 3) | ask Ben; do not unload it |
| `INSTRUMENT BROKEN …` (exit 4) | measure nothing. Send `sanity.log` and the newest `eval/battery/*-tapuz-mlx-sanity-local.json` back |
| `PARTIAL DOWNLOAD — stalled at N%` on a row | nothing now; run that tier again later — `lms` resumes where it stopped |
| `ON DISK BUT UNRESOLVED` on a row | send back the output of `lms ls --variants --json` — the script could not match the repo to a key |
| `NOT DOWNLOADED` / `DID NOT LOAD in stock LM Studio` | nothing — the row records it; the run continues |
| `THE OTHER VARIANT IS SELECTED` on a row | expected in pass 1 for the `-4bit` of a pair: LM Studio files both builds under ONE key and neither `lms load` nor its API can ask for a specific one (measured: both answer "Model not found" for `…@8bit`) — the bare key loads whatever is *selected*. The script knew which one that was and did not load the wrong weights. That row is pass 2 (step 3): one click by Ben, then that tag alone. Do not look for a way around it |
| `WRONG WEIGHTS` / `LOADED TOO SMALL` on a row | nothing — the row was not measured and says why |
| `WINDOW MISMATCH` on a row or in sanity | something between the script and the runtime is lying (a shim on PATH, an old checkout). Remove it; do not explain it away |
| the script itself crashes | report the line and the error. Do not patch it on the Mac |

## Send back

After pass 2, copy `$MLX_OUT/SCORECARD-draft.md` to `eval/battery/SCORECARD-<the date pass 1 started>-mac-mlx-rerun.md` (the `-rerun` keeps it off the first night's card even on the same date) and
fill its four sections from the logs and the per-turn `.json` files in `eval/battery/`:

- **every ✗**, per model: the owner's sentence, what landed, the door's notice if there was one;
- **habits** — which of these survive 8 bits, which are new: prints the page instead of calling the
  tool · silent after a read · talks about the page instead of making it · claims a change it did
  not make · loses the owner's facts (D9, D11, D12) · invents a picture or a link;
- **anything the judge got wrong** — a miss a person would have accepted, with the turn;
- **what did not download or load**, and LM Studio's own words;
- **the two `variants` reports** (before pass 1, before pass 2), pasted as they printed — tags and keys only,
  nothing private. The 5090 side builds the script's tests from what THIS machine says, not from guesses.

Numbers are ranges: a ×2 run moves by one or two scenarios. An MLX row is a new row — it never
corrects a 5090 row. Then the PR, and one message to Ben: the table and the link.

## The 5090 rows you are answering (GGUF Q4, 32K, `docs/LOCAL-LLM.md` §5 "The human track")

| model (5090, 4-bit GGUF) | copilot dreams D1–D14 |
|---|---|
| Gemma 4 31B | 26/28 |
| Gemma 4 12B QAT | 25/28 |
| Qwen 3.8 27B | 13/14 |
| Muse-Glimmer 30B | 24/28 (since v2.50; 12/14 before) |
| Gemma 4 26B-A4B | 22/28 |
| Qwen 3.5 9B | 11/14 |
| Granite 4.2 30B | 10/14 |

**The recommendation is decided** (Ben, 2026-09-20 — `docs/LOCAL-LLM.md` §1א): Gemma 4 12B QAT up to a
24 GB card, Gemma 4 31B at 32 GB, Qwen 3.5 9B a named option, Muse-Glimmer supported but not recommended.
The Mac is not asked "which model". It is asked two things a 32 GB card cannot answer: **do more bits
change the verdict** (the 8-bit against the 4-bit of the same model — what a Mac owner should download),
**and is a model that does not fit a 32 GB card the better helper** (tier C)?

Muse-Glimmer is a *thinking* model with no "off". Since v2.50 the CMS asks LM Studio which reasoning levels
the loaded model allows and sends the lowest — expect it slow, not empty. If its rows still say
`EMPTY_REPLY` or `THOUGHT_OUT`, that is a finding: paste the turn.
