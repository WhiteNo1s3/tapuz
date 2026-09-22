'use strict';

/**
 * Store mail — the owner hears about every order, the shopper gets a copy.
 *
 * Rides the site's own SMTP (src/notify.js): same readiness gate, same
 * header sanitizing, same daily cap. Nothing here ever throws, and nothing
 * here runs before the order is saved — a mail server that is down costs a
 * notification, never a sale. Plain text with an RTL HTML twin, so Hebrew
 * reads right in every client.
 */

const mail = require('../notify');
const money = require('./money');
const settingsMod = require('./settings');

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function asHtml(text) {
  return '<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a">' +
    esc(text).replace(/\n/g, '<br>') + '</div>';
}

function baseUrl() {
  try { return String(require('../config').loadConfig().baseUrl || '').trim().replace(/\/+$/, ''); } catch (e) { return ''; }
}

function parseAddress(order) {
  try { return JSON.parse(order.address || '{}') || {}; } catch (e) { return {}; }
}

function itemLines(order, items) {
  const cur = order.currency;
  return items.map((it) => '• ' + it.title + (it.variant_label ? ' — ' + it.variant_label : '') +
    ' × ' + it.qty + ' = ' + money.formatMoney(it.line_total, cur)).join('\n');
}

function totalsBlock(order) {
  const cur = order.currency;
  const f = (n) => money.formatMoney(n, cur);
  const rows = ['סכום ביניים: ' + f(order.subtotal)];
  if (order.discount) rows.push('הנחה' + (order.coupon ? ' (' + order.coupon + ')' : '') + ': -' + f(order.discount));
  if (order.shipping_method) rows.push('משלוח (' + order.shipping_label + '): ' + (order.shipping ? f(order.shipping) : 'חינם'));
  rows.push('סה״כ לתשלום: ' + f(order.total));
  if (order.vat) rows.push(order.vat_included ? 'מתוכם מע״מ (' + order.vat_rate + '%): ' + f(order.vat) : 'כולל מע״מ (' + order.vat_rate + '%): ' + f(order.vat));
  return rows.join('\n');
}

function paymentBlock(order, settings) {
  const m = settings.payments.find((p) => p.id === order.payment_method);
  if (!m) return order.payment_label ? 'תשלום: ' + order.payment_label : '';
  const rows = ['תשלום: ' + (order.payment_label || m.label)];
  const details = settingsMod.paymentDetails(m);
  if (details) rows.push(details);
  if (m.phone && (m.kind === 'bit' || m.kind === 'paybox' || m.kind === 'call')) rows.push('מספר: ' + m.phone);
  const pay = require('./orders').paymentUrl(order, settings);
  if (pay) rows.push('לתשלום: ' + pay);
  // a card order pays from its own page — the link below is the way back to it
  else if (m.kind === 'card' && !order.paid_at) {
    const link = orderLink(order, settings);
    rows.push(link ? 'לתשלום בכרטיס אשראי היכנסו לדף ההזמנה: ' + link : 'לתשלום בכרטיס אשראי היכנסו לדף ההזמנה.');
  }
  return rows.join('\n');
}

function orderLink(order, settings) {
  const base = baseUrl();
  if (!base) return '';
  return base + '/' + encodeURI(settings.pages.order) + '?o=' + encodeURIComponent(order.token);
}

