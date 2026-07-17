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
const modNames = listModules().map((m) => m.name);

// ── dictionary is live off the registry ──────────────────────────────
check('dictionary covers every registered module', dict.count === modNames.length);
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
check('pack lists the tool inventory', /tool inventory/i.test(pack.text) && /\*\*hero\*\*/.test(pack.text));
check('pack includes the full dictionary by default', /Syntax Dictionary/.test(pack.text));
check('pack moduleCount matches the registry', pack.moduleCount === modNames.length);

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

console.log('');
console.log(fail ? 'SMOKE ROLEPLAY: FAIL' : 'SMOKE ROLEPLAY: PASS');
process.exit(fail ? 1 : 0);
