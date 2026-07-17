'use strict';

/**
 * Prove the decompiler captures a full page picture (the "new HTML").
 * Fast, no server.
 */
const { compile, decompile } = require('../src/bentml');

let fail = 0;
function check(name, cond) {
  console.log((cond ? 'OK   ' : 'FAIL ') + name);
  if (!cond) fail++;
}

const page = {
  title: 'Shaltiel Enterprises',
  slug: 'home',
  direction: 'rtl',
  status: 'draft',
  tags: ['enterprise'],
  meta: {
    description: 'Method over chaos',
    seoTitle: 'SE · Home',
    ogImage: '/uploads/og.jpg',
    robots: 'index, follow',
    teaser: 'Red Hat of CMS'
  }
};

const blocks = [
  {
    type: 'banner',
    id: 'b1',
    data: { text: 'Welcome', tone: 'brand', className: 'top-banner' }
  },
  {
    type: 'hero',
    id: 'h1',
    data: {
      title: 'Ultimate CMS',
      subtitle: 'Visual + BenTML',
      buttonText: 'Start',
      buttonUrl: '/start',
      image: '/uploads/PLACEHOLDER-hero.jpg'
    }
  },
  {
    type: 'stats',
    id: 's1',
    data: {
      columns: 3,
      items: [
        { value: '1', label: 'Language' },
        { value: '1', label: 'Builder' },
        { value: '0', label: 'Plugins' }
      ]
    }
  },
  {
    type: 'faq',
    id: 'f1',
    data: {
      items: [{ question: 'Need Elementor?', answer: 'No. Builder is built-in.' }]
    }
  },
  {
    type: 'logos',
    id: 'l1',
    data: {
      items: [{ src: '/uploads/PLACEHOLDER-logo.svg', alt: 'Client', url: 'https://example.com' }]
    }
  },
  {
    type: 'text',
    id: 't1',
    data: {
      content: 'Hello @B{world}',
      size: 'lg',
      lead: true,
      className: 'intro',
      style: { color: '#111111' }
    }
  },
  {
    type: 'columns',
    id: 'c1',
    data: {
      ratio: '2:1',
      columns: [
        { blocks: [{ type: 'text', id: 't2', data: { content: 'Left' } }] },
        {
          blocks: [
            {
              type: 'image',
              id: 'i1',
              data: { src: '/uploads/PLACEHOLDER.jpg', alt: 'Photo', caption: 'Cap' }
            }
          ]
        }
      ]
    }
  }
];

const out = decompile(page, blocks);
check('starts BENTML', /^BENTML/m.test(out));
check('META description', out.includes('Method over chaos'));
check('STATS has STAT children', out.includes('STAT(value:') && out.includes('Language'));
check('FAQ has QA', out.includes('QA(question:') && out.includes('Need Elementor?'));
check('LOGOS has LOGO', out.includes('LOGO(src:') && out.includes('PLACEHOLDER-logo'));
// Marks decompile with escaped braces so the parser won't close TEXT early:
// @B{world} → @B\{world\} → parse unescapes → @B{world}
check('TEXT keeps @B mark (escaped in source)', out.includes('@B\\{world\\}') || out.includes('@B{world}'));
check('TEXT keeps class', out.includes('class: "intro"'));
check('TEXT keeps color style', out.includes('color:'));
check('ROW ratio', out.includes('ratio: "2:1"'));
check('IMAGE caption', out.includes('caption:'));

const back = compile(out);
const byType = {};
back.blocks.forEach((b) => {
  byType[b.type] = b;
});

check('recompile stats items', byType.stats && byType.stats.data.items[0].value === '1');
check('recompile faq answer', byType.faq && byType.faq.data.items[0].answer.includes('built-in'));
check('recompile logos src', byType.logos && byType.logos.data.items[0].src.includes('PLACEHOLDER-logo'));
check('recompile text mark', byType.text && byType.text.data.content.includes('@B{world}'));
check('recompile text class', byType.text && byType.text.data.className === 'intro');
check('recompile columns ratio', byType.columns && String(byType.columns.data.ratio).includes('2:1'));

// second pass: decompile(compile(decompile(blocks))) stable types
const out2 = decompile(back.page, back.blocks);
const back2 = compile(out2);
check(
  'double roundtrip type chain',
  back2.blocks.map((b) => b.type).join(',') === back.blocks.map((b) => b.type).join(',')
);

console.log(fail ? `\n${fail} failure(s)` : '\nAll decompile-picture checks passed');
process.exit(fail ? 1 : 0);
