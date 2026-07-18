'use strict';

/**
 * Generate docs/ROUTE-MAP.md — the navigational manifest for the now-modular
 * HTTP surface. After the v0.96–v1.35 extractions, routing lives across ~30
 * files in src/routes/ plus a lean remainder in src/server.js, and server.js's
 * mounts don't show the paths (they're inside each module). This map answers
 * "which file owns /admin/X?" at a glance — so editing the code is navigation,
 * not a grep hunt. Built FROM the source, drift-guarded by smoke-route-map.js.
 *
 * Run: node scripts/gen-route-map.js   (or `npm run gen:route-map`)
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const ROUTES_DIR = path.join(SRC, 'routes');
const OUT = path.join(__dirname, '..', 'docs', 'ROUTE-MAP.md');

const ROUTE_RE = /\b(?:router|app)\.(get|post|put|delete)\(\s*'([^']+)'/g;

/** Extract [{method, route}] from one file's source, in source order. */
function routesOf(source) {
  const out = [];
  let m;
  ROUTE_RE.lastIndex = 0;
  while ((m = ROUTE_RE.exec(source))) {
    // skip mount helpers like app.use(...) — only real path routes match anyway
    out.push({ method: m[1].toUpperCase(), route: m[2] });
  }
  return out;
}

/**
 * Build the ROUTE-MAP.md markdown from the live source. Exported so the
 * drift guard (smoke-route-map.js) compares against the EXACT same logic —
 * single source of truth, same discipline as buildCatalog for the pzn spec.
 * @returns {{ markdown: string, total: number, fileCount: number }}
 */
function buildRouteMap() {
  const files = [];
  files.push({ file: 'src/server.js', source: fs.readFileSync(path.join(SRC, 'server.js'), 'utf8') });
  for (const f of fs.readdirSync(ROUTES_DIR).filter((n) => n.endsWith('.js')).sort()) {
    files.push({ file: 'src/routes/' + f, source: fs.readFileSync(path.join(ROUTES_DIR, f), 'utf8') });
  }

  const byFile = [];
  let total = 0;
  for (const { file, source } of files) {
    const routes = routesOf(source);
    if (routes.length) { byFile.push({ file, routes }); total += routes.length; }
  }

  const flat = [];
  for (const { file, routes } of byFile) for (const r of routes) flat.push({ ...r, file });
  flat.sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method));

  const L = [];
  L.push('# Route map — which file owns which HTTP route');
  L.push('');
  L.push('Generated from the source by `scripts/gen-route-map.js` (regenerate with');
  L.push('`npm run gen:route-map`; `smoke-route-map.js` fails the build if this drifts).');
  L.push('The navigational manifest for the modular HTTP surface: after the route-group');
  L.push('extractions, every admin/public/agent route lives in its own module — this');
  L.push('shows where, so editing is navigation, not a grep hunt.');
  L.push('');
  L.push(`**${total} routes across ${byFile.length} files.**`);
  L.push('');
  L.push('## By file (what each module owns)');
  L.push('');
  for (const { file, routes } of byFile) {
    L.push(`### \`${file}\` — ${routes.length} route${routes.length === 1 ? '' : 's'}`);
    L.push('');
    for (const r of routes) L.push(`- \`${r.method} ${r.route}\``);
    L.push('');
  }
  L.push('## Alphabetical (find a route → its file)');
  L.push('');
  L.push('| Route | Method | File |');
  L.push('|---|---|---|');
  for (const r of flat) L.push(`| \`${r.route}\` | ${r.method} | \`${r.file}\` |`);
  L.push('');

  return { markdown: L.join('\n') + '\n', total, fileCount: byFile.length };
}

module.exports = { buildRouteMap };

if (require.main === module) {
  const { markdown, total, fileCount } = buildRouteMap();
  fs.writeFileSync(OUT, markdown, 'utf8');
  console.log(`wrote docs/ROUTE-MAP.md (${total} routes across ${fileCount} files)`);
}
