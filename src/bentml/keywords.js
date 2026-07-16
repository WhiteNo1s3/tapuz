'use strict';

/**
 * Keyword registry — v0.1 body keywords from docs/bentml-v0.md §10.
 * Wired to existing Tapuz JSON block types (src/blocks.js / renderer).
 */

/** @typedef {'TEXT-BODY'|'BLOCK-BODY'|'NO-BODY'|'META'|'HTML'} BodyClass */

/**
 * @type {Record<string, {
 *   body: BodyClass,
 *   jsonType?: string,
 *   childOnly?: boolean,
 *   parent?: string,
 *   children?: string[],
 *   params?: Record<string, { type: string, default?: *, required?: boolean, values?: string[] }>
 * }>}
 */
const KEYWORDS = {
  META: { body: 'META' },

  HEADING: {
    body: 'TEXT-BODY',
    jsonType: 'heading',
    params: {
      level: { type: 'integer', default: 2 },
      align: { type: 'enum', default: 'start', values: ['start', 'center', 'end'] },
      animate: { type: 'enum', default: 'none', values: ['none', 'fade', 'rise'] }
    }
  },
  TEXT: {
    body: 'TEXT-BODY',
    jsonType: 'text',
    params: {
      align: { type: 'enum', default: 'start', values: ['start', 'center', 'end'] },
      size: { type: 'enum', default: 'md', values: ['sm', 'md', 'lg'] },
      lead: { type: 'boolean', default: false },
      dropcap: { type: 'boolean', default: false },
      maxwidth: { type: 'enum', default: 'full', values: ['sm', 'md', 'lg', 'full'] },
      animate: { type: 'enum', default: 'none', values: ['none', 'fade', 'rise'] }
    }
  },
  IMAGE: {
    body: 'NO-BODY',
    jsonType: 'image',
    params: {
      src: { type: 'string', required: true },
      alt: { type: 'string', default: '' },
      caption: { type: 'string' },
      width: { type: 'enum', default: 'full', values: ['sm', 'md', 'lg', 'full'] }
    }
  },
  BUTTON: {
    body: 'TEXT-BODY',
    jsonType: 'button',
    params: {
      url: { type: 'string', required: true },
      style: { type: 'enum', default: 'primary', values: ['primary', 'secondary', 'ghost'] },
      align: { type: 'enum', default: 'start', values: ['start', 'center', 'end'] }
    }
  },
  ROW: {
    body: 'BLOCK-BODY',
    jsonType: 'columns',
    children: ['COL'],
    params: {
      ratio: { type: 'string' },
      gap: { type: 'enum', default: 'md', values: ['none', 'sm', 'md', 'lg'] },
      collapse: { type: 'enum', default: 'md', values: ['sm', 'md', 'lg', 'never'] },
      valign: { type: 'enum', default: 'top', values: ['top', 'center', 'bottom', 'stretch'] }
    }
  },
  COL: {
    body: 'BLOCK-BODY',
    childOnly: true,
    parent: 'ROW'
  },
  SPACE: {
    body: 'NO-BODY',
    jsonType: 'spacer',
    params: {
      size: { type: 'enum', default: 'md', values: ['sm', 'md', 'lg', 'xl'] }
    }
  },
  DIVIDER: {
    body: 'NO-BODY',
    jsonType: 'divider',
    params: {
      style: { type: 'enum', default: 'line', values: ['line', 'dots', 'thick'] }
    }
  },
  LIST: {
    body: 'BLOCK-BODY',
    jsonType: 'list',
    children: ['ITEM'],
    params: {
      type: { type: 'enum', default: 'bullet', values: ['bullet', 'number'] }
    }
  },
  ITEM: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'LIST'
  },
  QUOTE: {
    body: 'TEXT-BODY',
    jsonType: 'quote',
    params: {
      author: { type: 'string' }
    }
  },
  CARD: {
    body: 'BLOCK-BODY',
    jsonType: 'card'
  },
  HERO: {
    body: 'BLOCK-BODY',
    jsonType: 'hero',
    params: {
      image: { type: 'string' },
      height: { type: 'enum', default: 'md', values: ['sm', 'md', 'lg', 'full'] },
      overlay: { type: 'integer', default: 0 },
      parallax: { type: 'boolean', default: false }
    }
  },
  // Alias of MOTION(effect: marquee) — kept so older sources keep compiling.
  // Canonical decompile output is MOTION (see decompile.js).
  MARQUEE: {
    body: 'TEXT-BODY',
    jsonType: 'marquee',
    aliasOf: 'MOTION',
    params: {
      speed: { type: 'enum', default: 'md', values: ['slow', 'md', 'fast'] }
    }
  },
  // Alias of BACKDROP — kept so older sources keep compiling.
  // Canonical decompile output is BACKDROP (see decompile.js).
  PARALLAX: {
    body: 'BLOCK-BODY',
    jsonType: 'parallax',
    aliasOf: 'BACKDROP',
    params: {
      image: { type: 'string' },
      overlay: { type: 'integer', default: 0 },
      height: { type: 'enum', default: 'md', values: ['sm', 'md', 'lg', 'full'] }
    }
  },
  TESTIMONIAL: {
    body: 'TEXT-BODY',
    jsonType: 'testimonial',
    params: {
      author: { type: 'string' },
      role: { type: 'string' }
    }
  },
  GALLERY: {
    body: 'BLOCK-BODY',
    jsonType: 'gallery',
    children: ['IMAGE'],
    params: {
      columns: { type: 'integer', default: 3 }
    }
  },
  FEATURES: {
    body: 'BLOCK-BODY',
    jsonType: 'features',
    children: ['FEATURE'],
    params: {
      columns: { type: 'integer', default: 3 }
    }
  },
  FEATURE: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'FEATURES',
    params: {
      title: { type: 'string', required: true },
      icon: { type: 'string' }
    }
  },
  EMBED: {
    body: 'NO-BODY',
    jsonType: 'embed',
    params: {
      url: { type: 'string', required: true }
    }
  },
  ARTICLES: {
    body: 'NO-BODY',
    jsonType: 'article-list',
    params: {
      tag: { type: 'string', default: 'article' },
      limit: { type: 'integer', default: 6 },
      columns: { type: 'integer', default: 3 }
    }
  },
  // since 0.2 (MINOR addition per docs/bentml-v0.md §17)
  MAP: {
    body: 'NO-BODY',
    jsonType: 'map',
    since: { major: 0, minor: 2 },
    params: {
      address: { type: 'string', required: true },
      zoom: { type: 'integer', default: 15 },
      height: { type: 'enum', default: 'md', values: ['sm', 'md', 'lg'] }
    }
  },
  // Canonical moving-text keyword. effect: marquee = the horizontal scroll
  // ("moving text"); fade/slide/typewriter = CSS entrance animations. Renders
  // as the `marquee` type (MARQUEE is the alias). Reduced-motion safe.
  MOTION: {
    body: 'TEXT-BODY',
    jsonType: 'marquee',
    params: {
      effect: { type: 'enum', default: 'marquee', values: ['marquee', 'fade', 'slide', 'typewriter'] },
      speed: { type: 'enum', default: 'md', values: ['slow', 'md', 'fast'] }
    }
  },
  // Canonical fixed-background keyword — the content scrolls over a pinned
  // image. Renders as the `parallax` type (PARALLAX is the alias).
  BACKDROP: {
    body: 'BLOCK-BODY',
    jsonType: 'parallax',
    params: {
      // image not `required` at the language level so an empty-image block
      // round-trips without E306 (the registry marks it required for the form).
      image: { type: 'string' },
      overlay: { type: 'integer', default: 0 },
      height: { type: 'enum', default: 'md', values: ['sm', 'md', 'lg', 'full'] },
      tint: { type: 'enum', default: 'none', values: ['none', 'dark', 'light', 'brand'] },
      fade: { type: 'boolean', default: false }
    }
  },
  HTML: { body: 'HTML' },

  // Enterprise / company-page modules
  CTA: {
    body: 'NO-BODY',
    jsonType: 'cta',
    params: {
      title: { type: 'string', required: true },
      text: { type: 'string' },
      buttontext: { type: 'string', default: 'לפרטים' },
      url: { type: 'string', required: true },
      style: { type: 'enum', default: 'primary', values: ['primary', 'secondary', 'ghost'] },
      tone: { type: 'enum', default: 'brand', values: ['brand', 'dark', 'light'] },
      align: { type: 'enum', default: 'start', values: ['start', 'center', 'end'] }
    }
  },
  STATS: {
    body: 'BLOCK-BODY',
    jsonType: 'stats',
    children: ['STAT'],
    params: {
      columns: { type: 'integer', default: 3 }
    }
  },
  STAT: {
    body: 'NO-BODY',
    childOnly: true,
    parent: 'STATS',
    params: {
      value: { type: 'string', required: true },
      label: { type: 'string', required: true }
    }
  },
  LOGOS: {
    body: 'BLOCK-BODY',
    jsonType: 'logos',
    children: ['LOGO'],
    params: {}
  },
  LOGO: {
    body: 'NO-BODY',
    childOnly: true,
    parent: 'LOGOS',
    params: {
      src: { type: 'string', required: true },
      alt: { type: 'string' },
      url: { type: 'string' }
    }
  },
  FAQ: {
    body: 'BLOCK-BODY',
    jsonType: 'faq',
    children: ['QA'],
    params: {}
  },
  QA: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'FAQ',
    params: {
      question: { type: 'string', required: true }
    }
  },
  TABS: {
    body: 'NO-BODY',
    jsonType: 'tabs',
    params: {}
  },
  ACCORDION: {
    body: 'NO-BODY',
    jsonType: 'accordion',
    params: {}
  },
  FORM: {
    body: 'NO-BODY',
    jsonType: 'form',
    params: {
      action: { type: 'string' },
      method: { type: 'enum', values: ['post', 'get'], default: 'post' },
      submit: { type: 'string', default: 'שליחה' }
    }
  },
  CARDS: {
    body: 'NO-BODY',
    jsonType: 'cards',
    params: {}
  },
  NAV: {
    body: 'NO-BODY',
    jsonType: 'nav',
    params: {
      background: { type: 'string' },
      color: { type: 'string' },
      align: { type: 'enum', values: ['start', 'center', 'end'], default: 'start' }
    }
  },
  TICKER: {
    body: 'NO-BODY',
    jsonType: 'ticker',
    params: {
      label: { type: 'string' },
      speed: { type: 'enum', values: ['slow', 'md', 'fast'], default: 'md' },
      background: { type: 'string' },
      color: { type: 'string' }
    }
  },
  VIDEO: {
    body: 'NO-BODY',
    jsonType: 'video',
    params: {
      src: { type: 'string', required: true },
      poster: { type: 'string' },
      caption: { type: 'string' },
      controls: { type: 'boolean', default: true },
      autoplay: { type: 'boolean', default: false },
      loop: { type: 'boolean', default: false },
      muted: { type: 'boolean', default: false }
    }
  },
  CATEGORY: {
    body: 'NO-BODY',
    jsonType: 'category',
    params: {
      slug: { type: 'string', required: true },
      limit: { type: 'integer', default: 6 },
      showheader: { type: 'boolean', default: true }
    }
  },
  CONTACT: {
    body: 'NO-BODY',
    jsonType: 'contact-info',
    params: {
      phone: { type: 'string' },
      email: { type: 'string' },
      address: { type: 'string' },
      hours: { type: 'string' }
    }
  },
  BANNER: {
    body: 'TEXT-BODY',
    jsonType: 'banner',
    params: {
      tone: { type: 'enum', default: 'brand', values: ['brand', 'dark', 'light', 'warn'] },
      align: { type: 'enum', default: 'start', values: ['start', 'center', 'end'] }
    }
  }
};

const RESERVED = new Set([
  // FORM graduated v0.58, NAV graduated v0.60, VIDEO graduated v0.62. INPUT
  // stays a placeholder — form fields are the child `field` module (nav links
  // = child `navitem`). AUDIO is the natural next media graduation.
  'SECTION', 'INPUT', 'FOOTER', 'HEADER', 'CODE', 'TABLE',
  'AUDIO', 'SLIDER'
]);

const UNIVERSAL = new Set(['id', 'class', 'dir']);

function getKeyword(name) {
  if (!name) return null;
  const key = String(name).toUpperCase();
  return KEYWORDS[key] ? { name: key, ...KEYWORDS[key] } : null;
}

function isReserved(name) {
  return RESERVED.has(String(name).toUpperCase());
}

module.exports = {
  KEYWORDS,
  RESERVED,
  UNIVERSAL,
  getKeyword,
  isReserved
};
