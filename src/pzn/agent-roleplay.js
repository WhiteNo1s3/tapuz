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
function mediaInventoryMarkdown(media, he, cap) {
  const list = (media || []).filter((m) => m && m.url);
  if (!list.length) return '';
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
      ? `- (+${list.length - shown.length} תמונות נוספות בספרייה — בקש/י מהשחקן לבחור או להעלות)`
      : `- (+${list.length - shown.length} more in the library — ask the player to pick or upload)`);
  }
  lines.push('');
  lines.push(he
    ? 'אם אין תמונה מתאימה, השאר/י את bent-image בלי src או בקש/י מהשחקן להעלות — אל תמציא/י נתיב.'
    : 'If nothing fits, leave the bent-image without src or ask the player to upload — never invent a path.');
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
  lines.push(he ? '4. מהלכים לא חוקיים: HTML חופשי, מודולים שלא במילון, מסמך חצוי.' : '4. Illegal moves: free HTML, modules not in the dictionary, incomplete documents.');
  lines.push(he ? '5. אחרי שהמסמך מוכן — השחקן מפרסם ל‑CMS; הבונה הויזואלי מציג את אותה צורה.' : '5. After the document is ready the player publishes into the CMS; the visual builder shows the same shape.');
  lines.push('');

  // lite: the compact grammar IS the whole vocabulary (inventory + dictionary
  // in one) — the only rendering that fits a free plan's message gate.
  lines.push(lite ? toCompactMarkdown(dict, { locale }) : toolsInventoryMarkdown(tools));

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
      ? 'בנה/י עכשיו את הדף. מהלך מנצח אחד — fence מלא.'
      : 'Build the page now. One winning move — complete fence.');
  } else {
    lines.push('');
    lines.push(he ? '## התחלת משחק' : '## Start');
    lines.push('');
    lines.push(he
      ? 'אשר/י בקצרה שאת/ה הסוכן בונה-האתרים עם המלאי למעלה, ואז חכה/י לתיאור הדף מהשחקן.'
      : 'Briefly acknowledge you are the Site Builder with the inventory above, then wait for the player’s page description.');
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
  buildRoleCard,
  buildInjectBundle,
  toolsInventoryMarkdown,
  mediaInventoryMarkdown,
  LITE_BUDGET_CHARS,
  LITE_MEDIA_CAP
};
