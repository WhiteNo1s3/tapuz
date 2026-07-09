#!/usr/bin/env node

/**
 * Tapuz Elementor Migration
 * Rescues real content from Elementor-heavy WXR exports into structured blocks.
 */

const fs = require('fs');
const {
  createPage,
  getPageByFullPath,
  listPages,
  deletePage
} = require('../src/pages');
const {
  createHeading,
  createText,
  createImage,
  createButton,
  createHero,
  createTestimonial,
  createFeatures,
  createBlock
} = require('../src/blocks');

// =====================================================
// WXR parse
// =====================================================

function parseWXR(xml) {
  const pages = [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  const skipKeywords = [
    'header', 'footer', 'archive', 'single', 'search', '404', 'popup', 'template',
    'default kit', 'trashed', 'ghostwright', 'salvage', 'guard test',
    'elementor עמוד #', 'אלמנטור עמוד #', 'grokin build test', 'gemini garden test',
    'modern cyberpunk'
  ];

  for (const item of items) {
    let title = extractValue(item, 'title');
    if (!title) continue;
    title = title.trim();

    let postType = (extractValue(item, 'wp:post_type') || 'post').trim();
    const status = extractValue(item, 'wp:status') || 'publish';

    const isRealPage = postType === 'page';
    const isLibrary = postType === 'elementor_library';
    if (!isRealPage && !isLibrary) continue;

    const lower = title.toLowerCase();
    if (skipKeywords.some((k) => lower.includes(k))) continue;

    let content = extractCDATA(item, 'content:encoded') || '';

    // Robust _elementor_data extraction (CDATA)
    let elementorData = null;
    const keyPos = item.indexOf('_elementor_data');
    if (keyPos !== -1) {
      const v = item.indexOf('<![CDATA[', keyPos);
      if (v !== -1) {
        const e = item.indexOf(']]>', v + 9);
        if (e !== -1) elementorData = item.substring(v + 9, e);
      }
    }

    if (!content.trim() && !elementorData) continue;

    const slug = slugify(title);

    pages.push({
      title,
      slug,
      content,
      elementorData,
      status: status === 'publish' ? 'published' : 'draft',
      postType
    });
  }

  // Dedup by title
  const seen = new Set();
  return pages.filter((p) => {
    const k = p.title.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function extractValue(item, tag) {
  const open = '<' + tag;
  const close = '</' + tag + '>';
  const start = item.indexOf(open);
  if (start === -1) return '';
  const gt = item.indexOf('>', start);
  if (gt === -1) return '';
  const end = item.indexOf(close, gt);
  if (end === -1) return '';
  let val = item.substring(gt + 1, end).trim();
  if (val.startsWith('<![CDATA[') && val.endsWith(']]>')) {
    val = val.slice(9, -3);
  }
  return val;
}

function extractCDATA(item, tag) {
  const open = '<' + tag;
  const start = item.indexOf(open);
  if (start === -1) return '';
  const cdata = item.indexOf('<![CDATA[', start);
  if (cdata === -1) return extractValue(item, tag);
  const end = item.indexOf(']]>', cdata);
  if (end === -1) return '';
  return item.substring(cdata + 9, end);
}

function slugify(text) {
  let s = String(text || '').toLowerCase();
  s = s.replace(/^(white\s*no1se|whiteno1se)[\s\-–—:]*/i, '');

  const hebrewMap = {
    א: 'a', ב: 'b', ג: 'g', ד: 'd', ה: 'h', ו: 'v', ז: 'z',
    ח: 'ch', ט: 't', י: 'y', כ: 'k', ך: 'k', ל: 'l', מ: 'm', ם: 'm',
    נ: 'n', ן: 'n', ס: 's', ע: 'a', פ: 'p', ף: 'p', צ: 'ts', ץ: 'ts',
    ק: 'k', ר: 'r', ש: 'sh', ת: 't'
  };

  let result = '';
  for (const char of s) {
    if (hebrewMap[char]) result += hebrewMap[char];
    else if (/[a-z0-9]/.test(char)) result += char;
    else if (char === ' ' || char === '-' || char === '–' || char === '—' || char === '_' || char === '/') {
      result += '-';
    }
  }

  result = result.replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (result.length > 55) result = result.substring(0, 55).replace(/-$/, '');
  return result || 'page';
}

function cleanText(str) {
  if (!str) return '';
  return String(str)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function uniqueSlug(base) {
  let slug = base || 'page';
  if (!getPageByFullPath(slug)) return slug;
  let i = 2;
  while (getPageByFullPath(slug + '-' + i)) i++;
  return slug + '-' + i;
}

// =====================================================
// Elementor → Tapuz blocks
// =====================================================

function parseElementorData(jsonString) {
  if (!jsonString) return [];

  let data;
  try {
    data = JSON.parse(jsonString);
  } catch (e) {
    try {
      data = JSON.parse(jsonString.replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    } catch (e2) {
      try {
        data = JSON.parse(jsonString.replace(/\\/g, ''));
      } catch (e3) {
        return [];
      }
    }
  }
  if (!Array.isArray(data)) return [];

  return flattenRoot(data);
}

function flattenRoot(elements) {
  const out = [];
  for (const el of elements || []) {
    const chunks = convertNode(el);
    for (const c of chunks) if (c) out.push(c);
  }
  return out;
}

function convertNode(el) {
  if (!el) return [];
  const type = el.elType || '';

  // Nested sections / containers: recurse
  if (type === 'section' || type === 'container') {
    return convertSectionLike(el);
  }

  if (type === 'column') {
    return convertChildren(el.elements || []);
  }

  if (type === 'widget') {
    const b = convertWidget(el);
    return b ? [b] : [];
  }

  // unknown — try children
  return convertChildren(el.elements || []);
}

function convertChildren(elements) {
  const out = [];
  for (const child of elements || []) {
    for (const b of convertNode(child)) out.push(b);
  }
  return out;
}

function convertSectionLike(el) {
  const children = el.elements || [];
  // Elementor classic: section → columns
  const columns = children.filter((c) => c.elType === 'column');
  if (columns.length >= 2) {
    const colBlocks = columns.map((col) => ({
      blocks: convertChildren(col.elements || [])
    }));
    // if only one column has content and others empty, still keep columns
    const nonEmpty = colBlocks.filter((c) => c.blocks.length > 0).length;
    if (nonEmpty >= 2) {
      return [
        createBlock('columns', {
          columns: colBlocks.map((c) => ({
            blocks: c.blocks.length ? c.blocks : [createText('')]
          }))
        })
      ];
    }
    // mostly single-column content — flatten
    return convertChildren(children);
  }

  // container flex with multiple widgets side-by-side: keep flat for now
  return convertChildren(children);
}

function convertWidget(el) {
  const w = el.widgetType || '';
  const s = el.settings || {};
  const cls = s._css_classes || s.css_classes || '';
  const extra = {};
  if (cls) extra.className = cls;
  if (s.css_id) extra.id = s.css_id;

  if (w === 'heading' && s.title) {
    const lvl =
      s.header_size === 'h1' ? 1 :
      s.header_size === 'h3' ? 3 :
      s.header_size === 'h4' ? 4 :
      s.header_size === 'h5' ? 5 :
      s.header_size === 'h6' ? 6 : 2;
    const b = createHeading(cleanText(s.title), lvl);
    Object.assign(b.data, extra);
    return b;
  }

  if ((w === 'text-editor' || w === 'text' || w === 'theme-post-content') && (s.editor || s.content)) {
    const t = cleanText(s.editor || s.content);
    if (t.length > 2) {
      const b = createText(t);
      Object.assign(b.data, extra);
      return b;
    }
    return null;
  }

  if (w === 'image' && (s.image?.url || s.url)) {
    const b = createImage(s.image?.url || s.url, s.image?.alt || s.caption || s.alt || '');
    Object.assign(b.data, extra);
    return b;
  }

  if (w === 'button' && (s.text || s.button_text)) {
    const b = createButton(cleanText(s.text || s.button_text), (s.link && s.link.url) || s.url || '#');
    Object.assign(b.data, extra);
    return b;
  }

  if (w === 'icon-box' || w === 'image-box') {
    const title = cleanText(s.title_text || s.title || '');
    const desc = cleanText(s.description_text || s.description || '');
    // map to features single-item for rich cards, or heading+text
    if (title || desc) {
      const b = createFeatures([{ title: title || 'פריט', description: desc }]);
      Object.assign(b.data, extra);
      return b;
    }
    return null;
  }

  if (w === 'counter') {
    const num = s.ending_number != null ? String(s.ending_number) : '';
    const suffix = s.suffix || '';
    const title = cleanText(s.title || '');
    const line = [num + suffix, title].filter(Boolean).join(' — ');
    if (!line) return null;
    const b = createHeading(line, 3);
    Object.assign(b.data, extra, { className: (extra.className || '') + ' counter'.trim() });
    return b;
  }

  if (w === 'icon-list' && Array.isArray(s.icon_list)) {
    const lines = s.icon_list
      .map((it) => cleanText(it.text || it.title || ''))
      .filter(Boolean);
    if (!lines.length) return null;
    const b = createBlock('list', { items: lines, ordered: false, ...extra });
    return b;
  }

  if (String(w).includes('testimonial')) {
    const quote = cleanText(s.testimonial_content || s.content || s.quote || '');
    const author = cleanText(s.testimonial_name || s.name || s.author || '');
    const role = cleanText(s.testimonial_job || s.job || s.role || '');
    if (!quote && !author) return null;
    const b = createTestimonial(quote, author, role);
    Object.assign(b.data, extra);
    return b;
  }

  if (w === 'slides' && Array.isArray(s.slides)) {
    // Represent slideshow as columns of feature cards
    const cols = s.slides.map((slide) => {
      const kids = [];
      if (slide.heading) kids.push(createHeading(cleanText(slide.heading), 3));
      if (slide.description) kids.push(createText(cleanText(slide.description)));
      if (slide.button_text) {
        kids.push(createButton(cleanText(slide.button_text), (slide.link && slide.link.url) || '#'));
      }
      if (!kids.length) kids.push(createText(''));
      return { blocks: kids };
    });
    if (cols.length >= 2) return createBlock('columns', { columns: cols, ...extra });
    if (cols.length === 1) return cols[0].blocks[0] || null;
    return null;
  }

  if (w === 'posts' || w === 'portfolio' || w === 'loop-grid') {
    const label = w === 'portfolio' ? 'פורטפוליו' : 'מאמרים אחרונים';
    const b = createText('[[' + label + ' — תוכן דינמי מיובא כמקום שמור]]');
    Object.assign(b.data, extra, { className: ((extra.className || '') + ' dynamic-posts').trim() });
    return b;
  }

  if (w === 'form' || w === 'contact-form-7') {
    const name = cleanText(s.form_name || 'טופס יצירת קשר');
    const btn = cleanText(s.button_text || 'שליחה');
    const b = createText(name + '\n\n[טופס — ' + btn + ']');
    Object.assign(b.data, extra);
    return b;
  }

  if (w === 'video' && (s.youtube_url || s.vimeo_url || s.hosted_url)) {
    return createBlock('embed', {
      url: s.youtube_url || s.vimeo_url || s.hosted_url || '',
      ...extra
    });
  }

  if (w === 'spacer' || w === 'divider') {
    return w === 'spacer'
      ? createBlock('spacer', { height: (s.space && s.space.size ? s.space.size + 'px' : '40px'), ...extra })
      : createBlock('divider', { ...extra });
  }

  if (w === 'menu-anchor' || w === 'html' && !s.html) {
    return null; // skip anchors / empty
  }

  if (w === 'html' && s.html) {
    const t = cleanText(s.html);
    if (t.length > 3) {
      const b = createText(t);
      Object.assign(b.data, extra);
      return b;
    }
  }

  // Generic fallbacks
  if (s.title && typeof s.title === 'string') {
    const b = createHeading(cleanText(s.title), 2);
    Object.assign(b.data, extra);
    return b;
  }
  if (s.editor || s.content || s.description_text) {
    const t = cleanText(s.editor || s.content || s.description_text);
    if (t.length > 3) {
      const b = createText(t);
      Object.assign(b.data, extra);
      return b;
    }
  }

  return null;
}

// =====================================================
// HTML fallback
// =====================================================

function htmlToBlocks(html) {
  const blocks = [];
  if (!html) return blocks;
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  const parts = html.split(/(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>|<p[^>]*>[\s\S]*?<\/p>|<img[^>]*>|<a[^>]*>[\s\S]*?<\/a>)/gi);
  for (let part of parts) {
    if (!part || part.trim().length < 3) continue;
    const h = part.match(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/i);
    if (h) {
      const t = cleanText(h[2]);
      if (t) blocks.push(createHeading(t, parseInt(h[1], 10)));
      continue;
    }
    const img = part.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
    if (img) {
      blocks.push(createImage(img[1], ''));
      continue;
    }
    const a = part.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (a && !part.includes('<p')) {
      const t = cleanText(a[2]);
      if (t) blocks.push(createButton(t, a[1]));
      continue;
    }
    const p = part.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (p) {
      const t = cleanText(p[1]);
      if (t.length > 3) blocks.push(createText(t));
    }
  }
  if (blocks.length === 0) {
    const plain = cleanText(html);
    if (plain.length > 5) blocks.push(createText(plain));
  }
  return blocks;
}

function promoteHero(blocks) {
  if (!blocks.length) return blocks;
  if (blocks[0].type === 'heading') {
    const h = blocks.shift();
    blocks.unshift(
      createHero(h.data.text || h.data.title || 'כותרת', '')
    );
  } else if (blocks[0].type === 'hero') {
    // ok
  }
  return blocks;
}

function countBlocks(list) {
  let n = 0;
  (list || []).forEach((b) => {
    n += 1;
    if (b.type === 'columns' && b.data && Array.isArray(b.data.columns)) {
      b.data.columns.forEach((c) => {
        n += countBlocks(c.blocks);
      });
    }
  });
  return n;
}

// =====================================================
// Migrate
// =====================================================

async function migrate(filePath, opts = {}) {
  console.log('\n=== Tapuz Elementor Migration ===\n');

  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
  }

  if (opts.clear) {
    const existing = listPages();
    console.log(`Clearing ${existing.length} existing pages...`);
    for (const p of existing) deletePage(p.full_path);
  }

  const xml = fs.readFileSync(filePath, 'utf8');
  const wpPages = parseWXR(xml);
  console.log(`Found ${wpPages.length} usable pages\n`);

  let imported = 0;
  let usedElementor = 0;
  let withColumns = 0;

  for (const wp of wpPages) {
    console.log(`→ ${wp.title}`);

    let blocks = [];
    let fromEl = false;

    // Prefer Elementor when present — content is often empty/short.
    // Count nested blocks so a single rich columns block is not treated as thin.
    if (wp.elementorData) {
      const elBlocks = parseElementorData(wp.elementorData);
      if (countBlocks(elBlocks) > 0) {
        blocks = elBlocks;
        fromEl = true;
        usedElementor++;
      }
    }

    if (!fromEl && wp.content && wp.content.trim().length > 20) {
      blocks = htmlToBlocks(wp.content);
    } else if (fromEl && countBlocks(blocks) < 2 && wp.content && wp.content.trim().length > 20) {
      const htmlBlocks = htmlToBlocks(wp.content);
      if (countBlocks(htmlBlocks) > countBlocks(blocks)) blocks = htmlBlocks;
    }

    // Don't promote heading→hero when the page is already a multi-column layout block
    if (!(blocks.length === 1 && blocks[0].type === 'columns')) {
      blocks = promoteHero(blocks);
    }

    if (blocks.length === 0) {
      blocks = [createText('תוכן יובא מ-Elementor (ריק)')];
    }

    if (blocks.some((b) => b.type === 'columns')) withColumns++;

    const slug = uniqueSlug(wp.slug);

    try {
      createPage({
        title: wp.title,
        slug,
        path_prefix: '',
        direction: 'rtl',
        blocks,
        status: wp.status
      });
      imported++;
      console.log(`   ✓ ${slug} · ${countBlocks(blocks)} blocks${fromEl ? ' · elementor' : ''}`);
    } catch (e) {
      console.error('   Error:', e.message);
    }
  }

  console.log(`\n=== Finished ===`);
  console.log(`Imported: ${imported}`);
  console.log(`Used Elementor data: ${usedElementor}`);
  console.log(`Pages with columns: ${withColumns}`);
  console.log(`\nRun: ./bin/tapuz.js build`);
}

module.exports = { migrate, parseElementorData, parseWXR, slugify };

if (require.main === module) {
  const args = process.argv.slice(2);
  const clear = args.includes('--clear');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.log('Usage: node scripts/migrate-wp.js <export.xml> [--clear]');
    process.exit(1);
  }
  migrate(file, { clear }).catch(console.error);
}
