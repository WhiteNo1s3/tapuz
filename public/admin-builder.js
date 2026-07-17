/* Tapuz Visual Canvas Builder
 * Stacked blocks by default.
 * Drop BETWEEN blocks = reorder/insert.
 * Drop BESIDE a block = auto-split into columns.
 */
(function () {
  'use strict';

  var blocks = [];
  var selectedId = null;
  var currentPageFullPath = '';
  var currentSlug = '';        // page address; auto-follows the title until edited
  var slugTouched = false;     // true once the user edits the slug by hand
  var currentMediaTarget = null;
  var pageTags = [];
  var pageMeta = {};

  /** Slugify a title into a URL address: spaces → dashes, drop path-dangerous
   *  chars, keep Hebrew. Mirrors the server's deriveSlug so both agree. */
  function slugify(v) {
    return String(v || '').trim()
      .replace(/\s+/g, '-')
      .replace(/[\\/:*?"<>|#]/g, '')
      .replace(/\.\.+/g, '.')
      .replace(/^\.+/, '')
      .slice(0, 80);
  }
  var pageDirection = 'rtl'; // direction of the PAGE being edited (not the admin)
  var dragState = null; // { kind:'toolbox'|'block', blockType?, blockId? }
  var dropHint = null; // { mode:'insert'|'split', ... }
  var dropInProgress = false;

  /**
   * Module catalog — mirrors src/block-registry.js (syntax dictionary).
   * TEXT is the only advanced body container; others stay sharp + featureful.
   */
  var MODULES = [
    { type: 'hero', label: 'Hero', hint: 'פתיח עם רקע', icon: '★', group: 'תוכן', keyword: 'HERO' },
    { type: 'heading', label: 'כותרת', hint: 'H1–H6', icon: 'H', group: 'תוכן', keyword: 'HEADING' },
    { type: 'text', label: 'טקסט', hint: 'מיכל מתקדם · @B @LINK', icon: '¶', group: 'תוכן', keyword: 'TEXT', advanced: true },
    { type: 'button', label: 'כפתור', hint: 'CTA', icon: '◉', group: 'תוכן', keyword: 'BUTTON' },
    { type: 'quote', label: 'ציטוט', hint: 'ציטוט מובלט', icon: '❞', group: 'תוכן', keyword: 'QUOTE' },
    { type: 'testimonial', label: 'המלצה', hint: 'ציטוט + שם', icon: '❝', group: 'תוכן', keyword: 'TESTIMONIAL' },
    { type: 'list', label: 'רשימה', hint: 'נקודות / מספרים', icon: '≡', group: 'תוכן', keyword: 'LIST' },
    { type: 'features', label: 'תכונות', hint: 'כרטיסי יתרונות', icon: '▦', group: 'תוכן', keyword: 'FEATURES' },
    { type: 'article-list', label: 'מאמרים', hint: 'קוביות דינמיות', icon: '⊞', group: 'תוכן', keyword: 'ARTICLES' },
    { type: 'image', label: 'תמונה', hint: 'מדיה + כיתוב', icon: '▣', group: 'מדיה', keyword: 'IMAGE' },
    { type: 'gallery', label: 'גלריה', hint: 'רשת תמונות', icon: '▤', group: 'מדיה', keyword: 'GALLERY' },
    { type: 'embed', label: 'וידאו', hint: 'YouTube', icon: '▶', group: 'מדיה', keyword: 'EMBED' },
    { type: 'map', label: 'מפה', hint: 'Google Maps', icon: '📍', group: 'מדיה', keyword: 'MAP' },
    { type: 'cta', label: 'CTA', hint: 'קריאה לפעולה', icon: '➤', group: 'תוכן', keyword: 'CTA' },
    { type: 'stats', label: 'מדדים', hint: 'מספרים', icon: '＃', group: 'תוכן', keyword: 'STATS' },
    { type: 'faq', label: 'שאלות', hint: 'FAQ', icon: '?', group: 'תוכן', keyword: 'FAQ' },
    { type: 'banner', label: 'באנר', hint: 'הודעה', icon: '▬', group: 'מבנה', keyword: 'BANNER' },
    { type: 'columns', label: 'עמודות', hint: 'מכולות + resize', icon: '▥', group: 'מבנה', keyword: 'ROW' },
    { type: 'card', label: 'כרטיס', hint: 'קופסת מודולים', icon: '▢', group: 'מבנה', keyword: 'CARD' },
    { type: 'spacer', label: 'רווח', hint: 'sm–xl', icon: '↕', group: 'מבנה', keyword: 'SPACE' },
    { type: 'divider', label: 'קו מפריד', hint: 'line/dots', icon: '—', group: 'מבנה', keyword: 'DIVIDER' },
    { type: 'logos', label: 'לוגואים', hint: 'לקוחות', icon: '▣▣', group: 'מדיה', keyword: 'LOGOS' },
    { type: 'contact-info', label: 'קשר', hint: 'טלפון/מייל', icon: '☎', group: 'מדיה', keyword: 'CONTACT' }
  ];

  /**
   * Block registry (ask C) — injected by the server from src/block-registry.js
   * (window.__TAPUZ_REGISTRY__, also served at GET /admin/api/registry).
   * When present it becomes the single source of truth: the MODULES catalog,
   * BenTML keywords, defaults and the settings forms are all GENERATED from
   * it. The hardcoded MODULES above is only a fallback for older servers.
   */
  var REG = (window.__TAPUZ_REGISTRY__ && Array.isArray(window.__TAPUZ_REGISTRY__.blocks))
    ? window.__TAPUZ_REGISTRY__
    : null;
  var REG_BY_TYPE = {};
  if (REG) {
    REG.blocks.forEach(function (e) { REG_BY_TYPE[e.type] = e; });
    MODULES = REG.blocks.map(function (e) {
      return {
        type: e.type,
        label: e.labelHe || e.type,
        hint: e.hintHe || '',
        icon: e.icon || '•',
        group: e.category || 'תוכן',
        keyword: e.keyword || String(e.type).toUpperCase(),
        advanced: e.type === 'text'
      };
    });
  }

  function registryDef(type) {
    return REG_BY_TYPE[type] || null;
  }

  /**
   * Container classification — registry-driven off `childrenKey`
   * (src/block-registry.js). Two container shapes exist:
   *   - 'blocks'  → data.blocks is a flat block list   (card, parallax)
   *   - 'columns' → data.columns is [{blocks:[]}]       (ROW)
   * Adding a new nesting block = one registry entry with childrenKey; no
   * per-type client edits. FALLBACK_CHILDREN_KEY keeps the known containers
   * working on older servers that don't inject window.__TAPUZ_REGISTRY__.
   */
  var FALLBACK_CHILDREN_KEY = { card: 'blocks', parallax: 'blocks', columns: 'columns' };

  function childrenKeyFor(type) {
    var def = registryDef(type);
    if (def && def.childrenKey) return def.childrenKey;
    return FALLBACK_CHILDREN_KEY[type] || null;
  }

  /** True for containers whose children live in a single data.blocks list. */
  function isBlocksContainer(type) {
    return childrenKeyFor(type) === 'blocks';
  }

  /** True for the columns container (data.columns = [{blocks:[]}]). */
  function isColumnsContainer(type) {
    return childrenKeyFor(type) === 'columns';
  }

  /** Ensure a blocks-container has a live data.blocks array and return it. */
  function ensureBlocks(block) {
    if (!block.data) block.data = {};
    if (!Array.isArray(block.data.blocks)) block.data.blocks = [];
    return block.data.blocks;
  }

  function paramDefFor(type, key) {
    var def = registryDef(type);
    if (!def) return null;
    var ps = def.params || [];
    for (var i = 0; i < ps.length; i++) {
      if (ps[i].name === key) return ps[i];
    }
    return null;
  }

  /** Hebrew labels for common enum values in generated selects. */
  var ENUM_LABELS = {
    start: 'התחלה', center: 'מרכז', end: 'סוף',
    sm: 'קטן', md: 'בינוני', lg: 'גדול', xl: 'ענק', full: 'מלא / מסך מלא',
    primary: 'ראשי', secondary: 'משני', outline: 'מתאר',
    line: 'קו', dots: 'נקודות', thick: 'עבה',
    none: 'ללא', never: 'אף פעם',
    top: 'למעלה', bottom: 'למטה', stretch: 'מתיחה (גובה אחיד)'
  };
  function enumLabel(v) { return ENUM_LABELS[v] || String(v); }

  var SPACER_HEIGHTS = { sm: '0.75rem', md: '1.5rem', lg: '2.5rem', xl: '4rem' };

  var MODULE_BY_TYPE = {};
  MODULES.forEach(function (m) { MODULE_BY_TYPE[m.type] = m; });

  function typeLabel(type) {
    return (MODULE_BY_TYPE[type] && MODULE_BY_TYPE[type].label) || type || '?';
  }

  function typeIcon(type) {
    return (MODULE_BY_TYPE[type] && MODULE_BY_TYPE[type].icon) || '•';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;');
  }

  function cssEsc(s) {
    if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(String(s));
    return String(s).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  }

  function uid(type) {
    return (type || 'block') + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  }

  function isRtl() {
    var el = document.documentElement;
    return (el.getAttribute('dir') || el.dir || 'rtl') === 'rtl';
  }

  // ---- Nested tree helpers ----

  function ensureColumns(block) {
    if (!block.data) block.data = {};
    if (!Array.isArray(block.data.columns) || !block.data.columns.length) {
      block.data.columns = [{ blocks: [] }, { blocks: [] }];
    }
    block.data.columns.forEach(function (col) {
      if (!Array.isArray(col.blocks)) col.blocks = [];
    });
    return block.data.columns;
  }

  /** Find block by id. Returns { block, list, index, parent, colIndex } */
  function findNode(id, list, parent, colIndex) {
    list = list || blocks;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.id === id) {
        return {
          block: b,
          list: list,
          index: i,
          parent: parent || null,
          colIndex: colIndex == null ? null : colIndex
        };
      }
      if (isColumnsContainer(b.type)) {
        var cols = ensureColumns(b);
        for (var c = 0; c < cols.length; c++) {
          var found = findNode(id, cols[c].blocks, b, c);
          if (found) return found;
        }
      }
      if (isBlocksContainer(b.type)) {
        var foundInner = findNode(id, ensureBlocks(b), b, 'blocks');
        if (foundInner) return foundInner;
      }
    }
    return null;
  }

  function getBlock(id) {
    var n = findNode(id);
    return n ? n.block : null;
  }

  function countAllBlocks(list) {
    list = list || blocks;
    var n = 0;
    list.forEach(function (b) {
      n += 1;
      if (isColumnsContainer(b.type)) {
        ensureColumns(b).forEach(function (col) {
          n += countAllBlocks(col.blocks);
        });
      }
      if (isBlocksContainer(b.type)) {
        n += countAllBlocks(ensureBlocks(b));
      }
    });
    return n;
  }

  function isAncestor(maybeAncestorId, nodeId) {
    var n = findNode(nodeId);
    while (n && n.parent) {
      if (n.parent.id === maybeAncestorId) return true;
      n = findNode(n.parent.id);
    }
    return false;
  }

  function removeNode(id) {
    var n = findNode(id);
    if (!n) return null;
    return n.list.splice(n.index, 1)[0];
  }

  function snapshotTree() {
    return JSON.parse(JSON.stringify(blocks));
  }

  function restoreTree(snap) {
    blocks = snap || [];
  }

  // ---- History / dirty state / autosave ----

  var undoStack = [];
  var redoStack = [];
  var MAX_HISTORY = 60;
  var isDirty = false;
  var autosaveTimer = null;

  function pushHistorySnapshot(snap) {
    undoStack.push(snap);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    markDirty();
    updateHeaderExtras();
  }

  function pushHistory() {
    pushHistorySnapshot(snapshotTree());
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshotTree());
    restoreTree(undoStack.pop());
    if (selectedId && !getBlock(selectedId)) selectedId = null;
    markDirty();
    renderCanvas();
    renderProperties();
    syncToolboxMode();
    flashCanvasHint('בוטל ↩');
    updateHeaderExtras();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshotTree());
    restoreTree(redoStack.pop());
    if (selectedId && !getBlock(selectedId)) selectedId = null;
    markDirty();
    renderCanvas();
    renderProperties();
    syncToolboxMode();
    flashCanvasHint('בוצע שוב ↪');
    updateHeaderExtras();
  }

  function markDirty() {
    isDirty = true;
    scheduleAutosave();
    updateHeaderExtras();
    // Live BenTML output (closed-loop language) — not just import
    if (window.BentmlUI && typeof window.BentmlUI.onBuilderChange === 'function') {
      window.BentmlUI.onBuilderChange();
    }
  }

  function markSaved() {
    isDirty = false;
    updateHeaderExtras();
  }

  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () {
      if (isDirty && currentPageFullPath) savePage({ silent: true });
    }, 2500);
  }

  /**
   * Dirty-state publish (ask E): draft ≠ published is the real "needs publish"
   * signal — autosave clears isDirty within seconds, so the publish buttons key
   * off hasUnpublishedState (kept in sync from every /admin/save response)
   * OR isDirty (edits not yet autosaved).
   */
  var hasUnpublishedState = false;

  function updateHeaderExtras() {
    var u = document.getElementById('btn-undo');
    var r = document.getElementById('btn-redo');
    var d = document.getElementById('dirty-dot');
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
    if (d) {
      d.classList.toggle('on', isDirty);
      d.title = isDirty ? 'שינויים לא שמורים' : 'הכל שמור';
    }
    var pending = isDirty || hasUnpublishedState;
    document.querySelectorAll('.js-publish-btn').forEach(function (btn) {
      btn.classList.toggle('is-dirty', pending);
      btn.classList.toggle('is-clean', !pending);
      btn.disabled = !pending;
      btn.title = pending ? 'יש שינויים שלא פורסמו' : 'אין שינויים לפרסום';
      if (btn.hasAttribute('data-publish-main')) {
        btn.textContent = pending ? 'פרסם שינויים' : 'פרסם';
      }
    });
  }

  function ensureUiExtras() {
    if (document.getElementById('tapuz-toasts')) return;

    var style = document.createElement('style');
    style.textContent =
      '#history-controls{display:inline-flex;gap:6px;align-items:center;margin-inline-start:8px}' +
      '#history-controls button{border:1px solid var(--bc-border,#2a3a5c);background:var(--bc-panel-2,#1a243c);color:var(--bc-text,#e8eefc);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:1rem;font-weight:600;transition:border-color .15s,transform .15s}' +
      '#history-controls button:hover:not(:disabled){border-color:var(--accent,#f97316);transform:translateY(-1px)}' +
      '#history-controls button:disabled{opacity:0.35;cursor:default}' +
      '#dirty-dot{width:9px;height:9px;border-radius:50%;background:#475569;display:inline-block;margin-inline-start:6px;transition:background .2s}' +
      '#dirty-dot.on{background:#f59e0b;box-shadow:0 0 8px rgba(245,158,11,.6)}' +
      '#tapuz-toasts{position:fixed;bottom:18px;inset-inline-start:18px;z-index:9999;display:flex;flex-direction:column;gap:8px}' +
      '.tapuz-toast{display:flex;align-items:center;gap:10px;background:#0f172a;color:#fff;padding:10px 16px;border-radius:10px;font-size:0.9rem;box-shadow:0 6px 20px rgba(0,0,0,0.25);opacity:0;transform:translateY(8px);transition:all .25s}' +
      '.tapuz-toast .toast-action{border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:#fff;border-radius:7px;padding:3px 10px;cursor:pointer;font:inherit;font-size:.85rem;font-weight:700}' +
      '.tapuz-toast .toast-action:hover{background:rgba(255,255,255,.25)}' +
      '.tapuz-toast.show{opacity:1;transform:none}' +
      '.tapuz-toast.ok{background:#166534}' +
      '.tapuz-toast.err{background:#b91c1c}' +
      '.preview-embed{position:relative;display:inline-block}' +
      '.embed-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:2rem;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,0.6);pointer-events:none}' +
      '.check-line{display:flex;gap:6px;align-items:center;font-size:0.9rem;color:inherit}' +
      '.media-explorer{display:flex;flex-direction:column;gap:10px;flex:1;min-height:0}' +
      '.media-bar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;border-bottom:1px solid #e2e8f0;padding-bottom:8px}' +
      '.media-crumbs{font-size:0.9rem;color:#334155}' +
      '.crumb{cursor:pointer;padding:2px 4px;border-radius:4px}' +
      '.crumb:hover{background:#eff6ff;color:#0a66c2}' +
      '.media-actions{display:flex;gap:6px;flex-wrap:wrap}' +
      '.mbtn{border:1px solid #e2e8f0;background:#fff;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:0.85rem}' +
      '.mbtn:hover{background:#f8fafc}' +
      '.mbtn-primary{background:#0a66c2;border-color:#0a66c2;color:#fff}' +
      '.media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(136px,1fr));gap:12px;flex:1;min-height:0;overflow:auto;align-content:start;padding:2px}' +
      '.media-tile{border:1px solid #e2e8f0;border-radius:10px;padding:8px;cursor:pointer;text-align:center;background:#fff;user-select:none}' +
      '.media-tile:hover{border-color:#93c5fd;background:#f8fafc;box-shadow:0 4px 12px rgba(15,23,42,.08)}' +
      '.media-tile img{width:100%;height:104px;object-fit:cover;border-radius:6px}' +
      '.media-folder .tile-icon{font-size:3rem;line-height:104px;height:104px}' +
      '.media-name{font-size:0.74rem;color:#475569;margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.tile-selected{outline:3px solid #0a66c2;outline-offset:-1px;background:#eff6ff}' +
      '.media-empty{grid-column:1/-1;color:#64748b;padding:40px 20px;text-align:center;font-size:0.95rem}' +
      '#tapuz-ctx{position:fixed;z-index:10000;background:#fff;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 10px 30px rgba(15,23,42,0.2);min-width:170px;padding:4px;display:flex;flex-direction:column}' +
      '.ctx-item{background:none;border:none;text-align:start;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:0.9rem;color:#0f172a}' +
      '.ctx-item:hover{background:#f1f5f9}' +
      '.ctx-danger{color:#b91c1c}' +
      '.ctx-danger:hover{background:#fef2f2}' +
      '.preview-gallery{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;position:relative}' +
      '.preview-gallery img{width:100%;height:64px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0}' +
      '.gallery-more{position:absolute;bottom:6px;inset-inline-end:6px;background:rgba(15,23,42,0.75);color:#fff;border-radius:6px;padding:2px 8px;font-size:0.8rem}' +
      '.gallery-edit{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:6px}' +
      '.gallery-thumb{position:relative}' +
      '.gallery-thumb img{width:100%;height:56px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0}' +
      '.gallery-thumb button{position:absolute;top:2px;inset-inline-end:2px;border:none;background:rgba(185,28,28,0.9);color:#fff;border-radius:50%;width:18px;height:18px;line-height:1;cursor:pointer;font-size:0.75rem}';
    document.head.appendChild(style);

    var toasts = document.createElement('div');
    toasts.id = 'tapuz-toasts';
    document.body.appendChild(toasts);

    // undo/redo live in the TOPBAR — always visible, never a hidden trick
    var header = document.querySelector('.topbar-left') || document.querySelector('.canvas-header');
    if (header && !document.getElementById('history-controls')) {
      var wrap = document.createElement('span');
      wrap.id = 'history-controls';
      wrap.innerHTML =
        '<button type="button" id="btn-undo" title="בטל (Ctrl+Z)">↩ בטל</button>' +
        '<button type="button" id="btn-redo" title="בצע שוב (Ctrl+Shift+Z)">↪</button>' +
        '<span id="dirty-dot" title="שינויים שלא נשמרו"></span>';
      header.appendChild(wrap);
      document.getElementById('btn-undo').addEventListener('click', undo);
      document.getElementById('btn-redo').addEventListener('click', redo);
    }

    var titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.addEventListener('input', markDirty);
    var statusEl = document.getElementById('page-status');
    if (statusEl) statusEl.addEventListener('change', markDirty);

    // responsive drawers: toolbox bottom sheet + settings slide-over
    var toolboxHandle = document.getElementById('toolbox-handle');
    if (toolboxHandle) {
      toolboxHandle.addEventListener('click', function () {
        document.body.classList.toggle('toolbox-open');
      });
    }
    var propsClose = document.getElementById('props-close');
    if (propsClose) {
      propsClose.addEventListener('click', function () {
        document.body.classList.remove('props-open');
      });
    }
    var pagePropsBtn = document.getElementById('btn-page-props');
    if (pagePropsBtn) {
      pagePropsBtn.addEventListener('click', function () {
        selectedId = null;
        renderCanvas();
        renderProperties();
        document.body.classList.add('props-open');
      });
    }

    window.addEventListener('beforeunload', function (e) {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  function showToast(msg, kind, action) {
    var host = document.getElementById('tapuz-toasts');
    if (!host) return;
    var t = document.createElement('div');
    t.className = 'tapuz-toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    // destructive actions carry their own inline undo — cancel without
    // knowing Ctrl+Z exists
    if (action && action.label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'toast-action';
      b.textContent = action.label;
      b.addEventListener('click', function () {
        try { action.onClick(); } finally {
          t.classList.remove('show');
          setTimeout(function () { t.remove(); }, 300);
        }
      });
      t.appendChild(b);
    }
    host.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 300);
    }, action ? 5200 : 2800);
  }

  /** Cached article fetch for the article-list canvas preview. */
  var articlesPreviewCache = {}; // key -> { at, articles }
  function fetchArticlesPreview(tag, limit, cb) {
    var key = tag + '|' + limit;
    var hit = articlesPreviewCache[key];
    if (hit && Date.now() - hit.at < 15000) { cb(hit.articles); return; }
    fetch('/admin/api/articles?tag=' + encodeURIComponent(tag) + '&limit=' + encodeURIComponent(limit))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var articles = (data && data.articles) || [];
        articlesPreviewCache[key] = { at: Date.now(), articles: articles };
        cb(articles);
      })
      .catch(function () { cb(hit ? hit.articles : []); });
  }

  /** Cached one-shot categories fetch (v0.64) — page props + category preview. */
  var categoriesCache = null; // { at, cats }
  function loadCategoriesOnce(cb) {
    if (categoriesCache && Date.now() - categoriesCache.at < 15000) { cb(categoriesCache.cats); return; }
    fetch('/admin/api/categories')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var cats = (data && data.categories) || [];
        categoriesCache = { at: Date.now(), cats: cats };
        cb(cats);
      })
      .catch(function () { cb(categoriesCache ? categoriesCache.cats : []); });
  }

  /** Normalized src of a media list entry ('' when the slot is empty). */
  function mediaSrcOf(im) {
    var src = typeof im === 'string' ? im : ((im && im.src) || '');
    return String(src).trim();
  }

  /** Drop empty entries from a media list (imports leave blank slots). */
  function filledMedia(list) {
    return (Array.isArray(list) ? list : []).filter(function (im) { return mediaSrcOf(im); });
  }

  function youtubeId(url) {
    var m = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/);
    return m ? m[1] : null;
  }

  /** Live list only — never trust a list reference captured at render time. */
  function getLiveList(parentId, colIndex) {
    if (!parentId) return blocks;
    var parent = getBlock(parentId);
    if (!parent) return null;
    if (isBlocksContainer(parent.type)) {
      return ensureBlocks(parent);
    }
    if (!isColumnsContainer(parent.type)) return null;
    var cols = ensureColumns(parent);
    var ci = colIndex == null ? 0 : parseInt(colIndex, 10) || 0;
    while (cols.length <= ci) cols.push({ blocks: [] });
    if (!Array.isArray(cols[ci].blocks)) cols[ci].blocks = [];
    return cols[ci].blocks;
  }

  function containsId(rootBlock, id) {
    if (!rootBlock) return false;
    if (rootBlock.id === id) return true;
    if (isBlocksContainer(rootBlock.type) && rootBlock.data && Array.isArray(rootBlock.data.blocks)) {
      for (var j = 0; j < rootBlock.data.blocks.length; j++) {
        if (containsId(rootBlock.data.blocks[j], id)) return true;
      }
    }
    if (!isColumnsContainer(rootBlock.type)) return false;
    var cols = ensureColumns(rootBlock);
    for (var c = 0; c < cols.length; c++) {
      var kids = cols[c].blocks || [];
      for (var i = 0; i < kids.length; i++) {
        if (containsId(kids[i], id)) return true;
      }
    }
    return false;
  }

  /** Would placing `incoming` under parentId put it inside itself? */
  function wouldNestIntoSelf(incoming, parentId) {
    if (!incoming || !parentId) return false;
    if (incoming.id === parentId) return true;
    return containsId(incoming, parentId);
  }

  // ---- Block factory + smart replace ----

  function defaultData(type) {
    if (type === 'hero') return { title: 'כותרת ראשית', subtitle: '', buttonText: '', buttonUrl: '', height: 'md' };
    if (type === 'heading') return { text: 'כותרת', level: 2 };
    if (type === 'text') {
      return {
        content: 'טקסט חדש...\n\nשורה ריקה = פסקה. אפשר @B{הדגשה} ו-@LINK(url: "/x"){קישור}.',
        size: 'md'
      };
    }
    if (type === 'button') return { text: 'לחץ כאן', url: '#', variant: 'primary' };
    if (type === 'spacer') return { size: 'md', height: '1.5rem' };
    if (type === 'columns') return { columns: [{ blocks: [] }, { blocks: [] }], gap: 'md' };
    if (type === 'image') return { src: '', alt: '', caption: '', width: 'full' };
    if (type === 'testimonial') return { quote: '', author: '', role: '' };
    if (type === 'quote') return { text: '', author: '' };
    if (type === 'divider') return { style: 'solid', bentStyle: 'line' };
    if (type === 'features') return { items: [{ title: 'פריט', description: '', icon: '' }], columns: 3 };
    if (type === 'list') return { items: [{ text: 'פריט ראשון' }], ordered: false };
    if (type === 'gallery') return { images: [], columns: 3 };
    if (type === 'embed') return { url: '' };
    if (type === 'article-list') return { tag: 'article', limit: 6, columns: 3 };
    if (type === 'card') return { blocks: [] };
    if (type === 'map') return { address: '', zoom: 15, height: 'md' };
    // NEW types that exist only in the registry: derive defaults from schema
    // (param defaults minus omitDefault, merged with the Hebrew seed) — adding
    // a block type = adding one registry entry, no client edits needed.
    var def = registryDef(type);
    if (def) {
      var data = {};
      (def.params || []).forEach(function (p) {
        if (p.omitDefault) return;
        if (p.default !== undefined) data[p.name] = JSON.parse(JSON.stringify(p.default));
      });
      if (def.seed) {
        Object.keys(def.seed).forEach(function (k) {
          data[k] = JSON.parse(JSON.stringify(def.seed[k]));
        });
      }
      return data;
    }
    return {};
  }

  function makeBlock(type) {
    return { type: type, id: uid(type), data: defaultData(type) };
  }

  /** Pull free text / media from any block for soft-migration on replace. */
  function extractSoftFields(block) {
    var d = (block && block.data) || {};
    var text =
      d.title ||
      d.text ||
      d.content ||
      d.quote ||
      d.subtitle ||
      (d.items && d.items[0] && (typeof d.items[0] === 'string' ? d.items[0] : (d.items[0].title || d.items[0].description))) ||
      '';
    var secondary =
      d.subtitle ||
      d.author ||
      d.description ||
      (d.items && d.items[0] && d.items[0].description) ||
      '';
    return {
      text: String(text || '').trim(),
      secondary: String(secondary || '').trim(),
      src: d.src || (d.images && d.images[0] && (typeof d.images[0] === 'string' ? d.images[0] : d.images[0].src)) || '',
      alt: d.alt || '',
      url: d.url || d.buttonUrl || '',
      className: d.className || '',
      id: d.id || '',
      columns: block && block.type === 'columns' ? ensureColumns(block) : null
    };
  }

  function applySoftFields(type, soft) {
    var data = defaultData(type);
    soft = soft || {};
    if (soft.className) data.className = soft.className;
    if (soft.id) data.id = soft.id;

    if (type === 'hero') {
      if (soft.text) data.title = soft.text;
      if (soft.secondary) data.subtitle = soft.secondary;
    } else if (type === 'heading') {
      if (soft.text) data.text = soft.text;
    } else if (type === 'text') {
      if (soft.text) data.content = soft.text;
      else if (soft.secondary) data.content = soft.secondary;
    } else if (type === 'button') {
      if (soft.text) data.text = soft.text.slice(0, 80);
      if (soft.url) data.url = soft.url;
    } else if (type === 'image') {
      if (soft.src) data.src = soft.src;
      if (soft.alt || soft.text) data.alt = soft.alt || soft.text.slice(0, 120);
    } else if (type === 'testimonial') {
      if (soft.text) data.quote = soft.text;
      if (soft.secondary) data.author = soft.secondary;
    } else if (type === 'features') {
      if (soft.text) {
        data.items = [{ title: soft.text.slice(0, 80), description: soft.secondary || '' }];
      }
    } else if (type === 'list') {
      if (soft.text) {
        data.items = soft.secondary ? [soft.text, soft.secondary] : [soft.text];
      }
    } else if (type === 'embed') {
      if (soft.url) data.url = soft.url;
    } else if (type === 'gallery') {
      if (soft.src) data.images = [{ src: soft.src, alt: soft.alt || '' }];
    } else if (type === 'columns') {
      // Keep nested structure when replacing columns→columns; otherwise empty 2-col
      if (soft.columns && soft.columns.length) {
        data.columns = soft.columns.map(function (col) {
          return { blocks: (col.blocks || []).slice() };
        });
      }
    }
    return data;
  }

  /**
   * Replace module type in place (same id + tree position).
   * Soft-migrates text/media/class/id so content isn't wiped blindly.
   */
  function replaceBlockType(id, newType) {
    if (!id || !newType) return false;
    var node = findNode(id);
    if (!node) return false;
    var block = node.block;
    if (block.type === newType) return true;

    // Protect nested content: columns → non-columns needs confirm if children exist
    if (block.type === 'columns' && newType !== 'columns') {
      var childCount = 0;
      ensureColumns(block).forEach(function (col) {
        childCount += (col.blocks || []).length;
      });
      if (childCount > 0) {
        var ok = window.confirm(
          'במודול יש ' + childCount + ' מודולים פנימיים.\n' +
          'להחליף ל«' + typeLabel(newType) + '»? התוכן הפנימי יימחק.'
        );
        if (!ok) return false;
      }
    }

    pushHistory();
    var soft = extractSoftFields(block);
    // If converting *to* columns from a content block, put old block as left col
    if (newType === 'columns' && block.type !== 'columns') {
      var kept = {
        type: block.type,
        id: uid(block.type),
        data: JSON.parse(JSON.stringify(block.data || {}))
      };
      block.type = 'columns';
      block.data = {
        columns: [{ blocks: [kept] }, { blocks: [] }],
        className: soft.className || undefined,
        id: soft.id || undefined
      };
      if (!block.data.className) delete block.data.className;
      if (!block.data.id) delete block.data.id;
      selectedId = kept.id;
      renderCanvas();
      renderProperties();
      flashCanvasHint('הפך לעמודות — המודול נשמר בטור הימני');
      return true;
    }

    block.type = newType;
    block.data = applySoftFields(newType, soft);
    // keep stable id so selection/DnD stay sane
    selectedId = block.id;
    renderCanvas();
    renderProperties();
    flashCanvasHint('הוחלף ל«' + typeLabel(newType) + '»');
    return true;
  }

  var hintTimer = null;
  function flashCanvasHint(msg) {
    var host = document.getElementById('canvas-hint');
    if (!host) {
      var header = document.querySelector('.canvas-header');
      if (!header) return;
      host = document.createElement('span');
      host.id = 'canvas-hint';
      host.className = 'canvas-hint';
      header.appendChild(host);
    }
    host.textContent = msg || '';
    host.classList.add('visible');
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      host.classList.remove('visible');
    }, 2200);
  }

  // ---- Init ----

  function init(config) {
    blocks = config.blocks || [];
    (function walk(list) {
      list.forEach(function (b) {
        if (!b.id) b.id = uid(b.type || 'block');
        if (isColumnsContainer(b.type)) {
          ensureColumns(b).forEach(function (col) {
            walk(col.blocks || []);
          });
        } else if (isBlocksContainer(b.type)) {
          walk(ensureBlocks(b));
        }
      });
    })(blocks);

    currentPageFullPath = config.fullPath || '';
    currentSlug = config.slug || config.fullPath || '';
    // The slug auto-follows the title ONLY while it's still title-derived; a
    // customized slug (≠ slugify(title)) is treated as chosen and left alone.
    var loadedTitle = (document.getElementById('page-title') || {}).value || config.title || '';
    slugTouched = currentSlug !== slugify(loadedTitle);
    pageTags = Array.isArray(config.tags) ? config.tags.slice() : [];
    pageMeta = (config.meta && typeof config.meta === 'object') ? config.meta : {};
    selectedId = null;
    dropHint = null;
    undoStack = [];
    redoStack = [];
    isDirty = false;
    hasUnpublishedState = !!config.hasUnpublished;
    // a published page always shows its live door from the first paint
    if (config.status === 'published') updateLiveLink('/' + (config.fullPath || config.full_path || currentPageFullPath));
    // Direction of the PAGE being edited (ask B): the settings drawer side
    // follows it — RTL page → panel on the right, LTR page → panel on the left.
    pageDirection = config.direction === 'ltr' ? 'ltr' : 'rtl';
    var builderEl = document.querySelector('.builder');
    if (builderEl) {
      builderEl.classList.toggle('page-rtl', pageDirection === 'rtl');
      builderEl.classList.toggle('page-ltr', pageDirection === 'ltr');
    }
    ensureUiExtras();
    initToolSearch();
    renderCanvas();
    renderProperties();
    applyCanvasPageBg();
    bindToolboxDrag();
    updateHeaderExtras();

    // Title → slug auto-sync (bound once). While the slug is still title-derived,
    // typing a new title rewrites the address (spaces → dashes) so newcomers
    // never touch the slug; a hand-edited slug detaches and is left alone.
    var titleInput = document.getElementById('page-title');
    if (titleInput && !titleInput._slugBound) {
      titleInput._slugBound = true;
      titleInput.addEventListener('input', function () {
        if (!slugTouched) {
          currentSlug = slugify(titleInput.value);
          var sf = document.querySelector('[data-page-slug]');
          if (sf && document.activeElement !== sf) sf.value = currentSlug;
        }
        markDirty();
      });
    }
  }

  // ---- Canvas ----

  function renderCanvas() {
    var canvas = document.getElementById('canvas');
    if (!canvas) return;
    canvas.innerHTML = '';
    canvas.classList.add('block-stack');

    // Click on the canvas background (not a block) = deselect → page properties
    if (!canvas._deselectBound) {
      canvas._deselectBound = true;
      canvas.addEventListener('click', function (e) {
        if (e.target !== canvas) return;
        if (selectedId == null) return;
        selectedId = null;
        renderCanvas();
        renderProperties();
      });
    }

    if (!blocks.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-canvas';
      empty.innerHTML =
        '<div style="font-size:1.05rem;font-weight:700;color:#334155;margin-bottom:8px">בנו את הדף כאן</div>' +
        '<div>גררו מודולים מהסרגל · הזיזו מכולות · לחצו לבחירה</div>' +
        '<div style="margin-top:10px;font-size:0.8rem;color:#94a3b8">לחיצה כפולה על טקסט = כתיבה ישירה במכולה</div>' +
        '<div style="margin-top:6px;font-size:0.8rem;color:#94a3b8">בצד — הגדרות המודול + עיצוב מתקדם</div>';
      canvas.appendChild(empty);
      bindListSurface(canvas, null, null);
      updateCount();
      return;
    }

    renderListInto(canvas, blocks, null, null);
    updateCount();
  }

  function updateCount() {
    var el = document.getElementById('block-count');
    if (el) el.textContent = countAllBlocks() + ' מודולים';
  }

  /**
   * Render a vertical list of blocks with insert slots between them.
   * parentBlock + colIndex identify nested lists inside columns.
   */
  function renderListInto(container, list, parentBlock, colIndex) {
    container.classList.add('block-list');
    container.dataset.listScope = parentBlock ? parentBlock.id + ':' + colIndex : 'root';

    // leading insert slot
    container.appendChild(makeInsertSlot(list, 0, parentBlock, colIndex));

    list.forEach(function (block, i) {
      container.appendChild(createBlockEl(block, {
        nested: !!parentBlock,
        list: list,
        index: i,
        parent: parentBlock,
        colIndex: colIndex
      }));
      container.appendChild(makeInsertSlot(list, i + 1, parentBlock, colIndex));
    });

    bindListSurface(container, parentBlock, colIndex);
  }

  function makeInsertSlot(list, index, parentBlock, colIndex) {
    var slot = document.createElement('div');
    slot.className = 'drop-slot';
    slot.dataset.insertIndex = String(index);
    slot.dataset.parentId = parentBlock ? parentBlock.id : '';
    slot.dataset.colIndex = colIndex == null ? '' : String(colIndex);
    slot.innerHTML = '<span class="drop-slot-line"></span><span class="drop-slot-label">שחרר כאן</span>';

    function hint() {
      return {
        mode: 'insert',
        parentId: parentBlock ? parentBlock.id : null,
        colIndex: colIndex,
        index: index
      };
    }

    slot.addEventListener('dragover', function (e) {
      if (!dragState) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = dragState.kind === 'toolbox' ? 'copy' : 'move';
      setDropHint(hint());
      clearDropClasses();
      slot.classList.add('drop-slot-active');
    });

    slot.addEventListener('dragleave', function (e) {
      if (!slot.contains(e.relatedTarget)) slot.classList.remove('drop-slot-active');
    });

    slot.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      slot.classList.remove('drop-slot-active');
      commitDrop(hint());
    });

    return slot;
  }

  /** The "גרור לכאן" placeholder is a REAL drop target — dropping a tool or a
   *  block on it inserts at the top of that (empty) container list. Without
   *  this, everything inside a container sits under a .canvas-block and the
   *  generic list-surface fallback ignores the drop. */
  function bindEmptyTarget(el, parentBlock, colIndex) {
    function hint() {
      return {
        mode: 'insert',
        parentId: parentBlock ? parentBlock.id : null,
        colIndex: colIndex,
        index: 0
      };
    }
    el.addEventListener('dragover', function (e) {
      if (!dragState) return;
      if (dragState.kind === 'block' && parentBlock &&
          wouldNestIntoSelf(getBlock(dragState.blockId), parentBlock.id)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = dragState.kind === 'toolbox' ? 'copy' : 'move';
      setDropHint(hint());
      clearDropClasses();
      el.classList.add('drop-hover');
    });
    el.addEventListener('dragleave', function (e) {
      if (!el.contains(e.relatedTarget)) el.classList.remove('drop-hover');
    });
    el.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drop-hover');
      commitDrop(hint());
    });
  }

  function bindListSurface(el, parentBlock, colIndex) {
    // fallback: dropping on empty padding of the list = append
    el.addEventListener('dragover', function (e) {
      if (!dragState) return;
      if (e.target.closest('.canvas-block, .drop-slot, .split-zone')) return;
      e.preventDefault();
      var live = getLiveList(parentBlock ? parentBlock.id : null, colIndex);
      if (!live) return;
      setDropHint({
        mode: 'insert',
        parentId: parentBlock ? parentBlock.id : null,
        colIndex: colIndex,
        index: live.length
      });
      el.classList.add('list-drop-active');
    });
    el.addEventListener('dragleave', function (e) {
      if (!el.contains(e.relatedTarget)) el.classList.remove('list-drop-active');
    });
    el.addEventListener('drop', function (e) {
      if (e.target.closest('.canvas-block, .drop-slot, .split-zone')) return;
      e.preventDefault();
      el.classList.remove('list-drop-active');
      var live = getLiveList(parentBlock ? parentBlock.id : null, colIndex);
      if (!live) return;
      commitDrop({
        mode: 'insert',
        parentId: parentBlock ? parentBlock.id : null,
        colIndex: colIndex,
        index: live.length
      });
    });
  }

  function createBlockEl(block, opts) {
    opts = opts || {};
    var nested = !!opts.nested;

    var el = document.createElement('div');
    el.className = 'canvas-block' + (block.id === selectedId ? ' selected' : '') + (nested ? ' nested' : '');
    el.dataset.id = block.id;

    // only drag from handle — cleaner, less accidental drag
    var handle = document.createElement('div');
    handle.className = 'block-handle';
    handle.title = 'גרור לסידור / פיצול';
    handle.textContent = '⠿';
    handle.draggable = true;
    el.appendChild(handle);

    var toolbar = document.createElement('div');
    toolbar.className = 'block-toolbar';
    toolbar.innerHTML =
      '<button type="button" data-act="up" title="למעלה">↑</button>' +
      '<button type="button" data-act="down" title="למטה">↓</button>' +
      '<button type="button" data-act="split" title="פצל לשני טורים">⧉</button>' +
      '<button type="button" data-act="replace" title="החלף סוג מודול">⇄</button>' +
      '<button type="button" data-act="dup" title="שכפל">⎘</button>' +
      '<button type="button" data-act="del" title="מחק">×</button>';

    toolbar.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      e.stopPropagation();
      var act = btn.dataset.act;
      if (act === 'up') moveBlock(block.id, -1);
      if (act === 'down') moveBlock(block.id, 1);
      if (act === 'split') splitBlockInPlace(block.id);
      if (act === 'replace') {
        selectBlock(block.id);
        // unfold the advanced replace section and focus its chips
        setTimeout(function () {
          var det = document.querySelector('.replace-advanced');
          if (det) det.open = true;
          var chip = document.querySelector('.replace-chip');
          if (chip) chip.focus();
        }, 30);
      }
      if (act === 'dup') duplicateBlock(block.id);
      if (act === 'del') deleteBlock(block.id);
    });

    var label = document.createElement('div');
    label.className = 'block-label';
    // Language keyword first — agents/humans see BenTML, not a mystery list label
    var kw = bentmlKeywordFor(block.type);
    // Nested tag names the container: "בטור" for columns, "ב<שם המכולה>"
    // for card / parallax / any blocks-container.
    var nestTag = '';
    if (nested) {
      var nestLabel = (opts.parent && !isColumnsContainer(opts.parent.type))
        ? 'ב' + typeLabel(opts.parent.type)
        : 'בטור';
      nestTag = ' <span class="nest-tag">' + esc(nestLabel) + '</span>';
    }
    label.innerHTML =
      '<code class="block-kw">' + esc(kw) + '</code> ' +
      '<span class="block-type-icon">' + esc(typeIcon(block.type)) + '</span> ' +
      esc(typeLabel(block.type)) +
      nestTag;

    var content = document.createElement('div');
    content.className = 'block-content';
    content.appendChild(renderBlockBody(block));
    // apply module style to visual host
    (function applyStyleNow() {
      var d = block.data || {};
      var s = d.style || {};
      content.style.textAlign = d.align === 'center' ? 'center' : d.align === 'end' ? 'end' : '';
      content.style.color = s.color || '';
      content.style.background = s.background || '';
      content.style.fontSize = s.fontSize === 'sm' ? '0.9em' : s.fontSize === 'lg' ? '1.2em' : '';
      content.style.padding = s.padding === 'sm' ? '0.35rem 0.5rem' : s.padding === 'md' ? '0.75rem 1rem' : s.padding === 'lg' ? '1.25rem 1.5rem' : '';
      content.style.borderRadius = s.radius === 'sm' ? '6px' : s.radius === 'md' ? '12px' : s.radius === 'lg' ? '20px' : '';
    })();

    // side split zones (not for columns container itself — drop between/into cols instead)
    if (!isColumnsContainer(block.type)) {
      var leftZ = document.createElement('div');
      leftZ.className = 'split-zone split-left';
      leftZ.innerHTML = '<span>◂ פצל</span>';
      leftZ.title = 'שחרר כאן לפיצול — המודול יישב משמאל';

      var rightZ = document.createElement('div');
      rightZ.className = 'split-zone split-right';
      rightZ.innerHTML = '<span>פצל ▸</span>';
      rightZ.title = 'שחרר כאן לפיצול — המודול יישב מימין';

      bindSplitZone(leftZ, block, 'left');
      bindSplitZone(rightZ, block, 'right');
      el.appendChild(leftZ);
      el.appendChild(rightZ);
    }

    el.appendChild(toolbar);
    el.appendChild(label);
    el.appendChild(content);

    el.addEventListener('click', function (e) {
      if (e.target.closest('button, .split-zone')) return;
      var nearest = e.target.closest('.canvas-block');
      if (nearest && nearest !== el) return;
      e.stopPropagation();
      selectBlock(block.id);
    });

    el.addEventListener('dblclick', function (e) {
      // Inline text fields handle their own dblclick; otherwise focus settings
      if (e.target.closest('[data-inline-key]')) return;
      e.stopPropagation();
      selectBlock(block.id);
      var panel = document.getElementById('properties-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    handle.addEventListener('dragstart', function (e) {
      e.stopPropagation();
      dragState = { kind: 'block', blockId: block.id };
      e.dataTransfer.setData('text/plain', block.id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
      document.body.classList.add('is-dragging');
    });

    handle.addEventListener('dragend', function () {
      el.classList.remove('dragging');
      // Don't clobber mid-commit (drop fires before dragend in most browsers,
      // but be defensive so we never clear state while mutating the tree).
      if (dropInProgress) return;
      document.body.classList.remove('is-dragging');
      dragState = null;
      dropHint = null;
      clearDropClasses();
    });

    return el;
  }

  function bindSplitZone(zone, targetBlock, side) {
    zone.addEventListener('dragover', function (e) {
      if (!dragState) return;
      // don't split with self
      if (dragState.kind === 'block' && dragState.blockId === targetBlock.id) return;
      if (dragState.kind === 'block' && isAncestor(dragState.blockId, targetBlock.id)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = dragState.kind === 'toolbox' ? 'copy' : 'move';
      setDropHint({ mode: 'split', targetId: targetBlock.id, side: side });
      clearDropClasses();
      zone.classList.add('split-active');
      var host = zone.closest('.canvas-block');
      if (host) host.classList.add('split-target');
    });
    zone.addEventListener('dragleave', function (e) {
      if (!zone.contains(e.relatedTarget)) {
        zone.classList.remove('split-active');
        var host = zone.closest('.canvas-block');
        if (host && !host.querySelector('.split-zone.split-active')) {
          host.classList.remove('split-target');
        }
      }
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('split-active');
      commitDrop({ mode: 'split', targetId: targetBlock.id, side: side });
    });
  }

  function setDropHint(hint) {
    dropHint = hint;
  }

  function clearDropClasses() {
    document.querySelectorAll(
      '.drop-slot-active, .list-drop-active, .split-active, .split-target, .drop-hover, .drop-hover-root'
    ).forEach(function (el) {
      el.classList.remove(
        'drop-slot-active',
        'list-drop-active',
        'split-active',
        'split-target',
        'drop-hover',
        'drop-hover-root'
      );
    });
  }

  function renderBlockBody(block) {
    var d = block.data || {};
    var wrap = document.createElement('div');
    wrap.className = 'module-visual';
    if (d.className) wrap.className += ' ' + d.className;

    if (block.type === 'hero') {
      wrap.innerHTML =
        '<div class="preview-hero">' +
        '<h1 data-inline-key="title">' + esc(d.title || 'כותרת ראשית') + '</h1>' +
        '<p data-inline-key="subtitle">' + esc(d.subtitle || 'תת כותרת — לחצו לעריכה') + '</p>' +
        '</div>';
      wireInlineEditable(wrap, block);
      return wrap;
    }

    if (block.type === 'heading') {
      var level = Math.min(Math.max(d.level || 2, 1), 6);
      wrap.innerHTML =
        '<h' + level + ' data-inline-key="text" style="margin:4px 0">' +
        esc(d.text || 'כותרת') +
        '</h' + level + '>';
      wireInlineEditable(wrap, block);
      return wrap;
    }

    if (block.type === 'text') {
      wrap.innerHTML =
        '<div data-inline-key="content" class="inline-text" style="line-height:1.6;color:#334155;min-height:1.4em">' +
        esc(d.content || 'טקסט — לחצו לכתיבה ישירה').replace(/\n/g, '<br>') +
        '</div>';
      wireInlineEditable(wrap, block);
      return wrap;
    }

    if (block.type === 'button') {
      wrap.innerHTML =
        '<div><span class="preview-btn" data-inline-key="text">' +
        esc(d.text || 'לחץ כאן') +
        '</span></div>';
      wireInlineEditable(wrap, block);
      return wrap;
    }

    if (block.type === 'image') {
      if (d.src) {
        wrap.innerHTML =
          '<img src="' + escAttr(d.src) + '" alt="" style="max-width:100%;border-radius:8px;border:1px solid #e2e8f0">';
        var imgEl = wrap.querySelector('img');
        imgEl.title = 'לחיצה כפולה = החלפת תמונה';
        imgEl.addEventListener('dblclick', function (e) {
          e.stopPropagation();
          selectBlock(block.id);
          openMediaLibrary(block.id);
        });
      } else {
        // the easiest module: an empty image is ONE click away from the bank
        wrap.innerHTML =
          '<div class="preview-image-empty" style="cursor:pointer">🖼 לחצו לבחירת תמונה מהספרייה</div>';
        wrap.querySelector('.preview-image-empty').addEventListener('click', function (e) {
          e.stopPropagation();
          selectBlock(block.id);
          openMediaLibrary(block.id);
        });
      }
      return wrap;
    }

    if (block.type === 'spacer') {
      wrap.innerHTML =
        '<div class="preview-spacer" style="height:' + escAttr(d.height || '30px') + '"></div>';
      return wrap;
    }

    if (block.type === 'divider') {
      wrap.innerHTML = '<hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0">';
      return wrap;
    }

    if (block.type === 'testimonial') {
      wrap.innerHTML =
        '<div class="preview-testimonial">' +
        '<div data-inline-key="quote" style="font-style:italic">' + esc(d.quote || 'ציטוט...') + '</div>' +
        '<div data-inline-key="author" style="margin-top:8px;font-size:0.9rem;font-weight:600">' +
        esc(d.author || 'שם') +
        '</div>' +
        '</div>';
      wireInlineEditable(wrap, block);
      return wrap;
    }

    if (block.type === 'features') {
      var items = d.items || [];
      wrap.innerHTML =
        '<div class="preview-features">' +
        items
          .map(function (it) {
            return (
              '<div class="preview-feature"><strong>' +
              esc(it.title || '') +
              '</strong><div>' +
              esc(it.description || '') +
              '</div></div>'
            );
          })
          .join('') +
        '</div>';
      return wrap;
    }

    if (block.type === 'list') {
      var listItems = d.items || [];
      var listTag = d.ordered ? 'ol' : 'ul';
      wrap.innerHTML =
        '<' + listTag + ' style="margin:4px 0;padding-inline-start:20px;color:#334155">' +
        listItems
          .map(function (it) {
            return '<li>' + esc(typeof it === 'string' ? it : (it.text || '')) + '</li>';
          })
          .join('') +
        '</' + listTag + '>';
      return wrap;
    }

    if (block.type === 'embed') {
      var vid = youtubeId(d.url || '');
      if (vid) {
        wrap.innerHTML =
          '<div class="preview-embed">' +
          '<img src="https://img.youtube.com/vi/' + escAttr(vid) + '/hqdefault.jpg" alt="" style="max-width:100%;border-radius:8px;border:1px solid #e2e8f0">' +
          '<span class="embed-play">▶</span></div>';
      } else if (d.url) {
        wrap.innerHTML = '<div style="color:#334155;direction:ltr;text-align:left">🔗 ' + esc(d.url) + '</div>';
      } else {
        wrap.innerHTML = '<div class="preview-image-empty">הדבק קישור YouTube (לחץ לעריכה)</div>';
      }
      return wrap;
    }

    if (block.type === 'article-list') {
      var alCols = Math.min(Math.max(parseInt(d.columns, 10) || 3, 1), 4);
      var alLimit = Math.min(Math.max(parseInt(d.limit, 10) || 6, 1), 48);
      var alTag = d.tag || 'article';
      var grid = document.createElement('div');
      grid.className = 'preview-cubes';
      grid.style.gridTemplateColumns = 'repeat(' + alCols + ', 1fr)';
      var placeholders = Math.min(alLimit, alCols);
      var ph = '';
      for (var pi = 0; pi < placeholders; pi++) {
        ph += '<div class="preview-cube"><div class="cube-img">⊞</div><div class="cube-txt">מאמר…</div></div>';
      }
      grid.innerHTML = ph;
      wrap.appendChild(grid);
      fetchArticlesPreview(alTag, alLimit, function (articles) {
        if (!document.body.contains(grid)) return; // canvas re-rendered meanwhile
        if (!articles.length) {
          grid.innerHTML = '<div class="preview-cubes-note">אין עדיין דפים מפורסמים עם תגית "' + esc(alTag) +
            '" — סמן דף כמאמר במאפייני הדף (לחץ על רקע הקנבס)</div>';
          return;
        }
        grid.innerHTML = articles.map(function (a) {
          var img = a.image
            ? '<img src="' + escAttr(a.image) + '" alt="">'
            : '⊞';
          return '<div class="preview-cube"><div class="cube-img">' + img + '</div>' +
            '<div class="cube-txt">' + esc(a.title || '') + '</div></div>';
        }).join('');
      });
      return wrap;
    }

    if (block.type === 'gallery') {
      var gImgs = filledMedia(d.images);
      if (!gImgs.length) {
        wrap.innerHTML = '<div class="preview-image-empty">גלריה ריקה — הוסף תמונות במאפיינים</div>';
        return wrap;
      }
      wrap.innerHTML =
        '<div class="preview-gallery">' +
        gImgs.slice(0, 8).map(function (im) {
          return '<img src="' + escAttr(mediaSrcOf(im)) + '" alt="" loading="lazy">';
        }).join('') +
        (gImgs.length > 8 ? '<span class="gallery-more">+' + (gImgs.length - 8) + '</span>' : '') +
        '</div>';
      return wrap;
    }

    if (isColumnsContainer(block.type)) {
      return renderColumnsBody(block);
    }

    if (block.type === 'quote') {
      wrap.innerHTML =
        '<blockquote class="preview-quote">' +
        '<p data-inline-key="text">' + esc(d.text || 'ציטוט…') + '</p>' +
        (d.author ? '<footer data-inline-key="author">— ' + esc(d.author) + '</footer>' : '<footer data-inline-key="author">— מקור</footer>') +
        '</blockquote>';
      wireInlineEditable(wrap, block);
      return wrap;
    }

    // Any container whose children live in a flat data.blocks list
    // (card, parallax, …) — registry-driven off childrenKey:'blocks'.
    if (isBlocksContainer(block.type)) {
      var contDef = registryDef(block.type);
      var contInner = document.createElement('div');
      contInner.className = 'preview-card is-container';
      var contBadge = esc((contDef && contDef.labelHe) || typeLabel(block.type));
      contInner.innerHTML =
        '<div class="column-head"><span class="container-badge">' + contBadge + '</span> מכולה</div>';
      var contList = document.createElement('div');
      contList.className = 'column-list';
      var contKids = ensureBlocks(block);
      if (!contKids.length) {
        var contEmpty = document.createElement('div');
        contEmpty.className = 'column-empty';
        contEmpty.textContent = 'גרור לכאן';
        bindEmptyTarget(contEmpty, block, 'blocks');
        contList.appendChild(contEmpty);
      }
      renderListInto(contList, contKids, block, 'blocks');
      contInner.appendChild(contList);
      wrap.appendChild(contInner);
      return wrap;
    }

    if (block.type === 'map') {
      wrap.innerHTML =
        '<div class="preview-map">' +
        '<div class="preview-map-pin">📍</div>' +
        '<div><strong>מפה</strong></div>' +
        '<div style="color:#64748b;font-size:0.9rem">' +
        esc(d.address || 'הזן כתובת במאפיינים') +
        '</div></div>';
      return wrap;
    }

    if (block.type === 'tabs') {
      var tItems = d.items || [];
      wrap.innerHTML =
        '<div class="preview-tabs">' +
        '<div class="preview-tabs-labels">' +
        (tItems.length ? tItems : [{ label: 'טאב 1' }, { label: 'טאב 2' }]).map(function (it, i) {
          return '<span class="preview-tab-chip' + (i === 0 ? ' active' : '') + '">' + esc(it.label || ('טאב ' + (i + 1))) + '</span>';
        }).join('') +
        '</div>' +
        '<div class="preview-tab-body">' + esc((tItems[0] && tItems[0].content) || 'תוכן הלשונית — ערכו במאפיינים') + '</div>' +
        '</div>';
      return wrap;
    }

    if (block.type === 'accordion') {
      var aItems = d.items || [];
      wrap.innerHTML =
        '<div class="preview-accordion">' +
        (aItems.length ? aItems : [{ title: 'מגירה 1' }, { title: 'מגירה 2' }]).map(function (it, i) {
          return '<div class="preview-fold">' +
            '<div class="preview-fold-head">' + (i === 0 ? '▾ ' : '▸ ') + esc(it.title || 'כותרת') + '</div>' +
            (i === 0 ? '<div class="preview-fold-body">' + esc(it.content || 'תוכן — ערכו במאפיינים') + '</div>' : '') +
            '</div>';
        }).join('') +
        '</div>';
      return wrap;
    }

    if (block.type === 'nav') {
      var nItems = d.items || [];
      var navStyle = d.background ? 'background:' + esc(d.background) : '';
      wrap.innerHTML =
        '<div class="preview-nav preview-nav-' + esc(d.align || 'start') + '"' + (navStyle ? ' style="' + navStyle + '"' : '') + '>' +
        (nItems.length ? nItems : [{ label: 'בית' }, { label: 'אודות' }, { label: 'צור קשר' }]).map(function (it) {
          return '<span class="preview-nav-link"' + (d.color ? ' style="color:' + esc(d.color) + '"' : '') + '>' + esc(it.label || 'קישור') + '</span>';
        }).join('') +
        '</div>';
      return wrap;
    }

    if (block.type === 'ticker') {
      var tItems = d.items || [];
      var tStyle = d.background ? 'background:' + esc(d.background) : '';
      wrap.innerHTML =
        '<div class="preview-ticker"' + (tStyle ? ' style="' + tStyle + '"' : '') + '>' +
        (d.label ? '<span class="preview-ticker-label">' + esc(d.label) + '</span>' : '') +
        '<div class="preview-ticker-strip">' +
        (tItems.length ? tItems : [{ text: 'מבזק ראשון' }, { text: 'מבזק שני' }, { text: 'מבזק שלישי' }]).map(function (it) {
          return '<span class="preview-ticker-link"' + (d.color ? ' style="color:' + esc(d.color) + '"' : '') + '>' + esc(it.text || 'מבזק') + '</span>';
        }).join('') +
        '</div></div>';
      return wrap;
    }

    if (block.type === 'video') {
      var vurl = d.src || '';
      var vyt = youtubeId(vurl);
      var vthumb = vyt ? 'https://img.youtube.com/vi/' + escAttr(vyt) + '/hqdefault.jpg' : (d.poster ? escAttr(d.poster) : '');
      if (vthumb) {
        wrap.innerHTML =
          '<div class="preview-embed"><img src="' + vthumb + '" alt="" style="max-width:100%;border-radius:8px;border:1px solid #e2e8f0"><span class="embed-play">▶</span></div>';
      } else if (vurl) {
        wrap.innerHTML =
          '<div class="preview-embed" style="background:#0f172a;min-height:90px;display:flex;align-items:center;justify-content:center"><span class="embed-play" style="position:static">▶</span></div>';
      } else {
        wrap.innerHTML = '<div class="preview-image-empty">וידאו — בחר קובץ או הדבק קישור (לחץ לעריכה)</div>';
      }
      return wrap;
    }

    if (block.type === 'category') {
      var catSlug = d.slug || '';
      wrap.innerHTML =
        '<div class="preview-category">' +
        '<div class="preview-category-head" id="pcat-head-' + escAttr(block.id) + '">🗂 ' + esc(catSlug || 'בחרו קטגוריה במאפיינים') + '</div>' +
        '<div class="preview-cards">' +
        [1, 2, 3].map(function () {
          return '<div class="preview-card"><div class="preview-card-media"></div><div class="preview-card-title">כתבה מהקטגוריה</div></div>';
        }).join('') +
        '</div></div>';
      if (catSlug) {
        loadCategoriesOnce(function (cats) {
          var meta = null;
          for (var i = 0; i < cats.length; i++) if (cats[i].slug === catSlug) { meta = cats[i]; break; }
          var head = document.getElementById('pcat-head-' + block.id);
          if (head && meta) {
            head.textContent = '🗂 ' + (meta.name || catSlug);
            if (/^#[0-9a-fA-F]{6}$/.test(meta.color || '')) head.style.borderColor = meta.color;
          }
        });
      }
      return wrap;
    }

    if (block.type === 'cards') {
      var cItems = d.items || [];
      wrap.innerHTML =
        '<div class="preview-cards">' +
        (cItems.length ? cItems : [{ title: 'כרטיס 1' }, { title: 'כרטיס 2' }, { title: 'כרטיס 3' }]).map(function (it) {
          return '<div class="preview-card">' +
            '<div class="preview-card-media"></div>' +
            (it.tag ? '<span class="preview-card-tag">' + esc(it.tag) + '</span>' : '') +
            '<div class="preview-card-title">' + esc(it.title || 'כותרת') + '</div>' +
            (it.excerpt ? '<div class="preview-card-excerpt">' + esc(it.excerpt) + '</div>' : '') +
            '</div>';
        }).join('') +
        '</div>';
      return wrap;
    }

    if (block.type === 'form') {
      var fFields = d.fields || [];
      wrap.innerHTML =
        '<div class="preview-form">' +
        (fFields.length ? fFields : [{ label: 'שדה', type: 'text' }]).map(function (f) {
          var lab = esc(f.label || '') + (f.required ? ' *' : '');
          var t = f.type || 'text';
          var ctrl;
          if (t === 'textarea') ctrl = '<div class="preview-field-box" style="height:44px"></div>';
          else if (t === 'checkbox') ctrl = '<span class="preview-field-check"></span>';
          else if (t === 'select') ctrl = '<div class="preview-field-box">' + esc((f.options || '').split(',')[0] || '▾') + '</div>';
          else ctrl = '<div class="preview-field-box">' + esc(f.placeholder || '') + '</div>';
          return '<label class="preview-field"><span class="preview-field-label">' + lab + '</span>' + ctrl + '</label>';
        }).join('') +
        '<span class="preview-form-submit">' + esc(d.submit || 'שליחה') + '</span>' +
        '</div>';
      return wrap;
    }

    // Provisional raw-HTML block (the escape hatch) — show it clearly and offer
    // to graduate it into real modules. Content is shown ESCAPED (never injected
    // into the admin DOM) so an LLM-steered fragment can't run here.
    if (block.type === 'html') {
      var rawContent = d.content || '';
      var isProv = d.provisional !== false && d.provisional !== 'false';
      var escaped = esc(rawContent);
      wrap.innerHTML =
        '<div class="bent-html-card' + (isProv ? ' is-provisional' : '') + '">' +
        '<div class="bent-html-badge">' + (isProv ? '⚠ HTML גולמי — זמני' : 'HTML') + '</div>' +
        (d.note ? '<div class="bent-html-note">' + esc(d.note) + '</div>' : '') +
        '<pre class="bent-html-raw" dir="ltr">' + (escaped.length > 600 ? escaped.slice(0, 600) + '\n…' : (escaped || '(ריק)')) + '</pre>' +
        '<div class="bent-html-actions">' +
        '<button type="button" class="btn" data-graduate="' + escAttr(block.id) + '">✨ המר למודולים</button>' +
        '<span class="bent-html-hint">הופך את הקוד למודולים שאפשר לערוך בלחיצה</span>' +
        '</div></div>';
      var gradBtn = wrap.querySelector('[data-graduate]');
      if (gradBtn) {
        gradBtn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          graduateHtmlBlock(block.id);
        });
      }
      return wrap;
    }

    // Generic preview for registry-only types (no hand-written case needed).
    // The main text field is inline-editable too — so cta/banner/marquee/etc.
    // are all editable directly on the canvas, not only in the side panel.
    var genDef = registryDef(block.type);
    if (genDef) {
      var tf = genDef.textField;
      var bodyTxt = tf ? (d[tf] || '') : '';
      wrap.innerHTML =
        '<div style="padding:12px;border:1px dashed #cbd5e1;border-radius:8px;color:#334155;background:#f8fafc">' +
        '<strong>' + esc(genDef.icon || '') + ' ' + esc(genDef.labelHe || block.type) + '</strong>' +
        (tf
          ? '<div data-inline-key="' + escAttr(tf) + '" class="inline-text" style="margin-top:4px;min-height:1.2em">' +
            esc(bodyTxt || 'טקסט — לחצו לעריכה') + '</div>'
          : '') +
        '<div class="prop-hint">שדות נוספים במאפיינים ←</div>' +
        '</div>';
      if (tf) wireInlineEditable(wrap, block);
      return wrap;
    }

    wrap.textContent = block.type || '?';
    return wrap;
  }

  /** Column width ratios — "2:1" or [2,1]. Edge: user drags halves, agent can set ratio: "2:1". */
  function parseColumnRatios(block) {
    var cols = ensureColumns(block);
    var n = cols.length;
    var r = block.data && block.data.ratio;
    var parts = null;
    if (Array.isArray(r) && r.length === n) {
      parts = r.map(function (x) { return Math.max(0.2, Number(x) || 1); });
    } else if (typeof r === 'string' && r.indexOf(':') !== -1) {
      parts = r.split(':').map(function (x) { return Math.max(0.2, parseFloat(x) || 1); });
      if (parts.length !== n) parts = null;
    }
    if (!parts) {
      parts = [];
      for (var i = 0; i < n; i++) parts.push(1);
    }
    return parts;
  }

  function setColumnRatios(block, ratios) {
    if (!block.data) block.data = {};
    // the cut speaks percent: store "65:35" (integers summing to 100) so the
    // builder labels, BenTML source, and the drag all say the same numbers
    var sum = ratios.reduce(function (a, b) { return a + b; }, 0) || 1;
    var pcts = ratios.map(function (x) { return Math.max(5, Math.round((x / sum) * 100)); });
    var drift = 100 - pcts.reduce(function (a, b) { return a + b; }, 0);
    pcts[pcts.indexOf(Math.max.apply(null, pcts))] += drift;
    block.data.ratio = pcts.join(':');
  }

  function renderColumnsBody(block) {
    var cols = ensureColumns(block);
    var ratios = parseColumnRatios(block);
    var row = document.createElement('div');
    row.className = 'columns-preview is-container';
    row.style.display = 'grid';
    row.style.gridTemplateColumns = ratios.map(function (r) { return r + 'fr'; }).join(' ');
    row.style.gap = '0';
    row.dataset.columnsId = block.id;

    cols.forEach(function (col, colIndex) {
      var colEl = document.createElement('div');
      colEl.className = 'column-pane is-container';
      colEl.dataset.parentId = block.id;
      colEl.dataset.colIndex = String(colIndex);
      colEl.style.minWidth = '0';

      var head = document.createElement('div');
      head.className = 'column-head';
      var pct = Math.round((ratios[colIndex] / ratios.reduce(function (a, b) { return a + b; }, 0)) * 100);
      head.innerHTML =
        '<span class="container-badge">מכולה</span> טור ' +
        (colIndex + 1) +
        ' <span class="col-ratio-label">' +
        pct +
        '%</span>';
      colEl.appendChild(head);

      var listWrap = document.createElement('div');
      listWrap.className = 'column-list';
      if (!Array.isArray(col.blocks)) col.blocks = [];
      if (!col.blocks.length) {
        var empty = document.createElement('div');
        empty.className = 'column-empty';
        empty.textContent = 'גרור לכאן';
        bindEmptyTarget(empty, block, colIndex);
        listWrap.appendChild(empty);
      }
      renderListInto(listWrap, col.blocks, block, colIndex);
      colEl.appendChild(listWrap);

      var addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'column-add';
      addBtn.textContent = '+ הוסף';
      addBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        addChildToColumn(block.id, colIndex, 'text');
      });
      colEl.appendChild(addBtn);

      row.appendChild(colEl);

      // Resize handle between this column and the next (move the halves)
      if (colIndex < cols.length - 1) {
        var handle = document.createElement('div');
        handle.className = 'col-resize-handle';
        handle.title = 'גרור לשינוי רוחב הטורים';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        bindColumnResize(handle, block, colIndex, row);
        // grid: place handle as a narrow track — use absolute overlay between panes instead
        colEl.style.position = 'relative';
        handle.style.position = 'absolute';
        handle.style.top = '0';
        handle.style.bottom = '0';
        handle.style.left = isRtl() ? 'auto' : '100%';
        handle.style.right = isRtl() ? '100%' : 'auto';
        handle.style.marginInlineStart = isRtl() ? '0' : '-5px';
        handle.style.marginInlineEnd = isRtl() ? '-5px' : '0';
        colEl.appendChild(handle);
      }
    });

    return row;
  }

  function bindColumnResize(handle, block, leftIndex, rowEl) {
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var startX = e.clientX;
      var startRatios = parseColumnRatios(block).slice();
      var total = startRatios.reduce(function (a, b) { return a + b; }, 0);
      var rowRect = rowEl.getBoundingClientRect();
      var rowW = Math.max(rowRect.width, 1);
      var rtl = isRtl();

      function onMove(ev) {
        var dx = ev.clientX - startX;
        if (rtl) dx = -dx;
        // convert pixel drag to fraction of total ratio units
        var dUnits = (dx / rowW) * total;
        var left = startRatios[leftIndex];
        var right = startRatios[leftIndex + 1];
        var pair = left + right;
        var newLeft = Math.min(pair - 0.25, Math.max(0.25, left + dUnits));
        var newRight = pair - newLeft;
        var next = startRatios.slice();
        next[leftIndex] = newLeft;
        next[leftIndex + 1] = newRight;
        rowEl.style.gridTemplateColumns = next.map(function (r) { return r + 'fr'; }).join(' ');
        // live % labels
        var sum = next.reduce(function (a, b) { return a + b; }, 0);
        rowEl.querySelectorAll('.col-ratio-label').forEach(function (lab, i) {
          if (next[i] != null) lab.textContent = Math.round((next[i] / sum) * 100) + '%';
        });
        handle._liveRatios = next;
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('is-col-resizing');
        if (handle._liveRatios) {
          pushHistory();
          setColumnRatios(block, handle._liveRatios);
          markDirty();
          // refresh side panel if this columns block is selected
          if (selectedId === block.id) renderProperties();
        }
      }

      document.body.classList.add('is-col-resizing');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ---- Drop commit (never lose a block) ----

  // ---- Drop commit (never lose a block) ----

  function finishDrop(opts) {
    opts = opts || {};
    dragState = null;
    dropHint = null;
    clearDropClasses();
    document.body.classList.remove('is-dragging');
    if (!opts.skipRender) {
      renderCanvas();
      renderProperties();
    }
  }

  function commitDrop(hint) {
    if (!dragState || !hint) {
      clearDropClasses();
      return;
    }
    if (dropInProgress) return;
    dropInProgress = true;

    // Snapshot BEFORE any mutation. On failure, restore full tree.
    var snap = snapshotTree();
    var state = {
      kind: dragState.kind,
      blockId: dragState.blockId,
      blockType: dragState.blockType
    };

    var result;
    try {
      if (hint.mode === 'insert') result = doInsertMove(hint, state);
      else if (hint.mode === 'split') result = doSplitMove(hint, state);
      else result = { ok: false, reason: 'bad-mode' };

      if (!result || !result.ok) {
        if (result && result.mutated) restoreTree(snap);
        // no-op: tree unchanged; invalid: restored if needed
        dropInProgress = false;
        finishDrop();
        return;
      }

      // Hard safety: if a moved block disappeared, roll back completely.
      if (state.kind === 'block' && state.blockId && !findNode(state.blockId)) {
        console.error('Tapuz drop lost block, restoring', state.blockId);
        restoreTree(snap);
        dropInProgress = false;
        finishDrop();
        return;
      }

      // For split, also ensure target survived inside new columns.
      if (hint.mode === 'split' && hint.targetId && !findNode(hint.targetId)) {
        console.error('Tapuz split lost target, restoring', hint.targetId);
        restoreTree(snap);
        dropInProgress = false;
        finishDrop();
        return;
      }

      if (result.selectedId) selectedId = result.selectedId;
      pushHistorySnapshot(snap);
      dropInProgress = false;
      finishDrop();
      flashJustDropped(result.selectedId || state.blockId);
    } catch (err) {
      console.error('Tapuz drop failed, restoring tree', err);
      restoreTree(snap);
      dropInProgress = false;
      finishDrop();
    }
  }

  /** The landed block wobbles once — feedback that the drop took. */
  function flashJustDropped(id) {
    if (!id) return;
    var el = document.querySelector('.canvas-block[data-id="' + cssEsc(id) + '"]');
    if (!el) return;
    el.classList.add('just-dropped');
    el.addEventListener('animationend', function onEnd() {
      el.classList.remove('just-dropped');
      el.removeEventListener('animationend', onEnd);
    });
  }

  // ---- drag auto-scroll: the page follows the drag near viewport edges,
  // so long pages can be built with drag & drop without dropping blind ----
  var autoScrollVel = 0;
  var autoScrollRAF = null;
  function dragAutoScroll(e) {
    if (!document.body.classList.contains('is-dragging')) { autoScrollVel = 0; return; }
    var EDGE = 140;
    var MAX = 34;
    var y = e.clientY;
    var vh = window.innerHeight;
    if (y < EDGE) autoScrollVel = -MAX * (1 - y / EDGE);
    else if (y > vh - EDGE) autoScrollVel = MAX * (1 - (vh - y) / EDGE);
    else autoScrollVel = 0;
    if (autoScrollVel && !autoScrollRAF) {
      autoScrollRAF = requestAnimationFrame(function step() {
        autoScrollRAF = null;
        if (!autoScrollVel || !document.body.classList.contains('is-dragging')) return;
        window.scrollBy(0, autoScrollVel);
        autoScrollRAF = requestAnimationFrame(step);
      });
    }
  }
  document.addEventListener('dragover', dragAutoScroll);
  document.addEventListener('dragend', function () { autoScrollVel = 0; });
  document.addEventListener('drop', function () { autoScrollVel = 0; });

  function doInsertMove(hint, state) {
    var list = getLiveList(hint.parentId || null, hint.colIndex);
    if (!list) return { ok: false, reason: 'target-list-missing' };

    var index = typeof hint.index === 'number' ? hint.index : list.length;
    var incoming = null;
    var from = null;

    if (state.kind === 'block') {
      from = findNode(state.blockId);
      if (!from) return { ok: false, reason: 'source-missing' };

      // same-list no-op (drop on own edges)
      if (from.list === list && (from.index === index || from.index + 1 === index)) {
        return { ok: false, noop: true, reason: 'same-place' };
      }

      // cannot drop a block inside itself / its descendants
      if (wouldNestIntoSelf(from.block, hint.parentId)) {
        return { ok: false, reason: 'nest-into-self' };
      }

      // adjust index before removal when moving down in same list
      if (from.list === list && from.index < index) index -= 1;

      incoming = from.list.splice(from.index, 1)[0];

      // re-resolve destination AFTER removal (always live)
      list = getLiveList(hint.parentId || null, hint.colIndex);
      if (!list) {
        // should not happen for root; restore path handled by caller if we signal mutated
        blocks.push(incoming);
        return { ok: false, mutated: true, reason: 'list-gone-after-remove' };
      }
    } else if (state.kind === 'toolbox') {
      incoming = makeBlock(state.blockType);
    } else {
      return { ok: false, reason: 'bad-kind' };
    }

    if (!incoming) return { ok: false, mutated: state.kind === 'block', reason: 'no-incoming' };

    if (wouldNestIntoSelf(incoming, hint.parentId)) {
      // put back at root so safety net can restore from snap cleanly
      if (state.kind === 'block') blocks.push(incoming);
      return { ok: false, mutated: true, reason: 'nest-into-self-after' };
    }

    var safeIndex = Math.max(0, Math.min(index, list.length));
    list.splice(safeIndex, 0, incoming);
    return { ok: true, selectedId: incoming.id };
  }

  function doSplitMove(hint, state) {
    if (state.kind === 'block' && state.blockId === hint.targetId) {
      return { ok: false, noop: true, reason: 'split-self' };
    }
    if (state.kind === 'block' && isAncestor(state.blockId, hint.targetId)) {
      return { ok: false, reason: 'split-ancestor' };
    }

    var incoming = null;
    if (state.kind === 'block') {
      var from = findNode(state.blockId);
      if (!from) return { ok: false, reason: 'source-missing' };
      if (containsId(from.block, hint.targetId)) {
        return { ok: false, reason: 'target-inside-dragged' };
      }
      incoming = from.list.splice(from.index, 1)[0];
    } else if (state.kind === 'toolbox') {
      incoming = makeBlock(state.blockType);
    } else {
      return { ok: false, reason: 'bad-kind' };
    }

    if (!incoming) return { ok: false, mutated: state.kind === 'block', reason: 'no-incoming' };

    // target must still be findable after removing source
    var targetNode = findNode(hint.targetId);
    if (!targetNode) {
      if (state.kind === 'block') blocks.push(incoming);
      return { ok: false, mutated: true, reason: 'target-missing' };
    }

    if (isColumnsContainer(targetNode.block.type)) {
      if (state.kind === 'block') blocks.push(incoming);
      return { ok: false, mutated: true, reason: 'split-columns-container' };
    }

    var target = targetNode.list.splice(targetNode.index, 1)[0];
    var leftBlock;
    var rightBlock;
    // physical left/right; columns preview uses direction:ltr
    if (hint.side === 'left') {
      leftBlock = incoming;
      rightBlock = target;
    } else {
      leftBlock = target;
      rightBlock = incoming;
    }

    var colsBlock = makeBlock('columns');
    colsBlock.data.columns = [
      { blocks: [leftBlock] },
      { blocks: [rightBlock] }
    ];
    targetNode.list.splice(targetNode.index, 0, colsBlock);
    return { ok: true, selectedId: incoming.id };
  }

  // ---- Toolbox ----

  function bindToolboxDrag() {
    document.querySelectorAll('.tool-btn[data-type]').forEach(function (btn) {
      btn.setAttribute('draggable', 'true');

      // Click NEVER replaces (a misclick must not destroy content):
      //   empty container selected → the tool fills it;
      //   module selected         → the tool lands right below it;
      //   nothing selected        → append at the end.
      // Replacing a module's type is an explicit advanced action in the
      // settings panel (or the ⇄ button on the block toolbar).
      btn.addEventListener('click', function (e) {
        if (btn.dataset.didDrag === '1') {
          btn.dataset.didDrag = '0';
          return;
        }
        e.preventDefault();
        var type = btn.dataset.type;
        var sel = selectedId ? findNode(selectedId) : null;
        if (sel && isBlocksContainer(sel.block.type) && !ensureBlocks(sel.block).length) {
          pushHistory();
          var intoChild = makeBlock(type);
          ensureBlocks(sel.block).push(intoChild);
          selectedId = intoChild.id;
          renderCanvas();
          renderProperties();
          syncToolboxMode();
          flashCanvasHint('נוסף «' + typeLabel(type) + '» לתוך המיכל');
        } else if (sel) {
          pushHistory();
          var below = makeBlock(type);
          sel.list.splice(sel.index + 1, 0, below);
          selectedId = below.id;
          renderCanvas();
          renderProperties();
          syncToolboxMode();
          flashCanvasHint('נוסף «' + typeLabel(type) + '» מתחת למודול הנבחר');
        } else {
          addBlock(type);
        }
      });

      btn.addEventListener('dragstart', function (e) {
        btn.dataset.didDrag = '1';
        dragState = { kind: 'toolbox', blockType: btn.dataset.type };
        e.dataTransfer.setData('text/plain', 'toolbox:' + btn.dataset.type);
        e.dataTransfer.effectAllowed = 'copy';
        btn.classList.add('dragging-tool');
        document.body.classList.add('is-dragging');
        // bottom-sheet toolbox must not cover the canvas while dragging onto it
        document.body.classList.remove('toolbox-open');
      });
      btn.addEventListener('dragend', function () {
        btn.classList.remove('dragging-tool');
        setTimeout(function () { btn.dataset.didDrag = '0'; }, 0);
        if (dropInProgress) return;
        document.body.classList.remove('is-dragging');
        dragState = null;
        dropHint = null;
        clearDropClasses();
      });
    });
    syncToolboxMode();
  }

  // ---- Selection / properties ----

  function selectBlock(id, opts) {
    opts = opts || {};
    selectedId = id;
    if (!opts.skipCanvas) renderCanvas();
    if (!opts.skipProps) renderProperties();
    syncToolboxMode();
    // narrow viewports: the settings panel is a slide-over drawer —
    // selecting a block opens it, deselecting closes it (no-op on wide)
    document.body.classList.toggle('props-open', !!id);
    // the language dances with the canvas — highlight this block's BenTML
    if (!opts.fromSource && window.BentmlUI && typeof window.BentmlUI.onBlockSelect === 'function') {
      window.BentmlUI.onBlockSelect(id);
    }
  }

  /** Live-update canvas text from side panel without destroying the tree. */
  function liveUpdatePreview(id, key, val) {
    var nodes = document.querySelectorAll(
      '[data-inline-id="' + cssEsc(id) + '"][data-inline-key="' + cssEsc(key) + '"]'
    );
    nodes.forEach(function (target) {
      if (target.isContentEditable) return;
      if (key === 'content') {
        target.innerHTML = esc(val || '').replace(/\n/g, '<br>');
      } else {
        target.textContent = val || '';
      }
    });
    applyPreviewStyle(id);
  }

  function applyPreviewStyle(id) {
    var block = getBlock(id);
    if (!block) return;
    var host = document.querySelector('.canvas-block[data-id="' + cssEsc(id) + '"] .block-content');
    if (!host) return;
    var d = block.data || {};
    var s = d.style || {};
    host.style.textAlign = d.align === 'center' ? 'center' : d.align === 'end' ? 'end' : '';
    host.style.color = s.color || '';
    host.style.background = s.background || '';
    host.style.fontSize = s.fontSize === 'sm' ? '0.9em' : s.fontSize === 'lg' ? '1.2em' : '';
    host.style.padding = s.padding === 'sm' ? '0.35rem 0.5rem' : s.padding === 'md' ? '0.75rem 1rem' : s.padding === 'lg' ? '1.25rem 1.5rem' : '';
    host.style.borderRadius = s.radius === 'sm' ? '6px' : s.radius === 'md' ? '12px' : s.radius === 'lg' ? '20px' : '';
  }

  /**
   * Double-click to write directly in the container.
   * Commits to block.data and refreshes the side settings text.
   */
  function startInlineEdit(blockId, key) {
    var block = getBlock(blockId);
    if (!block) return;
    if (!block.data) block.data = {};
    var wasSelected = selectedId === blockId;
    selectedId = blockId;
    // Only rebuild the canvas when the SELECTION actually changed \u2014 clicking to
    // edit an already-selected block edits in place (no flicker, no lost caret).
    if (!wasSelected) renderCanvas();
    renderProperties();
    syncToolboxMode();

    var el = document.querySelector(
      '[data-inline-id="' + cssEsc(blockId) + '"][data-inline-key="' + cssEsc(key) + '"]'
    );
    if (!el) return;

    // The inline key IS the data field for every editable module \u2014 one path for
    // hero/heading/text/quote/testimonial AND the generic registry textFields
    // (cta/banner/marquee/\u2026). Only 'content' is multi-line.
    var multiline = key === 'content';
    var original = block.data[key] != null ? String(block.data[key]) : '';

    el.contentEditable = 'true';
    el.classList.add('inline-editing');
    el.focus();
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}

    var done = false;
    function commit(save) {
      if (done) return;
      done = true;
      el.contentEditable = 'false';
      el.classList.remove('inline-editing');
      if (save) {
        var text = (el.innerText || '').replace(/\u00a0/g, ' ');
        if (text !== original) {
          pushHistory();
          block.data[key] = text;
          markDirty();
        }
        renderProperties();
        if (multiline) el.innerHTML = esc(text).replace(/\n/g, '<br>');
        else el.textContent = text;
      } else {
        if (multiline) el.innerHTML = esc(original).replace(/\n/g, '<br>');
        else el.textContent = original;
      }
    }

    el.onblur = function () {
      commit(true);
    };
    el.onkeydown = function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        commit(false);
        el.blur();
      }
      // single-line fields: Enter commits
      if (e.key === 'Enter' && !multiline) {
        e.preventDefault();
        el.blur();
      }
      // live mirror to the side panel field while typing
      if (e.key !== 'Escape') {
        setTimeout(function () {
          var panelInput = document.querySelector('#properties-panel [data-key="' + key + '"]');
          if (panelInput && document.activeElement !== panelInput) {
            panelInput.value = (el.innerText || '').replace(/\u00a0/g, ' ');
          }
        }, 0);
      }
    };
  }

  function wireInlineEditable(root, block) {
    if (!root) return;
    root.querySelectorAll('[data-inline-key]').forEach(function (el) {
      el.setAttribute('data-inline-id', block.id);
      el.classList.add('inline-editable');
      el.title = 'לחצו כדי לכתוב — עריכה ישירה על הדף';
      var key = el.getAttribute('data-inline-key');
      // Foolproof: a SINGLE click starts editing (double-click kept for habit).
      // Once editing, clicks fall through so the caret can be placed normally.
      var start = function (e) {
        if (el.isContentEditable) return;
        e.preventDefault();
        e.stopPropagation();
        startInlineEdit(block.id, key);
      };
      el.addEventListener('click', start);
      el.addEventListener('dblclick', start);
    });
  }

  function field(label, inputHtml) {
    return '<div class="prop-group"><label>' + label + '</label>' + inputHtml + '</div>';
  }

  function buildReplaceChips(currentType) {
    var html = '<div class="replace-row">';
    MODULES.forEach(function (m) {
      var active = m.type === currentType ? ' active' : '';
      html +=
        '<button type="button" class="replace-chip' + active + '" data-replace="' +
        escAttr(m.type) +
        '" title="' + escAttr(m.hint) + '">' +
        '<span class="chip-icon">' + esc(m.icon) + '</span>' +
        esc(m.label) +
        '</button>';
    });
    html += '</div>';
    return html;
  }

  function syncToolboxMode() {
    var box = document.querySelector('.toolbox');
    if (!box) return;
    var mode = document.getElementById('toolbox-mode');
    var hasSel = !!(selectedId && getBlock(selectedId));
    box.classList.toggle('has-selection', hasSel);
    if (mode) {
      var selBlock = hasSel ? getBlock(selectedId) : null;
      var emptyContainerSel = !!(selBlock && isBlocksContainer(selBlock.type) && !ensureBlocks(selBlock).length);
      mode.innerHTML = emptyContainerSel
        ? 'מיכל ריק נבחר · <strong>לחיצה = מילוי המיכל</strong>'
        : hasSel
          ? 'נבחר מודול · <strong>לחיצה = הוספה מתחתיו</strong> · גרירה = מיקום חופשי'
          : 'גרור לקנבס · או לחץ להוספה בסוף';
    }
    document.querySelectorAll('.tool-btn[data-type]').forEach(function (btn) {
      var t = btn.dataset.type;
      var sel = hasSel ? getBlock(selectedId) : null;
      btn.classList.toggle('is-current', !!(sel && sel.type === t));
    });
    // the selected block's family unfolds so its highlighted tool is visible
    var cur = document.querySelector('.tool-btn.is-current');
    if (cur) {
      var cat = cur.closest('details.tool-cat');
      if (cat) cat.open = true;
    }
  }

  // ---- toolbox search: cuts across the folded categories ----
  function initToolSearch() {
    var search = document.getElementById('tool-search');
    if (!search) return;
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      document.querySelectorAll('.tool-cat').forEach(function (cat, i) {
        var any = false;
        cat.querySelectorAll('.tool-btn[data-type]').forEach(function (btn) {
          var hit = !q || btn.textContent.toLowerCase().indexOf(q) !== -1;
          btn.style.display = hit ? '' : 'none';
          if (hit) any = true;
        });
        cat.style.display = any ? '' : 'none';
        if (q) cat.open = true;
        else cat.open = false; // default: ALL families folded — a calm palette
      });
    });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && search.value) {
        search.value = '';
        search.dispatchEvent(new Event('input'));
        e.stopPropagation();
      }
    });
  }

  function bentmlKeywordFor(type) {
    // Registry-backed (MODULES carries keyword from src/block-registry.js)
    var m = MODULE_BY_TYPE[type];
    if (m && m.keyword) return m.keyword;
    var map = {
      hero: 'HERO', heading: 'HEADING', text: 'TEXT', button: 'BUTTON', image: 'IMAGE',
      embed: 'EMBED', gallery: 'GALLERY', 'article-list': 'ARTICLES', list: 'LIST',
      testimonial: 'TESTIMONIAL', features: 'FEATURES', columns: 'ROW', spacer: 'SPACE',
      divider: 'DIVIDER', quote: 'QUOTE', card: 'CARD', map: 'MAP'
    };
    return map[type] || String(type || '').toUpperCase();
  }

  // ─── Registry-generated settings forms (ask C) ───
  // The per-type settings UI is GENERATED from getBlockDef(type).params:
  // enum → select, boolean → toggle, integer → number (min/max),
  // media → input + library picker, url/string → input, textarea → textarea,
  // ratio → "2:1" input, list → item editor from itemFields.

  function renderParamControl(p, block) {
    var d = block.data || {};
    var cur = d[p.name] !== undefined ? d[p.name] : p.default;
    var label = esc(p.labelHe || p.name) + (p.required ? ' *' : '');
    var hint = p.hint ? '<div class="prop-hint">' + esc(p.hint) + '</div>' : '';
    var t = p.type;

    if (t === 'enum') {
      var opts = (p.enum || []).map(function (v) {
        return '<option value="' + escAttr(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(enumLabel(v)) + '</option>';
      }).join('');
      return field(label, '<select data-key="' + escAttr(p.name) + '">' + opts + '</select>') + hint;
    }
    if (t === 'boolean') {
      return '<div class="prop-group"><label class="check-line"><input type="checkbox" data-key="' + escAttr(p.name) + '"' +
        (cur ? ' checked' : '') + '> ' + esc(p.labelHe || p.name) + '</label></div>' + hint;
    }
    if (t === 'integer') {
      return field(label,
        '<input type="number" data-key="' + escAttr(p.name) + '"' +
        (p.min != null ? ' min="' + p.min + '"' : '') +
        (p.max != null ? ' max="' + p.max + '"' : '') +
        ' value="' + escAttr(cur != null ? cur : '') + '">') + hint;
    }
    if (t === 'media') {
      return field(label, '<input data-key="' + escAttr(p.name) + '" dir="ltr" value="' + escAttr(cur || '') + '" placeholder="/uploads/...">') +
        '<button type="button" class="btn" style="margin:2px 0 10px" data-media-param="' + escAttr(p.name) + '">בחר מהספרייה</button>' + hint;
    }
    if (t === 'url') {
      return field(label, '<input data-key="' + escAttr(p.name) + '" dir="ltr" value="' + escAttr(cur || '') + '">') + hint;
    }
    if (t === 'textarea') {
      return field(label, '<textarea data-key="' + escAttr(p.name) + '">' + esc(cur || '') + '</textarea>') + hint;
    }
    if (t === 'ratio') {
      return field(label, '<input data-key="' + escAttr(p.name) + '" dir="ltr" value="' + escAttr(cur || '') + '" placeholder="2:1">') + hint;
    }
    if (t === 'list') {
      return renderListParam(p, block) + hint;
    }
    // default: string
    return field(label, '<input data-key="' + escAttr(p.name) + '" value="' + escAttr(cur || '') + '">') + hint;
  }

  function renderListParam(p, block) {
    var d = block.data || {};
    var items = Array.isArray(d[p.name]) ? d[p.name] : [];
    var fields = p.itemFields || [{ name: 'text', labelHe: 'טקסט', type: 'string' }];
    var hasMedia = fields.some(function (f) { return f.type === 'media'; });
    var html = '<div class="prop-section-label">' + esc(p.labelHe || p.name) + '</div>';

    if (hasMedia) {
      // gallery-style thumbs + multi picker; empty slots hidden + cleanable
      var emptyCount = 0;
      var thumbs = '';
      items.forEach(function (im, i) {
        var src = mediaSrcOf(im);
        if (!src) { emptyCount++; return; }
        thumbs += '<div class="gallery-thumb"><img src="' + escAttr(src) + '" alt=""><button type="button" data-lp-del="' + i + '" data-lp="' + escAttr(p.name) + '" title="הסר">×</button></div>';
      });
      html += '<div class="gallery-edit">' + thumbs + '</div>';
      html += '<button type="button" class="btn" style="margin:6px 0" data-lp-media-add="' + escAttr(p.name) + '">+ הוסף תמונות מהספרייה</button>';
      if (emptyCount) {
        html += '<button type="button" class="btn secondary" style="margin:0 0 6px" data-lp-clean="' + escAttr(p.name) + '">🧹 נקה ' + emptyCount + ' משבצות ריקות</button>';
      }
      html += '<div class="prop-hint">' + (items.length - emptyCount) + ' פריטים</div>';
      return html;
    }

    if (fields.length === 1) {
      // compact editor: one line per item
      var fname = fields[0].name;
      var lines = items.map(function (it) {
        return typeof it === 'string' ? it : ((it && it[fname]) || '');
      });
      html += field('שורה לכל פריט', '<textarea data-lp-lines="' + escAttr(p.name) + '" data-lp-field="' + escAttr(fname) + '">' + esc(lines.join('\n')) + '</textarea>');
      return html;
    }

    items.forEach(function (it, i) {
      fields.forEach(function (f) {
        var v = (it && typeof it === 'object') ? (it[f.name] || '') : (f.name === fields[0].name ? (it || '') : '');
        var flabel = 'פריט ' + (i + 1) + ' — ' + esc(f.labelHe || f.name);
        if (f.type === 'textarea') {
          html += field(flabel, '<textarea data-lp="' + escAttr(p.name) + '" data-lp-i="' + i + '" data-lp-f="' + escAttr(f.name) + '">' + esc(v) + '</textarea>');
        } else {
          html += field(flabel, '<input data-lp="' + escAttr(p.name) + '" data-lp-i="' + i + '" data-lp-f="' + escAttr(f.name) + '" value="' + escAttr(v) + '">');
        }
      });
      html += '<button type="button" class="btn secondary" style="margin:0 0 12px;font-size:0.8rem;padding:4px 10px" data-lp-del="' + i + '" data-lp="' + escAttr(p.name) + '">− הסר פריט ' + (i + 1) + '</button>';
    });
    html += '<button type="button" class="btn secondary" style="margin:6px 0" data-lp-add="' + escAttr(p.name) + '">+ פריט</button>';
    return html;
  }

  function defaultListItem(p) {
    var fields = p.itemFields || [];
    if (fields.length <= 1) return '';
    var item = {};
    fields.forEach(function (f) { item[f.name] = ''; });
    return item;
  }

  /** Full generated form for a registry entry: body text field + all params. */
  function renderSchemaForm(def, block) {
    var d = block.data || {};
    var html = '';
    if (def.textField) {
      var tv = d[def.textField] || '';
      var tlabel = esc(def.textFieldLabelHe || 'טקסט');
      if (def.textFieldType === 'textarea') {
        html += field(tlabel, '<textarea data-key="' + escAttr(def.textField) + '">' + esc(tv) + '</textarea>');
      } else {
        html += field(tlabel, '<input data-key="' + escAttr(def.textField) + '" value="' + escAttr(tv) + '">');
      }
    }
    (def.params || []).forEach(function (p) {
      // align is rendered once in the shared "module style" section below
      if (p.name === 'align') return;
      html += renderParamControl(p, block);
    });
    return html;
  }

  /** Live-preview the page splash background on the builder canvas. */
  function applyCanvasPageBg() {
    var wrap = document.querySelector('.builder-canvas-wrap');
    if (!wrap) return;
    var b = (pageMeta.background && typeof pageMeta.background === 'object') ? pageMeta.background : {};
    if (b.image) {
      var ov = Math.min(Math.max(parseInt(b.overlay, 10) || 0, 0), 85) / 100;
      var grad = ov > 0 ? 'linear-gradient(rgba(0,0,0,' + ov + '),rgba(0,0,0,' + ov + ')),' : '';
      wrap.style.backgroundImage = grad + "url('" + String(b.image).replace(/['"\\]/g, '') + "')";
      wrap.style.backgroundSize = 'cover';
      wrap.style.backgroundPosition = 'center';
      wrap.style.backgroundAttachment = b.parallax ? 'fixed' : 'scroll';
      wrap.style.padding = '18px';
      wrap.style.borderRadius = '14px';
    } else if (b.color) {
      wrap.style.background = String(b.color).replace(/[^#\w(),.%\s-]/g, '');
      wrap.style.backgroundImage = '';
      wrap.style.padding = '18px';
      wrap.style.borderRadius = '14px';
    } else {
      wrap.style.backgroundImage = '';
      wrap.style.background = '';
      wrap.style.padding = '';
    }
  }

  function renderProperties() {
    var panel = document.getElementById('properties-panel');
    if (!panel) return;

    var node = selectedId ? findNode(selectedId) : null;
    if (!node) {
      var isArticle = pageTags.indexOf('article') !== -1;
      var pageHtml =
        '<div class="prop-type-head">' +
        '<span class="prop-type-icon">📄</span>' +
        '<div><div class="prop-type-name">מאפייני דף</div>' +
        '<div class="prop-type-sub">כל-ב-אחד · SEO · מאמרים · בלי תוספים</div></div></div>' +
        '<div class="prop-section-label">תוכן / מבנה</div>' +
        field('כתובת הדף (slug)',
          '<input data-page-slug dir="ltr" value="' + escAttr(currentSlug) + '" placeholder="נוצרת מהכותרת">') +
        '<div class="prop-hint" style="margin:-6px 0 12px">משתנה אוטומטית לפי הכותרת. עריכה ידנית קובעת כתובת קבועה (מחיקה = חזרה לאוטומטי).</div>' +
        '<div class="prop-group">' +
        '<label class="check-line"><input type="checkbox" data-page-article="1"' + (isArticle ? ' checked' : '') + '> דף מאמר (יופיע בקוביות מאמרים)</label>' +
        '</div>' +
        // v0.64: assign this page to categories — each is just a portable tag
        '<div class="prop-group" id="page-cats-box" style="display:none">' +
        '<div style="font-size:0.82rem;font-weight:600;margin-bottom:4px">קטגוריות (הדף יופיע בבלוק הקטגוריה)</div>' +
        '<div id="page-cats"></div></div>';
      if (isArticle) {
        pageHtml += field('תקציר לקובייה', '<textarea data-page-meta="teaser" placeholder="ריק = נלקח אוטומטית מהטקסט הראשון">' + esc(pageMeta.teaser || '') + '</textarea>');
        pageHtml += field('תמונת קובייה (URL)', '<input data-page-meta="cardImage" dir="ltr" value="' + escAttr(pageMeta.cardImage || '') + '" placeholder="ריק = התמונה הראשונה בדף">');
        pageHtml += '<button type="button" class="btn" style="margin:6px 0 12px" data-page-card-media="1">בחר תמונה מהספרייה</button>';
      }
      var pbg = (pageMeta.background && typeof pageMeta.background === 'object') ? pageMeta.background : {};
      pageHtml +=
        '<div class="prop-section-label">רקע הדף · splash</div>' +
        field('תמונת רקע לכל הדף', '<input data-page-bg="image" dir="ltr" value="' + escAttr(pbg.image || '') + '" placeholder="/uploads/… או ריק">') +
        '<button type="button" class="btn" style="margin:2px 0 10px" data-page-bg-media="1">בחר תמונת רקע מהספרייה</button>' +
        field('כהות שכבה כהה · ' + (parseInt(pbg.overlay, 10) || 0) + '%', '<input type="range" min="0" max="85" step="5" data-page-bg="overlay" value="' + (parseInt(pbg.overlay, 10) || 0) + '">') +
        '<label class="check-line" style="margin:2px 0 8px"><input type="checkbox" data-page-bg="parallax"' + (pbg.parallax ? ' checked' : '') + '> תמונה נעה בגלילה (parallax כמו onepage)</label>' +
        field('צבע רקע (אם אין תמונה)', '<input type="color" data-page-bg="color" value="' + escAttr(pbg.color || '#ffffff') + '">') +
        '<div class="prop-hint" style="margin-bottom:12px">התמונה מופיעה מאחורי הדף. הפעילו parallax ל"תמונת שער נעה" בזמן גלילה.</div>';
      pageHtml +=
        '<div class="prop-section-label">SEO (נקודת פתיחה ברמה של CMS גדול)</div>' +
        field('כותרת SEO / Title', '<input data-page-meta="seoTitle" value="' + escAttr(pageMeta.seoTitle || '') + '" placeholder="ריק = כותרת הדף">') +
        field('תיאור (meta description)', '<textarea data-page-meta="description" placeholder="תיאור לגוגל — עד ~160 תווים">' + esc(pageMeta.description || '') + '</textarea>') +
        field('תמונת שיתוף (og:image)', '<input data-page-meta="ogImage" dir="ltr" value="' + escAttr(pageMeta.ogImage || pageMeta.ogimage || '') + '" placeholder="/uploads/...">') +
        '<button type="button" class="btn" style="margin:2px 0 12px" data-page-og-media="1">בחר תמונת שיתוף מהספרייה</button>' +
        field(
          'אינדוקס',
          '<select data-page-meta="robots">' +
            '<option value=""' + (!pageMeta.robots ? ' selected' : '') + '>index, follow (ברירת מחדל)</option>' +
            '<option value="noindex"' + (pageMeta.robots === 'noindex' ? ' selected' : '') + '>noindex</option>' +
            '<option value="nofollow"' + (pageMeta.robots === 'nofollow' ? ' selected' : '') + '>nofollow</option>' +
            '<option value="noindex,nofollow"' + (pageMeta.robots === 'noindex,nofollow' ? ' selected' : '') + '>noindex, nofollow</option>' +
          '</select>'
        ) +
        '<div class="prop-hint">SEO מובנה בחבילה — לא תוסף. סוכנים כותבים description ב־META BenTML.</div>';
      pageHtml +=
        '<hr style="margin:14px 0;opacity:.25">' +
        '<div class="props-empty">' +
        '<div class="props-empty-title">אין מודול נבחר</div>' +
        '<div class="props-empty-line"><strong>הוספה</strong> — לחץ או גרור מהסרגל</div>' +
        '<div class="props-empty-line"><strong>סידור</strong> — גרור ⠿ בין מודולים</div>' +
        '<div class="props-empty-line"><strong>פיצול</strong> — גרור לצד מודול / ⧉</div>' +
        '<div class="props-empty-line"><strong>החלפה</strong> — בחר מודול · «החלף סוג מודול» בהגדרות (מתקדם)</div>' +
        '</div>';
      panel.innerHTML = pageHtml;

      var artToggle = panel.querySelector('[data-page-article]');
      if (artToggle) {
        artToggle.addEventListener('change', function () {
          var i = pageTags.indexOf('article');
          if (artToggle.checked && i === -1) pageTags.push('article');
          if (!artToggle.checked && i !== -1) pageTags.splice(i, 1);
          markDirty();
          renderProperties();
        });
      }
      // v0.64: category checkboxes (fetched once, cached) toggle category slugs
      // in pageTags — membership rides on the page's portable tags.
      loadCategoriesOnce(function (cats) {
        var box = document.getElementById('page-cats-box');
        var host = document.getElementById('page-cats');
        if (!box || !host || !cats.length) return;
        box.style.display = '';
        host.innerHTML = cats.map(function (c) {
          var on = pageTags.indexOf(c.slug) !== -1;
          return '<label class="check-line"><input type="checkbox" data-page-cat="' + escAttr(c.slug) + '"' + (on ? ' checked' : '') + '> ' +
            esc(c.name || c.slug) + '</label>';
        }).join('');
        host.querySelectorAll('[data-page-cat]').forEach(function (cb) {
          cb.addEventListener('change', function () {
            var slug = cb.dataset.pageCat;
            var i = pageTags.indexOf(slug);
            if (cb.checked && i === -1) pageTags.push(slug);
            if (!cb.checked && i !== -1) pageTags.splice(i, 1);
            markDirty();
          });
        });
      });
      panel.querySelectorAll('[data-page-meta]').forEach(function (input) {
        var applyMeta = function () {
          var v = input.value.trim();
          if (v) pageMeta[input.dataset.pageMeta] = v;
          else delete pageMeta[input.dataset.pageMeta];
          markDirty();
        };
        input.addEventListener('input', applyMeta);
        input.addEventListener('blur', applyMeta);
      });
      var slugField = panel.querySelector('[data-page-slug]');
      if (slugField) {
        slugField.addEventListener('input', function () { slugTouched = true; markDirty(); });
        slugField.addEventListener('blur', function () {
          var v = slugify(slugField.value);
          if (!v) {
            // cleared → re-enable auto-follow from the title
            slugTouched = false;
            var t = document.getElementById('page-title');
            currentSlug = slugify(t ? t.value : '');
          } else {
            currentSlug = v;
          }
          slugField.value = currentSlug;
        });
      }
      var cardMedia = panel.querySelector('[data-page-card-media]');
      if (cardMedia) {
        cardMedia.addEventListener('click', function () {
          openMediaGallery(function (picked) {
            if (picked && picked.length) {
              pageMeta.cardImage = typeof picked[0] === 'string' ? picked[0] : (picked[0].src || '');
              markDirty();
              renderProperties();
            }
          });
        });
      }
      var ogMedia = panel.querySelector('[data-page-og-media]');
      if (ogMedia) {
        ogMedia.addEventListener('click', function () {
          openMediaSingle(function (url) {
            pageMeta.ogImage = url;
            markDirty();
            renderProperties();
          });
        });
      }
      // Page splash background (v0.52) — write to pageMeta.background, live-preview on canvas.
      function ensureBg() {
        if (!pageMeta.background || typeof pageMeta.background !== 'object') pageMeta.background = {};
        return pageMeta.background;
      }
      panel.querySelectorAll('[data-page-bg]').forEach(function (input) {
        var apply = function () {
          var b = ensureBg();
          var k = input.getAttribute('data-page-bg');
          if (input.type === 'checkbox') b[k] = input.checked;
          else if (input.type === 'range') { b[k] = parseInt(input.value, 10) || 0; var lab = input.closest('.prop-group'); if (lab) { var l = lab.querySelector('label'); if (l) l.textContent = 'כהות שכבה כהה · ' + b[k] + '%'; } }
          else { var v = input.value.trim(); if (v) b[k] = v; else delete b[k]; }
          markDirty();
          applyCanvasPageBg();
        };
        input.addEventListener('input', apply);
        input.addEventListener('change', apply);
      });
      var bgMedia = panel.querySelector('[data-page-bg-media]');
      if (bgMedia) {
        bgMedia.addEventListener('click', function () {
          openMediaSingle(function (url) { ensureBg().image = url; markDirty(); renderProperties(); applyCanvasPageBg(); });
        });
      }
      applyCanvasPageBg();
      syncToolboxMode();
      return;
    }

    var block = node.block;
    var d = block.data || {};
    var nestHint = '';
    if (node.parent) {
      if (isColumnsContainer(node.parent.type)) {
        nestHint = '<div class="nest-hint">בתוך עמודות · טור ' + ((parseInt(node.colIndex, 10) || 0) + 1) + '</div>';
      } else {
        nestHint = '<div class="nest-hint">בתוך ' + esc(typeLabel(node.parent.type)) + '</div>';
      }
    }

    var kw = bentmlKeywordFor(block.type);
    var snips = (window.BentmlUI && window.BentmlUI.AGENT_SNIPPETS) || {};
    var snip = snips[kw] || (kw + ' { … }');
    var st = d.style || {};
    var html =
      nestHint +
      '<div class="prop-type-head">' +
      '<span class="prop-type-icon">' + esc(typeIcon(block.type)) + '</span>' +
      '<div>' +
      '<div class="prop-type-name">' + esc(typeLabel(block.type)) + '</div>' +
      '<div class="prop-type-sub">בחרת מכולה · ערוך כאן או לחיצה כפולה על הטקסט בדף</div>' +
      '</div></div>' +
      '<div class="prop-section-label">תוכן</div>';

    // Ask C: for every type the registry describes, the settings form is
    // GENERATED from the schema. Only genuinely bespoke editors remain
    // hand-written: text (advanced container), card + columns (nesting
    // containers). The chain below the first branch is a legacy fallback for
    // servers that don't inject the registry.
    var regDef = registryDef(block.type);
    var HAND_WRITTEN = { text: 1, columns: 1 };
    if (isBlocksContainer(block.type)) {
      // Container (card, parallax, …): render its own schema params (image /
      // overlay / height for parallax; none for card) then the nesting
      // affordance — drag modules in, or add one here.
      if (regDef) html += renderSchemaForm(regDef, block);
      var innerCount = (block.data && Array.isArray(block.data.blocks)) ? block.data.blocks.length : 0;
      html +=
        '<div class="prop-hint">' + esc(typeLabel(block.type)) +
        ' = מכולה. גררו מודולים פנימה מהסרגל (או הוסיפו למטה). ' +
        innerCount + ' מודולים בפנים.</div>';
      html += '<button type="button" class="btn" data-container-add-text="1">+ טקסט במכולה</button>';
    } else if (regDef && !HAND_WRITTEN[block.type]) {
      html += renderSchemaForm(regDef, block);
      if (block.type === 'spacer') {
        var exactPx = /^\d+px$/.test(String(d.height || '')) ? parseInt(d.height, 10) : '';
        html += field(
          'גובה מדויק (פיקסלים)',
          '<input type="number" min="0" max="800" step="2" data-spacer-px="1" value="' + exactPx + '" placeholder="למשל 120">'
        );
        html += '<div class="prop-hint">ריק = לפי הגודל למעלה · ערך = בדיוק הרווח שרוצים</div>';
      }
    } else if (block.type === 'hero') {
      html += field('כותרת', '<input data-key="title" value="' + escAttr(d.title || '') + '">');
      html += field('תת כותרת', '<input data-key="subtitle" value="' + escAttr(d.subtitle || '') + '">');
      html += field('טקסט כפתור', '<input data-key="buttonText" value="' + escAttr(d.buttonText || '') + '">');
      html += field('קישור כפתור', '<input data-key="buttonUrl" value="' + escAttr(d.buttonUrl || '') + '">');
      html += field('תמונת רקע', '<input data-key="image" value="' + escAttr(d.image || '') + '" dir="ltr" placeholder="/uploads/...">');
      html += '<button type="button" class="btn" style="margin:6px 0 12px" data-media-hero="' + escAttr(block.id) + '">בחר רקע ממדיה</button>';
      html += field(
        'גובה',
        '<select data-key="height">' +
          '<option value="sm"' + (d.height === 'sm' ? ' selected' : '') + '>קטן</option>' +
          '<option value="md"' + (!d.height || d.height === 'md' ? ' selected' : '') + '>רגיל</option>' +
          '<option value="lg"' + (d.height === 'lg' ? ' selected' : '') + '>גדול</option>' +
          '<option value="full"' + (d.height === 'full' ? ' selected' : '') + '>מסך מלא</option>' +
        '</select>'
      );
    } else if (block.type === 'heading') {
      html += field('טקסט', '<input data-key="text" value="' + escAttr(d.text || '') + '">');
      html += field('רמה (1-6)', '<input type="number" min="1" max="6" data-key="level" value="' + (d.level || 2) + '">');
    } else if (block.type === 'text') {
      html +=
        '<div class="text-format-bar">' +
        '<span class="prop-hint">מיכל מתקדם — סימון בתוך הטקסט:</span> ' +
        '<button type="button" class="btn secondary fmt-btn" data-fmt="B" title="מודגש">B</button>' +
        '<button type="button" class="btn secondary fmt-btn" data-fmt="I" title="נטוי"><em>I</em></button>' +
        '<button type="button" class="btn secondary fmt-btn" data-fmt="LINK" title="קישור">🔗</button>' +
        '</div>';
      html += field(
        'תוכן',
        '<textarea data-key="content" class="text-body-field" rows="8">' +
          esc(d.content || '') +
          '</textarea>'
      );
      html +=
        '<div class="prop-hint">@B{מודגש} · @I{נטוי} · @LINK(url: "/x"){טקסט} · שורה ריקה = פסקה</div>';
      html += field(
        'גודל',
        '<select data-key="size">' +
          '<option value="sm"' + (d.size === 'sm' ? ' selected' : '') + '>קטן</option>' +
          '<option value="md"' + (!d.size || d.size === 'md' ? ' selected' : '') + '>רגיל</option>' +
          '<option value="lg"' + (d.size === 'lg' ? ' selected' : '') + '>גדול</option>' +
        '</select>'
      );
      html += field(
        'רוחב מקסימלי',
        '<select data-key="maxWidth">' +
          '<option value="full"' + (!d.maxWidth || d.maxWidth === 'full' ? ' selected' : '') + '>מלא</option>' +
          '<option value="lg"' + (d.maxWidth === 'lg' ? ' selected' : '') + '>רחב</option>' +
          '<option value="md"' + (d.maxWidth === 'md' ? ' selected' : '') + '>בינוני</option>' +
          '<option value="sm"' + (d.maxWidth === 'sm' ? ' selected' : '') + '>צר (קריא)</option>' +
        '</select>'
      );
      html +=
        '<div class="prop-group"><label class="check-line"><input type="checkbox" data-bool="lead"' +
        (d.lead ? ' checked' : '') +
        '> פסקת פתיח (lead)</label></div>';
      html +=
        '<div class="prop-group"><label class="check-line"><input type="checkbox" data-bool="dropcap"' +
        (d.dropcap ? ' checked' : '') +
        '> אות פתיחה גדולה</label></div>';
    } else if (block.type === 'button') {
      html += field('טקסט', '<input data-key="text" value="' + escAttr(d.text || '') + '">');
      html += field('קישור', '<input data-key="url" value="' + escAttr(d.url || '') + '">');
      html += field(
        'סגנון',
        '<select data-key="variant">' +
          '<option value="primary"' + (d.variant === 'primary' || !d.variant ? ' selected' : '') + '>ראשי</option>' +
          '<option value="secondary"' + (d.variant === 'secondary' ? ' selected' : '') + '>משני</option>' +
          '<option value="outline"' + (d.variant === 'outline' ? ' selected' : '') + '>מתאר</option>' +
        '</select>'
      );
    } else if (block.type === 'image') {
      html += field('כתובת תמונה (URL)', '<input data-key="src" value="' + escAttr(d.src || '') + '">');
      html += '<button type="button" class="btn" style="margin:6px 0 12px" data-media="' + escAttr(block.id) + '">בחר מספריית מדיה</button>';
      html += field('Alt (SEO)', '<input data-key="alt" value="' + escAttr(d.alt || '') + '">');
      html += field('כיתוב', '<input data-key="caption" value="' + escAttr(d.caption || '') + '">');
      html += field(
        'רוחב',
        '<select data-key="width">' +
          '<option value="full"' + (!d.width || d.width === 'full' ? ' selected' : '') + '>מלא</option>' +
          '<option value="lg"' + (d.width === 'lg' ? ' selected' : '') + '>גדול</option>' +
          '<option value="md"' + (d.width === 'md' ? ' selected' : '') + '>בינוני</option>' +
          '<option value="sm"' + (d.width === 'sm' ? ' selected' : '') + '>קטן</option>' +
        '</select>'
      );
    } else if (block.type === 'quote') {
      html += field('ציטוט', '<textarea data-key="text">' + esc(d.text || '') + '</textarea>');
      html += field('מקור', '<input data-key="author" value="' + escAttr(d.author || '') + '">');
    } else if (block.type === 'map') {
      html += field('כתובת', '<input data-key="address" value="' + escAttr(d.address || '') + '" placeholder="תל אביב">');
      html += field('זום (1–20)', '<input type="number" min="1" max="20" data-key="zoom" value="' + (d.zoom || 15) + '">');
      html += field(
        'גובה',
        '<select data-key="height">' +
          '<option value="sm"' + (d.height === 'sm' ? ' selected' : '') + '>קטן</option>' +
          '<option value="md"' + (!d.height || d.height === 'md' ? ' selected' : '') + '>רגיל</option>' +
          '<option value="lg"' + (d.height === 'lg' ? ' selected' : '') + '>גדול</option>' +
        '</select>'
      );
    } else if (block.type === 'cta') {
      html += field('כותרת', '<input data-key="title" value="' + escAttr(d.title || '') + '">');
      html += field('טקסט', '<textarea data-key="text">' + esc(d.text || '') + '</textarea>');
      html += field('טקסט כפתור', '<input data-key="buttonText" value="' + escAttr(d.buttonText || '') + '">');
      html += field('קישור', '<input data-key="url" value="' + escAttr(d.url || '#') + '">');
      html += field(
        'סגנון כפתור',
        '<select data-key="variant">' +
          '<option value="primary"' + (d.variant !== 'secondary' && d.variant !== 'outline' ? ' selected' : '') + '>ראשי</option>' +
          '<option value="secondary"' + (d.variant === 'secondary' ? ' selected' : '') + '>משני</option>' +
          '<option value="outline"' + (d.variant === 'outline' ? ' selected' : '') + '>מתאר</option>' +
        '</select>'
      );
      html += field(
        'רקע הפס',
        '<select data-key="tone">' +
          '<option value="brand"' + (!d.tone || d.tone === 'brand' ? ' selected' : '') + '>מותג</option>' +
          '<option value="dark"' + (d.tone === 'dark' ? ' selected' : '') + '>כהה</option>' +
          '<option value="light"' + (d.tone === 'light' ? ' selected' : '') + '>בהיר</option>' +
        '</select>'
      );
    } else if (block.type === 'stats') {
      html += field('עמודות', '<input type="number" min="2" max="4" data-key="columns" value="' + (d.columns || 3) + '">');
      var stItems = d.items || [];
      stItems.forEach(function (it, i) {
        html += field('ערך ' + (i + 1), '<input data-stat="' + i + '" data-skey="value" value="' + escAttr(it.value || '') + '">');
        html += field('תווית ' + (i + 1), '<input data-stat="' + i + '" data-skey="label" value="' + escAttr(it.label || '') + '">');
      });
      html += '<button type="button" class="btn secondary" data-add-stat="1">+ מדד</button>';
    } else if (block.type === 'faq') {
      var fq = d.items || [];
      fq.forEach(function (it, i) {
        html += field('שאלה ' + (i + 1), '<input data-faq="' + i + '" data-fkey="question" value="' + escAttr(it.question || '') + '">');
        html += field('תשובה ' + (i + 1), '<textarea data-faq="' + i + '" data-fkey="answer">' + esc(it.answer || '') + '</textarea>');
      });
      html += '<button type="button" class="btn secondary" data-add-faq="1">+ שאלה</button>';
    } else if (block.type === 'logos') {
      html += '<div class="prop-hint">לוגואים — PLACEHOLDER עד העלאה. ניתן לערוך URL לכל לוגו.</div>';
      (d.items || []).forEach(function (it, i) {
        html += field('לוגו ' + (i + 1) + ' src', '<input data-logo="' + i + '" data-lkey="src" dir="ltr" value="' + escAttr(it.src || '') + '">');
        html += field('לוגו ' + (i + 1) + ' alt', '<input data-logo="' + i + '" data-lkey="alt" value="' + escAttr(it.alt || '') + '">');
      });
      html += '<button type="button" class="btn secondary" data-add-logo="1">+ לוגו</button>';
    } else if (block.type === 'contact-info') {
      html += field('טלפון', '<input data-key="phone" value="' + escAttr(d.phone || '') + '">');
      html += field('אימייל', '<input data-key="email" value="' + escAttr(d.email || '') + '">');
      html += field('כתובת', '<input data-key="address" value="' + escAttr(d.address || '') + '">');
      html += field('שעות', '<input data-key="hours" value="' + escAttr(d.hours || '') + '">');
    } else if (block.type === 'banner') {
      html += field('הודעה', '<input data-key="text" value="' + escAttr(d.text || '') + '">');
      html += field(
        'סגנון',
        '<select data-key="tone">' +
          '<option value="brand"' + (!d.tone || d.tone === 'brand' ? ' selected' : '') + '>מותג</option>' +
          '<option value="dark"' + (d.tone === 'dark' ? ' selected' : '') + '>כהה</option>' +
          '<option value="light"' + (d.tone === 'light' ? ' selected' : '') + '>בהיר</option>' +
          '<option value="warn"' + (d.tone === 'warn' ? ' selected' : '') + '>אזהרה</option>' +
        '</select>'
      );
    } else if (block.type === 'testimonial') {
      html += field('ציטוט', '<textarea data-key="quote">' + esc(d.quote || '') + '</textarea>');
      html += field('שם', '<input data-key="author" value="' + escAttr(d.author || '') + '">');
    } else if (block.type === 'spacer') {
      html += field(
        'גודל',
        '<select data-key="size" data-spacer-size="1">' +
          '<option value="sm"' + (d.size === 'sm' ? ' selected' : '') + '>קטן</option>' +
          '<option value="md"' + (!d.size || d.size === 'md' ? ' selected' : '') + '>בינוני</option>' +
          '<option value="lg"' + (d.size === 'lg' ? ' selected' : '') + '>גדול</option>' +
          '<option value="xl"' + (d.size === 'xl' ? ' selected' : '') + '>ענק</option>' +
        '</select>'
      );
    } else if (block.type === 'divider') {
      html += field(
        'סגנון',
        '<select data-key="bentStyle">' +
          '<option value="line"' + (!d.bentStyle || d.bentStyle === 'line' ? ' selected' : '') + '>קו</option>' +
          '<option value="dots"' + (d.bentStyle === 'dots' ? ' selected' : '') + '>נקודות</option>' +
          '<option value="thick"' + (d.bentStyle === 'thick' ? ' selected' : '') + '>עבה</option>' +
        '</select>'
      );
    } else if (block.type === 'features') {
      var items = d.items || [{ title: '', description: '' }];
      items.forEach(function (it, i) {
        html += field(
          'פריט ' + (i + 1) + ' — כותרת',
          '<input data-feat="' + i + '" data-fkey="title" value="' + escAttr(it.title || '') + '">'
        );
        html += field(
          'פריט ' + (i + 1) + ' — תיאור',
          '<textarea data-feat="' + i + '" data-fkey="description">' + esc(it.description || '') + '</textarea>'
        );
      });
      html += '<button type="button" class="btn secondary" style="margin:6px 0" data-add-feat="1">+ פריט</button>';
    } else if (block.type === 'list') {
      var liTexts = (d.items || []).map(function (it) {
        return typeof it === 'string' ? it : (it.text || '');
      });
      html += field('פריטים (שורה לכל פריט)', '<textarea data-list-items="1">' + esc(liTexts.join('\n')) + '</textarea>');
      html += field('סוג רשימה', '<label class="check-line"><input type="checkbox" data-list-ordered="1"' + (d.ordered ? ' checked' : '') + '> ממוספרת (1, 2, 3…)</label>');
    } else if (block.type === 'embed') {
      html += field('קישור (YouTube או כל URL)', '<input data-key="url" dir="ltr" value="' + escAttr(d.url || '') + '" placeholder="https://www.youtube.com/watch?v=...">');
      html += '<div class="prop-hint">קישור YouTube הופך לנגן מוטמע באתר המפורסם</div>';
    } else if (block.type === 'gallery') {
      // Only REAL photos are shown — empty slots (e.g. from imports) are
      // invisible dead weight; surface them once with a one-click cleanup.
      var galImgs = d.images || [];
      var galEmptyCount = 0;
      var galThumbs = '';
      galImgs.forEach(function (im, i) {
        var src = mediaSrcOf(im);
        if (!src) { galEmptyCount++; return; }
        galThumbs += '<div class="gallery-thumb"><img src="' + escAttr(src) + '" alt=""><button type="button" data-gal-del="' + i + '" title="הסר">×</button></div>';
      });
      html += '<div class="gallery-edit">' + galThumbs + '</div>';
      html += '<button type="button" class="btn" style="margin:6px 0" data-gal-add="1">+ הוסף תמונות מהספרייה</button>';
      if (galEmptyCount) {
        html += '<button type="button" class="btn secondary" style="margin:0 0 6px" data-gal-clean="1">🧹 נקה ' + galEmptyCount + ' משבצות ריקות</button>';
      }
      html += '<div class="prop-hint">' + (galImgs.length - galEmptyCount) + ' תמונות בגלריה · לחיצה ימנית בספרייה = אפשרויות</div>';
    } else if (block.type === 'article-list') {
      html += field('תגית (אילו דפים להציג)', '<input data-key="tag" value="' + escAttr(d.tag || 'article') + '" placeholder="article">');
      html += field('כמות מקסימלית', '<input type="number" min="1" max="48" data-key="limit" value="' + (parseInt(d.limit, 10) || 6) + '">');
      html += field('עמודות (1-4)', '<input type="number" min="1" max="4" data-key="columns" value="' + (parseInt(d.columns, 10) || 3) + '">');
      html += '<div class="prop-hint">מציג דפים מפורסמים עם התגית, מהחדש לישן. תמונה ותקציר לכל קובייה נלקחים ממאפייני הדף של המאמר — או אוטומטית מהתמונה והטקסט הראשונים שלו.</div>';
    } else if (block.type === 'columns') {
      var ratiosNow = parseColumnRatios(block);
      html +=
        '<div class="prop-hint" style="margin-bottom:8px">' +
        'מכולת טורים · גררו מודולים פנימה · <strong>גררו את הידית בין הטורים</strong> לשינוי רוחב (חצאים וכו׳)' +
        '</div>';
      html += field(
        'יחס רוחב (לסוכן: ratio)',
        '<input data-key="ratio" dir="ltr" value="' +
          escAttr(d.ratio || ratiosNow.join(':')) +
          '" placeholder="1:1 או 2:1">'
      );
      html += '<div class="prop-hint">דוגמאות: 1:1 · 2:1 · 1:2:1 — גם BenTML: ROW(ratio: "2:1")</div>';
      html += '<button type="button" class="btn" style="margin:4px" data-col="0">+ הוסף לטור 1</button>';
      html += '<button type="button" class="btn" style="margin:4px" data-col="1">+ הוסף לטור 2</button>';
      if (ensureColumns(block).length < 4) {
        html += '<button type="button" class="btn secondary" style="margin:4px" data-add-col="1">+ טור נוסף</button>';
      }
      html += '<button type="button" class="btn secondary" style="margin:4px;width:100%" data-unwrap="1">פרק עמודות (השטח הכל)</button>';
    }

    // ── Replace type (advanced, folded — a misclick can't nuke content) ──
    html +=
      '<details class="style-advanced replace-advanced">' +
      '<summary>החלף סוג מודול <span class="adv-badge">מתקדם</span></summary>' +
      '<div class="prop-hint" style="margin-bottom:8px">ממיר את המודול לסוג אחר — טקסט ותמונות עוברים איתו כשאפשר.</div>' +
      buildReplaceChips(block.type) +
      '</details>';

    // ── Style (first advanced module surface) ──
    html +=
      '<details class="style-advanced" open>' +
      '<summary>עיצוב מודול <span class="adv-badge">מתקדם</span></summary>' +
      '<div class="prop-hint" style="margin-bottom:8px">בלי HTML — בחר ערכים. המפתח לא צריך לחשוב על CSS.</div>' +
      field(
        'יישור',
        '<select data-key="align">' +
          '<option value="start"' + (!d.align || d.align === 'start' ? ' selected' : '') + '>התחלה</option>' +
          '<option value="center"' + (d.align === 'center' ? ' selected' : '') + '>מרכז</option>' +
          '<option value="end"' + (d.align === 'end' ? ' selected' : '') + '>סוף</option>' +
        '</select>'
      ) +
      field(
        'גודל טקסט',
        '<select data-style="fontSize">' +
          '<option value=""' + (!st.fontSize ? ' selected' : '') + '>רגיל</option>' +
          '<option value="sm"' + (st.fontSize === 'sm' ? ' selected' : '') + '>קטן</option>' +
          '<option value="lg"' + (st.fontSize === 'lg' ? ' selected' : '') + '>גדול</option>' +
        '</select>'
      ) +
      field('צבע טקסט', '<input type="color" data-style="color" value="' + escAttr(st.color || '#334155') + '">') +
      field('רקע', '<input type="color" data-style="background" value="' + escAttr(st.background || '#ffffff') + '">') +
      '<button type="button" class="btn secondary" data-clear-bg="1" style="margin-bottom:8px;width:100%">נקה רקע</button>' +
      field(
        'ריפוד פנימי',
        '<select data-style="padding">' +
          '<option value=""' + (!st.padding ? ' selected' : '') + '>ללא</option>' +
          '<option value="sm"' + (st.padding === 'sm' ? ' selected' : '') + '>קטן</option>' +
          '<option value="md"' + (st.padding === 'md' ? ' selected' : '') + '>בינוני</option>' +
          '<option value="lg"' + (st.padding === 'lg' ? ' selected' : '') + '>גדול</option>' +
        '</select>'
      ) +
      field(
        'עיגול פינות',
        '<select data-style="radius">' +
          '<option value=""' + (!st.radius ? ' selected' : '') + '>ללא</option>' +
          '<option value="sm"' + (st.radius === 'sm' ? ' selected' : '') + '>קטן</option>' +
          '<option value="md"' + (st.radius === 'md' ? ' selected' : '') + '>בינוני</option>' +
          '<option value="lg"' + (st.radius === 'lg' ? ' selected' : '') + '>גדול</option>' +
        '</select>'
      ) +
      field('מחלקת CSS (מתקדם מאוד)', '<input data-key="className" value="' + escAttr(d.className || '') + '" placeholder="my-class" dir="ltr">') +
      field('מזהה ID', '<input data-key="id" value="' + escAttr(d.id || '') + '" dir="ltr">') +
      '</details>';

    html +=
      '<details class="agent-snip-details">' +
      '<summary>לסוכנים · BenTML</summary>' +
      '<pre class="bentml-mini-snip">' + esc(snip) + '</pre>' +
      '<div class="prop-hint">השפה לסוכנים — לא חובה למעצבים. טאב ״שפה לסוכן״ לגיליון המלא.</div>' +
      '</details>';

    if (node.parent) {
      html += '<button type="button" class="btn secondary" style="margin-top:8px;width:100%" data-unnest="1">הוצא משורת עמודות</button>';
    }

    panel.innerHTML = html;

    panel.querySelectorAll('[data-replace]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        replaceBlockType(block.id, chip.dataset.replace);
      });
    });

    panel.querySelectorAll('[data-key]').forEach(function (input) {
      var apply = function (reRender) {
        if (!input._histPushed) { pushHistory(); input._histPushed = true; }
        var val;
        if (input.type === 'checkbox') {
          val = input.checked; // registry boolean params
        } else {
          val = input.value;
          // Registry-driven coercion: integer params get parsed + clamped
          var pd = paramDefFor(block.type, input.dataset.key);
          if (pd && pd.type === 'integer') {
            val = parseInt(val, 10);
            if (isNaN(val)) val = pd.default != null ? pd.default : 0;
            if (pd.min != null) val = Math.max(pd.min, val);
            if (pd.max != null) val = Math.min(pd.max, val);
          } else if (input.dataset.key === 'level') val = parseInt(val, 10) || 2;
          else if (input.dataset.key === 'limit') val = parseInt(val, 10) || 6;
          else if (input.dataset.key === 'columns' && block.type === 'article-list') val = Math.min(Math.max(parseInt(val, 10) || 3, 1), 4);
        }
        if (!block.data) block.data = {};
        block.data[input.dataset.key] = val;
        // Registry side-effects for legacy renderer fields:
        if (block.type === 'spacer' && input.dataset.key === 'size') {
          block.data.height = SPACER_HEIGHTS[val] || '1.5rem';
          var pxField = panel.querySelector('[data-spacer-px]');
          if (pxField) pxField.value = ''; // preset takes over from exact px
        }
        if (block.type === 'divider' && input.dataset.key === 'bentStyle' && typeof block.data.style !== 'object') {
          block.data.style = val === 'dots' ? 'dashed' : 'solid';
        }
        markDirty();
        // mirror text fields live into the page visualizer
        var k = input.dataset.key;
        if (k === 'text' || k === 'content' || k === 'title' || k === 'subtitle' || k === 'quote' || k === 'author') {
          liveUpdatePreview(block.id, k === 'text' ? 'text' : k, String(val));
        }
        if (k === 'ratio' && block.type === 'columns') {
          if (reRender) renderCanvas();
        } else if (k === 'align' || k === 'className') {
          applyPreviewStyle(block.id);
          if (reRender) renderCanvas();
        } else if (reRender && k !== 'text' && k !== 'content' && k !== 'title' && k !== 'subtitle' && k !== 'quote' && k !== 'author') {
          renderCanvas();
        }
      };
      input.addEventListener('input', function () { apply(false); });
      input.addEventListener('change', function () { apply(true); });
      input.addEventListener('blur', function () { apply(false); });
    });

    // Style object (advanced module styling)
    panel.querySelectorAll('[data-style]').forEach(function (input) {
      var applyStyle = function () {
        if (!input._histPushed) { pushHistory(); input._histPushed = true; }
        if (!block.data) block.data = {};
        if (!block.data.style || typeof block.data.style !== 'object') block.data.style = {};
        var key = input.dataset.style;
        var val = input.value;
        if (val === '' || val === '#ffffff' && key === 'background' && input.type === 'color' && !input._touched) {
          // keep default color inputs from forcing white bg until user touches
        }
        if (input.type === 'color') input._touched = true;
        if (!val) delete block.data.style[key];
        else block.data.style[key] = val;
        if (!Object.keys(block.data.style).length) delete block.data.style;
        markDirty();
        applyPreviewStyle(block.id);
      };
      input.addEventListener('input', applyStyle);
      input.addEventListener('change', applyStyle);
    });

    var clearBg = panel.querySelector('[data-clear-bg]');
    if (clearBg) {
      clearBg.addEventListener('click', function () {
        pushHistory();
        if (block.data && block.data.style) {
          delete block.data.style.background;
          if (!Object.keys(block.data.style).length) delete block.data.style;
        }
        markDirty();
        renderProperties();
        applyPreviewStyle(block.id);
      });
    }

    // TEXT format chips → insert BenTML marks into content field
    panel.querySelectorAll('[data-fmt]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var ta = panel.querySelector('textarea[data-key="content"]');
        if (!ta) return;
        pushHistory();
        var start = ta.selectionStart || 0;
        var end = ta.selectionEnd || 0;
        var val = ta.value;
        var selected = val.slice(start, end) || 'טקסט';
        var ins = '';
        if (btn.dataset.fmt === 'B') ins = '@B{' + selected + '}';
        else if (btn.dataset.fmt === 'I') ins = '@I{' + selected + '}';
        else if (btn.dataset.fmt === 'LINK') ins = '@LINK(url: "https://"){' + selected + '}';
        ta.value = val.slice(0, start) + ins + val.slice(end);
        if (!block.data) block.data = {};
        block.data.content = ta.value;
        markDirty();
        liveUpdatePreview(block.id, 'content', ta.value);
        ta.focus();
      });
    });

    panel.querySelectorAll('[data-bool]').forEach(function (input) {
      input.addEventListener('change', function () {
        pushHistory();
        if (!block.data) block.data = {};
        var key = input.dataset.bool;
        if (input.checked) block.data[key] = true;
        else delete block.data[key];
        markDirty();
        renderCanvas();
      });
    });

    var spacerSize = panel.querySelector('[data-spacer-size]');
    if (spacerSize) {
      spacerSize.addEventListener('change', function () {
        var map = { sm: '0.75rem', md: '1.5rem', lg: '2.5rem', xl: '4rem' };
        if (!block.data) block.data = {};
        block.data.size = spacerSize.value;
        block.data.height = map[spacerSize.value] || '1.5rem';
        markDirty();
        renderCanvas();
      });
    }

    // exact-px spacer: a number wins over the preset; clearing it returns
    // control to the size preset
    var spacerPx = panel.querySelector('[data-spacer-px]');
    if (spacerPx) {
      var applySpacerPx = function () {
        if (!spacerPx._histPushed) { pushHistory(); spacerPx._histPushed = true; }
        if (!block.data) block.data = {};
        var v = parseInt(spacerPx.value, 10);
        block.data.height = v > 0
          ? v + 'px'
          : (SPACER_HEIGHTS[block.data.size || 'md'] || '1.5rem');
        markDirty();
        renderCanvas();
      };
      spacerPx.addEventListener('input', applySpacerPx);
      spacerPx.addEventListener('change', applySpacerPx);
    }

    var heroMedia = panel.querySelector('[data-media-hero]');
    if (heroMedia) {
      heroMedia.addEventListener('click', function () {
        openMediaLibrary(block.id);
        // reuse: after pick, also set image — openMediaLibrary sets src; for hero we need image key
        var prev = currentMediaTarget;
        currentMediaTarget = null;
        openMediaGallery(function (picked) {
          if (picked && picked.length) {
            pushHistory();
            if (!block.data) block.data = {};
            block.data.image = typeof picked[0] === 'string' ? picked[0] : picked[0].src;
            markDirty();
            renderCanvas();
            renderProperties();
          }
        });
      });
    }

    var containerAdd = panel.querySelector('[data-container-add-text]');
    if (containerAdd) {
      containerAdd.addEventListener('click', function () {
        pushHistory();
        ensureBlocks(block).push(makeBlock('text'));
        markDirty();
        renderCanvas();
        renderProperties();
      });
    }

    function wireListEditor(attr, keys, addSel, newItem) {
      panel.querySelectorAll('[' + attr + ']').forEach(function (input) {
        var apply = function () {
          if (!input._histPushed) { pushHistory(); input._histPushed = true; }
          var i = parseInt(input.getAttribute(attr), 10);
          var k = input.dataset.skey || input.dataset.fkey || input.dataset.lkey;
          if (!block.data) block.data = {};
          if (!Array.isArray(block.data.items)) block.data.items = [];
          while (block.data.items.length <= i) block.data.items.push(newItem());
          block.data.items[i][k] = input.value;
          markDirty();
        };
        input.addEventListener('input', apply);
        input.addEventListener('change', function () { apply(); renderCanvas(); });
      });
      var addBtn = panel.querySelector(addSel);
      if (addBtn) {
        addBtn.addEventListener('click', function () {
          pushHistory();
          if (!block.data) block.data = {};
          if (!Array.isArray(block.data.items)) block.data.items = [];
          block.data.items.push(newItem());
          markDirty();
          renderCanvas();
          renderProperties();
        });
      }
    }
    wireListEditor('data-stat', ['value', 'label'], '[data-add-stat]', function () {
      return { value: '0', label: 'מדד' };
    });
    wireListEditor('data-faq', ['question', 'answer'], '[data-add-faq]', function () {
      return { question: 'שאלה?', answer: 'תשובה.' };
    });
    wireListEditor('data-logo', ['src', 'alt'], '[data-add-logo]', function () {
      return { src: '/uploads/PLACEHOLDER-logo.svg', alt: 'לוגו' };
    });

    panel.querySelectorAll('[data-feat]').forEach(function (input) {
      var apply = function (reRender) {
        if (!input._histPushed) { pushHistory(); input._histPushed = true; }
        var i = parseInt(input.dataset.feat, 10);
        if (!block.data) block.data = {};
        if (!Array.isArray(block.data.items)) block.data.items = [];
        while (block.data.items.length <= i) block.data.items.push({ title: '', description: '' });
        block.data.items[i][input.dataset.fkey] = input.value;
        if (reRender) renderCanvas();
      };
      input.addEventListener('input', function () { apply(false); });
      input.addEventListener('change', function () { apply(true); });
      input.addEventListener('blur', function () { apply(true); });
    });

    panel.querySelectorAll('[data-gal-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        pushHistory();
        if (block.data && Array.isArray(block.data.images)) {
          block.data.images.splice(parseInt(btn.dataset.galDel, 10), 1);
        }
        renderCanvas();
        renderProperties();
      });
    });

    var galClean = panel.querySelector('[data-gal-clean]');
    if (galClean) {
      galClean.addEventListener('click', function () {
        pushHistory();
        if (block.data) block.data.images = filledMedia(block.data.images);
        markDirty();
        renderCanvas();
        renderProperties();
        flashCanvasHint('המשבצות הריקות נוקו 🧹');
      });
    }

    var galAdd = panel.querySelector('[data-gal-add]');
    if (galAdd) {
      galAdd.addEventListener('click', function () {
        openMediaGallery(function (picked) {
          pushHistory();
          if (!block.data) block.data = {};
          if (!Array.isArray(block.data.images)) block.data.images = [];
          block.data.images = block.data.images.concat(picked);
          renderCanvas();
          renderProperties();
        });
      });
    }

    var listItemsEl = panel.querySelector('[data-list-items]');
    if (listItemsEl) {
      var applyList = function (reRender) {
        if (!listItemsEl._histPushed) { pushHistory(); listItemsEl._histPushed = true; }
        if (!block.data) block.data = {};
        block.data.items = listItemsEl.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        if (reRender) renderCanvas();
      };
      listItemsEl.addEventListener('input', function () { applyList(false); });
      listItemsEl.addEventListener('change', function () { applyList(true); });
      listItemsEl.addEventListener('blur', function () { applyList(true); });
    }

    var orderedEl = panel.querySelector('[data-list-ordered]');
    if (orderedEl) {
      orderedEl.addEventListener('change', function () {
        pushHistory();
        if (!block.data) block.data = {};
        block.data.ordered = orderedEl.checked;
        renderCanvas();
      });
    }

    var addFeat = panel.querySelector('[data-add-feat]');
    if (addFeat) {
      addFeat.addEventListener('click', function () {
        pushHistory();
        if (!block.data) block.data = {};
        if (!Array.isArray(block.data.items)) block.data.items = [];
        block.data.items.push({ title: 'פריט', description: '' });
        renderCanvas();
        renderProperties();
      });
    }

    panel.querySelectorAll('[data-media]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openMediaLibrary(btn.dataset.media);
      });
    });

    // ── Binders for registry-GENERATED controls ──

    // media param → single pick from the library into data[param]
    panel.querySelectorAll('[data-media-param]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.mediaParam;
        openMediaSingle(function (url) {
          pushHistory();
          if (!block.data) block.data = {};
          block.data[key] = url;
          markDirty();
          renderCanvas();
          renderProperties();
        });
      });
    });

    // list param, compact editor (single itemField): one line per item
    panel.querySelectorAll('[data-lp-lines]').forEach(function (ta) {
      var applyLines = function (reRender) {
        if (!ta._histPushed) { pushHistory(); ta._histPushed = true; }
        var key = ta.dataset.lpLines;
        var fname = ta.dataset.lpField || 'text';
        if (!block.data) block.data = {};
        block.data[key] = ta.value.split('\n')
          .map(function (s) { return s.trim(); })
          .filter(Boolean)
          .map(function (s) { var it = {}; it[fname] = s; return it; });
        markDirty();
        if (reRender) renderCanvas();
      };
      ta.addEventListener('input', function () { applyLines(false); });
      ta.addEventListener('change', function () { applyLines(true); });
      ta.addEventListener('blur', function () { applyLines(true); });
    });

    // list param, per-item field inputs
    panel.querySelectorAll('[data-lp][data-lp-i]').forEach(function (input) {
      var applyItem = function (reRender) {
        if (!input._histPushed) { pushHistory(); input._histPushed = true; }
        var key = input.dataset.lp;
        var i = parseInt(input.dataset.lpI, 10);
        var f = input.dataset.lpF;
        if (!block.data) block.data = {};
        if (!Array.isArray(block.data[key])) block.data[key] = [];
        while (block.data[key].length <= i) block.data[key].push({});
        if (typeof block.data[key][i] !== 'object' || block.data[key][i] == null) {
          block.data[key][i] = {};
        }
        block.data[key][i][f] = input.value;
        markDirty();
        if (reRender) renderCanvas();
      };
      input.addEventListener('input', function () { applyItem(false); });
      input.addEventListener('change', function () { applyItem(true); });
      input.addEventListener('blur', function () { applyItem(true); });
    });

    // list param: remove item
    panel.querySelectorAll('button[data-lp-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.lp;
        pushHistory();
        if (block.data && Array.isArray(block.data[key])) {
          block.data[key].splice(parseInt(btn.dataset.lpDel, 10), 1);
        }
        markDirty();
        renderCanvas();
        renderProperties();
      });
    });

    // list param: add item
    panel.querySelectorAll('[data-lp-add]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.lpAdd;
        var pdList = paramDefFor(block.type, key);
        pushHistory();
        if (!block.data) block.data = {};
        if (!Array.isArray(block.data[key])) block.data[key] = [];
        block.data[key].push(pdList ? defaultListItem(pdList) : {});
        markDirty();
        renderCanvas();
        renderProperties();
      });
    });

    // list param with media items: one-click cleanup of empty slots
    panel.querySelectorAll('[data-lp-clean]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.lpClean;
        pushHistory();
        if (block.data) block.data[key] = filledMedia(block.data[key]);
        markDirty();
        renderCanvas();
        renderProperties();
        flashCanvasHint('המשבצות הריקות נוקו 🧹');
      });
    });

    // list param with media items (e.g. gallery): multi-pick from the library
    panel.querySelectorAll('[data-lp-media-add]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.lpMediaAdd;
        openMediaGallery(function (picked) {
          pushHistory();
          if (!block.data) block.data = {};
          if (!Array.isArray(block.data[key])) block.data[key] = [];
          block.data[key] = block.data[key].concat(picked);
          markDirty();
          renderCanvas();
          renderProperties();
        });
      });
    });

    panel.querySelectorAll('[data-col]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        addChildToColumn(block.id, parseInt(btn.dataset.col, 10), 'text');
      });
    });

    var addCol = panel.querySelector('[data-add-col]');
    if (addCol) {
      addCol.addEventListener('click', function () {
        var cols = ensureColumns(block);
        if (cols.length >= 4) return;
        pushHistory();
        cols.push({ blocks: [] });
        renderCanvas();
        renderProperties();
      });
    }

    var unwrap = panel.querySelector('[data-unwrap]');
    if (unwrap) {
      unwrap.addEventListener('click', function () {
        unwrapColumns(block.id);
      });
    }

    var unnest = panel.querySelector('[data-unnest]');
    if (unnest) {
      unnest.addEventListener('click', function () {
        if (!findNode(block.id)) return;
        pushHistory();
        var moved = removeNode(block.id);
        if (!moved) return;
        blocks.push(moved);
        selectedId = moved.id;
        renderCanvas();
        renderProperties();
      });
    }
  }

  // ---- CRUD ----

  function addBlock(type) {
    pushHistory();
    var newBlock = makeBlock(type);
    blocks.push(newBlock);
    selectedId = newBlock.id;
    renderCanvas();
    renderProperties();
    syncToolboxMode();
    flashCanvasHint('נוסף: ' + typeLabel(type));
  }

  function addChildToColumn(columnsBlockId, columnIndex, type) {
    type = type || 'text';
    var parent = getBlock(columnsBlockId);
    if (!parent) return;
    pushHistory();
    var child = makeBlock(type);
    if (type === 'text') child.data = { content: 'טקסט חדש בטור' };
    if (type === 'heading') child.data = { text: 'כותרת', level: 3 };
    var cols = ensureColumns(parent);
    while (cols.length <= columnIndex) cols.push({ blocks: [] });
    cols[columnIndex].blocks.push(child);
    selectedId = child.id;
    renderCanvas();
    renderProperties();
  }

  /** Delete = soft erase (Ben's modularity law): the tool goes, the shape
   *  stays. A deleted module becomes an empty מיכל (section) holding its
   *  place; deleting the empty מיכל removes it for real. Pure-space types
   *  (spacer/divider) and empty containers skip straight to removal. */
  function deleteBlock(id) {
    var node = findNode(id);
    if (!node) return;
    var block = node.block;
    pushHistory();
    var d = block.data || {};
    var kidCount = 0;
    if (Array.isArray(d.blocks)) kidCount = d.blocks.length;
    if (Array.isArray(d.columns)) {
      d.columns.forEach(function (col) { kidCount += ((col && col.blocks) || []).length; });
    }
    var pureSpace = block.type === 'spacer' || block.type === 'divider';
    var emptyContainer =
      (isBlocksContainer(block.type) || isColumnsContainer(block.type)) && !kidCount;
    var soft = !pureSpace && !emptyContainer;
    if (soft) {
      block.type = 'section';
      block.data = { blocks: [], size: 'md' };
    } else {
      removeNode(id);
      if (selectedId === id) selectedId = null;
    }
    renderCanvas();
    renderProperties();
    syncToolboxMode();
    showToast(
      soft ? 'המודול פונה — המיכל נשאר לשמור מקום' : 'המודול נמחק',
      null,
      { label: '↩ בטל', onClick: undo }
    );
  }

  /** Graduation (v0.51): convert a provisional bent-html block's raw HTML into
   *  real modules in place. The server does the best-effort mapping; leftover
   *  bits stay as a smaller html block so nothing is lost. */
  function graduateHtmlBlock(id) {
    var n = findNode(id);
    if (!n || n.block.type !== 'html') return;
    var content = (n.block.data && n.block.data.content) || '';
    if (!content.trim()) { showToast('אין תוכן להמרה', 'warn'); return; }
    fetch('/admin/api/pzn/graduate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok || !Array.isArray(data.blocks) || !data.blocks.length) {
          showToast('לא הצלחתי להמיר למודולים', 'err');
          return;
        }
        var n2 = findNode(id);
        if (!n2) return;
        pushHistory();
        data.blocks.forEach(function (b) { if (!b.id) b.id = uid(b.type); });
        n2.list.splice.apply(n2.list, [n2.index, 1].concat(data.blocks));
        selectedId = null;
        markDirty();
        renderCanvas();
        renderProperties();
        var note = data.leftover ? (' · ' + data.leftover + ' חלקים נשארו כ‑HTML') : '';
        showToast('הומר ל‑' + data.mapped + ' מודולים' + note + ' ✓', 'ok');
      })
      .catch(function () { showToast('שגיאת רשת בהמרה', 'err'); });
  }

  function duplicateBlock(id) {
    var n = findNode(id);
    if (!n) return;
    pushHistory();
    var copy = JSON.parse(JSON.stringify(n.block));
    (function reId(b) {
      b.id = uid(b.type);
      if (isColumnsContainer(b.type)) {
        ensureColumns(b).forEach(function (col) {
          (col.blocks || []).forEach(reId);
        });
      } else if (isBlocksContainer(b.type)) {
        ensureBlocks(b).forEach(reId);
      }
    })(copy);
    n.list.splice(n.index + 1, 0, copy);
    selectedId = copy.id;
    renderCanvas();
    renderProperties();
  }

  function moveBlock(id, direction) {
    var n = findNode(id);
    if (!n) return;
    var newIdx = n.index + direction;
    if (newIdx < 0 || newIdx >= n.list.length) return;
    pushHistory();
    var moved = n.list.splice(n.index, 1)[0];
    n.list.splice(newIdx, 0, moved);
    renderCanvas();
  }

  /** Toolbar: turn one block into 2-col with empty sibling */
  function splitBlockInPlace(id) {
    var n = findNode(id);
    if (!n || isColumnsContainer(n.block.type)) return;
    pushHistory();
    var target = n.list.splice(n.index, 1)[0];
    var empty = makeBlock('text');
    empty.data = { content: 'טור חדש...' };
    var colsBlock = makeBlock('columns');
    // empty on the left (physical), original on the right
    colsBlock.data.columns = [
      { blocks: [empty] },
      { blocks: [target] }
    ];
    n.list.splice(n.index, 0, colsBlock);
    selectedId = empty.id;
    renderCanvas();
    renderProperties();
  }

  function unwrapColumns(id) {
    var n = findNode(id);
    if (!n || !isColumnsContainer(n.block.type)) return;
    pushHistory();
    var cols = ensureColumns(n.block);
    var flat = [];
    cols.forEach(function (col) {
      (col.blocks || []).forEach(function (b) { flat.push(b); });
    });
    n.list.splice.apply(n.list, [n.index, 1].concat(flat));
    selectedId = flat[0] ? flat[0].id : null;
    renderCanvas();
    renderProperties();
  }

  // ---- Save ----

  function savePage(opts) {
    opts = opts || {};
    var titleEl = document.getElementById('page-title');
    var statusEl = document.getElementById('page-status');
    var title = titleEl ? titleEl.value : '';
    var status = statusEl ? statusEl.value : 'draft';

    return fetch('/admin/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_path: currentPageFullPath,
        title: title,
        status: status,
        blocks: blocks,
        tags: pageTags,
        meta: pageMeta,
        slug: currentSlug
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          // draft ≠ published — the true "needs publish" signal (ask E)
          if (typeof data.hasUnpublished === 'boolean') {
            hasUnpublishedState = data.hasUnpublished;
          }
          // Slug rename: the address changed — follow it in-place (no reload)
          // so the URL bar and future saves point at the new page.
          if (data.full_path && data.full_path !== currentPageFullPath) {
            currentPageFullPath = data.full_path;
            currentSlug = data.full_path;
            try { history.replaceState(null, '', '/admin/edit/' + encodeURIComponent(data.full_path)); } catch (e) {}
            updateHeaderExtras();
          }
          if (data.slugRejected && !opts.silent) {
            showToast('הכתובת תפוסה — נשמר בכתובת הקודמת', 'warn');
          }
          markSaved();
          updatePublishBadge();
          if (opts.silent) flashCanvasHint('נשמר אוטומטית ✓');
          else showToast('נשמר ✓', 'ok');
        } else {
          showToast('שגיאה בשמירה' + (data && data.error ? ': ' + data.error : ''), 'err');
        }
        return data;
      })
      .catch(function () {
        showToast('שגיאה בשמירה — בדוק שהשרת רץ', 'err');
      });
  }

  function saveAndBuild() {
    savePage()
      .then(function () { return fetch('/admin/build', { method: 'POST' }); })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.ok === false) {
          showToast('שגיאה בבנייה' + (data.error ? ': ' + data.error : ''), 'err');
          return;
        }
        showToast('נבנה ✓ — נפתח בחלון חדש', 'ok');
        window.open('/', '_blank');
      })
      .catch(function () { showToast('שגיאה בבנייה', 'err'); });
  }

  // ---- Media ----

  var mediaState = { folder: '', mode: 'single', selection: [], onPick: null, onPickSingle: null };

  function openMediaLibrary(targetBlockId) {
    currentMediaTarget = targetBlockId || selectedId || null;
    mediaState.mode = currentMediaTarget && getBlock(currentMediaTarget) ? 'single' : 'browse';
    mediaState.selection = [];
    mediaState.onPick = null;
    mediaState.onPickSingle = null;
    showMediaModal();
  }

  /** Multi-select mode for the gallery module. onPick gets [{src, alt}] */
  function openMediaGallery(onPick) {
    currentMediaTarget = null;
    mediaState.mode = 'multi';
    mediaState.selection = [];
    mediaState.onPick = onPick;
    mediaState.onPickSingle = null;
    showMediaModal();
  }

  /** Single-pick mode with a callback — used by registry media params and page og:image. */
  function openMediaSingle(onPick) {
    currentMediaTarget = null;
    mediaState.mode = 'single';
    mediaState.selection = [];
    mediaState.onPick = null;
    mediaState.onPickSingle = onPick;
    showMediaModal();
  }

  function showMediaModal() {
    var modal = document.getElementById('media-modal');
    if (!modal) return;
    modal.classList.add('show');
    loadMediaFolder(mediaState.folder || '');
  }

  function loadMediaFolder(folder) {
    mediaState.folder = folder || '';
    var list = document.getElementById('media-list');
    if (!list) return;
    list.innerHTML = '<div style="color:#64748b;padding:20px">טוען...</div>';
    fetch('/admin/media?folder=' + encodeURIComponent(mediaState.folder))
      .then(function (r) { return r.json(); })
      .then(renderMediaExplorer)
      .catch(function () {
        list.innerHTML = '<div style="color:#b91c1c;padding:20px">שגיאה בטעינת מדיה</div>';
      });
  }

  function renderMediaExplorer(data) {
    var list = document.getElementById('media-list');
    if (!list) return;
    list.classList.add('media-explorer');

    var crumbs = '<span class="crumb" data-goto="">🏠 מדיה</span>';
    var acc = '';
    (mediaState.folder ? mediaState.folder.split('/') : []).forEach(function (seg) {
      acc = acc ? acc + '/' + seg : seg;
      crumbs += ' › <span class="crumb" data-goto="' + escAttr(acc) + '">' + esc(seg) + '</span>';
    });

    var bar =
      '<div class="media-bar">' +
      '<div class="media-crumbs">' + crumbs + '</div>' +
      '<div class="media-actions">' +
      (mediaState.folder ? '<button type="button" class="mbtn" data-up="1" title="תיקייה למעלה">⬆</button>' : '') +
      '<button type="button" class="mbtn" data-newfolder="1">📁+ תיקייה חדשה</button>' +
      '<button type="button" class="mbtn" data-upload-here="1">⬆ העלאה לתיקייה זו</button>' +
      (mediaState.mode === 'multi'
        ? '<button type="button" class="mbtn mbtn-primary" data-confirm-multi="1">הוסף (<span id="media-sel-count">0</span>)</button>'
        : '') +
      '</div></div>';

    var tiles = '';
    (data.folders || []).forEach(function (f) {
      tiles +=
        '<div class="media-tile media-folder" data-folder="' + escAttr(f.path) + '" title="' + escAttr(f.name) + '">' +
        '<div class="tile-icon">📁</div><div class="media-name">' + esc(f.name) + '</div></div>';
    });
    (data.files || []).forEach(function (f) {
      tiles +=
        '<div class="media-tile media-item" data-url="' + escAttr(f.url) + '" data-id="' + escAttr(String(f.id)) + '" data-name="' + escAttr(f.name) + '">' +
        '<img src="' + escAttr(f.url) + '" alt="" loading="lazy">' +
        '<div class="media-name">' + esc(f.name) + '</div></div>';
    });
    if (!tiles) {
      tiles = '<div class="media-empty">תיקייה ריקה — העלה תמונה או צור תיקייה</div>';
    }

    list.innerHTML = bar + '<div class="media-grid">' + tiles + '</div>';
    bindMediaEvents(list);
  }

  function bindMediaEvents(list) {
    list.querySelectorAll('.crumb').forEach(function (c) {
      c.addEventListener('click', function () { loadMediaFolder(c.dataset.goto); });
    });
    var up = list.querySelector('[data-up]');
    if (up) up.addEventListener('click', function () {
      var parts = mediaState.folder.split('/');
      parts.pop();
      loadMediaFolder(parts.join('/'));
    });
    var nf = list.querySelector('[data-newfolder]');
    if (nf) nf.addEventListener('click', function () {
      var name = window.prompt('שם התיקייה החדשה:');
      if (!name) return;
      fetch('/admin/media/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: mediaState.folder, name: name })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.ok) { showToast('תיקייה נוצרה ✓', 'ok'); loadMediaFolder(mediaState.folder); }
          else showToast(d.error || 'שגיאה', 'err');
        });
    });
    var uh = list.querySelector('[data-upload-here]');
    if (uh) uh.addEventListener('click', function () {
      var fileInput = document.getElementById('media-upload-input');
      if (fileInput) fileInput.click();
    });
    var cm = list.querySelector('[data-confirm-multi]');
    if (cm) cm.addEventListener('click', function () {
      if (mediaState.onPick && mediaState.selection.length) {
        mediaState.onPick(mediaState.selection.map(function (s) { return { src: s.url, alt: s.name }; }));
      }
      closeMediaLibrary();
    });

    list.querySelectorAll('.media-folder').forEach(function (tile) {
      tile.addEventListener('dblclick', function () { loadMediaFolder(tile.dataset.folder); });
      tile.addEventListener('click', function () { loadMediaFolder(tile.dataset.folder); });
      tile.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        showCtxMenu(e.clientX, e.clientY, [
          { label: '📂 פתח', fn: function () { loadMediaFolder(tile.dataset.folder); } },
          { label: '🗑 מחק תיקייה', danger: true, fn: function () { deleteMediaFolder(tile.dataset.folder); } }
        ]);
      });
    });

    list.querySelectorAll('.media-item').forEach(function (tile) {
      // keep multi-selection visible across folder loads / uploads
      if (mediaState.mode === 'multi' &&
          mediaState.selection.some(function (s) { return s.url === tile.dataset.url; })) {
        tile.classList.add('tile-selected');
      }
      tile.addEventListener('click', function () {
        if (mediaState.mode === 'single') {
          pickMedia(tile.dataset.url);
        } else if (mediaState.mode === 'multi') {
          toggleMediaSelection(tile);
        } else {
          tile.classList.toggle('tile-selected');
        }
      });
      tile.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        var items = [];
        if (mediaState.mode === 'single') {
          items.push({ label: '✔ בחר תמונה', fn: function () { pickMedia(tile.dataset.url); } });
        }
        items.push({
          label: '📁 העבר לתיקייה…',
          fn: function () { moveMediaFile(tile.dataset.id, tile.dataset.name); }
        });
        items.push({
          label: '🔗 העתק כתובת',
          fn: function () {
            if (navigator.clipboard) navigator.clipboard.writeText(tile.dataset.url);
            showToast('הכתובת הועתקה', 'ok');
          }
        });
        items.push({
          label: '🗑 מחק קובץ', danger: true,
          fn: function () { deleteMediaFile(tile.dataset.id, tile.dataset.name); }
        });
        showCtxMenu(e.clientX, e.clientY, items);
      });
    });

    var selCount = document.getElementById('media-sel-count');
    if (selCount) selCount.textContent = String(mediaState.selection.length);
  }

  function toggleMediaSelection(tile) {
    var url = tile.dataset.url;
    var idx = mediaState.selection.findIndex(function (s) { return s.url === url; });
    if (idx >= 0) {
      mediaState.selection.splice(idx, 1);
      tile.classList.remove('tile-selected');
    } else {
      mediaState.selection.push({ url: url, name: tile.dataset.name });
      tile.classList.add('tile-selected');
    }
    var count = document.getElementById('media-sel-count');
    if (count) count.textContent = String(mediaState.selection.length);
  }

  function moveMediaFile(id, name) {
    var target = window.prompt(
      'להעביר את "' + name + '" לאיזו תיקייה?\n(ריק = השורש · אפשר נתיב כמו banners/2026)',
      mediaState.folder
    );
    if (target === null) return;
    fetch('/admin/media/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: parseInt(id, 10), folder: String(target).trim() })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { showToast('הועבר ✓', 'ok'); loadMediaFolder(mediaState.folder); }
        else showToast(d.error || 'שגיאה בהעברה', 'err');
      });
  }

  function deleteMediaFile(id, name) {
    if (!window.confirm('למחוק את "' + name + '" לצמיתות?')) return;
    fetch('/admin/media/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: parseInt(id, 10) })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { showToast('נמחק ✓', 'ok'); loadMediaFolder(mediaState.folder); }
        else showToast(d.error || 'שגיאה במחיקה', 'err');
      });
  }

  function deleteMediaFolder(path) {
    if (!window.confirm('למחוק את התיקייה "' + path + '"? (חייבת להיות ריקה)')) return;
    fetch('/admin/media/delete-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { showToast('התיקייה נמחקה ✓', 'ok'); loadMediaFolder(mediaState.folder); }
        else showToast(d.error || 'שגיאה', 'err');
      });
  }

  // ---- Context menu (Windows-style) ----

  function showCtxMenu(x, y, items) {
    hideCtxMenu();
    var menu = document.createElement('div');
    menu.id = 'tapuz-ctx';
    items.forEach(function (it) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'ctx-item' + (it.danger ? ' ctx-danger' : '');
      row.textContent = it.label;
      row.addEventListener('click', function () {
        hideCtxMenu();
        it.fn();
      });
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    var rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
    setTimeout(function () {
      document.addEventListener('click', hideCtxMenu, { once: true });
      document.addEventListener('contextmenu', hideCtxMenu, { once: true });
    }, 0);
  }

  function hideCtxMenu() {
    var m = document.getElementById('tapuz-ctx');
    if (m) m.remove();
  }

  function closeMediaLibrary() {
    var modal = document.getElementById('media-modal');
    if (modal) modal.classList.remove('show');
  }

  function pickMedia(url) {
    if (mediaState.onPickSingle) {
      var cb = mediaState.onPickSingle;
      mediaState.onPickSingle = null;
      closeMediaLibrary();
      cb(url);
      return;
    }
    if (currentMediaTarget) {
      var block = getBlock(currentMediaTarget);
      if (block) {
        pushHistory();
        if (!block.data) block.data = {};
        block.data.src = url;
        selectedId = block.id;
        renderCanvas();
        renderProperties();
      }
    }
    closeMediaLibrary();
  }

  /** Upload one or many files into the CURRENT folder. Uploads are queued
   *  one-by-one; in multi mode they land pre-selected so "add photos" is
   *  upload → confirm, no hunting for what you just uploaded. */
  function uploadMedia(input) {
    if (!input.files || !input.files.length) return;
    var files = Array.prototype.slice.call(input.files);
    input.value = '';
    var uploaded = [];

    function finish() {
      if (!uploaded.length) return;
      showToast('הועלו ' + uploaded.length + ' קבצים ✓', 'ok');
      if (mediaState.mode === 'single' && (currentMediaTarget || mediaState.onPickSingle)) {
        pickMedia(uploaded[0].url);
        return;
      }
      if (mediaState.mode === 'multi') {
        uploaded.forEach(function (u) {
          if (!mediaState.selection.some(function (s) { return s.url === u.url; })) {
            mediaState.selection.push(u);
          }
        });
      }
      loadMediaFolder(mediaState.folder);
    }

    function next(i) {
      if (i >= files.length) { finish(); return; }
      var file = files[i];
      var reader = new FileReader();
      reader.onload = function () {
        fetch('/admin/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, data: reader.result, folder: mediaState.folder })
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.ok && data.url) uploaded.push({ url: data.url, name: file.name });
            else showToast((data.error || 'שגיאה בהעלאה') + ' — ' + file.name, 'err');
            next(i + 1);
          })
          .catch(function () {
            showToast('שגיאה בהעלאה — ' + file.name, 'err');
            next(i + 1);
          });
      };
      reader.readAsDataURL(file);
    }
    next(0);
  }

  // ---- Keyboard ----

  document.addEventListener('keydown', function (e) {
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      savePage();
    }
    var inField = /INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || '');
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z') && !inField) {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y') && !inField) {
      e.preventDefault();
      redo();
    }
    if (
      e.key === 'Delete' &&
      selectedId &&
      !/INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || '')
    ) {
      e.preventDefault();
      deleteBlock(selectedId);
    }
    if (e.key === 'Escape') {
      // responsive drawers close first; then selection clears
      if (document.body.classList.contains('toolbox-open')) {
        document.body.classList.remove('toolbox-open');
      } else if (document.body.classList.contains('props-open')) {
        document.body.classList.remove('props-open');
      } else if (selectedId && !inField) {
        selectBlock(null);
      }
    }
  });

  // ---- Page navigator modal ----
  function openPagesNav() {
    var modal = document.getElementById('pages-nav-modal');
    if (!modal) return;
    modal.classList.add('show');
    loadPagesNav('');
    var search = document.getElementById('pages-nav-search');
    if (search) {
      search.value = '';
      search.oninput = function () { loadPagesNav(search.value); };
      setTimeout(function () { search.focus(); }, 50);
    }
  }

  function closePagesNav() {
    var modal = document.getElementById('pages-nav-modal');
    if (modal) modal.classList.remove('show');
  }

  function loadPagesNav(q) {
    var list = document.getElementById('pages-nav-list');
    if (!list) return;
    list.innerHTML = '<div style="padding:20px;color:#64748b">טוען...</div>';
    var url = '/admin/api/pages' + (q ? '?q=' + encodeURIComponent(q) : '');
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) { list.innerHTML = '<div style="color:#b91c1c;padding:20px">שגיאה</div>'; return; }
        var pages = data.pages || [];
        if (!pages.length) {
          list.innerHTML = '<div style="padding:20px;color:#64748b">לא נמצאו דפים</div>';
          return;
        }
        list.innerHTML = pages.map(function (p) {
          var badge = p.status === 'published'
            ? '<span style="background:#dcfce7;color:#166534;font-size:0.7rem;padding:1px 7px;border-radius:999px;margin-inline-start:6px">פורסם</span>'
            : '<span style="background:#fef3c7;color:#92400e;font-size:0.7rem;padding:1px 7px;border-radius:999px;margin-inline-start:6px">טיוטה</span>';
          var dirty = p.has_unpublished ? '<span style="color:#b45309;font-size:0.7rem;margin-inline-start:4px">• שינויים</span>' : '';
          return '<div class="page-nav-item" data-path="' + escAttr(p.full_path) + '" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:6px;background:#fff;cursor:pointer">' +
            '<div><strong>' + esc(p.title) + '</strong><br><span style="font-family:monospace;font-size:0.8rem;color:#64748b">/' + esc(p.full_path) + '</span>' + badge + dirty + '</div>' +
            '<a href="/admin/edit/' + encodeURIComponent(p.full_path) + '" class="btn" style="padding:6px 14px">ערוך</a>' +
          '</div>';
        }).join('');
        list.querySelectorAll('.page-nav-item').forEach(function (row) {
          row.onclick = function (e) {
            if (e.target.tagName === 'A') return;
            window.location.href = '/admin/edit/' + encodeURIComponent(row.dataset.path);
          };
        });
      })
      .catch(function () { list.innerHTML = '<div style="color:#b91c1c;padding:20px">שגיאה בטעינה</div>'; });
  }

  // ---- Revisions modal ----
  function openRevisions() {
    var modal = document.getElementById('revisions-modal');
    if (!modal || !currentPageFullPath) return;
    modal.classList.add('show');
    loadRevisions();
  }

  function closeRevisions() {
    var modal = document.getElementById('revisions-modal');
    if (modal) modal.classList.remove('show');
  }

  function loadRevisions() {
    var list = document.getElementById('revisions-list');
    if (!list) return;
    list.innerHTML = '<div style="padding:20px;color:#64748b">טוען...</div>';
    fetch('/admin/api/revisions/' + encodeURIComponent(currentPageFullPath))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) { list.innerHTML = '<div style="color:#b91c1c;padding:20px">שגיאה</div>'; return; }
        var revs = data.revisions || [];
        if (!revs.length) {
          list.innerHTML = '<div style="padding:20px;color:#64748b">אין היסטוריה עדיין</div>';
          return;
        }
        list.innerHTML = revs.map(function (r) {
          var kind = r.kind === 'publish' ? 'פרסום' : (r.kind === 'restore' ? 'שחזור' : 'טיוטה');
          var badgeColor = r.kind === 'publish' ? '#166534' : '#0a66c2';
          return '<div class="rev-row" data-id="' + r.id + '" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:6px;background:#fff">' +
            '<div><strong>' + esc(r.title || 'ללא כותרת') + '</strong><br>' +
            '<span style="font-size:0.75rem;color:#64748b">' + (r.created_at || '').replace('T', ' ').slice(0, 19) + ' · ' + kind + '</span></div>' +
            '<button type="button" class="btn secondary" data-restore="' + r.id + '" style="padding:6px 12px">שחזר לטיוטה</button>' +
          '</div>';
        }).join('');
        list.querySelectorAll('[data-restore]').forEach(function (btn) {
          btn.onclick = function () {
            if (!confirm('לשחזר גרסה זו לטיוטה?')) return;
            fetch('/admin/api/revisions/restore', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ full_path: currentPageFullPath, revision_id: +btn.dataset.restore })
            }).then(function (r) { return r.json(); }).then(function (d) {
              if (d.ok) {
                closeRevisions();
                showToast('שוחזר ✓', 'ok');
                // restored content lives in the DRAFT, not the published snapshot
                blocks = (d.page.draft_blocks != null ? d.page.draft_blocks : d.page.blocks) || [];
                renderCanvas();
                renderProperties();
                markDirty();
              } else alert(d.error || 'שגיאה');
            });
          };
        });
      })
      .catch(function () { list.innerHTML = '<div style="color:#b91c1c;padding:20px">שגיאה</div>'; });
  }

  // ---- Publish helpers ----
  function publishPage() {
    var titleEl = document.getElementById('page-title');
    var title = titleEl ? titleEl.value : '';
    return fetch('/admin/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_path: currentPageFullPath, title: title, blocks: blocks, tags: pageTags, meta: pageMeta })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.ok) {
        showToast('פורסם ✓ — הדף חי', 'ok');
        hasUnpublishedState = false;
        markSaved();
        var badge = document.getElementById('publish-badge');
        if (badge) {
          badge.style.background = '#dcfce7';
          badge.style.color = '#166534';
          badge.textContent = 'פורסם';
        }
        updateLiveLink(data.liveUrl || ('/' + (data.full_path || currentPageFullPath)));
      } else {
        showToast('שגיאה: ' + (data.error || ''), 'err');
      }
      return data;
    }).catch(function () { showToast('שגיאה בפרסום', 'err'); });
  }

  /** A visible, always-clickable door to the live page — no guessing URLs. */
  function updateLiveLink(url) {
    if (!url) return;
    var link = document.getElementById('view-live-link');
    if (!link) {
      link = document.createElement('a');
      link.id = 'view-live-link';
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'btn secondary';
      var bar = document.querySelector('.save-bar .container');
      if (bar) bar.insertBefore(link, bar.firstChild);
    }
    link.href = encodeURI(url);
    link.textContent = 'צפה בדף החי ↗';
  }

  /** Refresh the topbar badge to reflect draft-vs-published state. */
  function updatePublishBadge() {
    var badge = document.getElementById('publish-badge');
    if (!badge) return;
    var published = badge.textContent.indexOf('פורסם') === 0;
    if (published) {
      badge.textContent = hasUnpublishedState ? 'פורסם • טיוטה שונה' : 'פורסם';
    }
  }

  function publishAndBuild() {
    var liveUrl = '';
    publishPage().then(function (pub) {
      liveUrl = (pub && pub.liveUrl) || ('/' + currentPageFullPath);
      return fetch('/admin/build', { method: 'POST' });
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.ok === false) {
        showToast('שגיאה בבנייה' + (data.error ? ': ' + data.error : ''), 'err');
        return;
      }
      showToast('נבנה ✓ — נפתח בחלון חדש', 'ok');
      // open THE PAGE that was just published, not the homepage
      window.open(encodeURI(liveUrl), '_blank');
    }).catch(function () { showToast('שגיאה בבנייה', 'err'); });
  }

  /**
   * Import BenTML from any AI (v0.53) — the in-builder bridge. One-time: hand
   * the AI the BenTML dictionary; then paste its reply and it becomes modules
   * (forgivingly — the server repairs imperfect output). BYOT: the AI runs on
   * the customer's own subscription; we only carry the reply.
   */
  function openImportAi() {
    var old = document.getElementById('import-ai-modal');
    if (old) old.remove();
    var ov = document.createElement('div');
    ov.id = 'import-ai-modal';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML =
      '<div dir="rtl" style="background:#fff;border-radius:16px;max-width:560px;width:100%;max-height:88vh;overflow:auto;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.3)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<h3 style="margin:0;font-size:1.15rem">🤖 ייבא מ‑AI</h3>' +
      '<button type="button" id="imp-close" style="border:none;background:#f1f5f9;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:1rem">✕</button></div>' +
      '<p style="color:#64748b;font-size:.86rem;margin:0 0 14px;line-height:1.5">ה‑AI שלכם, על המנוי שלכם. פעם אחת — תנו ל‑AI את מילון BenTML, ואז שוחחו איתו והדביקו את התשובה כאן.</p>' +
      '<button type="button" id="imp-primer" class="btn secondary" style="width:100%;margin-bottom:14px">📋 העתק מילון BenTML ל‑AI (פעם אחת)</button>' +
      '<label style="display:block;font-size:.82rem;color:#475569;margin-bottom:4px">הדביקו כאן את תשובת ה‑AI (אפשר עם טקסט מסביב — נחלץ את הקוד)</label>' +
      '<textarea id="imp-src" dir="ltr" spellcheck="false" style="width:100%;box-sizing:border-box;min-height:150px;border:1px solid #cbd5e1;border-radius:10px;padding:10px;font-family:ui-monospace,Consolas,monospace;font-size:.82rem" placeholder="<!DOCTYPE html> …"></textarea>' +
      '<div style="display:flex;gap:16px;margin:12px 0">' +
      '<label style="font-size:.88rem"><input type="radio" name="imp-mode" value="replace" checked> החלף את הדף</label>' +
      '<label style="font-size:.88rem"><input type="radio" name="imp-mode" value="append"> הוסף לסוף</label></div>' +
      '<div id="imp-status" style="display:none;font-size:.85rem;padding:8px 10px;border-radius:8px;margin-bottom:10px"></div>' +
      '<button type="button" id="imp-go" class="btn" style="width:100%;padding:11px">ייבא לדף ←</button></div>';
    document.body.appendChild(ov);
    var close = function () { ov.remove(); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#imp-close').addEventListener('click', close);
    var statusEl = ov.querySelector('#imp-status');
    function setStatus(msg, kind) {
      statusEl.style.display = 'block';
      statusEl.textContent = msg;
      statusEl.style.background = kind === 'err' ? '#fef2f2' : (kind === 'ok' ? '#f0fdf4' : '#fffbeb');
      statusEl.style.color = kind === 'err' ? '#b91c1c' : (kind === 'ok' ? '#166534' : '#92400e');
    }
    ov.querySelector('#imp-primer').addEventListener('click', function () {
      fetch('/admin/api/pzn/primer').then(function (r) { return r.text(); }).then(function (t) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t).then(function () { setStatus('מילון BenTML הועתק — הדביקו בצ׳אט של ה‑AI', 'ok'); }, function () { setStatus('העתקה נכשלה', 'err'); });
        } else { setStatus('העתקה לא נתמכת בדפדפן', 'err'); }
      }).catch(function () { setStatus('שגיאה בטעינת המילון', 'err'); });
    });
    ov.querySelector('#imp-go').addEventListener('click', function () {
      var src = ov.querySelector('#imp-src').value;
      if (!src.trim()) { setStatus('הדביקו קודם את תשובת ה‑AI', 'err'); return; }
      var mode = (ov.querySelector('input[name="imp-mode"]:checked') || {}).value || 'replace';
      setStatus('מייבא…', '');
      fetch('/admin/api/pzn/to-blocks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: src }) })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data.ok) { setStatus(data.error || 'ייבוא נכשל', 'err'); return; }
          pushHistory();
          if (mode === 'append') blocks = blocks.concat(data.blocks || []);
          else blocks = data.blocks || [];
          selectedId = null;
          markDirty();
          renderCanvas();
          renderProperties();
          syncToolboxMode();
          applyCanvasPageBg();
          close();
          var note = data.repaired ? (' · תוקן אוטומטית (' + (data.changes || []).length + ')') : '';
          showToast('יובאו ' + (data.blocks || []).length + ' מודולים' + note + ' ✓', 'ok');
        })
        .catch(function () { setStatus('שגיאת רשת בייבוא', 'err'); });
    });
  }

  // Expose new actions
  window.TapuzBuilder = {
    init: init,
    addBlock: addBlock,
    replaceBlockType: replaceBlockType,
    savePage: savePage,
    saveAndBuild: saveAndBuild,
    publishPage: publishPage,
    publishAndBuild: publishAndBuild,
    openMediaLibrary: openMediaLibrary,
    closeMediaLibrary: closeMediaLibrary,
    uploadMedia: uploadMedia,
    openPagesNav: openPagesNav,
    closePagesNav: closePagesNav,
    openRevisions: openRevisions,
    closeRevisions: closeRevisions,
    openImportAi: openImportAi,
    // BenTML language bridge (used by admin-bentml-ui.js)
    _getBlocks: function () { return blocks; },
    _setBlocks: function (next, opts) {
      opts = opts || {};
      blocks = Array.isArray(next) ? next : [];
      // live-apply from the source editor keeps the selection when the block
      // survived the recompile (nested blocks keep ids; top-level get new ones)
      if (!(opts.keepSelection && selectedId && getBlock(selectedId))) selectedId = null;
      renderCanvas();
      renderProperties();
      syncToolboxMode();
    },
    _selectBlock: selectBlock,
    _getSelectedId: function () { return selectedId; },
    _pushHistory: pushHistory,
    _getTags: function () { return pageTags; },
    _getMeta: function () { return pageMeta; },
    _markDirty: markDirty,
    get _fullPath() { return currentPageFullPath; },
    get _direction() { return pageDirection; }
  };

  // Wire the pages-nav button if present
  var navBtn = document.getElementById('btn-pages-nav');
  if (navBtn) navBtn.onclick = openPagesNav;
})();
