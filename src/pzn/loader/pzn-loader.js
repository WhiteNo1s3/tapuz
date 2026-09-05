'use strict';

/**
 * PZN Loader
 * ----------
 * Accept or build a .pzn with the user. Never "ask them for a pzn format"
 * as homework — the loader + builder produce everything the page needs:
 *
 *   source (benTML) · document AST · visual preview · toolbox ·
 *   commands+perks · page props · public file name · validation
 *
 * Public HTML is an *output*, not the editor source.
 */

const { parse } = require('../language/parse');
const { serialize } = require('../language/serialize');
const { compile, compileFragment } = require('../language/compile');
const { validate } = require('../language/validate');
const { BentError } = require('../language/errors');
const { createDocument } = require('../language/ast');
const { getToolbox, getDocumentSchema, getAllSchemas } = require('../builder/schema-api');
const { getCommandCatalog, getAgentCommandSheet, getCommand } = require('../modules/commands');
const { publicFileName } = require('../site/publish');
const ops = require('../builder/ops');

const BLANK_PZN = `<!DOCTYPE html>
<html lang="he" dir="rtl" bent-version="0.1">
<head>
  <meta charset="utf-8" />
  <title>עמוד חדש</title>
  <meta name="bent-slug" content="home" />
</head>
<body>
  <bent-hero id="hero_start">
    <bent-heading id="hero_start_h" level="1">החלום שלכם מתחיל כאן</bent-heading>
    <bent-text id="hero_start_t">בונים יחד — אתם + הבונה + הסוכן. המקור הוא benTML, לא HTML גולמי.</bent-text>
    <bent-button id="hero_start_btn" href="#builder" variant="primary">נתחיל</bent-button>
  </bent-hero>
</body>
</html>
`;

/**
 * Minimal CSS for visualizing compile output inside the builder canvas.
 * Advanced users override via class= + customCss (inspector path).
 */
