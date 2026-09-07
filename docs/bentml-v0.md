# BenTML — The Tapuz Page Language

**BenTML v0.1 — Draft Standard**

## 1. Introduction

BenTML is the page-authoring language of the Tapuz CMS: a small, deterministic, prefix-keyword
language that any human — and, critically, any fresh LLM session given only this document —
can write correctly on the first try. Every page is a sequence of `KEYWORD(params) { content }`
blocks — nestable to depth 4 — that compile to the existing Tapuz JSON block model and render as clean, semantic,
XSS-safe, RTL-first, responsive-by-construction HTML. Themes supply the look; BenTML supplies
structure and intent; raw HTML exists behind exactly one clearly-marked door. This document is
the single source of truth: a conforming compiler, renderer, or authoring agent needs nothing
else.

Before any rules, here is a complete, valid Hebrew page. Everything in it is explained later;
nothing in it is simplified for display:

```bentml
BENTML 0.1

META {
  title: "המתכונים של סבתא"
  slug: "מתכונים"
  description: "כל המתכונים המשפחתיים, מדור לדור."
  tags: ["בישול", "משפחה"]
  status: published
}

HEADING(level: 1) { המתכונים של סבתא }

TEXT {
  כל המתכונים כאן עוברים מדור לדור. יש לנו גם ערוץ
  @LINK(url: "https://youtube.com/@savta"){יוטיוב} עם סרטונים.

  פסקה חדשה מתחילה אחרי שורה ריקה — בדיוק כמו כאן.
}

IMAGE(src: "/uploads/soup.jpg", alt: "קערת מרק עוף מהבילה", caption: "המרק של יום שישי")

ROW(collapse: md) {
  COL {
    HEADING(level: 2) { מנות חמות }
    TEXT { המרקים והתבשילים שמחזיקים חורף שלם. }
  }
  COL {
    HEADING(level: 2) { מאפים }
    TEXT { החלה של שבת, העוגיות של החגים. }
  }
}

BUTTON(url: "/צור-קשר") { שלחו לנו מתכון }
```

---

## 2. Design principles

These are the guarantees the language makes. They are normative: an implementation that breaks
any of them is non-conforming, regardless of how it is built.

Throughout this document the key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted
as in RFC 2119; only the UPPERCASE forms carry that force.

1. **AI-writable from this document alone.** There is exactly one way to write each construct.
   No positional parameters, no flags, no aliases, no context-dependent sugar. The few
   leniencies that exist (case folding, trailing commas, quoted numbers, optional `- ` in list
   items) each remove a known LLM failure mode without adding a second "way to write it".
2. **Responsive by construction.** No block may ever be lost, clipped, or overflow the viewport
   at any width ≥ 320px. Side-by-side containers split the row and collapse to a stack below a
   theme breakpoint. Long unbroken words wrap. These are language semantics (§9), not user CSS.
3. **XSS-safe by default.** Every piece of authored text is HTML-escaped by the renderer. The
   `HTML` block (§12) is the single unescaped sink, gated and audited.
4. **RTL-first.** Pages default to `direction: rtl` and `lang: he`. Mixed
   Hebrew/English/numbers work without markup in the common case; direction-isolation spans
   exist for the rest. Source order is reading order at every width.
5. **HTML is a guest, not the host.** Authors never write HTML; BenTML compiles *to* semantic
   HTML. The one escape hatch is loud, fenced, flagged in export reports, and off by default.
6. **Theme-aware.** All sizes, gaps, speeds, and colors are named intents (`sm`, `md`, `dark`,
   `slow`) resolved by `theme.json`. No CSS value — no `px`, `rem`, `vh`, `ms` — exists
   anywhere in the language. Breakpoints come from the theme.
7. **Validatable with precise errors.** Compilation is atomic: any error means no output.
   Every error names the line, column, and construct, states what was found, lists the complete
   valid alternatives, and — whenever computable — prints the literal fix (§16). An agent must
   be able to self-correct from the error text alone.
8. **Versioned and forward-compatible.** Every document declares its spec version. Newer-minor
   documents degrade gracefully — unknown blocks are preserved, never dropped (§17).
9. **Round-trippable.** `compile()` and `decompile()` ship together. BenTML source is the
   canonical, diffable artifact; JSON is storage (§6.3).

---

## 3. Quick start

The smallest valid BenTML document:

```bentml
BENTML 0.1

META {
  title: "העמוד הראשון שלי"
}

TEXT {
  שלום עולם. זהו עמוד תפוז שלם.
}
```

Line by line:

| Line | Meaning |
|---|---|
| `BENTML 0.1` | Version declaration. Must be the first non-comment, non-blank line: the literal word `BENTML`, one space, `MAJOR.MINOR`. Nothing else on the line. |
| *(blank)* | Blank lines between blocks are insignificant. |
| `META {` | The page metadata block. Exactly one, immediately after the version line. |
| `  title: "העמוד הראשון שלי"` | One `key: value` entry per line. `title` is the only required key. Hebrew values are quoted strings. |
| `}` | Closes META. |
| `TEXT {` | A body block: keyword `TEXT`, no parameters, body opens with `{`. |
| `  שלום עולם. זהו עמוד תפוז שלם.` | Prose. UTF-8, no escaping needed for normal text. |
| `}` | Closes the block. |

That document compiles to a published-quality RTL Hebrew page: `<html dir="rtl" lang="he">`,
the title in `<title>`, the slug derived from the title, and one `<p dir="rtl">` paragraph.
Defaults do the rest — that is the point.

---

## 4. Document structure

A BenTML document is a UTF-8 text file, recommended extension `.btml`, with three parts in this
fixed order:

1. **Version line** — required, first non-comment, non-blank line: `BENTML 0.1`.
   The word `BENTML` folds case-insensitively like every keyword (§5) — `bentml 0.1` parses;
   canonical form is UPPERCASE. Missing or malformed → error **E001**. Document MAJOR greater
   than the compiler's MAJOR → error **E002**, refuse to compile.
2. **META block** — required, exactly one, immediately after the version line and before any
   body block. A missing, duplicate, or misplaced META block is error **E111**.
3. **Body** — zero or more blocks, in source order. **No bare content at the top level**: every
   construct is introduced by a keyword. A loose line of prose at the top level is error
   **E102**.

### 4.1 META keys

META content is one `key: value` entry per line, using the standard value grammar (§7). Keys
are case-insensitive on input; canonical form is lowercase. Duplicate keys → error **E302**.
Unknown keys follow the unknown-parameter rules (§7.6).

| Key | Type | Required | Default | Maps to |
|---|---|---|---|---|
| `title` | string | **yes** | — | page `title` |
| `slug` | string | no | derived from title (§4.2) | `slug` |
| `direction` | enum `rtl` \| `ltr` | no | `rtl` | `direction` |
| `theme` | string | no | `"default"` | `theme` |
| `description` | string | no | `""` | `meta.description` |
| `ogimage` | string | no | none | `meta.ogImage` |
| `tags` | list of strings | no | `[]` | `tags` |
| `status` | enum `draft` \| `published` | no | `draft` | `status` |
| `lang` | string (BCP-47) | no | `he` when rtl, `en` when ltr | `<html lang>` |
| `author` | string | no | none | `meta.author` (§14) |
| `date` | string `YYYY-MM-DD` | no | none | `meta.date` (§14) |

The `status` default is `draft`: **the compiler never auto-publishes.** A `date` value not
matching `YYYY-MM-DD` is error **E304**. A META block missing `title` is error **E306** —
required META keys use the same code as required parameters.

META string values are plain text: inline markup and direction isolates do not exist here by
design. Mixed-direction values (an English title inside a Hebrew description) rely on the
Unicode bidi algorithm, which browsers apply to `<title>` and `<meta>` content. Themes MAY
render an automatic byline from `author`/`date`; a page that wants a visually styled byline
writes it as an ordinary `TEXT` block (e.g. `TEXT(size: sm, class: "byline") { ... }`).

### 4.2 Slug derivation (normative)

If `slug` is omitted, it is derived from `title` by exactly these steps, in order:

1. Trim leading and trailing whitespace.
2. Replace every run of whitespace with a single `-`.
3. Replace every `—` (em dash) and `–` (en dash) with `-`.
4. Delete every occurrence of these characters: `"` `'` `?` `!` `,` `.` `(` `)` `[` `]` `{` `}`
   `/` `\` `:` `;` `#` `&` `$` `%` `*` `+` `=` `|` `<` `>` `@` `^` `~` `` ` ``.
5. Lowercase ASCII letters `A`–`Z` (Hebrew and every other script are unaffected).
6. Collapse repeated `-` into one, then strip any leading and trailing `-`.

Hebrew letters are preserved verbatim — Hebrew slugs are first-class, no transliteration.
This derivation is normative so that two independent compilers produce identical slugs.

Example: `title: "איך עברנו: מוורדפרס לתפוז!"` → slug `איך-עברנו-מוורדפרס-לתפוז`.

An **explicit** `slug` is accepted verbatim, never normalized — but it is validated: it must
be non-empty and contain no whitespace and none of the characters deleted in step 4, else
error **E308** (the message names the offending character and shows the derived slug as the
suggested fix).

---

## 5. Lexical rules

- **Encoding.** UTF-8, no BOM required (a BOM is accepted and ignored). Line endings `\n` and
  `\r\n` are both accepted and equivalent.
- **Whitespace.** Outside bodies (between blocks, around parameters, around braces) whitespace
  and newlines are insignificant. Inside TEXT bodies, whitespace follows the text-flow rules
  (§8.5). Indentation never carries meaning; 2 spaces per nesting level is the canonical style.
- **Keyword casing.** Keywords are ASCII letters only, single words — **no hyphens or
  underscores, ever** (`ARTICLES`, not `ARTICLE-LIST`). Input is case-insensitive
  (`heading`, `Heading`, `HEADING` all parse); the parser folds silently; canonical form in
  docs, examples, and decompiler output is UPPERCASE. Parameter names and META keys follow the
  same rule with canonical lowercase — with one carve-out: parameter names may carry the
  reserved `x-` prefix (§7.6), the only place a hyphen may ever appear.
- **Comments.** A line whose first non-whitespace characters are `//` is a comment to end of
  line; the comment text may be any UTF-8 content, Hebrew included. Comments are recognized **only in structural positions**: between blocks, between META
  entries, and inside BLOCK-BODY bodies. They are never recognized inside TEXT bodies (prose
  needs no comment-escaping — `https://` in a sentence is always safe), never inside
  parentheses, and never inside HTML fences. A comment line between a keyword (or its param
  list) and its `{` is not a structural position — that is error **E110**. There are no
  inline or block comments. Comments do not survive a round-trip through JSON (documented
  limitation, §6.3).
