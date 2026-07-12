/* /admin/ai — the paste flow: primer → paste bot reply → preview → apply.
   BYO AI subscription: no API keys, the user's own bot writes .pzn. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const pasteBox = $('paste-box');
  const previewFrame = $('preview-frame');
  const issuePanel = $('issue-panel');
  const applyDraft = $('apply-draft');
  const applyPublish = $('apply-publish');
  const applyResult = $('apply-result');
  const pagePick = $('page-pick');

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts
    });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok && typeof data === 'object') throw data;
    if (!res.ok) throw { error: String(data) };
    return data;
  }

  // ── 1. primer ────────────────────────────────────────────────────
  $('copy-primer').addEventListener('click', async () => {
    try {
      const text = await api('/admin/api/pzn/primer');
      await navigator.clipboard.writeText(text);
      $('primer-status').textContent = 'הועתק! הדביקו בצ׳אט של ה-AI שלכם';
      setTimeout(() => { $('primer-status').textContent = ''; }, 4000);
    } catch (e) {
      $('primer-status').textContent = 'שגיאה בהעתקה';
    }
  });

  // ── page picker ──────────────────────────────────────────────────
  (async function loadPages() {
    try {
      const data = await api('/admin/api/pages');
      const pages = Array.isArray(data) ? data : data.pages;
      for (const p of pages || []) {
        const opt = document.createElement('option');
        opt.value = p.full_path;
        opt.textContent = `${p.title} (${p.full_path})`;
        pagePick.appendChild(opt);
      }
    } catch (e) { /* list stays with "new page" only */ }
  })();

  // ── 2+3. live preview on paste/typing (debounced) ────────────────
  let timer = null;
  let lastGood = false;

  function setButtons(enabled) {
    lastGood = enabled;
    applyDraft.disabled = !enabled;
    applyPublish.disabled = !enabled;
  }

  function showIssues(err) {
    const lines = [];
    if (err.error) lines.push(err.error);
    if (err.line) lines.push(`שורה ${err.line}${err.column ? ', עמודה ' + err.column : ''}`);
    if (Array.isArray(err.issues)) {
      for (const i of err.issues.slice(0, 6)) lines.push(`${i.code}: ${i.message}${i.path ? ' (' + i.path + ')' : ''}`);
    }
    issuePanel.textContent = lines.join('\n');
    issuePanel.style.display = 'block';
  }

  async function refreshPreview() {
    const source = pasteBox.value;
    applyResult.style.display = 'none';
    if (!source.trim()) {
      issuePanel.style.display = 'none';
      previewFrame.srcdoc = '';
      setButtons(false);
      return;
    }
    try {
      const r = await api('/admin/api/pzn/preview', {
        method: 'POST',
        body: JSON.stringify({ source, loose: true })
      });
      issuePanel.style.display = 'none';
      previewFrame.srcdoc = r.html;
      setButtons(true);
    } catch (err) {
      showIssues(err);
      setButtons(false);
    }
  }

  pasteBox.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(refreshPreview, 400);
  });

  // ── apply ────────────────────────────────────────────────────────
  async function apply(publish) {
    if (!lastGood) return;
    const source = pasteBox.value;
    const target = pagePick.value;
    applyDraft.disabled = applyPublish.disabled = true;
    try {
      let r;
      if (target === '__new__') {
        r = await api('/admin/api/pzn/create-from-source', {
          method: 'POST',
          body: JSON.stringify({ source, publish })
        });
      } else {
        r = await api('/admin/api/pzn/source', {
          method: 'POST',
          body: JSON.stringify({ fullPath: target, source, loose: true, publish })
        });
      }
      const fp = encodeURIComponent(r.fullPath);
      const publicPath = '/' + r.fullPath.replace(/\s+/g, '-') + '.html';
      applyResult.innerHTML =
        (r.created ? 'הדף נוצר! ' : 'נשמר! ') +
        `<a href="/admin/edit/${fp}">פתח בבונה הדפים</a>` +
        (publish ? ` · <a href="${publicPath}" target="_blank">צפה בדף החי</a>` : ' (טיוטה — פרסמו מהבונה כשמוכן)');
      applyResult.style.display = 'block';
      if (r.created) {
        const opt = document.createElement('option');
        opt.value = r.fullPath;
        opt.textContent = `${r.fullPath} (חדש)`;
        pagePick.appendChild(opt);
        pagePick.value = r.fullPath;
      }
    } catch (err) {
      showIssues(err);
    } finally {
      setButtons(lastGood);
    }
  }

  applyDraft.addEventListener('click', () => apply(false));
  applyPublish.addEventListener('click', () => apply(true));
})();
