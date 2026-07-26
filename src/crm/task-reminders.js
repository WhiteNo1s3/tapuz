'use strict';

/**
 * Task email reminders (v2.01) — reuse SMTP, never invent a second mail path.
 *
 * Once a day (or on admin "שלח עכשיו"), if there are open tasks that are overdue
 * or due today, mail the owner a short Hebrew digest. Failures never throw into
 * the hot path. Deduped by UTC day so a restart does not spam.
 */

const path = require('path');
const fs = require('fs');
const { CONFIG_DIR } = require('../paths');
const tasks = require('./tasks');

const STATE_PATH = path.join(CONFIG_DIR, 'task-reminders.json');

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const d = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      if (d && typeof d === 'object') return d;
    }
  } catch (e) { /* */ }
  return { lastSentDay: '', lastResult: null };
}

function saveState(patch) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const next = Object.assign(loadState(), patch || {});
  fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2));
  return next;
}

function remindersConfig() {
  try {
    const cfg = require('../config').loadConfig();
    const t = (cfg.crm && cfg.crm.tasks) || {};
    const r = t.reminders || {};
    return {
      enabled: r.enabled === true,
      // empty = use notify.json `to`
      to: String(r.to || '').trim().slice(0, 300)
    };
  } catch (e) {
    return { enabled: false, to: '' };
  }
}

function contactLabel(t) {
  return t.contact_name || t.contact_email || t.contact_phone || ('#' + t.contact_id);
}

/**
 * Build plain-text + simple HTML digest. Pure — no I/O.
 * @returns {{subject:string, text:string, html:string, count:number}|null}
 */
function buildDigest({ overdue = [], dueToday = [], baseUrl = '' } = {}) {
  const all = []
    .concat(overdue.map((t) => Object.assign({}, t, { _bucket: 'overdue' })))
    .concat(dueToday.map((t) => Object.assign({}, t, { _bucket: 'today' })));
  if (!all.length) return null;

  const subject =
    all.length === 1
      ? 'משימה אחת ממתינה — תפוזיאל CRM'
      : all.length + ' משימות ממתינות — תפוזיאל CRM';

  const lines = [];
  lines.push('שלום,');
  lines.push('');
  lines.push('סיכום משימות CRM לביצוע:');
  lines.push('');
  if (overdue.length) {
    lines.push('⚠ באיחור (' + overdue.length + '):');
    for (const t of overdue) {
      lines.push(
        '  • [' + (t.due_at || '?') + '] ' + t.title + ' — ' + contactLabel(t)
      );
    }
    lines.push('');
  }
  if (dueToday.length) {
    lines.push('📅 להיום (' + dueToday.length + '):');
    for (const t of dueToday) {
      lines.push('  • ' + t.title + ' — ' + contactLabel(t));
    }
    lines.push('');
  }
  const board = (baseUrl || '').replace(/\/$/, '') + '/admin/crm/tasks';
  lines.push('לוח משימות: ' + board);
  lines.push('');
  lines.push('— תפוזיאל');

  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  let html = '<div dir="rtl" style="font-family:system-ui,sans-serif;line-height:1.6">';
  html += '<p>שלום,</p><p><strong>סיכום משימות CRM לביצוע</strong></p>';
  if (overdue.length) {
    html += '<p style="color:#b91c1c">⚠ באיחור (' + overdue.length + ')</p><ul>';
    for (const t of overdue) {
      html +=
        '<li><strong>' +
        esc(t.title) +
        '</strong> — ' +
        esc(contactLabel(t)) +
        ' <span style="color:#64748b">(' +
        esc(t.due_at) +
        ')</span></li>';
    }
    html += '</ul>';
  }
  if (dueToday.length) {
    html += '<p>📅 להיום (' + dueToday.length + ')</p><ul>';
    for (const t of dueToday) {
      html +=
        '<li><strong>' +
        esc(t.title) +
        '</strong> — ' +
        esc(contactLabel(t)) +
        '</li>';
    }
    html += '</ul>';
  }
  html +=
    '<p><a href="' +
    esc(board) +
    '">פתחו את לוח המשימות</a></p>';
  html += '<p style="color:#94a3b8;font-size:12px">תפוזיאל CRM</p></div>';

  return { subject, text: lines.join('\n'), html, count: all.length };
}

