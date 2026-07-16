'use strict';

/**
 * SEO / link attributes for an <a> (v0.71): rel, target, title. Shared by the
 * compile path (modules/registry.js) and renderer.js so the two can't diverge
 * (same reason as card-html.js / ticker-html.js).
 *
 * Opening a new tab (target="_blank") ALWAYS merges in rel="noopener
 * noreferrer" — a security requirement, not optional — on top of any author
 * rel (nofollow / sponsored / ugc …). Unknown targets are dropped.
 */

const { escapeAttr } = require('./language/escape');

const TARGETS = new Set(['_self', '_blank', '_parent', '_top']);

/** props: { rel, target, title } → a leading-space attribute string, or ''. */
function linkSeoAttrs(props = {}) {
  const out = [];
  const target = TARGETS.has(props.target) && props.target !== '_self' ? props.target : '';
  const rel = [];
  if (props.rel) {
    String(props.rel).trim().split(/\s+/).forEach((r) => { if (r && !rel.includes(r)) rel.push(r); });
  }
  if (target === '_blank') {
    if (!rel.includes('noopener')) rel.push('noopener');
    if (!rel.includes('noreferrer')) rel.push('noreferrer');
  }
  if (rel.length) out.push(`rel="${escapeAttr(rel.join(' '))}"`);
  if (target) out.push(`target="${escapeAttr(target)}"`);
  if (props.title) out.push(`title="${escapeAttr(props.title)}"`);
  return out.length ? ' ' + out.join(' ') : '';
}

module.exports = { linkSeoAttrs };
