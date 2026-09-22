'use strict';

/**
 * Geppetto — the life pass. A puppet (src/geppetto/puppet.js: boxes at
 * coordinates, runs of styled text, pictures behind pictures) becomes
 * Tapuziel pages made of REAL modules.
 *
 * Ben: "they are imported nonsense, we make a life in them, like Pinocchio
 * and Geppetto." A Canva website is a stack of canvases where every word
 * sits at an x/y; a Figma site is frames inside frames. Copying that as-is
 * would give the owner a picture of a site — nothing to edit, nothing that
 * reflows on a phone, no menu, no SEO. This pass reads the DESIGN INTENT
 * out of the geometry instead:
 *
 *   - a section's background (a photo under everything, a colored slab,
 *     a dark veil over the photo) becomes the section's own fill — a full-
 *     width SECTION or BACKDROP, never a positioned picture;
 *   - boxes side by side become a ROW with the designer's own ratio, boxes
 *     one under another become the column's flow (recursive XY-cut, the
 *     classic document-layout analysis); Figma's auto-layout is read
 *     directly (row / column / grid are already intent);
 *   - a pill with a word on it is a BUTTON, a photo+title+text repeated in a
 *     row is CARDS, round portraits with a name are a TEAM, big numbers with
 *     a label are STATS, a row of little linked icons is SOCIAL, pictures in
 *     a grid are a GALLERY;
 *   - the words' sizes rank into one h1, then h2/h3, body text, small print;
 *   - the row of links at the top of the home page is the site's MENU, not
 *     page content, and the name beside it is the site's title;
 *   - links between the design's pages and sections become real links
 *     between the new pages and their anchors.
 *
 * What cannot live (a decorative squiggle, a rotated sticker, an overlap
 * that only works at 1366px) is dropped and COUNTED in the report — the
 * owner sees what Geppetto chose, never a silent loss.
 *
 * The output is Tapuz JSON blocks (the renderer's model); land.js turns each
 * page into a .pzn source through the same bridge every door uses.
 */

const P = require('./puppet');

// ── tunables (design px are normalized to a 1366-wide canvas: `u` = 1 at 1366) ──

const T = {
  bandTol: 4,          // px shaved off every box before looking for gaps (text boxes overlap a little)
  rowGap: 10,          // a vertical gutter at least this wide splits a band into columns
  navBandMax: 170,     // the top band of the home page that may hold the menu
  navItemMax: 32,      // a menu label is short
  buttonMaxH: 150,     // a button is not taller than this
  buttonMaxChars: 48,
  iconMax: 60,         // an unlinked svg this small is decoration
  headingMaxChars: 140,
  bgCover: 0.62,       // a picture covering this share of a section is its background
  slabCover: 0.86,     // a plain shape covering this share is the section's color
  maxDepth: 4          // nesting guard (sections > rows > cards > …)
};

const SOCIAL_HOSTS = [
  ['facebook', /(^|\.)facebook\.com$|(^|\.)fb\.com$/],
  ['instagram', /(^|\.)instagram\.com$/],
  ['linkedin', /(^|\.)linkedin\.com$/],
  ['x', /(^|\.)twitter\.com$|(^|\.)x\.com$/],
  ['youtube', /(^|\.)youtube\.com$|(^|\.)youtu\.be$/],
  ['tiktok', /(^|\.)tiktok\.com$/],
  ['pinterest', /(^|\.)pinterest\.[a-z.]+$/],
  ['behance', /(^|\.)behance\.net$/],
  ['dribbble', /(^|\.)dribbble\.com$/],
  ['github', /(^|\.)github\.com$/],
  ['whatsapp', /(^|\.)wa\.me$|(^|\.)whatsapp\.com$/],
  ['telegram', /(^|\.)t\.me$|(^|\.)telegram\.me$/],
  ['spotify', /(^|\.)spotify\.com$/],
  ['threads', /(^|\.)threads\.net$/],
  ['upwork', /(^|\.)upwork\.com$/],
  ['etsy', /(^|\.)etsy\.com$/]
];

function socialNetwork(href) {
  const h = String(href || '');
  if (/^mailto:/i.test(h)) return 'email';
  if (/^tel:/i.test(h)) return 'phone';
  let host = '';
  try { host = new URL(h).hostname.toLowerCase(); } catch (e) { return ''; }
  for (const [name, re] of SOCIAL_HOSTS) if (re.test(host)) return name;
  return '';
}

// ── small helpers ─────────────────────────────────────────────────────────

function makeIds() {
  let n = 0;
  return (type) => `${type}_gp${(++n).toString(36)}`;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

function slugify(raw, fallback) {
  const s = String(raw || '').trim().toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['"’]/g, '')
    .replace(/[^\w\u0590-\u05ff-]+/g, '-')
    .replace(/_/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 60);
  return s || fallback;
}

function uniqueSlug(base, taken) {
  let s = base;
  for (let n = 2; taken.has(s); n++) s = base + '-' + n;
  taken.add(s);
  return s;
}

/** A link the published page may carry (never a script scheme). */
function safeUrl(href) {
  const s = String(href || '').trim();
  if (!s || /^(?:javascript|data|vbscript):/i.test(s)) return '';
  return s;
}

/**
 * A color that reaches a style attribute is REBUILT from its parsed numbers —
 * '#rrggbb', or 'rgba(r, g, b, a)' when it is translucent (a 40% black tint
 * must not become a black box) — never passed through as the decoder wrote it.
 */
function safeColor(c) {
  const p = P.parseColor(c);
  if (!p || !(p.alpha > 0)) return null;
  if (p.alpha >= 0.99) return p.hex;
  const h = p.hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${Math.round(p.alpha * 100) / 100})`;
}

/**
 * A gradient a decoder built reaches a style attribute (`background:…`), so
 * only a plain CSS gradient passes: linear/radial, colors and numbers, no
 * url(), no quotes, no semicolon — anything else is dropped.
 */
function safeGradient(g) {
  const s = String(g || '').trim();
  if (!s || s.length > 400) return null;
  if (!/^(?:linear|radial)-gradient\([#\w\s%,.()-]+\)$/i.test(s)) return null;
  if (/url\s*\(|expression|;|["'<>]/i.test(s)) return null;
  return s;
}

/** A text box's words as the visitor sees them (the design's CSS capitals applied). */
function shownText(node) {
  if (!node || node.type !== 'text') return P.plainText(node);
  if (!(node.paragraphs || []).some((p) => (p.runs || []).some((r) => r.upper))) return P.plainText(node);
  return P.plainText(Object.assign({}, node, {
    paragraphs: node.paragraphs.map((p) => Object.assign({}, p, {
      runs: (p.runs || []).map((r) => (r.upper ? Object.assign({}, r, { text: String(r.text || '').toUpperCase() }) : r))
    }))
  }));
}

/** Marks cannot nest and their body cannot hold a brace. */
function markBody(s) {
  return String(s || '').replace(/[{}]/g, '');
}

/** Literal text that happens to look like a BenTML mark must stay literal. */
function guardMarks(s) {
  return String(s || '').replace(/@(?=(B|I|CODE|LINK|BREAK|IMG|LTR|RTL)\b)/g, '@\u200b');
}

// ── text: runs → BenTML inline marks ──────────────────────────────────────

/**
 * One line of runs → inline BenTML. Bold is only marked when the node is not
 * bold as a whole (an all-bold heading gets no @B around every word); a link
 * wins over bold (marks cannot nest).
 */
function runsToInline(runs, base, linkOf) {
  const pieces = [];
  for (const r of runs || []) {
    // the design's capitals (CSS text-transform) become the words themselves:
    // what the owner edits is what the visitor sees
    const text = r.upper ? String(r.text || '').toUpperCase() : String(r.text || '');
    if (!text) continue;
    const href = linkOf(r.href);
    const bold = !base.bold && (!!r.bold || (r.weight || 0) >= 600);
    const italic = !base.italic && !!r.italic;
    const last = pieces[pieces.length - 1];
    if (last && last.href === href && last.bold === bold && last.italic === italic) last.text += text;
    else pieces.push({ text, href, bold, italic });
  }
  return pieces.map((p) => {
    const t = p.text;
    const lead = /^\s*/.exec(t)[0];
    const trail = /\s*$/.exec(t)[0];
    const core = t.trim();
    if (!core) return t;
    if (p.href) return lead + `@LINK(url: "${p.href.replace(/"/g, '%22')}"){${markBody(core)}}` + trail;
    if (p.bold) return lead + `@B{${markBody(core)}}` + trail;
    if (p.italic) return lead + `@I{${markBody(core)}}` + trail;
    return guardMarks(t);
  }).join('');
}

/** Paragraph lines of a text node, each as inline BenTML (empty = a blank line). */
function nodeLines(node, linkOf) {
  const base = P.dominantStyle(node);
  return (node.paragraphs || []).map((p) => ({
    list: p.list || null,
    align: p.align || 'start',
    inline: runsToInline(p.runs, base, linkOf).replace(/[ \t\u00a0]+/g, ' ').trim(),
    plain: (p.runs || []).map((r) => r.text || '').join('').replace(/\s+/g, ' ').trim()
  }));
}

