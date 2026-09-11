'use strict';

/**
 * Decompiler parsers for page-surface modules (search, newsletter, pager,
 * consent, related, comments, ad slot, auth). Bound from graduate.js so the
 * hunt and the flat walk share one implementation.
 */

function createSurfaceParsers(g) {
  const {
    parseFormFields,
    collectFormFields,
    isPageForm,
    matchClose,
    textOf,
    unescapeHtml,
    hintHay,
    classHay,
    extractCard,
    childSpans,
    HEADING,
    parseNavItems,
    collectChromeLinks,
    timeText,
    imageSrcOf,
    countHeadings
  } = g;

  const SEARCH_CLASS = /\b(?:search(?:-form|-box|-bar|-widget)?|site-search|header-search|bent-search)\b/i;
  const NEWSLETTER_CLASS = /\b(?:newsletter|subscribe|mailchimp|mc-embed|mailing-list|newsletterreg|bent-newsletter)\b/i;
  const PAGER_CLASS = /\b(?:pagination|pager|paginate|page-numbers|bent-pager)\b/i;
  const CONSENT_CLASS = /\b(?:cookie(?:-banner|-notice|-consent|-bar)?|gdpr|consent-banner|cookieconsent|cc-window|bent-consent)\b/i;
  const RELATED_CLASS = /\b(?:related(?:-posts|-articles|-content|-stories)?|more-stories|more-from|you-may-also|read-more-stories|bent-related)\b/i;
  const COMMENTS_CLASS = /\b(?:comments?|comment-list|commentlist|comment-thread|bent-comments)\b/i;
  const SLOT_CLASS = /\b(?:adsbygoogle|ad-slot|ad-unit|advertisement|advert|google-ad|dfp-ad|gpt-ad|sponsored-slot|bent-slot)\b/i;
  const AUTH_CLASS = /\b(?:account-menu|user-menu|user-nav|login-bar|login-nav|auth-nav|account-links|bent-auth)\b/i;

  function looksLikeSearch(t) {
    if (!t) return false;
    if (t.name === 'search') return true;
    const role = (t.attrs && t.attrs.role) || '';
    if (role === 'search') return true;
    const action = (t.attrs && t.attrs.action) || '';
    if (/search/i.test(action)) return true;
    return SEARCH_CLASS.test(hintHay(t));
  }

  function looksLikeNewsletter(t) {
    return !!(t && NEWSLETTER_CLASS.test(hintHay(t)));
  }

  function looksLikePager(t) {
    if (!t) return false;
    if (PAGER_CLASS.test(hintHay(t))) return true;
    const aria = (t.attrs && t.attrs['aria-label']) || '';
    return /pagination|pager|עמודים/i.test(aria);
  }

  function looksLikeConsent(t) {
    return !!(t && CONSENT_CLASS.test(hintHay(t)));
  }

  function looksLikeRelated(t) {
    return !!(t && RELATED_CLASS.test(hintHay(t)));
  }

  function looksLikeComments(t) {
    if (!t) return false;
    const id = (t.attrs && t.attrs.id) || '';
    if (/^comments?$/i.test(id)) return true;
    return COMMENTS_CLASS.test(hintHay(t));
  }

  function looksLikeSlot(t) {
    if (!t) return false;
    if (t.name === 'ins' && /adsbygoogle/i.test(classHay(t))) return true;
    return SLOT_CLASS.test(hintHay(t));
  }

  function looksLikeAuth(t) {
    return !!(t && AUTH_CLASS.test(hintHay(t)));
  }

  function submitLabelOf(tokens, from, to) {
    for (let j = from; j < to; j++) {
      const tk = tokens[j];
      if (tk.kind !== 'open') continue;
      const close = matchClose(tokens, j);
      if (tk.name === 'button') {
        const label = unescapeHtml(textOf(tokens, j + 1, close - 1)).replace(/\s+/g, ' ').trim();
        if (label) return label.slice(0, 40);
      }
      if (tk.name === 'input' && /submit|button/i.test((tk.attrs && tk.attrs.type) || '')) {
        const v = (tk.attrs && tk.attrs.value) || '';
        if (v) return String(v).slice(0, 40);
      }
      j = close - 1;
    }
    return '';
  }

  function headingIn(tokens, from, to) {
    for (let j = from; j < to; j++) {
      const tk = tokens[j];
      if (tk.kind !== 'open' || !HEADING.test(tk.name)) continue;
      const close = matchClose(tokens, j);
      const title = unescapeHtml(textOf(tokens, j + 1, close - 1)).replace(/\s+/g, ' ').trim();
      if (title) return title.slice(0, 80);
      j = close - 1;
    }
    return '';
  }

  function locateForm(tokens, i, end, t) {
    if (t.name === 'form' || t.name === 'search') return { fi: i, fend: end, ft: t };
    for (let j = i + 1; j < end - 1; j++) {
      if (tokens[j].kind === 'open' && tokens[j].name === 'form') {
        return { fi: j, fend: matchClose(tokens, j), ft: tokens[j] };
      }
    }
    return null;
  }

  function fieldsOf(tokens, i, end, t) {
    const loc = locateForm(tokens, i, end, t);
    if (loc) return { fields: parseFormFields(tokens, loc.fi, loc.fend), loc };
    return { fields: collectFormFields(tokens, i + 1, end - 1), loc: { fi: i, fend: end, ft: t } };
  }

  function parseSearchData(tokens, i, end, t) {
    if (!t) return null;
    const { fields, loc } = fieldsOf(tokens, i, end, t);
    if (isPageForm(tokens, i, end, fields)) return null;
    if (fields.length !== 1) return null;
    const f = fields[0];
    const ftype = String(f.type || 'text');
    if (ftype === 'email' || ftype === 'textarea') return null;
    const fname = String(f.name || '').toLowerCase();
    const hinted = looksLikeSearch(t) || looksLikeSearch(loc.ft);
    const named = ftype === 'search' || /^(q|query|s|search|term)$/i.test(fname);
    if (!hinted && !named) return null;
    const action = (loc.ft.attrs && loc.ft.attrs.action)
      || (t.attrs && t.attrs.action)
      || '/search';
    const method = /post/i.test((loc.ft.attrs && loc.ft.attrs.method) || '') ? 'post' : 'get';
    const submit = submitLabelOf(tokens, loc.fi + 1, loc.fend - 1) || 'חיפוש';
    const out = {
      placeholder: f.placeholder || 'חיפוש…',
      action: action || '/search',
      name: f.name || 'q',
      submit
    };
    if (method !== 'get') out.method = method;
    return out;
  }

  function parseNewsletterData(tokens, i, end, t) {
    if (!t) return null;
    const { fields, loc } = fieldsOf(tokens, i, end, t);
    if (isPageForm(tokens, i, end, fields)) return null;
    if (fields.length < 1 || fields.length > 2) return null;
    if (fields.some((f) => f.type === 'textarea')) return null;
    const email = fields.find((f) => f.type === 'email' || /e-?mail|mail/i.test(f.name || ''));
    if (!email) return null;
    const hinted = looksLikeNewsletter(t) || looksLikeNewsletter(loc.ft);
    const submit = submitLabelOf(tokens, loc.fi + 1, loc.fend - 1) || '';
    const subHint = /subscribe|newsletter|הרשמ|עדכון/i.test(submit);
    if (!hinted && !subHint && fields.length !== 1) return null;
    const action = (loc.ft.attrs && loc.ft.attrs.action) || (t.attrs && t.attrs.action) || '/api/form';
    const title = headingIn(tokens, i + 1, end - 1);
    const out = {
      placeholder: email.placeholder || 'האימייל שלכם',
      submit: submit || 'הרשמה',
      action: action || '/api/form'
    };
    if (title) out.title = title;
    return out;
  }

  function extractPageItem(tokens, s, e) {
    let label = '';
    let url = '';
    let current = false;
    const root = tokens[s];
    const aria = (root.attrs && (root.attrs['aria-current'] || root.attrs['aria-current'])) || '';
    if (aria === 'page') current = true;
    if (/current|active|is-current|selected/i.test((root.attrs && root.attrs.class) || '')) current = true;
    for (let j = s; j < e; j++) {
      const tk = tokens[j];
      if (tk.kind !== 'open') continue;
      const close = matchClose(tokens, j);
      if (tk.name === 'a') {
        url = (tk.attrs && tk.attrs.href) || url;
        if (!label) label = unescapeHtml(textOf(tokens, j + 1, close - 1)).replace(/\s+/g, ' ').trim();
        j = close - 1;
        continue;
      }
      if (!label && (tk.name === 'span' || tk.name === 'em' || tk.name === 'strong')) {
        const txt = unescapeHtml(textOf(tokens, j + 1, close - 1)).replace(/\s+/g, ' ').trim();
        if (txt && !/^[./›»·•]+$/.test(txt)) label = txt;
        j = close - 1;
      }
    }
    if (!label) label = unescapeHtml(textOf(tokens, s + 1, e - 1)).replace(/\s+/g, ' ').trim();
    label = label.replace(/\s+/g, ' ').trim();
    if (!label || /^[./›»·•]+$/.test(label) || label.length > 40) return null;
    const out = { label };
    if (url && url !== '#') out.url = url;
    else current = true;
    if (current) out.current = true;
    return out;
  }

  function parsePagerData(tokens, i, end, t) {
    if (!looksLikePager(t)) return null;
    const items = [];
    function collect(from, to) {
      for (let j = from; j < to; j++) {
        const tk = tokens[j];
        if (tk.kind !== 'open') continue;
        const e = matchClose(tokens, j);
        if (tk.name === 'ol' || tk.name === 'ul') {
          collect(j + 1, e - 1);
          j = e - 1;
          continue;
        }
        if (tk.name === 'li' || tk.name === 'a' || tk.name === 'span' || tk.name === 'button') {
          const item = extractPageItem(tokens, j, e);
          if (item) items.push(item);
          j = e - 1;
        }
      }
    }
    collect(i + 1, end - 1);
    if (items.length < 2) return null;
    const out = { items: items.slice(0, 24) };
    const aria = (t.attrs && t.attrs['aria-label']) || '';
    if (aria && !/pagination|pager/i.test(aria)) out.label = aria.slice(0, 40);
    return out;
  }

  function parseConsentData(tokens, i, end, t) {
    if (!looksLikeConsent(t)) return null;
    const blob = unescapeHtml(textOf(tokens, i + 1, end - 1)).replace(/\s+/g, ' ').trim();
    if (blob.length < 8 || blob.length > 900) return null;
    if (countHeadings(tokens, i + 1, end - 1) > 2) return null;
    let accept = 'אישור';
    let reject = '';
    let policy = '';
    let policyLabel = '';
    for (let j = i + 1; j < end - 1; j++) {
      const tk = tokens[j];
      if (tk.kind !== 'open') continue;
      const close = matchClose(tokens, j);
      const label = unescapeHtml(textOf(tokens, j + 1, close - 1)).replace(/\s+/g, ' ').trim();
      const href = (tk.attrs && tk.attrs.href) || '';
      const cls = (tk.attrs && tk.attrs.class) || '';
      if ((tk.name === 'button' || tk.name === 'a' || tk.name === 'label') && label) {
        if (/accept|agree|אישור|הסכם|מאשר/i.test(label + ' ' + cls) && accept === 'אישור') accept = label.slice(0, 40);
        else if (/reject|decline|סירוב|דחה/i.test(label + ' ' + cls)) reject = label.slice(0, 40);
        else if (/privacy|policy|פרטיות|מדיניות/i.test(label + ' ' + href) && href) {
          policy = href;
          policyLabel = label.slice(0, 40);
        }
      }
      j = close - 1;
    }
    const links = collectChromeLinks(tokens, i + 1, end - 1);
    if (!policy) {
      const pol = links.find((it) => /privacy|policy|פרטיות/i.test((it.href || '') + ' ' + (it.label || '')));
      if (pol) {
        policy = pol.href;
        policyLabel = pol.label;
      }
    }
    const out = { text: blob.slice(0, 400), accept };
    if (reject) out.reject = reject;
    if (policy) out.policy = policy;
    if (policyLabel) out.policyLabel = policyLabel;
    return out;
  }

  function parseRelatedData(tokens, i, end, t, bgMap) {
    if (!looksLikeRelated(t)) return null;
    let title = '';
    const items = [];
    for (const [s, e] of childSpans(tokens, i + 1, end - 1)) {
      const tk = tokens[s];
      if (HEADING.test(tk.name) && !title) {
        title = unescapeHtml(textOf(tokens, s + 1, e - 1)).replace(/\s+/g, ' ').trim().slice(0, 80);
        continue;
      }
      if (tk.name === 'ul' || tk.name === 'ol' || tk.name === 'div') {
        for (const [cs, ce] of childSpans(tokens, s + 1, e - 1)) {
          const card = extractCard(tokens, cs, ce, bgMap);
          if (card) items.push(card);
        }
      }
      const card = extractCard(tokens, s, e, bgMap);
      if (card) items.push(card);
    }
    if (items.length < 2) return null;
    const out = { items: items.slice(0, 12) };
    if (title) out.title = title;
    return out;
  }

  function extractComment(tokens, s, e) {
    let author = '';
    let time = '';
    let text = '';
    for (let j = s; j < e; j++) {
      const tk = tokens[j];
      if (tk.kind !== 'open') continue;
      const close = matchClose(tokens, j);
      const cls = (tk.attrs && tk.attrs.class) || '';
      if (!author && (/author|comment-author|\bfn\b/i.test(cls) || tk.name === 'b' || tk.name === 'strong' || tk.name === 'cite')) {
        author = unescapeHtml(textOf(tokens, j + 1, close - 1)).replace(/\s+/g, ' ').trim().slice(0, 80);
        j = close - 1;
        continue;
      }
      if (!time && (tk.name === 'time' || /comment-date|comment-time|date|datetime/i.test(cls))) {
        time = timeText(tokens, j, close, tk)
          || unescapeHtml(textOf(tokens, j + 1, close - 1)).replace(/\s+/g, ' ').trim();
        j = close - 1;
        continue;
      }
      if (!text && (tk.name === 'p' || /comment-body|comment-content|comment-text/i.test(cls))) {
        text = unescapeHtml(textOf(tokens, j + 1, close - 1)).replace(/\s+/g, ' ').trim().slice(0, 500);
        j = close - 1;
      }
    }
    if (!text) text = unescapeHtml(textOf(tokens, s + 1, e - 1)).replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!text || text.length < 3) return null;
    const out = { text };
    if (author) out.author = author;
    if (time) out.time = time;
    return out;
  }

  function parseCommentsData(tokens, i, end, t) {
    if (!looksLikeComments(t)) return null;
    const items = [];
    let title = '';
    for (const [s, e] of childSpans(tokens, i + 1, end - 1)) {
      const tk = tokens[s];
      if (HEADING.test(tk.name) && !title) {
        title = unescapeHtml(textOf(tokens, s + 1, e - 1)).replace(/\s+/g, ' ').trim().slice(0, 80);
        continue;
      }
      if (tk.name === 'ol' || tk.name === 'ul') {
        for (const [ls, le] of childSpans(tokens, s + 1, e - 1)) {
          const c = extractComment(tokens, ls, le);
          if (c) items.push(c);
        }
        continue;
      }
      const c = extractComment(tokens, s, e);
      if (c) items.push(c);
    }
    if (!items.length) return null;
    const out = { items: items.slice(0, 24) };
    if (title) out.title = title;
    return out;
  }

  function parseSlotData(tokens, i, end, t) {
    if (!looksLikeSlot(t)) return null;
    if (countHeadings(tokens, i + 1, end - 1) > 2) return null;
    let articles = 0;
    for (let j = i + 1; j < end - 1; j++) {
      if (tokens[j].kind === 'open' && tokens[j].name === 'article') articles += 1;
    }
    if (articles >= 2) return null;
    let src = '';
    let url = '';
    for (let j = i; j < end; j++) {
      const tk = tokens[j];
      if (tk.kind !== 'open') continue;
      if (!src && (tk.name === 'img' || tk.name === 'source')) src = imageSrcOf(tk.attrs);
      if (!url && tk.name === 'a' && tk.attrs && tk.attrs.href) url = tk.attrs.href;
    }
    const aria = (t.attrs && t.attrs['aria-label']) || '';
    const label = (aria || 'פרסומת').slice(0, 40);
    const blob = unescapeHtml(textOf(tokens, i + 1, end - 1)).replace(/\s+/g, ' ').trim();
    const out = { label };
    if (src) out.src = src;
    if (url && url !== '#') out.url = url;
    if (blob && blob.length < 60) out.advertiser = blob;
    return out;
  }

  function parseAuthData(tokens, i, end, t) {
    const items = parseNavItems(tokens, i, end);
    if (items.length < 1 || items.length > 6) return null;
    const login = items.find((it) => /login|sign[-_]?in|כניסה|התחבר/i.test((it.href || '') + ' ' + (it.label || '')));
    const register = items.find((it) => /sign[-_]?up|register|הרשמ/i.test((it.href || '') + ' ' + (it.label || '')));
    if (!looksLikeAuth(t) && !(login && register)) return null;
    if (!login && !register) return null;
    const out = {};
    if (login) {
      out.login = login.label;
      out.loginurl = login.href;
    }
    if (register) {
      out.register = register.label;
      out.registerurl = register.href;
    }
    return out;
  }

  return {
    parseSearchData,
    parseNewsletterData,
    parsePagerData,
    parseConsentData,
    parseRelatedData,
    parseCommentsData,
    parseSlotData,
    parseAuthData,
    looksLikeSearch,
    looksLikeNewsletter,
    looksLikePager,
    looksLikeConsent,
    looksLikeRelated,
    looksLikeComments,
    looksLikeSlot,
    looksLikeAuth
  };
}

module.exports = { createSurfaceParsers };
