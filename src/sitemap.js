// Site structure derived from menus + page inventory.
const { loadMenus } = require('./menus');
const { listPages } = require('./pages');

function buildSitemap() {
  const menus = loadMenus();
  const pages = listPages();
  const byPath = {};
  pages.forEach(p => { byPath[p.full_path] = p; });
  const used = new Set();

  function annotate(items) {
    return (items || []).map(it => {
      let page = null;
      if (it.type === 'page' && it.target) {
        page = byPath[it.target.replace(/^\/+/, '').replace(/\.html$/i, '')] || null;
      } else {
        const m = String(it.url || '').match(/^\/(.+?)\.html$/i);
        if (m && byPath[m[1]]) page = byPath[m[1]];
      }
      if (page) used.add(page.full_path);
      return {
        id: it.id,
        label: it.label,
        type: it.type,
        target: it.target,
        url: it.url,
        page: page
          ? {
              full_path: page.full_path,
              title: page.title,
              status: page.status,
              has_unpublished: !!page.has_unpublished
            }
          : null,
        missing: it.type === 'page' && !page,
        children: annotate(it.children)
      };
    });
  }

  const out = {};
  Object.keys(menus).forEach(name => { out[name] = annotate(menus[name]); });

  const orphans = pages
    .filter(p => !used.has(p.full_path))
    .map(p => ({
      full_path: p.full_path,
      title: p.title,
      status: p.status,
      has_unpublished: !!p.has_unpublished
    }));

  return { menus: out, orphans };
}

module.exports = { buildSitemap };