/** Heading text: every visual line break is one space (headings reflow). */
function headingText(node, linkOf) {
  return nodeLines(node, linkOf).map((l) => l.inline).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Body text: a designer breaks lines to fit the box; an EMPTY line is the
 * real paragraph break. Lines of one paragraph keep a soft break (\n → <br>)
 * only when they end like sentences; otherwise they rejoin into one line.
 */
function bodyContent(node, linkOf) {
  const lines = nodeLines(node, linkOf);
  const paras = [];
  let cur = [];
  for (const l of lines) {
    if (!l.plain) { if (cur.length) paras.push(cur); cur = []; continue; }
    cur.push(l);
  }
  if (cur.length) paras.push(cur);
  return paras.map((ls) => {
    let out = '';
    ls.forEach((l, i) => {
      if (i === 0) { out = l.inline; return; }
      const prev = ls[i - 1].plain;
      const hard = /[.!?:;…"”)\]]$/.test(prev) || prev.length < 28 || /^[-•·●▪–—*\d]/.test(l.plain);
      out += (hard ? '\n' : ' ') + l.inline;
    });
    return out;
  }).join('\n\n');
}

// ── text roles ────────────────────────────────────────────────────────────

/** Per-page type scale: the body size (by characters) and the tiers above it. */
function typeScale(page) {
  const tally = new Map();
  let all = [];
  for (const s of page.sections || []) {
    P.eachNode(s.nodes, (n) => {
      if (n.type !== 'text') return;
      for (const p of n.paragraphs || []) {
        for (const r of p.runs || []) {
          const len = String(r.text || '').replace(/\s+/g, '').length;
          if (!len || !(r.size > 0)) continue;
          const k = Math.round(r.size * 2) / 2;
          tally.set(k, (tally.get(k) || 0) + len);
          all.push([k, len]);
        }
      }
    });
  }
  if (!tally.size) return { body: 16, max: 16 };
  // the body is the size most characters are set in — among sizes a person reads paragraphs in
  let body = 0;
  let best = -1;
  for (const [k, n] of tally) {
    if (k > 40) continue;
    if (n > best) { best = n; body = k; }
  }
  if (!body) body = Math.min(...tally.keys());
  const max = Math.max(...tally.keys());
  return { body, max };
}

const ROLE_LEVEL = {
  title: 1, h1: 1, heading: 2, heading1: 2, h2: 2, subtitle: 2, heading2: 3, h3: 3, heading3: 4, h4: 4, h5: 5, h6: 6
};

/**
 * What a text IS: a heading (with a level), a list, a kicker (the small
 * spaced caps over a title), or body text (with a size).
 */
function classifyText(node, scale) {
  const st = P.dominantStyle(node);
  const text = P.plainText(node);
  const len = text.length;
  const lines = text.split('\n').filter((l) => l.trim()).length;
  const paras = node.paragraphs || [];
  const listParas = paras.filter((p) => p.list && (p.runs || []).some((r) => String(r.text || '').trim()));
  const nonEmpty = paras.filter((p) => (p.runs || []).some((r) => String(r.text || '').trim()));
  if (listParas.length >= 2 && listParas.length >= nonEmpty.length * 0.6) {
    return { kind: 'list', ordered: listParas.every((p) => p.list === 'number') };
  }
  const ratio = st.size && scale.body ? st.size / scale.body : 1;
  const role = String(node.role || '').toLowerCase();
  if (role === 'paragraph' || role === 'paragraph1' || role === 'p' || role === 'body' || role === 'caption') {
    return { kind: 'text', size: ratio <= 0.82 || role === 'caption' ? 'sm' : ratio >= 1.18 ? 'lg' : null };
  }
  if (ROLE_LEVEL[role] && len <= T.headingMaxChars * 1.6) {
    // a "subtitle" set in body size is a lead paragraph, not a heading
    if (role === 'subtitle' && ratio < 1.25) return { kind: 'text', size: 'lg' };
    return { kind: 'heading', level: ROLE_LEVEL[role], size: st.size };
  }
  const bodySize = { kind: 'text', size: ratio <= 0.82 ? 'sm' : ratio >= 1.18 ? 'lg' : null };
  if (len > T.headingMaxChars || lines > 4) return bodySize;
  // an address, a phone, an email is information, never a title
  if (CONTACTISH.test(text)) return bodySize;
  const sentence = /[.!?]["”)]?$/.test(text.trim()) && len > 40;
  if (ratio >= 2.0) return { kind: 'heading', level: len > 80 ? 2 : 1, size: st.size };
  if (ratio >= 1.5 && !sentence) return { kind: 'heading', level: 2, size: st.size };
  // between the body and a real title: only a SHORT line is a heading — a
  // hero's one-sentence promise at 1.2× is a lead paragraph
  if (ratio >= 1.2 && len <= 40 && !sentence) return { kind: 'heading', level: 3, size: st.size };
  if (st.bold && ratio >= 0.95 && len <= 40 && lines <= 2 && !sentence) return { kind: 'heading', level: 4, size: st.size };
  if (st.upper && ratio <= 1.05 && len <= 40) return { kind: 'kicker' };
  return bodySize;
}

const CONTACTISH = /[\w.+-]+@[\w-]+\.[\w.]+|https?:\/\/|www\.|(?:\+?\d[\d\s().-]{7,}\d)/i;

// ── the section's own layers: background, veil, color ─────────────────────

function sectionBox(section, width) {
  return { x: 0, y: 0, w: width, h: section.height || P.unionBox(section.nodes).h };
}

/**
 * Peel the section's background off its content: the picture under
 * everything, the slab of color, the dark veil between them.
 * @returns {{ items, fill: {color, image, video, overlay}, dropped }}
 */
function peelBackground(section, width) {
  const box = sectionBox(section, width);
  const fill = {
    color: section.fill && section.fill.color ? P.toHex(section.fill.color) : null,
    gradient: section.fill ? safeGradient(section.fill.gradient) : null,
    image: section.fill && section.fill.image && section.fill.image.src ? section.fill.image.src : null,
    video: section.fill && section.fill.video && section.fill.video.src ? section.fill.video : null,
    overlay: 0,
    overlayColor: null
  };
  let items = (section.nodes || []).slice();
  const dropped = [];
  // walk from the bottom of the paint order: background layers come first
  const sorted = items.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
  for (const n of sorted) {
    const cov = P.coverage(n, box) ; // share of the SECTION covered by n
    if ((n.type === 'image' || n.type === 'video') && cov >= T.bgCover && !n.link) {
      if (!fill.image && !fill.video) {
        if (n.type === 'image') fill.image = n.src;
        else fill.video = { src: n.src, poster: n.poster || '' };
        items = items.filter((x) => x !== n);
        continue;
      }
    }
    if (n.type === 'shape' && !(n.children && n.children.length) && cov >= T.slabCover && !n.link) {
      const c = P.parseColor(n.fill && n.fill.color);
      if (n.fill && n.fill.image && n.fill.image.src && !fill.image) {
        fill.image = n.fill.image.src;
        items = items.filter((x) => x !== n);
        continue;
      }
      if (c) {
        const alpha = c.alpha * (n.opacity == null ? 1 : n.opacity);
        if ((fill.image || fill.video) && alpha < 0.96) {
          fill.overlay = Math.max(fill.overlay, Math.round(alpha * 100));
          fill.overlayColor = c.hex;
        } else if (alpha >= 0.5) {
          fill.color = c.hex;
          if (fill.image && alpha >= 0.96) fill.image = null; // an opaque slab hides the picture under it
        }
        items = items.filter((x) => x !== n);
        continue;
      }
      if (n.fill && safeGradient(n.fill.gradient)) {
        fill.gradient = safeGradient(n.fill.gradient);
        items = items.filter((x) => x !== n);
        continue;
      }
    }
    break; // the first real content layer ends the peeling
  }
  // a frame that IS the section's slab (Figma: one child filling the section)
  return { items, fill, dropped };
}

// ── echoes: a word stacked on itself ──────────────────────────────────────

/**
 * Designers echo a big word: the solid "PORTFOLIO" with three outlined copies
 * stepping down under it (Canva's hollow effect), some cut short to fit
 * ("PORTFOL"). On a poster that is typography; in a page it would read
 * "PORTFOLIO PORTFOL PORTFOL PORTFOLIO". Keep the solid original, drop the
 * echoes, count them.
 */
function dropEchoes(items, report) {
  const texts = items.filter((n) => n.type === 'text');
  const drop = new Set();
  const norm = (n) => P.plainText(n).replace(/\s+/g, '').toLowerCase();
  for (const a of texts) {
    if (drop.has(a)) continue;
    const ta = norm(a);
    if (ta.length < 3) continue;
    const sa = P.dominantStyle(a);
    const echoes = texts.filter((b) => {
      if (b === a || drop.has(b)) return false;
      const tb = norm(b);
      if (tb.length < 3 || !(ta.startsWith(tb) || tb.startsWith(ta))) return false;
      const sb = P.dominantStyle(b);
      if (!sa.size || Math.abs(sb.size - sa.size) > sa.size * 0.06 || sb.font !== sa.font) return false;
      if (Math.abs(b.x - a.x) > Math.max(12, sa.size * 0.3)) return false; // the same column
      return Math.abs(b.y - a.y) <= Math.max(a.h, b.h) * 3.2; // stepping close under (or over) it
    });
    if (!echoes.length) continue;
    // the original is the solid one, else the topmost
    const family = [a, ...echoes].sort((p, q) => ((p.effect === 'hollow') - (q.effect === 'hollow')) || (p.y - q.y));
    family.slice(1).forEach((e) => { drop.add(e); report.dropped.push('echo'); });
  }
  return drop.size ? items.filter((n) => !drop.has(n)) : items;
}

// ── fragments: one heading set as pieces ──────────────────────────────────

/**
 * Canva designers set a heading in pieces so each can wear its own color:
 * "Hello!" on one line, then "I'm" + "Noa" (pink, outlined) + "!" on the
 * next, plus a second "!" drawn a hair off as a shadow. Read as boxes, that
 * is six headings; read as a person reads it, it is ONE: "Hello! I'm Noa!".
 *   1. a copy drawn over itself (same words, the same box) → the top one
 *   2. pieces on one line, same face and size, touching → one line
 *   3. big lines stacked tight, same face and size → one heading
 */
function mergeFragments(items, scale) {
  const texts = items.filter((n) => n.type === 'text' && P.plainText(n));
  if (texts.length < 2 || texts.length > 1500) return items;
  // everything a comparison needs, computed ONCE per box (the old version
  // recomputed the words inside nested loops: 31 s on 1,000 boxes)
  const meta = new Map();
  const info = (n) => {
    let m = meta.get(n);
    if (!m) {
      const st = P.dominantStyle(n);
      m = { text: P.plainText(n).replace(/\s+/g, ' ').trim(), size: st.size || 0, font: st.font || '' };
      meta.set(n, m);
    }
    return m;
  };
  const join = (a, b, sep) => {
    const merged = Object.assign({}, a, {
      id: a.id + '+' + b.id,
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
      h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y),
      z: Math.max(a.z || 0, b.z || 0),
      effect: a.effect === 'hollow' && b.effect === 'hollow' ? 'hollow' : undefined
    });
    if (sep === 'line') {
      const pa = a.paragraphs.map((p) => Object.assign({}, p, { runs: p.runs.slice() }));
      const last = pa[pa.length - 1];
      const first = b.paragraphs[0] || { runs: [] };
      const lastText = last.runs.map((r) => r.text || '').join('');
      const firstText = first.runs.map((r) => r.text || '').join('');
      if (lastText && firstText && !/\s$/.test(lastText) && !/^\s/.test(firstText) && !/^[!?.,:;)'’”]/.test(firstText)) last.runs.push(Object.assign({}, first.runs[0] || {}, { text: ' ' }));
      last.runs.push(...first.runs);
      merged.paragraphs = pa.concat(b.paragraphs.slice(1));
    } else {
      merged.paragraphs = a.paragraphs.concat(b.paragraphs);
    }
    const ma = info(a);
    meta.set(merged, { text: (ma.text + ' ' + info(b).text).trim(), size: ma.size, font: ma.font });
    return merged;
  };
  // only boxes in the same face and size can be one heading
  const buckets = new Map();
  for (const n of texts) {
    const m = info(n);
    if (!m.size) continue;
    const k = m.font + '|' + Math.round(m.size / (m.size * 0.04 || 1));
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(n);
  }
  const replaced = new Map(); // original box → the box that now carries it (or null = gone)
  const bigAt = scale && scale.body ? scale.body * 1.3 : 28;
  for (let list of buckets.values()) {
    if (list.length < 2) continue;
    // 1. a copy drawn over itself (the same words, nearly the same box) → the top one
    const byText = new Map();
    for (const n of list) {
      const t = info(n).text;
      if (!byText.has(t)) byText.set(t, []);
      byText.get(t).push(n);
    }
    const gone = new Set();
    for (const same of byText.values()) {
      if (same.length < 2) continue;
      for (const a of same) for (const b of same) {
        if (a === b || gone.has(a) || gone.has(b)) continue;
        if (P.coverage(a, b) >= 0.6 || P.coverage(b, a) >= 0.6) gone.add((a.z || 0) >= (b.z || 0) ? b : a);
      }
    }
    gone.forEach((n) => replaced.set(n, null));
    list = list.filter((n) => !gone.has(n));
    // 2. pieces on one line → one line (rows by vertical overlap, then left to right)
    const rows = [];
    for (const n of list.slice().sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2))) {
      const row = rows.find((r) => {
        const ov = Math.min(r.y + r.h, n.y + n.h) - Math.max(r.y, n.y);
        return ov >= Math.min(r.h, n.h) * 0.6;
      });
      if (row) { row.items.push(n); row.y = Math.min(row.y, n.y); row.h = Math.max(row.y + row.h, n.y + n.h) - row.y; } else rows.push({ y: n.y, h: n.h, items: [n] });
    }
    const lines = [];
    for (const row of rows) {
      const sorted = row.items.sort((a, b) => a.x - b.x);
      let cur = sorted[0];
      for (let i = 1; i < sorted.length; i++) {
        const nx = sorted[i];
        const size = info(cur).size;
        const gap = nx.x - (cur.x + cur.w);
        if (gap <= size * 0.8 && gap >= -size * 0.4 && info(cur).text.length <= 40 && info(nx).text.length <= 40) {
          const m = join(cur, nx, 'line');
          replaced.set(cur, m); replaced.set(nx, m);
          cur = m;
        } else { lines.push(cur); cur = nx; }
      }
      lines.push(cur);
    }
    // 3. big lines stacked tight → one heading (top to bottom)
    const open = [];
    for (const n of lines.slice().sort((a, b) => a.y - b.y)) {
      const m = info(n);
      const host = m.size >= bigAt && m.text.length <= 40 ? open.find((o) => {
        const om = info(o);
        const gapY = n.y - (o.y + o.h);
        const hOverlap = Math.min(o.x + o.w, n.x + n.w) - Math.max(o.x, n.x);
        return om.size >= bigAt && gapY <= m.size * 0.35 && gapY >= -m.size * 0.6 && hOverlap > 0 && om.text.split(' ').length <= 12;
      }) : null;
      if (host) {
        const merged = join(host, n, 'para');
        replaced.set(host, merged); replaced.set(n, merged);
        open[open.indexOf(host)] = merged;
      } else open.push(n);
    }
  }
  if (!replaced.size) return items;
  // every original box maps to its final carrier (follow the chain)
  const finalOf = (n) => {
    let cur = n;
    let hops = 0;
    while (replaced.has(cur) && hops++ < 2000) {
      const next = replaced.get(cur);
      if (next === null) return null;
      cur = next;
    }
    return cur;
  };
  const out = [];
  const placed = new Set();
  for (const n of items) {
    if (n.type !== 'text' || !replaced.has(n)) { out.push(n); continue; }
    const f = finalOf(n);
    if (f && !placed.has(f)) { placed.add(f); out.push(f); }
  }
  return out;
}

/**
 * A small picture tucked under a much bigger one (a drop-shadow strip under a
 * photo, an offset color panel behind it) is decoration: shown on its own it
 * would be an empty colored box. Only where there are few pictures — a
 * collage's photos overlap each other and every one of them is content.
 */
function dropTucked(items, report) {
  const pics = items.filter((n) => n.type === 'image' && n.src && !n.link);
  if (pics.length < 2 || pics.length > 4) return items;
  const drop = new Set();
  for (const a of pics) {
    for (const b of pics) {
      if (a === b || drop.has(b) || (a.z || 0) >= (b.z || 0)) continue;
      if (P.area(a) < 0.35 * P.area(b) && P.coverage(b, a) >= 0.3) { drop.add(a); report.dropped.push('shadow'); break; }
    }
  }
  return drop.size ? items.filter((n) => !drop.has(n)) : items;
}

/** The passes that make a list of boxes readable, in order — at every level. */
function tidy(items, report, scale) {
  return mergeButtons(mergeFragments(dropEchoes(dropTucked(items, report), report), scale));
}

// ── buttons: a pill with a word on it ─────────────────────────────────────

function shapeColor(n) {
  const c = n && n.fill && P.parseColor(n.fill.color);
  return c && c.alpha > 0.05 ? c.hex : null;
}

function radiusName(px, h) {
  if (px == null) return null;
  if (h && px >= h / 2 - 1) return 'lg';
  if (px >= 14) return 'lg';
  if (px >= 7) return 'md';
  if (px >= 2) return 'sm';
  return null;
}

function isShortLine(textNode) {
  const t = P.plainText(textNode);
  return t && t.length <= T.buttonMaxChars && t.split('\n').filter((l) => l.trim()).length <= 2;
}

function firstHref(node) {
  if (!node) return '';
  if (node.link && node.link.href) return node.link.href;
  if (node.link && (node.link.page || node.link.anchor)) return gpLink(node.link);
  if (node.type === 'text') {
    for (const p of node.paragraphs || []) for (const r of p.runs || []) if (r.href) return r.href;
  }
  for (const c of node.children || []) {
    const h = firstHref(c);
    if (h) return h;
  }
  return '';
}

function makeButton(shape, text, extraLink) {
  const st = P.dominantStyle(text);
  const bg = shapeColor(shape);
  const strokeColor = shape && shape.stroke && P.toHex(shape.stroke.color);
  const link = (shape && shape.link) || text.link || extraLink || null;
  const href = symbolic(link ? (link.href || gpLink(link)) : firstHref(text));
  // words the same color as the pill would be invisible on it: the pill is a
  // RING (Canva draws an outline as a filled path with a hole) — an outline
  let fill = bg;
  let ring = strokeColor;
  if (fill && st.color && P.colorDistance(fill, st.color) < 40) { ring = ring || fill; fill = null; }
  return {
    type: 'button',
    id: (shape || text).id + '-btn',
    x: shape ? shape.x : text.x,
    y: shape ? shape.y : text.y,
    w: shape ? shape.w : text.w,
    h: shape ? shape.h : text.h,
    z: Math.max((shape && shape.z) || 0, text.z || 0),
    label: (st.upper ? P.plainText(text).toUpperCase() : P.plainText(text)).replace(/\s+/g, ' ').trim(),
    href: href || '',
    bg: fill,
    fg: st.color,
    outline: !fill && !!ring,
    border: ring || null,
    radius: shape ? radiusName(shape.radius, shape.h) || (shape.shape === 'path' || shape.shape === 'ellipse' ? 'lg' : null) : null,
    anim: (shape && shape.anim) || text.anim || null,
    mobile: (shape && shape.mobile) || text.mobile || null
  };
}

/**
 * Merge shape+text pairs into buttons, at one level of the item list. A
 * shape carrying its own text (Canva's "text in a shape"), a group of one
 * shape + one short text, or a short text sitting on a small shape.
 */
function mergeButtons(items) {
  let out = [];
  const used = new Set();
  for (const n of items) {
    if (n.type === 'shape' && n.children && n.children.length === 1 && n.children[0].type === 'text' && n.h <= T.buttonMaxH && isShortLine(n.children[0])) {
      out.push(makeButton(n, n.children[0]));
      used.add(n);
      continue;
    }
    if (n.type === 'group' || (n.type === 'frame' && !(n.layout && n.layout.mode === 'grid'))) {
      const kids = (n.children || []).filter((c) => c.type !== 'line');
      const shapes = kids.filter((c) => c.type === 'shape' && !(c.children && c.children.length));
      const texts = kids.filter((c) => c.type === 'text');
      const others = kids.filter((c) => c.type !== 'shape' && c.type !== 'text' && !(c.type === 'image' && c.svg && c.w <= T.iconMax));
      const frameFill = n.type === 'frame' && (shapeColor(n) || (n.stroke && n.stroke.color));
      if (texts.length === 1 && !others.length && isShortLine(texts[0]) && n.h <= T.buttonMaxH &&
          (shapes.length === 1 || (frameFill && shapes.length === 0)) &&
          (n.link || firstHref(n) || /button|btn|cta/i.test(n.name || '') || n.role === 'button' || frameFill)) {
        const base = shapes[0] || n;
        out.push(makeButton(base, texts[0], n.link));
        used.add(n);
        continue;
      }
    }
    out.push(n);
  }
  // a short text sitting on a small shape (drawn separately)
  const shapes = out.filter((n) => n.type === 'shape' && !(n.children && n.children.length) && n.h <= T.buttonMaxH && n.w <= 700);
  const texts = out.filter((n) => n.type === 'text' && isShortLine(n));
  const taken = new Set();
  for (const s of shapes) {
    const t = texts.find((t) => !taken.has(t) && (t.z || 0) >= (s.z || 0) &&
      P.contains(s, { x: t.x + t.w / 2 - 1, y: t.y + t.h / 2 - 1, w: 2, h: 2 }, 0) &&
      P.coverage(s, t) >= 0.7 && s.w * s.h <= t.w * t.h * 9);
    if (!t) continue;
    taken.add(t);
    taken.add(s);
    out.push(makeButton(s, t));
  }
  out = out.filter((n) => !taken.has(n));
  return out;
}

// the report and type scale the recursive layout passes share (set per page)
const CTX = { report: { dropped: [] }, scale: { body: 16 } };

// ── layout: XY-cut ────────────────────────────────────────────────────────

/**
 * Runs along an axis and the clean gaps between them (boxes shaved by `tol`
 * first, so text boxes that overlap a hair still part).
 * @returns {{ groups: object[][], gaps: number[] }}  gaps[i] sits between groups[i] and groups[i+1]
 */
function runsAlong(items, axis, tol, minGap) {
  const size = axis === 'x' ? 'w' : 'h';
  const iv = items.map((it) => {
    let a = it[axis] + tol;
    let b = it[axis] + it[size] - tol;
    if (b < a) { const m = (a + b) / 2; a = m; b = m; }
    return { it, a, b };
  }).sort((p, q) => p.a - q.a || p.b - q.b);
  const groups = [];
  const gaps = [];
  let cur = null;
  let end = -Infinity;
  for (const x of iv) {
    if (!cur || x.a - end >= minGap) {
      if (cur) gaps.push(x.a - end);
      cur = [];
      groups.push(cur);
      end = x.b;
    } else end = Math.max(end, x.b);
    cur.push(x.it);
  }
  return { groups, gaps };
}

/** Split into runs wherever a clean gap of at least minGap opens. */
function splitAxis(items, axis, tol, minGap) {
  return runsAlong(items, axis, tol, minGap).groups;
}

/** Re-join runs so only the WIDE gaps (≥ ratio × the widest) cut; narrower ones stay inside. */
function cutAtWidest(runs, ratio) {
  const widest = Math.max(...runs.gaps);
  const out = [runs.groups[0].slice()];
  runs.gaps.forEach((g, i) => {
    if (g >= widest * ratio) out.push(runs.groups[i + 1].slice());
    else out[out.length - 1].push(...runs.groups[i + 1]);
  });
  return out;
}

function boxOf(list) { return P.unionBox(list); }

/**
 * The recursive XY-cut, widest gap first. Tree nodes:
 *   { kind: 'leaf', item } | { kind: 'stack', children } |
 *   { kind: 'row', cols: [{ box, node }] } | { kind: 'panel', base, child, box } |
 *   { kind: 'grid', perRow, cells: [{ box, node }] }
 *
 * Why widest-first: a row of three cards has 60px gutters between the cards
 * and 12px between each card's picture and title. Cutting every horizontal
 * band first would slice the cards into a row of pictures, a row of titles
 * and a row of texts; the widest gap is the designer's strongest boundary,
 * so it is cut first and the cards stay whole. An icon 12px from its label
 * stays a pair for the same reason.
 */
function cut(items, u, depth = 0) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1) return leafOrFlow(list[0], u, depth);
  if (depth > 40) return readingStack(list, u, depth);
  const tol = T.bandTol * u;
  const Y = runsAlong(list, 'y', tol, 0.5);
  const X = runsAlong(list, 'x', tol, T.rowGap * u);
  const yMax = Y.gaps.length ? Math.max(...Y.gaps) : -1;
  const xMax = X.gaps.length ? Math.max(...X.gaps) : -1;
  if (xMax > yMax && xMax > 0) {
    const cols = cutAtWidest(X, 0.7);
    return { kind: 'row', cols: cols.map((c) => ({ box: boxOf(c), node: cut(c, u, depth + 1) })).filter((c) => c.node) };
  }
  if (yMax >= 0 && Y.groups.length > 1) {
    const bands = cutAtWidest(Y, 0.7);
    return { kind: 'stack', children: bands.map((b) => cut(b, u, depth + 1)).filter(Boolean) };
  }
  // a decoration repeated at one size (Canva's frame behind every service) is
  // a row of CARDS: each frame gathers the picture in it and the words under it
  const anchored = anchorCards(list, u);
  if (anchored) return anchored;
  // cluster first, then cut: boxes that overlap belong together (a frame, the
  // photo in it and its label are ONE card) — each overlap-cluster becomes a
  // unit and the cut runs over the units
  const comps = overlapClusters(list, tol);
  if (comps.length >= 2 && comps.some((c) => c.length >= 2)) {
    const units = comps.map((c, i) => (c.length === 1 ? c[0] : Object.assign(
      { type: 'group', id: 'cluster-' + depth + '-' + i, children: c, z: Math.max(...c.map((n) => n.z || 0)), cluster: true },
      P.unionBox(c)
    )));
    return cut(units, u, depth + 1);
  }
  // overlap: something contains the others — a panel (a slab with words on it, a photo with a title over it)
  const base = list
    .filter((n) => (n.type === 'shape' || n.type === 'image' || n.type === 'video' || n.type === 'frame') && !(n.type === 'frame' && n.children && n.children.length))
    .filter((n) => list.some((m) => m !== n && (m.z || 0) >= (n.z || 0) && P.coverage(n, m) >= 0.8))
    .sort((a, b) => P.area(b) - P.area(a))[0];
  if (base) {
    const inner = list.filter((m) => m !== base && (m.z || 0) >= (base.z || 0) && P.coverage(base, m) >= 0.8);
    const outer = list.filter((m) => m !== base && !inner.includes(m));
    const panel = { kind: 'panel', base, child: cut(inner, u, depth + 1), box: { x: base.x, y: base.y, w: base.w, h: base.h } };
    if (!outer.length) return panel;
    // the panel now acts as one item among the rest
    const proxy = { type: '__panel', panel, x: base.x, y: base.y, w: base.w, h: base.h, z: base.z };
    return cut([proxy, ...outer], u, depth + 1);
  }
  // one big picture overlapping the words (a cut-out portrait across a title):
  // set the picture BESIDE the words, on the side the designer put it
  const whole = boxOf(list);
  const big = list.filter((n) => (n.type === 'image' || n.type === 'video') && P.area(n) >= 0.12 * P.area(whole));
  if (big.length === 1 && list.length >= 3) {
    const m = big[0];
    const rest = list.filter((x) => x !== m);
    const restBox = boxOf(rest);
    const pictureFirst = m.x + m.w / 2 < restBox.x + restBox.w / 2;
    const picture = { box: { x: m.x, y: m.y, w: m.w, h: m.h }, node: { kind: 'leaf', item: m } };
    const words = { box: restBox, node: cut(rest, u, depth + 1) };
    return { kind: 'row', cols: pictureFirst ? [picture, words] : [words, picture], overlap: true };
  }
  return readingStack(list, u, depth);
}

