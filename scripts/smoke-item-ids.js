'use strict';

/**
 * Item ids survive the block model (v2.37).
 *
 * Found live on the Bridge challenges: the copilot built bridge-challenge-cards
 * with card_1…card_3, the owner opened it in the builder, and the builder's
 * silent autosave (it runs before every copilot turn) rewrote the page without
 * a single card id — so when asked to "keep every id", the model read a page
 * that had none. The block model stores a container's leaves (mediacard, qa,
 * plan, …) as plain data, and no converter case carried their ids: measured on
 * the old converter, 0 of 31 containers kept them.
 *
 * (1) every registered container, round-tripped pzn → blocks → pzn;
 * (2) the builder's own save path (updatePage with the draft blocks) on a
 *     real page in a scratch site.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const pzn = require('../src/pzn/index');
const { listModules } = require('../src/pzn/modules/registry');
const { toTapuzPage, fromTapuzPage } = require('../src/pzn/bridge/tapuz-json');

const shell = (body) =>
  '<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n<head><meta charset="utf-8"/><title>t</title></head>\n<body>\n' + body + '\n</body></html>';
const ids = (s) => (String(s).match(/\bid="[^"]+"/g) || []).map((x) => x.slice(4, -1));

// ── (1) every container, generically ──
{
  const lost = [];
  let n = 0;
  for (const m of listModules()) {
    if (!m.container || !Array.isArray(m.accept) || !m.accept.length || m.decompileOnly) continue;
    n++;
    const kid = m.accept[0];
    const body = '<bent-' + m.name + ' id="parent"><bent-' + kid + ' id="' + m.name + '_one">א</bent-' + kid + '><bent-' + kid + ' id="' + m.name + '_two">ב</bent-' + kid + '></bent-' + m.name + '>';
    try {
      const back = pzn.serialize(fromTapuzPage(JSON.parse(JSON.stringify(toTapuzPage(pzn.parse(shell(body)))))));
      if (!ids(back).includes(m.name + '_one') || !ids(back).includes(m.name + '_two')) lost.push(m.name + '⊃' + kid);
    } catch (e) {
      lost.push(m.name + ' (' + e.message.slice(0, 40) + ')');
    }
  }
  check(`every container keeps its items' ids through the block model (${n} containers${lost.length ? '; lost: ' + lost.join(', ') : ''})`, n >= 30 && lost.length === 0);
}

// a case that produces a different number of items than children carries nothing
{
  const back = pzn.serialize(fromTapuzPage(JSON.parse(JSON.stringify(toTapuzPage(pzn.parse(shell(
    '<bent-cards id="g"><bent-mediacard id="c1" title="א" excerpt="ב" /></bent-cards>')))))));
  const page = toTapuzPage(pzn.parse(shell('<bent-cards id="g"><bent-mediacard id="c1" title="א" /></bent-cards>')));
  page.blocks[0].data.items.push({ title: 'בלי מזהה' }); // the builder added an item
  const grown = pzn.serialize(fromTapuzPage(page));
  check('an item the builder adds has no id, and the existing one keeps its own',
    ids(back).includes('c1') && ids(grown).filter((i) => i === 'c1').length === 1 && (grown.match(/<bent-mediacard\b/g) || []).length === 2);
}

// ── (2) the builder's save path on a real page ──
{
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-item-ids-'));
  process.env.TAPUZ_ROOT = ROOT;
  require('../src/db');
  require('../src/setup').runSetup({
    title: 'אתר', description: 'item ids', colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const pages = require('../src/pages');
  const src = shell([
    '  <bent-heading id="h" level="1">צילום אוכל</bent-heading>',
    '  <bent-cards id="food_grid">',
    '    <bent-mediacard id="card_1" title="תפריטים" excerpt="סטודיו" href="/a" />',
    '    <bent-mediacard id="card_2" title="לייף-סטייל" excerpt="אווירה" href="/b" />',
    '    <bent-mediacard id="card_3" title="מוצרים" excerpt="אריזות" href="/c" />',
    '  </bent-cards>',
    '  <bent-faq id="faq"><bent-qa id="qa_1" question="ציוד?">הכול כלול</bent-qa></bent-faq>',
    '  <bent-pricing id="prices"><bent-plan id="plan_1" title="בסיס" price="100" /></bent-pricing>'
  ].join('\n')).replace('<title>t</title>', '<title>צילום אוכל</title><meta name="bent-slug" content="ids-page"/>');
  pages.createPage({ title: 'צילום אוכל', slug: 'ids-page', blocks: [] });
  pages.savePageSource('ids-page', src, { publish: false });
  const before = pages.getPageSource('ids-page', 'draft');
  const page = pages.getPageByFullPath('ids-page');
  // exactly what POST /admin/save does with the canvas the builder holds
  pages.updatePage('ids-page', { title: page.title, blocks: JSON.parse(JSON.stringify(page.draft_blocks)), publish: false });
  const after = pages.getPageSource('ids-page', 'draft');
  const missing = ids(before).filter((i) => !ids(after).includes(i));
  check('a builder save keeps card_1…3, qa_1 and plan_1 (the copilot\'s next read_page sees them)' + (missing.length ? ' — lost: ' + missing.join(' ') : ''),
    ['card_1', 'card_2', 'card_3', 'qa_1', 'plan_1'].every((i) => ids(after).includes(i)) && missing.length === 0);
  check('…and the saved page still validates', pzn.validate(pzn.parse(after), { strict: false }).filter((i) => i.severity === 'error').length === 0);
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

console.log('');
console.log(fail ? 'SMOKE ITEM-IDS: FAIL' : 'SMOKE ITEM-IDS: PASS');
process.exit(fail ? 1 : 0);
