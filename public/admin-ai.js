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

  function showIssues(err, repair) {
    issuePanel.innerHTML = '';
    const lines = [];
    if (err.error) lines.push(err.error);
    if (err.line) lines.push(`שורה ${err.line}${err.column ? ', עמודה ' + err.column : ''}`);
    if (Array.isArray(err.issues)) {
      for (const i of err.issues.slice(0, 6)) lines.push(`${i.code}: ${i.message}${i.path ? ' (' + i.path + ')' : ''}`);
    }
    const pre = document.createElement('div');
    pre.style.whiteSpace = 'pre-wrap';
    pre.textContent = lines.join('\n');
    issuePanel.appendChild(pre);

    // v0.49 — "auto-correct, then you apply": if the server can repair the
    // reply into a clean document, offer a one-click fix that flows back into
    // the preview→apply pipeline. Nothing is saved until the admin applies.
    if (repair && repair.ok && Array.isArray(repair.changes) && repair.changes.length &&
        (!repair.remaining || !repair.remaining.length) && repair.repairedSource) {
      const box = document.createElement('div');
      box.style.cssText = 'margin-top:12px;padding:12px;border-radius:10px;background:#fffbeb;border:1px solid #fde68a;color:#78350f';
      const h = document.createElement('div');
      h.style.cssText = 'font-weight:700;margin-bottom:8px';
      h.textContent = `🔧 אפשר לתקן אוטומטית (${repair.changes.length} תיקונים):`;
      box.appendChild(h);
      const ul = document.createElement('ul');
      ul.style.cssText = 'margin:0 0 10px;padding-inline-start:18px;font-size:0.85rem;line-height:1.5';
      for (const c of repair.changes.slice(0, 10)) {
        const li = document.createElement('li');
        li.textContent = c.message;
        ul.appendChild(li);
      }
      box.appendChild(ul);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'תקן והחלף בתיבה ←';
      btn.style.cssText = 'font:600 0.9rem system-ui;padding:8px 14px;border:none;border-radius:8px;background:#b45309;color:#fff;cursor:pointer';
      btn.addEventListener('click', () => {
        pasteBox.value = repair.repairedSource;
        refreshPreview();
      });
      box.appendChild(btn);
      issuePanel.appendChild(box);
    }
    issuePanel.style.display = 'block';
  }

  /** Ask the server for a dry-run repair of the current paste (never saves). */
  async function fetchRepair(source) {
    try {
      return await api('/admin/api/pzn/repair', {
        method: 'POST',
        body: JSON.stringify({ source, loose: true })
      });
    } catch (_) { return null; }
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
      const repair = await fetchRepair(source);
      showIssues(err, repair);
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
          // from:'ai' — this is a model's reply: raw HTML loses its script (v2.39)
          body: JSON.stringify({ fullPath: target, source, loose: true, publish, from: 'ai' })
        });
      }
      const fp = encodeURIComponent(r.fullPath);
      const publicPath = '/' + r.fullPath.replace(/\s+/g, '-') + '.html';
      // A repaired page is forced to draft (never auto-published) so the admin
      // reviews the auto-corrections before it goes live.
      const wentLive = publish && !r.repaired;
      applyResult.innerHTML =
        (r.created ? 'הדף נוצר! ' : 'נשמר! ') +
        (r.scrubbed ? '<strong>' + String(r.notice || '').replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</strong> ' : '') +
        (r.repaired ? `<strong>תוקן אוטומטית (${(r.changes || []).length} שינויים)</strong> ונשמר כטיוטה. ` : '') +
        `<a href="/admin/edit/${fp}">פתח בבונה הדפים</a>` +
        (wentLive ? ` · <a href="${publicPath}" target="_blank">צפה בדף החי</a>` : ' (טיוטה — פרסמו מהבונה כשמוכן)');
      applyResult.style.display = 'block';
      if (r.created) {
        const opt = document.createElement('option');
        opt.value = r.fullPath;
        opt.textContent = `${r.fullPath} (חדש)`;
        pagePick.appendChild(opt);
        pagePick.value = r.fullPath;
      }
    } catch (err) {
      // the save endpoint may return a ready-to-apply repair in the error body
      const repair = err.repairable
        ? { ok: true, changes: err.changes, repairedSource: err.repairedSource, remaining: [] }
        : await fetchRepair(source);
      showIssues(err, repair);
    } finally {
      setButtons(lastGood);
    }
  }

  applyDraft.addEventListener('click', () => apply(false));
  applyPublish.addEventListener('click', () => apply(true));
})();
