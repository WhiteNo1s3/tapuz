/**
 * BenTML OUTPUT — closed loop with the visual page builder.
 *
 * Visual builder is the editor.
 * BenTML is the code that IS the page under language rules (decompile always).
 * Paste/apply is reverse direction (compile). Not a chat product.
 */
(function () {
  'use strict';

  var mode = 'page';
  var refreshTimer = null;
  var outputLocked = false; // true while user types in output textarea before apply
  var lastOutput = '';

  function $(id) {
    return document.getElementById(id);
  }

  function pageMetaFromDom() {
    var titleEl = $('page-title');
    var TB = window.TapuzBuilder;
    return {
      title: titleEl ? titleEl.value : 'עמוד',
      slug: (TB && TB._fullPath) || '',
      direction: (TB && TB._direction) || document.documentElement.getAttribute('dir') || 'rtl',
      status: 'draft',
      tags: (TB && TB._getTags && TB._getTags()) || [],
      meta: (TB && TB._getMeta && TB._getMeta()) || {}
    };
  }

  function getBlocks() {
    return (window.TapuzBuilder && window.TapuzBuilder._getBlocks && window.TapuzBuilder._getBlocks()) || [];
  }

  function setBlocks(blocks) {
    if (window.TapuzBuilder && window.TapuzBuilder._setBlocks) {
      window.TapuzBuilder._setBlocks(blocks);
    }
  }

  function setStatus(msg, kind) {
    ['bentml-source-status', 'bentml-live-status'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.textContent = msg;
      el.className = 'bentml-status' + (kind ? ' ' + kind : '');
    });
  }

  /**
   * Decompile current canvas → BenTML under language rules.
   * This IS the page code, not an optional export afterthought.
   */
  function refreshOutput(force) {
    if (outputLocked && !force) return;
    var ta = $('bentml-source');
    var live = $('bentml-live-output');
    if (!ta && !live) return;

    fetch('/admin/api/bentml/decompile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: pageMetaFromDom(), blocks: getBlocks() })
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.ok) {
          setStatus(data.error || 'שגיאת decompile', 'err');
          return;
        }
        lastOutput = data.source || '';
        if (ta && (force || mode === 'output' || !outputLocked)) {
          if (document.activeElement !== ta || force) ta.value = lastOutput;
        }
        if (live) live.value = lastOutput;
        var n = getBlocks().length;
        setStatus('פלט BenTML חי · ' + n + ' מודולים · לפי כללי השפה', 'ok');
      })
      .catch(function () {
        setStatus('שגיאת רשת ב־decompile', 'err');
      });
  }

  function onBuilderChange() {
    // debounce live decompile while dragging/typing
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      refreshOutput(false);
    }, 280);
  }

  function applyOutput() {
    var ta = $('bentml-source') || $('bentml-live-output');
    if (!ta) return;
    var source = ($('bentml-source') && $('bentml-source').value) || ta.value;
    setStatus('מקמפל לפי כללי BenTML…', '');
    fetch('/admin/api/bentml/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: source })
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.ok) {
          setStatus(
            (data.code || 'ERR') + ': ' + (data.error || '') + (data.fix ? ' · ' + data.fix : ''),
            'err'
          );
          return;
        }
        outputLocked = false;
        setBlocks(data.blocks || []);
        if (data.page && data.page.title) {
          var titleEl = $('page-title');
          if (titleEl) titleEl.value = data.page.title;
        }
        if (window.TapuzBuilder && window.TapuzBuilder._markDirty) {
          // markDirty will refresh output again
          window.TapuzBuilder._markDirty();
        }
        setStatus('הודבק לדף · ' + (data.blocks || []).length + ' מודולים · הפלט = השפה', 'ok');
        setMode('page');
        refreshOutput(true);
      })
      .catch(function () {
        setStatus('שגיאת רשת ב־compile', 'err');
      });
  }

  function copyOutput() {
    var text = lastOutput || ($('bentml-source') && $('bentml-source').value) || '';
    if (!text) {
      refreshOutput(true);
      setTimeout(function () {
        copyOutput();
      }, 400);
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        setStatus('הועתק פלט BenTML ✓', 'ok');
      });
    } else {
      setStatus('העתיקו ידנית מתיבת הפלט', 'warn');
    }
  }

  function setMode(next) {
    mode = next === 'source' ? 'output' : next;
    if (next === 'source') mode = 'output';

    document.querySelectorAll('[data-builder-mode]').forEach(function (btn) {
      var m = btn.getAttribute('data-builder-mode');
      var active = m === next || (next === 'output' && m === 'source') || (mode === 'output' && m === 'source');
      if (m === 'output') active = mode === 'output';
      btn.classList.toggle('active', active);
    });

    var pagePane = $('builder-pane-page');
    var sourcePane = $('builder-pane-source');
    var toolbox = document.querySelector('.toolbox');
    var props = document.querySelector('.properties');
    var builder = document.querySelector('.builder');
    var dock = $('bentml-output-dock');

    var showPage = mode === 'page';
    var showOutput = mode === 'output';

    if (pagePane) pagePane.hidden = !showPage;
    if (sourcePane) sourcePane.hidden = !showOutput;
    if (toolbox) toolbox.hidden = !showPage;
    if (props) props.hidden = !showPage;
    if (dock) dock.hidden = !showPage; // dock visible on page mode

    if (builder) {
      builder.classList.toggle('mode-page', showPage);
      builder.classList.toggle('mode-source', showOutput);
      builder.classList.toggle('live-page', showPage);
    }

    if (showOutput) {
      outputLocked = false;
      refreshOutput(true);
    }
  }

  function boot() {
    document.querySelectorAll('[data-builder-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var m = btn.getAttribute('data-builder-mode');
        if (m === 'source') m = 'output';
        setMode(m);
      });
    });

    var applyBtn = $('btn-bentml-apply');
    if (applyBtn) {
      applyBtn.textContent = 'החל פלט → דף (compile)';
      applyBtn.addEventListener('click', applyOutput);
    }
    var syncBtn = $('btn-bentml-sync');
    if (syncBtn) {
      syncBtn.textContent = 'רענן פלט מהדף (decompile)';
      syncBtn.addEventListener('click', function () {
        outputLocked = false;
        refreshOutput(true);
      });
    }
    var copyBtn = $('btn-bentml-copy');
    if (copyBtn) copyBtn.addEventListener('click', copyOutput);
    var copyLive = $('btn-bentml-copy-live');
    if (copyLive) copyLive.addEventListener('click', copyOutput);
    var openOut = $('btn-open-output');
    if (openOut) {
      openOut.addEventListener('click', function () {
        setMode('output');
      });
    }

    var ta = $('bentml-source');
    if (ta) {
      ta.addEventListener('input', function () {
        outputLocked = true;
        setStatus('ערכתם פלט ידנית · החל לדף כדי לסנכרן בונה', 'warn');
      });
      ta.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          applyOutput();
        }
      });
    }

    // initial output
    setTimeout(function () {
      refreshOutput(true);
    }, 200);
    setMode('page');
  }

  var prevInit = window.TapuzBuilder && window.TapuzBuilder.init;
  if (window.TapuzBuilder && prevInit) {
    window.TapuzBuilder.init = function (opts) {
      prevInit(opts);
      boot();
    };
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }

  window.BentmlUI = {
    setMode: setMode,
    onBuilderChange: onBuilderChange,
    refreshOutput: refreshOutput,
    applyOutput: applyOutput
  };
})();
