'use strict';

/**
 * The admin UI shell — layout(), the nav, and the command-palette boot data.
 * Pure rendering: no DB/session I/O beyond auth.getAdminBase() (the logout
 * form target). Every admin route module requires this instead of building
 * its own chrome, so the whole admin surface stays visually and structurally
 * one thing (v0.96 — the first extraction out of the src/server.js monolith;
 * see docs/ARCHITECTURE.md for the pattern this establishes).
 */

const auth = require('./auth');

/** Minimal HTML-escape for admin templates (real entities, not a no-op). */
function escapeAdmin(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Serialize a value for embedding inside an inline <script> block.
 *
 * JSON.stringify alone is NOT safe here: it does not escape `<`, so any string
 * in the data containing `</script>` closes the element early. That is not a
 * theoretical case — v1.49 gave authors a raw-HTML block, and the FIRST widget
 * pasted into it (an analytics snippet) carried `</script>`, which silently
 * broke the whole page builder: the script died mid-parse and the canvas
 * rendered zero blocks with no error. It is also an injection: everything after
 * the breakout runs as script in the ADMIN page, with the admin's session.
 *
 * Escaping `<` closes it (`<` is the same string to JSON.parse), and
 * U+2028/U+2029 are escaped because they are raw line terminators in JS source
 * and would break a string literal the same way.
 *
 * Use this for EVERY JSON value interpolated into a <script> body.
 */
function jsonForScript(value) {
  // Built with fromCharCode so no escape sequence in THIS file can be
  // mangled by an editor: BS is a single backslash, LS/PS are U+2028/U+2029.
  var BS = String.fromCharCode(92);
  var LS = String.fromCharCode(0x2028);
  var PS = String.fromCharCode(0x2029);
  return JSON.stringify(value === undefined ? null : value)
    .split("<").join(BS + "u003c")
    .split(LS).join(BS + "u2028")
    .split(PS).join(BS + "u2029");
}

// Tools sorted into color-coded families instead of one flat pile — every
// group carries its own hue, and each tool inherits the group identity in the
// nav, the dashboard hub, and the per-section accent. ONLY real, shipped tools
// appear here (the A++ teardown gap list lives in docs/ADMIN-TOOL-MAP.md, not
// in the customer's face).
const ADMIN_NAV_GROUPS = [
  {
    key: 'home', label: '', color: '#f97316',
    items: [{ key: 'dashboard', href: '/admin/dashboard', label: 'דשבורד', icon: '🏠' }]
  },
  {
    key: 'content', label: 'תוכן', color: '#2563eb', desc: 'הדפים של האתר — יצירה, ייבוא וסידור',
    items: [
      { key: 'pages', href: '/admin', label: 'דפים', icon: '📄' },
      { key: 'import', href: '/admin/import', label: 'ייבוא', icon: '📥' },
      { key: 'categories', href: '/admin/categories', label: 'קטגוריות', icon: '🗂️' },
      { key: 'inbox', href: '/admin/inbox', label: 'תיבת פניות', icon: '📬' }
    ]
  },
  {
    key: 'media', label: 'מדיה', color: '#0d9488', desc: 'תמונות, קבצים ומה שמאוחסן בשרת',
    items: [
      { key: 'media', href: '/admin/media-library', label: 'ספרייה', icon: '🖼️' },
      { key: 'storage', href: '/admin/storage', label: 'אחסון', icon: '📦' }
    ]
  },
  {
    key: 'design', label: 'עיצוב', color: '#7c3aed', desc: 'איך האתר נראה — צבעים, ניווט ומסגרת',
    items: [
      { key: 'theme', href: '/admin/theme', label: 'ערכת נושא', icon: '🎨' },
      { key: 'menus', href: '/admin/menus', label: 'תפריטים', icon: '🧭' },
      { key: 'site-chrome', href: '/admin/site-chrome', label: 'כותרת ותחתית', icon: '🧱' }
    ]
  },
  {
    // CRM (v1.77) — its own group because it is its own product: the CMS runs
    // without it, and one flag (config.crm.enabled) turns the whole group off.
    key: 'crm', label: 'לקוחות', color: '#ea580c', desc: 'האנשים מאחורי הפניות — מי הם, מה עשו ואיך לפלח אותם',
    items: [
      { key: 'crm-contacts', href: '/admin/crm', label: 'אנשי קשר', icon: '👥' },
      { key: 'crm-segments', href: '/admin/crm/segments', label: 'פילוחים', icon: '🎯' },
      { key: 'crm-lists', href: '/admin/crm/lists', label: 'רשימות דיוור', icon: '📋' },
      { key: 'crm-campaigns', href: '/admin/crm/campaigns', label: 'קמפיינים', icon: '✉️' },
      { key: 'crm-pixels', href: '/admin/crm/pixels', label: 'פיקסלים', icon: '📡' },
      { key: 'crm-conversions', href: '/admin/crm/conversions', label: 'המרות בשרת', icon: '🛰️' },
      { key: 'crm-privacy', href: '/admin/crm/privacy', label: 'פרטיות ושמירה', icon: '🛡️' }
    ]
  },
  {
    key: 'growth', label: 'קידום', color: '#059669', desc: 'להיראות בגוגל ולדעת מי נכנס',
    items: [
      { key: 'seo', href: '/admin/seo', label: 'SEO', icon: '🔍' },
      { key: 'sitemap', href: '/admin/sitemap', label: 'מפת אתר', icon: '🗺️' },
      { key: 'translations', href: '/admin/translations', label: 'תרגומים', icon: '🌐' },
      { key: 'analytics', href: '/admin/analytics', label: 'אנליטיקס', icon: '📈' },
      { key: 'integrations', href: '/admin/integrations', label: 'אינטגרציות', icon: '🔌' }
    ]
  },
  {
    // One AI front door (the copilot hub) + the extension/token setup. The paste
    // flow (/admin/ai) and the dictionary/game (/admin/inject) are sub-tools
    // reached from the hub — kept off the top nav to keep it coherent (v0.56).
    key: 'ai', label: 'AI', color: '#c026d3', desc: 'העוזרים החכמים של טפוז',
    items: [
      { key: 'chat', href: '/admin/chat', label: 'קופיילוט', icon: '✨' },
      { key: 'agent', href: '/admin/agent', label: 'גשר סוכן', icon: '🤖' }
    ]
  },
  {
    key: 'system', label: 'מערכת', color: '#475569', desc: 'הגדרות הבסיס של האתר',
    items: [
      { key: 'settings', href: '/admin/settings', label: 'הגדרות אתר', icon: '⚙️' },
      { key: 'team', href: '/admin/team', label: 'צוות', icon: '👥' }
    ]
  }
];

// key -> group color, so every screen's accent is derived from its family
// instead of hand-picked hexes drifting per route.
const ADMIN_ACCENTS = {};
for (const g of ADMIN_NAV_GROUPS) for (const it of g.items) ADMIN_ACCENTS[it.key] = g.color;
const accentFor = key => ADMIN_ACCENTS[key] || '#f97316';

/**
 * Shared CMS shell navigation — rendered on every admin screen so the whole
 * site is managed from one persistent menu (dashboard / pages / media / menus
 * / theme / settings / SEO / integrations). The page builder is reached by
 * editing a page from the pages list.
 */
function adminNav(active, sectionTitle, actionsHtml = '') {
  // Vertical rail: 19 tools across 7 families wrapped into a two-row horizontal
  // strip and read as one dense blur. Stacked, each family owns a row of its
  // own and the eye scans a short list instead of parsing a wall.
  const groups = ADMIN_NAV_GROUPS.map(g => {
    const links = g.items.map(item =>
      `<a href="${item.href}" title="${escapeAdmin(item.label)}"${item.key === active ? ' class="active"' : ''}>` +
      `<span class="nav-ico">${item.icon}</span><span class="nav-txt">${item.label}</span></a>`
    ).join('');
    const label = g.label ? `<span class="nav-group-label">${g.label}</span>` : '';
    return `<div class="nav-group" style="--g:${g.color}">${label}${links}</div>`;
  }).join('');
  return `
    <aside class="admin-side" aria-label="ניווט ראשי">
      <a href="/admin/dashboard" class="side-brand"><span class="side-brand-mark">🍊</span><span class="nav-txt">Tapuziel</span></a>
      <nav class="admin-nav">${groups}</nav>
    </aside>
    <div class="topbar">
      <div class="brand-strip"></div>
      <div class="container topbar-inner">
        <div style="display:flex;align-items:center;gap:12px">
          <span class="section-title">${sectionTitle}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button type="button" class="btn secondary" style="padding:7px 12px;font-family:inherit"
            onclick="window.TapuzPalette&&window.TapuzPalette.open()" title="חיפוש מהיר — קפצו לכל דף, מסך או פעולה">
            🔍 <kbd style="font:600 .72rem ui-monospace,monospace;background:rgba(148,163,184,.18);border-radius:4px;padding:1px 5px">Ctrl K</kbd>
          </button>
          <a href="/" target="_blank" class="btn secondary" style="padding:7px 12px">צפה באתר</a>
          <span class="topbar-actions">${actionsHtml}</span>
          <form method="POST" action="${auth.getAdminBase()}/logout" style="margin:0">
            <button type="submit" class="btn secondary" style="padding:7px 12px" title="התנתק">התנתק</button>
          </form>
        </div>
      </div>
    </div>
    <div class="nav-progress" id="nav-progress" aria-hidden="true"></div>
    <main id="admin-main" class="admin-main" data-admin-main>`;
  // NB: the <main> is left OPEN on purpose — layout() closes it once the page
  // content has been concatenated after this nav. The shell (sidebar + topbar)
  // stays OUTSIDE it, so client-side navigation swaps only #admin-main and the
  // fixed rail never repaints — no jump. See public/admin-nav.js.
}

// ── Command palette boot (v0.88): every nav item + the everyday actions,
//    serialized once — Ctrl+K's instant results before pages stream in.
//    English keywords so both שפות reach every command.
let _paletteJson = null;
function paletteBootJson() {
  if (_paletteJson) return _paletteJson;
  const KEYWORDS = {
    dashboard: 'dashboard home', pages: 'pages list', import: 'import wordpress html',
    categories: 'categories tags', inbox: 'inbox leads forms submissions',
    media: 'media library images uploads', storage: 'storage files disk',
    theme: 'theme design colors looks', menus: 'menus navigation', 'site-chrome': 'header footer chrome',
    seo: 'seo google search', sitemap: 'sitemap', analytics: 'analytics stats views visitors',
    integrations: 'integrations ga4 webhooks', chat: 'ai chat copilot key', agent: 'agent token extension bridge',
    settings: 'settings config site'
  };
  const commands = [];
  for (const g of ADMIN_NAV_GROUPS) {
    for (const it of g.items) {
      commands.push({
        label: it.label, icon: it.icon, href: it.href,
        hint: g.label || '', keywords: (KEYWORDS[it.key] || it.key)
      });
    }
  }
  commands.push(
    { label: 'דף חדש', icon: '➕', href: '/admin/new', hint: 'פעולה', keywords: 'new page create צור' },
    { label: 'צפייה באתר', icon: '🌐', href: '/', hint: 'פעולה', newTab: true, keywords: 'view site preview live' },
    { label: 'ייצוא פניות (CSV)', icon: '⬇', href: '/admin/inbox.csv', hint: 'פעולה', keywords: 'export leads csv excel' },
    { label: 'ייצוא אנליטיקס (CSV)', icon: '⬇', href: '/admin/analytics.csv?what=daily', hint: 'פעולה', keywords: 'export analytics csv excel' },
    { label: 'חבילת AI להדבקה', icon: '🎮', href: '/admin/inject', hint: 'פעולה', keywords: 'inject roleplay game pack dictionary' }
  );
  _paletteJson = JSON.stringify(commands);
  return _paletteJson;
}

// Product name: Tapuziel — final (Ben, 2026-07-24: "Tapuz is taken by many
// organizations, we are to avoid that"). Repo/CLI internals may say tapuz;
// anything a USER reads says Tapuziel.
function layout(content, title = 'Tapuziel', accent = '#f97316', opts = {}) {
  // opts.bare skips the command palette (auth screens — pre-session, no nav)
  const palette = opts.bare ? '' : `
  <script>window.__TAPUZ_NAV__ = ${paletteBootJson()};</script>
  <script src="/admin-palette.js" defer></script>`;
  // adminNav() opens <main id="admin-main"> and never closes it; close it here
  // when the sentinel is present. Pages that skip adminNav (auth, the builder,
  // the wizard) never opened one, so nothing is closed for them. The
  // navigation layer (admin-nav.js) swaps ONLY #admin-main between sidebar
  // screens, so the fixed rail never repaints — Ben's "site jumps" is a full
  // reload of a fixed shell; this removes the reload.
  const hasMain = content.includes('data-admin-main');
  const closeMain = hasMain ? '</main>' : '';
  const nav = hasMain ? '\n  <script src="/admin-nav.js" defer></script>' : '';
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} • Tapuziel</title>
  <link rel="stylesheet" href="/css/main.css">
  <link rel="stylesheet" href="/css/admin.css">
  <style>:root { --admin-accent: ${accent}; }</style>
</head>
<body${opts.bodyClass ? ` class="${opts.bodyClass}"` : ''}>
  ${content}${closeMain}${palette}${nav}
</body>
</html>`;
}

module.exports = {
  escapeAdmin,
  jsonForScript,
  ADMIN_NAV_GROUPS,
  ADMIN_ACCENTS,
  accentFor,
  adminNav,
  paletteBootJson,
  layout
};
