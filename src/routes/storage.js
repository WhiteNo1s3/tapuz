'use strict';

/**
 * Storage — extracted to its own route module in v1.09 (docs/ARCHITECTURE.md's
 * plan, seventh route-group extraction, same template as
 * team/integrations/seo/sitemap/site-chrome/menus). "The content is real
 * files on disk" screen: pages/media/site-data inventory via
 * src/storage-view.js. Read-only (no POST here — the underlying files are
 * edited from their own screens: pages in the builder, media in the
 * library, categories on /admin/categories).
 *
 * v1.90: one exception to "read-only" — the database card. The DB is a file
 * on this disk like everything else the screen shows, and it earned the two
 * POSTs a file can want: a backup snapshot and an integrity check.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');
const { requireAdmin } = require('../admin-guard');

const router = express.Router();

router.get('/admin/api/storage', (req, res) => {
  try {
    res.json({ ok: true, ...require('../storage-view').listStorage() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/admin/storage', (req, res) => {
  const store = require('../storage-view').listStorage();
  const kb = (n) => (n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B');
  const when = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  };
  const diskBadge = (p) => `<code class="disk-path">${escapeAdmin(p)}</code>`;

  const pageCards = store.pages.length
    ? store.pages.map((p) => {
        const badges =
          (p.published ? '<span class="pill ok">מפורסם</span>' : '') +
          (p.draft ? ' <span class="pill warn">טיוטה</span>' : '');
        return `<a href="/admin/edit/${encodeURIComponent(p.slug)}" class="stg-card">` +
          `<div class="row between"><strong>${escapeAdmin(p.slug)}</strong><span>${badges}</span></div>` +
          `<div class="stg-path">${diskBadge(p.diskPath)}</div>` +
          `<div class="faint">${kb(p.size)} · ${escapeAdmin(when(p.mtime))}</div></a>`;
      }).join('')
    : '<div class="stg-empty">אין דפים עדיין — <a href="/admin/new">צור דף</a>.</div>';

  const mediaCards = store.media.length
    ? store.media.map((m) =>
        `<div class="stg-card" style="text-align:center">` +
        `<img src="${escapeAdmin(m.url)}" alt="" loading="lazy" class="stg-thumb">` +
        `<div class="file-name" title="${escapeAdmin(m.name)}">${escapeAdmin(m.name)}</div></div>`
      ).join('')
    : '<div class="stg-empty">אין קבצי מדיה. העלה ב<a href="/admin/media-library">ספריית המדיה</a>.</div>';

  const dataCards = store.siteData.length
    ? store.siteData.map((f) =>
        `<div class="stg-card"><strong>🗂 ${escapeAdmin(f.name)}</strong>` +
        `<div class="stg-path">${diskBadge(f.diskPath)}</div>` +
        `<div class="faint">${kb(f.size)} · ${escapeAdmin(when(f.mtime))}</div></div>`
      ).join('')
    : '<div class="stg-empty">—</div>';

  const html = `
    ${adminNav('storage', 'אחסון')}
    <div class="container page-body" style="max-width:1000px">
      <div class="banner">
        <div class="banner-title">🗄️ התוכן שלך — קבצים אמיתיים על הדיסק</div>
        <div class="banner-text">אין מסד נתונים סגור ואין נעילה. כל דף הוא קובץ <code>.pzn</code> אמיתי בתיקייה שלך — אתה הבעלים. זו העוצמה של Tapuziel: התוכן נייד, קריא, ושלך.</div>
        <div class="banner-meta">📁 ${escapeAdmin(store.root)}</div>
      </div>

      <div class="stg-sec">📄 דפים <span class="n">${store.counts.pages}</span></div>
      <div class="stg-grid">${pageCards}</div>

      <div class="stg-sec">🖼️ מדיה <span class="n">${store.counts.media}</span></div>
      <div class="stg-grid">${mediaCards}</div>

      <div class="stg-sec">🗂️ נתוני אתר <span class="n">${store.counts.siteData}</span></div>
      <div class="stg-grid">${dataCards}</div>

      <div class="stg-sec">🛢️ מסד הנתונים</div>
      ${dbCard(req)}
    </div>
  `;
  res.send(layout(html, 'אחסון', accentFor('storage')));
});

// ── v1.90 premium db: the DB is a file on this disk too ──────────────

function dbCard(req) {
  const dbm = require('../db');
  const h = dbm.dbHealth();
  const kb = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB'
    : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B');
  const when = (ms) => new Date(ms).toLocaleDateString('he-IL') + ' ' +
    new Date(ms).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

  // integrity runs ON DEMAND (?check=1), never on every page load
  const checked = req.query.check === '1' ? dbm.integrityCheck() : null;
  const flash = req.query.db === 'backed'
    ? '<div class="pill ok">✓ גיבוי נוצר</div>'
    : req.query.db === 'restored'
      ? '<div class="pill ok">✓ שוחזר — התוכן הוחלף; גיבוי בטיחות מהרגע שלפני נוסף למדף</div>'
      : req.query.db === 'restorefail'
        ? '<div class="pill warn">השחזור נכשל — התוכן לא נגע (הכול-או-כלום)</div>' : '';

  const shelf = h.backups.length
    ? h.backups.map((b) =>
        `<div class="row between" style="padding:4px 0;gap:8px;align-items:center">` +
        `<a href="/admin/db/backup/${encodeURIComponent(b.name)}" download>💾 ${escapeAdmin(b.name)}</a>` +
        `<span class="faint">${kb(b.size)} · ${escapeAdmin(when(b.mtime))}</span>` +
        `<form method="POST" action="/admin/db/restore" style="margin:0" ` +
        `onsubmit="return confirm('לשחזר את מסד הנתונים מהגיבוי הזה? התוכן הנוכחי יוחלף — נוצר גיבוי בטיחות קודם.')">` +
        `<input type="hidden" name="name" value="${escapeAdmin(b.name)}">` +
        `<button class="btn secondary sm" type="submit">שחזר</button></form></div>`
      ).join('')
    : '<div class="faint">אין עדיין גיבויים — הראשון ייווצר אוטומטית, או עכשיו בכפתור.</div>';

  return `
    <div class="stg-card" style="max-width:640px">
      <div class="row between"><strong>SQLite — קובץ פתוח, שלך</strong>${flash}</div>
      <div class="stg-path"><code class="disk-path">${escapeAdmin(h.path)}</code></div>
      <div class="faint" style="margin:6px 0">
        ${kb(h.size)}${h.walSize ? ' (+' + kb(h.walSize) + ' WAL)' : ''} ·
        journal: ${escapeAdmin(h.journalMode)} ·
        מפתחות זרים: ${h.foreignKeys ? 'נאכפים ✓' : 'כבויים!'} ·
        busy timeout: ${h.busyTimeoutMs}ms
      </div>
      ${checked ? `<div class="pill ${checked.ok ? 'ok' : 'warn'}" style="margin:4px 0">
        בדיקת תקינות: ${checked.ok ? 'תקין ✓' : escapeAdmin(checked.detail)}</div>` : ''}
      <div style="display:flex;gap:8px;margin:8px 0">
        <form method="POST" action="/admin/db/backup"><button class="btn sm" type="submit">גבה עכשיו</button></form>
        <a class="btn secondary sm" href="/admin/storage?check=1#db">בדוק תקינות</a>
        <a class="btn secondary sm" href="/admin/db/export.pzn" download>ייצוא ‎.pzn</a>
      </div>
      <div class="side-title">מדף הגיבויים (אוטומטית פעם ביום, נשמרים ${h.backupKeep})</div>
      ${shelf}
      <p class="faint" style="margin-top:6px;font-size:.8rem">
        כל גיבוי הוא snapshot עקבי (VACUUM INTO) — קובץ SQLite רגיל שנפתח בכל כלי, בכל מקום.
        הייצוא הוא חבילת <code>tapuz-db</code> ‎(.pzn)‎ — אותו תוכן כ-JSON קריא, טבלה-טבלה,
        בשביל המשחק: כמו שחבילת <code>tapuz-site</code> נושאת את האתר, זו נושאת את מסד הנתונים.
      </p>
      <div class="side-title" style="margin-top:10px">ייבוא חבילת ‎.pzn</div>
      <textarea id="dbp-text" rows="3" dir="ltr" placeholder='{"format":"tapuz-db", ...}'
        style="width:100%;padding:8px;border:1.5px solid #cbd5e1;border-radius:8px;box-sizing:border-box;font-family:monospace;font-size:.8rem"></textarea>
      <div class="row between" style="margin-top:6px">
        <span id="dbp-status" class="faint"></span>
        <button type="button" class="btn secondary sm" id="dbp-apply">ייבוא (מחליף הכול)</button>
      </div>
      <script>
        document.getElementById('dbp-apply').addEventListener('click', function () {
          var status = document.getElementById('dbp-status');
          var pkg;
          try { pkg = JSON.parse(document.getElementById('dbp-text').value || ''); }
          catch (e) { status.textContent = 'לא JSON תקין'; status.style.color = '#b91c1c'; return; }
          if (!confirm('ייבוא מחליף את כל תוכן מסד הנתונים. נוצר גיבוי בטיחות קודם. להמשיך?')) return;
          status.textContent = 'מייבא…'; status.style.color = '#166534';
          fetch('/admin/api/db/import-pzn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ package: pkg })
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.ok) { window.location = '/admin/storage?db=restored'; }
            else { status.style.color = '#b91c1c'; status.textContent = d.error || 'שגיאה'; }
          }).catch(function () { status.style.color = '#b91c1c'; status.textContent = 'שגיאת רשת'; });
        });
      </script>
    </div>`;
}

router.post('/admin/db/backup', requireAdmin, (req, res) => {
  try { require('../db').backupNow(); } catch (e) { /* absence on the shelf is the signal */ }
  res.redirect('/admin/storage?db=backed');
});

