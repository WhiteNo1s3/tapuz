'use strict';

const { isDocument, isModule, walk } = require('./ast');
const { getModule } = require('../modules/registry');

/**
 * @typedef {{ severity: 'error'|'warning', code: string, message: string, path?: string }} Issue
 */

/**
 * Validate a document AST against the module registry.
 * @param {object} doc
 * @param {{ strict?: boolean }} [opts]
 * @returns {Issue[]}
 */
function validate(doc, opts = {}) {
  const strict = opts.strict !== false;
  /** @type {Issue[]} */
  const issues = [];

  if (!isDocument(doc)) {
    issues.push({
      severity: 'error',
      code: 'E_NOT_DOC',
      message: 'Root is not a document'
    });
    return issues;
  }

  if (doc.dir && doc.dir !== 'rtl' && doc.dir !== 'ltr') {
    issues.push({
      severity: 'error',
      code: 'E_DIR',
      message: `dir must be rtl|ltr, got "${doc.dir}"`
    });
  }

  const seenIds = new Set();

  walk(doc, (node, parent) => {
    if (!isModule(node)) return;

    const path = node.id || node.name;
    const def = getModule(node.name);

    if (!def) {
      issues.push({
        severity: 'error',
        code: 'E_UNKNOWN_MODULE',
        message: `Unknown module <bent-${node.name}>`,
        path
      });
      return;
    }

    if (node.id) {
      if (seenIds.has(node.id)) {
        issues.push({
          severity: 'error',
          code: 'E_DUP_ID',
          message: `Duplicate id "${node.id}"`,
          path
        });
      }
      seenIds.add(node.id);
    } else if (strict) {
      issues.push({
        severity: 'warning',
        code: 'W_NO_ID',
        message: `Module <bent-${node.name}> has no id`,
        path: node.name
      });
    }

    // parent accept rules
    if (parent && isModule(parent)) {
      const parentDef = getModule(parent.name);
      if (parentDef?.accept && parentDef.accept.length) {
        if (!parentDef.accept.includes(node.name)) {
          issues.push({
            severity: 'error',
            code: 'E_CHILD',
            message: `<bent-${parent.name}> cannot contain <bent-${node.name}>`,
            path
          });
        }
      }
      if (parentDef && !parentDef.container) {
        issues.push({
          severity: 'error',
          code: 'E_NOT_CONTAINER',
          message: `<bent-${parent.name}> cannot have child modules`,
          path
        });
      }
    }

    // prop validation
    for (const [key, schema] of Object.entries(def.props || {})) {
      if (schema.content) continue; // text content validated lightly
      if (key === 'id' || key === 'class') continue;

      let value = node.props[key];
      if (value === undefined || value === null || value === '') {
        if (!schema.optional && schema.default === undefined) {
          issues.push({
            severity: 'error',
            code: 'E_PROP_REQUIRED',
            message: `Missing prop "${key}" on <bent-${node.name}>`,
            path
          });
        }
        continue;
      }

      if (schema.type === 'integer') {
        const n = Number(value);
        if (!Number.isInteger(n)) {
          issues.push({
            severity: 'error',
            code: 'E_PROP_TYPE',
            message: `Prop "${key}" must be integer`,
            path
          });
        } else {
          if (schema.min != null && n < schema.min) {
            issues.push({
              severity: 'error',
              code: 'E_PROP_RANGE',
              message: `Prop "${key}" min ${schema.min}`,
              path
            });
          }
          if (schema.max != null && n > schema.max) {
            issues.push({
              severity: 'error',
              code: 'E_PROP_RANGE',
              message: `Prop "${key}" max ${schema.max}`,
              path
            });
          }
        }
      }

      if (schema.type === 'enum' && schema.values && !schema.values.includes(String(value))) {
        // allow enum as stored number-like strings already stringified
        if (!schema.values.includes(value)) {
          issues.push({
            severity: 'error',
            code: 'E_PROP_ENUM',
            message: `Prop "${key}" must be one of: ${schema.values.join(', ')}`,
            path
          });
        }
      }

      if (schema.type === 'boolean' && typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
        issues.push({
          severity: 'error',
          code: 'E_PROP_TYPE',
          message: `Prop "${key}" must be boolean`,
          path
        });
      }
    }

    // content modules should not have unexpected children already covered
  });

  return issues;
}

/**
 * @param {object} doc
 * @returns {boolean}
 */
function isValid(doc) {
  return validate(doc, { strict: true }).every((i) => i.severity !== 'error');
}

module.exports = { validate, isValid };
