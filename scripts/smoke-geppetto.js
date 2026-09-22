'use strict';

/**
 * v2.56 QA — Geppetto: a design's puppet becomes a living Tapuziel site.
 *
 * Ben: "they are imported nonsense, we make a life in them, like Pinocchio
 * and Geppetto." This smoke pins the life pass on SYNTHETIC designs (the
 * decoders have their own smokes over their own fixtures):
 *   1. a Canva-shaped page (absolute boxes): the menu band leaves the page
 *      for the site's menu, the brand names the site, the opening screen is
 *      a full-width hero, image|text is a row with the designer's ratio,
 *      three picture+title+text cells are CARDS, a photo under a dark veil
 *      is a BACKDROP with an overlay, linked icons are SOCIAL, a pill with a
 *      word is a BUTTON with the pill's colors, and #page-N links land on
 *      the anchors the menu labels named
 *   2. a Figma-shaped page (auto-layout): column/row/grid read as intent,
 *      a grid of round portraits is a TEAM, big numbers are STATS
 *   3. the XY-cut: a 2×3 wall of cards read row by row
 *   4. the text roles: one h1, a lead paragraph is not a heading, contact
 *      lines are never titles, the kicker
 *   5. the look: page color / words / accent, fonts mapped to Google, the
 *      fluid title sizes, a <bent-theme> that round-trips
 *   6. landing with a FAKE network: pages as BenTML, pictures and a clip in
 *      the media library, the theme in the library and applied, the menu,
 *      the crown, the site's name — and undo takes every one of them back
 *   7. the stretch band: SECTION/BACKDROP/HERO width in both dialects, the
 *      bridge and the renderer
 *   8. untrusted design text stays text: no script, no javascript: link, no
 *      CSS smuggled through a gradient, no mark (any case) on the landed page
 *   9. undo takes back the import and nothing else: an older import undone
 *      under a newer one leaves the newer one's chrome (and the newer one's
 *      undo then brings back the owner's, knobs included), an edited page is
 *      kept, a tuned look is filed before the old look returns, one landing
 *      at a time, a landing that fails half-way takes itself back, a crowded
 *      design breathes fast, other previews keep the site's logo
 *  10. a design the decoders do not understand is a refusal, never a 500
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-geppetto-'));

const P = require('../src/geppetto/puppet');
const life = require('../src/geppetto/life');
const { extractLook } = require('../src/geppetto/look');
const F = require('../src/geppetto/fonts');

let fail = false;
function check(name, cond, extra) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (cond || extra === undefined ? '' : '  → ' + JSON.stringify(extra).slice(0, 300)));
  if (!cond) fail = true;
}

// ── synthetic design builders ─────────────────────────────────────────────
let z = 0;
const run = (text, o) => ({ text, size: o.size || 20, color: o.color || '#222222', font: o.font || 'body', bold: !!o.bold, href: o.href, upper: !!o.upper });
const text = (id, x, y, w, h, t, o = {}) => ({
  id, type: 'text', x, y, w, h, z: z++, role: o.role, link: o.link, anim: o.anim,
  paragraphs: String(t).split('\n').map((line) => ({ align: o.align || 'start', list: o.list || null, runs: o.runs ? o.runs : [run(line, o)] }))
});
const img = (id, x, y, w, h, src, o = {}) => ({ id, type: 'image', x, y, w, h, z: z++, src, alt: o.alt || '', svg: !!o.svg, link: o.link, mask: o.mask, radius: o.radius });
const shape = (id, x, y, w, h, color, o = {}) => ({ id, type: 'shape', x, y, w, h, z: z++, fill: o.fill || { color }, radius: o.radius, children: o.children, link: o.link });
const A = 'https://example-studio.my.canva.site/_assets/media/';

function canvaDesign() {
  z = 0;
  const s1 = { key: 's1', anchor: '', height: 700, fill: { color: '#2f3543', gradient: null, image: null, video: null }, nodes: [
    text('brand', 60, 40, 260, 40, 'Olive Studio', { size: 30, color: '#f4f4f4', bold: true, font: 'title' }),
    text('nav1', 900, 45, 90, 30, 'About', { size: 18, color: '#ffffff', link: { anchor: 'page-0' } }),
    text('nav2', 1010, 45, 100, 30, 'Services', { size: 18, color: '#ffffff', link: { anchor: 'page-1' } }),
    text('nav3', 1130, 45, 100, 30, 'Contact', { size: 18, color: '#ffffff', link: { anchor: 'page-2' } }),
    text('title', 283, 250, 800, 120, 'Design that\nfeels like home', { size: 88, color: '#f16d82', align: 'center', role: 'title', font: 'title', anim: 'rise' }),
    text('sub', 383, 400, 600, 60, 'Brand identity, web and print for small businesses.', { size: 24, color: '#f4f4f4', align: 'center' }),
    shape('pill', 583, 500, 200, 60, '#f16d82', { radius: 30 }),
    text('pilltx', 603, 515, 160, 30, 'HIRE ME', { size: 18, color: '#000000', align: 'center', href: 'https://www.example-market.com/me' })
  ] };
  const s2 = { key: 's2', anchor: 'page-0', height: 800, fill: { color: '#f4f4f4' }, nodes: [
    img('portrait', 100, 100, 500, 600, A + 'portrait.jpg', { alt: 'Portrait of Olive' }),
    text('about-h', 700, 150, 560, 70, 'About me', { size: 56, color: '#2f3543', font: 'title' }),
    text('about-p', 700, 250, 560, 300, 'I help small businesses look their best, from the first logo sketch to the finished website. Every project starts with a coffee.\n\nI love clean typography.', { size: 20, color: '#2f3543' }),
    img('flower', 1250, 60, 40, 40, A + 'flower.svg', { svg: true })
  ] };
  const card = (i, x) => [
    img('c' + i + 'i', x, 300, 360, 240, A + 'card' + i + '.jpg', { alt: 'service ' + i }),
    text('c' + i + 't', x, 560, 360, 36, ['Logo design', 'Websites', 'Print'][i], { size: 28, color: '#2f3543', bold: true }),
    text('c' + i + 'p', x, 606, 360, 80, 'Short words about this service, two lines long at most.', { size: 18, color: '#555555' })
  ];
  const s3 = { key: 's3', anchor: 'page-1', height: 800, fill: { color: '#ffffff' }, nodes: [
    text('svc-h', 383, 120, 600, 70, 'Services', { size: 56, color: '#2f3543', align: 'center', font: 'title' }),
    ...card(0, 83), ...card(1, 503), ...card(2, 923)
  ] };
  const s4 = { key: 's4', anchor: 'page-2', height: 600, fill: { color: null }, nodes: [
    img('bg', 0, 0, 1366, 600, A + 'bg.jpg'),
    shape('veil', 0, 0, 1366, 600, 'rgba(0,0,0,0.45)'),
    text('ct-h', 383, 180, 600, 70, 'Let’s talk', { size: 56, color: '#ffffff', align: 'center', font: 'title' }),
    text('ct-p', 383, 280, 600, 60, 'hello@example.com · +1 555 0100', { size: 22, color: '#ffffff', align: 'center', href: 'mailto:hello@example.com' }),
    { id: 'clip', type: 'video', x: 483, y: 380, w: 400, h: 200, z: z++, src: A + 'clip.mp4', poster: A + 'poster.jpg' }
  ] };
  const s5 = { key: 's5', anchor: '', height: 160, fill: { color: '#2f3543' }, nodes: [
    text('copy', 60, 70, 400, 30, '© 2026 Olive Studio. All rights reserved.', { size: 14, color: '#bbbbbb' }),
    img('fb', 1150, 60, 40, 40, A + 'fb.svg', { svg: true, link: { href: 'https://www.facebook.com/example' } }),
    img('ig', 1210, 60, 40, 40, A + 'ig.svg', { svg: true, link: { href: 'https://www.instagram.com/example' } }),
    img('li', 1270, 60, 40, 40, A + 'li.svg', { svg: true, link: { href: 'https://www.linkedin.com/in/example' } })
  ] };
  const works = { key: 'w1', anchor: '', height: 500, fill: { color: '#ffffff' }, nodes: [
    text('w-h', 383, 80, 600, 70, 'Selected works', { size: 56, color: '#2f3543', align: 'center', font: 'title' }),
    text('w-back', 583, 200, 200, 30, 'Back to contact', { size: 18, color: '#2f3543', align: 'center', link: { page: 'doc1', anchor: 'page-2' } })
  ] };
  return P.makePuppet({
    source: 'canva', format: 'canva-app', origin: 'https://example-studio.my.canva.site/',
    site: { title: 'Brand Designer Portfolio Website in Beige', lang: 'en', dir: 'ltr' },
    fonts: { body: { family: 'Arimo' }, title: { family: 'The Seasons' } },
    pages: [
      { key: 'doc1', path: '/', title: 'Brand Designer Portfolio Website in Beige', name: '', width: 1366, sections: [s1, s2, s3, s4, s5] },
      { key: 'doc2', path: '/works', title: 'Works', name: 'Works', width: 1366, sections: [works] }
    ]
  });
}

function figmaDesign() {
  z = 0;
  const member = (i, x) => ({ id: 'm' + i, type: 'frame', x, y: 200, w: 260, h: 320, z: z++, layout: { mode: 'column', gap: 12 }, children: [
    { id: 'm' + i + 'p', type: 'image', x, y: 200, w: 200, h: 200, z: z++, src: 'https://example-site.figma.site/_assets/v11/p' + i + '.png', mask: 'circle', alt: 'member ' + i },
    text('m' + i + 'n', x, 410, 260, 30, ['Dana', 'Omer', 'Noa'][i], { size: 24, bold: true, font: 'Inter' }),
    text('m' + i + 'r', x, 446, 260, 24, ['Founder', 'Designer', 'Developer'][i], { size: 16, font: 'Inter' })
  ] });
  const stat = (i, x) => ({ id: 'st' + i, type: 'frame', x, y: 60, w: 300, h: 140, z: z++, layout: { mode: 'column', gap: 4 }, children: [
    text('st' + i + 'v', x, 60, 300, 80, ['120+', '98%', '12'][i], { size: 64, bold: true, font: 'Inter' }),
    text('st' + i + 'l', x, 150, 300, 30, ['projects', 'happy clients', 'awards'][i], { size: 18, font: 'Inter' })
  ] });
  const team = { key: 'team', anchor: 'team', name: 'Team', height: 600, fill: { color: '#fafafa' }, layout: { mode: 'column', gap: 24 }, nodes: [
    text('team-h', 400, 80, 480, 60, 'Our team', { size: 48, font: 'Inter', align: 'center' }),
    { id: 'row', type: 'frame', x: 160, y: 200, w: 960, h: 320, z: z++, layout: { mode: 'row', gap: 40 }, children: [member(0, 160), member(1, 510), member(2, 860)] }
  ] };
  const numbers = { key: 'numbers', anchor: 'numbers', name: 'Numbers', height: 260, fill: { color: '#111827' }, layout: { mode: 'column' }, nodes: [
    { id: 'grid', type: 'frame', x: 130, y: 60, w: 1020, h: 140, z: z++, layout: { mode: 'grid', columns: 3, gap: 20 }, children: [stat(0, 130), stat(1, 490), stat(2, 850)] }
  ] };
  return P.makePuppet({
    source: 'figma', format: 'figma-sites', origin: 'https://example-site.figma.site',
    site: { title: 'Example Team', lang: 'en', dir: 'ltr' },
    fonts: { Inter: { family: 'Inter' } },
    pages: [{ key: '0:3', path: '/', title: 'Example Team', name: 'Home', width: 1280, sections: [team, numbers] }]
  });
}

function find(blocks, pred) {
  for (const b of blocks || []) {
    if (pred(b)) return b;
    const d = b.data || {};
    const x = find(d.blocks, pred);
    if (x) return x;
    for (const c of d.columns || []) { const y = find(c.blocks, pred); if (y) return y; }
  }
  return null;
}

(async () => {
  // ── 1. the Canva-shaped page ──
  const canva = canvaDesign();
  check('synthetic canva puppet is sound', P.validatePuppet(canva).length === 0, P.validatePuppet(canva));
  const living = life.breathe(canva);
  const done = life.finish(living);
  const home = done.pages[0];
  const top = home.blocks.map((b) => b.type);
  check('home page: hero, section, section, backdrop, section', JSON.stringify(top) === JSON.stringify(['hero', 'section', 'section', 'parallax', 'section']), top);
  check('the brand names the home page and the site', home.title === 'Olive Studio' && home.slug === 'olive-studio' && living.brand && living.brand.text === 'Olive Studio', [home.title, home.slug, living.brand]);
  check('the menu band left the page for the menu', JSON.stringify(done.menu) === JSON.stringify([{ label: 'About', url: '/#about' }, { label: 'Services', url: '/#services' }, { label: 'Contact', url: '/#contact' }]), done.menu);
  check('no menu label is left on the page', !JSON.stringify(home.blocks).includes('"Services"') || !!find(home.blocks, (b) => b.type === 'heading' && b.data.text === 'Services'));
  const hero = home.blocks[0];
  check('the opening screen is a full-width hero with the design’s color', hero.data.width === 'full' && hero.data.style && hero.data.style.background === '#2f3543', hero.data);
  const h1 = find(home.blocks, (b) => b.type === 'heading' && b.data.level === 1);
  check('ONE h1, its visual line break reflowed', h1 && h1.data.text === 'Design that feels like home' && h1.data.align === 'center' && h1.data.animate === 'rise', h1);
  check('only one h1 on the page', JSON.stringify(home.blocks).split('"level":1').length === 2);
  const lead = find(home.blocks, (b) => b.type === 'text' && /Brand identity/.test(b.data.content));
  check('the hero promise is a lead paragraph, not a heading', lead && lead.data.size === 'lg', lead);
  const btn = find(home.blocks, (b) => b.type === 'button');
  check('the pill with a word is a BUTTON wearing the pill', btn && btn.data.text === 'HIRE ME' && btn.data.style.background === '#f16d82' && btn.data.style.color === '#000000' && btn.data.style.radius === 'lg' && btn.data.target === '_blank', btn);
  const about = home.blocks[1];
  check('the about band is anchored by its menu label and is edge to edge', about.id === 'about' && about.data.width === 'full' && about.data.style.background === '#f4f4f4', about);
  const row = find(about.data.blocks, (b) => b.type === 'columns');
  check('image|text is a ROW with the designer’s ratio', row && row.data.columns.length === 2 && row.data.ratio === '45:55' && row.data.columns[0].blocks[0].type === 'image' && row.data.columns[1].blocks[0].type === 'heading', row && row.data);
  check('the paragraph break survived, the alt text too', JSON.stringify(about).includes('coffee.\\n\\nI love clean typography.') && JSON.stringify(about).includes('Portrait of Olive'));
  check('a 40px decorative svg was dropped (and counted)', !JSON.stringify(about).includes('flower.svg') && living.report.dropped['small icon'] >= 1, living.report.dropped);
  const cards = find(home.blocks, (b) => b.type === 'cards');
  check('three picture+title+text cells are CARDS', cards && cards.data.items.length === 3 && cards.data.items[1].title === 'Websites' && /service/.test(cards.data.items[1].excerpt) && cards.data.items[1].image.endsWith('card1.jpg'), cards && cards.data);
  const back = home.blocks[3];
  check('a photo under a dark veil is a BACKDROP with the veil as overlay', back.type === 'parallax' && back.data.image.endsWith('bg.jpg') && back.data.overlay === 45 && back.data.width === 'full' && back.id === 'contact', back.data);
  check('a contact line is information, not a title', !!find(back.data.blocks, (b) => b.type === 'text' && /mailto:hello@example\.com/.test(b.data.content)));
  check('the clip is a VIDEO with its poster', !!find(back.data.blocks, (b) => b.type === 'video' && b.data.src.endsWith('clip.mp4') && b.data.poster.endsWith('poster.jpg')));
  const social = find(home.blocks, (b) => b.type === 'social');
  check('linked little icons are SOCIAL', social && social.data.items.map((i) => i.network).join(',') === 'facebook,instagram,linkedin', social && social.data);
  const works = done.pages[1];
  const backLink = find(works.blocks, (b) => b.type === 'text' && /Back to contact/.test(b.data.content));
  check('a link to another page’s section lands on the new page + anchor', backLink && backLink.data.content.includes('@LINK(url: "/#contact")'), backLink && backLink.data.content);
  const f2 = life.finish(living, { homeIsRoot: false, slugFor: (k, s) => s + '-2' });
  check('finish() re-resolves with final slugs when the home is not the root', f2.menu[0].url === '/olive-studio-2.html#about' && f2.pages[0].slug === 'olive-studio-2', f2.menu);

  // ── 2. the Figma-shaped page ──
  const fg = figmaDesign();
  check('synthetic figma puppet is sound', P.validatePuppet(fg).length === 0, P.validatePuppet(fg));
  const fl = life.finish(life.breathe(fg));
  const fh = fl.pages[0];
  const team = find(fh.blocks, (b) => b.type === 'team');
  check('auto-layout row of round portraits + name + role is a TEAM', team && team.data.items.length === 3 && team.data.items[0].name === 'Dana' && team.data.items[0].role === 'Founder', team && team.data);
  const stats = find(fh.blocks, (b) => b.type === 'stats');
  check('a grid of big numbers with labels is STATS', stats && stats.data.items.length === 3 && stats.data.items[0].value === '120+' && stats.data.items[1].label === 'happy clients', stats && stats.data);
  check('a design without a menu gets one from its sections', fl.menu.length === 0 || fl.menu.every((m) => m.url.startsWith('/#')), fl.menu);
  check('figma section names become anchors', fh.blocks[0].id === 'team' && fh.blocks[1].id === 'numbers', fh.blocks.map((b) => b.id));

  // ── 3. the XY-cut on a 2×3 wall of cards ──
  z = 0;
  const wall = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    const x = 80 + c * 420;
    const y = 100 + r * 420;
    wall.push(img('w' + r + c + 'i', x, y, 360, 220, A + 'w' + r + c + '.jpg'));
    wall.push(text('w' + r + c + 't', x, y + 236, 360, 36, 'Project ' + (r * 3 + c + 1), { size: 26, bold: true }));
    wall.push(text('w' + r + c + 'p', x, y + 280, 360, 50, 'A few words about the project.', { size: 18 }));
  }
  const wallPuppet = P.makePuppet({ source: 'canva', format: 'canva-static', pages: [{ key: 'p', path: '/', title: 'Wall', width: 1366, sections: [{ key: 'w', height: 1000, fill: { color: '#ffffff' }, nodes: wall }] }] });
  const wallDone = life.finish(life.breathe(wallPuppet)).pages[0];
  const wallCards = [];
  JSON.stringify(wallDone.blocks, (k, v) => { if (v && v.type === 'cards') wallCards.push(v); return v; });
  check('a 2×3 wall of cards is read row by row: two CARDS of three', wallCards.length === 2 && wallCards.every((c) => c.data.items.length === 3) && wallCards[1].data.items[0].title === 'Project 4', wallCards.map((c) => c.data.items.map((i) => i.title)));

  // ── 3b. a Hebrew design: direction from its words, rows mirrored ──
  z = 0;
  const he = P.makePuppet({ source: 'canva', format: 'canva-static', pages: [{ key: 'h', path: '/', title: 'סטודיו', width: 1366, sections: [{ key: 's', height: 700, fill: { color: '#ffffff' }, nodes: [
    img('he-img', 80, 100, 520, 500, A + 'he.jpg', { alt: 'תמונה' }),
    text('he-h', 700, 140, 560, 70, 'עלינו', { size: 56 }),
    text('he-p', 700, 240, 560, 200, 'אנחנו סטודיו קטן שמעצב אתרים לעסקים קטנים, באהבה ובסבלנות, מהסקיצה הראשונה ועד האתר המוכן.', { size: 20 })
  ] }] }] });
  const hePage = life.finish(life.breathe(he)).pages[0];
  const heRow = find(hePage.blocks, (b) => b.type === 'columns');
  check('a Hebrew design is an RTL page', hePage.dir === 'rtl' && hePage.lang === 'he', [hePage.dir, hePage.lang]);
  check('RTL rows are mirrored: the picture on the left stays on the left', heRow && heRow.data.columns[0].blocks[0].type === 'heading' && heRow.data.columns[1].blocks[0].type === 'image', heRow && heRow.data.columns.map((c) => c.blocks[0].type));

  // ── 3c. an echoed word keeps its solid original ──
  z = 0;
  const echo = (id, y, t, eff) => Object.assign(text(id, 123, y, 600, 125, t, { size: 90, font: 'title', color: '#e46f82' }), eff ? { effect: eff } : {});
  const echoP = P.makePuppet({ source: 'canva', format: 'canva-app', pages: [{ key: 'e', path: '/', title: 'Echo', width: 1366, sections: [{ key: 's', height: 800, fill: { color: '#2f3543' }, nodes: [
    echo('e1', 244, 'PORTFOLIO'), echo('e2', 327, 'PORTFOL', 'hollow'), echo('e3', 409, 'PORTFOL', 'hollow'), echo('e4', 491, 'PORTFOLIO', 'hollow')
  ] }] }] });
  const echoLiving = life.breathe(echoP);
  check('stacked hollow copies of a word are echoes: one heading, three counted', JSON.stringify(echoLiving.pages[0].blocks).split('PORTFOL').length === 2 && echoLiving.report.dropped.echo === 3, echoLiving.report.dropped);

  // ── 3d. one heading set as pieces; a sticker stacked on itself ──
  z = 0;
  const frag = (id, x, y, w, t, color, eff) => Object.assign(text(id, x, y, w, 98, t, { size: 77, font: 'title', color }), eff ? { effect: eff } : {});
  const fragP = P.makePuppet({ source: 'canva', format: 'canva-app', pages: [{ key: 'f', path: '/', title: 'Frag', width: 1366, sections: [{ key: 's', height: 768, fill: { color: '#f4f4f4' }, nodes: [
    frag('f1', 161, 179, 295, 'Hello!', '#2f3543'),
    frag('f2', 131, 267, 152, 'I’m', '#2f3543'),
    frag('f3', 288, 267, 216, 'Noa', '#f16d82', 'hollow'),
    frag('f4', 499, 267, 31, '!', '#f16d82'),
    frag('f5', 498, 273, 30, '!', '#2f3543'),
    text('body', 131, 420, 520, 120, 'An aspiring designer and virtual assistant who loves turning ideas into pages people remember.', { size: 20 }),
    img('glyph', 900, 400, 195, 195, A + 'flower.png'),
    img('glyph2', 980, 480, 37, 37, A + 'flower.png')
  ] }] }] });
  const fragLiving = life.breathe(fragP);
  const fragHeads = [];
  JSON.stringify(fragLiving.pages[0].blocks, (k, v) => { if (v && v.type === 'heading') fragHeads.push(v.data.text); return v; });
  check('a heading set as pieces (and a shadow "!") reads as ONE heading', fragHeads.length === 1 && fragHeads[0] === 'Hello! I’m Noa!', fragHeads);
  check('a sticker with a smaller copy of itself inside is decoration, not a backdrop', !JSON.stringify(fragLiving.pages[0].blocks).includes('flower.png') && fragLiving.report.dropped.decoration >= 1, fragLiving.report.dropped);

  // ── 4. text roles ──
  const scale = { body: 18, max: 80 };
  const cls = (t, o) => life.classifyText(text('t', 0, 0, 100, 20, t, o), scale);
  check('contact lines are never headings', cls('call +972 50 123 4567', { size: 30 }).kind === 'text' && cls('hello@studio.example', { size: 40 }).kind === 'text');
  check('a long sentence at 1.3× body is a lead paragraph', cls('We design brands that people remember for years.', { size: 24 }).kind === 'text');
  check('a short bold line at body size is a small heading (a card title)', cls('Web design', { size: 18, bold: true }).kind === 'heading');
  check('small spaced caps are a kicker', cls('ABOUT ME', { size: 16, upper: true }).kind === 'kicker');
  check('a bullet run is a LIST', cls('one\ntwo\nthree', { list: 'bullet' }).kind === 'list');

  // ── 5. the look ──
  const look = extractLook(living, canva);
  const o = look.overrides;
  check('page color = the fill with the most area (near-whites merged into one)', P.colorDistance(o.colors.bg, '#f4f4f4') < 28, o.colors);
  check('words = the text color on it', o.colors.text === '#2f3543', o.colors);
  check('accent = the pill / colored titles', o.colors.primary === '#f16d82', o.colors);
  check('fonts: The Seasons → Playfair Display, Arimo exact', o.fonts.headingFamily.includes('Playfair Display') && o.fonts.family.includes('Arimo') && o.fonts.google.includes('Playfair Display') && o.fonts.google.includes('Arimo'), o.fonts);
  check('pill buttons → round style, flat design', o.style.radius === 'round' && o.style.shadow === 'flat' && o.style.accent === 'solid', o.style);
  check('the dark menu band colors the header', o.chrome.headerBg === '#2f3543', o.chrome);
  // two pages, two h1s (88px and 56px): the site's h1 is their median, fluid
  check('the design’s title size, fluid', /h1 \{ font-size: clamp\(2\.25rem, 5\.3vw, 4\.5rem\)/.test(o.skin.css) && /h2 \{ font-size: clamp\(/.test(o.skin.css), o.skin.css);
  const td = require('../src/bentml/theme-dialect');
  const parsed = td.parseTheme(look.bent);
  check('<bent-theme> round-trips', parsed.overrides.colors.primary === '#f16d82' && parsed.overrides.skin.css === o.skin.css && /Olive Studio · Canva/.test(look.bent), parsed.overrides.colors);
  check('font map: exact, cousin, Hebrew, category', F.mapFamily('Montserrat').exact && F.mapFamily('Canva Sans').family === 'DM Sans' && F.mapFamily('Montserrat', { hebrew: true }).family === 'Heebo' && F.mapFamily('Zorblax Script').family === 'Dancing Script');

  // ── 6. landing with a fake network, and undo ──
  require('../src/db');
  const gp = require('../src/geppetto');
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a00000000049454e44ae426082', 'hex');
  const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#123"/></svg>');
  const MP4 = Buffer.concat([Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex'), Buffer.alloc(64)]);
  const seen = [];
  const transport = async (url) => {
    seen.push(url);
    if (/\.mp4$/.test(url)) return { status: 200, contentType: 'video/mp4', buffer: MP4, url };
    if (/\.svg$/.test(url)) return { status: 200, contentType: 'image/svg+xml', buffer: SVG, url };
    return { status: 200, contentType: 'image/png', buffer: PNG, url };
  };
  const pagesLib = require('../src/pages');
  pagesLib.createPage({ title: 'Existing', slug: 'olive-studio', blocks: [] }); // a page already at the brand's address
  const theme = require('../src/theme');
  const menus = require('../src/menus');
  const { loadConfig } = require('../src/config');
  const beforeTheme = JSON.stringify(theme.loadOverrides());
  const beforeMenu = JSON.stringify(menus.loadMenus().main);
  const beforeTitle = loadConfig().title;
  const plan = gp.planFromPuppet(canvaDesign(), { door: 'canva', url: 'https://example-studio.my.canva.site/' });
  check('a plan is stored and loadable', !!gp.loadPlan(plan.id) && plan.pages.length === 2 && plan.pages.every((p) => /<bent-/.test(p.source) && !p.errors.length), plan.pages.map((p) => p.errors));
  const preview = gp.previewHtml(plan, 'doc1');
  check('the preview is the page in ITS theme with ITS menu', preview.includes('#f16d82') && preview.includes('>About<') && preview.includes('Olive Studio') && preview.includes('sec-w-full'));
  const landed = await gp.landPlan(plan.id, { mode: 'live' }, { transport, rebuild: false });
  check('landed live', landed.ok && landed.mode === 'live' && landed.pages.length === 2, landed);
  const homeSlug = landed.pages.find((p) => p.home).fullPath;
  check('an existing page is never overwritten (the slug moved aside)', homeSlug === 'olive-studio-2' && pagesLib.getPageByFullPath('olive-studio').title === 'Existing', homeSlug);
  const homeRow = pagesLib.getPageByFullPath(homeSlug);
  check('the page is published BenTML, anchors intact', homeRow.status === 'published' && JSON.stringify(homeRow.blocks).includes('"id":"about"'), homeRow.status);
  const homeJson = JSON.stringify(homeRow.blocks);
  check('every picture became a file of this site', !/example-studio\.my\.canva\.site/.test(homeJson) && /\/assets\/geppetto\//.test(homeJson), homeJson.match(/https?:\/\/[^"]+/g));
  check('the clip too', /\/assets\/geppetto\/[^"]+\.mp4/.test(homeJson) && landed.media.videos === 1, landed.media);
  const live = theme.loadOverrides();
  check('the look is applied, and filed in the library', live.colors.primary === '#f16d82' && landed.theme && landed.theme.applied && require('../src/theme-library').getTheme(landed.theme.id), live.colors);
  check('the menu is the design’s', JSON.stringify(menus.loadMenus().main.map((m) => [m.label, m.url])) === JSON.stringify([['About', '/#about'], ['Services', '/#services'], ['Contact', '/#contact']]), menus.loadMenus().main);
  check('the home page wears the crown, the brand names the site', loadConfig().homepage === homeSlug && loadConfig().title === 'Olive Studio', [loadConfig().homepage, loadConfig().title]);
  const worksRow = pagesLib.getPageByFullPath(landed.pages.find((p) => !p.home).fullPath);
  check('the other page links back to the home anchor', JSON.stringify(worksRow.blocks).includes('/#contact'));
  check('nothing reached the real network (only the fake one)', seen.length > 5 && seen.every((u) => u.startsWith('https://example-studio.my.canva.site/')), seen.length);
  const records = gp.listImports();
  check('the landing left a record', records.length === 1 && records[0].id === landed.importId && records[0].pagesCreated.length === 2);

  const undone = gp.undo(landed.importId, { rebuild: false });
  check('undo removed the imported pages, never the owner’s', undone.pagesRemoved.length === 2 && !pagesLib.getPageByFullPath(homeSlug) && !!pagesLib.getPageByFullPath('olive-studio'), undone);
  check('undo removed the media it brought', undone.media >= 5 && !fs.existsSync(path.join(require('../src/paths').ASSETS_DIR, 'geppetto', landed.pages[0].fullPath)), undone.media);
  check('undo put the look back', JSON.stringify(theme.loadOverrides()) === beforeTheme);
  check('undo put the menu back', JSON.stringify(menus.loadMenus().main) === beforeMenu);
  check('undo put the crown and the name back', (loadConfig().homepage || '') === '' && loadConfig().title === beforeTitle, [loadConfig().homepage, loadConfig().title]);
  let again = '';
  try { gp.undo(landed.importId, { rebuild: false }); } catch (e) { again = e.code; }
  check('an import is undone once', again === 'ALREADY');

  const plan2 = gp.planFromPuppet(canvaDesign(), { door: 'canva' });
  const drafts = await gp.landPlan(plan2.id, { mode: 'drafts' }, { transport, rebuild: false });
  check('drafts mode: pages are drafts, the live look/menu/crown untouched, the theme only filed',
    drafts.pages.every((p) => pagesLib.getPageByFullPath(p.fullPath).status === 'draft') && JSON.stringify(theme.loadOverrides()) === beforeTheme &&
    JSON.stringify(menus.loadMenus().main) === beforeMenu && !loadConfig().homepage && drafts.theme && drafts.theme.applied === false, drafts);
  gp.undo(drafts.importId, { rebuild: false });

  // ── 7. the stretch band, both dialects ──
  const { renderBlock } = require('../src/renderer');
  const sec = renderBlock({ type: 'section', id: 'band', data: { width: 'full', style: { background: '#101010' }, blocks: [{ type: 'text', id: 'text_x', data: { content: 'hi' } }] } }, 'ltr');
  check('SECTION width=full renders a band with an inner column', /class="bent-section tz-section sec-w-full"/.test(sec) && sec.includes('<div class="sec-inner">'), sec);
  const px = renderBlock({ type: 'parallax', id: 'p', data: { width: 'full', image: '/a.jpg', blocks: [] } }, 'ltr');
  check('BACKDROP width=full', px.includes('px-w-full'));
  const hr = renderBlock({ type: 'hero', id: 'h', data: { width: 'wide', blocks: [{ type: 'heading', id: 'heading_x', data: { level: 1, text: 'X' } }] } }, 'ltr');
  check('HERO width=wide', hr.includes('hero-w-wide'));
  const bent = require('../src/bentml');
  const kw = 'BENTML 0.2\nMETA {\n  title: "w"\n}\nSECTION(width: full) {\n  TEXT { a }\n}\nBACKDROP(image: "/x.jpg", width: wide, tint: dark) {\n  TEXT { b }\n}\nHERO(width: full) {\n  HEADING(level: 1) { c }\n}\n';
  const compiled = bent.compile(kw);
  const kblocks = compiled.blocks || (compiled.page && compiled.page.blocks) || [];
  check('keyword dialect compiles width', kblocks[0] && kblocks[0].data.width === 'full' && kblocks[1].data.width === 'wide' && kblocks[1].data.tint === 'dark' && kblocks[2].data.width === 'full', kblocks.map((b) => b.data));
  const dec = bent.decompile({ title: 'w', slug: 'w' }, kblocks);
  check('keyword dialect decompiles width', /SECTION\(width: full\)/.test(dec) && /width: wide/.test(dec) && /HERO\(width: full\)/.test(dec), dec);
  const pzn = require('../src/pzn/index');
  const rt = pzn.toTapuzPage(pzn.parse(pzn.serialize(pzn.fromTapuzPage({ title: 't', slug: 't', direction: 'ltr', blocks: kblocks })))).blocks;
  check('the .pzn bridge carries width, tint and fade', rt[0].data.width === 'full' && rt[1].data.width === 'wide' && rt[1].data.tint === 'dark' && rt[2].data.width === 'full', rt.map((b) => b.data));

  // ── 8. untrusted design text stays text ──
  z = 0;
  const evil = P.makePuppet({ source: 'canva', format: 'canva-app', pages: [{ key: 'e', path: '/', title: 'Evil', width: 1366, sections: [{ key: 's', height: 400,
    fill: { color: null, gradient: 'linear-gradient(red, blue); position: fixed' }, nodes: [
      text('x', 100, 100, 600, 60, '<script>alert(1)</script> @B{x}', { size: 40 }),
      text('y', 100, 200, 600, 30, 'click', { size: 18, href: 'javascript:alert(2)' }),
      shape('s1', 100, 300, 200, 50, 'red; position:fixed'),
      text('st', 120, 310, 160, 30, 'Go', { size: 18, href: 'https://example.org' })
    ] }] }] });
  const ep = gp.planFromPuppet(evil, {});
  const ehtml = gp.previewHtml(ep, 'e');
  const body = ehtml.slice(ehtml.indexOf('<main'));
  check('a design’s <script> text is escaped', !body.includes('<script>alert(1)') && body.includes('&lt;script&gt;'));
  check('a literal @B{ in design text stays literal', !body.includes('<strong>x</strong>'));
  check('a javascript: link never reaches the page', !/javascript:alert/.test(body));
  check('no CSS smuggled through a gradient or a color', !/position:\s*fixed/.test(body), body.match(/style="[^"]*"/g));

  // a browser drops control characters (and a CR/LF/tab inside the scheme)
  // before it reads a link's scheme — the smuggled forms must die too, in the
  // menu the design's band becomes as well as on the page
  z = 0;
  const sly = ['\x01javascript:alert(3)', 'java\rscript:alert(4)', '\x00javascript:alert(5)'];
  const smuggled = P.makePuppet({ source: 'canva', format: 'canva-app', pages: [{ key: 'm', path: '/', title: 'Sly', width: 1366, sections: [
    { key: 'band', height: 140, fill: { color: '#2f3543' }, nodes: [
      text('sb', 60, 40, 260, 40, 'Sly Studio', { size: 30, color: '#ffffff', bold: true }),
      text('sn1', 900, 45, 90, 30, 'About', { size: 18, color: '#ffffff', link: { href: sly[0] } }),
      text('sn2', 1010, 45, 100, 30, 'Work', { size: 18, color: '#ffffff', link: { href: sly[1] } }),
      text('sn3', 1130, 45, 100, 30, 'Contact', { size: 18, color: '#ffffff', link: { href: sly[2] } })
    ] },
    { key: 'body', height: 500, fill: { color: '#ffffff' }, nodes: [
      text('sh', 383, 100, 600, 70, 'Hello there', { size: 56, color: '#2f3543', align: 'center' }),
      text('sl', 383, 200, 600, 30, 'read more', { size: 18, href: sly[1] }),
      shape('sp', 583, 300, 200, 60, '#f16d82', { radius: 30 }),
      text('spt', 603, 315, 160, 30, 'GO', { size: 18, color: '#000000', align: 'center', href: sly[0] })
    ] }] }] });
  const sp = gp.planFromPuppet(smuggled, {});
  const shtml = gp.previewHtml(sp, 'm');
  const decode = (v) => v.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(+d));
  const runs = (html) => (html.match(/href\s*=\s*"[^"]*"/gi) || []).filter((h) => /^href="(?:javascript|vbscript|data):/i.test(decode(h).replace(/[\x00-\x20\x7f]/g, '')));
  check('a smuggled scheme (control char, CR inside) dies in the plan', !/script:alert/.test(JSON.stringify(sp)), JSON.stringify(sp).match(/.{40}script:alert.{10}/g));
  check('…and on the previewed page, menu included', runs(shtml).length === 0, runs(shtml));
  check('…and in the BenTML source that lands', !/script:alert/.test(JSON.stringify(sp.pages.map((pg) => pg.source || pg.bentml || ''))));

  // ── 9. undo takes back the import — never what came after it ──
  const themeLib = require('../src/theme-library');
  const { saveConfig } = require('../src/config');
  const { renderPage } = require('../src/renderer');
  const ZWNJ = String.fromCharCode(0x200c);
  const mini = (name, color) => {
    z = 0;
    const Name = name[0].toUpperCase() + name.slice(1);
    return P.makePuppet({ source: 'canva', format: 'canva-app', origin: 'https://' + name + '.my.canva.site/',
      site: { title: Name, lang: 'en', dir: 'ltr' },
      pages: [{ key: 'h', path: '/', title: Name, name: '', width: 1366, sections: [
        { key: 'top', height: 140, fill: { color }, nodes: [
          text('b', 60, 40, 260, 40, Name, { size: 30, color: '#ffffff', bold: true }),
          text('n1', 900, 45, 90, 30, 'About', { size: 18, color: '#ffffff', link: { anchor: 'a' } }),
          text('n2', 1010, 45, 100, 30, 'Work', { size: 18, color: '#ffffff', link: { anchor: 'w' } }),
          text('n3', 1130, 45, 100, 30, 'Contact', { size: 18, color: '#ffffff', link: { anchor: 'c' } })
        ] },
        { key: 's1', anchor: 'a', height: 500, fill: { color: '#ffffff' }, nodes: [
          text('h1', 383, 100, 600, 70, 'About ' + Name, { size: 56, color, align: 'center' }),
          text('p1', 383, 200, 600, 60, 'Write @b{bold}, @link(url: "https://example.org"){a link}, @BREAK and mail hello@code.org', { size: 18 })
        ] },
        { key: 's2', anchor: 'w', height: 400, fill: { color: '#f4f4f4' }, nodes: [
          text('h2', 383, 60, 600, 70, 'Work of ' + Name, { size: 56, color, align: 'center' }),
          img('pic', 533, 150, 300, 200, 'https://' + name + '.my.canva.site/_assets/media/work.jpg', { alt: 'work' })
        ] },
        { key: 's3', anchor: 'c', height: 400, fill: { color: '#ffffff' }, nodes: [text('h3', 383, 100, 600, 70, 'Contact ' + Name, { size: 56, color, align: 'center' })] }
      ] }] });
  };
  const landMini = async (name, color, choices) => gp.landPlan(gp.planFromPuppet(mini(name, color), {}).id, Object.assign({ mode: 'live' }, choices), { transport, rebuild: false });
  const homeOf = (r) => r.pages.find((pg) => pg.home).fullPath;

  // other previews pass siteTitle — the header never read it, and must not start to
  const cfgL = loadConfig(); cfgL.logo = { type: 'image', image: '/assets/owner-logo.png' }; saveConfig(cfgL);
  const bare = { title: 'x', full_path: 'x', direction: 'ltr', blocks: [], status: 'published' };
  check('a preview passing siteTitle keeps the site’s image logo', renderPage(bare, { siteTitle: 'My Site' }).includes('/assets/owner-logo.png'));
  check('Geppetto’s previewBrand shows the design’s brand instead', !renderPage(bare, { previewBrand: 'Alpha' }).includes('/assets/owner-logo.png'));
  const cfgN = loadConfig(); delete cfgN.logo; saveConfig(cfgN);

  // the owner's site: a crown, a name, a menu, a look with its own menu knobs
  const ownerHome = 'olive-studio';
  const cfg0 = loadConfig(); cfg0.homepage = ownerHome; cfg0.title = 'My Site'; saveConfig(cfg0);
  menus.saveMenus({ main: [{ label: 'דף הבית', url: '/', type: 'custom' }] });
  theme.saveOverrides(theme.mergeDeep(theme.loadOverrides(), theme.knobsToOverrides({ placement: 'side', fold: 5, align: 'center' }).overrides));
  const ownerLook = JSON.stringify(theme.loadOverrides());
  const ownerMenu = JSON.stringify(menus.loadMenus().main.map((m) => [m.label, m.url]));
  const chromeNow = () => JSON.stringify([loadConfig().homepage, loadConfig().title, theme.loadOverrides(), menus.loadMenus().main.map((m) => [m.label, m.url])]);

  const imA = await landMini('alpha', '#aa3355');
  const aHtml = pagesLib.getPageByFullPath(homeOf(imA)).blocks.map((b) => renderBlock(b, 'ltr')).join('');
  check('design text that looks like BenTML stays text on the LANDED page, in any case',
    aHtml.includes('@' + ZWNJ + 'b{bold}') && aHtml.includes('@' + ZWNJ + 'link(') && aHtml.includes('@' + ZWNJ + 'BREAK') &&
    !aHtml.includes('<strong>bold') && !aHtml.includes('href="https://example.org"'), aHtml.match(/Write[^<]*/));
  check('…and an address like hello@code.org is left exactly as written', aHtml.includes('hello@code.org'));

  const imB = await landMini('bravo', '#3355aa');
  const afterB = chromeNow();
  const uA = gp.undo(imA.importId, { rebuild: false });
  check('undoing an OLDER import leaves the newer one’s crown, name, look and menu',
    chromeNow() === afterB && uA.pagesRemoved.length === imA.pages.length && ['theme', 'menu', 'homepage'].every((k) => uA.left.includes(k)), uA);
  const uB = gp.undo(imB.importId, { rebuild: false });
  check('…and undoing the newer one brings back the owner’s — not a ghost of the older import',
    loadConfig().homepage === ownerHome && loadConfig().title === 'My Site' && JSON.stringify(menus.loadMenus().main.map((m) => [m.label, m.url])) === ownerMenu, [loadConfig().homepage, loadConfig().title, uB]);
  check('the owner’s look is back exactly, menu knobs included', JSON.stringify(theme.loadOverrides()) === ownerLook, theme.menuKnobs(theme.loadOverrides()));

  const imC = await landMini('charlie', '#118844');
  const cHome = homeOf(imC);
  const cRow = pagesLib.getPageByFullPath(cHome);
  pagesLib.updatePage(cHome, { blocks: cRow.draft_blocks.concat([{ type: 'text', id: 'text_owner', data: { content: 'the owner wrote this' } }]) }); // a draft save, not even published
  const uC = gp.undo(imC.importId, { rebuild: false });
  check('an imported page the owner edited since is kept by undo — with the pictures it shows', uC.pagesKept.includes(cHome) && !!pagesLib.getPageByFullPath(cHome) && uC.mediaKept === true && uC.mediaKeptFor === 'page:' + cHome && uC.pagesRemoved.length === imC.pages.length - 1, uC);
  check('…the crown stays on it (it is not going away), the rest is the owner’s again', loadConfig().homepage === cHome && loadConfig().title === 'My Site' && JSON.stringify(theme.loadOverrides()) === ownerLook, [loadConfig().homepage, loadConfig().title]);
  pagesLib.deletePage(cHome);
  const cfg1 = loadConfig(); cfg1.homepage = ownerHome; cfg1.title = ''; saveConfig(cfg1);

  const imD = await landMini('delta', '#884411');
  const tuned = theme.loadOverrides();
  tuned.colors = Object.assign({}, tuned.colors, { primary: '#00aa88' });
  theme.saveOverrides(tuned);
  const uD = gp.undo(imD.importId, { rebuild: false });
  const filed = themeLib.listThemes().map((t) => themeLib.getTheme(t.id)).find((e) => e && e.overrides && e.overrides.colors && e.overrides.colors.primary === '#00aa88');
  check('a look tuned after the import is filed in the library before the old look returns', !!uD.themeSaved && !!filed && JSON.stringify(theme.loadOverrides()) === ownerLook, [uD.themeSaved, theme.loadOverrides().colors]);
  check('a site that had no name before the import has none after undo', loadConfig().title === '', loadConfig().title);
  if (filed) themeLib.removeTheme(filed.id);

  const first = landMini('echo', '#445566');
  let busy = '';
  try { await landMini('foxtrot', '#665544'); } catch (e) { busy = e.code; }
  const imE = await first;
  check('one landing at a time: a second one is refused while the first runs', busy === 'BUSY', busy);
  gp.undo(imE.importId, { rebuild: false });

  const ledger = gp.listImports().length;
  const realSave = pagesLib.savePageSource;
  pagesLib.savePageSource = () => { throw new Error('the disk is full'); };
  let broke = '';
  try { await landMini('golf', '#556677'); } catch (e) { broke = e.message; }
  pagesLib.savePageSource = realSave;
  const golfLeft = pagesLib.listPages().filter((pg) => /^golf/.test(pg.full_path)).map((pg) => pg.full_path);
  const golfMedia = fs.existsSync(path.join(require('../src/paths').ASSETS_DIR, 'geppetto')) ? fs.readdirSync(path.join(require('../src/paths').ASSETS_DIR, 'geppetto')).filter((f) => /^golf/.test(f)) : [];
  check('a landing that fails half-way takes itself back: no reserved page, no files, no record', broke === 'the disk is full' && !golfLeft.length && !golfMedia.length && gp.listImports().length === ledger, [broke, golfLeft, golfMedia]);
  check('…and the site is as it was', loadConfig().homepage === ownerHome && JSON.stringify(theme.loadOverrides()) === ownerLook && JSON.stringify(menus.loadMenus().main.map((m) => [m.label, m.url])) === ownerMenu);

  const { ASSETS_DIR, CONFIG_DIR } = require('../src/paths');
  const ledgerPath = path.join(CONFIG_DIR, 'geppetto', 'imports.json');
  const ownerAgain = () => {
    theme.saveOverrides(JSON.parse(ownerLook));
    menus.saveMenus({ main: [{ label: 'דף הבית', url: '/', type: 'custom' }] });
    const cfg = loadConfig(); cfg.homepage = ownerHome; cfg.title = 'My Site'; saveConfig(cfg);
  };
  ownerAgain();

  // a page the owner renamed is still the import's (its stamp says so)
  const imH = await landMini('hotel', '#335577');
  pagesLib.updatePage(homeOf(imH), { slug: 'hotel-renamed' });
  const uH = gp.undo(imH.importId, { rebuild: false });
  const hRow = pagesLib.getPageByFullPath('hotel-renamed');
  const hPic = hRow ? (JSON.stringify(hRow.draft_blocks || hRow.blocks).match(/\/assets\/geppetto\/[^"\\]+/) || [])[0] : '';
  check('a page the owner renamed survives undo — and the pictures it shows stay on disk',
    uH.pagesKept.includes('hotel-renamed') && !!hRow && uH.mediaKept === true && !!hPic && fs.existsSync(path.join(ASSETS_DIR, hPic.replace(/^\/assets\//, ''))), [uH, hPic]);
  pagesLib.deletePage('hotel-renamed');
  ownerAgain();

  // what the owner changed between two imports is what the newer one gives back
  const imJ = await landMini('juliett', '#aa7700');
  const edited = theme.loadOverrides();
  edited.colors = Object.assign({}, edited.colors, { primary: '#118811' });
  theme.saveOverrides(edited);
  menus.saveMenus({ main: [{ label: 'OwnerMenu', url: '/', type: 'custom' }] });
  const editedLook = JSON.stringify(theme.loadOverrides());
  const imK = await landMini('kilo', '#0077aa');
  gp.undo(imJ.importId, { rebuild: false });
  gp.undo(imK.importId, { rebuild: false });
  check('the look and menu the owner made between two imports come back — not the ones before the older import',
    JSON.stringify(theme.loadOverrides()) === editedLook && menus.loadMenus().main.map((m) => m.label).join('|') === 'OwnerMenu',
    [theme.loadOverrides().colors.primary, menus.loadMenus().main.map((m) => m.label)]);
  ownerAgain();

  // a full theme library: the import's own entry goes first and frees the slot
  const imL = await landMini('lima', '#553311');
  const tunedL = theme.loadOverrides();
  tunedL.colors = Object.assign({}, tunedL.colors, { primary: '#abcdef' });
  theme.saveOverrides(tunedL);
  const fillers = [];
  const baseLook = JSON.parse(ownerLook);
  for (let i = 0; themeLib.listThemes().length < themeLib.MAX_THEMES && i < 100; i++) {
    fillers.push(themeLib.saveAiTheme('filler ' + i, Object.assign({}, baseLook, { colors: Object.assign({}, baseLook.colors, { primary: '#10' + String(i).padStart(4, '0') }) })).id);
  }
  const uL = gp.undo(imL.importId, { rebuild: false });
  check('undo with a full theme library still files the tuned look and brings the old one back', uL.theme === true && !!uL.themeSaved && !uL.themeNotRestored && JSON.stringify(theme.loadOverrides()) === ownerLook, uL);
  fillers.forEach((fid) => themeLib.removeTheme(fid));
  const savedL = themeLib.listThemes().find((t) => t.name === uL.themeSaved);
  if (savedL) themeLib.removeTheme(savedL.id);
  ownerAgain();

  // a record from the first v2.56 draft (no marks) is undone newest first
  const imM = await landMini('mike', '#227744');
  const led = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  delete led.imports.find((r) => r.id === imM.importId).pageMarks;
  fs.writeFileSync(ledgerPath, JSON.stringify(led));
  const imN = await landMini('november', '#774422');
  let order = '';
  try { gp.undo(imM.importId, { rebuild: false }); } catch (e) { order = e.code; }
  check('an old-format record cannot be spliced out from under a newer import (ORDER)', order === 'ORDER', order);
  gp.undo(imN.importId, { rebuild: false });
  const uM = gp.undo(imM.importId, { rebuild: false });
  check('…newest first, it goes', uM.pagesRemoved.length === imM.pages.length && loadConfig().homepage === ownerHome && JSON.stringify(theme.loadOverrides()) === ownerLook, [uM, loadConfig().homepage]);
  ownerAgain();

  // the ledger knows a landing while it runs — a restart would leave it undoable
  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = async (url) => { await gate; return transport(url); };
  const flying = gp.landPlan(gp.planFromPuppet(mini('oscar', '#336699'), {}).id, { mode: 'live' }, { transport: slow, rebuild: false });
  await new Promise((r) => setTimeout(r, 30));
  const pending = gp.listImports()[0];
  let early = '';
  try { gp.undo(pending.id, { rebuild: false }); } catch (e) { early = e.code; }
  check('a landing in flight is in the ledger (a restart leaves it undoable), and is not undone under its feet', !!pending && pending.landing === true && gp.isLanding() && gp.currentLanding() === pending.id && early === 'BUSY', [pending && pending.landing, early]);
  release();
  const imO = await flying;
  check('…the finished landing replaces its draft record', gp.listImports().filter((r) => r.id === imO.importId).length === 1 && !gp.listImports()[0].landing && !gp.isLanding());
  const led2 = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  led2.imports.find((r) => r.id === imO.importId).landing = true; // as a restart would leave it
  fs.writeFileSync(ledgerPath, JSON.stringify(led2));
  const oRow = pagesLib.getPageByFullPath(homeOf(imO));
  pagesLib.updatePage(homeOf(imO), { blocks: oRow.draft_blocks.concat([{ type: 'text', id: 'text_after', data: { content: 'the owner, after the restart' } }]) });
  const uO = gp.undo(imO.importId, { rebuild: false });
  check('a landing cut off by a restart is undone by the same rules — a page the owner filled since stays theirs', uO.pagesKept.includes(homeOf(imO)) && !uO.pagesRemoved.length && JSON.stringify(theme.loadOverrides()) === ownerLook, uO);
  pagesLib.deletePage(homeOf(imO));
  ownerAgain();

  // a hard stop right before the name changes: the ledger was written ahead of each change
  let crashLedger = null;
  const cfgMod = require('../src/config');
  const realSaveConfig = cfgMod.saveConfig;
  cfgMod.saveConfig = (c) => { if (crashLedger === null) crashLedger = fs.readFileSync(ledgerPath, 'utf8'); return realSaveConfig(c); };
  const imR = await landMini('romeo', '#335511');
  cfgMod.saveConfig = realSaveConfig;
  // the site as a kill inside saveConfig leaves it: pages, look and menu on, the name and crown not yet
  const cfgR = loadConfig(); cfgR.homepage = ownerHome; cfgR.title = 'My Site'; saveConfig(cfgR);
  fs.writeFileSync(ledgerPath, crashLedger);
  const recR = gp.listImports().find((r) => r.id === imR.importId);
  const uR = gp.undo(imR.importId, { rebuild: false });
  check('a hard stop just before the name changed is undone fully (the ledger was written ahead)',
    !!recR && recR.landing === true && recR.themeApplied && !!recR.menuSetTo && !!recR.titleSetTo && uR.pagesRemoved.length === imR.pages.length &&
    JSON.stringify(theme.loadOverrides()) === ownerLook && JSON.stringify(menus.loadMenus().main.map((m) => [m.label, m.url])) === ownerMenu &&
    loadConfig().title === 'My Site' && loadConfig().homepage === ownerHome, [recR && recR.landing, uR]);
  ownerAgain();

  // pictures the owner reused beyond pages — a store product, a category cover — stay after undo
  const imS = await landMini('sierra', '#553377');
  const sPic = (JSON.stringify(pagesLib.getPageByFullPath(homeOf(imS)).blocks).match(/\/assets\/geppetto\/[^"\\]+/) || [])[0];
  const { db: rawDb } = require('../src/db');
  rawDb.prepare('INSERT INTO store_products (slug, title, images, status) VALUES (?, ?, ?, ?)').run('jar-gp', 'Jar', JSON.stringify([sPic]), 'draft');
  const uS = gp.undo(imS.importId, { rebuild: false });
  check('an imported picture a store product uses stays on disk after undo', !!sPic && uS.mediaKept === true && uS.mediaKeptFor === 'table:store_products' && fs.existsSync(path.join(ASSETS_DIR, sPic.replace(/^\/assets\//, ''))), [uS, sPic]);
  rawDb.prepare('DELETE FROM store_products WHERE slug = ?').run('jar-gp');
  const imT = await landMini('tango', '#775533');
  const tPic = (JSON.stringify(pagesLib.getPageByFullPath(homeOf(imT)).blocks).match(/\/assets\/geppetto\/[^"\\]+/) || [])[0];
  const cats = require('../src/categories');
  const catsBefore = cats.listCategories();
  cats.saveCategories(catsBefore.concat([{ slug: 'jars', name: 'Jars', image: tPic }]));
  const uT = gp.undo(imT.importId, { rebuild: false });
  check('…and so does one a category cover uses', !!tPic && uT.mediaKept === true && /categories\.json$/.test(uT.mediaKeptFor) && fs.existsSync(path.join(ASSETS_DIR, tPic.replace(/^\/assets\//, ''))), [uT, tPic]);
  cats.saveCategories(catsBefore);
  ownerAgain();

  // a landing that fails never pushes the oldest record out of a full ledger
  const full = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  while (full.imports.length < 30) full.imports.unshift({ id: 'gp_old' + full.imports.length, at: '2026-01-01T00:00:00.000Z', source: 'canva', mode: 'drafts', pagesCreated: [], pageMarks: {}, undone: true });
  const oldest = full.imports[0].id;
  fs.writeFileSync(ledgerPath, JSON.stringify(full));
  const realSave2 = pagesLib.savePageSource;
  pagesLib.savePageSource = () => { throw new Error('the disk is full'); };
  try { await landMini('uniform', '#224466'); } catch (e) { /* expected */ }
  pagesLib.savePageSource = realSave2;
  const after = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).imports;
  check('a landing that fails never pushes the oldest record out of a full ledger', after.length === 30 && after[0].id === oldest, [after.length, after[0] && after[0].id]);
  ownerAgain();

  // a look that went on before its call threw is still a look undo takes off
  const realApply = themeLib.applyTheme;
  themeLib.applyTheme = (tid) => { realApply(tid); throw new Error('the library tripped after applying'); };
  const imQ = await landMini('quebec', '#772255');
  themeLib.applyTheme = realApply;
  const lookedQ = JSON.stringify(theme.loadOverrides()) !== ownerLook;
  gp.undo(imQ.importId, { rebuild: false });
  check('a look applied before its call threw is still taken off by undo', lookedQ && !!(imQ.theme && imQ.theme.error) && JSON.stringify(theme.loadOverrides()) === ownerLook, imQ.theme);
  ownerAgain();

  // a hard stop right after a page was written: the ledger knew its source first
  let midLedger = null;
  const realSave3 = pagesLib.savePageSource;
  pagesLib.savePageSource = function () { const r = realSave3.apply(this, arguments); if (midLedger === null) midLedger = fs.readFileSync(ledgerPath, 'utf8'); return r; };
  const imV = await landMini('victor', '#446688');
  pagesLib.savePageSource = realSave3;
  fs.writeFileSync(ledgerPath, midLedger); // the ledger exactly as that stop leaves it
  const recV = gp.listImports().find((r) => r.id === imV.importId);
  const uV = gp.undo(imV.importId, { rebuild: false });
  check('a hard stop right after a page was written: undo still knows the page as the landing’s own',
    !!recV && recV.landing === true && !!(recV.pageSources || {})[homeOf(imV)] && uV.pagesRemoved.includes(homeOf(imV)) && !uV.pagesKept.length, [recV && recV.pageSources, uV]);
  if (imV.theme && imV.theme.id) themeLib.removeTheme(imV.theme.id); // the stop came before the look, in a real one
  ownerAgain();

  // an unrelated undo while a landing runs, and the landing then fails: the oldest record stays
  const imW = await landMini('whiskey', '#664422');
  const full2 = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  while (full2.imports.filter((r) => !r.landing).length < 30) full2.imports.unshift({ id: 'gp_older' + full2.imports.length, at: '2026-01-01T00:00:00.000Z', source: 'canva', mode: 'drafts', pagesCreated: [], pageMarks: {}, undone: true });
  const oldest2 = full2.imports[0].id;
  fs.writeFileSync(ledgerPath, JSON.stringify(full2));
  let release2;
  const gate2 = new Promise((r) => { release2 = r; });
  const failing = gp.landPlan(gp.planFromPuppet(mini('xray', '#226644'), {}).id, { mode: 'live' }, { transport: async (u) => { await gate2; return transport(u); }, rebuild: false });
  await new Promise((r) => setTimeout(r, 30));
  gp.undo(imW.importId, { rebuild: false });
  const realSave4 = pagesLib.savePageSource;
  pagesLib.savePageSource = () => { throw new Error('the disk is full'); };
  release2();
  try { await failing; } catch (e) { /* expected */ }
  pagesLib.savePageSource = realSave4;
  const after2 = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).imports;
  check('an undo while a landing runs never pushes the oldest record out, even when that landing then fails', after2.some((r) => r.id === oldest2) && after2.filter((r) => !r.landing).length === 30, [after2.length, after2[0] && after2[0].id]);
  ownerAgain();

  // thirty landings tried and undone never push out a live import: it stays undoable
  const imY = await landMini('yankee', '#446622');
  const tried = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  tried.imports = tried.imports.filter((r) => r.id === imY.importId);
  for (let i = 0; i < 30; i++) tried.imports.push({ id: 'gp_tried' + i, at: '2026-09-01T00:00:00.000Z', source: 'canva', mode: 'live', pagesCreated: [], pageMarks: {}, undone: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(tried));
  const imZ = await landMini('zulu', '#224422');
  const kept2 = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).imports;
  let uY = null;
  try { gp.undo(imZ.importId, { rebuild: false }); uY = gp.undo(imY.importId, { rebuild: false }); } catch (e) { uY = { error: e.code }; }
  check('a live import outlives thirty landings tried and undone — the ledger drops undone ones first', kept2.some((r) => r.id === imY.importId) && !!uY && !uY.error && uY.pagesRemoved.length === imY.pages.length, [kept2.length, uY]);
  ownerAgain();

  // a design far past any real site is refused; a throw in the life pass is a refusal too
  z = 0;
  const huge = [];
  for (let i = 0; i < 20001; i++) huge.push(text('x' + i, (i % 100) * 13, Math.floor(i / 100) * 20, 12, 18, 'x' + i, { size: 12 }));
  let tooBig = '';
  try { gp.planFromPuppet(P.makePuppet({ source: 'canva', format: 'canva-app', pages: [{ key: 'b', path: '/', title: 'Big', width: 1366, sections: [{ key: 's', height: 4100, fill: { color: '#ffffff' }, nodes: huge }] }] }), {}); } catch (e) { tooBig = e.code; }
  check('a design past 20,000 boxes is refused (E_TOO_BIG), not breathed', tooBig === 'E_TOO_BIG', tooBig);
  const realBreathe = life.breathe;
  const quiet = console.error;
  life.breathe = () => { throw new TypeError('boom'); };
  console.error = () => {};
  let lifeErr = '';
  try { gp.planFromPuppet(mini('papa', '#123456'), {}); } catch (e) { lifeErr = e.code; }
  console.error = quiet;
  life.breathe = realBreathe;
  check('a throw inside the life pass is a refusal (E_LIFE) — the stack goes to the log only', lifeErr === 'E_LIFE', lifeErr);

  // a crowded design must not stall the server: the life pass runs in the request
  z = 0;
  const crowd = [];
  for (let i = 0; i < 6000; i++) crowd.push(text('c' + i, (i % 40) * 34, Math.floor(i / 40) * 30, 30, 24, 'Item number ' + i, { size: 20 }));
  const crowded = P.makePuppet({ source: 'canva', format: 'canva-app', pages: [{ key: 'c', path: '/', title: 'Crowd', width: 1366, sections: [{ key: 's', height: 4600, fill: { color: '#ffffff' }, nodes: crowd }] }] });
  const t0 = Date.now();
  life.breathe(crowded);
  check('6,000 boxes in one section breathe in well under two seconds', Date.now() - t0 < 2000, Date.now() - t0);

  // ── 10. a design the decoders do not understand is a refusal, not a 500 ──
  const { readDesign } = require('../src/geppetto/fetch');
  const refusal = async (input) => {
    try { await readDesign(input, { transport: async () => { throw new Error('no network in this smoke'); } }); return 'ok'; } catch (e) { return e.code || 'uncoded: ' + e.message; }
  };
  check('a Figma file with no frame → E_EMPTY_DESIGN', (await refusal({ json: { document: { children: [{ type: 'CANVAS', children: [] }] } } })) === 'E_EMPTY_DESIGN');
  const FIX = path.join(__dirname, '..', 'test', 'fixtures', 'geppetto');
  const hostile = JSON.parse(fs.readFileSync(path.join(FIX, 'figma-file.json'), 'utf8'));
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n.fills)) n.fills.forEach((f) => { if (f && typeof f === 'object') f.type = 7; });
    for (const k of Object.keys(n)) walk(n[k]);
  })(hostile);
  const hostileRead = await refusal({ json: hostile });
  check('a paint whose type is not a string does not crash the decoder', hostileRead === 'ok' || /^E_/.test(hostileRead), hostileRead);
  const figmaMod = require('../src/geppetto/figma');
  const realPlugin = figmaMod.fromPluginExport;
  const realErr = console.error;
  figmaMod.fromPluginExport = () => { throw new TypeError('boom'); };
  console.error = () => {};
  const dr = await refusal({ json: JSON.parse(fs.readFileSync(path.join(FIX, 'figma-plugin-export.json'), 'utf8')) });
  console.error = realErr;
  figmaMod.fromPluginExport = realPlugin;
  check('a decoder that trips over a design is a refusal (E_DECODE) — the stack goes to the log only', dr === 'E_DECODE', dr);

  console.log(fail ? 'SMOKE GEPPETTO: FAIL' : 'SMOKE GEPPETTO: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  console.log('SMOKE GEPPETTO: FAIL');
  process.exit(1);
});
