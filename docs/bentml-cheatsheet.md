# BenTML Cheat Sheet (v0.1)

> Extracted verbatim from [bentml-v0.md](bentml-v0.md) §19 — the full spec is the source of
> truth; update there first, then re-extract. This block is normative and self-contained:
> paste it alone into any assistant's system prompt (ChatGPT, Gemini, Claude, Grok, DeepSeek)
> to make it a competent BenTML author.

```
BENTML CHEAT SHEET (v0.1) — the whole language on one screen

FILE:  line 1 is exactly:  BENTML 0.1
       then exactly one META block, then body blocks. UTF-8. Nothing outside blocks.

META {                              ← EXACTLY one "key: value" per line
  title: "כותרת העמוד"              ← required; everything else optional
  slug: "כתובת-בעברית"
  direction: rtl|ltr                ← default rtl
  theme: "default"
  description: "..."
  ogimage: "/path.jpg"
  tags: ["א","ב"]
  status: draft|published           ← default draft
  lang: "he"
  author: "שם הכותב"
  date: "2026-01-31"
}

BLOCKS: three shapes — KEYWORD { body } / KEYWORD(params) { body } / KEYWORD(params)
  (in the third, no-body shape the parentheses are optional: bare SPACE / DIVIDER is legal)
  Params are ALWAYS name: value, comma-separated, ALL OPTIONAL unless noted. No positional
  params, no flags. Trailing commas OK. Strings use double quotes with JSON escapes; anything
  with spaces/Hebrew/slashes MUST be quoted (all URLs quoted). Enums/ints/booleans are bare.

HEADING(level: 1..6=2) { כותרת }              TEXT { פסקאות. שורה ריקה = פסקה חדשה }
IMAGE(src: "/x.jpg" REQUIRED, alt: "תיאור", caption: "...")     ← no braces
BUTTON(url: "/page" REQUIRED, style: primary|secondary|ghost, align: start|center|end) { תווית }
ROW(ratio: "2:1", collapse: sm|md|lg|never, gap: none|sm|md|lg,
    valign: top|center|bottom|stretch) { COL {...} COL {...} }
  ← ROW children MUST be COL; N columns split equally unless ratio given; stacks on mobile;
    valign: stretch = equal-height columns (sole-child CARDs fill them)
SPACE(size: sm|md|lg|xl)   DIVIDER(style: line|dots|thick)          ← no braces
LIST(type: bullet|number) { ITEM { ... } ITEM { ... } }
QUOTE(author: "...") { ציטוט }      CARD { ...blocks... }
HERO(image: "/x.jpg", height: sm|md|lg|full, overlay: 0-100, parallax: true|false)
  { at most one HEADING + one TEXT + one BUTTON — children are plain text }
TESTIMONIAL(author: "...", role: "...") { הציטוט }
GALLERY(columns: 1-4) { IMAGE(...) IMAGE(...) }
FEATURES(columns: 1-4) { FEATURE(title: "..." REQUIRED, icon: "⚡") { תיאור } ... }
EMBED(url: "https://..." REQUIRED)    ARTICLES(tag: "...", limit: 6, columns: 3)   ← no braces
MOTION(effect: fade|slide|typewriter|marquee, speed: slow|normal|fast,
       repeat: once|loop) { plain text only }
BACKDROP(image: "/x.jpg" REQUIRED, tint: dark|light|brand|none, opacity: 0-100,
         fade: true|false, minheight: sm|md|lg|full) { ...any blocks... }
HTML {{{             ← the ONLY raw-HTML door; no params; {{{ ends the keyword's line
  raw html, verbatim
}}}                  ← the closing fence sits ALONE on its own line

INSIDE TEXT: @B{bold} @I{italic} @LINK(url: "/x" REQUIRED){text} @IMG(src: "/x.jpg" REQUIRED, alt: "...")
  @LTR{English} @RTL{עברית} (optional lang: "en") @CODE{mono} @BREAK — no nesting.
  Inline markup works ONLY in TEXT, HEADING, QUOTE, TESTIMONIAL, ITEM bodies —
  BUTTON, FEATURE, MOTION and HERO children are plain text.
  NO Markdown: never ** or [x](url) or # headings or "- " bullets outside LIST ITEMs.
  Escape only \{ \} \@ \\ in prose; ( ) [ ] " & are literal. Emails need no escaping.

RULES OF THUMB: everything has a good zero-param default — omit params you don't need.
  No CSS values ever (no px/rem/vh) — sizes are names the theme resolves. Comments: whole
  lines starting with // between blocks, between META entries, and inside container bodies —
  never inside prose. Max nesting depth 4 (content inside 4 containers is the limit).
ON ERROR: read the message — it names line, construct, and the complete valid alternatives,
  and usually contains the literal fix. Apply exactly the Fix: snippet and recompile.

── SINCE 0.2 — the full builder vocabulary (write "BENTML 0.2" on line 1 to use these) ──

MAP(address: "..." REQUIRED, zoom: 1-20=15, height: sm|md|lg)                ← no braces
CTA(title: "..." REQUIRED, url: "/x" REQUIRED, text: "...", buttontext: "...",
    style: primary|secondary|ghost, tone: brand|dark|light, align: start|center|end)
STATS(columns: 2-4=3) { STAT(value: "120" REQUIRED, label: "לקוחות" REQUIRED) ... }
LOGOS { LOGO(src: "/x.svg" REQUIRED, alt: "...", url: "https://...") ... }
FAQ { QA(question: "...?" REQUIRED) { התשובה } ... }
CONTACT(phone: "...", email: "...", address: "...", hours: "...")            ← no braces
BANNER(tone: brand|dark|light|warn, align: start|center|end) { טקסט ההודעה }
SECTION(size: sm|md|lg|xl) { ...any blocks... }     ← מיכל: container, legit empty
TABS { TAB(label: "לשונית" REQUIRED) { התוכן } ... }
ACCORDION { FOLD(title: "מגירה" REQUIRED) { התוכן } ... }
FORM(action: "/api", method: post|get, submit: "שליחה") {
  FIELD(label: "שם" REQUIRED, name: "name", type: text|email|tel|textarea|select|checkbox,
        placeholder: "...", required: true|false, options: ["א","ב"])       ← no braces
}
CARDS { MEDIACARD(title: "..." REQUIRED, image: "/x.jpg", tag: "חדשות", url: "/a")
        { התקציר } ... }
CAROUSEL(height: sm|md|lg, peek: true|false) {
  SLIDE(title: "...", image: "/x.jpg", tag: "...", url: "/a") { התקציר } ... }
NAV(background: "#0b0f1a", color: "#fff", align: start|center|end)
  { NAVITEM(url: "/" REQUIRED) { בית } ... }
TICKER(label: "מבזק", speed: slow|md|fast, background: "...", color: "...")
  { TICKERITEM(url: "/x") { כותרת המבזק } ... }
NEWSPOP(label: "מבזקים") { NEWSPOPITEM(time: "12:00", url: "/x") { העדכון } ... }
VIDEO(src: "/uploads/clip.mp4 or YouTube" REQUIRED, poster: "/x.jpg", caption: "...",
      controls: true|false, autoplay: true|false, loop: true|false, muted: true|false)
AUDIO(src: "/uploads/ep.mp3 or YouTube" REQUIRED, caption: "...", loop: true|false)
      ← no braces; controls always on, no autoplay (browsers block it anyway)
TABLE(header: true|false) { TROW { יום | שעות } TROW { ראשון | 9:00–17:00 } ... }
      ← each TROW body is one row, cells split on | (like a markdown row);
        header: true (default) renders the first TROW as the header row

CHROME on any block (optional): id: "anchor", class: "hook",
  color/background: "#hex", fontsize/padding/radius: sm|md|lg — the theme resolves them.
```
