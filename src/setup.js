// Wizard v2 engine — creates the site skeleton from wizard answers.
// Shared by POST /admin/setup, the CLI, and agents (see docs/cli-agent-support.md).
const { createPage, getPageByFullPath, listPages } = require('./pages');
const { saveMenu } = require('./menus');
const { saveThemeSettings } = require('./theme');
const { loadConfig, saveConfig } = require('./config');
const { exportAll } = require('./export');

const PAGE_LABELS = { home: 'דף הבית', about: 'אודות', contact: 'צור קשר', articles: 'מאמרים' };

/**
 * Is this a pristine install still needing the setup wizard? (v1.30: promoted
 * from a server.js-local helper + a v1.24 inline copy in dashboard.js to the
 * single source of truth here, next to runSetup — the state it guards.)
 * @returns {boolean}
 */
function needsSetup() {
  try {
    return !loadConfig().setupDone && listPages().length === 0;
  } catch (e) {
    return false;
  }
}

function isHex(c) {
  return /^#[0-9a-fA-F]{6}$/.test(String(c || ''));
}

/**
 * body: {
 *   title, description,
 *   colors: { primary, text, bg, lightBg },   // each optional, #rrggbb
 *   menuPlacement: 'top' | 'side',
 *   pages: ['home','about','contact','articles'],
 *   menuPages: subset of pages for the main menu,
 *   external: [{ label, url }]                // http(s) links appended to the menu
 * }
 * Existing pages are never overwritten. Returns { pages, menu }.
 */
function runSetup(body = {}) {
  const siteTitle = String(body.title || '').trim() || 'האתר שלי';
  const description = String(body.description || '').trim();

  // Wizard v2 sends colors{}; old form shape (primary field) still accepted
  const wanted = body.colors || { primary: body.primary };
  const colors = {};
  ['primary', 'text', 'bg', 'lightBg'].forEach((k) => {
    if (isHex(wanted && wanted[k])) colors[k] = wanted[k];
  });

  // A LOOK (v0.72) is the grade-1 path: one card click = the whole
  // personality (palette + radius + shadows + gradient + fonts). The look
  // is the base; the wizard's fine-tune color pickers win on top of it.
  const { LOOKS } = require('./theme');
  const look = body.look && LOOKS[body.look]
    ? JSON.parse(JSON.stringify(LOOKS[body.look].overrides))
    : null;

  const config = loadConfig();
  config.title = siteTitle;
  config.description = description;
  config.setupDone = true;
  // The wizard's home page is the homepage, explicitly — never leave the
  // crowning to the title heuristic (v0.78 homepage flow).
  if (!config.homepage) config.homepage = 'home';
  saveConfig(config);

  saveThemeSettings({
    siteTitle: siteTitle,
    overrides: {
      ...(look || {}),
      colors: { ...((look && look.colors) || {}), ...colors },
      layout: { menuPlacement: body.menuPlacement === 'side' ? 'side' : 'top' }
    }
  });

  const wantedPages = Array.isArray(body.pages) && body.pages.length ? body.pages : ['home'];
  const has = (p) => wantedPages.includes(p);

  const homeBlocks = [
    { type: 'hero', data: { title: siteTitle, subtitle: description || 'ברוכים הבאים' } },
    { type: 'text', data: { content: 'זהו דף הבית החדש שלך. לחץ "ערוך" כדי לשנות הכל — כל קטע בדף הוא מודול שאפשר לגרור, להחליף ולערוך.' } }
  ];
  if (has('articles')) {
    homeBlocks.push({ type: 'heading', data: { level: 2, text: 'מאמרים אחרונים' } });
    homeBlocks.push({ type: 'article-list', data: { tag: 'article', limit: 3, columns: 3 } });
  }
  if (!getPageByFullPath('home')) {
    createPage({ title: siteTitle, slug: 'home', status: 'published', blocks: homeBlocks });
  }

  if (has('about') && !getPageByFullPath('about')) {
    createPage({
      title: 'אודות', slug: 'about', status: 'published',
      blocks: [
        { type: 'heading', data: { level: 1, text: 'אודות' } },
        { type: 'text', data: { content: 'כאן מספרים מי אתם, מה אתם עושים ולמה. פתחו את הדף בבונה והחליפו את הטקסט הזה בסיפור שלכם.' } }
      ]
    });
  }

  if (has('contact') && !getPageByFullPath('contact')) {
    createPage({
      title: 'צור קשר', slug: 'contact', status: 'published',
      blocks: [
        { type: 'heading', data: { level: 1, text: 'צור קשר' } },
        { type: 'text', data: { content: 'כאן שמים דרכי התקשרות — טלפון, מייל, כתובת. טופס לידים אמיתי יגיע בשלב ה־CRM.' } }
      ]
    });
  }

  if (has('articles')) {
    if (!getPageByFullPath('articles')) {
      createPage({
        title: 'מאמרים', slug: 'articles', status: 'published',
        blocks: [
          { type: 'heading', data: { level: 1, text: 'המאמרים שלנו' } },
          { type: 'article-list', data: { tag: 'article', limit: 12, columns: 3 } }
        ]
      });
    }
    if (!getPageByFullPath('first-article')) {
      createPage({
        title: 'המאמר הראשון שלך', slug: 'first-article', status: 'published',
        tags: ['article'],
        meta: { teaser: 'ככה נראית קוביית מאמר. כתבו מאמר חדש, סמנו אותו כ"דף מאמר" — והוא יופיע כאן לבד.' },
        blocks: [
          { type: 'heading', data: { level: 1, text: 'המאמר הראשון שלך' } },
          { type: 'text', data: { content: 'כל דף שמסומן כ"דף מאמר" (במאפייני הדף בבונה) מופיע אוטומטית בקוביות המאמרים — התמונה והתקציר נלקחים מהדף עצמו. מחקו את המאמר הזה כשיש לכם תוכן אמיתי.' } }
        ]
      });
    }
  }

  // Menu: picked pages first (wizard order), then external links
  const menuPages = (Array.isArray(body.menuPages) ? body.menuPages : wantedPages)
    .filter((p) => wantedPages.includes(p));
  const items = menuPages.map((p) => ({ label: PAGE_LABELS[p] || p, type: 'page', target: p }));
  (Array.isArray(body.external) ? body.external : []).slice(0, 4).forEach((x) => {
    const label = String((x && x.label) || '').trim();
    const url = String((x && x.url) || '').trim();
    if (label && /^https?:\/\//i.test(url)) items.push({ label, type: 'custom', target: url, url });
  });
  saveMenu('main', items.length ? items : [{ label: 'דף הבית', type: 'page', target: 'home' }]);

  try { exportAll(); } catch (e) {}

  return { pages: wantedPages, menu: items.length };
}

module.exports = { runSetup, needsSetup, PAGE_LABELS };
