'use strict';

const { createDocument, createModule } = require('../language/ast');
const { getModule } = require('../modules/registry');

/**
 * Bridge: Tapuz JSON blocks (D:\Dev\Tapuz style) → benTML document AST.
 * Lets us migrate without mixing runtimes.
 *
 * @param {{ title?: string, slug?: string, lang?: string, direction?: string, tags?: string[], meta?: object, blocks?: object[] }} page
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
 * @param {object} block  { type, id, data }
 */
function blockToModule(block) {
  if (!block || !block.type) return null;
  const type = block.type;
  const def = getModule(type);
  const id = block.id || '';
  const data = block.data || {};

  if (type === 'columns') {
    let cols = [];
    if (Array.isArray(data.columns)) {
      cols = data.columns.map((c) => {
        const width = c.width || '1/2';
        const kids = (c.blocks || []).map(blockToModule).filter(Boolean);
        return createModule('col', { props: { width }, children: kids, id: c.id || '' });
      });
    } else if (Array.isArray(data.children)) {
      cols = data.children.map((blocks) =>
        createModule('col', {
          props: { width: '1/2' },
          children: (blocks || []).map(blockToModule).filter(Boolean)
        })
      );
    }
    return createModule('columns', {
      id,
      props: { gap: data.gap || 'medium' },
      children: cols,
      className: data.className || ''
    });
  }

  if (type === 'list') {
    const items = (data.items || []).map((item, i) =>
      createModule('item', {
        id: `${id || 'list'}_i${i}`,
        text: typeof item === 'string' ? item : item.text || ''
      })
    );
    return createModule('list', {
      id,
      props: { ordered: !!data.ordered },
      children: items,
      className: data.className || ''
    });
  }

  if (type === 'gallery') {
    const images = (data.images || []).map((img, i) =>
      createModule('image', {
        id: `${id || 'gal'}_img${i}`,
        props: {
          src: typeof img === 'string' ? img : img.src || '',
          alt: typeof img === 'string' ? '' : img.alt || ''
        }
      })
    );
    return createModule('gallery', { id, children: images, className: data.className || '' });
  }

  if (type === 'hero') {
    const children = [];
    if (data.title) {
      children.push(createModule('heading', { props: { level: 1 }, text: data.title }));
    }
    if (data.subtitle) {
      children.push(createModule('text', { text: data.subtitle }));
    }
    if (data.buttonText) {
      children.push(
        createModule('button', {
          props: { href: data.buttonUrl || '#', variant: 'primary' },
          text: data.buttonText
        })
      );
    }
    return createModule('hero', { id, children, className: data.className || '' });
  }

  if (type === 'card' || type === 'features' || type === 'testimonial') {
    // best-effort mapping
    if (type === 'testimonial') {
      return createModule('quote', {
        id,
        props: { author: [data.author, data.role].filter(Boolean).join(', ') },
        text: data.quote || data.text || '',
        className: data.className || ''
      });
    }
    if (type === 'card') {
      return createModule('section', {
        id,
        props: { kind: 'card' },
        children: (data.blocks || []).map(blockToModule).filter(Boolean),
        className: data.className || 'card'
      });
    }
    // features → section of texts
    return createModule('section', {
      id,
      props: { kind: 'features' },
      children: (data.items || []).map((item, i) =>
        createModule('text', {
          id: `${id || 'feat'}_${i}`,
          text: typeof item === 'string' ? item : item.title || item.text || ''
        })
      ),
      className: data.className || ''
    });
  }

  // generic mapping via known prop names
  const props = {};
  let text = '';
  if (def) {
    for (const [key, schema] of Object.entries(def.props || {})) {
      if (key === 'id' || key === 'class') continue;
      if (schema.content) {
        text = data.text ?? data.content ?? data.title ?? '';
        continue;
      }
      if (data[key] !== undefined) props[key] = data[key];
    }
    // common aliases
    if (type === 'text' && data.content != null) text = data.content;
    if (type === 'heading' && data.text != null) text = data.text;
    if (type === 'button') {
      if (data.url != null) props.href = data.url;
      if (data.text != null) text = data.text;
    }
    if (type === 'image') {
      props.src = data.src || '';
      props.alt = data.alt || '';
      props.caption = data.caption || '';
      if (data.alignment) props.align = data.alignment;
    }
    if (type === 'embed' && data.url) props.url = data.url;
    if (type === 'article-list') {
      props.tag = data.tag || 'article';
      props.limit = data.limit || 6;
      props.columns = data.columns || 3;
    }
    if (type === 'spacer') props.height = data.height || '2rem';
    if (type === 'divider') props.style = data.style || 'solid';
    if (type === 'quote') {
      text = data.text || '';
      props.author = data.author || '';
    }
  } else {
    // unknown — stash as section kind
    return createModule('section', {
      id,
      props: { kind: type },
      text: JSON.stringify(data),
      className: data.className || ''
    });
  }

  return createModule(type, {
    id,
    props,
    text,
    className: data.className || '',
    children: []
  });
}

module.exports = { fromTapuzPage, blockToModule };
