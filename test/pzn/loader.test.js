'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  loadPzn,
  loadBlank,
  acceptPzn,
  applySource,
  insertModule,
  getCommand,
  getCommandCatalog,
  getAgentCommandSheet,
  moduleNames,
  listModules
} = require('../../src/pzn/index');

describe('module commands + perks', () => {
  it('every module has a command snippet and perks', () => {
    for (const name of moduleNames()) {
      const cmd = getCommand(name);
      assert.ok(cmd, name);
      assert.equal(cmd.type, name);
      assert.ok(cmd.command.snippet.includes(`<${cmd.tag}`), `${name} snippet uses ${cmd.tag}`);
      assert.ok(!cmd.command.snippet.includes('<!DOCTYPE'), 'snippet is fragment not full HTML doc');
      assert.ok(Array.isArray(cmd.perks) && cmd.perks.length >= 2, name);
      assert.ok(cmd.perks.some((p) => p.id === 'class'), 'class override perk');
      assert.ok(cmd.perks.some((p) => p.id === 'id'), 'id perk');
    }
  });

  it('agent sheet exposes insert syntax for all authoring modules', () => {
    const sheet = getAgentCommandSheet();
    assert.ok(sheet.rules.length);
    // decompile-only modules (the imported header/footer bands) stay
    // registered for the draft preview but are never handed to agents
    const authoring = listModules().filter((m) => !m.decompileOnly).map((m) => m.name);
    const decompileOnly = listModules().filter((m) => m.decompileOnly).map((m) => m.name);
    assert.equal(sheet.commands.length, authoring.length);
    assert.ok(decompileOnly.length >= 2, 'header/footer are registered as decompile-only');
    assert.ok(decompileOnly.every((n) => !sheet.commands.some((c) => c.type === n || c.tag === `bent-${n}`)));
    assert.ok(sheet.commands.every((c) => c.insert && c.tag));
  });

  it('catalog philosophy: source is bentml not html', () => {
    const cat = getCommandCatalog();
    assert.equal(cat.philosophy.source, 'bentml');
    assert.equal(cat.philosophy.notSource, 'html');
    assert.equal(cat.philosophy.file, '.pzn');
  });
});

describe('pzn loader', () => {
  it('blank provides full page payload without asking user for pzn', () => {
    const p = loadBlank();
    assert.equal(p.policy.weBuildWithUser, true);
    assert.equal(p.policy.acceptPzn, true);
    assert.equal(p.policy.neverAskUserToLearnPznFormat, true);
    assert.equal(p.policy.sourceIsBentml, true);
    assert.equal(p.policy.htmlIsCompileOutputOnly, true);
    assert.equal(p.source.language, 'bentml');
    assert.equal(p.source.htmlSourceAvailable, false);
    assert.ok(p.visualization.previewHtml.includes('<main'));
    assert.ok(p.tools.toolbox.categories.length);
    assert.ok(p.tools.commands.modules.length);
    assert.ok(p.ok);
  });

  it('accepts home.pzn and visualizes', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'examples', 'pzn', 'home.pzn'), 'utf8');
    const p = acceptPzn(src);
    assert.ok(p.ok);
    assert.equal(p.page.slug, 'home');
    assert.equal(p.page.publicFile, 'index.html');
    assert.ok(p.visualization.previewHtml.includes('hero') || p.visualization.previewHtml.includes('bent-hero') === false);
    assert.ok(p.visualization.previewHtml.includes('h1') || p.visualization.previewHtml.includes('<h1'));
    assert.ok(!p.source.text.includes('htmlSource'));
    assert.match(p.source.text, /bent-hero|bent-heading/);
  });

  it('loadPzn provides everything required for the page tools', () => {
    const p = loadPzn(null);
    assert.ok(p.tools.schemas.heading);
    assert.ok(p.tools.documentSchema);
    assert.ok(p.tools.agentSheet.commands.length);
    assert.ok(p.publish.fileName);
  });

  it('applySource round-trips edits from source panel', () => {
    const blank = loadBlank();
    const edited = blank.source.text.replace('החלום שלכם מתחיל כאן', 'כותרת חדשה לגמרי');
    const p = applySource(edited);
    assert.ok(p.ok);
    assert.ok(p.source.text.includes('כותרת חדשה לגמרי'));
    assert.ok(p.visualization.previewHtml.includes('כותרת חדשה לגמרי'));
  });

  it('insertModule writes bentml not raw html into source', () => {
    let p = loadBlank();
    p = insertModule(p.source.text, 'embed');
    assert.ok(p.ok);
    assert.match(p.source.text, /<bent-embed\b/);
    assert.ok(!p.source.text.includes('<iframe'), 'source must stay bentml');
    assert.match(p.visualization.previewHtml, /iframe|youtube/);
  });

  it('insert youtube-class module via command path', () => {
    const cmd = getCommand('embed');
    assert.ok(cmd.command.snippet.includes('youtube') || cmd.perks.some((x) => x.id === 'youtube'));
    let p = loadBlank();
    p = insertModule(p.source.text, 'text');
    assert.match(p.source.text, /<bent-text\b/);
  });

  it('custom CSS is advanced override in preview only', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'examples', 'pzn', 'home.pzn'), 'utf8');
    const p = loadPzn(src, { customCss: '.bent-heading { color: red; }' });
    assert.ok(p.visualization.previewHtml.includes('color: red'));
    assert.ok(!p.source.text.includes('color: red'), 'css does not pollute bentml source');
  });

  it('invalid source surfaces issues without throwing', () => {
    const p = loadPzn('<not-valid');
    assert.equal(p.ok, false);
    assert.ok(p.issues.some((i) => i.severity === 'error'));
  });
});
