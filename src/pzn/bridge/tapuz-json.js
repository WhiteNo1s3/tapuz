'use strict';

const { createDocument, createModule } = require('../language/ast');
const { getModule } = require('../modules/registry');
const { heroChildren } = require('../hero-children');

/**
 * Bridge: Tapuz JSON blocks ⇄ benTML document AST.
 *
 * v0.40 contract (registry unification): the round trip
 *   fromTapuzPage(page) → serialize → parse → toTapuzPage
 * must be lossless for every block type in src/block-registry.js.
 *
 * Rule: only carry what exists. A data field absent from the JSON stays
 * absent from the AST and vice versa — the bridge never invents defaults,
 * ids, or empty strings.
 */

function fromTapuzPage(page = {}) {
  const doc = createDocument({
    title: page.title || '',
    slug: page.slug || '',
    // v2.58 — a page with no language or direction of its own is the site's
    lang: page.lang || require('../../site-language').siteLanguage(),
    dir: page.direction || page.dir || require('../../site-language').siteDirection(),
    tags: page.tags || [],
    meta: {
      teaser: page.meta?.teaser || '',
      cardImage: page.meta?.cardImage || ''
    }
  });
  doc.body = (page.blocks || []).map(blockToModule).filter(Boolean);
  return doc;
}

/**
 * Copy `keys` from data → props, renaming via `renames`, skipping undefined.
 */
function pickProps(data, keys, renames = {}) {
  const props = {};
  for (const key of keys) {
    if (data[key] !== undefined) props[renames[key] || key] = data[key];
  }
  return props;
}

// data.style (the builder's styling object) crosses the bridge as flat
// `style-*` attributes — prefixed so they can never collide with a module's
// own props (divider's `style`, nav/ticker's `background`/`color`).
const STYLE_KEYS = [
  ['color', 'style-color'],
  ['background', 'style-background'],
  ['fontSize', 'style-fontsize'],
  ['padding', 'style-padding'],
  ['radius', 'style-radius'],
  // v2.21 paint widening — every key styleDecls honors crosses the bridge,
  // or the AI round-trip silently strips the owner's styling.
  ['fontWeight', 'style-fontweight'],
  ['margin', 'style-margin'],
  ['border', 'style-border'],
  ['borderColor', 'style-bordercolor'],
  ['shadow', 'style-shadow'],
  // hideOn predates this list and was never bridged: a page that round-tripped
  // through .pzn (every AI edit) lost its per-device visibility. Real bug.
  ['hideOn', 'style-hideon']
];

function styleToProps(data, props) {
  const s = data?.style;
  if (!s || typeof s !== 'object') return;
  for (const [key, attr] of STYLE_KEYS) {
    if (s[key] !== undefined && s[key] !== null && s[key] !== '') props[attr] = s[key];
  }
}

function propsToStyle(props, data) {
  const style = {};
  for (const [key, attr] of STYLE_KEYS) {
    if (props[attr] !== undefined && props[attr] !== '') style[key] = props[attr];
  }
  if (Object.keys(style).length) data.style = style;
}

function baseOpts(block, props, extra = {}) {
  const opts = { props, ...extra };
  if (block.id) opts.id = block.id;
  if (block.data?.className) opts.className = block.data.className;
  // animate is universal (v1.97) — carried for EVERY type, like className;
  // the per-case pickProps lists that already name it simply win the tie
  if (block.data?.animate !== undefined && props.animate === undefined) {
    props.animate = block.data.animate;
  }
  styleToProps(block.data, props);
  return opts;
}

/**
 * @param {object} block  { type, id?, data }
 */
