'use strict';

/**
 * v0.55 QA — the BYOT language-injection layer. Proves the roleplay "game pack",
 * the tool inventory, and the mission message builders are all generated LIVE
 * from the module registry (so they can never drift from the validator) and
 * carry the completion contract the extension watches for.
 */

const { buildDictionary, toAgentTools, toMarkdown, toCompactMarkdown, HIDDEN } = require('../src/pzn/syntax-dictionary');
const { buildRoleplayPack, buildRoleCard, buildInjectBundle, mediaInventoryMarkdown, LITE_BUDGET_CHARS, LITE_MEDIA_CAP } = require('../src/pzn/agent-roleplay');
const mi = require('../src/pzn/agent-mission');
const { listModules } = require('../src/pzn/modules/registry');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const dict = buildDictionary();
const tools = toAgentTools(dict);
// the agent's inventory = every registered module an AUTHOR may use. The
// decompile-only chrome bands (header/footer, gap-audit wave 4) are named
// apart in dict.decompileOnly and never handed to agents as tools.
const modNames = listModules().filter((m) => !m.decompileOnly).map((m) => m.name);
const decompileOnlyNames = listModules().filter((m) => m.decompileOnly).map((m) => m.name);

// ── dictionary is live off the registry ──────────────────────────────
check('dictionary covers every registered authoring module', dict.count === modNames.length);
check('decompile-only modules are named apart, never as tools',
  dict.decompileOnly.map((m) => m.name).sort().join(',') === decompileOnlyNames.sort().join(',')
  && decompileOnlyNames.every((n) => !tools.some((t) => t.tool === n)));
check('tools exclude child-only leaves (except col)',
  tools.every((t) => !HIDDEN.has(t.tool) || t.tool === 'col') && tools.some((t) => t.tool === 'col'));
check('tabs + accordion containers are in the inventory',
  tools.some((t) => t.tool === 'tabs' && t.kind === 'container') && tools.some((t) => t.tool === 'accordion'));
check('child leaves tab/fold are hidden from the inventory',
  !tools.some((t) => t.tool === 'tab') && !tools.some((t) => t.tool === 'fold'));
check('each tool has tag + how snippet + kind',
  tools.every((t) => t.tag && t.how && (t.kind === 'container' || t.kind === 'content')));

// ── roleplay pack shape ──────────────────────────────────────────────
const pack = buildRoleplayPack({ locale: 'he' });
check('pack has the Site Builder role', /Site Builder|בונה אתרים/.test(pack.text));
check('pack embeds the completion contract', /COMPLETION CONTRACT/.test(pack.text) && /PZN_READY/.test(pack.text));
// v2.21: ONE vocabulary per pack. The full pack's inventory IS the dictionary
// (the separate inventory section listed every module a second time — the TMI
// Ben called out); a pointer names the dictionary as the only tool source.
check('full pack carries the vocabulary ONCE (dictionary, not a duplicate inventory)',
  /Syntax Dictionary/.test(pack.text) && !/tool inventory \(only these\)/i.test(pack.text));
check('the pointer names the dictionary as the ONLY tool source', /המלאי שלך = המילון המלא/.test(pack.text));
check('pack moduleCount matches the registry', pack.moduleCount === modNames.length);
// "behave as a page builder the instant the injection starts": first reply is
// one ready line, every later reply is the document only — no prose fences.
check('pack forbids prose around the fence (the move IS the document)',
  /המהלך הוא המסמך/.test(pack.text));
check('pack opens play with one ready line, not an acknowledgment essay',
  /המשחק מתחיל עכשיו/.test(pack.text) && /שורה אחת בלבד/.test(pack.text));
const packWithQuest = buildRoleplayPack({ locale: 'he', playerBrief: 'דף אודות לסטודיו' });
check('a quest pack demands the document ONLY as the reply',
  /המסמך בלבד/.test(packWithQuest.text));

// ── lite pack (v0.86 — the free-tier payload) ────────────────────────
// Free chat plans (ChatGPT free etc.) reject the full pack at the message
// gate; the lite pack must stay inside the budget FOREVER, even as the
// vocabulary grows — this is the check that keeps free users in the game.
const manyMedia = Array.from({ length: 40 }, (_, i) => ({
  url: '/uploads/m' + i + '.webp',
  alt: 'a long descriptive alt text for image number ' + i + ' with plenty of detail'
}));
const lite = buildRoleplayPack({ locale: 'he', media: manyMedia, size: 'lite' });
const fullSized = buildRoleplayPack({ locale: 'he', media: manyMedia });
check(`lite pack fits the free-plan budget (${lite.chars} ≤ ${LITE_BUDGET_CHARS})`,
  lite.size === 'lite' && lite.chars <= LITE_BUDGET_CHARS);
