'use strict';

const { listModules, getModule } = require('../modules/registry');

const CATEGORY_LABELS = {
  content: { he: 'תוכן', en: 'Content' },
  layout: { he: 'פריסה', en: 'Layout' },
  data: { he: 'נתונים', en: 'Data' }
};

/**
 * Full toolbox catalog for the visual page builder.
 */
function getToolbox() {
  const byCat = new Map();
  for (const def of listModules()) {
    // list items are usually inserted via list defaults, still expose them
    if (!byCat.has(def.category)) byCat.set(def.category, []);
    byCat.get(def.category).push({
      type: def.name,
      tag: def.tag,
      label: def.label,
      icon: def.icon,
      container: !!def.container,
      accept: def.accept || [],
      defaults: buildDefaults(def)
    });
  }

  const order = ['content', 'layout', 'data'];
  const categories = order
    .filter((id) => byCat.has(id))
    .map((id) => ({
      id,
      label: CATEGORY_LABELS[id] || { he: id, en: id },
      items: byCat.get(id)
    }));

  // any unknown categories last
  for (const [id, items] of byCat) {
    if (order.includes(id)) continue;
    categories.push({
      id,
      label: CATEGORY_LABELS[id] || { he: id, en: id },
      items
    });
  }

  return { categories, version: '0.1' };
}

/**
 * Schema for one module — drives the side options panel.
 * @param {string} type
 */
function getSchema(type) {
  const def = getModule(type);
  if (!def) return null;
  return {
    type: def.name,
    tag: def.tag,
    label: def.label,
    icon: def.icon,
    container: !!def.container,
    accept: def.accept || [],
    props: def.props,
    defaults: buildDefaults(def)
  };
}

/**
 * All schemas keyed by type.
 */
function getAllSchemas() {
  /** @type {Record<string, object>} */
  const out = {};
  for (const def of listModules()) {
    out[def.name] = getSchema(def.name);
  }
  return out;
}

/**
 * Document-level schema (page properties panel when nothing selected).
 */
function getDocumentSchema() {
  return {
    type: 'document',
    label: { he: 'מאפייני עמוד', en: 'Page properties' },
    props: {
      title: { type: 'string', label: { he: 'כותרת', en: 'Title' } },
      slug: { type: 'string', label: { he: 'סלאג', en: 'Slug' } },
      lang: { type: 'string', default: 'he', label: { he: 'שפה', en: 'Language' } },
      dir: {
        type: 'enum',
        values: ['rtl', 'ltr'],
        default: 'rtl',
        label: { he: 'כיוון', en: 'Direction' }
      },
      tags: { type: 'string', optional: true, label: { he: 'תגיות', en: 'Tags' } },
      teaser: { type: 'text', optional: true, label: { he: 'תקציר', en: 'Teaser' } },
      cardImage: { type: 'url', optional: true, label: { he: 'תמונת כרטיס', en: 'Card image' } }
    }
  };
}

function buildDefaults(def) {
  const defaults = { ...(def.defaults || {}) };
  // ensure content text default surfaces
  for (const [key, schema] of Object.entries(def.props || {})) {
    if (schema.content && defaults.text === undefined && schema.default !== undefined) {
      defaults.text = schema.default;
    }
    if (!schema.content && defaults[key] === undefined && schema.default !== undefined) {
      defaults[key] = schema.default;
    }
  }
  return defaults;
}

module.exports = {
  getToolbox,
  getSchema,
  getAllSchemas,
  getDocumentSchema
};
