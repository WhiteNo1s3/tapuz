# Tapuziel North Star — all-in-one, agent-native, free CMS

## Position

Users today bounce between:

- WordPress + Elementor (pay for page builder)
- “Free” templates that look like Bootstrap leftovers  
- ChatGPT that dumps unmaintainable HTML

**We stop that journey.** One package:

| Layer | Role |
|-------|------|
| **BenTML** | Private language. Free-tier Grok / ChatGPT / Gemini only need our syntax. |
| **compile / decompile** | Agent is the *author*; CMS is the *compiler* into page-builder modules. |
| **Page builder** | Interactive: containers, drag-drop, split, **resize halves**, double-click text, style panel. User **acts**, does not think HTML. |
| **CMS body** | Site, publish, media, menus, theme, SEO, updates path, security path — **starting point above** “CMS + plugin store”. |

No “install a page builder plugin.” It **exists**.

## Agent loop (product)

```
Any free-tier agent + docs/agent-free-tier-pack.md
        → BenTML source
        → compile → modules on canvas (user sees vivid page)
        → drag / resize / style without code
        → publish → website
        → decompile when agents need the file again
```

## Builder edge (now)

- Modules in **containers** (columns marked מכולה)
- Drag-drop, split page into columns
- **Resize column ratios** (halves, 2:1, …) — visual + `ratio` for agents
- Select module → side settings (content + **style advanced**)
- Double-click text → edit in place
- SEO fields on page (description, og:image, robots) — not a plugin

## Skeleton of the whole shabang (roadmap posture)

1. Language + builder reaction (compile path) ✅  
2. Interactive canvas + style + column resize ✅ edge  
3. SEO / site / media / menus (shipping Tapuz base) ✅ growing  
4. Security tier-1 phase (auth, CSRF, uploads, encryption) — pre-beta  
5. CRM → store — ✅ the store (v2.53): one flip opens it, written in BenTML (`<bent-store>`), carried whole by the `.pzn` — the same “all in package” rule ([bent-store.md](bent-store.md))  

## Success metric

A user can:

1. Paste free-tier agent BenTML → page appears  
2. Drag modules, split, resize, style without leaving Tapuz  
3. Publish SEO-aware HTML  
4. Never need a competing CMS for “the page builder part”

## Free forever positioning

Private CMS, open language, no DRM on the dialect. Business is mastery + ecosystem (`.pzn` packages later), not locking the builder behind a paywall plugin.
