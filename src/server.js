const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const {
  createPage, updatePage, listPages, getPageByFullPath, deletePage
} = require('./pages');
const { exportAll } = require('./export');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Assets
const uploadDir = path.join(__dirname, '..', 'public', 'assets');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/assets', express.static(uploadDir));

// Media: list + upload (base64 JSON to avoid extra deps)
app.get('/admin/assets', (req, res) => {
  try {
    const files = fs.readdirSync(uploadDir)
      .filter(f => /\.(png|jpe?g|gif|webp|svg)$/i.test(f))
      .map(f => ({ name: f, url: '/assets/' + f }));
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/admin/upload', (req, res) => {
  try {
    const { filename, data } = req.body || {};
    if (!filename || !data || typeof data !== 'string') {
      return res.status(400).json({ ok: false, error: 'missing filename/data' });
    }

    const safe = String(filename)
      .replace(/[^a-zA-Z0-9._\-\u0590-\u05FF]/g, '_')
      .slice(0, 80);
    const match = data.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ ok: false, error: 'invalid data url' });
    }

    const mime = match[1];
    const extFromMime = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg'
    }[mime] || path.extname(safe) || '.png';

    const base = path.basename(safe, path.extname(safe)) || 'image';
    const finalName = base + '-' + Date.now() + extFromMime;
    const buf = Buffer.from(match[2], 'base64');
    fs.writeFileSync(path.join(uploadDir, finalName), buf);

    res.json({ ok: true, url: '/assets/' + finalName, name: finalName });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