function blockToModuleInner(block) {
  if (!block || !block.type) return null;
  const type = block.type;
  const data = block.data || {};

  switch (type) {
    case 'heading':
      return createModule('heading', baseOpts(block, pickProps(data, ['level', 'align', 'animate']), {
        text: data.text || ''
      }));

    case 'text': {
      const props = pickProps(data, ['align', 'size', 'lead', 'dropcap', 'animate']);
      if (data.maxWidth !== undefined) props.maxwidth = data.maxWidth;
      return createModule('text', baseOpts(block, props, { text: data.content || '' }));
    }

    case 'button': {
      const props = pickProps(data, ['variant', 'align', 'rel', 'target', 'title']);
      if (data.url !== undefined) props.href = data.url;
      return createModule('button', baseOpts(block, props, { text: data.text || '' }));
    }

    case 'quote':
      return createModule('quote', baseOpts(block, pickProps(data, ['author']), {
        text: data.text || ''
      }));

    case 'testimonial':
      return createModule('testimonial', baseOpts(block, pickProps(data, ['author', 'role']), {
        text: data.quote || ''
      }));

    case 'list': {
      const children = (data.items || []).map((item) =>
        createModule('item', {
          text: typeof item === 'string' ? item : item.text || ''
        })
      );
      return createModule('list', baseOpts(block, pickProps(data, ['ordered']), { children }));
    }

    case 'features': {
      const children = (data.items || []).map((item) =>
        createModule('feature', {
          props: pickProps(item || {}, ['title', 'icon']),
          text: (item && item.description) || ''
        })
      );
      return createModule('features', baseOpts(block, pickProps(data, ['columns']), { children }));
    }

    case 'article-list':
      return createModule('article-list', baseOpts(block, pickProps(data, ['tag', 'limit', 'columns'])));

    case 'image':
      return createModule('image', baseOpts(block, pickProps(data, ['src', 'alt', 'title', 'caption', 'width'])));

    case 'gallery': {
      const children = (data.images || []).map((img) =>
        createModule('image', {
          props: typeof img === 'string'
            ? { src: img }
            : pickProps(img, ['src', 'alt', 'caption'])
        })
      );
      return createModule('gallery', baseOpts(block, pickProps(data, ['columns']), { children }));
    }

    case 'embed':
      return createModule('embed', baseOpts(block, pickProps(data, ['url'])));

    case 'columns': {
      // width (v2.26) is the ROW's breakout (content|wide|full); a col's own
      // width prop below is the cell's share — two different knobs
      const props = pickProps(data, ['gap', 'collapse', 'valign', 'width']);
      if (data.ratio !== undefined) {
        props.ratio = Array.isArray(data.ratio) ? data.ratio.join(':') : String(data.ratio);
      }
      let cols = [];
      if (Array.isArray(data.columns)) {
        cols = data.columns.map((c) => {
          const colOpts = {
            children: ((c && c.blocks) || []).map(blockToModule).filter(Boolean)
          };
          if (c && c.width !== undefined) colOpts.props = { width: c.width };
          if (c && c.id) colOpts.id = c.id;
          return createModule('col', colOpts);
        });
      } else if (Array.isArray(data.children)) {
        cols = data.children.map((blocks) =>
          createModule('col', {
            children: (blocks || []).map(blockToModule).filter(Boolean)
          })
        );
      }
      return createModule('columns', baseOpts(block, props, { children: cols }));
    }

    case 'spacer':
      return createModule('spacer', baseOpts(block, pickProps(data, ['height', 'size'])));

    case 'divider': {
      const props = pickProps(data, ['style']);
      if (data.bentStyle !== undefined) props.bentstyle = data.bentStyle;
      return createModule('divider', baseOpts(block, props));
    }

    case 'card':
      return createModule('card', baseOpts(block, {}, {
        children: (data.blocks || []).map(blockToModule).filter(Boolean)
      }));

    case 'section':
      return createModule('section', baseOpts(block, pickProps(data, ['size', 'width']), {
        children: (data.blocks || []).map(blockToModule).filter(Boolean)
      }));

    case 'map':
      return createModule('map', baseOpts(block, pickProps(data, ['address', 'zoom', 'height'])));

    case 'cta': {
      const props = pickProps(data, ['title', 'url', 'variant', 'tone', 'align']);
      if (data.buttonText !== undefined) props.buttontext = data.buttonText;
      return createModule('cta', baseOpts(block, props, { text: data.text || '' }));
    }

    case 'stats': {
      const children = (data.items || []).map((item) =>
        createModule('stat', { props: pickProps(item || {}, ['value', 'label']) })
      );
      return createModule('stats', baseOpts(block, pickProps(data, ['columns']), { children }));
    }

    case 'logos': {
      const children = (data.items || []).map((item) =>
        createModule('logo', { props: pickProps(item || {}, ['src', 'alt', 'url']) })
      );
      return createModule('logos', baseOpts(block, {}, { children }));
    }

    case 'social': {
      const children = (data.items || []).map((item) =>
        createModule('handle', {
          props: pickProps(item || {}, ['network', 'url', 'label']),
          text: (item && item.label) || ''
        })
      );
      return createModule('social', baseOpts(block, {}, { children }));
    }

    case 'faq': {
      const children = (data.items || []).map((item) =>
        createModule('qa', {
          props: pickProps(item || {}, ['question']),
          text: (item && item.answer) || ''
        })
      );
      return createModule('faq', baseOpts(block, {}, { children }));
    }

    case 'tabs': {
      const children = (data.items || []).map((item) =>
        createModule('tab', {
          props: pickProps(item || {}, ['label']),
          text: (item && item.content) || ''
        })
      );
      return createModule('tabs', baseOpts(block, {}, { children }));
    }

    case 'accordion': {
      const children = (data.items || []).map((item) =>
        createModule('fold', {
          props: pickProps(item || {}, ['title']),
          text: (item && item.content) || ''
        })
      );
      return createModule('accordion', baseOpts(block, {}, { children }));
    }

    case 'form': {
      const children = (data.fields || []).map((f) =>
        createModule('field', {
          props: pickProps(f || {}, ['label', 'name', 'type', 'placeholder', 'required', 'options'])
        })
      );
      return createModule('form', baseOpts(block, pickProps(data, ['action', 'method', 'submit']), { children }));
    }

    case 'products': {
      const children = (data.items || []).map((it) =>
        createModule('product', {
          props: pickProps(it || {}, ['title', 'price', 'image', 'url'])
        })
      );
      return createModule('products', baseOpts(block, pickProps(data, ['columns']), { children }));
    }

    case 'cards': {
      const children = (data.items || []).map((it) =>
        createModule('mediacard', {
          props: pickProps(it || {}, ['image', 'tag', 'title', 'excerpt', 'href'])
        })
      );
      return createModule('cards', baseOpts(block, {}, { children }));
    }

    case 'pricing': {
      const children = (data.items || []).map((it) =>
        createModule('plan', {
          props: pickProps(it || {}, ['title', 'price', 'period', 'features', 'ctaLabel', 'ctaUrl', 'highlighted'])
        })
      );
      return createModule('pricing', baseOpts(block, {}, { children }));
    }

    case 'steps': {
      const children = (data.items || []).map((it) =>
        createModule('step', {
          props: pickProps(it || {}, ['title', 'icon']),
          text: (it && it.text) || ''
        })
      );
      return createModule('steps', baseOpts(block, {}, { children }));
    }

    case 'crumbs': {
      const children = (data.items || []).map((it) =>
        createModule('crumb', {
          props: pickProps(it || {}, ['label', 'url'])
        })
      );
      return createModule('crumbs', baseOpts(block, {}, { children }));
    }

    case 'team': {
      const children = (data.items || []).map((it) =>
        createModule('member', {
          props: pickProps(it || {}, ['name', 'role', 'image', 'url']),
          text: (it && it.bio) || ''
        })
      );
      return createModule('team', baseOpts(block, {}, { children }));
    }

    case 'countdown': {
      return createModule('countdown', baseOpts(block, pickProps(data, ['target', 'done']), { text: data.label || '' }));
    }

    case 'pricelist': {
      const children = (data.items || []).map((it) =>
        createModule('priceitem', {
          props: pickProps(it || {}, ['name', 'price']),
          text: (it && it.desc) || ''
        })
      );
      return createModule('pricelist', baseOpts(block, {}, { children }));
    }

    case 'progress': {
      const children = (data.items || []).map((it) =>
        createModule('bar', {
          props: pickProps(it || {}, ['value', 'color']),
          text: (it && it.label) || ''
        })
      );
      return createModule('progress', baseOpts(block, {}, { children }));
    }

    case 'rating':
      return createModule('rating', baseOpts(block, pickProps(data, ['value', 'max']), { text: data.text || '' }));

    case 'hours': {
      const children = (data.items || []).map((it) =>
        createModule('day', {
          props: { name: (it && it.day) || '' },
          text: (it && it.hours) || ''
        })
      );
      return createModule('hours', baseOpts(block, {}, { children }));
    }

    case 'toc': {
      const children = (data.items || []).map((it) =>
        createModule('tocitem', {
          props: pickProps(it || {}, ['anchor']),
          text: (it && it.label) || ''
        })
      );
      return createModule('toc', baseOpts(block, pickProps(data, ['title']), { children }));
    }

    case 'author':
      return createModule('author', baseOpts(block, pickProps(data, ['name', 'image', 'url', 'linkLabel', 'role', 'time']), { text: data.bio || '' }));

    case 'compare':
      return createModule('compare', baseOpts(block, pickProps(data, ['before', 'after', 'beforeLabel', 'afterLabel'])));

    case 'flipbox': {
      const props = pickProps(data, ['title', 'icon']);
      if (data.buttonText) props.cta = data.buttonText;
      if (data.buttonUrl) props.url = data.buttonUrl;
      return createModule('flipbox', baseOpts(block, props, { text: data.backText || '' }));
    }

    case 'header':
      return createModule('header', baseOpts(block, pickProps(data, ['tone', 'layout']), {
        children: (data.blocks || []).map(blockToModule).filter(Boolean)
      }));

    case 'footer':
      return createModule('footer', baseOpts(block, pickProps(data, ['tone', 'credit']), {
        children: (data.blocks || []).map(blockToModule).filter(Boolean)
      }));

    case 'whatsapp':
      return createModule('whatsapp', baseOpts(block, pickProps(data, ['phone', 'message', 'note', 'url', 'align']), {
        text: data.label || ''
      }));

    case 'timeline': {
      const children = (data.items || []).map((it) =>
        createModule('event', {
          props: pickProps(it || {}, ['time', 'title', 'image']),
          text: (it && it.text) || ''
        })
      );
      return createModule('timeline', baseOpts(block, {}, { children }));
    }

    case 'carousel': {
      const children = (data.items || []).map((it) =>
        createModule('slide', {
          props: pickProps(it || {}, ['image', 'tag', 'title', 'excerpt', 'href'])
        })
      );
      return createModule('carousel', baseOpts(block, pickProps(data, ['height', 'peek']), { children }));
    }

    // the store (v2.53)
    case 'shop':
      return createModule('shop', baseOpts(block, pickProps(data, ['shelf', 'columns', 'limit', 'sort', 'filter', 'title', 'exclude', 'buttons'])));
    case 'buy':
      return createModule('buy', baseOpts(block, pickProps(data, ['sku', 'gallery', 'description'])));
    case 'cart':
      return createModule('cart', baseOpts(block, pickProps(data, ['empty'])));
    case 'checkout':
      return createModule('checkout', baseOpts(block, {}));
    case 'order':
      return createModule('order', baseOpts(block, {}));

    case 'search':
      return createModule('search', baseOpts(block, pickProps(data, ['placeholder', 'action', 'name', 'submit', 'method'])));

    case 'newsletter':
      return createModule('newsletter', baseOpts(block, pickProps(data, ['title', 'placeholder', 'submit', 'action']), {
        text: data.text || ''
      }));

    case 'pager': {
      const children = (data.items || []).map((it) =>
        createModule('page', {
          props: pickProps(it || {}, ['label', 'url', 'current'])
        })
      );
      return createModule('pager', baseOpts(block, pickProps(data, ['label']), { children }));
    }

    case 'consent':
      return createModule('consent', baseOpts(block, pickProps(data, ['accept', 'reject', 'policy', 'policyLabel']), {
        text: data.text || data.content || ''
      }));

    case 'related': {
      const children = (data.items || []).map((it) =>
        createModule('relcard', {
          props: pickProps(it || {}, ['image', 'tag', 'title', 'excerpt', 'href'])
        })
      );
      return createModule('related', baseOpts(block, pickProps(data, ['title']), { children }));
    }

    case 'comments': {
      const children = (data.items || []).map((it) =>
        createModule('comment', {
          props: pickProps(it || {}, ['author', 'time']),
          text: (it && it.text) || ''
        })
      );
      return createModule('comments', baseOpts(block, pickProps(data, ['title']), { children }));
    }

    case 'slot':
      return createModule('slot', baseOpts(block, pickProps(data, ['label', 'src', 'url', 'advertiser'])));

    case 'auth':
      return createModule('auth', baseOpts(block, pickProps(data, ['login', 'loginurl', 'register', 'registerurl']), {
        text: data.text || ''
      }));

    case 'code':
      return createModule('code', baseOpts(block, pickProps(data, ['lang', 'source'])));

    case 'tags': {
      const children = (data.items || []).map((it) =>
        createModule('tag', {
          props: pickProps(it || {}, ['url']),
          text: (it && it.label) || ''
        })
      );
      return createModule('tags', baseOpts(block, pickProps(data, ['label']), { children }));
    }

    case 'nav': {
      const children = (data.items || []).map((it) =>
        createModule('navitem', {
          props: pickProps(it || {}, ['label', 'href'])
        })
      );
      return createModule('nav', baseOpts(block, pickProps(data, ['background', 'color', 'align']), { children }));
    }

    case 'ticker': {
      const children = (data.items || []).map((it) =>
        createModule('tickeritem', {
          props: pickProps(it || {}, ['text', 'href'])
        })
      );
      return createModule('ticker', baseOpts(block, pickProps(data, ['label', 'speed', 'background', 'color']), { children }));
    }
    case 'newspop': {
      const children = (data.items || []).map((it) =>
        createModule('newspopitem', {
          props: pickProps(it || {}, ['time', 'text', 'href'])
        })
      );
      return createModule('newspop', baseOpts(block, pickProps(data, ['label']), { children }));
    }

    case 'video':
      return createModule('video', baseOpts(block, pickProps(data, ['src', 'poster', 'caption', 'controls', 'autoplay', 'loop', 'muted'])));

    case 'audio':
      return createModule('audio', baseOpts(block, pickProps(data, ['src', 'caption', 'loop'])));

    case 'table': {
      const children = (data.rows || []).map((r) =>
        createModule('trow', { text: typeof r === 'string' ? r : (r && r.cells) || '' })
      );
      return createModule('table', baseOpts(block, pickProps(data, ['header']), { children }));
    }

    case 'category':
      return createModule('category', baseOpts(block, pickProps(data, ['slug', 'limit', 'showheader'])));

    case 'contact-info':
      return createModule('contact-info', baseOpts(block, pickProps(data, ['phone', 'email', 'address', 'hours'])));

    case 'banner':
      return createModule('banner', baseOpts(block, pickProps(data, ['tone', 'align']), {
        text: data.text || ''
      }));

    case 'marquee':
      return createModule('marquee', baseOpts(block, pickProps(data, ['speed']), {
        text: data.text || ''
      }));

    case 'parallax':
      // tint/fade were registry params the bridge never carried — every save
      // through the file dropped them (v2.56, found wiring width)
      return createModule('parallax', baseOpts(block, pickProps(data, ['image', 'overlay', 'height', 'tint', 'fade', 'width']), {
        children: (data.blocks || []).map(blockToModule).filter(Boolean)
      }));

    case 'hero': {
      const props = pickProps(data, ['image', 'height', 'overlay', 'parallax', 'width']);
      // v2.38: the authored children, with the builder form's edits applied
      // (src/pzn/hero-children.js); a hero without them keeps the old trio
      const authored = heroChildren(data);
      if (authored) {
        return createModule('hero', baseOpts(block, props, { children: authored.map(blockToModule).filter(Boolean) }));
      }
      const children = [];
      if (data.title) {
        children.push(createModule('heading', { props: { level: 1 }, text: data.title }));
      }
      if (data.subtitle) {
        children.push(createModule('text', { text: data.subtitle }));
      }
      if (data.buttonText) {
        const btnProps = {};
        if (data.buttonUrl !== undefined) btnProps.href = data.buttonUrl;
        children.push(createModule('button', { props: btnProps, text: data.buttonText }));
      }
      return createModule('hero', baseOpts(block, props, { children }));
    }

    case 'html':
      return createModule('html', baseOpts(block, pickProps(data, ['content', 'provisional', 'note'])));

    default:
      // unknown block type — stash losslessly inside a section
      return createModule('section', baseOpts(block, { kind: type }, {
        text: JSON.stringify(data)
      }));
  }
}

