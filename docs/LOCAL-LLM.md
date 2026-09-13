# Testing the injections against a local model (LM Studio)

Ben's rule: *"we have our own friendly AI pipeline with API key when the user is paying per token — we are to make this area function seamlessly; we can test with the local LLM."* The CMS's `local` provider speaks the OpenAI chat endpoint any local runtime exposes (LM Studio, Ollama's OpenAI shim, llama.cpp server), on loopback only — a public host typed into the "local" box is refused before any key is attached (`src/providers.js`, `scripts/smoke-local-llm.js`).

## 1. Load the model (LM Studio)

```bash
"$USERPROFILE/.lmstudio/bin/lms.exe" server start --port 1234
"$USERPROFILE/.lmstudio/bin/lms.exe" load qwen3.6-35b-a3b --gpu 0.6 --context-length 24576 --identifier tapuz-qwen -y
"$USERPROFILE/.lmstudio/bin/lms.exe" ps
```

`--gpu 0.6` leaves VRAM for whatever else is running (with `--gpu max` and a game open the model crawled at ~1 token/s; with partial offload it runs ~20 tokens/s). 24K context takes the full site-builder dictionary (44K chars ≈ 14K tokens) with room for the reply. `reasoning_effort: 'none'` is sent by the CMS and honoured (0 reasoning tokens).

## 2. Point the CMS at it

`/admin/ai` → provider **מודל מקומי**, endpoint `http://127.0.0.1:1234/v1`, model `tapuz-qwen` (or leave the model empty for whatever is loaded). The connection test lists the loaded models. From then on every **▶ הרץ עם ה-AI המחובר** button in the admin (the menu organizer on `/admin/menus`, the packs on `/admin/inject`) runs through this endpoint, with the same doors as the paste flow.

## 3. The live smoke — one real run, end to end

```bash
LOCAL_LLM_BASE=http://127.0.0.1:1234/v1 LOCAL_LLM_MODEL=tapuz-qwen node scripts/smoke-local-live.js
```

Spawns a server on a temp root seeded with the ten-item live menu, logs in as admin, calls `POST /admin/api/inject/menu-organizer/run`, and checks: the reply is a `<bent-menus>` document the door parsed, at most one repair round, no hard warning, under 240 s, usage reported, the paste of the same reply gives the same warnings, and **nothing was applied**. Skips with exit 0 when `LOCAL_LLM_BASE` is not set, so `test:smoke` never needs a model.

## 4. The eval — the 99.9% instrument

```bash
EVAL_MODEL=tapuz-qwen node scripts/eval-injections.js                                  # every pack, 3 runs each
EVAL_MODEL=tapuz-qwen node scripts/eval-injections.js menu-organizer 20 --fixtures=all --repair
EVAL_MODEL=tapuz-qwen node scripts/eval-injections.js menu-organizer 5 --fixtures=live-10 --size=full --variant=B
EVAL_MODEL=tapuz-qwen node scripts/eval-injections.js theme-designer 5
EVAL_MODEL=tapuz-qwen node scripts/eval-injections.js site-builder-lite 5
```

Every run goes through `src/ai.js` (the same code path the admin buttons use) and is judged by the real door. Read `docs/INJECTION-EVAL.md` afterwards:

| Column | Meaning |
|---|---|
| Landed | the door accepted the reply (no refusal) |
| PASS | landed **and** right for the site — organizer: no hard warning, every published page placed, fits one row (or a fold/side/drawer was chosen), not an echo; theme: ≥ 4 sections and the bench compiles; page: ≥ 3 blocks, no raw-html fallback |
| Strict | PASS on the first reply (no repair round) |
| Clean | no repair and no warning at all — the prompt's quality |
| 2nd round | a repair turn was sent (the door refused or raised a repairable warning) — the winner is the reply with fewer hard warnings |
| Top codes | what the doors had to do, with the prompt rule to tighten |

Non-passing replies are saved verbatim under `eval/failures/<pack>/` — each one becomes a canned reply in the pack's drift matrix (`test/fixtures/inject/<id>/replies/`) so the door never fails the same way twice. The 99.9% headline is written only after ≥ 3,000 scored runs with ≤ 3 non-passes; until then the report states "N runs, X pass".

## 5. What was measured (2026-09-13, qwen3.6-35b-a3b at 24K, `--gpu 0.6`)

Organizer, final prompt: 27 runs → 25 PASS (92.6%), 24 strict, avg 23 s, p95 50 s, ~3,166 prompt tokens (lite pack); the first prompt scored 7/16 before the fold-tag rule and the scorer's home-as-URL fix. Non-passes on the final prompt: both on nested-existing — a "רק סדר" brief on a nested menu that already fits one row: one reply echoed the menu (NO_CHANGE after the repair round), one dissolved a group (7 top items against the fixture's 6) — the one fixture still under 3/3; every other fixture scored 3/3. Theme-designer: 10/10 PASS, avg 137 s. The live route smoke: PASS — one round, 29 s, the door accepted a fold after 7 items (669px of 880px), nothing applied. The full tables are in `docs/INJECTION-EVAL.md` and the Version Log row for v2.28 in `docs/ROADMAP.md`. Earlier probes: theme-designer pack (17K chars ≈ 7K tokens) → a valid `<bent-theme>` in 71 s with zero warnings; site-builder full (44K chars) → a clean page in 131 s with zero repairs; site-builder lite → landed after the repair engine closed unclosed leaves; a 3.6K-char organizer draft → 3/3 valid `<bent-menus>` documents in 20–27 s, ~1,580 prompt tokens, and no reply used a code fence (which is why every door treats the fence as optional).
