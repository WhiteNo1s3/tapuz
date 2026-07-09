const fs = require('fs');
const path = require('path');

const THEMES_DIR = path.join(__dirname, '..', 'themes');
const { loadConfig } = require('./config');
const { getMenu } = require('./menus');

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

function renderBlock(block, direction = 'rtl') {
  const extraClass = block.data?.className ? ` ${escapeHtml(block.data.className)}` : '';
  const extraId = block.data?.id ? ` id="${escapeHtml(block.data.id)}"` : '';
  const extra = extraClass + extraId;

  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(block.data.level || 2, 1), 6);
      return `<h${level}${extra} dir="${direction}">${escapeHtml(block.data.text || '')}</h${level}>`;
    }
    case 'text': {
      let c = escapeHtml(block.data.content || '').replace(/\n\n/g, '</p><p dir="' + direction + '">');
      return `<p${extra} dir="${direction}">${c}</p>`;
    }
    case 'image': {
      const { src = '', alt = '', caption = '' } = block.data;
      let h = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">`;
      if (caption) h += `<figcaption>${escapeHtml(caption)}</figcaption>`;
      return `<figure${extra} dir="${direction}">${h}</figure>`;
    }
    case 'button': {
      const { text = '', url = '#', variant = 'primary' } = block.data;
      return `<a${extra} href="${escapeHtml(url)}" class="btn btn-${variant}" dir="${direction}">${escapeHtml(text)}</a>`;
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
      const inner = cols.map((colBlocks, i) => {
        const list = Array.isArray(colBlocks) ? colBlocks : [];
        const colContent = list.map(bb => renderBlock(bb, direction)).join('');
        return `<div class="col" style="flex:1">${colContent || ''}</div>`;
      }).join('');
      return `<div${extra} class="columns" dir="${direction}" style="display:flex;gap:1rem">${inner}</div>`;
    }
    case 'list': {
      const items = block.data.items || [];
      const tag = block.data.ordered ? 'ol' : 'ul';
      return `<${tag} dir="${direction}">${items.map(i => `<li dir="${direction}">${escapeHtml(i.text || i)}</li>`).join('')}</${tag}>`;
    }
    case 'quote': {
      const t = escapeHtml(block.data.text || '');
      const a = block.data.author ? `<footer>— ${escapeHtml(block.data.author)}</footer>` : '';
      return `<blockquote dir="${direction}"><p>${t}</p>${a}</blockquote>`;
    }
    case 'card': {
      const inner = (block.data.blocks || []).map(b => renderBlock(b, direction)).join('');
      return `<div class="card" dir="${direction}">${inner}</div>`;
    }
    case 'hero': {
      const title = escapeHtml(block.data.title || '');
      const subtitle = escapeHtml(block.data.subtitle || '');
      const btnText = block.data.buttonText ? escapeHtml(block.data.buttonText) : '';
      const btnUrl = block.data.buttonUrl || '#';
      let html = `<div class="hero" dir="${direction}">`;
      html += `<h1>${title}</h1>`;
      if (subtitle) html += `<p class="subtitle">${subtitle}</p>`;
      if (btnText) html += `<a href="${btnUrl}" class="btn btn-primary">${btnText}</a>`;
      html += `</div>`;
      return html;
    }

    case 'testimonial': {
      const quote = escapeHtml(block.data.quote || '');
      const author = escapeHtml(block.data.author || '');
      const role = block.data.role ? `, ${escapeHtml(block.data.role)}` : '';
      return `<div class="testimonial" dir="${direction}"><p>“${quote}”</p><div class="author">${author}${role}</div></div>`;
    }

    case 'gallery': {
      const images = block.data.images || [];
      const imgs = images.map(img => {
        const src = escapeHtml(img.src || img);
        const alt = escapeHtml(img.alt || '');
        return `<img src="${src}" alt="${alt}">`;
      }).join('');
      return `<div class="gallery" dir="${direction}">${imgs}</div>`;
    }

    case 'embed': {
      const rawUrl = String(block.data.url || '');
      const yt = rawUrl.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/);
      if (yt) {
        return `<div class="video-embed" style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;"><iframe src="https://www.youtube.com/embed/${yt[1]}" style="position:absolute;top:0;left:0;width:100%;height:100%;" frameborder="0" allowfullscreen loading="lazy" title="YouTube video"></iframe></div>`;
      }
      const url = escapeHtml(rawUrl);
      return `<a href="${url}" target="_blank" rel="noopener" dir="${direction}">${url}</a>`;
    }

    case 'features': {
      const items = block.data.items || [];
      const list = items.map(item => {
        const title = escapeHtml(item.title || item);
        const desc = item.description ? `<p>${escapeHtml(item.description)}</p>` : '';
        return `<div class="feature"><strong>${title}</strong>${desc}</div>`;
      }).join('');
      return `<div class="features" dir="${direction}">${list}</div>`;
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

function renderPage(page, options = {}) {
  const direction = page.direction || 'rtl';
  const lang = direction === 'rtl' ? 'he' : 'en';
  const theme = loadTheme(page.theme || 'default');

  const content = page.blocks.map(b => renderBlock(b, direction)).join('\n');

  const cssPath = path.join(theme.dir, 'css', 'main.css');
  const head = fs.existsSync(cssPath) ? `<style>\n${fs.readFileSync(cssPath, 'utf8')}\n</style>` : '';

  const config = loadConfig();
  const currentYear = new Date().getFullYear();

  const mainMenu = getMenu('main');
  const footerMenu = getMenu('footer');

  // Logo rendering
  let logoHtml = '';
  if (config.logo && config.logo.type === 'image' && config.logo.image) {
    const w = config.logo.width || 160;
    const h = config.logo.height || 50;
    logoHtml = `<img src="${escapeHtml(config.logo.image)}" alt="${escapeHtml(config.title)}" width="${w}" height="${h}" style="max-height:60px;width:auto;display:block;">`;
  } else {
    logoHtml = escapeHtml(config.logo?.text || config.title || 'Site');
  }

  // Menus
  const menuHtml = mainMenu.map(item => 
    `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.label)}</a></li>`
  ).join('\n');

  const footerMenuHtml = footerMenu.map(item =>
    `<a href="${escapeHtml(item.url)}">${escapeHtml(item.label)}</a>`
  ).join(' &nbsp;|&nbsp; ');

  let layout = loadLayout(theme.dir);

  const replacements = {
    '{{lang}}': lang,
    '{{direction}}': direction,
    '{{title}}': escapeHtml(page.title),
    '{{head}}': head,
    '{{content}}': content,
    '{{site.title}}': escapeHtml(config.title),
    '{{currentYear}}': currentYear,
    '{{meta.description}}': escapeHtml(page.meta?.description || ''),
    '{{logo_html}}': logoHtml,
    '{{menu_html}}': menuHtml,
    '{{footer_menu_html}}': footerMenuHtml
  };

  Object.keys(replacements).forEach(key => {
    layout = layout.split(key).join(replacements[key]);
  });

  return layout;
}

function renderPageToFile(page, outputPath) {
  fs.writeFileSync(outputPath, renderPage(page), 'utf8');
  return outputPath;
}

module.exports = { renderPage, renderBlock, renderPageToFile };
