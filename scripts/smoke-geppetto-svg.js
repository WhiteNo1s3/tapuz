'use strict';

/**
 * Geppetto — the SVG door (src/geppetto/svg.js) and the parser it shares with
 * the Canva door (src/geppetto/markup.js).
 *
 * What is under test, on two SYNTHETIC fixtures written to mirror the shape of
 * a real Figma export (test/fixtures/geppetto/figma-page.svg; the same page
 * OUTLINED in figma-outlined.svg) and a few SVGs built inline:
 *   - detect: a readable export, the outlined refusal (E_SVG_OUTLINED), not an
 *     SVG, over the size cap, a file with no text at all — Hebrew messages;
 *   - the root scale undone: page width = the DESIGN width (1440), not the
 *     export's (1226); the canvas backdrop OUTSIDE the frame dropped, the
 *     frame's own background INSIDE it kept as the section fill; the frame
 *     group's id → the section name — on a page fixture and on a third fixture
 *     with the real export's exact tree and numbers (figma-real-shape.svg);
 *   - names stripped of Figma's _N suffix; a named group with several members
 *     → a group node, the frame itself never one;
 *   - text: one paragraph per tspan (Figma's &#10; swallowed), size / colour /
 *     face / bold from the attributes, alignment from text-anchor, letter-
 *     spacing in em, the box from the baselines, a Hebrew line;
 *   - a pattern fill → an image node with its data URI, cover vs contain from
 *     the pattern's scale, the crop window, data-name as alt;
 *   - a gradient → a `gradient` fill that passes life.js's gate, a <line> → a
 *     thin line, rotate() → rotate, a translated group inside the scaled root;
 *   - <use> of a symbol, a <use> cycle that must not hang, a picture over the
 *     per-image cap skipped with a note, the 20,000-node budget in time;
 *   - primitivesToPuppet on bare primitives (the PDF reader's way in), several
 *     files → several pages, validatePuppet clean, and the whole thing through
 *     planFromPuppet → BenTML with no errors;
 *   - the review's findings: a <use> fan-out bomb cut by the visits budget,
 *     pretty-printed text, Illustrator class rules, an illustration not
 *     refused as outlined text, physical units, colliding page names.
 * No network. Runs on a throwaway TAPUZ_ROOT.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-geppetto-svg-'));

const svg = require('../src/geppetto/svg');
const markup = require('../src/geppetto/markup');
const canva = require('../src/geppetto/canva');
const life = require('../src/geppetto/life');
const { validatePuppet, eachNode, plainText, countNodes } = require('../src/geppetto/puppet');

const FIX = path.join(__dirname, '..', 'test', 'fixtures', 'geppetto');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const t0 = Date.now();

let fail = false;
function check(name, cond, extra) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (cond || extra == null ? '' : '  → ' + String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 300)));
  if (!cond) fail = true;
}
const near = (a, b, tol = 0.6) => typeof a === 'number' && Math.abs(a - b) <= tol;
// Built with fromCharCode so no editor ever turns an escape into a raw byte.
const HEBREW = new RegExp('[' + String.fromCharCode(0x05d0) + '-' + String.fromCharCode(0x05ea) + ']');

function find(puppet, pred) {
  let out = null;
  for (const pg of puppet.pages) for (const s of pg.sections) eachNode(s.nodes, (n) => { if (!out && pred(n)) out = n; });
  return out;
}
function all(puppet, pred) {
  const out = [];
  for (const pg of puppet.pages) for (const s of pg.sections) eachNode(s.nodes, (n) => { if (pred(n)) out.push(n); });
  return out;
}
const byName = (puppet, name) => find(puppet, (n) => n.name === name);
const byText = (puppet, text) => find(puppet, (n) => n.type === 'text' && plainText(n) === text);
const thrown = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// ── 1. detect ─────────────────────────────────────────────────────────────
const pageSvg = read('figma-page.svg');
const outlinedSvg = read('figma-outlined.svg');
check('detect accepts the text-kept export', JSON.stringify(svg.detect(pageSvg)) === '{"ok":true}', svg.detect(pageSvg));
const dOut = svg.detect(outlinedSvg);
check('detect refuses the OUTLINED export: E_SVG_OUTLINED, a Hebrew sentence naming "Outline text"', !dOut.ok && dOut.code === 'E_SVG_OUTLINED' && HEBREW.test(dOut.message) && /Outline text/.test(dOut.message), dOut);
check('the outlined fixture really has no <text> and at least 5 named paths', !/<text[\s>]/.test(outlinedSvg) && (outlinedSvg.match(/<path id="/g) || []).length >= 5);
const dNot = svg.detect('<html><body>hello</body></html>');
check('not an SVG → E_SVG_NOT_SVG (Hebrew); so are an empty string and null', !dNot.ok && dNot.code === 'E_SVG_NOT_SVG' && HEBREW.test(dNot.message) && svg.detect('').code === 'E_SVG_NOT_SVG' && svg.detect(null).code === 'E_SVG_NOT_SVG', dNot);
const tBig = Date.now();
const dBig = svg.detect('<svg xmlns="http://www.w3.org/2000/svg"><text>x</text>' + ' '.repeat(svg.MAX_TEXT_BYTES) + '</svg>');
check('over 24 MB of text → E_SVG_TOO_BIG, cheaply, the sizes in the sentence', !dBig.ok && dBig.code === 'E_SVG_TOO_BIG' && HEBREW.test(dBig.message) && /24\.0 MB/.test(dBig.message) && Date.now() - tBig < 400, dBig);
const dQuiet = svg.detect('<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#333"/><path id="Vector" d="M0 0h2v2z"/></svg>');
check('no text and too few named paths → accepted, with a Hebrew note', dQuiet.ok === true && HEBREW.test(dQuiet.note), dQuiet);
check('a prolog, a doctype and a comment before <svg> are fine', svg.detect('<?xml version="1.0"?>\n<!DOCTYPE svg>\n<!-- hi -->\n<svg><text>a</text></svg>').ok === true);

// ── 2. the page fixture → puppet ──────────────────────────────────────────
const tDec = Date.now();
const puppet = svg.fromSvg([{ name: 'landing.svg', text: pageSvg }]);
const decodeMs = Date.now() - tDec;
check('fromSvg: validatePuppet finds no issue; source figma, a format puppet.js knows, door figma-svg', validatePuppet(puppet).length === 0 && puppet.source === 'figma' && puppet.format === 'figma-file' && puppet.door === 'figma-svg', validatePuppet(puppet));
const page = puppet.pages[0];
const sec = page.sections[0];
check('one page at /, ONE section s0, the frame group id as the section name and anchor', puppet.pages.length === 1 && page.path === '/' && page.sections.length === 1 && sec.key === 's0' && sec.name === 'Landing page' && sec.anchor === 'landing-page' && page.title === 'Landing page');
check('the root scale is undone: page width = the DESIGN width 1440 (not the exported 1226), height 1600', page.width === 1440 && sec.height === 1600, [page.width, sec.height]);
check('the frame\'s own white is the section fill; the canvas backdrop (#1E1E1E) is dropped with a note', sec.fill.color === '#ffffff' && !find(puppet, (n) => n.fill && n.fill.color === '#1e1e1e') && puppet.notes.some((n) => HEBREW.test(n) && /Figma/.test(n)), [sec.fill, puppet.notes]);
check('no node is the frame group; no node keeps a _N suffix', !byName(puppet, 'Landing page') && all(puppet, (n) => /_\d+$/.test(n.name || '')).length === 0);
check('names survive stripped: three "Nav label", three "Card", three "Photo"', all(puppet, (n) => n.name === 'Nav label').length === 3 && all(puppet, (n) => n.name === 'Card').length === 3 && all(puppet, (n) => n.name === 'Photo').length === 3);
const nav = byName(puppet, 'Nav');
check('a named <g> with several members → a group node, its members in section coordinates', !!nav && nav.type === 'group' && nav.children.length === 3 && near(nav.x, 1096) && near(nav.y, 41, 1) && nav.children.every((c) => c.type === 'text'));
check('a <g> with one member or no name is flattened (the filter wrapper is no group)', !find(puppet, (n) => n.type === 'group' && n.children.length < 2));
check('z grows in paint order across the section, groups included', (() => { let last = -1; let ok = true; eachNode(sec.nodes, (n) => { if (!(n.z > last)) ok = false; last = n.z; }); return ok; })());

// text
const h1 = byName(puppet, 'Heading');
check('a <text> with two tspans → one text node with two paragraphs, Figma\'s &#10; swallowed', !!h1 && h1.type === 'text' && h1.paragraphs.length === 2 && plainText(h1) === 'Gardens that\ngrow with you');
const hr = h1 && h1.paragraphs[0].runs[0];
check('runs: size 72 (design px), white → #ffffff, font Inter, bold from weight 700, letter-spacing -0.02 em', !!hr && hr.size === 72 && hr.color === '#ffffff' && hr.font === 'Inter' && hr.bold === true && hr.weight === 700 && hr.letterSpacing === -0.02, hr);
check('text-anchor middle → align center on both lines, the box centred on x = 720', h1.paragraphs.every((p) => p.align === 'center') && near(h1.x + h1.w / 2, 720, 1.5), [h1.x, h1.w]);
check('the box top is the first baseline - 0.8 em (352.8 - 57.6 = 295.2); the bottom below the last baseline', near(h1.y, 295.2, 0.3) && h1.y + h1.h > 432.8 && h1.h < 72 * 2.6, [h1.y, h1.h]);
const brand = byName(puppet, 'Brand');
check('start-anchored text keeps its x (60); weight 700 → bold; size 24', !!brand && brand.x === 60 && brand.paragraphs[0].align === 'start' && brand.paragraphs[0].runs[0].bold === true && brand.paragraphs[0].runs[0].size === 24, brand);
const navLabel = byName(puppet, 'Nav label');
check('weight 500 is not bold and is kept as `weight`', !!navLabel && !navLabel.paragraphs[0].runs[0].bold && navLabel.paragraphs[0].runs[0].weight === 500);
const sub = byName(puppet, 'Subheading');
check('a hex colour survives lowercased; a 22 px line is one centred paragraph', !!sub && sub.paragraphs[0].runs[0].color === '#d8e6dc' && sub.paragraphs[0].runs[0].size === 22 && sub.paragraphs[0].align === 'center');
const body = byText(puppet, 'Raised beds sized to a railing,\nwith drip lines built in.');
check('a two-line body: two paragraphs, 16 px, #4a4a4a, not bold', !!body && body.paragraphs.length === 2 && body.paragraphs[0].runs[0].size === 16 && body.paragraphs[0].runs[0].color === '#4a4a4a' && !body.paragraphs[0].runs[0].bold);
check('fonts table: Inter with the weights in use', puppet.fonts.Inter && JSON.stringify(puppet.fonts.Inter.weights) === '[400,500,600,700]' && puppet.fonts.Inter.italic === false, puppet.fonts);
check('site: title from the frame, dir ltr', puppet.site.title === 'Landing page' && puppet.site.dir === 'ltr');

// shapes, pictures, lines
const hero = byName(puppet, 'Hero backdrop');
check('a userSpaceOnUse linear gradient → a gradient fill (180deg, two stops) that life.js\'s safeGradient lets through', !!hero && hero.type === 'shape' && hero.fill.gradient === 'linear-gradient(180deg, #1f3a2e 0%, #0b1f17 100%)' && life.safeGradient(hero.fill.gradient) === hero.fill.gradient && near(hero.y, 96) && near(hero.h, 664), hero);
const rule = byName(puppet, 'Rule');
check('a <line> → a thin line node: its stroke colour, the full width, h = the stroke width', !!rule && rule.type === 'line' && rule.color === '#e4ded6' && near(rule.w, 1440) && rule.h > 0 && rule.h < 2 && near(rule.width, rule.h, 0.01), rule);
const sun = byName(puppet, 'Sun');
check('a <circle> with fill-opacity → an ellipse shape with an rgba colour safeColor accepts', !!sun && sun.shape === 'ellipse' && sun.fill.color === 'rgba(242,184,75,0.35)' && life.safeColor(sun.fill.color) === 'rgba(242, 184, 75, 0.35)' && near(sun.w, 120) && near(sun.x, 1180), sun);
const leaf = byName(puppet, 'Leaf mark');
check('rotate(45 cx cy) → rotate 45, the unrotated 40×40 centred on (180, 200)', !!leaf && leaf.rotate === 45 && near(leaf.w, 40, 0.05) && near(leaf.x + leaf.w / 2, 180) && near(leaf.y + leaf.h / 2, 200), leaf);
const pill = byName(puppet, 'Pill');
const button = byName(puppet, 'Button');
check('rx → radius (28 design px); the pill and its label form the "Button" group', !!pill && pill.radius === 28 && !!button && button.children.length === 2 && button.children[0].type === 'shape' && button.children[1].type === 'text');
const photos = all(puppet, (n) => n.name === 'Photo');
check('a pattern fill → an image node: data URI src, natural size, rounded mask with radius 16, cover', photos.length === 3 && photos.every((p) => p.type === 'image' && /^data:image\/png;base64,iVBOR/.test(p.src) && p.mask === 'rounded' && p.radius === 16) && photos[0].fit === 'cover' && !photos[0].crop && photos[0].natural.w === 1200 && photos[0].natural.h === 720, photos.map((p) => [p.fit, p.crop, p.natural, p.radius]));
check('a pattern whose picture overflows the box → cover with the crop window (the middle 60 %)', photos[1].fit === 'cover' && !!photos[1].crop && photos[1].crop.y === 0.2 && photos[1].crop.h === 0.6 && photos[1].crop.w === 1, photos[1].crop);
check('alt: a data-name that is not image.png wins over a generic layer name; otherwise the layer name; a horizontal overflow → crop.x', photos[2].alt === 'greenhouse morning' && photos[0].alt === 'Photo' && !!photos[2].crop && near(photos[2].crop.x, 0.125, 0.011) && near(photos[2].crop.w, 0.75, 0.011) && photos[2].crop.h === 1, photos.map((p) => [p.alt, p.crop]));
const titles = all(puppet, (n) => n.name === 'Card title');
const cards = all(puppet, (n) => n.name === 'Card');
check('a translated group inside the scaled root: the second and third cards land at +460 / +920', near(cards[0].x, 60) && near(titles[1].x, 544) && near(titles[2].x, 1004) && near(cards[2].x, 980) && cards.every((c) => c.type === 'group' && c.children.length === 4), cards.map((c) => c.x));
const base = byName(puppet, 'Card base');
check('stroke → { color, width } in design px (its 1 px is 1 px again once the child\'s scale is undone)', !!base && base.stroke && base.stroke.color === '#e4ded6' && near(base.stroke.width, 1, 0.02) && base.fill.color === '#ffffff', base);
check('palette: the design\'s colours, most used first, the section fill among them', puppet.palette.includes('#ffffff') && puppet.palette.includes('#f2b84b') && puppet.palette.includes('#1c1b1f') && puppet.palette.length <= 12, puppet.palette);
check('the fixture decodes in well under a second', decodeMs < 300, decodeMs + 'ms');

// ── 2b. the real export's shape: the canvas rect OUTSIDE the frame, the frame's background INSIDE, carrying the scale ──
const realSvg = read('figma-real-shape.svg');
const real = svg.fromSvg([{ name: 'real.svg', text: realSvg }]);
const realSec = real.pages[0].sections[0];
check('real shape: validates; width 1440 and height 4811 from the frame\'s own background rect (the export was 1226×4096)', validatePuppet(real).length === 0 && real.pages[0].width === 1440 && realSec.height === 4811 && realSec.name === 'Landing page', [real.pages[0].width, realSec.height]);
check('real shape: the white INSIDE the frame is the section fill; the #1E1E1E rect OUTSIDE is dropped and named in a note', realSec.fill.color === '#ffffff' && !find(real, (n) => n.fill && n.fill.color === '#1e1e1e') && !find(real, (n) => n.fill && n.fill.color === '#ffffff' && n.w >= 1400) && real.notes.some((n) => /#1e1e1e/.test(n) && HEBREW.test(n)), [realSec.fill, real.notes]);
const sh = byName(real, 'Section heading');
check('real shape: every child carries scale(0.851382), so the numbers inside are design px and come out untouched (x 80, baseline 1400, size 48, weight 600)', !!sh && near(sh.x, 80, 0.05) && near(sh.y, 1400 - 48 * 0.8, 0.05) && sh.paragraphs[0].runs[0].size === 48 && sh.paragraphs[0].runs[0].bold === true && sh.paragraphs[0].runs[0].weight === 600, sh);
const navG = byName(real, 'Navigation');
check('real shape: a scaled <g> inside the frame → a group whose texts sit in design px', !!navG && navG.type === 'group' && navG.children.length === 3 && near(navG.children[0].x, 80, 0.05) && navG.children[0].paragraphs[0].runs[0].size === 20 && navG.children[0].paragraphs[0].runs[0].weight === 500, navG);
const pic = byName(real, 'Photo');
check('real shape: the brief\'s own pattern numbers (4096×3525 under translate(-0.0809929) scale(0.000283688)) → cover, crop x 0.07 / w 0.86, data-name as alt', !!pic && pic.type === 'image' && pic.fit === 'cover' && !!pic.crop && near(pic.crop.x, 0.07, 0.011) && near(pic.crop.w, 0.86, 0.011) && pic.natural.w === 4096 && pic.alt === 'harbor morning' && near(pic.w, 600, 0.05), pic);
check('real shape: geometry in design units — the header band and the rule span 1440, the stroke is 1', near(byName(real, 'Header').w, 1440, 0.05) && near(byName(real, 'Rule').w, 1440, 0.05) && near(byName(real, 'Rule').width, 1, 0.02), [byName(real, 'Header'), byName(real, 'Rule')]);
const grpScaled = svg.fromSvg([{ name: 'g.svg', text: '<svg viewBox="0 0 720 450" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="Page" transform="scale(0.5)"><rect width="1440" height="900" fill="#FFFFFF"/><rect id="Panel" x="800" y="200" width="600" height="200" fill="#abcdef"/></g></svg>' }]);
check('the scale on the frame group itself: width 1440, the background inside is the fill, content in design px', grpScaled.pages[0].width === 1440 && grpScaled.pages[0].sections[0].height === 900 && grpScaled.pages[0].sections[0].fill.color === '#ffffff' && byName(grpScaled, 'Panel').x === 800 && byName(grpScaled, 'Panel').w === 600, [grpScaled.pages[0].width, grpScaled.pages[0].sections[0].fill, byName(grpScaled, 'Panel')]);

// ── 3. the same page outlined: fromSvg refuses with the coded error ───────
const eOut = thrown(() => svg.fromSvg([{ name: 'landing.svg', text: outlinedSvg }]));
check('fromSvg throws the outlined refusal as a coded Error with the Hebrew message', !!eOut && eOut.code === 'E_SVG_OUTLINED' && HEBREW.test(eOut.message), eOut && eOut.message);
const eNamed = thrown(() => svg.fromSvg([{ name: 'home.svg', text: pageSvg }, { name: 'about.svg', text: outlinedSvg }]));
check('a refused file names itself when several were handed over', !!eNamed && eNamed.code === 'E_SVG_OUTLINED' && eNamed.message.startsWith('about.svg: '), eNamed && eNamed.message);
check('no files → E_SVG_EMPTY; a file with nothing to show → E_SVG_EMPTY', (thrown(() => svg.fromSvg([])) || {}).code === 'E_SVG_EMPTY' && (thrown(() => svg.fromSvg([{ name: 'x.svg', text: '<svg><text/><defs><rect width="9" height="9"/></defs></svg>' }])) || {}).code === 'E_SVG_EMPTY');

// ── 4. several files → several pages ──────────────────────────────────────
const two = svg.fromSvg([{ name: 'Home.svg', text: pageSvg }, { name: 'About Us.svg', text: pageSvg }], { title: 'Ferngrove' });
check('two files → two pages: / and /<slug of the file name>, distinct keys, the given site title', validatePuppet(two).length === 0 && two.pages.length === 2 && two.pages[1].path === '/about-us' && two.pages[0].key !== two.pages[1].key && two.site.title === 'Ferngrove', two.pages.map((p) => [p.key, p.path]));

// ── 5. inline SVGs: the standard frame shape, a Hebrew line, a clip hint, <use>, the caps ──
const std = svg.fromSvg([{ name: 'frame.svg', text: '<svg width="1440" height="900" viewBox="0 0 1440 900" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="Home" clip-path="url(#clip0)"><rect width="1440" height="900" fill="#FAF6F0"/><text id="Title" fill="#222222" font-family="Heebo" font-size="40" font-weight="700"><tspan x="1380" y="132">שלום עולם</tspan></text><g id="Avatar" clip-path="url(#clip1)"><image id="Face" x="100" y="300" width="200" height="200" preserveAspectRatio="xMidYMid slice" href="data:image/png;base64,AAAA"/></g></g><defs><clipPath id="clip0"><rect width="1440" height="900" fill="white"/></clipPath><clipPath id="clip1"><circle cx="200" cy="400" r="100"/></clipPath></defs></svg>' }]);
const stdSec = std.pages[0].sections[0];
const title = byName(std, 'Title');
check('an unscaled export: the first full-bleed rect inside the frame group is the section fill, width 1440', std.pages[0].width === 1440 && stdSec.fill.color === '#faf6f0' && stdSec.name === 'Home' && !find(std, (n) => n.fill && n.fill.color === '#faf6f0'), stdSec.fill);
check('a Hebrew line: paragraph dir rtl, the start anchor at the RIGHT edge (x + w = 1380), site.dir rtl, font Heebo', !!title && title.paragraphs[0].dir === 'rtl' && near(title.x + title.w, 1380, 0.5) && std.site.dir === 'rtl' && title.paragraphs[0].runs[0].font === 'Heebo', title);
const face = byName(std, 'Face');
check('an <image> in place → image (slice → cover); a circle clip on its group → mask circle', !!face && face.type === 'image' && face.fit === 'cover' && face.mask === 'circle' && face.x === 100 && face.w === 200, face);

const useSvg = '<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><symbol id="badge" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ff0000"/></symbol><use xlink:href="#badge" x="20" y="30" width="40" height="40"/><g id="loop"><use xlink:href="#loop"/><rect id="Box" x="100" y="100" width="50" height="50" fill="#00ff00"/></g><use xlink:href="#nowhere"/><text x="10" y="290" font-size="12">t</text></svg>';
const used = svg.fromSvg([{ name: 'use.svg', text: useSvg }]);
const badge = find(used, (n) => n.fill && n.fill.color === '#ff0000');
check('<use> of a symbol lands at its x/y, sized by width/height over the symbol\'s viewBox', !!badge && badge.x === 20 && badge.y === 30 && badge.w === 40 && badge.h === 40, badge);
check('a <use> cycle stops; a dangling <use> is skipped with a note', !!byName(used, 'Box') && used.notes.some((n) => /use/.test(n)), used.notes);

const capSvg = '<svg viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect id="Hero photo" width="800" height="400" fill="url(#p0)"/><rect id="Band" y="400" width="800" height="200" fill="#123456"/><text x="10" y="500" font-size="20" fill="white">words</text><defs><pattern id="p0" patternContentUnits="objectBoundingBox" width="1" height="1"><use xlink:href="#i0" transform="scale(0.00125 0.0025)"/></pattern><image id="i0" width="800" height="400" xlink:href="data:image/png;base64,' + 'A'.repeat(svg.MAX_IMAGE_BASE64 + 64) + '"/></defs></svg>';
const capped = svg.fromSvg([{ name: 'cap.svg', text: capSvg }]);
check('a single picture over 8 MB of base64 is skipped with a note naming it; the rest of the page survives', validatePuppet(capped).length === 0 && !byName(capped, 'Hero photo') && !!byName(capped, 'Band') && capped.notes.some((n) => /Hero photo/.test(n) && /MB/.test(n) && HEBREW.test(n)), capped.notes);

// the units of the content next to a scaled backdrop
const unitsA = svg.fromSvg([{ name: 'a.svg', text: '<svg viewBox="0 0 720 450" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="1440" height="900" transform="scale(0.5)" fill="white"/><g id="Page"><rect id="Panel" x="400" y="100" width="300" height="100" fill="#abcdef"/><text fill="#000" font-size="10"><tspan x="10" y="30">a</tspan></text></g></svg>' }]);
check('content in export px is scaled back by the root scale (x 400 → 800, size 10 → 20)', unitsA.pages[0].width === 1440 && byName(unitsA, 'Panel').x === 800 && byName(unitsA, 'Panel').w === 600 && find(unitsA, (n) => n.type === 'text').paragraphs[0].runs[0].size === 20, byName(unitsA, 'Panel'));
const unitsB = svg.fromSvg([{ name: 'b.svg', text: '<svg viewBox="0 0 720 450" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="1440" height="900" transform="scale(0.5)" fill="white"/><g id="Page"><rect id="Panel" x="800" y="200" width="600" height="200" fill="#abcdef"/></g></svg>' }]);
check('content already in design px (it overflows the export box) is left alone, with a note', unitsB.pages[0].width === 1440 && byName(unitsB, 'Panel').x === 800 && byName(unitsB, 'Panel').w === 600 && unitsB.notes.some((n) => HEBREW.test(n)), [byName(unitsB, 'Panel'), unitsB.notes]);

// ── 6. the work budget ────────────────────────────────────────────────────
const many = ['<svg viewBox="0 0 2000 2100" xmlns="http://www.w3.org/2000/svg">'];
for (let i = 0; i < 20050; i++) many.push('<rect id="r' + i + '" x="' + (i % 100) * 20 + '" y="' + Math.floor(i / 100) * 10 + '" width="18" height="8" fill="#' + (i % 2 ? '336699' : 'cc3333') + '"/>');
many.push('<text x="0" y="2099" font-size="9">z</text></svg>');
const tMany = Date.now();
const big = svg.fromSvg([{ name: 'many.svg', text: many.join('') }]);
const manyMs = Date.now() - tMany;
check('20,050 elements: the walk stops at the 20,000-node budget with a note, in linear time', countNodes(big) === 20000 && big.notes.some((n) => /20,000|20000/.test(n)) && manyMs < 1500, manyMs + 'ms, ' + countNodes(big) + ' nodes');

// ── 7. primitivesToPuppet on bare primitives (the PDF reader's way in) ────
const prim = svg.primitivesToPuppet([
  { name: 'Sheet', width: 800, height: 600, nodes: [
    { id: 'bg', type: 'shape', shape: 'rect', x: 0, y: 0, w: 800, h: 600, z: 0, fill: { color: '#fafafa' } },
    { id: 't1', type: 'text', x: 40, y: 40, w: 300, h: 30, z: 1, name: 'Title', paragraphs: [{ align: 'start', list: null, runs: [{ text: 'Hello sheet', size: 28, bold: true, font: 'Arimo', color: '#111111' }] }] }
  ] },
  { name: 'Second sheet', width: 800, height: 600, nodes: [{ id: 's', type: 'shape', shape: 'ellipse', x: 10, y: 10, w: 50, h: 50, z: 0, fill: { color: '#ff8800' } }] }
], { title: 'Sheets', lang: 'en' });
check('primitivesToPuppet: the backdrop becomes the section fill, pages get paths and keys, fonts come from the runs', validatePuppet(prim).length === 0 && prim.pages[0].sections[0].fill.color === '#fafafa' && prim.pages[0].sections[0].nodes.length === 1 && prim.pages[1].path === '/second-sheet' && prim.fonts.Arimo.weights[0] === 700 && prim.site.lang === 'en' && prim.palette[0] === '#fafafa', [prim.pages.map((p) => p.path), prim.fonts, prim.palette]);

// ── 8. _internals ─────────────────────────────────────────────────────────
const I = svg._internals;
const pt = I.apply(I.parseTransform('translate(10 20) scale(2) rotate(90)'), 1, 0);
check('parseTransform composes left to right (translate ∘ scale ∘ rotate)', near(pt[0], 10, 0.001) && near(pt[1], 22, 0.001), pt);
check('pathBox is exact on a Bézier circle and reads relative / glued commands', JSON.stringify(I.pathBox('M50 0C77.6 0 100 22.4 100 50C100 77.6 77.6 100 50 100C22.4 100 0 77.6 0 50C0 22.4 22.4 0 50 0Z')) === '{"x":0,"y":0,"w":100,"h":100}' && JSON.stringify(I.pathBox('m10-5l5 5h-3v2z')) === '{"x":10,"y":-5,"w":5,"h":7}');
check('pathKind: a box, a four-arc ellipse, a blob', I.pathKind('M0 0H100V50H0V0Z') === 'rect' && I.pathKind('M50 0C77.6 0 100 22.4 100 50C100 77.6 77.6 100 50 100C22.4 100 0 77.6 0 50C0 22.4 22.4 0 50 0Z') === 'ellipse' && I.pathKind('M0 0L10 5L3 9Z') === 'path');
check('estimateWidth grows with the words and the size; capitals are wider', I.estimateWidth('ab', 10) < I.estimateWidth('abc', 10) && I.estimateWidth('abc', 10) < I.estimateWidth('abc', 20) && I.estimateWidth('ABC', 10) > I.estimateWidth('abc', 10));
check('stripSuffix takes only Figma\'s _N', I.stripSuffix('Subheading_2') === 'Subheading' && I.stripSuffix('Topic_3') === 'Topic' && I.stripSuffix('Card base') === 'Card base' && I.stripSuffix('v2_final') === 'v2_final');

// ── 9. one parser for both doors ──────────────────────────────────────────
check('canva.js reads through markup.js (the very same parseHtml)', canva._internals.parseHtml === markup.parseHtml && canva._internals.decodeEntities === markup.decodeEntities && typeof markup.parseAttrs === 'function');

// ── 10. through Geppetto: BenTML with no errors ────────────────────────────
const gp = require('../src/geppetto');
const plan = gp.planFromPuppet(puppet, {});
const p0 = plan.pages[0];
check('planFromPuppet builds the page: blocks counted, no errors', !!p0 && Object.keys(p0.blocks).length > 0 && Array.isArray(p0.errors) && p0.errors.length === 0, [p0 && p0.blocks, p0 && p0.errors]);
check('the BenTML carries the heading, a card title and the embedded picture; the nav labels became the menu', /Gardens that/.test(p0.source) && /Balcony beds/.test(p0.source) && /data:image\/png;base64/.test(p0.source) && plan.menu.length === 3 && plan.menu.some((m) => m.label === 'Studio'), plan.menu);
check('the plan says where it came from', plan.source === 'figma' && plan.format === 'figma-file' && plan.title === 'Ferngrove', [plan.source, plan.format, plan.title]);
const realPlan = gp.planFromPuppet(real, {});
check('the real-shape fixture also builds BenTML with no errors', Object.keys(realPlan.pages[0].blocks).length > 0 && realPlan.pages[0].errors.length === 0 && /What we make|Quiet rooms/.test(realPlan.pages[0].source), [realPlan.pages[0].blocks, realPlan.pages[0].errors]);

// ── 11. the review's findings ─────────────────────────────────────────────
// H1: a <use> fan-out bomb — 8 levels × 8 branches of EMPTY groups (16.7 M visits, nothing emitted)
const tBomb = Date.now();
const bombed = svg.fromSvg([{ name: 'bomb.svg', text: read('svg-use-bomb.svg') }]);
const bombMs = Date.now() - tBomb;
check('H1: a 1.7 KB <use> fan-out bomb is cut by the visits budget — back in well under two seconds, the page kept, a Hebrew note naming the budget', bombMs < 1500 && validatePuppet(bombed).length === 0 && !!byText(bombed, 'Still here') && bombed.notes.some((n) => HEBREW.test(n) && /300,000|300000/.test(n)), bombMs + 'ms ' + JSON.stringify(bombed.notes));
check('H1: the node budget still says nodes and the visits budget says visits — two causes, two notes', big.notes.some((n) => /20,000|20000/.test(n)) && !big.notes.some((n) => /300,000|300000/.test(n)) && !bombed.notes.some((n) => /20,000|20000/.test(n)));

// M1: pretty-printed text
const pretty = svg.fromSvg([{ name: 'pretty.svg', text: read('svg-pretty-text.svg') }]);
const ph = byName(pretty, 'Heading');
check('M1: a pretty-printed <text> (whitespace around its tspan, the place on a transform) is ONE paragraph at its place — not three lines from (0,0)', !!ph && ph.paragraphs.length === 1 && plainText(ph) === 'A heading' && near(ph.x, 400, 0.05) && near(ph.y, 300 - 56 * 0.8, 0.05) && ph.h < 56 * 1.3, ph);
const pw = byName(pretty, 'Plain');
check('M1: bare words on their own lines inside <text> stay one line at x/y, trimmed', !!pw && plainText(pw) === 'Hello world' && pw.paragraphs.length === 1 && pw.x === 80 && near(pw.y, 120 - 20 * 0.8, 0.05), pw);
const pair = byName(pretty, 'Pair');
check('M1: whitespace between two tspans on one line is one space, the bold run kept apart', !!pair && plainText(pair) === 'Hello world' && pair.paragraphs[0].runs.length === 2 && pair.paragraphs[0].runs[1].bold === true, pair);
check('M1: Figma\'s own &#10; line ends still read as before', plainText(h1) === 'Gardens that\ngrow with you' && plainText(body).split('\n').length === 2);

// M2: Illustrator's default export — every fill and font a class rule in <style>
const ai = svg.fromSvg([{ name: 'flyer.svg', text: read('svg-illustrator-classes.svg') }]);
const aiSec = ai.pages[0].sections[0];
const aiTitle = byText(ai, 'Quiet rooms');
check('M2: class rules paint the page — the .st0 artboard is the white fill, nothing is black by default', validatePuppet(ai).length === 0 && aiSec.fill.color === '#ffffff' && !find(ai, (n) => n.fill && n.fill.color === '#000000') && !find(ai, (n) => n.type === 'text' && n.paragraphs[0].runs[0].color === '#000000'), [aiSec.fill, ai.notes]);
check('M2: a heading styled by three classes: 64 px, #1c1b1f, bold Inter from the PostScript name Inter-Bold, placed by its matrix', !!aiTitle && aiTitle.paragraphs[0].runs[0].size === 64 && aiTitle.paragraphs[0].runs[0].color === '#1c1b1f' && aiTitle.paragraphs[0].runs[0].font === 'Inter' && aiTitle.paragraphs[0].runs[0].bold === true && aiTitle.paragraphs[0].runs[0].weight === 700 && aiTitle.x === 80 && near(aiTitle.y, 420 - 64 * 0.8, 0.05), aiTitle);
const aiSub = byText(ai, 'Interiors for people who read.');
check('M2: a multi-property class and grouped selectors (.st4,.st5)', !!aiSub && aiSub.paragraphs[0].runs[0].size === 20 && aiSub.paragraphs[0].runs[0].color === '#4a4a4a' && aiSub.paragraphs[0].runs[0].font === 'Inter' && all(ai, (n) => n.type === 'shape' && n.fill && n.fill.color === '#c8553d').length === 2, all(ai, (n) => n.type === 'shape').map((n) => n.fill));
check('M2: a full-bleed rect the file never coloured is not the page background — dropped with a note', !byName(ai, 'Artboard') && ai.notes.some((n) => HEBREW.test(n) && /שחור/.test(n)) && ai.pages[0].name === 'flyer', [ai.notes, ai.pages[0].name]);
check('M2: the inline style beats a class rule, a class rule beats the attribute (CSS order)', (() => { const p = svg.fromSvg([{ name: 'o.svg', text: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><style>.a{fill:#00ff00}</style><rect id="A" class="a" fill="#ff0000" width="10" height="10"/><rect id="B" class="a" style="fill:#0000ff" fill="#ff0000" x="20" width="10" height="10"/><text x="0" y="90" font-size="9">t</text></svg>' }]); return byName(p, 'A').fill.color === '#00ff00' && byName(p, 'B').fill.color === '#0000ff'; })());

// M3: an illustration is not "outlined text"
const illo = read('svg-illustration.svg');
const dIllo = svg.detect(illo);
check('M3: an illustration with six named vector paths and no text is NOT refused — it passes with a Hebrew note that counts them', dIllo.ok === true && HEBREW.test(dIllo.note) && /6/.test(dIllo.note), dIllo);
const illoPuppet = svg.fromSvg([{ name: 'illo.svg', text: illo }]);
check('M3: …and decodes into its shapes (five filled paths, one stroked line)', all(illoPuppet, (n) => n.type === 'shape').length >= 5 && all(illoPuppet, (n) => n.type === 'line').length === 1 && illoPuppet.pages[0].sections[0].fill.color === '#dcebf7', all(illoPuppet, (n) => n.type !== 'group').map((n) => [n.type, n.name]));
const evOut = svg._internals.outlineEvidence(outlinedSvg);
check('M3: the outlined fixture is still refused — multi-word names AND glyph-shaped paths', svg.detect(outlinedSvg).code === 'E_SVG_OUTLINED' && evOut.strong >= 3 && evOut.shaped >= 3, evOut);
check('M3: the evidence pieces — "Section heading" reads as words, "Vector_7" / "leaf-left" do not; a glyph run is text-shaped, a leaf is not', svg._internals.wordsInName('Section heading') === 2 && svg._internals.wordsInName('Subheading_2') === 1 && svg._internals.wordsInName('Vector_7') === 0 && svg._internals.wordsInName('leaf-left') === 0 && svg._internals.textShaped('M0 0h5v8h-5zM8 0h5v8h-5zM16 0h5v8h-5zM24 0h5v8h-5zM32 0h5v8h-5zM40 0h5v8h-5z') === true && svg._internals.textShaped('M0 0C10 -10 20 10 30 0C20 20 10 20 0 0Z') === false);

// LOW: physical units and colliding names
const a4 = svg.fromSvg([{ name: 'a4.svg', text: '<svg width="210mm" height="297mm" viewBox="0 0 210 297" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="190" height="50" fill="#123456"/><text x="10" y="100" font-size="8">Hi</text></svg>' }]);
check('LOW: an Inkscape A4 page (width="210mm") is 793.7 px wide, its units scaled to px (x 10 → 37.8, 8 → 30.24)', near(a4.pages[0].width, 793.7, 0.1) && near(find(a4, (n) => n.type === 'shape').x, 37.8, 0.1) && near(find(a4, (n) => n.type === 'text').paragraphs[0].runs[0].size, 30.24, 0.05), [a4.pages[0].width, find(a4, (n) => n.type === 'shape')]);
check('LOW: width="100%" says nothing — the viewBox is the page', svg.fromSvg([{ name: 'p.svg', text: '<svg width="100%" height="100%" viewBox="0 0 640 480" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="480" fill="#eeeeee"/><rect x="10" y="10" width="100" height="100" fill="#112233"/></svg>' }]).pages[0].width === 640);
const homes = svg.fromSvg([{ name: 'Home.svg', text: pageSvg }, { name: 'Home.svg', text: pageSvg }, { name: 'Home.svg', text: pageSvg }]);
check('LOW: three files called Home → names, paths, keys and anchors all distinct (no home-2-2)', homes.pages.map((p) => p.name).join('|') === 'Landing page|Landing page 2|Landing page 3' && homes.pages.map((p) => p.path).join('|') === '/|/home|/home-2' && new Set(homes.pages.map((p) => p.key)).size === 3 && new Set(homes.pages.map((p) => p.sections[0].anchor)).size === 3, homes.pages.map((p) => [p.name, p.path, p.key]));

// a file that spends its whole budget before it draws anything is HEAVY, not
// empty: the refusal must not send the owner to go and check their frame
{
  let defs = '<defs><g id="L0"><rect width="4" height="4" fill="#123"/></g>';
  for (let i = 1; i <= 14; i++) defs += '<g id="L' + i + '">' + ('<use xlink:href="#L' + (i - 1) + '"/>').repeat(8) + '</g>';
  const deep = '<svg width="800" height="600" viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
    defs + '</defs><g id="Page"><use xlink:href="#L14"/><text font-family="Inter" font-size="40"><tspan x="40" y="80">Hello</tspan></text></g></svg>';
  const tDeep = Date.now();
  let code = '';
  let msg = '';
  try { svg.fromSvg([{ name: 'Bomb', text: deep }], {}); } catch (e) { code = e.code; msg = e.message; }
  check('H1: a fan-out that eats the budget before drawing is refused as HEAVY (not "empty"), fast',
    code === 'E_SVG_TOO_BIG' && /כבד/.test(msg) && Date.now() - tDeep < 1500, [code, (Date.now() - tDeep) + 'ms']);
}

check('smoke runs in < 2 s', Date.now() - t0 < 2000, (Date.now() - t0) + 'ms');
console.log('SMOKE GEPPETTO-SVG: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