check('lite is a fraction of the full pack', lite.chars < fullSized.chars / 2.5);
check('lite drops the full dictionary', !/Syntax Dictionary/.test(lite.text));
check('lite keeps role + contract + example move',
  /בונה אתרים/.test(lite.text) && /COMPLETION CONTRACT/.test(lite.text) &&
  /PZN_READY/.test(lite.text) && /<!DOCTYPE html>/.test(lite.text));
check('lite grammar carries the WHOLE vocabulary incl. child-only tags',
  ['bent-tab', 'bent-fold', 'bent-field', 'bent-trow'].every((t) => lite.text.includes('`' + t + '`')));
check('lite grammar maps containers to their children',
  /`bent-tabs` ⊃ bent-tab/.test(lite.text) && /`bent-accordion` ⊃ bent-fold/.test(lite.text));
check('lite grammar marks open containers (section accepts anything)',
  /`bent-section` ⊃ כל כלי/.test(lite.text));
check('lite grammar shows enum values', /=sm\|md\|lg/.test(lite.text));
check(`lite caps the media manifest at ${LITE_MEDIA_CAP} + a "more exist" note`,
  (lite.text.match(/- `\/uploads\/m\d+\.webp`/g) || []).length === LITE_MEDIA_CAP &&
  new RegExp('\\+' + (manyMedia.length - LITE_MEDIA_CAP) + ' תמונות נוספות').test(lite.text));
check('full pack keeps the whole media manifest',
  (fullSized.text.match(/- `\/uploads\/m\d+\.webp`/g) || []).length === manyMedia.length);
check('en-locale lite renders too', /any tool/.test(buildRoleplayPack({ locale: 'en', size: 'lite' }).text));
check('inject bundle reports packSize + packChars',
  buildInjectBundle({ locale: 'he', size: 'lite' }).packSize === 'lite' &&
  buildInjectBundle({ locale: 'he' }).packSize === 'full' &&
  buildInjectBundle({ locale: 'he', size: 'lite' }).packChars <= LITE_BUDGET_CHARS);
check('toCompactMarkdown covers every module',
  (() => { const md = toCompactMarkdown(dict); return dict.modules.every((m) => md.includes('`' + m.tag + '`')); })());

// playerBrief becomes the in-game quest
const quest = buildRoleplayPack({ locale: 'he', playerBrief: 'דף נחיתה למאפייה' });
check('playerBrief is injected as the quest',
  /המשימה של השחקן|Player quest/.test(quest.text) && /מאפייה/.test(quest.text));

// ── media manifest injection (v0.56 — no-key media awareness) ────────
const withMedia = buildRoleplayPack({ locale: 'he', media: [{ url: '/assets/a.jpg', alt: 'front' }, { url: '/assets/b.png', alt: '' }] });
check('media manifest injects an Available-media section', /מדיה זמינה|Available media/.test(withMedia.text));
check('media section lists the real path', /\/assets\/a\.jpg/.test(withMedia.text));
check('media section warns against inventing paths', /אל תמציא|do NOT invent/i.test(withMedia.text));
check('no-media pack omits the media section', !/מדיה זמינה|Available media/.test(buildRoleplayPack({ locale: 'he' }).text));
check('mediaInventoryMarkdown is empty for no media', mediaInventoryMarkdown([], true) === '' && mediaInventoryMarkdown(null, false) === '');
check('inject bundle reports mediaCount', buildInjectBundle({ locale: 'he', media: [{ url: '/assets/x.jpg' }] }).mediaCount === 1);

// ── role card (compact) ──────────────────────────────────────────────
const card = buildRoleCard();
check('role card lists TOOLS + WIN/LOSE', /TOOLS \(\d+\)/.test(card) && /WIN:/.test(card) && /LOSE:/.test(card));

// ── machine inject bundle ────────────────────────────────────────────
const bundle = buildInjectBundle({ locale: 'he' });
check('inject bundle is machine-complete',
  bundle.ok && bundle.kind === 'site-builder-roleplay' && bundle.roleCard &&
  bundle.roleplayMarkdown && Array.isArray(bundle.tools) && bundle.completion);

