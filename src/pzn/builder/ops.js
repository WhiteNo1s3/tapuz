'use strict';

const { createModule, isDocument, isModule, findById, walk, clone } = require('../language/ast');
const { getModule } = require('../modules/registry');
const { BentError } = require('../language/errors');

/**
 * Pure AST operations for the page builder.
 * All functions return a new document (immutable-style via clone).
 */

function requireDoc(doc) {
  if (!isDocument(doc)) throw new BentError('E_OPS', 'Expected document');
}

function newId(prefix = 'm') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Create a module from registry defaults.
 * @param {string} type
 * @param {object} [overrides]
 */
function createFromType(type, overrides = {}) {
  const def = getModule(type);
  if (!def) throw new BentError('E_UNKNOWN_MODULE', `Unknown module type: ${type}`);

  const props = {};
  let text = '';
  for (const [key, schema] of Object.entries(def.props || {})) {
    if (key === 'id' || key === 'class') continue;
    if (schema.content) {
      text = overrides.text != null ? overrides.text : (schema.default ?? def.defaults?.text ?? '');
      continue;
    }
    if (overrides[key] !== undefined) props[key] = overrides[key];
    else if (def.defaults && def.defaults[key] !== undefined) props[key] = def.defaults[key];
    else if (schema.default !== undefined) props[key] = schema.default;
  }

  return createModule(type, {
    id: overrides.id || newId(type),
    className: overrides.className || overrides.class || '',
    props: { ...props, ...(overrides.props || {}) },
    text,
    children: overrides.children || []
  });
}

/**
 * @param {object} doc
 * @param {string|null} parentId null = body root
 * @param {number} index
 * @param {object} moduleNode
 */
function insert(doc, parentId, index, moduleNode) {
  requireDoc(doc);
  const next = clone(doc);
  const parent = parentId ? findById(next, parentId) : null;
  if (parentId && !parent) throw new BentError('E_OPS', `Parent not found: ${parentId}`);

  if (parent) {
    const def = getModule(parent.name);
    if (!def?.container) throw new BentError('E_OPS', `Not a container: ${parent.name}`);
    const arr = parent.children;
    const i = clampIndex(index, arr.length);
    arr.splice(i, 0, moduleNode);
  } else {
    const i = clampIndex(index, next.body.length);
    next.body.splice(i, 0, moduleNode);
  }
  return next;
}

/**
 * @param {object} doc
 * @param {string} id
 */
function remove(doc, id) {
  requireDoc(doc);
  const next = clone(doc);
  const hit = locate(next, id);
  if (!hit) throw new BentError('E_OPS', `Module not found: ${id}`);
  hit.list.splice(hit.index, 1);
  return next;
}

/**
 * @param {object} doc
 * @param {string} id
 * @param {string|null} newParentId
 * @param {number} index
 */
function move(doc, id, newParentId, index) {
  requireDoc(doc);
  const next = clone(doc);
  const hit = locate(next, id);
  if (!hit) throw new BentError('E_OPS', `Module not found: ${id}`);
  const [node] = hit.list.splice(hit.index, 1);

  if (newParentId) {
    const parent = findById(next, newParentId);
    if (!parent) throw new BentError('E_OPS', `Parent not found: ${newParentId}`);
    const def = getModule(parent.name);
    if (!def?.container) throw new BentError('E_OPS', `Not a container: ${parent.name}`);
    const i = clampIndex(index, parent.children.length);
    parent.children.splice(i, 0, node);
  } else {
    const i = clampIndex(index, next.body.length);
    next.body.splice(i, 0, node);
  }
  return next;
}

/**
 * @param {object} doc
 * @param {string} id
 * @param {object} propsPatch  may include text, className, class, and prop keys
 */
function updateProps(doc, id, propsPatch = {}) {
  requireDoc(doc);
  const next = clone(doc);
  const node = findById(next, id);
  if (!node) throw new BentError('E_OPS', `Module not found: ${id}`);

  if (propsPatch.text !== undefined) node.text = String(propsPatch.text);
  if (propsPatch.className !== undefined) node.className = String(propsPatch.className);
  if (propsPatch.class !== undefined) node.className = String(propsPatch.class);
  if (propsPatch.id !== undefined && propsPatch.id !== id) {
    node.id = String(propsPatch.id);
  }

  for (const [k, v] of Object.entries(propsPatch)) {
    if (k === 'text' || k === 'class' || k === 'className' || k === 'id' || k === 'props') continue;
    node.props[k] = v;
  }
  if (propsPatch.props && typeof propsPatch.props === 'object') {
    Object.assign(node.props, propsPatch.props);
  }
  return next;
}

/**
 * Soft replace type — keeps id, maps common props, clears incompatible ones.
 * @param {object} doc
 * @param {string} id
 * @param {string} newType
 */
function replace(doc, id, newType) {
  requireDoc(doc);
  const next = clone(doc);
  const hit = locate(next, id);
  if (!hit) throw new BentError('E_OPS', `Module not found: ${id}`);
  const old = hit.list[hit.index];
  const fresh = createFromType(newType, {
    id: old.id,
    className: old.className,
    text: old.text
  });
  // migrate overlapping prop keys
  for (const key of Object.keys(fresh.props)) {
    if (old.props[key] !== undefined) fresh.props[key] = old.props[key];
  }
  if (getModule(newType)?.container) {
    fresh.children = old.children || [];
  }
  hit.list[hit.index] = fresh;
  return next;
}

/**
 * @param {object} doc
 * @param {string} id
 */
function duplicate(doc, id) {
  requireDoc(doc);
  const next = clone(doc);
  const hit = locate(next, id);
  if (!hit) throw new BentError('E_OPS', `Module not found: ${id}`);
  const copy = clone(hit.list[hit.index]);
  reassignIds(copy);
  hit.list.splice(hit.index + 1, 0, copy);
  return next;
}

/**
 * Update document-level page properties.
 * @param {object} doc
 * @param {object} patch
 */
function updateDocument(doc, patch = {}) {
  requireDoc(doc);
  const next = clone(doc);
  for (const key of ['title', 'slug', 'lang', 'dir', 'version']) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  if (patch.tags) next.tags = [...patch.tags];
  if (patch.meta) next.meta = { ...next.meta, ...patch.meta };
  return next;
}

// ─── helpers ───────────────────────────────────────────────────────

function clampIndex(index, len) {
  if (index == null || index < 0 || index > len) return len;
  return index;
}

/**
 * Locate module's parent list + index.
 * @param {object} doc
 * @param {string} id
 * @returns {{ list: object[], index: number } | null}
 */
function locate(doc, id) {
  for (let i = 0; i < doc.body.length; i++) {
    if (doc.body[i].id === id) return { list: doc.body, index: i };
  }
  let found = null;
  walk(doc, (node) => {
    if (!isModule(node) || found) return;
    for (let i = 0; i < node.children.length; i++) {
      if (node.children[i].id === id) {
        found = { list: node.children, index: i };
        return false;
      }
    }
  });
  return found;
}

function reassignIds(node) {
  if (isModule(node)) {
    node.id = newId(node.name);
    for (const c of node.children || []) reassignIds(c);
  }
}

module.exports = {
  newId,
  createFromType,
  insert,
  remove,
  move,
  updateProps,
  replace,
  duplicate,
  updateDocument,
  locate
};
