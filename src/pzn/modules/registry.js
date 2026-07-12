'use strict';

const { escapeHtml, escapeAttr } = require('../language/escape');

/**
 * Module registry = type system of the page.
 * Each module implements HTML (not the other way around).
 */

/** @typedef {{ he: string, en: string }} I18n */

/**
 * @typedef {object} PropSchema
 * @property {'string'|'text'|'integer'|'number'|'boolean'|'enum'|'url'} type
 * @property {boolean} [optional]
 * @property {boolean} [content]  - maps to node.text
 * @property {*} [default]
 * @property {number} [min]
 * @property {number} [max]
 * @property {string[]} [values]
 * @property {I18n} [label]
 */

/**
 * @typedef {object} ModuleDef
 * @property {string} name
 * @property {string} tag
 * @property {string} category
 * @property {I18n} label
 * @property {string} icon
 * @property {boolean} container
 * @property {string[]} [accept] child module names allowed (empty = any if container)
 * @property {Record<string, PropSchema>} props
 * @property {object} defaults
 * @property {(node: object, ctx: object, compileChild: Function) => string} compile
 */

/** @type {Map<string, ModuleDef>} */
const REGISTRY = new Map();

function register(def) {
  if (!def.name || !def.tag) throw new Error('module requires name and tag');
  REGISTRY.set(def.name, def);
  return def;
}

function getModule(name) {
  return REGISTRY.get(name) || null;
}

function getModuleByTag(tag) {
  const name = tag.startsWith('bent-') ? tag.slice(5) : tag;
  return getModule(name);
}

function listModules() {
  return [...REGISTRY.values()];
}

function moduleNames() {
  return [...REGISTRY.keys()];
}

function attrsExtra(node) {
  const id = node.id ? ` id="${escapeAttr(node.id)}"` : '';
  const cls = node.className ? ` ${escapeAttr(node.className)}` : '';
  return { id, cls, idAttr: id };
}

function dirAttr(ctx) {
  return ctx.dir ? ` dir="${escapeAttr(ctx.dir)}"` : '';
}

// ─── Content modules ───────────────────────────────────────────────

