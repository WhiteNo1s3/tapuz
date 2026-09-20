# Research — Hebrew + coder dream LLMs for Tapuziel (2026-09-20)

Hebrew-first CMS co-pilot. The owner talks in **dreams**, not robot prompts. This note is for the
Mac 128 GB MLX node and the product recommendation that follows from public Hebrew/coder model
sources plus the Tapuziel dreams battery (see `docs/LOCAL-LLM.md` and `eval/battery/RUN-ON-MAC.md`).

Public-repo hygiene: no hostname, absolute home paths, IPs, or mailboxes. Say **the Mac checkout**.

**Scope of this note:** public sources and already-published Tapuziel measurements only. No new
model downloads, loads, or survey edits. Do not touch live survey screens or unload anything.

---

## 1. Cornerstone — talk like a customer dreaming

Ben (reading early scorecards): the prompts must not be structured in robot language. The product
handles the **dreams of the customer**, so the checks must go on reasonable human input — and
correlate with the **page builder**, not with tool JSON.

What that means for Tapuziel:

- **Input:** vague, warm, Hebrew sentences an owner would type ("אני פותחת סטודיו לקרמיקה…",
  "אנשים לא מוצאים איך ליצור קשר", "תקצר", a pasted document, a change of heart) — never
  `hero <XXXX>` spec lists.
- **Judgement:** did the **builder** open the page, does **preview** render it, does a builder
  **save** keep every module, is it real Hebrew about *her* business, and did it invent nothing?
- **Not the score:** whether the model emitted pretty `tool_calls` JSON. A printed second try, a
  silent read, or a plan that waits for "yes" before touching a live menu are product manners —
  the door and the card already own apply.

The dreams track (`battery-copilot.js --track=dreams`, D1–D14) and the theme/page dreams packs
(`eval-injections.js … --briefs=dreams`) are the instrument. Robot T-scenarios still exist for
regression; they are not how we pick a recommendation for owners.

---

## 2. Best open Hebrew LLMs — DictaLM 3.0

