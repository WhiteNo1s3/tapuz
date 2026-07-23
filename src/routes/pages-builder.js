'use strict';

/**
 * Page builder — the twenty-fifth route-group extraction, and the marquee
 * one: the site-builder surface itself. New-page picker + create, delete,
 * server-side preview, the visual builder (/admin/edit), and the
 * save/publish/build lifecycle. The largest single cut of the session
 * (~477 lines). Dependencies are all clean module imports — the page
 * store, the BenTML engine, the block registry, the renderer, and the
 * admin-ui shell — nothing reaches back into server.js.
 */

const express = require('express');
const { layout, adminNav, accentFor, escapeAdmin, jsonForScript } = require('../admin-ui');
const { loadConfig } = require('../config');
const { listPages, createPage, updatePage, publishPage, getPageByFullPath, deletePage, generateFullPath } = require('../pages');
const { exportAll } = require('../export');
const bentml = require('../bentml');
const blockRegistry = require('../block-registry');

const router = express.Router();

router.get('/admin/new', (req, res) => {
  // Starter templates (v0.93) — pick a layout instead of a blank page.
  const templates = require('../templates').listTemplates();
  const templateCards = templates.map((t, i) =>
    `<label class="tpl-card">
       <input type="radio" name="template" value="${t.key}"${i === 0 ? ' checked' : ''}>
       <span class="tpl-ico">${t.icon}</span>
       <span class="tpl-name">${t.name}</span>
       <span class="tpl-desc">${t.desc}</span>
     </label>`
  ).join('');
  const html = `
    ${adminNav('pages', 'דף חדש')}
    <style>
      .tpl-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:20px }
      .tpl-card { position:relative;display:flex;flex-direction:column;gap:4px;background:#fff;border:2px solid #e2e8f0;
        border-radius:12px;padding:12px;cursor:pointer;transition:border-color .12s }
      .tpl-card:hover { border-color:#94a3b8 }
      .tpl-card input { position:absolute;opacity:0;pointer-events:none }
      .tpl-card:has(input:checked) { border-color:var(--admin-accent);box-shadow:0 0 0 3px color-mix(in srgb, var(--admin-accent) 18%, transparent) }
      .tpl-ico { font-size:1.4rem }
      .tpl-name { font-weight:700;font-size:.92rem }
      .tpl-desc { font-size:.75rem;color:#64748b;line-height:1.45 }
    </style>
    <div class="container page-body" style="max-width:640px">
      <h2 style="margin-bottom:20px">דף חדש</h2>
      <form method="POST" action="/admin/create">
        <div style="margin-bottom:14px">
          <label class="field-label">כותרת</label>
          <input id="np-title" name="title" required autofocus class="input">
        </div>
        <div style="margin-bottom:20px">
          <label class="field-label">כתובת הדף (slug)</label>
          <input id="np-slug" name="slug" placeholder="נוצר אוטומטית מהכותרת" class="input">
          <div style="font-size:0.8rem;color:#64748b;margin-top:4px">נוצר אוטומטית מהכותרת — אפשר לשנות, לא חובה להבין ב-slug</div>
        </div>
        <label style="display:block;margin-bottom:8px;font-weight:600">מתחילים מ…</label>
        <div class="tpl-grid">${templateCards}</div>
        <button type="submit" class="btn">צור דף והתחל לערוך</button>
      </form>

      <details class="card" style="margin-top:26px;padding:6px 16px 16px">
        <summary style="cursor:pointer;font-weight:600;padding:10px 0">🔁 יש לכם כבר דף? ייבאו אותו (מכתובת או מ‑HTML)</summary>
        <p style="color:#64748b;font-size:.88rem;margin:6px 0 12px">
          תפוזיאל יפרק את הדף למודולים שאפשר לערוך בבונה. מה שלא ממופה נשמר כ‑HTML זמני — שום דבר לא הולך לאיבוד.
        </p>
        <label class="field-label">כתובת דף (URL)</label>
        <input id="imp-url" dir="ltr" placeholder="https://example.com/page" class="input">
        <div style="text-align:center;color:#94a3b8;font-size:.8rem;margin:8px 0">— או —</div>
        <label class="field-label">הדביקו HTML</label>
        <textarea id="imp-html" dir="ltr" rows="5" placeholder="<html>…</html>" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;box-sizing:border-box;font-family:ui-monospace,monospace;font-size:.82rem"></textarea>
        <button type="button" id="imp-go" class="btn" style="margin-top:12px">🔁 ייבא ופתח בבונה</button>
        <div id="imp-status" style="margin-top:10px;font-size:.88rem;display:none"></div>
      </details>
    </div>
    <script>
      (function () {
        // Auto-slug for people unfamiliar with sites: derive from the title as
        // you type, but stop the moment the user edits the slug themselves.
        var t = document.getElementById('np-title');
        var s = document.getElementById('np-slug');
        if (!t || !s) return;
        var touched = false;
        s.addEventListener('input', function () { touched = s.value.trim().length > 0; });
        function slugify(v) {
          return String(v || '').trim().replace(/\\s+/g, '-')
            .replace(/[\\\\/:*?"<>|#]/g, '').replace(/\\.\\.+/g, '.').replace(/^\\.+/, '').slice(0, 80);
        }
        t.addEventListener('input', function () { if (!touched) s.value = slugify(t.value); });
      })();

      (function () {
        // Decompile-import (v0.57): URL or pasted HTML → draft page → builder.
        var go = document.getElementById('imp-go');
        var st = document.getElementById('imp-status');
        if (!go) return;
        function say(msg, ok) {
          st.style.display = 'block';
          st.style.color = ok ? '#166534' : '#b91c1c';
          st.textContent = msg;
        }
        go.addEventListener('click', function () {
          var url = document.getElementById('imp-url').value.trim();
          var htmlIn = document.getElementById('imp-html').value.trim();
          if (!url && !htmlIn) { say('הזינו כתובת או הדביקו HTML', false); return; }
          go.disabled = true;
          say(url ? 'מביא ומפרק את הדף…' : 'מפרק את ה‑HTML…', true);
          fetch('/admin/api/pzn/decompile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url, html: htmlIn, create: true })
          }).then(function (r) { return r.json(); }).then(function (r) {
            go.disabled = false;
            if (!r.ok) { say('שגיאה: ' + (r.error || '?'), false); return; }
            var gap = (r.toolGap && r.toolGap.length) ? ' · חסרים לנו כלים ל: ' + r.toolGap.join(', ') : '';
            say('נוצר "' + r.meta.title + '" — ' + r.mapped + ' מודולים מופו, ' + r.leftover + ' נשמרו כ‑HTML זמני' + gap, true);
            setTimeout(function () { location.href = '/admin/edit/' + encodeURIComponent(r.fullPath); }, 1400);
          }).catch(function (e) { go.disabled = false; say('שגיאה: ' + e.message, false); });
        });
      })();
    </script>
  `;
  res.send(layout(html, 'דף חדש', accentFor('pages')));
});

