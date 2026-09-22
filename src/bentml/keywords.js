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
      title: { type: 'string' },
      caption: { type: 'string' },
      link: { type: 'string' },
      width: { type: 'enum', default: 'full', values: ['sm', 'md', 'lg', 'full'] }
    }
  },
  BUTTON: {
    body: 'TEXT-BODY',
    jsonType: 'button',
    params: {
      url: { type: 'string', required: true },
      style: { type: 'enum', default: 'primary', values: ['primary', 'secondary', 'ghost'] },
      align: { type: 'enum', default: 'start', values: ['start', 'center', 'end'] },
      rel: { type: 'string' },
      target: { type: 'enum', default: '_self', values: ['_self', '_blank'] },
      title: { type: 'string' }
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
      valign: { type: 'enum', default: 'top', values: ['top', 'center', 'bottom', 'stretch'] },
      // v2.26 — the row breaks out of the content column (content|wide|full)
      width: { type: 'enum', default: 'content', values: ['content', 'wide', 'full'] }
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
      size: { type: 'enum', default: 'md', values: ['sm', 'md', 'lg', 'xl'] },
      // exact css length (e.g. 106px) — wins over size; written by drag-resize
      height: { type: 'string' }
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
  SECTION: {
    body: 'BLOCK-BODY',
    jsonType: 'section',
    params: {
      size: { type: 'enum', values: ['sm', 'md', 'lg', 'xl'] },
      // v2.56 — the stretch section (a full-width band, content in the column)
      width: { type: 'enum', default: 'content', values: ['content', 'wide', 'full'] }
    }
  },
  HERO: {
    body: 'BLOCK-BODY',
    jsonType: 'hero',
    params: {
      image: { type: 'string' },
      height: { type: 'enum', default: 'md', values: ['sm', 'md', 'lg', 'full'] },
      overlay: { type: 'integer', default: 0 },
      parallax: { type: 'boolean', default: false },
      // v2.56 — a band edge to edge
      width: { type: 'enum', default: 'content', values: ['content', 'wide', 'full'] }
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
      icon: { type: 'string' },
      url: { type: 'string' }
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
      fade: { type: 'boolean', default: false },
      // v2.56 — edge to edge, the content keeps the column
      width: { type: 'enum', default: 'content', values: ['content', 'wide', 'full'] }
    }
  },
  HTML: { body: 'HTML', jsonType: 'html', params: {
    note: { type: 'string' },
    provisional: { type: 'boolean' }
  } },

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
  SOCIAL: {
    body: 'BLOCK-BODY',
    jsonType: 'social',
    children: ['HANDLE'],
    params: {}
  },
  PRODUCTS: {
    body: 'BLOCK-BODY',
    jsonType: 'products',
    children: ['PRODUCT'],
    params: {
      columns: { type: 'integer', default: 3 }
    }
  },
  PRODUCT: {
    body: 'NO-BODY',
    childOnly: true,
    parent: 'PRODUCTS',
    params: {
      title: { type: 'string', required: true },
      price: { type: 'string' },
      image: { type: 'string' },
      url: { type: 'string' }
    }
  },
  HANDLE: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'SOCIAL',
    params: {
      network: { type: 'string' },
      url: { type: 'string', required: true }
    }
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
  // ── containers with typed children (v0.77): the whole builder vocabulary
  //    round-trips — content children follow the ITEM/FEATURE pattern
  //    (the link/label params on the keyword, the visible text as the body).
  TABS: {
    body: 'BLOCK-BODY',
    jsonType: 'tabs',
    children: ['TAB'],
    params: {}
  },
  TAB: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'TABS',
    params: {
      label: { type: 'string', required: true }
    }
  },
  ACCORDION: {
    body: 'BLOCK-BODY',
    jsonType: 'accordion',
    children: ['FOLD'],
    params: {}
  },
  FOLD: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'ACCORDION',
    params: {
      title: { type: 'string', required: true }
    }
  },
  FORM: {
    body: 'BLOCK-BODY',
    jsonType: 'form',
    children: ['FIELD'],
    params: {
      action: { type: 'string' },
      method: { type: 'enum', values: ['post', 'get'], default: 'post' },
      submit: { type: 'string', default: 'שליחה' }
    }
  },
  FIELD: {
    body: 'NO-BODY',
    childOnly: true,
    parent: 'FORM',
    params: {
      label: { type: 'string', required: true },
      name: { type: 'string' },
      type: { type: 'enum', values: ['text', 'email', 'tel', 'textarea', 'select', 'checkbox'], default: 'text' },
      placeholder: { type: 'string' },
      required: { type: 'boolean', default: false },
      options: { type: 'list' }
    }
  },
  CARDS: {
    body: 'BLOCK-BODY',
    jsonType: 'cards',
    children: ['MEDIACARD'],
    params: {}
  },
  CAROUSEL: {
    body: 'BLOCK-BODY',
    jsonType: 'carousel',
    children: ['SLIDE'],
    params: {
      height: { type: 'enum', values: ['sm', 'md', 'lg'], default: 'md' },
      peek: { type: 'boolean', default: true }
    }
  },
  SLIDE: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'CAROUSEL',
    params: {
      title: { type: 'string' },
      image: { type: 'string' },
      tag: { type: 'string' },
      url: { type: 'string' }
    }
  },
  MEDIACARD: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'CARDS',
    params: {
      title: { type: 'string', required: true },
      image: { type: 'string' },
      tag: { type: 'string' },
      url: { type: 'string' }
    }
  },
  PRICING: {
    body: 'BLOCK-BODY',
    jsonType: 'pricing',
    children: ['PLAN'],
    params: {}
  },
  PLAN: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'PRICING',
    // param names are single lowercase words in this dialect (parse.js
    // lowercases every key) — `cta` (button text) + `url` (button link),
    // matching the existing url-for-a-link convention (NAVITEM/MEDIACARD/
    // TICKERITEM/etc.) rather than the pzn registry's camelCase ctaLabel/ctaUrl.
    params: {
      title: { type: 'string', required: true },
      price: { type: 'string' },
      period: { type: 'string' },
      cta: { type: 'string' },
      url: { type: 'string' },
      highlighted: { type: 'boolean', default: false }
    }
  },
  STEPS: {
    body: 'BLOCK-BODY',
    jsonType: 'steps',
    children: ['STEP'],
    params: {}
  },
  STEP: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'STEPS',
    params: {
      title: { type: 'string', required: true },
      icon: { type: 'string' }
    }
  },
  TIMELINE: {
    body: 'BLOCK-BODY',
    jsonType: 'timeline',
    children: ['EVENT'],
    params: {}
  },
  EVENT: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'TIMELINE',
    params: {
      time: { type: 'string' },
      title: { type: 'string', required: true },
      image: { type: 'string' }
    }
  },
  CRUMBS: {
    body: 'BLOCK-BODY',
    jsonType: 'crumbs',
    children: ['CRUMB'],
    params: {}
  },
  CRUMB: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'CRUMBS',
    params: {
      url: { type: 'string' }
    }
  },
  TEAM: {
    body: 'BLOCK-BODY',
    jsonType: 'team',
    children: ['MEMBER'],
    params: {}
  },
  MEMBER: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'TEAM',
    params: {
      name: { type: 'string', required: true },
      role: { type: 'string' },
      image: { type: 'string' },
      url: { type: 'string' }
    }
  },
  COUNTDOWN: {
    body: 'TEXT-BODY',
    jsonType: 'countdown',
    params: {
      target: { type: 'string', required: true },
      done: { type: 'string' }
    }
  },
  PRICELIST: {
    body: 'BLOCK-BODY',
    jsonType: 'pricelist',
    children: ['PRICEITEM'],
    params: {}
  },
  PRICEITEM: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'PRICELIST',
    params: {
      name: { type: 'string', required: true },
      price: { type: 'string' }
    }
  },
  PROGRESS: {
    body: 'BLOCK-BODY',
    jsonType: 'progress',
    children: ['BAR'],
    params: {}
  },
  BAR: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'PROGRESS',
    params: {
      value: { type: 'integer', default: 0 },
      color: { type: 'string' }
    }
  },
  RATING: {
    body: 'TEXT-BODY',
    jsonType: 'rating',
    params: {
      value: { type: 'number', required: true },
      max: { type: 'integer', default: 5 }
    }
  },
  HOURS: {
    body: 'BLOCK-BODY',
    jsonType: 'hours',
    children: ['DAY'],
    params: {}
  },
  DAY: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'HOURS',
    params: {
      name: { type: 'string', required: true }
    }
  },
  TOC: {
    body: 'BLOCK-BODY',
    jsonType: 'toc',
    children: ['TOCITEM'],
    params: {
      title: { type: 'string' }
    }
  },
  TOCITEM: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'TOC',
    params: {
      anchor: { type: 'string' }
    }
  },
  AUTHOR: {
    body: 'TEXT-BODY',
    jsonType: 'author',
    params: {
      name: { type: 'string', required: true },
      image: { type: 'string' },
      url: { type: 'string' },
      linkLabel: { type: 'string' },
      role: { type: 'string' },
      time: { type: 'string' }
    }
  },
  COMPARE: {
    body: 'NO-BODY',
    jsonType: 'compare',
    params: {
      before: { type: 'string', required: true },
      after: { type: 'string', required: true },
      beforeLabel: { type: 'string' },
      afterLabel: { type: 'string' }
    }
  },
  FLIPBOX: {
    body: 'TEXT-BODY',
    jsonType: 'flipbox',
    params: {
      title: { type: 'string', required: true },
      icon: { type: 'string' },
      cta: { type: 'string' },
      url: { type: 'string' }
    }
  },
  // gap-audit wave 4 — HEADER/FOOTER leave RESERVED, but ONLY for the
  // decompile-preview path (decompileOnly): the compiler must accept a
  // decompiled draft that carries them, while the module catalog and the
  // primers never offer them — the site's real chrome is the theme master
  // (עיצוב → כותרת ותחתית)
  HEADER: {
    body: 'BLOCK-BODY',
    jsonType: 'header',
    decompileOnly: true,
    params: {
      tone: { type: 'enum', default: 'light', values: ['light', 'dark', 'brand', 'none'] },
      layout: { type: 'enum', default: 'row', values: ['row', 'stack'] }
    }
  },
  FOOTER: {
    body: 'BLOCK-BODY',
    jsonType: 'footer',
    decompileOnly: true,
    params: {
      tone: { type: 'enum', default: 'dark', values: ['dark', 'light', 'brand', 'none'] },
      credit: { type: 'string', default: '' }
    }
  },
  WHATSAPP: {
    body: 'TEXT-BODY',
    jsonType: 'whatsapp',
    params: {
      phone: { type: 'string', default: '' },
      message: { type: 'string', default: '' },
      note: { type: 'string', default: '' },
      url: { type: 'string', default: '' },
      align: { type: 'enum', default: 'start', values: ['start', 'center', 'end'] }
    }
  },
  NAV: {
    body: 'BLOCK-BODY',
    jsonType: 'nav',
    children: ['NAVITEM'],
    params: {
      background: { type: 'string' },
      color: { type: 'string' },
      align: { type: 'enum', values: ['start', 'center', 'end'], default: 'start' }
    }
  },
  NAVITEM: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'NAV',
    params: {
      url: { type: 'string', required: true }
    }
  },
  TICKER: {
    body: 'BLOCK-BODY',
    jsonType: 'ticker',
    children: ['TICKERITEM'],
    params: {
      label: { type: 'string' },
      speed: { type: 'enum', values: ['slow', 'md', 'fast'], default: 'md' },
      background: { type: 'string' },
      color: { type: 'string' }
    }
  },
  TICKERITEM: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'TICKER',
    params: {
      url: { type: 'string' }
    }
  },
  NEWSPOP: {
    body: 'BLOCK-BODY',
    jsonType: 'newspop',
    children: ['NEWSPOPITEM'],
    params: {
      label: { type: 'string' }
    }
  },
  NEWSPOPITEM: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'NEWSPOP',
    params: {
      time: { type: 'string' },
      url: { type: 'string' }
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
  TABLE: {
    body: 'BLOCK-BODY',
    jsonType: 'table',
    children: ['TROW'],
    params: {
      header: { type: 'boolean', default: true }
    }
  },
  TROW: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'TABLE',
    params: {}
  },
  AUDIO: {
    body: 'NO-BODY',
    jsonType: 'audio',
    params: {
      src: { type: 'string', required: true },
      caption: { type: 'string' },
      loop: { type: 'boolean', default: false }
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
  // the store (v2.53) — NO-BODY: a storefront module is its params. They read
  // the store's own catalog (חנות → מוצרים); the flip writes the shop, cart,
  // checkout and order pages out of them.
  SHOP: {
    body: 'NO-BODY',
    jsonType: 'shop',
    params: {
      shelf: { type: 'string', default: '' },
      columns: { type: 'integer', default: 3 },
      limit: { type: 'integer', default: 0 },
      sort: { type: 'enum', values: ['manual', 'new', 'price-asc', 'price-desc', 'name'], default: 'manual' },
      filter: { type: 'boolean', default: false },
      title: { type: 'string', default: '' },
      exclude: { type: 'string', default: '' },
      buttons: { type: 'boolean', default: true }
    }
  },
  BUY: {
    body: 'NO-BODY',
    jsonType: 'buy',
    params: {
      sku: { type: 'string', required: true },
      gallery: { type: 'boolean', default: true },
      description: { type: 'boolean', default: true }
    }
  },
  CART: {
    body: 'NO-BODY',
    jsonType: 'cart',
    params: {
      empty: { type: 'string', default: '' }
    }
  },
  CHECKOUT: {
    body: 'NO-BODY',
    jsonType: 'checkout',
    params: {}
  },
  ORDER: {
    body: 'NO-BODY',
    jsonType: 'order',
    params: {}
  },
  SEARCH: {
    body: 'NO-BODY',
    jsonType: 'search',
    params: {
      placeholder: { type: 'string', default: 'חיפוש…' },
      action: { type: 'string', default: '/search' },
      name: { type: 'string', default: 'q' },
      submit: { type: 'string', default: 'חיפוש' },
      method: { type: 'enum', values: ['get', 'post'], default: 'get' }
    }
  },
  NEWSLETTER: {
    body: 'TEXT-BODY',
    jsonType: 'newsletter',
    params: {
      title: { type: 'string' },
      placeholder: { type: 'string', default: 'האימייל שלכם' },
      submit: { type: 'string', default: 'הרשמה' },
      action: { type: 'string', default: '/api/form' }
    }
  },
  PAGER: {
    body: 'BLOCK-BODY',
    jsonType: 'pager',
    children: ['PAGE'],
    params: {
      label: { type: 'string' }
    }
  },
  PAGE: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'PAGER',
    params: {
      url: { type: 'string' },
      current: { type: 'boolean', default: false }
    }
  },
  CONSENT: {
    body: 'TEXT-BODY',
    jsonType: 'consent',
    params: {
      accept: { type: 'string', default: 'אישור' },
      reject: { type: 'string' },
      policy: { type: 'string' },
      policylabel: { type: 'string' }
    }
  },
  RELATED: {
    body: 'BLOCK-BODY',
    jsonType: 'related',
    children: ['RELCARD'],
    params: {
      title: { type: 'string' }
    }
  },
  RELCARD: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'RELATED',
    params: {
      title: { type: 'string', required: true },
      image: { type: 'string' },
      tag: { type: 'string' },
      url: { type: 'string' }
    }
  },
  COMMENTS: {
    body: 'BLOCK-BODY',
    jsonType: 'comments',
    children: ['COMMENT'],
    params: {
      title: { type: 'string' }
    }
  },
  COMMENT: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'COMMENTS',
    params: {
      author: { type: 'string' },
      time: { type: 'string' }
    }
  },
  SLOT: {
    body: 'NO-BODY',
    jsonType: 'slot',
    params: {
      label: { type: 'string', default: 'פרסומת' },
      src: { type: 'string' },
      url: { type: 'string' },
      advertiser: { type: 'string' }
    }
  },
  AUTH: {
    body: 'TEXT-BODY',
    jsonType: 'auth',
    params: {
      login: { type: 'string', default: 'כניסה' },
      loginurl: { type: 'string', default: '/login' },
      register: { type: 'string', default: 'הרשמה' },
      registerurl: { type: 'string', default: '/signup' }
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
  CODE: {
    body: 'NO-BODY',
    jsonType: 'code',
    params: {
      lang: { type: 'string' },
      source: { type: 'string', required: true }
    }
  },
  TAGS: {
    body: 'BLOCK-BODY',
    jsonType: 'tags',
    children: ['TAG'],
    params: {
      label: { type: 'string' }
    }
  },
  TAG: {
    body: 'TEXT-BODY',
    childOnly: true,
    parent: 'TAGS',
    params: {
      url: { type: 'string' }
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
  // FORM graduated v0.58, NAV graduated v0.60, VIDEO graduated v0.62,
  // SECTION graduated v0.75 (container-as-tool), SLIDER graduated v0.79 as
  // CAROUSEL (the slide strip; a range-input SLIDER would be a FORM field),
  // AUDIO graduated v0.80 (media set complete), TABLE graduated v0.83
  // (pipe-row syntax), HEADER + FOOTER graduated in gap-audit wave 4 as
  // page chrome modules. INPUT stays a placeholder — form fields are the
  // child `field` module (nav links = child `navitem`).
  'INPUT'
]);

const UNIVERSAL = new Set(['id', 'class', 'dir', 'animate']);

// v1.97: entrance animation is UNIVERSAL — every keyword takes animate=
// (grok's game writes it on anything). Injected in one loop so the whole
// dictionary agrees; a per-keyword copy (HEADING/TEXT used to carry one
// without zoom) is replaced by the canonical version.
const ANIMATE_KW_PARAM = {
  type: 'enum', default: 'none', values: ['none', 'fade', 'rise', 'zoom']
};
for (const def of Object.values(KEYWORDS)) {
  if (!def.params) def.params = {};
  def.params.animate = ANIMATE_KW_PARAM;
}

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
