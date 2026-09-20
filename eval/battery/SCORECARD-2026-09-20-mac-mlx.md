# SCORECARD — 2026-09-20 — Mac MLX, dreams first

> **Read this before quoting a row (added from the 5090 side, v2.50).** This card was produced by the FIRST version of
> `scripts/mlx-survey.sh` (code `aa34f60`, package 2.48) — the one `BREAKAGE-2026-09-20-mlx-survey.md` is about. Its header
> says `32768 ctx`; the MLX engine ignores that request and every model here ran at the engine's auto-fit window
> (262,144 on this Mac), with the CMS trimming nothing. The script's window check could not pass, and the run went through
> a wrapper ("via wrap" below). So these are **uncapped rows** — what v2.49+ calls `+autofit`: what a Mac owner gets today,
> **never comparable with a 32K row**, on the 5090 or anywhere. The numbers are real measurements of that condition and stay
> for that reason. The 31B rows failed for a reason the script now handles honestly (LM Studio cannot load a staff pick's
> variant by name — see `RUN-ON-MAC.md`, "THE OTHER VARIANT IS SELECTED"). The re-run on ≥ 2.50 — budgeted at 32K by the
> CMS, every row carrying configured → effective → budgeted → what the battery saw — supersedes this card.

code: `aa34f60` · package `2.48.0-alpha` · LM Studio MLX engine · 32768 ctx · `--parallel 1` · live model runs · 128 GB unified memory

Survey: `scripts/mlx-survey.sh` finished `EXIT:0` at 13:58 IDT after a mid-morning restart (RESTART2). The table below is the **completed remount pass**. An earlier interrupted pass left duplicate TSV rows; those are not re-scored here.

Instrument sanity (Gemma 31B, T2/T4/T13): **3/3 PASS** before measuring.

| model | MLX repo | size in memory | copilot dreams | theme /5 | page /5 |
|---|---|---|---|---|---|
| gemma-31b-8bit | `lmstudio-community/gemma-4-31B-it-MLX-8bit` | DID NOT LOAD (CLI) | - | - | - |
| gemma-31b-4bit | `lmstudio-community/gemma-4-31B-it-MLX-4bit` | DID NOT LOAD (CLI) | - | - | - |
| gemma-26b-a4b-8bit | `lmstudio-community/gemma-4-26B-A4B-it-MLX-8bit` | 27.99 GB | **25/28** · 5 soft · 1004s | **4** | **4** |
| gemma-26b-a4b-4bit | `lmstudio-community/gemma-4-26B-A4B-it-MLX-4bit` | 15.64 GB | **26/28** · 7 soft · 787s | 3 | **5** |
| gemma-12b-8bit | `lmstudio-community/gemma-4-12B-it-MLX-8bit` | 12.75 GB | **24/28** · 6 soft · 2210s | **4** | 2 |
| gemma-12b-4bit | `lmstudio-community/gemma-4-12B-it-MLX-4bit` | 6.77 GB | 10/28 · 3 soft · 2260s | 4 | 0 |
| qwen38-27b-8bit | `lmstudio-community/Qwen3.8-27B-MLX-8bit` | 29.53 GB | 10/28 · 9 soft · 3655s | 4 | 2 |
| qwen35-9b-8bit | `lmstudio-community/Qwen3.5-9B-MLX-8bit` | 10.45 GB | 10/14 · 1 soft · 768s | 3 | 1 |
| gemma-e4b-8bit | `lmstudio-community/gemma-4-E4B-it-MLX-8bit` | 8.97 GB | 5/14 · 6 soft · 555s | 4 | 2 |
| granite-30b-8bit | `lmstudio-community/granite-4.2-30b-MLX-8bit` | 31.11 GB | 6/14 · 3 soft · 3890s | 3 | **5** |
| muse-glimmer-30b-8bit | `mlx-community/Muse-Glimmer-30B-8bit` | DID NOT LOAD | - | - | - |
| bonsai2-27b-2bit | `prism-ml/Ternary-Bonsai-2-27B-mlx-2bit` | DID NOT LOAD | - | - | - |
| gpt-oss-120b | `lmstudio-community/gpt-oss-120b-MLX-8bit` | DID NOT LOAD (resources) | - | - | - |
| mistral-small-4-119b-4bit | `mlx-community/Mistral-Small-4-119B-2603-4bit` | 67.79 GB | 9/14 · 2 soft · 1582s | 4 | 3 |
| qwen3-coder-next-6bit | `lmstudio-community/Qwen3-Coder-Next-MLX-6bit` | 64.76 GB | **13/14** · 3 soft · 563s | **4** | 3 |

