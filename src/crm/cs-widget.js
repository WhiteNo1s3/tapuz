'use strict';

/**
 * CRM — the customer-service chat widget (v1.83).
 *
 * Served as a standalone script from `/tz-cs-chat.js`, and only while the chat
 * is switched on. Kept in its own module so the markup and the wire protocol sit
 * next to each other and the route file stays a router.
 *
 * The one rule that matters here: **every string that came from the model or the
 * visitor is written with `textContent` — never as markup.** The bot's reply is
 * remote text arriving on a public page; parsing it as HTML would be an XSS hole
 * with extra steps. The bubbles are built as elements, so there is nothing for a
 * reply to inject into.
 */

const GREETING_FALLBACK = 'שלום! איך אפשר לעזור?';

function script() {
  return `(function(){
  'use strict';
  if (window.__tzCsChat) return; window.__tzCsChat = true;

  var token = null, busy = false, open = false;
  var GREET = ${JSON.stringify(GREETING_FALLBACK)};

  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;   // text, never parsed as markup
    return e;
  }

  var launcher = el('button', 'position:fixed;inset-inline-end:18px;bottom:18px;z-index:2147482000;' +
    'width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;background:#ea580c;' +
    'color:#fff;font-size:26px;box-shadow:0 6px 22px rgba(0,0,0,.28)', '💬');
  launcher.setAttribute('aria-label', 'פתיחת צ׳אט');

  var panel = el('div', 'position:fixed;inset-inline-end:18px;bottom:86px;z-index:2147482001;' +
    'width:340px;max-width:92vw;height:460px;max-height:70vh;display:none;flex-direction:column;' +
    'background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;' +
    'box-shadow:0 16px 48px rgba(2,6,23,.22);font:14px/1.5 system-ui,sans-serif;color:#0f172a');
  panel.setAttribute('dir', 'rtl');

  var head = el('div', 'display:flex;align-items:center;gap:8px;padding:12px 14px;' +
    'background:#0f172a;color:#fff;font-weight:700');
  head.appendChild(el('span', '', '💬 שירות לקוחות'));
  var close = el('button', 'margin-inline-start:auto;background:none;border:none;color:#94a3b8;' +
    'cursor:pointer;font-size:15px', '✕');
  close.setAttribute('aria-label', 'סגירה');
  head.appendChild(close);

  var log = el('div', 'flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px');
  var note = el('div', 'padding:0 12px 6px;font-size:11px;color:#94a3b8;text-align:center');

  var compose = el('div', 'display:flex;gap:8px;padding:10px 12px;border-top:1px solid #e2e8f0');
  var input = el('input', 'flex:1;border:1px solid #cbd5e1;border-radius:9px;padding:9px;font:inherit');
  input.setAttribute('placeholder', 'כתבו שאלה…');
  input.setAttribute('maxlength', '800');
  var send = el('button', 'border:none;border-radius:9px;background:#ea580c;color:#fff;' +
    'padding:0 16px;cursor:pointer;font-weight:700', 'שלח');
  compose.appendChild(input); compose.appendChild(send);

  panel.appendChild(head); panel.appendChild(log); panel.appendChild(note); panel.appendChild(compose);

  function bubble(who, text) {
    var mine = who === 'me';
    var b = el('div',
      'max-width:88%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;' +
      (mine ? 'align-self:flex-start;background:#0a66c2;color:#fff'
            : who === 'sys' ? 'align-self:center;background:#f1f5f9;color:#475569;font-size:12px;text-align:center'
            : 'align-self:flex-end;background:#fff7ed;border:1px solid #fed7aa;color:#7c2d12'),
      text);                                   // textContent — the reply is data
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }

  function api(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
  }

  function ensureSession() {
    if (token) return Promise.resolve(token);
    return api('/crm/cs/v1/session').then(function (d) {
      if (d && d.ok && d.token) { token = d.token; return token; }
      throw new Error('no session');
    });
  }

  function ask() {
    if (busy) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    bubble('me', text);
    busy = true; send.disabled = true;
    var thinking = bubble('sys', '…');
    ensureSession()
      .then(function () { return api('/crm/cs/v1/message', { token: token, text: text }); })
      .then(function (d) {
        thinking.remove();
        if (d && d.ok && d.reply) bubble('bot', d.reply);
        else bubble('sys', (d && d.message) || 'לא הצלחתי לענות עכשיו.');
      })
      .catch(function () {
        thinking.remove();
        bubble('sys', 'אין חיבור כרגע. נסו שוב.');
      })
      .then(function () { busy = false; send.disabled = false; input.focus(); });
  }

  send.addEventListener('click', ask);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ask(); } });
  close.addEventListener('click', function () { panel.style.display = 'none'; open = false; });
  launcher.addEventListener('click', function () {
    open = !open;
    panel.style.display = open ? 'flex' : 'none';
    if (open) {
      if (!log.childNodes.length) {
        bubble('bot', GREET);
        note.textContent = 'עוזר אוטומטי — לא תמיד מדויק. לפרטים מחייבים השאירו דרך ליצירת קשר.';
      }
      input.focus();
    }
  });

  function mount() {
    if (!document.body) return;
    document.body.appendChild(launcher);
    document.body.appendChild(panel);
    fetch('/crm/cs/v1/config').then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.enabled) { launcher.remove(); panel.remove(); return; }
      if (d.greeting) GREET = d.greeting;
    }).catch(function () { /* leave the default greeting */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();`;
}

/** The one-line tag a page needs. Empty when the chat is off. */
function renderTag(config) {
  const cs = require('./cs').getSettings(config);
  if (!cs.enabled) return '';
  return '<script src="/tz-cs-chat.js" defer></script>';
}

module.exports = { script, renderTag, GREETING_FALLBACK };
