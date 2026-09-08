'use strict';

/**
 * Copilot tools (v1.59) — the copilot stops being blind.
 *
 * Until now the model could only emit text; a reply that happened to contain a
 * whole `.pzn` document offered a button the OWNER pressed. That made it safe
 * and useless in equal measure: it could not see a single page of the site it
 * was supposedly helping with, so "make the hero blue" was impossible and
 * every request rebuilt a page from nothing.
 *
 * Now it can look, and it can propose changes. Two rules keep that honest:
 *
 *   READ tools run on their own. list_pages / read_page have no side effects,
 *   so pausing to ask permission would be theatre — and a model that must beg
 *   to look at a page is one that will guess instead.
 *
 *   WRITE tools NEVER run on their own. create_page / edit_page return a
 *   description of what they WOULD do; the server stops the loop and hands it
 *   to the owner. Nothing touches the site until a human presses approve.
 *
 * What is deliberately absent is as much of the design as what is here:
 * no publish, no delete, no theme or settings writes. Every write lands in a
 * DRAFT, which the existing revision history already makes reversible, and
 * going live stays a human act on the publish button. A model that can put
 * words in front of the public without anyone reading them first is a
 * different product, and not one this commit is going to invent quietly.
 */

const MAX_SOURCE = 60000;

/** A page list small enough to think with — titles, slugs, status. */
function listPages() {
  const pages = require('./pages').listPages();
  return {
    count: pages.length,
    pages: pages.map((p) => ({
      slug: p.full_path,
      title: p.title,
      status: p.status,
      hasUnpublishedChanges: !!p.has_unpublished
    }))
  };
}

/** One page as its real `.pzn` source — what the model needs to edit it. */
function readPage(args) {
  const slug = String((args && args.slug) || '').trim();
  if (!slug) throw new Error('slug required');
  const { getPageByFullPath, getPageSource } = require('./pages');
  const page = getPageByFullPath(slug);
  if (!page) throw new Error('אין דף בשם "' + slug + '" — השתמש/י ב-list_pages כדי לראות מה קיים');
  // 'draft' is what the builder edits and what a follow-up edit_page replaces —
  // reading 'published' would hand the model a stale document.
  return {
    slug,
    title: page.title,
    status: page.status,
    source: getPageSource(slug, 'draft') || ''
  };
}

/** Validate a document the way the create route does — same gate, one place. */
function checkSource(raw) {
  // v2.20: take only the BenTML — a fence, a chat sentence, <html> brackets
  // around the keyword dialect, all gone; a keyword document is compiled to
  // .pzn here, so the model may answer in either dialect
  const ex = require('./pzn-source').toPznSource(String(raw || ''));
  const source = ex.source;
  if (!source.trim()) throw new Error('source ריק');
  if (source.length > MAX_SOURCE) throw new Error('המסמך ארוך מדי');
  const pznApi = require('./pzn/index');
  const doc = pznApi.parse(source);
  const errors = pznApi.validate(doc, { strict: false }).filter((i) => i.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.code + ': ' + e.message).join('; '));
  const blocks = pznApi.toTapuzPage(doc).blocks;
  if (!blocks.length) throw new Error('המסמך לא מכיל אף מודול bent-*');
  return { source, doc, blocks, meta: ex.page && ex.page.meta };
}

function createPage(args) {
  const { source, doc, blocks, meta } = checkSource(args && args.source);
  const title = String((args && args.title) || doc.title || 'דף חדש');
  const { deriveSlug } = require('./pzn/intent');
  const slug = deriveSlug(String((args && args.slug) || doc.slug || '').trim() || title);
  const { getPageByFullPath, createPage: create, savePageSource } = require('./pages');
  if (getPageByFullPath(slug)) {
    throw new Error('דף בשם "' + slug + '" כבר קיים — לעריכה השתמש/י ב-edit_page');
  }
  create({ title, slug, blocks: [] });
  const r = savePageSource(slug, source, { publish: false, meta });
  return { slug, title, created: true, blocks: r.blocks, warnings: r.warnings || [], moduleCount: blocks.length };
}

function editPage(args) {
  const slug = String((args && args.slug) || '').trim();
  if (!slug) throw new Error('slug required');
  const { getPageByFullPath, savePageSource } = require('./pages');
  const page = getPageByFullPath(slug);
  if (!page) throw new Error('אין דף בשם "' + slug + '"');
  const { source, blocks, meta } = checkSource(args && args.source);
  // publish:false — the edit lands in the DRAFT. The live page does not move
  // until the owner publishes it, and the previous draft is in the revisions.
  const r = savePageSource(slug, source, { publish: false, meta });
  return { slug, title: page.title, edited: true, blocks: r.blocks, warnings: r.warnings || [], moduleCount: blocks.length };
}

const TOOLS = [
  {
    name: 'list_pages',
    mutates: false,
    description: 'רשימת כל הדפים באתר — slug, כותרת וסטטוס. השתמש/י בזה לפני עריכה כדי למצוא את הדף הנכון.',
    schema: { type: 'object', properties: {}, required: [] },
    run: listPages
  },
  {
    name: 'read_page',
    mutates: false,
    description: 'קריאת דף קיים כמקור BenTML (.pzn) מלא. חובה לקרוא דף לפני שעורכים אותו.',
    schema: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'ה-slug של הדף, כפי שהוחזר מ-list_pages' } },
      required: ['slug']
    },
    run: readPage
  },
  {
    name: 'create_page',
    mutates: true,
    description: 'יצירת דף חדש כטיוטה ממסמך BenTML שלם. הדף לא מתפרסם — הוא נוצר כטיוטה בלבד.',
    schema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'מסמך .pzn שלם, מ-<!DOCTYPE html> ועד </html>' },
        title: { type: 'string', description: 'כותרת הדף (אופציונלי — נלקחת מהמסמך אם חסרה)' },
        slug: { type: 'string', description: 'כתובת הדף (אופציונלי)' }
      },
      required: ['source']
    },
    summary: (a) => 'ליצור דף חדש: ' + String((a && (a.title || a.slug)) || 'דף חדש'),
    run: createPage
  },
  {
    name: 'edit_page',
    mutates: true,
    description: 'החלפת התוכן של דף קיים במסמך BenTML חדש. השינוי נשמר כטיוטה — הדף החי לא משתנה עד שמפרסמים.',
    schema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'הדף לעריכה' },
        source: { type: 'string', description: 'המסמך המלא אחרי השינוי (לא רק החלק ששונה)' }
      },
      required: ['slug', 'source']
    },
    summary: (a) => 'לערוך את הדף "' + String((a && a.slug) || '?') + '" (נשמר כטיוטה)',
    run: editPage
  }
];

const BY_NAME = {};
TOOLS.forEach((t) => { BY_NAME[t.name] = t; });

function getTool(name) { return BY_NAME[String(name || '')] || null; }

/** Human-readable one-liner for the approval prompt. */
function describeCall(name, input) {
  const t = getTool(name);
  if (!t) return String(name);
  return t.summary ? t.summary(input || {}) : t.description;
}

/** Provider-shaped tool declarations. The two APIs disagree on the wrapper
 *  but agree on JSON Schema, so only the envelope differs. */
function toolsForProvider(style) {
  if (style === 'openai-chat') {
    return TOOLS.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.schema }
    }));
  }
  return TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
}

module.exports = { TOOLS, getTool, describeCall, toolsForProvider, MAX_SOURCE };
