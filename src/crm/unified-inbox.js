'use strict';

/**
 * Unified inbox (v2.05) — the hard problem, solved by NOT merging stores.
 *
 * Each channel keeps its own tables (forms, CS chat, WhatsApp, identity
 * claims). This module is a **read projector**: it lists "things that need
 * the owner" as one stream of InboxItems. Writing always goes back through
 * the channel that owns the row.
 *
 * Why this stays clean as we grow:
 *   - Customer (OOP) is the entity; items only *link* to contact_id.
 *   - Adding a channel = one collector function + a deep link. No rewrite.
 *   - Optional ack table is ONLY for channels without a native "handled"
 *     flag (today: WhatsApp inbound). Forms/chat/claims already have state.
 *
 * InboxItem shape (stable wire format):
 *   { id, channel, refId, contactId, title, preview, at, state, href, meta }
 */

const { db } = require('../db');
const contacts = require('./contacts');

const CHANNELS = ['form', 'chat', 'whatsapp', 'claim'];
const CHANNEL_LABELS = {
  form: 'טופס',
  chat: 'צ׳אט',
  whatsapp: 'WhatsApp',
  claim: 'תביעת זהות'
};

function channelLabel(ch) {
  return CHANNEL_LABELS[ch] || String(ch || '');
}

function itemKey(channel, refId) {
  return String(channel) + ':' + String(refId);
}

function parseKey(key) {
  const s = String(key || '');
  const i = s.indexOf(':');
  if (i < 1) return null;
  return { channel: s.slice(0, i), refId: s.slice(i + 1) };
}

// ── optional acks (WA and future channels without native handled state) ──

function ensureAckTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_inbox_acks (
      item_key TEXT PRIMARY KEY,
      contact_id INTEGER,
      acked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function isAcked(key) {
  try {
    ensureAckTable();
    return !!db.prepare('SELECT 1 FROM crm_inbox_acks WHERE item_key = ?').get(String(key));
  } catch (e) {
    return false;
  }
}

function ackItem(key, contactId = null) {
  ensureAckTable();
  const k = String(key || '');
  if (!k) return false;
  db.prepare(
    `INSERT INTO crm_inbox_acks (item_key, contact_id) VALUES (?, ?)
     ON CONFLICT(item_key) DO UPDATE SET acked_at = CURRENT_TIMESTAMP,
       contact_id = COALESCE(excluded.contact_id, crm_inbox_acks.contact_id)`
  ).run(k, contactId != null ? Number(contactId) : null);
  return true;
}

function unackItem(key) {
  ensureAckTable();
  return db.prepare('DELETE FROM crm_inbox_acks WHERE item_key = ?').run(String(key)).changes > 0;
}

// ── channel collectors (each isolated; failure of one never empties others) ──

function collectForms({ limit = 80 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 80, 1), 200);
  let rows = [];
  try {
    rows = db
      .prepare(
        `SELECT s.*, e.contact_id AS linked_contact_id
         FROM form_submissions s
         LEFT JOIN crm_events e ON e.ref_id = s.id AND e.type = 'form'
         WHERE COALESCE(s.status, 'new') NOT IN ('won', 'lost')
         ORDER BY s.id DESC LIMIT ?`
      )
      .all(n);
  } catch (e) {
    return [];
  }

  return rows.map((s) => {
    let fields = {};
    try {
      fields = typeof s.fields === 'string' ? JSON.parse(s.fields) : s.fields || {};
    } catch (e) {
      fields = {};
    }
    const values = Object.values(fields).map((v) => String(v == null ? '' : v));
    const first = values[0] || 'פנייה מטופס';
    const preview = values.slice(0, 3).join(' · ').slice(0, 200);
    const open = !s.is_read || !['won', 'lost', 'qualified'].includes(s.status);
    return {
      id: itemKey('form', s.id),
      channel: 'form',
      refId: s.id,
      contactId: s.linked_contact_id || null,
      title: first,
      preview: preview || (s.page ? 'מ־/' + s.page : 'טופס'),
      at: s.created_at,
      state: open ? 'open' : 'done',
      href: '/admin/inbox',
      meta: {
        page: s.page || '',
        status: s.status || 'new',
        is_read: !!s.is_read,
        value: s.value,
        follow_up_at: s.follow_up_at || null
      }
    };
  });
}

