'use strict';

const { escapeHtml, escapeAttr } = require('./escape');
const { isDocument, isModule } = require('./ast');
const { getModule } = require('../modules/registry');

/**
 * AST → .pzn source (benTML dialect — HTML that is our language).
 * @param {object} doc
 * @param {{ pretty?: boolean, indent?: string }} [opts]
 */
function serialize(doc, opts = {}) {
  if (!isDocument(doc)) {
    throw new Error('serialize() expects a document AST');
  }
  const pretty = opts.pretty !== false;
  const indent = opts.indent || '  ';
  const nl = pretty ? '\n' : '';

  const lines = [];
  lines.push('<!DOCTYPE html>');
  lines.push(
    `<html lang="${escapeAttr(doc.lang || 'he')}" dir="${escapeAttr(doc.dir || 'rtl')}" bent-version="${escapeAttr(doc.version || '0.1')}">`
  );
  lines.push(`${indent}<head>`);
  lines.push(`${indent}${indent}<meta charset="utf-8" />`);
  lines.push(`${indent}${indent}<title>${escapeHtml(doc.title || '')}</title>`);
  if (doc.slug) {
    lines.push(`${indent}${indent}<meta name="bent-slug" content="${escapeAttr(doc.slug)}" />`);
  }
  if (doc.tags && doc.tags.length) {
    lines.push(
      `${indent}${indent}<meta name="bent-tags" content="${escapeAttr(doc.tags.join(','))}" />`
    );
  }
  if (doc.meta?.teaser) {
    lines.push(
      `${indent}${indent}<meta name="bent-teaser" content="${escapeAttr(doc.meta.teaser)}" />`
    );
  }
  if (doc.meta?.cardImage) {
    lines.push(
      `${indent}${indent}<meta name="bent-card-image" content="${escapeAttr(doc.meta.cardImage)}" />`
    );
  }
  lines.push(`${indent}</head>`);
  lines.push(`${indent}<body>`);

  for (const child of doc.body || []) {
    lines.push(serializeModule(child, 2, indent, pretty));
  }

  lines.push(`${indent}</body>`);
  lines.push('</html>');
  lines.push('');
  return lines.join(nl);
}

/**
 * @param {object} node
 * @param {number} depth
 * @param {string} indent
 * @param {boolean} pretty
 */
function serializeModule(node, depth, indent, pretty) {
  if (!isModule(node)) return '';
  const pad = pretty ? indent.repeat(depth) : '';
  const nl = pretty ? '\n' : '';
  const tag = `bent-${node.name}`;
  const attrStr = formatAttrs(node);
  const def = getModule(node.name);
  const hasChildren = node.children && node.children.length;
  const hasText = node.text != null && String(node.text).length > 0;

  if (!hasChildren && !hasText) {
    return `${pad}<${tag}${attrStr} />`;
  }

  if (!hasChildren && hasText) {
    // Keep single-line text inline so round-trip does not invent indentation.
    // Only pretty-print when the authoring text already contains newlines.
    const text = String(node.text);
    if (!pretty || !text.includes('\n')) {
      return `${pad}<${tag}${attrStr}>${escapeHtml(text)}</${tag}>`;
    }
    const innerPad = indent.repeat(depth + 1);
    const body = text
      .split('\n')
      .map((line) => `${innerPad}${escapeHtml(line)}`)
      .join(nl);
    return `${pad}<${tag}${attrStr}>${nl}${body}${nl}${pad}</${tag}>`;
  }

  // children
  const parts = [];
  parts.push(`${pad}<${tag}${attrStr}>`);
  if (hasText && String(node.text).trim()) {
    const innerPad = indent.repeat(depth + 1);
    parts.push(`${innerPad}${escapeHtml(node.text)}`);
  }
  for (const child of node.children) {
    parts.push(serializeModule(child, depth + 1, indent, pretty));
  }
  parts.push(`${pad}</${tag}>`);
  return parts.join(nl);
}

function formatAttrs(node) {
  const chunks = [];
  if (node.id) chunks.push(`id="${escapeAttr(node.id)}"`);
  if (node.className) chunks.push(`class="${escapeAttr(node.className)}"`);

  const props = node.props || {};
  const keys = Object.keys(props).sort();
  for (const key of keys) {
    const val = props[key];
    if (val === undefined || val === null) continue;
    if (typeof val === 'boolean') {
      if (val) chunks.push(`${key}="true"`);
      else chunks.push(`${key}="false"`);
      continue;
    }
    chunks.push(`${key}="${escapeAttr(String(val))}"`);
  }
  return chunks.length ? ' ' + chunks.join(' ') : '';
}

/**
 * Serialize a fragment (list of modules) without document shell — useful for builder.
 * @param {object[]} modules
 * @param {object} [opts]
 */
function serializeFragment(modules, opts = {}) {
  const pretty = opts.pretty !== false;
  const indent = opts.indent || '  ';
  return (modules || [])
    .map((m) => serializeModule(m, 0, indent, pretty))
    .join(pretty ? '\n' : '');
}

module.exports = { serialize, serializeFragment, serializeModule };
