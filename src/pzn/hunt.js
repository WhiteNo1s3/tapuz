'use strict';

/**
 * The structure hunt (v0.66) — decompiler V2, rebuilt from the grok-lab
 * hunter against the Tapuz block model.
 *
 * The flat walk (graduate.js) reads a page as a stream: heading, text, image…
 * Real pages are not text-photo-text — they are halves and quarters, heroes,
 * card walls, repeated chrome. The hunt reads the SHAPE:
 *   - row/grid wrappers with 2–4 column children → a `columns` block with a
 *     PERCENTAGE cut ("67:33") the admin can drag in the builder
 *   - hero-classed sections that look like a hero → one `hero` block
 *     (role-collapse: a hero inside a hero is just markup, not two heroes)
 *   - responsive twins (the same heading/nav rendered for desktop AND mobile)
 *     → deduped to one block per container level
 *   - card clusters, forms, navs, videos → the same first-class modules the
 *     flat walk maps (shared parsers), so nothing regresses
 *
 * The hunt is one strategy in a SET — decompile.js runs flat + hunt on the
 * same HTML and a quality scorer picks the winner, so a page the hunt reads
 * badly still ships with the flat map (the safety guard).
 */

const { tokenize } = require('./language/parse');
const { unescapeHtml } = require('./language/escape');
const {
  parseFormFields,
  parseNavItems,
  parseVideoData,
  detectCardCluster,
  collectLinkRun,
  coalesceButtonRuns,
  navItemsFromList,
  anchorCard,
  attrOf,
  LINK_RUN_MIN,
  LINK_LABEL_MAX,
  imageSrcOf,
  classBgMap,
  bgOfAttrs,
  childSpans,
  matchClose,
  textOf,
  tokenToHtml,
  HEADING,
  CONTAINERS,
  INLINE,
  parseAudioData,
  parseTableData,
  parseDetailsRun,
  parseStepsData,
  parseTimelineData,
  mapsAddressOf
} = require('./graduate');

// ─── role inference (the lab's naming.js, trimmed to what Tapuz maps) ───

const ROLE_FROM_CLASS = [
  [/hero|banner|jumbotron|masthead|splash/i, 'hero'],
  [/sidebar|aside|\brail\b/i, 'sidebar'],
  [/footer|site-footer|page-footer/i, 'footer'],
  [/header|site-header|page-header|topbar|navbar|nav-bar/i, 'header'],
  [/\bnav\b|menu|menubar/i, 'nav'],
  [/gallery|carousel|slider|swiper/i, 'gallery'],
  [/\brow\b|grid|columns|\bcols?\b|flex-row|split|two-col|three-col/i, 'row'],
  [/\bsteps?\b|process|how-it-works|workflow|stepper/i, 'steps'],
  [/timeline|milestones?|chrono/i, 'timeline'],
  [/main|content|primary|article-body|post-content/i, 'main'],
  [/card|tile|teaser|cube/i, 'card'],
  [/cta|call-to-action|promo/i, 'cta']
];

const ROLE_FROM_TAG = {
  header: 'header', nav: 'nav', main: 'main', aside: 'sidebar',
  footer: 'footer', article: 'article', section: 'section'
};

/** Semantic role from tag + class + id. Landmarks feed the report. */
function inferRole(t) {
  const hay = `${(t.attrs && t.attrs.class) || ''} ${(t.attrs && t.attrs.id) || ''}`;
  for (const [re, role] of ROLE_FROM_CLASS) {
    if (re.test(hay)) return role;
  }
  return ROLE_FROM_TAG[t.name] || 'block';
}

// ─── column width inference (the percentage cut) ────────────────────────

/**
 * How wide does this wrapper WANT to be? Reads bootstrap-style col-N classes
 * (N of 12) and inline width/flex-basis percentages. null = no opinion.
 */
function colWeight(t) {
  const cls = String((t.attrs && t.attrs.class) || '');
  const m = /(?:^|\s)col(?:-[a-z]{2,3})?-(\d{1,2})(?:\s|$)/i.exec(cls);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 12) return n / 12;
  }
  const style = String((t.attrs && t.attrs.style) || '');
  const w = /(?:^|;)\s*(?:width|flex-basis)\s*:\s*(\d{1,2}(?:\.\d+)?)%/i.exec(style);
  if (w) {
    const p = Number(w[1]);
    if (p >= 5 && p <= 95) return p / 100;
  }
  return null;
}

