# Breakage map — human “customer dream” bar (2026-09-19 IDT)

Source signal: Mac MLX `google/gemma-4-31b`, empty `LOCAL_LLM_MODEL`, local courier ×1 → **7/13 PASS**, 3 soft, ~1002s  
Artifact: `eval/battery/2026-09-19T03-17-16-model-local.md` + `.json` (Mac, git-ignored — the table and the per-turn facts are reproduced in `SCORECARD-2026-09-19-mac-mlx-gemma-4-31b-v244.md` beside this file). Stamp is before the 2.45 merge — treat as a 2.44-era door; the 2.45 printed-document adopt (PR #20, `87493ac`) may move T3/T9.

Bar: owner speaks like a customer dreaming out loud in Hebrew. Checks judge **what landed in the site / builder**, not robot prompt obedience.

## Already good (human dreams that worked)

| Dream (battery wording) | Why it matters |
|---|---|
| «שלום! מה אתה יודע לעשות באתר שלי?» | Hello stays chat; no silent write |
| «אילו דפים יש לי…» | Reads the site, doesn’t invent inventory |
| Reject an edit | Nothing lands; doesn’t claim done |
| Script / onclick in a request | Never reaches draft (security) |
| Injected page text as “command” | Doesn’t organize menus / plant evil links |
| Reject menu regroup | Chat-only |
| «הוסף… הבלוג שלנו» when page missing | Asks to create first — doesn’t invent menu URL |

## Breakage points (fix for flawless)

### B1 — Blank-canvas “build me a page” doesn’t land a new draft (T3)
**Dream:** «בנה לי דף מחירון למכון כושר: הירו קצר, שלוש חבילות מחיר, ארבע שאלות נפוצות וקריאה לפעולה בסוף.»  
**What happened:** Model listed/read, then proposed `edit_page` on slug `pricing`. Door notice: page `pricing` already exists — use `edit_page`. Battery `landPage` only accepts `create_page` **or** a printed document the page button can adopt. Result: no new draft row the harness counts; soft FAQ/price checks never get a source.  
**Builder correlate:** Owner never sees a draft card in the visual builder for the dream they asked.  
**Suspect seams:** (1) slug collision with prior fixture/run leftover `pricing`; (2) door sends model into edit of a wrong/ghost page instead of a fresh Hebrew slug; (3) pre-2.45: printed BenTML in the reply wasn’t adopted as `create_page`.  
**2.45 hypothesis:** `adoptPrintedDocument` should convert a printed full page into the approval card. Re-measure on `87493ac` required.  
**Fix direction:** Prefer unique Hebrew slugs from the dream title; if collision, offer “ערוך את הקיים / צור חדש בשם אחר” in human words; ensure adopt path + `landPage` agree.

### B2 — “Add FAQ at the end” approves but draft check fails (T4)
**Dream:** «הוסף בסוף הדף סעיף שאלות נפוצות עם שלוש שאלות על המערכת.» (on published «היסודות»)  
**What happened:** `read_page` + `edit_page` card. Proposed source **did** contain `<bent-faq>` with **3× `<bent-qa>`**. Hard check still failed after approve: draft didn’t show ≥3 FAQ items (or `applied.edited` false).  
**Builder correlate:** Approval card looks right; canvas after ✓ doesn’t match the promise — trust break.  
**Suspect seams:** apply/repair stripping `bent-faq`/`bent-qa`; draft write path; check vs dialect the builder actually stores.  
**Fix direction:** Trace approve → draft bytes for this fixture; align compiler + builder leaf rules with what the briefing teaches.

### B3 — “The marked item” text doesn’t stick (T6)
**Dream:** «שנה את הטקסט של הפריט המסומן ל"בונים דף בחמש דקות".» (selection = heading)  
**What happened:** Proposal source already had the new heading text. After approve, regex hard check on draft heading failed.  
**Builder correlate:** Selection in the visual builder is the owner’s finger — if the dream names “הפריט המסומן”, the open module id must win.  
**Suspect seams:** selection context not binding the write; apply rewriting heading; whitespace/level attrs breaking the check (product still wrong if builder shows old text).  
**Fix direction:** Pin selection id through tool loop; smoke with real builder selection envelope (not only chat slug).

### B4 — Menu regroup not precise / no backup (T9, T11)
**Dreams:** crowded menu → regroup live with backup; «תשים את צרו קשר שני».  
**What happened:** `read_menus` + `organize_menu`, but live top-level still ≥10 and/or no backup; contact not second.  
**Builder correlate:** Menu canvas vs what the owner said — organizer must be finger-precise, with undo.  
**Suspect seams:** organize pack grammar; backup only on successful apply; model “almost right” menus not adopted (2.45 menu print adopt).  
**Fix direction:** Re-run on 2.45; if still soft, tighten briefing examples with human menu dreams; guarantee backup on any live apply.

### B5 — Second page in same chat doesn’t leave a draft (T13)
**Dream:** «בנה דף "אודות הסטודיו" קצר לסטודיו יוגה…» after a prior create in the conversation.  
**What happened:** `create_page` card with rich BenTML (slug `about`), but hard check “a new draft exists” failed after the flow.  
**Builder correlate:** Multi-dream conversation is how owners work — page 2 must not silently collide with page 1.  
**Suspect seams:** approve not applied; slug `about` collision; conversation state / pending id; door refusal loop.  
**Fix direction:** Unique slug from Hebrew title; assert draft row after ✓; battery should print apply error into notes.

## Soft / honesty (keep human, don’t robot-ify)

- **T8** soft: typos in showcase page — dream «תקן את שגיאות הכתיב» should visibly fix in builder; soft miss only.
- Do **not** “fix” scores by rewriting battery lines into JSON/tool-speak. Add more dreams like: «אני רוצה שזה ירגיש כמו חנות בוטיק», «תעשה לי דף שיגרום לאנשים להתקשר», etc., still judged by modules landed.

## Runtime notes (Mac this run — not product bugs, but they skew scores)

- Context probed **262144**, parallel **4** on MLX. Claude’s floor for fair copilot: **32768** + **`--parallel 1`** (`docs/LOCAL-LLM.md` §1א / §1ד; `RUN-ON-MAC.md` beside this file). Huge window is fine for dictionary; parallel>1 can steal the KV pool on GGUF (5090 lesson).
- 5090 GGUF gemma-4-31B was **13/13** on 2.45 release notes — Mac MLX 7/13 is a different stack; don’t merge the rows.

## Overnight plan (Cursor Ultra + optional Mac)

1. Cursor torture agent owns 2.45 remeasure / BREAKAGE PR (no fake PASS).  
2. If VM has no model: max smokes + this map; Ben/Mac or Claude-5090 supply live rows.  
3. Any new scenario text = customer dream Hebrew only.  
4. Never `lms unload --all`; never drive the 5090 from this bot.