// ── mission messages ─────────────────────────────────────────────────
check('teach message carries the contract', /COMPLETION CONTRACT/.test(mi.buildTeachMessage({ provider: 'claude' })));
check('compact providers get a shorter sheet than Claude',
  mi.buildTeachMessage({ provider: 'chatgpt' }).length < mi.buildTeachMessage({ provider: 'claude' }).length);
check('build message requires a description', (() => { try { mi.buildBuildMessage({}); return false; } catch (e) { return true; } })());
check('build message embeds the brief + contract',
  /Page brief/.test(mi.buildBuildMessage({ description: 'x' })) && /COMPLETION CONTRACT/.test(mi.buildBuildMessage({ description: 'x' })));
check('every provider has url + tips', Object.values(mi.PROVIDERS).every((p) => typeof p.url === 'string' && Array.isArray(p.tips)));
check('listProviders exposes claude/chatgpt/grok/gemini',
  ['claude', 'chatgpt', 'grok', 'gemini'].every((id) => mi.listProviders().some((p) => p.id === id)));

// ── dictionary markdown ──────────────────────────────────────────────
check('dictionary markdown renders tools + completion',
  /## Tools \(modules\)/.test(toMarkdown(dict)) && /## Completion/.test(toMarkdown(dict)));


// ── v1.58: the CONNECTED copilot is briefed, not roleplayed ────────────────
// buildRoleplayPack is written for a stranger's chat tab and every line of it
// is false for the copilot at /admin/chat, which arrived through the owner's
// API key. The two share a dictionary and a media manifest but must never
// share a framing, so the split is pinned here: a regression that points the
// copilot back at the game pack would otherwise be invisible.
{
  const { buildCopilotBriefing } = require('../src/pzn/agent-roleplay');
  const media = [{ url: '/demo/tile-1.svg', alt: 'x' }];
  const brief = buildCopilotBriefing({ locale: 'he', siteTitle: 'הבית של המוזיקה', media });
  const pack = buildRoleplayPack({ locale: 'he', media });

  check('briefing knows whose assistant it is', /העוזר\/ת האישי\/ת של בעל\/ת האתר/.test(brief.text));
  check('briefing says where it is standing (inside the CMS, connected by key)',
    /בתוך ה‑CMS/.test(brief.text) && /מפתח ה‑API/.test(brief.text));
  check('briefing names the actual site it is working on', brief.text.includes('הבית של המוזיקה'));
  check('briefing explains what becomes of its output (one click → real draft)',
    /טיוטה אמיתית/.test(brief.text));
  for (const lie of ['משחק', 'שחקן', 'מהלך מנצח', 'אין מפתחות API']) {
    check(`briefing does NOT carry the game framing: "${lie}"`, !brief.text.includes(lie));
  }
  check('briefing still carries the FULL vocabulary (same dictionary as the pack)',
    brief.moduleCount === pack.moduleCount && brief.moduleCount > 30);
  check('briefing still carries the real media manifest', brief.text.includes('/demo/tile-1.svg'));
  check('briefing asks the OWNER for a missing picture, in grammatical Hebrew',
    brief.text.includes('מבעל/ת האתר') && !brief.text.includes('מהבעל/ת'));
  check('the BYOT pack keeps its own voice (player + paste), untouched',
    pack.text.includes('שחקן') && pack.text.includes('הדבק') && !pack.text.includes('מבעל/ת האתר'));

  const wired = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'routes', 'copilot.js'), 'utf8');
  check('/admin/api/ai/chat sends the BRIEFING, not the roleplay pack',
    /buildCopilotBriefing\(\{[^}]*siteTitle/.test(wired) &&
    !/const system = buildRoleplayPack/.test(wired));
}