const PREVIEW_THEME_CSS = `
:root {
  --pzn-bg: #0f1419;
  --pzn-surface: #1a2332;
  --pzn-text: #e7ecf3;
  --pzn-muted: #9aa8bc;
  --pzn-accent: #f59e0b;
  --pzn-accent-2: #38bdf8;
  --pzn-border: #2a3548;
  --pzn-radius: 12px;
  --pzn-font: "Segoe UI", system-ui, sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--pzn-font);
  background: var(--pzn-bg);
  color: var(--pzn-text);
  line-height: 1.6;
}
.skip-link {
  position: absolute; left: -999px;
}
.skip-link:focus { left: 8px; top: 8px; background: #000; color: #fff; padding: 8px; z-index: 9; }
main#main { max-width: 960px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
.bent-heading { margin: 0 0 0.6em; line-height: 1.25; }
.bent-text { margin: 0 0 1em; color: var(--pzn-muted); }
.btn {
  display: inline-block;
  padding: 0.65em 1.2em;
  border-radius: 999px;
  text-decoration: none;
  font-weight: 600;
  border: 2px solid transparent;
}
.btn-primary { background: var(--pzn-accent); color: #111; }
.btn-secondary { background: var(--pzn-accent-2); color: #111; }
.btn-outline { border-color: var(--pzn-accent); color: var(--pzn-accent); }
.hero, .bent-hero {
  padding: 2.5rem 1.5rem;
  border-radius: var(--pzn-radius);
  background: linear-gradient(135deg, #1e293b, #0f172a 60%, #1a1030);
  border: 1px solid var(--pzn-border);
  margin-bottom: 1.5rem;
}
.hero .bent-heading, .bent-hero h1 { font-size: clamp(1.8rem, 4vw, 2.6rem); }
.columns, .bent-columns {
  display: grid;
  gap: 1.25rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  margin: 1.25rem 0;
}
.col { padding: 1rem; background: var(--pzn-surface); border-radius: var(--pzn-radius); border: 1px solid var(--pzn-border); }
.bent-section { margin: 1.5rem 0; }
.bent-image { margin: 1rem 0; text-align: center; }
.bent-image img { max-width: 100%; border-radius: 8px; background: #222; min-height: 80px; }
.bent-image figcaption { color: var(--pzn-muted); font-size: 0.9em; margin-top: 0.4em; }
.bent-list { margin: 0.5rem 0 1rem; padding-inline-start: 1.25rem; }
.bent-quote {
  margin: 1.5rem 0;
  padding: 1rem 1.25rem;
  border-inline-start: 4px solid var(--pzn-accent);
  background: var(--pzn-surface);
  border-radius: 0 var(--pzn-radius) var(--pzn-radius) 0;
}
.bent-divider { border: 0; border-top: 1px solid var(--pzn-border); margin: 2rem 0; }
.video-embed iframe { width: 100%; aspect-ratio: 16/9; border: 0; border-radius: 8px; }
.article-cubes {
  display: grid;
  gap: 1rem;
  margin: 1.25rem 0;
}
.article-cubes.cols-2 { grid-template-columns: repeat(2, 1fr); }
.article-cubes.cols-3 { grid-template-columns: repeat(3, 1fr); }
.article-cubes.cols-4 { grid-template-columns: repeat(4, 1fr); }
.article-cube {
  display: block;
  text-decoration: none;
  color: inherit;
  background: var(--pzn-surface);
  border: 1px solid var(--pzn-border);
  border-radius: var(--pzn-radius);
  overflow: hidden;
}
.article-cube .cube-media img { width: 100%; display: block; aspect-ratio: 16/10; object-fit: cover; }
.article-cube .cube-body { padding: 0.85rem 1rem; }
.article-cube h3 { margin: 0 0 0.35rem; color: var(--pzn-text); }
.article-cube p { margin: 0; color: var(--pzn-muted); font-size: 0.92em; }
@media (max-width: 640px) {
  .article-cubes.cols-2, .article-cubes.cols-3, .article-cubes.cols-4 {
    grid-template-columns: 1fr;
  }
}

/* signature visuals (v0.44) */
.hero { position: relative; }
.hero.hero-overlaid::before {
  content: ""; position: absolute; inset: 0;
  background: rgba(0, 0, 0, var(--hero-overlay, 0.35)); pointer-events: none;
}
.hero.hero-overlaid > * { position: relative; z-index: 1; }
.hero.hero-overlaid { color: #fff; }
.hero.hero-overlaid::before { border-radius: inherit; }
.hero.hero-parallax { background-attachment: fixed; }
.parallax-section {
  position: relative; background-size: cover; background-position: center;
  background-attachment: fixed; display: flex; align-items: center;
  justify-content: center; padding: 3rem 1.25rem;
}
.parallax-sm { min-height: 30vh; } .parallax-md { min-height: 50vh; }
.parallax-lg { min-height: 70vh; } .parallax-full { min-height: 100vh; }
.parallax-section.parallax-overlaid::before {
  content: ""; position: absolute; inset: 0;
  background: rgba(0, 0, 0, var(--px-overlay, 0.3));
}
.parallax-inner { position: relative; z-index: 1; max-width: 860px; text-align: center; color: #fff; }
.marquee { display: flex; overflow: hidden; white-space: nowrap; padding-block: 0.6rem; }
.marquee-track {
  flex-shrink: 0; min-width: 100%; display: flex; justify-content: space-around; gap: 3rem;
  animation: pzn-marquee var(--marquee-duration, 18s) linear infinite;
}
.marquee-slow .marquee-track { --marquee-duration: 32s; }
.marquee-fast .marquee-track { --marquee-duration: 9s; }
.marquee-item { display: inline-block; font-size: 1.15rem; }
@keyframes pzn-marquee { from { transform: translateX(0); } to { transform: translateX(-100%); } }
[dir="rtl"] .marquee-track { animation-name: pzn-marquee-rtl; }
@keyframes pzn-marquee-rtl { from { transform: translateX(0); } to { transform: translateX(100%); } }
@media (prefers-reduced-motion: no-preference) {
  .anim-fade { animation: pzn-fade 0.8s ease-out both; }
  .anim-rise { animation: pzn-rise 0.8s ease-out both; }
  .anim-zoom { animation: pzn-zoom 0.8s ease-out both; }
}
@keyframes pzn-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes pzn-rise { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
@keyframes pzn-zoom { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: none; } }
@media (hover: none) and (pointer: coarse) {
  .hero.hero-parallax, .parallax-section { background-attachment: scroll; }
}
@media (prefers-reduced-motion: reduce) { .marquee-track { animation: none; } }
.bent-crumbs { margin: 0.75rem 0 1.25rem; }
.bent-crumbs-list { display: flex; flex-wrap: wrap; align-items: center; list-style: none; margin: 0; padding: 0; font-size: 0.9rem; color: #57534e; }
.bent-crumb { display: inline-flex; align-items: center; }
.bent-crumb + .bent-crumb::before { content: "/"; margin-inline: 0.45rem 0.5rem; color: #a8a29e; }
.bent-crumb-link { color: #ea580c; text-decoration: none; }
.bent-crumb-current { font-weight: 600; }
.bent-steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1.25rem; margin: 1.25rem 0; padding: 0; list-style: none; counter-reset: bent-step; }
.bent-step { text-align: center; margin: 0; padding: 0.5rem 0.5rem 0; }
.bent-step-n, .bent-step-icon { display: flex; align-items: center; justify-content: center; width: 2.25rem; height: 2.25rem; margin-inline: auto; margin-block-end: 0.5rem; border-radius: 999px; background: #ea580c; color: #fff; font-weight: 800; }
.bent-step-n { counter-increment: bent-step; }
.bent-step-n::before { content: counter(bent-step); }
.bent-step-title { margin: 0 0 0.3rem; font-size: 1.05rem; }
.bent-step-body { margin: 0; color: #57534e; }
.bent-timeline { position: relative; list-style: none; margin: 1.25rem 0; padding: 0; padding-inline-start: 2rem; }
.bent-timeline::before { content: ""; position: absolute; inset-inline-start: 0.45rem; top: 0.4rem; bottom: 0.4rem; width: 2px; background: #ea580c; opacity: 0.35; }
.bent-event { position: relative; margin: 0; padding-block: 0.2rem 1.2rem; }
.bent-event::before { content: ""; position: absolute; inset-inline-start: -1.68rem; top: 0.55rem; width: 10px; height: 10px; border-radius: 999px; background: #ea580c; box-shadow: 0 0 0 3px #fff; }
.bent-event-time { display: block; font-size: 0.8rem; font-weight: 700; color: #ea580c; }
.bent-event-title { margin: 0.15rem 0 0.35rem; font-size: 1.05rem; }
.bent-event-body { margin: 0; color: #57534e; }
.bent-event-image { display: block; max-width: 100%; height: auto; margin-top: 0.6rem; border-radius: 8px; }
`.trim();

