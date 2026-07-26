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
  ackItem,
  unackItem,
  isAcked,
  attachContactNames,
  collectForms,
  collectChat,
  collectWhatsApp,
  collectClaims
};