/** Weights → integer percentages that always sum to exactly 100. */
function toPercentages(weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const pcts = weights.map((w) => Math.max(5, Math.round((w / sum) * 100)));
  // rounding drift lands on the widest column so 33/33/33 becomes 33:33:34
  const drift = 100 - pcts.reduce((a, b) => a + b, 0);
  pcts[pcts.indexOf(Math.max(...pcts))] += drift;
  return pcts;
}

// ─── hero shape test ─────────────────────────────────────────────────────

/**
 * A hero is a SLOT layout (title, subtitle, one CTA, a background) — not a
 * whole page that happens to carry a hero class. Counting keeps stripe's
 * five-deep hero-in-hero markup from eating the page: the huge outer
 * wrappers fail the shape test and simply descend; one true hero remains.
 */
function heroShape(tokens, i, end) {
  let headings = 0, paragraphs = 0, links = 0, images = 0, textLen = 0;
  for (let j = i + 1; j < end - 1; j++) {
    const tk = tokens[j];
    if (tk.kind === 'text') { textLen += tk.value.trim().length; continue; }
    if (tk.kind !== 'open') continue;
    if (HEADING.test(tk.name)) headings++;
    else if (tk.name === 'p') paragraphs++;
    else if (tk.name === 'a' || tk.name === 'button') links++;
    else if (tk.name === 'img') images++;
  }
  return headings >= 1 && headings <= 2 && paragraphs <= 2 && links <= 3 && images <= 2 && textLen <= 400;
}

/** Pull the hero slots (title/subtitle/button/image) out of a hero range. */
function extractHero(tokens, i, end, bgMap) {
  const data = {};
  for (let j = i + 1; j < end - 1; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    if (!data.title && HEADING.test(tk.name)) {
      const e = matchClose(tokens, j);
      data.title = unescapeHtml(textOf(tokens, j + 1, e - 1));
      j = e - 1;
    } else if (!data.subtitle && tk.name === 'p') {
      const e = matchClose(tokens, j);
      data.subtitle = unescapeHtml(textOf(tokens, j + 1, e - 1));
      j = e - 1;
    } else if (!data.buttonText && (tk.name === 'a' || tk.name === 'button')) {
      const e = matchClose(tokens, j);
      const label = unescapeHtml(textOf(tokens, j + 1, e - 1));
      if (label) {
        data.buttonText = label;
        data.buttonUrl = (tk.attrs && (tk.attrs.href || tk.attrs.formaction)) || '#';
      }
      j = e - 1;
    } else if (!data.image && (tk.name === 'img' || tk.name === 'source')) {
      data.image = imageSrcOf(tk.attrs);
    } else if (!data.image) {
      // hero backgrounds usually ride a CSS background-image, not an <img>
      const bg = bgOfAttrs(tk.attrs, bgMap);
      if (bg) data.image = bg;
    }
  }
  if (!data.image) {
    const bg = bgOfAttrs(tokens[i].attrs, bgMap);
    if (bg) data.image = bg;
  }
  return data.title ? data : null;
}

// ─── sibling dedupe (responsive twins) ──────────────────────────────────

/** One content key per block type — twins collapse when keys match. */
function dedupeKey(b) {
  const d = b.data || {};
  switch (b.type) {
    case 'heading': return 'h|' + d.level + '|' + (d.text || '');
    case 'text': return 't|' + (d.content || '');
    case 'image': return 'i|' + (d.src || '');
    case 'button': return 'b|' + (d.text || '') + '|' + (d.url || '');
    case 'nav': return 'n|' + JSON.stringify(d.items || []);
    case 'embed': return 'e|' + (d.url || '');
    case 'video': return 'v|' + (d.src || '');
    default: return null; // structural blocks never dedupe
  }
}

/**
 * Drop later siblings whose key matches an earlier one. Because wrappers
 * descend (are dropped), a desktop header and its mobile twin become
 * SIBLINGS here even when the source nested them apart.
 */
