'use strict';

/**
 * v0.43 QA — the paste flow: primer → extract → preview → apply.
 * Runs on a throwaway TAPUZ_ROOT.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

if (!process.env.TAPUZ_ROOT) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-pzn-paste-'));
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [__filename], {
    env: { ...process.env, TAPUZ_ROOT: tmp },
    stdio: 'inherit'
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  process.exit(r.status == null ? 1 : r.status);
}

require('../src/db');
const { extractPzn } = require('../src/pzn-extract');
const { buildPznPrimer } = require('../src/pzn/agent-primer');
const { moduleNames, listModules } = require('../src/pzn/modules/registry');
const pzn = require('../src/pzn/index');
const { createPage, getPageByFullPath, savePageSource } = require('../src/pages');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

// ── primer ───────────────────────────────────────────────────────────
const primer = buildPznPrimer();
// decompile-only modules (the imported header/footer bands, gap-audit wave
// 4) stay registered — repair must accept a decompiled draft — but are
// deliberately NOT taught: the theme master is the site's real chrome
const decompileOnly = new Set(listModules().filter((m) => m.decompileOnly).map((m) => m.name));
const missing = moduleNames().filter((n) => !decompileOnly.has(n) && !primer.includes(`<bent-${n}>`));
check('primer covers every registered authoring module', missing.length === 0);
check('primer never teaches the decompile-only bands',
  decompileOnly.size > 0 && [...decompileOnly].every((n) => !primer.includes(`<bent-${n}>`)));
check('primer carries the reply contract', primer.includes('ONE fenced code block'));
check('primer includes the page template', primer.includes('bent-version="0.1"'));

// ── extraction ───────────────────────────────────────────────────────
const doc = `<!DOCTYPE html>
<html lang="he" dir="rtl" bent-version="0.1">
  <head>
    <meta charset="utf-8" />
    <title>דף מהבוט</title>
    <meta name="bent-slug" content="bot-page" />
  </head>
  <body>
    <bent-hero id="hero-1">
      <bent-heading id="hero-1-h" level="1">שלום מהבוט</bent-heading>
    </bent-hero>
    <bent-text id="t-1">פסקה שנכתבה בצ'אט.</bent-text>
  </body>
</html>`;

const botReply = `בשמחה! הנה הדף שביקשת:

\`\`\`html
${doc}
\`\`\`

אם תרצה שינויים — רק תגיד!`;

check('extract from fenced bot reply', extractPzn(botReply).trim() === doc.trim());
check('extract from bare doc in prose', extractPzn(`הנה:\n${doc}\nבהצלחה!`).trim() === doc.trim());
check('extract from clean source (identity)', extractPzn(doc).trim() === doc.trim());
check('extract from ~~~ fence', extractPzn('~~~\n' + doc + '\n~~~').trim() === doc.trim());
check('extract prefers the document fence over other fences',
  extractPzn('קודם קצת CSS:\n```css\n.x{color:red}\n```\nוהדף:\n```html\n' + doc + '\n```').trim() === doc.trim());

// ── preview (parse + validate + compile, like the endpoint) ─────────
const parsed = pzn.parse(extractPzn(botReply));
const errors = pzn.validate(parsed, { strict: false }).filter((i) => i.severity === 'error');
check('extracted source validates', errors.length === 0);
const previewHtml = pzn.buildPreviewHtml(parsed, {});
check('preview compiles to full HTML', previewHtml.includes('<h1') && previewHtml.includes('שלום מהבוט'));

// ── apply to existing page (loose end-to-end) ────────────────────────
createPage({ title: 'דף יעד', slug: 'target', blocks: [] });
const result = savePageSource('target', extractPzn(botReply));
check('loose apply saves blocks', result.blocks.length === 2);
const page = getPageByFullPath('target');
check('title synced from bot source', page.title === 'דף מהבוט');
check('draft file holds the bot page', fs.readFileSync(
  require('../src/pzn-store').pznPathFor('target', 'draft'), 'utf8').includes('שלום מהבוט'));

// ── create-from-source path (slug from bent-slug) ────────────────────
const slug = (parsed.slug || '').trim();
check('bot doc carries slug', slug === 'bot-page');
createPage({ title: parsed.title, slug, blocks: [] });
savePageSource(slug, extractPzn(botReply), { publish: true });
const created = getPageByFullPath('bot-page');
check('create-from-source page published', created.status === 'published' && created.blocks.length === 2);

console.log('');
console.log(fail ? 'SMOKE PZN PASTE: FAIL' : 'SMOKE PZN PASTE: PASS');
process.exit(fail ? 1 : 0);
