const { renderPage, renderBlock } = require('../src/renderer');
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
  'ARIA-NAV': html.includes('aria-label'),
  'EMPTY-IMAGE': renderBlock({ type: 'image', data: { src: '', alt: 'Business management' } }, 'rtl') === ''
    && renderBlock({ type: 'image', data: { src: '   ', alt: 'x' } }, 'rtl') === '',
  'NORMAL-IMAGE': /<figure class="bent-image"[^>]*><img src="\/uploads\/a\.jpg" alt="Business management" loading="lazy">/.test(
    renderBlock({ type: 'image', data: { src: '/uploads/a.jpg', alt: 'Business management' } }, 'rtl')
  ),
  'EMPTY-VIDEO-NO-SRC': !/src=""/.test(renderBlock({ type: 'video', data: { src: '' } }, 'rtl'))
    && !/src=""/.test(renderBlock({ type: 'video', data: {} }, 'rtl')),
  'EMPTY-AUDIO-NO-SRC': !/src=""/.test(renderBlock({ type: 'audio', data: { src: '' } }, 'rtl'))
    && !/src=""/.test(renderBlock({ type: 'audio', data: {} }, 'rtl')),
  'EMPTY-PARALLAX': (() => {
    const px = renderBlock({
      type: 'parallax',
      data: { image: '', blocks: [{ type: 'heading', data: { text: 'נשאר', level: 2 } }] }
    }, 'rtl');
    return px.includes('נשאר') && !/url\(/.test(px) && !/src=""/.test(px);
  })(),
  'EMPTY-LOGO': !/src=""/.test(renderBlock({
    type: 'logos',
    data: { items: [{ src: '', alt: 'חסר' }, { src: '/demo/tile-1.svg', alt: 'יש' }] }
  }, 'rtl')) && /src="\/demo\/tile-1\.svg"/.test(renderBlock({
    type: 'logos',
    data: { items: [{ src: '', alt: 'חסר' }, { src: '/demo/tile-1.svg', alt: 'יש' }] }
  }, 'rtl'))
};
let fail = false;
Object.keys(checks).forEach(k => {
  console.log((checks[k] ? 'OK  ' : 'FAIL') + ' ' + k);
  if (!checks[k]) fail = true;
});
process.exit(fail ? 1 : 0);
