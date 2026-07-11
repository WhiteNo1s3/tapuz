// E2E: article pages → listArticles cards → article-list module rendering
const { createPage, updatePage, publishPage, deletePage, listArticles } = require('../src/pages');
const { renderBlock } = require('../src/renderer');

const A1 = 'smoke-article-1';
const A2 = 'smoke-article-2';
const A3 = 'smoke-article-draft';
[A1, A2, A3].forEach(p => { try { deletePage(p); } catch (e) {} });

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

// Article 1: auto card image + auto teaser from blocks
createPage({
  title: 'מאמר ראשון',
  slug: A1,
  tags: ['article'],
  blocks: [
    { type: 'heading', id: 'h1', data: { level: 1, text: 'מאמר ראשון' } },
    { type: 'image', id: 'i1', data: { src: '/assets/first.jpg', alt: 'ראשי' } },
    { type: 'text', id: 't1', data: { content: 'זהו הטקסט הפותח של המאמר הראשון. הוא ארוך מספיק כדי לשמש תקציר.' } }
  ],
  status: 'draft'
});
publishPage(A1);

// Article 2: manual cardImage + teaser via meta, image nested in columns
createPage({
  title: 'מאמר שני',
  slug: A2,
  tags: ['article', 'news'],
  meta: { cardImage: '/assets/manual.jpg', teaser: 'תקציר ידני' },
  blocks: [
    { type: 'columns', id: 'c1', data: { columns: [
      { blocks: [{ type: 'image', id: 'i2', data: { src: '/assets/nested.jpg' } }] },
      { blocks: [{ type: 'text', id: 't2', data: { content: 'טקסט בתוך טור' } }] }
    ] } }
  ],
  status: 'draft'
});
publishPage(A2);

// Article 3: tagged but NOT published — must not appear
createPage({
  title: 'טיוטת מאמר',
  slug: A3,
  tags: ['article'],
  blocks: [{ type: 'text', id: 't3', data: { content: 'טיוטה' } }],
  status: 'draft'
});

const arts = listArticles({ tag: 'article', limit: 12 })
  .filter(a => a.full_path.startsWith('smoke-article'));

check('two published articles found', arts.length === 2);
check('draft article excluded', !arts.some(a => a.full_path === A3));

const a1 = arts.find(a => a.full_path === A1);
const a2 = arts.find(a => a.full_path === A2);
check('auto card image from first image block', a1 && a1.image === '/assets/first.jpg');
check('auto teaser from first text block', a1 && a1.teaser.includes('הטקסט הפותח'));
check('manual cardImage wins', a2 && a2.image === '/assets/manual.jpg');
check('manual teaser wins', a2 && a2.teaser === 'תקציר ידני');
check('url shape', a1 && a1.url === '/' + A1 + '.html');
check('newest first', arts[0].full_path === A2);

// Render the module
const html = renderBlock({ type: 'article-list', id: 'al', data: { tag: 'article', limit: 12, columns: 2 } }, 'rtl');
check('renders section with cols class', html.includes('article-cubes cols-2'));
check('renders cube link to article', html.includes('href="/' + A1 + '.html"'));
check('renders titles', html.includes('מאמר ראשון') && html.includes('מאמר שני'));
check('renders card image', html.includes('/assets/manual.jpg'));

// Teaser must be escaped
updatePage(A1, { meta: { teaser: '<script>x</script>' }, blocks: undefined });
publishPage(A1);
const html2 = renderBlock({ type: 'article-list', id: 'al2', data: { tag: 'article' } }, 'rtl');
check('teaser escaped', !html2.includes('<script>x') && html2.includes('&lt;script&gt;'));

// Empty tag → comment, no crash
const none = renderBlock({ type: 'article-list', id: 'al3', data: { tag: 'no-such-tag' } }, 'rtl');
check('empty tag renders comment', none.startsWith('<!-- article-list'));

[A1, A2, A3].forEach(p => deletePage(p));
process.exit(fail ? 1 : 0);
