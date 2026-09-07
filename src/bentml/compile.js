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
      seoTitle: ast.meta.seotitle || '',
      robots: ast.meta.robots || '',
      author: ast.meta.author || '',
      date: ast.meta.date || '',
      teaser: ast.meta.teaser || '',
      cardImage: ast.meta.cardimage || ''
    }
  };

  return { page, blocks, warnings, ast };
}

/**
 * @param {object} node
 * @param {object[]} warnings
 */
function applyChrome(data, p) {
  if (p.class) data.className = p.class;
  // animate is universal chrome since v1.97 — every keyword carries it here
  if (p.animate && p.animate !== 'none' && data.animate === undefined) data.animate = p.animate;
  // generated (storage-shape) ids are block identity, not authored anchors —
  // blockToJson restores those on the block itself, never into data.id
  if (p.id && !isGeneratedBlockId(p.id)) data.id = p.id;
  const style = {};
  if (p.color) style.color = p.color;
  if (p.background) style.background = p.background;
  if (p.fontsize) style.fontSize = p.fontsize;
  if (p.padding) style.padding = p.padding;
  if (p.radius) style.radius = p.radius;
  if (p.hide === 'mobile' || p.hide === 'desktop') style.hideOn = p.hide;
  if (Object.keys(style).length) data.style = style;
  return data;
}

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
      applyChrome(data, p); // animate rides the universal chrome (v1.97)
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
      applyChrome(data, p); // animate rides the universal chrome (v1.97)
      return createBlock('text', data);
    }
    case 'IMAGE': {
      const data = {
        src: p.src || '',
        alt: p.alt || '',
        caption: p.caption || '',
        width: p.width || 'full'
      };
      if (p.title) data.title = p.title; // image SEO title (v0.71)
      if (p.link) data.link = p.link;    // clickable image (v2.12)
      if (!data.alt) warnings.push({ code: 'W401', message: 'IMAGE missing alt' });
      applyChrome(data, p);
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
      applyChrome(data, p);
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
      applyChrome(data, p);
      return createBlock('columns', data);
    }
    case 'SPACE': {
      const size = p.size || 'md';
      const heightMap = { sm: '0.75rem', md: '1.5rem', lg: '2.5rem', xl: '4rem' };
      const data = { size, height: heightMap[size] || '1.5rem' };
      // exact height wins over the size name — the builder's drag-resize writes
      // pixel heights, and the code tab must not flatten them back to the enum
      if (p.height != null && p.height !== '') {
        const raw = typeof p.height === 'number' ? p.height + 'px' : String(p.height).trim();
        if (!/^\d+(\.\d+)?(px|rem|em|vh)$/.test(raw)) {
          throw new BentmlError('E305', `Invalid SPACE height: ${p.height} (use e.g. 106px or 2rem)`, {});
        }
        data.height = raw;
      }
      return createBlock('spacer', applyChrome(data, p));
    }
    case 'DIVIDER': {
      // renderer uses style solid|dashed — map line→solid, dots→dashed, thick→solid
      const styleMap = { line: 'solid', dots: 'dashed', thick: 'solid' };
      const st = p.style || 'line';
      return createBlock('divider', applyChrome({ style: styleMap[st] || 'solid', bentStyle: st }, p));
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
      return createBlock('list', applyChrome({ ordered, items }, p));
    }
    case 'QUOTE': {
      return createBlock('quote', applyChrome({
        text: collapseSingleParagraph(text),
        author: p.author || ''
      }, p));
    }
    case 'CARD': {
      const blocks = (node.children || []).map((c) => blockToJson(c, warnings)).filter(Boolean);
      return createBlock('card', applyChrome({ blocks }, p));
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
      applyChrome(data, p);
      return createBlock('hero', data);
    }
    case 'MOTION':
    case 'MARQUEE': {
      // MOTION is canonical; MARQUEE is the alias fixed to effect: marquee.
      // effect marquee = horizontal scroll; fade/slide/typewriter = entrance.
      const effect = node.name === 'MARQUEE'
        ? 'marquee'
        : (['marquee', 'fade', 'slide', 'typewriter'].includes(p.effect) ? p.effect : 'marquee');
      const data = { text: collapseSingleParagraph(text) };
      if (effect !== 'marquee') data.effect = effect;
      if (p.speed && p.speed !== 'md') data.speed = p.speed;
      applyChrome(data, p);
      return createBlock('marquee', data);
    }
    case 'BACKDROP':
    case 'PARALLAX': {
      // BACKDROP is canonical; PARALLAX is the alias (no tint/fade).
      const data = {
        image: p.image || '',
        blocks: (node.children || []).map((c) => blockToJson(c, warnings)).filter(Boolean)
      };
      if (p.overlay != null && Number(p.overlay) > 0) data.overlay = clampInt(p.overlay, 0, 80, 0);
      if (p.height && p.height !== 'md') data.height = p.height;
      if (p.tint && p.tint !== 'none') data.tint = p.tint;
      if (p.fade === true || p.fade === 'true') data.fade = true;
      applyChrome(data, p);
      return createBlock('parallax', data);
    }
    case 'TESTIMONIAL': {
      return createBlock('testimonial', applyChrome({
        quote: collapseSingleParagraph(text),
        author: p.author || '',
        role: p.role || ''
      }, p));
    }
    case 'GALLERY': {
      const images = (node.children || [])
        .filter((c) => c.name === 'IMAGE')
        .map((c) => ({
          src: c.params.src || '',
          alt: c.params.alt || ''
        }));
      return createBlock('gallery', applyChrome({
        images,
        columns: clampInt(p.columns, 1, 4, 3)
      }, p));
    }
    case 'FEATURES': {
      const items = (node.children || [])
        .filter((c) => c.name === 'FEATURE')
        .map((c) => ({
          title: (c.params && c.params.title) || '',
          icon: (c.params && c.params.icon) || '',
          url: (c.params && c.params.url) || '',
          description: collapseSingleParagraph(c.text || '')
        }));
      return createBlock('features', applyChrome({
        items,
        columns: clampInt(p.columns, 1, 4, 3)
      }, p));
    }
    case 'EMBED': {
      return createBlock('embed', applyChrome({ url: p.url || '' }, p));
    }
    case 'ARTICLES': {
      return createBlock('article-list', applyChrome({
        tag: p.tag || 'article',
        limit: clampInt(p.limit, 1, 48, 6),
        columns: clampInt(p.columns, 1, 4, 3)
      }, p));
    }
    case 'MAP': {
      // since 0.2 — Google Maps embed, no API key
      return createBlock('map', applyChrome({
        address: p.address || '',
        zoom: clampInt(p.zoom, 1, 20, 15),
        height: p.height || 'md'
      }, p));
    }
    case 'HTML': {
      warnings.push({
        code: 'W_HTML',
        message: 'HTML fence used — raw HTML escape hatch'
      });
      // v1.49: this used to mint a `text` block carrying the markup in a
      // `rawHtml` field. Nothing ever RENDERED that field — renderer.js reads
      // `content` — so a fence round-tripped through the engine and then
      // published as an empty paragraph, silently losing the author's HTML.
      // Now it compiles to the real `html` block, the same one the builder tool
      // and the pzn `html` module use, so one representation renders everywhere.
      return createBlock('html', {
        content: node.text || '',
        className: 'bentml-html-fence'
      });
    }
    case 'STATS': {
      const items = (node.children || [])
        .filter((c) => c.name === 'STAT')
        .map((c) => ({
          value: (c.params && c.params.value) || '',
          label: (c.params && c.params.label) || ''
        }));
      const data = {
        columns: clampInt(p.columns, 2, 4, 3),
        items: items.length
          ? items
          : [
              { value: '—', label: 'מדד' },
              { value: '—', label: 'מדד' },
              { value: '—', label: 'מדד' }
            ]
      };
      applyChrome(data, p);
      return createBlock('stats', data);
    }
    case 'LOGOS': {
      const items = (node.children || [])
        .filter((c) => c.name === 'LOGO')
        .map((c) => ({
          src: (c.params && c.params.src) || '',
          alt: (c.params && c.params.alt) || '',
          url: (c.params && c.params.url) || ''
        }));
      const data = {
        items: items.length
          ? items
          : [
              { src: '/uploads/PLACEHOLDER-logo-1.svg', alt: 'Logo 1' },
              { src: '/uploads/PLACEHOLDER-logo-2.svg', alt: 'Logo 2' }
            ]
      };
      applyChrome(data, p);
      return createBlock('logos', data);
    }
    case 'SOCIAL': {
      const items = (node.children || [])
        .filter((c) => c.name === 'HANDLE')
        .map((c) => {
          const item = {
            network: (c.params && c.params.network) || '',
            url: (c.params && c.params.url) || ''
          };
          const label = collapseSingleParagraph(c.text || '');
          if (label) item.label = label;
          return item;
        });
      const data = {
        items: items.length
          ? items
          : [
              { network: 'facebook', url: 'https://facebook.com/', label: 'פייסבוק' },
              { network: 'instagram', url: 'https://instagram.com/', label: 'אינסטגרם' }
            ]
      };
      applyChrome(data, p);
      return createBlock('social', data);
    }
    case 'FAQ': {
      const items = (node.children || [])
        .filter((c) => c.name === 'QA')
        .map((c) => ({
          question: (c.params && c.params.question) || '',
          answer: collapseSingleParagraph(c.text || '')
        }));
      const data = {
        items: items.length ? items : [{ question: 'שאלה?', answer: 'תשובה.' }]
      };
      applyChrome(data, p);
      return createBlock('faq', data);
    }
    case 'CONTACT': {
      const data = {
        phone: p.phone || '',
        email: p.email || '',
        address: p.address || '',
        hours: p.hours || ''
      };
      applyChrome(data, p);
      return createBlock('contact-info', data);
    }
    case 'BANNER': {
      const data = {
        text: collapseSingleParagraph(text) || '',
        tone: p.tone || 'brand',
        align: p.align || 'start'
      };
      applyChrome(data, p);
      return createBlock('banner', data);
    }
    case 'CTA': {
      const variant = p.style === 'ghost' ? 'outline' : p.style || 'primary';
      const data = {
        title: p.title || '',
        text: p.text || '',
        buttonText: p.buttontext || p.buttonText || 'לפרטים',
        url: p.url || '#',
        variant,
        tone: p.tone || 'brand',
        align: p.align || 'start'
      };
      applyChrome(data, p);
      return createBlock('cta', data);
    }
    case 'SECTION': {
      const data = {
        blocks: (node.children || []).map((c) => blockToJson(c, warnings)).filter(Boolean),
        size: p.size || 'md'
      };
      applyChrome(data, p);
      return createBlock('section', data);
    }
    case 'TABS': {
      const items = (node.children || [])
        .filter((c) => c.name === 'TAB')
        .map((c) => ({
          label: (c.params && c.params.label) || '',
          content: singleOrMultiline(c.text)
        }));
      const data = {
        items: items.length
          ? items
          : [{ label: 'לשונית 1', content: '' }, { label: 'לשונית 2', content: '' }]
      };
      applyChrome(data, p);
      return createBlock('tabs', data);
    }
    case 'ACCORDION': {
      const items = (node.children || [])
        .filter((c) => c.name === 'FOLD')
        .map((c) => ({
          title: (c.params && c.params.title) || '',
          content: singleOrMultiline(c.text)
        }));
      const data = {
        items: items.length
          ? items
          : [{ title: 'מגירה 1', content: '' }, { title: 'מגירה 2', content: '' }]
      };
      applyChrome(data, p);
      return createBlock('accordion', data);
    }
    case 'FORM': {
      const fields = (node.children || [])
        .filter((c) => c.name === 'FIELD')
        .map((c) => {
          const fp = c.params || {};
          const field = { label: fp.label || '' };
          if (fp.name) field.name = fp.name;
          if (fp.type && fp.type !== 'text') field.type = fp.type;
          if (fp.placeholder) field.placeholder = fp.placeholder;
          if (fp.required === true || fp.required === 'true') field.required = true;
          if (Array.isArray(fp.options) && fp.options.length) field.options = fp.options;
          return field;
        });
      const data = {
        action: p.action || '',
        method: p.method === 'get' ? 'get' : 'post',
        submit: p.submit || 'שליחה',
        fields: fields.length
          ? fields
          : [
              { label: 'שם', name: 'name', required: true },
              { label: 'אימייל', name: 'email', type: 'email', required: true },
              { label: 'הודעה', name: 'message', type: 'textarea' }
            ]
      };
      applyChrome(data, p);
      return createBlock('form', data);
    }
    case 'CARDS': {
      const items = (node.children || [])
        .filter((c) => c.name === 'MEDIACARD')
        .map((c) => {
          const cp = c.params || {};
          const item = { title: cp.title || '' };
          if (cp.image) item.image = cp.image;
          if (cp.tag) item.tag = cp.tag;
          const excerpt = collapseSingleParagraph(c.text || '');
          if (excerpt) item.excerpt = excerpt;
          if (cp.url) item.href = cp.url;
          return item;
        });
      const data = { items };
      applyChrome(data, p);
      return createBlock('cards', data);
    }
    case 'PRICING': {
      const items = (node.children || [])
        .filter((c) => c.name === 'PLAN')
        .map((c) => {
          const cp = c.params || {};
          const item = { title: cp.title || '' };
          if (cp.price) item.price = cp.price;
          if (cp.period) item.period = cp.period;
          const features = singleOrMultiline(c.text || '');
          if (features) item.features = features;
          if (cp.cta) item.ctaLabel = cp.cta;
          if (cp.url) item.ctaUrl = cp.url;
          if (cp.highlighted === true || cp.highlighted === 'true') item.highlighted = true;
          return item;
        });
      const data = { items };
      applyChrome(data, p);
      return createBlock('pricing', data);
    }
    case 'STEPS': {
      const items = (node.children || [])
        .filter((c) => c.name === 'STEP')
        .map((c) => {
          const cp = c.params || {};
          const item = { title: cp.title || '' };
          const text = collapseSingleParagraph(c.text || '');
          if (text) item.text = text;
          if (cp.icon) item.icon = cp.icon;
          return item;
        });
      const data = {
        items: items.length
          ? items
          : [
              { title: 'מתארים', text: 'מספרים מה האתר צריך לעשות.' },
              { title: 'בונים', text: 'מודולים על הקנבס — בלי קוד.' },
              { title: 'מפרסמים', text: 'HTML נקי, חי בלחיצה.' }
            ]
      };
      applyChrome(data, p);
      return createBlock('steps', data);
    }
    case 'TIMELINE': {
      const items = (node.children || [])
        .filter((c) => c.name === 'EVENT')
        .map((c) => {
          const cp = c.params || {};
          const item = { title: cp.title || '' };
          if (cp.time) item.time = cp.time;
          const text = collapseSingleParagraph(c.text || '');
          if (text) item.text = text;
          if (cp.image) item.image = cp.image;
          return item;
        });
      const data = {
        items: items.length
          ? items
          : [
              { time: '2024', title: 'ההתחלה', text: 'פתחנו את הסטודיו.' },
              { time: '2026', title: 'היום', text: 'ממשיכים לבנות.' }
            ]
      };
      applyChrome(data, p);
      return createBlock('timeline', data);
    }
    case 'CAROUSEL': {
      const items = (node.children || [])
        .filter((c) => c.name === 'SLIDE')
        .map((c) => {
          const cp = c.params || {};
          const item = {};
          if (cp.title) item.title = cp.title;
          if (cp.image) item.image = cp.image;
          if (cp.tag) item.tag = cp.tag;
          const excerpt = collapseSingleParagraph(c.text || '');
          if (excerpt) item.excerpt = excerpt;
          if (cp.url) item.href = cp.url;
          return item;
        });
      const data = { items };
      if (p.height && p.height !== 'md') data.height = p.height;
      if (p.peek === false || p.peek === 'false') data.peek = false;
      applyChrome(data, p);
      return createBlock('carousel', data);
    }
    case 'CRUMBS': {
      const items = (node.children || [])
        .filter((c) => c.name === 'CRUMB')
        .map((c) => {
          const item = { label: collapseSingleParagraph(c.text || '') };
          const url = c.params && c.params.url;
          if (url) item.url = url;
          return item;
        });
      const data = {
        items: items.length
          ? items
          : [
              { label: 'בית', url: '/' },
              { label: 'הדף' }
            ]
      };
      applyChrome(data, p);
      return createBlock('crumbs', data);
    }
    case 'TEAM': {
      const items = (node.children || [])
        .filter((c) => c.name === 'MEMBER')
        .map((c) => {
          const cp = c.params || {};
          const item = { name: cp.name || '' };
          if (cp.role) item.role = cp.role;
          if (cp.image) item.image = cp.image;
          if (cp.url) item.url = cp.url;
          const bio = collapseSingleParagraph(c.text || '');
          if (bio) item.bio = bio;
          return item;
        });
      const data = {
        items: items.length
          ? items
          : [
              { name: 'דנה לוי', role: 'מנכ"לית' },
              { name: 'יוסי כהן', role: 'סמנכ"ל טכנולוגיות' }
            ]
      };
      applyChrome(data, p);
      return createBlock('team', data);
    }
    case 'COUNTDOWN': {
      const data = { target: p.target || '' };
      const label = collapseSingleParagraph(node.text || '');
      if (label) data.label = label;
      if (p.done) data.done = p.done;
      applyChrome(data, p);
      return createBlock('countdown', data);
    }
    case 'PRICELIST': {
      const items = (node.children || [])
        .filter((c) => c.name === 'PRICEITEM')
        .map((c) => {
          const cp = c.params || {};
          const item = { name: cp.name || '' };
          if (cp.price) item.price = cp.price;
          const desc = collapseSingleParagraph(c.text || '');
          if (desc) item.desc = desc;
          return item;
        });
      const data = {
        items: items.length
          ? items
          : [
              { name: 'חומוס מלא', price: '32 ₪' },
              { name: 'שקשוקה', price: '44 ₪' }
            ]
      };
      applyChrome(data, p);
      return createBlock('pricelist', data);
    }
    case 'PROGRESS': {
      const items = (node.children || [])
        .filter((c) => c.name === 'BAR')
        .map((c) => {
          const cp = c.params || {};
          const item = { label: collapseSingleParagraph(c.text || '') };
          if (cp.value != null) item.value = cp.value;
          if (cp.color) item.color = cp.color;
          return item;
        });
      const data = {
        items: items.length
          ? items
          : [
              { label: 'עיצוב', value: 90 },
              { label: 'פיתוח', value: 75 }
            ]
      };
      applyChrome(data, p);
      return createBlock('progress', data);
    }
    case 'HEADER': {
      const data = {
        blocks: (node.children || []).map((c) => blockToJson(c, warnings)).filter(Boolean),
        tone: p.tone || 'light',
        layout: p.layout || 'row'
      };
      applyChrome(data, p);
      return createBlock('header', data);
    }
    case 'FOOTER': {
      const data = {
        blocks: (node.children || []).map((c) => blockToJson(c, warnings)).filter(Boolean),
        tone: p.tone || 'dark'
      };
      if (p.credit) data.credit = p.credit;
      applyChrome(data, p);
      return createBlock('footer', data);
    }
    case 'WHATSAPP': {
      const data = { label: collapseSingleParagraph(text) || 'דברו איתנו בוואטסאפ' };
      if (p.phone) data.phone = p.phone;
      if (p.message) data.message = p.message;
      if (p.note) data.note = p.note;
      if (p.url) data.url = p.url;
      if (p.align && p.align !== 'start') data.align = p.align;
      applyChrome(data, p);
      return createBlock('whatsapp', data);
    }
    case 'NAV': {
      const items = (node.children || [])
        .filter((c) => c.name === 'NAVITEM')
        .map((c) => ({
          label: collapseSingleParagraph(c.text || ''),
          href: (c.params && c.params.url) || '#'
        }));
      const data = { items };
      if (p.background) data.background = p.background;
      if (p.color) data.color = p.color;
      if (p.align && p.align !== 'start') data.align = p.align;
      // background/color are the nav's own fields here, not generic chrome
      applyChrome(data, { ...p, background: undefined, color: undefined });
      return createBlock('nav', data);
    }
    case 'TICKER': {
      const items = (node.children || [])
        .filter((c) => c.name === 'TICKERITEM')
        .map((c) => {
          const item = { text: collapseSingleParagraph(c.text || '') };
          const url = c.params && c.params.url;
          if (url) item.href = url;
          return item;
        });
      const data = { items };
      if (p.label) data.label = p.label;
      if (p.speed && p.speed !== 'md') data.speed = p.speed;
      if (p.background) data.background = p.background;
      if (p.color) data.color = p.color;
      applyChrome(data, { ...p, background: undefined, color: undefined });
      return createBlock('ticker', data);
    }
    case 'NEWSPOP': {
      const items = (node.children || [])
        .filter((c) => c.name === 'NEWSPOPITEM')
        .map((c) => {
          const item = { text: collapseSingleParagraph(c.text || '') };
          const cp = c.params || {};
          if (cp.time) item.time = cp.time;
          if (cp.url) item.href = cp.url;
          return item;
        });
      const data = { items };
      if (p.label) data.label = p.label;
      applyChrome(data, p);
      return createBlock('newspop', data);
    }
    case 'VIDEO': {
      const data = { src: p.src || '' };
      if (p.poster) data.poster = p.poster;
      if (p.caption) data.caption = p.caption;
      data.controls = !(p.controls === false || p.controls === 'false');
      if (p.autoplay === true || p.autoplay === 'true') data.autoplay = true;
      if (p.loop === true || p.loop === 'true') data.loop = true;
      if (p.muted === true || p.muted === 'true') data.muted = true;
      applyChrome(data, p);
      return createBlock('video', data);
    }
    case 'TABLE': {
      const rows = (node.children || [])
        .filter((c) => c.name === 'TROW')
        .map((c) => ({ cells: collapseSingleParagraph(c.text || '') }));
      const data = {
        rows: rows.length
          ? rows
          : [{ cells: 'יום | שעות' }, { cells: 'ראשון–חמישי | 9:00–17:00' }]
      };
      if (p.header === false || p.header === 'false') data.header = false;
      applyChrome(data, p);
      return createBlock('table', data);
    }
    case 'AUDIO': {
      const data = { src: p.src || '' };
      if (p.caption) data.caption = p.caption;
      if (p.loop === true || p.loop === 'true') data.loop = true;
      applyChrome(data, p);
      return createBlock('audio', data);
    }
    case 'CATEGORY': {
      const data = {
        slug: p.slug || '',
        limit: clampInt(p.limit, 1, 48, 6),
        showheader: !(p.showheader === false || p.showheader === 'false')
      };
      applyChrome(data, p);
      return createBlock('category', data);
    }
    case 'COL':
    case 'ITEM':
    case 'FEATURE':
    case 'STAT':
    case 'LOGO':
    case 'QA':
    case 'TAB':
    case 'FOLD':
    case 'FIELD':
    case 'MEDIACARD':
    case 'SLIDE':
    case 'TROW':
    case 'NAVITEM':
    case 'TICKERITEM':
    case 'NEWSPOPITEM':
    case 'PLAN':
    case 'STEP':
    case 'EVENT':
    case 'CRUMB':
    case 'HANDLE':
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

/** TAB/FOLD content: keep authored line breaks, collapse one-liners' padding. */
function singleOrMultiline(text) {
  const t = String(text || '');
  return t.includes('\n') ? t : collapseSingleParagraph(t);
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
