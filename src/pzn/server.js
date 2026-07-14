'use strict';

/**
 * Lightweight PZN builder server (zero Express dependency).
 * Serves visualization UI + JSON API for load / apply / insert / commands.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const loader = require('./loader/pzn-loader');

const ROOT = path.join(__dirname, '..');
const BUILDER_DIR = path.join(ROOT, 'builder');
const EXAMPLES_DIR = path.join(ROOT, 'examples');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pzn': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function send(res, status, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '', 'utf8');
  res.writeHead(status, {
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(payload);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8'
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeExample(name) {
  const base = path.basename(name);
  if (!base.endsWith('.pzn')) return null;
  const full = path.join(EXAMPLES_DIR, base);
  if (!full.startsWith(EXAMPLES_DIR)) return null;
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

async function handleApi(req, res, url) {
  const route = url.pathname.replace(/^\/api/, '') || '/';

  if (req.method === 'GET' && route === '/health') {
    return sendJson(res, 200, { ok: true, service: 'pzn-loader' });
  }

  if (req.method === 'GET' && route === '/blank') {
    return sendJson(res, 200, loader.loadBlank({ includeAgentSheet: true }));
  }

  if (req.method === 'GET' && route === '/commands') {
    return sendJson(res, 200, loader.getCommandCatalog());
  }

  if (req.method === 'GET' && route === '/agent-sheet') {
    return sendJson(res, 200, loader.getAgentCommandSheet());
  }

  if (req.method === 'GET' && route === '/examples') {
    const list = fs
      .readdirSync(EXAMPLES_DIR)
      .filter((f) => f.endsWith('.pzn'))
      .map((f) => ({ name: f, url: `/api/example/${f}` }));
    return sendJson(res, 200, { examples: list });
  }

  if (req.method === 'GET' && route.startsWith('/example/')) {
    const name = decodeURIComponent(route.slice('/example/'.length));
    const text = safeExample(name);
    if (text == null) return sendJson(res, 404, { error: 'Example not found' });
    return sendJson(res, 200, loader.acceptPzn(text, { includeAgentSheet: true }));
  }

  if (req.method === 'POST' && route === '/load') {
    const body = JSON.parse((await readBody(req)) || '{}');
    return sendJson(
      res,
      200,
      loader.loadPzn(body.source, {
        articles: body.articles,
        categories: body.categories,
        customCss: body.customCss,
        includeAgentSheet: body.includeAgentSheet !== false
      })
    );
  }

  if (req.method === 'POST' && route === '/apply') {
    const body = JSON.parse((await readBody(req)) || '{}');
    if (typeof body.source !== 'string') {
      return sendJson(res, 400, { error: 'source (benTML string) required' });
    }
    return sendJson(
      res,
      200,
      loader.applySource(body.source, {
        articles: body.articles,
        categories: body.categories,
        customCss: body.customCss || ''
      })
    );
  }

  if (req.method === 'POST' && route === '/insert') {
    const body = JSON.parse((await readBody(req)) || '{}');
    if (!body.module) return sendJson(res, 400, { error: 'module type required' });
    return sendJson(
      res,
      200,
      loader.insertModule(body.source || '', body.module, {
        parentId: body.parentId || null,
        index: body.index,
        customCss: body.customCss || '',
        articles: body.articles,
        categories: body.categories
      })
    );
  }

  return sendJson(res, 404, { error: 'Unknown API route', route });
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = decodeURIComponent(rel.split('?')[0]);
  if (rel.includes('..')) return send(res, 400, 'Bad path');

  const file = path.join(BUILDER_DIR, rel.replace(/^\//, ''));
  if (!file.startsWith(BUILDER_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'Not found');
  }
  const ext = path.extname(file);
  send(res, 200, fs.readFileSync(file), {
    'Content-Type': MIME[ext] || 'application/octet-stream'
  });
}

/**
 * @param {{ port?: number, host?: string }} [opts]
 * @returns {Promise<{ server: import('http').Server, port: number, url: string }>}
 */
function startServer(opts = {}) {
  const port = opts.port != null ? opts.port : 4747;
  const host = opts.host || '127.0.0.1';

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${host}:${port}`);
      if (url.pathname.startsWith('/api')) {
        return await handleApi(req, res, url);
      }
      return serveStatic(req, res, url.pathname);
    } catch (err) {
      sendJson(res, 500, { error: err.message || String(err) });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const url = `http://${host}:${port}/`;
      resolve({ server, port, url });
    });
  });
}

if (require.main === module) {
  startServer()
    .then(({ url }) => {
      console.log(`PZN loader + builder: ${url}`);
      console.log('Visualize .pzn · edit benTML source · module commands+perks');
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { startServer };
