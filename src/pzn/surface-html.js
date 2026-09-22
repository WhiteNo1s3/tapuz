'use strict';

/**
 * Human-fillable page-surface modules: search, newsletter, pager, consent,
 * related, comments, ad slot, auth strip. CSS-only published HTML (consent
 * dismisses with a checkbox hack — no JS). Shared by the pzn registry and
 * renderer.js so the two paths cannot drift.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');
const { blockOpts } = require('./block-attrs');

function renderSearch(props = {}, opts = {}) {
  const action = safeHref(props.action || '/search');
  const method = props.method === 'post' ? 'post' : 'get';
  const name = String(props.name || 'q').replace(/[^\w-]/g, '') || 'q';
  const ph = escapeAttr(props.placeholder || 'חיפוש…');
  const submit = escapeHtml(props.submit || 'חיפוש');
  const actionAttr = action && action !== '#' ? ` action="${escapeAttr(action)}"` : '';
  return `<form${opts.idAttr || ''} class="bent-search${opts.cls || ''}" role="search" method="${method}"${actionAttr}${opts.extra || ''}${opts.dir || ''}>` +
    `<input class="bent-search-input" type="search" name="${escapeAttr(name)}" placeholder="${ph}">` +
    `<button class="bent-search-submit" type="submit">${submit}</button></form>`;
}

function renderSearchFromData(data = {}, dir = '', attrs = {}) {
  return renderSearch(data, blockOpts(dir, attrs));
}

function renderNewsletter(props = {}, opts = {}) {
  const title = escapeHtml(props.title || '');
  const text = escapeHtml(props.text || '');
  const action = safeHref(props.action || '/api/form');
  const ph = escapeAttr(props.placeholder || 'האימייל שלכם');
  const submit = escapeHtml(props.submit || 'הרשמה');
  const actionAttr = action && action !== '#' ? ` action="${escapeAttr(action)}"` : '';
  const head = title ? `<h2 class="bent-newsletter-title">${title}</h2>` : '';
  const body = text ? `<p class="bent-newsletter-text">${text}</p>` : '';
  return `<section${opts.idAttr || ''} class="bent-newsletter${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>` +
    `${head}${body}` +
    `<form class="bent-newsletter-form" method="post"${actionAttr}>` +
    `<input type="email" name="email" required placeholder="${ph}" autocomplete="email">` +
    `<button type="submit">${submit}</button></form></section>`;
}

function renderNewsletterFromData(data = {}, dir = '', attrs = {}) {
  return renderNewsletter(data, blockOpts(dir, attrs));
}

function renderPageItem(props = {}, current = false) {
  const label = escapeHtml(props.label || '');
  const href = safeHref(props.url || props.href || '');
  if (current || !href || href === '#') {
    return `<li class="bent-pager-item" aria-current="page"><span class="bent-pager-current">${label}</span></li>`;
  }
  return `<li class="bent-pager-item"><a class="bent-pager-link" href="${escapeAttr(href)}">${label}</a></li>`;
}

function renderPager(props = {}, itemsHtml = '', opts = {}) {
  return `<nav${opts.idAttr || ''} class="bent-pager${opts.cls || ''}" aria-label="${escapeAttr(props.label || 'עמודים')}"${opts.extra || ''}${opts.dir || ''}>` +
    `<ol class="bent-pager-list">${itemsHtml}</ol></nav>`;
}

function renderPagerFromData(data = {}, dir = '', attrs = {}) {
  const items = data.items || [];
  const inner = items.map((it, idx) => {
    const current = !!(it && it.current) || (idx === items.length - 1 && !(it && (it.url || it.href)));
    return renderPageItem(it || {}, current);
  }).join('');
  return renderPager(data, inner, blockOpts(dir, attrs));
}

function renderConsent(props = {}, opts = {}) {
  const gid = 'bc-' + String(props.id || opts.gid || 'consent').replace(/[^\w-]/g, '');
  const text = escapeHtml(props.text || props.content || 'אתר זה משתמש בעוגיות כדי לשפר את החוויה.');
  const accept = escapeHtml(props.accept || 'אישור');
  const reject = escapeHtml(props.reject || 'סירוב');
  const policy = safeHref(props.policy || props.policyUrl || '');
  const policyLabel = escapeHtml(props.policyLabel || 'מדיניות פרטיות');
  const policyLink = policy && policy !== '#'
    ? `<a class="bent-consent-policy" href="${escapeAttr(policy)}">${policyLabel}</a>`
    : '';
  return `<div class="bent-consent-wrap${opts.cls || ''}">` +
    `<input type="checkbox" id="${escapeAttr(gid)}" class="bent-consent-toggle">` +
    `<aside${opts.idAttr || ''} class="bent-consent" role="dialog" aria-label="${escapeAttr(props.label || 'הסכמה לעוגיות')}"${opts.extra || ''}${opts.dir || ''}>` +
    `<p class="bent-consent-text">${text}</p>` +
    `<div class="bent-consent-actions">` +
    `<label class="bent-consent-accept" for="${escapeAttr(gid)}">${accept}</label>` +
    `<label class="bent-consent-reject" for="${escapeAttr(gid)}">${reject}</label>` +
    `${policyLink}</div></aside></div>`;
}

function renderConsentFromData(data = {}, dir = '', attrs = {}) {
  return renderConsent(data, blockOpts(dir, attrs));
}

function renderRelcard(props = {}) {
  const href = safeHref(props.href || props.url || '');
  const title = escapeHtml(props.title || '');
  const excerpt = escapeHtml(props.excerpt || '');
  const tag = escapeHtml(props.tag || '');
  const img = props.image
    ? `<img class="bent-related-image" src="${escapeAttr(safeHref(props.image))}" alt="${escapeAttr(props.alt || props.title || '')}" loading="lazy">`
    : '';
  const inner =
    (img ? `<div class="bent-related-media">${img}</div>` : '') +
    `<div class="bent-related-body">` +
      (tag ? `<span class="bent-related-tag">${tag}</span>` : '') +
      (title ? `<h3 class="bent-related-item-title">${title}</h3>` : '') +
      (excerpt ? `<p class="bent-related-excerpt">${excerpt}</p>` : '') +
    `</div>`;
  if (href && href !== '#') {
    return `<a class="bent-related-item" href="${escapeAttr(href)}">${inner}</a>`;
  }
  return `<article class="bent-related-item">${inner}</article>`;
}

function renderRelated(props = {}, itemsHtml = '', opts = {}) {
  const title = escapeHtml(props.title || 'כתבות נוספות');
  const head = title ? `<h2 class="bent-related-title">${title}</h2>` : '';
  return `<section${opts.idAttr || ''} class="bent-related${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>` +
    `${head}<div class="bent-related-grid">${itemsHtml}</div></section>`;
}

function renderRelatedFromData(data = {}, dir = '', attrs = {}) {
  const inner = (data.items || []).map((it) => renderRelcard(it || {})).join('');
  return renderRelated(data, inner, blockOpts(dir, attrs));
}

function renderComment(props = {}) {
  const author = escapeHtml(props.author || '');
  const time = escapeHtml(props.time || '');
  const text = escapeHtml(props.text || '');
  const meta = (author ? `<b class="bent-comment-author">${author}</b>` : '') +
    (time ? `<time class="bent-comment-time">${time}</time>` : '');
  return `<article class="bent-comment">` +
    (meta ? `<header class="bent-comment-meta">${meta}</header>` : '') +
    `<p class="bent-comment-text">${text}</p></article>`;
}

function renderComments(props = {}, itemsHtml = '', opts = {}) {
  const title = escapeHtml(props.title || 'תגובות');
  const head = title ? `<h2 class="bent-comments-title">${title}</h2>` : '';
  return `<section${opts.idAttr || ''} class="bent-comments${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>` +
    `${head}${itemsHtml}</section>`;
}

function renderCommentsFromData(data = {}, dir = '', attrs = {}) {
  const inner = (data.items || []).map((it) => {
    const p = Object.assign({}, it || {});
    if (!p.text && it && it.content) p.text = it.content;
    return renderComment(p);
  }).join('');
  return renderComments(data, inner, blockOpts(dir, attrs));
}

function renderSlot(props = {}, opts = {}) {
  const label = escapeHtml(props.label || 'פרסומת');
  const advertiser = escapeHtml(props.advertiser || '');
  const href = safeHref(props.url || props.href || '');
  const src = safeHref(props.src || props.image || '');
  const img = src && src !== '#'
    ? `<img class="bent-slot-image" src="${escapeAttr(src)}" alt="${escapeAttr(props.alt || label)}" loading="lazy">`
    : `<span class="bent-slot-placeholder">${label}</span>`;
  const media = href && href !== '#'
    ? `<a class="bent-slot-link" href="${escapeAttr(href)}" rel="noopener noreferrer sponsored">${img}</a>`
    : img;
  const who = advertiser ? `<span class="bent-slot-advertiser">${advertiser}</span>` : '';
  return `<aside${opts.idAttr || ''} class="bent-slot${opts.cls || ''}" aria-label="${escapeAttr(label)}"${opts.extra || ''}${opts.dir || ''}>` +
    `<span class="bent-slot-label">${label}</span>${media}${who}</aside>`;
}

function renderSlotFromData(data = {}, dir = '', attrs = {}) {
  return renderSlot(data, blockOpts(dir, attrs));
}

function renderAuth(props = {}, opts = {}) {
  const greeting = escapeHtml(props.text || props.greeting || '');
  const login = escapeHtml(props.login || 'כניסה');
  const loginUrl = safeHref(props.loginurl || props.loginUrl || '/login');
  const register = escapeHtml(props.register || 'הרשמה');
  const registerUrl = safeHref(props.registerurl || props.registerUrl || '/signup');
  const hello = greeting ? `<span class="bent-auth-hello">${greeting}</span>` : '';
  return `<nav${opts.idAttr || ''} class="bent-auth${opts.cls || ''}" aria-label="${escapeAttr(props.label || 'חשבון')}"${opts.extra || ''}${opts.dir || ''}>` +
    `${hello}` +
    `<a class="bent-auth-login" href="${escapeAttr(loginUrl && loginUrl !== '#' ? loginUrl : '/login')}">${login}</a>` +
    `<a class="bent-auth-register" href="${escapeAttr(registerUrl && registerUrl !== '#' ? registerUrl : '/signup')}">${register}</a>` +
    `</nav>`;
}

function renderAuthFromData(data = {}, dir = '', attrs = {}) {
  return renderAuth(data, blockOpts(dir, attrs));
}

module.exports = {
  renderSearch,
  renderSearchFromData,
  renderNewsletter,
  renderNewsletterFromData,
  renderPageItem,
  renderPager,
  renderPagerFromData,
  renderConsent,
  renderConsentFromData,
  renderRelcard,
  renderRelated,
  renderRelatedFromData,
  renderComment,
  renderComments,
  renderCommentsFromData,
  renderSlot,
  renderSlotFromData,
  renderAuth,
  renderAuthFromData
};
