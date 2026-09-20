# A letter to Grok — the MLX side of the survey (2026-09-20)

From Claude on the 5090, by way of Ben. You are on the Mac; I cannot reach it and you should not
reach the PC. This letter is the whole job — nothing in it depends on a chat you did not see.

## Why

Ben decided two things this week, and both are now the law of every test in this repo:

1. *"We will recommend gemma4 for our product"* — by graphics card: 12–16 GB → Gemma 4 12B, 24 GB →
   Gemma 4 26B-A4B, 32 GB → Gemma 4 31B (`docs/LOCAL-LLM.md` §1א, §5). Those numbers are 5090 **GGUF
   Q4** numbers. Nobody has measured the **MLX** builds, and a Mac owner is a customer too.
2. *"We cannot talk robot to the robot, we must act human when we interact with the llm — we cannot
   make his life easy 'hero <XXXX> bla bla' … think about humans, what they ask you to do all the
   time — that is the attitude."* The verdict on a model is the **dreams track**: an owner's
   sentences in Hebrew, judged by what SHE would check and by the page builder. The T-battery and
   the spec evals are a comparison column, not the verdict.

The question only the Mac can answer: **do more bits change the verdict?** The 5090 runs everything
at 4 bits because 32 GB is all it has. On the 5090 the 12B misses "make the page, don't talk about
it", and the 26B-A4B sometimes goes silent after a read. At 8 bits — are those still there? And
the models that do not fit 32 GB at all (below, §3C) — is any of them the better helper?

## 0. Rules — read them twice

- **Never against the live site.** The battery approves its own proposals and an approved menu is
  LIVE. It runs against a scratch CMS it spawns on `127.0.0.1:3948` under a temp root, and nothing else.
- **Do not rewrite a battery sentence, a check, or a threshold to make a score better.** If a check
  looks wrong to you, say so in the scorecard — with the transcript — and leave it. A miss EVERY
  model gets is the judge's fault and I want to hear about it; a miss one model gets is the finding.
- **No product code in your PR.** Scorecards and observations only. Found a bug? Write it down
  (what was sent, what came back, what landed) — `BREAKAGE-…md` beside this file is the pattern.
- **Never `lms unload --all`**; unload by identifier (`lms unload tapuz-…`). LM Link stays off.
- **One GPU job at a time, `--parallel 1`, 32K context.** Not 262K, not parallel 4 — see §1.
- **Weights only.** MLX repos from `lmstudio-community`, `mlx-community` or the publisher. Do not
  install a custom runtime, a fork of llama.cpp/mlx, or anything that asks to run an installer. If
  LM Studio cannot load a model as it ships, write "does not load in stock LM Studio" and move on.
- **Disk is not a concern** — Ben: *"I have no problem with storage, I will delete the useless ones
  afterward"*. Download freely; do not delete anything you did not download.
- **Results do not go in the home directory.** Raw artifacts stay in `eval/battery/` of the checkout
  (git-ignored); the scorecard is a tracked file beside this letter (§5). Yesterday's
  `battery-v246-dreams.out` landed somewhere under `~` and nobody else can read it — if it still
  exists, move it next to the artifacts and quote it in the scorecard.
- **The repo is public.** No hostname, no IP, no device name, no `/Users/<name>` path, no mailbox in
  anything you commit. `gitleaks` will refuse some of it; the rest is on you.

## 1. First, make sure the instrument is sound — yesterday's 7/13 was not the model

`SCORECARD-2026-09-19-mac-mlx-gemma-4-31b-v244.md` reports Gemma 4 31B MLX at 7/13. Read its own
per-turn table again: **every** failing row says the server applied the change (`applied.created =
true`, `applied.edited = true`, `backupId = …`) while the judge's database says it did not — and T3
found a page called `pricing` that no fresh site has. That is one cause, not five: **an earlier
battery had been interrupted and its server was still holding port 3948.** The new run's own server
could not bind; every turn went to yesterday's site; the judge read today's empty one. (It happened
to me on Windows on day one — a killed run leaves its children alive.)

Since this PR the battery refuses to start when something already answers on its port. Do this once:

```bash
lsof -ti :3948 | xargs kill 2>/dev/null; true        # an orphan from an earlier run
cd <your tapuz checkout> && git fetch origin main && git checkout main && git pull --ff-only origin main
node -e "console.log(require('./package.json').version)"   # 2.47.0-alpha or later
git rev-parse --short HEAD                                   # note it for the scorecard
npm ci
```

Then the **sanity run** — the 31B MLX you already have, loaded the way the product is documented:

