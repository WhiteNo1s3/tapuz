'use strict';

const { createDocument, createModule } = require('../language/ast');
const { getModule } = require('../modules/registry');

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
    lang: page.lang || 'he',
    dir: page.direction || page.dir || 'rtl',
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
  ['radius', 'style-radius']
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
  styleToProps(block.data, props);
  return opts;
}

/**
 * @param {object} block  { type, id?, data }
 */
function blockToModule(block) {
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
      const props = pickProps(data, ['gap', 'collapse', 'valign']);
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
      return createModule('section', baseOpts(block, pickProps(data, ['size']), {
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

    case 'carousel': {
      const children = (data.items || []).map((it) =>
        createModule('slide', {
          props: pickProps(it || {}, ['image', 'tag', 'title', 'excerpt', 'href'])
        })
      );
      return createModule('carousel', baseOpts(block, pickProps(data, ['height', 'peek']), { children }));
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
      return createModule('parallax', baseOpts(block, pickProps(data, ['image', 'overlay', 'height']), {
        children: (data.blocks || []).map(blockToModule).filter(Boolean)
      }));

    case 'hero': {
      const props = pickProps(data, ['image', 'height', 'overlay', 'parallax']);
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
    direction: doc.dir || 'rtl',
    lang: doc.lang || 'he',
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
  propsToStyle(node.props || {}, data);
  const block = { type, data };
  if (node.id) block.id = node.id;
  return block;
}

/**
 * @param {object} node module AST node
 * @returns {object|null} Tapuz JSON block { type, id?, data }
 */
function moduleToBlock(node) {
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
      const data = pickData(props, ['gap', 'collapse', 'valign', 'ratio']);
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

    case 'carousel': {
      const data = pickData(props, ['height', 'peek']);
      data.items = (node.children || [])
        .filter((c) => c.name === 'slide')
        .map((c) => pickData(c.props || {}, ['image', 'tag', 'title', 'excerpt', 'href']));
      return finishBlock(node, 'carousel', data);
    }

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
      const data = pickData(props, ['image', 'overlay', 'height']);
      data.blocks = (node.children || []).map(moduleToBlock).filter(Boolean);
      return finishBlock(node, 'parallax', data);
    }

    case 'hero': {
      const data = pickData(props, ['image', 'height', 'overlay', 'parallax']);
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
      const data = pickData(props, ['size']);
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

module.exports = { fromTapuzPage, blockToModule, toTapuzPage, moduleToBlock };
