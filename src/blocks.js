// Tapuz Block helpers

const BLOCK_TYPES = [
  'heading', 'text', 'image', 'button', 'columns', 'spacer', 'divider',
  'list', 'quote', 'card', 'hero', 'testimonial', 'gallery', 'features', 'embed',
  'article-list', 'map', 'cta', 'stats', 'logos', 'faq', 'contact-info', 'banner',
  'marquee', 'parallax', 'tabs', 'accordion', 'form', 'cards', 'nav', 'ticker', 'video', 'category'
];

function createBlock(type, data = {}) {
  return {
    type,
    id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    data
  };
}

// Matches ids minted by createBlock above and by the builder's uid()
// (public/admin-builder.js) — distinguishes storage ids from authored
// anchor ids so BenTML round-trips can carry them in `id:` params.
function isGeneratedBlockId(id) {
  return typeof id === 'string' && /^[a-z][a-z0-9-]*_\d+_[a-z0-9]+$/.test(id);
}

function createHeading(text, level = 2) { return createBlock('heading', { level, text }); }
function createText(content) { return createBlock('text', { content }); }
function createButton(text, url, variant = 'primary') { return createBlock('button', { text, url, variant }); }
function createImage(src, alt = '', caption = '') { return createBlock('image', { src, alt, caption }); }
function createHero(title, subtitle = '', buttonText = '', buttonUrl = '') {
  return createBlock('hero', { title, subtitle, buttonText, buttonUrl });
}
function createTestimonial(quote, author, role = '') {
  return createBlock('testimonial', { quote, author, role });
}
function createGallery(images) {
  return createBlock('gallery', { images: images.map(i => typeof i === 'string' ? { src: i } : i) });
}
function createFeatures(items) {
  return createBlock('features', { items: items.map(i => typeof i === 'string' ? { title: i } : i) });
}

module.exports = {
  BLOCK_TYPES,
  createBlock,
  isGeneratedBlockId,
  createHeading, createText, createButton, createImage,
  createHero, createTestimonial, createGallery, createFeatures
};
