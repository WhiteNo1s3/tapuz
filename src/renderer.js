const fs = require('fs');
const path = require('path');

const { THEMES_DIR } = require('./paths');
const { loadConfig } = require('./config');
const { getMenu } = require('./menus');
const { loadOverrides, overridesToCss } = require('./theme');
const { sanitizeHtmlFragment } = require('./html-sanitize');

function loadTheme(themeSlug = 'default') {
  const themeDir = path.join(THEMES_DIR, themeSlug);
  const jsonPath = path.join(themeDir, 'theme.json');
  const theme = fs.existsSync(jsonPath) 
    ? JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    : { slug: 'default', name: 'Default' };
  theme.dir = themeDir;
  return theme;
}

function loadLayout(themeDir, layoutName = 'default') {
  const layoutPath = path.join(themeDir, 'layouts', `${layoutName}.html`);
  if (fs.existsSync(layoutPath)) {
    return fs.readFileSync(layoutPath, 'utf8');
  }
  return `<!DOCTYPE html><html lang="{{lang}}" dir="{{direction}}"><head><title>{{title}}</title></head><body><main>{{content}}</main></body></html>`;
}

/** Raw inline-style declarations (no `style="…"` wrapper), or '' when none. */
function styleDecls(data) {
  const s = data?.style || {};
  const parts = [];
  if (data?.align === 'center') parts.push('text-align:center');
  else if (data?.align === 'end') parts.push('text-align:end');
  else if (data?.align === 'start') parts.push('text-align:start');
  if (s.color) parts.push(`color:${escapeHtml(s.color)}`);
  if (s.background) parts.push(`background:${escapeHtml(s.background)}`);
  if (s.fontSize === 'sm') parts.push('font-size:0.9em');
  if (s.fontSize === 'lg') parts.push('font-size:1.15em');
  if (s.padding === 'sm') parts.push('padding:0.35rem 0.5rem');
  if (s.padding === 'md') parts.push('padding:0.75rem 1rem');
  if (s.padding === 'lg') parts.push('padding:1.25rem 1.5rem');
  if (s.radius === 'sm') parts.push('border-radius:6px');
  if (s.radius === 'md') parts.push('border-radius:12px');
  if (s.radius === 'lg') parts.push('border-radius:20px');
  return parts.join(';');
}

function styleAttr(data) {
  const decls = styleDecls(data);
  return decls ? ` style="${decls}"` : '';
}

/**
 * Escape a URL for a CSS url('…') string that lives inside an HTML style="…"
 * attribute. HTML-entity escaping is WRONG here: the HTML parser decodes it
 * back before the CSS parser runs, so a single quote would still break out of
 * url('…'). We escape the CSS-dangerous characters as CSS hex escapes instead,
 * which neutralizes breakout while keeping legitimate URLs working.
 */
