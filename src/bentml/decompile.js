'use strict';

const { isGeneratedBlockId } = require('../blocks');

/**
 * decompile(page, blocks) → canonical BenTML
 *
 * This is the "new HTML" of Tapuz: every visual builder action accumulates here.
 * Goal: full site picture — META/SEO, all module content, style, nested containers.
 */

/**
 * @param {object} page
 * @param {object[]} blocks
 * @param {{ withMap?: boolean }} [opts] — withMap returns { source, map } where
 *   map is [{ id, type, start, end }] with 1-based line ranges per top-level
 *   block in the emitted source. Nested blocks are addressed by their
 *   `id: "..."` param in the text (they always carry their storage id).
 * @returns {string | { source: string, map: object[] }}
 */
function decompile(page = {}, blocks = [], opts = {}) {
  const lines = [];
  lines.push('BENTML 0.2');
  lines.push('');
  lines.push('META {');
  lines.push(`  title: ${q(page.meta?.seoTitle || page.title || 'ללא כותרת')}`);
  if (page.slug) lines.push(`  slug: ${q(page.slug)}`);
  if (page.direction && page.direction !== 'rtl') lines.push(`  direction: ${page.direction}`);
  if (page.theme && page.theme !== 'default') lines.push(`  theme: ${q(page.theme)}`);
  if (page.meta?.description) lines.push(`  description: ${q(page.meta.description)}`);
  if (page.meta?.ogImage || page.meta?.ogimage) {
    lines.push(`  ogimage: ${q(page.meta.ogImage || page.meta.ogimage)}`);
  }
  if (page.meta?.robots && page.meta.robots !== 'index, follow') {
    lines.push(`  robots: ${q(page.meta.robots)}`);
  }
  if (page.tags && page.tags.length) lines.push(`  tags: ${JSON.stringify(page.tags)}`);
  if (page.status && page.status !== 'draft') lines.push(`  status: ${page.status}`);
  if (page.lang && page.lang !== 'he') lines.push(`  lang: ${q(page.lang)}`);
  if (page.meta?.author) lines.push(`  author: ${q(page.meta.author)}`);
  if (page.meta?.date) lines.push(`  date: ${q(page.meta.date)}`);
  if (page.meta?.teaser) lines.push(`  teaser: ${q(page.meta.teaser)}`);
  if (page.meta?.cardImage) lines.push(`  cardimage: ${q(page.meta.cardImage)}`);
  lines.push('}');
  lines.push('');

  const map = [];
  for (const b of blocks || []) {
    const chunk = decompileBlock(b, 0).split('\n');
    map.push({ id: b.id, type: b.type, start: lines.length + 1, end: lines.length + chunk.length });
    lines.push(...chunk);
    lines.push('');
  }

  // Line-aware equivalent of the old `\n{3,} → \n\n` collapse + trim: drop a
  // blank line that follows a blank line, drop leading/trailing blanks. An
  // original→new line index keeps the map ranges true through the drops.
  const out = [];
  const newIndex = new Array(lines.length + 1);
  for (let i = 0; i < lines.length; i++) {
    const blank = lines[i] === '';
    if (blank && (out.length === 0 || out[out.length - 1] === '')) {
      newIndex[i + 1] = out.length; // dropped — resolves to the previous kept line
      continue;
    }
    out.push(lines[i]);
    newIndex[i + 1] = out.length;
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  const last = out.length || 1;
  for (const m of map) {
    m.start = Math.min(Math.max(1, newIndex[m.start] || 1), last);
    m.end = Math.min(Math.max(m.start, newIndex[m.end] || m.start), last);
  }

  const source = out.join('\n') + '\n';
  if (opts && opts.withMap) return { source, map };
  return source;
}

function uni(params, d, idParams = []) {
  const has = (name) => params.some((x) => x.startsWith(name + ':'));
  if (d.className) params.push(`class: ${q(d.className)}`);
  // the id: slot holds either the authored anchor (data.id, §7.4) or the
  // nested block's storage id — the anchor is content, so it wins
  if (d.id) params.push(`id: ${q(d.id)}`);
  else params.push(...idParams);
  const s = d.style || {};
  // never emit a param twice — NAV/TICKER own `background:`/`color:` already
  if (s.color && !has('color')) params.push(`color: ${q(s.color)}`);
  if (s.background && !has('background')) params.push(`background: ${q(s.background)}`);
  if (s.fontSize) params.push(`fontsize: ${s.fontSize}`);
  if (s.padding) params.push(`padding: ${s.padding}`);
  if (s.radius) params.push(`radius: ${s.radius}`);
}

function decompileBlock(block, indent) {
  const pad = '  '.repeat(indent);
  const type = block.type;
  const d = block.data || {};
  // Nested blocks carry their id as an `id:` param so recompile preserves
  // identity — top-level blocks can be reconciled by position, children of
  // CARD/ROW/PARALLAX/BACKDROP cannot. Storage-shaped ids are restored as
  // block identity by compile; authored ids (imported .pzn) live on as the
  // §7.4 anchor — either way the source names the block, so the builder⇄code
  // selection dance works for every nested block.
  const idParams = indent > 0 && block.id ? [`id: ${q(block.id)}`] : [];

  switch (type) {
    case 'heading': {
      const params = [];
      if (d.level != null && d.level !== 2) params.push(`level: ${d.level}`);
      if (d.align && d.align !== 'start') params.push(`align: ${d.align}`);
      if (d.animate && d.animate !== 'none') params.push(`animate: ${d.animate}`);
      uni(params, d, idParams);
      return `${pad}HEADING${paramList(params)} { ${escBody(d.text || '')} }`;
    }
    case 'text': {
      if (d.rawHtml) {
        return `${pad}HTML {{{\n${d.rawHtml}\n${pad}}}}`;
      }
      const params = [];
      if (d.align && d.align !== 'start') params.push(`align: ${d.align}`);
      if (d.size && d.size !== 'md') params.push(`size: ${d.size}`);
      if (d.lead) params.push('lead: true');
      if (d.dropcap) params.push('dropcap: true');
      if (d.maxWidth && d.maxWidth !== 'full') params.push(`maxwidth: ${d.maxWidth}`);
      if (d.animate && d.animate !== 'none') params.push(`animate: ${d.animate}`);
      uni(params, d, idParams);
      const body = String(d.content || '');
      if (!body.includes('\n')) {
        return `${pad}TEXT${paramList(params)} { ${escBody(body)} }`;
      }
      return `${pad}TEXT${paramList(params)} {\n${indentBody(body, indent + 1)}\n${pad}}`;
    }
    case 'image': {
      const params = [`src: ${q(d.src || '')}`];
      if (d.alt) params.push(`alt: ${q(d.alt)}`);
      if (d.title) params.push(`title: ${q(d.title)}`); // image SEO title (v0.71)
      if (d.caption) params.push(`caption: ${q(d.caption)}`);
      if (d.width && d.width !== 'full') params.push(`width: ${d.width}`);
      uni(params, d, idParams);
      return `${pad}IMAGE${paramList(params)}`;
    }
    case 'button': {
      const style = d.variant === 'outline' ? 'ghost' : d.variant || 'primary';
      const params = [`url: ${q(d.url || '#')}`];
      if (style !== 'primary') params.push(`style: ${style}`);
      if (d.align && d.align !== 'start') params.push(`align: ${d.align}`);
      uni(params, d, idParams);
      return `${pad}BUTTON${paramList(params)} { ${escBody(d.text || '')} }`;
    }
    case 'columns': {
      const params = [];
      if (d.gap && d.gap !== 'md') params.push(`gap: ${d.gap}`);
      if (d.collapse && d.collapse !== 'md') params.push(`collapse: ${d.collapse}`);
      if (d.valign && d.valign !== 'top') params.push(`valign: ${d.valign}`);
      if (d.ratio) params.push(`ratio: ${q(String(d.ratio))}`);
      uni(params, d, idParams);
      let colBlocks = d.columns || [];
      if (!colBlocks.length && Array.isArray(d.children)) {
        colBlocks = d.children.map((c) => ({ blocks: c }));
      }
      const inner = colBlocks
        .map((col) => {
          const kids = (col.blocks || []).map((b) => decompileBlock(b, indent + 2)).join('\n');
          return `${pad}  COL {\n${kids || pad + '  '}\n${pad}  }`;
        })
        .join('\n');
      return `${pad}ROW${paramList(params)} {\n${inner}\n${pad}}`;
    }
    case 'spacer': {
      const size = d.size || sizeFromHeight(d.height) || 'md';
      const params = [];
      if (size !== 'md') params.push(`size: ${size}`);
      uni(params, d, idParams);
      if (!params.length) return `${pad}SPACE`;
      return `${pad}SPACE${paramList(params)}`;
    }
    case 'divider': {
      const st = d.bentStyle || (d.style === 'dashed' ? 'dots' : 'line');
      const params = [];
      if (st !== 'line') params.push(`style: ${st}`);
      uni(params, d, idParams);
      if (!params.length) return `${pad}DIVIDER`;
      return `${pad}DIVIDER${paramList(params)}`;
    }
    case 'list': {
      const params = [];
      if (d.ordered) params.push('type: number');
      uni(params, d, idParams);
      const items = (d.items || [])
        .map((it) => {
          const t = typeof it === 'string' ? it : it.text || '';
          const prefix = d.ordered ? '' : '- ';
          return `${pad}  ITEM { ${prefix}${escBody(t)} }`;
        })
        .join('\n');
      return `${pad}LIST${paramList(params)} {\n${items}\n${pad}}`;
    }
    case 'quote': {
      const params = [];
      if (d.author) params.push(`author: ${q(d.author)}`);
      uni(params, d, idParams);
      return `${pad}QUOTE${paramList(params)} { ${escBody(d.text || '')} }`;
    }
    case 'card': {
      if (d.backdrop) {
        const params = [`image: ${q(d.backdrop.image || '')}`];
        if (d.backdrop.tint && d.backdrop.tint !== 'none') params.push(`tint: ${d.backdrop.tint}`);
        uni(params, d, idParams);
        const kids = (d.blocks || []).map((b) => decompileBlock(b, indent + 1)).join('\n');
        return `${pad}BACKDROP${paramList(params)} {\n${kids}\n${pad}}`;
      }
      const params = [];
      uni(params, d, idParams);
      const kids = (d.blocks || []).map((b) => decompileBlock(b, indent + 1)).join('\n');
      return `${pad}CARD${paramList(params)} {\n${kids}\n${pad}}`;
    }
    case 'hero': {
      const params = [];
      if (d.image) params.push(`image: ${q(d.image)}`);
      if (d.height && d.height !== 'md') params.push(`height: ${d.height}`);
      if (d.overlay != null && Number(d.overlay) > 0) params.push(`overlay: ${d.overlay}`);
      if (d.parallax) params.push('parallax: true');
      uni(params, d, idParams);
      const kids = [];
      if (d.title) kids.push(`${pad}  HEADING(level: 1) { ${escBody(d.title)} }`);
      if (d.subtitle) kids.push(`${pad}  TEXT { ${escBody(d.subtitle)} }`);
      if (d.buttonText) {
        kids.push(`${pad}  BUTTON(url: ${q(d.buttonUrl || '#')}) { ${escBody(d.buttonText)} }`);
      }
      return `${pad}HERO${paramList(params)} {\n${kids.join('\n')}\n${pad}}`;
    }
    case 'testimonial': {
      const params = [];
      if (d.author) params.push(`author: ${q(d.author)}`);
      if (d.role) params.push(`role: ${q(d.role)}`);
      uni(params, d, idParams);
      return `${pad}TESTIMONIAL${paramList(params)} { ${escBody(d.quote || d.text || '')} }`;
    }
    case 'marquee': {
      const params = [];
      const effect = ['marquee', 'fade', 'slide', 'typewriter'].includes(d.effect) ? d.effect : 'marquee';
      if (effect !== 'marquee') params.push(`effect: ${effect}`);
      if (d.speed && d.speed !== 'md') params.push(`speed: ${d.speed}`);
      uni(params, d, idParams);
      return `${pad}MOTION${paramList(params)} { ${escBody(d.text || '')} }`;
    }
    case 'parallax': {
      const params = [`image: ${q(d.image || '')}`];
      if (d.overlay != null && Number(d.overlay) > 0) params.push(`overlay: ${d.overlay}`);
      if (d.height && d.height !== 'md') params.push(`height: ${d.height}`);
      if (d.tint && d.tint !== 'none') params.push(`tint: ${d.tint}`);
      if (d.fade === true || d.fade === 'true') params.push('fade: true');
      uni(params, d, idParams);
      const kids = (d.blocks || []).map((b) => decompileBlock(b, indent + 1)).join('\n');
      return `${pad}BACKDROP${paramList(params)} {\n${kids}\n${pad}}`;
    }
    case 'gallery': {
      const params = [];
      if (d.columns && d.columns !== 3) params.push(`columns: ${d.columns}`);
      uni(params, d, idParams);
      const imgs = (d.images || [])
        .map((img) => {
          const src = typeof img === 'string' ? img : img.src || '';
          const alt = typeof img === 'string' ? '' : img.alt || '';
          const cap = typeof img === 'string' ? '' : img.caption || '';
          const ps = [`src: ${q(src)}`];
          if (alt) ps.push(`alt: ${q(alt)}`);
          if (cap) ps.push(`caption: ${q(cap)}`);
          return `${pad}  IMAGE${paramList(ps)}`;
        })
        .join('\n');
      return `${pad}GALLERY${paramList(params)} {\n${imgs}\n${pad}}`;
    }
    case 'features': {
      const params = [];
      if (d.columns && d.columns !== 3) params.push(`columns: ${d.columns}`);
      uni(params, d, idParams);
      const feats = (d.items || [])
        .map((it) => {
          const title = typeof it === 'string' ? it : it.title || '';
          const desc = typeof it === 'string' ? '' : it.description || '';
          const icon = typeof it === 'string' ? '' : it.icon || '';
          const ps = [`title: ${q(title)}`];
          if (icon) ps.push(`icon: ${q(icon)}`);
          if (desc) return `${pad}  FEATURE${paramList(ps)} { ${escBody(desc)} }`;
          return `${pad}  FEATURE${paramList(ps)} { }`;
        })
        .join('\n');
      return `${pad}FEATURES${paramList(params)} {\n${feats}\n${pad}}`;
    }
    case 'embed': {
      const params = [`url: ${q(d.url || '')}`];
      uni(params, d, idParams);
      return `${pad}EMBED${paramList(params)}`;
    }
    case 'map': {
      const params = [`address: ${q(d.address || '')}`];
      if (d.zoom != null && Number(d.zoom) !== 15) params.push(`zoom: ${d.zoom}`);
      if (d.height && d.height !== 'md') params.push(`height: ${d.height}`);
      uni(params, d, idParams);
      return `${pad}MAP${paramList(params)}`;
    }
    case 'article-list': {
      const params = [];
      if (d.tag && d.tag !== 'article') params.push(`tag: ${q(d.tag)}`);
      if (d.limit && d.limit !== 6) params.push(`limit: ${d.limit}`);
      if (d.columns && d.columns !== 3) params.push(`columns: ${d.columns}`);
      uni(params, d, idParams);
      return `${pad}ARTICLES${paramList(params)}`;
    }
    case 'cta': {
      const style = d.variant === 'outline' ? 'ghost' : d.variant || 'primary';
      const params = [`title: ${q(d.title || '')}`, `url: ${q(d.url || '#')}`];
      if (d.text) params.push(`text: ${q(d.text)}`);
      if (d.buttonText) params.push(`buttontext: ${q(d.buttonText)}`);
      if (style !== 'primary') params.push(`style: ${style}`);
      if (d.tone && d.tone !== 'brand') params.push(`tone: ${d.tone}`);
      if (d.align && d.align !== 'start') params.push(`align: ${d.align}`);
      uni(params, d, idParams);
      return `${pad}CTA${paramList(params)}`;
    }
    case 'stats': {
      const params = [];
      if (d.columns && d.columns !== 3) params.push(`columns: ${d.columns}`);
      uni(params, d, idParams);
      const kids = (d.items || [])
        .map((it) => {
          const ps = [`value: ${q(it.value || '')}`, `label: ${q(it.label || '')}`];
          return `${pad}  STAT${paramList(ps)}`;
        })
        .join('\n');
      return `${pad}STATS${paramList(params)} {\n${kids}\n${pad}}`;
    }
    case 'logos': {
      const params = [];
      uni(params, d, idParams);
      const kids = (d.items || [])
        .map((it) => {
          const ps = [`src: ${q(it.src || '')}`];
          if (it.alt) ps.push(`alt: ${q(it.alt)}`);
          if (it.url) ps.push(`url: ${q(it.url)}`);
          return `${pad}  LOGO${paramList(ps)}`;
        })
        .join('\n');
      return `${pad}LOGOS${paramList(params)} {\n${kids}\n${pad}}`;
    }
    case 'faq': {
      const params = [];
      uni(params, d, idParams);
      const kids = (d.items || [])
        .map((it) => {
          const ps = [`question: ${q(it.question || '')}`];
          return `${pad}  QA${paramList(ps)} { ${escBody(it.answer || '')} }`;
        })
        .join('\n');
      return `${pad}FAQ${paramList(params)} {\n${kids}\n${pad}}`;
    }
    case 'contact-info': {
      const params = [];
      if (d.phone) params.push(`phone: ${q(d.phone)}`);
      if (d.email) params.push(`email: ${q(d.email)}`);
      if (d.address) params.push(`address: ${q(d.address)}`);
      if (d.hours) params.push(`hours: ${q(d.hours)}`);
      uni(params, d, idParams);
      return `${pad}CONTACT${paramList(params)}`;
    }
    case 'banner': {
      const params = [];
      if (d.tone && d.tone !== 'brand') params.push(`tone: ${d.tone}`);
      if (d.align && d.align !== 'start') params.push(`align: ${d.align}`);
      uni(params, d, idParams);
      return `${pad}BANNER${paramList(params)} { ${escBody(d.text || '')} }`;
    }
    case 'section': {
      const params = [];
      if (d.size && d.size !== 'md') params.push(`size: ${d.size}`);
      uni(params, d, idParams);
      const kids = (d.blocks || []).map((b) => decompileBlock(b, indent + 1)).join('\n');
      return `${pad}SECTION${paramList(params)} {\n${kids || pad + '  '}\n${pad}}`;
    }
    case 'tabs': {
      const params = [];
      uni(params, d, idParams);
      const kids = (d.items || [])
        .map((it) => childWithBody('TAB', [`label: ${q(it.label || '')}`], it.content, indent))
        .join('\n');
      return `${pad}TABS${paramList(params)} {\n${kids}\n${pad}}`;
    }
    case 'accordion': {
      const params = [];
      uni(params, d, idParams);
      const kids = (d.items || [])
        .map((it) => childWithBody('FOLD', [`title: ${q(it.title || '')}`], it.content, indent))
        .join('\n');
      return `${pad}ACCORDION${paramList(params)} {\n${kids}\n${pad}}`;
    }
    case 'form': {
      const params = [];
      if (d.action) params.push(`action: ${q(d.action)}`);
      if (d.method && d.method !== 'post') params.push(`method: ${d.method}`);
      if (d.submit && d.submit !== 'שליחה') params.push(`submit: ${q(d.submit)}`);
      uni(params, d, idParams);
      const kids = (d.fields || [])
        .map((f) => {
          const ps = [`label: ${q(f.label || '')}`];
          if (f.name) ps.push(`name: ${q(f.name)}`);
          if (f.type && f.type !== 'text') ps.push(`type: ${f.type}`);
          if (f.placeholder) ps.push(`placeholder: ${q(f.placeholder)}`);
          if (f.required) ps.push('required: true');
          if (Array.isArray(f.options) && f.options.length) ps.push(`options: ${JSON.stringify(f.options)}`);
          return `${pad}  FIELD${paramList(ps)}`;
        })
        .join('\n');
      return `${pad}FORM${paramList(params)} {\n${kids}\n${pad}}`;
    }
    case 'cards': {
      const params = [];
      uni(params, d, idParams);
      const kids = (d.items || [])
        .map((it) => {
          const ps = [`title: ${q(it.title || '')}`];
          if (it.image) ps.push(`image: ${q(it.image)}`);
          if (it.tag) ps.push(`tag: ${q(it.tag)}`);
          if (it.href && it.href !== '#') ps.push(`url: ${q(it.href)}`);
          return childWithBody('MEDIACARD', ps, it.excerpt, indent);
        })
        .join('\n');
      return `${pad}CARDS${paramList(params)} {\n${kids}\n${pad}}`;
    }
    case 'carousel': {
      const params = [];
      if (d.height && d.height !== 'md') params.push(`height: ${d.height}`);
      if (d.peek === false) params.push('peek: false');
      uni(params, d, idParams);
      const kids = (d.items || [])
        .map((it) => {
          const ps = [];
          if (it.title) ps.push(`title: ${q(it.title)}`);
          if (it.image) ps.push(`image: ${q(it.image)}`);
          if (it.tag) ps.push(`tag: ${q(it.tag)}`);
          if (it.href && it.href !== '#') ps.push(`url: ${q(it.href)}`);
          return childWithBody('SLIDE', ps, it.excerpt, indent);
        })
        .join('\n');
      return `${pad}CAROUSEL${paramList(params)} {\n${kids}\n${pad}}`;
    }
    case 'nav': {
      const params = [];
      if (d.background) params.push(`background: ${q(d.background)}`);
      if (d.color) params.push(`color: ${q(d.color)}`);
      if (d.align && d.align !== 'start') params.push(`align: ${d.align}`);
      uni(params, d, idParams);
      const kids = (d.items || [])
        .map((it) => `${pad}  NAVITEM(url: ${q(it.href || '#')}) { ${escBody(it.label || '')} }`)
        .join('\n');
      return `${pad}NAV${paramList(params)} {\n${kids}\n${pad}}`;
    }
    case 'ticker': {
      const params = [];
      if (d.label) params.push(`label: ${q(d.label)}`);
      if (d.speed && d.speed !== 'md') params.push(`speed: ${d.speed}`);
      if (d.background) params.push(`background: ${q(d.background)}`);
      if (d.color) params.push(`color: ${q(d.color)}`);
      uni(params, d, idParams);
      const kids = (d.items || [])
        .map((it) => {
          const ps = [];
          if (it.href && it.href !== '#') ps.push(`url: ${q(it.href)}`);
          return `${pad}  TICKERITEM${paramList(ps)} { ${escBody(it.text || '')} }`;
        })
        .join('\n');
      return `${pad}TICKER${paramList(params)} {\n${kids}\n${pad}}`;
    }
    case 'newspop': {
      const params = [];
      if (d.label) params.push(`label: ${q(d.label)}`);
      uni(params, d, idParams);
      const kids = (d.items || [])
        .map((it) => {
          const ps = [];
          if (it.time) ps.push(`time: ${q(it.time)}`);
          if (it.href && it.href !== '#') ps.push(`url: ${q(it.href)}`);
          return `${pad}  NEWSPOPITEM${paramList(ps)} { ${escBody(it.text || '')} }`;
        })
        .join('\n');
      return `${pad}NEWSPOP${paramList(params)} {\n${kids}\n${pad}}`;
    }
    case 'video': {
      const params = [`src: ${q(d.src || '')}`];
      if (d.poster) params.push(`poster: ${q(d.poster)}`);
      if (d.caption) params.push(`caption: ${q(d.caption)}`);
      if (d.controls === false) params.push('controls: false');
      if (d.autoplay) params.push('autoplay: true');
      if (d.loop) params.push('loop: true');
      if (d.muted) params.push('muted: true');
      uni(params, d, idParams);
      return `${pad}VIDEO${paramList(params)}`;
    }
    case 'category': {
      const params = [`slug: ${q(d.slug || '')}`];
      if (d.limit != null && Number(d.limit) !== 6) params.push(`limit: ${d.limit}`);
      if (d.showheader === false) params.push('showheader: false');
      uni(params, d, idParams);
      return `${pad}CATEGORY${paramList(params)}`;
    }
    default:
      return `${pad}// unknown block type: ${type} — extend decompiler`;
  }
}

/** TAB/FOLD/MEDIACARD: params on the keyword, the content as the body. */
function childWithBody(kw, ps, content, indent) {
  const pad = '  '.repeat(indent);
  const body = String(content || '');
  if (!body) return `${pad}  ${kw}(${ps.join(', ')}) { }`;
  if (!body.includes('\n')) return `${pad}  ${kw}(${ps.join(', ')}) { ${escBody(body)} }`;
  return `${pad}  ${kw}(${ps.join(', ')}) {\n${indentBody(body, indent + 2)}\n${pad}  }`;
}

function paramList(params) {
  if (!params || !params.length) return '';
  return `(${params.join(', ')})`;
}

function q(s) {
  return JSON.stringify(String(s ?? ''));
}

/**
 * Escape body so `}` inside @B{…} does not close the keyword body.
 * Parse unescapes \{ \} back; renderInlineMarks then sees @B{world}.
 */
function escBody(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}

function indentBody(body, level) {
  const pad = '  '.repeat(level);
  return String(body)
    .split('\n')
    .map((l) => pad + escBody(l))
    .join('\n');
}

function sizeFromHeight(h) {
  const map = { '0.75rem': 'sm', '1.5rem': 'md', '2rem': 'md', '2.5rem': 'lg', '4rem': 'xl' };
  return map[h] || null;
}

module.exports = { decompile, decompileBlock };
