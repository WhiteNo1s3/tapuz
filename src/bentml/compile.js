'use strict';

const { parse } = require('./parse');
const { createBlock, isGeneratedBlockId } = require('../blocks');
const { BentmlError } = require('./errors');

/**
 * compile(source) → { page, blocks, warnings }
 * BenTML → Tapuz JSON block model (docs/bentml-v0.md §6.3).
 */

/**
 * @param {string} source
 * @returns {{ page: object, blocks: object[], warnings: object[], ast: object }}
 */
function compile(source) {
  const ast = parse(source);
  const warnings = [];
  const blocks = ast.body.map((node) => blockToJson(node, warnings)).filter(Boolean);

  const page = {
    title: ast.meta.title,
    slug: ast.meta.slug,
    direction: ast.meta.direction,
    theme: ast.meta.theme,
    status: ast.meta.status,
    tags: ast.meta.tags,
    lang: ast.meta.lang,
    meta: {
      description: ast.meta.description || '',
      ogImage: ast.meta.ogimage || '',
      author: ast.meta.author || '',
      date: ast.meta.date || '',
      teaser: '',
      cardImage: ''
    }
  };

  return { page, blocks, warnings, ast };
}

/**
 * @param {object} node
 * @param {object[]} warnings
 */
function blockToJson(node, warnings) {
  const p = (node.params || {});
  const block = buildBlock(node, warnings);
  // An `id:` param in storage-id shape restores block identity, so
  // decompile → compile keeps nested block ids stable (authored anchor
  // ids keep their §7.4 meaning and never look like storage ids).
  if (block && isGeneratedBlockId(p.id)) block.id = String(p.id);
  return block;
}