/** Owner alert + shopper confirmation for a freshly placed order. */
async function orderPlaced(order, items) {
  const out = { owner: null, customer: null };
  try {
    const s = settingsMod.loadSettings();
    const name = settingsMod.storeName(s);
    const smtp = mail.getSettings();
    const ownerTo = s.notifyEmail || smtp.to || '';
    const a = parseAddress(order);
    const where = [a.street, a.city, a.zip].filter(Boolean).join(', ');
    const adminLink = (baseUrl() || '') + '/admin/store/orders/' + encodeURIComponent(order.number);

    if (ownerTo) {
      const text = [
        'הזמנה חדשה #' + order.number + ' — ' + money.formatMoney(order.total, order.currency),
        '',
        'לקוח/ה: ' + order.customer_name,
        'טלפון: ' + order.customer_phone,
        order.customer_email ? 'מייל: ' + order.customer_email : '',
        order.shipping_method ? 'משלוח: ' + order.shipping_label + (where ? ' — ' + where : '') : '',
        a.notes ? 'הערות למשלוח: ' + a.notes : '',
        '',
        itemLines(order, items),
        '',
        totalsBlock(order),
        order.payment_label ? '\nתשלום: ' + order.payment_label : '',
        order.note ? '\nהערת הלקוח/ה: ' + order.note : '',
        '',
        'לניהול ההזמנה: ' + adminLink
      ].filter((l) => l !== '').join('\n');
      out.owner = await mail.sendMail({
        to: ownerTo,
        subject: 'הזמנה חדשה #' + order.number + ' — ' + name,
        text, html: asHtml(text)
      });
    }

    if (s.customerEmails && order.customer_email) {
      const link = orderLink(order, s);
      const text = [
        'שלום ' + (String(order.customer_name || '').split(/\s+/)[0] || '') + ',',
        '',
        s.thanks,
        'מספר ההזמנה: #' + order.number,
        '',
        itemLines(order, items),
        '',
        totalsBlock(order),
        '',
        paymentBlock(order, s),
        order.shipping_method ? '\nמשלוח: ' + order.shipping_label : '',
        link ? '\nמעקב אחרי ההזמנה: ' + link : '',
        '',
        name
      ].filter((l) => l !== '').join('\n');
      out.customer = await mail.sendMail({
        to: order.customer_email,
        subject: 'קיבלנו את ההזמנה #' + order.number + ' — ' + name,
        text, html: asHtml(text)
      });
    }
  } catch (e) {
    console.error('[store] order mail failed:', e.message);
  }
  return out;
}

/** The shopper hears when the order ships (with the tracking number) or is cancelled. */
async function statusChanged(order, items) {
  try {
    const s = settingsMod.loadSettings();
    if (!s.customerEmails || !order.customer_email || order.erased) return null;
    const name = settingsMod.storeName(s);
    const first = String(order.customer_name || '').split(/\s+/)[0] || '';
    let subject;
    let body;
    if (order.status === 'shipped') {
      subject = 'ההזמנה #' + order.number + ' יצאה לדרך — ' + name;
      body = 'ההזמנה שלכם יצאה לדרך' + (order.tracking ? '.\nמספר מעקב: ' + order.tracking : '.');
    } else if (order.status === 'cancelled') {
      subject = 'ההזמנה #' + order.number + ' בוטלה — ' + name;
      body = 'ההזמנה בוטלה. לשאלות — פשוט השיבו למייל הזה.';
    } else {
      return null;
    }
    const link = orderLink(order, s);
    const text = ['שלום ' + first + ',', '', body, '', itemLines(order, items), link ? '\n' + link : '', '', name]
      .filter((l) => l !== '').join('\n');
    return await mail.sendMail({ to: order.customer_email, subject, text, html: asHtml(text) });
  } catch (e) {
    console.error('[store] status mail failed:', e.message);
    return null;
  }
}

function cardLine(payment) {
  const bits = [];
  if (payment.approval) bits.push('אישור ' + payment.approval);
  if (payment.card_last4) bits.push('כרטיס ····' + payment.card_last4);
  if (payment.installments > 1) bits.push(payment.installments + ' תשלומים');
  return bits.join(' · ');
}

/**
 * The gateway settled a payment (src/store/gateway/index.js → settle):
 * the owner hears, and the shopper gets "התשלום התקבל" — after the commit,
 * best effort. `stray` = 'double' (the order was already paid) or
 * 'cancelled' (money for a cancelled order): the owner is told to refund.
 * `test` = a test-mode confirmation — said as such, never as money, and the
 * shopper is not written to. `alert` = the driver's loud note (Grow: a
 * non-card method in test mode may be real money).
 */