router.post('/admin/create', (req, res) => {
  const title = (req.body.title || '').trim() || 'דף חדש';
  let slug = (req.body.slug || '').trim();
  // Auto-slug when the user left it blank (they may not know what a slug is).
  if (!slug) {
    const { deriveSlug } = require('../pzn/intent');
    slug = deriveSlug(title);
  }
  // Never clobber an existing page — suffix until the full_path is free.
  let candidate = slug;
  for (let n = 2; getPageByFullPath(generateFullPath('', candidate)); n++) {
    candidate = slug + '-' + n;
  }
  const result = createPage({
    title,
    slug: candidate,
    direction: 'rtl',
    // starter templates (v0.93) — unknown/missing key falls back to 'basic',
    // which is exactly the old single-hero seed (behavior preserved)
    blocks: require('../templates').templateBlocks(req.body.template, title)
  });
  res.redirect('/admin/edit/' + encodeURIComponent(result.full_path));
});

router.post('/admin/delete', (req, res) => {
  deletePage(req.body.full_path);
  res.redirect('/admin');
});

// ======================== VISUAL CANVAS BUILDER ========================
// Draft preview (v0.90) — the CURRENT DRAFT rendered with the real theme
// (markup, CSS, media queries — the truth, not the canvas approximation).
// Feeds the builder's responsive device preview. Admin-gated like all
// /admin routes; never writes to public/.
router.get('/admin/preview/:fullPath', (req, res) => {
  try {
    const { renderPage } = require('../renderer');
    const page = getPageByFullPath(decodeURIComponent(req.params.fullPath));
    if (!page) return res.status(404).send('הדף לא נמצא');
    // the builder iframes this route — SAMEORIGIN (not the global DENY) keeps
    // clickjacking protection while letting the admin frame its own preview
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.type('html').send(renderPage(page, { useDraft: true }));
  } catch (e) {
    res.status(500).send(e.message);
  }
});