register({
  name: 'heading',
  tag: 'bent-heading',
  category: 'content',
  label: { he: 'כותרת', en: 'Heading' },
  icon: 'heading',
  container: false,
  props: {
    level: {
      type: 'integer', min: 1, max: 6, default: 2,
      label: { he: 'רמה', en: 'Level' }
    },
    text: {
      type: 'text', content: true, default: 'כותרת חדשה',
      label: { he: 'טקסט', en: 'Text' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { level: 2, text: 'כותרת חדשה' },
  compile(node, ctx) {
    const level = Math.min(Math.max(parseInt(node.props.level, 10) || 2, 1), 6);
    const { id, cls } = attrsExtra(node);
    return `<h${level}${id} class="bent-heading${cls}"${dirAttr(ctx)}>${escapeHtml(node.text)}</h${level}>`;
  }
});

register({
  name: 'text',
  tag: 'bent-text',
  category: 'content',
  label: { he: 'טקסט', en: 'Text' },
  icon: 'text',
  container: false,
  props: {
    text: {
      type: 'text', content: true, default: 'פסקה חדשה',
      label: { he: 'תוכן', en: 'Content' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { text: 'פסקה חדשה' },
  compile(node, ctx) {
    const { id, cls } = attrsExtra(node);
    const parts = String(node.text || '').split(/\n\n+/);
    const d = dirAttr(ctx);
    return parts
      .map((p) => `<p${id} class="bent-text${cls}"${d}>${escapeHtml(p)}</p>`)
      .join('');
  }
});

register({
  name: 'image',
  tag: 'bent-image',
  category: 'content',
  label: { he: 'תמונה', en: 'Image' },
  icon: 'image',
  container: false,
  props: {
    src: { type: 'url', default: '', label: { he: 'מקור', en: 'Source' } },
    alt: { type: 'string', default: '', optional: true, label: { he: 'טקסט חלופי', en: 'Alt' } },
    caption: { type: 'string', default: '', optional: true, label: { he: 'כיתוב', en: 'Caption' } },
    align: {
      type: 'enum', values: ['left', 'center', 'right'], default: 'center', optional: true,
      label: { he: 'יישור', en: 'Align' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { src: '', alt: '', caption: '', align: 'center' },
  compile(node, ctx) {
    const { src = '', alt = '', caption = '', align = 'center' } = node.props;
    const { id, cls } = attrsExtra(node);
    let inner = `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" loading="lazy">`;
    if (caption) inner += `<figcaption>${escapeHtml(caption)}</figcaption>`;
    return `<figure${id} class="bent-image align-${escapeAttr(align)}${cls}"${dirAttr(ctx)}>${inner}</figure>`;
  }
});

register({
  name: 'button',
  tag: 'bent-button',
  category: 'content',
  label: { he: 'כפתור', en: 'Button' },
  icon: 'button',
  container: false,
  props: {
    href: { type: 'url', default: '#', label: { he: 'קישור', en: 'URL' } },
    variant: {
      type: 'enum', values: ['primary', 'secondary', 'outline'], default: 'primary',
      label: { he: 'סגנון', en: 'Variant' }
    },
    text: {
      type: 'text', content: true, default: 'לחץ כאן',
      label: { he: 'טקסט', en: 'Label' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { href: '#', variant: 'primary', text: 'לחץ כאן' },
  compile(node, ctx) {
    const href = node.props.href || '#';
    const variant = node.props.variant || 'primary';
    const { id, cls } = attrsExtra(node);
    return `<a${id} href="${escapeAttr(href)}" class="btn btn-${escapeAttr(variant)} bent-button${cls}"${dirAttr(ctx)}>${escapeHtml(node.text)}</a>`;
  }
});

register({
  name: 'item',
  tag: 'bent-item',
  category: 'content',
  label: { he: 'פריט רשימה', en: 'List item' },
  icon: 'item',
  container: false,
  props: {
    text: {
      type: 'text', content: true, default: 'פריט',
      label: { he: 'טקסט', en: 'Text' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { text: 'פריט' },
  compile(node, ctx) {
    const { id, cls } = attrsExtra(node);
    return `<li${id} class="bent-item${cls}"${dirAttr(ctx)}>${escapeHtml(node.text)}</li>`;
  }
});

register({
  name: 'list',
  tag: 'bent-list',
  category: 'content',
  label: { he: 'רשימה', en: 'List' },
  icon: 'list',
  container: true,
  accept: ['item'],
  props: {
    ordered: {
      type: 'boolean', default: false, optional: true,
      label: { he: 'ממוספרת', en: 'Ordered' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { ordered: false },
  compile(node, ctx, compileChild) {
    const ordered = node.props.ordered === true || node.props.ordered === 'true';
    const tag = ordered ? 'ol' : 'ul';
    const { id, cls } = attrsExtra(node);
    let items;
    if (node.children.length) {
      items = node.children.map((c) => compileChild(c, ctx)).join('');
    } else if (node.text) {
      items = String(node.text)
        .split(/\n+/)
        .filter(Boolean)
        .map((line) => `<li${dirAttr(ctx)}>${escapeHtml(line)}</li>`)
        .join('');
    } else {
      items = '';
    }
    return `<${tag}${id} class="bent-list${cls}"${dirAttr(ctx)}>${items}</${tag}>`;
  }
});

register({
  name: 'quote',
  tag: 'bent-quote',
  category: 'content',
  label: { he: 'ציטוט', en: 'Quote' },
  icon: 'quote',
  container: false,
  props: {
    author: {
      type: 'string', default: '', optional: true,
      label: { he: 'מחבר', en: 'Author' }
    },
    text: {
      type: 'text', content: true, default: 'ציטוט',
      label: { he: 'טקסט', en: 'Text' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { author: '', text: 'ציטוט' },
  compile(node, ctx) {
    const { id, cls } = attrsExtra(node);
    const author = node.props.author
      ? `<footer>— ${escapeHtml(node.props.author)}</footer>`
      : '';
    return `<blockquote${id} class="bent-quote${cls}"${dirAttr(ctx)}><p>${escapeHtml(node.text)}</p>${author}</blockquote>`;
  }
});

register({
  name: 'spacer',
  tag: 'bent-spacer',
  category: 'content',
  label: { he: 'רווח', en: 'Spacer' },
  icon: 'spacer',
  container: false,
  props: {
    height: {
      type: 'string', default: '2rem',
      label: { he: 'גובה', en: 'Height' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { height: '2rem' },
  compile(node) {
    const height = node.props.height || '2rem';
    const { id, cls } = attrsExtra(node);
    return `<div${id} class="bent-spacer spacer${cls}" style="height:${escapeAttr(height)}" aria-hidden="true"></div>`;
  }
});

register({
  name: 'divider',
  tag: 'bent-divider',
  category: 'content',
  label: { he: 'קו מפריד', en: 'Divider' },
  icon: 'divider',
  container: false,
  props: {
    style: {
      type: 'enum', values: ['solid', 'dashed', 'none'], default: 'solid', optional: true,
      label: { he: 'סגנון', en: 'Style' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { style: 'solid' },
  compile(node, ctx) {
    const style = node.props.style || 'solid';
    const { id, cls } = attrsExtra(node);
    return `<hr${id} class="bent-divider style-${escapeAttr(style)}${cls}"${dirAttr(ctx)}>`;
  }
});

register({
  name: 'embed',
  tag: 'bent-embed',
  category: 'content',
  label: { he: 'הטמעה', en: 'Embed' },
  icon: 'embed',
  container: false,
  props: {
    url: { type: 'url', default: '', label: { he: 'כתובת', en: 'URL' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { url: '' },
  compile(node) {
    const rawUrl = String(node.props.url || '');
    const { id, cls } = attrsExtra(node);
    const yt = rawUrl.match(
      /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/
    );
    if (yt) {
      return `<figure${id} class="bent-embed video-embed${cls}"><iframe src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen loading="lazy" title="YouTube video"></iframe></figure>`;
    }
    const url = escapeAttr(rawUrl);
    return `<a${id} href="${url}" class="bent-embed${cls}" target="_blank" rel="noopener">${escapeHtml(rawUrl)}</a>`;
  }
});

// ─── Layout ────────────────────────────────────────────────────────

register({
  name: 'section',
  tag: 'bent-section',
  category: 'layout',
  label: { he: 'סקשן', en: 'Section' },
  icon: 'section',
  container: true,
  accept: [],
  props: {
    kind: {
      type: 'string', default: 'content', optional: true,
      label: { he: 'סוג', en: 'Kind' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { kind: 'content' },
  compile(node, ctx, compileChild) {
    const kind = node.props.kind || 'content';
    const { id, cls } = attrsExtra(node);
    const inner = node.children.map((c) => compileChild(c, ctx)).join('');
    return `<section${id} class="bent-section kind-${escapeAttr(kind)}${cls}"${dirAttr(ctx)}>${inner}</section>`;
  }
});

register({
  name: 'col',
  tag: 'bent-col',
  category: 'layout',
  label: { he: 'עמודה', en: 'Column' },
  icon: 'col',
  container: true,
  accept: [],
  props: {
    width: {
      type: 'enum',
      values: ['1/1', '1/2', '1/3', '2/3', '1/4', '3/4'],
      default: '1/2',
      label: { he: 'רוחב', en: 'Width' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { width: '1/2' },
  compile(node, ctx, compileChild) {
    const width = node.props.width || '1/2';
    const { id, cls } = attrsExtra(node);
    const inner = node.children.map((c) => compileChild(c, ctx)).join('');
    return `<div${id} class="col width-${escapeAttr(String(width).replace('/', '-'))}${cls}">${inner}</div>`;
  }
});

register({
  name: 'columns',
  tag: 'bent-columns',
  category: 'layout',
  label: { he: 'עמודות', en: 'Columns' },
  icon: 'columns',
  container: true,
  accept: ['col'],
  props: {
    gap: {
      type: 'enum', values: ['small', 'medium', 'large'], default: 'medium', optional: true,
      label: { he: 'מרווח', en: 'Gap' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { gap: 'medium' },
  compile(node, ctx, compileChild) {
    const gap = node.props.gap || 'medium';
    const { id, cls } = attrsExtra(node);
    const inner = node.children.map((c) => compileChild(c, ctx)).join('');
    return `<div${id} class="columns gap-${escapeAttr(gap)} bent-columns${cls}"${dirAttr(ctx)}>${inner}</div>`;
  }
});

register({
  name: 'hero',
  tag: 'bent-hero',
  category: 'layout',
  label: { he: 'הירו', en: 'Hero' },
  icon: 'hero',
  container: true,
  accept: [],
  props: {
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const inner = node.children.map((c) => compileChild(c, ctx)).join('');
    return `<section${id} class="hero bent-hero${cls}"${dirAttr(ctx)}>${inner}</section>`;
  }
});

// ─── Data ──────────────────────────────────────────────────────────

register({
  name: 'gallery',
  tag: 'bent-gallery',
  category: 'data',
  label: { he: 'גלריה', en: 'Gallery' },
  icon: 'gallery',
  container: true,
  accept: ['image'],
  props: {
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const inner = node.children.map((c) => compileChild(c, ctx)).join('');
    return `<div${id} class="gallery bent-gallery${cls}"${dirAttr(ctx)}>${inner}</div>`;
  }
});

register({
  name: 'article-list',
  tag: 'bent-article-list',
  category: 'data',
  label: { he: 'רשימת מאמרים', en: 'Article list' },
  icon: 'articles',
  container: false,
  props: {
    tag: {
      type: 'string', default: 'article',
      label: { he: 'תגית', en: 'Tag' }
    },
    limit: {
      type: 'integer', min: 1, max: 48, default: 6,
      label: { he: 'כמות', en: 'Limit' }
    },
    columns: {
      type: 'integer', min: 1, max: 4, default: 3,
      label: { he: 'עמודות', en: 'Columns' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { tag: 'article', limit: 6, columns: 3 },
  compile(node, ctx) {
    const tag = node.props.tag || 'article';
    const limit = parseInt(node.props.limit, 10) || 6;
    const cols = Math.min(Math.max(parseInt(node.props.columns, 10) || 3, 1), 4);
    const { id, cls } = attrsExtra(node);
    const articles = Array.isArray(ctx.articles)
      ? ctx.articles.filter((a) => !tag || (a.tags || []).includes(tag)).slice(0, limit)
      : [];
    if (!articles.length) {
      return `<!-- bent-article-list: no articles for tag "${escapeHtml(tag)}" -->`;
    }
    const cards = articles
      .map((a) => {
        const media = a.image
          ? `<img src="${escapeAttr(a.image)}" alt="" loading="lazy">`
          : '';
        const teaser = a.teaser ? `<p>${escapeHtml(a.teaser)}</p>` : '';
        return (
          `<a class="article-cube" href="${escapeAttr(a.url || '#')}">` +
          `<div class="cube-media">${media}</div>` +
          `<div class="cube-body"><h3>${escapeHtml(a.title || '')}</h3>${teaser}</div></a>`
        );
      })
      .join('');
    return `<section${id} class="article-cubes cols-${cols} bent-article-list${cls}"${dirAttr(ctx)}>${cards}</section>`;
  }
});

module.exports = {
  register,
  getModule,
  getModuleByTag,
  listModules,
  moduleNames,
  REGISTRY
};
