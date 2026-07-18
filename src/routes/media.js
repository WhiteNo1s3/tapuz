'use strict';

/**
 * Media library — extracted to its own route module in v1.10
 * (docs/ARCHITECTURE.md's plan, ninth route-group extraction, the last
 * named same-shaped candidate before the harder auth/CSRF gate and the
 * pzn/builder API surface). DB-wired, folder-aware (v0.31): folder CRUD,
 * upload (magic-byte validation lives inside src/media.js's saveBase64,
 * not here), and the library browser UI. The fully dead, already-commented-
 * out `/admin/upload-legacy` route (explicitly marked "unused after v0.31"
 * in its own comment) was dropped rather than relocated — moving confirmed
 * dead code forward serves nobody.
 */

const express = require('express');
const { layout, adminNav, accentFor } = require('../admin-ui');

const router = express.Router();

const mediaLib = require('../media');
mediaLib.syncDisk(); // adopt files already on disk

router.get('/admin/media', (req, res) => {
  try {
    res.json(mediaLib.listMedia(req.query.folder || ''));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/media/folder', (req, res) => {
  try {
    const folder = mediaLib.createFolder(
      (req.body.parent ? req.body.parent + '/' : '') + (req.body.name || '')
    );
    res.json({ ok: true, folder });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/media/delete-folder', (req, res) => {
  try {
    mediaLib.deleteFolder(req.body.path);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/media/delete', (req, res) => {
  try {
    mediaLib.deleteFile(req.body.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/media/move', (req, res) => {
  try {
    const url = mediaLib.moveFile(req.body.id, req.body.folder || '');
    res.json({ ok: true, url });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Legacy flat list (kept for compatibility)
router.get('/admin/assets', (req, res) => {
  try {
    res.json(mediaLib.listMedia('').files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/upload', (req, res) => {
  try {
    const { filename, data, folder } = req.body || {};
    if (!filename || !data || typeof data !== 'string') {
      return res.status(400).json({ ok: false, error: 'missing filename/data' });
    }
    const saved = mediaLib.saveBase64({ filename, data, folder: folder || '' });
    return res.json({ ok: true, url: saved.url, name: saved.name, id: saved.id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/admin/media-library', (req, res) => {
  const html = `
    ${adminNav('media', 'ספריית מדיה')}
    <div class="container" style="padding-top:28px;max-width:960px;padding-bottom:60px">
      <p style="color:#64748b;margin-top:0">כל התמונות והקבצים של האתר — תיקיות, העלאה ומחיקה. אותה ספרייה שמופיעה בבונה הדפים.</p>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <div id="ml-crumbs" style="font-size:0.95rem;color:#334155"></div>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn secondary" id="ml-new-folder">📁+ תיקייה</button>
            <label class="btn" style="cursor:pointer">העלה קובץ
              <input type="file" accept="image/*" id="ml-upload" style="display:none">
            </label>
          </div>
        </div>
        <div id="ml-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px"></div>
      </div>
    </div>
    <script>
      (function () {
        var folder = '';
        function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
        function load(f) {
          folder = f || '';
          fetch('/admin/media?folder=' + encodeURIComponent(folder))
            .then(function (r) { return r.json(); })
            .then(render)
            .catch(function () {
              document.getElementById('ml-grid').innerHTML = '<div style="color:#b91c1c">שגיאה בטעינה</div>';
            });
        }
        function render(data) {
          var crumbs = '<span class="ml-crumb" data-goto="" style="cursor:pointer;color:#0a66c2">🏠 מדיה</span>';
          var acc = '';
          (folder ? folder.split('/') : []).forEach(function (seg) {
            acc = acc ? acc + '/' + seg : seg;
            crumbs += ' › <span class="ml-crumb" data-goto="' + esc(acc) + '" style="cursor:pointer;color:#0a66c2">' + esc(seg) + '</span>';
          });
          document.getElementById('ml-crumbs').innerHTML = crumbs;

          var tiles = '';
          (data.folders || []).forEach(function (f) {
            tiles += '<div class="media-tile" data-folder="' + esc(f.path) + '" style="border:1px solid #e2e8f0;border-radius:10px;padding:10px;cursor:pointer;text-align:center;background:#fff">' +
              '<div style="font-size:2.4rem;line-height:70px;height:70px">📁</div>' +
              '<div style="font-size:0.8rem;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(f.name) + '</div></div>';
          });
          (data.files || []).forEach(function (f) {
            tiles += '<div style="border:1px solid #e2e8f0;border-radius:10px;padding:8px;text-align:center;background:#fff">' +
              '<img src="' + esc(f.url) + '" alt="" loading="lazy" style="width:100%;height:88px;object-fit:cover;border-radius:6px">' +
              '<div style="font-size:0.75rem;color:#475569;margin:5px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(f.name) + '">' + esc(f.name) + '</div>' +
              '<div style="display:flex;gap:4px;justify-content:center">' +
              '<button type="button" data-copy="' + esc(f.url) + '" style="border:1px solid #e2e8f0;background:#fff;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:0.75rem">🔗 העתק</button>' +
              '<button type="button" data-del="' + esc(String(f.id)) + '" data-name="' + esc(f.name) + '" style="border:1px solid #fecaca;background:#fff;color:#b91c1c;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:0.75rem">🗑</button>' +
              '</div></div>';
          });
          var grid = document.getElementById('ml-grid');
          grid.innerHTML = tiles || '<div style="grid-column:1/-1;color:#64748b;padding:26px;text-align:center">תיקייה ריקה — העלה קובץ או צור תיקייה</div>';

          document.querySelectorAll('.ml-crumb').forEach(function (c) {
            c.addEventListener('click', function () { load(c.dataset.goto); });
          });
          grid.querySelectorAll('[data-folder]').forEach(function (t) {
            t.addEventListener('click', function () { load(t.dataset.folder); });
          });
          grid.querySelectorAll('[data-copy]').forEach(function (b) {
            b.addEventListener('click', function () {
              if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy);
              b.textContent = 'הועתק ✓';
              setTimeout(function () { b.textContent = '🔗 העתק'; }, 1400);
            });
          });
          grid.querySelectorAll('[data-del]').forEach(function (b) {
            b.addEventListener('click', function () {
              if (!confirm('למחוק את "' + b.dataset.name + '" לצמיתות?')) return;
              fetch('/admin/media/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: parseInt(b.dataset.del, 10) })
              }).then(function (r) { return r.json(); }).then(function (d) {
                if (d.ok) load(folder); else alert(d.error || 'שגיאה');
              });
            });
          });
        }
        document.getElementById('ml-new-folder').addEventListener('click', function () {
          var name = prompt('שם התיקייה החדשה:');
          if (!name) return;
          fetch('/admin/media/folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parent: folder, name: name })
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.ok) load(folder); else alert(d.error || 'שגיאה');
          });
        });
        document.getElementById('ml-upload').addEventListener('change', function () {
          var input = this;
          if (!input.files || !input.files.length) return;
          var file = input.files[0];
          var reader = new FileReader();
          reader.onload = function () {
            fetch('/admin/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: file.name, data: reader.result, folder: folder })
            }).then(function (r) { return r.json(); }).then(function (d) {
              input.value = '';
              if (d.ok) load(folder); else alert(d.error || 'שגיאה בהעלאה');
            });
          };
          reader.readAsDataURL(file);
        });
        load('');
      })();
    </script>
  `;
  res.send(layout(html, 'ספריית מדיה', accentFor('media')));
});

module.exports = router;