// ─── Reverse: benTML AST → Tapuz JSON ──────────────────────────────

function toTapuzPage(doc) {
  const page = {
    title: doc.title || '',
    slug: doc.slug || '',
    direction: doc.dir || require('../../site-language').siteDirection(),
    lang: doc.lang || require('../../site-language').siteLanguage(),
    tags: (doc.tags || []).slice(),
    meta: {},
    blocks: (doc.body || []).map(moduleToBlock).filter(Boolean)
  };
  if (doc.meta?.teaser) page.meta.teaser = doc.meta.teaser;
  if (doc.meta?.cardImage) page.meta.cardImage = doc.meta.cardImage;
  return page;
}

/**
 * Copy `keys` from props → data, applying reverse renames, skipping undefined.
 */
function pickData(props, keys, renames = {}) {
  const data = {};
  for (const key of keys) {
    if (props[key] !== undefined) data[renames[key] || key] = props[key];
  }
  return data;
}

function finishBlock(node, type, data) {
  if (node.className) data.className = node.className;
  // the universal animate crosses back too (v1.97), for every type
  const anim = node.props && node.props.animate;
  if (anim !== undefined && anim !== 'none' && data.animate === undefined) {
    data.animate = anim;
  }
  propsToStyle(node.props || {}, data);
  const block = { type, data };
  if (node.id) block.id = node.id;
  return block;
}