function cssUrl(value) {
  return String(value == null ? '' : value)
    .replace(/[\r\n\f]/g, '')
    .replace(/[\\'"()<>]/g, (c) => '\\' + c.charCodeAt(0).toString(16) + ' ');
}

const ANIMATE_VALUES = new Set(['fade', 'rise']);

/** Neutralize executable URL schemes on any clickable link (public render). */
function safeHref(url) {
  const s = String(url == null ? '' : url).trim();
  if (/^(?:javascript|data|vbscript):/i.test(s)) return '#';
  return s || '#';
}

/**
 * Expand BenTML inline marks inside already-escaped? No — work on raw, escape segments.
 * @B{…} @I{…} @LINK(url: "…"){…} @CODE{…} @BREAK
 */
function renderInlineMarks(raw) {
  let s = String(raw ?? '');
  const tokens = [];
  const hold = (html) => {
    const i = tokens.length;
    tokens.push(html);
    return `§§TAPUZ${i}§§`;
  };
  s = s.replace(/@BREAK\b/gi, () => hold('<br>'));
  s = s.replace(/@B\{([^{}]*)\}/gi, (_, inner) => hold(`<strong>${escapeHtml(inner)}</strong>`));
  s = s.replace(/@I\{([^{}]*)\}/gi, (_, inner) => hold(`<em>${escapeHtml(inner)}</em>`));
  s = s.replace(/@CODE\{([^{}]*)\}/gi, (_, inner) => hold(`<code>${escapeHtml(inner)}</code>`));
  s = s.replace(
    /@LINK\s*\(\s*url\s*:\s*"([^"]*)"\s*\)\s*\{([^{}]*)\}/gi,
    (_, url, label) =>
      hold(`<a href="${escapeHtml(safeHref(url))}" rel="noopener">${escapeHtml(label)}</a>`)
  );
  let out = escapeHtml(s);
  out = out.replace(/§§TAPUZ(\d+)§§/g, (_, i) => tokens[Number(i)] || '');
  return out;
}

function renderBlock(block, direction = 'rtl') {
  const extraClass = block.data?.className ? ` ${escapeHtml(block.data.className)}` : '';
  const extraId = block.data?.id ? ` id="${escapeHtml(block.data.id)}"` : '';
  const style = styleAttr(block.data);
  const extra = extraClass + extraId + style;

  // bent-html escape hatch (v0.49): a pzn-level PROVISIONAL raw-HTML block, not
  // a Tapuz toolbox block — handled here (not a switch case) so it stays out of
  // the block registry / keyword language. The sanitizer is the guarantee (the
  // published CSP allows inline script) — see src/html-sanitize.js.
  if (block.type === 'html') {
    const safe = sanitizeHtmlFragment((block.data && block.data.content) || '');
    const prov = (block.data && block.data.provisional !== false && block.data.provisional !== 'false')
      ? ' data-bent-provisional="true"' : '';
    return `<div class="bent-html${extraClass}"${extraId}${style}${prov} dir="${direction}">${safe}</div>`;
  }

  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(block.data.level || 2, 1), 6);
      const clsList = [];
      if (ANIMATE_VALUES.has(block.data.animate)) clsList.push(`anim-${block.data.animate}`);
      if (block.data.className) clsList.push(escapeHtml(block.data.className));
      const clsAttr = clsList.length ? ` class="${clsList.join(' ')}"` : '';
      const hId = block.data?.id ? ` id="${escapeHtml(block.data.id)}"` : '';
      return `<h${level}${hId}${clsAttr}${style} dir="${direction}">${renderInlineMarks(block.data.text || '')}</h${level}>`;
    }
    case 'text': {
      const d = block.data || {};
      const classes = ['bent-text'];
      if (d.size && d.size !== 'md') classes.push(`text-size-${d.size}`);
      if (d.lead) classes.push('text-lead');
      if (d.dropcap) classes.push('text-dropcap');
      if (d.maxWidth && d.maxWidth !== 'full') classes.push(`text-max-${escapeHtml(d.maxWidth)}`);
      if (ANIMATE_VALUES.has(d.animate)) classes.push(`anim-${d.animate}`);
      if (d.className) classes.push(escapeHtml(d.className));
      const classAttr = ` class="${escapeHtml(classes.join(' '))}"`;
      const idAttr = d.id ? ` id="${escapeHtml(d.id)}"` : '';
      const paras = String(d.content || '').split(/\n\n+/);
      const inner = paras
        .map((p) => `<p dir="${direction}">${renderInlineMarks(p).replace(/\n/g, '<br>')}</p>`)
        .join('');
      return `<div${idAttr}${classAttr}${style} dir="${direction}">${inner}</div>`;
    }
    case 'image': {
      const { src = '', alt = '', caption = '', width = 'full' } = block.data || {};
      const wClass = width && width !== 'full' ? ` img-w-${escapeHtml(width)}` : '';
      const figClass = ` class="bent-image${wClass}${extraClass}"`;
      const figId = block.data?.id ? ` id="${escapeHtml(block.data.id)}"` : '';
      let h = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">`;
      if (caption) h += `<figcaption>${escapeHtml(caption)}</figcaption>`;
      return `<figure${figId}${figClass}${style} dir="${direction}">${h}</figure>`;
    }
    case 'button': {
      const { text = '', url = '#', variant = 'primary' } = block.data;
      const btnClass = ` class="btn btn-${escapeHtml(variant)}${extraClass}"`;
      const btnId = block.data?.id ? ` id="${escapeHtml(block.data.id)}"` : '';
      return `<a${btnId}${btnClass}${style} href="${escapeHtml(safeHref(url))}" dir="${direction}">${escapeHtml(text)}</a>`;
    }
    case 'spacer': return `<div${extra} class="spacer" style="height:${escapeHtml(block.data.height || '2rem')}"></div>`;
    case 'divider': return `<hr${extra} dir="${direction}">`;
    case 'columns': {
      // Support both shapes:
      // - data.columns = [{ blocks: [...] }, ...]
      // - data.children = [[...], ...] / data.count
      let cols = [];
      if (Array.isArray(block.data?.columns) && block.data.columns.length) {
        cols = block.data.columns.map(c => c.blocks || c || []);
      } else if (Array.isArray(block.data?.children) && block.data.children.length) {
        cols = block.data.children;
      } else {
        const count = block.data?.count || 2;
        cols = Array.from({ length: count }, () => []);
      }
      const n = cols.length || 1;
      let ratios = null;
      const rawRatio = block.data?.ratio;
      if (Array.isArray(rawRatio) && rawRatio.length === n) {
        ratios = rawRatio.map((x) => Math.max(0.2, Number(x) || 1));
      } else if (typeof rawRatio === 'string' && rawRatio.includes(':')) {
        const parts = rawRatio.split(':').map((x) => Math.max(0.2, parseFloat(x) || 1));
        if (parts.length === n) ratios = parts;
      }
      const gridCss = ratios
        ? `display:grid;grid-template-columns:${ratios.map((r) => r + 'fr').join(' ')};gap:var(--col-gap,1.15rem)`
        : '';
      // merge with module style attr (avoid two style= attributes)
      let colExtra = extra;
      if (gridCss) {
        if (colExtra.includes(' style="')) {
          colExtra = colExtra.replace(' style="', ` style="${gridCss};`);
        } else {
          colExtra += ` style="${gridCss}"`;
        }
      }
      const inner = cols.map((colBlocks) => {
        const list = Array.isArray(colBlocks) ? colBlocks : [];
        const colContent = list.map(bb => renderBlock(bb, direction)).join('');
        return `<div class="col">${colContent || ''}</div>`;
      }).join('');
      return `<div${colExtra} class="columns" dir="${direction}">${inner}</div>`;
    }
    case 'list': {
      const items = block.data.items || [];
      const tag = block.data.ordered ? 'ol' : 'ul';
      return `<${tag} dir="${direction}">${items.map(i => `<li dir="${direction}">${escapeHtml(i.text || i)}</li>`).join('')}</${tag}>`;
    }
    case 'quote': {
      const t = renderInlineMarks(block.data.text || '');
      const a = block.data.author ? `<footer>— ${escapeHtml(block.data.author)}</footer>` : '';
      return `<blockquote class="bent-quote"${extra} dir="${direction}"><p>${t}</p>${a}</blockquote>`;
    }
    case 'card': {
      const inner = (block.data.blocks || []).map(b => renderBlock(b, direction)).join('');
      return `<div class="card bent-card"${extra} dir="${direction}">${inner}</div>`;
    }
    case 'hero': {
      const d = block.data || {};
      const title = renderInlineMarks(d.title || '');
      const subtitle = renderInlineMarks(d.subtitle || '');
      const btnText = d.buttonText ? escapeHtml(d.buttonText) : '';
      const btnUrl = escapeHtml(safeHref(d.buttonUrl || '#'));
      const hClass = d.height && d.height !== 'md' ? ` hero-${escapeHtml(d.height)}` : '';
      const overlayVal = Math.min(Math.max(parseInt(d.overlay, 10) || 0, 0), 80);
      const overlayCls = overlayVal > 0 ? ' hero-overlaid' : '';
      const parallaxCls = (d.parallax === true || d.parallax === 'true') ? ' hero-parallax' : '';
      // assemble ONE style attribute from parts — no more string-splicing that
      // injected background-image:url('') when overlay was set but image wasn't
      const heroStyle = [];
      if (overlayVal > 0) heroStyle.push(`--hero-overlay:${(overlayVal / 100).toFixed(2)}`);
      if (d.image) {
        heroStyle.push(`background-image:url('${cssUrl(d.image)}')`);
        heroStyle.push('background-size:cover');
        heroStyle.push('background-position:center');
      }
      const userDecls = styleDecls(d);
      if (userDecls) heroStyle.push(userDecls);
      const heroStyleAttr = heroStyle.length ? ` style="${heroStyle.join(';')}"` : '';
      let html = `<section class="hero${hClass}${overlayCls}${parallaxCls}${extraClass}"${extraId}${heroStyleAttr} dir="${direction}">`;
      html += `<h1>${title}</h1>`;
      if (subtitle) html += `<p class="subtitle">${subtitle}</p>`;
      if (btnText) html += `<a href="${btnUrl}" class="btn btn-primary">${btnText}</a>`;
      html += `</section>`;
      return html;
    }

    case 'testimonial': {
      const quote = renderInlineMarks(block.data.quote || '');
      const author = escapeHtml(block.data.author || '');
      const role = block.data.role ? `, ${escapeHtml(block.data.role)}` : '';
      return `<blockquote class="testimonial"${extra} dir="${direction}"><p>“${quote}”</p><footer class="author">${author}${role}</footer></blockquote>`;
    }

    case 'gallery': {
      const images = block.data.images || [];
      const cols = Math.min(Math.max(parseInt(block.data.columns, 10) || 3, 1), 4);
      const imgs = images.map(img => {
        const src = escapeHtml(img.src || img);
        const alt = escapeHtml(img.alt || '');
        return `<img src="${src}" alt="${alt}">`;
      }).join('');
      return `<div class="gallery cols-${cols}"${extra} dir="${direction}">${imgs}</div>`;
    }

    case 'embed': {
      const rawUrl = String(block.data.url || '');
      const yt = rawUrl.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/);
      if (yt) {
        return `<figure class="video-embed"${extra}><iframe src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen loading="lazy" title="YouTube video"></iframe></figure>`;
      }
      const url = escapeHtml(safeHref(rawUrl));
      return `<a href="${url}" target="_blank" rel="noopener" dir="${direction}">${url}</a>`;
    }

    case 'article-list': {
      const { listArticles } = require('./pages'); // lazy: avoids require cycle via export.js
      const tag = block.data?.tag || 'article';
      const limit = block.data?.limit || 6;
      const cols = Math.min(Math.max(parseInt(block.data?.columns, 10) || 3, 1), 4);
      let articles = [];
      try { articles = listArticles({ tag, limit }); } catch (e) { /* empty DB in static contexts */ }
      if (!articles.length) {
        return `<!-- article-list: no published pages tagged "${escapeHtml(tag)}" -->`;
      }
      const cards = articles.map(a => {
        const media = a.image
          ? `<img src="${escapeHtml(a.image)}" alt="" loading="lazy">`
          : '';
        const teaser = a.teaser ? `<p>${escapeHtml(a.teaser)}</p>` : '';
        return `<a class="article-cube" href="${escapeHtml(a.url)}">` +
          `<div class="cube-media">${media}</div>` +
          `<div class="cube-body"><h3>${escapeHtml(a.title)}</h3>${teaser}</div></a>`;
      }).join('');
      return `<section${extra} class="article-cubes cols-${cols}" dir="${direction}">${cards}</section>`;
    }

    case 'map': {
      const address = String(block.data?.address || '');
      const zoom = Math.min(Math.max(parseInt(block.data?.zoom, 10) || 15, 1), 20);
      const height = ['sm', 'md', 'lg'].includes(block.data?.height) ? block.data.height : 'md';
      const src = `https://www.google.com/maps?q=${encodeURIComponent(address)}&z=${zoom}&output=embed&hl=he`;
      return `<figure class="map-embed map-${height}${extraClass}"${extraId}${style}>` +
        `<iframe src="${escapeHtml(src)}" loading="lazy" title="מפה: ${escapeHtml(address)}" allowfullscreen></iframe>` +
        `</figure>`;
    }

    case 'features': {
      const items = block.data.items || [];
      const list = items.map(item => {
        const title = escapeHtml(item.title || item);
        const icon = item.icon ? `<span class="feature-icon">${escapeHtml(item.icon)}</span>` : '';
        const desc = item.description ? `<p>${escapeHtml(item.description)}</p>` : '';
        return `<article class="feature">${icon}<h3>${title}</h3>${desc}</article>`;
      }).join('');
      const cols = Math.min(Math.max(parseInt(block.data.columns, 10) || 3, 1), 4);
      return `<section class="features cols-${cols}"${extra} dir="${direction}">${list}</section>`;
    }

    case 'cta': {
      const d = block.data || {};
      const tone = ['brand', 'dark', 'light'].includes(d.tone) ? d.tone : 'brand';
      const variant = d.variant || 'primary';
      const btn = d.buttonText
        ? `<a class="btn btn-${escapeHtml(variant)}" href="${escapeHtml(safeHref(d.url || '#'))}">${escapeHtml(d.buttonText)}</a>`
        : '';
      return (
        `<section class="cta-strip tone-${escapeHtml(tone)}"${extra} dir="${direction}">` +
        `<div class="cta-inner">` +
        (d.title ? `<h2>${escapeHtml(d.title)}</h2>` : '') +
        (d.text ? `<p>${escapeHtml(d.text)}</p>` : '') +
        btn +
        `</div></section>`
      );
    }

    case 'stats': {
      const items = block.data.items || [];
      const cols = Math.min(Math.max(parseInt(block.data.columns, 10) || 3, 2), 4);
      const cells = items
        .map(
          (it) =>
            `<div class="stat-cell"><div class="stat-value">${escapeHtml(it.value || '')}</div>` +
            `<div class="stat-label">${escapeHtml(it.label || '')}</div></div>`
        )
        .join('');
      return `<section class="stats-row cols-${cols}"${extra} dir="${direction}">${cells}</section>`;
    }

    case 'logos': {
      const items = block.data.items || [];
      const cells = items
        .map((it) => {
          const img = `<img src="${escapeHtml(it.src || '')}" alt="${escapeHtml(it.alt || '')}" loading="lazy">`;
          return it.url
            ? `<a class="logo-cell" href="${escapeHtml(it.url)}">${img}</a>`
            : `<div class="logo-cell">${img}</div>`;
        })
        .join('');
      return `<section class="logos-strip"${extra} dir="${direction}">${cells}</section>`;
    }

    case 'faq': {
      const items = block.data.items || [];
      const rows = items
        .map(
          (it) =>
            `<details class="faq-item"><summary>${escapeHtml(it.question || '')}</summary>` +
            `<div class="faq-answer">${escapeHtml(it.answer || '')}</div></details>`
        )
        .join('');
      return `<section class="faq-list"${extra} dir="${direction}">${rows}</section>`;
    }

    case 'tabs': {
      // pure-CSS tabs: input:checked + label + .panel (no JS)
      const items = block.data.items || [];
      const gid = 'bt-' + (block.data?.id || block.id || Math.random().toString(36).slice(2, 8));
      let inner = '';
      items.forEach((it, i) => {
        const tid = escapeHtml(gid + '-' + i);
        inner +=
          `<input type="radio" name="${escapeHtml(gid)}" id="${tid}" class="bent-tab-radio"${i === 0 ? ' checked' : ''}>` +
          `<label for="${tid}" class="bent-tab-label">${escapeHtml(it.label || ('טאב ' + (i + 1)))}</label>` +
          `<div class="bent-tab-panel">${renderInlineMarks(it.content || '')}</div>`;
      });
      return `<div class="bent-tabs"${extra} dir="${direction}">${inner}</div>`;
    }

    case 'accordion': {
      const items = block.data.items || [];
      const rows = items
        .map(
          (it, i) =>
            `<details class="bent-fold"${i === 0 ? ' open' : ''}><summary>${escapeHtml(it.title || '')}</summary>` +
            `<div class="bent-fold-body">${renderInlineMarks(it.content || '')}</div></details>`
        )
        .join('');
      return `<div class="bent-accordion"${extra} dir="${direction}">${rows}</div>`;
    }

    case 'form':
      return require('./pzn/form-html').renderFormFromData(block.data || {}, direction, extra);

    case 'cards':
      return require('./pzn/card-html').renderCardsFromData(block.data || {}, direction, extra);

    case 'nav':
      // pass id/class as `extra` but the generic style decls as `decls` so the
      // nav renders ONE style attribute (its colors + any generic style), never
      // two (which the browser would drop, killing the colors).
      return require('./pzn/nav-html').renderNavFromData(block.data || {}, direction, extraClass + extraId, styleDecls(block.data));

    case 'ticker':
      // same ONE-merged-style contract as nav (v0.60 lesson): id/class as
      // `extra`, generic style decls as `decls` so ticker colors never split.
      return require('./pzn/ticker-html').renderTickerFromData(block.data || {}, direction, extraClass + extraId, styleDecls(block.data));

    case 'newspop':
      // timestamped news feed (v0.70) — same ONE-merged-style contract.
      return require('./pzn/newspop-html').renderNewspopFromData(block.data || {}, direction, extraClass + extraId, styleDecls(block.data));

    case 'video':
      // cls = className suffix (goes INSIDE class="") ; extra = id + style
      // (trailing attrs) — the correct split so a custom class isn't emitted
      // as a stray boolean attribute.
      return require('./pzn/video-html').renderVideoFromData(block.data || {}, direction, extraClass, extraId + style);

    case 'category': {
      // dynamic leaf like article-list: lazy-require the stores at render time
      // (avoids require cycles via export.js). Membership = the page tags;
      // metadata = the file store content/categories.json.
      const { listArticles } = require('./pages');
      const { getCategory } = require('./categories');
      const d = block.data || {};
      const slug = String(d.slug || '');
      const limit = Math.min(Math.max(parseInt(d.limit, 10) || 6, 1), 48);
      let articles = [];
      try { if (slug) articles = listArticles({ tag: slug, limit }); } catch (e) { /* empty DB in static contexts */ }
      let category = null;
      try { category = getCategory(slug); } catch (e) { /* no content dir yet */ }
      // ONE-merged-style contract (v0.60 lesson): id/class split + decls merged
      return require('./pzn/category-html').renderCategory(d, { category, articles }, {
        idAttr: extraId, cls: extraClass, decls: styleDecls(block.data), dir: ` dir="${direction}"`
      });
    }

    case 'contact-info': {
      const d = block.data || {};
      const lines = [];
      if (d.phone) {
        lines.push(
          `<div class="contact-line"><span class="contact-k">טלפון</span> ` +
            `<a href="tel:${escapeHtml(String(d.phone).replace(/\s/g, ''))}">${escapeHtml(d.phone)}</a></div>`
        );
      }
      if (d.email) {
        lines.push(
          `<div class="contact-line"><span class="contact-k">אימייל</span> ` +
            `<a href="mailto:${escapeHtml(d.email)}">${escapeHtml(d.email)}</a></div>`
        );
      }
      if (d.address) {
        lines.push(
          `<div class="contact-line"><span class="contact-k">כתובת</span> ${escapeHtml(d.address)}</div>`
        );
      }
      if (d.hours) {
        lines.push(
          `<div class="contact-line"><span class="contact-k">שעות</span> ${escapeHtml(d.hours)}</div>`
        );
      }
      return `<section class="contact-info"${extra} dir="${direction}">${lines.join('')}</section>`;
    }

    case 'banner': {
      const d = block.data || {};
      const tone = ['brand', 'dark', 'light', 'warn'].includes(d.tone) ? d.tone : 'brand';
      return (
        `<div class="site-banner tone-${escapeHtml(tone)}"${extra} dir="${direction}">` +
        `<p>${escapeHtml(d.text || '')}</p></div>`
      );
    }

    case 'marquee': {
      const d = block.data || {};
      const speed = ['slow', 'md', 'fast'].includes(d.speed) ? d.speed : 'md';
      const t = escapeHtml(d.text || '');
      const cls = `marquee marquee-${speed}${extraClass}`;
      // two full-width tracks side by side → seamless loop for any text length
      const trackInner = `<span class="marquee-item">${t}</span>`;
      return (
        `<div class="${cls}"${extraId}${style} dir="${direction}">` +
        `<div class="marquee-track">${trackInner}</div>` +
        `<div class="marquee-track" aria-hidden="true">${trackInner}</div></div>`
      );
    }

    case 'parallax': {
      const d = block.data || {};
      const height = ['sm', 'md', 'lg', 'full'].includes(d.height) ? d.height : 'md';
      const overlayVal = Math.min(Math.max(parseInt(d.overlay, 10) || 0, 0), 80);
      const overlaidCls = overlayVal > 0 ? ' parallax-overlaid' : '';
      const pxStyle = [];
      if (overlayVal > 0) pxStyle.push(`--px-overlay:${(overlayVal / 100).toFixed(2)}`);
      if (d.image) pxStyle.push(`background-image:url('${cssUrl(d.image)}')`);
      const userDecls = styleDecls(d);
      if (userDecls) pxStyle.push(userDecls);
      const pxStyleAttr = pxStyle.length ? ` style="${pxStyle.join(';')}"` : '';
      const inner = (d.blocks || []).map((b) => renderBlock(b, direction)).join('');
      return (
        `<section class="parallax-section parallax-${height}${overlaidCls}${extraClass}"${extraId}` +
        `${pxStyleAttr} dir="${direction}">` +
        `<div class="parallax-inner">${inner}</div></section>`
      );
    }

    default: return `<!-- unknown block: ${block.type} -->`;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMenuItems(items) {
  return (items || []).map(item => {
    const kids = item.children && item.children.length
      ? `<ul class="sub-menu">${renderMenuItems(item.children)}</ul>`
      : '';
    return `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.label)}</a>${kids}</li>`;
  }).join('\n');
}

