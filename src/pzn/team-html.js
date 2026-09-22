'use strict';

/**
 * Shared team-grid HTML — the gap-audit find that flattened worst: real
 * business sites all carry an "our team" section (photo, name, role, bio)
 * and the decompiler was scattering it into generic cards. One renderer for
 * compile and renderer.js so they cannot diverge. Zero JS: a responsive
 * grid; the photo is round via CSS.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');
const { blockOpts } = require('./block-attrs');

/** One member → <article class="bent-member">. props: {name, role, image, bio, url} */
function renderMember(props = {}) {
  const name = escapeHtml(props.name || '');
  const role = escapeHtml(props.role || '');
  const bio = escapeHtml(props.bio || '');
  const image = String(props.image || '').trim();
  const href = safeHref(props.url || '');
  const photo = image
    ? `<img class="bent-member-photo" src="${escapeAttr(image)}" alt="${escapeAttr(props.name || '')}" loading="lazy">`
    : '<span class="bent-member-photo bent-member-photo-empty" aria-hidden="true">👤</span>';
  const nameHtml = href && href !== '#'
    ? `<a class="bent-member-name" href="${escapeAttr(href)}">${name}</a>`
    : `<h3 class="bent-member-name">${name}</h3>`;
  return `<article class="bent-member">` +
    photo +
    (name ? nameHtml : '') +
    (role ? `<p class="bent-member-role">${role}</p>` : '') +
    (bio ? `<p class="bent-member-bio">${bio}</p>` : '') +
    '</article>';
}

/** The team grid around already-rendered member cards. */
function renderTeam(props = {}, itemsHtml = '', opts = {}) {
  return `<section${opts.idAttr || ''} class="bent-team${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>${itemsHtml}</section>`;
}

/** Convenience for the renderer: whole team block from block.data (items array). */
function renderTeamFromData(data = {}, dir = '', attrs = {}) {
  const items = (data.items || []).map((it) => renderMember(it || {})).join('');
  return renderTeam(data, items, blockOpts(dir, attrs));
}

module.exports = { renderMember, renderTeam, renderTeamFromData };
