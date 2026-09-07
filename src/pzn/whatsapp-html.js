'use strict';

/**
 * Shared WhatsApp click-to-chat HTML — the `whatsapp` page module
 * (gap-audit wave 4). Israeli business sites hang a wa.me link on every
 * page; until now the decompiler kept it as a plain button and put
 * `whatsapp` on toolGap every single time. This is the first-class module:
 * a styled CTA (brand-green pill, the glyph, a label, an optional subline),
 * driven by phone + prepared message, with a raw-url escape hatch for links
 * that carry no phone (wa.me/message/…, group invites).
 *
 * The site-wide floating button (config.integrations.whatsapp, rendered by
 * renderer.js renderWhatsappFloat) is a different thing and stays as is —
 * this is the in-page module an author drops where the copy asks for it.
 *
 * One renderer for compile (pzn) and renderer.js so they cannot diverge.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');

const WA_HOST_RE = /(?:^|\/\/)(?:www\.)?(?:wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|chat\.whatsapp\.com|wa\.link)(?=[/?#:]|$)|^whatsapp:/i;

const DEFAULT_LABEL = 'דברו איתנו בוואטסאפ';

const WA_ICON = '<svg class="bent-wa-icon" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>' +
  '</svg>';

/** True for any WhatsApp click-to-chat destination. */
function isWhatsappHref(href) {
  return WA_HOST_RE.test(String(href || '').trim());
}

/**
 * Digits wa.me accepts: international, no plus, no leading zeros. Hebrew-
 * first convenience — a local Israeli number (050-1234567 / 03-1234567)
 * becomes 972…; a 00-prefixed international dial string drops the 00.
 * Anything without enough digits → '' (the module falls back to `url`).
 */
function phoneDigits(raw) {
  let d = String(raw == null ? '' : raw).replace(/\D+/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0') && (d.length === 9 || d.length === 10)) d = '972' + d.slice(1);
  return d.length >= 7 && d.length <= 15 ? d : '';
}

function decodeText(v) {
  if (v == null) return '';
  try { return decodeURIComponent(String(v).replace(/\+/g, ' ')).trim(); } catch (e) { return String(v).trim(); }
}

/**
 * Read a WhatsApp link into module data. wa.me/<digits>?text= and
 * api.whatsapp.com/send?phone=&text= (+ web.whatsapp.com, whatsapp://send)
 * yield {phone, message}; a wa.me/message/<code>, wa.link or group invite
 * carries no phone and comes back as {url} verbatim. null = not WhatsApp.
 * @returns {{ phone?: string, message?: string, url?: string } | null}
 */
function parseWhatsappHref(href) {
  const s = String(href || '').trim();
  if (!isWhatsappHref(s)) return null;
  let phone = '';
  let message = '';
  const q = s.indexOf('?');
  const query = q === -1 ? '' : s.slice(q + 1).split('#')[0];
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = (eq === -1 ? pair : pair.slice(0, eq)).toLowerCase();
    const v = eq === -1 ? '' : pair.slice(eq + 1);
    if (k === 'phone') phone = phoneDigits(decodeText(v));
    else if (k === 'text') message = decodeText(v);
  }
  const path = /wa\.me\/([^/?#]+)/i.exec(s);
  if (!phone && path && /^\+?\d[\d-]*$/.test(path[1])) phone = phoneDigits(path[1]);
  if (!phone) return { url: s };
  const out = { phone };
  if (message) out.message = message;
  return out;
}

/** The click-to-chat destination for module data ('#' when it has none). */
function whatsappHref(data = {}) {
  const phone = phoneDigits(data.phone);
  if (phone) {
    const message = String(data.message || '').trim();
    return `https://wa.me/${phone}` + (message ? `?text=${encodeURIComponent(message)}` : '');
  }
  const url = String(data.url || '').trim();
  return url ? safeHref(url) : '#';
}

/** The styled CTA. props: {label, phone, message, note, url} */
function renderWhatsapp(props = {}, opts = {}) {
  const label = escapeHtml(String(props.label || '').trim() || DEFAULT_LABEL);
  const note = escapeHtml(String(props.note || '').trim());
  const href = escapeAttr(whatsappHref(props));
  return `<a${opts.idAttr || ''} class="bent-whatsapp${opts.cls || ''}" href="${href}" target="_blank" rel="noopener noreferrer"${opts.extra || ''}${opts.dir || ''}>` +
    WA_ICON +
    `<span class="bent-wa-body"><span class="bent-wa-label">${label}</span>` +
    (note ? `<span class="bent-wa-note">${note}</span>` : '') +
    '</span></a>';
}

/** Convenience for the renderer: the module from block.data. */
function renderWhatsappFromData(data = {}, dir = '', extra = '') {
  const dirAttr = dir ? ` dir="${escapeAttr(dir)}"` : '';
  return renderWhatsapp(data, { dir: dirAttr, extra });
}

module.exports = {
  DEFAULT_LABEL,
  isWhatsappHref,
  phoneDigits,
  parseWhatsappHref,
  whatsappHref,
  renderWhatsapp,
  renderWhatsappFromData
};
