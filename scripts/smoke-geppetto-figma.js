'use strict';

/**
 * Geppetto — the Figma doors (src/geppetto/figma.js) and the Figma plugin.
 *
 * What is under test, on SYNTHETIC fixtures that mimic the shapes read off
 * real published sites:
 *   - the Sites bundle: two pages with their paths, sections from the widest
 *     breakpoint frame, a TEXT with mixed runs (a bold word, a hyperlink run at
 *     the desktop text size), an IMAGE fill → an absolute asset URL, a VIDEO
 *     fill → a video with its poster, a GRID frame → a grid layout, a URL
 *     interaction → link, NAVIGATE → link.page, SCROLL_TO → link.anchor, a
 *     hidden node skipped, a code component skipped with a note, VARIABLE
 *     colours → palette, an INSTANCE materialized from its component with its
 *     label override, the phone layout (hidden / reordered / boxes), fonts
 *     with their files, roles from accessibleHTMLTag, RTL detection;
 *   - detectSites / detectMakeApp on synthetic heads, sitesPagePaths,
 *     sitesPageJsonPath;
 *   - the REST file: pages from ≥ 900 px frames, the phone frame matched by
 *     name, narrow frames noted, node-id narrowing, the images map (a missing
 *     ref skipped with a note), REST interactions and the legacy
 *     transitionNodeID, gradient handles, ELLIPSE → circle mask, rotation;
 *   - parseFileUrl on /design/, /file/, /proto/ and a foreign URL;
 *   - the plugin: code.js loads in Node, its pure serializer turns a mocked
 *     Figma tree into the export, fromPluginExport reads it, the committed
 *     fixture decodes, the in-Figma bootstrap runs against a mocked `figma`,
 *     and the picture budget (per picture, in total) is enforced with notes.
 * No network: every URL here is invented.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-geppetto-figma-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const figma = require('../src/geppetto/figma');
const { validatePuppet, eachNode, plainText, countNodes } = require('../src/geppetto/puppet');
const PLUGIN_PATH = path.join(__dirname, '..', 'integrations', 'figma-plugin', 'code.js');
const plugin = require(PLUGIN_PATH);

const FIX = path.join(__dirname, '..', 'test', 'fixtures', 'geppetto');
const load = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
const ORIGIN = 'https://example-site.figma.site';

function find(puppet, pred) {
  let out = null;
  for (const pg of puppet.pages) for (const s of pg.sections) eachNode(s.nodes, (n) => { if (!out && pred(n)) out = n; });
  return out;
}
const byName = (puppet, name) => find(puppet, (n) => n.name === name);
const byText = (puppet, text) => find(puppet, (n) => n.type === 'text' && plainText(n) === text);
const section = (puppet, pageIndex, anchor) => puppet.pages[pageIndex].sections.find((s) => s.anchor === anchor);

// ── detectSites / detectMakeApp on synthetic heads ────────────────────────
const BUNDLE = 'a1b2c3d4-0000-4000-8000-0123456789ab';
const sitesHead = (preload) => `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<link rel="preload" href="/_json/${BUNDLE}/${preload}" as="fetch" /></head><body><div id="container"></div>
<script type="module">
  import {SitesRuntime} from '/_runtimes/sites-runtime.0123456789abcdef.js';
  const sitesRuntime = new SitesRuntime({
    container: document.getElementById('container'),
    env: 'published',
    bundleId: '${BUNDLE}',
    assetsVersion: 'v11',
    fontsVersion: 'v1',
    videosVersion: 'v1',
    codeComponentsVersion: 'v2',
    isFigmake: false,
    renderOptions: { a: 1 },
  });
</script></body></html>`;
const det = figma.detectSites(sitesHead('_index.json'));
check('detectSites reads the multi-line boot block', !!det && det.bundleId === BUNDLE && det.indexPath === '/_json/' + BUNDLE + '/_index.json');
check('detectSites: versions, isFigmake, page path', !!det && det.assetsVersion === 'v11' && det.videosVersion === 'v1' && det.fontsVersion === 'v1' && det.isFigmake === false && det.pagePath === '/');
const detAbout = figma.detectSites(sitesHead('about.json'));
check('detectSites on a sub-page HTML knows which page it is', !!detAbout && detAbout.pagePath === '/about');
const framerHtml = '<html><head><meta name="generator" content="Framer 1"><script type="module" src="https://framerusercontent.com/sites/x/script_main.mjs"></script></head><body></body></html>';
check('detectSites returns null for a non-Figma page', figma.detectSites(framerHtml) === null);
const makeHtml = '<html><head><script type="module" src="https://example-app.figma.site/assets/index-Ab12Cd34.js"></script><script defer src="/__figma__/make_community_banner_v1.js"></script></head><body></body></html>';
check('a Figma Make app is not a Sites page but is recognised as a Make app', figma.detectSites(makeHtml) === null && figma.detectMakeApp(makeHtml) === true && figma.detectMakeApp(sitesHead('_index.json')) === false);

// ── the bundle helpers ────────────────────────────────────────────────────
const index = load('figma-sites-index.json');
const about = load('figma-sites-about.json');
check('sitesPagePaths lists the other pages', JSON.stringify(figma.sitesPagePaths(index)) === '["/about"]');
check('sitesPageJsonPath: page, index and CMS sibling', figma.sitesPageJsonPath(BUNDLE, '/about') === '/_json/' + BUNDLE + '/about.json' && figma.sitesPageJsonPath(BUNDLE, '/') === '/_json/' + BUNDLE + '/_index.json' && figma.sitesPageJsonPath(BUNDLE, '/about', { cms: true }) === '/_json/' + BUNDLE + '/_cms/about.json' && figma.sitesCmsJsonPath(BUNDLE, '/') === '/_json/' + BUNDLE + '/_cms/_index.json');

// ── fromSites over the two-page fixture ───────────────────────────────────
const sites = figma.fromSites({ origin: ORIGIN + '/', index, pages: { '/about': about } });
check('Sites puppet validates', validatePuppet(sites).length === 0 && sites.format === 'figma-sites' && sites.source === 'figma');
check('two pages with their paths and stable keys', sites.pages.length === 2 && sites.pages[0].path === '/' && sites.pages[0].key === '0:3' && sites.pages[1].path === '/about' && sites.pages[1].key === '9:1');
check('page width = the widest breakpoint, phone width kept', sites.pages[0].width === 1280 && sites.pages[0].mobileWidth === 375 && sites.pages[0].breakpoints.length === 2);
check('site: title, description, lang, favicon and social image URLs', sites.site.title === 'Example Studio' && sites.site.lang === 'en' && sites.site.favicon === ORIGIN + '/_assets/v11/1000000000000000000000000000000000000009.png' && sites.site.socialImage.endsWith('0010.png') && sites.site.dir === 'ltr');
check('origin keeps its trailing slash', sites.origin === ORIGIN + '/');

const home = sites.pages[0];
check('sections come from the Desktop frame children, in order', home.sections.map((s) => s.anchor).join(',') === 'hero,gallery,film,newsletter-form,footer,nav');
const nav = section(sites, 0, 'nav');
check('the fixed nav is a section with fixed + tag nav and a translucent fill', !!nav && nav.fixed === true && nav.tag === 'nav' && nav.fill.color === 'rgba(255,255,255,0.8)');
const hero = section(sites, 0, 'hero');
check('hero section: image fill with an absolute URL + gradient tint + column layout + entrance animation', !!hero && hero.fill.image && hero.fill.image.src === ORIGIN + '/_assets/v11/1000000000000000000000000000000000000002.png' && /^linear-gradient\(180deg/.test(hero.fill.gradient) && hero.layout.mode === 'column' && hero.layout.gap === 24 && JSON.stringify(hero.layout.padding) === '[160,240,120,240]' && hero.anim === 'rise' && hero.tag === 'header');

const h1 = byName(sites, 'Headline');
const runs = h1 && h1.paragraphs[0].runs;
check('TEXT with mixed runs: 4 runs, the bold word, the hyperlink run', !!runs && runs.length === 4 && runs[1].text === 'bread' && runs[1].bold === true && runs[1].weight === 700 && runs[3].text === 'daily' && runs[3].href === 'https://example.com/bakery/daily' && runs[3].underline === true && runs[3].color === '#ffd999');
check('run size = the responsive variant for the desktop width (56, not the base 40)', !!runs && runs.every((r) => r.size === 56) && runs[0].font === 'Arimo' && runs[0].color === '#ffffff');
check('role from accessibleHTMLTag: h1 / p / a / button', h1.role === 'h1' && byName(sites, 'Tagline').role === 'p' && byText(sites, 'About').role === 'a' && byName(sites, 'Button').role === 'button');
check('paragraphs split on newline and keep the align', byName(sites, 'Tagline').paragraphs.length === 2 && byName(sites, 'Tagline').paragraphs[0].align === 'center');

const loaf = byName(sites, 'Loaf');
check('IMAGE fill → image with absolute URL, cover, rounded mask, natural size, alt', !!loaf && loaf.type === 'image' && loaf.src === ORIGIN + '/_assets/v11/1000000000000000000000000000000000000003.png' && loaf.fit === 'cover' && loaf.mask === 'rounded' && loaf.radius === 12 && loaf.natural.w === 1200 && loaf.alt === 'A round loaf on a wooden board');
check('FIT scale mode → contain', byName(sites, 'Croissants').fit === 'contain');
const video = byName(sites, 'Oven film');
check('VIDEO fill → video with src, poster, autoplay/loop/muted', !!video && video.type === 'video' && video.src === ORIGIN + '/_videos/v1/1000000000000000000000000000000000000007' && video.poster === ORIGIN + '/_assets/v11/1000000000000000000000000000000000000006.png' && video.autoplay && video.loop && video.muted);
const gallery = section(sites, 0, 'gallery');
check('GRID frame → grid layout with columns and gaps', !!gallery && gallery.layout.mode === 'grid' && gallery.layout.columns === 3 && gallery.layout.gap === 40 && gallery.layout.rowGap === 40 && gallery.tag === 'section');
check('a hidden node is skipped', gallery.nodes.length === 3 && !byName(sites, 'Oven (old)'));

const button = byName(sites, 'Button');
check('URL interaction → link with newTab', !!button && button.link && button.link.href === 'https://order.example.com/bakery' && button.link.newTab === true);
check('INSTANCE materialized from its component: the label override lands inside the button box', !!button && button.children.length === 1 && plainText(button.children[0]) === 'Order now' && button.children[0].x >= button.x && button.children[0].x + button.children[0].w <= button.x + button.w + 1 && button.children[0].paragraphs[0].runs[0].bold === true && button.fill.color === '#b8471f' && button.radius === 8);
check('NAVIGATE interaction → link.page (a text and the logo)', byText(sites, 'About').link.href === '/about' && byText(sites, 'About').link.page === '9:1' && byName(sites, 'Logo').link.page === '0:3');
check('SCROLL_TO interaction → link.anchor of the target section', byText(sites, 'Contact').link.anchor === 'footer' && byText(sites, 'Contact').link.href === '#footer');
check('an SVG node → svg image with the .svg asset URL and its label as alt', byName(sites, 'Logo').type === 'image' && byName(sites, 'Logo').svg === true && byName(sites, 'Logo').src.endsWith('0001.svg') && byName(sites, 'Logo').alt === 'Example Studio');
check('a picture that also navigates keeps its link', byName(sites, 'Oven').link && byName(sites, 'Oven').link.page === '9:1');

check('CODE_INSTANCE skipped with a note that names it', !byName(sites, 'Newsletter form') && sites.notes.some((n) => /code component/.test(n) && /Newsletter form/.test(n)));
check('VARIABLE colours → palette (in order) and named tokens', JSON.stringify(sites.palette) === '["#b8471f","#fffdfa"]' && sites.tokens.length === 2 && sites.tokens[0].name === 'Brand/Crust');
check('TEXT STYLE nodes → textStyles with the desktop size', sites.textStyles.length === 1 && sites.textStyles[0].name === 'Display/H1' && sites.textStyles[0].size === 56 && sites.textStyles[0].weight === 700);
check('fonts registered with weights and hosted files (Google path + custom /_user_fonts/)', sites.fonts.Arimo && JSON.stringify(sites.fonts.Arimo.weights) === '[400,700]' && sites.fonts.Arimo.files.some((f) => f.url === ORIGIN + '/_woff/v2/Arimo_2/Arimo_2.woff2' && f.weight === 700) && sites.fonts['Example Serif'].files[0].url === ORIGIN + '/_user_fonts/v1/2000000000000000000000000000000000000001');

const footer = section(sites, 0, 'footer');
check('footer: bullet list, a line, a rotated shape with stroke, tag footer', !!footer && footer.tag === 'footer' && byName(sites, 'Menu list').paragraphs.every((p) => p.list === 'bullet') && byName(sites, 'Divider').type === 'line' && byName(sites, 'Divider').width === 1 && byName(sites, 'Diamond').rotate === 45 && byName(sites, 'Diamond').w === 40 && byName(sites, 'Diamond').stroke.width === 2 && byName(sites, 'Diamond').role === 'decoration');
check('UPPER text case and a semi-transparent colour survive as run facts', byName(sites, 'Caption').paragraphs[0].runs[0].upper === true && byName(sites, 'Tagline').paragraphs[0].runs[0].color === 'rgba(255,255,255,0.9)');
check('z grows in paint order inside a section', hero.nodes.every((n, i) => i === 0 || n.z > hero.nodes[i - 1].z));

// the phone layout
check('phone: a node absent on the phone is hidden, a present one carries its phone box', byName(sites, 'Tagline').mobile && byName(sites, 'Tagline').mobile.hidden === true && h1.mobile && h1.mobile.w === 327 && h1.mobile.x === 24);
const sectionMobile = (anchor) => section(sites, 0, anchor).mobile || {};
check('phone: sections carry their phone order / hidden', sectionMobile('gallery').order === 2 && sectionMobile('film').hidden === true && sectionMobile('footer').order === 1);

// the second page
const aboutPage = sites.pages[1];
check('about page: its own title and description from its siteSettings', aboutPage.title === 'About — Example Studio' && aboutPage.description === 'Who bakes your bread' && aboutPage.name === 'About');
const back = byName(sites, 'Back');
check('a NODE hyperlink with a path → run href + node link.page', !!back && back.paragraphs[0].runs[0].href === '/' && back.link.page === '0:3' && back.paragraphs[0].runs[0].underline === true);
check('H2 with UPPER case and Bold style name → weight 700', byName(sites, 'Title').role === 'h2' && byName(sites, 'Title').paragraphs[0].runs[0].weight === 700 && byName(sites, 'Title').paragraphs[0].runs[0].upper === true);

// tolerance: a page that failed to fetch
const partial = figma.fromSites({ origin: ORIGIN, index, pages: { '/about': null } });
check('a page that failed to fetch is simply absent, with a note', validatePuppet(partial).length === 0 && partial.pages.length === 1 && partial.notes.some((n) => /\/about/.test(n) && /not fetched/.test(n)));

// RTL detection
const rtlIndex = JSON.parse(JSON.stringify(index));
for (const n of Object.values(rtlIndex.nodeById)) if (n.type === 'TEXT') { n.characters = 'לחם טרי, נאפה כל יום'; n.characterStyleOverrides = []; n.lineTypes = ['NONE']; }
check('Hebrew text → site.dir rtl', figma.fromSites({ origin: ORIGIN, index: rtlIndex }).site.dir === 'rtl');
check('a bundle that is not a bundle throws a clear error', (() => { try { figma.fromSites({ index: { hello: 1 } }); return false; } catch (e) { return /_index\.json/.test(e.message); } })());

// ── the REST file ─────────────────────────────────────────────────────────
const file = load('figma-file.json');
const images = { meta: { images: { 'hero-ref': 'https://images.example.invalid/hero.png', 'card-ref-1': 'https://images.example.invalid/card1.png', 'portrait-ref': 'https://images.example.invalid/dana.png', '10:28': 'https://images.example.invalid/leaf.svg' } } };
const rest = figma.fromFile(file, { images, key: 'ABCDEFGHIJKLMNOPQRSTUV' });
check('REST puppet validates (format figma-file)', validatePuppet(rest).length === 0 && rest.format === 'figma-file' && rest.fileKey === 'ABCDEFGHIJKLMNOPQRSTUV' && rest.site.title === 'Example Site');
check('pages from the ≥ 900 px frames: Home → /, About → /about', rest.pages.length === 2 && rest.pages[0].path === '/' && rest.pages[0].key === '10:1' && rest.pages[1].path === '/about' && rest.pages[1].key === '20:1' && rest.pages[0].width === 1440);
check('the phone frame with a matching name is used for phone hints', rest.pages[0].mobileWidth === 390 && byName(rest, 'Sub').mobile && byName(rest, 'Sub').mobile.hidden === true && byName(rest, 'Headline').mobile && byName(rest, 'Headline').mobile.w === 350);
check('narrow frames without a match are noted and skipped', rest.notes.some((n) => /Sticker/.test(n)) && rest.notes.some((n) => /Tablet/.test(n) && /768/.test(n)) && !rest.pages.some((p) => /sticker|tablet/i.test(p.name)));
check('a free-form page whose full-width children stack becomes sections', rest.pages[1].sections.map((s) => s.anchor).join(',') === 'intro,team');
check('images map (REST envelope) resolves imageRefs; a missing ref is skipped with a note', byName(rest, 'Hero photo').src === 'https://images.example.invalid/hero.png' && !byName(rest, 'Badge') && rest.notes.some((n) => /1 picture skipped/.test(n)));
check('REST interactions: NODE navigation → link.page; legacy transitionNodeID → anchor', byName(rest, 'Nav / About').link.page === '20:1' && byName(rest, 'Nav / About').link.href === '/about' && byName(rest, 'Nav / Contact').link.anchor === 'footer');
const restRuns = byName(rest, 'Headline').paragraphs[0].runs;
check('REST TypeStyle: fontWeight + an italic override run', restRuns.length === 2 && restRuns[0].bold === true && restRuns[0].weight === 700 && restRuns[1].italic === true && restRuns[1].weight === 400 && restRuns[1].text === 'small rooms');
check('ELLIPSE with a solid fill → ellipse shape; with an image → circle mask', byName(rest, 'Icon').shape === 'ellipse' && byName(rest, 'Portrait').type === 'image' && byName(rest, 'Portrait').mask === 'circle');
check('gradient handles → CSS angle and stops', byName(rest, 'Gradient').fill.gradient === 'linear-gradient(90deg, #338c59 0%, #1a5940 100%)');
check('LINE → line; ORDERED lines → numbered paragraphs; rotation → CSS degrees', byName(rest, 'Rule').type === 'line' && byName(rest, 'Steps').paragraphs.every((p) => p.list === 'number') && byName(rest, 'Tilted square').rotate === 15 && byName(rest, 'Tilted square').w === 40);
check('a vector with a rendered URL in the images map → svg image; a style hyperlink → run href + node link', byName(rest, 'Leaf icon').svg === true && byName(rest, 'CTA').paragraphs[0].runs[0].href === 'https://booking.example.com/plants' && byName(rest, 'CTA').link.href === 'https://booking.example.com/plants');
check('wrap layout with row gap and a card with shadow', section(rest, 0, 'features').layout.wrap === true && section(rest, 0, 'features').layout.rowGap === 40 && byName(rest, 'Card').shadow === '0px 8px 24px 0px rgba(0,0,0,0.08)');
const scoped = figma.fromFile(file, { images, nodeId: '20:1' });
check('nodeId narrows the import to that frame (as the only page)', scoped.pages.length === 1 && scoped.pages[0].name === 'About' && scoped.pages[0].path === '/' && validatePuppet(scoped).length === 0);
check('nodeId of a CANVAS → that page\'s frames; an unknown id falls back with a note', figma.fromFile(file, { images, nodeId: '0:1' }).pages.length === 2 && figma.fromFile(file, { images, nodeId: '99:99' }).notes.some((n) => /99:99/.test(n)));
check('fromFile refuses a non-file', (() => { try { figma.fromFile({ name: 'x' }); return false; } catch (e) { return /v1\/files/.test(e.message); } })());

// ── parseFileUrl ──────────────────────────────────────────────────────────
check('parseFileUrl: /design/ with node-id', JSON.stringify(figma.parseFileUrl('https://www.figma.com/design/AbCdEfGhIjKlMnOp/My-Site?node-id=12-34&t=xyz')) === '{"key":"AbCdEfGhIjKlMnOp","nodeId":"12:34"}');
check('parseFileUrl: /file/ without node-id, /proto/ with an encoded colon', JSON.stringify(figma.parseFileUrl('https://figma.com/file/AbCdEfGhIjKlMnOp/Name')) === '{"key":"AbCdEfGhIjKlMnOp","nodeId":null}' && figma.parseFileUrl('https://www.figma.com/proto/AbCdEfGhIjKlMnOp/Name?node-id=1%3A2').nodeId === '1:2');
check('parseFileUrl: a foreign URL → null', figma.parseFileUrl('https://example.com/design/AbCdEfGhIjKlMnOp') === null && figma.parseFileUrl('') === null);

// ── the plugin ────────────────────────────────────────────────────────────
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><path d="M4 44C4 20 20 4 44 4 44 28 28 44 4 44Z"/></svg>');
const MIXED = Symbol('mixed');
const white = { type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 1, b: 1 } };
const ink = { type: 'SOLID', visible: true, opacity: 1, color: { r: 0.1, g: 0.1, b: 0.12 } };
const green = { type: 'SOLID', visible: true, opacity: 1, color: { r: 0.2, g: 0.55, b: 0.35 } };

/** A mocked Plugin-API node: the fields code.js reads, nothing more. */
function mockNode(o) {
  const bb = o.absoluteBoundingBox;
  return Object.assign({ visible: true, opacity: 1, rotation: 0, fills: [], strokes: [], effects: [], reactions: [], cornerRadius: 0, relativeTransform: [[1, 0, bb.x], [0, 1, bb.y]], width: bb.width, height: bb.height, exportAsync: async ({ format }) => (format === 'SVG' ? SVG : PNG) }, o);
}
function seg(start, end, characters, extra) {
  return Object.assign({ start, end, characters, fontName: { family: 'Example Sans', style: 'Regular' }, fontSize: 16, fontWeight: 400, fills: [ink], textCase: 'ORIGINAL', textDecoration: 'NONE', hyperlink: null, listOptions: { type: 'NONE' }, indentation: 0, letterSpacing: { value: 0, unit: 'PIXELS' }, lineHeight: { unit: 'AUTO' } }, extra);
}
function mockText(o, segments) {
  return mockNode(Object.assign({ type: 'TEXT', textAlignHorizontal: 'LEFT', textAlignVertical: 'TOP', textAutoResize: 'WIDTH_AND_HEIGHT', fontName: MIXED, fills: MIXED, characters: segments.map((s) => s.characters).join(''), getStyledTextSegments: () => segments }, o));
}
function mockPage() {
  const header = mockNode({ id: '1:2', type: 'FRAME', name: 'Header', absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 80 }, layoutMode: 'HORIZONTAL', itemSpacing: 40, paddingLeft: 60, paddingRight: 60, primaryAxisAlignItems: 'SPACE_BETWEEN', counterAxisAlignItems: 'CENTER', fills: [white], children: [
    mockText({ id: '1:3', name: 'Wordmark', absoluteBoundingBox: { x: 60, y: 26, width: 160, height: 28 } }, [seg(0, 12, 'Example Site', { fontName: { family: 'Example Sans', style: 'Bold' }, fontWeight: 700, fontSize: 22 })]),
    mockText({ id: '1:4', name: 'About link', absoluteBoundingBox: { x: 1300, y: 28, width: 80, height: 24 }, reactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: '2:1', navigation: 'NAVIGATE' }] }] }, [seg(0, 5, 'About')])
  ] });
  const hero = mockNode({ id: '1:10', type: 'FRAME', name: 'Hero', absoluteBoundingBox: { x: 0, y: 80, width: 1440, height: 600 }, layoutMode: 'NONE', clipsContent: true, children: [
    mockNode({ id: '1:11', type: 'RECTANGLE', name: 'Hero photo', absoluteBoundingBox: { x: 0, y: 80, width: 1440, height: 600 }, fills: [{ type: 'IMAGE', visible: true, opacity: 1, scaleMode: 'FILL', imageHash: 'hash-hero' }] }),
    mockText({ id: '1:12', name: 'Headline', absoluteBoundingBox: { x: 320, y: 300, width: 800, height: 64 }, textAlignHorizontal: 'CENTER' }, [
      seg(0, 11, 'Plants for ', { fontName: { family: 'Example Sans', style: 'Bold' }, fontWeight: 700, fontSize: 56, fills: [white] }),
      seg(11, 22, 'small rooms', { fontName: { family: 'Example Sans', style: 'Italic' }, fontWeight: 400, fontSize: 56, fills: [white], textDecoration: 'UNDERLINE', hyperlink: { type: 'URL', value: 'https://example.com/rooms' } })
    ])
  ] });
  const gallery = mockNode({ id: '1:20', type: 'FRAME', name: 'Gallery', absoluteBoundingBox: { x: 0, y: 680, width: 1440, height: 400 }, layoutMode: 'HORIZONTAL', layoutWrap: 'WRAP', itemSpacing: 24, counterAxisSpacing: 24, paddingTop: 40, paddingRight: 60, paddingBottom: 40, paddingLeft: 60, fills: [white], children: [
    mockNode({ id: '1:21', type: 'RECTANGLE', name: 'Fern', absoluteBoundingBox: { x: 60, y: 720, width: 400, height: 320 }, cornerRadius: 12, fills: [{ type: 'IMAGE', visible: true, opacity: 1, scaleMode: 'FILL', imageHash: 'hash-fern' }] }),
    mockNode({ id: '1:22', type: 'ELLIPSE', name: 'Monstera', absoluteBoundingBox: { x: 484, y: 720, width: 320, height: 320 }, fills: [{ type: 'IMAGE', visible: true, opacity: 1, scaleMode: 'FILL', imageHash: 'hash-monstera' }] }),
    mockNode({ id: '1:23', type: 'VECTOR', name: 'Leaf', absoluteBoundingBox: { x: 900, y: 856, width: 48, height: 48 }, fills: [green] }),
    mockNode({ id: '1:24', type: 'RECTANGLE', name: 'Old photo', visible: false, absoluteBoundingBox: { x: 980, y: 720, width: 400, height: 320 }, fills: [{ type: 'IMAGE', visible: true, opacity: 1, scaleMode: 'FILL', imageHash: 'hash-old' }] })
  ] });
  const footer = mockNode({ id: '1:30', type: 'FRAME', name: 'Footer', absoluteBoundingBox: { x: 0, y: 1080, width: 1440, height: 120 }, layoutMode: 'NONE', fills: [ink], children: [
    mockNode({ id: '1:31', type: 'LINE', name: 'Rule', absoluteBoundingBox: { x: 60, y: 1080, width: 1320, height: 0 }, strokes: [{ type: 'SOLID', visible: true, opacity: 0.3, color: { r: 1, g: 1, b: 1 } }], strokeWeight: 1, strokeAlign: 'CENTER' }),
    mockText({ id: '1:32', name: 'Steps', absoluteBoundingBox: { x: 60, y: 1100, width: 400, height: 48 } }, [seg(0, 23, 'Pick a plant\nWe ship it', { fills: [white], listOptions: { type: 'ORDERED' }, indentation: 1 })])
  ] });
  const home = mockNode({ id: '1:1', type: 'FRAME', name: 'Home', absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1200 }, layoutMode: 'VERTICAL', clipsContent: true, fills: [white], children: [header, hero, gallery, footer] });
  const mobile = mockNode({ id: '3:1', type: 'FRAME', name: 'Home — Mobile', absoluteBoundingBox: { x: 1600, y: 0, width: 390, height: 1400 }, layoutMode: 'VERTICAL', fills: [white], children: [
    mockNode({ id: '3:2', type: 'FRAME', name: 'Header', absoluteBoundingBox: { x: 1600, y: 0, width: 390, height: 64 }, layoutMode: 'HORIZONTAL', children: [mockText({ id: '3:3', name: 'Wordmark', absoluteBoundingBox: { x: 1620, y: 20, width: 140, height: 24 } }, [seg(0, 12, 'Example Site', { fontWeight: 700, fontSize: 18 })])] }),
    mockNode({ id: '3:10', type: 'FRAME', name: 'Hero', absoluteBoundingBox: { x: 1600, y: 64, width: 390, height: 480 }, layoutMode: 'NONE', children: [
      mockNode({ id: '3:11', type: 'RECTANGLE', name: 'Hero photo', absoluteBoundingBox: { x: 1600, y: 64, width: 390, height: 480 }, fills: [{ type: 'IMAGE', visible: true, opacity: 1, scaleMode: 'FILL', imageHash: 'hash-hero' }] }),
      mockText({ id: '3:12', name: 'Headline', absoluteBoundingBox: { x: 1620, y: 240, width: 350, height: 96 }, textAlignHorizontal: 'CENTER' }, [seg(0, 22, 'Plants for small rooms', { fontWeight: 700, fontSize: 36, fills: [white] })])
    ] })
  ] });
  const aboutFrame = mockNode({ id: '2:1', type: 'FRAME', name: 'About', absoluteBoundingBox: { x: 0, y: 1400, width: 1440, height: 600 }, layoutMode: 'VERTICAL', fills: [white], children: [
    mockNode({ id: '2:2', type: 'FRAME', name: 'Intro', absoluteBoundingBox: { x: 0, y: 1400, width: 1440, height: 600 }, layoutMode: 'NONE', children: [mockText({ id: '2:3', name: 'Title', absoluteBoundingBox: { x: 320, y: 1500, width: 800, height: 48 } }, [seg(0, 17, 'About the nursery', { fontWeight: 700, fontSize: 40 })])] })
  ] });
  const sticker = mockNode({ id: '4:1', type: 'FRAME', name: 'Sticker', absoluteBoundingBox: { x: 3000, y: 0, width: 200, height: 200 }, fills: [green], children: [] });
  return { id: '0:1', name: 'Website', selection: [], children: [home, mobile, aboutFrame, sticker] };
}
function mockApi(page, extra) {
  return Object.assign({
    mixed: MIXED,
    currentPage: page,
    root: { name: 'Example Site' },
    fileKey: '',
    base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
    getImageByHash: () => ({ getBytesAsync: async () => PNG }),
    variables: {
      getLocalVariablesAsync: async () => [{ name: 'Brand/Green', variableCollectionId: 'c1', valuesByMode: { m1: { r: 0.2, g: 0.55, b: 0.35, a: 1 } } }],
      getVariableCollectionByIdAsync: async () => ({ defaultModeId: 'm1' }),
      getVariableByIdAsync: async () => null
    }
  }, extra || {});
}

