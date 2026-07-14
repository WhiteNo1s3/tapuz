'use strict';

/**
 * Categories (v0.64) — the taxonomy, on FILE storage (Ben's call: no DB —
 * `content/categories.json` on disk, visible in the אחסון/Storage section).
 *
 * The model: a category = a first-class TAG with metadata. Membership stays on
 * the page's portable tags (in the .pzn head — travels with the file); this
 * store holds only the branding/metadata: name, color, cover image,
 * description, order. So listArticles({ tag: slug }) already answers "what's
 * in this category" with zero new query code.
 */

const fs = require('fs');
const path = require('path');
const { SITE_ROOT } = require('./paths');

const CONTENT_DIR = path.join(SITE_ROOT, 'content');
const CATEGORIES_PATH = path.join(CONTENT_DIR, 'categories.json');

/** Slug = safe tag token (it doubles as a page tag). */
function safeSlug(v) {
  return String(v == null ? '' : v).trim().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w֐-׿-]/g, '') // latin/digits/underscore/hyphen + Hebrew
    .slice(0, 60);
}

function normalizeCategory(raw = {}) {
  const slug = safeSlug(raw.slug || raw.name);
  if (!slug) return null;
  return {
    slug,
    name: String(raw.name || slug).trim().slice(0, 80),
    color: String(raw.color || '').trim().slice(0, 40),
    image: String(raw.image || '').trim().slice(0, 500),
    description: String(raw.description || '').trim().slice(0, 300)
  };
}

/** All categories, in file order. Missing/corrupt file → []. */
function listCategories() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CATEGORIES_PATH, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeCategory).filter(Boolean);
  } catch {
    return [];
  }
}

function getCategory(slug) {
  const s = safeSlug(slug);
  return listCategories().find((c) => c.slug === s) || null;
}

/**
 * Replace the whole list (the admin screen edits it as one document — like the
 * menus editor). Slugs are sanitized and deduped (first wins). Returns the
 * normalized list that was written.
 */
function saveCategories(list) {
  const seen = new Set();
  const clean = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const cat = normalizeCategory(raw);
    if (!cat || seen.has(cat.slug)) continue;
    seen.add(cat.slug);
    clean.push(cat);
  }
  if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR, { recursive: true });
  fs.writeFileSync(CATEGORIES_PATH, JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}

module.exports = { listCategories, getCategory, saveCategories, safeSlug, CATEGORIES_PATH };