/**
 * @param {object} node module AST node
 * @returns {object|null} Tapuz JSON block { type, id?, data }
 */
function moduleToBlockInner(node) {
  if (!node || !node.name) return null;
  const props = node.props || {};

  switch (node.name) {
    case 'heading': {
      const data = pickData(props, ['level', 'align', 'animate']);
      if (node.text) data.text = node.text;
      return finishBlock(node, 'heading', data);
    }

    case 'text': {
      const data = pickData(props, ['align', 'size', 'lead', 'dropcap', 'animate']);
      if (props.maxwidth !== undefined) data.maxWidth = props.maxwidth;
      if (node.text) data.content = node.text;
      return finishBlock(node, 'text', data);
    }

    case 'button': {
      const data = pickData(props, ['variant', 'align', 'rel', 'target', 'title']);
      if (props.href !== undefined) data.url = props.href;
      if (node.text) data.text = node.text;
      return finishBlock(node, 'button', data);
    }

    case 'quote': {
      const data = pickData(props, ['author']);
      if (node.text) data.text = node.text;
      return finishBlock(node, 'quote', data);
    }

    case 'testimonial': {
      const data = pickData(props, ['author', 'role']);
      if (node.text) data.quote = node.text;
      return finishBlock(node, 'testimonial', data);
    }

    case 'item':
      // handled inside list; a stray top-level item becomes a text block
      return finishBlock(node, 'text', node.text ? { content: node.text } : {});

    case 'list': {
      const data = pickData(props, ['ordered']);
      data.items = (node.children || [])
        .filter((c) => c.name === 'item')
        .map((c) => ({ text: c.text || '' }));
      return finishBlock(node, 'list', data);
    }

    case 'features': {
      const data = pickData(props, ['columns']);
      data.items = (node.children || [])
        .filter((c) => c.name === 'feature')
        .map((c) => {
          const item = pickData(c.props || {}, ['title', 'icon']);
          if (c.text) item.description = c.text;
          return item;
        });
      return finishBlock(node, 'features', data);
    }

    case 'article-list':
      return finishBlock(node, 'article-list', pickData(props, ['tag', 'limit', 'columns']));

    case 'image':
      return finishBlock(node, 'image', pickData(props, ['src', 'alt', 'title', 'caption', 'width']));

    case 'gallery': {
      const data = pickData(props, ['columns']);
      data.images = (node.children || [])
        .filter((c) => c.name === 'image')
        .map((c) => pickData(c.props || {}, ['src', 'alt', 'caption']));
      return finishBlock(node, 'gallery', data);
    }

    case 'embed':
      return finishBlock(node, 'embed', pickData(props, ['url']));

    case 'columns': {
      const data = pickData(props, ['gap', 'collapse', 'valign', 'ratio', 'width']);
      data.columns = (node.children || [])
        .filter((c) => c.name === 'col')
        .map((c) => {
          const col = { blocks: (c.children || []).map(moduleToBlock).filter(Boolean) };
          if (c.props?.width !== undefined) col.width = c.props.width;
          if (c.id) col.id = c.id;
          return col;
        });
      return finishBlock(node, 'columns', data);
    }

    case 'col':
      // a stray top-level col becomes a card of its children
      return finishBlock(node, 'card', {
        blocks: (node.children || []).map(moduleToBlock).filter(Boolean)
      });

    case 'spacer':
      return finishBlock(node, 'spacer', pickData(props, ['height', 'size']));

    case 'divider': {
      const data = pickData(props, ['style']);
      if (props.bentstyle !== undefined) data.bentStyle = props.bentstyle;
      return finishBlock(node, 'divider', data);
    }

    case 'card':
      return finishBlock(node, 'card', {
        blocks: (node.children || []).map(moduleToBlock).filter(Boolean)
      });

    case 'map':
      return finishBlock(node, 'map', pickData(props, ['address', 'zoom', 'height']));

    case 'cta': {
      const data = pickData(props, ['title', 'url', 'variant', 'tone', 'align']);
      if (props.buttontext !== undefined) data.buttonText = props.buttontext;
      if (node.text) data.text = node.text;
      return finishBlock(node, 'cta', data);
    }

    case 'stats': {
      const data = pickData(props, ['columns']);
      data.items = (node.children || [])
        .filter((c) => c.name === 'stat')
        .map((c) => pickData(c.props || {}, ['value', 'label']));
      return finishBlock(node, 'stats', data);
    }

    case 'logos': {
      const data = {};
      data.items = (node.children || [])
        .filter((c) => c.name === 'logo')
        .map((c) => pickData(c.props || {}, ['src', 'alt', 'url']));
      return finishBlock(node, 'logos', data);
    }

    case 'social': {
      const data = {};
      data.items = (node.children || [])
        .filter((c) => c.name === 'handle')
        .map((c) => {
          const item = pickData(c.props || {}, ['network', 'url', 'label']);
          if (!item.label && c.text) item.label = c.text;
          return item;
        });
      return finishBlock(node, 'social', data);
    }

    case 'faq': {
      const data = {};
      data.items = (node.children || [])
        .filter((c) => c.name === 'qa')
        .map((c) => {
          const item = pickData(c.props || {}, ['question']);
          if (c.text) item.answer = c.text;
          return item;
        });
      return finishBlock(node, 'faq', data);
    }

    case 'tabs': {
      const data = {};
      data.items = (node.children || [])
        .filter((c) => c.name === 'tab')
        .map((c) => {
          const item = pickData(c.props || {}, ['label']);
          if (c.text) item.content = c.text;
          return item;
        });
      return finishBlock(node, 'tabs', data);
    }

    case 'accordion': {
      const data = {};
      data.items = (node.children || [])
        .filter((c) => c.name === 'fold')
        .map((c) => {
          const item = pickData(c.props || {}, ['title']);
          if (c.text) item.content = c.text;
          return item;
        });
      return finishBlock(node, 'accordion', data);
    }

    case 'form': {
      const data = pickData(props, ['action', 'method', 'submit']);
      data.fields = (node.children || [])
        .filter((c) => c.name === 'field')
        .map((c) => pickData(c.props || {}, ['label', 'name', 'type', 'placeholder', 'required', 'options']));
      return finishBlock(node, 'form', data);
    }

    case 'products': {
      const data = pickData(props, ['columns']);
      data.items = (node.children || [])
        .filter((c) => c.name === 'product')
        .map((c) => pickData(c.props || {}, ['title', 'price', 'image', 'url']));
      return finishBlock(node, 'products', data);
    }

    case 'product':
      return null;

    case 'cards': {
      const data = {};
      data.items = (node.children || [])
        .filter((c) => c.name === 'mediacard')
        .map((c) => pickData(c.props || {}, ['image', 'tag', 'title', 'excerpt', 'href']));
      return finishBlock(node, 'cards', data);
    }

    case 'pricing': {
      const data = {};
      data.items = (node.children || [])
        .filter((c) => c.name === 'plan')
        .map((c) => pickData(c.props || {}, ['title', 'price', 'period', 'features', 'ctaLabel', 'ctaUrl', 'highlighted']));
      return finishBlock(node, 'pricing', data);
    }

    case 'steps': {
      const data = {};
      data.items = (node.children || [])
        .filter((c) => c.name === 'step')
        .map((c) => {
          const item = pickData(c.props || {}, ['title', 'icon']);
          if (c.text) item.text = c.text;
          return item;
        });
      return finishBlock(node, 'steps', data);
    }

    case 'crumbs': {
      const data = {};
      data.items = (node.children || [])
        .filter((c) => c.name === 'crumb')
        .map((c) => {
          const item = pickData(c.props || {}, ['label', 'url']);
          if (!item.url) delete item.url;
          return item;
        });
      return finishBlock(node, 'crumbs', data);
    }

    case 'team': {
      const data = {};
      data.items = (node.children || [])
        .filter((c) => c.name === 'member')
        .map((c) => {
          const item = pickData(c.props || {}, ['name', 'role', 'image', 'url']);
          if (c.text) item.bio = c.text;
          return item;
        });
      return finishBlock(node, 'team', data);
    }

    case 'countdown': {
      const data = pickData(props, ['target', 'done']);
      if (node.text) data.label = node.text;
      return finishBlock(node, 'countdown', data);
    }

    case 'pricelist': {
      const data = {};
      data.items = (node.children || [])
        .filter((c) => c.name === 'priceitem')
        .map((c) => {
          const item = pickData(c.props || {}, ['name', 'price']);
          if (c.text) item.desc = c.text;
          return item;
        });
      return finishBlock(node, 'pricelist', data);
    }

    case 'progress': {
      const data = {};
      data.items = (node.children || [])
        .filter((c) => c.name === 'bar')
        .map((c) => {
          const item = pickData(c.props || {}, ['value', 'color']);
          item.label = c.text || '';
          return item;
        });
      return finishBlock(node, 'progress', data);
    }

    case 'rating': {
      const data = pickData(props, ['value', 'max']);
      if (node.text) data.text = node.text;
      return finishBlock(node, 'rating', data);
    }

    case 'hours': {
      const data = {};
      data.items = (node.children || [])
        .filter((c) => c.name === 'day')
        .map((c) => ({ day: (c.props && c.props.name) || '', hours: c.text || '' }));
      return finishBlock(node, 'hours', data);
    }

    case 'toc': {
      const data = pickData(props, ['title']);
      data.items = (node.children || [])
        .filter((c) => c.name === 'tocitem')
        .map((c) => {
          const item = pickData(c.props || {}, ['anchor']);
          item.label = c.text || '';
          return item;
        });
      return finishBlock(node, 'toc', data);
    }

    case 'author': {
      const data = pickData(props, ['name', 'image', 'url', 'linkLabel', 'role', 'time']);
      if (node.text) data.bio = node.text;
      return finishBlock(node, 'author', data);
    }

    case 'compare':
      return finishBlock(node, 'compare', pickData(props, ['before', 'after', 'beforeLabel', 'afterLabel']));

    case 'flipbox': {
      const data = pickData(props, ['title', 'icon']);
      if (props.cta) data.buttonText = props.cta;
      if (props.url) data.buttonUrl = props.url;
      if (node.text) data.backText = node.text;
      return finishBlock(node, 'flipbox', data);
    }

    case 'header': {
      const data = pickData(props, ['tone', 'layout']);
      data.blocks = (node.children || []).map(moduleToBlock).filter(Boolean);
      return finishBlock(node, 'header', data);
    }

    case 'footer': {
      const data = pickData(props, ['tone', 'credit']);
      data.blocks = (node.children || []).map(moduleToBlock).filter(Boolean);
      return finishBlock(node, 'footer', data);
    }

    case 'whatsapp': {
      const data = pickData(props, ['phone', 'message', 'note', 'url', 'align']);
      if (node.text) data.label = node.text;
      return finishBlock(node, 'whatsapp', data);
    }

    case 'timeline': {
      const data = {};
      data.items = (node.children || [])
        .filter((c) => c.name === 'event')
        .map((c) => {
          const item = pickData(c.props || {}, ['time', 'title', 'image']);
          if (c.text) item.text = c.text;
          return item;
        });
      return finishBlock(node, 'timeline', data);
    }

    case 'carousel': {
      const data = pickData(props, ['height', 'peek']);
      data.items = (node.children || [])
        .filter((c) => c.name === 'slide')
        .map((c) => pickData(c.props || {}, ['image', 'tag', 'title', 'excerpt', 'href']));
      return finishBlock(node, 'carousel', data);
    }

    // the store (v2.53)
    case 'shop':
      return finishBlock(node, 'shop', pickData(props, ['shelf', 'columns', 'limit', 'sort', 'filter', 'title', 'exclude', 'buttons']));
    case 'buy':
      return finishBlock(node, 'buy', pickData(props, ['sku', 'gallery', 'description']));
    case 'cart':
      return finishBlock(node, 'cart', pickData(props, ['empty']));
    case 'checkout':
      return finishBlock(node, 'checkout', {});
    case 'order':
      return finishBlock(node, 'order', {});

    case 'search':
      return finishBlock(node, 'search', pickData(props, ['placeholder', 'action', 'name', 'submit', 'method']));

    case 'newsletter': {
      const data = pickData(props, ['title', 'placeholder', 'submit', 'action']);
      if (node.text) data.text = node.text;
      return finishBlock(node, 'newsletter', data);
    }

    case 'pager': {
      const data = pickData(props, ['label']);
      data.items = (node.children || [])
        .filter((c) => c.name === 'page')
        .map((c) => {
          const it = pickData(c.props || {}, ['label', 'url', 'current']);
          if (!it.url) delete it.url;
          if (!it.current) delete it.current;
          return it;
        });
      return finishBlock(node, 'pager', data);
    }

    case 'page':
      return null;

    case 'consent': {
      const data = pickData(props, ['accept', 'reject', 'policy', 'policyLabel']);
      if (node.text) data.text = node.text;
      return finishBlock(node, 'consent', data);
    }

    case 'related': {
      const data = pickData(props, ['title']);
      data.items = (node.children || [])
        .filter((c) => c.name === 'relcard')
        .map((c) => {
          const it = pickData(c.props || {}, ['image', 'tag', 'title', 'excerpt', 'href']);
          if (c.text && !it.excerpt) it.excerpt = c.text;
          return it;
        });
      return finishBlock(node, 'related', data);
    }

    case 'relcard':
      return null;

    case 'comments': {
      const data = pickData(props, ['title']);
      data.items = (node.children || [])
        .filter((c) => c.name === 'comment')
        .map((c) => {
          const it = pickData(c.props || {}, ['author', 'time']);
          if (c.text) it.text = c.text;
          return it;
        });
      return finishBlock(node, 'comments', data);
    }

    case 'comment':
      return null;

    case 'slot':
      return finishBlock(node, 'slot', pickData(props, ['label', 'src', 'url', 'advertiser']));

    case 'auth': {
      const data = pickData(props, ['login', 'loginurl', 'register', 'registerurl']);
      if (node.text) data.text = node.text;
      return finishBlock(node, 'auth', data);
    }

    case 'code':
      return finishBlock(node, 'code', pickData(props, ['lang', 'source']));

    case 'tags': {
      const data = pickData(props, ['label']);
      data.items = (node.children || [])
        .filter((c) => c.name === 'tag')
        .map((c) => {
          const it = pickData(c.props || {}, ['url']);
          it.label = c.text || it.label || '';
          return it;
        });
      return finishBlock(node, 'tags', data);
    }

    case 'tag':
      return null;

    case 'nav': {
      const data = pickData(props, ['background', 'color', 'align']);
      data.items = (node.children || [])
        .filter((c) => c.name === 'navitem')
        .map((c) => pickData(c.props || {}, ['label', 'href']));
      return finishBlock(node, 'nav', data);
    }

    case 'ticker': {
      const data = pickData(props, ['label', 'speed', 'background', 'color']);
      data.items = (node.children || [])
        .filter((c) => c.name === 'tickeritem')
        .map((c) => pickData(c.props || {}, ['text', 'href']));
      return finishBlock(node, 'ticker', data);
    }
    case 'newspop': {
      const data = pickData(props, ['label']);
      data.items = (node.children || [])
        .filter((c) => c.name === 'newspopitem')
        .map((c) => pickData(c.props || {}, ['time', 'text', 'href']));
      return finishBlock(node, 'newspop', data);
    }

    case 'video':
      return finishBlock(node, 'video', pickData(props, ['src', 'poster', 'caption', 'controls', 'autoplay', 'loop', 'muted']));

    case 'audio':
      return finishBlock(node, 'audio', pickData(props, ['src', 'caption', 'loop']));

    case 'table': {
      const data = pickData(props, ['header']);
      data.rows = (node.children || [])
        .filter((c) => c.name === 'trow')
        .map((c) => ({ cells: c.text || '' }));
      return finishBlock(node, 'table', data);
    }

    case 'category':
      return finishBlock(node, 'category', pickData(props, ['slug', 'limit', 'showheader']));

    case 'contact-info':
      return finishBlock(node, 'contact-info', pickData(props, ['phone', 'email', 'address', 'hours']));

    case 'banner': {
      const data = pickData(props, ['tone', 'align']);
      if (node.text) data.text = node.text;
      return finishBlock(node, 'banner', data);
    }

    case 'marquee': {
      const data = pickData(props, ['speed']);
      if (node.text) data.text = node.text;
      return finishBlock(node, 'marquee', data);
    }

    case 'parallax': {
      const data = pickData(props, ['image', 'overlay', 'height', 'tint', 'fade', 'width']);
      data.blocks = (node.children || []).map(moduleToBlock).filter(Boolean);
      return finishBlock(node, 'parallax', data);
    }

    case 'hero': {
      const data = pickData(props, ['image', 'height', 'overlay', 'parallax', 'width']);
      for (const child of node.children || []) {
        if (child.name === 'heading' && data.title === undefined) {
          data.title = child.text || '';
        } else if (child.name === 'text' && data.subtitle === undefined) {
          data.subtitle = child.text || '';
        } else if (child.name === 'button' && data.buttonText === undefined) {
          data.buttonText = child.text || '';
          if (child.props?.href !== undefined) data.buttonUrl = child.props.href;
        }
      }
      // v2.38: every child as a block — ids, levels, aligns, extras, order —
      // beside the four fields the builder's hero form edits. Only when the
      // children say more than those fields: a plain trio (what a builder hero
      // serializes to) stays exactly the block it always was.
      if (!isPlainHeroTrio(node.children || [], data)) {
        const kids = (node.children || []).map(moduleToBlock).filter(Boolean);
        if (kids.length) data.blocks = kids;
      }
      return finishBlock(node, 'hero', data);
    }

    case 'section': {
      // unknown-type stash round-trips back to the original block
      const kind = props.kind;
      if (kind && kind !== 'content' && node.text) {
        try {
          const data = JSON.parse(node.text);
          const block = { type: kind, data };
          if (node.id) block.id = node.id;
          return block;
        } catch {
          /* fall through */
        }
      }
      // first-class section (v0.75 container-as-tool): size + children.
      // Generic sections authored in .pzn land here too — they ARE sections
      // now (pre-v0.75 they degraded to a card).
      const data = pickData(props, ['size', 'width']);
      data.blocks = (node.children || []).map(moduleToBlock).filter(Boolean);
      return finishBlock(node, 'section', data);
    }

    case 'html':
      return finishBlock(node, 'html', pickData(props, ['content', 'provisional', 'note']));

    default:
      // module with no Tapuz equivalent yet — preserve as unknown type
      return finishBlock(node, node.name, { ...(node.props || {}), ...(node.text ? { text: node.text } : {}) });
  }
}

