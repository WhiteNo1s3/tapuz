'use strict';

/**
 * Syntax dictionary — live map of the BenTML page language for humans + agents.
 * Built ONLY from the module registry / command catalog so it can never drift
 * from what the validator accepts.
 *
 * Forms:
 *   buildDictionary()     → machine JSON
 *   toMarkdown(dict)      → human markdown (injectable + docs)
 *   toAgentTools(dict)    → tool cards for roleplay / tool-use style agents
 *
 * (v0.55 — ported from the grokTapuziel language lab; the "tools" an agent gets
 * ARE the bent-* modules, presented as a tool inventory.)
 */

const { listModules } = require('./modules/registry');
const { getCommand, getCommandCatalog } = require('./modules/commands');

// Child-only leaves — nested inside a container, never used at the top level.
// Kept in the dictionary (agents must know how to fill a container) but marked
// childOnly and hidden from the flat tool inventory (except `col`, which is the
// one child type agents place directly when building columns).
const HIDDEN = new Set(['item', 'feature', 'stat', 'logo', 'qa', 'col', 'tab', 'fold', 'field', 'mediacard', 'navitem', 'tickeritem', 'plan', 'member', 'priceitem', 'bar', 'day', 'tocitem']);

/**
 * @returns {object} full dictionary catalog
 */
function buildDictionary() {
  const catalog = getCommandCatalog();
  const modules = [];

  for (const def of listModules()) {
    const cmd = getCommand(def.name);
    const props = {};
    for (const [k, schema] of Object.entries(def.props || {})) {
      if (k === 'id' || k === 'class') continue;
      props[k] = {
        type: schema.type,
        optional: !!schema.optional,
        content: !!schema.content,
        values: schema.values || undefined,
        min: schema.min,
        max: schema.max,
        default: schema.default,
        label: schema.label
      };
    }
    modules.push({
      name: def.name,
      tag: def.tag,
      category: def.category,
      label: def.label,
      icon: def.icon,
      container: !!def.container,
      accept: def.accept || [],
      childOnly: HIDDEN.has(def.name),
      props,
      snippet: cmd ? cmd.command.snippet : '',
      command: cmd
        ? {
            name: cmd.command.name,
            intent: cmd.command.intent,
            description: cmd.command.description
          }
        : null,
      perks: (cmd && cmd.perks) || []
    });
  }

  const byCategory = {};
  for (const m of modules) {
    if (!byCategory[m.category]) byCategory[m.category] = [];
    byCategory[m.category].push(m);
  }

  return {
    version: '0.1',
    format: 'pzn-bentml',
    generatedAt: new Date().toISOString(),
    count: modules.length,
    philosophy: catalog.philosophy,
    document: {
      shell: '<!DOCTYPE html><html lang="he" dir="rtl" bent-version="0.1">…</html>',
      slugMeta: '<meta name="bent-slug" content="…">',
      tagsMeta: '<meta name="bent-tags" content="article">',
      rules: [
        'Body may contain only registered bent-* tags',
        'Every module needs a unique id',
        'Source is .pzn (BenTML dialect) — never edit public HTML as source',
        'class= is the advanced CSS escape hatch',
        'Containers nest modules; leaves hold text or empty'
      ]
    },
    categories: byCategory,
    modules
  };
}

/**
 * Tool cards — each module is a "tool" the site-builder agent may use.
 */
function toAgentTools(dict = buildDictionary()) {
  return dict.modules
    .filter((m) => !m.childOnly || m.name === 'col')
    .map((m) => {
      const propKeys = Object.keys(m.props || {});
      return {
        tool: m.name,
        tag: m.tag,
        title: `${m.label.en} / ${m.label.he}`,
        kind: m.container ? 'container' : 'content',
        category: m.category,
        accept: m.accept,
        props: propKeys,
        how: m.snippet,
        intent: m.command ? m.command.intent : `use ${m.name}`
      };
    });
}

/**
 * Human markdown dictionary (injectable + docs).
 */