function collectChat({ limit = 80 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 80, 1), 200);
  let rows = [];
  try {
    rows = db
      .prepare(
        `SELECT c.*,
                (SELECT text FROM crm_cs_messages m
                 WHERE m.conversation_id = c.id AND m.role = 'user'
                 ORDER BY m.id DESC LIMIT 1) AS last_user_text,
                (SELECT text FROM crm_cs_messages m
                 WHERE m.conversation_id = c.id AND m.role = 'user'
                 ORDER BY m.id ASC LIMIT 1) AS first_question
         FROM crm_cs_conversations c
         WHERE c.status = 'open'
         ORDER BY c.last_message_at DESC LIMIT ?`
      )
      .all(n);
  } catch (e) {
    return [];
  }

  return rows.map((c) => ({
    id: itemKey('chat', c.id),
    channel: 'chat',
    refId: c.id,
    contactId: c.contact_id || null,
    title: c.first_question
      ? String(c.first_question).slice(0, 80)
      : 'שיחת צ׳אט #' + c.id,
    preview: String(c.last_user_text || c.first_question || '').slice(0, 200),
    at: c.last_message_at || c.created_at,
    state: c.status === 'open' ? 'open' : 'done',
    href: '/admin/crm/chat/' + c.id,
    meta: { token: c.token, status: c.status }
  }));
}

function collectWhatsApp({ limit = 80 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 80, 1), 200);
  let rows = [];
  try {
    // Latest inbound per phone in the last 30 days — one card per thread.
    rows = db
      .prepare(
        `SELECT m.* FROM crm_wa_messages m
         INNER JOIN (
           SELECT phone, MAX(id) AS mid FROM crm_wa_messages
           WHERE direction = 'in'
             AND created_at >= datetime('now', '-30 days')
           GROUP BY phone
         ) t ON m.id = t.mid
         ORDER BY m.id DESC LIMIT ?`
      )
      .all(n);
  } catch (e) {
    return [];
  }

  return rows
    .map((m) => {
      const key = itemKey('whatsapp', m.id);
      const acked = isAcked(key);
      return {
        id: key,
        channel: 'whatsapp',
        refId: m.id,
        contactId: m.contact_id || null,
        title: m.phone || 'WhatsApp',
        preview: String(m.body || m.msg_type || '').slice(0, 200),
        at: m.created_at,
        state: acked ? 'done' : 'open',
        href: '/admin/crm/whatsapp',
        meta: {
          phone: m.phone,
          direction: m.direction,
          wa_message_id: m.wa_message_id || ''
        }
      };
    })
    .filter((it) => it.state === 'open');
}

function collectClaims({ limit = 40 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 40, 1), 100);
  let rows = [];
  try {
    rows = db
      .prepare(
        `SELECT * FROM crm_identity_claims
         WHERE status = 'pending'
         ORDER BY last_seen_at DESC LIMIT ?`
      )
      .all(n);
  } catch (e) {
    return [];
  }

  return rows.map((c) => ({
    id: itemKey('claim', c.id),
    channel: 'claim',
    refId: c.id,
    contactId: c.contact_id || null,
    title: c.email || c.phone || 'תביעת זהות',
    preview:
      (c.name ? c.name + ' · ' : '') +
      'site ' +
      (c.site_id || '—') +
      (c.claim_count > 1 ? ' · ×' + c.claim_count : ''),
    at: c.last_seen_at || c.first_seen_at,
    state: 'open',
    href: '/admin/crm/claims',
    meta: { site_id: c.site_id, claim_count: c.claim_count }
  }));
}

/**
 * Merge collectors, sort by time, optional filters.
 * @param {{channel?:string, state?:'open'|'done'|'all', contactId?:number, limit?:number, q?:string}} opts
 */
function listItems(opts = {}) {
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 100, 1), 300);
  const want = opts.channel && CHANNELS.includes(opts.channel) ? opts.channel : '';
  const state = opts.state || 'open';
  const contactId = opts.contactId != null ? Number(opts.contactId) : null;
  const q = String(opts.q || '')
    .trim()
    .toLowerCase();

  let items = [];
  const safe = (fn) => {
    try {
      return fn() || [];
    } catch (e) {
      console.error('[crm] unified-inbox collector failed:', e.message);
      return [];
    }
  };

  if (!want || want === 'form') items = items.concat(safe(() => collectForms({ limit })));
  if (!want || want === 'chat') items = items.concat(safe(() => collectChat({ limit })));
  if (!want || want === 'whatsapp') items = items.concat(safe(() => collectWhatsApp({ limit })));
  if (!want || want === 'claim') items = items.concat(safe(() => collectClaims({ limit })));

  if (contactId) {
    items = items.filter((it) => Number(it.contactId) === contactId);
  }
  if (state !== 'all') {
    items = items.filter((it) => it.state === state);
  }
  if (q) {
    items = items.filter(
      (it) =>
        String(it.title || '')
          .toLowerCase()
          .includes(q) ||
        String(it.preview || '')
          .toLowerCase()
          .includes(q) ||
        String((it.meta && it.meta.phone) || '').includes(q)
    );
  }

  items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return items.slice(0, limit);
}

