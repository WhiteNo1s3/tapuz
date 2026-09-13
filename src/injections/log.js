'use strict';

/**
 * The injection ledger (v2.28) — one JSON line per action in
 * config/inject-log.jsonl under the site root (the same root as
 * config/menus.json, so a TAPUZ_ROOT site keeps its own ledger).
 *
 * WHY: the 99.9 % claim for the organizer needs numbers, not anecdotes —
 * how many runs, how many repairs, which warning codes keep coming back,
 * how many tokens a local model burns per pack. Every run / paste / apply /
 * undo lands here with its outcome, so `scripts/eval-injections.js` and the
 * repair-stats card have something real to count.
 *
 * NEVER the reply text and never the prompt: the ledger is telemetry, not a
 * transcript. Only the fields below are written; anything else on the entry
 * is dropped at the door. Logging never throws — a full disk must not turn a
 * successful apply into a 500.
 */

const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('../paths');

const LOG_PATH = path.join(CONFIG_DIR, 'inject-log.jsonl');

// the whitelist — the contract's fields, nothing model-written
const FIELDS = ['ts', 'id', 'action', 'provider', 'model', 'ms', 'promptChars', 'replyChars',
  'ok', 'code', 'warningCodes', 'rounds', 'repaired', 'usage'];

function pick(entry) {
  const src = entry && typeof entry === 'object' ? entry : {};
  const out = {};
  for (const k of FIELDS) if (src[k] !== undefined) out[k] = src[k];
  if (!out.ts) out.ts = new Date().toISOString();
  if (Array.isArray(out.warningCodes)) out.warningCodes = out.warningCodes.map((c) => String(c)).slice(0, 60);
  if (out.usage && typeof out.usage === 'object') {
    const u = out.usage;
    out.usage = { prompt_tokens: Number(u.prompt_tokens) || 0, completion_tokens: Number(u.completion_tokens) || 0 };
    if (u.reasoning_tokens != null) out.usage.reasoning_tokens = Number(u.reasoning_tokens) || 0;
  }
  return out;
}

/** Append one line. Returns the entry as written (or null when it could not be). */
function logRun(entry) {
  const line = pick(entry);
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify(line) + '\n', 'utf8');
    return line;
  } catch (e) {
    return null;
  }
}

/** The newest entries (for a stats card / the eval script). */
function readLog(limit) {
  try {
    const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean);
    const tail = limit > 0 ? lines.slice(-limit) : lines;
    return tail.map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) {
    return [];
  }
}

module.exports = { logRun, readLog, LOG_PATH, FIELDS };
