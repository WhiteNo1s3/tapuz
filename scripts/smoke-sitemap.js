// E2E: typed menu links + sitemap structure + redirect page
const { normalizeItems, resolveUrl, saveMenu } = require('../src/menus');
const { createPage, deletePage, getPageByFullPath } = require('../src/pages');
const { buildSitemap } = require('../src/sitemap');
const { renderPage } = require('../src/renderer');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

// link types resolve
check('page url', resolveUrl('page', 'about') === '/about.html');
check('page url strips html/slash', resolveUrl('page', '/about.html') === '/about.html');
check('tel url', resolveUrl('tel', '050-123 4567') === 'tel:0501234567');
check('mailto url', resolveUrl('mailto', 'a@b.co') === 'mailto:a@b.co');
check('anchor url', resolveUrl('anchor', 'contact') === '#contact');
check('custom passthrough', resolveUrl('custom', '', 'https://x.co') === 'https://x.co');
check('legacy item keeps url', normalizeItems([{ label: 'x', url: '/old.html' }])[0].url === '/old.html');

// sitemap: menu->page matching + orphans
try { deletePage('sm-linked'); deletePage('sm-orphan'); } catch (e) {}
createPage({ title: 'מקושר', slug: 'sm-linked', blocks: [], status: 'published' });
createPage({ title: 'יתום', slug: 'sm-orphan', blocks: [], status: 'draft' });
saveMenu('main', [
  { label: 'בית', type: 'custom', url: '/' },
  { label: 'מקושר', type: 'page', target: 'sm-linked' },
  { label: 'חסר', type: 'page', target: 'no-such-page' },
  { label: 'חייגו', type: 'tel', target: '+972501112222' }
]);
const sm = buildSitemap();
const main = sm.menus.main;
check('linked item found page', main[1].page && main[1].page.full_path === 'sm-linked');
check('missing page flagged', main[2].missing === true);
check('tel item no page', main[3].page === null && main[3].url === 'tel:+972501112222');
check('orphan detected', sm.orphans.some(o => o.full_path === 'sm-orphan'));
check('linked not orphan', !sm.orphans.some(o => o.full_path === 'sm-linked'));

// redirect page render
const rhtml = renderPage({ title: 'הפניה', meta: { redirect: '/sm-linked.html' }, blocks: [] });
check('redirect meta refresh', rhtml.includes('http-equiv="refresh"') && rhtml.includes('/sm-linked.html'));

deletePage('sm-linked');
deletePage('sm-orphan');
saveMenu('main', [{ label: 'דף הבית', type: 'custom', url: '/' }]);
check('cleanup', !getPageByFullPath('sm-linked'));

process.exit(fail ? 1 : 0);