/** True when a hero's children are exactly the heading/text/button the four
 *  flat fields rebuild (no ids, classes or other props, nothing more) — then
 *  the flat fields ARE the hero, and no data.blocks is stored. */
function isPlainHeroTrio(children, data) {
  const legacy = blockToModuleInner({ type: 'hero', data: {
    title: data.title, subtitle: data.subtitle, buttonText: data.buttonText, buttonUrl: data.buttonUrl
  } }).children;
  if (legacy.length !== children.length) return false;
  const norm = (props) => JSON.stringify(Object.keys(props || {}).sort().map((k) => [k, String(props[k])]));
  return children.every((c, i) => {
    const l = legacy[i];
    return c && l && c.name === l.name && !c.id && !c.className &&
      String(c.text || '') === String(l.text || '') && norm(c.props) === norm(l.props) &&
      !(c.children && c.children.length);
  });
}

// ── item ids across the block model (v2.37) ─────────────────────────────
// A container's leaves (cards → mediacard, faq → qa, pricing → plan, …) live
// in the block as plain data — `items` / `images` / `fields` / `rows` — and
// no case carried their ids. Any save through the builder, including the
// silent autosave before every copilot turn, rewrote the page without them.
// Seen live on the Bridge challenges: bridge-challenge-cards lost card_1…3
// between its creation and the copilot's read_page, so "keep every id" could
// not be kept. One pass per direction, aligned by position with the children
// the case produced — rather than an id line in each of 27 cases. A length
// mismatch (a case that filtered or merged children) carries nothing: never
// a wrong id on the wrong item.
const ITEM_ARRAYS = ['items', 'images', 'fields', 'rows'];

