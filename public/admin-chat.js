/* /admin/chat — copilot: teach BenTML, capture a page description, mint a mission
   the extension injects into your own logged-in AI chat, then auto-publishes. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const log = $('chat-log');
  const input = $('chat-input');
  let provider = 'claude';
  let lastMission = null;

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts
    });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) || res.statusText);
    return data;
  }

  function bubble(role, html) {
    const div = document.createElement('div');
    div.className = 'bubble ' + role;
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // boot providers
  (async function init() {
    try {
      const r = await api('/admin/api/mission/providers');
      const sel = $('provider');
      sel.innerHTML = (r.providers || [])
        .filter((p) => p.id !== 'generic')
        .map((p) => `<option value="${p.id}">${esc(p.label)}</option>`)
        .join('');
      provider = sel.value || 'claude';
      sel.onchange = () => {
        provider = sel.value;
      };

      bubble(
        'system',
        `<strong>🎮 בונה אתרים ב‑AI שלכם</strong> — המוח שלכם, השפה שלנו.<br/>
        <span class="muted">① לימוד BenTML (משחק + מילון) · ② תיאור הדף · ③ התוסף מזריק לצ׳אט שלכם · ④ <b>פרסום אוטומטי</b> כשה‑‎.pzn מלא (&lt;/html&gt; + מודול bent-* + fence סגור).</span><br/>
        <span class="muted">בלי מפתחות API, בלי cookies של ה‑AI בשרת — הכול רץ אצלכם בדפדפן.</span>`
      );
    } catch (e) {
      bubble('system', 'שגיאה: ' + esc(e.message));
    }
  })();

  $('btn-teach').addEventListener('click', async () => {
    try {
      const r = await api('/admin/api/mission/teach', {
        method: 'POST',
        body: JSON.stringify({ provider })
      });
      await navigator.clipboard.writeText(r.message);
      bubble(
        'assistant',
        `📚 <strong>הודעת הלימוד הועתקה</strong> (${esc(r.providerLabel)}).<br/>
        הדביקו בצ׳אט של ה‑AI, או לחצו «פתח + הפעל תוסף» אחרי שתתארו את הדף.<br/>
        <details><summary>תצוגת ההודעה</summary><pre class="code">${esc(r.message.slice(0, 1200))}…</pre></details>`
      );
    } catch (e) {
      bubble('system', esc(e.message));
    }
  });

  async function submitDescription() {
    const description = input.value.trim();
    if (!description) return;
    input.value = '';
    bubble('user', esc(description));
    try {
      const r = await api('/admin/api/mission/create', {
        method: 'POST',
        body: JSON.stringify({
          description,
          provider,
          title: $('page-title').value.trim(),
          slug: $('page-slug').value.trim(),
          targetPage: $('page-target').value
        })
      });
      lastMission = r.mission;
      bubble(
        'assistant',
        `🚀 <strong>המשימה מוכנה</strong> · ${esc(r.mission.id.slice(0, 8))}…<br/>
        <div class="actions">
          <button type="button" class="act" data-copy="one">📋 העתק הודעה מלאה (לימוד+בנייה)</button>
          <button type="button" class="act" data-copy="build">📋 העתק רק תיאור+בנייה</button>
          <button type="button" class="act primary" data-open="1">↗ פתח ${esc(r.providerLabel)} + הפעל תוסף</button>
        </div>
        <p class="muted">בתוסף: סמנו «פרסום אוטומטי» · ① לימוד · ② בנייה · המעקב מפרסם כשהמסמך <b>מלא</b>.</p>
        <details open><summary>איך זה עובד</summary>
          <ol class="muted">
            <li>התוסף מחובר ל‑CMS עם טוקן write</li>
            <li>לשונית ${esc(r.providerLabel)} — אתם מחוברים כרגיל (BYOT)</li>
            <li>⬇ משוך משימה → ① לימוד → ② בנייה</li>
            <li>חכו ל‑&lt;/html&gt; + fence סגור — או PZN_READY</li>
            <li>פרסום אוטומטי · פתחו את הדף החי</li>
          </ol>
        </details>`
      );
      wireActionButtons();
    } catch (e) {
      bubble('system', esc(e.message));
    }
  }

  function wireActionButtons() {
    log.querySelectorAll('.act').forEach((btn) => {
      if (btn._wired) return;
      btn._wired = true;
      btn.addEventListener('click', async () => {
        if (!lastMission) return;
        if (btn.getAttribute('data-copy') === 'one') {
          await navigator.clipboard.writeText(lastMission.oneShot);
          btn.textContent = '✓ הועתק';
        } else if (btn.getAttribute('data-copy') === 'build') {
          await navigator.clipboard.writeText(lastMission.buildMessage);
          btn.textContent = '✓ הועתק';
        } else if (btn.getAttribute('data-open')) {
          // mark the mission active so the extension can pull it
          await api('/admin/api/mission/activate/' + lastMission.id, { method: 'POST', body: '{}' });
          const url = lastMission.providerUrl || 'https://claude.ai/new';
          window.open(url, '_blank');
          bubble(
            'system',
            'נפתח הצ׳אט של ה‑AI. בתוסף לחצו <strong>⬇ משוך משימה</strong> — הוא משתמש ב‑session שלכם.'
          );
        }
      });
    });
  }

  $('btn-send').addEventListener('click', submitDescription);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submitDescription();
    }
  });

  // load page targets
  (async () => {
    try {
      const r = await api('/admin/api/pages');
      const sel = $('page-target');
      for (const p of r.pages || []) {
        const o = document.createElement('option');
        o.value = p.full_path;
        o.textContent = p.title + ' (' + p.full_path + ')';
        sel.appendChild(o);
      }
      const q = new URLSearchParams(location.search).get('page');
      if (q) sel.value = q;
    } catch (e) {
      /* ok */
    }
  })();
})();