**Mac recommendation (dreams cornerstone):** primary still **Gemma 4 26B-A4B** (8-bit 25/28 with theme/page 4/4, or 4-bit 26/28 with page 5/5). Closest “AI helper” on this list: **Qwen3-Coder-Next 6-bit** (13/14 dreams). Gemma 12B 8-bit stays in the same band as 26B on D1–D14 but loses page dreams.

Against the 5090 Gemma 31B GGUF Q4 row in RUN-ON-MAC (dreams 26/28 · theme 4/5 · page 5/5): Mac 26B-A4B is in that class; Mac never measured 31B this pass because the LM Studio CLI refused hub `@4bit`/`@8bit` keys.

## Per model — every ✗, with the owner's sentence and what landed

### gemma-26b-a4b-8bit (25/28) — json `…-tapuz-mlx-gemma-26b-a4b-8bit-local-dreams.json`
- **D9#1** long pasted document (“make it beautiful, with chapters…”): `create_page` built a rich multi-section page, but hard check failed — **13/20 of her facts** (need 14+). Soft miss on “nearly all (18+)”.
- **D4#2** “people can't find how to contact me”: asked the owner, then `create_page` for contact; door notice **E_CHILD** on a proposal; after approve, contact still not judged reachable (placeholders / empty contact facts).
- **D13#2** “put the page back the way it was”: talked about not having prior history; banner **not removed**; module order not restored.

### gemma-26b-a4b-4bit (26/28)
- **D4#1** contact complaint → created/edited path but contact not judged reachable.
- **D2#2** honey “make people order” → **no tools** (talked instead of building).

### gemma-12b-8bit (24/28)
- **D1#1 / D1#2** ceramics studio → **no tools** (both runs).
- **D8#1** breathless “add a line that it's free…” → edit path missed the free/no-card fact landing.
- **D10#2** look-and-feel wish → **no tools**.

### gemma-12b-4bit (10/28)
- Habit: repeated **list_pages / read_page without landing edits** across D1–D4, D6, D9–D12, D14 (both runs). Page dreams **0/5**. Too small at 4-bit for this instrument.

### qwen38-27b-8bit (10/28)
- Run 1: misses on contact, menu tidy, free-line, long doc facts, look-and-feel, hours.
- Run 2: **collapsed** — D4–D14 all **no tools / 0s** after an early stall (instrument still counts them).

### qwen35-9b-8bit (10/14)
- D2 honey **no tools**; D10 look-and-feel; D12 Dana quote not kept verbatim; D14 hours not updated wherever they belong.

### gemma-e4b-8bit (5/14)
- Many **no tools** / read-without-edit on create and edit dreams. Theme packs still 4/5; page packs 2/5. Too small for owner dreams.

### granite-30b-8bit (6/14)
- Slow; D2 no tools; D4 contact; D9 long doc; then D10–D14 **0s / no tools** (stall). Page dreams nonetheless **5/5**.

### mistral-small-4-119b-4bit (9/14)
- D3 enrich-without-delete; D8 free-line **no tools**; D9 long-doc facts; D10 look-and-feel; D11 shorten-but-keep phone/prices.