function toMarkdown(dict = buildDictionary()) {
  const lines = [];
  lines.push('# Tapuziel Syntax Dictionary — BenTML / `.pzn`');
  lines.push('');
  lines.push('> **Live map of the page language.** Generated from the module registry.');
  lines.push(`> Modules: **${dict.count}** · format: \`${dict.format}\` · ${dict.generatedAt}`);
  lines.push('');
  lines.push('Agents write **BenTML** (`.pzn` files). The page builder shows the same shape.');
  lines.push('Users describe the site in plain language; agents use **tools** (modules) from this dictionary.');
  lines.push('');
  lines.push('## Document shell');
  lines.push('');
  lines.push('```html');
  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="he" dir="rtl" bent-version="0.1">');
  lines.push('  <head>');
  lines.push('    <meta charset="utf-8" />');
  lines.push('    <title>Page title</title>');
  lines.push('    <meta name="bent-slug" content="my-page" />');
  lines.push('  </head>');
  lines.push('  <body>');
  lines.push('    <!-- only bent-* tools here -->');
  lines.push('  </body>');
  lines.push('</html>');
  lines.push('```');
  lines.push('');
  lines.push('## Rules');
  lines.push('');
  for (const r of dict.document.rules) lines.push(`- ${r}`);
  lines.push('');
  lines.push('## Tools (modules)');
  lines.push('');

  const catOrder = ['content', 'layout', 'data', 'media', 'effects', 'advanced'];
  const cats = [
    ...catOrder.filter((c) => dict.categories[c]),
    ...Object.keys(dict.categories).filter((c) => !catOrder.includes(c))
  ];

  for (const cat of cats) {
    const list = dict.categories[cat] || [];
    lines.push(`### ${cat}`);
    lines.push('');
    for (const m of list) {
      const badge = m.container ? ' · **container**' : '';
      const child = m.childOnly ? ' · *child type*' : '';
      lines.push(`#### \`${m.tag}\` — ${m.label.he} / ${m.label.en}${badge}${child}`);
      lines.push('');
      if (m.accept && m.accept.length) {
        lines.push(`Accepts children: \`${m.accept.join('`, `')}\``);
        lines.push('');
      }
      const propEntries = Object.entries(m.props || {});
      if (propEntries.length) {
        lines.push('| Prop | Type | Notes |');
        lines.push('|------|------|-------|');
        for (const [k, p] of propEntries) {
          const bits = [p.type];
          if (p.values) bits.push(p.values.join('|'));
          if (p.content) bits.push('body text');
          if (p.optional) bits.push('optional');
          if (p.default !== undefined && p.default !== '') bits.push(`default: ${JSON.stringify(p.default)}`);
          lines.push(`| \`${k}\` | ${bits.join(', ')} | ${(p.label && p.label.en) || ''} |`);
        }
        lines.push('');
      }
      if (m.snippet) {
        lines.push('```html');
        lines.push(m.snippet.trim());
        lines.push('```');
        lines.push('');
      }
    }
  }

  lines.push('## Completion');
  lines.push('');
  lines.push('Reply with **one** fenced `html` block = complete document ending in `</html>`.');
  lines.push('Optional final line: `PZN_READY`');
  lines.push('');

  return lines.join('\n');
}

/**
 * Compact grammar — the free-tier injectable. Free chat plans (ChatGPT free
 * etc.) reject the ~19KB full dictionary at the message-length gate, so this
 * renders the ENTIRE vocabulary as one line per module: tag, container→children
 * mapping, props with enum values. Child-only leaves are included — without the
 * full dictionary a model has no other way to learn `<bent-tab>`/`<bent-trow>`.
 */
function toCompactMarkdown(dict = buildDictionary(), opts = {}) {
  const he = opts.locale !== 'en';
  const tagOf = {};
  for (const m of dict.modules) tagOf[m.name] = m.tag;

  const lines = [];
  lines.push(he ? '## הכלים — דקדוק מקוצר (זה כל המילון)' : '## Tools — compact grammar (this IS the dictionary)');
  lines.push('');
  lines.push(he
    ? 'שורה לכלי: `תג` · ⊃ = אילו ילדים נכנסים בתוכו · props (ערך1|ערך2 = הערכים המותרים, `*` = טקסט הגוף של התג, ↳ = חי רק בתוך מיכל). לכל תג יש גם `id`, `class` ו-`animate=none|fade|rise|zoom` אופציונליים — לא חוזרים עליהם בשורות.'
    : 'One line per tool: `tag` · ⊃ = allowed children · props (a|b = allowed values, `*` = tag body text, ↳ = lives only inside a container). Every tag also takes optional `id`, `class` and `animate=none|fade|rise|zoom` — not repeated per line.');
  lines.push('');

  const catOrder = ['content', 'layout', 'data', 'media', 'effects', 'advanced'];
  const cats = [
    ...catOrder.filter((c) => dict.categories[c]),
    ...Object.keys(dict.categories).filter((c) => !catOrder.includes(c))
  ];
  for (const cat of cats) {
    lines.push(`### ${cat}`);
    for (const m of dict.categories[cat] || []) {
      // id/class/animate are universal — declared ONCE in the header above.
      // animate alone repeated its full enum on ~60 lines (~1.7K chars), and
      // the lite pack's free-plan budget (LITE_BUDGET_CHARS) paid for it —
      // Ben's new modules pushed the pack past the gate exactly this way.
      const props = Object.entries(m.props || {})
        .filter(([k]) => k !== 'id' && k !== 'class' && k !== 'animate')
        .slice(0, 8).map(([k, p]) => {
        let s = k;
        if (p.values) s += '=' + p.values.slice(0, 4).join('|') + (p.values.length > 4 ? '|…' : '');
        if (p.content) s += '*';
        return s;
      });
      // empty accept on a container means "accepts anything" — say so, or the
      // lite model can't tell section/hero/card nest at all
      const kids = !m.container ? ''
        : (m.accept && m.accept.length && m.accept.length <= 6)
          ? ' ⊃ ' + m.accept.map((n) => tagOf[n] || n).join(',')
          : (he ? ' ⊃ כל כלי' : ' ⊃ any tool');
      const mark = m.childOnly ? ' ↳' : '';
      const label = he ? m.label.he : m.label.en;
      lines.push(`- \`${m.tag}\`${kids}${mark} ${label}${props.length ? ' · ' + props.join(' ') : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = {
  buildDictionary,
  toMarkdown,
  toCompactMarkdown,
  toAgentTools,
  HIDDEN
};