function layout(content, title = 'Tapuz') {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} • Tapuz</title>
  <link rel="stylesheet" href="/css/main.css">
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Hebrew", sans-serif;
      background: #f8fafc;
      margin: 0;
      color: #0f172a;
    }
    .container { max-width: 1280px; margin: 0 auto; padding: 0 20px; }

    .topbar {
      background: #fff;
      border-bottom: 1px solid #e2e8f0;
      padding: 12px 0;
      position: sticky;
      top: 0;
      z-index: 200;
    }
    .topbar-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .topbar-left { display: flex; align-items: center; gap: 16px; }
    .topbar input.page-title {
      font-size: 1.25rem;
      font-weight: 600;
      border: none;
      background: transparent;
      padding: 4px 8px;
      min-width: 280px;
      border-radius: 6px;
    }
    .topbar input.page-title:focus {
      background: #f8fafc;
      outline: 1.5px solid #0a66c2;
    }

    .builder {
      display: grid;
      grid-template-columns: 210px 1fr 300px;
      gap: 20px;
      padding-top: 20px;
      padding-bottom: 80px;
    }

    .toolbox {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px;
      height: fit-content;
      position: sticky;
      top: 70px;
    }
    .toolbox h4 {
      margin: 0 0 12px;
      font-size: 0.85rem;
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .toolbox-mode {
      font-size: 0.75rem;
      color: #64748b;
      line-height: 1.45;
      margin: -4px 0 12px;
      padding: 8px 10px;
      background: #f8fafc;
      border-radius: 8px;
      border: 1px dashed #e2e8f0;
    }
    .toolbox.has-selection .toolbox-mode {
      background: #eff6ff;
      border-color: #bfdbfe;
      color: #1e40af;
    }
    .tool-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      text-align: right;
      padding: 10px 12px;
      margin-bottom: 6px;
      border: 1px solid #e2e8f0;
      background: #fff;
      border-radius: 8px;
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      transition: all .1s;
    }
    .tool-btn .tool-ico {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: #f1f5f9;
      color: #475569;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .tool-btn .tool-meta { flex: 1; min-width: 0; }
    .tool-btn .tool-name { display: block; line-height: 1.2; }
    .tool-btn .tool-hint {
      display: block;
      font-size: 0.7rem;
      color: #94a3b8;
      font-weight: 500;
      margin-top: 2px;
    }
    .tool-btn:hover {
      border-color: #0a66c2;
      background: #f0f7ff;
      color: #0a66c2;
    }
    .tool-btn:hover .tool-ico { background: #dbeafe; color: #0a66c2; }
    .tool-btn.is-current {
      border-color: #0a66c2;
      background: #eff6ff;
      box-shadow: inset 3px 0 0 #0a66c2;
    }
    .toolbox.has-selection .tool-btn.is-replace-mode:not(.is-current):hover {
      border-color: #7c3aed;
      background: #f5f3ff;
      color: #5b21b6;
    }
    .toolbox.has-selection .tool-btn.is-replace-mode:not(.is-current):hover .tool-ico {
      background: #ede9fe;
      color: #6d28d9;
    }

    .canvas {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      min-height: 620px;
      padding: 24px;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
    }
    .canvas-header {
      font-size: 0.8rem;
      color: #64748b;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #f1f5f9;
      display: flex;
      justify-content: space-between;
    }

    .canvas-block {
      position: relative;
      margin-bottom: 14px;
      border: 2px solid transparent;
      border-radius: 10px;
      padding: 4px 28px 8px 8px;
      transition: all 0.1s;
      cursor: default;
      background: #fff;
    }
    .canvas-block:hover { border-color: #cbd5e1; }
    .canvas-block.selected {
      border-color: #0a66c2;
      background: #f8fafc;
      box-shadow: 0 0 0 3px rgba(10,102,194,0.12);
    }
    .canvas-block.nested {
      margin-bottom: 8px;
      padding: 4px 24px 6px 6px;
      background: #fff;
      border-style: dashed;
    }
    .canvas-block.dragging { opacity: 0.45; }
    .canvas-block.drag-ghost { outline: 2px dashed #0a66c2; }

    .block-handle {
      position: absolute;
      top: 50%;
      right: 6px;
      transform: translateY(-50%);
      color: #94a3b8;
      font-size: 14px;
      cursor: grab;
      user-select: none;
      line-height: 1;
      padding: 4px 2px;
    }
    .block-handle:active { cursor: grabbing; }
    .canvas-block:hover .block-handle { color: #0a66c2; }

    .block-toolbar {
      position: absolute;
      top: -11px;
      left: 10px;
      background: #0f172a;
      color: white;
      font-size: 11px;
      padding: 1px 8px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      gap: 2px;
      opacity: 0;
      transition: opacity .1s;
      z-index: 10;
    }
    .canvas-block:hover .block-toolbar,
    .canvas-block.selected .block-toolbar { opacity: 1; }
    .block-toolbar button {
      background: none;
      border: none;
      color: #cbd5e1;
      font-size: 13px;
      padding: 2px 5px;
      cursor: pointer;
      line-height: 1;
    }
    .block-toolbar button:hover { color: white; }

    .block-label {
      font-size: 11px;
      color: #64748b;
      font-weight: 600;
      margin-bottom: 4px;
      letter-spacing: .2px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .block-type-icon {
      display: inline-flex;
      width: 18px;
      height: 18px;
      align-items: center;
      justify-content: center;
      background: #f1f5f9;
      border-radius: 4px;
      font-size: 10px;
      color: #475569;
    }
    .nest-tag {
      font-size: 10px;
      color: #94a3b8;
      font-weight: 500;
    }
    .canvas-header .canvas-hint {
      opacity: 0;
      transition: opacity .2s;
      color: #0a66c2;
      font-weight: 600;
      font-size: 0.78rem;
      margin-inline-start: auto;
      padding-inline-start: 12px;
    }
    .canvas-header .canvas-hint.visible { opacity: 1; }
    .canvas-header { gap: 8px; flex-wrap: wrap; }

    .prop-type-head {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .prop-type-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: #eff6ff;
      color: #0a66c2;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      font-weight: 700;
    }
    .prop-type-name { font-weight: 700; font-size: 1rem; }
    .prop-type-sub { font-size: 0.75rem; color: #64748b; }
    .prop-hint {
      font-size: 0.72rem;
      color: #94a3b8;
      margin-top: 6px;
      line-height: 1.4;
    }
    .replace-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .replace-chip {
      border: 1px solid #e2e8f0;
      background: #fff;
      border-radius: 999px;
      padding: 5px 10px;
      font-size: 0.78rem;
      font-weight: 600;
      color: #334155;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-family: inherit;
    }
    .replace-chip:hover {
      border-color: #7c3aed;
      background: #f5f3ff;
      color: #5b21b6;
    }
    .replace-chip.active {
      border-color: #0a66c2;
      background: #eff6ff;
      color: #0a66c2;
      cursor: default;
    }
    .replace-chip .chip-icon { font-size: 0.7rem; opacity: .85; }
    .props-empty {
      color: #64748b;
      font-size: 0.88rem;
      padding: 18px 6px;
      text-align: center;
      line-height: 1.55;
    }
    .props-empty-title {
      font-weight: 700;
      color: #334155;
      margin-bottom: 12px;
      font-size: 0.95rem;
    }
    .props-empty-line {
      margin: 6px 0;
      text-align: right;
      padding: 6px 8px;
      background: #f8fafc;
      border-radius: 8px;
      font-size: 0.8rem;
    }
    .nest-hint {
      font-size: 0.75rem;
      color: #0a66c2;
      background: #eff6ff;
      border-radius: 6px;
      padding: 4px 8px;
      margin-bottom: 10px;
      display: inline-block;
    }

    .properties {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 18px;
      height: fit-content;
      position: sticky;
      top: 70px;
    }
    .properties h4 { margin: 0 0 14px; font-size: 0.95rem; }
    .prop-group { margin-bottom: 14px; }
    .prop-group label {
      display: block;
      font-size: 0.8rem;
      font-weight: 600;
      margin-bottom: 4px;
      color: #475569;
    }
    .prop-group input, .prop-group textarea, .prop-group select {
      width: 100%;
      padding: 8px 10px;
      border: 1.5px solid #cbd5e1;
      border-radius: 7px;
      font-size: 0.95rem;
      font-family: inherit;
    }
    .prop-group textarea { min-height: 80px; }

    .empty-canvas {
      padding: 80px 20px;
      text-align: center;
      color: #64748b;
      border: 2px dashed #e2e8f0;
      border-radius: 12px;
    }

    .save-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: white;
      border-top: 1px solid #e2e8f0;
      padding: 14px 0;
      z-index: 300;
    }

    /* Stacked block list */
    .block-stack, .block-list { min-height: 40px; }
    .list-drop-active {
      outline: 2px dashed #93c5fd;
      outline-offset: 2px;
      border-radius: 10px;
    }

    /* Insert-between slots (vertical stack) */
    .drop-slot {
      height: 10px;
      margin: 0;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: height .1s;
    }
    body.is-dragging .drop-slot { height: 18px; }
    .drop-slot-line {
      display: block;
      width: 100%;
      height: 2px;
      background: transparent;
      border-radius: 2px;
      transition: background .1s, height .1s;
    }
    .drop-slot-label {
      display: none;
      position: absolute;
      font-size: 10px;
      font-weight: 700;
      color: #0a66c2;
      background: #eff6ff;
      padding: 1px 8px;
      border-radius: 999px;
      pointer-events: none;
    }
    .drop-slot.drop-slot-active {
      height: 28px;
    }
    .drop-slot.drop-slot-active .drop-slot-line {
      height: 3px;
      background: #0a66c2;
      box-shadow: 0 0 0 3px rgba(10,102,194,.12);
    }
    .drop-slot.drop-slot-active .drop-slot-label { display: inline-block; }

    /* Side split zones — drop beside a block to create columns */
    .split-zone {
      position: absolute;
      top: 8px;
      bottom: 8px;
      width: 22px;
      opacity: 0;
      pointer-events: none;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 5;
      transition: opacity .12s, background .12s, width .12s;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 700;
      color: #0a66c2;
      writing-mode: horizontal-tb;
    }
    .split-zone span {
      transform: none;
      white-space: nowrap;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 6px;
      padding: 4px 2px;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      letter-spacing: .5px;
    }
    .split-left { left: 2px; }
    .split-right { right: 24px; }
    body.is-dragging .split-zone {
      opacity: 0.55;
      pointer-events: auto;
      background: rgba(239,246,255,.55);
    }
    body.is-dragging .canvas-block:hover .split-zone,
    .split-zone.split-active {
      opacity: 1;
      width: 28px;
      background: #dbeafe;
      box-shadow: inset 0 0 0 1px #0a66c2;
    }
    .canvas-block.split-target {
      border-color: #0a66c2 !important;
      box-shadow: 0 0 0 3px rgba(10,102,194,.15);
    }

    .columns-preview {
      display: flex;
      gap: 12px;
      align-items: stretch;
      direction: ltr; /* physical left/right for split side */
    }
    .column-pane, .column-drop {
      flex: 1;
      min-width: 0;
      background: #f8fafc;
      border: 1.5px dashed #cbd5e1;
      border-radius: 10px;
      min-height: 110px;
      padding: 8px;
      transition: border-color .12s, background .12s, box-shadow .12s;
      direction: rtl;
    }
    .column-drop.drop-hover, .column-pane.list-drop-active {
      border-color: #0a66c2;
      background: #eff6ff;
      box-shadow: inset 0 0 0 1px #0a66c2;
    }
    .column-head {
      font-size: 11px;
      font-weight: 700;
      color: #64748b;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: .4px;
    }
    .column-empty {
      padding: 18px 8px;
      text-align: center;
      color: #94a3b8;
      font-size: 0.85rem;
      border: 1px dashed #e2e8f0;
      border-radius: 8px;
      margin: 4px 0;
    }
    .column-add {
      width: 100%;
      margin-top: 4px;
      padding: 6px;
      border: 1px solid #e2e8f0;
      background: #fff;
      border-radius: 6px;
      font-size: 0.8rem;
      color: #475569;
      cursor: pointer;
    }
    .column-add:hover {
      border-color: #0a66c2;
      color: #0a66c2;
    }
    .canvas.drop-hover-root, .canvas.list-drop-active {
      outline: 2px dashed #0a66c2;
      outline-offset: -4px;
    }
    .preview-features { display: grid; gap: 8px; }
    .preview-feature {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 0.9rem;
    }
    .preview-feature strong { display: block; margin-bottom: 2px; }
    .preview-hero {
      background: #0a66c2;
      color: white;
      padding: 28px 24px;
      border-radius: 8px;
      text-align: center;
    }
    .preview-hero h1 { margin: 0 0 8px; font-size: 1.8rem; color: white; }
    .preview-hero p { margin: 0; opacity: 0.9; }
    .preview-btn {
      display: inline-block;
      background: #0a66c2;
      color: white;
      padding: 8px 20px;
      border-radius: 6px;
      font-weight: 600;
    }
    .preview-image-empty {
      background: #f1f5f9;
      padding: 40px 20px;
      text-align: center;
      border-radius: 8px;
      color: #64748b;
    }
    .preview-spacer {
      background: repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9 4px,#fff 4px,#fff 8px);
      border-radius: 4px;
    }
    .preview-testimonial {
      background: #f8fafc;
      padding: 16px;
      border-radius: 8px;
      border-right: 4px solid #0a66c2;
    }
    .nest-hint {
      background: #eff6ff;
      color: #0a66c2;
      font-size: 0.78rem;
      font-weight: 600;
      padding: 6px 10px;
      border-radius: 6px;
      margin-bottom: 10px;
    }
    .media-item {
      cursor: pointer;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
      background: #fff;
    }
    .media-item:hover { border-color: #0a66c2; }
    .media-item img {
      width: 100%;
      height: 90px;
      object-fit: cover;
      display: block;
    }
    .media-name {
      padding: 4px;
      font-size: 0.75rem;
      text-align: center;
      color: #475569;
    }
    .tool-btn.dragging-tool { opacity: 0.55; }
    .tool-btn[draggable="true"] { cursor: grab; }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 16px;
      background: #0a66c2;
      color: white;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.95rem;
      text-decoration: none;
      cursor: pointer;
    }
    .btn:hover { background: #084d96; }
    .btn.secondary { background: #64748b; }
    .btn.secondary:hover { background: #475569; }

    .modal {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.65);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 999;
    }
    .modal.show { display: flex; }
    .modal-content {
      background: white;
      padding: 28px;
      border-radius: 16px;
      width: 100%;
      max-width: 720px;
    }
  </style>
</head>
<body>
  ${content}
</body>
</html>`;
}

// ======================== ROUTES ========================

app.get('/admin', (req, res) => {
  const pages = listPages();
  const msg = req.query.built
    ? `<div style="background:#ecfdf5;border:1px solid #10b981;color:#166534;padding:12px 18px;border-radius:10px;margin-bottom:16px;">האתר נבנה בהצלחה ✓ <a href="/" target="_blank" style="color:#166534;font-weight:600">צפה באתר</a></div>`
    : '';

  let listHtml = pages.length === 0
    ? `<div style="padding:40px;text-align:center;color:#64748b">אין דפים עדיין</div>`
    : pages.map(p => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:8px;background:white">
        <div>
          <strong>${p.title}</strong><br>
          <span style="font-family:monospace;font-size:0.85rem;color:#64748b">/${p.full_path}</span>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/admin/edit/${encodeURIComponent(p.full_path)}" class="btn" style="padding:8px 16px">ערוך</a>
          <form method="POST" action="/admin/delete" onsubmit="return confirm('למחוק?')">
            <input type="hidden" name="full_path" value="${p.full_path}">
            <button type="submit" class="btn secondary" style="padding:8px 14px">מחק</button>
          </form>
        </div>
      </div>
    `).join('');

  const html = `
    <div class="topbar">
      <div class="container topbar-inner">
        <div style="display:flex;align-items:center;gap:12px">
          <a href="/admin" style="font-size:1.6rem;font-weight:700;text-decoration:none;color:#0f172a">Tapuz</a>
          <span style="color:#94a3b8">•</span>
          <span style="font-weight:600">הדפים</span>
        </div>
        <a href="/admin/new" class="btn">+ דף חדש</a>
      </div>
    </div>
    <div class="container" style="padding-top:30px">
      ${msg}
      ${listHtml}
    </div>
  `;
  res.send(layout(html));
});

app.get('/admin/new', (req, res) => {
  const html = `
    <div class="topbar"><div class="container"><a href="/admin" style="font-size:1.5rem;font-weight:700;text-decoration:none">Tapuz</a></div></div>
    <div class="container" style="max-width:520px;padding-top:40px">
      <h2 style="margin-bottom:20px">דף חדש</h2>
      <form method="POST" action="/admin/create">
        <div style="margin-bottom:14px">
          <label style="display:block;margin-bottom:4px;font-weight:600">כותרת</label>
          <input name="title" required style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px">
        </div>
        <div style="margin-bottom:20px">
          <label style="display:block;margin-bottom:4px;font-weight:600">כתובת (slug)</label>
          <input name="slug" required style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px">
        </div>
        <button type="submit" class="btn">צור דף והתחל לערוך</button>
      </form>
    </div>
  `;
  res.send(layout(html));
});

app.post('/admin/create', (req, res) => {
  const { title, slug } = req.body;
  const result = createPage({
    title,
    slug,
    direction: 'rtl',
    blocks: [
      { type: 'hero', id: 'h_' + Date.now(), data: { title, subtitle: '' } }
    ]
  });
  res.redirect('/admin/edit/' + encodeURIComponent(result.full_path));
});

app.post('/admin/delete', (req, res) => {
  deletePage(req.body.full_path);
  res.redirect('/admin');
});

// ======================== VISUAL CANVAS BUILDER ========================
app.get('/admin/edit/:fullPath', (req, res) => {
  const fullPath = decodeURIComponent(req.params.fullPath);
  const page = getPageByFullPath(fullPath);
  if (!page) return res.status(404).send('דף לא נמצא');

  const initialBlocks = JSON.stringify(page.blocks || []);
  const safeTitle = String(page.title || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');

  const html = `
    <div class="topbar">
      <div class="container topbar-inner">
        <div class="topbar-left">
          <a href="/admin" style="font-weight:700;font-size:1.35rem;text-decoration:none;color:#0f172a">Tapuz</a>
          <input id="page-title" class="page-title" value="${safeTitle}" placeholder="כותרת הדף">
          <select id="page-status" style="padding:4px 10px;border-radius:6px;border:1px solid #cbd5e1">
            <option value="draft" ${page.status === 'draft' ? 'selected' : ''}>טיוטה</option>
            <option value="published" ${page.status === 'published' ? 'selected' : ''}>פורסם</option>
          </select>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <a href="/" target="_blank" class="btn secondary">צפה באתר</a>
          <button onclick="TapuzBuilder.savePage()" class="btn">שמור</button>
          <button onclick="TapuzBuilder.saveAndBuild()" class="btn" style="background:#166534">שמור + בנה</button>
        </div>
      </div>
    </div>

    <div class="container">
      <div class="builder">
        <div class="toolbox">
          <h4>מודולים</h4>
          <div id="toolbox-mode" class="toolbox-mode">גרור לקנבס · או לחץ להוספה בסוף</div>
          <button type="button" class="tool-btn" data-type="hero" title="כותרת גדולה בראש">
            <span class="tool-ico">★</span><span class="tool-meta"><span class="tool-name">Hero</span><span class="tool-hint">כותרת גדולה</span></span>
          </button>
          <button type="button" class="tool-btn" data-type="heading" title="כותרת">
            <span class="tool-ico">H</span><span class="tool-meta"><span class="tool-name">כותרת</span><span class="tool-hint">H1–H6</span></span>
          </button>
          <button type="button" class="tool-btn" data-type="text" title="טקסט">
            <span class="tool-ico">¶</span><span class="tool-meta"><span class="tool-name">טקסט</span><span class="tool-hint">פסקה</span></span>
          </button>
          <button type="button" class="tool-btn" data-type="button" title="כפתור">
            <span class="tool-ico">◉</span><span class="tool-meta"><span class="tool-name">כפתור</span><span class="tool-hint">קישור / CTA</span></span>
          </button>
          <button type="button" class="tool-btn" data-type="image" title="תמונה">
            <span class="tool-ico">▣</span><span class="tool-meta"><span class="tool-name">תמונה</span><span class="tool-hint">מדיה</span></span>
          </button>
          <button type="button" class="tool-btn" data-type="testimonial" title="המלצה">
            <span class="tool-ico">❝</span><span class="tool-meta"><span class="tool-name">המלצה</span><span class="tool-hint">ציטוט + שם</span></span>
          </button>
          <button type="button" class="tool-btn" data-type="features" title="תכונות">
            <span class="tool-ico">▦</span><span class="tool-meta"><span class="tool-name">תכונות</span><span class="tool-hint">כרטיסים</span></span>
          </button>
          <button type="button" class="tool-btn" data-type="columns" title="עמודות">
            <span class="tool-ico">▥</span><span class="tool-meta"><span class="tool-name">עמודות</span><span class="tool-hint">2–4 טורים</span></span>
          </button>
          <button type="button" class="tool-btn" data-type="spacer" title="רווח">
            <span class="tool-ico">↕</span><span class="tool-meta"><span class="tool-name">רווח</span><span class="tool-hint">מרווח אנכי</span></span>
          </button>
          <button type="button" class="tool-btn" data-type="divider" title="קו מפריד">
            <span class="tool-ico">—</span><span class="tool-meta"><span class="tool-name">קו מפריד</span><span class="tool-hint">קו אופקי</span></span>
          </button>
          <hr style="margin:12px 0;border-color:#e2e8f0">
          <button type="button" class="tool-btn" onclick="TapuzBuilder.openMediaLibrary()" style="border:1px solid #0a66c2;color:#0a66c2">
            <span class="tool-ico">🖼</span><span class="tool-meta"><span class="tool-name">מדיה</span><span class="tool-hint">ספרייה / העלאה</span></span>
          </button>
        </div>

        <div>
          <div class="canvas-header">
            <span>תצוגה חיה</span>
            <span id="block-count">${(page.blocks || []).length} מודולים</span>
            <span id="canvas-hint" class="canvas-hint"></span>
          </div>
          <div id="canvas" class="canvas"></div>
        </div>

        <div class="properties">
          <h4>מאפיינים</h4>
          <div id="properties-panel">
            <div style="color:#64748b;font-size:0.9rem;padding:30px 10px;text-align:center">
              לחץ על מודול כדי לערוך<br>
              או הוסף מודול חדש
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="save-bar">
      <div class="container" style="display:flex;gap:12px;justify-content:flex-end">
        <button onclick="TapuzBuilder.savePage()" class="btn">שמור שינויים</button>
        <button onclick="TapuzBuilder.saveAndBuild()" class="btn" style="background:#166534">שמור + בנה אתר</button>
      </div>
    </div>

    <div id="media-modal" class="modal" onclick="if (event.target.id === 'media-modal') TapuzBuilder.closeMediaLibrary()">
      <div class="modal-content" onclick="event.stopPropagation()">
        <h3 style="margin-top:0">מספריית מדיה</h3>
        <div id="media-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;max-height:400px;overflow:auto"></div>
        <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end">
          <button type="button" class="btn secondary" onclick="TapuzBuilder.closeMediaLibrary()">סגור</button>
          <label class="btn" style="cursor:pointer">העלה תמונה
            <input type="file" accept="image/*" style="display:none" onchange="TapuzBuilder.uploadMedia(this)">
          </label>
        </div>
      </div>
    </div>

    <script src="/admin-builder.js"></script>
    <script>
      TapuzBuilder.init({
        fullPath: ${JSON.stringify(page.full_path)},
        blocks: ${initialBlocks}
      });
    </script>
  `;
  res.send(layout(html, 'עריכה • ' + page.title));
});

app.post('/admin/save', (req, res) => {
  try {
    const { full_path, title, status, blocks } = req.body;
    updatePage(full_path, { title, status: status || 'draft', blocks });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/admin/build', (req, res) => {
  try {
    const results = exportAll();
    res.json({ ok: true, count: results.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Tapuz Visual Builder: http://localhost:${PORT}/admin`);
});