check('code.js loads in Node without a figma global and exposes the pure serializer', typeof plugin.serializeNode === 'function' && typeof plugin.assembleExport === 'function' && plugin.MAX_TOTAL_BYTES === 11 * 1024 * 1024 && plugin.MAX_IMAGE_BYTES === 5 * 1024 * 1024);

const pluginFixture = load('figma-plugin-export.json');
check('the committed plugin fixture is a tapuz-figma export', figma.isPluginExport(pluginFixture) && !figma.isPluginExport({ pages: [] }) && !figma.isPluginExport(index));
const fromFixture = figma.fromPluginExport(pluginFixture);
check('fromPluginExport(fixture) validates: two pages, phone hints, data: pictures, palette', validatePuppet(fromFixture).length === 0 && fromFixture.format === 'figma-file' && fromFixture.pages.length === 2 && fromFixture.pages[0].mobileWidth === 390 && /^data:image\/png;base64,/.test(byName(fromFixture, 'Hero photo').src) && JSON.stringify(fromFixture.palette) === '["#338c59"]');

(async () => {
  // the pure serializer on a mocked tree → the export → the puppet
  const page = mockPage();
  const ctx = plugin.newContext({ mixed: MIXED });
  const frames = plugin.pickNodes(page, 'page').map((n) => plugin.serializeNode(n, ctx));
  check('serializeNode: REST-shaped text (base style + override table + per-char indexes + lineTypes)', (() => {
    const t = frames[0].children[1].children[1];
    return t.type === 'TEXT' && t.characters === 'Plants for small rooms' && t.style.fontWeight === 700 && t.characterStyleOverrides.length === 22 && t.characterStyleOverrides[11] === 1 && t.styleOverrideTable[1].italic === true && t.styleOverrideTable[1].hyperlink.url === 'https://example.com/rooms' && JSON.stringify(t.lineTypes) === '["NONE"]';
  })());
  check('serializeNode: image fill → imageRef, reactions → REST interactions, hidden node kept as a stub, vector marked for SVG', frames[0].children[1].children[0].fills[0].imageRef === 'hash-hero' && frames[0].children[0].children[1].interactions[0].actions[0].destinationId === '2:1' && frames[0].children[2].children[3].visible === false && frames[0].children[2].children[2].svgRef === '1:23' && ctx.vectors.length === 1 && ctx.rasters.length === 3);
  await plugin.collectImages(ctx, mockApi(page));
  const exported = plugin.assembleExport({ fileName: 'Example Site', pages: [{ id: page.id, name: page.name, frames }], images: ctx.images, notes: ctx.notes, variables: await plugin.collectVariables(mockApi(page)) });
  check('collectImages: rasters keyed by hash, the vector keyed by node id, all as data URLs, no notes', Object.keys(exported.images).sort().join(',') === '1:23,hash-fern,hash-hero,hash-monstera' && /^data:image\/svg\+xml;base64,/.test(exported.images['1:23']) && exported.notes.length === 0);
  const live = figma.fromPluginExport(JSON.parse(JSON.stringify(exported)));
  check('fromPluginExport(live export) validates and the text facts survive', validatePuppet(live).length === 0 && byName(live, 'Headline').paragraphs[0].runs.length === 2 && byName(live, 'Headline').paragraphs[0].runs[0].bold === true && byName(live, 'Headline').paragraphs[0].runs[1].italic === true && byName(live, 'Headline').paragraphs[0].runs[1].href === 'https://example.com/rooms');
  check('… and the picture / vector / link / list / phone facts survive', /^data:image\/png/.test(byName(live, 'Fern').src) && byName(live, 'Fern').mask === 'rounded' && byName(live, 'Monstera').mask === 'circle' && byName(live, 'Leaf').svg === true && byName(live, 'About link').link.page === '2:1' && byName(live, 'Steps').paragraphs.every((p) => p.list === 'number') && byName(live, 'Headline').mobile.w === 350 && !byName(live, 'Old photo') && live.notes.some((n) => /Sticker/.test(n)));

  // the picture budget: one picture over 5 MB is skipped, the total stops at 11 MB — with notes
  const big = Buffer.alloc(6 * 1024 * 1024, 1);
  const four = Buffer.alloc(4 * 1024 * 1024, 1);
  const budgetPage = mockPage();
  const rasterNodes = [budgetPage.children[0].children[1].children[0], budgetPage.children[0].children[2].children[0], budgetPage.children[0].children[2].children[1]];
  rasterNodes[0].exportAsync = async () => big;
  rasterNodes[1].exportAsync = async () => four;
  rasterNodes[2].exportAsync = async () => four;
  budgetPage.children[0].children[2].children.push(mockNode({ id: '1:25', type: 'RECTANGLE', name: 'Third', absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 }, fills: [{ type: 'IMAGE', visible: true, opacity: 1, scaleMode: 'FILL', imageHash: 'hash-third' }], exportAsync: async () => four }));
  const bctx = plugin.newContext({ mixed: MIXED });
  plugin.pickNodes(budgetPage, 'page').forEach((n) => plugin.serializeNode(n, bctx));
  await plugin.collectImages(bctx, mockApi(budgetPage, { getImageByHash: () => ({ getBytesAsync: async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) }) }));
  const kept = Object.keys(bctx.images);
  check('budget: a 6 MB picture is skipped with a note, two 4 MB pictures fit, the third stops the export with a note', !kept.includes('hash-hero') && kept.includes('hash-fern') && kept.includes('hash-monstera') && !kept.includes('hash-third') && bctx.notes.some((n) => /over the 5\.0 MB limit/.test(n)) && bctx.notes.some((n) => /11\.0 MB limit/.test(n)));
  check('a node whose picture was left out still decodes (skipped with a note, the frame stays)', (() => {
    const puppet = figma.fromPluginExport(plugin.assembleExport({ fileName: 'x', pages: [{ id: '0:1', name: 'p', frames: plugin.pickNodes(budgetPage, 'page').map((n) => plugin.serializeNode(n, plugin.newContext({ mixed: MIXED }))) }], images: bctx.images, notes: bctx.notes }));
    return validatePuppet(puppet).length === 0 && !byName(puppet, 'Hero photo') && puppet.notes.some((n) => /picture.*skipped/.test(n)) && puppet.notes.some((n) => /^plugin: /.test(n)) && byName(puppet, 'Fern');
  })());

  // the in-Figma bootstrap against a mocked global
  const posted = [];
  const uiMock = { onmessage: null, postMessage: (m) => posted.push(m) };
  global.__html__ = '<html></html>';
  global.figma = mockApi(mockPage(), { showUI: () => { posted.push({ type: '_showUI' }); }, ui: uiMock, closePlugin: () => posted.push({ type: '_closed' }) });
  delete require.cache[require.resolve(PLUGIN_PATH)];
  require(PLUGIN_PATH);
  check('bootstrap: showUI called, a ready message posted, onmessage installed', posted.some((m) => m.type === '_showUI') && posted.some((m) => m.type === 'ready' && m.page === 'Website') && typeof uiMock.onmessage === 'function');
  await uiMock.onmessage({ type: 'export', scope: 'page' });
  const exportMsg = posted.find((m) => m.type === 'export');
  check('bootstrap: an export message carries the JSON text, a file name and stats', !!exportMsg && typeof exportMsg.text === 'string' && /\.tapuz-figma\.json$/.test(exportMsg.fileName) && exportMsg.stats.frames === 4 && exportMsg.stats.images === 4 && figma.isPluginExport(JSON.parse(exportMsg.text)));
  await uiMock.onmessage({ type: 'close' });
  check('bootstrap: close closes the plugin', posted.some((m) => m.type === '_closed'));
  delete global.figma;
  delete global.__html__;

  check('every puppet built here counts nodes', countNodes(sites) > 15 && countNodes(rest) > 15 && countNodes(live) > 8);
  console.log('SMOKE GEPPETTO-FIGMA: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('FAIL smoke threw: ' + (e && e.stack || e));
  console.log('SMOKE GEPPETTO-FIGMA: FAIL');
  process.exit(1);
});
