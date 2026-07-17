// E2E: Wizard v2 engine → full site skeleton, on a throwaway TAPUZ_ROOT.
// Re-execs itself with TAPUZ_ROOT set so no real site data is touched.
const fs = require('fs');
const path = require('path');
const os = require('os');

if (!process.env.TAPUZ_ROOT) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-wizard-'));
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [__filename], {
    env: { ...process.env, TAPUZ_ROOT: tmp },
    stdio: 'inherit'
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  process.exit(r.status == null ? 1 : r.status);
}

const ROOT = process.env.TAPUZ_ROOT;
const { runSetup } = require('../src/setup');
const { getPageByFullPath, listArticles } = require('../src/pages');
const { loadConfig } = require('../src/config');
const { loadOverrides } = require('../src/theme');
const { getMenu } = require('../src/menus');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const result = runSetup({
  title: 'אתר הבדיקה',
  description: 'תיאור קצר',
  colors: { primary: '#166534', bg: '#ffffff', lightBg: '#f0fdf4', text: 'not-a-color' },
  menuPlacement: 'side',
  pages: ['home', 'about', 'contact', 'articles'],
  menuPages: ['home', 'articles', 'about'],
  external: [
    { label: 'גיטהאב', url: 'https://github.com/whiteno1se' },
    { label: 'זבל', url: 'javascript:alert(1)' } // must be rejected
  ]
});

check('returns created pages', result.pages.length === 4);

// Pages
['home', 'about', 'contact', 'articles', 'first-article'].forEach((p) => {
  const page = getPageByFullPath(p);
  check('page created + published: ' + p, !!page && page.status === 'published');
});
const home = getPageByFullPath('home');
check('home hero has site title', home.blocks[0].type === 'hero' && home.blocks[0].data.title === 'אתר הבדיקה');
check('home includes article-list', home.blocks.some(b => b.type === 'article-list'));
const articles = getPageByFullPath('articles');
check('articles page uses article-list', articles.blocks.some(b => b.type === 'article-list' && b.data.limit === 12));
const sample = getPageByFullPath('first-article');
check('sample article tagged', sample.tags.includes('article'));
check('sample article has teaser', !!sample.meta.teaser);
check('sample article appears in cubes', listArticles({ tag: 'article' }).some(a => a.full_path === 'first-article'));

// Config + theme
const cfg = loadConfig();
check('config title set', cfg.title === 'אתר הבדיקה');
check('setupDone flag', cfg.setupDone === true);
const ov = loadOverrides();
check('primary color applied', ov.colors.primary === '#166534');
check('lightBg applied', ov.colors.lightBg === '#f0fdf4');
check('bad color rejected (default kept)', ov.colors.text === '#1c1917'); // תפוז look default (v0.72)
check('menu placement side', ov.layout.menuPlacement === 'side');

// Menu
const menu = getMenu('main');
check('menu has 4 items (3 pages + 1 external)', menu.length === 4);
check('menu order follows wizard', menu[0].target === 'home' && menu[1].target === 'articles' && menu[2].target === 'about');
check('external link kept', menu[3].type === 'custom' && menu[3].url === 'https://github.com/whiteno1se');
check('javascript: link rejected', !menu.some(m => String(m.url).startsWith('javascript:')));
check('contact page exists but not in menu', !menu.some(m => m.target === 'contact'));

// Static build in the temp root
const pub = path.join(ROOT, 'public');
check('index.html built', fs.existsSync(path.join(pub, 'index.html')));
check('home.html also built (menu link works)', fs.existsSync(path.join(pub, 'home.html')));
check('articles.html built', fs.existsSync(path.join(pub, 'articles.html')));
check('css built', fs.existsSync(path.join(pub, 'css', 'main.css')));
const artHtml = fs.readFileSync(path.join(pub, 'articles.html'), 'utf8');
check('published articles page shows cube', artHtml.includes('article-cubes') && artHtml.includes('first-article.html'));
const indexHtml = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
check('home page shows cube of sample article', indexHtml.includes('article-cubes'));
const css = fs.readFileSync(path.join(pub, 'css', 'main.css'), 'utf8');
check('built css carries chosen primary', css.includes('#166534'));

// Second run must not clobber existing pages
runSetup({ title: 'שם אחר', pages: ['home'] });
check('rerun keeps original home blocks', getPageByFullPath('home').blocks[0].data.title === 'אתר הבדיקה');

// A LOOK applies the whole personality (v0.72 grade-1 path) — and explicit
// fine-tune colors still win over the look's palette.
runSetup({ title: 'שם אחר', pages: ['home'], look: 'layla', colors: { primary: '#123456' } });
const lookOv = loadOverrides();
check('look applies the dark palette', lookOv.colors.bg === '#0b1220' && lookOv.colors.surface === '#131f36');
check('look applies the style knobs', lookOv.style.shadow === 'deep' && lookOv.style.accent === 'gradient');
check('explicit fine-tune color wins over the look', lookOv.colors.primary === '#123456');
check('unknown look is ignored safely', (() => { runSetup({ title: 'x', pages: ['home'], look: 'nope', colors: { primary: '#166534' } }); return loadOverrides().colors.primary === '#166534'; })());

// Isolation: nothing leaked outside TAPUZ_ROOT
check('temp DB used', fs.existsSync(path.join(ROOT, 'db', 'tapuz.db')));

process.exit(fail ? 1 : 0);