/**
 * Wrap compiled body into a visualizable document for iframe preview.
 * @param {object} doc
 * @param {object} [context]
 * @param {{ customCss?: string }} [opts]
 */
function buildPreviewHtml(doc, context = {}, opts = {}) {
  const body = compileFragment(doc.body || [], {
    dir: doc.dir || 'rtl',
    lang: doc.lang || 'he',
    articles: context.articles || [],
    categories: context.categories || [],
    pretty: true
  });
  const custom = opts.customCss
    ? `\n/* advanced user CSS overrides */\n${opts.customCss}\n`
    : '';
  return `<!DOCTYPE html>
<html lang="${escapeAttr(doc.lang || 'he')}" dir="${escapeAttr(doc.dir || 'rtl')}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(doc.title || 'Preview')}</title>
  <style>${PREVIEW_THEME_CSS}${custom}</style>
</head>
<body>
  <main id="main">
${body}
  </main>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s) {
  return escapeHtml(s);
}

/**
 * Load a .pzn source (or blank starter) into a full builder/runtime payload.
 * This is the single entry: accept pzn OR build with user from blank.
 *
 * @param {string|null|undefined} source  null → blank starter we build with user
 * @param {{
 *   articles?: object[],
 *   customCss?: string,
 *   includeAgentSheet?: boolean
 * }} [options]
 */
function loadPzn(source, options = {}) {
  const raw = source == null || String(source).trim() === '' ? BLANK_PZN : String(source);
  let doc;
  /** @type {import('../language/validate').Issue[]|object[]} */
  let parseError = null;

  try {
    doc = parse(raw);
  } catch (err) {
    if (err instanceof BentError || err.name === 'BentError') {
      parseError = err;
      doc = createDocument({
        title: 'Parse error',
        slug: 'error',
        body: []
      });
    } else {
      throw err;
    }
  }

  const issues = parseError
    ? [
        {
          severity: 'error',
          code: parseError.code || 'E_PARSE',
          message: parseError.message,
          path: parseError.path,
          line: parseError.line,
          column: parseError.column
        }
      ]
    : validate(doc);

  const hasErrors = issues.some((i) => i.severity === 'error');
  let previewHtml = '';
  let publicHtml = '';
  let sourceOut = raw;

  if (!parseError) {
    try {
      sourceOut = serialize(doc);
      previewHtml = buildPreviewHtml(doc, options, { customCss: options.customCss || '' });
      if (!hasErrors) {
        publicHtml = compile(doc, {
          articles: options.articles || [],
          categories: options.categories || [],
          skipValidate: false
        });
      }
    } catch (err) {
      issues.push({
        severity: 'error',
        code: err.code || 'E_COMPILE',
        message: err.message
      });
    }
  }

  const payload = {
    ok: !issues.some((i) => i.severity === 'error'),
    /** Authoring source — always benTML, never public HTML */
    source: {
      language: 'bentml',
      format: 'pzn',
      text: sourceOut,
      /** Explicit: we do not expose HTML as editable source */
      htmlSourceAvailable: false
    },
    document: doc,
    page: {
      title: doc.title,
      slug: doc.slug,
      lang: doc.lang,
      dir: doc.dir,
      tags: doc.tags,
      meta: doc.meta,
      publicFile: publicFileName(doc.slug)
    },
    visualization: {
      previewHtml,
      themeCss: PREVIEW_THEME_CSS,
      customCss: options.customCss || ''
    },
    /** Full public compile when valid (for publish), not for editing */
    publish: {
      html: publicHtml,
      fileName: publicFileName(doc.slug)
    },
    issues,
    tools: {
      toolbox: getToolbox(),
      documentSchema: getDocumentSchema(),
      schemas: getAllSchemas(),
      commands: getCommandCatalog(),
      agentSheet: options.includeAgentSheet !== false ? getAgentCommandSheet() : null
    },
    policy: {
      weBuildWithUser: true,
      acceptPzn: true,
      neverAskUserToLearnPznFormat: true,
      sourceIsBentml: true,
      htmlIsCompileOutputOnly: true,
      cssOverrideIsAdvanced: true,
      redHatOfCms: true
    }
  };

  return payload;
}

/**
 * Apply new benTML source (from builder SOURCE panel) and reload.
 * @param {string} source
 * @param {object} [options]
 */
function applySource(source, options = {}) {
  return loadPzn(source, options);
}

/**
 * Insert a module command into document and return fresh load payload.
 * @param {string} source current benTML
 * @param {string} moduleType
 * @param {object} [options]
 */
function insertModule(source, moduleType, options = {}) {
  const loaded = loadPzn(source, { ...options, includeAgentSheet: false });
  if (!loaded.ok && loaded.document.body.length === 0 && loaded.issues.some((i) => i.code !== 'E_PARSE')) {
    // still try if only warnings
  }
  if (loaded.issues.some((i) => i.code === 'E_PARSE' || i.code === 'E_RAW_HTML' || i.code === 'E_RAW_TEXT')) {
    // cannot insert into unparseable source
    return { ...loaded, ok: false };
  }

  const node = ops.createFromType(moduleType, options.overrides || {});
  // attach command snippet defaults for embed etc.
  if (moduleType === 'embed' && !node.props.url) {
    node.props.url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  }
  if (moduleType === 'image' && !node.props.src) {
    node.props.src = '/uploads/photo.jpg';
    node.props.alt = 'תמונה';
  }
  if (moduleType === 'columns') {
    node.children = [
      ops.createFromType('col', {
        width: '1/2',
        children: [ops.createFromType('text', { text: 'עמודה' })]
      }),
      ops.createFromType('col', {
        width: '1/2',
        children: [ops.createFromType('text', { text: 'עמודה' })]
      })
    ];
  }
  if (moduleType === 'list') {
    node.children = [
      ops.createFromType('item', { text: 'פריט 1' }),
      ops.createFromType('item', { text: 'פריט 2' })
    ];
  }
  if (moduleType === 'hero') {
    node.children = [
      ops.createFromType('heading', { level: 1, text: 'כותרת' }),
      ops.createFromType('text', { text: 'משנה' }),
      ops.createFromType('button', { text: 'CTA', href: '#' })
    ];
  }
  if (moduleType === 'gallery') {
    node.children = [
      ops.createFromType('image', { src: '/uploads/1.jpg', alt: '' }),
      ops.createFromType('image', { src: '/uploads/2.jpg', alt: '' })
    ];
  }
  if (moduleType === 'section') {
    node.children = [ops.createFromType('heading', { level: 2, text: 'סקשן' })];
  }

  let doc = loaded.document;
  const parentId = options.parentId || null;
  const index = options.index != null ? options.index : undefined;
  doc = ops.insert(doc, parentId, index, node);
  const newSource = serialize(doc);
  return loadPzn(newSource, options);
}

/**
 * Blank page payload — we build the pzn with the user from here.
 */
function loadBlank(options = {}) {
  return loadPzn(BLANK_PZN, options);
}

/**
 * Accept an existing .pzn (file content). User is not quizzed on the format.
 * @param {string} source
 * @param {object} [options]
 */
function acceptPzn(source, options = {}) {
  return loadPzn(source, options);
}

module.exports = {
  BLANK_PZN,
  PREVIEW_THEME_CSS,
  loadPzn,
  loadBlank,
  acceptPzn,
  applySource,
  insertModule,
  buildPreviewHtml,
  getCommand,
  getCommandCatalog,
  getAgentCommandSheet
};