/**
 * Site-wide WhatsApp click-to-chat floating button.
 * Driven by config.integrations.whatsapp { enabled, phone, message, position }.
 * Returns '' when disabled or when no phone digits are configured.
 * Styling lives in the theme CSS (.whatsapp-float) so it survives static
 * export, which strips inline <style> blocks.
 */
function renderWhatsappFloat(config) {
  const wa = config && config.integrations && config.integrations.whatsapp;
  if (!wa || !wa.enabled) return '';
  const phone = String(wa.phone || '').replace(/\D+/g, '');
  if (!phone) return '';
  const message = String(wa.message || '').trim();
  const href = `https://wa.me/${phone}` + (message ? `?text=${encodeURIComponent(message)}` : '');
  const posClass = wa.position === 'end' ? 'pos-end' : 'pos-start';
  const icon = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>' +
    '</svg>';
  return `<a class="whatsapp-float ${posClass}" href="${escapeHtml(href)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon}</a>`;
}

/**
 * S5a — Google Analytics 4 (gtag) snippet for public pages.
 * The Measurement ID (G-XXXX) is PUBLIC, not a secret. Returns '' unless a
 * well-formed id is configured, so a site without GA renders exactly as today.
 * Appended into `head` (renders inside <head> via {{head}}) as high as we can,
 * and it survives static export (export.js strips only <style>, never <script>).
 */