Dicta published **Dicta-LM 3.0** as open-weight Hebrew-sovereign models (24B / 12B / 1.7B), with
instruct and "Thinking" chat variants, long context, and a Hebrew chat suite alongside the Open
Hebrew LLM Leaderboard. Public pages: [dicta.org.il/dicta-lm-3](https://dicta.org.il/dicta-lm-3),
technical report / arXiv [2602.02104](https://arxiv.org/abs/2602.02104), Hugging Face
`dicta-il/DictaLM-3.0-24B-Thinking` (and the Nemotron-12B / 1.7B siblings).

### Hebrew chat suite (public Dicta table)

| Model | Summarization | Translation | Winograd | Trivia | Nikud |
|---|---:|---:|---:|---:|---:|
| **DictaLM-3.0-24B-Thinking** | **56.86** | **30.09** | 78.06 | **60.13** | **86.86** |
| gemma3-27B-it | 44.54 | 26.73 | **79.86** | 45.51 | 60.21 |
| aya-expanse-32B | 29.46 | 17.10 | 80.58 | 53.82 | 45.40 |
| Llama-3.3-70B-Instruct | 37.83 | 19.31 | 83.45 | 60.13 | 4.05 |
| **DictaLM-3.0-Nemotron-12B-Instruct** | 33.27 | 13.50 | 73.74 | 45.18 | **76.12** |
| gemma-3-12b-it | **39.48** | **16.50** | **75.90** | 44.85 | 51.78 |
| Qwen3-14B (think) | 15.83 | 0.90 | 73.38 | 41.86 | 4.73 |
| DictaLM-3.0-1.7B-Instruct / Thinking | ~10 | ~2.2–2.5 | ~56–58 | ~30–31 | ~47–53 |
| gemma-3-1b-it / Qwen3-1.7B (think) | ≈0 | ≈0 | ~48–51 | ~22–27 | ≈3 |

Reading for Tapuziel: **24B Thinking leads** the Dicta Hebrew chat tasks that matter for prose
(summarization, translation, trivia, nikud) against Gemma3-27B; Gemma keeps a narrow Winograd edge.
At ~12B, Gemma3-12B wins summarization/translation; **Dicta Nemotron-12B** dominates nikud.
Qwen3 at these sizes is far behind on the Hebrew chat suite. Dicta also reports the 24B Thinking
model as top of the Open Hebrew LLM Leaderboard in its weight class (up to 70B) on their site.

English mid-size split (Dicta table): Gemma3-27B leads MATH / BigBenchHard; DictaLM 24B Thinking
leads OMEGA, ZebraLogic, IFEval, MMLU, GPQA, AlpacaEval 2 LC.

### Already measured on Tapuziel (5090 GGUF, `docs/LOCAL-LLM.md` §5)

Hebrew quality ≠ copilot fitness. On the Tapuziel tool loop + BenTML grammar:

| Model | Copilot 32K ×2 | Dreams (D1–D8) | Notes |
|---|---|---|---|
| DictaLM-3.0-24B-Thinking Q4 | 21/26 · slow | 4/8 | tools work; invents tags; long think |
| DictaLM-3.0-Nemotron-12B-Instruct Q4 | 17/26 | 3/8 | **prints** tool calls as text |
| gemma-4-12B QAT | much stronger | 14/16 | same size class, better loop |

So DictaLM remains the **Hebrew specialist to re-test on the dreams track** (next experiments) —
not the default primary for the Mac recommendation today.

---

## 3. Best programmer / agentic local LLMs (tool-use co-pilots)

For a CMS co-pilot the scarce skill is **reliable tool use** (read → decide → write a whole
document through tools), not raw Hebrew. Public open weights worth watching:

| Model | Why it matters for Tapuziel | Caveats (public) |
|---|---|---|
| **Qwen3-Coder-Next** | MoE coding agent (≈80B total / 3B active), long context, trained for long-horizon tool use and recovery; HF + LM Studio / MLX-LM listed | Needs current runtime + correct `qwen3_coder` / XML tool parser; older GGUFs and bad templates break tool calls |
| **Qwen3-Coder 30B-A3B** | Smaller MoE coder; fits tighter VRAM than Next | Same parser/template sensitivity; some quants historically weak on complex tools |
| **gpt-oss-20b** (and larger 120b class) | Already on the Tapuziel 5090 table: fastest tool driver when the reply parses (26/27 organizer, strong dreams pace) | LM Studio peg-native parse errors cost ~1/6 turns at six tools — not a recommend until the runtime catches up |
| **Devstral** (Mistral coding line) | Public local agent / multi-file coding reputation; candidate when we want a non-Qwen coder control | Not yet on the Tapuziel dreams scorecard — measure before recommending |

These are **AI-helper / secondary** candidates for the one fixable miss of a dream generalist —
not replacements for the primary until they clear dreams + builder gates on the Mac survey.

---

## 4. Tapuziel recommendation — Mac 128 GB MLX

### Primary — dream generalist

**Gemma 4 26B-A4B at 8-bit MLX** as the Mac primary dream generalist.

- On the 5090 GGUF Q4 survey, `gemma-4-26B-A4B` already matched the 31B on early dreams pace
  (**15/16** at three times the speed of 31B) with one manners miss (extra contact draft).
- Live Mac MLX survey row (parent brief / `eval/battery/mlx-2026-09-20/results.tsv` when present on
  the Mac checkout): **`gemma-26b-a4b-8bit` → 26/28** on the dreams-facing battery. That is the
  number to cite for the Mac recommendation; do not invent other Mac rows here.
- 128 GB unified memory comfortably holds 8-bit MoE + 32K + `--parallel 1` without fighting the
  5090 card sizing story in `LOCAL-LLM.md` §1א.

Keep **Gemma 4 31B** as the known 5090 / "vague sentence" reference from §5; the Mac question was
whether more bits / a model that does not fit 32 GB wins — the 26B-A4B 8-bit row answers with a
dreams score in the same band at MoE cost.

### Secondary — AI-helper for the one fixable miss

Pick **one** secondary, not a zoo:

1. **Coder helper** — Qwen3-Coder-Next (tier C when scheduled) or Qwen3-Coder 30B-A3B, aimed at
   stubborn tool-loop / BenTML structure misses the generalist still has after the door.
2. **Hebrew specialist** — DictaLM-3.0-24B-Thinking (or 12B Nemotron if memory pressure), aimed only
   at Hebrew prose / nikud / owner-voice edges the generalist soft-misses — **after** a dreams-track
   re-run proves the tool loop is no longer the bottleneck.

Do not dual-load both secondaries by default. One helper, one miss class.

---

## 5. What NOT to optimize

From the dreams track and the product doors (`LOCAL-LLM.md` §3):

1. **Inventing pictures and links** — empty media libraries and missing pages are briefing/door
   problems. Optimizing the base model to "guess URLs" is wrong; teach emptiness and bounce once.
2. **Robot hero tags** — scoring models on `hero <XXXX>` specs trains the wrong mouth. Owners do
   not talk like that; the dreams track is the north star.
3. **Training a base LLM from one image (or one site)** — a single screenshot / one BenTML page is
   not a corpus. Fix briefing, doors, and repair; do not fine-tune a foundation model on one asset.
4. **Pretty tool JSON as the KPI** — judge the landing page in the builder.
5. **Unload-everything scripts across LM Link** — never `--all` on a shared mesh; unload by
   identifier only (cluster rule in `RUN-ON-MAC.md`).

---

## 6. Next experiments (no downloads in this note)

Ordered for the Mac survey / product loop. **Cursor survey models only** until Ben says otherwise —
do not queue DictaLM / Coder-Next / extras from this document alone.

1. **DictaLM on the dreams track** — when explicitly allowed: DictaLM-3.0-24B-Thinking (and/or 12B
   Nemotron) through `battery-copilot.js --track=dreams` + theme/page dreams, same 32K /
   `--parallel 1` contract as `mlx-survey.sh`. Question: did tool-loop / print-tools habits improve
   since the 5090 GGUF snapshot, or is Hebrew still orthogonal?
2. **Qwen3.8 remount** — remount the already-interesting Qwen 3.8 27B (5090: fast organizer, strong
   second) on Mac MLX bits; compare dreams manners to `gemma-26b-a4b-8bit`, not raw tokens/s.
3. **Qwen3-Coder-Next — tier C** — only on the survey's tier C slot when Ben opens non-Cursor
   weights: tool-loop stress (printed second try, silent after read, BenTML closer typos) as a
   **helper**, scored by builder landing. Confirm LM Studio / MLX tool parser before trusting a row.
4. Leave **gpt-oss-*** and **Devstral** as optional controls after the runtime parse story is clean.

---

## Sources (public)

- Tapuziel: `docs/LOCAL-LLM.md` (dreams track, §5 scorecards), `eval/battery/RUN-ON-MAC.md`
- Dicta: https://dicta.org.il/dicta-lm-3 · arXiv 2602.02104 · HF `dicta-il/DictaLM-3.0-*`
- Qwen3-Coder-Next: https://huggingface.co/Qwen/Qwen3-Coder-Next (tool-call parser notes in
  vLLM/sglang docs; local GGUF/MLX caveats in community runbooks)
- Mac live row cited above: `eval/battery/mlx-2026-09-20/results.tsv` on the Mac checkout
  (`gemma-26b-a4b-8bit` 26/28) — read locally when present; not required to re-download weights

---

*Written 2026-09-20 (Asia/Jerusalem). Research only — no survey script edits, no model unload.*