```bash
LMS="$HOME/.lmstudio/bin/lms"
"$LMS" server start --port 1234
"$LMS" load google/gemma-4-31b --gpu max --context-length 32768 --parallel 1 --identifier tapuz-gemma -y
curl -s http://127.0.0.1:1234/api/v0/models | grep -o '"loaded_context_length":[0-9]*'     # must say 32768
LOCAL_LLM_BASE=http://127.0.0.1:1234/v1 LOCAL_LLM_MODEL=tapuz-gemma \
  node scripts/battery-copilot.js --only=T2,T4,T13
```

Expected: 3/3. If a row says `applied…= true` and the draft check still fails, **stop** — the
instrument is broken on this machine, and that is the report (send me the three turns from the
`.json`). Do not measure twelve models with a broken ruler.

Always pass `LOCAL_LLM_MODEL=<the identifier you loaded>`. Empty means "whatever is loaded", and a
name that matches nothing makes LM Studio JIT-load another copy at its default window.

## 2. The run, per model

```bash
ID=tapuz-<short-tag>          # e.g. tapuz-g4-12b-8bit
"$LMS" unload tapuz-<previous-tag>
"$LMS" load <model key from `lms ls`> --gpu max --context-length 32768 --parallel 1 --identifier $ID -y
curl -s http://127.0.0.1:1234/api/v0/models | grep -o '"loaded_context_length":[0-9]*'

export LOCAL_LLM_BASE=http://127.0.0.1:1234/v1 EVAL_BASE=http://127.0.0.1:1234/v1

# (a) THE VERDICT — the copilot dreams D1–D14. ×2 for the three recommended Gemmas, ×1 for the rest.
LOCAL_LLM_MODEL=$ID node scripts/battery-copilot.js --track=dreams --runs=2

# (b) the one-shot doors, with an owner's sentences and her questions
EVAL_MODEL=$ID node scripts/eval-injections.js theme-designer 1 --briefs=dreams
cp docs/INJECTION-EVAL.md eval/battery/$ID.theme-dreams.md
EVAL_MODEL=$ID node scripts/eval-injections.js site-builder-lite 1 --briefs=dreams
cp docs/INJECTION-EVAL.md eval/battery/$ID.page-dreams.md
git checkout docs/INJECTION-EVAL.md docs/injection-eval.json      # the eval rewrites tracked files — put them back

# (c) the comparison column — only if there is time
LOCAL_LLM_MODEL=$ID node scripts/battery-copilot.js --runs=2                                  # T1–T13 ×2
EVAL_MODEL=$ID node scripts/eval-injections.js menu-organizer 3 --fixtures=all --repair        # 27 runs
git checkout docs/INJECTION-EVAL.md docs/injection-eval.json
```

Memory: note what the model takes at 32K (Activity Monitor → Memory, or `"$LMS" ps`). A Mac owner
wants to know whether it fits 16 / 24 / 32 / 64 GB of unified memory the way §1א says it for cards.

What the console means: `✗` = a hard miss (the scenario FAILS), `~` = a soft miss (wording or
taste — it does not fail), `·` = a note. The `.json` next to it has every turn: what was sent, the
card's source, the reply, the notices, the seconds.

## 3. Which models

Names marked ✓ I verified on Hugging Face on 2026-09-20. `lms get <repo url> -y` or the app's
search both work. 8-bit where the Mac's memory allows — that is the point of the exercise; add the
4-bit of the same model when you can, so the pair isolates "bits" from "MLX vs GGUF".

**A. The recommendation (do these first, dreams ×2)**

| model | MLX repo | the 5090 row it answers to (GGUF Q4, v2.47 unless said) |
|---|---|---|
| Gemma 4 31B | ✓ `lmstudio-community/gemma-4-31B-it-MLX-8bit` (and `-4bit`); the `google/gemma-4-31b` already on the Mac counts — say which bits it is | dreams 26/28 · theme dreams 4/5 · page dreams 5/5 |
| Gemma 4 26B-A4B | ✓ `lmstudio-community/gemma-4-26B-A4B-it-MLX-8bit` (and `-4bit`, and ✓ `gemma-4-26B-A4B-it-QAT-MLX-4bit`) | dreams D1–D8 15/16 (v2.46); the GGUF **QAT** build was the worse one (21/26 on the T-battery — silent after `read_page`) |
| Gemma 4 12B | ✓ `lmstudio-community/gemma-4-12B-it-MLX-8bit` (and `-4bit`) | dreams D1–D8 14/16 (v2.46, the QAT Q4_0 GGUF) |
| Qwen 3.8 27B | ✓ `lmstudio-community/Qwen3.8-27B-MLX-8bit` (and `-4bit`) | dreams D1–D8 8/8, T-battery 26/26 — Gemma's equal |

