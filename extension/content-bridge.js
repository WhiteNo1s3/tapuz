/* Tapuziel Bridge — content script on the LLM site.
 *
 * This script has NO access to the CMS token (by design). It reads the latest
 * assistant message from the page and asks the background worker to publish it.
 * A floating button gives the admin one-click "send this reply to Tapuziel".
 */
(function () {
  'use strict';

  const provider = self.TapuzProviders && self.TapuzProviders.forHost(location.hostname);
  if (!provider) return; // not a supported LLM site

  // --- latest assistant message text ---
  function latestReplyText() {
    const nodes = document.querySelectorAll(provider.assistant);
    if (!nodes.length) return '';
    const el = nodes[nodes.length - 1];
    return (el.innerText || el.textContent || '').trim();
  }

  // --- floating button + toast ---
  const btn = document.createElement('button');
  btn.textContent = '🍊 → תפוזיאל';
  btn.setAttribute('dir', 'rtl');
  Object.assign(btn.style, {
    position: 'fixed', insetInlineEnd: '18px', bottom: '18px', zIndex: 2147483647,
    padding: '10px 14px', borderRadius: '10px', border: 'none', cursor: 'pointer',
    background: '#0891b2', color: '#fff', font: '600 14px system-ui, sans-serif',
    boxShadow: '0 6px 20px rgba(0,0,0,.25)'
  });

  function toast(msg, ok) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.setAttribute('dir', 'rtl');
    Object.assign(t.style, {
      position: 'fixed', insetInlineEnd: '18px', bottom: '64px', zIndex: 2147483647,
      maxWidth: '320px', padding: '10px 14px', borderRadius: '10px',
      background: ok ? '#052e16' : '#450a0a', color: '#fff',
      border: '1px solid ' + (ok ? '#166534' : '#991b1b'),
      font: '500 13px system-ui, sans-serif', boxShadow: '0 6px 20px rgba(0,0,0,.25)'
    });
    if (ok && msg.url) {
      const a = document.createElement('a');
      a.href = msg.url; a.target = '_blank'; a.textContent = ' פתח';
      a.style.color = '#7dd3fc';
      t.appendChild(a);
    }
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }

  btn.addEventListener('click', () => {
    const text = latestReplyText();
    if (!text) { toast('לא נמצאה תשובה מהבוט בעמוד', false); return; }
    btn.disabled = true;
    btn.textContent = '⏳ שולח…';
    chrome.runtime.sendMessage({ type: 'publish', text, publish: true }, (r) => {
      btn.disabled = false;
      btn.textContent = '🍊 → תפוזיאל';
      if (r && r.ok) {
        const t = document.createElement('div');
        t.setAttribute('dir', 'rtl');
        Object.assign(t.style, {
          position: 'fixed', insetInlineEnd: '18px', bottom: '64px', zIndex: 2147483647,
          maxWidth: '340px', padding: '10px 14px', borderRadius: '10px',
          background: r.repaired ? '#422006' : '#052e16', color: '#fff',
          border: '1px solid ' + (r.repaired ? '#a16207' : '#166534'), font: '500 13px system-ui, sans-serif'
        });
        // A repaired page is saved as a DRAFT — the CMS auto-fixed the reply and
        // is waiting for the admin to review before it goes live.
        let msg = (r.created ? 'נוצר דף: ' : 'עודכן: ') + r.fullPath;
        if (r.repaired) msg += ` · תוקן אוטומטית (${r.changes} שינויים), נשמר כטיוטה לבדיקה`;
        t.textContent = msg + ' — ';
        const a = document.createElement('a');
        a.href = r.url; a.target = '_blank'; a.textContent = r.repaired ? 'פתח לעריכה' : 'צפה בדף'; a.style.color = '#7dd3fc';
        t.appendChild(a);
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 9000);
      } else {
        toast('שגיאה: ' + ((r && r.error) || 'לא ידועה'), false);
      }
    });
  });

  const mount = () => { if (document.body && !btn.isConnected) document.body.appendChild(btn); };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