/** The key two decorations share when they are "the same frame": its picture or its paint, and its size. */
function decorKey(n) {
  const size = Math.round(n.w / 6) + 'x' + Math.round(n.h / 6);
  if (n.type === 'image' && n.src) return 'img:' + n.src + ':' + size;
  if (n.type === 'shape' && !(n.children && n.children.length)) return 'shape:' + ((n.fill && (n.fill.color || n.fill.gradient)) || '') + ':' + (n.shape || '') + ':' + size;
  return '';
}

/**
 * A frame (or a slab) repeated three or more times at one size is the
 * background of a row of cards. Each frame gathers what sits in it and the
 * words hanging just under it; the frames line up in rows; the frame itself
 * is decoration. Returns a grid tree (plus whatever lies above/below it), or
 * null when there is no such repetition.
 */
function anchorCards(list, u) {
  const byKey = new Map();
  for (const n of list) {
    const k = decorKey(n);
    if (!k || n.w < 60 * u || n.h < 60 * u) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(n);
  }
  let anchors = null;
  for (const group of byKey.values()) {
    if (group.length < 3) continue;
    // the repeats must not sit on each other (a stack of the same sticker is not a row)
    const clean = group.every((a) => group.every((b) => a === b || P.coverage(a, b) < 0.25));
    if (clean && (!anchors || group.length > anchors.length)) anchors = group;
  }
  if (!anchors) return null;
  const members = new Map(anchors.map((a) => [a, []]));
  const rest = [];
  for (const n of list) {
    if (anchors.includes(n)) continue;
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    let best = null;
    let bestD = Infinity;
    for (const a of anchors) {
      const inside = cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h;
      const under = n.type === 'text' && cx >= a.x && cx <= a.x + a.w && n.y >= a.y + a.h * 0.5 && n.y <= a.y + a.h * 1.35;
      if (!inside && !under) continue;
      const d = Math.hypot(cx - (a.x + a.w / 2), cy - (a.y + a.h / 2));
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best) members.get(best).push(n);
    else rest.push(n);
  }
  // an anchor that gathered nothing is plain decoration
  const cards = anchors.filter((a) => members.get(a).length);
  if (cards.length < 3) return null;
  const cells = cards.map((a) => {
    const kids = [Object.assign({}, a, { decor: true }), ...members.get(a)];
    const box = P.unionBox(kids);
    return { box, node: Object.assign(cut(kids.slice(1), u, 1) || { kind: 'stack', children: [] }, { frame: a }) };
  });
  // the cards in rows (by their frames' vertical centers), each row start-to-end
  const rows = [];
  for (const c of cells.slice().sort((p, q) => (p.node.frame.y - q.node.frame.y) || (p.node.frame.x - q.node.frame.x))) {
    const row = rows.find((r) => Math.abs(r[0].node.frame.y - c.node.frame.y) <= c.node.frame.h * 0.5);
    if (row) row.push(c); else rows.push([c]);
  }
  rows.forEach((r) => r.sort((p, q) => p.node.frame.x - q.node.frame.x));
  const perRow = Math.max(...rows.map((r) => r.length));
  const grid = { kind: 'grid', perRow, cells: rows.flat() };
  if (!rest.length) return grid;
  const top = Math.min(...cards.map((a) => a.y));
  const above = rest.filter((n) => n.y + n.h / 2 < top);
  const below = rest.filter((n) => !above.includes(n));
  return { kind: 'stack', children: [cut(above, u, 1), grid, cut(below, u, 1)].filter(Boolean) };
}

