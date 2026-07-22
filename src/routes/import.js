'use strict';

/**
 * The import wizard — the twelfth route-group extraction. One page (pick a
 * source system, upload its export file) plus the API that actually runs
 * the import through src/importers.js and lands real .pzn pages. Not
 * gated by requireAdmin, matching every other editor-level settings page.
 */

const express = require('express');
const { layout, adminNav, accentFor } = require('../admin-ui');

const router = express.Router();

router.post('/admin/api/import', (req, res) => {
  try {
    const { format, content, publish } = req.body || {};
    if (!format || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ ok: false, error: 'format and content required' });
    }
    let result;
    try {
      result = require('../importers').importFile(content, { format: String(format) });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }
    const { createPage, getPageByFullPath, savePageSource } = require('../pages');
    const created = [];
    for (const page of result.pages) {
      // never clobber — suffix until the slug is free (same rule as decompile)
      let candidate = page.slug;
      for (let n = 2; getPageByFullPath(candidate); n++) candidate = page.slug + '-' + n;
      createPage({ title: page.title, slug: candidate, blocks: [] });
      try {
        savePageSource(candidate, page.source, { publish: !!publish });
      } catch (strictErr) {
        savePageSource(candidate, page.source, { publish: !!publish, repair: true });
      }
      created.push({ title: page.title, fullPath: candidate });
    }
    res.json({ ok: true, format: result.format, count: created.length, created });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'import failed' });
  }
});

router.get('/admin/import', (req, res) => {
  const soon = [
    ['Builder.io', 'קובץ ה‑JSON של Builder.io'],
    ['HubSpot', 'ייצוא HubSpot CMS'],
    ['Camilyo', 'ייצוא Camilyo'],
    ['Mobeart', 'ייצוא Mobeart']
  ].map((v) => `
      <section class="card tight" style="opacity:.65">
        <h3 style="margin:0 0 4px">${v[0]} <span style="font-size:.72rem;background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:999px;vertical-align:middle">בקרוב</span></h3>
        <p style="color:#94a3b8;margin:0;font-size:.9rem">${v[1]} — נוסף בקרוב.</p>
      </section>`).join('');
  const html = `
    ${adminNav('import', 'ייבוא — מערכות חיצוניות')}
    <div class="container" style="padding-top:24px;max-width:920px">
      <p class="lead">
        בוחרים מערכת, מעלים את קובץ הייצוא — ותפוזיאל בונה את הדפים בשפת ה‑<code>.pzn</code> שלנו.
        לכל מערכת קטע נפרד; אין צורך לנחש איזה קובץ העליתם.
      </p>
      <section class="card tight">
        <h3 style="margin:0 0 4px">וורדפרס / Elementor <span style="font-size:.72rem;background:#dcfce7;color:#166534;padding:2px 8px;border-radius:999px;vertical-align:middle">פעיל</span></h3>
        <p style="color:#64748b;margin:0 0 12px;font-size:.9rem">קובץ ייצוא <b>WXR</b> (ב‑WordPress: כלים ← ייצוא ← כל התוכן).</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
          <input type="file" id="wp-file" accept=".xml,.wxr" style="flex:1;min-width:220px">
          <label style="font-size:.9rem;color:#475569"><input type="checkbox" id="wp-publish"> פרסם מיד</label>
          <button type="button" class="btn" data-format="wordpress" data-file="wp-file" data-publish="wp-publish" data-result="wp-result">ייבא</button>
        </div>
        <div id="wp-result" style="margin-top:12px;font-size:.9rem"></div>
      </section>
      ${soon}
    </div>
    <script>
    (function(){
      function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
      document.querySelectorAll('button[data-format]').forEach(function(btn){
        btn.addEventListener('click', function(){
          var fileEl = document.getElementById(btn.dataset.file);
          var pubEl = btn.dataset.publish ? document.getElementById(btn.dataset.publish) : null;
          var out = document.getElementById(btn.dataset.result);
          var f = fileEl && fileEl.files && fileEl.files[0];
          if(!f){ out.innerHTML = '<span style="color:#b91c1c">בחרו קובץ קודם.</span>'; return; }
          var label = btn.textContent; btn.disabled = true; btn.textContent = 'מייבא…';
          var reader = new FileReader();
          reader.onload = function(){
            fetch('/admin/api/import', { method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ format: btn.dataset.format, content: reader.result, publish: pubEl ? pubEl.checked : false }) })
            .then(function(r){return r.json();})
            .then(function(d){
              btn.disabled = false; btn.textContent = label;
              if(!d.ok){ out.innerHTML = '<span style="color:#b91c1c">שגיאה: '+esc(d.error||'')+'</span>'; return; }
              if(!d.count){ out.innerHTML = '<span style="color:#64748b">לא נמצאו דפים לייבוא בקובץ.</span>'; return; }
              var li = d.created.map(function(p){ return '<li><a href="/admin/edit/'+encodeURIComponent(p.fullPath)+'">'+esc(p.title)+'</a> <span style="color:#94a3b8">('+esc(p.fullPath)+')</span></li>'; }).join('');
              out.innerHTML = '<div style="color:#166534;margin-bottom:6px">יובאו '+d.count+' דפים:</div><ul style="margin:0;padding-inline-start:18px">'+li+'</ul>';
            })
            .catch(function(){ btn.disabled=false; btn.textContent=label; out.innerHTML = '<span style="color:#b91c1c">שגיאת רשת.</span>'; });
          };
          reader.readAsText(f);
        });
      });
    })();
    </script>
  `;
  res.send(layout(html, 'ייבוא', accentFor('import')));
});

module.exports = router;
