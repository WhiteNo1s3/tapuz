'use strict';

/**
 * Every page-builder module is wired with:
 *   - command  → exact benTML snippet agents/humans insert into SOURCE
 *   - perks    → what the module can do (props, overrides, behaviors)
 *
 * Source is always benTML — never public HTML.
 * Advanced users may set class= and custom CSS (inspector → override).
 */

const { listModules, getModule } = require('./registry');
const { createFromType } = require('../builder/ops');
const { serializeFragment } = require('../language/serialize');

/** Universal perks every module shares */
const UNIVERSAL_PERKS = [
  {
    id: 'id',
    label: { he: 'מזהה יציב', en: 'Stable id' },
    how: 'id="unique-id"',
    level: 'core',
    note: {
      he: 'חובה לסוכנים — כתובת המודול בבונה',
      en: 'Required for agents — module address in the builder'
    }
  },
  {
    id: 'class',
    label: { he: 'מחלקת CSS (מתקדם)', en: 'CSS class (advanced)' },
    how: 'class="my-override"',
    level: 'advanced',
    note: {
      he: 'מפקח דפדפן → מצא class → דרוס בעיצוב מותאם. לא חובה לרוב המשתמשים.',
      en: 'Browser inspector → find class → override in custom CSS. Advanced users only.'
    }
  }
];

/** Module-specific perk extras beyond schema props */
const EXTRA_PERKS = {
  heading: [
    {
      id: 'seo-levels',
      label: { he: 'היררכיית כותרות', en: 'Heading hierarchy' },
      how: 'level="1" … level="6"',
      level: 'core',
      note: { he: 'h1 פעם בעמוד; h2/h3 לסקשנים', en: 'One h1 per page; h2/h3 for sections' }
    }
  ],
  text: [
    {
      id: 'paragraphs',
      label: { he: 'פסקאות מרובות', en: 'Multi-paragraph' },
      how: 'blank line between paragraphs in content',
      level: 'core',
      note: { he: 'שורה ריקה מפצלת ל־<p> נפרדים ב־compile', en: 'Blank line splits into separate <p> at compile' }
    }
  ],
  button: [
    {
      id: 'variants',
      label: { he: 'סגנונות כפתור', en: 'Button variants' },
      how: 'variant="primary|secondary|outline"',
      level: 'core'
    }
  ],
  embed: [
    {
      id: 'youtube',
      label: { he: 'יוטיוב אוטומטי', en: 'YouTube auto-embed' },
      how: 'url="https://www.youtube.com/watch?v=..."',
      level: 'core',
      note: { he: 'מזהה וידאו → iframe; אחרת קישור בטוח', en: 'Video id → iframe; else safe link' }
    }
  ],
  columns: [
    {
      id: 'layout',
      label: { he: 'פריסת עמודות', en: 'Column layout' },
      how: '<bent-col width="1/2">…</bent-col>',
      level: 'core',
      note: { he: 'רק bent-col כילדים', en: 'Only bent-col children allowed' }
    }
  ],
  'article-list': [
    {
      id: 'context',
      label: { he: 'מאמרים מקונטקסט', en: 'Articles from context' },
      how: 'tag="article" limit="6" columns="3"',
      level: 'core',
      note: { he: 'compile מקבל articles[]; ה־.pzn מספיק למבנה', en: 'compile gets articles[]; .pzn owns structure' }
    }
  ],
  image: [
    {
      id: 'a11y',
      label: { he: 'נגישות', en: 'Accessibility' },
      how: 'alt="…" caption="…"',
      level: 'core'
    }
  ]
};

/**
 * Build a command sheet for one module type.
 * @param {string} type
 * @param {{ id?: string }} [opts]
 */
