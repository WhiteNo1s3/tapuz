'use strict';

/**
 * Store mail — the owner hears about every order, the shopper gets a copy.
 *
 * Rides the site's own SMTP (src/notify.js): same readiness gate, same
 * header sanitizing, same daily cap. Nothing here ever throws, and nothing
 * here runs before the order is saved — a mail server that is down costs a
 * notification, never a sale. Plain text with an RTL HTML twin, so Hebrew
 * reads right in every client.
 *
 * EVERY ATTEMPT LEAVES A LINE ON THE ORDER (v2.69). Without SMTP every send
 * is a silent no-op, and the order's history used to say nothing either
 * way — an owner could not tell whether a confirmation went out. Each send
 * now records one event: that it went, or which mail did not and why
 * ("אישור ההזמנה לא נשלח ללקוח/ה: SMTP לא מוגדר" — two failures on one
 * order must not read as the same line twice). The shopper's address is
 * never written into an event — events outlive an erasure request; the
 * owner's own address may be.
 *
 * LINKS NEED A REAL ADDRESS. The order page and the admin screen are linked
 * only when the site's base URL is configured; without one the line is
 * left out and the mail still goes. The admin link follows a custom admin
 * path (auth.getAdminBase()).
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

const WHY_NOT = {
  'smtp not ready': 'SMTP לא מוגדר',
  'daily send cap reached': 'הגענו למכסת המיילים היומית',
  'rate limited': 'נשלחו יותר מדי מיילים ברגע אחד',
  'invalid recipient': 'כתובת הנמען אינה תקינה',
  'invalid from': 'כתובת השולח אינה תקינה'
};

/** Why a send failed, in the owner's language. A mail server's own words are not repeated: they can carry an address. */
function whyNot(result) {
  const e = String((result && result.error) || '');
  if (WHY_NOT[e]) return WHY_NOT[e];
  return e.indexOf('smtp not ready') === 0 ? WHY_NOT['smtp not ready'] : 'שרת המייל לא קיבל את ההודעה';
}

/** One line on the order per send: `sent` when it went, `failed` + the reason when it did not. Never throws. */
function record(order, result, sent, failed) {
  try {
    if (!order || !order.id || !result) return;
    require('./orders').addEvent(order.id, 'mail', result.ok ? sent : failed + ': ' + whyNot(result));
  } catch (e) { /* the history is a courtesy; a mail outcome never costs anything else */ }
}

/** The order's screen in the admin — under the owner's own admin path — or '' when the site has no address to build it on. */
function adminLink(order) {
  const base = baseUrl();
  if (!base) return '';
  let admin = '/admin';
  try { admin = require('../auth').getAdminBase() || '/admin'; } catch (e) { admin = '/admin'; }
  return base + admin + '/store/orders/' + encodeURIComponent(order.number);
}

/** A pickup order (a shipping method, no street): "shipped" means it is waiting to be collected. */
function isPickup(order) {
  return !!order.shipping_method && !parseAddress(order).street;
}

function paymentBlock(order, settings) {
  // by id, else by the kind the order kept (a renamed method still explains how to pay)
  const m = require('./orders').methodOf(order, settings);
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
  // …and so do PayPal's button and a demo shop's pretend payment
  else if ((m.kind === 'paypal' || m.kind === 'demo') && !order.paid_at) {
    const link = orderLink(order, settings);
    rows.push(link ? 'התשלום נעשה בדף ההזמנה: ' + link : 'התשלום נעשה בדף ההזמנה.');
  }
  return rows.join('\n');
}

function orderLink(order, settings) {
  const base = baseUrl();
  if (!base) return '';
  return base + '/' + encodeURI(settings.pages.order) + '?o=' + encodeURIComponent(order.token);
}

/** The owner's line under a mail: the admin link when there is one to give. */
function manageLine(order) {
  const link = adminLink(order);
  return link ? 'לניהול ההזמנה: ' + link : '';
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
        manageLine(order)
      ].filter((l) => l !== '').join('\n');
      out.owner = await mail.sendMail({
        to: ownerTo,
        subject: 'הזמנה חדשה #' + order.number + ' — ' + name,
        text, html: asHtml(text)
      });
      record(order, out.owner, 'התראה על ההזמנה נשלחה אל ' + ownerTo, 'ההתראה על ההזמנה לא נשלחה לבעל החנות');
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
      record(order, out.customer, 'אישור ההזמנה נשלח ללקוח/ה במייל', 'אישור ההזמנה לא נשלח ללקוח/ה');
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
    let what;
    if (order.status === 'shipped' && isPickup(order)) {
      // nothing "left" for anywhere: the order waits where the shopper said they would come
      subject = 'ההזמנה #' + order.number + ' מוכנה לאיסוף — ' + name;
      body = 'ההזמנה שלכם מוכנה לאיסוף' + (order.shipping_label ? ' (' + order.shipping_label + ').' : '.');
      what = 'ההודעה "מוכנה לאיסוף"';
    } else if (order.status === 'shipped') {
      subject = 'ההזמנה #' + order.number + ' יצאה לדרך — ' + name;
      body = 'ההזמנה שלכם יצאה לדרך' + (order.tracking ? '.\nמספר מעקב: ' + order.tracking : '.');
      what = 'ההודעה "יצאה לדרך"';
    } else if (order.status === 'cancelled') {
      subject = 'ההזמנה #' + order.number + ' בוטלה — ' + name;
      body = 'ההזמנה בוטלה. לשאלות — פשוט השיבו למייל הזה.';
      what = 'הודעת הביטול';
    } else {
      return null;
    }
    const link = orderLink(order, s);
    const text = ['שלום ' + first + ',', '', body, '', itemLines(order, items), link ? '\n' + link : '', '', name]
      .filter((l) => l !== '').join('\n');
    const sent = await mail.sendMail({ to: order.customer_email, subject, text, html: asHtml(text) });
    record(order, sent, what + ' נשלחה ללקוח/ה במייל', what + ' לא נשלחה ללקוח/ה');
    return sent;
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
 *
 * `via` says HOW the money came, read straight after the sum — "בכרטיס
 * אשראי" unless the caller knows better (PayPal passes "ב-PayPal"). `panel`
 * is where a refund is made when this system cannot make it: the card
 * gateway refunds from the order screen; a PayPal payment is given back
 * from the PayPal account, and the owner must not be sent to look for a
 * button that is not there.
 */
