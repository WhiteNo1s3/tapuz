# The Mac node — orders for the MLX survey

You are the agent on the Mac (128 GB unified memory, LM Studio, MLX). The PC (RTX 5090, GGUF Q4) is
the other node; you cannot reach it and must not try. GitHub `main` is the only thing the two
nodes share. Your job is one command and one file.

## Do this

```bash
cd <the tapuz checkout>
git fetch origin main && git checkout main && git pull --ff-only origin main
npm ci
bash scripts/mlx-survey.sh            # sanity → tier A → tier B → tier C.  DRY=1 prints the plan and runs nothing.
```

The script decides everything: which models (fifteen, fixed), which bits, how many runs, the 32K
window, `--parallel 1`, the download, the load check, the three measurements per model, the unload.
**Do not add, swap or reorder models. Do not edit the script.** It writes to
`eval/battery/mlx-<date>/`: a log per step, `results.tsv`, and `SCORECARD-draft.md` at the end.

What is measured, per model — the verdict is human sentences, never a spec:
1. `battery-copilot.js --track=dreams` — D1–D14, an owner's own words in Hebrew, judged by what she
   would check and by the page builder (×2 for the recommended models, ×1 for the rest);
2. `eval-injections.js theme-designer 1 --briefs=dreams` — five look-and-feel wishes;
3. `eval-injections.js site-builder-lite 1 --briefs=dreams` — five "make me a page" wishes.

Expect 6–10 hours for everything. Tiers can be run separately (`bash scripts/mlx-survey.sh A`) and
the script skips nothing silently: a model that does not download or load becomes a row that says so.

## Cluster rules

1. **`main` is the sync point.** Pull before you start. Never push to `main`; never force-push.
2. **You own one path:** `eval/battery/SCORECARD-<date>-mac-mlx.md`. Everything else in the repo is
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

## When something goes wrong

| the script says | do |
|---|---|
| `REFUSED: this checkout is … need ≥ 2.48.0` | `git pull --ff-only origin main` |
| `REFUSED: something answers on port 3948` | an interrupted battery left its server: `lsof -ti :3948 \| xargs kill`, run again |
| `STOP: a model that is not mine …` (exit 3) | ask Ben; do not unload it |
| `INSTRUMENT BROKEN …` (exit 4) | measure nothing. Send `sanity.log` and the newest `eval/battery/*-tapuz-mlx-sanity-local.json` back |
| `DID NOT DOWNLOAD` / `DID NOT LOAD` on a row | nothing — the row records it; the run continues |
| the script itself crashes | report the line and the error. Do not patch it on the Mac |

## Send back

Copy `eval/battery/mlx-<date>/SCORECARD-draft.md` to `eval/battery/SCORECARD-<date>-mac-mlx.md` and
fill its four sections from the logs and the per-turn `.json` files in `eval/battery/`:

- **every ✗**, per model: the owner's sentence, what landed, the door's notice if there was one;
- **habits** — which of these survive 8 bits, which are new: prints the page instead of calling the
  tool · silent after a read · talks about the page instead of making it · claims a change it did
  not make · loses the owner's facts (D9, D11, D12) · invents a picture or a link;
- **anything the judge got wrong** — a miss a person would have accepted, with the turn;
- **what did not download or load**, and LM Studio's own words.

Numbers are ranges: a ×2 run moves by one or two scenarios. An MLX row is a new row — it never
corrects a 5090 row. Then the PR, and one message to Ben: the table and the link.

## The 5090 rows you are answering (GGUF Q4, v2.48, `docs/LOCAL-LLM.md` §5)

Gemma 4 31B: dreams 26/28 · theme dreams 4/5 · page dreams 5/5. The other rows land in §5 when the
5090's own survey finishes. The question for the Mac: **do more bits change the verdict** (8-bit
against 4-bit of the same model), **and is a model that does not fit a 32 GB card the better helper**
(tier C)?
