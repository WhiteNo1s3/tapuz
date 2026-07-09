const { renderPage } = require('../src/renderer');
const html = renderPage({
  title: 'בדיקה',
  blocks: [
    { type: 'hero', data: { title: 'שלום', subtitle: 'תת' } },
    { type: 'testimonial', data: { quote: 'מעולה', author: 'בן' } },
    { type: 'features', data: { items: [{ title: 'מהיר', description: 'סטטי' }] } },
    { type: 'embed', data: { url: 'https://youtu.be/abc123def45' } },
    { type: 'list', data: { items: ['אחד', 'שניים'], ordered: false } }
  ]
});
const checks = {
  'HERO-SECTION': html.includes('<section class="hero"'),
  'BLOCKQUOTE': html.includes('<blockquote class="testimonial"'),
  'FEATURE-ARTICLE': html.includes('<article class="feature">'),
  'VIDEO-FIGURE': html.includes('figure class="video-embed"'),
  'SKIP-LINK': html.includes('skip-link'),
  'NO-INLINE-FLEX': !html.includes('style="display:flex'),
  'ARIA-NAV': html.includes('aria-label')
};
let fail = false;
Object.keys(checks).forEach(k => {
  console.log((checks[k] ? 'OK  ' : 'FAIL') + ' ' + k);
  if (!checks[k]) fail = true;
});
process.exit(fail ? 1 : 0);
