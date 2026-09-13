# Testing the injections against a local model (LM Studio)

Ben's rule: *"we have our own friendly AI pipeline with API key when the user is paying per token — we are to make this area function seamlessly; we can test with the local LLM."* The CMS's `local` provider speaks the OpenAI chat endpoint any local runtime exposes (LM Studio, Ollama's OpenAI shim, llama.cpp server), on loopback only — a public host typed into the "local" box is refused before any key is attached (`src/providers.js`, `scripts/smoke-local-llm.js`).

## 1. Load the model (LM Studio)

```bash
"$USERPROFILE/.lmstudio/bin/lms.exe" server start --port 1234
"$USERPROFILE/.lmstudio/bin/lms.exe" load google/gemma-4-31b --gpu max --context-length 24576 --identifier tapuz-gemma -y
"$USERPROFILE/.lmstudio/bin/lms.exe" ps
```

Gemma 4 31B is dense: at `--gpu max` with nothing else on the card it runs ~40–50 tokens/s (18.5 GiB + the KV cache); at `--gpu 0.8` it crawled to ~6 tokens/s, so close the game first. The 3B-active MoEs (qwen3.6-35b-a3b, nemotron) tolerate partial offload — `--gpu 0.6` keeps them at ~20 tokens/s beside a game — but score lower (see §5). 24K context takes the full site-builder dictionary (44K chars ≈ 14K tokens) with room for the reply. `reasoning_effort: 'none'` is sent by the CMS and honoured (0 reasoning tokens).

## 2. Point the CMS at it

`/admin/ai` → provider **מודל מקומי**, endpoint `http://127.0.0.1:1234/v1`, model `tapuz-gemma` (or leave the model empty for whatever is loaded). The connection test lists the loaded models. From then on every **▶ הרץ עם ה-AI המחובר** button in the admin (the menu organizer on `/admin/menus`, the packs on `/admin/inject`) runs through this endpoint, with the same doors as the paste flow.

## 2א. The site is on a HOST, the model is here — Bridge V2 (v2.29)

Everything above assumes the CMS and the model share a machine. The live site does not: `<live-site>` runs on Hostinger, the 5090 sits at home. The server cannot reach LM Studio, and **the page cannot either** — LM Studio answers loopback with no CORS headers at all (its preflight comes back 400 with no `Access-Control-*`), and Chrome's Private Network Access would block a public page reaching a private address anyway. The one context that may do it is a browser extension's background worker with a host permission.

That is Bridge V2 (`extension-v2a`), and it is the only moving part:

```
hosted admin page  ──postMessage──►  content script ──►  background worker ──fetch──►  LM Studio
   (the site)                          (the bridge, per-origin opt-in)                 (127.0.0.1:1234)
```

1. **Install** — `/admin/ai-setup` → the Bridge V2 download for your browser. Chrome/Edge: `chrome://extensions`, Developer mode, drag the ZIP in. Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on (a permanent install needs Mozilla's signature).
2. **Connect the site** — open your admin, then the extension's popup → **״חבר את האתר הפתוח״**. That asks for a host permission for that one origin and registers the content script there; it is injected into the open tab immediately, so nothing needs a reload. The popup lists every connected site and disconnects any of them.
3. **Choose it in the CMS** — `/admin/ai-setup` → the **🌉 האתר בענן, המודל אצלכם** card names every model your LM Studio has loaded; pick one (or "whatever is loaded") and press **חבר דרך הדפדפן**.

From then on **▶ הרץ עם ה-AI המחובר** on `/admin/menus` and `/admin/inject` runs the pack on your own GPU: the server composes the request, the page carries it to the model, the page brings the reply back, and the same door judges it. No key exists anywhere on this path, the model is never exposed to the internet, and the run still applies nothing — apply is the owner's second click on text they can read.

The extension holds **no credentials, ever**, and the page never names a host: it picks a path from a closed list (`/v1/chat/completions`, `/v1/models`) and the worker supplies the loopback endpoint.

### Why the bridge streams (and why it had to)

Both browsers evict an idle background script after ~30 seconds, and Chrome is explicit about the case that matters here: a service worker is terminated **"when a `fetch()` response takes more than 30 seconds to arrive"**, with a hard five-minute ceiling on any single request ([Chrome: service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)). A non-streaming relay is exactly that shape — one fetch, silent for the whole generation — so it would have died on anything slower than a quick pack. Firefox is no escape: its MV3 event page idles out the same way ([bug 1851373](https://bugzilla.mozilla.org/show_bug.cgi?id=1851373)); what keeps it alive is an open message port, which is the same lever Chrome gives.

Measured here (gemma-4-31b on a 5090, the real organizer pack at 6,918 chars):

| | non-streaming | streaming |
|---|---|---|
| first token | — | 0.4 s warm, 4.2 s cold |
| longest silence the worker sees | the whole generation (9–13 s here, 131 s for a site-builder pack) | **47 ms** |
| token accounting | full | full (`stream_options.include_usage`) |

So Bridge V2 (0.4.0+) streams every chat call over a `runtime.Port`: chunks arrive every few tens of milliseconds, each one is an event that resets the idle timer, the port itself keeps a Firefox event page loaded, and the worker sends a progress message at least every 10 seconds even while the model is still reading the prompt. The page reassembles the stream into the ordinary non-streaming reply, so the CMS composes and parses exactly what it always did — and the card shows the token count climbing instead of a dead spinner. The run's ceiling now measures **silence**, not duration: a model that is visibly writing is never cut off.

What is still out of reach in a browser: a single generation over **five minutes** (Chrome's per-request cap). Nothing the CMS ships comes close on a 31B model — the slowest measured pack is 131 s — but a very large pack on a very slow machine would want a worker process instead of a tab.

```bash
LOCAL_LLM_BASE=http://127.0.0.1:1234/v1 LOCAL_LLM_MODEL=tapuz-gemma node scripts/smoke-bridge-run.js
```

That is the whole hosted flow in one script: it starts a server with **no way to call a model at all**, plays the extension's part itself, and checks that the organizer pack still runs, that the door judged it, and that nothing was applied.

## 2ב. No browser at all — the worker (v2.30)

Bridge V2 still needs an admin tab open, and the browser sets the ceiling: Chrome caps any single request at five minutes. The worker has no such ceiling and no tab. It is one process on the machine that has the model:

```bash
TAPUZ_SITE=https://<live-site> \
TAPUZ_TOKEN=<agent token with read+write> \
LOCAL_LLM_BASE=http://127.0.0.1:1234/v1 \
LOCAL_LLM_MODEL=tapuz-gemma \
node scripts/tapuz-worker.js
```

Mint the token at **ניהול → גשר סוכן** (`/admin/agent`) with both scopes. Then, in the admin, every pack card grows a **🛠 שלחו לעובד שלכם** button beside ▶: it queues the pack and you may close the tab. The worker claims it within a poll, runs it on your GPU, and posts the reply back; when you return, the card shows the reply, the preview and the warnings, and **✅ החל** is the same second click it always was.

What the worker does and does not do:

- It **composes nothing**. The site hands it a finished prompt and, if the door asks for the one repair turn, the finished repair prompt too. Every decision stays on the server.
- It streams from the local runtime, so nothing times out and you can watch the token count in the terminal.
- A model failure is **reported** (`{error:{code,message}}`), so a job ends `failed` with a reason you can read rather than hanging as `running`.
- It talks to loopback only for the model, and refuses a public model address outright.
- The token lives in the environment, never in a flag and never in a log line.

A job that no worker ever claims simply waits; start the worker later and it runs. A claim abandoned for 30 minutes goes back in the queue. The agent API allows 120 requests per minute per address, so leave `TAPUZ_POLL_MS` at a second or more — the 5-second default asks twelve times a minute.

## 3. The live smoke — one real run, end to end

```bash
LOCAL_LLM_BASE=http://127.0.0.1:1234/v1 LOCAL_LLM_MODEL=tapuz-gemma node scripts/smoke-local-live.js
```

Spawns a server on a temp root seeded with the ten-item live menu, logs in as admin, calls `POST /admin/api/inject/menu-organizer/run`, and checks: the reply is a `<bent-menus>` document the door parsed, at most one repair round, no hard warning, under 240 s, usage reported, the paste of the same reply gives the same warnings, and **nothing was applied**. Skips with exit 0 when `LOCAL_LLM_BASE` is not set, so `test:smoke` never needs a model.

## 4. The eval — the 99.9% instrument

```bash
EVAL_MODEL=tapuz-gemma node scripts/eval-injections.js                                  # every pack, 3 runs each
EVAL_MODEL=tapuz-gemma node scripts/eval-injections.js menu-organizer 20 --fixtures=all --repair
EVAL_MODEL=tapuz-gemma node scripts/eval-injections.js menu-organizer 5 --fixtures=live-10 --size=full --variant=B
EVAL_MODEL=tapuz-gemma node scripts/eval-injections.js theme-designer 5
EVAL_MODEL=tapuz-gemma node scripts/eval-injections.js site-builder-lite 5
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

Organizer, final prompt: 27 runs → 25 PASS (92.6%), 24 strict, avg 23 s, p95 50 s, ~3,166 prompt tokens (lite pack); the first prompt scored 7/16 before the fold-tag rule and the scorer's home-as-URL fix. Non-passes on the final prompt: both on nested-existing — a "רק סדר" brief on a nested menu that already fits one row: one reply echoed the menu (NO_CHANGE after the repair round), one dissolved a group (7 top items against the fixture's 6) — the one fixture still under 3/3; every other fixture scored 3/3. Theme-designer: 10/10 PASS, avg 137 s. The live route smoke: PASS — one round, 29 s, the door accepted a fold after 7 items (669px of 880px), nothing applied. The full tables are in `docs/INJECTION-EVAL.md` and the Version Log row for v2.28 in `docs/ROADMAP.md`.

### Model comparison (same suite, same prompts, same doors, 2026-09-13)

| Model (LM Studio, 24K, `--gpu 0.6`) | Organizer 27 runs | Strict | 2nd rounds | Avg s | Theme-designer | Live smoke |
|---|---|---|---|---|---|---|
| qwen3.6-35b-a3b Q4_K_M | 27 landed · **25 PASS** | 24 | 2 | 23 | 10/10 PASS, avg 137 s | PASS, 1 round, 29 s |
| nemotron-3-nano-omni-30b-a3b Q4_K_M | 22 landed · 15 PASS | 5 | 22 | 24 | 10/15 PASS (5 refused: effect JS does not compile), avg 73 s | PASS, 2 rounds, 45 s |
| gemma-4-31b Q4_K_M (dense, full offload, 39 tok/s) | 27 landed · **27 PASS** | 27 | 0 | 7 | 10/10 PASS, 5 clean (a quoting quirk on `secondary=`, dropped by the door), avg 37 s | PASS, 1 round, 12 s |
| qwen3.8-27b Q4_K_M (dense) | 27 landed · **27 PASS** | 24 | 3 | 3 | 10/10 PASS, 8 clean, avg 20 s | PASS, 1 round, 4 s |

Nemotron's misses are one habit: it invents `page=` slugs that are not in the table (5 replies refused as `TOO_MANY_UNKNOWN`, 4 more landed with `UNKNOWN_PAGE` drops) and it links drafts; it also copied the collapse knob's option list literally as a value, which is why both prompts now state that an `a|b|c` value is a list of options and exactly one is written (the door had already reset the literal to the default). **Gemma 4 31B is now the recommended local model**: a perfect organizer run (27/27, all first-try, 7 s per turn at full offload) and a perfect theme run; Qwen 3.8 27B is a close second and the fastest (3 s per organizer turn, 24/27 first-try); the two 3B-active MoEs are behind on quality. Gemma 4 31B also lives on the Mac's LM Studio as an MLX build with more bits (`/Users/<user>/.lmstudio/hub/models/google/gemma-4-31b`) — serve it on the local network and run the eval with `EVAL_BASE=http://<mac-ip>:1234/v1 EVAL_MODEL=google/gemma-4-31b … --provider=direct` (the CMS's local provider is loopback-only by design; direct mode keeps the prompt, the door and the scoring). Earlier probes: theme-designer pack (17K chars ≈ 7K tokens) → a valid `<bent-theme>` in 71 s with zero warnings; site-builder full (44K chars) → a clean page in 131 s with zero repairs; site-builder lite → landed after the repair engine closed unclosed leaves; a 3.6K-char organizer draft → 3/3 valid `<bent-menus>` documents in 20–27 s, ~1,580 prompt tokens, and no reply used a code fence (which is why every door treats the fence as optional).