/** Connected groups of boxes that overlap (after shaving `tol` off each side). */
function overlapClusters(list, tol) {
  const shaved = list.map((n) => ({ n, x: n.x + tol, y: n.y + tol, w: Math.max(0, n.w - 2 * tol), h: Math.max(0, n.h - 2 * tol) }));
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < shaved.length; i++) {
    for (let j = i + 1; j < shaved.length; j++) {
      if (P.intersection(shaved[i], shaved[j])) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  list.forEach((n, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(n);
  });
  return [...groups.values()];
}

/** Last resort for overlapping content: reading order (top-down, then start-side). */
function readingStack(list, u, depth) {
  const sorted = list.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return { kind: 'stack', children: sorted.map((n) => leafOrFlow(n, u, depth + 1)).filter(Boolean) };
}

function leafOrFlow(n, u, depth) {
  if (n.type === '__panel') return n.panel;
  if (n.type === 'group') {
    // a designer's group: its members still need a layout of their own
    const kids = tidy(n.children || [], CTX.report, CTX.scale);
    if (kids.length === 1) return leafOrFlow(kids[0], u, depth + 1);
    const tree = cut(kids, u, depth + 1);
    if (tree) tree.group = n;
    return tree;
  }
  if (n.type === 'frame') return flowTree(n, u, depth + 1);
  return { kind: 'leaf', item: n };
}

/**
 * A collage: many pictures thrown over each other (a portfolio wall) cannot be
 * cut into rows — every cut runs through a photo. Read it as what it is: the
 * words (in reading order), then the pictures as one gallery.
 * @returns {object|null} a tree, or null when the items are not a collage
 */
function collageTree(items, u) {
  const media = items.filter((n) => (n.type === 'image' && n.src && !(n.svg && n.w <= T.iconMax * u)) || (n.type === 'video' && n.src));
  const words = items.filter((n) => n.type === 'text' || n.type === 'button');
  if (media.length < 5 || media.length < words.length * 2) return null;
  const overlapping = media.filter((a) => media.some((b) => {
    if (a === b) return false;
    const i = P.intersection(a, b);
    return i && P.area(i) > 0.08 * Math.min(P.area(a), P.area(b));
  }));
  if (overlapping.length < media.length * 0.3) return null;
  const rest = items.filter((n) => !media.includes(n) && !words.includes(n));
  const byReading = (a, b) => (a.y - b.y) || (a.x - b.x);
  const children = words.concat(rest.filter((n) => n.type === 'group' || n.type === 'frame')).sort(byReading).map((n) => leafOrFlow(n, u, 1)).filter(Boolean);
  children.push({ kind: 'wall', items: media.slice().sort(byReading) });
  return { kind: 'stack', children };
}

// ── layout: Figma's auto-layout, read as intent ───────────────────────────

function flowTree(frame, u, depth) {
  const kids = frame.layout && frame.layout.mode && frame.layout.mode !== 'none'
    ? mergeButtons(dropEchoes((frame.children || []).filter(Boolean), CTX.report)) // auto-layout already orders the words
    : tidy((frame.children || []).filter(Boolean), CTX.report, CTX.scale);
  const mode = frame.layout && frame.layout.mode;
  const fillColor = shapeColor(frame);
  const hasFill = !!(fillColor || (frame.fill && (frame.fill.image || frame.fill.gradient)));
  let tree;
  if (!kids.length) {
    if (frame.fill && frame.fill.image && frame.fill.image.src) {
      return { kind: 'leaf', item: { type: 'image', id: frame.id, x: frame.x, y: frame.y, w: frame.w, h: frame.h, z: frame.z, src: frame.fill.image.src, fit: frame.fill.image.fit || 'cover', radius: frame.radius, alt: frame.alt || frame.name || '', link: frame.link, anim: frame.anim, mobile: frame.mobile } };
    }
    return null;
  }
  if (mode === 'column') {
    tree = { kind: 'stack', children: kids.map((k) => leafOrFlow(k, u, depth + 1)).filter(Boolean) };
  } else if (mode === 'row') {
    const rowKids = kids.slice().sort((a, b) => a.x - b.x);
    tree = rowKids.length === 1
      ? leafOrFlow(rowKids[0], u, depth + 1)
      : { kind: 'row', cols: rowKids.map((k) => ({ box: { x: k.x, y: k.y, w: k.w, h: k.h }, node: leafOrFlow(k, u, depth + 1) })).filter((c) => c.node), gapPx: frame.layout.gap };
  } else if (mode === 'grid') {
    const perRow = Math.max(1, Math.min(6, frame.layout.columns || Math.round(frame.w / (kids[0].w || frame.w)) || 3));
    const ordered = kids.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    tree = { kind: 'grid', perRow, cells: ordered.map((k) => ({ box: { x: k.x, y: k.y, w: k.w, h: k.h }, node: leafOrFlow(k, u, depth + 1) })).filter((c) => c.node) };
  } else {
    tree = cut(kids, u, depth + 1);
  }
  if (tree && hasFill && depth > 0) {
    return { kind: 'panel', base: frame, child: tree, box: { x: frame.x, y: frame.y, w: frame.w, h: frame.h } };
  }
  if (tree) tree.frame = frame;
  return tree;
}

// ── emission: tree → Tapuz blocks ─────────────────────────────────────────

/** A bare in-page anchor ('#page-2') made symbolic, like every other design link. */
function symbolic(href) {
  const s = String(href || '');
  return s.startsWith('#') && s.length > 1 ? 'gp://#' + encodeURIComponent(s.slice(1)) : s;
}

/** A link inside the design, before the target pages have slugs. */
function gpLink(link) {
  if (!link) return '';
  if (link.page || link.anchor) return 'gp://' + encodeURIComponent(link.page || '') + '#' + encodeURIComponent(link.anchor || '');
  return safeUrl(link.href);
}

function nodeHref(node) {
  if (!node || !node.link) return '';
  return node.link.page || node.link.anchor ? gpLink(node.link) : safeUrl(node.link.href);
}

function chrome(block, node) {
  if (!node) return block;
  if (node.anim && ['fade', 'rise', 'zoom'].includes(node.anim)) block.data.animate = node.anim;
  if (node.mobile && node.mobile.hidden) block.data.style = Object.assign({}, block.data.style, { hideOn: 'mobile' });
  return block;
}

function leafItems(tree) {
  const out = [];
  const walk = (t) => {
    if (!t) return;
    if (t.kind === 'leaf') out.push(t.item);
    else if (t.kind === 'stack') t.children.forEach(walk);
    else if (t.kind === 'row') t.cols.forEach((c) => walk(c.node));
    else if (t.kind === 'grid') t.cells.forEach((c) => walk(c.node));
    else if (t.kind === 'panel') { out.push({ type: '__base', base: t.base }); walk(t.child); }
  };
  walk(tree);
  return out;
}

/** The link a designer put on a whole cell (a Figma card frame's click, a Canva group's link). */
function cellLink(t) {
  if (!t) return null;
  if (t.frame && t.frame.link) return t.frame.link;
  if (t.group && t.group.link) return t.group.link;
  if (t.kind === 'panel' && t.base && t.base.link) return t.base.link;
  return null;
}

function treeBox(t) {
  if (!t) return { x: 0, y: 0, w: 0, h: 0 };
  if (t.box) return t.box;
  const items = leafItems(t).map((it) => (it.type === '__base' ? it.base : it));
  return P.unionBox(items);
}

/**
 * A grid read column-first: every column is a stack of k whole cells whose
 * rows line up across the columns (a 2×3 wall of cards cut at its widest
 * gutter first). Read it back row by row, so each row can be recognized as
 * cards / team / stats. Returns rows of { box, node } or null.
 */
function transposeGrid(cols) {
  if (cols.length < 2 || !cols.every((c) => c.node && c.node.kind === 'stack')) return null;
  const k = cols[0].node.children.length;
  if (k < 2 || !cols.every((c) => c.node.children.length === k)) return null;
  const cells = cols.map((c) => c.node.children.map((ch) => ({ node: ch, box: treeBox(ch) })));
  for (let i = 0; i < k; i++) {
    const row = cells.map((col) => col[i]);
    const top = Math.max(...row.map((r) => r.box.y));
    const bottom = Math.min(...row.map((r) => r.box.y + r.box.h));
    if (bottom <= top) return null; // row i does not line up across the columns
    // a cell is a whole thing (a picture with words), not a lone line of text
    if (!row.every((r) => leafItems(r.node).length >= 2)) return null;
  }
  const rows = [];
  for (let i = 0; i < k; i++) rows.push(cells.map((col) => col[i]));
  return rows;
}

function isNumberish(s) {
  return /^[\s$€£₪¥+~≈<>]*[\d][\d.,\s]*([kKmMbB]|%|\+|x|×)?\+?\s*$/.test(String(s || '').trim());
}

class Emitter {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = ctx.id;
    this.report = ctx.report;
    this.h1Done = false;
  }

  emit(tree, depth = 0, colW = null) {
    if (!tree) return [];
    switch (tree.kind) {
      case 'leaf': return this.leaf(tree.item, depth, colW);
      case 'stack': return this.pictureRuns(tree.children.flatMap((c) => this.emit(c, depth, colW)), depth);
      case 'wall': return this.wall(tree, depth);
      case 'row': return this.row(tree, depth);
      case 'grid': return this.grid(tree, depth);
      case 'panel': return this.panel(tree, depth, colW);
      default: return [];
    }
  }

  // text / image / video / button / line / embed
  leaf(n, depth, colW) {
    const ctx = this.ctx;
    const linkOf = (href) => safeUrl(href && String(href).startsWith('#') ? 'gp://#' + encodeURIComponent(href.slice(1)) : href);
    if (n.type === 'text') {
      const txt = P.plainText(n);
      if (!txt) return [];
      // a link on the whole text box (not on a run) links all of its words
      const boxHref = nodeHref(n);
      if (boxHref && !(n.paragraphs || []).some((p) => (p.runs || []).some((r) => r.href))) {
        n = Object.assign({}, n, { paragraphs: n.paragraphs.map((p) => Object.assign({}, p, { runs: (p.runs || []).map((r) => Object.assign({}, r, { href: boxHref })) })) });
      }
      const kind = classifyText(n, ctx.scale);
      const align = alignOf(n, ctx);
      const st = P.dominantStyle(n);
      const style = {};
      if (st.color && ctx.sectionText && P.toHex(st.color) && P.colorDistance(P.toHex(st.color), P.toHex(ctx.sectionText) || '#000000') > 48 && safeColor(st.color)) style.color = safeColor(st.color);
      const fact = { kind: kind.kind, level: 0, size: st.size, color: st.color, font: st.font, chars: txt.length, upper: st.upper, weight: st.weight, section: ctx.sectionIndex, page: ctx.pageIndex };
      ctx.facts.texts.push(fact);
      let block;
      if (kind.kind === 'heading') {
        let level = kind.level;
        if (level === 1) { if (this.h1Done) level = 2; else this.h1Done = true; }
        fact.level = level;
        const text = headingText(n, linkOf);
        block = { type: 'heading', id: this.id('heading'), data: { level, text } };
        this.report.headings += 1;
      } else if (kind.kind === 'list') {
        const items = (n.paragraphs || [])
          .map((p) => runsToInline(p.runs, st, linkOf).replace(/^\s*[•·●▪–—*-]\s*/, '').trim())
          .filter(Boolean)
          .map((t) => ({ text: t }));
        block = { type: 'list', id: this.id('list'), data: { ordered: !!kind.ordered, items } };
      } else {
        const content = bodyContent(n, linkOf);
        block = { type: 'text', id: this.id('text'), data: { content } };
        if (kind.kind === 'kicker') { block.data.size = 'sm'; style.fontWeight = 'bold'; }
        else if (kind.size) block.data.size = kind.size;
      }
      if (align && align !== 'start') block.data.align = align;
      if (Object.keys(style).length) block.data.style = style;
      return [chrome(block, n)];
    }
    if (n.type === 'button') {
      if (!n.label) return [];
      if (!n.href || n.href === '#') {
        // a pill with no link is a LABEL (a badge, a tag) — a button that goes
        // nowhere would be a lie; the words keep the pill's look
        const style = { radius: n.radius || 'lg', padding: 'sm' };
        if (safeColor(n.bg)) style.background = safeColor(n.bg);
        if (safeColor(n.fg)) style.color = safeColor(n.fg);
        if (n.outline && safeColor(n.border)) { style.border = 'sm'; style.borderColor = safeColor(n.border); }
        const al = ctx.alignFor(n);
        const block = { type: 'text', id: this.id('text'), data: { content: guardMarks(n.label), style } };
        if (al !== 'start') block.data.align = al;
        return [chrome(block, n)];
      }
      const variant = n.outline ? 'outline' : 'primary';
      const style = {};
      if (safeColor(n.bg)) style.background = safeColor(n.bg);
      if (safeColor(n.fg)) style.color = safeColor(n.fg);
      if (n.outline && safeColor(n.border)) { style.border = 'sm'; style.borderColor = safeColor(n.border); }
      if (n.radius) style.radius = n.radius;
      ctx.facts.buttons.push({ bg: n.bg, fg: n.fg, radius: n.radius, outline: n.outline, h: n.h });
      const block = { type: 'button', id: this.id('button'), data: { text: n.label, url: n.href || '#', variant } };
      if (Object.keys(style).length) block.data.style = style;
      if (/^https?:/i.test(n.href) && !this.ctx.isSameSite(n.href)) block.data.target = '_blank';
      const al = ctx.alignFor(n);
      if (al !== 'start') block.data.align = al;
      this.report.buttons += 1;
      return [chrome(block, n)];
    }
    if (n.type === 'image') {
      if (!n.src) return [];
      const unlinked = !n.link;
      if (n.role === 'decoration' || /decorative/i.test(n.role || '')) { this.report.dropped.push('decoration'); return []; }
      if (n.svg && unlinked && n.w <= T.iconMax * ctx.u && n.h <= T.iconMax * ctx.u) { this.report.dropped.push('small icon'); return []; }
      if (Math.abs(n.rotate || 0) > 12 && n.svg) { this.report.dropped.push('rotated sticker'); return []; }
      const data = { src: n.src, alt: String(n.alt || '').slice(0, 200) };
      const href = nodeHref(n);
      if (href) data.link = href;
      const w = n.w / ctx.u;
      const limit = colW ? colW / ctx.u : ctx.width / ctx.u;
      if (w < limit * 0.8) data.width = w <= 260 ? 'sm' : w <= 460 ? 'md' : w <= 680 ? 'lg' : 'full';
      const block = { type: 'image', id: this.id('image'), data };
      if (n.mask === 'circle' || (n.radius && n.radius >= Math.min(n.w, n.h) / 2 - 1)) block.data.className = 'gp-circle';
      else if (n.radius) { const r = radiusName(n.radius, n.h); if (r) block.data.style = { radius: r }; }
      this.report.images += 1;
      ctx.facts.images += 1;
      return [chrome(block, n)];
    }
    if (n.type === 'video') {
      if (!n.src) return [];
      const autoplay = !!n.autoplay;
      const data = { src: n.src, controls: !autoplay };
      if (n.poster) data.poster = n.poster;
      if (autoplay) { data.autoplay = true; data.muted = true; data.loop = n.loop !== false; }
      this.report.videos += 1;
      return [chrome({ type: 'video', id: this.id('video'), data }, n)];
    }
    if (n.type === 'embed') {
      const url = safeUrl(n.url);
      if (!url) return [];
      this.report.embeds += 1;
      return [chrome({ type: 'embed', id: this.id('embed'), data: { url } }, n)];
    }
    if (n.type === 'line') {
      const horizontal = n.w >= n.h * 4;
      if (horizontal && n.w >= (colW || ctx.width) * 0.25) return [{ type: 'divider', id: this.id('divider'), data: { bentStyle: (n.width || 1) >= 3 ? 'thick' : 'line', style: 'solid' } }];
      this.report.dropped.push('line');
      return [];
    }
    if (n.type === 'shape') {
      this.report.dropped.push('shape');
      return [];
    }
    return [];
  }

  /**
   * A run of three or more plain pictures in a column is a GALLERY, and two
   * or more clips in a row are a row of clips — a person scrolling a phone
   * past twelve full-width photos one by one would call it broken.
   */
  pictureRuns(blocks, depth) {
    const out = [];
    let run = [];
    const flush = () => {
      if (run.length >= 3 && run.every((b) => b.type === 'image')) {
        out.push(this.gallery(run.map((b) => ({ src: b.data.src, alt: b.data.alt || '' }))));
      } else if (run.length >= 2 && run.every((b) => b.type === 'video') && depth < T.maxDepth) {
        out.push(...this.clipRows(run));
      } else out.push(...run);
      run = [];
    };
    for (const b of blocks) {
      const plainImage = b.type === 'image' && !b.data.link && !b.data.className;
      const kind = plainImage ? 'image' : b.type === 'video' ? 'video' : '';
      if (kind && (!run.length || run[0].type === kind)) { run.push(b); continue; }
      flush();
      if (kind) run.push(b); else out.push(b);
    }
    flush();
    return out;
  }

  gallery(images) {
    const n = images.length;
    this.report.patterns.push('gallery');
    return { type: 'gallery', id: this.id('gallery'), data: { columns: n >= 8 ? 4 : n === 4 ? 2 : 3, images } };
  }

  clipRows(videos) {
    const rows = [];
    for (let i = 0; i < videos.length; i += 2) {
      const pair = videos.slice(i, i + 2);
      if (pair.length === 1) { rows.push(pair[0]); continue; }
      this.report.rows += 1;
      rows.push({ type: 'columns', id: this.id('columns'), data: { columns: pair.map((v) => ({ blocks: [v] })), gap: 'md' } });
    }
    return rows;
  }

  // a collage: its words first, then its pictures as one gallery (and its clips in rows)
  wall(tree, depth) {
    const images = tree.items.filter((n) => n.type === 'image');
    const videos = tree.items.filter((n) => n.type === 'video');
    const out = [];
    if (images.length) {
      images.forEach(() => { this.report.images += 1; this.ctx.facts.images += 1; });
      out.push(images.length >= 3 ? this.gallery(images.map((n) => ({ src: n.src, alt: String(n.alt || '').slice(0, 200) })))
        : images.flatMap((n) => this.leaf(n, depth)));
    }
    if (videos.length) {
      const blocks = videos.flatMap((n) => this.leaf(n, depth));
      out.push(...(blocks.length >= 2 ? this.clipRows(blocks) : blocks));
    }
    return out.flat();
  }

  // a slab with words on it / a photo with a title over it
  panel(tree, depth, colW) {
    const base = tree.base;
    const isImage = base.type === 'image' || (base.fill && base.fill.image && base.fill.image.src);
    const baseSrc = base.type === 'image' ? base.src : isImage ? base.fill.image.src : '';
    // a glyph stacked on itself (a sticker with a smaller copy inside) is decoration
    const innerLeaves = leafItems(tree.child);
    if (isImage && innerLeaves.length && innerLeaves.every((it) => it.type === 'image' && it.src === baseSrc)) {
      this.report.dropped.push('decoration');
      return [];
    }
    const inner = this.emit(tree.child, depth + 1, tree.box.w);
    if (!inner.length) return base.type === 'image' ? this.leaf(base, depth, colW) : [];
    // a picture in a picture frame (Canva's decorative frame around a photo):
    // the photo is the content, the frame is decoration
    const hasWords = innerLeaves.some((it) => it.type === 'text' || it.type === 'button');
    const innerPics = innerLeaves.filter((it) => it.type === 'image');
    if (isImage && !hasWords && innerPics.length && innerPics.some((it) => P.area(it) >= 0.3 * P.area(tree.box))) {
      this.report.dropped.push('frame');
      return inner;
    }
    const big = tree.box.w >= this.ctx.width * 0.4 && tree.box.h >= 180 * this.ctx.u;
    if (isImage && (!hasWords || !big)) {
      return (base.type === 'image' ? this.leaf(base, depth, colW) : []).concat(inner);
    }
    if (isImage) {
      const src = base.type === 'image' ? base.src : base.fill.image.src;
      const data = { image: src, overlay: 0, height: tree.box.h >= tree.box.w * 0.6 ? 'lg' : 'md', blocks: inner };
      const light = inner.some((b) => b.data && b.data.style && b.data.style.color && !P.isDark(b.data.style.color));
      if (light) data.overlay = 30;
      this.report.backdrops += 1;
      this.ctx.facts.images += 1;
      return [chrome({ type: 'parallax', id: this.id('parallax'), data }, base)];
    }
    const bg = shapeColor(base) || (base.fill && safeGradient(base.fill.gradient)) || null;
    const style = { padding: 'lg' };
    if (bg) style.background = bg;
    const r = radiusName(base.radius, base.h);
    if (r) style.radius = r;
    if (base.stroke && safeColor(base.stroke.color)) { style.border = 'sm'; style.borderColor = safeColor(base.stroke.color); }
    const txt = inner.find((b) => b.data && b.data.style && b.data.style.color);
    if (bg && P.parseColor(bg) && txt) style.color = txt.data.style.color;
    this.ctx.facts.panels.push({ bg, radius: r });
    this.report.cards += 1;
    return [chrome({ type: 'card', id: this.id('card'), data: { blocks: inner, style } }, base)];
  }

  // columns — or a pattern that a person would call by its name
  row(tree, depth) {
    const cols = tree.cols.filter((c) => c.node);
    if (!cols.length) return [];
    if (cols.length === 1) return this.emit(cols[0].node, depth, cols[0].box.w);
    const grid = transposeGrid(cols);
    if (grid) return grid.flatMap((r) => this.row({ kind: 'row', cols: r }, depth));
    const pattern = this.rowPattern(cols.map((c) => c.node), cols.map((c) => c.box));
    if (pattern) return pattern;
    if (depth >= T.maxDepth) return cols.flatMap((c) => this.emit(c.node, depth, c.box.w));
    if (cols.length > 6) {
      const chunks = [];
      for (let i = 0; i < cols.length; i += 4) chunks.push(cols.slice(i, i + 4));
      return chunks.flatMap((ch) => this.row({ kind: 'row', cols: ch }, depth));
    }
    const built = cols.map((c) => ({ box: c.box, blocks: this.emit(c.node, depth + 1, c.box.w) })).filter((c) => c.blocks.length);
    if (!built.length) return [];
    if (built.length === 1) return built[0].blocks;
    const widths = built.map((c) => c.box.w);
    const total = widths.reduce((a, b) => a + b, 0) || 1;
    const pct = widths.map((w) => Math.max(8, Math.round((w / total) * 20) * 5));
    const equal = Math.max(...widths) / Math.max(1, Math.min(...widths)) < 1.15;
    const gaps = [];
    for (let i = 1; i < built.length; i++) gaps.push(built[i].box.x - (built[i - 1].box.x + built[i - 1].box.w));
    const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length / this.ctx.u : 30;
    // an RTL page lays its first column out on the RIGHT: hand the columns over
    // right-to-left so the picture the designer put on the left stays there
    const rtl = this.ctx.dir === 'rtl';
    const ordered = rtl ? built.slice().reverse() : built;
    const data = { columns: ordered.map((c) => ({ blocks: c.blocks })) };
    if (!equal) data.ratio = (rtl ? pct.slice().reverse() : pct).join(':');
    data.gap = avgGap < 18 ? 'sm' : avgGap > 72 ? 'lg' : 'md';
    const tops = built.map((c) => c.box.y);
    const mids = built.map((c) => c.box.y + c.box.h / 2);
    const spread = (a) => Math.max(...a) - Math.min(...a);
    if (spread(tops) > 16 * this.ctx.u && spread(mids) <= 16 * this.ctx.u) data.valign = 'center';
    this.report.rows += 1;
    return [{ type: 'columns', id: this.id('columns'), data }];
  }

  grid(tree, depth) {
    const cells = tree.cells.filter((c) => c.node);
    // a pattern's items read each grid row right-to-left on an RTL page; the
    // row fallback below mirrors on its own (row())
    let reading = cells;
    if (this.ctx.dir === 'rtl') {
      const rows = [];
      for (let i = 0; i < cells.length; i += tree.perRow) rows.push(cells.slice(i, i + tree.perRow).reverse());
      reading = rows.flat();
    }
    const pattern = this.rowPattern(reading.map((c) => c.node), reading.map((c) => c.box), tree.perRow);
    if (pattern) return pattern;
    const out = [];
    for (let i = 0; i < cells.length; i += tree.perRow) {
      out.push(...this.row({ kind: 'row', cols: cells.slice(i, i + tree.perRow) }, depth));
    }
    return out;
  }

  /**
   * Cards, team, stats, gallery, logos, social — when every cell of a row
   * says the same thing, the row has a name.
   */
  rowPattern(nodes, boxes, perRow) {
    const ctx = this.ctx;
    // RTL: the first item of a row is the one on the right (see row())
    if (ctx.dir === 'rtl' && !perRow) { nodes = nodes.slice().reverse(); boxes = boxes.slice().reverse(); }
    const cells = nodes.map((n) => leafItems(n));
    const n = cells.length;
    if (n < 2) return null;
    const flat = cells.flat();
    const onlyImages = flat.length && flat.every((it) => it.type === 'image' && it.src);
    // pictures only
    if (onlyImages) {
      const small = flat.every((it) => it.w <= 200 * ctx.u && it.h <= 120 * ctx.u);
      const linkedSocial = flat.every((it) => it.link && socialNetwork(it.link.href));
      if (linkedSocial && small) return [this.social(flat.map((it) => ({ href: it.link.href, label: it.alt || '' })))];
      if (small && flat.length >= 4 && !flat.some((it) => it.svg && it.w < 40 * ctx.u)) {
        this.report.patterns.push('logos');
        return [{ type: 'logos', id: this.id('logos'), data: { items: flat.map((it) => ({ src: it.src, alt: it.alt || '', url: nodeHref(it) })) } }];
      }
      if (flat.length >= 3) {
        const cols = Math.max(2, Math.min(4, perRow || n));
        flat.forEach(() => { ctx.facts.images += 1; this.report.images += 1; });
        this.report.patterns.push('gallery');
        return [{ type: 'gallery', id: this.id('gallery'), data: { columns: cols, images: flat.map((it) => ({ src: it.src, alt: it.alt || '' })) } }];
      }
      return null;
    }
    // little linked words or icons pointing at social profiles
    const allLinkedSmall = flat.length >= 2 && flat.every((it) => (it.type === 'image' || it.type === 'text' || it.type === 'button') && (it.link || firstHref(it) || it.href));
    if (allLinkedSmall) {
      const hrefs = flat.map((it) => (it.link && it.link.href) || it.href || firstHref(it));
      if (hrefs.every((h) => socialNetwork(h))) {
        return [this.social(flat.map((it, i) => ({ href: hrefs[i], label: it.type === 'text' ? shownText(it) : it.label || it.alt || '' })))];
      }
    }
    // per-cell shape: [image?] + texts (+ button)
    const shapes = cells.map((items, i) => {
      const imgs = items.filter((it) => it.type === 'image' && it.src && !it.decor && !(it.svg && it.w <= T.iconMax * ctx.u));
      // a clip with a poster is a card's picture too (a Figma site's showcase)
      const clips = items.filter((it) => it.type === 'video' && it.poster);
      const texts = items.filter((it) => it.type === 'text' && shownText(it));
      const buttons = items.filter((it) => it.type === 'button');
      const other = items.filter((it) => !imgs.includes(it) && !clips.includes(it) && !texts.includes(it) && !buttons.includes(it) && it.type !== '__base' && !it.decor && !(it.type === 'image' && it.svg));
      return { imgs, clips, texts, buttons, other, link: cellLink(nodes[i]) };
    });
    const everyCell = (fn) => shapes.every(fn);
    // stats: a big number and a label
    if (everyCell((s) => !s.imgs.length && s.texts.length >= 1 && s.texts.length <= 3 && !s.other.length &&
      isNumberish(shownText(s.texts.slice().sort((a, b) => P.dominantStyle(b).size - P.dominantStyle(a).size)[0])))) {
      const items = shapes.map((s) => {
        const sorted = s.texts.slice().sort((a, b) => P.dominantStyle(b).size - P.dominantStyle(a).size);
        return { value: shownText(sorted[0]).replace(/\s+/g, ' '), label: sorted.slice(1).map((t) => shownText(t)).join(' ').replace(/\s+/g, ' ').trim() || ' ' };
      });
      if (items.every((it) => it.label.trim())) {
        this.report.patterns.push('stats');
        return [{ type: 'stats', id: this.id('stats'), data: { columns: Math.max(2, Math.min(4, n)), items } }];
      }
    }
    // team: a round portrait, a name, a role — people, not round service photos:
    // most cells carry a second line (the role) or every label reads as a name
    const round = (im) => im.mask === 'circle' || (im.radius && im.radius >= Math.min(im.w, im.h) / 2 - 1);
    const personName = (t) => /^\p{Lu}[\p{L}'’.-]+(\s+\p{Lu}[\p{L}'’.-]+){0,3}$/u.test(shownText(t).trim()) || /^[\u0590-\u05ff'"׳״ -]{2,30}$/.test(shownText(t).trim());
    const peopleLike = shapes.filter((s) => s.texts.length >= 2).length >= shapes.length / 2 ||
      shapes.every((s) => s.texts.length && personName(s.texts.slice().sort((a, b) => a.y - b.y)[0]));
    if (n >= 2 && peopleLike && everyCell((s) => s.imgs.length === 1 && round(s.imgs[0]) &&
      s.texts.length >= 1 && s.texts.length <= 3 && !s.other.length)) {
      const items = shapes.map((s) => {
        const [name, ...rest] = s.texts.slice().sort((a, b) => a.y - b.y);
        const role = rest[0] ? shownText(rest[0]).replace(/\s+/g, ' ') : '';
        const bio = rest.slice(1).map((t) => shownText(t)).join(' ').replace(/\s+/g, ' ').trim();
        const item = { name: shownText(name).replace(/\s+/g, ' '), role, image: s.imgs[0].src };
        if (bio) item.bio = bio;
        return item;
      });
      shapes.forEach(() => { ctx.facts.images += 1; this.report.images += 1; });
      this.report.patterns.push('team');
      return [{ type: 'team', id: this.id('team'), data: { items } }];
    }
    // cards: a picture (or a clip's poster), a title, a few words, maybe a
    // small label over the picture (the card's tag) and a link on the whole cell
    const cardMedia = (s) => (s.imgs.length === 1 && !s.clips.length ? s.imgs[0] : !s.imgs.length && s.clips.length === 1 ? s.clips[0] : null);
    const above = (s, m) => s.texts.filter((t) => t.y + t.h <= m.y + 4);
    const below = (s, m) => s.texts.filter((t) => t.y + t.h > m.y + 4);
    if (n >= 2 && everyCell((s) => {
      const m = cardMedia(s);
      if (!m || s.buttons.length > 1 || s.other.length) return false;
      const up = above(s, m);
      const down = below(s, m);
      return down.length >= 1 && down.length <= 4 && up.length <= 1 && up.every((t) => shownText(t).length <= 24);
    })) {
      const items = shapes.map((s) => {
        const m = cardMedia(s);
        const tagNode = above(s, m)[0];
        const texts = below(s, m).sort((a, b) => a.y - b.y);
        const bySize = texts.slice().sort((a, b) => P.dominantStyle(b).size - P.dominantStyle(a).size);
        const titleNode = bySize[0];
        const rest = texts.filter((t) => t !== titleNode);
        const linkOf = (l) => (l ? (l.page || l.anchor ? gpLink(l) : safeUrl(l.href)) : '');
        const href = linkOf(s.link) || (s.buttons[0] && s.buttons[0].href) || nodeHref(m) || firstHref(titleNode) || '';
        const item = { title: shownText(titleNode).replace(/\s+/g, ' '), image: m.type === 'video' ? m.poster : m.src };
        if (tagNode) item.tag = shownText(tagNode).replace(/\s+/g, ' ');
        const excerpt = rest.map((t) => shownText(t)).join(' ').replace(/\s+/g, ' ').trim();
        if (excerpt) item.excerpt = excerpt;
        if (href) item.href = href;
        return item;
      });
      shapes.forEach(() => { ctx.facts.images += 1; this.report.images += 1; });
      this.report.patterns.push('cards');
      const cardsBlock = { type: 'cards', id: this.id('cards'), data: { items } };
      // round pictures stay round (the design's circle frames)
      if (shapes.every((s) => s.imgs.length === 1 && round(s.imgs[0]))) cardsBlock.data.className = 'gp-round-media';
      return [cardsBlock];
    }
    return null;
  }

  social(list) {
    const items = list.map((it) => {
      const network = socialNetwork(it.href) || 'link';
      return { network, url: it.href, label: (it.label || '').trim() || network };
    });
    this.report.patterns.push('social');
    return { type: 'social', id: this.id('social'), data: { items } };
  }
}

