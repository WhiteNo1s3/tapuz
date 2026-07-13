'use strict';

/**
 * Agent mission packets — teach BenTML (like teaching a public schema), then build.
 *
 * Philosophy: we never steal sessions or call LLM APIs with stolen cookies.
 * The authentic path is the user's OWN browser session (the extension injects
 * into their already-logged-in chat). The CMS builds accurate prompts; the
 * extension delivers them where credentials already live (BYOT).
 *
 * (v0.55 — ported from the grokTapuziel language lab.)
 */

const { buildPznPrimer } = require('./agent-primer');
const { getCommandCatalog } = require('./modules/commands');

/** Compact cheat-sheet for models that choke on long primers. */
function compactSyntaxSheet() {
  const mods = getCommandCatalog().modules;
  const lines = [
    'BENTML / .pzn — constrained HTML. Body may only contain bent-* tags below.',
    'Reply with ONE fenced ```html block: full <!DOCTYPE html>…</html> document.',
    'Every module needs unique id. Hebrew sites: lang="he" dir="rtl".',
    'Containers nest children; leaves hold text or empty.',
    '',
    'Modules:'
  ];
  for (const m of mods) {
    const props = Object.keys(m.schemaProps || m.props || {})
      .filter((k) => k !== 'id' && k !== 'class')
      .slice(0, 6)
      .join(', ');
    lines.push(
      `- <${m.tag}> ${m.label.en}${m.container ? ' [container]' : ''}${props ? ' · ' + props : ''}`
    );
  }
  lines.push('');
  lines.push('Example skeleton:');
  lines.push('```html');
  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="he" dir="rtl" bent-version="0.1">');
  lines.push('<head><meta charset="utf-8"/><title>TITLE</title>');
  lines.push('<meta name="bent-slug" content="slug-here"/></head>');
  lines.push('<body>');
  lines.push('  <bent-hero id="hero1"><bent-heading id="h1" level="1">…</bent-heading></bent-hero>');
  lines.push('  <bent-columns id="cols1" gap="md" ratio="1:1">');
  lines.push('    <bent-col id="c1" width="1/2"><bent-text id="t1">…</bent-text></bent-col>');
  lines.push('    <bent-col id="c2" width="1/2"><bent-image id="i1" src="/x.jpg" alt=""/></bent-col>');
  lines.push('  </bent-columns>');
  lines.push('</body></html>');
  lines.push('```');
  return lines.join('\n');
}

/**
 * Per-provider coaching — each model needs slightly different framing.
 * @type {Record<string, { label: string, tips: string[], preferCompact: boolean, url: string }>}
 */
const PROVIDERS = {
  claude: {
    label: 'Claude',
    url: 'https://claude.ai/new',
    preferCompact: false,
    tips: [
      'Claude follows long specs well — full primer is fine.',
      'Ask for the document only inside one code fence; no preamble inside the fence.'
    ]
  },
  chatgpt: {
    label: 'ChatGPT',
    url: 'https://chatgpt.com/',
    preferCompact: true,
    tips: [
      'Keep the syntax sheet compact; put the page brief first.',
      'Remind: only bent-* tags in body — no free HTML.'
    ]
  },
  grok: {
    label: 'Grok',
    url: 'https://grok.com/',
    preferCompact: true,
    tips: [
      'Lead with the user page description, then the compact sheet.',
      'Stress unique ids and one complete document.'
    ]
  },
  gemini: {
    label: 'Gemini',
    url: 'https://gemini.google.com/app',
    preferCompact: true,
    tips: [
      'Gemini prefers short structured rules + one example.',
      'Repeat: reply with exactly one fenced full .pzn document.'
    ]
  },
  generic: {
    label: 'Any AI',
    url: '',
    preferCompact: true,
    tips: ['Use the compact sheet + clear page brief.']
  }
};

/** Shared completion contract — the auto-publish watcher looks for this shape. */
const COMPLETION_CONTRACT = [
  '## COMPLETION CONTRACT (required — an automated bridge publishes when this is true)',
  'When the page is finished, output EXACTLY:',
  '1. One markdown fence starting with ```html',
  '2. A FULL document: <!DOCTYPE html> … </html> with at least one <bent-*> module in <body>',
  '3. Close the fence with ```',
  '4. Optionally on its own line after the fence: PZN_READY',
  'Do NOT write explanations inside the fence. Prefer silence after the fence (or only PZN_READY).',
  'Incomplete streams (open fence, missing </html>) will NOT be published — finish the document.'
].join('\n');

/**
 * Build the TEACH message (step 1) — inject into the LLM chat first.
 */
function buildTeachMessage({ provider = 'generic', full = false } = {}) {
  const p = PROVIDERS[provider] || PROVIDERS.generic;
  const sheet = full || !p.preferCompact ? buildPznPrimer() : compactSyntaxSheet();
  return [
    'You are helping build pages for **Tapuziel CMS** in **BenTML / .pzn**.',
    'This is a constrained HTML dialect (like teaching a public schema / GSC-style contract). Follow it exactly.',
    'The user uses their own subscription in the browser (BYOT). You only need to emit correct .pzn.',
    '',
    sheet,
    '',
    COMPLETION_CONTRACT,
    '',
    'Acknowledge briefly that you understand BenTML, then **wait** for my page description before building.'
  ].join('\n');
}

/**
 * Build the BUILD message (step 2) — after the user describes the page.
 */
function buildBuildMessage({ description, title, slug, provider = 'generic' } = {}) {
  const p = PROVIDERS[provider] || PROVIDERS.generic;
  const brief = String(description || '').trim();
  if (!brief) throw new Error('page description required');

  const lines = [
    'Build a complete Tapuziel .pzn page from this description NOW.',
    '',
    '## Page brief (from the site owner)',
    brief,
    ''
  ];
  if (title) lines.push(`Preferred <title>: ${title}`);
  if (slug) lines.push(`Preferred bent-slug: ${slug}`);
  lines.push(
    '',
    '## Rules',
    '1. Output ONE fenced ```html block with a full document (<!DOCTYPE html>…</html>).',
    '2. Body: only registered bent-* modules (heading, text, image, button, hero, columns/col, gallery, features, cta, marquee, parallax, …).',
    '3. Unique id on every module. Hebrew: lang="he" dir="rtl" unless asked otherwise.',
    '4. Use containers (hero, section, columns) to structure; fill them with content modules.',
    '5. Prefer columns with ratio (e.g. ratio="1:1" or "2:1") when the brief wants a split layout.',
    '6. No free HTML tags in the body. No javascript: URLs.',
    '7. Do not explain inside the fence — the fence is pure .pzn only.',
    '',
    COMPLETION_CONTRACT,
    '',
    ...(p.tips || []).map((t) => `Note: ${t}`)
  );
  return lines.join('\n');
}

/**
 * Combined one-shot (when the model is already warm or the user wants a single paste).
 */
function buildOneShotMessage(opts = {}) {
  const teach = buildTeachMessage({ ...opts, full: opts.full });
  const build = buildBuildMessage(opts);
  return teach + '\n\n---\n\n' + build;
}

function listProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    label: p.label,
    url: p.url,
    preferCompact: p.preferCompact,
    tips: p.tips
  }));
}

module.exports = {
  PROVIDERS,
  listProviders,
  compactSyntaxSheet,
  COMPLETION_CONTRACT,
  buildTeachMessage,
  buildBuildMessage,
  buildOneShotMessage
};
