'use strict';

/**
 * Task email reminders (v2.01 owner digest, v2.04 customer-facing).
 *
 * Owner digest: once a day, overdue + due-today tasks → notify.to
 * Customer reminders: email the *contact* about meetings / follow-ups due
 * today or overdue (transactional, not a marketing blast). Deduped per task
 * per calendar day via crm_tasks.customer_reminded_on.
 */

const path = require('path');
const fs = require('fs');
const { CONFIG_DIR } = require('../paths');
const { db } = require('../db');
const tasks = require('./tasks');
const contacts = require('./contacts');
const events = require('./events');

const STATE_PATH = path.join(CONFIG_DIR, 'task-reminders.json');

/** Kinds that make sense as a customer-facing appointment/touch reminder. */
const DEFAULT_CUSTOMER_KINDS = ['meeting', 'followup', 'call'];

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const d = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      if (d && typeof d === 'object') return d;
    }
  } catch (e) { /* */ }
  return { lastSentDay: '', lastResult: null, lastCustomerDay: '', lastCustomerResult: null };
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
    const c = t.customerReminders || {};
    const kinds = Array.isArray(c.kinds) && c.kinds.length
      ? c.kinds.map((k) => String(k).toLowerCase()).filter((k) => tasks.KINDS.includes(k))
      : DEFAULT_CUSTOMER_KINDS.slice();
    return {
      enabled: r.enabled === true,
      // empty = use notify.json `to`
      to: String(r.to || '').trim().slice(0, 300),
      customerEnabled: c.enabled === true,
      customerKinds: kinds.length ? kinds : DEFAULT_CUSTOMER_KINDS.slice()
    };
  } catch (e) {
    return {
      enabled: false,
      to: '',
      customerEnabled: false,
      customerKinds: DEFAULT_CUSTOMER_KINDS.slice()
    };
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
 * Pure builder for the customer-facing note.
 * @returns {{to:string, subject:string, text:string, html:string}|null}
 */
function buildCustomerReminderMail({ task, contact, siteTitle, baseUrl } = {}) {
  if (!task || !contact || !contact.email) return null;
  const name = String(contact.name || '').trim() || 'שלום';
  const title = String(task.title || 'תזכורת').trim();
  const due = task.due_at || '';
  const kind = tasks.kindLabel(task.kind);
  const site = String(siteTitle || 'העסק').trim() || 'העסק';
  const subject = 'תזכורת: ' + title + (due ? ' · ' + due : '');

  const lines = [];
  lines.push(name + ',');
  lines.push('');
  lines.push('תזכורת מ־' + site + ':');
  lines.push('');
  lines.push('  ' + title);
  if (kind) lines.push('  סוג: ' + kind);
  if (due) lines.push('  תאריך: ' + due);
  if (task.notes) {
    lines.push('');
    lines.push(String(task.notes).slice(0, 500));
  }
  lines.push('');
  lines.push('אם צריך לשנות מועד — פשוט השבו לנו.');
  lines.push('');
  lines.push('— ' + site);

  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  let html = '<div dir="rtl" style="font-family:system-ui,sans-serif;line-height:1.65;color:#0f172a">';
  html += '<p>' + esc(name) + ',</p>';
  html += '<p>תזכורת מ־<strong>' + esc(site) + '</strong>:</p>';
  html +=
    '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:14px 16px;margin:12px 0">';
  html += '<div style="font-size:1.05rem;font-weight:700">' + esc(title) + '</div>';
  if (kind) html += '<div style="color:#9a3412;font-size:.9rem;margin-top:4px">' + esc(kind) + '</div>';
  if (due) html += '<div style="margin-top:6px">📅 ' + esc(due) + '</div>';
  if (task.notes) {
    html +=
      '<p style="margin:10px 0 0;color:#57534e;font-size:.9rem">' +
      esc(String(task.notes).slice(0, 500)) +
      '</p>';
  }
  html += '</div>';
  html += '<p style="color:#64748b;font-size:.9rem">אם צריך לשנות מועד — השבו לנו.</p>';
  if (baseUrl) {
    html +=
      '<p style="color:#94a3b8;font-size:12px">' + esc(String(baseUrl).replace(/\/$/, '')) + '</p>';
  }
  html += '</div>';

  return {
    to: String(contact.email).trim(),
    subject: subject.slice(0, 200),
    text: lines.join('\n'),
    html
  };
}

/**
 * Open tasks due today/overdue that still need a customer-facing email.
 */
function listCustomerReminderCandidates({ kinds, today, limit = 40 } = {}) {
  const day = today || tasks.todayUTC();
  const kindList = (kinds && kinds.length ? kinds : DEFAULT_CUSTOMER_KINDS)
    .map((k) => String(k))
    .filter(Boolean);
  if (!kindList.length) return [];
  const placeholders = kindList.map(() => '?').join(',');
  const n = Math.min(Math.max(parseInt(limit, 10) || 40, 1), 100);
  return db
    .prepare(
      `SELECT t.*, c.email AS contact_email, c.name AS contact_name,
              c.phone AS contact_phone, c.status AS contact_status, c.consent AS contact_consent
       FROM crm_tasks t
       JOIN crm_contacts c ON c.id = t.contact_id
       WHERE t.status = 'open'
         AND t.due_at IS NOT NULL
         AND t.due_at <= ?
         AND t.kind IN (${placeholders})
         AND c.email IS NOT NULL AND c.email <> ''
         AND c.status NOT IN ('provisional', 'garbage')
         AND (t.customer_reminded_on IS NULL OR t.customer_reminded_on = '' OR t.customer_reminded_on < ?)
       ORDER BY t.due_at ASC, t.id ASC
       LIMIT ?`
    )
    .all(day, ...kindList, day, n);
}

/**
 * Email contacts about their due meetings/follow-ups.
 * @param {{force?:boolean, ignoreEnabled?:boolean, sender?:Function}} opts
 */
async function sendCustomerTaskReminders(opts = {}) {
  const conf = remindersConfig();
  if (!conf.customerEnabled && !opts.ignoreEnabled) {
    return { ok: false, error: 'customer reminders disabled', skipped: true };
  }

  const notify = require('../notify');
  if (!opts.sender && !notify.isSmtpReady()) {
    return { ok: false, error: 'smtp not ready' };
  }
  const sendFn = opts.sender || ((msg) => notify.sendMail(msg));

  let siteTitle = 'העסק';
  let baseUrl = '';
  try {
    const cfg = require('../config').loadConfig();
    siteTitle = cfg.title || siteTitle;
    baseUrl = String(cfg.baseUrl || '').trim();
  } catch (e) { /* */ }

  const today = tasks.todayUTC();
  const candidates = listCustomerReminderCandidates({
    kinds: conf.customerKinds,
    today,
    limit: 40
  });

  if (!candidates.length) {
    saveState({
      lastCustomerResult: { at: new Date().toISOString(), ok: true, count: 0, empty: true }
    });
    return { ok: true, empty: true, count: 0, sent: 0 };
  }

  let sent = 0;
  let failed = 0;
  for (const row of candidates) {
    try {
      if (!opts.sender && notify.remainingToday() < 1) break;
    } catch (e) { /* */ }

    const contact = contacts.getContact(row.contact_id) || {
      email: row.contact_email,
      name: row.contact_name,
      id: row.contact_id
    };
    const mail = buildCustomerReminderMail({
      task: row,
      contact,
      siteTitle,
      baseUrl
    });
    if (!mail) {
      failed++;
      continue;
    }

    let result;
    try {
      result = await sendFn({
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html
      });
    } catch (e) {
      result = { ok: false, error: e.message };
    }

    if (result && result.ok) {
      db.prepare(
        `UPDATE crm_tasks SET customer_reminded_on = ? WHERE id = ?`
      ).run(today, row.id);
      try {
        events.record({
          contactId: row.contact_id,
          type: 'email',
          title: 'תזכורת ללקוח: ' + row.title
        });
      } catch (e) { /* */ }
      sent++;
    } else {
      failed++;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  saveState({
    lastCustomerDay: today,
    lastCustomerResult: {
      at: new Date().toISOString(),
      ok: failed === 0,
      sent,
      failed
    }
  });

  return { ok: true, sent, failed, count: sent };
}

/**
 * Housekeeping hook — never throws.
 * @returns {object|null}
 */
function maybeSendDaily() {
  try {
    const conf = remindersConfig();
    if (conf.enabled) {
      sendTaskReminders({ force: false }).catch((e) => {
        console.error('[crm] task reminders failed:', e.message);
      });
    }
    if (conf.customerEnabled) {
      sendCustomerTaskReminders({ force: false }).catch((e) => {
        console.error('[crm] customer task reminders failed:', e.message);
      });
    }
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
  const customerPending = listCustomerReminderCandidates({
    kinds: conf.customerKinds,
    today: tasks.todayUTC()
  }).length;
  return {
    enabled: conf.enabled,
    to: conf.to,
    lastSentDay: state.lastSentDay || '',
    lastResult: state.lastResult || null,
    pendingOverdue: buckets.overdue.length,
    pendingToday: buckets.dueToday.length,
    customerEnabled: conf.customerEnabled,
    customerKinds: conf.customerKinds,
    customerPending,
    lastCustomerDay: state.lastCustomerDay || '',
    lastCustomerResult: state.lastCustomerResult || null
  };
}

module.exports = {
  remindersConfig,
  buildDigest,
  collectDueBuckets,
  sendTaskReminders,
  buildCustomerReminderMail,
  listCustomerReminderCandidates,
  sendCustomerTaskReminders,
  maybeSendDaily,
  getReminderStatus,
  loadState,
  saveState,
  STATE_PATH,
  DEFAULT_CUSTOMER_KINDS
};
