'use strict';

const { escapeHtml, escapeAttr, escapeCssUrl } = require('../language/escape');

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
    align: {
      type: 'enum', values: ['start', 'center', 'end'], default: 'start', optional: true,
      label: { he: 'יישור', en: 'Align' }
    },
    animate: {
      type: 'enum', values: ['none', 'fade', 'rise'], default: 'none', optional: true,
      label: { he: 'אנימציית כניסה', en: 'Entrance animation' }
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
    const alignCls = node.props.align && node.props.align !== 'start' ? ` align-${escapeAttr(node.props.align)}` : '';
    const animCls = node.props.animate && node.props.animate !== 'none' ? ` anim-${escapeAttr(node.props.animate)}` : '';
    return `<h${level}${id} class="bent-heading${alignCls}${animCls}${cls}"${dirAttr(ctx)}>${escapeHtml(node.text)}</h${level}>`;
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
    align: {
      type: 'enum', values: ['start', 'center', 'end'], default: 'start', optional: true,
      label: { he: 'יישור', en: 'Align' }
    },
    size: {
      type: 'enum', values: ['sm', 'md', 'lg'], default: 'md', optional: true,
      label: { he: 'גודל', en: 'Size' }
    },
    lead: {
      type: 'boolean', default: false, optional: true,
      label: { he: 'פסקת פתיח', en: 'Lead' }
    },
    dropcap: {
      type: 'boolean', default: false, optional: true,
      label: { he: 'אות פתיחה', en: 'Drop cap' }
    },
    maxwidth: {
      type: 'enum', values: ['sm', 'md', 'lg', 'full'], default: 'full', optional: true,
      label: { he: 'רוחב מקסימלי', en: 'Max width' }
    },
    animate: {
      type: 'enum', values: ['none', 'fade', 'rise'], default: 'none', optional: true,
      label: { he: 'אנימציית כניסה', en: 'Entrance animation' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { text: 'פסקה חדשה' },
  compile(node, ctx) {
    const { id, cls } = attrsExtra(node);
    const p = node.props;
    let extraCls = '';
    if (p.align && p.align !== 'start') extraCls += ` align-${escapeAttr(p.align)}`;
    if (p.size && p.size !== 'md') extraCls += ` size-${escapeAttr(p.size)}`;
    if (p.lead === true || p.lead === 'true') extraCls += ' lead';
    if (p.dropcap === true || p.dropcap === 'true') extraCls += ' dropcap';
    if (p.maxwidth && p.maxwidth !== 'full') extraCls += ` maxw-${escapeAttr(p.maxwidth)}`;
    if (p.animate && p.animate !== 'none') extraCls += ` anim-${escapeAttr(p.animate)}`;
    const parts = String(node.text || '').split(/\n\n+/);
    const d = dirAttr(ctx);
    return parts
      .map((pt) => `<p${id} class="bent-text${extraCls}${cls}"${d}>${escapeHtml(pt)}</p>`)
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
    width: {
      type: 'enum', values: ['sm', 'md', 'lg', 'full'], default: 'full', optional: true,
      label: { he: 'רוחב', en: 'Width' }
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
    const widthCls = node.props.width && node.props.width !== 'full' ? ` width-${escapeAttr(node.props.width)}` : '';
    return `<figure${id} class="bent-image align-${escapeAttr(align)}${widthCls}${cls}"${dirAttr(ctx)}>${inner}</figure>`;
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
    align: {
      type: 'enum', values: ['start', 'center', 'end'], default: 'start', optional: true,
      label: { he: 'יישור', en: 'Align' }
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
    size: {
      type: 'enum', values: ['sm', 'md', 'lg', 'xl'], default: 'md', optional: true,
      label: { he: 'גודל', en: 'Size' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { height: '2rem' },
  compile(node) {
    const SIZE_HEIGHTS = { sm: '0.75rem', md: '1.5rem', lg: '2.5rem', xl: '4rem' };
    const height = node.props.height || SIZE_HEIGHTS[node.props.size] || '2rem';
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
    bentstyle: {
      type: 'enum', values: ['line', 'dots', 'thick'], default: 'line', optional: true,
      label: { he: 'סגנון BenTML', en: 'BenTML style' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { style: 'solid' },
  compile(node, ctx) {
    const BENT_TO_LEGACY = { line: 'solid', dots: 'dashed', thick: 'solid' };
    const style = node.props.bentstyle
      ? BENT_TO_LEGACY[node.props.bentstyle] || 'solid'
      : node.props.style || 'solid';
    const thickCls = node.props.bentstyle === 'thick' ? ' thick' : '';
    const { id, cls } = attrsExtra(node);
    return `<hr${id} class="bent-divider style-${escapeAttr(style)}${thickCls}${cls}"${dirAttr(ctx)}>`;
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
      type: 'enum', values: ['none', 'sm', 'md', 'lg', 'small', 'medium', 'large'],
      default: 'medium', optional: true,
      label: { he: 'מרווח', en: 'Gap' }
    },
    ratio: {
      type: 'string', default: '', optional: true,
      label: { he: 'יחס רוחב', en: 'Ratio' }
    },
    collapse: {
      type: 'enum', values: ['sm', 'md', 'lg', 'never'], default: 'md', optional: true,
      label: { he: 'קריסה במובייל', en: 'Collapse' }
    },
    valign: {
      type: 'enum', values: ['top', 'center', 'bottom', 'stretch'], default: 'top', optional: true,
      label: { he: 'יישור אנכי', en: 'Vertical align' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { gap: 'medium' },
  compile(node, ctx, compileChild) {
    const gap = node.props.gap || 'medium';
    const { id, cls } = attrsExtra(node);
    let extraCls = '';
    if (node.props.collapse && node.props.collapse !== 'md') extraCls += ` collapse-${escapeAttr(node.props.collapse)}`;
    if (node.props.valign && node.props.valign !== 'top') extraCls += ` valign-${escapeAttr(node.props.valign)}`;
    let gridStyle = '';
    const ratio = String(node.props.ratio || '');
    if (ratio.includes(':')) {
      const parts = ratio.split(':').map((x) => Math.max(0.2, parseFloat(x) || 1));
      if (parts.length === node.children.length) {
        gridStyle = ` style="display:grid;grid-template-columns:${parts.map((r) => r + 'fr').join(' ')};gap:var(--col-gap,1.15rem)"`;
      }
    }
    const inner = node.children.map((c) => compileChild(c, ctx)).join('');
    return `<div${id} class="columns gap-${escapeAttr(gap)}${extraCls} bent-columns${cls}"${gridStyle}${dirAttr(ctx)}>${inner}</div>`;
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
    image: { type: 'url', default: '', optional: true, label: { he: 'תמונת רקע', en: 'Background image' } },
    height: {
      type: 'enum', values: ['sm', 'md', 'lg', 'full'], default: 'md', optional: true,
      label: { he: 'גובה', en: 'Height' }
    },
    overlay: {
      type: 'integer', min: 0, max: 80, default: 0, optional: true,
      label: { he: 'כהות שכבת רקע', en: 'Overlay' }
    },
    parallax: {
      type: 'boolean', default: false, optional: true,
      label: { he: 'רקע קבוע', en: 'Parallax' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const hCls = node.props.height && node.props.height !== 'md' ? ` hero-${escapeAttr(node.props.height)}` : '';
    const overlayVal = Math.min(Math.max(parseInt(node.props.overlay, 10) || 0, 0), 80);
    const overlayCls = overlayVal > 0 ? ' hero-overlaid' : '';
    const overlayVar = overlayVal > 0 ? `--hero-overlay:${(overlayVal / 100).toFixed(2)};` : '';
    const parallaxCls = node.props.parallax === true || node.props.parallax === 'true' ? ' hero-parallax' : '';
    const styleParts = overlayVar + (node.props.image
      ? `background-image:url('${escapeCssUrl(node.props.image)}');background-size:cover;background-position:center`
      : '');
    const bg = styleParts ? ` style="${styleParts}"` : '';
    const inner = node.children.map((c) => compileChild(c, ctx)).join('');
    return `<section${id} class="hero bent-hero${hCls}${overlayCls}${parallaxCls}${cls}"${bg}${dirAttr(ctx)}>${inner}</section>`;
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
    columns: {
      type: 'integer', min: 1, max: 4, default: 3, optional: true,
      label: { he: 'עמודות', en: 'Columns' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const cols = Math.min(Math.max(parseInt(node.props.columns, 10) || 3, 1), 4);
    const inner = node.children.map((c) => compileChild(c, ctx)).join('');
    return `<div${id} class="gallery cols-${cols} bent-gallery${cls}"${dirAttr(ctx)}>${inner}</div>`;
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

// ─── Tapuz parity modules (v0.40 registry unification) ─────────────
// HTML contracts mirror src/renderer.js so existing theme CSS applies.

register({
  name: 'testimonial',
  tag: 'bent-testimonial',
  category: 'content',
  label: { he: 'המלצה', en: 'Testimonial' },
  icon: 'testimonial',
  container: false,
  props: {
    author: { type: 'string', default: '', optional: true, label: { he: 'שם הממליץ', en: 'Author' } },
    role: { type: 'string', default: '', optional: true, label: { he: 'תפקיד', en: 'Role' } },
    text: { type: 'text', content: true, default: '', label: { he: 'ציטוט', en: 'Quote' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx) {
    const { id, cls } = attrsExtra(node);
    const author = escapeHtml(node.props.author || '');
    const role = node.props.role ? `, ${escapeHtml(node.props.role)}` : '';
    return `<blockquote${id} class="testimonial bent-testimonial${cls}"${dirAttr(ctx)}><p>“${escapeHtml(node.text)}”</p><footer class="author">${author}${role}</footer></blockquote>`;
  }
});

register({
  name: 'feature',
  tag: 'bent-feature',
  category: 'content',
  label: { he: 'תכונה', en: 'Feature' },
  icon: 'feature',
  container: false,
  props: {
    title: { type: 'string', default: '', label: { he: 'כותרת', en: 'Title' } },
    icon: { type: 'string', default: '', optional: true, label: { he: 'אייקון', en: 'Icon' } },
    text: { type: 'text', content: true, default: '', label: { he: 'תיאור', en: 'Description' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    const { id, cls } = attrsExtra(node);
    const icon = node.props.icon ? `<span class="feature-icon">${escapeHtml(node.props.icon)}</span>` : '';
    const desc = node.text ? `<p>${escapeHtml(node.text)}</p>` : '';
    return `<article${id} class="feature bent-feature${cls}">${icon}<h3>${escapeHtml(node.props.title || '')}</h3>${desc}</article>`;
  }
});

register({
  name: 'features',
  tag: 'bent-features',
  category: 'content',
  label: { he: 'תכונות', en: 'Features' },
  icon: 'features',
  container: true,
  accept: ['feature'],
  props: {
    columns: {
      type: 'integer', min: 1, max: 4, default: 3, optional: true,
      label: { he: 'עמודות', en: 'Columns' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { columns: 3 },
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const cols = Math.min(Math.max(parseInt(node.props.columns, 10) || 3, 1), 4);
    const inner = node.children.map((c) => compileChild(c, ctx)).join('');
    return `<section${id} class="features cols-${cols} bent-features${cls}"${dirAttr(ctx)}>${inner}</section>`;
  }
});

register({
  name: 'card',
  tag: 'bent-card',
  category: 'layout',
  label: { he: 'כרטיס', en: 'Card' },
  icon: 'card',
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
    return `<div${id} class="card bent-card${cls}"${dirAttr(ctx)}>${inner}</div>`;
  }
});

register({
  name: 'map',
  tag: 'bent-map',
  category: 'data',
  label: { he: 'מפה', en: 'Map' },
  icon: 'map',
  container: false,
  props: {
    address: { type: 'string', default: '', label: { he: 'כתובת', en: 'Address' } },
    zoom: {
      type: 'integer', min: 1, max: 20, default: 15, optional: true,
      label: { he: 'זום', en: 'Zoom' }
    },
    height: {
      type: 'enum', values: ['sm', 'md', 'lg'], default: 'md', optional: true,
      label: { he: 'גובה', en: 'Height' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { zoom: 15, height: 'md' },
  compile(node) {
    const { id, cls } = attrsExtra(node);
    const address = String(node.props.address || '');
    const zoom = Math.min(Math.max(parseInt(node.props.zoom, 10) || 15, 1), 20);
    const height = ['sm', 'md', 'lg'].includes(node.props.height) ? node.props.height : 'md';
    const src = `https://www.google.com/maps?q=${encodeURIComponent(address)}&z=${zoom}&output=embed&hl=he`;
    return `<figure${id} class="map-embed map-${height} bent-map${cls}">` +
      `<iframe src="${escapeAttr(src)}" loading="lazy" title="מפה: ${escapeAttr(address)}" allowfullscreen></iframe>` +
      `</figure>`;
  }
});

register({
  name: 'cta',
  tag: 'bent-cta',
  category: 'content',
  label: { he: 'קריאה לפעולה', en: 'CTA' },
  icon: 'cta',
  container: false,
  props: {
    title: { type: 'string', default: '', label: { he: 'כותרת', en: 'Title' } },
    buttontext: { type: 'string', default: '', optional: true, label: { he: 'טקסט כפתור', en: 'Button text' } },
    url: { type: 'url', default: '#', optional: true, label: { he: 'קישור', en: 'URL' } },
    variant: {
      type: 'enum', values: ['primary', 'secondary', 'outline'], default: 'primary', optional: true,
      label: { he: 'סגנון כפתור', en: 'Button variant' }
    },
    tone: {
      type: 'enum', values: ['brand', 'dark', 'light'], default: 'brand', optional: true,
      label: { he: 'רקע', en: 'Tone' }
    },
    align: {
      type: 'enum', values: ['start', 'center', 'end'], default: 'start', optional: true,
      label: { he: 'יישור', en: 'Align' }
    },
    text: { type: 'text', content: true, default: '', label: { he: 'טקסט', en: 'Text' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx) {
    const { id, cls } = attrsExtra(node);
    const p = node.props;
    const tone = ['brand', 'dark', 'light'].includes(p.tone) ? p.tone : 'brand';
    const btn = p.buttontext
      ? `<a class="btn btn-${escapeAttr(p.variant || 'primary')}" href="${escapeAttr(p.url || '#')}">${escapeHtml(p.buttontext)}</a>`
      : '';
    return (
      `<section${id} class="cta-strip tone-${escapeAttr(tone)} bent-cta${cls}"${dirAttr(ctx)}>` +
      `<div class="cta-inner">` +
      (p.title ? `<h2>${escapeHtml(p.title)}</h2>` : '') +
      (node.text ? `<p>${escapeHtml(node.text)}</p>` : '') +
      btn +
      `</div></section>`
    );
  }
});

register({
  name: 'stat',
  tag: 'bent-stat',
  category: 'content',
  label: { he: 'מדד', en: 'Stat' },
  icon: 'stat',
  container: false,
  props: {
    value: { type: 'string', default: '', label: { he: 'ערך', en: 'Value' } },
    label: { type: 'string', default: '', label: { he: 'תווית', en: 'Label' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    const { id, cls } = attrsExtra(node);
    return `<div${id} class="stat-cell bent-stat${cls}"><div class="stat-value">${escapeHtml(node.props.value || '')}</div>` +
      `<div class="stat-label">${escapeHtml(node.props.label || '')}</div></div>`;
  }
});

register({
  name: 'stats',
  tag: 'bent-stats',
  category: 'content',
  label: { he: 'מספרים / מדדים', en: 'Stats' },
  icon: 'stats',
  container: true,
  accept: ['stat'],
  props: {
    columns: {
      type: 'integer', min: 2, max: 4, default: 3, optional: true,
      label: { he: 'עמודות', en: 'Columns' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { columns: 3 },
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const cols = Math.min(Math.max(parseInt(node.props.columns, 10) || 3, 2), 4);
    const inner = node.children.map((c) => compileChild(c, ctx)).join('');
    return `<section${id} class="stats-row cols-${cols} bent-stats${cls}"${dirAttr(ctx)}>${inner}</section>`;
  }
});

register({
  name: 'logo',
  tag: 'bent-logo',
  category: 'media',
  label: { he: 'לוגו', en: 'Logo' },
  icon: 'logo',
  container: false,
  props: {
    src: { type: 'url', default: '', label: { he: 'תמונה', en: 'Image' } },
    alt: { type: 'string', default: '', optional: true, label: { he: 'שם', en: 'Alt' } },
    url: { type: 'url', default: '', optional: true, label: { he: 'קישור', en: 'URL' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    const { id, cls } = attrsExtra(node);
    const img = `<img src="${escapeAttr(node.props.src || '')}" alt="${escapeAttr(node.props.alt || '')}" loading="lazy">`;
    return node.props.url
      ? `<a${id} class="logo-cell bent-logo${cls}" href="${escapeAttr(node.props.url)}">${img}</a>`
      : `<div${id} class="logo-cell bent-logo${cls}">${img}</div>`;
  }
});

register({
  name: 'logos',
  tag: 'bent-logos',
  category: 'media',
  label: { he: 'לוגואים / לקוחות', en: 'Logos' },
  icon: 'logos',
  container: true,
  accept: ['logo'],
  props: {
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const inner = node.children.map((c) => compileChild(c, ctx)).join('');
    return `<section${id} class="logos-strip bent-logos${cls}"${dirAttr(ctx)}>${inner}</section>`;
  }
});

register({
  name: 'qa',
  tag: 'bent-qa',
  category: 'content',
  label: { he: 'שאלה ותשובה', en: 'Q&A' },
  icon: 'qa',
  container: false,
  props: {
    question: { type: 'string', default: '', label: { he: 'שאלה', en: 'Question' } },
    text: { type: 'text', content: true, default: '', label: { he: 'תשובה', en: 'Answer' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    const { id, cls } = attrsExtra(node);
    return `<details${id} class="faq-item bent-qa${cls}"><summary>${escapeHtml(node.props.question || '')}</summary>` +
      `<div class="faq-answer">${escapeHtml(node.text)}</div></details>`;
  }
});

register({
  name: 'faq',
  tag: 'bent-faq',
  category: 'content',
  label: { he: 'שאלות נפוצות', en: 'FAQ' },
  icon: 'faq',
  container: true,
  accept: ['qa'],
  props: {
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const inner = node.children.map((c) => compileChild(c, ctx)).join('');
    return `<section${id} class="faq-list bent-faq${cls}"${dirAttr(ctx)}>${inner}</section>`;
  }
});

register({
  name: 'contact-info',
  tag: 'bent-contact-info',
  category: 'data',
  label: { he: 'פרטי קשר', en: 'Contact info' },
  icon: 'contact',
  container: false,
  props: {
    phone: { type: 'string', default: '', optional: true, label: { he: 'טלפון', en: 'Phone' } },
    email: { type: 'string', default: '', optional: true, label: { he: 'אימייל', en: 'Email' } },
    address: { type: 'string', default: '', optional: true, label: { he: 'כתובת', en: 'Address' } },
    hours: { type: 'string', default: '', optional: true, label: { he: 'שעות פעילות', en: 'Hours' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx) {
    const { id, cls } = attrsExtra(node);
    const p = node.props;
    const lines = [];
    if (p.phone) {
      lines.push(
        `<div class="contact-line"><span class="contact-k">טלפון</span> ` +
          `<a href="tel:${escapeAttr(String(p.phone).replace(/\s/g, ''))}">${escapeHtml(p.phone)}</a></div>`
      );
    }
    if (p.email) {
      lines.push(
        `<div class="contact-line"><span class="contact-k">אימייל</span> ` +
          `<a href="mailto:${escapeAttr(p.email)}">${escapeHtml(p.email)}</a></div>`
      );
    }
    if (p.address) {
      lines.push(`<div class="contact-line"><span class="contact-k">כתובת</span> ${escapeHtml(p.address)}</div>`);
    }
    if (p.hours) {
      lines.push(`<div class="contact-line"><span class="contact-k">שעות</span> ${escapeHtml(p.hours)}</div>`);
    }
    return `<section${id} class="contact-info bent-contact-info${cls}"${dirAttr(ctx)}>${lines.join('')}</section>`;
  }
});

register({
  name: 'banner',
  tag: 'bent-banner',
  category: 'content',
  label: { he: 'באנר הודעה', en: 'Banner' },
  icon: 'banner',
  container: false,
  props: {
    tone: {
      type: 'enum', values: ['brand', 'dark', 'light', 'warn'], default: 'brand', optional: true,
      label: { he: 'סגנון', en: 'Tone' }
    },
    align: {
      type: 'enum', values: ['start', 'center', 'end'], default: 'start', optional: true,
      label: { he: 'יישור', en: 'Align' }
    },
    text: { type: 'text', content: true, default: '', label: { he: 'הודעה', en: 'Message' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx) {
    const { id, cls } = attrsExtra(node);
    const tone = ['brand', 'dark', 'light', 'warn'].includes(node.props.tone) ? node.props.tone : 'brand';
    return `<div${id} class="site-banner tone-${escapeAttr(tone)} bent-banner${cls}"${dirAttr(ctx)}><p>${escapeHtml(node.text)}</p></div>`;
  }
});

// ─── Signature visuals (v0.44) — the patterns the vision was named for ──

register({
  name: 'marquee',
  tag: 'bent-marquee',
  category: 'effects',
  label: { he: 'טקסט נע', en: 'Marquee' },
  icon: 'marquee',
  container: false,
  props: {
    speed: {
      type: 'enum', values: ['slow', 'md', 'fast'], default: 'md', optional: true,
      label: { he: 'מהירות', en: 'Speed' }
    },
    text: { type: 'text', content: true, default: 'ברוכים הבאים ✦', label: { he: 'הטקסט הנע', en: 'Text' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx) {
    const { id, cls } = attrsExtra(node);
    const speed = ['slow', 'md', 'fast'].includes(node.props.speed) ? node.props.speed : 'md';
    const t = escapeHtml(node.text);
    const track = `<span class="marquee-item">${t}</span>`;
    return `<div${id} class="marquee marquee-${speed} bent-marquee${cls}"${dirAttr(ctx)}>` +
      `<div class="marquee-track">${track}</div>` +
      `<div class="marquee-track" aria-hidden="true">${track}</div></div>`;
  }
});

register({
  name: 'parallax',
  tag: 'bent-parallax',
  category: 'effects',
  label: { he: 'רקע קבוע (פרלקסה)', en: 'Parallax' },
  icon: 'parallax',
  container: true,
  accept: [],
  props: {
    image: { type: 'url', default: '', label: { he: 'תמונת רקע', en: 'Background image' } },
    overlay: {
      type: 'integer', min: 0, max: 80, default: 0, optional: true,
      label: { he: 'כהות שכבת רקע', en: 'Overlay' }
    },
    height: {
      type: 'enum', values: ['sm', 'md', 'lg', 'full'], default: 'md', optional: true,
      label: { he: 'גובה', en: 'Height' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const height = ['sm', 'md', 'lg', 'full'].includes(node.props.height) ? node.props.height : 'md';
    const overlayVal = Math.min(Math.max(parseInt(node.props.overlay, 10) || 0, 0), 80);
    const vars = [`background-image:url('${escapeCssUrl(node.props.image || '')}')`];
    if (overlayVal > 0) vars.unshift(`--px-overlay:${(overlayVal / 100).toFixed(2)}`);
    const overlaidCls = overlayVal > 0 ? ' parallax-overlaid' : '';
    const inner = node.children.map((c) => compileChild(c, ctx)).join('');
    return `<section${id} class="parallax-section parallax-${height}${overlaidCls} bent-parallax${cls}"` +
      ` style="${vars.join(';')}"${dirAttr(ctx)}>` +
      `<div class="parallax-inner">${inner}</div></section>`;
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