function renderGa4Snippet(config) {
  const a = config && config.analytics;
  const id = a && a.ga4 && a.ga4.measurementId;
  if (!id || !/^G-[A-Z0-9]+$/.test(String(id))) return '';
  const safe = String(id); // already validated to a strict charset above
  return (
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${safe}"></script>` +
    `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}` +
    `gtag('js',new Date());gtag('config','${safe}');</script>`
  );
}

/**
 * S6 — first-party pageview beacon for public pages.
 * A tiny inline <script> (no external asset, so it survives static export) that
 * POSTs { path, ref } to the configured collector on page load. It respects
 * Do-Not-Track / Global Privacy Control and never sends an IP — the server
 * derives the IP + device class + salted visitor hash. Returns '' when
 * first-party analytics are disabled.
 *
 * NOTE (documented in docs/analytics.md): the beacon only records while a Tapuz
 * server is reachable at collectorUrl. A relative '/_tapuz/collect' works when
 * the site is served BY Tapuz; an exported site hosted elsewhere needs an
 * ABSOLUTE collector URL to a live instance or first-party stats silently stop.
 */
function renderAnalyticsBeacon(config) {
  const a = config && config.analytics;
  const fp = a && a.firstParty;
  if (!fp || !fp.enabled) return '';
  const url = String(fp.collectorUrl || '/_tapuz/collect');
  const urlLit = JSON.stringify(url); // safe JS string literal
  return (
    `<script>(function(){try{` +
    `if(navigator.doNotTrack=='1'||window.doNotTrack=='1'||navigator.msDoNotTrack=='1')return;` +
    `var u=${urlLit};` +
    `var b=JSON.stringify({path:location.pathname,ref:document.referrer});` +
    `if(navigator.sendBeacon){navigator.sendBeacon(u,new Blob([b],{type:'application/json'}));}` +
    `else{fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:b,keepalive:true}).catch(function(){});}` +
    `}catch(e){}})();</script>`
  );
}