function dedupeSiblings(blocks) {
  const seen = new Set();
  return blocks.filter((b) => {
    const key = dedupeKey(b);
    if (key == null) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Empty content is markup residue, not a module the admin should meet. */
function isEmptyBlock(b) {
  const d = b.data || {};
  switch (b.type) {
    case 'heading': return !String(d.text || '').trim();
    case 'text': return !String(d.content || '').trim();
    case 'image': return !String(d.src || '').trim();
    case 'list': return !(d.items || []).some((it) => String(it.text || it || '').trim());
    case 'quote': return !String(d.text || '').trim();
    case 'cards': return !(d.items || []).length;
    case 'steps':
    case 'timeline': return !(d.items || []).length;
    default: return false;
  }
}

// ─── the hunt ────────────────────────────────────────────────────────────

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'template', 'canvas', 'link', 'meta']);

/**
 * @param {string} html
 * @returns {{ blocks: object[], mapped: number, leftover: number,
 *             suggestedTools: string[], roles: string[] }}
 */
function huntBlocks(html, opts = {}) {
  let uid = 0;
  const nid = (p) => `${p}-v2${++uid}`;
  const bgMap = opts.bgMap != null ? opts.bgMap : classBgMap(html);

  let tokens;
  try {
    tokens = tokenize(String(html == null ? '' : html), { lenient: true });
  } catch (e) {
    // hunt found nothing it can read — the scorer will hand the page to flat
    return { blocks: [], mapped: 0, leftover: 0, suggestedTools: [], roles: [] };
  }

  const suggested = new Set();
  const rolesSeen = new Set();
  let mapped = 0;
  let leftover = 0;

  function flushRaw(buf, sink) {
    const trimmed = buf.trim();
    if (!trimmed) return;
    if (/<[a-z]/i.test(trimmed)) {
      leftover += 1;
      sink.push({ type: 'html', id: nid('html'), data: { content: trimmed, provisional: true } });
    } else {
      sink.push({ type: 'text', id: nid('t'), data: { content: unescapeHtml(trimmed).replace(/\s+/g, ' ').trim() } });
      mapped += 1;
    }
  }

  /**
   * Row detection: direct children are all wrappers (2–4 of them), and either
   * the wrapper says row/grid or the children carry width hints. Whitespace
   * between columns is fine; any other content breaks pure-row detection.
   */
  function tryColumns(t, i, end, depth) {
    const spans = [];
    let j = i + 1;
    while (j < end - 1) {
      const tk = tokens[j];
      if (tk.kind === 'text') {
        if (tk.value.trim()) return null;
        j++;
        continue;
      }
      if (tk.kind !== 'open') { j++; continue; }
      if (!CONTAINERS.has(tk.name)) return null;
      const e = matchClose(tokens, j);
      spans.push([j, e]);
      j = e;
    }
    if (spans.length < 2 || spans.length > 4) return null;

    const weights = spans.map(([s]) => colWeight(tokens[s]));
    const rowHint = inferRole(t) === 'row';
    if (!rowHint && !weights.some((w) => w != null)) return null;

    const cols = [];
    const kept = [];
    spans.forEach(([s, e], idx) => {
      const colBlocks = walk(s + 1, e - 1, depth + 1, {});
      if (colBlocks.length) {
        cols.push({ blocks: colBlocks });
        kept.push(weights[idx] == null ? 1 : weights[idx]);
      }
    });
    if (cols.length < 2) {
      // one real column is not a split — hand its blocks back inline
      return { inline: cols.length === 1 ? cols[0].blocks : [] };
    }
    const ratio = toPercentages(kept).join(':');
    mapped += 1;
    return { block: { type: 'columns', id: nid('cols'), data: { columns: cols, gap: 'md', ratio } } };
  }

  /** @returns {object[]} blocks for this token range */
  function walk(from, to, depth, ctx) {
    const sink = [];

    // a whole range repeating the card shape → ONE cards block (v0.65 rule)
    const cluster = detectCardCluster(tokens, from, to, bgMap);
    if (cluster) {
      sink.push({ type: 'cards', id: nid('cards'), data: { items: cluster } });
      mapped += 1;
      return sink;
    }

    let raw = '';
    let i = from;
    while (i < to) {
      const t = tokens[i];
      if (t.kind === 'text') {
        if (t.value.trim()) raw += t.value;
        i++;
        continue;
      }
      if (t.kind !== 'open') { i++; continue; }

      const name = t.name;
      const end = matchClose(tokens, i);

      if (SKIP_TAGS.has(name)) { i = end; continue; }
      if (INLINE.has(name)) { raw += textOf(tokens, i, end) + ' '; i = end; continue; }

      if (raw.trim()) { flushRaw(raw, sink); raw = ''; }

      const hm = HEADING.exec(name);
      if (hm) {
        sink.push({ type: 'heading', id: nid('h'), data: { level: Number(hm[1]), text: unescapeHtml(textOf(tokens, i + 1, end - 1)) } });
        mapped += 1; i = end; continue;
      }
      if (name === 'p') {
        sink.push({ type: 'text', id: nid('t'), data: { content: unescapeHtml(textOf(tokens, i + 1, end - 1)) } });
        mapped += 1; i = end; continue;
      }
      if (name === 'blockquote' || name === 'q' || name === 'cite') {
        const qt = unescapeHtml(textOf(tokens, i + 1, end - 1));
        if (qt) { sink.push({ type: 'quote', id: nid('q'), data: { text: qt } }); mapped += 1; }
        i = end; continue;
      }
      // a bare <button> with visible text is a CTA (textless ones are chrome)
      if (name === 'button') {
        const btnLabel = unescapeHtml(textOf(tokens, i + 1, end - 1)).trim();
        if (btnLabel) {
          sink.push({ type: 'button', id: nid('b'), data: { text: btnLabel, url: (t.attrs && t.attrs.formaction) || '#' } });
          mapped += 1;
        }
        i = end; continue;
      }
      if (name === 'img') {
        const a = t.attrs || {};
        sink.push({ type: 'image', id: nid('img'), data: { src: imageSrcOf(a), alt: a.alt || '' } });
        mapped += 1; i = end; continue;
      }
      // <picture> (A++ marketing sites) → image from the inner img/source
      if (name === 'picture') {
        let src = '', alt = '';
        for (let j = i + 1; j < end - 1; j++) {
          const tk = tokens[j];
          if (tk.kind !== 'open') continue;
          if (tk.name === 'img') {
            src = imageSrcOf(tk.attrs) || src;
            alt = (tk.attrs && tk.attrs.alt) || alt;
          } else if (tk.name === 'source' && !src) {
            src = imageSrcOf(tk.attrs);
          }
        }
        if (src) {
          sink.push({ type: 'image', id: nid('img'), data: { src, alt } });
          mapped += 1;
        }
        i = end; continue;
      }
      if (name === 'a') {
        // a picture/headline teaser link IS a card — the picture survives
        const teaser = anchorCard(tokens, i, end, bgMap);
        if (teaser) {
          sink.push({ type: 'cards', id: nid('cards'), data: { items: [teaser] } });
          mapped += 1; i = end; continue;
        }
        // a run of ≥4 short bare links is a menu, not a button pile
        const run = collectLinkRun(tokens, i, to);
        if (run.items.length >= LINK_RUN_MIN) {
          sink.push({ type: 'nav', id: nid('nav'), data: { items: run.items } });
          mapped += 1; i = run.end; continue;
        }
        const href = (t.attrs && t.attrs.href) || '#';
        let label = unescapeHtml(textOf(tokens, i + 1, end - 1)).trim();
        if (!label) {
          // a textless link is an icon or a picture link — keep the picture,
          // or fall back to the aria name; never a nameless "קישור" button
          let pictured = false;
          for (let j = i + 1; j < end - 1; j++) {
            if (tokens[j].kind === 'open' && (tokens[j].name === 'img' || tokens[j].name === 'source')) {
              const src = imageSrcOf(tokens[j].attrs);
              if (src) { sink.push({ type: 'image', id: nid('img'), data: { src, alt: tokens[j].attrs.alt || '' } }); mapped += 1; pictured = true; }
              break;
            }
          }
          if (pictured) { i = end; continue; }
          label = attrOf(t.attrs, 'aria-label', 'title').trim().slice(0, LINK_LABEL_MAX);
          if (!label) { i = end; continue; }
        }
        if (/youtube\.com|youtu\.be/i.test(href)) {
          sink.push({ type: 'embed', id: nid('em'), data: { url: href } });
        } else {
          if (/wa\.me|whatsapp/i.test(href)) suggested.add('whatsapp');
          sink.push({ type: 'button', id: nid('b'), data: { text: label, url: href } });
        }
        mapped += 1; i = end; continue;
      }
      if (name === 'iframe') {
        // v2.22: a Google-Maps embed with a readable address → the map module
        const mapsAddr = mapsAddressOf((t.attrs && t.attrs.src) || '');
        if (mapsAddr) {
          sink.push({ type: 'map', id: nid('map'), data: { address: mapsAddr } });
        } else {
          sink.push({ type: 'embed', id: nid('em'), data: { url: (t.attrs && t.attrs.src) || '' } });
        }
        mapped += 1; i = end; continue;
      }
      if (name === 'hr') { sink.push({ type: 'divider', id: nid('d'), data: {} }); mapped += 1; i = end; continue; }
      if (name === 'ul' || name === 'ol') {
        const liCluster = detectCardCluster(tokens, i + 1, end - 1, bgMap);
        if (liCluster) {
          sink.push({ type: 'cards', id: nid('cards'), data: { items: liCluster } });
          mapped += 1; i = end; continue;
        }
        // a ul of single short links is a menu — keep the hrefs (v0.67)
        const menu = navItemsFromList(tokens, i, end);
        if (menu) {
          sink.push({ type: 'nav', id: nid('nav'), data: { items: menu } });
          mapped += 1; i = end; continue;
        }
        const stepData = parseStepsData(tokens, i, end, t);
        if (stepData) {
          sink.push({ type: 'steps', id: nid('steps'), data: stepData });
          mapped += 1; i = end; continue;
        }
        const tlData = parseTimelineData(tokens, i, end, t);
        if (tlData) {
          sink.push({ type: 'timeline', id: nid('tl'), data: tlData });
          mapped += 1; i = end; continue;
        }
        const items = [];
        for (let j = i + 1; j < end - 1; j++) {
          if (tokens[j].kind === 'open' && tokens[j].name === 'li') {
            const liEnd = matchClose(tokens, j);
            items.push({ text: unescapeHtml(textOf(tokens, j + 1, liEnd - 1)) });
            j = liEnd - 1;
          }
        }
        if (items.some((it) => it.text.trim())) {
          sink.push({ type: 'list', id: nid('list'), data: { ordered: name === 'ol', items } });
          mapped += 1;
        }
        i = end; continue;
      }
      if (name === 'dl') {
        const tlData = parseTimelineData(tokens, i, end, t);
        if (tlData) {
          sink.push({ type: 'timeline', id: nid('tl'), data: tlData });
          mapped += 1; i = end; continue;
        }
        suggested.add('timeline');
        let frag = '';
        for (let j = i; j < end; j++) frag += tokenToHtml(tokens[j]);
        raw += frag;
        i = end; continue;
      }
      if (name === 'form') {
        const fields = parseFormFields(tokens, i, end);
        if (fields.length) {
          const method = /get/i.test((t.attrs && t.attrs.method) || '') ? 'get' : 'post';
          sink.push({ type: 'form', id: nid('form'), data: { action: (t.attrs && t.attrs.action) || '', method, submit: 'שליחה', fields } });
          mapped += 1;
        } else {
          let frag = '';
          for (let j = i; j < end; j++) frag += tokenToHtml(tokens[j]);
          raw += frag;
        }
        i = end; continue;
      }
      if (name === 'nav') {
        rolesSeen.add('nav');
        const items = parseNavItems(tokens, i, end);
        if (items.length) {
          sink.push({ type: 'nav', id: nid('nav'), data: { items } });
          mapped += 1;
        }
        i = end; continue;
      }
      if (name === 'video') {
        const data = parseVideoData(tokens, i, end, t);
        if (data) {
          sink.push({ type: 'video', id: nid('video'), data });
          mapped += 1;
        } else {
          let frag = '';
          for (let j = i; j < end; j++) frag += tokenToHtml(tokens[j]);
          raw += frag;
        }
        i = end; continue;
      }
      // v2.22: the decompiler caught up to its own language — table, audio
      // and details-runs map to their modules; only sources too rich for the
      // module fall back to verbatim HTML (+ the gap report for table/audio).
      if (name === 'table') {
        const tblData = parseTableData(tokens, i, end);
        if (tblData) {
          sink.push({ type: 'table', id: nid('tbl'), data: tblData });
          mapped += 1; i = end; continue;
        }
        suggested.add('table');
        let frag = '';
        for (let j = i; j < end; j++) frag += tokenToHtml(tokens[j]);
        raw += frag;
        i = end; continue;
      }
      if (name === 'audio') {
        const auData = parseAudioData(tokens, i, end, t);
        if (auData) {
          sink.push({ type: 'audio', id: nid('au'), data: auData });
          mapped += 1; i = end; continue;
        }
        suggested.add('audio');
        let frag = '';
        for (let j = i; j < end; j++) frag += tokenToHtml(tokens[j]);
        raw += frag;
        i = end; continue;
      }
      if (name === 'details') {
        const run = parseDetailsRun(tokens, i, tokens.length);
        if (run) {
          sink.push({ type: 'accordion', id: nid('acc'), data: { items: run.items } });
          mapped += 1; i = run.next; continue;
        }
        let frag = '';
        for (let j = i; j < end; j++) frag += tokenToHtml(tokens[j]);
        raw += frag;
        i = end; continue;
      }

      if (CONTAINERS.has(name)) {
        const role = inferRole(t);
        if (role !== 'block') rolesSeen.add(role);

        // the percentage cut: a row of 2–4 columns → one columns block
        const colTry = tryColumns(t, i, end, depth);
        if (colTry) {
          if (colTry.block) sink.push(colTry.block);
          else if (colTry.inline) colTry.inline.forEach((b) => sink.push(b));
          i = end; continue;
        }

        const stepData = parseStepsData(tokens, i, end, t);
        if (stepData) {
          sink.push({ type: 'steps', id: nid('steps'), data: stepData });
          mapped += 1; i = end; continue;
        }
        const tlData = parseTimelineData(tokens, i, end, t);
        if (tlData) {
          sink.push({ type: 'timeline', id: nid('tl'), data: tlData });
          mapped += 1; i = end; continue;
        }

        // hero role + hero shape → one hero block (role-collapse via ctx)
        if (role === 'hero' && !ctx.inHero && heroShape(tokens, i, end)) {
          const data = extractHero(tokens, i, end, bgMap);
          if (data) {
            sink.push({ type: 'hero', id: nid('hero'), data });
            mapped += 1;
            i = end; continue;
          }
        }

        // every other wrapper descends — structure comes from columns/cards/
        // hero, never from empty grouping shells
        const childCtx = role === 'hero' ? { ...ctx, inHero: true } : ctx;
        const kids = walk(i + 1, end - 1, depth + 1, childCtx);
        kids.forEach((b) => sink.push(b));
        // an empty wrapper whose CSS carries a background IS a picture
        if (!kids.length) {
          const bg = bgOfAttrs(t.attrs, bgMap);
          if (bg) { sink.push({ type: 'image', id: nid('img'), data: { src: bg, alt: '' } }); mapped += 1; }
        }
        i = end; continue;
      }

      // custom elements / SPA shells (devsite-*, react-*) — walk children,
      // never report framework tag names as toolGap
      if (name.includes('-')) {
        walk(i + 1, end - 1, depth + 1, ctx).forEach((b) => sink.push(b));
        i = end; continue;
      }

      // unmappable element → keep verbatim as leftover raw HTML
      let frag = '';
      for (let j = i; j < end; j++) frag += tokenToHtml(tokens[j]);
      raw += frag;
      i = end;
    }
    if (raw.trim()) flushRaw(raw, sink);

    return coalesceButtonRuns(dedupeSiblings(sink.filter((b) => !isEmptyBlock(b))));
  }

  const blocks = walk(0, tokens.length, 0, {});
  return { blocks, mapped, leftover, suggestedTools: [...suggested], roles: [...rolesSeen] };
}

module.exports = { huntBlocks, inferRole, colWeight, toPercentages };