async function paymentReceived(order, payment, items, { stray = '', test = false, alert = '' } = {}) {
  const out = { owner: null, customer: null };
  try {
    const s = settingsMod.loadSettings();
    const name = settingsMod.storeName(s);
    const smtp = mail.getSettings();
    const ownerTo = s.notifyEmail || smtp.to || '';
    const sum = money.formatMoney(payment.amount, payment.currency);
    const adminLink = (baseUrl() || '') + '/admin/store/orders/' + encodeURIComponent(order.number);
    if (ownerTo) {
      const head = test ? 'תשלום בדיקה להזמנה #' + order.number + ' אושר — ' + sum + ' (לא התקבל כסף)'
        : stray === 'double' ? 'התקבל תשלום נוסף להזמנה #' + order.number + ' — ' + sum + ' בכרטיס אשראי'
          : stray === 'cancelled' ? 'התקבל תשלום להזמנה מבוטלת #' + order.number + ' — ' + sum + ' בכרטיס אשראי'
            : 'התשלום להזמנה #' + order.number + ' התקבל — ' + sum + ' בכרטיס אשראי';
      const text = [
        head,
        stray === 'double' ? 'ההזמנה כבר סומנה כשולמה קודם — יש להחזיר לקונה את התשלום הכפול (פעולת ההחזר במסך ההזמנה).' : '',
        stray === 'cancelled' ? 'ההזמנה בוטלה לפני שהתשלום אושר — יש להחזיר לקונה (פעולת ההחזר במסך ההזמנה).' : '',
        alert ? 'שימו לב: ' + alert : '',
        cardLine(payment),
        '',
        'לקוח/ה: ' + order.customer_name,
        '',
        itemLines(order, items || []),
        '',
        'לניהול ההזמנה: ' + adminLink
      ].filter((l) => l !== '').join('\n');
      out.owner = await mail.sendMail({
        to: ownerTo,
        subject: (test ? 'תשלום בדיקה אושר — הזמנה #' : stray ? 'יש להחזיר תשלום — הזמנה #' : 'התשלום התקבל — הזמנה #') + order.number + ' — ' + name,
        text, html: asHtml(text)
      });
    }
    if (!test && !stray && s.customerEmails && order.customer_email && !order.erased) {
      const link = orderLink(order, s);
      const text = [
        'שלום ' + (String(order.customer_name || '').split(/\s+/)[0] || '') + ',',
        '',
        'התשלום על הזמנה #' + order.number + ' התקבל — ' + sum + '.',
        cardLine(payment),
        '',
        itemLines(order, items || []),
        link ? '\nמעקב אחרי ההזמנה: ' + link : '',
        '',
        name
      ].filter((l) => l !== '').join('\n');
      out.customer = await mail.sendMail({
        to: order.customer_email,
        subject: 'התשלום התקבל — הזמנה #' + order.number + ' — ' + name,
        text, html: asHtml(text)
      });
    }
  } catch (e) {
    console.error('[store] payment mail failed:', e.message);
  }
  return out;
}

/** The provider reported a sum or a currency that is not the order's: the owner, and only the owner, hears at once. */
async function paymentMismatch(order, payment) {
  try {
    const s = settingsMod.loadSettings();
    const name = settingsMod.storeName(s);
    const smtp = mail.getSettings();
    const ownerTo = s.notifyEmail || smtp.to || '';
    if (!ownerTo) return null;
    const adminLink = (baseUrl() || '') + '/admin/store/orders/' + encodeURIComponent(order.number);
    const text = [
      'אי-התאמה בתשלום להזמנה #' + order.number,
      payment.error || '',
      'ההזמנה לא סומנה כשולמה. בדקו בממשק חברת הסליקה מה נגבה בפועל.',
      '',
      'לניהול ההזמנה: ' + adminLink
    ].filter((l) => l !== '').join('\n');
    return await mail.sendMail({ to: ownerTo, subject: 'אי-התאמה בתשלום — הזמנה #' + order.number + ' — ' + name, text, html: asHtml(text) });
  } catch (e) {
    console.error('[store] mismatch mail failed:', e.message);
    return null;
  }
}

module.exports = { orderPlaced, statusChanged, paymentReceived, paymentMismatch, totalsBlock, itemLines };