router.get('/admin/edit/:fullPath', (req, res) => {
  const fullPath = decodeURIComponent(req.params.fullPath);
  const page = getPageByFullPath(fullPath);
  if (!page) return res.status(404).send('דף לא נמצא');

  // Builder always edits draft_blocks
  const draft = page.draft_blocks != null ? page.draft_blocks : (page.blocks || []);
  const initialBlocks = jsonForScript(draft);
  const safeTitle = escapeAdmin(page.title || '');
  // The settings drawer follows the direction of the PAGE being edited
  const pageDirection = page.direction === 'ltr' ? 'ltr' : 'rtl';
  const hasUnpublished = JSON.stringify(draft || []) !== JSON.stringify(page.blocks || []);
  const statusLabel = page.status === 'published' ? 'פורסם' : 'טיוטה';
  const badgeBg = page.status === 'published' ? '#dcfce7' : '#fef3c7';
  const badgeFg = page.status === 'published' ? '#166534' : '#92400e';
  const badgeExtra = hasUnpublished ? ' • טיוטה שונה' : '';

  // Toolbox is GENERATED from the block registry (src/block-registry.js),
  // grouped by category — a new block type appears here automatically.
  // Categories fold closed (first one open) so the palette never drowns the
  // canvas; a search field cuts across all of them.
  const toolboxHtml = blockRegistry.BLOCK_CATEGORIES.map((cat, catIndex) => {
    const entries = blockRegistry.BLOCK_REGISTRY.filter(e => e.category === cat && !e.childrenOf);
    if (!entries.length) return '';
    const buttons = entries.map(e => `
            <button type="button" class="tool-btn" data-type="${escapeAdmin(e.type)}" title="${escapeAdmin(e.hintHe || e.labelHe)}">
              <span class="tool-ico">${escapeAdmin(e.icon || '•')}</span><span class="tool-meta"><span class="tool-name">${escapeAdmin(e.labelHe)}</span><span class="tool-hint">${escapeAdmin(e.hintHe || '')}</span></span>
            </button>`).join('');
    return `<details class="tool-cat" data-cat-i="${catIndex}">
            <summary class="tool-cat-toggle"><span class="chev">▸</span><span class="tool-cat-title">${escapeAdmin(cat)}</span><span class="tool-cat-count">${entries.length}</span></summary>
            <div class="tool-cat-body">${buttons}</div>
          </details>`;
  }).join('');

  const html = `
    <div class="topbar">
      <div class="brand-strip"></div>
      <div class="container topbar-inner">
        <div class="topbar-left">
          <a href="/admin" class="brand-logo" style="font-size:1.35rem">🍊 Tapuz</a>
          <button type="button" id="btn-pages-nav" class="btn secondary sm" title="ניווט דפים">☰ דפים</button>
          <input id="page-title" class="page-title" value="${safeTitle}" placeholder="כותרת הדף">
          <span id="publish-badge" style="font-size:0.8rem;padding:3px 10px;border-radius:999px;background:${badgeBg};color:${badgeFg}">${statusLabel}${badgeExtra}</span>
          <select id="page-status" style="display:none">
            <option value="draft" ${page.status === 'draft' ? 'selected' : ''}>טיוטה</option>
            <option value="published" ${page.status === 'published' ? 'selected' : ''}>פורסם</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button type="button" onclick="TapuzBuilder.openImportAi()" class="btn secondary" style="padding:8px 12px;border-color:#c7d2fe;color:#4338ca">🤖 ייבא מ‑AI</button>
          <button type="button" onclick="TapuzBuilder.openRevisions()" class="btn secondary sm">היסטוריה</button>
          <a href="/admin/theme" class="btn secondary sm">ערכת נושא</a>
          <a href="/" target="_blank" class="btn secondary sm">צפה באתר</a>
          <button type="button" onclick="TapuzBuilder.savePage()" class="btn sm">שמור טיוטה</button>
          <button type="button" onclick="TapuzBuilder.publishPage()" class="btn js-publish-btn publish sm" data-publish-main="1">פרסם</button>
          <button type="button" onclick="TapuzBuilder.publishAndBuild()" class="btn js-publish-btn publish-build sm">פרסם + בנה</button>
        </div>
      </div>
    </div>

    <div class="container adv-off" id="builder-root">
      <div class="builder-mode-tabs" role="tablist">
        <button type="button" data-builder-mode="page" class="active" role="tab">
          בונה הדף
          <span class="tab-sub">ויזואלי · גרירה · פשוט ליהנות</span>
        </button>
        <button type="button" data-builder-mode="output" role="tab" class="adv-only">
          קוד BenTML
          <span class="tab-sub">מתקדם · שפה חיה — כותבים והדף רוקד</span>
        </button>
        <button type="button" id="btn-toggle-advanced" class="mode-advanced-toggle" title="כלים מתקדמים — קוד BenTML" aria-pressed="false">⚙ מתקדם</button>
      </div>

      <div class="builder live-page mode-page page-${pageDirection}">
        <aside class="toolbox" aria-label="ארגז מודולים">
          <button type="button" id="toolbox-handle" class="toolbox-handle" aria-label="פתח/סגור ארגז מודולים">🧰 מודולים <span class="th-arrow">▲</span></button>
          <details id="layers-fold" class="layers-fold">
            <summary>🧬 שכבות הדף <span id="layers-count" class="layers-count"></span></summary>
            <div id="layers-tree" class="layers-tree"></div>
          </details>
          <details id="symbols-fold" class="layers-fold">
            <summary>💠 בלוקים שמורים <span id="symbols-count" class="layers-count"></span></summary>
            <div id="symbols-list" class="symbols-list"></div>
          </details>
          <h4>מודולים</h4>
          <div id="toolbox-mode" class="toolbox-mode">גרור לדף · בחר לעריכה בצד</div>
          <input type="search" id="tool-search" class="tool-search" placeholder="🔎 חיפוש מודול..." autocomplete="off">
          ${toolboxHtml}
          <hr style="margin:12px 0">
          <button type="button" class="tool-btn tool-utility" onclick="TapuzBuilder.openMediaLibrary()">
            <span class="tool-ico">🖼</span><span class="tool-meta"><span class="tool-name">מדיה</span><span class="tool-hint">ספרייה / העלאה</span></span>
          </button>
          <a class="tool-btn tool-utility" href="/admin/api/syntax-dictionary.md" target="_blank" rel="noopener">
            <span class="tool-ico">📖</span><span class="tool-meta"><span class="tool-name">מילון תחביר</span><span class="tool-hint">לשימוש חיצוני</span></span>
          </a>
          <a class="tool-btn tool-utility" href="/chat-snippet.txt" download="tapuz-syntax-snippet.txt">
            <span class="tool-ico">📋</span><span class="tool-meta"><span class="tool-name">Snippet חיצוני</span><span class="tool-hint">הורדה לצ׳אט שלהם — לא אצלנו</span></span>
          </a>
        </aside>

        <div id="builder-pane-page" class="builder-canvas-wrap">
          <div class="canvas-header">
            <span>דף חי · טיוטה</span>
            <span id="block-count">${(draft || []).length} מודולים</span>
            <button type="button" id="btn-page-props" class="page-props-btn">⚙ הגדרות דף</button>
            <button type="button" id="btn-responsive" class="page-props-btn" title="איך הדף נראה בנייד, בטאבלט ובמחשב — הרינדור האמיתי">📱 רספונסיב</button>
            <button type="button" id="btn-prompt-builder" class="page-props-btn" title="פרומפט מלא לצ׳אט ה-AI שלכם — כולל הדף הנוכחי, בלי מפתח">🧠 פרומפט AI</button>
            <span id="canvas-hint" class="canvas-hint"></span>
          </div>
          <div id="canvas" class="canvas"></div>
          <div id="bentml-output-dock" class="bentml-output-dock adv-only">
            <div class="bentml-output-dock-head">
              <span class="bentml-live-dot" id="bentml-live-dot" aria-hidden="true"></span>
              <strong>BenTML חי</strong>
              <span class="dock-sub">דו־כיווני: גררו — הקוד נכתב · כתבו — הדף רוקד</span>
              <button type="button" class="btn secondary" id="btn-bentml-copy-live">העתק</button>
              <button type="button" class="btn secondary" id="btn-open-output">מסך מלא</button>
              <span id="bentml-live-status" class="bentml-status"></span>
            </div>
            <textarea id="bentml-live-output" dir="ltr" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" wrap="off" aria-label="Live BenTML source"></textarea>
          </div>
        </div>

        <aside class="properties" aria-label="הגדרות מודול">
          <div class="props-head-row">
            <h4>הגדרות</h4>
            <button type="button" id="props-close" class="props-close" aria-label="סגור הגדרות">✕</button>
          </div>
          <div id="properties-panel">
            <div class="props-empty">
              בחרו מודול בדף · ההגדרות יופיעו כאן<br>
              <span style="font-size:0.8rem">לחצו על טקסט בדף כדי לכתוב · תיהנו מהזרימה ✨</span>
            </div>
          </div>
        </aside>

        <div id="builder-pane-source" class="builder-pane" hidden>
          <div class="bentml-source-bar">
            <strong>פלט BenTML (מסך מלא)</strong>
            <span style="color:#64748b;font-size:0.85rem">decompile ← בונה · compile → בונה</span>
            <button type="button" class="btn secondary" id="btn-bentml-sync">רענן מהדף</button>
            <button type="button" class="btn secondary" id="btn-bentml-copy">העתק</button>
            <button type="button" class="btn" id="btn-bentml-apply">החל פלט → דף</button>
            <span id="bentml-source-status" class="bentml-status"></span>
          </div>
          <p class="output-explain">
            זה לא ״ייבוא בלבד״. <strong>כל גרירה ועריכה בבונה מייצרת מחדש את הקוד</strong> לפי כללי BenTML —
            וכל הקלדה כאן מקומפלת חיה ומוחלת לדף. שגיאה מצביעה על השורה המדויקת + תיקון.
            אפשר גם להדביק מסמך שלם.
          </p>
          <textarea id="bentml-source" spellcheck="false" dir="ltr" autocomplete="off" autocorrect="off" autocapitalize="off" wrap="off" aria-label="BenTML source" placeholder="BENTML 0.1&#10;&#10;META {&#10;  title: &quot;...&quot;&#10;}&#10;&#10;TEXT { ... }"></textarea>
        </div>
      </div>
    </div>

    <div class="save-bar">
      <div class="container" style="display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap">
        <button type="button" onclick="TapuzBuilder.savePage()" class="btn">שמור טיוטה</button>
        <button type="button" onclick="TapuzBuilder.publishPage()" class="btn js-publish-btn publish" data-publish-main="1">פרסם</button>
        <button type="button" onclick="TapuzBuilder.publishAndBuild()" class="btn js-publish-btn publish-build">פרסם + בנה אתר</button>
      </div>
    </div>

    <div id="media-modal" class="modal" onclick="if (event.target.id === 'media-modal') TapuzBuilder.closeMediaLibrary()">
      <div class="modal-content media-modal-content" onclick="event.stopPropagation()">
        <h3 class="sub-head">🗂 ספריית המדיה</h3>
        <div id="media-list"></div>
        <div class="media-modal-foot">
          <button type="button" class="btn secondary" onclick="TapuzBuilder.closeMediaLibrary()">סגור</button>
          <label class="btn" style="cursor:pointer">⬆ העלאת תמונות
            <input id="media-upload-input" type="file" accept="image/*" multiple style="display:none" onchange="TapuzBuilder.uploadMedia(this)">
          </label>
        </div>
      </div>
    </div>

    <div id="pages-nav-modal" class="modal" onclick="if (event.target.id === 'pages-nav-modal') TapuzBuilder.closePagesNav()">
      <div class="modal-content" style="max-width:560px" onclick="event.stopPropagation()">
        <h3 class="sub-head">ניווט דפים</h3>
        <input id="pages-nav-search" type="search" placeholder="חיפוש לפי כותרת או נתיב..." style="width:100%;padding:10px 12px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:12px">
        <div id="pages-nav-list" style="max-height:420px;overflow:auto"></div>
        <div style="margin-top:14px;display:flex;justify-content:space-between;gap:10px">
          <a href="/admin/new" class="btn">+ דף חדש</a>
          <button type="button" class="btn secondary" onclick="TapuzBuilder.closePagesNav()">סגור</button>
        </div>
      </div>
    </div>

    <div id="revisions-modal" class="modal" onclick="if (event.target.id === 'revisions-modal') TapuzBuilder.closeRevisions()">
      <div class="modal-content" style="max-width:560px" onclick="event.stopPropagation()">
        <h3 class="sub-head">היסטוריית גרסאות</h3>
        <p class="lead">שמירה אוטומטית בכל שמירה/פרסום. שחזור מעתיק לטיוטה בלבד.</p>
        <div id="revisions-list" style="max-height:420px;overflow:auto"></div>
        <div style="margin-top:14px;text-align:left">
          <button type="button" class="btn secondary" onclick="TapuzBuilder.closeRevisions()">סגור</button>
        </div>
      </div>
    </div>

    <script>
      // Block registry — the client generates the settings forms from this
      window.__TAPUZ_REGISTRY__ = ${jsonForScript({
        blocks: blockRegistry.BLOCK_REGISTRY,
        categories: blockRegistry.BLOCK_CATEGORIES,
        universalParams: blockRegistry.UNIVERSAL_PARAMS
      })};
    </script>
    <script src="/admin-builder.js"></script>
    <script src="/admin/bentml-engine.js"></script>
    <script src="/admin-bentml-ui.js"></script>
    <script src="/admin-builder-tour.js"></script>
    <script src="/admin-prompt-builder.js"></script>
    <script>
      TapuzBuilder.init({
        fullPath: ${jsonForScript(page.full_path)},
        slug: ${jsonForScript(page.slug || page.full_path)},
        blocks: ${initialBlocks},
        status: ${jsonForScript(page.status || 'draft')},
        hasUnpublished: ${hasUnpublished ? 'true' : 'false'},
        direction: ${jsonForScript(pageDirection)},
        tags: ${jsonForScript(page.tags || [])},
        meta: ${jsonForScript(page.meta || {})}
      });
    </script>
    <script>
      (function () {
        // Advanced toggle: reveal the BenTML code view (tab + live dock). Off by
        // default and remembered, so customers get the clean visual builder.
        var root = document.getElementById('builder-root');
        var btn = document.getElementById('btn-toggle-advanced');
        if (!root || !btn) return;
        var on = false;
        try { on = localStorage.getItem('tapuz-advanced') === 'on'; } catch (e) {}
        function apply() {
          root.classList.toggle('adv-off', !on);
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
          btn.textContent = on ? '⚙ מתקדם ✓' : '⚙ מתקדם';
        }
        apply();
        btn.addEventListener('click', function () {
          on = !on;
          try { localStorage.setItem('tapuz-advanced', on ? 'on' : 'off'); } catch (e) {}
          // leaving advanced while viewing the code → back to the visual page
          if (!on && window.BentmlUI && window.BentmlUI.setMode) window.BentmlUI.setMode('page');
          apply();
        });
      })();
    </script>
  `;
  res.send(layout(html, 'עריכה • ' + page.title, accentFor('pages'), { bodyClass: 'builder-screen' }));
});