function alignOf(n, ctx) {
  const a = P.dominantAlign(n);
  if (a === 'center' || a === 'end' || a === 'justify') return a === 'justify' ? null : a;
  return ctx.alignFor(n);
}

// ── the menu: the row of links at the top of the home page ────────────────

function isNavCandidate(n, bandBottom) {
  if (n.y + n.h > bandBottom) return false;
  if (n.type === 'text') {
    const t = P.plainText(n);
    return t && t.length <= T.navItemMax && t.split('\n').length <= 2 && !!(firstHref(n) || n.link);
  }
  if (n.type === 'button') return n.label && n.label.length <= T.navItemMax && !!n.href;
  return false;
}

/**
 * Take the menu (and the brand) out of the first section of the home page.
 * @returns {{ items: [{label, href}], brand: {text, image}|null, removed: Set }}
 */
function takeNav(items, box, u, siteTitle, opts = {}) {
  // a thin band on top of the page (the design's own header) is chrome as a
  // whole: even ONE link in it is the menu ("Submit a website")
  const bandBottom = opts.thin ? box.h + 1 : Math.min(T.navBandMax * u, box.h * 0.34 + 1);
  const cands = items.filter((n) => isNavCandidate(n, bandBottom));
  if (cands.length < (opts.thin ? 1 : 2)) return null;
  // the links must sit on one line (or one column for a side bar)
  const mids = cands.map((n) => n.y + n.h / 2);
  const oneLine = Math.max(...mids) - Math.min(...mids) <= 26 * u;
  if (!oneLine) return null;
  const sorted = cands.slice().sort((a, b) => a.x - b.x);
  const navItems = sorted.map((n) => ({
    label: cleanLabel(n.type === 'button' ? n.label : shownText(n)),
    href: symbolic(n.type === 'button' ? n.href : (nodeHref(n) || firstHref(n)))
  })).filter((it) => it.label && it.href);
  const removed = new Set(cands);
  // the brand: a short text or a small picture at the start of the same band
  const navTop = Math.min(...cands.map((n) => n.y));
  let brandCand = items
    .filter((n) => !removed.has(n) && n.y + n.h <= bandBottom + 20 * u && (opts.thin || n.y <= navTop + 40 * u))
    .filter((n) => (n.type === 'text' && shownText(n).length <= 48) || (n.type === 'image' && n.h <= 120 * u))
    .sort((a, b) => a.x - b.x)[0];
  let brand = null;
  if (brandCand && brandCand.type === 'text' && !looksLikeName(shownText(brandCand))) brandCand = null;
  if (brandCand) {
    removed.add(brandCand);
    brand = brandCand.type === 'text'
      ? { text: shownText(brandCand).replace(/\s+/g, ' ').trim() }
      : { image: brandCand.src, alt: brandCand.alt || siteTitle || '' };
  }
  return { items: navItems, brand, removed };
}

