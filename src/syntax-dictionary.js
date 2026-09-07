'use strict';

/**
 * Syntax dictionary — the ONE place agents and humans look up modules.
 * Built from src/block-registry.js (product modules) + BenTML keywords.
 *
 * Files:
 *   docs/SYNTAX-DICTIONARY.md  — human markdown (regenerate: node scripts/gen-syntax-dictionary.js)
 *   GET /admin/api/syntax-dictionary — machine JSON
 */

const {
  BLOCK_REGISTRY,
  BLOCK_CATEGORIES,
  UNIVERSAL_PARAMS,
  getBlockDef,
  authoringBlocks
} = require('./block-registry');
const { KEYWORDS, RESERVED } = require('./bentml/keywords');

/**
 * Full dictionary object for API / docs generation.
 */
function buildDictionary() {
  // the dictionary teaches AUTHORING — decompile-only types (the imported
  // header/footer bands) are listed apart, so an agent recognises them in a
  // decompiled draft but is never taught to mint them for a new page
  const modules = authoringBlocks().map((entry) => {
    const kw = KEYWORDS[entry.keyword] || null;
    const snippet = buildSnippet(entry);
    return {
      type: entry.type,
      keyword: entry.keyword,
      labelHe: entry.labelHe,
      icon: entry.icon,
      category: entry.category,
      bodyClass: entry.bodyClass,
      hintHe: entry.hintHe,
      complexity: entry.type === 'text' ? 'advanced' : 'standard',
      params: (entry.params || []).map((p) => ({
        name: p.name,
        bentmlParam: p.bentmlParam !== undefined ? p.bentmlParam : p.name,
        labelHe: p.labelHe,
        type: p.type,
        required: !!p.required,
        default: p.default,
        enum: p.enum || null,
        hint: p.hint || null
      })),
      textField: entry.textField || null,
      textFieldLabelHe: entry.textFieldLabelHe || null,
      childrenKey: entry.childrenKey || null,
      universal: UNIVERSAL_PARAMS.map((p) => p.name),
      snippet,
      bentmlShape: describeShape(entry)
    };
  });

  return {
    version: '0.1',
    language: 'bentml',
    principle: {
      he: 'הסוכן כותב BenTML. הבונה מציג מודולים. TEXT הוא המיכל המורכב היחיד (פסקאות + סימון פנימי).',
      en: 'Agents write BenTML. Builder shows modules. TEXT is the only deep container (paragraphs + inline marks).'
    },
    documentShape: [
      'BENTML 0.1',
      'META { title: "..."  …page metadata / SEO… }',
      'BODY: KEYWORD(params) { … } | KEYWORD(params)'
    ],
    categories: BLOCK_CATEGORIES,
    modules,
    reservedFuture: [...RESERVED],
    styleNote: {
      he: 'עיצוב מודול = פאנל Style בבונה (align, צבע, ריפוד…). class/id = מתקדם. אין בלוק STYLE{}.',
      en: 'Module style = builder Style panel. class/id advanced. No STYLE{} block.'
    },
    textAdvanced: {
      keyword: 'TEXT',
      marks: [
        { syntax: '@B{…}', meaning: 'bold' },
        { syntax: '@I{…}', meaning: 'italic' },
        { syntax: '@LINK(url: "…"){…}', meaning: 'link' },
        { syntax: '@CODE{…}', meaning: 'monospace' },
        { syntax: '@BREAK', meaning: 'line break' }
      ],
      rules: [
        'Blank line = new paragraph',
        'Marks only inside TEXT, HEADING, QUOTE, TESTIMONIAL, ITEM bodies',
        'No Markdown ** or [x](url)'
      ]
    },
    decompileOnly: BLOCK_REGISTRY.filter((e) => e.decompileOnly).map((e) => ({
      type: e.type, keyword: e.keyword, labelHe: e.labelHe, hintHe: e.hintHe || ''
    })),
    decompileOnlyNote: {
      he: 'מופיעים רק בטיוטות שנוצרו מפירוק אתר (תצוגת ייבוא). לא כלי כתיבה — כרום האתר האמיתי: עיצוב → כותרת ותחתית.',
      en: 'Appear only in drafts produced by decompiling a site (import preview). Not authoring tools — the real site chrome is theme → header & footer.'
    },
    count: modules.length
  };
}