function counts() {
  const open = listItems({ state: 'open', limit: 300 });
  const by = { form: 0, chat: 0, whatsapp: 0, claim: 0, total: open.length };
  for (const it of open) {
    if (by[it.channel] != null) by[it.channel]++;
  }
  return by;
}

/**
 * Mark handled — channel-native when possible, ack table otherwise.
 * Never deletes the underlying message.
 */
function markHandled(key) {
  const p = parseKey(key);
  if (!p) return { ok: false, error: 'key' };

  if (p.channel === 'form') {
    try {
      const forms = require('../forms');
      forms.markRead(Number(p.refId));
      // Pipeline: first touch from the unified desk moves new → contacted
      const row = forms.getSubmission(Number(p.refId));
      if (row && (row.status === 'new' || !row.status)) {
        forms.setStatus(Number(p.refId), 'contacted');
      }
      return { ok: true, channel: 'form' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  if (p.channel === 'chat') {
    try {
      require('./cs').closeConversation(Number(p.refId));
      return { ok: true, channel: 'chat' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  if (p.channel === 'whatsapp') {
    let contactId = null;
    try {
      const row = db.prepare('SELECT contact_id FROM crm_wa_messages WHERE id = ?').get(Number(p.refId));
      contactId = row && row.contact_id;
    } catch (e) { /* */ }
    ackItem(key, contactId);
    return { ok: true, channel: 'whatsapp' };
  }
  if (p.channel === 'claim') {
    // Claims are handled by approve/reject — marking handled is not enough.
    return { ok: false, error: 'use-approve-or-reject' };
  }
  return { ok: false, error: 'channel' };
}

/**
 * Re-load one item by key from collectors (fresh, not stale list).
 */
function getItem(key) {
  const p = parseKey(key);
  if (!p) return null;
  const items = listItems({ channel: p.channel, state: 'all', limit: 200 });
  return items.find((it) => it.id === key) || null;
}

/**
 * Ensure a Customer exists for this inbox item and link channel rows to it.
 * Adds to the entity — never invents a parallel person store.
 *
 * @returns {{ok:boolean, contactId?:number, created?:boolean, error?:string}}
 */
function ensureContactForItem(key) {
  const p = parseKey(key);
  if (!p) return { ok: false, error: 'key' };
  const item = getItem(key);
  if (item && item.contactId) {
    return { ok: true, contactId: Number(item.contactId), created: false };
  }

  if (p.channel === 'form') {
    try {
      const forms = require('../forms');
      const crm = require('./index');
      const sub = forms.getSubmission(Number(p.refId));
      if (!sub) return { ok: false, error: 'missing' };
      const fields = sub.fields || {};
      const identity = crm.identityFromFields(fields);
      if (!identity.email && !identity.phone && !identity.name) {
        return { ok: false, error: 'no-identity' };
      }
      const up = contacts.upsertContact(
        Object.assign({}, identity, {
          source: sub.page || 'form',
          status: identity.email || identity.phone ? 'lead' : 'provisional'
        })
      );
      if (!up.contact) return { ok: false, error: 'upsert' };
      // Link timeline if missing
      const linked = db
        .prepare(
          `SELECT id FROM crm_events WHERE type = 'form' AND ref_id = ? AND contact_id = ?`
        )
        .get(Number(p.refId), up.contact.id);
      if (!linked) {
        require('./events').record({
          contactId: up.contact.id,
          type: 'form',
          path: sub.page || '',
          title: identity.name || identity.email || identity.phone || '',
          refId: Number(p.refId)
        });
      }
      return { ok: true, contactId: up.contact.id, created: !!up.created };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  if (p.channel === 'chat') {
    try {
      const cs = require('./cs');
      const conv = cs.getConversation(Number(p.refId));
      if (!conv) return { ok: false, error: 'missing' };
      if (conv.contact_id) return { ok: true, contactId: conv.contact_id, created: false };
      // Pull identity from user messages (email/phone typed in chat)
      const msgs = cs.messagesFor(Number(p.refId), { limit: 50 });
      const blob = msgs
        .filter((m) => m.role === 'user')
        .map((m) => m.text)
        .join('\n');
      const crm = require('./index');
      const identity = crm.identityFromFields({ text: blob, message: blob });
      // also scan for email/phone regex if identityFromFields only looks at keys
      const emailMatch = blob.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      const phoneMatch = blob.match(/(?:\+?972|0)[\d\- ]{8,12}/);
      if (emailMatch) identity.email = identity.email || emailMatch[0];
      if (phoneMatch) identity.phone = identity.phone || phoneMatch[0];
      if (!identity.email && !identity.phone) {
        return { ok: false, error: 'no-identity' };
      }
      const up = contacts.upsertContact(
        Object.assign({}, identity, { source: 'chat', status: 'lead' })
      );
      if (!up.contact) return { ok: false, error: 'upsert' };
      db.prepare(
        'UPDATE crm_cs_conversations SET contact_id = ? WHERE id = ? AND contact_id IS NULL'
      ).run(up.contact.id, Number(p.refId));
      return { ok: true, contactId: up.contact.id, created: !!up.created };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  if (p.channel === 'whatsapp') {
    try {
      const row = db
        .prepare('SELECT * FROM crm_wa_messages WHERE id = ?')
        .get(Number(p.refId));
      if (!row) return { ok: false, error: 'missing' };
      if (row.contact_id) return { ok: true, contactId: row.contact_id, created: false };
      const ledger = require('./wa-ledger');
      const cid = ledger.ensureContact(row.phone, '');
      if (!cid) return { ok: false, error: 'upsert' };
      return { ok: true, contactId: cid, created: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  if (p.channel === 'claim') {
    return { ok: false, error: 'use-approve' };
  }
  return { ok: false, error: 'channel' };
}

/**
 * Open a sales task on the person behind this item (ensures contact first).
 */
function createTaskFromItem(key, { title, kind, dueAt, notes } = {}) {
  const ensured = ensureContactForItem(key);
  if (!ensured.ok) return ensured;
  const tasks = require('./tasks');
  const item = getItem(key);
  const defaultTitle =
    title ||
    (item
      ? 'מעקב: ' + String(item.title || item.channel).slice(0, 80)
      : 'מעקב מתיבה');
  return tasks.createTask({
    contactId: ensured.contactId,
    title: defaultTitle,
    kind: kind || 'followup',
    dueAt: dueAt || tasks.todayUTC(),
    notes: notes || ''
  });
}

/**
 * Owner note on the Customer timeline for this item.
 */
function addNoteFromItem(key, text) {
  const body = String(text || '').trim().slice(0, 500);
  if (!body) return { ok: false, error: 'empty' };
  const ensured = ensureContactForItem(key);
  if (!ensured.ok) return ensured;
  try {
    require('./events').record({
      contactId: ensured.contactId,
      type: 'note',
      title: body
    });
    contacts.touchActivity(ensured.contactId);
    return { ok: true, contactId: ensured.contactId };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Resolve display names for contact ids in a list (one query). */
function attachContactNames(items) {
  const ids = [
    ...new Set(
      (items || [])
        .map((it) => it.contactId)
        .filter(Boolean)
        .map(Number)
    )
  ];
  if (!ids.length) return items || [];
  const map = {};
  for (const id of ids) {
    const c = contacts.getContact(id);
    if (c) {
      map[id] =
        c.name || c.email || c.phone || '#' + id;
    }
  }
  return (items || []).map((it) =>
    Object.assign({}, it, {
      contactName: it.contactId ? map[it.contactId] || null : null
    })
  );
}

module.exports = {
  CHANNELS,
  CHANNEL_LABELS,
  channelLabel,
  itemKey,
  parseKey,
  listItems,
  counts,
  markHandled,
  getItem,
  ensureContactForItem,
  createTaskFromItem,
  addNoteFromItem,
  ackItem,
  unackItem,
  isAcked,
  attachContactNames,
  collectForms,
  collectChat,
  collectWhatsApp,
  collectClaims
};