/** pzn node → block, with each accepted child's id kept on its item. */
function moduleToBlock(node) {
  const block = moduleToBlockInner(node);
  if (!block || !node || !Array.isArray(node.children) || !node.children.length) return block;
  const def = getModule(node.name);
  const accept = def && Array.isArray(def.accept) ? def.accept : [];
  if (!accept.length) return block;
  const kids = node.children.filter((c) => c && accept.includes(c.name));
  const data = block.data || {};
  for (const key of ITEM_ARRAYS) {
    const arr = data[key];
    if (!Array.isArray(arr) || arr.length !== kids.length) continue;
    arr.forEach((item, i) => {
      if (item && typeof item === 'object' && !Array.isArray(item) && kids[i].id && item.id === undefined) item.id = kids[i].id;
    });
    break;
  }
  return block;
}

/** block → pzn node, with each item's id back on its child module. */
function blockToModule(block) {
  const mod = blockToModuleInner(block);
  if (!mod || !Array.isArray(mod.children) || !mod.children.length) return mod;
  const data = (block && block.data) || {};
  for (const key of ITEM_ARRAYS) {
    const arr = data[key];
    if (!Array.isArray(arr) || arr.length !== mod.children.length) continue;
    arr.forEach((item, i) => {
      const child = mod.children[i];
      if (item && typeof item === 'object' && typeof item.id === 'string' && item.id && child && !child.id) child.id = item.id;
    });
    break;
  }
  return mod;
}

module.exports = { fromTapuzPage, blockToModule, toTapuzPage, moduleToBlock };