/**
 * CMS-managed static header + footer chrome (S3).
 * Builds the HTML fragments that the theme layout slots wrap EVERY public page
 * in — on both live serve and static export (export.js calls this same
 * renderPage). Every fragment is EMPTY when its config value is empty, so a
 * site with no chrome configured renders exactly like today (no regression).
 * Styling lives in the theme CSS so it survives export (which strips <style>).
 */
function renderSiteChrome(config, direction) {
  const header = (config && config.header) || {};
  const footer = (config && config.footer) || {};

  // --- Header: tagline, sticky, CTA ---
  const headerTagline = header.tagline
    ? `<span class="site-tagline">${escapeHtml(header.tagline)}</span>`
    : '';
  const headerClass = header.sticky === false ? 'site-header--nosticky' : '';
  const headerCta = (header.ctaLabel && header.ctaUrl)
    ? `<a class="header-cta btn btn-primary" href="${escapeHtml(header.ctaUrl)}">${escapeHtml(header.ctaLabel)}</a>`
    : '';

  // --- Footer: link columns ---
  let footerColumns = '';
  if (Array.isArray(footer.columns) && footer.columns.length) {
    const cols = footer.columns
      .filter(c => c && (c.title || (Array.isArray(c.links) && c.links.length)))
      .map(col => {
        const title = col.title ? `<h4 class="footer-col-title">${escapeHtml(col.title)}</h4>` : '';
        const links = (Array.isArray(col.links) ? col.links : [])
          .filter(l => l && (l.label || l.url))
          .map(l => `<li><a href="${escapeHtml(l.url || '#')}">${escapeHtml(l.label || l.url || '')}</a></li>`)
          .join('');
        return `<div class="footer-col">${title}<ul>${links}</ul></div>`;
      }).join('');
    if (cols) footerColumns = `<div class="footer-columns" dir="${direction}">${cols}</div>`;
  }

  // --- Footer: free text ---
  const footerText = footer.text
    ? `<p class="footer-text">${escapeHtml(footer.text).replace(/\n/g, '<br>')}</p>`
    : '';

  // --- Footer: social links ---
  let footerSocial = '';
  if (Array.isArray(footer.social) && footer.social.length) {
    const items = footer.social
      .filter(s => s && s.url)
      .map(s => {
        const net = String(s.network || 'link');
        return `<a class="social-link social-${escapeHtml(net.toLowerCase())}" href="${escapeHtml(s.url)}" ` +
          `target="_blank" rel="noopener" aria-label="${escapeHtml(net)}">${escapeHtml(net)}</a>`;
      }).join('');
    if (items) footerSocial = `<div class="footer-social">${items}</div>`;
  }

  // --- Footer: CMS credit (on by default; a toggle turns it off) ---
  const footerCredit = footer.showCredit === false
    ? ''
    : `<p class="footer-credit">נבנה עם Tapuz</p>`;

  return { headerTagline, headerClass, headerCta, footerColumns, footerText, footerSocial, footerCredit };
}