### qwen3-coder-next-6bit (13/14)
- Only hard miss **D11** shorten-but-keep phone and prices (read without a sufficient edit). Strong tool loop for a coder-labelled weights file.

## Habits (which survive 8 bits, which are new)

- **Survives at 8-bit on the strong Gemma MoE:** create/edit for ordinary Hebrew owner wishes; theme packs stay high; page packs stay high on 26B.
- **Still bites the leader:** long pasted documents under-count owner facts (D9); contact complaint (D4) + door **E_CHILD**; undo/restore (D13) without real history.
- **Worse when bits or size drop:** Gemma 12B 4-bit and E4B slide into **read-only loops** and **no tools** — not a new habit, just sharper.
- **New / sharp on Qwen3.8 this pass:** mid-battery **collapse to silent no-tools** for a whole second run.
- **Coder-Next:** almost no “talk about the page instead of making it”; one keep-facts miss (D11).
- **Does not apply to Muse / Bonsai / gpt-oss-120b:** they never entered the dreams instrument (load failed). That is **not** “they don’t fit the Tapuziel dreams framework” — the framework never saw them.

## Anything the judge got wrong — with the turn from the .json

- **D4 contact (26B 8-bit run 2):** model did build a contact page with form / WhatsApp after an E_CHILD bounce; the hard check still failed (empty/placeholder contact facts). A human might accept the structure and still want real phone/email — borderline, left as fail.
- **D13 undo:** model correctly said it lacked prior revision bytes; check requires banner gone + same modules. Product gap (no revision restore tool) as much as model gap — left as fail per orders (do not soften thresholds).
- No threshold or check text was changed to improve a score.

## What did not download or load, and what LM Studio said

| model | LM Studio / engine words (trimmed) | What it means |
|---|---|---|
| **gemma-31b-8bit / 4bit** | `Model not found` for `google/gemma-4-31b@8bit` and `@4bit` | Weights are on disk under hub variants; **stock `lms load` cannot address `@quant` hub keys** (base key loads the selected 4-bit variant only). CLI limitation on this LM Studio build — not a missing download. Remount for 12B/E4B/Qwen3.8 worked later via wrap; 31B was attempted before that path was solid. |
| **muse-glimmer-30b-8bit** | `ValueError: Model type muse_glimmer not supported. Error: No module named 'mlx_vlm.speculative.drafters.muse_glimmer'` | **Stock Mac MLX / mlx_vlm backend** shipped with LM Studio does not implement this architecture. Not a Tapuziel prompt/framework reject. |
| **bonsai2-27b-2bit** | `Unrecognized video processor` … need `video_processor_type` or a known `model_type` | Weights start loading, then **vision/video preprocessor config is outside what stock transformers/mlx_vlm accept**. Runtime/packaging mismatch, not dreams-brief mismatch. |
| **gpt-oss-120b** | `Model loading was stopped due to insufficient system resources` … adjust guardrails | **Memory guardrail** on the 128 GB Mac at this window — size/fit issue for this load, not architecture. |

### Muse / Bonsai vs the 5090 (for Ben)

These two failed because **the Mac MLX engine in stock LM Studio does not support their model types**, not because owner-dream briefs are the wrong yardstick. Moving them to the **5090** only helps if that node loads them under **its** stack (typically **GGUF + CUDA** in LM Studio, not MLX). If a GGUF (or other supported) build loads there, the same dreams battery can measure them. If the architecture is still exotic on that runtime, the 5090 will refuse them the same way. **gpt-oss-120b** is the clearer 5090 candidate: Mac refused on **resources**; a 32 GB card with Q4 GGUF is the intended other-node path in RUN-ON-MAC.

Mac node does not run the 5090 survey.

## Raw artifacts

- Survey log / TSV / draft: `eval/battery/mlx-2026-09-20/`
- Per-turn json: `eval/battery/2026-09-20T*-tapuz-mlx-*-local*.json`
