'use strict';

/**
 * Storage view (v0.63) — the "your content is real files on disk" section.
 *
 * Ben's file-first selling point made tangible: the user opens "אחסון" and sees
 * their actual files on the disk — pages as .pzn, media, and the site's JSON
 * config. Read-only presentation (metadata only: name, size, modified, and the
 * on-disk path); this never reads or exposes file CONTENTS, and it NEVER lists
 * the secret/ephemeral config files (auth, agent tokens, missions).
 */

const fs = require('fs');
const path = require('path');
const { PAGES_DIR, ASSETS_DIR, CONFIG_DIR, SITE_ROOT } = require('./paths');

// config files that hold secrets or throwaway runtime state — never surfaced.
// payments.json: the card gateway's keys and its token-sealing key (src/store/gateway/config.js)
const HIDDEN_CONFIG = new Set(['auth.json', 'agent-tokens.json', 'missions.json', 'payments.json']);

function statSafe(p) {
  try { return fs.statSync(p); } catch { return null; }
}

/** Files (not dirs) in `dir` passing `keep(name)`, with size + mtime. */
function listDirFiles(dir, keep) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of ents) {
    if (!e.isFile() || (keep && !keep(e.name))) continue;
    const st = statSafe(path.join(dir, e.name));
    out.push({ name: e.name, size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0 });
  }
  return out;
}

/** Path shown to the user — always relative to the site root, forward slashes. */
function onDisk(abs) {
  return path.relative(SITE_ROOT, abs).replace(/\\/g, '/');
}

/**
 * Everything the user owns on disk, grouped for presentation.
 * @returns {{ pages:object[], media:object[], siteData:object[], counts:object, root:string }}
 */
function listStorage() {
  // ── pages: pages/published + pages/drafts (.pzn), merged by slug ──
  const pubDir = path.join(PAGES_DIR, 'published');
  const draftDir = path.join(PAGES_DIR, 'drafts');
  const isPzn = (n) => n.toLowerCase().endsWith('.pzn');
  const bySlug = {};
  for (const f of listDirFiles(pubDir, isPzn)) {
    const slug = f.name.replace(/\.pzn$/i, '');
    bySlug[slug] = {
      slug, name: f.name, size: f.size, mtime: f.mtime,
      published: true, draft: false, diskPath: onDisk(path.join(pubDir, f.name))
    };
  }
  for (const f of listDirFiles(draftDir, isPzn)) {
    const slug = f.name.replace(/\.pzn$/i, '');
    if (bySlug[slug]) {
      bySlug[slug].draft = true;
    } else {
      bySlug[slug] = {
        slug, name: f.name, size: f.size, mtime: f.mtime,
        published: false, draft: true, diskPath: onDisk(path.join(draftDir, f.name))
      };
    }
  }
  const pages = Object.values(bySlug).sort((a, b) => b.mtime - a.mtime);

  // ── media: reuse the DB-backed manifest (url + name) ──
  let media = [];
  try {
    media = require('./media').listAllMedia(300).map((m) => ({ name: m.name, url: m.url }));
  } catch { /* fresh/empty DB */ }

  // ── site data: content/*.json + config/*.json (minus secrets) ──
  const contentDir = path.join(SITE_ROOT, 'content');
  const siteData = [];
  for (const f of listDirFiles(contentDir, (n) => n.toLowerCase().endsWith('.json'))) {
    siteData.push({ name: f.name, size: f.size, mtime: f.mtime, diskPath: onDisk(path.join(contentDir, f.name)) });
  }
  for (const f of listDirFiles(CONFIG_DIR, (n) => n.toLowerCase().endsWith('.json') && !HIDDEN_CONFIG.has(n.toLowerCase()))) {
    siteData.push({ name: f.name, size: f.size, mtime: f.mtime, diskPath: onDisk(path.join(CONFIG_DIR, f.name)) });
  }
  siteData.sort((a, b) => a.name.localeCompare(b.name));

  return {
    pages,
    media,
    siteData,
    counts: { pages: pages.length, media: media.length, siteData: siteData.length },
    root: onDisk(SITE_ROOT) || '.'
  };
}

module.exports = { listStorage, HIDDEN_CONFIG };