// ── section containers ────────────────────────────────────────────────────

function heroShaped(blocks, fill) {
  if (!blocks.length || blocks.length > 5) return false;
  const types = blocks.map((b) => b.type);
  if (types.some((t) => !['heading', 'text', 'button', 'image', 'spacer'].includes(t))) return false;
  const headings = blocks.filter((b) => b.type === 'heading');
  if (headings.length !== 1) return false;
  if (blocks.filter((b) => b.type === 'image').length > 1) return false;
  const centered = headings[0].data.align === 'center';
  return !!(fill.image || centered);
}

function heightName(h, w) {
  const r = h / Math.max(1, w);
  if (r >= 0.62) return 'full';
  if (r >= 0.42) return 'lg';
  if (r >= 0.24) return 'md';
  return 'sm';
}

// ── the pass ──────────────────────────────────────────────────────────────

/**
 * Breathe life into a puppet.
 * @param {object} puppet  a validated puppet
 * @param {{ homePath?: string }} [opts]
 * @returns {{ pages: object[], menu: object[], brand: object|null, facts: object, report: object }}
 */
function breathe(puppet, opts = {}) {
  const id = makeIds();
  const report = {
    source: puppet.source, format: puppet.format,
    pages: 0, sections: 0, headings: 0, buttons: 0, images: 0, videos: 0, embeds: 0,
    rows: 0, cards: 0, backdrops: 0, patterns: [], dropped: [], links: 0, notes: (puppet.notes || []).slice()
  };
  const facts = { texts: [], buttons: [], panels: [], images: 0, fills: [], sectionsText: [], widths: [], nav: null, footer: null, fonts: puppet.fonts || {} };
  const origin = puppet.origin || '';
  let originHost = '';
  try { originHost = origin ? new URL(origin).host : ''; } catch (e) { originHost = ''; }
  const isSameSite = (href) => {
    try { return originHost && new URL(href).host === originHost; } catch (e) { return false; }
  };

  const takenSlugs = new Set();
  const pageSlug = new Map(); // page key → slug
  const pagePath = new Map(); // source path → page key
  const anchorMap = new Map(); // page key → Map(source anchor → block id)
  const homeKey = (puppet.pages[0] || {}).key;

  // slugs first, so links can resolve across pages
  puppet.pages.forEach((page, pi) => {
    const pathSlug = slugify(String(page.path || '').replace(/^\/+|\/+$/g, '').replace(/\//g, '-'), '');
    const base = pathSlug || slugify(page.name || page.title, pi === 0 ? 'home' : 'page-' + (pi + 1));
    pageSlug.set(page.key, uniqueSlug(base, takenSlugs));
    pagePath.set(String(page.path || '/').replace(/\/+$/, '') || '/', page.key);
  });

  let menu = null;
  let brand = null;
  const navLabels = new Map(); // source anchor → the menu label that points at it
  const pages = [];

  puppet.pages.forEach((page, pi) => {
    const width = page.width || 1366;
    const u = width / 1366;
    const scale = typeScale(page);
    const anchors = new Map();
    anchorMap.set(page.key, anchors);
    const takenAnchors = new Set();
    const blocks = [];
    const dir = pageDirection(page, puppet.site);
    CTX.report = report;
    CTX.scale = scale;
    const emitter = new Emitter({
      id, report, facts, scale, u, width, pageIndex: pi, isSameSite, dir,
      sectionText: null, sectionIndex: 0,
      alignFor: () => 'start'
    });

    page.sections.forEach((section, si) => {
      report.sections += 1;
      const box = sectionBox(section, width);
      const peeled = peelBackground(section, width);
      let items = tidy(peeled.items, report, scale);

      // the menu lives in the home page's first sections — take it out of the content
      const thin = box.h <= T.navBandMax * u;
      if (pi === 0 && si <= 1 && !menu) {
        const nav = takeNav(items, box, u, puppet.site.title, { thin: thin && si === 0 });
        if (nav && nav.items.length >= (thin && si === 0 ? 1 : 2)) {
          menu = nav.items;
          brand = nav.brand;
          for (const it of menu) {
            const m = /^gp:\/\/[^#]*#(.+)$/.exec(it.href || '');
            if (m && !navLabels.has(decodeURIComponent(m[1]))) navLabels.set(decodeURIComponent(m[1]), it.label);
          }
          facts.nav = { fill: peeled.fill.color, color: null };
          const navText = [...nav.removed].find((n) => n.type === 'text');
          if (navText) facts.nav.color = P.dominantStyle(navText).color;
          items = items.filter((n) => !nav.removed.has(n));
        }
      } else if (menu && si <= 1) {
        // the same menu repeated on another page of the site
        const again = takeNav(items, box, u, puppet.site.title, { thin: thin && si === 0 });
        if (again && again.items.length >= 1 && again.items.filter((it) => menu.some((m) => m.label === it.label)).length >= Math.min(2, again.items.length)) {
          items = items.filter((n) => !again.removed.has(n));
        }
      }

      // the section's dominant text color (what its words mostly wear)
      const colorTally = new Map();
      P.eachNode(items, (n) => {
        if (n.type !== 'text') return;
        const st = P.dominantStyle(n);
        if (!st.color) return;
        colorTally.set(st.color, (colorTally.get(st.color) || 0) + P.plainText(n).length);
      });
      let sectionText = null;
      let bestN = 0; // (sanitized below — a decoder may hand an rgba() string)
      for (const [c, cnt] of colorTally) if (cnt > bestN) { bestN = cnt; sectionText = c; }
      sectionText = safeColor(sectionText);
      emitter.ctx.sectionText = sectionText;
      emitter.ctx.sectionIndex = si;

      // content width (for the theme's column) and horizontal alignment of lone items
      const content = P.unionBox(items);
      if (content.w > 0) facts.widths.push(content.w / u);
      emitter.ctx.alignFor = (n) => {
        const mid = n.x + n.w / 2;
        const left = n.x - box.x;
        const rightGap = box.x + box.w - (n.x + n.w);
        if (Math.abs(mid - box.w / 2) <= box.w * 0.04 && n.w < box.w * 0.9 && Math.abs(left - rightGap) <= box.w * 0.08) return 'center';
        return 'start';
      };

      const tree = section.layout && section.layout.mode && section.layout.mode !== 'none'
        ? flowTree({ type: 'frame', id: section.key, x: 0, y: 0, w: box.w, h: box.h, children: items, layout: section.layout }, u, 0)
        : (collageTree(items, u) || cut(items, u, 0));
      let inner = emitter.emit(tree, 1, box.w);
      if (!inner.length && !peeled.fill.image && !peeled.fill.video) return; // a section that only held the menu or decoration

      // the section's anchor: the menu label that points at it, else its
      // designer's name for it, else its first heading — never "section-3"
      // when a person-readable name exists
      const firstHeading = findBlock(inner, (b) => b.type === 'heading');
      const headWords = firstHeading ? stripMarks(firstHeading.data.text) : '';
      const navName = section.anchor ? navLabels.get(String(section.anchor)) : '';
      const designName = section.name && !/^(frame|group|section|page|rectangle|container|desktop|mobile)[\s_-]*\d*$/i.test(section.name) ? section.name : '';
      const anchorBase = slugify(navName || designName || headWords.split(/\s+/).slice(0, 3).join(' '), 'section-' + (si + 1));
      const anchor = uniqueSlug(anchorBase, takenAnchors);
      if (section.anchor) anchors.set(String(section.anchor), anchor);
      anchors.set(String(section.key), anchor);

      const fill = peeled.fill;
      if (fill.color) facts.fills.push({ color: fill.color, area: box.w * box.h, page: pi, section: si, last: si === page.sections.length - 1 });
      facts.sectionsText.push({ fill: fill.color, text: sectionText, chars: bestN });

      let block;
      const bgImage = fill.image || (fill.video && fill.video.poster) || null;
      if (fill.video && !fill.image) report.notes.push('a video background became its poster picture (section ' + (si + 1) + ')');
      if (pi === 0 && blocks.length === 0 && heroShaped(inner, { image: bgImage })) {
        const data = { blocks: inner, height: heightName(box.h, box.w), width: 'full' };
        if (bgImage) data.image = bgImage;
        if (fill.overlay) data.overlay = Math.min(80, fill.overlay);
        else if (bgImage) data.overlay = 25;
        const style = {};
        if (!bgImage && fill.color) style.background = fill.color;
        if (sectionText) style.color = sectionText;
        if (Object.keys(style).length) data.style = style;
        block = { type: 'hero', id: anchor, data };
        report.patterns.push('hero');
      } else if (bgImage) {
        const data = { image: bgImage, overlay: Math.min(80, fill.overlay || 0), height: heightName(box.h, box.w), width: 'full', blocks: inner };
        if (sectionText) data.style = { color: sectionText };
        block = { type: 'parallax', id: anchor, data };
        report.backdrops += 1;
      } else {
        const style = {};
        if (fill.color) style.background = fill.color;
        else if (fill.gradient) style.background = fill.gradient;
        if (sectionText) style.color = sectionText;
        const data = { blocks: inner, width: 'full' };
        if (Object.keys(style).length) data.style = style;
        block = { type: 'section', id: anchor, data };
      }
      blocks.push(block);
    });

    report.pages += 1;
    pages.push({
      key: page.key,
      path: page.path,
      slug: pageSlug.get(page.key),
      title: page.name || page.title || '',
      seoTitle: page.title || '',
      description: page.description || puppet.site.description || '',
      lang: puppet.site.lang || (dir === 'rtl' ? 'he' : 'en'),
      dir,
      home: page.key === homeKey,
      blocks
    });
  });

  // no brand in a menu band: the site's own title, unless it is a template's
  // name — then the address the owner chose (her-name.my.canva.site)
  if (!brand) {
    const title = String(puppet.site.title || '').trim();
    // "Dana Levi, Realtor - Let's find home" → "Dana Levi"; a
    // title that is a sentence ("Bonjour, je m'appelle Léa !") names nothing
    const cut = title.split(/\s+[-|–—•·:*]\s+|,\s+/)[0].trim();
    const sentence = /[!?]\s*$/.test(title);
    const guess = cut && !sentence && !looksLikeTemplateName(title) && looksLikeName(cut) ? cut : nameFromOrigin(puppet.origin);
    if (guess) brand = { text: guess, guessed: true };
  }

  // the home page is named after the brand the menu band showed — a Canva
  // design's own title is usually the TEMPLATE's name ("Brand Designer
  // Portfolio Website in Beige…"), which no owner wants in her address bar
  if (pages[0] && brand && brand.text && (pages[0].path === '/' || !pages[0].path)) {
    const base = slugify(brand.text, '');
    if (base) {
      takenSlugs.delete(pageSlug.get(pages[0].key));
      const slug = uniqueSlug(base, takenSlugs);
      pageSlug.set(pages[0].key, slug);
      pages[0].slug = slug;
    }
    pages[0].title = brand.text;
  }

  // the footer: the last section of the home page, when it reads like one
  const home = pages[0];
  if (home && home.blocks.length > 1) {
    const last = home.blocks[home.blocks.length - 1];
    const text = JSON.stringify(last.data.blocks || []);
    if (/©|copyright|all rights|כל הזכויות/i.test(text)) facts.footer = { fill: last.data.style && last.data.style.background, color: last.data.style && last.data.style.color };
  }

  // links stay symbolic (gp://<page key>#<anchor>) until the owner lands the
  // import: the final addresses depend on slugs still free on HER site and on
  // whether the home page becomes the site's root — finish() resolves them
  const links = {
    homeKey,
    originHost,
    pageSlug: Object.fromEntries(pageSlug),
    pagePath: Object.fromEntries(pagePath),
    anchors: Object.fromEntries([...anchorMap].map(([k, m]) => [k, Object.fromEntries(m)]))
  };
  report.dropped = tallyList(report.dropped);
  report.patterns = tallyList(report.patterns);
  return { pages, menuRaw: menu, brand, facts, report, links, scale: puppet.pages[0] ? typeScale(puppet.pages[0]) : { body: 16, max: 16 } };
}

/**
 * Resolve the symbolic links of a breathed site into real addresses, and
 * build its menu. Pure: returns deep copies, the living site is untouched,
 * so the preview (plan slugs) and the landing (final slugs) both call it.
 *
 * @param {object} living  the result of breathe()
 * @param {{ slugFor?: (key: string, planSlug: string) => string, homeIsRoot?: boolean }} [opts]
 * @returns {{ pages: object[], menu: {label, url}[], notes: string[], links: number }}
 */
function finish(living, opts = {}) {
  const L = living.links || {};
  const homeKey = L.homeKey;
  const homeIsRoot = opts.homeIsRoot !== false;
  const slugOf = (key) => {
    const planSlug = (L.pageSlug || {})[key];
    if (!planSlug) return '';
    return typeof opts.slugFor === 'function' ? opts.slugFor(key, planSlug) || planSlug : planSlug;
  };
  const anchorsOf = (key) => (L.anchors || {})[key] || {};
  const urlForPage = (key) => {
    const slug = slugOf(key);
    if (!slug) return '';
    return key === homeKey && homeIsRoot ? '/' : '/' + slug + '.html';
  };
  const sameSite = (href) => {
    try { return L.originHost && new URL(href).host === L.originHost; } catch (e) { return false; }
  };
  let count = 0;
  const resolve = (href, currentKey) => {
    const s = String(href || '');
    if (s.startsWith('gp://')) {
      const m = /^gp:\/\/([^#]*)#?(.*)$/.exec(s);
      const key = decodeURIComponent(m[1] || '') || currentKey;
      const anchorSrc = decodeURIComponent(m[2] || '');
      let targetKey = key;
      // an anchor may belong to another page — find who owns it
      if (anchorSrc && !Object.prototype.hasOwnProperty.call(anchorsOf(targetKey), anchorSrc)) {
        for (const k of Object.keys(L.anchors || {})) if (Object.prototype.hasOwnProperty.call(anchorsOf(k), anchorSrc)) { targetKey = k; break; }
      }
      const anchor = anchorSrc ? anchorsOf(targetKey)[anchorSrc] || '' : '';
      count += 1;
      if (targetKey === currentKey) return anchor ? '#' + anchor : (urlForPage(targetKey) || '#');
      return (urlForPage(targetKey) || '/') + (anchor ? '#' + anchor : '');
    }
    // an absolute link to another page of the same source site
    if (sameSite(s)) {
      try {
        const u = new URL(s);
        const key = (L.pagePath || {})[u.pathname.replace(/\/+$/, '') || '/'];
        if (key) {
          const hash = u.hash ? decodeURIComponent(u.hash.slice(1)) : '';
          const anchor = hash ? anchorsOf(key)[hash] || '' : '';
          count += 1;
          if (key === currentKey) return anchor ? '#' + anchor : '#';
          return urlForPage(key) + (anchor ? '#' + anchor : '');
        }
      } catch (e) { /* keep as is */ }
    }
    return s;
  };
  const inText = (str, key) => String(str).replace(/@LINK\(url: "([^"]*)"\)/g, (m, u) => `@LINK(url: "${resolve(u, key).replace(/"/g, '%22')}")`);
  const fixBlocks = (list, key) => {
    for (const b of list || []) {
      const d = b.data || {};
      for (const f of ['url', 'link', 'href', 'buttonUrl']) {
        if (typeof d[f] === 'string' && d[f]) d[f] = resolve(d[f], key);
      }
      for (const f of ['text', 'content']) {
        if (typeof d[f] === 'string' && d[f].includes('@LINK')) d[f] = inText(d[f], key);
      }
      for (const it of d.items || []) {
        if (it && typeof it === 'object') {
          for (const f of ['url', 'href']) if (typeof it[f] === 'string' && it[f]) it[f] = resolve(it[f], key);
          if (typeof it.text === 'string' && it.text.includes('@LINK')) it.text = inText(it.text, key);
        }
      }
      if (Array.isArray(d.blocks)) fixBlocks(d.blocks, key);
      if (Array.isArray(d.columns)) d.columns.forEach((c) => fixBlocks(c.blocks, key));
    }
  };
  const pages = JSON.parse(JSON.stringify(living.pages || []));
  for (const p of pages) {
    p.slug = slugOf(p.key) || p.slug;
    fixBlocks(p.blocks, p.key);
  }

  // the menu: resolved links; a design with no menu gets one from its pages or its sections
  const notes = [];
  let menu = [];
  if (living.menuRaw && living.menuRaw.length) {
    menu = living.menuRaw.map((it) => ({ label: it.label, url: resolve(it.href, homeKey) }))
      .map((it) => (it.url.startsWith('#') ? { label: it.label, url: (homeIsRoot ? '/' : urlForPage(homeKey)) + it.url } : it))
      .filter((it) => it.label && it.url);
  } else if (pages.length > 1) {
    menu = pages.map((p) => ({ label: p.title || p.slug, url: urlForPage(p.key) }));
    notes.push('לעיצוב לא היה תפריט — נבנה תפריט מהדפים שלו');
  } else if (pages.length === 1) {
    // a one-page design without a menu gets one from its SECTION TITLES — but
    // only when they read like a menu (short, distinct, real words, level-2
    // titles); a heading like "J" or "BEFORE" twice is not navigation, and no
    // menu is better than a wrong one
    const seen = new Set();
    const named = pages[0].blocks
      .filter((b) => ['section', 'parallax', 'hero'].includes(b.type) && b.id)
      .map((b) => {
        const h = findBlock(b.data.blocks || [], (k) => k.type === 'heading');
        return { label: h && h.data.level <= 2 ? cleanLabel(stripMarks(h.data.text)) : '', url: (homeIsRoot ? '/' : urlForPage(homeKey)) + '#' + b.id };
      })
      .filter((it) => {
        const l = it.label;
        if (!l || l.length < 3 || l.length > 22 || l.split(/\s+/).length > 3) return false;
        if ((l.match(/\p{L}/gu) || []).length < 3 || /[!?]$/.test(l)) return false;
        if (/^(the|and|of|le|la|les|de|des|der|die|das|el|los|il|una?|ein|eine)$/i.test(l)) return false;
        const k = l.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    if (named.length >= 3) {
      menu = named.slice(0, 6);
      notes.push('לעיצוב לא היה תפריט — נבנה תפריט מהכותרות של האזורים');
    }
  }
  return { pages, menu, notes, links: count };
}

/** Depth-first search through a block tree (section/card blocks, row columns). */
function findBlock(list, pred) {
  for (const b of list || []) {
    if (pred(b)) return b;
    const d = b.data || {};
    const inBlocks = findBlock(d.blocks, pred);
    if (inBlocks) return inBlocks;
    for (const c of Array.isArray(d.columns) ? d.columns : []) {
      const inCol = findBlock(c && c.blocks, pred);
      if (inCol) return inCol;
    }
  }
  return null;
}

/**
 * The page's direction: what the design declares, else what its words are
 * written in — a Canva site in Hebrew rarely says dir="rtl" anywhere.
 */
function pageDirection(page, site) {
  if (site && (site.dir === 'rtl' || site.dir === 'ltr')) return site.dir;
  if (site && /^(he|iw|ar|fa|ur|yi)\b/i.test(site.lang || '')) return 'rtl';
  let rtl = 0;
  let ltr = 0;
  for (const sec of page.sections || []) {
    P.eachNode(sec.nodes, (n) => {
      if (n.type !== 'text') return;
      const t = P.plainText(n);
      rtl += (t.match(/[\u0590-\u05ff\u0600-\u06ff]/g) || []).length;
      ltr += (t.match(/[A-Za-z\u00c0-\u024f]/g) || []).length;
    });
  }
  return rtl > ltr ? 'rtl' : 'ltr';
}

/** A menu label: one line, without the punctuation a designer hung on it. */
function cleanLabel(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/^[\s•·●▪\-–—|/]+|[\s;:,.·•|/\-–—]+$/g, '').trim();
}

/**
 * A Canva design is often still named after its TEMPLATE ("Brand Designer
 * Portfolio Website in Beige Black Bronze Warm Classic Style") — a site
 * name no owner chose. The address she DID choose (her-name.my.canva.site)
 * names the site better.
 */
function looksLikeTemplateName(title) {
  const t = String(title || '');
  const words = t.split(/\s+/).filter(Boolean).length;
  return words >= 5 && /\b(website|web site|landing page|template|portfolio|resume|cv|presentation|in (?:beige|black|white|blue|green|pink|brown|purple|red|yellow|gray|grey))\b/i.test(t);
}

/** A site's name is a few words, not a sentence ("Bonjour, je m'appelle Léa !"). */
function looksLikeName(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 40) return false;
  if (t.split(' ').length > 5) return false;
  if (/[!?]\s*$/.test(t) || /,.*,/.test(t)) return false;
  return true;
}

function nameFromOrigin(origin) {
  let host = '';
  try { host = new URL(origin).hostname.toLowerCase(); } catch (e) { return ''; }
  host = host.replace(/^www\./, '');
  const parts = host.split('.');
  const label = /\.(my\.canva\.site|figma\.site|canva\.site)$/.test(host) ? parts[0] : parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  if (!label || /^[a-z]+-[a-z]+-\d{5,}$/.test(label)) return ''; // a generated name (quiet-lamp-12345678)
  return label.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function stripMarks(s) {
  return String(s || '').replace(/@\w+(\([^)]*\))?\{([^}]*)\}/g, '$2').replace(/\s+/g, ' ').trim();
}

function tallyList(list) {
  const out = {};
  for (const x of list || []) out[x] = (out[x] || 0) + 1;
  return out;
}

module.exports = {
  breathe,
  finish,
  // exported for the smoke — the pieces a reviewer will want to poke at
  classifyText,
  typeScale,
  splitAxis,
  cut,
  mergeButtons,
  dropEchoes,
  mergeFragments,
  peelBackground,
  bodyContent,
  headingText,
  runsToInline,
  socialNetwork,
  slugify,
  safeGradient,
  safeColor,
  cleanLabel,
  pageDirection,
  looksLikeTemplateName,
  looksLikeName,
  nameFromOrigin,
  T
};