router.post('/admin/db/restore', requireAdmin, (req, res) => {
  const name = String((req.body || {}).name || '');
  if (!/^tapuz-[\w.-]+\.sqlite$/.test(name) || name.includes('..')) {
    return res.redirect('/admin/storage?db=restorefail');
  }
  const file = path.join(require('../paths').DB_DIR, 'backups', name);
  if (!fs.existsSync(file)) return res.redirect('/admin/storage?db=restorefail');
  // Copy the target ASIDE first: the safety backup below prunes the shelf,
  // and restoring the OLDEST snapshot must not see its own file pruned away.
  const tmp = file + '.restoring';
  try {
    fs.copyFileSync(file, tmp);
    require('../db').backupNow(); // the moment before the replace, kept
    const r = require('../db-restore').restoreFromSnapshot(tmp);
    return res.redirect('/admin/storage?db=' + (r.ok ? 'restored' : 'restorefail'));
  } catch (e) {
    return res.redirect('/admin/storage?db=restorefail');
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* best effort */ }
  }
});

// The database as a .pzn package — `tapuz-db`, the same family as
// `tapuz-site`: everything portable in Tapuziel is a documented package.
router.get('/admin/db/export.pzn', requireAdmin, (req, res) => {
  try {
    const pkg = require('../db-restore').exportDbPackage();
    const filename = 'tapuziel-db-' + new Date().toISOString().slice(0, 10) + '.pzn';
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.type('application/json').send(JSON.stringify(pkg, null, 2));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/db/import-pzn', requireAdmin, (req, res) => {
  try {
    require('../db').backupNow(); // safety net before the replace
    const r = require('../db-restore').importDbPackage((req.body || {}).package);
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

router.get('/admin/db/backup/:name', requireAdmin, (req, res) => {
  const name = String(req.params.name || '');
  // the shelf's own naming, nothing else — no traversal, no surprises
  if (!/^tapuz-[\w.-]+\.sqlite$/.test(name) || name.includes('..')) {
    return res.status(400).send('bad name');
  }
  const file = path.join(require('../paths').DB_DIR, 'backups', name);
  if (!fs.existsSync(file)) return res.status(404).send('not found');
  res.download(file);
});

module.exports = router;
