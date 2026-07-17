# BenTML is the new HTML (closed system)

## Contract

| Layer | Role |
|-------|------|
| **Visual page builder** | How humans act (drag, split, resize, style, double-click text) |
| **BenTML output** | The **code of the page** under language rules — decompiled live |
| **compile** | Optional reverse: paste BenTML → modules |
| **Publish HTML** | Browser delivery only — not the authoring language |

Authoring source of truth: **BenTML** (what the decompiler produces as you build).

## Live accumulation — and the dance (v0.77)

Every builder change:

1. Updates the module tree  
2. **Decompiles in the browser** (`window.BentmlEngine`, the real compiler bundled) → full BenTML picture (META, modules, style, nested content)  
3. Shows under the canvas (**BenTML חי**) and in tab **קוד BenTML** — highlighted, editable

And the reverse is live too:

- **Typing in the source compiles as you type** and applies to the canvas (atomic — an error touches nothing, lights the exact line, prints the fix)  
- **Click a block on the canvas** → its BenTML lines glow and scroll into view  
- **Click a line in the source** → the block it compiles to is selected on the canvas  
- Undo (בטל) covers source edits — one step per typing burst

This is not “export as an afterthought.” The output **is** the page file of the system — and now it dances with the canvas.

## Full picture (decompiler captures)

- META: title, slug, direction, SEO description, og:image, robots, tags, teaser…  
- STATS → `STAT(value, label)` children  
- FAQ → `QA(question) { answer }`  
- LOGOS → `LOGO(src, alt, url)`  
- ROW ratio, IMAGE captions, TEXT marks (`@B{}` escaped in source), class/color/style  

Test: `node scripts/smoke-decompile-picture.js`

## Future: Chromium + Tapuz

Plan (not built yet): a Chromium-based shell with Tapuz preinstalled, where BenTML is first-class like HTML was for the open web — **method, security, learning** instead of random AI soup.

Until then: this CMS **deserves** that future only if decompile stays complete and the builder always feeds it.

## UI

- **בונה הדף** — visual + live output dock  
- **פלט BenTML** — full code (copy / apply paste)  
- External chat snippet = download only (`/chat-snippet.txt`) — not an in-app chat  
