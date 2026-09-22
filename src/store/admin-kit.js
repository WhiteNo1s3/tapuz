'use strict';

/**
 * Shared pieces of the store's admin screens (v2.53): the store's own tab
 * strip, status pills, money, and the page frame. Pure rendering.
 */

const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');
const money = require('./money');

const TABS = [
  ['store', '/admin/store', '🛍️ החנות'],
  ['store-products', '/admin/store/products', '🏷️ מוצרים'],
  ['store-orders', '/admin/store/orders', '📦 הזמנות'],
  ['store-coupons', '/admin/store/coupons', '🎟️ קופונים'],
  ['store-settings', '/admin/store/settings', '🚚 משלוח ותשלום'],
  ['store-gateway', '/admin/store/gateway', '💳 סליקת אשראי'],
  ['store-bentml', '/admin/store/bentml', '🧬 BenTML']
];

function tabs(active) {
  return '<nav class="st-tabs" aria-label="החנות">' + TABS.map(([key, href, label]) =>
    `<a href="${href}"${key === active ? ' class="is-on" aria-current="page"' : ''}>${label}</a>`).join('') + '</nav>';
}

/** One store screen: the admin shell, the store tabs, the body. */
function screen({ key, title, body, actions = '', width = 1040 }) {
  const navKey = key === 'store-bentml' ? 'store' : key === 'store-gateway' ? 'store-settings' : key;
  const html = `
    ${adminNav(navKey, title, actions)}
    <div class="container page-body st-page" style="max-width:${width}px">
      ${tabs(key)}
      ${body}
    </div>`;
  return layout(html, title, accentFor('store'));
}

const ORDER_TONES = { new: 'info', processing: 'warn', shipped: 'accent', completed: 'ok', cancelled: 'danger' };

function orderPill(order, labels) {
  return `<span class="pill ${ORDER_TONES[order.status] || ''}">${escapeAdmin(labels[order.status] || order.status)}</span>`;
}

function paidPill(order) {
  if (order.status === 'cancelled') return '';
  return order.paid_at ? '<span class="pill ok">שולם</span>' : '<span class="pill warn">לא שולם</span>';
}

function productPill(status) {
  const map = { active: ['ok', 'פעיל'], hidden: ['', 'מוסתר'], draft: ['warn', 'טיוטה'] };
  const [tone, label] = map[status] || ['', status];
  return `<span class="pill ${tone}">${label}</span>`;
}

function fmt(minor, currency) {
  return escapeAdmin(money.formatMoney(minor, currency));
}

function when(sqlDate) {
  if (!sqlDate) return '';
  const d = new Date(String(sqlDate).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(sqlDate)) ? '' : 'Z'));
  if (isNaN(d)) return escapeAdmin(sqlDate);
  return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

module.exports = { TABS, tabs, screen, orderPill, paidPill, productPill, fmt, when, esc: escapeAdmin };
