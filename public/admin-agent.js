/* /admin/agent — mint & revoke agent bridge tokens. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  async function api(path, opts = {}) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error((data && data.error) || res.statusText);
    return data;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  async function refresh() {
    try {
      const { tokens } = await api('/admin/api/agent-tokens');
      if (!tokens.length) { $('tok-list').textContent = 'אין עדיין טוקנים.'; return; }
      $('tok-list').innerHTML = tokens.map((t) => `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f1f5f9">
          <div>
            <b>${esc(t.name)}</b>
            <code dir="ltr" style="color:#94a3b8;margin-inline-start:8px">${esc(t.prefix)}…</code>
            <span style="font-size:.82rem;color:#64748b;margin-inline-start:8px">[${t.scopes.join(', ')}]</span>
            ${t.lastUsedAt ? `<span style="font-size:.78rem;color:#94a3b8;margin-inline-start:8px">שימוש אחרון: ${new Date(t.lastUsedAt).toLocaleString('he-IL')}</span>` : ''}
          </div>
          <button type="button" class="btn secondary" data-revoke="${esc(t.id)}" style="padding:5px 12px">בטל</button>
        </div>`).join('');
      $('tok-list').querySelectorAll('[data-revoke]').forEach((b) => {
        b.addEventListener('click', async () => {
          if (!confirm('לבטל את הטוקן? סוכנים שמשתמשים בו יאבדו גישה מיד.')) return;
          await api('/admin/api/agent-tokens/' + encodeURIComponent(b.getAttribute('data-revoke')), { method: 'DELETE' });
          refresh();
        });
      });
    } catch (e) {
      $('tok-list').textContent = 'שגיאה: ' + e.message;
    }
  }

  $('tok-create').addEventListener('click', async () => {
    const name = $('tok-name').value.trim() || 'agent';
    const scopes = $('tok-write').checked ? ['read', 'write'] : ['read'];
    try {
      const { token } = await api('/admin/api/agent-tokens', { method: 'POST', body: JSON.stringify({ name, scopes }) });
      $('tok-secret').textContent = token;
      $('tok-new').style.display = 'block';
      $('tok-name').value = '';
      refresh();
    } catch (e) {
      alert('שגיאה ביצירת טוקן: ' + e.message);
    }
  });

  refresh();
})();
