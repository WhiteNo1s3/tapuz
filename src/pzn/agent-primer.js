'use strict';

/**
 * Agent primer — the paste-into-any-AI document that teaches a bot to write
 * Tapuziel pages in .pzn (benTML dialect).
 *
 * Generated from the live module registry + command catalog so it can never
 * drift from what the validator accepts. Hebrew-first (the user audience),
 * with the syntax rules bots need in English (they parse either fine).
 */

const { getCommandCatalog } = require('./modules/commands');

function propLine(name, schema) {
  const bits = [schema.type];
  if (schema.values) bits.push(schema.values.join('|'));
  if (schema.min != null || schema.max != null) bits.push(`${schema.min ?? ''}–${schema.max ?? ''}`);
  if (schema.default !== undefined && schema.default !== '') bits.push(`default: ${schema.default}`);
  if (schema.content) bits.push('← goes in the tag BODY, not as an attribute');
  return `  - ${name}: ${bits.join(', ')}`;
}

/**
 * @returns {string} markdown primer
 */
function buildPznPrimer() {
  const catalog = getCommandCatalog();
  const lines = [];

  lines.push('# Tapuziel .pzn primer — teach your AI to build pages');
  lines.push('');
  lines.push('אתם עוזרים לבנות דפים ב‑CMS תפוזיאל. הדפים נכתבים בשפת **‎.pzn** — HTML מוגבל שבו כל רכיב הוא תג `bent-*` רשום. אין HTML חופשי.');
  lines.push('');
  lines.push('## Contract (follow exactly)');
  lines.push('');
  lines.push('1. Reply with **ONE fenced code block** containing a **complete .pzn document** (`<!DOCTYPE html>` … `</html>`). Explanations go outside the fence.');
  lines.push('2. Body may contain **only registered `bent-*` tags** listed below. Raw HTML tags in the body are a build error.');
  lines.push('3. Every module gets a stable, unique `id` attribute (kebab or snake, e.g. `hero-1`).');
  lines.push('4. Hebrew site: keep `<html lang="he" dir="rtl">` unless asked otherwise.');
  lines.push('5. Page title goes in `<title>`; slug in `<meta name="bent-slug" content="...">` (do not change the slug unless asked).');
  lines.push('6. Tags/teaser/card image (for article cubes): `<meta name="bent-tags|bent-teaser|bent-card-image" content="...">`.');
  lines.push('7. Styling comes from module props; `class="..."` is an advanced escape hatch — never invent inline styles.');
  lines.push('8. If you are correcting a previous attempt, return the full corrected document again.');
  lines.push('');
  lines.push('## Page template');
  lines.push('');
  lines.push('```html');
  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="he" dir="rtl" bent-version="0.1">');
  lines.push('  <head>');
  lines.push('    <meta charset="utf-8" />');
  lines.push('    <title>כותרת הדף</title>');
  lines.push('    <meta name="bent-slug" content="my-page" />');
  lines.push('  </head>');
  lines.push('  <body>');
  lines.push('    <!-- bent-* modules here -->');
  lines.push('  </body>');
  lines.push('</html>');
  lines.push('```');
  lines.push('');
  lines.push(`## Modules (${catalog.modules.length}) — the complete vocabulary`);
  lines.push('');

  for (const mod of catalog.modules) {
    lines.push(`### \`<${mod.tag}>\` — ${mod.label.he} / ${mod.label.en}`);
    lines.push('');
    lines.push('```html');
    lines.push(mod.command.snippet);
    lines.push('```');
    const props = Object.entries(mod.props || {}).filter(([k]) => k !== 'id' && k !== 'class');
    if (props.length) {
      lines.push('Props:');
      for (const [name, schema] of props) lines.push(propLine(name, schema));
    }
    if (mod.container) {
      lines.push(`Container${mod.accept && mod.accept.length ? ` — children: only \`bent-${mod.accept.join('`, `bent-')}\`` : ' — nest other modules inside'}.`);
    }
    lines.push('');
  }

  lines.push('## Worked example — hero + two columns');
  lines.push('');
  lines.push('```html');
  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="he" dir="rtl" bent-version="0.1">');
  lines.push('  <head>');
  lines.push('    <meta charset="utf-8" />');
  lines.push('    <title>סטודיו לצילום</title>');
  lines.push('    <meta name="bent-slug" content="studio" />');
  lines.push('  </head>');
  lines.push('  <body>');
  lines.push('    <bent-hero id="hero-1" height="lg">');
  lines.push('      <bent-heading id="hero-1-h" level="1">סטודיו אור</bent-heading>');
  lines.push('      <bent-text id="hero-1-t">צילום אירועים ותדמית</bent-text>');
  lines.push('      <bent-button id="hero-1-btn" href="/contact" variant="primary">דברו איתנו</bent-button>');
  lines.push('    </bent-hero>');
  lines.push('    <bent-columns id="split-1" gap="md">');
  lines.push('      <bent-col id="split-1-a" width="1/2">');
  lines.push('        <bent-text id="split-1-a-t">עשר שנות ניסיון.</bent-text>');
  lines.push('      </bent-col>');
  lines.push('      <bent-col id="split-1-b" width="1/2">');
  lines.push('        <bent-image id="split-1-b-img" src="/uploads/studio.jpg" alt="הסטודיו" />');
  lines.push('      </bent-col>');
  lines.push('    </bent-columns>');
  lines.push('  </body>');
  lines.push('</html>');
  lines.push('```');
  lines.push('');
  lines.push('עכשיו שאלו את המשתמש מה הוא רוצה לבנות — וענו תמיד עם מסמך ‎.pzn מלא אחד בתוך code block.');
  lines.push('');

  return lines.join('\n');
}

module.exports = { buildPznPrimer };