async function paymentReceived(order, payment, items, { stray = '', test = false, alert = '', via = 'בכרטיס אשראי', panel = '' } = {}) {
  const out = { owner: null, customer: null };
  try {
    const s = settingsMod.loadSettings();
    const name = settingsMod.storeName(s);
    const smtp = mail.getSettings();
    const ownerTo = s.notifyEmail || smtp.to || '';
    const sum = money.formatMoney(payment.amount, payment.currency);
    const refundHow = panel ? ' (' + panel + ')' : ' (פעולת ההחזר במסך ההזמנה)';
    if (ownerTo) {
      const head = test ? 'תשלום בדיקה להזמנה #' + order.number + ' אושר — ' + sum + ' (לא התקבל כסף)'
        : stray === 'double' ? 'התקבל תשלום נוסף להזמנה #' + order.number + ' — ' + sum + ' ' + via
          : stray === 'cancelled' ? 'התקבל תשלום להזמנה מבוטלת #' + order.number + ' — ' + sum + ' ' + via
            : 'התשלום להזמנה #' + order.number + ' התקבל — ' + sum + ' ' + via;
      const text = [
        head,
        stray === 'double' ? 'ההזמנה כבר סומנה כשולמה קודם — יש להחזיר לקונה את התשלום הכפול' + refundHow + '.' : '',
        stray === 'cancelled' ? 'ההזמנה בוטלה לפני שהתשלום אושר — יש להחזיר לקונה' + refundHow + '.' : '',
        alert ? 'שימו לב: ' + alert : '',
        cardLine(payment),
        '',
        'לקוח/ה: ' + order.customer_name,
        '',
        itemLines(order, items || []),
        '',
        manageLine(order)
      ].filter((l) => l !== '').join('\n');
      out.owner = await mail.sendMail({
        to: ownerTo,
        subject: (test ? 'תשלום בדיקה אושר — הזמנה #' : stray ? 'יש להחזיר תשלום — הזמנה #' : 'התשלום התקבל — הזמנה #') + order.number + ' — ' + name,
        text, html: asHtml(text)
      });
      record(order, out.owner, 'הודעת התשלום נשלחה אל ' + ownerTo, 'הודעת התשלום לא נשלחה לבעל החנות');
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
      record(order, out.customer, 'אישור התשלום נשלח ללקוח/ה במייל', 'אישור התשלום לא נשלח ללקוח/ה');
    }
  } catch (e) {
    console.error('[store] payment mail failed:', e.message);
  }
  return out;
}

/**
 * The provider reported a sum or a currency that is not the order's: the
 * owner, and only the owner, hears at once. `panel` names where to look for
 * what was really charged ("בממשק חברת הסליקה" unless the caller says
 * otherwise — PayPal's is the PayPal account).
 */
async function paymentMismatch(order, payment, { panel = 'בממשק חברת הסליקה' } = {}) {
  try {
    const s = settingsMod.loadSettings();
    const name = settingsMod.storeName(s);
    const smtp = mail.getSettings();
    const ownerTo = s.notifyEmail || smtp.to || '';
    if (!ownerTo) return null;
    const text = [
      'אי-התאמה בתשלום להזמנה #' + order.number,
      payment.error || '',
      'ההזמנה לא סומנה כשולמה. בדקו ' + panel + ' מה נגבה בפועל.',
      '',
      manageLine(order)
    ].filter((l) => l !== '').join('\n');
    const sent = await mail.sendMail({ to: ownerTo, subject: 'אי-התאמה בתשלום — הזמנה #' + order.number + ' — ' + name, text, html: asHtml(text) });
    record(order, sent, 'התראת אי-ההתאמה נשלחה אל ' + ownerTo, 'התראת אי-ההתאמה לא נשלחה לבעל החנות');
    return sent;
  } catch (e) {
    console.error('[store] mismatch mail failed:', e.message);
    return null;
  }
}

module.exports = { orderPlaced, statusChanged, paymentReceived, paymentMismatch, totalsBlock, itemLines, adminLink, orderLink };
