# Where is what — syntax dictionary & modules

## External chat snippet (outside the product)

We do **not** run chat or AI APIs inside Tapuz.

| Form | Path |
|------|------|
| Snippet for *their* ChatGPT/Grok/… | `public/chat-snippet.txt` (download from toolbox) |
| Source | `docs/chat-snippet.md` · `node scripts/gen-chat-snippet.js` |

Product = **visual page builder + BenTML source paste**. Their chat is their business.

## Syntax dictionary (the map)

| Form | Path |
|------|------|
| **Human markdown** | [`docs/SYNTAX-DICTIONARY.md`](SYNTAX-DICTIONARY.md) |
| **Machine JSON** | `GET /admin/api/syntax-dictionary` |
| **Markdown via API** | `GET /admin/api/syntax-dictionary.md` |
| **Source of truth in code** | [`src/block-registry.js`](../src/block-registry.js) |
| **Generator** | `node scripts/gen-syntax-dictionary.js` |

Full language law: [`bentml-v0.md`](bentml-v0.md) · one-screen: [`bentml-cheatsheet.md`](bentml-cheatsheet.md)

## Modules (17 live)

All modules live in **`block-registry.js`**. The builder toolbox and dictionary are driven from that list.

| Kind | Modules |
|------|---------|
| **Sharp / simple** | HEADING, BUTTON, IMAGE, EMBED, SPACE, DIVIDER, LIST, QUOTE, TESTIMONIAL, FEATURES, GALLERY, ARTICLES, ROW, CARD, HERO, MAP |
| **Advanced container** | **TEXT only** — paragraphs + `@B` `@I` `@LINK` `@CODE` `@BREAK` + lead/dropcap/size/maxwidth |

**Reserved (not built yet):** SECTION, FORM, VIDEO, ACCORDION, TABS, SLIDER, … (see dictionary footer)

## Advanced modules status

- **Not a separate plugin store.** “Advanced” means deeper params on a module.
- **TEXT** is the only intentionally deep content container.
- Style panel (align, color, padding…) is **shared advanced UI** on every selected module — not a STYLE keyword.
- Future reserved keywords become new registry entries + renderer + toolbox when we implement them.

## Regenerate after changing modules

```bash
# edit src/block-registry.js (+ keywords/compile/renderer as needed)
node scripts/gen-syntax-dictionary.js
node scripts/smoke-registry.js
```
