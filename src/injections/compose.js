'use strict';

/**
 * composePack — the one shape every roleplay injection pack is written in
 * (v2.28). A pack is ten sections in a FIXED order, so a chat meets the same
 * rhythm whichever pack it is handed and the eval can point at a section by
 * name when a prompt variant moves the needle:
 *
 *   FRESH line → role → not-this → site state → grammar → decision ladder
 *   → hard rules (numbered) → reply format → worked example → brief | start
 *
 * The FRESH first line is byte-identical to the theme prompt's first line
 * (src/theme-roleplay.js) — smoke-pinned — because the warning it carries is
 * the same: paste this in a NEW chat, never in one that already learned the
 * page language. Only the menu organizer is composed on this today; the
 * theme/effects/site-builder prompts keep their own text this release.
 */

const FRESH_LINE = '# ⚠️ צ׳אט חדש בלבד (FRESH CHAT)';

const FRESH_TEXT = {
  he: [
    'את הבקשה הזו מדביקים ב**צ׳אט חדש לגמרי** — לא בצ׳אט שבו נבנו דפים או ערכות',
    'עם תפוזיאל. צ׳אט שכבר למד שפה אחרת יענה במסמך מהסוג הלא נכון.'
  ],
  en: [
    'Paste this into a **brand-new chat** — not one that already built pages or',
    'themes with Tapuziel. A chat that learned another dialect answers in the wrong document.'
  ]
};

const HEADINGS = {
  he: { role: '## התפקיד שלך', notThis: '## מה זה **לא**', grammar: '## הדקדוק — המסמך (תג לשורה, הערכים המותרים)', rules: '## חוקים קשיחים', format: '## מבנה התשובה', example: '## דוגמה מלאה (אתר בדיוני)', brief: '## המשימה של השחקן', start: '## המשחק מתחיל עכשיו' },
  en: { role: '## Your role', notThis: '## What this is **not**', grammar: '## The grammar — one tag per line, allowed values', rules: '## Hard rules', format: '## Reply format', example: '## Full example (a fictional site)', brief: '## The player\'s brief', start: '## The game starts now' }
};

function text(v) {
  if (v == null) return '';
  return Array.isArray(v) ? v.filter((l) => l != null).join('\n') : String(v);
}

/**
 * @param {object} spec
 *   locale 'he'|'en' · fresh (default true) · role {title, text} · notThis
 *   · state [{title, body}] · grammar · decision · rules [string] (numbered here)
 *   · rulesTail (text emitted right after the rules — variant B repeats the ladder)
 *   · format · example (raw document; fenced here as ```html) · brief · start
 * @returns {{ text: string, chars: number }}
 */
function composePack(spec = {}) {
  const locale = spec.locale === 'en' ? 'en' : 'he';
  const H = HEADINGS[locale];
  const out = [];
  const push = (...lines) => { for (const l of lines) out.push(l); };

  if (spec.fresh !== false) {
    push(FRESH_LINE, '', ...FRESH_TEXT[locale], '');
  }
  if (spec.role) {
    if (spec.role.title) push(String(spec.role.title), '');
    if (spec.role.text) push(H.role, '', text(spec.role.text), '');
  }
  if (spec.notThis) push(H.notThis, '', text(spec.notThis), '');
  for (const s of Array.isArray(spec.state) ? spec.state : []) {
    if (!s) continue;
    if (s.title) push('## ' + String(s.title), '');
    push(text(s.body), '');
  }
  if (spec.grammar) push(H.grammar, '', text(spec.grammar), '');
  if (spec.decision) push(text(spec.decision), '');
  if (Array.isArray(spec.rules) && spec.rules.length) {
    push(H.rules, '');
    spec.rules.forEach((r, i) => push(`${i + 1}. ${text(r)}`));
    push('');
    if (spec.rulesTail) push(text(spec.rulesTail), '');
  }
  if (spec.format) push(H.format, '', text(spec.format), '');
  if (spec.example) push(H.example, '', '```html', text(spec.example).replace(/\s+$/, ''), '```', '');
  if (spec.brief) push(H.brief, '', text(spec.brief), '');
  else if (spec.start) push(H.start, '', text(spec.start), '');

  const joined = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
  return { text: joined, chars: joined.length };
}

module.exports = { composePack, FRESH_LINE };
