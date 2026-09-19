# SCORECARD — 2026-09-19 — Cursor Cloud Agent, v2.45-alpha (PR #20 head)

**HARNESS-ONLY. No live model ran on this VM.** The model rows below are
quoted from PR #20's description, not re-measured. The live 2.45 rows come from
the Mac / 5090 runs (`RUN-ON-MAC.md`).

| | |
|---|---|
| what | PR #20 `claude/copilot-adopts-printed-documents` — *v2.45-alpha — a model that is almost right gets the rest of the way* |
| git SHA | `7a46053` (2 commits over `deeed4a`: `1f09cb7` feat, `7a46053` release) |
| package | `tapuziel@2.45.0-alpha` |
| `main` at run time | still `deeed4a` / `2.44.0-alpha` — 2.45 was **open, not merged** (03:24–03:40 UTC) |
| runtime | Linux (Cursor Cloud VM), Node v24.21.0, validated in a detached worktree of the PR head |
| model reachable | none (no `LOCAL_LLM_*`, nothing on `127.0.0.1:1234`) |
| `battery:copilot` | exists; gates with `BATTERY COPILOT: SKIPPED`, exit 0 (verified on 7a46053) |

## 1. The four v2.45 changes — each pinned by a passing smoke

| change | smoke | assertion (verbatim from the log) |
|---|---|---|
| 1. A PRINTED document is adopted as the proposal (`ai.adoptPrintedDocument`) | `smoke-copilot-tools` | *a printed NEW page becomes a create_page card — same gate, nothing written*; *a page the model READ this turn, printed back → an edit_page card for that page*; *an existing page the model did NOT read this turn is never adopted*; *a reply cut at max_tokens is never adopted*; *a printed `<bent-menus>` document becomes an organize_menu card WITH the door's preview — and nothing moved*; *a printed menu from a model that never called read_menus is NOT adopted — describe-only (gate 3)*; *an undeclared tool is never adopted*; *an adopted document is judged like a called one: the door's refusal goes back to the MODEL* |
| 2. A closing tag that almost matches is read as the open element (`fixCloserTypos`) | `smoke-pzn-repair` | *`</bent/heading>` and `</int-hero>` are read as the elements that were open*; *`</bent_qa>` → `</bent-qa>`*; *a plain HTML closer is never touched*; *a REAL other module as the closer is a structural error, not a typo — left for the parser to refuse* |
| 3. The door names the fix | `smoke-pzn-repair` | *E_CHILD says what the container ACCEPTS*; *E_NOT_CONTAINER says the module is a leaf and names its attributes* |
| 4. Honesty guard after a refused proposal | `smoke-copilot-tools` | *a refusal followed by plain words: no card, the model's sentence is kept — and the notice says nothing was saved, whatever the reply claims*; *an ordinary reply carries no such notice* |

The battery script itself changed: T9 now accepts the door's ✓ fit line (an
"עוד" fold) as well as fewer-than-ten top-level items, and `--courier=relay`
records what the door told the model about each refused proposal (`refusals`
in the JSON, `↩` lines on the console). Both are harness changes, not product
changes; the local courier's output shape is unchanged.

## 2. What ran on `7a46053` (Node 24.21.0, Linux)

| targeted smoke | result |
|---|---|
| `smoke-copilot-tools` (+122 lines in 2.45) | PASS |
| `smoke-pzn-repair` (+37 lines in 2.45) | PASS |
| `smoke-ai-window`, `smoke-no-briefing`, `smoke-inject-route`, `smoke-inject-worker`, `smoke-copilot-route`, `smoke-turn-clock`, `smoke-local-llm`, `smoke-byok`, `smoke-menu-organizer`, `smoke-menu-render`, `smoke-agent-bridge`, `smoke-extension-v2a`, `smoke-version` | all PASS |

| suite | result |
|---|---|
| `npm run test:smoke` (169 scripts) | **exit 0** (PR says 168/169 on Windows — the win32-only `smoke-update-bridge`; green on Linux) |
| `npm run test:pzn` | **158/158** |

The v2.44 fixes stay pinned on 2.45 (`WINDOW_SHARED`, `roomForRead`, the 30 s
socket lift, the `lost` preflight — same assertions as
`SCORECARD-2026-09-19-cursor-harness.md`, all still PASS).

## 3. Model rows — quoted from PR #20, not measured here

RTX 5090, `--parallel 1`, copilot battery @32K, before → after (Claude's lane):

| Model | before | after |
|---|---|---|
| gemma-4-12B QAT | 24/26 | 26/26, 25/26 |
| gemma-4-12B Q4_K_M | 23/26 · 8K 10/13 | 25/26 · 8K 12/13 |
| qwen3.6-35b-a3b | 23/26 | 24/26 |
| gemma-4-26B-A4B | 25/26 | 25/26, 23/26 (misses moved) |
| gemma-4-E4B | 12/26 | 12/26 |
| gemma-4-31B · qwen3.8-27b (regression) | 13/13 | 13/13 ×2 · 13/13 |

`docs/LOCAL-LLM.md` §5's model table is unchanged by PR #20; the new section
is §3ב. The §5 recommendation (Gemma 4 31B recommended; qwen3.8-27b equal and
faster; nemotron not recommended) is neither confirmed nor contradicted from
this VM.

## 4. Not touched

No source change, no `extension/` / `extension-v2a/` change (Bridge stays
0.5.5, as the PR says), no force-push, no secrets. Nothing unloaded anywhere;
`lms unload --all` was neither run nor recommended; the 5090 / Windows LM
Studio was not driven.
