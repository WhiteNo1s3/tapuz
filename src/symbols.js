'use strict';

/**
 * Symbols (v0.91) — saved reusable blocks, the Builder.io "symbols" answer.
 *
 * A symbol = a named snapshot of one block (usually a container with its
 * children). Inserting one makes an UNSYNCED deep copy with fresh ids — the
 * page stays a plain .pzn, no rendering indirection, no linked-instance
 * machinery (a possible future tier).
 *
 * FILE storage like categories (Ben's call): content/symbols.json on disk,
 * visible in the אחסון/Storage section.
 */

const fs = require('fs');
const path = require('path');
const { SITE_ROOT } = require('./paths');

const SYMBOLS_PATH = path.join(SITE_ROOT, 'content', 'symbols.json');

// sanity caps — a personal library, not a dumping ground
const MAX_SYMBOLS = 100;
const MAX_NAME = 60;
const MAX_BLOCK_JSON = 100 * 1024;

function readAll() {
  try {
    const list = JSON.parse(fs.readFileSync(SYMBOLS_PATH, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function writeAll(list) {
  fs.mkdirSync(path.dirname(SYMBOLS_PATH), { recursive: true });
  fs.writeFileSync(SYMBOLS_PATH, JSON.stringify(list, null, 2), 'utf8');
}

/** Newest first. */
function listSymbols() {
  return readAll().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

/**
 * @param {{ name: string, block: object }} input
 * @returns {{ ok: true, symbol: object } | { ok: false, error: string }}
 */
function saveSymbol(input = {}) {
  const name = String(input.name || '').trim().slice(0, MAX_NAME);
  if (!name) return { ok: false, error: 'נדרש שם לבלוק השמור' };
  const block = input.block;
  if (!block || typeof block !== 'object' || Array.isArray(block) || !block.type) {
    return { ok: false, error: 'בלוק לא תקין' };
  }
  const json = JSON.stringify(block);
  if (json.length > MAX_BLOCK_JSON) return { ok: false, error: 'הבלוק גדול מדי לשמירה' };

  const list = readAll();
  if (list.length >= MAX_SYMBOLS) return { ok: false, error: `הספרייה מלאה (${MAX_SYMBOLS}) — מחקו בלוק שמור ישן` };

  const symbol = {
    id: 'sym_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    type: String(block.type),
    created_at: new Date().toISOString(),
    block: JSON.parse(json) // detached snapshot — caller mutations can't leak in
  };
  list.push(symbol);
  writeAll(list);
  return { ok: true, symbol };
}

function deleteSymbol(id) {
  const list = readAll();
  const next = list.filter((s) => s.id !== id);
  if (next.length === list.length) return false;
  writeAll(next);
  return true;
}

module.exports = { listSymbols, saveSymbol, deleteSymbol, SYMBOLS_PATH, MAX_SYMBOLS };