function describeShape(entry) {
  if (entry.bodyClass === 'none') {
    return `${entry.keyword}(params)`;
  }
  if (entry.bodyClass === 'text') {
    return `${entry.keyword}(params) { text body }`;
  }
  if (entry.bodyClass === 'blocks') {
    return `${entry.keyword}(params) { nested modules }`;
  }
  if (entry.bodyClass === 'raw') {
    return `${entry.keyword} {{{ raw }}}`;
  }
  return entry.keyword;
}

function buildSnippet(entry) {
  const kw = entry.keyword;
  const req = (entry.params || []).filter((p) => p.required && p.bentmlParam !== null);
  const paramParts = [];
  for (const p of req) {
    const bp = p.bentmlParam !== undefined && p.bentmlParam !== null ? p.bentmlParam : p.name;
    if (bp === null) continue;
    paramParts.push(`${bp}: "..."`);
  }
  // add a couple useful optionals with defaults omitted
  const optShow = (entry.params || []).filter(
    (p) => !p.required && p.bentmlParam !== null && ['level', 'style', 'size', 'align', 'ratio'].includes(p.name)
  );
  for (const p of optShow.slice(0, 2)) {
    const bp = p.bentmlParam !== undefined && p.bentmlParam !== null ? p.bentmlParam : p.name;
    if (p.default !== undefined && p.type !== 'boolean') {
      paramParts.push(`${bp}: ${typeof p.default === 'string' ? p.default : p.default}`);
    }
  }
  const plist = paramParts.length ? `(${paramParts.join(', ')})` : '';

  if (entry.bodyClass === 'none') {
    if (kw === 'IMAGE') return `IMAGE(src: "/uploads/photo.jpg", alt: "תיאור")`;
    if (kw === 'EMBED') return `EMBED(url: "https://www.youtube.com/watch?v=XXXXXXXX")`;
    if (kw === 'MAP') return `MAP(address: "תל אביב", zoom: 14)`;
    if (kw === 'ARTICLES') return `ARTICLES(tag: "article", limit: 6, columns: 3)`;
    if (kw === 'SPACE') return `SPACE(size: md)`;
    if (kw === 'DIVIDER') return `DIVIDER`;
    return `${kw}${plist}`;
  }
  if (entry.bodyClass === 'text') {
    if (kw === 'TEXT') {
      return `TEXT(size: md) {\n  פסקה ראשונה עם @B{הדגשה}.\n\n  פסקה שנייה.\n}`;
    }
    if (kw === 'HEADING') return `HEADING(level: 2) {\n  כותרת\n}`;
    if (kw === 'BUTTON') return `BUTTON(url: "/contact", style: primary) {\n  לחץ כאן\n}`;
    return `${kw}${plist} {\n  …\n}`;
  }
  if (kw === 'ROW') {
    return `ROW(ratio: "1:1") {\n  COL {\n    TEXT { טור }\n  }\n  COL {\n    TEXT { טור }\n  }\n}`;
  }
  if (kw === 'HERO') {
    return `HERO {\n  HEADING(level: 1) { כותרת }\n  TEXT { משנה }\n  BUTTON(url: "#") { CTA }\n}`;
  }
  if (kw === 'LIST') {
    return `LIST {\n  ITEM { - פריט }\n  ITEM { - פריט }\n}`;
  }
  if (kw === 'CARD') {
    return `CARD {\n  HEADING(level: 3) { כרטיס }\n  TEXT { תוכן }\n}`;
  }
  if (kw === 'GALLERY') {
    return `GALLERY(columns: 3) {\n  IMAGE(src: "/uploads/1.jpg", alt: "")\n}`;
  }
  if (kw === 'FEATURES') {
    return `FEATURES(columns: 2) {\n  FEATURE(title: "יתרון") { תיאור }\n}`;
  }
  return `${kw}${plist} {\n  …\n}`;
}

