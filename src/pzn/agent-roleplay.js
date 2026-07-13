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

const { buildDictionary, toMarkdown, toAgentTools } = require('./syntax-dictionary');
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
 * Full injectable roleplay setup for a blank chat.
 * @param {{ locale?: 'he'|'en', includeFullDictionary?: boolean, playerBrief?: string }} [opts]
 */
function buildRoleplayPack(opts = {}) {
  const locale = opts.locale === 'en' ? 'en' : 'he';
  const dict = buildDictionary();
  const tools = toAgentTools(dict);
  const includeDict = opts.includeFullDictionary !== false;

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

  lines.push(toolsInventoryMarkdown(tools));

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

  return {
    text: lines.join('\n'),
    tools,
    moduleCount: dict.count,
    locale
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
    moduleCount: pack.moduleCount
  };
}

module.exports = {
  buildRoleplayPack,
  buildRoleCard,
  buildInjectBundle,
  toolsInventoryMarkdown
};
