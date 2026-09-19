# SCORECARD — 2026-09-19 — Cursor Cloud Agent, v2.44 FIXED code

**These numbers are HARNESS-ONLY. No live model ran.** Every model row in
docs/LOCAL-LLM.md §5 is quoted, not re-measured — see "Why no model" below and
`RUN-ON-MAC.md` beside this file for the command that produces the live rows.

| | |
|---|---|
| git SHA | `deeed4a7c8044472e6f12e607f96022dc6def8b3` (`origin/main`, PR #18 merged 02:21 UTC) |
| package | `tapuziel@2.44.0-alpha` |
| v2.45 | **not on GitHub at run time** (03:00–03:15 UTC): `main` = deeed4a, no other branch, no tag, no open PR. Re-run this card when it lands. |
| runtime | Linux (Cursor Cloud VM), Node v24.21.0 (nvm; the VM's default `/exec-daemon/node` is v22 — below `engines`) |
| instrument | `scripts/battery-copilot.js` exists on `main`; `npm run battery:copilot` exists; with no `LOCAL_LLM_BASE` it exits 0 with `BATTERY COPILOT: SKIPPED` (verified) |
| model reachable | **none** — no `LOCAL_LLM_*` / `EVAL_*` env vars, nothing on `127.0.0.1:1234` or `:11434`, no Cloud Agent secret for it |

## 1. The copilot battery vs §5 — what this run can and cannot say

| Model (§5 row, RTX 5090, `--parallel 1`) | Window · courier | §5 result | this run |
|---|---|---|---|
| gemma-4-31b Q4_K_M | 32K · local ×3 | **39/39**, 1 soft | not run — no model |
| gemma-4-31b Q4_K_M | 32K · relay | **13/13** | not run — no model |
| gemma-4-31b Q4_K_M | 8K · local / relay | **13/13** / **13/13** | not run — no model |
| qwen3.8-27b Q6_K | 32K · local ×2 | **26/26**, 2 soft | not run — no model |
| qwen3.6-35b-a3b Q4_K_M | 32K · local ×2 | 23/26 | not run — no model |
| nemotron-3-nano-omni Q4_K_M | 32K · local ×2 | 18/26 | not run — no model |

No PASS/FAIL number was invented. The §5 recommendation (Gemma 4 31B
recommended; qwen3.8-27b equal and faster; nemotron not recommended) is
neither confirmed nor contradicted by this run.

### 1א. One live line, from the Mac — a 2.44-era run (reported by Ben, not measured here)

| Model | Build / machine | Window · courier | PASS | Soft | Seconds | artifact |
|---|---|---|---|---|---|---|
| google/gemma-4-31b | **MLX** (Mac LM Studio), `LOCAL_LLM_MODEL` empty | local ×1 | **7/13** | 3 | 1002 | `eval/battery/2026-09-19T03-17-16-model-local.md` (Mac, git-ignored) |

The stamp is 03:17:16 UTC (06:17 IDT) — **before** PR #20 merged (03:27 UTC)
and before the Mac's ff-only pull to `87493ac`, so this is **2.44 code**, and
a different build of the model (MLX, more bits) on a different machine than
§5's 5090 GGUF row. It is a new line, not a re-measurement of 39/39, and it
is not the 2.45 re-measure either. The gap to §5's 13/13 is real and
unexplained from this VM: the `.json` beside the `.md` holds every turn
(`✗` hard misses, `used[]`, `window`, seconds) and the `battery:` header
line in the console log says which window LM Studio reported — the first
things to read before naming a cause (build, window, `--parallel`, or the
code). The 2.45 re-measure (Mac, `87493ac`) is pending: its first process
exited after init with no `eval/battery/` file written — the battery writes
its artifacts only at the end, so an early exit leaves nothing; the console
`.out` carries the reason (`BATTERY COPILOT: crashed — …` is exit 2) — and
has been restarted. Both facts are Ben's report (03:32 UTC), not this VM's
measurement.

## 2. What DID run — every v2.44 fix, pinned by its smoke (all PASS)

The five fixes in `13fe05e` ("a turn outlives thirty seconds, a read outranks
old chat, a menu does not lose pages quietly") each have a hard assertion that
fails on v2.43 code and passes here:

| v2.44 fix | smoke | the assertion that pins it |
|---|---|---|
| 1. `/admin/api/ai/chat` lifts the 30 s socket cap to `turnCeilingMs()` | `smoke-inject-route` | *a copilot turn whose model is silent past the idle cap still reaches the owner — /admin/api/ai/chat lifts the cap for its socket* (1.5 s cap in the test, 30 s live) |
| 2. The window is a pool → `WINDOW_SHARED`, no retry, window cache untouched | `smoke-ai-window` (s) | *a filled pool → WINDOW_SHARED, in Hebrew, with the setting in .fix (Max Concurrent Predictions → 1, --parallel 1)*; *the window it knew is untouched (32,768 by probe — the pool error teaches nothing)*; `smoke-byok`: the vocabulary carries `WINDOW_SHARED` |
| 3. A read outranks old chat at 8,192 (`roomForRead`) | `smoke-ai-window` (h2) | *a page that fits the window is READ even when old chat was in the way*; *the OLD turns left to make the room; the owner's current message and the read stayed*; *the request still fits the 8,192 plan* |
| 4. A menu that loses pages is sent back once (`lost`), unless the owner asked | `smoke-copilot-tools` | *judged against the OWNER's words: "הסר את צור קשר מהתפריט" / "remove contact" pass straight to the card*; *only ONCE: a model that insists reaches the card (lostAsked) — PAGES_MISSING still on the card*; *a page that was NEVER in a menu is not "lost"* |
| 5. The copilot briefing carries its own contract (no paste-flow `PZN_READY`) | `smoke-no-briefing`, `smoke-copilot-route` | both tiers of the real briefing pass the `NO_BRIEFING` gate; the route smoke's chat surface, window chip and lean-mode notice |

Targeted set (each run alone, Node 24.21.0):

| smoke | result |
|---|---|
| `smoke-ai-window` | PASS |
| `smoke-copilot-tools` | PASS |
| `smoke-no-briefing` | PASS |
| `smoke-inject-route` | PASS |
| `smoke-inject-worker` | PASS |
| `smoke-copilot-route` | PASS |
| `smoke-turn-clock` | PASS |
| `smoke-local-llm` | PASS |
| `smoke-byok` | PASS |
| `smoke-menu-organizer` | PASS |
| `smoke-menu-render` | PASS |
| `smoke-agent-bridge` | PASS |
| `smoke-extension-v2a` | PASS (Bridge 0.5.5 glue, unchanged in v2.44) |
| `smoke-version` | PASS |
| `smoke-bridge-run` | SKIPPED, exit 0 (needs a model) |
| `smoke-local-live` | SKIPPED, exit 0 (needs a model) |
| `battery-copilot --courier=local --runs=1` | SKIPPED, exit 0 (needs a model) |

Whole suite:

| suite | result |
|---|---|
| `npm run test:smoke` (169 scripts, `&&`-chained) | **exit 0 — 169/169** (the doc's 168/169 was `smoke-update-bridge` on win32; it passes on Linux) |
| `npm run test:pzn` | **158/158** |

## 3. Why no model, and how to get one

The Cloud VM's loopback is not Ben's Mac. The battery's `local` courier goes
through the CMS's loopback-only rule (`src/providers.js`), so a LAN or public
address cannot be typed in; the `relay` courier calls the runtime from the
battery process, but the VM has no route to the Mac's LAN either. The doc's
own answer (LOCAL-LLM.md §2א "Cursor Cloud Agent") is a reverse tunnel landing
LM Studio on the VM's `127.0.0.1:1234` — nothing like that exists here, and
Ben's 5090 / Windows LM Studio is Claude's lane and was not touched.

So the live rows come from the Mac: `RUN-ON-MAC.md` §2. Expected artifacts:
`eval/battery/<stamp>-tapuz-gemma-local.json` + `.md` (and `-relay`,
`-relay-8192`). Nothing was unloaded anywhere; `lms unload --all` was neither
run nor recommended.

## 4. On Grok's Direct C-suite (`challenges.mjs`)

- `challenges.mjs` is **not in the repository** (`git ls-files` finds no
  `challenge*` / `direct*` file); it lived outside the tree.
- A Direct `chat/completions` call to LM Studio bypasses `buildCopilotBriefing`,
  the tool loop, the approval gate and the doors. LOCAL-LLM.md §1ב measured
  exactly that as C1 (2026-09-17, Gemma 4 31B): `FAIL_INVENT` — an invented
  fence, zero `bent-*` tags — and states it is *expected and will stay
  expected*, because no model knows BenTML without the briefing.
- So the earlier Direct scores were stale twice over: they predate the v2.44
  fixes **and** they never measured the product path. The battery is the
  instrument; a Direct score should not be compared to §5 at all.
