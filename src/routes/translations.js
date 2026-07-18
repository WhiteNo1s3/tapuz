'use strict';

/**
 * Multilingual pairing admin (v1.08) — link two existing pages as
 * translations of each other. "A fraction of WPML's surface" (Ben): no
 * per-string translation, no URL-prefix routing, just page pairing +
 * a language switcher (rendered by src/renderer.js renderLangSwitcher,
 * wired the same way theme/search/whatsapp are). Own admin page, same
 * pattern as /admin/sitemap and /admin/menus — not wedged into the page
 * builder's side panel.
 */

const express = require('express');
const { listPages, getPageByFullPath, linkTranslations, unlinkTranslation } = require('../pages');
const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');

const router = express.Router();

function withMeta(p) {
  const full = getPageByFullPath(p.full_path);
  return { ...p, meta: (full && full.meta) || {} };
}

router.get('/admin/translations', (req, res) => {
  const pages = listPages().map(withMeta);
  const groups = {};
  for (const p of pages) {
    const g = p.meta.translationGroup;
    if (!g) continue;
    (groups[g] = groups[g] || []).push(p);
  }
  // A "group" of one member is a page whose sibling was unlinked — it isn't
  // actually paired with anything anymore (getTranslations() already treats
  // it as untranslated); don't show it as a translation group in the UI.
  const groupRows = Object.entries(groups).filter(([, members]) => members.length >= 2).map(([g, members]) => `
    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:10px">
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${members.map((p) => `
          <span style="display:flex;align-items:center;gap:6px;background:#f1f5f9;border-radius:999px;padding:4px 10px;font-size:0.85rem">
            <strong style="color:#0a66c2">${escapeAdmin((p.meta.lang || '?').toUpperCase())}</strong>
            <span>${escapeAdmin(p.title)}</span>
            <button type="button" class="tr-unlink" data-path="${escapeAdmin(p.full_path)}" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:0.85rem" title="הסר מהקבוצה">✕</button>
          </span>`).join('')}
      </div>
    </div>`).join('') || '<p style="color:#94a3b8">אין עדיין תרגומים מקושרים.</p>';

  const pageOptions = pages.map((p) =>
    `<option value="${escapeAdmin(p.full_path)}">${escapeAdmin(p.title)} — /${escapeAdmin(p.full_path)}${p.meta.lang ? ' (' + escapeAdmin(p.meta.lang.toUpperCase()) + ')' : ''}</option>`
  ).join('');

  const html = `
    ${adminNav('translations', 'תרגומים')}
    <div class="container" style="padding-top:28px;max-width:760px;padding-bottom:60px">
      <p style="color:#64748b;margin-top:0">קשרו שני דפים קיימים כתרגום זה של זה — כמו "אודות" ו-"About". קישור יוצר החלפת שפה אוטומטית וזוגות ‎hreflang‎ ל-SEO. אין שדה שפה גלובלי — כל דף מסמן את השפה שלו ברגע שהוא נכנס לקבוצה.</p>

      <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px;margin-bottom:18px">
        <h3 style="margin-top:0">קבוצות תרגום קיימות</h3>
        ${groupRows}
      </section>

      <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px">
        <h3 style="margin-top:0">➕ קשר שני דפים</h3>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-bottom:10px">
          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px">דף א׳</label>
            <select id="tr-page-a" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px">${pageOptions}</select>
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px">שפה</label>
            <input id="tr-lang-a" dir="ltr" placeholder="he" maxlength="8" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;box-sizing:border-box">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-bottom:14px">
          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px">דף ב׳</label>
            <select id="tr-page-b" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px">${pageOptions}</select>
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px">שפה</label>
            <input id="tr-lang-b" dir="ltr" placeholder="en" maxlength="8" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;box-sizing:border-box">
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;align-items:center">
          <span id="tr-status" style="font-size:0.85rem"></span>
          <button type="button" class="btn" id="tr-link">קשר כתרגומים</button>
        </div>
        <div style="font-size:0.8rem;color:#94a3b8;margin-top:10px">השינוי נכנס לתוקף באתר אחרי "בנה אתר".</div>
      </section>
    </div>
    <script>
      document.getElementById('tr-link').addEventListener('click', function () {
        var status = document.getElementById('tr-status');
        fetch('/admin/api/translations/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pathA: document.getElementById('tr-page-a').value,
            langA: document.getElementById('tr-lang-a').value,
            pathB: document.getElementById('tr-page-b').value,
            langB: document.getElementById('tr-lang-b').value
          })
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d.ok) { status.style.color = '#166534'; status.textContent = 'קושר ✓'; location.reload(); }
          else { status.style.color = '#b91c1c'; status.textContent = d.error || 'שגיאה'; }
        }).catch(function () { status.style.color = '#b91c1c'; status.textContent = 'שגיאת רשת'; });
      });
      document.querySelectorAll('.tr-unlink').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (!confirm('להסיר את הדף מקבוצת התרגום?')) return;
          fetch('/admin/api/translations/unlink', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: btn.dataset.path })
          }).then(function () { location.reload(); });
        });
      });
    </script>
  `;
  res.send(layout(html, 'תרגומים', accentFor('translations')));
});

router.post('/admin/api/translations/link', (req, res) => {
  try {
    const b = req.body || {};
    const group = linkTranslations(String(b.pathA || ''), String(b.langA || ''), String(b.pathB || ''), String(b.langB || ''));
    res.json({ ok: true, group });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/translations/unlink', (req, res) => {
  try {
    unlinkTranslation(String((req.body || {}).path || ''));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