/**
 * Markdown document for docs/SYNTAX-DICTIONARY.md
 */
function toMarkdown(dict) {
  const d = dict || buildDictionary();
  const lines = [];
  lines.push('# BenTML Syntax Dictionary');
  lines.push('');
  lines.push('> **Single source of truth for modules + agent syntax.**');
  lines.push('> Generated from `src/block-registry.js`. Do not hand-edit module tables — change the registry, then run:');
  lines.push('> `node scripts/gen-syntax-dictionary.js`');
  lines.push('');
  lines.push(d.principle.en);
  lines.push('');
  lines.push('## Document shape');
  lines.push('');
  lines.push('```');
  d.documentShape.forEach((l) => lines.push(l));
  lines.push('```');
  lines.push('');
  lines.push('## TEXT is the advanced container');
  lines.push('');
  lines.push('Other modules stay sharp and simple. **TEXT** carries paragraphs + inline marks:');
  lines.push('');
  d.textAdvanced.marks.forEach((m) => {
    lines.push(`- \`${m.syntax}\` — ${m.meaning}`);
  });
  lines.push('');
  d.textAdvanced.rules.forEach((r) => lines.push(`- ${r}`));
  lines.push('');
  lines.push('## Modules (' + d.count + ')');
  lines.push('');

  let cat = null;
  for (const m of d.modules) {
    if (m.category !== cat) {
      cat = m.category;
      lines.push(`### ${cat}`);
      lines.push('');
    }
    const badge = m.complexity === 'advanced' ? ' · **advanced**' : '';
    lines.push(`#### \`${m.keyword}\` → \`${m.type}\`${badge}`);
    lines.push('');
    lines.push(`${m.icon} **${m.labelHe}** — ${m.hintHe || ''}`);
    lines.push('');
    lines.push(`Shape: \`${m.bentmlShape}\``);
    lines.push('');
    if (m.params.length) {
      lines.push('| Param (JSON) | BenTML | Type | Required | Default |');
      lines.push('|---|---|---|---|---|');
      for (const p of m.params) {
        lines.push(
          `| \`${p.name}\` | \`${p.bentmlParam == null ? '—' : p.bentmlParam}\` | ${p.type}${p.enum ? ' ' + p.enum.join('\\|') : ''} | ${p.required ? 'yes' : ''} | ${p.default !== undefined ? JSON.stringify(p.default) : ''} |`
        );
      }
      lines.push('');
    }
    lines.push('```bentml');
    lines.push(m.snippet);
    lines.push('```');
    lines.push('');
  }

  lines.push('## Style (not a keyword)');
  lines.push('');
  lines.push(d.styleNote.en);
  lines.push('');
  lines.push('Universal on most keywords: `class`, `id`.');
  lines.push('');
  lines.push('## Reserved (future advanced modules)');
  lines.push('');
  lines.push(d.reservedFuture.map((k) => `\`${k}\``).join(', '));
  lines.push('');
  lines.push('These are **not** implemented yet. Using them in BenTML is an error today.');
  lines.push('');
  if (d.decompileOnly && d.decompileOnly.length) {
    lines.push('## Decompile-preview only (not authoring tools)');
    lines.push('');
    lines.push(d.decompileOnlyNote.en);
    lines.push('');
    lines.push(d.decompileOnlyNote.he);
    lines.push('');
    for (const m of d.decompileOnly) {
      lines.push(`- \`${m.keyword}\` → \`${m.type}\` — **${m.labelHe}** — ${m.hintHe}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = {
  buildDictionary,
  toMarkdown,
  getBlockDef
};
