#!/usr/bin/env node

const { 
  createPage, updatePage, listPages, getPageByFullPath, deletePage 
} = require('../src/pages');
const { renderPage } = require('../src/renderer');
const { exportAll, exportPage } = require('../src/export');
const { initialize } = require('../src/db');
const { loadConfig, saveConfig } = require('../src/config');
const { loadMenus, saveMenus } = require('../src/menus');
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
Tapuz CLI — Hebrew RTL CMS

Core:
  create-page <title> [slug] [--prefix p]
  add-block <full_path> <type> [text...]
  list-pages
  show <full_path>
  preview <full_path>
  delete-page <full_path>

Build & Preview:
  build
  export [full_path]
  serve [port]               # Quick local preview (default 8080)

Migration:
  import-wp <file.xml>       # Import WordPress WXR export

Site config:
  set-logo --text "Name" --image "/assets/logo.png"
  set-menu main '[{"label":"Home","url":"/"}]'

Examples:
  tapuz create-page "עבודות" "עבודות"
  tapuz add-block home-דף-הבית hero "כותרת" "תת כותרת"
  tapuz import-wp ~/Downloads/white-no1se-export.xml
  tapuz build
  tapuz serve
`);
}

function parseFlags(start) {
  const flags = {};
  for (let i = start; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].replace('--', '');
      flags[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      if (flags[key] !== true) i++;
    }
  }
  return flags;
}

if (!command || command === 'help') {
  printHelp();
  process.exit(0);
}

// === Commands ===

if (command === 'init-db') {
  initialize();
  console.log('✅ Database ready');
  process.exit(0);
}

if (command === 'list-pages') {
  console.table(listPages().map(p => ({ full_path: p.full_path, title: p.title, status: p.status })));
  process.exit(0);
}

if (command === 'show') {
  const page = getPageByFullPath(args[1]);
  if (!page) return console.error('Not found');
  console.dir(page, { depth: 3 });
  process.exit(0);
}

if (command === 'preview') {
  const page = getPageByFullPath(args[1]);
  if (!page) return console.error('Not found');
  console.log(renderPage(page));
  process.exit(0);
}

if (command === 'create-page') {
  const title = args[1];
  let slug = args[2];
  const flags = parseFlags(3);
  if (!title) return console.error('Usage: create-page <title> [slug]');

  if (!slug) slug = title.replace(/\s+/g, '-');

  const result = createPage({
    title,
    slug,
    path_prefix: flags.prefix || '',
    direction: 'rtl',
    blocks: [
      { type: 'heading', id: 'h1', data: { level: 1, text: title } },
      { type: 'text', id: 't1', data: { content: 'תוכן חדש...' } }
    ]
  });
  console.log('✅ Created:', result.full_path);
  process.exit(0);
}

if (command === 'add-block') {
  const fullPath = args[1];
  const type = args[2];
  const rest = args.slice(3).join(' ');

  const page = getPageByFullPath(fullPath);
  if (!page) return console.error('Page not found');

  let data = {};
  if (type === 'hero') data = { title: rest || 'כותרת', subtitle: 'תת כותרת' };
  else if (type === 'heading') data = { level: 2, text: rest || 'כותרת' };
  else if (type === 'text') data = { content: rest || 'טקסט חדש' };
  else if (type === 'button') data = { text: rest || 'לחץ', url: '#' };
  else data = { content: rest };

  const newBlock = { type, id: 'b_' + Date.now(), data };
  updatePage(fullPath, { blocks: [...page.blocks, newBlock] });
  console.log(`✅ Added ${type} to ${fullPath}`);
  process.exit(0);
}

if (command === 'build') {
  const results = exportAll();
  console.log(`✅ Built ${results.length} pages to public/`);
  results.forEach(r => console.log('  ' + r.full_path));
  process.exit(0);
}

if (command === 'serve') {
  const port = parseInt(args[1]) || 8080;
  const publicDir = path.join(__dirname, '..', 'public');

  const server = http.createServer((req, res) => {
    let filePath = path.join(publicDir, req.url === '/' ? 'index.html' : req.url);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      const contentType = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
      }[ext] || 'text/plain';

      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port, () => {
    console.log(`✅ Serving static site at http://localhost:${port}`);
    console.log('   (Ctrl+C to stop)');
  });
  return;
}

if (command === 'import-wp') {
  const file = args[1];
  if (!file) {
    console.error('Usage: tapuz import-wp <wordpress-export.xml>');
    process.exit(1);
  }
  const { migrate } = require('../scripts/migrate-wp');
  migrate(file).catch(err => {
    console.error(err);
    process.exit(1);
  });
  return;
}

if (command === 'set-logo') {
  const flags = parseFlags(1);
  const config = loadConfig();

  if (flags.text) {
    config.logo = { type: 'text', text: flags.text };
  }
  if (flags.image) {
    config.logo = { 
      type: 'image', 
      image: flags.image, 
      width: flags.width || 180, 
      height: flags.height || 50 
    };
  }
  saveConfig(config);
  console.log('✅ Logo updated');
  process.exit(0);
}

if (command === 'set-menu') {
  const menuName = args[1];
  const json = args.slice(2).join(' ');
  if (!menuName || !json) return console.error('Usage: set-menu main \'[{"label":"Home","url":"/"}]\'');
  
  try {
    const menus = loadMenus();
    menus[menuName] = JSON.parse(json);
    saveMenus(menus);
    console.log(`✅ Menu "${menuName}" updated`);
  } catch (e) {
    console.error('Invalid JSON');
  }
  process.exit(0);
}

if (command === 'delete-page') {
  const ok = deletePage(args[1]);
  console.log(ok ? '✅ Deleted' : 'Not found');
  process.exit(0);
}

printHelp();
process.exit(1);
