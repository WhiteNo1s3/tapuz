'use strict';

/**
 * Industrial corpus scorer — HIS decompiler only.
 * Usage: node scripts/score-corpus.js
 * Fetches public URLs (or scores local fixtures) and prints leftover / toolGap / types.
 */

const fs = require('fs');
const path = require('path');
const { decompileUrl, decompileHtml } = require('../src/pzn/decompile');
const bentml = require('../src/bentml');

const LIVE = [
  { id: 'ynet-home', cls: 'he-news', url: 'https://www.ynet.co.il/' },
  { id: 'globes-home', cls: 'he-news', url: 'https://www.globes.co.il/' },
  { id: 'geektime', cls: 'he-tech', url: 'https://www.geektime.co.il/' },
  { id: 'timesofisrael', cls: 'he-news', url: 'https://www.timesofisrael.com/' },
  { id: 'ice', cls: 'he-tech', url: 'https://www.ice.co.il/' },
  { id: 'wp-news', cls: 'wp', url: 'https://wordpress.org/news/' },
  { id: 'wp-blog', cls: 'wp', url: 'https://en.blog.wordpress.com/' },
  { id: 'ghost-blog', cls: 'intl-blog', url: 'https://ghost.org/blog/' },
  { id: 'hubspot', cls: 'intl-blog', url: 'https://blog.hubspot.com/marketing' },
  { id: 'shopify-blog', cls: 'shop-blog', url: 'https://www.shopify.com/blog' },
  { id: 'elementor-blog', cls: 'wp', url: 'https://elementor.com/blog/' },
  { id: 'css-tricks', cls: 'tech-blog', url: 'https://css-tricks.com/' },
  { id: 'smashing', cls: 'tech-blog', url: 'https://www.smashingmagazine.com/' },
  { id: 'medium', cls: 'intl-blog', url: 'https://medium.com/' },
  { id: 'substack', cls: 'intl-blog', url: 'https://on.substack.com/' }
];

function tally(r) {
  const types = {};
  for (const b of r.blocks || []) types[b.type] = (types[b.type] || 0) + 1;
  let compileOk = false;
  let compileErr = '';
  try {
    const src = r.bentml || '';
    if (src) {
      bentml.compile(src);
      compileOk = true;
    }
  } catch (e) {
    compileErr = (e.code || '') + ' ' + (e.message || String(e)).slice(0, 80);
  }
  return {
    leftover: r.leftover,
    toolGap: r.toolGap || [],
    types,
    n: (r.blocks || []).length,
    compileOk,
    compileErr,
    HEADER: /HEADER/.test(r.bentml || ''),
    RELATED: /RELATED/.test(r.bentml || ''),
    COMMENTS: /COMMENTS/.test(r.bentml || ''),
    NEWSLETTER: /NEWSLETTER/.test(r.bentml || ''),
    PAGER: /PAGER/.test(r.bentml || ''),
    SEARCH: /SEARCH/.test(r.bentml || ''),
    AUTHOR: /AUTHOR|BYLINE/.test(r.bentml || ''),
    TAGS: /\bTAGS\b/.test(r.bentml || '')
  };
}

async function one(entry) {
  try {
    const r = await decompileUrl(entry.url);
    return { ...entry, ok: true, ...tally(r) };
  } catch (e) {
    return { ...entry, ok: false, err: e.message };
  }
}

async function fixture(id, file) {
  const html = fs.readFileSync(file, 'utf8');
  const r = decompileHtml(html);
  return { id, cls: 'fixture', url: file, ok: true, ...tally(r) };
}

(async () => {
  const rows = [];
  for (const e of LIVE) {
    process.stderr.write('fetch ' + e.id + '…\n');
    rows.push(await one(e));
  }
  const fixDir = path.join(__dirname, '..', 'test', 'fixtures', 'corpus');
  if (fs.existsSync(fixDir)) {
    for (const f of fs.readdirSync(fixDir).filter((n) => n.endsWith('.html'))) {
      rows.push(await fixture(f, path.join(fixDir, f)));
    }
  }
  for (const r of rows) {
    if (!r.ok) {
      console.log(JSON.stringify({ id: r.id, cls: r.cls, err: r.err }));
      continue;
    }
    console.log(JSON.stringify({
      id: r.id, leftover: r.leftover, toolGap: r.toolGap, types: r.types,
      n: r.n, compileOk: r.compileOk, compileErr: r.compileErr,
      RELATED: r.RELATED, COMMENTS: r.COMMENTS, NEWSLETTER: r.NEWSLETTER,
      PAGER: r.PAGER, SEARCH: r.SEARCH, HEADER: r.HEADER
    }));
  }
})();
