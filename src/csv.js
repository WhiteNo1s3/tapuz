'use strict';

/**
 * CSV assembly (v0.87) — ONE implementation of the escaping rules for every
 * export in the CMS (inbox, analytics, whatever comes next).
 *
 * Excel-proofed: UTF-8 BOM (Excel reads Hebrew), CRLF rows, every cell quoted
 * with quote-doubling, and cells starting with =/+/-/@ get a leading
 * apostrophe so hostile data can never execute as a formula on the site
 * owner's machine (CSV injection).
 */

const BOM = String.fromCharCode(0xfeff);

function cell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

/** @param {string[]} head @param {Array<Array<unknown>>} rows */
function csvTable(head, rows) {
  const lines = [head.map(cell).join(',')];
  for (const r of rows) lines.push(r.map(cell).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}

module.exports = { csvTable, cell, BOM };
