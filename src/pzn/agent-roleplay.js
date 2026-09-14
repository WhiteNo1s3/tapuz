'use strict';

/**
 * Site Builder roleplay — the "injection" a user drops into their OWN AI chat.
 *
 * Metaphor: a construction game.
 *   Role  = Site Builder agent
 *   Tools = modules from the syntax dictionary (the inventory)
 *   Move  = emit ONE complete .pzn document when the player describes a page
 *
 * Users press one button (extension or /admin/inject) to inject this pack into
 * ChatGPT / Claude / Grok / Gemini (BYOT). No API keys. Then they tell the
 * primed agent the game's rules (their page description).
 *
 * (v0.55 — ported from the grokTapuziel language lab.)
 */

const { buildDictionary, toMarkdown, toCompactMarkdown, toAgentTools } = require('./syntax-dictionary');
const { COMPLETION_CONTRACT } = require('./agent-mission');

/**
 * Compact tool inventory for the roleplay (not the full dictionary).
 */
function toolsInventoryMarkdown(tools) {
  const lines = ['## Your tool inventory (only these)', ''];
  const byCat = {};
  for (const t of tools) {
    if (!byCat[t.category]) byCat[t.category] = [];
    byCat[t.category].push(t);
  }
  for (const [cat, list] of Object.entries(byCat)) {
    lines.push(`### ${cat}`);
    for (const t of list) {
      const kind = t.kind === 'container' ? '🧰 container' : '🔧 content';
      lines.push(`- **${t.tool}** (\`${t.tag}\`) — ${t.title} · ${kind}`);
      if (t.props && t.props.length) {
        lines.push(`  props: ${t.props.slice(0, 8).join(', ')}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Real media manifest (v0.56) — so the agent references images that ACTUALLY
 * exist instead of inventing paths like /uploads/x.jpg. Read-only, no key.
 */
/**
 * @param {string} [askWho] the WHOLE "from <someone>" phrase, not just a noun —
 *   Hebrew glues its preposition to the word (מהשחקן), and "בעל/ת האתר" is
 *   already definite, so a naive `מה` + noun yields the double-definite
 *   "מהבעל/ת האתר". The roleplay pack faces a "player" in a game; the
 *   connected copilot faces the site's owner, and calling the owner a player
 *   inside their own CMS is the tell that gives away a borrowed prompt.
 */
function mediaInventoryMarkdown(media, he, cap, askWho) {
  const list = (media || []).filter((m) => m && m.url);
  if (!list.length) return '';
  const who = askWho || (he ? 'מהשחקן' : 'the player');
  const shown = cap > 0 ? list.slice(0, cap) : list;
  const lines = [];
  lines.push(he
    ? '## מדיה זמינה — השתמש/י רק בנתיבים האלה (אל תמציא/י נתיבי תמונה)'
    : '## Available media — use ONLY these paths (do NOT invent image paths)');
  lines.push('');
  for (const m of shown) {
    // capped (lite) mode also trims long alts — every char counts on free plans
    const alt = m.alt && cap > 0 && m.alt.length > 60 ? m.alt.slice(0, 57) + '…' : m.alt;
    lines.push(`- \`${m.url}\`${alt ? ' — alt: ' + alt : ''}`);
  }
  if (shown.length < list.length) {
    lines.push(he
      ? `- (+${list.length - shown.length} תמונות נוספות בספרייה — בקש/י ${who} לבחור או להעלות)`
      : `- (+${list.length - shown.length} more in the library — ask ${who} to pick or upload)`);
  }
  lines.push('');
  lines.push(he
    ? `אם אין תמונה מתאימה, השאר/י את bent-image בלי src או בקש/י ${who} להעלות — אל תמציא/י נתיב.`
    : `If nothing fits, leave the bent-image without src or ask ${who} to upload — never invent a path.`);
  lines.push('');
  return lines.join('\n');
}

// The lite pack must fit ONE message on a free chat plan (ChatGPT free is the
// tightest gate). Budget in chars; smoke-roleplay enforces it so vocabulary
// growth can never silently push free users back over the limit.
const LITE_BUDGET_CHARS = 9000;
const LITE_MEDIA_CAP = 12;

/**
 * Full injectable roleplay setup for a blank chat.
 *
 * `size: 'lite'` (v0.86) — the free-tier pack. Subscribed models get the full
 * ~25KB pack (dictionary included); free plans can't paste that much, so lite
 * swaps the dictionary + inventory for the compact grammar (still the WHOLE
 * vocabulary — one line per tool) and caps the media manifest.
 * @param {{ locale?: 'he'|'en', size?: 'full'|'lite', includeFullDictionary?: boolean, playerBrief?: string, media?: Array }} [opts]
 */
function buildRoleplayPack(opts = {}) {
  const locale = opts.locale === 'en' ? 'en' : 'he';
  const lite = opts.size === 'lite';
  const dict = buildDictionary();
  const tools = toAgentTools(dict);
  const includeDict = !lite && opts.includeFullDictionary !== false;

  const he = locale === 'he';
  const lines = [];

  lines.push(he
    ? '# 🎮 משחק: בונה האתרים תפוזיאל (Site Builder Roleplay)'
    : '# 🎮 GAME: Tapuziel Site Builder Roleplay');
  lines.push('');
  lines.push(he
    ? 'הדבק/י את כל החבילה הזו בצ׳אט חדש של ה‑AI שלך (ChatGPT / Claude / Grok / Gemini).'
    : 'Paste this entire pack into a NEW chat with your AI (ChatGPT / Claude / Grok / Gemini).');
  lines.push(he
    ? 'אין מפתחות API. את/ה מביא/ה את המנוי — אנחנו מביאים את השפה והכלים.'
    : 'No API keys. You bring the subscription — we bring the language and tools.');
  lines.push('');

  lines.push(he ? '## התפקיד שלך' : '## Your role');
  lines.push('');
  lines.push(he
    ? 'את/ה **סוכן בונה אתרים** במשחק בנייה. השחקן מתאר אתר או דף בשפה פשוטה. את/ה בונה אותו רק עם **הכלים** מהמילון למטה — שפת **BenTML / `.pzn`**.'
    : 'You are the **Site Builder agent** in a construction game. The player describes a site or page in plain language. You build it **only** with **tools** from the dictionary below — the **BenTML / `.pzn`** language.');
  lines.push('');

  lines.push(he ? '## איך משחקים' : '## How to play');
  lines.push('');
  lines.push(he ? '1. השחקן מתאר מה הוא רוצה (עברית או אנגלית).' : '1. Player describes what they want (any language).');
  lines.push(he ? '2. את/ה בוחר/ת כלים מהמלאי ומרכיב/ת מסמך `.pzn` מלא.' : '2. You pick tools from inventory and compose one complete `.pzn` document.');
  lines.push(he ? '3. מהלך מנצח = fence אחד של html עם מסמך שלם + `</html>` (+ אופציונלי `PZN_READY`).' : '3. Winning move = one html fence with a complete document + `</html>` (optional `PZN_READY`).');
  // "so it won't paste build things in it" (Ben, v2.27): a chat that knows
  // web pages reaches for <div>, <style> and <script> the moment a page gets
  // interesting — those are BUILD output, not moves. Named as illegal here,
  // in the fewest words the lite pack's free-plan budget allows.
  lines.push(he
    ? '4. מהלכים לא חוקיים: HTML חופשי, `<style>`/`<script>`/CSS, מודולים או מאפיינים שלא במילון, מסמך חצוי.'
    : '4. Illegal moves: free HTML, `<style>`/`<script>`/CSS, modules or attributes not in the dictionary, incomplete documents.');
  lines.push(he
    ? '5. בלי תגיות HTML בטקסט (`<b>` `<i>` `<a>` `<br>`) — במקומן: `@B{מודגש}` · `@I{נטוי}` · `@LINK(url: "/דף"){טקסט}` · `@BREAK`.'
    : '5. No HTML tags inside text (`<b>` `<i>` `<a>` `<br>`) — instead: `@B{bold}` · `@I{italic}` · `@LINK(url: "/page"){text}` · `@BREAK`.');
  lines.push(he
    ? '6. **המהלך הוא המסמך.** שום פרוזה מסביב ל-fence: בלי "הנה הדף", בלי סיכום, בלי הצעות. ההדבקה כמו-שהיא חייבת לקמפל.'
    : '6. **The move IS the document.** No prose around the fence: no "here is your page", no summary, no offers. Pasted as-is, it must compile.');
  lines.push(he ? '7. אחרי שהמסמך מוכן השחקן מפרסם; הבונה הויזואלי מציג את אותה צורה.' : '7. After the document is ready the player publishes; the visual builder shows the same shape.');
  lines.push('');

  // ONE vocabulary per pack, never two renderings of the same modules:
  //   lite → the compact grammar (inventory + dictionary fused, fits a free
  //          plan's message gate)
  //   full → the Syntax Dictionary below is the inventory (it alone carries
  //          enums, defaults and HOW snippets); the old separate inventory
  //          section duplicated every module a second time — TMI that
  //          crowded the actual rules out of the model's attention.
  if (lite) {
    lines.push(toCompactMarkdown(dict, { locale }));
  } else {
    lines.push(he
      ? '## המלאי שלך = המילון המלא שבסוף החבילה. אין אף כלי מחוץ לו.'
      : '## Your tool inventory = the full dictionary at the end of this pack. No tool exists outside it.');
    lines.push('');
  }

  const mediaMd = mediaInventoryMarkdown(opts.media, he, lite ? LITE_MEDIA_CAP : 0);
  if (mediaMd) lines.push(mediaMd);

  lines.push(he ? '## מהלך לדוגמה (כלי → תחביר)' : '## Example move (tool → syntax)');
  lines.push('');
  lines.push('```html');
  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="he" dir="rtl" bent-version="0.1">');
  lines.push('<head><meta charset="utf-8"/><title>סטודיו</title>');
  lines.push('<meta name="bent-slug" content="studio"/></head>');
  lines.push('<body>');
  lines.push('  <bent-hero id="hero1">');
  lines.push('    <bent-heading id="hero1_h" level="1">סטודיו אור</bent-heading>');
  lines.push('    <bent-text id="hero1_t">צילום אירועים</bent-text>');
  lines.push('    <bent-button id="hero1_b" href="/contact" variant="primary">דברו איתנו</bent-button>');
  lines.push('  </bent-hero>');
  lines.push('</body></html>');
  lines.push('```');
  lines.push('PZN_READY');
  lines.push('');

  lines.push(COMPLETION_CONTRACT);
  lines.push('');

  if (includeDict) {
    lines.push('---');
    lines.push('');
    lines.push(toMarkdown(dict));
  }

  if (opts.playerBrief && String(opts.playerBrief).trim()) {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(he ? '## המשימה של השחקן עכשיו' : '## Player quest now');
    lines.push('');
    lines.push(String(opts.playerBrief).trim());
    lines.push('');
    lines.push(he
      ? 'בנה/י עכשיו את הדף. התשובה שלך היא המסמך בלבד — fence אחד שלם, בלי מילה לפניו או אחריו.'
      : 'Build the page now. Your reply is the document ONLY — one complete fence, not a word before or after it.');
  } else {
    // "behave as a page builder the instant the injection starts" (Ben):
    // the old ending invited a paragraph of acknowledgment — models restated
    // the rules, summarized the inventory, offered options. One ready line,
    // then every reply is a move.
    lines.push('');
    lines.push(he ? '## המשחק מתחיל עכשיו' : '## The game starts now');
    lines.push('');
    lines.push(he
      ? 'התגובה הראשונה שלך: שורה אחת בלבד — "מוכן. תארו את הדף." בלי לסכם את החוקים, בלי לחזור על המילון, בלי הצעות. מהתיאור הראשון של השחקן והלאה, כל תשובה שלך היא מהלך: המסמך בלבד.'
      : 'Your first reply: one line only — "Ready. Describe the page." Do not summarize the rules, do not restate the dictionary, do not offer options. From the player\'s first description on, every reply of yours is a move: the document only.');
  }

  const text = lines.join('\n');
  return {
    text,
    tools,
    moduleCount: dict.count,
    locale,
    size: lite ? 'lite' : 'full',
    chars: text.length
  };
}

/**
 * The CONNECTED copilot's briefing (v1.58) — a different scenario entirely.
 *
 * buildRoleplayPack above is written for a stranger's chat tab: it opens with
 * "paste this pack into a NEW chat", swears there are "no API keys", and casts
 * the model as a contestant in a construction game facing a "player". That is
 * right for BYOT — and every line of it is false for the copilot at
 * /admin/chat, which arrived through the owner's own API key, is already
 * inside the CMS, and is talking to the person who owns the site.
 *
 * Same vocabulary (one dictionary, one media manifest — they must never
 * diverge), opposite framing: not a game, a post. The model is told who it
 * works for, where it is standing, what becomes of its output, and what it can
 * actually see.
 *
 * Two tiers (v2.32 — the window). `tier: 'full'` (or omitted) is today's
 * text, byte for byte: the whole Syntax Dictionary at the end, ~45K chars.
 * `tier: 'compact'` is the same briefing with the compact grammar (one line
 * per tool — still the WHOLE vocabulary, the way the lite roleplay pack
 * does it), the media manifest capped like the lite pack, and one extra
 * working rule: the window is small, build short. ai.js picks the tier from
 * what the runtime actually loaded — a Gemma at 8,192 tokens got the full
 * text, LM Studio silently threw the middle of it away, and the copilot
 * answered from a briefing with no dictionary in it (map.md, addendum 1).
 * `canvas` ('blank'|'page') is echoed back for the caller; the situation
 * block that describes the canvas is the route's, appended after this text.
 * @param {{ locale?: 'he'|'en', media?: Array, siteTitle?: string, ownerName?: string, tier?: 'full'|'compact', canvas?: 'blank'|'page' }} [opts]
 */
function buildCopilotBriefing(opts = {}) {
  const locale = opts.locale === 'en' ? 'en' : 'he';
  const he = locale === 'he';
  const tier = opts.tier === 'compact' ? 'compact' : 'full';
  const compact = tier === 'compact';
  const dict = buildDictionary();
  const tools = toAgentTools(dict);
  const siteTitle = String(opts.siteTitle || '').trim();
  const ownerName = String(opts.ownerName || '').trim();
  const lines = [];

  if (he) {
    lines.push('# מי את/ה');
    lines.push('');
    lines.push('את/ה **העוזר/ת האישי/ת של בעל/ת האתר בתוך Tapuziel** — מערכת ניהול תוכן עברית.');
    lines.push('לא בוט תמיכה כללי ולא מנוע חיפוש: יש לך תפקיד אחד, ואת/ה טוב/ה בו — **לבנות ולערוך דפים בשפת BenTML**.');
    lines.push('');
    lines.push('## איפה את/ה נמצא/ת עכשיו');
    lines.push('');
    lines.push('את/ה **בתוך ה‑CMS**, במסך הקופיילוט. בעל/ת האתר חיבר/ה אותך במפתח ה‑API הפרטי שלו/ה,');
    lines.push('כלומר בחר/ה בך במודע ומשלם/ת על כל תשובה. אין כאן העתקה־הדבקה ואין לשונית צ׳אט אחרת —');
    lines.push('השיחה הזו היא הממשק. מה שאת/ה כותב/ת מגיע ישירות למערכת.');
    if (siteTitle) lines.push('');
    if (siteTitle) lines.push('**האתר שאת/ה עובד/ת עליו:** ' + siteTitle);
    if (ownerName) lines.push('**מי מולך:** ' + ownerName + ' — בעל/ת האתר.');
    lines.push('');
    lines.push('## מה קורה למה שאת/ה כותב/ת');
    lines.push('');
    lines.push('כשתשובה שלך מכילה מסמך `.pzn` שלם, המערכת מזהה אותו ומציעה כפתור אחד:');
    lines.push('**"צור דף"**. לחיצה אחת והוא הופך ל**טיוטה אמיתית** באתר, פתוחה בבונה הויזואלי,');
    lines.push('שם אפשר לגרור, לערוך ולפרסם. לכן מסמך חצוי הוא לא "כמעט" — הוא כפתור שלא נדלק.');
    lines.push('');
    lines.push('## הכלים שלך — את/ה רואה את האתר');
    lines.push('');
    lines.push('אינך עובד/ת באפלה. יש לך ארבעה כלים, ואת/ה קורא/ת לפי הצורך:');
    lines.push('');
    lines.push('- **`list_pages`** — אילו דפים קיימים (slug, כותרת, סטטוס). רץ מיד, בלי לשאול.');
    lines.push('- **`read_page`** — המקור המלא של דף קיים. רץ מיד. **חובה לקרוא דף לפני שעורכים אותו** —');
    lines.push('  עריכה מחליפה את כל התוכן, אז מי שלא קרא/ה קודם מוחק/ת בטעות.');
    lines.push('- **`create_page`** — דף חדש. **דורש אישור** מבעל/ת האתר.');
    lines.push('- **`edit_page`** — החלפת תוכן של דף קיים. **דורש אישור**.');
    lines.push('');
    lines.push('**שני הכלים שכותבים לא רצים לבד.** כשאת/ה מבקש/ת אותם, המערכת עוצרת ומציגה');
    lines.push('לבעל/ת האתר מה עומד לקרות, עם כפתור אישור. זה תקין ומכוון — אל תתנצל/י על כך');
    lines.push('ואל תנסה/י לעקוף. אם הבקשה נדחית, הצע/י משהו אחר במקום לחזור על אותה בקשה.');
    lines.push('');
    lines.push('**כשמבקשים ממך שינוי — קרא/י לכלי, אל תדפיס/י את המסמך.** תשובה שמדביקה את');
    lines.push('ה‑`.pzn` המעודכן בצ׳אט במקום לקרוא ל‑`edit_page` לא עושה כלום: אין כפתור אישור,');
    lines.push('הדף לא משתנה, ובעל/ת האתר נשאר/ת עם קיר טקסט. הדפסת מקור שמורה למקרה אחד בלבד —');
    lines.push('כשביקשו ממך במפורש "תראה לי את הקוד".');
    lines.push('');
    lines.push('כל כתיבה נשמרת כ**טיוטה**. אינך יכול/ה לפרסם, למחוק דף, לשנות ערכת נושא או הגדרות —');
    lines.push('הדברים האלה נשארים בידיים של בעל/ת האתר. אם מבקשים מהם, הסבר/י איפה זה נמצא בממשק.');
    lines.push('');
    lines.push('## איך לעבוד');
    lines.push('');
    lines.push('- **שאל/י כשחסר מידע.** עדיף שאלה קצרה אחת מאשר דף שלם שנבנה על ניחוש.');
    lines.push('- **לעריכה: קודם `read_page`, אחר כך `edit_page` עם המסמך המלא** — לא רק החלק ששונה.');
    lines.push('- **עברית ו‑RTL כברירת מחדל** — האתר עברי אלא אם נאמר אחרת.');
    lines.push('- **רק מודולים מהמלאי למטה.** אין HTML חופשי ואין תגיות שהומצאו; מה שלא במילון לא יעבור.');
    lines.push('- **מסמך אחד שלם** בכל תשובה שבונה דף — מ‑`<!DOCTYPE html>` ועד `</html>`, בתוך fence של html.');
    lines.push('- **טקסט אמיתי, לא "לורם איפסום".** כתב/י תוכן שאפשר לפרסם כמו שהוא.');
    lines.push('- **אל תמציא/י נתיבי תמונה.** יש רשימת מדיה אמיתית למטה; אם אין מתאימה — אמור/י זאת.');
    lines.push('- לשאלות שאינן בניית דף (איך משנים צבע, איפה התפריטים) — פשוט ענה/י בעברית, בלי fence.');
    // the compact tier's one extra rule: a small window cannot take a long
    // page back for editing, and a model that guesses at the part it never
    // saw deletes it — say so instead
    if (compact) lines.push('- **החלון של המודל הזה קטן** — בנה/י דפים קצרים וממוקדים; דף קיים ארוך עלול לא להיכנס לעריכה, ואז אמור/י זאת לבעל/ת האתר במקום לנחש.');
    lines.push('');
  } else {
    lines.push('# Who you are');
    lines.push('');
    lines.push("You are **the site owner's personal assistant inside Tapuziel**, a Hebrew-first CMS.");
    lines.push('Not a general support bot: you have one job and you are good at it — **building and editing pages in BenTML**.');
    lines.push('');
    lines.push('## Where you are standing');
    lines.push('');
    lines.push('You are **inside the CMS**, on the copilot screen. The owner connected you with their own');
    lines.push('API key — they chose you deliberately and pay for every reply. There is no copy-paste and no');
    lines.push('other chat tab: this conversation IS the interface, and what you write reaches the system directly.');
    if (siteTitle) lines.push('');
    if (siteTitle) lines.push('**The site you are working on:** ' + siteTitle);
    if (ownerName) lines.push('**Who you are talking to:** ' + ownerName + ' — the owner.');
    lines.push('');
    lines.push('## What happens to what you write');
    lines.push('');
    lines.push('When a reply contains a complete `.pzn` document the CMS detects it and offers one button:');
    lines.push('**Create page**. One click turns it into a real draft, open in the visual builder, ready to');
    lines.push('drag, edit and publish. A half-finished document is not "almost" — it is a button that never lights up.');
    lines.push('');
    lines.push('## How to work');
    lines.push('');
    lines.push('- **Ask when something is missing.** One short question beats a whole page built on a guess.');
    lines.push('- **Hebrew and RTL by default** unless told otherwise.');
    lines.push('- **Only modules from the inventory below.** No free HTML, no invented tags.');
    lines.push('- **One complete document** per page-building reply — `<!DOCTYPE html>` through `</html>`, in an html fence.');
    lines.push('- **Real copy, never lorem ipsum.** Write text that could ship as-is.');
    lines.push('- **Never invent image paths.** A real media list follows; if nothing fits, say so.');
    lines.push('- For non-building questions (how to change a colour, where menus live) just answer plainly, no fence.');
    if (compact) lines.push('- **This model\'s window is small** — build short, focused pages; a long existing page may not fit for editing, and then say so to the owner instead of guessing.');
    lines.push('');
  }

  lines.push(he ? '## השפה: BenTML / `.pzn`' : '## The language: BenTML / `.pzn`');
  lines.push('');
  lines.push(he
    ? 'BenTML הוא HTML מוגבל: רק תגיות `bent-*` רשומות. ההגבלה היא התכונה — כל דף הוא קובץ `.pzn` אמיתי'
    : 'BenTML is constrained HTML: only registered `bent-*` tags. The constraint IS the feature — every page is a real `.pzn` file');
  lines.push(he
    ? 'על הדיסק, קריא לאדם ולמכונה, והבונה הויזואלי מציג בדיוק את אותו מבנה.'
    : 'on disk, readable by human and machine, and the visual builder shows exactly the same structure.');
  lines.push('');

  // Same dedupe as the roleplay pack: the Syntax Dictionary at the end IS the
  // inventory (enums, defaults, HOW snippets); listing every module a second
  // time here doubled the vocabulary and diluted the actual instructions.
  if (compact) {
    lines.push(he
      ? '## הכלים שלך = הדקדוק המקוצר שבסוף ההודעה — שורה לכלי, וזה כל המילון. אין תגית מחוץ לו.'
      : '## Your tools = the compact grammar at the end of this message — one line per tool, and that is the whole dictionary. No tag exists outside it.');
  } else {
    lines.push(he
      ? '## הכלים שלך = המילון המלא שבסוף ההודעה. אין תגית מחוץ לו.'
      : '## Your tools = the full dictionary at the end of this message. No tag exists outside it.');
  }
  lines.push('');

  // compact: the lite pack's media cap and 60-char alts — every line of a
  // small window is a line the page itself cannot have
  const mediaMd = mediaInventoryMarkdown(opts.media, he, compact ? LITE_MEDIA_CAP : 0, he ? 'מבעל/ת האתר' : 'the owner');
  if (mediaMd) lines.push(mediaMd);

  lines.push(he ? '## דוגמה למסמך שלם' : '## A complete document');
  lines.push('');
  lines.push('```html');
  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="he" dir="rtl" bent-version="0.1">');
  lines.push('<head><meta charset="utf-8"/><title>סטודיו אור</title>');
  lines.push('<meta name="bent-slug" content="studio"/></head>');
  lines.push('<body>');
  lines.push('  <bent-hero id="hero1">');
  lines.push('    <bent-heading id="hero1_h" level="1">סטודיו אור</bent-heading>');
  lines.push('    <bent-text id="hero1_t">צילום אירועים בתל אביב</bent-text>');
  lines.push('    <bent-button id="hero1_b" href="/contact" variant="primary">דברו איתנו</bent-button>');
  lines.push('  </bent-hero>');
  lines.push('</body></html>');
  lines.push('```');
  lines.push('');
  lines.push(COMPLETION_CONTRACT);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(compact ? toCompactMarkdown(dict, { locale }) : toMarkdown(dict));

  const text = lines.join('\n');
  return {
    text,
    tools,
    moduleCount: dict.count,
    locale,
    chars: text.length,
    tier,
    canvas: opts.canvas === 'blank' ? 'blank' : (opts.canvas === 'page' ? 'page' : '')
  };
}

/**
 * Short "system card" for agents that already have context.
 */
function buildRoleCard(opts = {}) {
  const dict = buildDictionary();
  const tools = toAgentTools(dict);
  const names = tools.map((t) => t.tool).join(', ');
  return [
    'ROLE: Tapuziel Site Builder agent (construction game).',
    'LANGUAGE: BenTML / .pzn (constrained HTML, bent-* tags only).',
    `TOOLS (${tools.length}): ${names}`,
    'WIN: one complete fenced html document with </html> and ≥1 bent-* module.',
    'LOSE: free HTML, unknown tags, incomplete streams.',
    'After win optional line: PZN_READY',
    opts.playerBrief ? `QUEST: ${String(opts.playerBrief).trim()}` : 'QUEST: wait for player description.'
  ].join('\n');
}

/**
 * Machine pack for the extension / APIs.
 */
function buildInjectBundle(opts = {}) {
  const pack = buildRoleplayPack(opts);
  const dict = buildDictionary();
  return {
    ok: true,
    kind: 'site-builder-roleplay',
    version: '0.1',
    roleCard: buildRoleCard(opts),
    roleplayMarkdown: pack.text,
    dictionaryMarkdown: toMarkdown(dict),
    tools: pack.tools,
    dictionary: dict,
    completion: COMPLETION_CONTRACT,
    moduleCount: pack.moduleCount,
    mediaCount: (opts.media || []).length,
    packSize: pack.size,
    packChars: pack.chars
  };
}

module.exports = {
  buildRoleplayPack,
  buildCopilotBriefing,
  buildRoleCard,
  buildInjectBundle,
  toolsInventoryMarkdown,
  mediaInventoryMarkdown,
  LITE_BUDGET_CHARS,
  LITE_MEDIA_CAP
};
