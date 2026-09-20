# The premium tier — the owner's API key as the brain

> Ben, 2026-09-20: *"this is the phase where the PREMIUM CUSTOMERS will be at, having an api key and
> powerful agent with RAGs that pass the moon, not 31b or 70b."*

`docs/LOCAL-LLM.md` is the free tier: a model on the owner's own machine, nothing leaving it, nothing
billed. This file is the other one — the owner brings a key, the CMS calls the provider, and **every
token is on their bill**. Same copilot, same six tools, same doors, same approval card. What changes is
who thinks, and that somebody is paying per thought.

Nothing here changes the local tier. A local run still sends no key, shows no cost line and gets no
cache header.

---

## 1. What exists (v2.51)

| | |
|---|---|
| Providers with a key | `claude` (Anthropic) · `openai` · `xai` (Grok) · `openrouter` |
| Where a key may be sent | four hosts, hand-written in `src/providers.js` — a fifth is a code change |
| What a turn reports | `spend` on every chat response: calls, tokens, cache split, and the money when we hold a price |
| The price table | `src/ai-cost.js` — Anthropic's list as read on 2026-06-24, with the date attached |
| A model with no price | reports `null`, never `0` — the tokens still come back, the money is worked out afterwards |
| The battery | `scripts/battery-copilot.js --provider=… --model=…`, with a default spending cap |
| Pinned by | `scripts/smoke-ai-cost.js` (30 checks, no key, no network, in `test:smoke`) |

---

## 2. The number that decides what this tier costs

The copilot's briefing is not small, and it rides on **every model call**:

```
full briefing     49,904 chars  ≈ 21,700 tokens
tool schemas       1,685 chars  ≈     733 tokens
                                ─────────────────
stable prefix per call          ≈ 22,430 tokens
```

A cloud window is effectively unbounded, so a cloud provider always gets the **full** tier — the whole
21,700 tokens, on hop one and on hop fourteen alike. At Claude Sonnet 5's $2 per million input tokens
that is **$0.045 a call before anything else happens**, and a dreams battery makes a few hundred calls.

So v2.51 marks that prefix with `cache_control`. After the first call it is served from Anthropic's
cache at a tenth of the price — $0.0045 instead of $0.045 — for the cost of writing it once at a
quarter more. **That one change is most of the difference between a battery that costs eight dollars
and one that costs one.** The run prints what the cache saved, so it is a measurement and not a claim.

Rough arithmetic for a full `--track=dreams` run (14 scenarios, ×1), *before* anyone has measured one:

| | Sonnet 5 | Haiku 4.5 |
|---|---|---|
| prefix, no cache | ~$7–11 | ~$3.5–5.5 |
| prefix, cached | ~$1–1.5 | ~$0.5–0.8 |
| output + history | ~$1 | ~$0.5 |
| **expect** | **$2–4** | **$1–2** |

Those are estimates from the prefix measurement and the local runs' call counts. **Replace them with
the probe below before quoting them at anyone** — a range with arithmetic behind it is still a range.

---

## 3. Run it — the probe first, then the night

**Step 1 — one scenario, one dollar.** Never start with the whole list; start by finding out what one
costs.

```bash
export ANTHROPIC_API_KEY=sk-ant-…
node scripts/battery-copilot.js --provider=claude --model=claude-haiku-4-5 \
  --track=dreams --only=D1 --runs=1 --budget=1
```

It prints a line per scenario with its own cost and the running total, and writes
`eval/battery/<stamp>-claude-claude-haiku-4-5-local-dreams.json` with a `spend` block: the tokens, the
price it used, the date that price was read, what the cache saved, and **what one scenario passed
cost**.

**Step 2 — multiply.** Fourteen dreams is roughly fourteen times D1, plus the ones that go long. If D1
came to $0.08, the night is about $1.20 and a $3 cap is generous. If it came to $0.60, stop and think
before spending $9.

