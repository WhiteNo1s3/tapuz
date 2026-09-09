'use strict';

const { escapeHtml, escapeAttr, escapeCssUrl, safeHref } = require('../language/escape');
const { renderHandle, renderSocial } = require('../social-html');
const {
  renderHeadLink, renderHeader, renderFootLink, renderFooter
} = require('../chrome-html');
const { renderProduct, renderProducts } = require('../products-html');

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

/** Entrance-animation values. Canonical names; the repair layer aliases the
 * common drifts (slide-up → rise, zoom-in → zoom) instead of snapping them
 * to none — grok's demo wrote them, the game must honour them. */
const ANIMATE_VALUES = ['none', 'fade', 'rise', 'zoom'];

/**
 * v1.97: props EVERY module accepts, injected at registration like id/class
 * are — grok's game writes `animate=` on anything, and it was silently
 * dropped on modules that didn't declare it (validate skips undeclared
 * props, compile ignores them: the worst kind of bug, the invisible kind).
 * A def that declares its own version keeps it.
 */
const UNIVERSAL_PROPS = {
  animate: {
    type: 'enum', values: ANIMATE_VALUES, default: 'none', optional: true,
    label: { he: 'אנימציית כניסה', en: 'Entrance animation' }
  }
};

function register(def) {
  if (!def.name || !def.tag) throw new Error('module requires name and tag');
  def.props = Object.assign({}, UNIVERSAL_PROPS, def.props || {});
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
  // the universal entrance animation rides the same class slot as class= —
  // one seam, every module animates (v1.97)
  const anim = node.props && ANIMATE_VALUES.includes(node.props.animate) && node.props.animate !== 'none'
    ? ` anim-${node.props.animate}` : '';
  const cls = (node.className ? ` ${escapeAttr(node.className)}` : '') + anim;
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
    // animate is UNIVERSAL since v1.97 — injected by register(), zoom included
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
    const { id, cls } = attrsExtra(node); // cls carries anim-* since v1.97
    const alignCls = node.props.align && node.props.align !== 'start' ? ` align-${escapeAttr(node.props.align)}` : '';
    return `<h${level}${id} class="bent-heading${alignCls}${cls}"${dirAttr(ctx)}>${escapeHtml(node.text)}</h${level}>`;
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
    // animate is UNIVERSAL since v1.97 — injected by register(), zoom included
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
    // anim-* rides cls via attrsExtra since v1.97
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
    title: { type: 'string', default: '', optional: true, label: { he: 'כותרת תמונה (SEO)', en: 'Image title' } },
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
    const imgTitle = node.props.title ? ` title="${escapeAttr(node.props.title)}"` : '';
    let inner = `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${imgTitle} loading="lazy">`;
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
    rel: { type: 'string', default: '', optional: true, label: { he: 'יחס קישור (rel)', en: 'Link rel' } },
    target: { type: 'enum', values: ['_self', '_blank'], default: '_self', optional: true, label: { he: 'פתיחה', en: 'Target' } },
    title: { type: 'string', default: '', optional: true, label: { he: 'כותרת קישור (SEO)', en: 'Link title' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { href: '#', variant: 'primary', text: 'לחץ כאן' },
  compile(node, ctx) {
    const href = safeHref(node.props.href || '#');
    const variant = node.props.variant || 'primary';
    const { id, cls } = attrsExtra(node);
    const seo = require('../link-attrs').linkSeoAttrs(node.props);
    return `<a${id} href="${escapeAttr(href)}"${seo} class="btn btn-${escapeAttr(variant)} bent-button${cls}"${dirAttr(ctx)}>${escapeHtml(node.text)}</a>`;
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
    const url = escapeAttr(safeHref(rawUrl));
    return `<a${id} href="${url}" class="bent-embed${cls}" target="_blank" rel="noopener">${escapeHtml(rawUrl)}</a>`;
  }
});

// ─── Layout ────────────────────────────────────────────────────────

register({
  // v0.75: section doubles as the container-as-tool (מיכל). A content section
  // with no children is legitimate EMPTY — it compiles to reserved blank
  // space (sized by `size`) to be filled in a future release. The `kind`
  // prop keeps its old job: lossless stash for unknown block types.
  name: 'section',
  tag: 'bent-section',
  category: 'layout',
  label: { he: 'מיכל', en: 'Section' },
  icon: 'section',
  container: true,
  accept: [],
  props: {
    kind: {
      type: 'string', default: 'content', optional: true,
      label: { he: 'סוג', en: 'Kind' }
    },
    size: {
      type: 'enum', values: ['sm', 'md', 'lg', 'xl'], default: 'md', optional: true,
      label: { he: 'גובה כשריק', en: 'Empty height' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { kind: 'content', size: 'md' },
  compile(node, ctx, compileChild) {
    const kind = node.props.kind || 'content';
    const { id, cls } = attrsExtra(node);
    const inner = node.children.map((c) => compileChild(c, ctx)).join('');
    const size = ['sm', 'md', 'lg', 'xl'].includes(String(node.props.size)) ? node.props.size : 'md';
    const empty = (!inner && kind === 'content') ? ` tz-section is-empty size-${size}` : '';
    return `<section${id} class="bent-section kind-${escapeAttr(kind)}${empty}${cls}"${dirAttr(ctx)}>${inner}</section>`;
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
    // Ratio rides a CSS custom property, never inline display:grid — same
    // contract as the server renderer: the stylesheet (.cols-ratio) owns
    // display and the narrow-screen stack; inline display used to defeat it.
    let gridStyle = '';
    const ratio = String(node.props.ratio || '');
    if (ratio.includes(':')) {
      const parts = ratio.split(':').map((x) => Math.max(0.2, parseFloat(x) || 1));
      if (parts.length === node.children.length) {
        gridStyle = ` style="--cols:${parts.map((r) => r + 'fr').join(' ')}"`;
        extraCls += ' cols-ratio';
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
      ? `<a class="btn btn-${escapeAttr(p.variant || 'primary')}" href="${escapeAttr(safeHref(p.url || '#'))}">${escapeHtml(p.buttontext)}</a>`
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
      ? `<a${id} class="logo-cell bent-logo${cls}" href="${escapeAttr(safeHref(node.props.url))}">${img}</a>`
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

// ─── Nav (v0.60) — page-level navigation bar with color options (batch 2) ─
register({
  name: 'navitem',
  tag: 'bent-navitem',
  category: 'layout',
  label: { he: 'קישור ניווט', en: 'Nav link' },
  icon: 'link',
  container: false,
  props: {
    label: { type: 'string', default: '', label: { he: 'טקסט', en: 'Label' } },
    href: { type: 'url', default: '', optional: true, label: { he: 'קישור', en: 'Link' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    return require('../nav-html').renderNavItem(node.props || {});
  }
});

register({
  name: 'nav',
  tag: 'bent-nav',
  category: 'layout',
  label: { he: 'תפריט ניווט', en: 'Nav menu' },
  icon: 'nav',
  container: true,
  accept: ['navitem'],
  props: {
    background: { type: 'string', default: '', optional: true, label: { he: 'צבע רקע', en: 'Background color' } },
    color: { type: 'string', default: '', optional: true, label: { he: 'צבע טקסט', en: 'Text color' } },
    align: { type: 'enum', values: ['start', 'center', 'end'], default: 'start', label: { he: 'יישור', en: 'Align' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const inner = (node.children || []).map((c) => compileChild(c, ctx)).join('');
    return require('../nav-html').renderNav(node.props || {}, inner, { idAttr: id, cls, dir: dirAttr(ctx) });
  }
});

// ─── Card grid (v0.59) — the walla lesson: a content site is a wall of
//     media cards. `cards` container of repeatable `mediacard` items. ───
register({
  name: 'mediacard',
  tag: 'bent-mediacard',
  category: 'media',
  label: { he: 'כרטיס תוכן', en: 'Media card' },
  icon: 'card',
  container: false,
  props: {
    image: { type: 'url', default: '', optional: true, label: { he: 'תמונה', en: 'Image' } },
    tag: { type: 'string', default: '', optional: true, label: { he: 'תגית / קטגוריה', en: 'Tag' } },
    title: { type: 'string', default: '', label: { he: 'כותרת', en: 'Title' } },
    excerpt: { type: 'string', default: '', optional: true, label: { he: 'תקציר', en: 'Excerpt' } },
    href: { type: 'url', default: '', optional: true, label: { he: 'קישור', en: 'Link' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    return require('../card-html').renderCard(node.props || {});
  }
});

register({
  name: 'cards',
  tag: 'bent-cards',
  category: 'media',
  label: { he: 'רשת כרטיסים', en: 'Card grid' },
  icon: 'grid',
  container: true,
  accept: ['mediacard'],
  props: {
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const inner = (node.children || []).map((c) => compileChild(c, ctx)).join('');
    return require('../card-html').renderCardsGrid(inner, { idAttr: id, cls, dir: dirAttr(ctx) });
  }
});

// ─── Carousel (v0.79) — the cards unit sliding instead of wrapping: a
//     zero-JS horizontal scroll-snap strip (touch-native, RTL-aware). ───
register({
  name: 'slide',
  tag: 'bent-slide',
  category: 'media',
  label: { he: 'שקופית', en: 'Slide' },
  icon: 'card',
  container: false,
  props: {
    image: { type: 'url', default: '', optional: true, label: { he: 'תמונה', en: 'Image' } },
    tag: { type: 'string', default: '', optional: true, label: { he: 'תגית / קטגוריה', en: 'Tag' } },
    title: { type: 'string', default: '', optional: true, label: { he: 'כותרת', en: 'Title' } },
    excerpt: { type: 'string', default: '', optional: true, label: { he: 'תקציר', en: 'Excerpt' } },
    href: { type: 'url', default: '', optional: true, label: { he: 'קישור', en: 'Link' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    return require('../carousel-html').renderSlide(node.props || {});
  }
});

register({
  name: 'carousel',
  tag: 'bent-carousel',
  category: 'media',
  label: { he: 'קרוסלה', en: 'Carousel' },
  icon: 'carousel',
  container: true,
  accept: ['slide'],
  props: {
    height: { type: 'enum', values: ['sm', 'md', 'lg'], default: 'md', optional: true, label: { he: 'גובה', en: 'Height' } },
    peek: { type: 'boolean', default: true, optional: true, label: { he: 'הצצה לשקופית הבאה', en: 'Peek next slide' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const inner = (node.children || []).map((c) => compileChild(c, ctx)).join('');
    return require('../carousel-html').renderCarouselTrack(inner, {
      idAttr: id,
      cls,
      height: node.props && node.props.height,
      peek: node.props && node.props.peek,
      dir: dirAttr(ctx)
    });
  }
});

// ─── Moving-news ticker (v0.61) — walla's מבזקים strip (batch 3): a pinned
//     label + scrolling clickable headlines, with color + speed options.
//     A NEWS component (headlines/links), not the decorative `marquee`. ───
register({
  name: 'tickeritem',
  tag: 'bent-tickeritem',
  category: 'media',
  label: { he: 'מבזק', en: 'Ticker headline' },
  icon: 'link',
  container: false,
  props: {
    text: { type: 'string', default: '', label: { he: 'כותרת', en: 'Headline' } },
    href: { type: 'url', default: '', optional: true, label: { he: 'קישור', en: 'Link' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    return require('../ticker-html').renderTickerItem(node.props || {});
  }
});

register({
  name: 'ticker',
  tag: 'bent-ticker',
  category: 'media',
  label: { he: 'מבזקים נעים', en: 'News ticker' },
  icon: 'ticker',
  container: true,
  accept: ['tickeritem'],
  props: {
    label: { type: 'string', default: '', optional: true, label: { he: 'תווית', en: 'Label' } },
    speed: { type: 'enum', values: ['slow', 'md', 'fast'], default: 'md', optional: true, label: { he: 'מהירות', en: 'Speed' } },
    background: { type: 'string', default: '', optional: true, label: { he: 'צבע רקע', en: 'Background color' } },
    color: { type: 'string', default: '', optional: true, label: { he: 'צבע טקסט', en: 'Text color' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const inner = (node.children || []).map((c) => compileChild(c, ctx)).join('');
    return require('../ticker-html').renderTicker(node.props || {}, inner, { idAttr: id, cls, dir: dirAttr(ctx) });
  }
});

// ─── Timestamped news feed (v0.70) — walla's standing "HH:MM · headline"
//     column (the ticker scrolls; newspop stays). A `newspop` container of
//     repeatable `newspopitem` rows, each with a time + headline + link. ───
register({
  name: 'newspopitem',
  tag: 'bent-newspopitem',
  category: 'media',
  label: { he: 'עדכון', en: 'News update' },
  icon: 'link',
  container: false,
  props: {
    time: { type: 'string', default: '', optional: true, label: { he: 'שעה', en: 'Time' } },
    text: { type: 'string', default: '', label: { he: 'כותרת', en: 'Headline' } },
    href: { type: 'url', default: '', optional: true, label: { he: 'קישור', en: 'Link' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    return require('../newspop-html').renderNewspopItem(node.props || {});
  }
});

register({
  name: 'newspop',
  tag: 'bent-newspop',
  category: 'media',
  label: { he: 'מבזקים עם שעות', en: 'News feed' },
  icon: 'ticker',
  container: true,
  accept: ['newspopitem'],
  props: {
    label: { type: 'string', default: '', optional: true, label: { he: 'תווית', en: 'Label' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const inner = (node.children || []).map((c) => compileChild(c, ctx)).join('');
    return require('../newspop-html').renderNewspop(node.props || {}, inner, { idAttr: id, cls, dir: dirAttr(ctx) });
  }
});

// ─── Video (v0.62) — native self-hosted <video> (batch item 4). `embed`
//     already covers YouTube iframes; a YT url here degrades to that embed. ──
register({
  name: 'video',
  tag: 'bent-video',
  category: 'media',
  label: { he: 'וידאו', en: 'Video' },
  icon: 'video',
  container: false,
  props: {
    src: { type: 'url', default: '', label: { he: 'קובץ וידאו / קישור', en: 'Video file / URL' } },
    poster: { type: 'url', default: '', optional: true, label: { he: 'תמונת שער', en: 'Poster' } },
    caption: { type: 'string', default: '', optional: true, label: { he: 'כיתוב', en: 'Caption' } },
    controls: { type: 'boolean', default: true, optional: true, label: { he: 'פקדי נגן', en: 'Controls' } },
    autoplay: { type: 'boolean', default: false, optional: true, label: { he: 'ניגון אוטומטי', en: 'Autoplay' } },
    loop: { type: 'boolean', default: false, optional: true, label: { he: 'לולאה', en: 'Loop' } },
    muted: { type: 'boolean', default: false, optional: true, label: { he: 'מושתק', en: 'Muted' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { controls: true },
  compile(node) {
    const { id, cls } = attrsExtra(node);
    return require('../video-html').renderVideo(node.props || {}, { idAttr: id, cls });
  }
});

// ─── Audio (v0.80) — the last media graduation: native <audio> player
//     (podcasts, music, radio clips). YouTube src degrades to the embed. ───
register({
  name: 'audio',
  tag: 'bent-audio',
  category: 'media',
  label: { he: 'שמע', en: 'Audio' },
  icon: 'audio',
  container: false,
  props: {
    src: { type: 'url', default: '', label: { he: 'קובץ שמע / קישור', en: 'Audio file / URL' } },
    caption: { type: 'string', default: '', optional: true, label: { he: 'כיתוב', en: 'Caption' } },
    loop: { type: 'boolean', default: false, optional: true, label: { he: 'לולאה', en: 'Loop' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    const { id, cls } = attrsExtra(node);
    return require('../audio-html').renderAudio(node.props || {}, { idAttr: id, cls });
  }
});

// ─── Category presentation (v0.64, batch finale) — a branded header + the
//     category's article grid. Dynamic leaf like article-list: articles come
//     from ctx (threaded), category metadata from ctx.categories (the file
//     store content/categories.json). Membership = the page's portable tags. ──
register({
  name: 'category',
  tag: 'bent-category',
  category: 'data',
  label: { he: 'קטגוריה', en: 'Category' },
  icon: 'category',
  container: false,
  props: {
    slug: { type: 'string', default: '', label: { he: 'קטגוריה (slug)', en: 'Category slug' } },
    limit: { type: 'integer', min: 1, max: 48, default: 6, optional: true, label: { he: 'כמות', en: 'Limit' } },
    showheader: { type: 'boolean', default: true, optional: true, label: { he: 'הצג כותרת', en: 'Show header' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { slug: '' },
  compile(node, ctx) {
    const { id, cls } = attrsExtra(node);
    const p = node.props || {};
    const slug = String(p.slug || '');
    const limit = Math.min(Math.max(parseInt(p.limit, 10) || 6, 1), 48);
    const articles = (Array.isArray(ctx.articles) ? ctx.articles : [])
      .filter((a) => slug && (a.tags || []).includes(slug))
      .slice(0, limit);
    const category = (Array.isArray(ctx.categories) ? ctx.categories : [])
      .find((c) => c && c.slug === slug) || null;
    return require('../category-html').renderCategory(p, { category, articles }, { idAttr: id, cls, dir: dirAttr(ctx) });
  }
});

// ─── Form (v0.58) — the decompiler's #1 tool gap, now first-class ──────
register({
  name: 'field',
  tag: 'bent-field',
  category: 'data',
  label: { he: 'שדה טופס', en: 'Form field' },
  icon: 'field',
  container: false,
  props: {
    label: { type: 'string', default: '', label: { he: 'תווית', en: 'Label' } },
    name: { type: 'string', default: '', optional: true, label: { he: 'שם השדה', en: 'Field name' } },
    type: { type: 'enum', values: ['text', 'email', 'tel', 'textarea', 'select', 'checkbox'], default: 'text', label: { he: 'סוג', en: 'Type' } },
    placeholder: { type: 'string', default: '', optional: true, label: { he: 'רמז', en: 'Placeholder' } },
    required: { type: 'boolean', default: false, label: { he: 'חובה', en: 'Required' } },
    options: { type: 'string', default: '', optional: true, label: { he: 'אפשרויות (מופרד בפסיק)', en: 'Options (comma-sep)' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    const { id, cls } = attrsExtra(node);
    return require('../form-html').renderField(node.props || {}, id, cls);
  }
});

register({
  name: 'form',
  tag: 'bent-form',
  category: 'data',
  label: { he: 'טופס', en: 'Form' },
  icon: 'form',
  container: true,
  accept: ['field'],
  props: {
    action: { type: 'string', default: '', optional: true, label: { he: 'יעד שליחה (URL)', en: 'Submit URL' } },
    method: { type: 'enum', values: ['post', 'get'], default: 'post', label: { he: 'שיטה', en: 'Method' } },
    submit: { type: 'string', default: 'שליחה', label: { he: 'כפתור שליחה', en: 'Submit label' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const inner = (node.children || []).map((c) => compileChild(c, ctx)).join('');
    return require('../form-html').renderForm(node.props || {}, inner, { idAttr: id, cls, dir: dirAttr(ctx) });
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
  label: { he: 'באנר', en: 'Banner' },
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
    // a fresh banner starts with visible placeholder text (like heading/text/
    // button) — the compile guard below hides EMPTIED banners from readers,
    // and a blank default would make the builder drop an invisible block
    text: { type: 'text', content: true, default: 'הודעה חדשה', label: { he: 'הודעה', en: 'Message' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx) {
    const { id, cls } = attrsExtra(node);
    // an empty banner is markup residue — never ship a blank strip to a reader
    if (!String(node.text || '').trim()) return '';
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

// ─── Interactive containers (v0.54) — CSS-only, no JS ──────────────
// tabs: pure-CSS via the radio hack (input:checked + label + .panel).
// accordion: native <details>. Children are leaf tab/fold (label + text).

register({
  name: 'tab',
  tag: 'bent-tab',
  category: 'layout',
  label: { he: 'טאב', en: 'Tab' },
  icon: 'tab',
  container: false,
  props: {
    label: { type: 'string', default: 'טאב', label: { he: 'כותרת הטאב', en: 'Tab label' } },
    text: { type: 'text', content: true, default: '', label: { he: 'תוכן', en: 'Content' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { label: 'טאב' },
  // rendered by the parent <bent-tabs>; standalone it degrades to a text block
  compile(node, ctx) {
    const { id, cls } = attrsExtra(node);
    return `<div${id} class="bent-tab-panel${cls}"${dirAttr(ctx)}>${escapeHtml(node.text)}</div>`;
  }
});

register({
  name: 'tabs',
  tag: 'bent-tabs',
  category: 'layout',
  label: { he: 'טאבים', en: 'Tabs' },
  icon: 'tabs',
  container: true,
  accept: ['tab'],
  props: {
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx) {
    const { id, cls } = attrsExtra(node);
    const group = 'bt-' + escapeAttr(node.id || 'tabs');
    const tabs = (node.children || []).filter((c) => c.name === 'tab');
    let inner = '';
    tabs.forEach((t, i) => {
      const tid = escapeAttr((node.id || 'tabs') + '-' + i);
      inner += `<input type="radio" name="${group}" id="${tid}" class="bent-tab-radio"${i === 0 ? ' checked' : ''}>`;
      inner += `<label for="${tid}" class="bent-tab-label">${escapeHtml(t.props.label || ('טאב ' + (i + 1)))}</label>`;
      inner += `<div class="bent-tab-panel">${escapeHtml(t.text || '')}</div>`;
    });
    return `<div${id} class="bent-tabs${cls}"${dirAttr(ctx)}>${inner}</div>`;
  }
});

register({
  name: 'fold',
  tag: 'bent-fold',
  category: 'layout',
  label: { he: 'מגירה', en: 'Fold' },
  icon: 'fold',
  container: false,
  props: {
    title: { type: 'string', default: 'כותרת', label: { he: 'כותרת', en: 'Title' } },
    text: { type: 'text', content: true, default: '', label: { he: 'תוכן', en: 'Content' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { title: 'כותרת' },
  compile(node, ctx) {
    const { id, cls } = attrsExtra(node);
    return `<details${id} class="bent-fold${cls}"${dirAttr(ctx)}><summary>${escapeHtml(node.props.title || '')}</summary>` +
      `<div class="bent-fold-body">${escapeHtml(node.text)}</div></details>`;
  }
});

register({
  name: 'accordion',
  tag: 'bent-accordion',
  category: 'layout',
  label: { he: 'אקורדיון', en: 'Accordion' },
  icon: 'accordion',
  container: true,
  accept: ['fold'],
  props: {
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx) {
    const { id, cls } = attrsExtra(node);
    const folds = (node.children || []).filter((c) => c.name === 'fold');
    const rows = folds.map((f, i) =>
      `<details class="bent-fold"${i === 0 ? ' open' : ''}><summary>${escapeHtml(f.props.title || '')}</summary>` +
      `<div class="bent-fold-body">${escapeHtml(f.text || '')}</div></details>`
    ).join('');
    return `<div${id} class="bent-accordion${cls}"${dirAttr(ctx)}>${rows}</div>`;
  }
});

// ─── Table (v0.83) — hours, prices, schedules. Rows are ONE pipe-joined
//     string everywhere (the markdown-table reflex); zero JS. ───
register({
  name: 'trow',
  tag: 'bent-trow',
  category: 'content',
  label: { he: 'שורת טבלה', en: 'Table row' },
  icon: 'row',
  container: false,
  props: {
    cells: { type: 'text', content: true, default: '', label: { he: 'תאים (מופרדים ב-|)', en: 'Cells (pipe-separated)' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    // Inside a real table the PARENT renders the whole grid (it needs every
    // row for width equalizing) and reads this child's text directly. A
    // stray standalone trow (repair paths) degrades to a one-row table —
    // content always visible, never an empty string.
    return require('../table-html').renderTable({ header: false, rows: [{ cells: node.text || ' ' }] });
  }
});

register({
  name: 'table',
  tag: 'bent-table',
  category: 'content',
  label: { he: 'טבלה', en: 'Table' },
  icon: 'table',
  container: true,
  accept: ['trow'],
  props: {
    header: { type: 'boolean', default: true, optional: true, label: { he: 'שורה ראשונה = כותרת', en: 'First row is header' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx) {
    const { id, cls } = attrsExtra(node);
    const rows = (node.children || [])
      .filter((c) => c.name === 'trow')
      .map((c) => ({ cells: c.text || '' }));
    return require('../table-html').renderTable(
      { header: node.props && node.props.header, rows },
      { idAttr: id, cls, dir: dirAttr(ctx) }
    );
  }
});

// ─── The escape hatch (v0.49) — graduated to a first-class tool (v1.49) ────
// A registered tag whose PAYLOAD is arbitrary HTML. The standard stays a
// registry (this IS a registered module); the payload is unconstrained.
//
// WHY IT EXISTS: no CMS can ship every widget in the world. When an author —
// human or agent — needs the thing we have no module for, this is the hatch,
// rather than the thing not being buildable at all. v0.49 shipped it as a
// QUARANTINE bin (provisional, sanitized, importer-only); v1.49 graduated it
// into a real tool authors and agents reach for on purpose.
//
// SECURITY — deliberate, do not "fix" this by adding a sanitizer back:
// the payload compiles RAW, script included, and the published CSP allows
// 'unsafe-inline', so a <script> written here RUNS. Anyone who can edit a page
// can run script on visitors. What stays scrubbed is content from OUTSIDE —
// src/pzn/graduate.js still sanitizes scraped third-party markup on import.
// Trusted-author raw, untrusted-source scrubbed. That is the line.
//
// `provisional` no longer defaults true: it now means "the importer parked
// this here, graduate it into real modules," which is what the builder flags.
register({
  name: 'html',
  tag: 'bent-html',
  category: 'advanced',
  label: { he: 'HTML גולמי', en: 'Raw HTML' },
  icon: 'code',
  container: false,
  props: {
    content: {
      type: 'text', default: '',
      label: { he: 'קוד HTML', en: 'HTML code' }
    },
    provisional: {
      type: 'boolean', default: false, optional: true,
      label: { he: 'זמני (להמרה למודולים)', en: 'Provisional (convert to modules)' }
    },
    note: {
      type: 'string', default: '', optional: true,
      label: { he: 'הערה / מה להמיר', en: 'Note / what to convert' }
    },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: { content: '', provisional: false },
  compile(node, ctx) {
    const { id, cls } = attrsExtra(node);
    const raw = node.props.content || '';
    const flag = node.props.provisional;
    const prov = (flag === true || flag === 'true') ? ' data-bent-provisional="true"' : '';
    return `<div${id} class="bent-html${cls}"${prov}${dirAttr(ctx)}>${raw}</div>`;
  }
});

// ─── Pricing table (v1.05) — the module-hunt gap from docs/COMPETITIVE.md
//     ("pricing-table sugar"). `pricing` container of repeatable `plan`
//     items, same flat-props-only shape as mediacard/navitem. ───
register({
  name: 'plan',
  tag: 'bent-plan',
  category: 'layout',
  label: { he: 'תוכנית מחיר', en: 'Pricing plan' },
  icon: 'card',
  container: false,
  props: {
    title: { type: 'string', default: '', label: { he: 'שם התוכנית', en: 'Title' } },
    price: { type: 'string', default: '', optional: true, label: { he: 'מחיר', en: 'Price' } },
    period: { type: 'string', default: '', optional: true, label: { he: 'תדירות', en: 'Period' } },
    features: { type: 'string', default: '', optional: true, label: { he: 'תכונות (שורה לכל תכונה)', en: 'Features (one per line)' } },
    ctaLabel: { type: 'string', default: '', optional: true, label: { he: 'טקסט כפתור', en: 'CTA label' } },
    ctaUrl: { type: 'url', default: '', optional: true, label: { he: 'קישור כפתור', en: 'CTA link' } },
    highlighted: { type: 'boolean', default: false, optional: true, label: { he: 'תוכנית מומלצת', en: 'Highlighted' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    return require('../pricing-html').renderPlan(node.props || {});
  }
});

register({
  name: 'pricing',
  tag: 'bent-pricing',
  category: 'layout',
  label: { he: 'טבלת מחירים', en: 'Pricing table' },
  icon: 'grid',
  container: true,
  accept: ['plan'],
  props: {
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const inner = (node.children || []).map((c) => compileChild(c, ctx)).join('');
    return require('../pricing-html').renderPricing(node.props || {}, inner, { idAttr: id, cls, dir: dirAttr(ctx) });
  }
});

// ─── Steps + timeline (module-hunt gaps from docs/COMPETITIVE.md) ───
// How-it-works numbered process and company-history rail. Zero JS;
// CSS counters / a vertical line. Child modules are flat-props like plan.

register({
  name: 'step',
  tag: 'bent-step',
  category: 'layout',
  label: { he: 'שלב', en: 'Step' },
  icon: 'step',
  container: false,
  props: {
    title: { type: 'string', default: '', label: { he: 'כותרת השלב', en: 'Title' } },
    icon: { type: 'string', default: '', optional: true, label: { he: 'אייקון', en: 'Icon' } },
    text: { type: 'text', content: true, default: '', label: { he: 'תיאור', en: 'Description' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    const props = Object.assign({}, node.props || {}, { text: node.text || (node.props && node.props.text) || '' });
    return require('../steps-html').renderStep(props);
  }
});

register({
  name: 'steps',
  tag: 'bent-steps',
  category: 'layout',
  label: { he: 'שלבי תהליך', en: 'Steps' },
  icon: 'steps',
  container: true,
  accept: ['step'],
  props: {
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const inner = (node.children || []).map((c) => compileChild(c, ctx)).join('');
    return require('../steps-html').renderSteps(node.props || {}, inner, { idAttr: id, cls, dir: dirAttr(ctx) });
  }
});

register({
  name: 'event',
  tag: 'bent-event',
  category: 'content',
  label: { he: 'אירוע בציר זמן', en: 'Timeline event' },
  icon: 'event',
  container: false,
  props: {
    time: { type: 'string', default: '', optional: true, label: { he: 'תאריך / שנה', en: 'Date / year' } },
    title: { type: 'string', default: '', label: { he: 'כותרת', en: 'Title' } },
    image: { type: 'url', default: '', optional: true, label: { he: 'תמונה', en: 'Image' } },
    text: { type: 'text', content: true, default: '', label: { he: 'תיאור', en: 'Description' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    const props = Object.assign({}, node.props || {}, { text: node.text || (node.props && node.props.text) || '' });
    return require('../timeline-html').renderEvent(props);
  }
});

register({
  name: 'timeline',
  tag: 'bent-timeline',
  category: 'content',
  label: { he: 'ציר זמן', en: 'Timeline' },
  icon: 'timeline',
  container: true,
  accept: ['event'],
  props: {
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const inner = (node.children || []).map((c) => compileChild(c, ctx)).join('');
    return require('../timeline-html').renderTimeline(node.props || {}, inner, { idAttr: id, cls, dir: dirAttr(ctx) });
  }
});

// ─── Breadcrumbs (copy-this-site chrome that was flattening into nav) ───
register({
  name: 'crumb',
  tag: 'bent-crumb',
  category: 'layout',
  label: { he: 'פירור', en: 'Crumb' },
  icon: 'crumb',
  container: false,
  props: {
    label: { type: 'string', default: '', label: { he: 'טקסט', en: 'Label' } },
    url: { type: 'url', default: '', optional: true, label: { he: 'קישור', en: 'Link' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    return require('../crumbs-html').renderCrumb(node.props || {}, !((node.props && node.props.url)));
  }
});

register({
  name: 'handle',
  tag: 'bent-handle',
  category: 'media',
  label: { he: 'רשת', en: 'Network' },
  icon: 'social',
  container: false,
  props: {
    network: { type: 'string', default: '', optional: true, label: { he: 'רשת', en: 'Network' } },
    url: { type: 'url', default: '', label: { he: 'קישור', en: 'URL' } },
    label: { type: 'string', default: '', optional: true, label: { he: 'תווית', en: 'Label' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    const props = Object.assign({}, node.props || {});
    if (!props.label && node.text) props.label = node.text;
    return renderHandle(props);
  }
});

register({
  name: 'social',
  tag: 'bent-social',
  category: 'media',
  label: { he: 'רשתות חברתיות', en: 'Social' },
  icon: 'social',
  container: true,
  accept: ['handle'],
  props: {
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const inner = (node.children || []).map((c) => {
      if (c.name !== 'handle') return compileChild(c, ctx);
      const props = Object.assign({}, c.props || {});
      if (!props.label && c.text) props.label = c.text;
      return renderHandle(props);
    }).join('');
    return renderSocial(node.props || {}, inner, { idAttr: id, cls, dir: dirAttr(ctx) });
  }
});

register({
  name: 'headlink',
  tag: 'bent-headlink',
  category: 'layout',
  label: { he: 'קישור כותרת', en: 'Header link' },
  icon: 'link',
  container: false,
  props: {
    label: { type: 'string', default: '', label: { he: 'טקסט', en: 'Label' } },
    href: { type: 'url', default: '', optional: true, label: { he: 'קישור', en: 'Link' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    const props = Object.assign({}, node.props || {});
    if (!props.label && node.text) props.label = node.text;
    return renderHeadLink(props);
  }
});

register({
  name: 'header',
  tag: 'bent-header',
  category: 'layout',
  label: { he: 'כותרת עליונה', en: 'Header' },
  icon: 'header',
  container: true,
  accept: ['headlink'],
  props: {
    logo: { type: 'url', default: '', optional: true, label: { he: 'לוגו', en: 'Logo' } },
    title: { type: 'string', default: '', optional: true, label: { he: 'שם האתר', en: 'Title' } },
    url: { type: 'url', default: '', optional: true, label: { he: 'קישור הלוגו', en: 'Logo URL' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const inner = (node.children || []).map((c) => {
      if (c.name !== 'headlink') return compileChild(c, ctx);
      const props = Object.assign({}, c.props || {});
      if (!props.label && c.text) props.label = c.text;
      return renderHeadLink(props);
    }).join('');
    return renderHeader(node.props || {}, inner, { idAttr: id, cls, dir: dirAttr(ctx) });
  }
});

register({
  name: 'footlink',
  tag: 'bent-footlink',
  category: 'layout',
  label: { he: 'קישור כותרת תחתונה', en: 'Footer link' },
  icon: 'link',
  container: false,
  props: {
    label: { type: 'string', default: '', label: { he: 'טקסט', en: 'Label' } },
    href: { type: 'url', default: '', optional: true, label: { he: 'קישור', en: 'Link' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    const props = Object.assign({}, node.props || {});
    if (!props.label && node.text) props.label = node.text;
    return renderFootLink(props);
  }
});

register({
  name: 'footer',
  tag: 'bent-footer',
  category: 'layout',
  label: { he: 'כותרת תחתונה', en: 'Footer' },
  icon: 'footer',
  container: true,
  accept: ['footlink'],
  props: {
    copy: { type: 'string', default: '', optional: true, label: { he: 'קופירייט', en: 'Copyright' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const inner = (node.children || []).map((c) => {
      if (c.name !== 'footlink') return compileChild(c, ctx);
      const props = Object.assign({}, c.props || {});
      if (!props.label && c.text) props.label = c.text;
      return renderFootLink(props);
    }).join('');
    return renderFooter(node.props || {}, inner, { idAttr: id, cls, dir: dirAttr(ctx) });
  }
});

register({
  name: 'crumbs',
  tag: 'bent-crumbs',
  category: 'layout',
  label: { he: 'פירורי לחם', en: 'Breadcrumbs' },
  icon: 'crumbs',
  container: true,
  accept: ['crumb'],
  props: {
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const kids = node.children || [];
    const inner = kids.map((c, idx) => {
      if (c.name !== 'crumb') return compileChild(c, ctx);
      const current = idx === kids.length - 1 || !(c.props && c.props.url);
      return require('../crumbs-html').renderCrumb(c.props || {}, current);
    }).join('');
    return require('../crumbs-html').renderCrumbs(node.props || {}, inner, { idAttr: id, cls, dir: dirAttr(ctx) });
  }
});

register({
  name: 'product',
  tag: 'bent-product',
  category: 'media',
  label: { he: 'מוצר', en: 'Product' },
  icon: 'card',
  container: false,
  props: {
    title: { type: 'string', default: '', label: { he: 'שם', en: 'Title' } },
    price: { type: 'string', default: '', optional: true, label: { he: 'מחיר', en: 'Price' } },
    image: { type: 'url', default: '', optional: true, label: { he: 'תמונה', en: 'Image' } },
    url: { type: 'url', default: '', optional: true, label: { he: 'קישור', en: 'URL' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node) {
    return renderProduct(node.props || {});
  }
});

register({
  name: 'products',
  tag: 'bent-products',
  category: 'media',
  label: { he: 'רשת מוצרים', en: 'Products' },
  icon: 'grid',
  container: true,
  accept: ['product'],
  props: {
    columns: { type: 'integer', default: 3, optional: true, label: { he: 'עמודות', en: 'Columns' } },
    id: { type: 'string', optional: true, label: { he: 'מזהה', en: 'ID' } },
    class: { type: 'string', optional: true, label: { he: 'מחלקה', en: 'Class' } }
  },
  defaults: {},
  compile(node, ctx, compileChild) {
    const { id, cls } = attrsExtra(node);
    const inner = (node.children || []).map((c) => {
      if (c.name !== 'product') return compileChild(c, ctx);
      return renderProduct(c.props || {});
    }).join('');
    return renderProducts(node.props || {}, inner, { idAttr: id, cls, dir: dirAttr(ctx) });
  }
});

module.exports = {
  register,
  ANIMATE_VALUES,
  getModule,
  getModuleByTag,
  listModules,
  moduleNames,
  REGISTRY
};