/** Keep a CSS color value safe to interpolate (no breakout chars). */
function safeCssColor(v) {
  return String(v == null ? '' : v).replace(/[^#\w(),.%\s-]/g, '').slice(0, 40);
}

/**
 * Page-level "splash" background (v0.52) — a full-page photo/colour set in page
 * properties. When parallax is on it's a FIXED layer the content scrolls over
 * (the one-page "splash photo on scroll" feel); a fixed <div>-style layer is
 * smoother on mobile than background-attachment:fixed. Returns the <style> to
 * drop in <head> and the body class that switches it on.
 * @returns {{ css: string, bodyClass: string }}
 */
function pageBackgroundStyle(bg) {
  if (!bg || typeof bg !== 'object' || (!bg.image && !bg.color)) return { css: '', bodyClass: '' };
  const overlay = Math.min(Math.max(parseInt(bg.overlay, 10) || 0, 0), 85);
  const parallax = bg.image && (bg.parallax === true || bg.parallax === 'true');
  const pos = parallax ? 'fixed' : 'absolute';
  const rules = ['body.tapuz-page-bg{position:relative;min-height:100vh;}'];
  if (bg.color) rules.push(`body.tapuz-page-bg{background-color:${safeCssColor(bg.color)};}`);
  if (bg.image) {
    rules.push(
      `body.tapuz-page-bg::before{content:"";position:${pos};inset:0;z-index:-2;` +
      `background-image:url('${cssUrl(bg.image)}');background-size:cover;background-position:center;background-repeat:no-repeat;}`
    );
  }
  if (overlay > 0 && bg.image) {
    rules.push(`body.tapuz-page-bg::after{content:"";position:${pos};inset:0;z-index:-1;background:rgba(0,0,0,${(overlay / 100).toFixed(2)});pointer-events:none;}`);
  }
  // touch devices: a fixed layer can jitter with the URL bar — pin to the page
  if (parallax) {
    rules.push('@media (hover:none) and (pointer:coarse){body.tapuz-page-bg::before,body.tapuz-page-bg::after{position:absolute;}}');
  }
  return { css: `<style id="tapuz-page-bg">${rules.join('')}</style>`, bodyClass: 'tapuz-page-bg' };
}

function renderPage(page, options = {}) {
  // Redirect pages: meta.redirect = target URL → tiny instant-redirect document
  if (page.meta && page.meta.redirect) {
    const to = escapeHtml(String(page.meta.redirect));
    return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8">` +
      `<meta http-equiv="refresh" content="0;url=${to}"><link rel="canonical" href="${to}">` +
      `<title>${escapeHtml(page.title || '')}</title></head>` +
      `<body><p style="font-family:system-ui;text-align:center;margin-top:3rem">` +
      `<a href="${to}">ממשיכים לדף החדש…</a></p></body></html>`;
  }

  const direction = page.direction || 'rtl';
  const lang = direction === 'rtl' ? 'he' : 'en';
  const theme = loadTheme(page.theme || 'default');
  const useDraft = !!options.useDraft;

  const blockSource = useDraft
    ? (page.draft_blocks != null ? page.draft_blocks : page.blocks)
    : page.blocks;
  const content = (blockSource || []).map(b => renderBlock(b, direction)).join('\n');

  const cssPath = path.join(theme.dir, 'css', 'main.css');
  const overrides = loadOverrides();
  const overrideCss = overridesToCss(overrides);
  let head = fs.existsSync(cssPath)
    ? `<style>\n${fs.readFileSync(cssPath, 'utf8')}\n</style>`
    : '';
  head += `<style id="tapuz-theme-overrides">\n${overrideCss}\n</style>`;

  const config = loadConfig();
  // S5a: GA4 gtag as high in <head> as our {{head}} slot allows. Public + export.
  head += renderGa4Snippet(config);
  const currentYear = new Date().getFullYear();

  const mainMenu = getMenu('main');
  const footerMenu = getMenu('footer');

  // CMS-managed static chrome (S3): header tagline/CTA + footer columns/social/credit
  const chrome = renderSiteChrome(config, direction);

  // Logo rendering (config.header.showLogo === false hides it entirely)
  let logoHtml = '';
  if (config.header && config.header.showLogo === false) {
    logoHtml = '';
  } else if (config.logo && config.logo.type === 'image' && config.logo.image) {
    const w = config.logo.width || 160;
    const h = config.logo.height || 50;
    logoHtml = `<img src="${escapeHtml(config.logo.image)}" alt="${escapeHtml(config.title)}" width="${w}" height="${h}" style="max-height:60px;width:auto;display:block;">`;
  } else {
    logoHtml = escapeHtml(config.logo?.text || config.title || 'Site');
  }

  // Menus
  const menuHtml = renderMenuItems(mainMenu);
  const footerMenuHtml = (footerMenu || []).map(item =>
    `<a href="${escapeHtml(item.url)}">${escapeHtml(item.label)}</a>`
  ).join(' &nbsp;|&nbsp; ');

  let layout = loadLayout(theme.dir);
  // Page splash background (v0.52) — inject its <style> into <head> and switch
  // it on with a body class.
  const pageBg = pageBackgroundStyle(page.meta && page.meta.background);
  if (pageBg.css) head += pageBg.css;
  const bodyClass = [
    overrides.layout?.menuPlacement === 'side' ? 'menu-side' : '',
    pageBg.bodyClass
  ].filter(Boolean).join(' ');
  if (bodyClass) {
    layout = layout.replace(/<body([^>]*)>/, `<body$1 class="${bodyClass}">`);
    if (!/<body[^>]*class=/.test(layout)) {
      layout = layout.replace('<body>', `<body class="${bodyClass}">`);
    }
  }

  // Site-wide extras (WhatsApp click-to-chat float) — injected into the shared
  // layout path so both live serve and static export emit them.
  // WhatsApp float (S-integrations) + first-party analytics beacon (S6), both
  // injected at body-end via {{site_extras}} so serve and static export match.
  const siteExtras = renderWhatsappFloat(config) + renderAnalyticsBeacon(config);
  const hasExtrasSlot = layout.includes('{{site_extras}}');

  let pageTitle = page.meta?.seoTitle || page.title || '';
  // Site-level SEO defaults (config.seo): title pattern "{page} · {site}" + og:image fallback
  const titlePattern = (config.seo && config.seo.titlePattern) || '';
  if (titlePattern && titlePattern.includes('{page}')) {
    pageTitle = titlePattern
      .split('{page}').join(pageTitle)
      .split('{site}').join(config.title || '');
  }
  const pageDesc = page.meta?.description || config.description || '';
  const pageOg = page.meta?.ogImage || page.meta?.ogimage || (config.seo && config.seo.defaultOgImage) || '';
  const pageRobots = page.meta?.robots || 'index, follow';

  const replacements = {
    '{{lang}}': lang,
    '{{direction}}': direction,
    '{{title}}': escapeHtml(pageTitle),
    '{{head}}': head,
    '{{content}}': content,
    '{{site.title}}': escapeHtml(config.title),
    '{{currentYear}}': currentYear,
    '{{meta.description}}': escapeHtml(pageDesc),
    '{{meta.ogImage}}': escapeHtml(pageOg),
    '{{meta.robots}}': escapeHtml(pageRobots),
    '{{logo_html}}': logoHtml,
    '{{menu_html}}': menuHtml,
    '{{footer_menu_html}}': footerMenuHtml,
    '{{site_extras}}': siteExtras,
    // S3 site chrome slots
    '{{header_class}}': chrome.headerClass,
    '{{header_tagline}}': chrome.headerTagline,
    '{{header_cta}}': chrome.headerCta,
    '{{footer_columns_html}}': chrome.footerColumns,
    '{{footer_text_html}}': chrome.footerText,
    '{{footer_social_html}}': chrome.footerSocial,
    '{{footer_credit_html}}': chrome.footerCredit
  };

  Object.keys(replacements).forEach(key => {
    layout = layout.split(key).join(replacements[key]);
  });

  // Fallback for theme layouts without a {{site_extras}} slot
  if (siteExtras && !hasExtrasSlot) {
    layout = layout.replace('</body>', `${siteExtras}\n</body>`);
  }

  return layout;
}

function renderPageToFile(page, outputPath) {
  fs.writeFileSync(outputPath, renderPage(page), 'utf8');
  return outputPath;
}

module.exports = { renderPage, renderBlock, renderPageToFile, renderWhatsappFloat, renderGa4Snippet, renderAnalyticsBeacon, pageBackgroundStyle };