**Step 3 — the night.**

```bash
node scripts/battery-copilot.js --provider=claude --model=claude-haiku-4-5 \
  --track=dreams --runs=1 --budget=3
```

**Step 4 — the model you actually want to sell.** Same command, `--model=claude-sonnet-5` (or
`claude-opus-5`), with the cap raised to whatever step 2 said. The rows compare because the sentences,
the judges and the site are identical.

### The cap

`--budget` is a **default, not a flag**: leave it out and the run stops at $5. Only `--budget=0`
removes it, and the run says so in capitals. When the cap is passed the run stops mid-scenario, scores
nothing it did not finish, writes the card with what it had, and exits **5**.

### The refusals

The battery refuses before it spends, never after. Each one names the fix:

| it says | why |
|---|---|
| `ANTHROPIC_API_KEY is not set` | the key comes from the provider's own env var (`XAI_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`) |
| `--model is required for a cloud provider` | a row has to name the weights that answered |
| `"x" is not in this CMS's list … would quietly run y instead` | `providers.js` substitutes its default for an unknown model — in a chat that is a kindness, in a measurement a lie |
| `I hold no price for "x" … cannot enforce --budget` | give `--price-in=` and `--price-out=` in dollars per **million** tokens, or `--budget=0` and price it afterwards |
| `--courier=relay … nothing to relay` | relay plays the Bridge, which reaches a model on *this* machine |

---

## 4. Where the key lives

- The battery writes it into the **throwaway site** it spawns under a temp root, and deletes that root
  when it finishes. Nothing is written into the checkout.
- In the product it lives in the site's own `config/ai.json`, and `getSettings()` never returns it —
  only whether one exists and its last four characters.
- It may only be sent to the four hosts in `ALLOWED_API_HOSTS` (`src/providers.js`). The set is a
  hand-written literal, not something derived from the provider table, because the table is data and
  data is what an attacker who reached the CMS would edit. Loopback is allowed for local runtimes;
  everything public must be `https` **and** on the list. A lookalike (`api.x.ai.evil.com`) fails the
  exact match — pinned by `smoke-ai-cost`.
- **Never put a key in this repo.** It is public. `.env`, the shell, or the command line.

---

## 5. What we do not know yet

1. **What the battery actually costs.** Estimated in §2, never measured. The probe in §3 answers it.
2. **Prices for xai / openrouter.** No quote is held, on purpose — nobody here has read their pricing
   page, and a guessed price is worse than none. Pass `--price-in` / `--price-out`, and if those
   numbers are going to be used twice, add them to `QUOTES` in `src/ai-cost.js` **with the date you
   read them**.
3. **Whether the tool loop behaves the same on a cloud model.** Every habit in `LOCAL-LLM.md` §5 —
   silence after a read, a printed tool call, a claimed change that never happened — was found on
   local weights. The premium rows are new rows; they never correct a local row.
4. **The second cache breakpoint.** Only the system prefix is cached today. The growing tool-result
   history is re-sent whole on every hop and is not marked. That is the next lever, and it is bigger on
   a long scenario than on a short one.
5. **RAG.** The "agent with RAGs" half of Ben's sentence is not built. Nothing here retrieves; the
   copilot reads pages with its own tools. That is its own phase.

---

## 6. Adding a provider

Twelve lines in `src/providers.js` (copy the `xai` entry), its host in `ALLOWED_API_HOSTS`, and its env
var in `KEY_ENV` in `scripts/battery-copilot.js`. If the provider speaks the OpenAI chat shape —
almost all of them do — nothing else changes.

Prefer `openModel: true` unless the model ids are genuinely stable: a hardcoded list that goes stale
makes the CMS refuse a model that exists, and the battery already insists the runner names the model
out loud.

For a survey across vendors, **OpenRouter is one key and one request shape** for Grok, Gemini, DeepSeek,
Qwen and the rest — which is what makes comparing them affordable at all.