function getCommand(type, opts = {}) {
  const def = getModule(type);
  if (!def) return null;

  const node = createFromType(type, { id: opts.id || `${type}_demo` });
  // richer demo snippets for containers
  if (type === 'columns') {
    node.children = [
      createFromType('col', { id: 'col_a', width: '1/2', children: [createFromType('text', { id: 'col_a_t', text: 'עמודה א' })] }),
      createFromType('col', { id: 'col_b', width: '1/2', children: [createFromType('text', { id: 'col_b_t', text: 'עמודה ב' })] })
    ];
  } else if (type === 'list') {
    node.children = [
      createFromType('item', { id: 'li_1', text: 'פריט 1' }),
      createFromType('item', { id: 'li_2', text: 'פריט 2' })
    ];
  } else if (type === 'hero') {
    node.children = [
      createFromType('heading', { id: 'hero_h', level: 1, text: 'כותרת הירו' }),
      createFromType('text', { id: 'hero_t', text: 'משפט משנה' }),
      createFromType('button', { id: 'hero_btn', text: 'CTA', href: '/contact' })
    ];
  } else if (type === 'section') {
    node.children = [createFromType('heading', { id: 'sec_h', level: 2, text: 'סקשן' })];
  } else if (type === 'gallery') {
    node.children = [
      createFromType('image', { id: 'gal_1', src: '/uploads/1.jpg', alt: '1' }),
      createFromType('image', { id: 'gal_2', src: '/uploads/2.jpg', alt: '2' })
    ];
  } else if (type === 'embed') {
    node.props.url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  } else if (type === 'image') {
    node.props.src = '/uploads/photo.jpg';
    node.props.alt = 'תיאור';
  }

  const snippet = serializeFragment([node], { pretty: true });

  const propPerks = Object.entries(def.props || {})
    .filter(([k]) => k !== 'id' && k !== 'class')
    .map(([key, schema]) => ({
      id: `prop:${key}`,
      label: schema.label || { he: key, en: key },
      how: schema.content
        ? `(text content inside <${def.tag}>…</${def.tag}>)`
        : schema.type === 'boolean'
          ? `${key}="true|false"`
          : schema.values
            ? `${key}="${schema.values.join('|')}"`
            : `${key}="…"`,
      level: schema.optional ? 'optional' : 'core',
      note: schema.default !== undefined
        ? { he: `ברירת מחדל: ${schema.default}`, en: `Default: ${schema.default}` }
        : undefined
    }));

  const perks = [
    ...UNIVERSAL_PERKS,
    ...propPerks,
    ...(EXTRA_PERKS[type] || [])
  ];

  return {
    type: def.name,
    tag: def.tag,
    label: def.label,
    icon: def.icon,
    category: def.category,
    container: !!def.container,
    accept: def.accept || [],
    /** Exact benTML to insert into SOURCE (not HTML) */
    command: {
      name: `insert:${def.name}`,
      description: {
        he: `הכנס מודול ${def.label.he} למקור benTML`,
        en: `Insert ${def.label.en} module into benTML source`
      },
      snippet,
      // machine form for agents
      intent: `insert module ${def.name}`,
      tag: def.tag
    },
    perks,
    defaults: { ...def.defaults },
    schemaProps: def.props
  };
}

/**
 * Full command catalog for page builder + agents.
 */
function getCommandCatalog() {
  return {
    version: '0.1',
    philosophy: {
      source: 'bentml',
      notSource: 'html',
      file: '.pzn',
      note: {
        he: 'המקור הוא תמיד benTML. HTML נוצר ב־compile. class/CSS = כלי מתקדם.',
        en: 'Source is always benTML. HTML is compile output. class/CSS = advanced tool.'
      }
    },
    // decompile-only modules (the imported header/footer bands) are not
    // commands an agent may mint — the theme master is the real chrome
    modules: listModules().filter((d) => !d.decompileOnly).map((d) => getCommand(d.name))
  };
}

/**
 * Agent-facing one-pager: all insert commands as snippets.
 */
function getAgentCommandSheet() {
  const catalog = getCommandCatalog();
  return {
    version: catalog.version,
    rules: [
      'Edit benTML source only (inside .pzn). Never treat compiled HTML as source.',
      'Use command.snippet as template; change id + props for the user intent.',
      'Every module needs a unique id.',
      'class= is optional advanced override; prefer module props first.',
      'Validate mentally against perks before writing.'
    ],
    commands: catalog.modules.map((m) => ({
      type: m.type,
      tag: m.tag,
      label: m.label,
      insert: m.command.snippet,
      perks: m.perks.map((p) => ({ id: p.id, how: p.how, level: p.level }))
    }))
  };
}

module.exports = {
  UNIVERSAL_PERKS,
  getCommand,
  getCommandCatalog,
  getAgentCommandSheet
};
