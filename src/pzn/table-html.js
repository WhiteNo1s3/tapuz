'use strict';

/**
 * Shared table HTML (v0.83) — one renderer for both the compile path and
 * renderer.js (the card-html/form-html can't-diverge contract).
 *
 * TABLE graduates from RESERVED: opening hours, price lists, schedules —
 * the SMB staples that are impossible with text blocks. Zero JS.
 *
 * The row representation is ONE pipe-joined string everywhere — the BenTML
 * body (`TROW { יום | שעות }` — the markdown-table reflex every LLM already
 * has), the pzn text content, the builder's list editor, and storage
 * (data.rows = [{ cells: "יום | שעות" }]). One shape, no drift. A literal
 * pipe inside a cell is not representable in v1 — an honest, documented
 * limit rather than a new escape (the prose escape set is closed by spec).
 *
 * Responsive invariant I2: the <table> lives inside an overflow-x wrapper —
 * a wide schedule scrolls in its own container, never the page.
 */

const { escapeHtml } = require('./language/escape');

/** "א | ב | ג" → ['א','ב','ג'] (trimmed; empty cells preserved). */
function splitCells(cells) {
  return String(cells == null ? '' : cells).split('|').map((c) => c.trim());
}

/** Whole table from block.data. data: {header, rows:[{cells}|string]}.
 *  opts: {idAttr, cls, extra, dir}. */
function renderTable(data = {}, opts = {}) {
  const idAttr = opts.idAttr || '';
  const cls = opts.cls || '';
  const extra = opts.extra || '';
  const dir = opts.dir || '';
  const header = !(data.header === false || data.header === 'false');

  const rows = (data.rows || [])
    .map((r) => splitCells(typeof r === 'string' ? r : (r && r.cells)))
    .filter((cells) => cells.some((c) => c !== ''));

  // equalize width so a short row never collapses the grid
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const tr = (cells, tag) =>
    `<tr>${Array.from({ length: width }, (_, i) =>
      `<${tag}>${escapeHtml(cells[i] == null ? '' : cells[i])}</${tag}>`).join('')}</tr>`;

  let head = '';
  let body = rows;
  if (header && rows.length) {
    head = `<thead>${tr(rows[0], 'th')}</thead>`;
    body = rows.slice(1);
  }
  const tbody = `<tbody>${body.map((r) => tr(r, 'td')).join('')}</tbody>`;

  if (!rows.length) {
    return `<div${idAttr} class="bent-table-wrap bent-table-empty${cls}"${extra}${dir}>` +
      `<span>📋 טבלה — הוסיפו שורות</span></div>`;
  }
  return `<div${idAttr} class="bent-table-wrap${cls}"${extra}${dir}>` +
    `<table class="bent-table">${head}${tbody}</table></div>`;
}

module.exports = { renderTable, splitCells };