/**
 * Collect open tasks due today or earlier, split buckets.
 */
function collectDueBuckets() {
  const today = tasks.todayUTC();
  const due = tasks.listDue({ asOf: today, limit: 200 });
  const overdue = due.filter((t) => t.due_at && t.due_at < today);
  const dueToday = due.filter((t) => t.due_at === today);
  return { overdue, dueToday, today };
}

/**
 * Send the digest if there is something to say.
 * @param {{force?:boolean, ignoreEnabled?:boolean}} opts
 *   force — ignore same-day dedupe (admin "send now")
 *   ignoreEnabled — admin force even if flag off
 */
async function sendTaskReminders(opts = {}) {
  const conf = remindersConfig();
  if (!conf.enabled && !opts.ignoreEnabled) {
    return { ok: false, error: 'reminders disabled', skipped: true };
  }

  const notify = require('../notify');
  if (!notify.isSmtpReady()) {
    return { ok: false, error: 'smtp not ready' };
  }

  const settings = notify.getSettings();
  const to = conf.to || settings.to;
  if (!to) return { ok: false, error: 'no recipient (set notify.to or crm.tasks.reminders.to)' };

  const today = tasks.todayUTC();
  const state = loadState();
  if (!opts.force && state.lastSentDay === today) {
    return { ok: true, skipped: true, reason: 'already-sent-today', lastSentDay: today };
  }

  const { overdue, dueToday } = collectDueBuckets();
  let baseUrl = '';
  try {
    baseUrl = String(require('../config').loadConfig().baseUrl || '').trim();
  } catch (e) { /* */ }

  const digest = buildDigest({ overdue, dueToday, baseUrl });
  if (!digest) {
    saveState({ lastResult: { at: new Date().toISOString(), ok: true, count: 0, empty: true } });
    if (opts.force) {
      // Admin asked — still mark day so auto doesn't double later only if we sent?
      // Don't mark lastSentDay on empty force — they may add tasks and want a real send.
      return { ok: true, empty: true, count: 0 };
    }
    // No work: still mark day so we don't re-check spam logs; empty is fine.
    saveState({ lastSentDay: today, lastResult: { at: new Date().toISOString(), ok: true, count: 0, empty: true } });
    return { ok: true, empty: true, count: 0, lastSentDay: today };
  }

  const result = await notify.sendMail({
    to,
    subject: digest.subject,
    text: digest.text,
    html: digest.html
  });

  if (result.ok) {
    saveState({
      lastSentDay: today,
      lastResult: {
        at: new Date().toISOString(),
        ok: true,
        count: digest.count,
        to: to.replace(/(^.).*(@.*$)/, '$1***$2')
      }
    });
    return { ok: true, count: digest.count, to };
  }

  saveState({
    lastResult: {
      at: new Date().toISOString(),
      ok: false,
      error: result.error || 'send failed'
    }
  });
  return { ok: false, error: result.error || 'send failed' };
}

/**
 * Housekeeping hook — never throws.
 * @returns {object|null}
 */
function maybeSendDaily() {
  try {
    const conf = remindersConfig();
    if (!conf.enabled) return null;
    // fire-and-forget
    sendTaskReminders({ force: false }).catch((e) => {
      console.error('[crm] task reminders failed:', e.message);
    });
    return { scheduled: true };
  } catch (e) {
    console.error('[crm] task reminders:', e.message);
    return null;
  }
}

function getReminderStatus() {
  const conf = remindersConfig();
  const state = loadState();
  const buckets = collectDueBuckets();
  return {
    enabled: conf.enabled,
    to: conf.to,
    lastSentDay: state.lastSentDay || '',
    lastResult: state.lastResult || null,
    pendingOverdue: buckets.overdue.length,
    pendingToday: buckets.dueToday.length
  };
}

module.exports = {
  remindersConfig,
  buildDigest,
  collectDueBuckets,
  sendTaskReminders,
  maybeSendDaily,
  getReminderStatus,
  loadState,
  saveState,
  STATE_PATH
};