// ── leaves hold no modules (v2.34) ─────────────────────────────────────────
// Gemma 4, live on the copilot: a bent-mediacard with a heading and a text
// inside → E_NOT_CONTAINER, and repair hoisted the kids so the card rendered
// empty. One named rule with a correct example fixed it; the dictionary's
// container badge alone did not. Both briefing tiers and the primer say it.
{
  const { buildCopilotBriefing } = require('../src/pzn/agent-roleplay');
  const { buildPznPrimer } = require('../src/pzn/agent-primer');
  const { getModule } = require('../src/pzn/modules/registry');
  const { parse } = require('../src/pzn/language/parse');
  const { validate } = require('../src/pzn/language/validate');
  const leafExample = '<bent-mediacard id="c1" title="…" excerpt="…" />';

  for (const locale of ['he', 'en']) {
    for (const tier of ['full', 'compact']) {
      const t = buildCopilotBriefing({ locale, tier }).text;
      check(`briefing ${locale}/${tier} carries the leaf rule, E_NOT_CONTAINER and a self-closing mediacard`,
        t.includes('E_NOT_CONTAINER') && t.includes(leafExample) &&
        ['bent-cta', 'bent-mediacard', 'bent-plan', 'bent-fold'].every((tag) => t.includes('`' + tag + '`')));
      // the example a model copies first must itself be a clean page
      const start = t.indexOf('```html\n<!DOCTYPE html>') + 8;
      const example = t.slice(start, t.indexOf('</body></html>', start) + 14);
      let errors = ['unparsed'];
      try { errors = validate(parse(example)).filter((x) => x.severity === 'error'); } catch (e) { errors = [e.message]; }
      check(`briefing ${locale}/${tier} example validates with no errors: cards of self-closing leaves, a cta with plain body text`,
        errors.length === 0 && /<bent-cards[^>]*>\s*<bent-mediacard [^>]*\/>/.test(example) &&
        /<bent-cta [^>]*>[^<]+<\/bent-cta>/.test(example));
    }
    check(`briefing ${locale}/full repeats the rule where the tool list starts`,
      /(מודול שאינו מסומן \*\*container\*\* הוא עלה|A module not marked \*\*container\*\* is a leaf)/.test(buildCopilotBriefing({ locale }).text));
  }
  check('the compact grammar still says a tag without ⊃ never contains tags (the compact tier leans on it)',
    buildCopilotBriefing({ tier: 'compact' }).text.includes('תג בלי ⊃ לא מכיל תגים') &&
    buildCopilotBriefing({ locale: 'en', tier: 'compact' }).text.includes('a tag without ⊃ never contains tags'));
  // the rule's counter-example, proven: a mediacard holding a heading and a
  // text (what Gemma wrote) really is refused as E_NOT_CONTAINER (from #2)
  {
    const heText = buildCopilotBriefing({ locale: 'he' }).text;
    const start = heText.indexOf('```html' + '\n<!DOCTYPE html>') + 8;
    const example = heText.slice(start, heText.indexOf('</body></html>', start) + 14);
    const nested = example.replace(/<bent-mediacard id="work_2"[^>]*\/>/,
      '<bent-mediacard id="work_2"><bent-heading id="bad_h" level="3">א</bent-heading><bent-text id="bad_t">ב</bent-text></bent-mediacard>');
    check('the nested form the rule forbids really is E_NOT_CONTAINER',
      nested !== example && validate(parse(nested)).some((d) => d.code === 'E_NOT_CONTAINER'));
  }
  check('every leaf the briefing names really is a registered leaf',
    ['cta', 'mediacard', 'plan', 'fold', 'tab', 'slide', 'feature'].every((n) => getModule(n) && !getModule(n).container));

  const primer = buildPznPrimer();
  check('primer contract item 9: leaf vs container, E_NOT_CONTAINER, the mediacard example',
    /^9\. \*\*Leaf vs container:\*\*/m.test(primer) && primer.includes('E_NOT_CONTAINER') && primer.includes(leafExample));
  check('primer marks every module Leaf or Container', (() => {
    const blocks = primer.split(/\n### `<bent-/).slice(1);
    return blocks.length > 30 && blocks.every((b) => /\n(Leaf —|Container)/.test(b));
  })());
  check('primer lists real props (it printed none before: the catalog entry has no prop schemas)',
    /### `<bent-mediacard>`[\s\S]*?Props:\n  - image: url[\s\S]*?  - excerpt: string[\s\S]*?Leaf —/.test(primer));
  check('primer says where BODY text goes (a leaf may still have a body)',
    /### `<bent-heading>`[\s\S]*?← goes in the tag BODY[\s\S]*?Leaf —/.test(primer));
}

console.log('');
console.log(fail ? 'SMOKE ROLEPLAY: FAIL' : 'SMOKE ROLEPLAY: PASS');
process.exit(fail ? 1 : 0);

console.log('');
console.log(fail ? 'SMOKE ROLEPLAY: FAIL' : 'SMOKE ROLEPLAY: PASS');
process.exit(fail ? 1 : 0);