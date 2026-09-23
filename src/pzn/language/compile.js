'use strict';

const { BentError } = require('./errors');
const { isDocument, isModule, assignMissingIds } = require('./ast');
const { escapeHtml, escapeAttr } = require('./escape');
const { getModule } = require('../modules/registry');
const { validate } = require('./validate');

/**
 * Compile document AST → public HTML5.
 * This is where modules **implement HTML**.
 *
 * @param {object} doc
 * @param {{
 *   articles?: object[],
 *   assignIds?: boolean,
 *   pretty?: boolean,
 *   skipValidate?: boolean,
 *   themeCssHref?: string
 * }} [context]
 */
function compile(doc, context = {}) {
  if (!isDocument(doc)) {
    throw new BentError('E_COMPILE', 'compile() expects a document AST');
  }

  const ctx = {
    dir: doc.dir || 'rtl',
    lang: doc.lang || 'he',
    articles: context.articles || [],
    categories: context.categories || [],
    pretty: context.pretty !== false
  };

  if (context.assignIds) assignMissingIds(doc);

  if (!context.skipValidate) {
    const issues = validate(doc, { strict: true });
    const errors = issues.filter((x) => x.severity === 'error');
    if (errors.length) {
      throw new BentError('E_VALIDATE', errors[0].message, { path: errors[0].path });
    }
  }

  const compileChild = (node, childCtx) => compileModule(node, childCtx || ctx, compileChild);
  const bodyHtml = (doc.body || []).map((n) => compileChild(n, ctx)).join(ctx.pretty ? '\n' : '');

  const themeLink = context.themeCssHref
    ? `  <link rel="stylesheet" href="${escapeAttr(context.themeCssHref)}">\n`
    : '';

  const html = [
    '<!DOCTYPE html>',
    `<html lang="${escapeAttr(doc.lang || 'he')}" dir="${escapeAttr(doc.dir || 'rtl')}">`,
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${escapeHtml(doc.title || '')}</title>`,
    themeLink.trimEnd() ? themeLink.replace(/\n$/, '') : null,
    '</head>',
    '<body>',
    `  <a class="skip-link" href="#main">${escapeHtml(require('../../site-language').strings(doc.lang).skip)}</a>`,
    '  <main id="main">',
    indentBlock(bodyHtml, 4),
    '  </main>',
    '</body>',
    '</html>',
    ''
  ]
    .filter((line) => line !== null)
    .join('\n');

  return html;
}

/**
 * Compile a single module node to HTML fragment.
 * @param {object} node
 * @param {object} ctx
 * @param {Function} compileChild
 */
function compileModule(node, ctx, compileChild) {
  if (!isModule(node)) {
    throw new BentError('E_COMPILE', 'Expected module node');
  }
  const def = getModule(node.name);
  if (!def) {
    throw new BentError('E_UNKNOWN_MODULE', `Unknown module: ${node.name}`, {
      path: node.id || node.name
    });
  }
  return def.compile(node, ctx, compileChild);
}

/**
 * Compile body modules only (canvas preview).
 * @param {object[]} modules
 * @param {object} [ctx]
 */
function compileFragment(modules, ctx = {}) {
  const context = {
    dir: ctx.dir || 'rtl',
    lang: ctx.lang || 'he',
    articles: ctx.articles || [],
    categories: ctx.categories || []
  };
  const compileChild = (node, childCtx) =>
    compileModule(node, childCtx || context, compileChild);
  return (modules || []).map((n) => compileChild(n, context)).join(ctx.pretty === false ? '' : '\n');
}

function indentBlock(text, spaces) {
  if (!text) return '';
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}

module.exports = { compile, compileModule, compileFragment };
