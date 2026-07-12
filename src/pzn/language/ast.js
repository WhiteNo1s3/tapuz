'use strict';

/**
 * AST factories and helpers for benTML.
 * Document and module nodes are plain objects (JSON-serializable).
 */

function createDocument(partial = {}) {
  return {
    type: 'document',
    version: partial.version || '0.1',
    lang: partial.lang || 'he',
    dir: partial.dir || 'rtl',
    title: partial.title || '',
    slug: partial.slug || '',
    tags: Array.isArray(partial.tags) ? partial.tags.slice() : [],
    meta: {
      teaser: partial.meta?.teaser || '',
      cardImage: partial.meta?.cardImage || ''
    },
    body: Array.isArray(partial.body) ? partial.body : []
  };
}

/**
 * @param {string} name module name without bent- prefix
 * @param {object} [opts]
 */
function createModule(name, opts = {}) {
  return {
    type: 'module',
    name,
    id: opts.id || '',
    props: { ...(opts.props || {}) },
    className: opts.className || '',
    children: Array.isArray(opts.children) ? opts.children : [],
    text: opts.text != null ? String(opts.text) : ''
  };
}

function isDocument(node) {
  return node && node.type === 'document';
}

function isModule(node) {
  return node && node.type === 'module';
}

/**
 * Depth-first walk. Visitor may return false to skip children.
 * @param {object} node
 * @param {(node: object, parent: object|null, index: number) => void|false} visitor
 * @param {object|null} [parent]
 * @param {number} [index]
 */
function walk(node, visitor, parent = null, index = -1) {
  const cont = visitor(node, parent, index);
  if (cont === false) return;
  if (isDocument(node)) {
    node.body.forEach((child, i) => walk(child, visitor, node, i));
  } else if (isModule(node)) {
    node.children.forEach((child, i) => walk(child, visitor, node, i));
  }
}

/**
 * Find module by id (first match).
 * @param {object} doc
 * @param {string} id
 */
function findById(doc, id) {
  if (!id) return null;
  let found = null;
  walk(doc, (node) => {
    if (isModule(node) && node.id === id) {
      found = node;
      return false;
    }
  });
  return found;
}

/**
 * Structural equality for tests (ignores key order via JSON normalize).
 * @param {object} a
 * @param {object} b
 */
function equal(a, b) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function normalize(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(normalize);
  if (isDocument(node)) {
    return {
      type: 'document',
      version: node.version || '0.1',
      lang: node.lang || 'he',
      dir: node.dir || 'rtl',
      title: node.title || '',
      slug: node.slug || '',
      tags: [...(node.tags || [])],
      meta: {
        teaser: node.meta?.teaser || '',
        cardImage: node.meta?.cardImage || ''
      },
      body: (node.body || []).map(normalize)
    };
  }
  if (isModule(node)) {
    const props = {};
    const keys = Object.keys(node.props || {}).sort();
    for (const k of keys) props[k] = node.props[k];
    return {
      type: 'module',
      name: node.name,
      id: node.id || '',
      props,
      className: node.className || '',
      children: (node.children || []).map(normalize),
      text: node.text || ''
    };
  }
  return node;
}

/**
 * Assign missing ids deterministically (for tests / agent comfort).
 * @param {object} doc
 * @param {() => string} [idFactory]
 */
function assignMissingIds(doc, idFactory) {
  let n = 0;
  const gen = idFactory || (() => `bent_${++n}`);
  walk(doc, (node) => {
    if (isModule(node) && !node.id) node.id = gen();
  });
  return doc;
}

/**
 * Deep clone via JSON (AST is plain data).
 * @param {object} node
 */
function clone(node) {
  return JSON.parse(JSON.stringify(node));
}

module.exports = {
  createDocument,
  createModule,
  isDocument,
  isModule,
  walk,
  findById,
  equal,
  normalize,
  assignMissingIds,
  clone
};