router.post('/admin/save', (req, res) => {
  try {
    const { full_path, title, blocks, tags, meta, publish, slug } = req.body || {};
    const updates = { title, blocks, publish: !!publish };
    if (Array.isArray(tags)) updates.tags = tags;
    if (meta && typeof meta === 'object') updates.meta = meta;
    // Slug rename (v0.51): auto-follows the page title. A taken address must
    // NEVER block the content save — skip only the rename and flag it, so the
    // page's edits always persist. updatePage handles the .pzn/file rename.
    let slugRejected = false;
    if (typeof slug === 'string' && slug.trim()) {
      const existing = getPageByFullPath(full_path);
      const desired = existing ? generateFullPath(existing.path_prefix || '', slug.trim()) : null;
      if (desired && desired !== full_path) {
        if (getPageByFullPath(desired)) slugRejected = true;
        else updates.slug = slug.trim();
      }
    }
    const page = updatePage(full_path, updates);
    const hasUnpublished = JSON.stringify(page.draft_blocks || []) !== JSON.stringify(page.blocks || []);
    res.json({
      ok: true,
      status: page.status,
      hasUnpublished,
      full_path: page.full_path,
      slugRejected
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/publish', (req, res) => {
  try {
    const { full_path, title, blocks, tags, meta } = req.body || {};
    const updates = {};
    if (title) updates.title = title;
    if (blocks) updates.blocks = blocks;
    if (Array.isArray(tags)) updates.tags = tags;
    if (meta && typeof meta === 'object') updates.meta = meta;
    if (Object.keys(updates).length) {
      updatePage(full_path, updates);
    }
    const page = publishPage(full_path);
    // publish MEANS live (v0.69): the static site is rebuilt right here — the
    // admin never needed to know a separate "build" step existed to see the page
    exportAll();
    // homepage state rides along (v0.78): the builder offers one-click
    // crowning when the site root would otherwise 404
    const cfg = loadConfig();
    const homePath = require('../seo').resolveHomePath(
      listPages({ status: 'published' }), cfg.homepage
    );
    res.json({
      ok: true,
      status: page.status,
      hasUnpublished: false,
      full_path: page.full_path,
      liveUrl: '/' + page.full_path,
      homePath,
      homeIsExplicit: !!(cfg.homepage && homePath === cfg.homepage)
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/build', (req, res) => {
  try {
    const results = exportAll();
    res.json({ ok: true, count: results.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
