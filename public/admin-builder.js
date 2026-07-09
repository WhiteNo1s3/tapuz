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
  var currentMediaTarget = null;
  var dragState = null; // { kind:'toolbox'|'block', blockType?, blockId? }
  var dropHint = null; // { mode:'insert'|'split', ... }
  var dropInProgress = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;');
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
      if (b.type === 'columns') {
        var cols = ensureColumns(b);
        for (var c = 0; c < cols.length; c++) {
          var found = findNode(id, cols[c].blocks, b, c);
          if (found) return found;
        }
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
      if (b.type === 'columns') {
        ensureColumns(b).forEach(function (col) {
          n += countAllBlocks(col.blocks);
        });
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

  /** Live list only — never trust a list reference captured at render time. */
  function getLiveList(parentId, colIndex) {
    if (!parentId) return blocks;
    var parent = getBlock(parentId);
    if (!parent || parent.type !== 'columns') return null;
    var cols = ensureColumns(parent);
    var ci = colIndex == null ? 0 : colIndex;
    while (cols.length <= ci) cols.push({ blocks: [] });
    if (!Array.isArray(cols[ci].blocks)) cols[ci].blocks = [];
    return cols[ci].blocks;
  }

  function containsId(rootBlock, id) {
    if (!rootBlock) return false;
    if (rootBlock.id === id) return true;
    if (rootBlock.type !== 'columns') return false;
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

  // ---- Block factory ----

  function makeBlock(type) {
    var newBlock = { type: type, id: uid(type), data: {} };
    if (type === 'hero') newBlock.data = { title: 'כותרת ראשית', subtitle: '' };
    else if (type === 'heading') newBlock.data = { text: 'כותרת', level: 2 };
    else if (type === 'text') newBlock.data = { content: 'טקסט חדש...' };
    else if (type === 'button') newBlock.data = { text: 'לחץ כאן', url: '#' };
    else if (type === 'spacer') newBlock.data = { height: '40px' };
    else if (type === 'columns') newBlock.data = { columns: [{ blocks: [] }, { blocks: [] }] };
    else if (type === 'image') newBlock.data = { src: '', alt: '' };
    else if (type === 'testimonial') newBlock.data = { quote: '', author: '' };
    else if (type === 'divider') newBlock.data = {};
    else if (type === 'features') newBlock.data = { items: [{ title: 'פריט', description: '' }] };
    return newBlock;
  }

  // ---- Init ----

  function init(config) {
    blocks = config.blocks || [];
    (function walk(list) {
      list.forEach(function (b) {
        if (!b.id) b.id = uid(b.type || 'block');
        if (b.type === 'columns') {
          ensureColumns(b).forEach(function (col) {
            walk(col.blocks || []);
          });
        }
      });
    })(blocks);

    currentPageFullPath = config.fullPath || '';
    selectedId = null;
    dropHint = null;
    renderCanvas();
    renderProperties();
    bindToolboxDrag();
  }

  // ---- Canvas ----

  function renderCanvas() {
    var canvas = document.getElementById('canvas');
    if (!canvas) return;
    canvas.innerHTML = '';
    canvas.classList.add('block-stack');

    if (!blocks.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-canvas';
      empty.innerHTML = 'הדף ריק.<br><strong>לחץ</strong> מודול משמאל או <strong>גרור</strong> לכאן<br><span style="font-size:0.85rem;opacity:.8">גרור מודול ליד מודול אחר כדי לפצל לשני טורים</span>';
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
      '<button type="button" data-act="edit" title="ערוך">✎</button>' +
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
      if (act === 'edit') selectBlock(block.id);
      if (act === 'dup') duplicateBlock(block.id);
      if (act === 'del') deleteBlock(block.id);
    });

    var label = document.createElement('div');
    label.className = 'block-label';
    label.textContent = (block.type || '').toUpperCase() + (nested ? ' · בטור' : '');

    var content = document.createElement('div');
    content.className = 'block-content';
    content.appendChild(renderBlockBody(block));

    // side split zones (not for columns container itself — drop between/into cols instead)
    if (block.type !== 'columns') {
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
      e.stopPropagation();
      selectBlock(block.id);
      var panel = document.getElementById('properties-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth' });
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

    if (block.type === 'hero') {
      wrap.innerHTML =
        '<div class="preview-hero">' +
        '<h1>' + esc(d.title || 'כותרת ראשית') + '</h1>' +
        (d.subtitle ? '<p>' + esc(d.subtitle) + '</p>' : '') +
        '</div>';
      return wrap;
    }

    if (block.type === 'heading') {
      var level = Math.min(Math.max(d.level || 2, 1), 6);
      wrap.innerHTML = '<h' + level + ' style="margin:4px 0">' + esc(d.text || 'כותרת') + '</h' + level + '>';
      return wrap;
    }

    if (block.type === 'text') {
      wrap.innerHTML =
        '<div style="line-height:1.6;color:#334155">' +
        esc(d.content || '').replace(/\n/g, '<br>') +
        '</div>';
      return wrap;
    }

    if (block.type === 'button') {
      wrap.innerHTML =
        '<div><span class="preview-btn">' + esc(d.text || 'לחץ כאן') + '</span></div>';
      return wrap;
    }

    if (block.type === 'image') {
      if (d.src) {
        wrap.innerHTML =
          '<img src="' + escAttr(d.src) + '" alt="" style="max-width:100%;border-radius:8px;border:1px solid #e2e8f0">';
      } else {
        wrap.innerHTML =
          '<div class="preview-image-empty">תמונה (לחץ לעריכה)</div>';
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
        '<div style="font-style:italic">' + esc(d.quote || 'ציטוט...') + '</div>' +
        '<div style="margin-top:8px;font-size:0.9rem;font-weight:600">' + esc(d.author || '') + '</div>' +
        '</div>';
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

    if (block.type === 'columns') {
      return renderColumnsBody(block);
    }

    wrap.textContent = block.type || '?';
    return wrap;
  }

  function renderColumnsBody(block) {
    var cols = ensureColumns(block);
    var row = document.createElement('div');
    row.className = 'columns-preview';

    cols.forEach(function (col, colIndex) {
      var colEl = document.createElement('div');
      colEl.className = 'column-pane';
      colEl.dataset.parentId = block.id;
      colEl.dataset.colIndex = String(colIndex);

      var head = document.createElement('div');
      head.className = 'column-head';
      head.textContent = 'טור ' + (colIndex + 1);
      colEl.appendChild(head);

      var listWrap = document.createElement('div');
      listWrap.className = 'column-list';
      // Always use the real col.blocks array via renderListInto (empty = one insert slot).
      if (!Array.isArray(col.blocks)) col.blocks = [];
      if (!col.blocks.length) {
        var empty = document.createElement('div');
        empty.className = 'column-empty';
        empty.textContent = 'גרור לכאן';
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
    });

    return row;
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
      dropInProgress = false;
      finishDrop();
    } catch (err) {
      console.error('Tapuz drop failed, restoring tree', err);
      restoreTree(snap);
      dropInProgress = false;
      finishDrop();
    }
  }

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

    if (targetNode.block.type === 'columns') {
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
      btn.addEventListener('dragstart', function (e) {
        dragState = { kind: 'toolbox', blockType: btn.dataset.type };
        e.dataTransfer.setData('text/plain', 'toolbox:' + btn.dataset.type);
        e.dataTransfer.effectAllowed = 'copy';
        btn.classList.add('dragging-tool');
        document.body.classList.add('is-dragging');
      });
      btn.addEventListener('dragend', function () {
        btn.classList.remove('dragging-tool');
        if (dropInProgress) return;
        document.body.classList.remove('is-dragging');
        dragState = null;
        dropHint = null;
        clearDropClasses();
      });
    });
  }

  // ---- Selection / properties ----

  function selectBlock(id) {
    selectedId = id;
    renderCanvas();
    renderProperties();
  }

  function field(label, inputHtml) {
    return '<div class="prop-group"><label>' + label + '</label>' + inputHtml + '</div>';
  }

  function renderProperties() {
    var panel = document.getElementById('properties-panel');
    if (!panel) return;

    var node = selectedId ? findNode(selectedId) : null;
    if (!node) {
      panel.innerHTML =
        '<div style="color:#64748b;font-size:0.9rem;padding:24px 10px;text-align:center;line-height:1.6">' +
        'לחץ על מודול לעריכה<br><br>' +
        '<strong>סידור:</strong> גרור בין מודולים<br>' +
        '<strong>פיצול לטורים:</strong> גרור לצד מודול<br>' +
        '(או כפתור ⧉ בסרגל)' +
        '</div>';
      return;
    }

    var block = node.block;
    var d = block.data || {};
    var nestHint = node.parent
      ? '<div class="nest-hint">בתוך עמודות · טור ' + ((node.colIndex || 0) + 1) + '</div>'
      : '';

    var html = nestHint + '<div style="margin-bottom:10px"><strong>' + esc(block.type) + '</strong></div>';

    if (block.type === 'hero') {
      html += field('כותרת', '<input data-key="title" value="' + escAttr(d.title || '') + '">');
      html += field('תת כותרת', '<input data-key="subtitle" value="' + escAttr(d.subtitle || '') + '">');
    } else if (block.type === 'heading') {
      html += field('טקסט', '<input data-key="text" value="' + escAttr(d.text || '') + '">');
      html += field('רמה (1-6)', '<input type="number" min="1" max="6" data-key="level" value="' + (d.level || 2) + '">');
    } else if (block.type === 'text') {
      html += field('תוכן', '<textarea data-key="content">' + esc(d.content || '') + '</textarea>');
    } else if (block.type === 'button') {
      html += field('טקסט', '<input data-key="text" value="' + escAttr(d.text || '') + '">');
      html += field('קישור', '<input data-key="url" value="' + escAttr(d.url || '') + '">');
    } else if (block.type === 'image') {
      html += field('כתובת תמונה (URL)', '<input data-key="src" value="' + escAttr(d.src || '') + '">');
      html += '<button type="button" class="btn" style="margin:6px 0 12px" data-media="' + escAttr(block.id) + '">בחר מספריית מדיה</button>';
      html += field('Alt (SEO)', '<input data-key="alt" value="' + escAttr(d.alt || '') + '">');
    } else if (block.type === 'testimonial') {
      html += field('ציטוט', '<textarea data-key="quote">' + esc(d.quote || '') + '</textarea>');
      html += field('שם', '<input data-key="author" value="' + escAttr(d.author || '') + '">');
    } else if (block.type === 'spacer') {
      html += field('גובה', '<input data-key="height" value="' + escAttr(d.height || '30px') + '">');
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
    } else if (block.type === 'columns') {
      html += '<div style="font-size:0.85rem;color:#64748b;margin-bottom:8px">גרור מודולים לטורים, או בין מודולים. גרור לצד מודול בתוך טור לפיצול נוסף.</div>';
      html += '<button type="button" class="btn" style="margin:4px" data-col="0">+ הוסף לטור 1</button>';
      html += '<button type="button" class="btn" style="margin:4px" data-col="1">+ הוסף לטור 2</button>';
      if (ensureColumns(block).length < 4) {
        html += '<button type="button" class="btn secondary" style="margin:4px" data-add-col="1">+ טור נוסף</button>';
      }
      html += '<button type="button" class="btn secondary" style="margin:4px;width:100%" data-unwrap="1">פרק עמודות (השטח הכל)</button>';
    }

    html += '<hr style="margin:18px 0;border-color:#f1f5f9">';
    html += field('Class', '<input data-key="className" value="' + escAttr(d.className || '') + '" placeholder="custom-class">');
    html += field('ID', '<input data-key="id" value="' + escAttr(d.id || '') + '">');

    if (node.parent) {
      html += '<button type="button" class="btn secondary" style="margin-top:8px;width:100%" data-unnest="1">הוצא משורת עמודות</button>';
    }

    panel.innerHTML = html;

    panel.querySelectorAll('[data-key]').forEach(function (input) {
      var apply = function (reRender) {
        var val = input.value;
        if (input.dataset.key === 'level') val = parseInt(val, 10) || 2;
        if (!block.data) block.data = {};
        block.data[input.dataset.key] = val;
        if (reRender) renderCanvas();
      };
      input.addEventListener('input', function () { apply(false); });
      input.addEventListener('change', function () { apply(true); });
      input.addEventListener('blur', function () { apply(true); });
    });

    panel.querySelectorAll('[data-feat]').forEach(function (input) {
      var apply = function (reRender) {
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

    var addFeat = panel.querySelector('[data-add-feat]');
    if (addFeat) {
      addFeat.addEventListener('click', function () {
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

    panel.querySelectorAll('[data-col]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        addChildToColumn(block.id, parseInt(btn.dataset.col, 10), 'text');
      });
    });

    var addCol = panel.querySelector('[data-add-col]');
    if (addCol) {
      addCol.addEventListener('click', function () {
        var cols = ensureColumns(block);
        if (cols.length < 4) cols.push({ blocks: [] });
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
    var newBlock = makeBlock(type);
    blocks.push(newBlock);
    selectedId = newBlock.id;
    renderCanvas();
    renderProperties();
  }

  function addChildToColumn(columnsBlockId, columnIndex, type) {
    type = type || 'text';
    var parent = getBlock(columnsBlockId);
    if (!parent) return;
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

  function deleteBlock(id) {
    removeNode(id);
    if (selectedId === id) selectedId = null;
    renderCanvas();
    renderProperties();
  }

  function duplicateBlock(id) {
    var n = findNode(id);
    if (!n) return;
    var copy = JSON.parse(JSON.stringify(n.block));
    (function reId(b) {
      b.id = uid(b.type);
      if (b.type === 'columns') {
        ensureColumns(b).forEach(function (col) {
          (col.blocks || []).forEach(reId);
        });
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
    var moved = n.list.splice(n.index, 1)[0];
    n.list.splice(newIdx, 0, moved);
    renderCanvas();
  }

  /** Toolbar: turn one block into 2-col with empty sibling */
  function splitBlockInPlace(id) {
    var n = findNode(id);
    if (!n || n.block.type === 'columns') return;
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
    if (!n || n.block.type !== 'columns') return;
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

  function savePage() {
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
        blocks: blocks
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          var orig = document.title;
          document.title = 'נשמר ✓';
          setTimeout(function () { document.title = orig; }, 1200);
        }
        return data;
      })
      .catch(function () { alert('שגיאה בשמירה'); });
  }

  function saveAndBuild() {
    savePage()
      .then(function () { return fetch('/admin/build', { method: 'POST' }); })
      .then(function (r) { return r.json(); })
      .then(function () { window.open('/', '_blank'); });
  }

  // ---- Media ----

  function openMediaLibrary(targetBlockId) {
    currentMediaTarget = targetBlockId || selectedId || null;
    var modal = document.getElementById('media-modal');
    var list = document.getElementById('media-list');
    if (!modal || !list) return;
    list.innerHTML = 'טוען...';
    modal.classList.add('show');

    fetch('/admin/assets')
      .then(function (r) { return r.json(); })
      .then(function (files) {
        if (!files.length) {
          list.innerHTML = '<div style="color:#64748b">אין תמונות עדיין. העלה אחת.</div>';
          return;
        }
        list.innerHTML = files
          .map(function (f) {
            return (
              '<div class="media-item" data-url="' + escAttr(f.url) + '">' +
              '<img src="' + escAttr(f.url) + '" alt="">' +
              '<div class="media-name">' + esc(f.name) + '</div></div>'
            );
          })
          .join('');

        list.querySelectorAll('.media-item').forEach(function (item) {
          item.addEventListener('click', function () { pickMedia(item.dataset.url); });
        });
      })
      .catch(function () {
        list.innerHTML = '<div style="color:#b91c1c">שגיאה בטעינת מדיה</div>';
      });
  }

  function closeMediaLibrary() {
    var modal = document.getElementById('media-modal');
    if (modal) modal.classList.remove('show');
  }

  function pickMedia(url) {
    if (currentMediaTarget) {
      var block = getBlock(currentMediaTarget);
      if (block) {
        if (!block.data) block.data = {};
        block.data.src = url;
        selectedId = block.id;
        renderCanvas();
        renderProperties();
      }
    }
    closeMediaLibrary();
  }

  function uploadMedia(input) {
    if (!input.files || !input.files.length) return;
    var file = input.files[0];
    var reader = new FileReader();
    reader.onload = function () {
      fetch('/admin/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, data: reader.result })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.ok && data.url) {
            if (currentMediaTarget) pickMedia(data.url);
            else openMediaLibrary(currentMediaTarget);
          } else {
            alert(data.error || 'שגיאה בהעלאה');
          }
          input.value = '';
        })
        .catch(function () { alert('שגיאה בהעלאה'); });
    };
    reader.readAsDataURL(file);
  }

  // ---- Keyboard ----

  document.addEventListener('keydown', function (e) {
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      savePage();
    }
    if (
      e.key === 'Delete' &&
      selectedId &&
      !/INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || '')
    ) {
      e.preventDefault();
      deleteBlock(selectedId);
    }
  });

  window.TapuzBuilder = {
    init: init,
    addBlock: addBlock,
    savePage: savePage,
    saveAndBuild: saveAndBuild,
    openMediaLibrary: openMediaLibrary,
    closeMediaLibrary: closeMediaLibrary,
    uploadMedia: uploadMedia
  };
})();
