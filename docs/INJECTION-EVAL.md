# Injection eval — the packs against the owner's model

Model endpoint: `http://127.0.0.1:1234/v1` (tapuz-qwen) · 3 runs per case · provider cms · size lite · variant A · one repair round · run at 2026-09-12T23:58:31.731Z

Every pack the CMS generates is sent through the CMS's own pipeline (`src/ai.js`) and every reply is judged by the REAL admin door. **Landed** = the door accepted the reply; **PASS** = landed and the result is right for the site (organizer: no hard warning, every published page placed, fits one row or a fold/side/drawer was chosen, not an echo; theme: ≥ 4 sections and the bench compiles; page: ≥ 3 blocks and no raw-html fallback); **strict** = PASS on the first reply; **clean** = no repair and no warning at all.

The 99.9% headline is earned only after ≥ 3,000 scored runs with ≤ 3 non-passes — until then this report says "27 runs, 25 pass".

| Pack | Runs | Landed | PASS | Strict | Clean | 2nd round | Repairs | Warnings | Avg s | p95 s | Prompt tok | Reply tok |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| menu-organizer | 27 | 27 (100%) | 25 (92.6%) | 24 (88.9%) | 24 (88.9%) | 2 | 0 | 3 | 23 | 50 | 3166 | 319 |

## Menu organizer — per fixture site

| Fixture | Runs | PASS | Strict | Avg coverage | Avg s | Top codes |
|---|---|---|---|---|---|---|
| blog-30 | 3 | 3 (100%) | 2 | 100% | 30 | — |
| drafts-mixed | 3 | 3 (100%) | 3 | 100% | 16 | — |
| english-ltr | 3 | 3 (100%) | 3 | 100% | 18 | — |
| live-10 | 3 | 3 (100%) | 3 | 100% | 25 | PARENT_TO_GROUP×1 |
| long-labels | 3 | 3 (100%) | 3 | 100% | 21 | PARENT_TO_GROUP×1 |
| nested-existing | 3 | 1 (33.3%) | 1 | 100% | 31 | NO_CHANGE×1 |
| relocated-main | 3 | 3 (100%) | 3 | 100% | 21 | — |
| services-12-side | 3 | 3 (100%) | 3 | 100% | 33 | — |
| small-5 | 3 | 3 (100%) | 3 | 100% | 17 | — |

## What the doors had to do (most frequent first)

- `PARENT_TO_GROUP` × 2
- `NO_CHANGE` × 1 — rule 8 — never echo the current menu

## Refusals

- none

Raw replies: `C:\Users\<user>\AppData\Local\Temp\tapuz-eval\replies` · run log: `eval/runs/2026-09-12-<pack>-A.jsonl` · non-passing replies: `eval/failures/<pack>/`
