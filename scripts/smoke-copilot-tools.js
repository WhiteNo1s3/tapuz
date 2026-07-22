'use strict';

/**
 * v1.59 QA — the copilot can act, and the gate that means it still can't act
 * ALONE.
 *
 * Giving a model tools reverses the guarantee the previous design rested on
 * ("the reply is a string; nothing executes it"). What replaces it is a single
 * rule: a mutating tool is never executed on the model's say-so. The loop
 * stops, hands a description to the owner, and only an explicit approval —
 * carrying an id the browser cannot forge into something else — lets it run.
 *
 * So this file's job is to try to get a write past the gate. If any of these
 * ever go green-to-red, the copilot has quietly become something that edits a
 * person's site without asking.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-tools-'));

const tools = require('../src/ai-tools');
const ai = require('../src/ai');
const { createPage } = require('../src/pages');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

// ── the tool surface: what exists, and what deliberately does not ─────────
const names = tools.TOOLS.map((t) => t.name).sort();
check('the copilot can look (list_pages, read_page)',
  names.includes('list_pages') && names.includes('read_page'));
check('the copilot can propose writes (create_page, edit_page)',
  names.includes('create_page') && names.includes('edit_page'));
for (const forbidden of ['publish_page', 'delete_page', 'save_theme', 'save_settings', 'run_sql', 'build_site']) {
  check(`NO tool named ${forbidden} exists`, !names.includes(forbidden));
}
check('reads are marked safe, writes are marked mutating',
  tools.getTool('list_pages').mutates === false &&
  tools.getTool('read_page').mutates === false &&
  tools.getTool('create_page').mutates === true &&
  tools.getTool('edit_page').mutates === true);
check('every tool carries a description and a JSON schema',
  tools.TOOLS.every((t) => t.description && t.schema && t.schema.type === 'object'));
check('both provider envelopes are produced from the same schemas',
  tools.toolsForProvider('openai-chat').every((t) => t.type === 'function' && t.function.parameters) &&
  tools.toolsForProvider('anthropic-messages').every((t) => t.name && t.input_schema));

// ── the tools themselves do what they claim ──────────────────────────────
const PZN = (title, body, slug = 'tool-test') =>
  '<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n<head><meta charset="utf-8"/>' +
  `<title>${title}</title><meta name="bent-slug" content="${slug}"/></head>\n<body>\n` +
  `  <bent-heading id="h1" level="1">${body}</bent-heading>\n</body></html>`;

createPage({ title: 'דף קיים', slug: 'existing', status: 'published', blocks: [] });
check('list_pages sees the real site', tools.getTool('list_pages').run().pages.some((p) => p.slug === 'existing'));
check('read_page returns real .pzn source', /bent-version/.test(tools.getTool('read_page').run({ slug: 'existing' }).source));
check('read_page on a missing page is a clear error, not a crash', (() => {
  try { tools.getTool('read_page').run({ slug: 'nope' }); return false; } catch (e) { return /nope/.test(e.message); }
})());

const made = tools.getTool('create_page').run({ source: PZN('דף מהכלי', 'שלום') });
check('create_page makes a page', made.created && made.slug === 'tool-test');
check('create_page leaves it as a DRAFT — never published',
  require('../src/pages').getPageByFullPath('tool-test').status !== 'published');
check('create_page refuses to clobber an existing slug', (() => {
  try { tools.getTool('create_page').run({ source: PZN('שוב', 'x') }); return false; }
  catch (e) { return /כבר קיים/.test(e.message); }
})());
check('a document with no bent-* modules is refused', (() => {
  try { tools.getTool('create_page').run({ source: '<!DOCTYPE html><html><head><title>x</title></head><body></body></html>' }); return false; }
  catch (e) { return true; }
})());
const edited = tools.getTool('edit_page').run({ slug: 'existing', source: PZN('דף קיים', 'אחרי עריכה') });
check('edit_page rewrites the draft', edited.edited);
check('edit_page does NOT publish the change (the live page is untouched)', (() => {
  const p = require('../src/pages').getPageByFullPath('existing');
  const live = JSON.stringify(p.blocks || []);
  return !/אחרי עריכה/.test(live);
})());

// ── the gate: a write must never run without approval ────────────────────
// converse() is driven with a fake provider so the "model" can be as hostile
// as we like. Every path a write could take to execution is walked.
const providers = require('../src/providers');
providers.PROVIDERS.__fake = {
  id: '__fake', label: 'test', endpoint: 'http://127.0.0.1:1/v1/chat/completions',
  method: 'POST', authScheme: 'bearer', authHeader: 'Authorization', extraHeaders: {},
  defaultModel: 'm', models: [], openModel: true, keyOptional: true, maxTokens: 100,
  responsePath: ['choices', 0, 'message', 'content'],
  body: { style: 'openai-chat' }, baseUrlDefault: 'http://127.0.0.1:1/v1'
};

let scripted = [];
global.fetch = async () => ({
  ok: true, json: async () => scripted.shift() || { choices: [{ message: { content: 'done', tool_calls: null } }] }
});
ai.saveSettings({ provider: '__fake', baseUrl: 'http://127.0.0.1:1/v1' });

const wantsWrite = {
  choices: [{
    message: {
      content: 'אני אבנה', tool_calls: [{
        id: 'c1', type: 'function',
        function: { name: 'create_page', arguments: JSON.stringify({ source: PZN('לא מאושר', 'לא') }) }
      }]
    }
  }]
};

(async () => {
  const before = require('../src/pages').listPages().length;
  scripted = [wantsWrite];
  const out = await ai.converse({ system: 's', user: 'בנה דף' });
  check('a proposed WRITE stops the loop and returns a pending approval',
    !!out.pending && out.pending.tool === 'create_page' && !!out.pending.id);
  check('the pending carries a human summary of what would happen',
    typeof out.pending.summary === 'string' && out.pending.summary.length > 3);
  check('NOTHING was written while waiting for approval',
    require('../src/pages').listPages().length === before);

  // refusing must not write, and must tell the model so
  scripted = [{ choices: [{ message: { content: 'הבנתי, לא אבצע', tool_calls: null } }] }];
  const refused = await ai.converse({ approve: { id: out.pending.id, ok: false } });
  check('a REFUSED proposal writes nothing',
    require('../src/pages').listPages().length === before);
  check('a refusal still returns the model a chance to respond', typeof refused.reply === 'string');
  check('a pending id is single-use — replaying it is rejected', await (async () => {
    try { await ai.converse({ approve: { id: out.pending.id, ok: true } }); return false; }
    catch (e) { return /פגה/.test(e.message); }
  })());
  check('an invented pending id is rejected', await (async () => {
    try { await ai.converse({ approve: { id: 'pend_deadbeef', ok: true } }); return false; }
    catch (e) { return /פגה/.test(e.message); }
  })());

  // approving DOES write — a slug nothing else in this file has claimed, so a
  // "already exists" refusal can't be mistaken for the gate holding
  scripted = [{
    choices: [{
      message: {
        content: 'אני אבנה', tool_calls: [{
          id: 'c2', type: 'function',
          function: { name: 'create_page', arguments: JSON.stringify({ source: PZN('מאושר', 'כן', 'approved-page') }) }
        }]
      }
    }]
  }];
  const again = await ai.converse({ system: 's', user: 'בנה דף' });
  scripted = [{ choices: [{ message: { content: 'נוצר', tool_calls: null } }] }];
  await ai.converse({ approve: { id: again.pending.id, ok: true } });
  check('an APPROVED proposal actually writes',
    !!require('../src/pages').getPageByFullPath('approved-page') &&
    require('../src/pages').listPages().length === before + 1);
  check('...and what it wrote is a DRAFT, not a live page',
    require('../src/pages').getPageByFullPath('approved-page').status !== 'published');

  // reads need no approval — a model forced to beg to look will guess instead
  scripted = [
    { choices: [{ message: { content: '', tool_calls: [{ id: 'r1', type: 'function', function: { name: 'list_pages', arguments: '{}' } }] } }] },
    { choices: [{ message: { content: 'יש לך כמה דפים', tool_calls: null } }] }
  ];
  const readOnly = await ai.converse({ system: 's', user: 'אילו דפים יש?' });
  check('a READ runs without asking and the answer comes back',
    !readOnly.pending && readOnly.used.includes('list_pages') && /דפים/.test(readOnly.reply));

  // a runaway tool loop terminates
  scripted = Array.from({ length: 12 }, () => ({
    choices: [{ message: { content: '', tool_calls: [{ id: 'x', type: 'function', function: { name: 'list_pages', arguments: '{}' } }] } }]
  }));
  const runaway = await ai.converse({ system: 's', user: 'loop' });
  check('a model that never stops calling tools is cut off, not left spinning',
    !runaway.pending && /עצרתי/.test(runaway.reply));

  // an unknown tool name is answered, not thrown
  scripted = [
    { choices: [{ message: { content: '', tool_calls: [{ id: 'u1', type: 'function', function: { name: 'drop_database', arguments: '{}' } }] } }] },
    { choices: [{ message: { content: 'אין לי כלי כזה', tool_calls: null } }] }
  ];
  const unknown = await ai.converse({ system: 's', user: 'x' });
  check('an invented tool name is refused as a tool error, never executed',
    !unknown.pending && typeof unknown.reply === 'string');

  console.log('');
  console.log(fail ? 'SMOKE COPILOT-TOOLS: FAIL' : 'SMOKE COPILOT-TOOLS: PASS');
  process.exit(fail ? 1 : 0);
})();
