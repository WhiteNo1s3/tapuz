'use strict';

/**
 * Geppetto QA — the Canva decoders (src/geppetto/canva.js + font-name.js).
 *
 * Ben: "get canva sites and make them our own in BenTML … swallow it whole
 * with no salt." Before the life pass can breathe on a puppet, the decoder
 * must have carried EVERYTHING across: every text with its runs, every
 * picture with an absolute URL, links to the outside / another page / a
 * section anchor, groups flattened into section coordinates, the phone
 * layout. This gate decodes the two synthetic fixtures (one per Canva export
 * format) and checks facts built into them by hand:
 *
 *   1. detect — app / static / null for a plain page and a Figma Sites page.
 *   2. the app blob — sections from pages, the delta stream of a text, a
 *      group scaled into place, a picture with its crop, a shape with a label,
 *      a video, an embed, a photo grid, the `A = top / B = left` convention.
 *   3. the static export — desktop boxes hand-computed from the grid tracks,
 *      font sizes through var(--first-font-size), a grouped inner grid, the
 *      phone order and a phone-hidden member, links, faces, masks.
 *   4. a mixed site (app home + static contact) — links resolve across pages,
 *      a static font takes its name from the app's table.
 *   5. font-name.js on fonts BUILT IN MEMORY (TTF, WOFF, WOFF2) — no font
 *      files live in the repo.
 *
 * No network. Runs on a throwaway TAPUZ_ROOT.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-geppetto-canva-'));

const canva = require('../src/geppetto/canva');
const { familyFromFontBytes, sniffFontFormat, WOFF2_TAGS } = require('../src/geppetto/font-name');
const { validatePuppet, plainText, eachNode } = require('../src/geppetto/puppet');

const FIX = path.join(__dirname, '..', 'test', 'fixtures', 'geppetto');
const ORIGIN = 'https://example-studio.my.canva.site';
const appHtml = fs.readFileSync(path.join(FIX, 'canva-app.html'), 'utf8');
const staticHtml = fs.readFileSync(path.join(FIX, 'canva-static.html'), 'utf8');

let fail = false;
function check(name, ok, detail) {
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (ok || detail == null ? '' : '  → ' + String(detail).slice(0, 300)));
  if (!ok) fail = true;
}
const near = (a, b, tol = 0.06) => typeof a === 'number' && Math.abs(a - b) <= tol;
const t0 = Date.now();

function textNode(section, prefix) {
  let found = null;
  eachNode(section.nodes, (n) => { if (!found && n.type === 'text' && plainText(n).startsWith(prefix)) found = n; });
  return found;
}
function firstDeep(section, pred) {
  let found = null;
  eachNode(section.nodes, (n) => { if (!found && pred(n)) found = n; });
  return found;
}

// ── 1. detect ─────────────────────────────────────────────────────────────
const FIGMA_LIKE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="preload" href="/_runtimes/sites-runtime.abc123.js" as="script" crossorigin><link rel="preload" href="/_json/00000000-0000-0000-0000-000000000000/_index.json" as="fetch"></head><body><div id="container"><section>figma</section></div><script src="/_runtimes/sites-runtime.abc123.js"></script></body></html>';
check('detect: app fixture → canva-app', canva.detect(appHtml) === 'canva-app');
check('detect: static fixture → canva-static', canva.detect(staticHtml) === 'canva-static');
check('detect: plain HTML → null', canva.detect('<!DOCTYPE html><html><body><div id="root"><section>plain</section></div></body></html>') === null);
check('detect: Figma Sites page → null', canva.detect(FIGMA_LIKE) === null);
check('detect: empty / non-string → null', canva.detect('') === null && canva.detect(null) === null);

// ── 2. the app format ─────────────────────────────────────────────────────
const app = canva.decode([{ url: ORIGIN + '/', html: appHtml }]);
check('app: validatePuppet = []', validatePuppet(app).length === 0, JSON.stringify(validatePuppet(app)));
check('app: source/format/origin', app.source === 'canva' && app.format === 'canva-app' && app.origin === ORIGIN + '/');
const ap = app.pages[0];
check('app: page key = the design id, path /', ap && ap.key === 'DAFEXAMPLE01' && ap.path === '/' && ap.width === 1366);
check('app: site meta (title, lang, favicon, description)', app.site.title === 'Example Studio' && app.site.lang === 'en' && app.site.favicon === ORIGIN + '/images/favicon.png' && /synthetic/.test(app.site.description) && /&/.test(app.site.description));
check('app: 4 sections (the hidden empty page skipped)', ap.sections.length === 4, ap.sections.length);
const [s0, s1, s2, s3] = ap.sections;
check('app: section names / anchors / own heights', s0.name === 'Home' && s0.anchor === 'page-0' && s0.height === 768 && s1.height === 900 && s2.anchor === 'page-2' && s2.name === 'Works' && s3.name === 'Contact' && s0.title === 'Example Studio - Home');
check('app: hero fill (color + largest image + opacity from transparency + role)', s0.fill.color === '#f4efe6' && s0.fill.image && s0.fill.image.src === ORIGIN + '/_assets/media/hero-2x.jpg' && near(s0.fill.image.opacity, 0.6) && s0.role === 'hero');
const title = textNode(s0, 'Welcome');
const r0 = title && title.paragraphs[0].runs[0];
check('app: title run size / color / font / bold + role hint', r0 && title.role === 'title' && title.paragraphs[0].align === 'center' && r0.size === 64 && r0.color === '#1d2b3a' && r0.font === 'YAFONT0001-0' && r0.bold === true && near(title.paragraphs[0].lineHeight, 1.2));
check('app: element box reads A as top and B as left', title && near(title.x, 183) && near(title.y, 200) && near(title.w, 1000) && near(title.h, 96), title && [title.x, title.y, title.w, title.h].join(','));
check('app: font table → puppet.fonts (family, weights, italic)', app.fonts['YAFONT0001-0'] && app.fonts['YAFONT0001-0'].family === 'Example Serif' && app.fonts['YAFONT0001-0'].weights.join() === '400,700' && app.fonts['YAFONT0002-0'].italic === true);
const para = textNode(s0, 'We design');
const pr = para ? para.paragraphs[0].runs : [];
check('app: delta stream → runs (a color change mid-text)', pr.length === 5 && pr[0].text === 'We design calm brands' && pr[0].color === '#333333' && pr[1].text === '.' && pr[1].color === '#c0392b' && pr[2].text === ' ', JSON.stringify(pr));
check('app: run link to #page-1 with underline → run.anchor', pr[3] && pr[3].text === 'Read our story here' && pr[3].href === '#page-1' && pr[3].anchor === 'page-1' && pr[3].underline === true && pr[4].text === '.');
check('app: paragraph leading → lineHeight', para && near(para.paragraphs[0].lineHeight, 1.4));
const group = s0.nodes.find((n) => n.type === 'group');
const gk = group ? group.children : [];
check('app: group flattened — box kept, children scaled ×0.5 into section coordinates', group && near(group.x, 583) && near(group.y, 500) && gk.length === 2 && gk[0].type === 'shape' && gk[0].fill.color === '#1d2b3a' && near(gk[0].x, 583) && near(gk[0].w, 200) && near(gk[0].h, 60) && gk[1].type === 'text' && near(gk[1].x, 603) && near(gk[1].y, 515) && near(gk[1].w, 160) && near(gk[1].h, 30), JSON.stringify(gk.map((c) => [c.type, c.x, c.y, c.w, c.h])));
check('app: a font size inside a scaled group scales too (32 → 16)', gk[1] && gk[1].paragraphs[0].runs[0].size === 16);
check('app: element link to another page of the site', group && group.link && group.link.href === ORIGIN + '/contact');
const img = s0.nodes.find((n) => n.type === 'image');
check('app: picture — absolute URL of the largest quality, natural size, crop, hint', img && img.src === ORIGIN + '/_assets/media/photo1-2x.jpg' && img.natural.w === 1600 && img.crop && near(img.crop.left, 0.125) && near(img.crop.width, 0.75) && near(img.crop.top, 0) && img.hint === 'photo' && !img.alt, JSON.stringify(img));
const btn = s0.nodes.find((n) => n.type === 'shape' && n.children);
check('app: shape with text inside = button (fill, label, link on the run)', btn && btn.shape === 'rect' && btn.fill.color === '#c0392b' && btn.role === 'button' && plainText(btn.children[0]) === 'See works' && btn.children[0].paragraphs[0].runs[0].href === '#page-2' && btn.children[0].valign === 'middle');
check('app: shape corner radius scaled out of the viewBox (8 × 80/64)', btn && near(btn.radius, 10));
check('app: #page-N link resolves to the section anchor', btn && btn.link && btn.link.anchor === 'page-2' && ap.sections.find((s) => s.anchor === btn.link.anchor).name === 'Works');
const line = s0.nodes.find((n) => n.type === 'line');
check('app: line (color, stroke width, length)', line && line.color === '#1d2b3a' && line.width === 2 && near(line.w, 400));
check('app: paint order = array order = z', s0.nodes.every((n, i) => n.z === i));
const heading = textNode(s1, 'About us');
check('app: heading role from the hint', heading && heading.role === 'heading' && heading.hint === 'heading1');
const list = textNode(s1, 'Services');
check('app: list markers → bullet paragraphs', list && list.paragraphs.length === 3 && list.paragraphs[0].list === null && list.paragraphs[1].list === 'bullet' && list.paragraphs[2].list === 'bullet' && plainText(list) === 'Services\nBranding\nWeb design', list && JSON.stringify(list.paragraphs.map((p) => p.list)));
const circle = s1.nodes.find((n) => n.type === 'image' && n.mask === 'circle');
check('app: a picture in a circle frame → image with mask circle', circle && circle.src === ORIGIN + '/_assets/media/photo2-2x.jpg' && near(circle.x, 700) && near(circle.y, 100) && near(circle.w, 400));
const icon = s1.nodes.find((n) => n.type === 'image' && n.svg);
check('app: vector icon — svg, recolor map, opacity = 1 − F, rotation', icon && icon.src === ORIGIN + '/_assets/media/icon.svg' && icon.recolor && icon.recolor['#000000'] === '#c0392b' && near(icon.opacity, 0.75) && icon.rotate === 15 && icon.hint === 'icon');
const vid = s1.nodes.find((n) => n.type === 'video');
check('app: video (largest mp4, poster, autoplay/loop/muted)', vid && vid.src === ORIGIN + '/_assets/video/v1-720.mp4' && vid.poster === ORIGIN + '/_assets/video/v1-poster.jpg' && vid.autoplay && vid.loop && vid.muted);
const emb = s1.nodes.find((n) => n.type === 'embed');
check('app: embed (url, iframe html, provider title, natural size)', emb && emb.url === 'https://example.com/embed' && /<iframe/.test(emb.html) && emb.provider === 'Example Embed' && emb.natural.w === 600);
const frame = s1.nodes.find((n) => n.type === 'frame');
check('app: photo grid → frame with two image cells laid out', frame && frame.layout.mode === 'grid' && frame.layout.columns === 2 && frame.children.length === 2 && near(frame.children[0].x, 100) && near(frame.children[0].w, 300) && near(frame.children[1].x, 410) && frame.children[1].src === ORIGIN + '/_assets/media/grid2-2x.jpg', frame && JSON.stringify(frame.children.map((c) => [c.x, c.w])));
const ext = s2.nodes.find((n) => n.type === 'image');
check('app: outside link stays plain (no page, no anchor)', ext && ext.link && ext.link.href === 'https://example.org/gallery' && !ext.link.page && !ext.link.anchor);
const echo = s2.nodes.find((n) => n.effect);
check('app: text effect → effect: hollow', echo && echo.effect === 'hollow' && plainText(echo) === 'ECHO');
const cafe = s3.nodes.find((n) => n.type === 'text');
const expectedCafe = 'Caf' + String.fromCharCode(233) + ' ' + String.fromCharCode(0x5e9, 0x5dc, 0x5d5, 0x5dd);
check('app: \\xNN and \\uXXXX escapes inside the blob decode', cafe && plainText(cafe).startsWith(expectedCafe), cafe && plainText(cafe));
check('app: hidden empty page noted for the owner (Hebrew)', app.notes.some((n) => /S=true/.test(n) && /[֐-׿]/.test(n)), JSON.stringify(app.notes));
check('app: palette leads with the brand pair', app.palette[0] === '#f4efe6' && app.palette[1] === '#1d2b3a');
check('app: pageLinks → the other page, never the outside link', JSON.stringify(canva.pageLinks(appHtml, ORIGIN + '/')) === JSON.stringify([ORIGIN + '/contact']), JSON.stringify(canva.pageLinks(appHtml, ORIGIN + '/')));
check('app: fontFaces = [] (the blob names its fonts)', canva.fontFaces(appHtml, ORIGIN + '/').length === 0);

// ── 3. the static format ──────────────────────────────────────────────────
const st = canva.decode([{ url: ORIGIN + '/contact', html: staticHtml }], { fontNames: { 'YAEXAMPLE1-0': 'Example Serif', 'YAFONT0002-0': 'Example Sans' } });
check('static: validatePuppet = []', validatePuppet(st).length === 0, JSON.stringify(validatePuppet(st)));
const sp = st.pages[0];
check('static: page key = design id, path /contact, og image', sp && sp.key === 'DAFEXAMPLE02' && sp.path === '/contact' && st.site.socialImage === ORIGIN + '/contact/social-card.png');
check('static: 3 sections', sp.sections.length === 3, sp.sections.length);
const [t1, t2, t3] = sp.sections;
check('static: anchors — the section id, the preceding <a id>, a named id', t1.anchor === 'page-1' && t2.anchor === 'page-2' && t3.anchor === 'contact' && t3.name === 'contact' && !t2.name);
check('static: section height = the grid rows (768 px)', near(t1.height, 768, 0.1) && near(t2.height, 768, 0.1) && near(t3.height, 768, 0.1), [t1.height, t2.height, t3.height].join());
check('static: backdrop color + image (+ nested color, older generation)', t1.fill.color === '#f4efe6' && t1.fill.image && t1.fill.image.src === ORIGIN + '/images/hero-bg.jpg' && near(t1.fill.image.opacity, 0.5) && t2.fill.color === '#ffffff' && t3.fill.color === '#1d2b3a');
const h1 = textNode(t1, 'Example Static Studio');
check('static: heading desktop box hand-computed from the tracks (273.2, 136.6, 819.6 × 109.28)', h1 && near(h1.x, 273.2) && near(h1.y, 136.6) && near(h1.w, 819.6) && near(h1.h, 109.28), h1 && [h1.x, h1.y, h1.w, h1.h].join(','));
const hr = h1 && h1.paragraphs[0].runs[0];
check('static: heading run — 3.5em → 47.81 px, color, font key, bold, letter-spacing, align, line-height', hr && near(hr.size, 47.81) && hr.color === '#1d2b3a' && hr.font === 'YAEXAMPLE1-0' && hr.bold === true && near(hr.letterSpacing, -0.02) && h1.paragraphs[0].align === 'center' && near(h1.paragraphs[0].lineHeight, 1.2), JSON.stringify(hr));
check('static: fonts named through opts.fontNames, canonical weights, real italic', st.fonts['YAEXAMPLE1-0'].family === 'Example Serif' && st.fonts['YAEXAMPLE1-0'].weights.join() === '400,700' && st.fonts['YAEXAMPLE1-0'].italic === false && st.fonts['YAFONT0002-0'].family === 'Example Sans' && st.fonts['YAFONT0002-0'].italic === true, JSON.stringify(st.fonts));
const p2 = textNode(t1, 'We make');
check('static: <br> splits paragraphs; var(--first-font-size) resolves (1.5em → 20.49)', p2 && p2.paragraphs.length === 2 && near(p2.paragraphs[0].runs[0].size, 20.49) && plainText(p2) === 'We make calm brands.\nBack to the works or home.', p2 && plainText(p2));
const wr = p2 ? p2.paragraphs[1].runs : [];
check('static: link runs — same-page #page-2 (anchor) with underline and color', wr.some((r) => r.text === 'works' && r.href === ORIGIN + '/contact#page-2' && r.anchor === 'page-2' && !r.page && r.underline === true && r.color === '#c0392b'), JSON.stringify(wr));
const im = t1.nodes.find((n) => n.type === 'image');
check('static: picture — largest srcset, alt, box from the tracks, height from padding-top', im && im.src === ORIGIN + '/images/hero.jpg' && im.alt === 'Studio desk' && near(im.x, 273.2) && near(im.y, 655.68) && near(im.w, 819.6) && near(im.h, 409.8) && im.fit === 'cover', im && JSON.stringify(im));
check('static: phone layout — order by phone row (picture first) and phone px', im && im.mobile && im.mobile.order === 1 && h1.mobile.order === 2 && p2.mobile.order === 3 && near(im.mobile.x, 15) && near(im.mobile.y, 22.5) && near(im.mobile.w, 345), JSON.stringify([im && im.mobile, h1 && h1.mobile, p2 && p2.mobile]));
const sbtn = t1.nodes.find((n) => n.type === 'shape' && n.children);
check('static: svg + label in one wrapper = button with the wrapper link', sbtn && sbtn.shape === 'rect' && sbtn.fill.color === '#c0392b' && sbtn.role === 'button' && sbtn.link.href === ORIGIN + '/works-list' && plainText(sbtn.children[0]) === 'Contact us' && sbtn.children[0].paragraphs[0].runs[0].bold === true, sbtn && JSON.stringify(sbtn).slice(0, 300));
check('static: margin-left 70% moves and narrows the box; padding-top gives the height', sbtn && near(sbtn.x, 846.92) && near(sbtn.w, 245.88) && near(sbtn.h, 49.18), sbtn && [sbtn.x, sbtn.w, sbtn.h].join(','));
check('static: z from z-index → paint order', t1.nodes.map((n) => n.id).join() === 'w3,w1,w2,w4', t1.nodes.map((n) => n.id).join());
const grp = t2.nodes.find((n) => n.type === 'group');
const gc = grp ? grp.children : [];
check('static: a Canva group = an inner grid; members land in section coordinates', grp && near(grp.x, 136.6) && near(grp.y, 68.3) && near(grp.w, 1092.8) && gc.length === 2 && gc[0].type === 'shape' && gc[0].fill.color === '#e8e0d2' && near(gc[0].x, 136.6) && near(gc[0].w, 1092.8) && gc[1].type === 'text' && near(gc[1].x, 546.4) && near(gc[1].y, 204.9) && near(gc[1].w, 683) && near(gc[1].paragraphs[0].runs[0].size, 20.49), JSON.stringify(gc.map((c) => [c.type, c.x, c.y, c.w, c.h])));
check('static: group members carry the phone layout too', gc[1] && gc[1].mobile && near(gc[1].mobile.x, 15 + 112.5) && gc[1].mobile.order === 2, gc[1] && JSON.stringify(gc[1].mobile));
const ul = textNode(t2, 'Branding');
check('static: <ul><li> → bullet paragraphs with the li font size (1.2em → 16.39)', ul && ul.paragraphs.length === 2 && ul.paragraphs.every((p) => p.list === 'bullet') && near(ul.paragraphs[0].runs[0].size, 16.39) && plainText(ul) === 'Branding\nWeb design', ul && JSON.stringify(ul.paragraphs));
const sv = t2.nodes.find((n) => n.type === 'video');
check('static: <video> node (absolute src, flags, aspect from padding-top)', sv && sv.src === ORIGIN + '/videos/clip.mp4' && sv.autoplay && sv.muted && sv.loop && near(sv.h, sv.w * 0.5625));
const deco = t2.nodes.find((n) => n.type === 'shape' && n.shape === 'ellipse');
check('static: a circle path → shape ellipse; phone display:none → mobile.hidden', deco && deco.fill.color === '#c0392b' && deco.mobile && deco.mobile.hidden === true, deco && JSON.stringify(deco.mobile));
const se = t3.nodes.find((n) => n.type === 'embed');
check('static: iframe.ly embed unwrapped to the real url, provider, natural size, html kept', se && se.url === 'https://example.com/flipbook' && se.provider === 'example.com' && se.natural.w === 400 && /<iframe/.test(se.html) && near(se.x, 341.5) && near(se.w, 683), se && JSON.stringify(se).slice(0, 300));
const masked = t3.nodes.find((n) => n.type === 'image' && n.mask);
check('static: foreignObject + clip-path circle → image with mask circle, alt, cover', masked && masked.mask === 'circle' && masked.alt === 'Founder portrait' && masked.fit === 'cover' && masked.src === ORIGIN + '/images/portrait.jpg', masked && JSON.stringify(masked));
const social = t3.nodes.find((n) => n.type === 'image' && n.link);
check('static: outside link in a new tab, svg picture, entrance animation (pop → rise), pulse ignored', social && social.link.href === 'https://www.example.org/profile' && social.link.newTab === true && social.svg === true && social.anim === 'rise' && social.alt === 'Social icon', social && JSON.stringify(social));
const hol = t3.nodes.find((n) => n.effect);
check('static: hollow text (text-stroke) + entities + uppercase + italic run', hol && hol.effect === 'hollow' && plainText(hol) === 'Bold & hollow' && hol.paragraphs[0].runs[0].upper === true && hol.paragraphs[0].runs.some((r) => r.italic === true) && near(hol.paragraphs[0].runs[0].size, 27.32), hol && JSON.stringify(hol.paragraphs));
check('static: pageLinks → the other pages of the site (home, works-list), not #page-2, not the outside', JSON.stringify(canva.pageLinks(staticHtml, ORIGIN + '/contact')) === JSON.stringify([ORIGIN + '/', ORIGIN + '/works-list']), JSON.stringify(canva.pageLinks(staticHtml, ORIGIN + '/contact')));
const faces = canva.fontFaces(staticHtml, ORIGIN + '/contact');
const serifFaces = faces.filter((f) => f.key === 'YAEXAMPLE1-0');
check('static: fontFaces — one face per file with its canonical weight/style, absolute urls', faces.length === 4 && serifFaces.map((f) => f.weight).sort().join() === '400,700' && serifFaces.every((f) => f.style === 'normal') && faces.some((f) => f.key === 'YAFONT0002-0' && f.style === 'italic' && f.weight === 400) && faces.every((f) => f.url.startsWith(ORIGIN + '/fonts/')), JSON.stringify(faces));
check('static: no "unnamed fonts" note once names are given', !st.notes.some((n) => /font-name/.test(n)), JSON.stringify(st.notes));

// ── 4. a mixed site: the app home + the static contact page ────────────────
const both = canva.decode([{ url: ORIGIN + '/', html: appHtml }, { url: ORIGIN + '/contact', html: staticHtml }]);
check('mixed: validatePuppet = []', validatePuppet(both).length === 0, JSON.stringify(validatePuppet(both)));
check('mixed: two pages with distinct keys, format of the first page', both.pages.length === 2 && both.pages[0].key === 'DAFEXAMPLE01' && both.pages[1].key === 'DAFEXAMPLE02' && both.format === 'canva-app');
const g2 = both.pages[0].sections[0].nodes.find((n) => n.type === 'group');
check('mixed: the app link to /contact → link.page = the static page key', g2 && g2.link && g2.link.page === 'DAFEXAMPLE02');
let homeRun = null;
eachNode(both.pages[1].sections[0].nodes, (n) => { for (const p of n.paragraphs || []) for (const r of p.runs) if (r.text === 'home') homeRun = r; });
check('mixed: the static run link to / → run.page = the app page key', homeRun && homeRun.page === 'DAFEXAMPLE01', JSON.stringify(homeRun));
let worksRun = null;
eachNode(both.pages[1].sections[0].nodes, (n) => { for (const p of n.paragraphs || []) for (const r of p.runs) if (r.text === 'works') worksRun = r; });
check('mixed: a same-page anchor run stays an anchor (no page hop)', worksRun && !worksRun.page && worksRun.anchor === 'page-2' && worksRun.href === ORIGIN + '/contact#page-2', JSON.stringify(worksRun));
check('mixed: the static font id shared with the app takes its family from the app table', both.fonts['YAFONT0002-0'].family === 'Example Sans' && both.fonts['YAEXAMPLE1-0'].family === '', JSON.stringify(both.fonts));
check('mixed: Hebrew note tells the owner the site is mixed; unnamed font noted', both.notes.some((n) => /מעורב/.test(n) && /\/contact/.test(n)) && both.notes.some((n) => /YAEXAMPLE1-0/.test(n)), JSON.stringify(both.notes));

// ── 5. font-name.js on fonts built in memory ──────────────────────────────
function nameTable(records) {
  const strings = [];
  let offset = 0;
  const recs = records.map((r) => {
    const bytes = r.platform === 1 ? Buffer.from(r.text, 'latin1') : Buffer.from(r.text, 'utf16le').swap16();
    const rec = Object.assign({}, r, { length: bytes.length, offset });
    strings.push(bytes);
    offset += bytes.length;
    return rec;
  });
  const head = Buffer.alloc(6);
  head.writeUInt16BE(0, 0);
  head.writeUInt16BE(recs.length, 2);
  head.writeUInt16BE(6 + recs.length * 12, 4);
  const body = Buffer.concat(recs.map((r) => {
    const b = Buffer.alloc(12);
    b.writeUInt16BE(r.platform, 0); b.writeUInt16BE(r.encoding, 2); b.writeUInt16BE(r.language, 4);
    b.writeUInt16BE(r.nameID, 6); b.writeUInt16BE(r.length, 8); b.writeUInt16BE(r.offset, 10);
    return b;
  }));
  return Buffer.concat([head, body, ...strings]);
}
const pad4 = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);
function buildTtf(tables) {
  const dir = Buffer.alloc(12 + 16 * tables.length);
  dir.writeUInt32BE(0x00010000, 0);
  dir.writeUInt16BE(tables.length, 4);
  let offset = dir.length;
  const datas = [];
  tables.forEach((t, i) => {
    const at = 12 + i * 16;
    dir.write(t.tag, at, 4, 'latin1');
    dir.writeUInt32BE(0, at + 4);
    dir.writeUInt32BE(offset, at + 8);
    dir.writeUInt32BE(t.data.length, at + 12);
    const p = pad4(t.data);
    datas.push(p);
    offset += p.length;
  });
  return Buffer.concat([dir, ...datas]);
}
function buildWoff(tables) {
  const header = Buffer.alloc(44);
  header.write('wOFF', 0, 4, 'latin1');
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt16BE(tables.length, 12);
  let offset = 44 + 20 * tables.length;
  const entries = [];
  const datas = [];
  for (const t of tables) {
    const comp = zlib.deflateSync(t.data);
    const use = comp.length < t.data.length ? comp : t.data;
    const e = Buffer.alloc(20);
    e.write(t.tag, 0, 4, 'latin1');
    e.writeUInt32BE(offset, 4);
    e.writeUInt32BE(use.length, 8);
    e.writeUInt32BE(t.data.length, 12);
    e.writeUInt32BE(0, 16);
    entries.push(e);
    const p = pad4(use);
    datas.push(p);
    offset += p.length;
  }
  header.writeUInt32BE(offset, 8);
  return Buffer.concat([header, ...entries, ...datas]);
}
function base128(n) {
  const bytes = [];
  do { bytes.unshift(n & 0x7f); n = Math.floor(n / 128); } while (n > 0);
  return Buffer.from(bytes.map((b, i) => (i < bytes.length - 1 ? b | 0x80 : b)));
}
function buildWoff2(tables) {
  const header = Buffer.alloc(48);
  header.write('wOF2', 0, 4, 'latin1');
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt16BE(tables.length, 12);
  const dir = [];
  for (const t of tables) {
    const known = WOFF2_TAGS.indexOf(t.tag);
    // transform version 0 on a non-glyf/loca table = the null transform: no transformLength follows
    if (known >= 0) dir.push(Buffer.from([known]));
    else dir.push(Buffer.from([63]), Buffer.from(t.tag, 'latin1'));
    dir.push(base128(t.data.length));
  }
  const stream = zlib.brotliCompressSync(Buffer.concat(tables.map((t) => t.data)));
  const dirBuf = Buffer.concat(dir);
  header.writeUInt32BE(48 + dirBuf.length + stream.length, 8);
  header.writeUInt32BE(stream.length, 20);
  return Buffer.concat([header, dirBuf, stream]);
}
const nameRecords = [
  { platform: 1, encoding: 0, language: 0, nameID: 1, text: 'Example Sans Mac' },
  { platform: 3, encoding: 1, language: 0x409, nameID: 1, text: 'Example Sans Bold' },
  { platform: 3, encoding: 1, language: 0x409, nameID: 16, text: 'Example Sans' },
  { platform: 3, encoding: 1, language: 0x409, nameID: 2, text: 'Bold' }
];
const tables = [
  { tag: 'head', data: Buffer.alloc(54) },
  { tag: 'zzzz', data: Buffer.from('private table') },
  { tag: 'name', data: nameTable(nameRecords) }
];
const ttf = buildTtf(tables);
const woff = buildWoff(tables);
const woff2 = buildWoff2(tables);
check('font-name: sniffFontFormat on the three builds', sniffFontFormat(ttf) === 'ttf' && sniffFontFormat(woff) === 'woff' && sniffFontFormat(woff2) === 'woff2');
check('font-name: TTF → typographic family (nameID 16 over 1)', familyFromFontBytes(ttf) === 'Example Sans', familyFromFontBytes(ttf));
check('font-name: WOFF (zlib per table) → Example Sans', familyFromFontBytes(woff) === 'Example Sans', familyFromFontBytes(woff));
check('font-name: WOFF2 (one brotli stream, known + custom tags) → Example Sans', familyFromFontBytes(woff2) === 'Example Sans', familyFromFontBytes(woff2));
const otto = Buffer.from(ttf);
otto.write('OTTO', 0, 4, 'latin1');
check('font-name: OTF (OTTO) container reads the same table', sniffFontFormat(otto) === 'otf' && familyFromFontBytes(otto) === 'Example Sans');
const macOnly = buildWoff2([{ tag: 'name', data: nameTable([{ platform: 1, encoding: 0, language: 0, nameID: 1, text: 'Example Mac' }]) }]);
check('font-name: a Mac-only name table falls back to nameID 1 / platform 1', familyFromFontBytes(macOnly) === 'Example Mac', familyFromFontBytes(macOnly));
check('font-name: garbage, empty, null, a huge buffer → null and never throws', familyFromFontBytes(Buffer.from('hello world')) === null && familyFromFontBytes(Buffer.alloc(0)) === null && familyFromFontBytes(null) === null && familyFromFontBytes(Buffer.alloc(4 * 1024 * 1024, 1)) === null);
const truncated = woff2.subarray(0, 60);
check('font-name: a truncated WOFF2 → null (no throw)', familyFromFontBytes(truncated) === null);

check('smoke runs in < 2 s', Date.now() - t0 < 2000, (Date.now() - t0) + 'ms');

try { fs.rmSync(process.env.TAPUZ_ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
console.log('');
console.log(fail ? 'SMOKE GEPPETTO-CANVA: FAIL' : 'SMOKE GEPPETTO-CANVA: PASS');
process.exit(fail ? 1 : 0);