- **Escapes in text.** Inside TEXT bodies exactly four escapes exist:

  | Write | Get | Why |
  |---|---|---|
  | `\{` | `{` | `{` opens a body |
  | `\}` | `}` | `}` closes the body |
  | `\@` | `@` | `@` may start inline markup |
  | `\\` | `\` | the escape character itself |

  A backslash before **any other character** is a literal backslash plus that character —
  never an error, never reserved. Adding a new escape character is a MAJOR version bump.
  Parentheses, quotes, brackets, angle brackets, and ampersands in prose are **always
  literal**: `TEXT { סוגריים (כאלה) וגם [כאלה] הם טקסט רגיל }` is valid as written. An
  **unescaped `{`** inside prose is error **E109**, whose message prints the fix `\{`; an
  unescaped `}` closes the body. Braces are thus the only prose punctuation that must be
  escaped (plus `@`, only where it would trigger). The renderer HTML-escapes all text output,
  so no character an author types can ever inject markup.
- **`@` trigger rule.** `@` starts an inline construct only when immediately followed by a
  known inline keyword (case-insensitive) and then `(` or `{` (§8.1). Exception: for inline
  keywords that take neither params nor a body — in v0.1 only `BREAK` — the trigger fires
  when the keyword is followed by any non-letter character or by the end of the body, so a
  bare `@BREAK` works. Otherwise `@` is a literal character — `someone@example.com` needs
  no escaping.

---

## 6. Grammar overview

The full normative EBNF is Appendix A. In prose:

### 6.1 The three block shapes

Every block is exactly one of three shapes — no fourth exists:

```
KEYWORD { body }
KEYWORD(params) { body }
KEYWORD(params)            ← NO-BODY keywords only; the parentheses are optional —
                             a bare SPACE or DIVIDER is this shape with them omitted
```

Body delimiters are always `{` and `}` — never quotes, never indentation, never
line-orientation. `KEYWORD()` with empty parentheses is legal and identical to no parentheses.

Every keyword is **statically classified** as one of three body classes; the classification —
together with one flag the parser already holds on its stack, whether the enclosing parent
permits inline markup in this body (§8; relevant only for HERO children) — decides how the
body is lexed. The parser never inspects the body's contents to guess:

| Class | Body contains | Violations |
|---|---|---|
| **TEXT-BODY** | prose (inline markup where §8 permits) | — |
| **BLOCK-BODY** | nested blocks only | bare prose directly inside → **E102** |
| **NO-BODY** | nothing — braces forbidden | `{` after the keyword → **E103** |

A TEXT-BODY or BLOCK-BODY keyword with **no body at all** — no `{` follows the keyword and
its optional param list — is error **E110**. **E103** fires across newlines: for a NO-BODY
keyword, a `{` appearing as the next token is E103 even when it sits on a later line.

`HTML` is a fourth, unique thing: a raw-fenced block (§12).

**Nesting depth (normative):** a block's depth is the number of blocks enclosing it. A
top-level block has depth 0, and every keyword counts toward depth — `COL`, `ITEM`, `FEATURE`,
and leaf blocks included. Maximum depth is **4**: a block enclosed by five or more blocks is
error **E105**. Worked examples: in `BACKDROP > ROW > COL > TEXT` the `TEXT` has depth 3 —
real pages rarely need more. A nested column split `ROW > COL > ROW > COL > TEXT` is legal:
its `TEXT` sits at depth 4, exactly at the limit — which also means a nested split can never
be wrapped in a further container (a `BACKDROP` around it is E105). The canonical pricing
pattern `ROW > COL > CARD > LIST > ITEM` likewise puts `ITEM` at depth 4: legal, but at the
ceiling — that section too cannot be wrapped in anything further. That ceiling is
deliberate: keep pages shallow. **Inline constructs are not blocks and never count toward
nesting depth** — `@B{...}` inside a depth-4 `ITEM` is fine.

Some keywords are **child-only**: `COL` (only inside `ROW`), `ITEM` (only inside `LIST`),
`FEATURE` (only inside `FEATURES`). `GALLERY` children must be `IMAGE`. A wrong child, or a
child-only keyword outside its container, is error **E104**, and the message names the allowed
context.

**Empty bodies** are legal and emit quality warning **W410**: an empty TEXT-BODY compiles to
its empty string form and renders its element empty (present in the DOM — invariant I1); an
empty BLOCK-BODY compiles with an empty child array and renders its wrapper element empty. An
empty `ROW` renders an empty row; any `ratio` on it is then **E305** (the segment count cannot
match zero columns).

### 6.2 Lexer modes and parseability

A conforming parser uses three lexer modes:

- **Block mode** — the default: keywords, parameter lists, punctuation, comments.
- **Text mode** — entered at the `{` of a TEXT-BODY keyword: raw characters, the four escapes,
  the `@` trigger rule; an unescaped `}` ends the body.
- **Raw mode** — entered at the `{{{` fence of `HTML`: everything verbatim until a line
  consisting solely of `}}}`.

An **unknown keyword** (E201 in strict mode, W405 in forward-compat mode) has no static body
class, so its body is lexed by one fixed rule: a **raw brace-balanced scan** — from the
opening `{`, count `{` and `}` with no escapes, comments, or inline rules recognized, until
the balancing `}`. The body's opening `{` is sought as the **next token after the keyword and
its (possibly multi-line) param list**; if the next token is anything else, the block is
taken to be body-less. A
forward-compat document MUST keep unknown-block bodies brace-balanced; the scanned span is
exactly the `data.source` that W405 preserves verbatim (§17).

The grammar is **LL(1)**: after any token, one token of lookahead suffices to choose the
production. This is a conformance requirement — independent implementations MUST be able to
parse in a single pass with one token of lookahead and no backtracking.

### 6.3 The toolchain contract: compile, decompile, canonical form

Two functions ship together in v0.1, both first-class deliverables:

- `compile(source) → { page, blocks, warnings }` — BenTML text to the Tapuz JSON block model.
- `decompile(page, blocks) → source` — JSON back to canonical BenTML text.

**Round-trip guarantees (normative):**

- `compile(decompile(B)) == B` for every valid block array, modulo storage block ids (ids are
  storage identity, regenerated by `createBlock`; they are not content).
- `decompile(compile(S))` is the **canonical form** of `S`.

**Canonical form rules:** parameters printed in the spec-table order for the keyword, with
parameters equal to their default omitted; canonical casing (UPPERCASE keywords, lowercase
params); strings quoted, enums/integers/booleans bare; 2-space indent per nesting level; one
blank line between top-level blocks; META one entry per line; text printed with the four
escapes applied and structured runs printed as inline constructs; `LIST(type: bullet)` items
printed with a leading `- ` (numbered-list items are printed without it). Unknown `data`
fields decompile to `x-` parameters (§7.6), so blocks written by
a newer tool survive a round-trip losslessly. Comments do not round-trip.

---

## 7. Parameters

### 7.1 Form

```
KEYWORD(name: value, name2: value2)
```

- **Named parameters only.** There are no positional parameters and no flags anywhere in the
  language. Order never matters.
- Comma-separated. **A trailing comma is legal** in parameter lists, in JSON lists, and after
  a META value. A parameter list may span multiple lines; comments are never recognized inside
  it — a `//` inside parentheses is error **E110**.
- Duplicate parameter name (or META key) → error **E302** — never last-wins; last-wins hides
  AI mistakes.
- All parameters are **optional enhancers** unless the keyword's table marks them required.
  Every keyword with zero parameters must render its documented good default.

### 7.2 Value types

Exactly six value types exist:

| # | Type | Syntax | Examples |
|---|---|---|---|
| 1 | **string** | double-quoted; the escape set is **closed** — exactly `\"` `\\` `\n` `\t` `\uXXXX`, any other backslash inside a string is error E307 | `"דף הבית"`, `"/uploads/hero.jpg"` |
| 2 | **enum** | bare lowercase word from the param's documented closed set | `rtl`, `primary`, `md` |
| 3 | **integer** | bare digits | `3`, `80` |
| 4 | **boolean** | bare `true` / `false` | `true` |
| 5 | **ratio** | quoted string of integers joined by `:` | `"2:1"`, `"1:2:1"` |
| 6 | **list** | JSON array of strings | `["ראשי", "בית"]` |

There are **no dimension or CSS values** (`px`, `rem`, `vh`, `ms`) anywhere in the language.
Sizes, gaps, and speeds are named intents (`sm`, `md`, `lg`, `slow`, `fast`) resolved by the
theme (§15).

### 7.3 Quoting rules

- Bare (unquoted) values may contain only `[A-Za-z0-9_.-]`. Anything else — spaces, Hebrew,
  slashes, colons, `#` — **must** be quoted. Consequently **all URLs and paths are quoted
  strings**.
- Quoting an enum or integer is accepted and equivalent: `level: "2"` ≡ `level: 2`. A bare
  token that satisfies the bare-charset rule is accepted in a string-typed position:
  `theme: default` ≡ `theme: "default"`. Canonical form: strings quoted; enums, integers, and
  booleans unquoted.
- An unterminated string, or an invalid escape inside a string, is error **E307**.
- An enum value outside the documented set — or an integer outside its documented range, e.g.
  `level: 7` or `columns: 9` — is error **E303**, and the message lists every valid value, or
  the valid range, for the declared spec version.
- A value of the wrong type for a known parameter is error **E304**.

### 7.4 Universal parameters

Every body keyword accepts these reserved parameters — **except** the child-only keywords
`COL`, `ITEM`, and `FEATURE`, the children of `HERO` (§11.1), the children of `GALLERY`
(§10), and `HTML` (§12): their JSON shapes carry no `data` object to hold them, so a
universal param there is error **E301** (for HERO children, **E108**):

| Param | Type | Maps to | Purpose |
|---|---|---|---|
| `id` | string | `data.id` | DOM anchor (`id="..."` on the rendered element) |
| `class` | string | `data.className` | theme hook class |
| `dir` | enum `rtl` \| `ltr` | `data.dir` | per-block direction override (all visible blocks; inherited from the page when absent) |

Storage block ids are compiler-generated via the existing `createBlock` scheme; the `id`
parameter populates `data.id` (the DOM anchor), never the storage id.

### 7.5 Per-param defaults

Every parameter's default is stated in its keyword's table (§10). A default is part of the
language: a MINOR version may add parameters and enum values but may never change an existing
default or meaning (§17).

### 7.6 Unknown parameters and the `x-` namespace

- **Strict mode** (document version ≤ compiler version, same MAJOR): unknown parameter on a
  known keyword → error **E301**, message lists the complete valid parameter set.
- **Forward-compat mode** (document MINOR > compiler MINOR, same MAJOR): unknown parameter →
  warning **W404**; the value is preserved verbatim in `data` under its name and re-emitted on
  decompile.
- **`x-` namespace:** any parameter whose name starts with `x-` is accepted silently, in
  every mode, and passed to `data` verbatim — **on keywords that carry a `data` object**. The
  data-less shapes of §7.4 (`COL`, `ITEM`, `FEATURE`, `HTML`, the children of `HERO`, and
  the children of `GALLERY`) have nowhere to store it: an `x-` parameter there is rejected
  like any other parameter —
  **E301** (**E108** on HERO children) — in every mode. An `x-` name never collides with
  future spec parameters. Example: `TEXT(x-experiment: "b") { ... }`.

---

## 8. Inline text markup

Inline constructs are introduced by `@`. They are permitted in the bodies of **exactly five
keywords**: `TEXT`, `HEADING`, `QUOTE`, `TESTIMONIAL`, and `ITEM` — the keywords whose JSON
targets accept structured runs (Appendix B, R1). Every other prose body — `BUTTON`, `FEATURE`,
`MOTION`, and the children of `HERO` — is **plain text**: the `@` trigger runs in
**detect-only** mode there — a would-be inline construct renders literally, and the compiler
emits warning **W407** so the author gets a signal. Near-miss detection (W402) does not run
in plain-text bodies: only exact trigger matches are reported. Each keyword's entry in §10
restates this.

### 8.1 Trigger rule (deterministic)

`@` begins an inline construct **only if** it is immediately followed by a known inline keyword
(case-insensitive) and then `(` or `{`. One exception: for inline keywords that declare
neither params nor a body — in v0.1 only `BREAK` — the trigger fires when the keyword is
followed by any non-letter character or by the end of the body: `@BREAK` before a space,
newline, Hebrew letter, or punctuation all work, while `@BREAKFAST` is literal text.
Otherwise `@` is a literal character.

Near-miss detection is normative, so W402 fires identically in every implementation: the
lexer takes the **maximal run of ASCII letters** after `@`; if that run is not a known inline
keyword but is followed by `(` or `{` and is within edit distance 2 of a known inline keyword
— or is a prefix or extension of one (e.g. `@LNIK{...}`, `@Bold{...}`) — the compiler emits
warning **W402** and renders the text literally: the page compiles, the agent gets a signal.
Unknown inline constructs are never forgiven by version skew (§17). Inline markup in a
plain-text body renders literally with warning **W407** (§8).

### 8.2 The eight inline constructs of v0.1

| Construct | Body | Params | Meaning |
|---|---|---|---|
| `@B{ ... }` | text | — | bold → `<strong>` |
| `@I{ ... }` | text | — | italic → `<em>` |
| `@LINK(url: "..."){ ... }` | text | `url` string **required** | hyperlink → `<a href>` |
| `@IMG(src: "...", alt: "...")` | none | `src` string **required**; `alt` string (W401 if missing); `width` enum `sm`\|`md`\|`full` default `md`; `float` enum `start`\|`end`\|`none` default `none` | image inside flowing text → inline `<img>` |
| `@LTR{ ... }` | text | `lang` string optional | left-to-right isolation span → `<bdi dir="ltr">` |
| `@RTL{ ... }` | text | `lang` string optional | right-to-left isolation span → `<bdi dir="rtl">` |
| `@CODE{ ... }` | text | — | monospace, always rendered LTR → `<code dir="ltr">` |
| `@BREAK` | none | — | hard line break within a paragraph → `<br>` |

- `@LTR`/`@RTL` accept an optional `lang` parameter — `@LTR(lang: "en"){MacBook Pro}` — which
  emits `lang="en"` on the span for SEO and screen readers. Prefer the `lang` form whenever the
  span is genuinely another language, not just a direction fix.
- `@IMG` float directions are logical: in an RTL paragraph, `float: start` floats right.
  Floated inline images are capped at 40% of the text column; `width: full` breaks the float
  and spans the column.
- Non-floated `@IMG` (`float: none`, the default) is deterministic too: `width: sm` renders
  inline with the surrounding text, bottom edge on the text baseline; `width: md` and
  `width: full` render on their own line inside the paragraph — the text resumes on the next
  line and the paragraph is not split.
- `@IMG` deliberately has **no `lg`** and a different default than the block `IMAGE`
  (`md` vs `full`): inline images are guests inside text, not layout.
- **Inline constructs do not nest** in v0.1: `@B{@I{x}}` is error **E107**. A blank line
  inside an inline construct's body is not a paragraph break — it collapses to a single
  space.
- **The tail shape is fixed per keyword** by the table above, and once the trigger fires a
  wrong tail is an error, never literal text: a forbidden param-list (`@B(x: 1){...}`), a
  forbidden body (`@IMG{...}` — `@IMG` takes params only), or a missing required body
  (`@LINK(url: "/x")` with nothing after it) is error **E107**; a missing required inline
  parameter (`@LINK{...}` with no `url`, `@IMG(...)` with no `src`) is error **E306**,
  exactly as for block parameters.

### 8.3 Markdown-reflex diagnostics

Markdown syntax in text emits warning **W403** naming the specific BenTML construct:
`**bold**` → "use `@B{ ... }`"; `[text](url)` → "use `@LINK(url: \"...\"){ ... }`". At the top
level, lines starting with `#` or `##` get the targeted hint "use `HEADING(level: 1) { ... }`"
and lines starting with `- ` get "use `LIST { ITEM { ... } }`" — instead of the generic
unknown-keyword message (§16.4).

Similarly, HTML-tag-shaped text in prose (e.g. `<div>`, `</p>`, `<script>`) emits warning
**W409**: it will render as visible literal text — always escaped, never markup — and the
message names `HTML {{{ ... }}}` (§12) as the one sanctioned path for real markup.

### 8.4 Compiled form

A TEXT body **without** inline markup compiles to a plain string (`data.content: "..."`) —
exactly what the current renderer consumes; existing pages render unchanged. A body **with**
markup compiles to structured runs: an array of paragraphs, each an array of typed run objects,
with every text leaf still passing through `escapeHtml`:

```json
{ "type": "text", "data": { "content": [
  [ {"t":"text","v":"אנחנו עובדים עם "},
    {"t":"span","dir":"ltr","lang":"en","v":"Node.js"},
    {"t":"text","v":" כבר "},
    {"t":"bold","v":"שלוש שנים"},
    {"t":"text","v":"."} ]
] } }
```

Run types: `text`, `bold`, `italic`, `link` (`url`), `img` (`src`, `alt`, `width`, `float`),
`span` (`dir`, optional `lang`), `code`, `br`.

### 8.5 Text flow

Inside prose bodies:

- Leading/trailing whitespace of the whole body is trimmed; common leading indentation is
  stripped. Normatively: a line is **blank** if it is empty after removing spaces and tabs;
  the common indentation is the longest common prefix of spaces and tabs (matched
  character-by-character, tabs never expanded) across all non-blank lines, excluding any text
  on the opening-brace line; that prefix is removed from every line. Indent freely.
- A **single newline** collapses to a space — wrap source lines wherever you like.
- A **blank line** is a **paragraph break** — **in `TEXT` bodies only** (maps to the
  renderer's existing `\n\n` → `</p><p>` behavior). Every other prose body (`HEADING`,
  `QUOTE`, `TESTIMONIAL`, `ITEM`, `BUTTON`, `FEATURE`, `MOTION`, and `HERO` children) is
  **single-paragraph**: a blank line there collapses to a single space.
- A hard line break within a paragraph is written explicitly: `@BREAK`. Whitespace
  immediately following `@BREAK` — spaces, tabs, or one newline — is dropped, so the next
  rendered line never starts with a stray space.
- `LIST` `ITEM` bodies additionally accept and strip one optional leading `- ` (the LLM bullet
  reflex); the canonical printer emits it for `type: bullet` lists only. The strip is applied
  to the trimmed body text **before** any inline lexing, so `ITEM { - @B{שאלה} ... }` works.

**Processing order (normative).** A prose body is processed in exactly this order:
(1) split the raw body into lines and strip the common indentation; (2) trim leading and
trailing whitespace of the whole body; (3) for `ITEM`, strip one optional leading `- `;
(4) lex escapes and inline constructs (inline bodies and param lists may span lines);
(5) in `TEXT` only, split into paragraphs at blank lines that lie **outside** every inline
extent — a blank line inside an inline construct collapses to a space, per §8.2; (6) collapse
every remaining single newline to a space. Two implementations following this order produce
identical output for every body.

---

## 9. Layout model

### 9.1 ROW and COL

```bentml
ROW(ratio: "2:1", gap: md, collapse: md) {
  COL {
    HEADING(level: 2) { צד ימין }
    TEXT { הטור הראשון — בעמוד עברי הוא מוצג מימין. }
  }
  COL {
    IMAGE(src: "/uploads/team.jpg", alt: "הצוות")
  }
}
```

- `ROW` is BLOCK-BODY; its direct children **must all be `COL`** — anything else is error
  **E104** with the message "wrap in COL { ... }". There is no auto-column sugar.
- `COL` is BLOCK-BODY and legal only inside `ROW`. It may contain any non-child-only block,
  including another `ROW`, up to the depth limit.
- **Default split:** N columns share the row equally — two `COL`s → halves, three → thirds.
- `ratio: "2:1"` — explicit proportions. The segment count must equal the `COL` count, else
  error **E305**; a mismatch can never silently drop or squash a column.
- `gap`: enum `none | sm | md | lg`, default `md`, resolved by the theme.
- `collapse`: enum `sm | md | lg | never`, default `md`. Below the theme's named breakpoint
  (`theme.json → breakpoints`), the row stacks vertically **in source order**. Collapse is
  evaluated against the **viewport width** (a CSS media query), never the container width: a
  nested `ROW` inside a `COL` collapses at the same viewport width as a top-level one. Just
  above the breakpoint a nested row's columns can therefore be narrow — I2 keeps them safe
  from overflow; choose a larger `collapse` value on nested rows when that reads badly.
- `valign`: enum `top | center | bottom | stretch`, default `top`. **`stretch` (normative):**
  every `COL` box in the row stretches to the height of the tallest column. When a stretched
  `COL`'s **sole child** is a `CARD`, the card fills the full column height — this is the
  intended equal-height-pricing-cards pattern (worked example under CARD, §10). With multiple
  children, the extra space falls after the last child.
- **RTL rule:** the first `COL` sits at inline-start — the **right** side on an RTL page.
  Source order is reading order, at every width, in both directions.

### 9.2 The responsive invariants (RFC 2119)

These invariants are language semantics (RFC 2119 keywords per §2); a compiler or theme that
violates any of them is non-conforming. They hold for every compiled page at every viewport
width ≥ 320px.

- **I1 — Completeness.** Every block in the source MUST produce exactly one corresponding
  node in the output, in source order — and that node MUST render visibly whenever the block
  is known, renderable, and permitted. Suppressed `HTML` blocks (§12) and unknown
  forward-compat blocks (§17) satisfy I1 through their placeholder nodes: present in the DOM,
  never silently absent. Compilation MUST be atomic: any error produces no output, never a
  partial page. No construct may drop, merge, or reorder a block.
- **I2 — No horizontal overflow.** No block's border box may exceed the viewport width. The
  compiled output MUST carry `min-width: 0` on every flex/grid child, `max-width: 100%` on all
  media, and `overflow-wrap: anywhere` on all text containers, so long unbroken tokens (URLs,
  long Hebrew compounds) wrap instead of overflowing. No BenTML construct accepts a fixed
  pixel width.
- **I3 — Collapse.** Every `ROW` MUST become a vertical stack below its collapse breakpoint,
  stacking in source order. `collapse: never` MUST keep columns side by side at every width
  while still satisfying I2 (columns shrink, content wraps).
- **I4 — Media containment.** Images and embeds MUST render at `max-width: 100%; height: auto`
  with lazy loading; a portrait photo can never blow out a column.
- **I5 — Reduced-motion safety.** Under `prefers-reduced-motion`, every `MOTION` effect MUST
  render as static, fully readable text, and `BACKDROP` MUST drop fixed attachment. Content is
  always fully present.
- **I6 — Clipping ban.** `overflow: hidden` MUST NOT be applied to any element containing
  authored content; it MAY be applied only to purely decorative layers (e.g. the backdrop
  image layer, the marquee viewport — with the full text still present in the DOM).

### 9.3 Machine-checkable conformance

The spec ships a **conformance page** — a single `.btml` document exercising every invariant
(deep nesting, extreme ratios, 300-character unbroken tokens, all three effects, mixed-direction
text). A conforming implementation is verified by rendering it at **320, 375, 768, and 1280 px**
and asserting, at each width: `document.scrollingElement.scrollWidth <= viewport width`, and
every source block's generated element present in the DOM.

Error-path conformance uses **separate fixture documents**, one per error code: compilation
is atomic, so a document exercising an error case produces no output and cannot share a file
with rendering fixtures.

---

## 10. Block reference

The v0.1 body keywords are exactly: `HEADING`, `TEXT`, `IMAGE`, `BUTTON`, `ROW`, `COL`,
`SPACE`, `DIVIDER`, `LIST`, `ITEM`, `QUOTE`, `CARD`, `HERO`, `TESTIMONIAL`, `GALLERY`,
`FEATURES`, `FEATURE`, `EMBED`, `ARTICLES`, `MOTION`, `BACKDROP`, `HTML` — plus `META` (§4).

**Reserved future keywords** — using them today is error **E201** with a "reserved for a future
version" note: `INPUT`, `CODE`. (Everything else on the original v0.1 reserved list has since
graduated: `SECTION`, `FORM`, `NAV`, `TABLE`, `VIDEO`, `AUDIO`, `ACCORDION`, `TABS`, `SLIDER`
as `CAROUSEL`.) `HEADER` and `FOOTER` compile, but are **decompile-preview only**: the decompiler
emits them so an imported site shows its chrome inside Tapuziel; authors and agents never write
them — the site's real header and footer are theme chrome (עיצוב → כותרת ותחתית), and the
toolbox, dictionaries and primers omit both keywords.

Every keyword below also accepts the universal params `id`, `class`, `dir` (§7.4) — except
`COL`, `ITEM`, `FEATURE`, `HTML`, and HERO children, per §7.4; they are omitted from the
tables. "Compiles to" shows the HTML shape; the exact JSON mapping is the
`{type, data}` line plus Appendix B.

### HEADING — section titles

TEXT-BODY → type `heading`. Renders `<h1>`–`<h6>`. Inline markup allowed (§8);
single-paragraph (a blank line collapses to a space, §8.5).

| Param | Type | Default | Required |
|---|---|---|---|
| `level` | integer 1–6 | `2` | no |
| `align` | enum `start`\|`center`\|`end` | `start` | no |

```bentml
HEADING { מה חדש }
HEADING(level: 1, align: center) { ברוכים הבאים }
```

Compiles to: `<h2 dir="rtl">מה חדש</h2>`.
JSON: `{ "type": "heading", "data": { "level": 2, "text": "מה חדש" } }` (with runs when inline
markup is present; `align` additive).

### TEXT — paragraphs

TEXT-BODY → type `text`. Renders `<p>` per paragraph. Blank line = new paragraph; inline
markup allowed (§8).

| Param | Type | Default | Required |
|---|---|---|---|
| `align` | enum `start`\|`center`\|`end` | `start` | no |
| `size` | enum `sm`\|`md`\|`lg` | `md` | no |

```bentml
TEXT { פסקה אחת פשוטה. }

TEXT(align: center, size: lg) {
  פסקה ראשונה עם @B{הדגשה}.

  פסקה שנייה.
}
```

Compiles to: `<p dir="rtl">…</p><p dir="rtl">…</p>`.
JSON: `{ "type": "text", "data": { "content": "..." } }` — string, or paragraphs-of-runs (§8.4).

### IMAGE — a standalone image

NO-BODY → type `image`. Renders `<figure><img loading="lazy">…</figure>`.

| Param | Type | Default | Required |
|---|---|---|---|
| `src` | string | — | **yes** (E306 if missing) |
| `alt` | string | `""` (warning **W401** if missing) | no |
| `caption` | string | none | no |
| `width` | enum `sm`\|`md`\|`lg`\|`full` | `full` | no |

```bentml
IMAGE(src: "/uploads/soup.jpg")
IMAGE(src: "/uploads/soup.jpg", alt: "קערת מרק", caption: "המרק של שישי", width: md)
```

Compiles to: `<figure dir="rtl"><img src="…" alt="…" loading="lazy"><figcaption>…</figcaption></figure>`.
JSON: `{ "type": "image", "data": { "src", "alt", "caption", "width" } }`.

### BUTTON — a call-to-action link

TEXT-BODY (the body is the label — **plain text**: inline markup renders literally with
**W407**) → type `button`. Renders `<a class="btn btn-primary">`.

| Param | Type | Default | Required |
|---|---|---|---|
| `url` | string | — | **yes** (E306) |
| `style` | enum `primary`\|`secondary`\|`ghost` | `primary` | no |
| `align` | enum `start`\|`center`\|`end` | `start` | no |

```bentml
BUTTON(url: "/צור-קשר") { דברו איתנו }
BUTTON(url: "/מחירים", style: secondary) { לכל המחירים }
```

Compiles to: `<a href="/צור-קשר" class="btn btn-primary" dir="rtl">דברו איתנו</a>`.
JSON: `{ "type": "button", "data": { "text", "url", "variant", "align" } }` (`style` maps to
the existing `variant` field; `ghost` is a new variant value; `align` positions a standalone
button in the flow — `start` by default — and is additive).

### ROW — side-by-side layout

BLOCK-BODY, children must be `COL` → type `columns`. Semantics in §9.1.

| Param | Type | Default | Required |
|---|---|---|---|
| `ratio` | ratio string | equal split | no |
| `gap` | enum `none`\|`sm`\|`md`\|`lg` | `md` | no |
| `collapse` | enum `sm`\|`md`\|`lg`\|`never` | `md` | no |
| `valign` | enum `top`\|`center`\|`bottom`\|`stretch` | `top` | no |

```bentml
ROW {
  COL { TEXT { טור ראשון } }
  COL { TEXT { טור שני } }
}

ROW(ratio: "2:1", gap: lg, collapse: sm, valign: center) {
  COL { TEXT { רחב } }
  COL { TEXT { צר } }
}
```

Compiles to: `<div class="columns" dir="rtl"><div class="col">…</div><div class="col">…</div></div>`
plus grid/flex utility classes for ratio, gap, and the collapse media query.
JSON: `{ "type": "columns", "data": { "columns": [ {"blocks":[…]}, … ], "ratio": [2,1], "gap": "md", "collapse": "md", "valign": "top" } }` —
`ratio`/`gap`/`collapse`/`valign` are additive; the current renderer ignores them gracefully.

### COL — one column of a ROW

BLOCK-BODY, child-only (inside `ROW`). Takes **no params at all** — not even the universal
set (§7.4); its column entry has no `data` object to carry them. Each `COL` becomes one
`{ "blocks": [ … ] }` entry in the parent's `data.columns`.

```bentml
COL { TEXT { תוכן הטור } }
```

### SPACE — vertical breathing room

NO-BODY → type `spacer`. Renders `<div class="spacer spacer-md"></div>`; the theme resolves
the size.

| Param | Type | Default | Required |
|---|---|---|---|
| `size` | enum `sm`\|`md`\|`lg`\|`xl` | `md` | no |

```bentml
SPACE
SPACE(size: xl)
```

JSON: `{ "type": "spacer", "data": { "size": "md" } }` (legacy `data.height` values remain
valid renderer input; the compiler emits only `size`).

### DIVIDER — horizontal rule

NO-BODY → type `divider`. Renders `<hr>`.

| Param | Type | Default | Required |
|---|---|---|---|
| `style` | enum `line`\|`dots`\|`thick` | `line` | no |

```bentml
DIVIDER
DIVIDER(style: dots)
```

JSON: `{ "type": "divider", "data": { "style": "line" } }`.

### LIST / ITEM — bulleted and numbered lists

`LIST` is BLOCK-BODY whose children must be `ITEM` (E104 otherwise) → type `list`. `ITEM` is
TEXT-BODY, child-only; inline markup allowed; an optional leading `- ` is accepted and
stripped (canonical form emits it for `type: bullet` lists only).

| LIST param | Type | Default | Required |
|---|---|---|---|
| `type` | enum `bullet`\|`number` | `bullet` | no |

```bentml
LIST {
  ITEM { - עציץ גדול }
  ITEM { - אדמה איכותית }
}

LIST(type: number) {
  ITEM { לשתול עמוק }
  ITEM { להשקות רק כשהאדמה יבשה, ראו @LINK(url: "/מדריך"){במדריך} }
}
```

Compiles to: `<ul dir="rtl"><li>…</li>…</ul>` or `<ol>`.
JSON: `{ "type": "list", "data": { "ordered": false, "items": [ {"text":"…"}, … ] } }` —
items are strings, or run arrays when marked up.

**FAQ pattern (blessed for v0.1):** until `ACCORDION` arrives (reserved, §10), write an FAQ
as a `LIST` of `ITEM`s — question bold, `@BREAK`, then the answer:

```bentml
LIST {
  ITEM { @B{כמה זה עולה?}@BREAK מסלול הבסיס חינם, ללא הגבלת זמן. }
  ITEM { @B{אפשר לייצא את האתר?}@BREAK כן — ייצוא סטטי מלא בלחיצה אחת. }
}
```

A future keyword will carry the question/answer semantics (and FAQ structured data); this
pattern is forward-portable to it.

### QUOTE — a pull quote

TEXT-BODY → type `quote`. Renders `<blockquote><p>…</p><footer>— author</footer></blockquote>`.
Inline markup allowed (§8); single-paragraph.

| Param | Type | Default | Required |
|---|---|---|---|
| `author` | string | none | no |

```bentml
QUOTE { מי שלא זורע — לא קוצר. }
QUOTE(author: "סבתא רחל") { מרק טוב לא ממהרים. }
```

JSON: `{ "type": "quote", "data": { "text", "author" } }`.

Do not type quotation marks around the body: quote styling — glyphs, marks, the em-dash
before the author — is supplied by the theme, and typed quotes would double up. The same
rule applies to `TESTIMONIAL`.

### CARD — a boxed group of blocks

BLOCK-BODY → type `card`. Renders `<div class="card">…</div>`. No params beyond the universal
set.

```bentml
CARD {
  HEADING(level: 3) { מסלול בסיסי }
  TEXT { כל מה שצריך כדי להתחיל. }
  BUTTON(url: "/הרשמה") { בחירה }
}
```

JSON: `{ "type": "card", "data": { "blocks": [ … ] } }`.

The canonical **pricing card**, worked in full: the price line is `TEXT(size: lg)` — the
intended pattern; no dedicated price construct exists in v0.1 — and equal-height cards come
from `valign: stretch` on the row (§9.1) with the `CARD` as each column's sole child. Note
`₪190` needs no bidi isolation (§13):

```bentml
ROW(valign: stretch, collapse: md) {
  COL {
    CARD {
      HEADING(level: 3) { מסלול בסיסי }
      TEXT(size: lg) { ₪190 לחודש }
      TEXT { כל מה שצריך כדי להתחיל. }
      BUTTON(url: "/הרשמה") { בחירה }
    }
  }
  COL {
    CARD {
      HEADING(level: 3) { מסלול מקצועי }
      TEXT(size: lg) { ₪390 לחודש }
      TEXT { לאתרים עם תנועה רצינית. }
      BUTTON(url: "/הרשמה") { בחירה }
    }
  }
}
```

### HERO — see §11.1.

### TESTIMONIAL — a customer quote

TEXT-BODY (the body is the quote; inline markup allowed, single-paragraph) → type
`testimonial`.

| Param | Type | Default | Required |
|---|---|---|---|
| `author` | string | `""` | no |
| `role` | string | none | no |

```bentml
TESTIMONIAL(author: "מיכל לוי", role: "בעלת סטודיו") {
  העברתי את האתר תוך יומיים והכול פשוט עובד.
}
```

Compiles to: `<blockquote class="testimonial"><p>"…"</p><footer class="author">מיכל לוי, בעלת סטודיו</footer></blockquote>`.
JSON: `{ "type": "testimonial", "data": { "quote", "author", "role" } }`.

The quotation marks in the compiled form are **added by the renderer/theme** — do not type
your own quotation marks in the body (they would double up). Same rule as `QUOTE`.

### GALLERY — an image grid

BLOCK-BODY, children must be `IMAGE` (E104 otherwise) → type `gallery`.

| Param | Type | Default | Required |
|---|---|---|---|
| `columns` | integer 1–4 | `3` | no |

```bentml
GALLERY(columns: 2) {
  IMAGE(src: "/uploads/a.jpg", alt: "לפני")
  IMAGE(src: "/uploads/b.jpg", alt: "אחרי")
}
```

Compiles to: `<div class="gallery" dir="rtl"><img …><img …></div>`.
JSON: `{ "type": "gallery", "data": { "columns": 2, "images": [ {"src","alt","caption"}, … ] } }`
(a child `caption` is carried additively as `images[].caption`). GALLERY children accept
**only** `src`, `alt`, and `caption` — `width`, universal params, or anything else on a child
`IMAGE` is error **E301**: the grid controls sizing.

### FEATURES / FEATURE — a feature grid

`FEATURES` is BLOCK-BODY whose children must be `FEATURE` (E104) → type `features`. `FEATURE`
is TEXT-BODY (the body is the description — **plain text**: inline markup renders literally
with **W407**), child-only.

| FEATURES param | Type | Default | Required |
|---|---|---|---|
| `columns` | integer 1–4 | `3` | no |

| FEATURE param | Type | Default | Required |
|---|---|---|---|
| `title` | string | — | **yes** (E306) |
| `icon` | string: a single emoji, or a site path under `/uploads` ending in `.svg`/`.png` | none | no |

```bentml
FEATURES {
  FEATURE(title: "מהירות", icon: "⚡") { עמודים נטענים בפחות משנייה. }
  FEATURE(title: "עברית", icon: "🍊") { כיווניות מובנית מהשורש. }
  FEATURE(title: "בעלות", icon: "/uploads/icons/export.svg") { ייצוא סטטי מלא בלחיצה. }
}
```

Compiles to: `<section class="features"><article class="feature"><h3>…</h3><p>…</p></article>…</section>`.
JSON: `{ "type": "features", "data": { "columns": 3, "items": [ {"title","description","icon"}, … ] } }`.
The theme renders `icon` before the title — an emoji as text, a path as a small `<img>`.

### EMBED — external media

NO-BODY → type `embed`. YouTube URLs render as a responsive `<iframe>`; any other URL renders
as a safe outbound link (`rel="noopener"`). The recognized YouTube shapes are normative and
the decision is made at render time: `youtube.com/watch?v=ID`, `youtu.be/ID`,
`youtube.com/embed/ID`, `youtube.com/shorts/ID` — each with or without `www.`, over `http` or
`https`.

| Param | Type | Default | Required |
|---|---|---|---|
| `url` | string | — | **yes** (E306) |

```bentml
EMBED(url: "https://youtu.be/dQw4w9WgXcQ")
```

JSON: `{ "type": "embed", "data": { "url" } }`.

### ARTICLES — a dynamic list of published pages

NO-BODY → type `article-list`. Renders the site's latest published pages with a given tag as a
card grid; content is resolved at render time.

| Param | Type | Default | Required |
|---|---|---|---|
| `tag` | string | `"article"` | no |
| `limit` | integer | `6` | no |
| `columns` | integer 1–4 | `3` | no |

```bentml
ARTICLES
ARTICLES(tag: "בלוג", limit: 3, columns: 3)
```

JSON: `{ "type": "article-list", "data": { "tag", "limit", "columns" } }`.

Render-time semantics (normative): pages with `status: published` whose META `tags` contain
`tag` — compared by **exact string match** after trimming and Unicode NFC normalization — are
listed **newest first by publish date** (the moment the page's status last became
`published`). Each card shows the page's title, its `description` (the theme may truncate),
and its `ogimage` as a thumbnail when present. Fewer matches than `limit` renders that many;
zero matches renders an empty but present grid (invariant I1). A page never lists itself.

### MOTION — see §11.2.
### BACKDROP — see §11.3.
### HTML — see §12.

---

## 11. Signature effects

The three product-signature primitives are first-class keywords. Each effect's parameter set is
namespaced under its own block, so new effects and new parameters arrive as MINOR bumps (§17).
Each effect carries a mandatory `prefers-reduced-motion` contract (invariant I5).

### 11.1 HERO — the opening section

BLOCK-BODY → existing type `hero`, but **constrained**: the body may contain at most one
`HEADING`, at most one `TEXT`, and at most one `BUTTON`, in any order. Anything else, or a
duplicate, is error **E108** — an error, never silent dropping (invariant I1). Because HERO
children map to flat scalar fields, they are further constrained: their bodies are **plain
text** (inline markup renders literally with W407; a blank line collapses to a space, §8.5),
and each child accepts only these params — `HEADING`: `level` (the rendered heading tag,
default `1`, carried as `data.titleLevel`); `TEXT`: none; `BUTTON`: `url` and `style`
(carried as `data.buttonVariant`). Any other param on a HERO child — including the universal
set — is error **E108**.

| Param | Type | Default | Required |
|---|---|---|---|
| `image` | string | none | no |
| `height` | enum `sm`\|`md`\|`lg`\|`full` | `md` | no |
| `overlay` | integer 0–100 | `35` when `image` present, `0` otherwise | no |
| `align` | enum `start`\|`center`\|`end` (logical, RTL-aware) | `center` | no |
| `parallax` | boolean | `false` | no |

`HERO` MAY appear anywhere in the body and any number of times — "the opening section" names
its typical role, not a placement rule. A short closing-CTA hero (as in §18.2) is idiomatic;
the compiler never warns about hero count or position.

`overlay` is the opacity of a darkening layer between the image and the text, keeping text
readable over any photo. `parallax: true` fixes the hero image while content scrolls (same
engine and same touch-device degrade as BACKDROP). `height: full` fills the viewport —
expressed as a named intent, resolved by the theme, never a CSS value in the source.

```bentml
HERO {
  HEADING(level: 1) { ברוכים הבאים }
}

HERO(image: "/uploads/hero.jpg", height: lg, overlay: 45, parallax: true) {
  HEADING(level: 1) { תפוז — מערכת ניהול תוכן }
  TEXT { בונים דפים יפים בלי לריב עם הכלי. }
  BUTTON(url: "/התחלה") { מתחילים עכשיו }
}
```

Compiles to: `<section class="hero"><h1>…</h1><p class="subtitle">…</p><a class="btn btn-primary">…</a></section>`
(the heading tag follows the child's `level`, default `<h1>`), plus a background layer and
overlay when `image` is set.
JSON: `{ "type": "hero", "data": { "title", "titleLevel", "subtitle", "buttonText", "buttonUrl", "buttonVariant", "image", "height", "overlay", "align", "parallax" } }` —
the child-derived fields come from the children (`titleLevel` and `buttonVariant` are
additive and omitted at their defaults); the rest are additive. **Zero-param HERO output is
byte-identical to today's renderer.**

Reduced-motion contract: `parallax` MUST degrade to a static background under
`prefers-reduced-motion` and on touch/iOS.

### 11.2 MOTION — animated text

TEXT-BODY, **plain text only** in v0.1 — inline markup inside MOTION renders literally with
warning **W407** (§8) → new type `motion-text`.

| Param | Type | Default | Required |
|---|---|---|---|
| `effect` | enum `fade`\|`slide`\|`typewriter`\|`marquee` | `fade` | no |
| `speed` | enum `slow`\|`normal`\|`fast` | `normal` | no |
| `repeat` | enum `once`\|`loop` | `once` | no |
| `direction` | enum `start`\|`end` (logical) | `start` | no |

`direction` is logical and names the edge the text **enters from**: `start` (the default)
means the text enters at the inline-start edge and travels toward inline-end — on an RTL page
it enters at the right and flows right-to-left; on an LTR page it enters at the left and
flows left-to-right. `direction: end` is the mirror image in either page direction. An unknown
`effect` value is error **E303** listing the valid set for the declared version — so an agent
targeting `BENTML 0.1` learns precisely which effects exist in 0.1.

```bentml
MOTION { טקסט שמופיע בעדינות }

MOTION(effect: marquee, speed: slow, repeat: loop) {
  מבצע חורף — משלוח חינם עד סוף החודש
}
```

Compiles to: `<div class="motion motion-marquee" dir="rtl"><span>…</span></div>`.
JSON: `{ "type": "motion-text", "data": { "text", "effect", "speed", "repeat", "direction" } }`.

**Conformance contract (normative, not renderer goodwill):**

- Animations are CSS-only (keyframes + custom properties), plus at most a minimal
  IntersectionObserver to start `typewriter` on scroll-into-view.
- The **full text MUST always be present in the DOM** — screen readers read a marquee or
  typewriter as ordinary static text.
- Under `prefers-reduced-motion`, every effect MUST render as static, fully readable text.

### 11.3 BACKDROP — fixed background, content scrolls over it

BLOCK-BODY; children are any blocks → new type `backdrop`. This is the general-purpose
"section with a fixed image behind it".

| Param | Type | Default | Required |
|---|---|---|---|
| `image` | string | — | **yes** (error **E306** if missing) |
| `tint` | enum `dark`\|`light`\|`brand`\|`none` | `dark` | no |
| `opacity` | integer 0–100 | `50` | no |
| `fade` | boolean | `false` | no |
| `minheight` | enum `sm`\|`md`\|`lg`\|`full` | `md` | no |

`opacity` is the opacity of the **tint layer between the image and the content** — 0 shows the
bare image, 100 is a solid tint. `fade: true` fades the content layer in **as a single unit,
once, at its first intersection with the viewport** — it never replays on re-entry.
`minheight` is applied as `min-height`, **never** `height` (invariant I6: content can always
grow). Text color auto-selects from the tint (`dark` tint → the theme's on-dark palette).

```bentml
BACKDROP(image: "/uploads/valley.jpg") {
  HEADING(level: 2) { הסיפור שלנו }
  TEXT { התוכן גולל מעל תמונה קבועה. }
}

BACKDROP(image: "/uploads/night.jpg", tint: brand, opacity: 65, fade: true, minheight: lg) {
  HEADING(level: 2) { בואו נדבר }
  BUTTON(url: "/צור-קשר") { צרו קשר }
}
```

Compiles to: `<section class="backdrop" style-hooks…><div class="backdrop-media"></div><div class="backdrop-tint"></div><div class="backdrop-content">…children…</div></section>`.
JSON: `{ "type": "backdrop", "data": { "image", "tint", "opacity", "fade", "minheight", "blocks": [ … ] } }`.

**Degrade contract (part of the language guarantee):** `background-attachment: fixed` on
desktop; on touch/iOS — where fixed attachment is broken — it MUST degrade to a plain scrolling
background. Same content, same layout, invariant I1 intact. Under `prefers-reduced-motion`,
`fade` renders content fully visible immediately.

---

## 12. Raw HTML escape hatch

There is exactly one door for raw HTML:

```bentml
HTML {{{
<div class="my-widget" data-id="42">
  <script>console.log("raw zone { braces are plain here }");</script>
</div>
}}}
```

**Exact syntax:** the keyword `HTML`, then the fence `{{{` as the **last token on its line**
(nothing may follow it, not even a comment); everything until a line consisting solely of
`}}}` (optionally indented) passes through **verbatim** — no escapes, no comments, no inline
markup, braces are plain characters. `HTML` accepts **no parameters**, not even the universal
set (§7.4): `HTML(` is error **E301**. Anything other than `{{{` as the last token after the
keyword — a single `{`, two braces, trailing text, or a fence on a later line — is error
**E106**, whose message states the fence rule. A file that ends while the fence is still
open is error **E101**; the message is fence-specific: it names the `HTML` block's opening
line and gives the fix — add a line consisting solely of `}}}` (not `}`).

- Compiles to new block type `html` with `data.markup`.
- **What is sanitized: nothing** — that is the point and the danger. This is the *only*
  unescaped path in the entire system; everything else in Tapuz is escaped, always.
- **When it is allowed:** rendering is gated by the site-level setting `allowRawHtml`
  (default **off**). When off, the block renders as an HTML placeholder comment
  (`<!-- raw html suppressed: enable allowRawHtml -->`) — present in the DOM (invariant I1),
  inert on the page. Every `HTML` block is flagged in the export report regardless of the
  setting, so raw zones are always auditable.
- A literal `}}}` line inside the payload cannot be expressed; the documented remedy is
  splitting the content into two `HTML` blocks.

Editorial stance: if you are writing `HTML` more than once per site, you are fighting the
language — ask for the block you actually need.

---

## 13. RTL & bidirectional text

- **Defaults.** Pages are `direction: rtl`, `lang: he` unless META says otherwise. The
  renderer stamps `dir` on the `<html>` element and on every block-level element.
- **Per-block override.** Every visible block accepts `dir: rtl|ltr` (§7.4) — e.g. an English
  code-tutorial section inside a Hebrew page: `TEXT(dir: ltr) { English paragraph here. }`.
- **Mixed Hebrew/English/numbers.** The Unicode bidi algorithm handles the common case with no
  markup: numbers and short English words inside Hebrew sentences just work. For the cases it
  gets wrong — trailing punctuation, version strings, phone numbers, brand names — use the
  isolation spans `@LTR{...}` / `@RTL{...}`, which render as `<bdi>` so surrounding
  punctuation can never be reordered. Add `lang` when the span is genuinely another language:
  `@LTR(lang: "en"){MacBook Pro 16}`.
- **Currency amounts need no markup.** `₪190 לחודש`, `המחיר הוא $25.`, `190 ₪` all order
  correctly under the bidi algorithm — a currency sign adjacent to digits is a solved case,
  not one of the isolation cases above. Write prices bare.
- **Worked example — a Latin title with a year in Hebrew prose** (the most common article
  pattern): keep the title, its internal punctuation, and the year together inside one
  isolate — `@LTR(lang: "en"){Heathers, 1988}`, `@LTR(lang: "en"){Mean Girls (2004)}`.
  Parentheses that belong to the *Hebrew* sentence stay outside the isolate:
  `(@LTR(lang: "en"){Heathers, 1988})`. Rule of thumb: if the year reads as part of the
  title, put it (and its punctuation) inside the isolate.
- `@CODE{...}` is always rendered LTR — code fragments never flip.
- **Layout is logical.** `align: start|end`, `float: start|end`, and column order are all
  logical: `start` means right on an RTL page, left on an LTR page. The first `COL` of a `ROW`
  is what the reader sees first in either direction.
- **Authoring.** Source files are plain UTF-8; ASCII keywords anchor line starts, Hebrew flows
  inside bodies. Note: weak editors may *display* mixed lines in a confusing visual order even
  though the file is correct — visual order in an editor is not logical order.

---

## 14. SEO & metadata

- **Semantic output guarantee.** Every block compiles to the correct semantic element —
  `<h1>`–`<h6>`, `<p>`, `<figure>/<figcaption>`, `<blockquote>/<footer>`, `<ul>/<ol>`,
  `<section>`, `<article>` — never a div-soup. Public output is hand-coded-quality HTML/CSS
  with minimal JS.
- **One `<h1>` per page.** `HEADING(level: 1)` or a HERO's `HEADING(level: 1)` supplies it;
  the compiler emits warning **W408** when a page has zero or multiple level-1 headings
  (quality warning, not an error).
- **Meta description.** `META description` → `<meta name="description">`. Keep it under ~155
  characters; it is emitted escaped.
- **Social image.** `META ogimage` → `<meta property="og:image">`, alongside `og:title` from
  the page title.
- **Authorship.** `META author` → `<meta name="author">` and `article:author`; `META date`
  → `article:published_time`. Themes MAY render an automatic byline from these keys (§4.1).
- **Hebrew slugs.** First-class, normative derivation in §4.2, emitted percent-encoded in
  URLs, human-readable in the address bar.
- **Language signals.** `<html lang>` from META `lang`; inline `@LTR(lang: "en")` spans emit
  `lang` attributes so search engines and screen readers see correct per-phrase language.
- **Media.** `alt` on images is a first-class parameter with a dedicated warning (**W401**)
  when missing; images are lazy-loaded by default.

---

## 15. Theme interaction

BenTML supplies **structure and intent**; the theme (`theme.json` + its CSS) supplies **the
look**. The boundary is strict:

| Theme controls | BenTML controls |
|---|---|
| Fonts, colors, spacing scale, radii | Which blocks exist and their order |
| What `sm`/`md`/`lg`/`xl`/`full` resolve to | Which named intent each block requests |
| **Breakpoints** (`theme.json → breakpoints`) | Which breakpoint name a ROW collapses at |
| Hero band styling, on-dark palette | Hero content, overlay strength as intent |
| Animation timing curves | Effect choice, `slow`/`normal`/`fast` |

- `collapse: md` means "the theme's `md` breakpoint" — e.g. `768px` in the default theme.
  Changing the theme re-resolves every named intent on the page with no source edit.
  **Normative floor:** a theme MUST define breakpoints satisfying `sm < md < lg`, with `md`
  at least **600px** — so "stacks on mobile" (invariant I3) is a real guarantee on real
  phones, never a theme accident.
- **No inline CSS exists in normal use.** The `class` universal param is a theme hook (the
  theme defines what the class means); the `HTML` block is the only bypass, and it is gated
  (§12).
- Themes MUST honor the invariants of §9.2 — the conformance page (§9.3) machine-checks a
  theme, not just a compiler.

---

## 16. Error model

### 16.1 Levels and behavior

- **ERROR** — compilation produces **no output** (atomic, invariant I1). The parser recovers
  and keeps scanning so one run reports multiple problems: recovery resynchronizes at the
  next line that begins (after indentation) with an ASCII-letter run followed by `(`, `{`, or
  the end of the line, at nesting depth 0 — case-insensitive, so lowercase keywords and bare
  NO-BODY keywords like `SPACE` resynchronize too.
- **WARNING** — output is produced; warnings ride along in the result and CLI output.
  Warnings are also reported on a run that fails with errors: the diagnostics list carries
  both levels, so an agent can fix errors and warnings in a single pass.
- Maximum **10 diagnostics per run** (the first is always the most reliable). Under the cap,
  errors are never displaced by warnings.
- Message language is English (canonical, tool-facing); UIs may localize over the stable codes.
- `--json` mode emits each diagnostic as `{level, code, line, col, keyword, message, fix}` for
  agent pipelines.

### 16.2 Message format (normative)

One canonical line, followed by the quoted source line, and — when computable — a `Fix:` line
containing a literal corrected snippet (multi-line block shapes allowed where the fix is a
block):

```
LEVEL CODE [line N, col M] CONSTRUCT: message. FIX_HINT
  N | <the offending source line>
  Fix: <literal corrected snippet>
```

Line and column numbers are **1-based**. A column counts **Unicode code points** — never
bytes (a Hebrew letter is one column) — a tab counts as one column, and the column anchors at
the **first character of the offending token**: for value errors (E303, E304, E307) the first
character of the offending value; for parameter errors (E301, E302) the first character of
the parameter name; otherwise the first character of the offending construct or line.

When a `Fix:` line replaces an invalid value (E303), the replacement is the parameter's
**documented default**, and the Fix line reprints the entire corrected source line (or the
corrected block shape when the fix spans lines, as in E104).

**The self-correction contract (normative):** every ERROR MUST contain (a) the line, (b) the
construct, (c) what was found, (d) the complete valid alternatives, and (e) the literal fix
when computable. A compiler whose messages omit (d) is non-conforming.

### 16.3 Code catalog

Codes are stable across versions. Ranges: `E0xx` document/version · `E1xx` structure ·
`E2xx` keywords · `E3xx` parameters/values · `W4xx` quality and forward-compat.

| Code | Meaning |
|---|---|
| **E001** | missing or malformed version line |
| **E002** | document MAJOR unsupported by this compiler |
| **E101** | unclosed block (brace accounting names each unclosed block and its opening line; a file ending inside an open `HTML {{{` fence is also E101, with the fence-specific fix `}}}`) |
| **E102** | bare prose in block context (top level or inside a BLOCK-BODY) |
| **E103** | braces after a NO-BODY keyword (fires even when the `{` sits on a later line, §6.1) |
| **E104** | child not allowed here (ROW→COL, LIST→ITEM, FEATURES→FEATURE, GALLERY→IMAGE; child-only keyword outside its container) |
| **E105** | nesting deeper than the limit (a block enclosed by five or more blocks, §6.1) |
| **E106** | wrong HTML fence (anything other than `{{{` as the last token after `HTML`) |
| **E107** | inline construct shape violation: nested inline markup, a forbidden param-list or body, or a missing required body (§8.2; a missing required inline *parameter* is E306) |
| **E108** | HERO body constraint violated (wrong/duplicate child, or a disallowed param on a child) |
| **E109** | unescaped `{` in prose (Fix: `\{`) |
| **E110** | unexpected token in block context (text after `}`, `//` inside parentheses, a comment between a keyword and its `{`, a TEXT-BODY/BLOCK-BODY keyword with no `{` at all, stray characters). When prose continues on the same line after a `}`, the message adds the hint that an unescaped `}` may have closed the body early (Fix: `\}`) |
| **E111** | missing, duplicate, or misplaced META block |
| **E201** | unknown keyword (with did-you-mean; "reserved" note for reserved keywords; Markdown-shaped hint when applicable). Disambiguation from E102: a keyword-shaped token followed, after optional whitespace, by `(` or `{` is E201; anything else prose-shaped in block context is E102 |
| **E301** | unknown parameter on a known keyword (strict mode) |
| **E302** | duplicate parameter or META key |
| **E303** | invalid enum value or out-of-range integer (message lists every valid value / the valid range for the declared version) |
| **E304** | wrong value type for a known parameter |
| **E305** | ratio segment count ≠ COL count |
| **E306** | missing required parameter (also required META keys — a META block without `title` — and required inline params, §8.2) |
| **E307** | unterminated string or invalid string escape |
| **E308** | invalid explicit slug (whitespace or a forbidden character, §4.2) |
| **W401** | image missing `alt` |
| **W402** | probable misspelled inline construct (rendered literally) |
| **W403** | Markdown syntax detected in text (names the BenTML construct to use) |
| **W404** | unknown parameter preserved (forward-compat mode only) |
| **W405** | unknown keyword preserved as `x-unknown` (forward-compat mode only) |
| **W406** | unknown enum value replaced by its default (forward-compat mode only) |
| **W407** | inline markup in a plain-text body — rendered literally (BUTTON, FEATURE, MOTION, HERO children) |
| **W408** | page has zero or multiple level-1 headings |
| **W409** | HTML-tag-shaped text in prose — renders as literal escaped text (use `HTML {{{ }}}` for real markup) |
| **W410** | empty block body |

### 16.4 Example diagnostics (exact text)

The templates in this section are **normative word-for-word for their codes**. For every
other code, what is stable is the structured `--json` fields (`level, code, line, col,
keyword, fix`) plus the content requirements of §16.2; the exact message prose MAY differ
between implementations.

Unclosed block — the #1 LLM failure; the counter names *which* block and *where it opened*:

```
ERROR E101 [line 42, col 1] TEXT: block opened at line 42 was never closed. Expected "}" before end of file. 1 unclosed "{" remains (TEXT at line 42). Add "}" after the block's content.
  42 | TEXT {
```

Wrong child, with a multi-line block-shaped fix:

```
ERROR E104 [line 23, col 3] ROW: direct children of ROW must be COL blocks, found TEXT. Wrap the content in COL { ... }.
  23 |   TEXT { שני טורים }
  Fix: COL {
         TEXT { שני טורים }
       }
```

Bare prose at the top level, Markdown-shaped, with a targeted construct hint:

```
ERROR E102 [line 8, col 1] document: found "## מה חדש" outside any block. "##" looks like a Markdown heading, which BenTML does not use. All content must be inside a block.
  8 | ## מה חדש
  Fix: HEADING(level: 2) { מה חדש }
```

Invented parameter:

```
ERROR E301 [line 7, col 9] HEADING: unknown parameter "size". Valid parameters for HEADING: level, align, id, class, dir. Did you mean "level"? Remove or rename the parameter.
  7 | HEADING(size: big) { כותרת }
```

Invalid enum value:

```
ERROR E303 [line 15, col 16] MOTION: invalid value "bounce" for parameter "effect". Valid values in BENTML 0.1: fade, slide, typewriter, marquee. Replace "bounce" with one of these.
  15 | MOTION(effect: bounce) { טקסט }
  Fix: MOTION(effect: fade) { טקסט }
```

Missing required parameter:

```
ERROR E306 [line 55, col 1] BACKDROP: missing required parameter "image". BACKDROP always needs a background image.
  55 | BACKDROP(tint: dark) {
  Fix: BACKDROP(image: "/uploads/photo.jpg", tint: dark) {
```

Markdown reflex in prose (warning — compiles):

```
WARNING W403 [line 31, col 6] TEXT: "**" looks like Markdown bold, which BenTML does not use. It will render as literal asterisks. Use @B{ ... } for bold text.
  31 |   זה **חשוב** מאוד
  Fix: זה @B{חשוב} מאוד
```

### 16.5 How an AI agent self-corrects, per error class

- **E0xx (document/version):** rewrite line 1 as `BENTML 0.1`; do not touch anything else.
- **E1xx (structure):** these are shape errors. E101 tells you exactly how many `}` to add and
  where each unclosed block opened — append them innermost-first. E102/E104 include the
  corrected block shape verbatim — replace the offending lines with the `Fix:` snippet. E103:
  delete the braces (the keyword takes none). E107: make the inline construct match its fixed
  tail shape (§8.2) — flatten nesting, remove a forbidden param-list or body, add the missing
  body. E109: escape the brace (`\{`). E110: delete the stray text. E111: keep exactly one
  META block, placed immediately after the version line.
- **E2xx (keywords):** the keyword does not exist in the declared version. Take the
  did-you-mean suggestion, or pick from the valid-keyword list in the message. Never invent a
  new spelling.
- **E3xx (parameters/values):** the message always contains the complete valid set — pick from
  it. E302: delete the second occurrence. E305: make the ratio segment count equal the COL
  count. E306: copy the `Fix:` line. E307: close the quote.
- **W4xx:** the page compiled, but check each warning — W402/W403 mean your intent was
  probably not rendered as intended; apply the named construct and recompile.

---

## 17. Versioning & compatibility policy

Every document declares `BENTML MAJOR.MINOR`. The compiler has its own supported version.

| Situation | Behavior |
|---|---|
| Document MAJOR > compiler MAJOR | **E002** — refuse to compile ("requires a newer compiler"). |
| Document version ≤ compiler version (same MAJOR) | **Strict mode.** Unknown keyword → E201 (did-you-mean). Unknown param → E301 (valid list). Unknown enum value → E303 (valid list). If a document claims 0.1 and uses something 0.1 doesn't have, it's a hallucination, not the future — the agent gets maximum error surface. |
| Document MINOR > compiler MINOR (same MAJOR) | **Forward-compat mode.** See below. |
| Document MAJOR < compiler MAJOR | Compile per the old spec if the compiler retains it; otherwise E002 with a migration hint. |

**Forward-compat mode (newer-minor document) — the complete degradation surface:**

1. **Unknown keyword** → warning **W405**; the block compiles to
   `{ "type": "x-unknown", "data": { "keyword": "...", "params": { ... }, "source": "<verbatim source>" } }`
   — the body's extent is determined by the raw brace-balanced scan of §6.2.
   The renderer's default branch renders unknown types as a placeholder node — present in the
   DOM but not visible (this satisfies invariant I1 across version skew), and `decompile`
   re-emits the verbatim source. Because the raw scan honors no escapes, a document targeting
   older compilers MUST keep any `\{` / `\}` escapes inside such bodies brace-balanced, and a
   future MINOR version MUST NOT define a keyword whose canonical usage relies on unbalanced
   escaped braces.
2. **Unknown parameter** on a known keyword → warning **W404**; the value is preserved in
   `data` verbatim under its name and re-emitted on decompile.
3. **Unknown enum value** on a known parameter → warning **W406**; the documented default is
   used (content over chrome).
4. **Unknown inline construct** → never forgiven by version skew: it renders literally with
   **W402** in all modes (mis-rendered prose is corrupted output, not degraded output).
5. **`x-` params** → accepted silently, in every mode, on data-carrying keywords; still
   rejected (E301/E108) on the data-less shapes (§7.6).

**What a MINOR bump may do:** add keywords, add parameters, add enum values, add inline
constructs. **What it may never do:** change the meaning or default of anything that already
exists. Everything else — grammar changes, new escape characters, semantic changes — is a
MAJOR bump.

---

## 18. Complete example documents

Both documents below are valid BenTML 0.1 under this spec's own grammar, verified symbol by
symbol.

### 18.1 Hebrew RTL article page

```bentml
BENTML 0.1

META {
  title: "איך עברנו מוורדפרס לתפוז"
  slug: "מעבר-מוורדפרס"
  direction: rtl
  description: "הסיפור המלא של המעבר: למה עזבנו, מה למדנו, ומה היינו עושים אחרת."
  ogimage: "/uploads/2026/migration-og.jpg"
  tags: ["מאמרים", "וורדפרס"]
  status: published
}

HEADING(level: 1) { איך עברנו מוורדפרס לתפוז }

TEXT {
  אחרי שבע שנים על @LTR(lang: "en"){WordPress} עם @LTR(lang: "en"){Elementor},
  הגענו למסקנה פשוטה: אנחנו מבלים יותר זמן במלחמה עם הכלי מאשר בכתיבה.
  האתר נטען לאט, כל עדכון שבר משהו, וה-@B{תחזוקה הפכה לעבודה במשרה חלקית}.

  ההחלטה לעבור לא הייתה קלה. @LINK(url: "/מאמרים/למה-תפוז"){כתבנו על השיקולים בהרחבה},
  אבל בקצרה — רצינו בעלות מלאה על התוכן ופלט נקי.
}

IMAGE(src: "/uploads/2026/before-after.png", alt: "השוואת זמני טעינה לפני ואחרי", caption: "זמן טעינה: 4.2 שניות לפני, 0.6 אחרי")

HEADING(level: 2) { שלושת הדברים שלמדנו }

LIST(type: number) {
  ITEM { תוכן מובנה מנצח @I{עיצוב חופשי} — מגבלות טובות מולידות עקביות. }
  ITEM { ביצועים הם פיצ'ר. הקוראים מרגישים את ההבדל בין 4 שניות ל-@LTR{0.6s}. }
  ITEM { כתיבה בעברית חייבת להיות טבעית — בלי @CODE{dir} ידני בכל פסקה. }
}

QUOTE(author: "בן שלטיאל") {
  הרגע שבו הבנתי שזה עובד היה כשכתבתי עמוד שלם בלי לגעת בעכבר.
}

DIVIDER

TEXT {
  רוצים לנסות בעצמכם? @LINK(url: "/התחלה"){מדריך ההתחלה} לוקח עשר דקות.
}
```

### 18.2 English LTR landing page — all three signature effects

```bentml
BENTML 0.1

META {
  title: "Tapuz — Your Site, Your Code, Your Ownership"
  slug: "landing"
  direction: ltr
  lang: "en"
  description: "An AI-first CMS that ships hand-coded-quality pages in under a second."
  ogimage: "/uploads/2026/landing-og.jpg"
  status: published
}

// Signature effect 1: HERO with image, overlay, and parallax
HERO(image: "/uploads/2026/hero-desk.jpg", height: full, overlay: 45, parallax: true) {
  HEADING(level: 1) { Your site. Your code. Your ownership. }
  TEXT { Tapuz compiles pages that look hand-written — because effectively they are. }
  BUTTON(url: "/start") { Start for free }
}

// Signature effect 2: animated text
MOTION(effect: typewriter, speed: normal, repeat: once) {
  No plugins. No subscriptions. No surprises.
}

SPACE(size: lg)

ROW(ratio: "1:1", gap: lg, collapse: md) {
  COL {
    HEADING(level: 2) { Fast is the default }
    TEXT {
      Every page loads in under a second: no framework payloads, no render-blocking
      fonts, no client-side hydration. Read the @LINK(url: "/performance"){performance notes}
      for the full picture.
    }
    BUTTON(url: "/performance", style: secondary) { How it works }
  }
  COL {
    IMAGE(src: "/uploads/2026/lighthouse-100.png", alt: "A perfect 100 performance score")
  }
}

// Signature effect 3: fixed background with content scrolling over it
BACKDROP(image: "/uploads/2026/jerusalem-night.jpg", tint: dark, opacity: 60, fade: true) {
  HEADING(level: 2) { Built RTL-first, fluent in both directions }
  TEXT {
    Hebrew is the starting point here, not an add-on — and English pages like this
    one get the same guarantees. Mixed text such as @RTL(lang: "he"){עברית} sits
    comfortably inside an English sentence, in either direction.
  }
  TESTIMONIAL(author: "Ruth Cohen", role: "Digital Director") {
    The first system I have used where mixed-direction text simply works.
  }
}

FEATURES(columns: 3) {
  FEATURE(title: "Static export") { The whole site as clean files, at any moment. }
  FEATURE(title: "AI-writable") { Any language model writes valid pages from the spec alone. }
  FEATURE(title: "Open themes") { One theme standard, endless sites. }
}

SPACE(size: xl)

HERO(height: sm) {
  HEADING(level: 2) { Ready to start? }
  BUTTON(url: "/signup") { Open your site now }
}
```

---

## 19. Authoring notes for AI agents

This section is **normative** and self-contained: pasted alone into any assistant's system
prompt, it makes the assistant a competent BenTML author.

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
```

---

## 20. Appendices

### Appendix A — Full EBNF grammar (normative)

A conforming parser implements three lexer modes — **block mode** (default), **text mode**
(inside TEXT-BODY braces), and **raw mode** (inside HTML fences) — and parses LL(1): after any
token, one token of lookahead selects the production. Keywords select their body production
statically from the keyword table (§10); the grammar below marks the selection points.

```ebnf
(* ===================== block mode ===================== *)
document       = { skip } , version-line , { skip } , meta-block , { skip | block } ;
skip           = blank-line | comment-line ;
comment-line   = ws , "//" , { any-char - EOL } , EOL ;
version-line   = "BENTML" , SP , digits , "." , digits , ws , EOL ;
                                                  (* "BENTML" folds case-insensitively,
                                                      like every keyword (§4) *)

meta-block     = "META" , ows , "{" , { meta-entry | skip } , ows , "}" ;
meta-entry     = ws , name , ws , ":" , ws , value , [ ws , "," ] , ws , EOL ;

block          = keyword , [ ows , param-list ] , body ;
keyword        = ALPHA , { ALPHA } ;              (* case-insensitive; canonical UPPERCASE *)
param-list     = "(" , ows ,
                 [ param , { ows , "," , ows , param } , [ ows , "," ] ] ,
                 ows , ")" ;
param          = name , ows , ":" , ows , value ;
name           = ALPHA , { ALPHA | DIGIT | "-" } ; (* "-" only for the x- namespace;
                                                      case-insensitive; canonical lowercase *)
value          = string | list | bare ;
string         = '"' , { string-char | string-escape } , '"' ;
string-escape  = "\" , ( '"' | "\" | "n" | "t" | ( "u" , HEX , HEX , HEX , HEX ) ) ;
string-char    = any-char - ( '"' | "\" | EOL ) ;
bare           = bare-char , { bare-char } ;
bare-char      = ALPHA | DIGIT | "_" | "." | "-" ;
list           = "[" , ows , [ string , { ows , "," , ows , string } , [ ows , "," ] ] ,
                 ows , "]" ;

body           = text-body                        (* iff keyword is TEXT-BODY  *)
               | block-body                       (* iff keyword is BLOCK-BODY *)
               | raw-body                         (* iff keyword is HTML       *)
               | empty ;                          (* iff keyword is NO-BODY    *)
block-body     = ows , "{" , { skip | ( ows , block ) } , ows , "}" ;
raw-body       = ws , "{{{" , ws , EOL , { raw-line } , raw-close ;
                                                  (* ws, not ows: the {{{ fence MUST open on
                                                      the keyword's own line (§12, E106) *)
raw-close      = ws , "}}}" , ws , EOL ;          (* a line consisting solely of }}} *)
raw-line       = any line not matching raw-close , EOL ;

(* ===================== text mode ====================== *)
(* entered at the "{" of a TEXT-BODY keyword; exits at the matching unescaped "}" *)
text-body      = ows , "{" , text , "}" ;
text           = { text-char | text-escape | inline } ;
                                                  (* text-escape takes precedence over
                                                      text-char — maximal munch: "\\" is one
                                                      escape, never two text-chars *)
text-escape    = "\{" | "\}" | "\@" | "\\" ;
text-char      = any-char - ( "{" | "}" ) ;       (* "@" is literal unless the trigger
                                                      rule below fires *)
inline         = "@" , inline-kw , inline-tail ;  (* trigger: only when inline-kw is a
                                                      known inline keyword (case-insensitive)
                                                      followed by "(" or "{" — except BREAK,
                                                      which fires when followed by any
                                                      non-letter or the end of the body. In
                                                      plain-text bodies (BUTTON, FEATURE,
                                                      MOTION, HERO children) the trigger runs
                                                      detect-only: a match renders literally
                                                      and emits W407; W402 near-misses are
                                                      not reported there (§8). *)
inline-kw      = "B" | "I" | "LINK" | "IMG" | "LTR" | "RTL" | "CODE" | "BREAK" ;
inline-tail    = [ param-list ] , [ "{" , inline-text , "}" ] ;
                                                  (* the tail shape is FIXED per keyword by
                                                      the §8.2 table: body required for
                                                      B/I/LINK/LTR/RTL/CODE, params only for
                                                      IMG, neither for BREAK. A fired trigger
                                                      with a wrong tail is E107; a missing
                                                      required inline param is E306 (§8.2) *)
inline-text    = { text-char | text-escape } ;    (* the @ trigger rule also applies inside
                                                      inline-text: a match is error E107 —
                                                      inline constructs do not nest. An
                                                      unescaped "{" in any text position is
                                                      error E109 *)

(* ===================== terminals ====================== *)
ALPHA  = "A".."Z" | "a".."z" ;   DIGIT = "0".."9" ;   HEX = DIGIT | "A".."F" | "a".."f" ;
digits = DIGIT , { DIGIT } ;     SP = " " ;      empty = "" ;
ws     = { " " | TAB } ;                          (* intra-line whitespace — never EOL *)
ows    = { " " | TAB | EOL } ;                    (* inter-token whitespace: param lists,
                                                      JSON lists, and block bodies may span
                                                      lines; line-oriented rules use ws *)
EOL    = "\n" | "\r\n" ;         blank-line = ws , EOL ;
```

Where a blank line is derivable through both `skip` and `ows`, `skip` consumes it at the
positions where `skip` appears — the lexer owns whitespace, so the overlap is a notational
convenience, not a parse ambiguity. `raw-line` is any line whose content is not `raw-close`;
`any-char` is any Unicode scalar value.

Value-type refinement (checked after parsing, per the parameter tables): **enum** and
**boolean** are `bare` restricted to the documented set; **integer** is `bare` of digits;
**ratio** is a `string` matching `digits(":"digits)+`; quoted forms of enums and integers are
accepted and equivalent (§7.3).

### Appendix B — BenTML → Tapuz JSON block mapping

All 16 existing types covered; 3 new types (`motion-text`, `backdrop`, `html`). Body class:
T = TEXT-BODY, B = BLOCK-BODY, N = NO-BODY, R = raw-fenced.

| Keyword | Class | JSON `type` | Body maps to | Params → `data` |
|---|---|---|---|---|
| `HEADING` | T | `heading` | `text` (string/runs) | `level`, `align` |
| `TEXT` | T | `text` | `content` (string/runs; blank line = paragraph) | `align`, `size` |
| `IMAGE` | N | `image` | — | `src`*, `alt`, `caption`, `width` |
| `BUTTON` | T | `button` | `text` (label, plain) | `url`*, `style`→`variant`, `align` |
| `ROW` | B | `columns` | COL children → `columns: [{blocks}]` | `ratio`, `gap`, `collapse`, `valign` |
| `COL` | B | (column entry) | children → one `{blocks:[…]}` | — |
| `SPACE` | N | `spacer` | — | `size` |
| `DIVIDER` | N | `divider` | — | `style` |
| `LIST` | B | `list` | ITEM children → `items` | `type`→`ordered` |
| `ITEM` | T | (list item) | one item (string/runs) | — |
| `QUOTE` | T | `quote` | `text` | `author` |
| `CARD` | B | `card` | children → `blocks` | — |
| `HERO` | B (constrained) | `hero` | children → `title`, `titleLevel`, `subtitle`, `buttonText`, `buttonUrl`, `buttonVariant` | `image`, `height`, `overlay`, `align`, `parallax` |
| `TESTIMONIAL` | T | `testimonial` | `quote` | `author`, `role` |
| `GALLERY` | B | `gallery` | IMAGE children → `images: [{src,alt,caption}]` | `columns` |
| `FEATURES` | B | `features` | FEATURE children → `items: [{title,description,icon}]` | `columns` |
| `FEATURE` | T | (feature item) | `description` | `title`*, `icon` |
| `EMBED` | N | `embed` | — | `url`* |
| `ARTICLES` | N | `article-list` | — | `tag`, `limit`, `columns` |
| `MOTION` | T | `motion-text` (new) | `text` (plain) | `effect`, `speed`, `repeat`, `direction` |
| `BACKDROP` | B | `backdrop` (new) | children → `blocks` | `image`*, `tint`, `opacity`, `fade`, `minheight` |
| `HTML` | R | `html` (new) | raw → `markup` | — |

`*` = required. Universal params (`id` → `data.id`, `class` → `data.className`,
`dir` → `data.dir`) apply to every row **except** `COL`, `ITEM`, `FEATURE`, `HTML`, the
children of `HERO`, and the children of `GALLERY` — their JSON shapes have no `data` object
to carry them (§7.4). Inline
markup (structured runs) is accepted in exactly the `TEXT`, `HEADING`, `QUOTE`,
`TESTIMONIAL`, and `ITEM` bodies; every other prose body is plain text (§8, W407).
`x-`-prefixed params pass to `data` verbatim (data-carrying keywords only, §7.6); unknown
`data` fields decompile to `x-` params.
Storage `block.id` values are generated by the compiler via the existing `createBlock`
scheme.

Renames from the JSON model (three, all single-word by rule — keywords never contain hyphens):
`columns` → `ROW`+`COL` (the semantic is *a row that splits, then stacks*, and explicit `COL`
gives multi-block columns an unambiguous home); `spacer` → `SPACE`; `article-list` →
`ARTICLES`.

Renderer extensions required (additive; the plain-string path renders on today's
`renderer.js` unchanged): (R1) `renderRuns()` for structured content in `text`/`heading`/
`quote`/`testimonial`/`list`; (R2) `columns` honors `ratio`/`gap`/`collapse`/`valign`;
(R3) universal `data.dir` override; (R4) `hero` background image + overlay layer; (R5) three
new cases `motion-text`, `backdrop`, `html` (gated by `allowRawHtml`).

### Appendix C — Notes for Elementor / WordPress importers

**Importers emit BenTML source text, not JSON.** Because BenTML is canonical, diffable, and
human-reviewable, migration quality becomes a PR-style diff review; `compile` then does all
validation. This is a deliberate "the artifact is the standard" move.

- **Elementor** (JSON tree): `section`/`container` → `ROW`, `column` → `COL`, widget
  `heading` → `HEADING`, `text-editor` → `TEXT` (HTML downshifted to inline runs),
  `image` → `IMAGE`, `button` → `BUTTON`, `testimonial` → `TESTIMONIAL`, `image-gallery` →
  `GALLERY`, `icon-list` → `LIST`, sections with `background-attachment: fixed` → `BACKDROP`,
  top-of-page image sections with title/subtitle/CTA → `HERO`.
- **WordPress / Gutenberg**: `core/paragraph` → `TEXT`, `core/heading` → `HEADING`,
  `core/columns` → `ROW` + `COL`, `core/list` → `LIST` + `ITEM`, `core/quote` → `QUOTE`,
  `core/image` → `IMAGE`, `core/buttons` → `BUTTON`, `core/embed` → `EMBED`, `core/cover` →
  `HERO` or `BACKDROP`, `core/latest-posts` → `ARTICLES`. Classic-editor HTML goes through the
  same HTML-to-runs downshift as Elementor text.
- **Unconvertible fragments** become clearly marked `HTML {{{ ... }}}` blocks plus a
  `// TODO(import)` comment immediately above, so nothing is silently lost and every raw zone
  is greppable and reviewable. Remember: rendering those blocks still requires `allowRawHtml`
  (§12), and each one is flagged in the export report.
- Styling does not migrate — named intents replace inline CSS. Importers should map obvious
  intent (dark overlays → `tint: dark` + `opacity`, wide gaps → `gap: lg`) and drop the rest;
  the theme supplies the look.

---

*End of BenTML v0.1 Draft Standard. File extension `.btml`, UTF-8, `\n` and `\r\n` both
accepted. This document, the conformance page (§9.3), and the `compile`/`decompile` pair
(§6.3) together define conformance.*
