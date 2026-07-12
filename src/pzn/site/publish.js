'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('../language/parse');
const { compile } = require('../language/compile');
const { BentError } = require('../language/errors');

/**
 * WordPress-shaped public mapping:
 *   slug "home" or ""  →  index.html
 *   otherwise          →  {slug}.html
 *
 * @param {string} slug
 * @returns {string} filename
 */
function publicFileName(slug) {
  const s = String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-');
  if (!s || s === 'home' || s === 'index') return 'index.html';
  return `${s}.html`;
}

/**
 * Compile one .pzn source string to public HTML + suggested filename.
 * @param {string} source
 * @param {object} [context]
 */
function compilePage(source, context = {}) {
  const doc = parse(source);
  const html = compile(doc, context);
  const file = publicFileName(doc.slug);
  return { doc, html, file, slug: doc.slug || (file === 'index.html' ? 'home' : '') };
}

/**
 * Publish all *.pzn files from a pages directory into an output directory.
 * Site starts at index.html when a home.pzn (or slug=home) exists.
 *
 * @param {string} pagesDir
 * @param {string} outDir
 * @param {object} [context]
 * @returns {{ files: string[], index: string|null }}
 */
function publishSite(pagesDir, outDir, context = {}) {
  if (!fs.existsSync(pagesDir)) {
    throw new BentError('E_SITE', `Pages directory not found: ${pagesDir}`);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const names = fs
    .readdirSync(pagesDir)
    .filter((f) => f.endsWith('.pzn') || f.endsWith('.bentml')); // .bentml legacy alias only

  if (!names.length) {
    throw new BentError('E_SITE', `No .pzn pages in ${pagesDir}`);
  }

  const written = [];
  let index = null;

  for (const name of names) {
    const src = fs.readFileSync(path.join(pagesDir, name), 'utf8');
    const { html, file } = compilePage(src, context);
    const dest = path.join(outDir, file);
    fs.writeFileSync(dest, html, 'utf8');
    written.push(file);
    if (file === 'index.html') index = dest;
  }

  return { files: written.sort(), index };
}

module.exports = {
  publicFileName,
  compilePage,
  publishSite
};
