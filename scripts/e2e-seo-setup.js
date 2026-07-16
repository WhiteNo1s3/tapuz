'use strict';
// E2E fixture for the v0.71 SEO head (run once, then curl the server):
// sets baseUrl, creates a published ARTICLE page (with image title + link SEO),
// a published NOINDEX page, and exports HTML — the real pipeline end to end.
const { loadConfig, saveConfig } = require('../src/config');
const { createPage, getPageByFullPath } = require('../src/pages');
const { exportAll } = require('../src/export');

const cfg = loadConfig();
cfg.baseUrl = 'https://tapuz.example';
saveConfig(cfg);
console.log('baseUrl set:', cfg.baseUrl);

if (!getPageByFullPath('seo-e2e-article')) {
  createPage({
    title: 'מאמר בדיקת SEO',
    slug: 'seo-e2e-article',
    tags: ['article'],
    meta: { description: 'תיאור המאמר לבדיקת SEO', cardImage: '/assets/card.jpg' },
    status: 'published',
    blocks: [
      { type: 'heading', id: 'h1', data: { level: 1, text: 'כותרת המאמר' } },
      { type: 'image', id: 'i1', data: { src: '/assets/pic.jpg', alt: 'תמונה', title: 'כותרת תמונה SEO' } },
      { type: 'button', id: 'b1', data: { text: 'קישור ממומן', url: 'https://out.example', variant: 'primary', rel: 'sponsored', target: '_blank', title: 'החוצה' } },
      { type: 'text', id: 't1', data: { content: 'גוף המאמר.' } }
    ]
  });
  console.log('article page created');
}
if (!getPageByFullPath('seo-e2e-hidden')) {
  createPage({
    title: 'דף נסתר',
    slug: 'seo-e2e-hidden',
    meta: { robots: 'noindex, nofollow' },
    status: 'published',
    blocks: [{ type: 'text', id: 't1', data: { content: 'לא באינדקס.' } }]
  });
  console.log('noindex page created');
}
const results = exportAll();
console.log('exported', results.length, 'pages');
