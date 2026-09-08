'use strict';

/**
 * Shared WhatsApp button HTML — the first-class page module the decompiler
 * kept asking for ("real sites want a first-class whatsapp module"). Distinct
 * from the site-chrome float (config.integrations.whatsapp): this one sits
 * in the page flow, with its own text and pre-filled message. Zero JS.
 */

const { escapeHtml, escapeAttr } = require('./language/escape');

const WA_ICON = '<svg class="bent-whatsapp-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
  '<path fill="currentColor" d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.88-.79-1.48-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.62.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35M12.05 21.78h-.01a9.86 9.86 0 0 1-5.03-1.38l-.36-.21-3.73.98 1-3.64-.24-.37a9.82 9.82 0 0 1-1.51-5.25c0-5.44 4.43-9.87 9.88-9.87 2.64 0 5.12 1.03 6.98 2.9a9.82 9.82 0 0 1 2.89 6.98c0 5.45-4.43 9.86-9.87 9.86m8.4-18.26A11.8 11.8 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.9c0 2.1.55 4.15 1.59 5.95L.06 24l6.3-1.65a11.9 11.9 0 0 0 5.69 1.45h.01c6.55 0 11.89-5.34 11.89-11.9 0-3.18-1.24-6.17-3.5-8.42"/></svg>';

/** Digits-only phone for wa.me (drops +, spaces, dashes); '' when nothing usable. */
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 7 ? digits : '';
}

/** The wa.me link for a phone + optional pre-filled message. */
function whatsappHref(phone, message) {
  const num = normalizePhone(phone);
  if (!num) return '';
  const msg = String(message || '').trim();
  return `https://wa.me/${num}${msg ? '?text=' + encodeURIComponent(msg) : ''}`;
}

/** Whole WhatsApp button. props: {phone, message, text} */
function renderWhatsapp(props = {}, opts = {}) {
  const href = whatsappHref(props.phone, props.message);
  const text = escapeHtml(props.text || 'דברו איתנו בוואטסאפ');
  const inner = `${WA_ICON}<span class="bent-whatsapp-text">${text}</span>`;
  if (!href) {
    // no usable number → an inert pill, never a broken link
    return `<span${opts.idAttr || ''} class="bent-whatsapp bent-whatsapp-empty${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>${inner}</span>`;
  }
  return `<a${opts.idAttr || ''} class="bent-whatsapp${opts.cls || ''}" href="${escapeAttr(href)}" target="_blank" rel="noopener"${opts.extra || ''}${opts.dir || ''}>${inner}</a>`;
}

/** Convenience for the renderer: whole button from block.data. */
function renderWhatsappFromData(data = {}, dir = '', extra = '') {
  const dirAttr = dir ? ` dir="${escapeAttr(dir)}"` : '';
  return renderWhatsapp(data, { dir: dirAttr, extra });
}

module.exports = { renderWhatsapp, renderWhatsappFromData, whatsappHref, normalizePhone };
