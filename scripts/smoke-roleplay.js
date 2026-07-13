'use strict';

/**
 * v0.55 QA — the BYOT language-injection layer. Proves the roleplay "game pack",
 * the tool inventory, and the mission message builders are all generated LIVE
 * from the module registry (so they can never drift from the validator) and
 * carry the completion contract the extension watches for.
 */

const { buildDictionary, toAgentTools, toMarkdown, HIDDEN } = require('../src/pzn/syntax-dictionary');
const { buildRoleplayPack, buildRoleCard, buildInjectBundle, mediaInventoryMarkdown } = require('../src/pzn/agent-roleplay');
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
