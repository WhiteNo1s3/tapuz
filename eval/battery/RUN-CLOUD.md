# The premium run — orders (code ≥ 2.51)

The free tier's batteries need a GPU. **This one needs a key and a network**, so it runs on whichever
machine has a terminal open — the Mac, the 5090 box, either. It does not touch LM Studio, does not load
a model, and does not use the GPU.

The background is `docs/CLOUD-LLM.md`. Read §2 before spending anything: the copilot's briefing is
~21,700 tokens on **every** model call, which is what makes an uncapped run expensive and a cached one
cheap.

---

## Before you start

```bash
cd <the tapuz checkout>
git fetch origin main && git checkout main && git pull --ff-only origin main
npm ci
node -e "console.log(require('./package.json').version)"   # must be 2.51.0-alpha or later
```

**If the MLX survey is still running on this machine**, the cloud run is safe beside it — different
model, no GPU — but it must not take the survey's port:

```bash
export BATTERY_PORT=3949
```

**The key.** In the shell, never in the repo (it is public):

```bash
export ANTHROPIC_API_KEY=sk-ant-…      # or XAI_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY
```

---

## 1 — the probe. One scenario, one dollar, five minutes.

Nobody knows what this battery costs yet. Find out on one scenario before spending a night's worth.

```bash
node scripts/battery-copilot.js --provider=claude --model=claude-haiku-4-5 \
  --track=dreams --only=D1 --runs=1 --budget=1
```

Read the last three lines. They say what D1 cost, what the prompt cache saved, and where the card went.

**Send back:** that block, verbatim. It decides every number below.

## 2 — the cheap night. The whole dreams list on the cheapest model.

Cap it at **fifteen times what D1 cost**, rounded up (fourteen dreams plus room for the long ones):

```bash
node scripts/battery-copilot.js --provider=claude --model=claude-haiku-4-5 \
  --track=dreams --runs=1 --budget=<that number>
```

If it stops on the cap (exit 5) that is a **result, not a failure**: the card holds what was measured
and the message says where the money went. Send it back rather than raising the cap on the spot.

## 3 — the model we would actually sell. Same list, better brain.

```bash
node scripts/battery-copilot.js --provider=claude --model=claude-sonnet-5 \
  --track=dreams --runs=1 --budget=<step 2's cost × 3>
```

Sonnet is twice Haiku's input price and twice its output price, so budget for roughly double — the ×3
is headroom, not a forecast.

**Stop here and report.** Opus (`--model=claude-opus-5`, 2.5× Sonnet) is worth running only if Sonnet's
card leaves a question Opus could answer. Ask first.

## 4 — Grok, when the key arrives

xAI publishes its own prices and this CMS holds no quote for them, so the two numbers come from
<https://docs.x.ai/docs/models> — dollars per **million** tokens:

```bash
export XAI_API_KEY=xai-…
node scripts/battery-copilot.js --provider=xai --model=<the id from that page> \
  --price-in=<in> --price-out=<out> --track=dreams --only=D1 --runs=1 --budget=1
```

Then the same three steps. If those two numbers are going to be used again, they belong in `QUOTES` in
`src/ai-cost.js` **with the date they were read** — that is a small PR, not something to keep in a
shell history.

---

## What to send back

For each model, the card (`eval/battery/*.md`) and:

1. **the cost block** — total, per scenario passed, and what the cache saved;
2. **every ✗** — the owner's sentence, what landed, the door's notice if there was one;
3. **the habits** — which of the local tier's habits survive a cloud model, and which are new: prints
   the page instead of calling the tool · silent after a read · talks about the page instead of making
   it · claims a change it did not make · loses the owner's facts (D9, D11, D12) · invents a picture;
4. **anything the judge got wrong** — a miss a person would have accepted, with the turn.

Then one PR: `claude/cloud-battery-<date>`, adding
`eval/battery/SCORECARD-<date>-cloud-<provider>.md`. No version bump — measuring ships nothing.

---

## Rules

1. **`main` is the sync point.** Pull before you start; never push to `main`, never force-push.
2. **You own one path:** the scorecard you are writing. Everything else is read-only — the product
   code, the battery, this file.
3. **Never the live site.** The battery spawns its own throwaway CMS on `127.0.0.1:$BATTERY_PORT` and
   approves its own proposals; pointed anywhere else it would publish a menu.
4. **Nothing private in the repo.** No key, no hostname, no `/Users/<name>` path, no mailbox. The key
   lives in the shell and in the throwaway site the run deletes.
5. **Never change a sentence, a check or a threshold to improve a score.** If a check looks wrong, put
   the turn from the `.json` in the scorecard and leave the check alone.
6. **A refusal is a result.** The battery refuses before it spends — no key, no `--model`, a model this
   CMS would silently swap, a cap with no price behind it. Send the refusal back; do not work around
   it, and do not remove the cap to make a run finish.
7. **A cloud row is a NEW row.** It never corrects a 5090 row or an MLX row. Different tier, different
   question.
