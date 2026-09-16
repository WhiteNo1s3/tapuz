# Testing the injections against a local model (LM Studio)

Ben's rule: *"we have our own friendly AI pipeline with API key when the user is paying per token — we are to make this area function seamlessly; we can test with the local LLM."* The CMS's `local` provider speaks the OpenAI chat endpoint any local runtime exposes (LM Studio, Ollama's OpenAI shim, llama.cpp server), on loopback only — a public host typed into the "local" box is refused before any key is attached (`src/providers.js`, `scripts/smoke-local-llm.js`).

## 1. Load the model (LM Studio)

```bash
"$USERPROFILE/.lmstudio/bin/lms.exe" server start --port 1234
"$USERPROFILE/.lmstudio/bin/lms.exe" load google/gemma-4-31b --gpu max --context-length 32768 --identifier tapuz-gemma -y
"$USERPROFILE/.lmstudio/bin/lms.exe" ps
```

Gemma 4 31B is dense: at `--gpu max` with nothing else on the card it runs ~40–50 tokens/s (18.5 GiB + the KV cache); at `--gpu 0.8` it crawled to ~6 tokens/s, so close the game first. The 3B-active MoEs (qwen3.6-35b-a3b, nemotron) tolerate partial offload — `--gpu 0.6` keeps them at ~20 tokens/s beside a game — but score lower (see §5). **32K is the context the copilot wants** — the full site-builder dictionary (45K chars ≈ 15K tokens on Gemma), a page read back, the reply and the conversation all fit; the packs on `/admin/inject` are happy with 24K. Why 32K, what happens below it and what each window costs in VRAM is §1א. `reasoning_effort: 'none'` is sent by the CMS and honoured (0 reasoning tokens).

## 1א. חלון ההקשר — the window (v2.32)

Ben, when the copilot answered nonsense and then refused: *"`[google/gemma-4-31b] Engine protocol predict request returned 400: {"error":{"code":400,"message":"request (17246 tokens) exceeds the available context size (8192 tokens), try increasing it","type":"exceed_context_size_error","n_prompt_tokens":17246,"n_ctx":8192}}` … I needed 2 turns to get a respond that not related to the conversation"* — and later: *"I think context should be way above 32 — it wouldn't release a right page, and there ain't no pagebuilder to see it on … people are limited to 16GB sometimes."* The window is the whole story of that day, so here it is in one place.

**Where 8,192 comes from.** LM Studio's GUI loads a model with its *default* context length, and the default is 8,192. Its server also has `justInTimeModelLoading: true` (`~/.lmstudio/.internal/http-server-config.json`): a request that names a model which is not loaded makes LM Studio load it — at that same default. So the CMS itself can cause the 8K load just by naming the model first. `lms load` with `--context-length` is the explicit way; the GUI's per-model default (My Models → ⚙ next to the model → Context Length) is what a JIT load uses.

**The rule: 32K is the floor for page building.** The copilot's briefing is the site's whole module dictionary (96 modules, ≈ 15K tokens on Gemma), plus a page it reads back (3–10K), plus the reply (2–4K), plus the tools and the conversation. That is a 32,768 window with room to breathe, and it is the only window in which the copilot sends the **full** dictionary (`FULL_MIN_WINDOW_TOKENS`). Anything smaller runs the **compact** briefing — one line per tool, the whole vocabulary in ≈ 9.5K chars (measured: 9,425 against 45,322 for the full briefing) — which builds short pages fine but cannot take a long existing page into an edit; the copilot says so in its welcome line instead of guessing. A window the compact briefing does not fit either is refused with the click path (`WINDOW_TOO_SMALL`). The full dictionary is sent only for a window the CMS has **measured** (probed, hinted by the bridge, or learned from an error) or for a cloud key; an advisory or unknown window never promotes to full.

**Silent halving — the enemy that returns HTTP 200.** Measured on this box with Gemma at 8,192: the 45K-char briefing (15,179 prompt tokens) came back **200** with a coherent-sounding reply, because the llama.cpp engine discards the *middle* of an over-long prompt — the dictionary, the example, the contract, the older turns — and keeps the head. The 400 above only fires when the prompt is at least **twice** the window:

| prompt vs window | LM Studio answers |
|---|---|
| `n_prompt < n_ctx` | normally |
| `n_ctx ≤ n_prompt < 2 · n_ctx` | **200**, middle of the prompt discarded — a hollow or unrelated reply |
| `n_prompt ≥ 2 · n_ctx` | **400** `exceed_context_size_error` with `n_prompt_tokens` and `n_ctx` |

Ben's 17,246-token request errored only because half of it was still over 8,192; a smaller briefing would have been quietly truncated instead. So the error is the lucky case, and the copilot never relies on it:

1. **Before sending** it reads the window. Server-side (`מודל מקומי`): `GET http://127.0.0.1:1234/api/v0/models` — LM Studio's native REST, no auth — reports per model `state`, `loaded_context_length` and `max_context_length`; a model that is `not-loaded` is flagged as a JIT load about to happen at the default. Hosted (Bridge V2): the page asks the extension to make the same call (allowed since bridge **0.5.0**) and sends the number with every turn. The exact `exceed_context_size_error` body is the third source — `n_ctx` is learned from it, the briefing drops a tier and the turn is retried once, with a Hebrew notice in the chat.
2. **After every reply** it compares `usage.prompt_tokens` with the window it knows (`usage` rides `stream_options.include_usage`, so it reaches the page through a streaming bridge too). `prompt_tokens > window` proves the model answered from a halved prompt: that reply is discarded — never shown, never stored — and the turn is retried one tier down; a second miss ends with the click path.
3. The copilot tells you which mode it is in: `חלון 8,192 · מקוצר` / `חלון 32,768 · מלא` on the chat screen and in the builder's drawer, and the connection test on `/admin/ai-setup` prints the window sentence under the ✅ line.

**How to set it.** In LM Studio: **My Models → ⚙ next to the model → Context Length → 32768 → Reload** (this also fixes the JIT default for that model). Or in a terminal:

```bash
"$USERPROFILE/.lmstudio/bin/lms.exe" load google/gemma-4-31b --gpu max --context-length 32768 --identifier tapuz-gemma -y
```

**What a window costs (`lms load --estimate-only -c <n> --gpu max`, this box, Q4_K_M unless noted):**

| model | 8K | 16K | 32K | 64K |
|---|---|---|---|---|
| google/gemma-4-31b (dense, 19.9 GB file) | 21.3 GiB | 23.6 GiB | **28.1 GiB** | 37.1 GiB (over a 32 GB card → partial offload → slow) |
| qwen/qwen3.6-35b-a3b (MoE, 3B active, 22.1 GB) | 21.4 GiB | – | **22.2 GiB** (the KV cache is cheap on this MoE) | – |
| qwen/qwen3.8-27b (dense Q6_K, 23.4 GB) | 25.3 GiB | – | 28.9 GiB | – |

Guidance by card:

- **16 GB** — none of the models above fit at full offload at any window. Load a smaller model at 32K (≈ 12B dense, or a 3B-active MoE at Q4 with ~9–10 GB of weights), or accept CPU offload and the speed that comes with it. The copilot's compact mode is the fallback, not the plan.
- **24–32 GB** (a 4090 / 5090) — Gemma 4 31B at **32K** fits with nothing else on the card (28.1 GiB); close the game first. Qwen 3.6 35B-A3B at 32K is the cheap alternative (22.2 GiB).
- **A cluster / a workstation card** — 64K–128K; the full dictionary plus several long pages in one conversation.

**Bridge V2 0.5.0.** The hosted flow needs the extension to (a) stream tool calls — 0.4.0 dropped `delta.tool_calls`, so every `list_pages` / `read_page` / `edit_page` came back as an empty reply, which was the other half of Ben's "unrelated" turn — (b) forward the model's error body, so the 8K explanation reaches the page instead of "no response", and (c) call `/api/v0/models` for the window. The ZIP is built from the CMS, so an update ships with it: download Bridge V2 again from `/admin/ai-setup`, reload it at `chrome://extensions` (or `about:debugging` in Firefox) and refresh the admin tab. An older bridge still works for plain chat, and the page says which version it sees and what it cannot do with it.

**Bridge V2 0.5.2.** Two things the live site taught with gemma-4-31b. (a) The connected site now survives a Reload: the tracked manifest names no site — the repo is public and `.gitleaks.toml` refuses a `*.hostingersite.com` hostname — so the site rides the popup's dynamic registration, and that went dark after `git pull` + Reload of the unpacked tree. The worker keeps its own record of connected sites (`storage.local` → `sites`) and re-registers them on every boot; a site whose grant is gone shows in the popup as stale with **חבר מחדש**. Do not patch the manifest with your hostname — connect once from the popup and it stays. An owner who connected from an older popup connects **once more** after updating: Chrome drops dynamic registrations on update and Reload before the new worker boots, so there is nothing left to adopt (measured). A site wired by the ZIP downloaded from it (0.5.1) is unaffected. (b) Long turns no longer die at two–three minutes: before the first token the model is *reading* the prompt (a 45K briefing plus history, and the whole conversation again after an approval), and 0.5.0 capped that at the same two minutes as mid-stream silence. The first-frame ceiling now mirrors the server's twenty minutes (`LOCAL_TIMEOUT_MS`), the server sends `timeoutMs` with every `modelCall`, and the page's default is the same twenty — the error names which silence it caught. (c) The copilot briefing teaches **leaf modules** (`bent-mediacard` and every other non-container take props only — `title=`, `excerpt=` — never nested `bent-heading`/`bent-text`, which is `E_NOT_CONTAINER`), and the tool loop refuses to relay a request that carries no BenTML briefing at all (`NO_BRIEFING`).

## 2. Point the CMS at it

`/admin/ai` → provider **מודל מקומי**, endpoint `http://127.0.0.1:1234/v1`, model `tapuz-gemma` (or leave the model empty for whatever is loaded). The connection test lists the loaded models. From then on every **▶ הרץ עם ה-AI המחובר** button in the admin (the menu organizer on `/admin/menus`, the packs on `/admin/inject`) runs through this endpoint, with the same doors as the paste flow.

## 2א. The site is on a HOST, the model is here — Bridge V2 (v2.29)

Everything above assumes the CMS and the model share a machine. The live site does not: the live site runs on Hostinger, the 5090 sits at home. The server cannot reach LM Studio, and **the page cannot either** — LM Studio answers loopback with no CORS headers at all (its preflight comes back 400 with no `Access-Control-*`), and Chrome's Private Network Access would block a public page reaching a private address anyway. The one context that may do it is a browser extension's background worker with a host permission.

That is Bridge V2 (`extension-v2a`), and it is the only moving part:

```
hosted admin page  ──postMessage──►  content script ──►  background worker ──fetch──►  LM Studio
   (the site)                          (the bridge, per-origin opt-in)                 (127.0.0.1:1234)
```

1. **Install** — `/admin/ai-setup` → the Bridge V2 download for your browser. Chrome/Edge: `chrome://extensions`, Developer mode, drag the ZIP in. Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on (a permanent install needs Mozilla's signature).
2. **Connect the site** — since bridge **0.5.1** the ZIP you downloaded from `/admin/ai-setup` already is: the route writes the host it was served from into that copy's manifest (`content_scripts` + `host_permissions` for `*://<host>/*`, `src/bridge-manifest.js`), so after installing, refresh the admin and the bridge is there. Unzip it **outside** any git checkout — loading `extension-v2a/` straight from the repo gets the source manifest, which names no site (the repo is public) and which the next `git pull` restores anyway; a hand-patched manifest in a checkout is exactly what kept going dark. For another site, or a ZIP downloaded from localhost (never wired, or the bridge would sit on every dev server on the machine): open that admin, then the extension's popup → **״חבר את האתר הפתוח״**. That asks for a host permission for that one origin and registers the content script there; it is injected into the open tab immediately, so nothing needs a reload. The popup lists every connected site — a downloaded one tagged *מההורדה* (turn it off in the browser's site-access settings for the extension) — and disconnects any site it connected.
3. **Choose it in the CMS** — `/admin/ai-setup` → the **🌉 האתר בענן, המודל אצלכם** card names every model your LM Studio has loaded; pick one (or "whatever is loaded") and press **חבר דרך הדפדפן**.

From then on **▶ הרץ עם ה-AI המחובר** on `/admin/menus` and `/admin/inject` runs the pack on your own GPU: the server composes the request, the page carries it to the model, the page brings the reply back, and the same door judges it. No key exists anywhere on this path, the model is never exposed to the internet, and the run still applies nothing — apply is the owner's second click on text they can read.

The extension holds **no credentials, ever**, and the page never names a host: it picks a path from a closed list (`/v1/chat/completions`, `/v1/models`) and the worker supplies the loopback endpoint.

### Cursor Cloud Agent (site on the Linux VM, model on Windows)

Same topology as a Hostinger deploy: the Cloud Agent VM's `127.0.0.1` is **not** your Windows box. `host.docker.internal`, a LAN IP, or typing your Windows address into the CMS **local** provider will not work — `local` is loopback-only by design (`src/providers.js`).

**Dummy / local-dev stand-up on the agent VM:**

```bash
nvm use 24
npm run seed:admin          # admin / admin  (dev only; gitignored config/auth.json)
# wire Bridge V2 as the provider (gitignored config/ai.json):
node -e "require('./src/ai').saveSettings({ provider:'browser', model:'tapuz-gemma', baseUrl:'http://127.0.0.1:1234/v1' })"
PORT=3000 node src/server.js
# → http://localhost:3000/admin
```

Then on Windows: start LM Studio on `127.0.0.1:1234`, open the forwarded admin in your browser, install Bridge V2 from `/admin/ai-setup`, connect the open origin, pick the model. Optional no-browser path: run `scripts/tapuz-worker.js` on Windows with `TAPUZ_SITE` pointing at the agent URL (or a tunnel) and `LOCAL_LLM_BASE=http://127.0.0.1:1234/v1`.

A reverse tunnel that lands LM Studio on the VM's own `127.0.0.1:1234` would unlock the server-side `local` provider; without that tunnel, keep provider `browser` (or the worker).

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

Nemotron's misses are one habit: it invents `page=` slugs that are not in the table (5 replies refused as `TOO_MANY_UNKNOWN`, 4 more landed with `UNKNOWN_PAGE` drops) and it links drafts; it also copied the collapse knob's option list literally as a value, which is why both prompts now state that an `a|b|c` value is a list of options and exactly one is written (the door had already reset the literal to the default). **Gemma 4 31B is now the recommended local model**: a perfect organizer run (27/27, all first-try, 7 s per turn at full offload) and a perfect theme run; Qwen 3.8 27B is a close second and the fastest (3 s per organizer turn, 24/27 first-try); the two 3B-active MoEs are behind on quality. Gemma 4 31B also lives on the Mac's LM Studio as an MLX build with more bits (`~/.lmstudio/hub/models/google/gemma-4-31b`) — serve it on the local network and run the eval with `EVAL_BASE=http://<mac-ip>:1234/v1 EVAL_MODEL=google/gemma-4-31b … --provider=direct` (the CMS's local provider is loopback-only by design; direct mode keeps the prompt, the door and the scoring). Earlier probes: theme-designer pack (17K chars ≈ 7K tokens) → a valid `<bent-theme>` in 71 s with zero warnings; site-builder full (44K chars) → a clean page in 131 s with zero repairs; site-builder lite → landed after the repair engine closed unclosed leaves; a 3.6K-char organizer draft → 3/3 valid `<bent-menus>` documents in 20–27 s, ~1,580 prompt tokens, and no reply used a code fence (which is why every door treats the fence as optional).