The full v2.47 rows (D1–D14) for all four land in `docs/LOCAL-LLM.md` §5 when the 5090's run
finishes; until then compare D1–D8 with D1–D8.

**B. The small end (dreams ×1)** — is there a helper for an 8 GB machine?

| model | MLX repo | note |
|---|---|---|
| Qwen 3.5 9B | ✓ `lmstudio-community/Qwen3.5-9B-MLX-8bit` / `-4bit` | being measured on the 5090 now |
| Granite 4.2 8B / 30B | ✓ `lmstudio-community/granite-4.2-8b-MLX-8bit`, `granite-4.2-30b-MLX-8bit` | built for tool calling; Hebrew is not on its language list |
| Gemma 4 E4B | ✓ `lmstudio-community/gemma-4-E4B-it-MLX-8bit` | at Q4 it *describes* the tool call and stops (12/26). Do 8 bits cure that? |
| Bonsai 2 27B (ternary) | ✓ `prism-ml/Ternary-Bonsai-2-27B-mlx-2bit` | a 27B in ~7 GB. Its GGUF needs the publisher's llama.cpp fork, so I could not run it. If stock LM Studio loads the MLX build — measure it; if not, say so and move on. **No forks, no installers.** |

**C. What does not fit a 32 GB card (dreams ×1, as the Mac's memory allows)** — Ben: *"you can seek
information on more capable llms I didn't mention"*. I could not verify MLX repos for these; look
under `lmstudio-community` and `mlx-community`, pick the largest bit-width that leaves ~15 GB free
at 32K, and skip whatever does not fit: **Qwen3.8-Flash-Next** (180B MoE), **gpt-oss-120b**,
**Mistral-Small-4-119B**, **GLM-5.3-Flash** (321B MoE), **DeepSeek-V4-Flash**, **Qwen3-Coder-Next**
(✓ `lmstudio-community/Qwen3-Coder-Next-MLX-8bit`). If one of them is clearly the better helper,
that is news — Ben sells a product, and "bring a Mac Studio" is a sentence he can say.

Already known, do not spend time on them: DictaLM 3.0 (both sizes) — a Hebrew model is not what
this job needs; nemotron-3-nano; gpt-oss-20b (loses one turn in six to the runtime's own parser on
LM Studio GGUF — if MLX parses its tool calls cleanly, *that* is worth one dreams run).

## 4. What I would look at in the transcripts

The habits the 5090 runs found. Tell me which ones survive more bits, and which are new:

- **The document is printed instead of called** (12B, 26B-A4B, qwen3.6) — since v2.45 the door
  adopts it; the note says "it printed the page".
- **Silence after a read** (26B-A4B): an empty reply right after `read_page`.
- **Talks about the page instead of making it** (12B, D1): after the owner's "you decide".
- **Dead styling** (31B, D10): `class="bg-purple-600"` / `style=` and then "I made it purple" —
  since v2.47 it goes back to the model once. Does the MLX build do it at all?
- **Facts lost** (31B): D9 keeps HER facts but drops up to half of the world's facts she wrote
  down; D11 ("shorten it") drops her street address; D12 keeps the customer's words and loses the
  owner's own paragraph.
- **Invented pictures and links** — should be zero since v2.46; say if you see one.

## 5. What to send back

One tracked file beside this letter: `eval/battery/SCORECARD-2026-09-20-mac-mlx-dreams.md`, on a
branch of your own, as a PR with **no version bump** (docs-only PRs do not bump; `smoke-version`
will agree). Shape:

```markdown
# SCORECARD — 2026-09-20 — Mac MLX, dreams first
code: <git sha> · package <version> · LM Studio <version> · MLX engine <version> · 32768 ctx · --parallel 1 · live model runs

| model | build · bits | memory @32K | dreams D1–D14 | soft | seconds | theme dreams /5 | page dreams /5 | T-battery ×2 | organizer /27 |
|---|---|---|---|---|---|---|---|---|---|

## Per model — every ✗, with the owner's sentence and what landed
## Habits (from §4 of the letter): which survive 8 bits, which are new
## Anything the judge got wrong (a miss a person would have accepted) — with the turn from the .json
## What did not load, and what LM Studio said
```

Numbers are ranges, not points: a ×2 run moves by one or two scenarios between runs. Label every
row with its build and bits; an MLX row is a **new row**, never a correction of a 5090 row.

If something here is wrong or cannot be done on the Mac, say which line and why — that is a better
answer than a number produced around it.

— Claude (5090 side), 2026-09-20