function buildBlock(node, warnings) {
  const p = node.params || {};
  const text = node.text || '';

  switch (node.name) {
    case 'HEADING': {
      const level = clampInt(p.level, 1, 6, 2);
      const data = { level, text: collapseSingleParagraph(text) };
      if (p.align && p.align !== 'start') data.align = p.align;
      if (p.animate && p.animate !== 'none') data.animate = p.animate;
      if (p.class) data.className = p.class;
      if (p.id && !isGeneratedBlockId(p.id)) data.id = p.id;
      return createBlock('heading', data);
    }
    case 'TEXT': {
      // single-line inline bodies keep the spaces inside `{ ... }` —
      // collapse them so round-trips don't grow padding each cycle
      const data = { content: text.includes('\n') ? text : collapseSingleParagraph(text) };
      if (p.align && p.align !== 'start') data.align = p.align;
      if (p.size && p.size !== 'md') data.size = p.size;
      if (p.lead === true || p.lead === 'true') data.lead = true;
      if (p.dropcap === true || p.dropcap === 'true') data.dropcap = true;
      if (p.maxwidth && p.maxwidth !== 'full') data.maxWidth = p.maxwidth;
      if (p.animate && p.animate !== 'none') data.animate = p.animate;
      if (p.class) data.className = p.class;
      return createBlock('text', data);
    }
    case 'IMAGE': {
      const data = {
        src: p.src || '',
        alt: p.alt || '',
        caption: p.caption || '',
        width: p.width || 'full'
      };
      if (!data.alt) warnings.push({ code: 'W401', message: 'IMAGE missing alt' });
      if (p.class) data.className = p.class;
      return createBlock('image', data);
    }
    case 'BUTTON': {
      const variant = p.style === 'ghost' ? 'outline' : p.style || 'primary';
      // map ghost→outline for existing renderer (btn-outline); secondary/primary ok
      const data = {
        text: collapseSingleParagraph(text) || 'לחץ כאן',
        url: p.url || '#',
        variant: variant === 'outline' ? 'outline' : variant
      };
      if (p.align && p.align !== 'start') data.align = p.align;
      return createBlock('button', data);
    }
    case 'ROW': {
      const cols = (node.children || []).map((col) => {
        const blocks = (col.children || []).map((c) => blockToJson(c, warnings)).filter(Boolean);
        return { blocks };
      });
      const data = {
        columns: cols,
        gap: p.gap || 'md',
        collapse: p.collapse || 'md',
        valign: p.valign || 'top'
      };
      // the cut speaks percent too: "70%:30%" and "70:30" are the same split
      if (p.ratio) data.ratio = String(p.ratio).split(':').map((s) => s.trim().replace(/%$/, '')).join(':');
      return createBlock('columns', data);
    }
    case 'SPACE': {
      const size = p.size || 'md';
      const heightMap = { sm: '0.75rem', md: '1.5rem', lg: '2.5rem', xl: '4rem' };
      return createBlock('spacer', { size, height: heightMap[size] || '1.5rem' });
    }
    case 'DIVIDER': {
      // renderer uses style solid|dashed — map line→solid, dots→dashed, thick→solid
      const styleMap = { line: 'solid', dots: 'dashed', thick: 'solid' };
      const st = p.style || 'line';
      return createBlock('divider', { style: styleMap[st] || 'solid', bentStyle: st });
    }
    case 'LIST': {
      const ordered = p.type === 'number';
      const items = (node.children || []).map((it) => {
        let t = it.text || '';
        // strip optional leading "- "
        t = t.replace(/^\s*-\s+/, '');
        if (!t.includes('\n')) t = collapseSingleParagraph(t);
        return { text: t };
      });
      return createBlock('list', { ordered, items });
    }
    case 'QUOTE': {
      return createBlock('quote', {
        text: collapseSingleParagraph(text),
        author: p.author || ''
      });
    }
    case 'CARD': {
      const blocks = (node.children || []).map((c) => blockToJson(c, warnings)).filter(Boolean);
      return createBlock('card', { blocks });
    }
    case 'HERO': {
      // children: at most one HEADING, TEXT, BUTTON → flat hero data
      let title = '';
      let subtitle = '';
      let buttonText = '';
      let buttonUrl = '';
      for (const c of node.children || []) {
        if (c.name === 'HEADING') title = collapseSingleParagraph(c.text);
        else if (c.name === 'TEXT') subtitle = collapseSingleParagraph(c.text);
        else if (c.name === 'BUTTON') {
          buttonText = collapseSingleParagraph(c.text);
          buttonUrl = (c.params && c.params.url) || '#';
        }
      }
      const data = { title, subtitle, buttonText, buttonUrl };
      if (p.image) data.image = p.image;
      if (p.height) data.height = p.height;
      // spec §11.1 overlay/parallax — stored since v0.44 (the drift is closed)
      if (p.overlay != null && Number(p.overlay) > 0) data.overlay = clampInt(p.overlay, 0, 80, 0);
      if (p.parallax === true || p.parallax === 'true') data.parallax = true;
      return createBlock('hero', data);
    }
    case 'MARQUEE': {
      const data = { text: collapseSingleParagraph(text) };
      if (p.speed && p.speed !== 'md') data.speed = p.speed;
      if (p.class) data.className = p.class;
      if (p.id && !isGeneratedBlockId(p.id)) data.id = p.id;
      return createBlock('marquee', data);
    }
    case 'PARALLAX': {
      const data = {
        image: p.image || '',
        blocks: (node.children || []).map((c) => blockToJson(c, warnings)).filter(Boolean)
      };
      if (p.overlay != null && Number(p.overlay) > 0) data.overlay = clampInt(p.overlay, 0, 80, 0);
      if (p.height && p.height !== 'md') data.height = p.height;
      if (p.class) data.className = p.class;
      if (p.id && !isGeneratedBlockId(p.id)) data.id = p.id;
      return createBlock('parallax', data);
    }
    case 'TESTIMONIAL': {
      return createBlock('testimonial', {
        quote: collapseSingleParagraph(text),
        author: p.author || '',
        role: p.role || ''
      });
    }
    case 'GALLERY': {
      const images = (node.children || [])
        .filter((c) => c.name === 'IMAGE')
        .map((c) => ({
          src: c.params.src || '',
          alt: c.params.alt || ''
        }));
      return createBlock('gallery', {
        images,
        columns: clampInt(p.columns, 1, 4, 3)
      });
    }
    case 'FEATURES': {
      const items = (node.children || [])
        .filter((c) => c.name === 'FEATURE')
        .map((c) => ({
          title: (c.params && c.params.title) || '',
          icon: (c.params && c.params.icon) || '',
          description: collapseSingleParagraph(c.text || '')
        }));
      return createBlock('features', {
        items,
        columns: clampInt(p.columns, 1, 4, 3)
      });
    }
    case 'EMBED': {
      return createBlock('embed', { url: p.url || '' });
    }
    case 'ARTICLES': {
      return createBlock('article-list', {
        tag: p.tag || 'article',
        limit: clampInt(p.limit, 1, 48, 6),
        columns: clampInt(p.columns, 1, 4, 3)
      });
    }
    case 'MAP': {
      // since 0.2 — Google Maps embed, no API key
      return createBlock('map', {
        address: p.address || '',
        zoom: clampInt(p.zoom, 1, 20, 15),
        height: p.height || 'md'
      });
    }
    case 'MOTION': {
      // v0.1: store as text with class for theme motion hooks
      return createBlock('text', {
        content: text,
        className: `motion motion-${p.effect || 'fade'}`,
        motion: {
          effect: p.effect || 'fade',
          speed: p.speed || 'normal',
          repeat: p.repeat || 'once'
        }
      });
    }
    case 'BACKDROP': {
      const blocks = (node.children || []).map((c) => blockToJson(c, warnings)).filter(Boolean);
      // map to card/section-like: use card with class backdrop
      return createBlock('card', {
        blocks,
        className: 'backdrop',
        backdrop: {
          image: p.image,
          tint: p.tint || 'none',
          opacity: p.opacity != null ? p.opacity : 100,
          fade: !!p.fade,
          minheight: p.minheight || 'md'
        }
      });
    }
    case 'HTML': {
      warnings.push({
        code: 'W_HTML',
        message: 'HTML fence used — raw HTML escape hatch'
      });
      return createBlock('text', {
        content: '',
        rawHtml: node.text || '',
        className: 'bentml-html-fence'
      });
    }
    case 'CTA': {
      const variant = p.style === 'ghost' ? 'outline' : p.style || 'primary';
      return createBlock('cta', {
        title: p.title || '',
        text: p.text || '',
        buttonText: p.buttontext || p.buttonText || 'לפרטים',
        url: p.url || '#',
        variant,
        tone: p.tone || 'brand',
        align: p.align || 'start'
      });
    }
    case 'STATS': {
      return createBlock('stats', {
        columns: clampInt(p.columns, 2, 4, 3),
        items: [
          { value: '—', label: 'מדד' },
          { value: '—', label: 'מדד' },
          { value: '—', label: 'מדד' }
        ]
      });
    }
    case 'LOGOS': {
      return createBlock('logos', {
        items: [
          { src: '/uploads/PLACEHOLDER-logo-1.svg', alt: 'Logo 1' },
          { src: '/uploads/PLACEHOLDER-logo-2.svg', alt: 'Logo 2' }
        ]
      });
    }
    case 'FAQ': {
      return createBlock('faq', {
        items: [
          { question: 'שאלה?', answer: 'תשובה.' }
        ]
      });
    }
    case 'CONTACT': {
      return createBlock('contact-info', {
        phone: p.phone || '',
        email: p.email || '',
        address: p.address || '',
        hours: p.hours || ''
      });
    }
    case 'BANNER': {
      return createBlock('banner', {
        text: collapseSingleParagraph(text) || '',
        tone: p.tone || 'brand',
        align: p.align || 'start'
      });
    }
    case 'COL':
    case 'ITEM':
    case 'FEATURE':
      throw new BentmlError('E104', `${node.name} cannot appear at this level`);
    default:
      warnings.push({ code: 'W405', message: `Skipped unknown block ${node.name}` });
      return null;
  }
}

function collapseSingleParagraph(text) {
  return String(text || '')
    .replace(/\n\n+/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

/**
 * Compile BenTML and produce HTML via existing renderer (preview path).
 * @param {string} source
 * @param {(page: object) => string} renderPage
 */
function compileAndRender(source, renderPage) {
  const { page, blocks, warnings } = compile(source);
  const html = renderPage({
    title: page.title,
    direction: page.direction,
    theme: page.theme,
    blocks,
    status: page.status,
    tags: page.tags,
    meta: page.meta
  });
  return { page, blocks, warnings, html };
}

module.exports = {
  compile,
  compileAndRender,
  blockToJson
};
