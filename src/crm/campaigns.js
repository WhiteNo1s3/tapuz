'use strict';

/**
 * CRM — campaigns (v1.81, phase 3c).
 *
 * Send a message to a mailing list, then learn who opened and who clicked.
 * Three things here are not features but obligations:
 *
 *   1. CONSENT IS THE RECIPIENT LIST. Only contacts with `consent = 1` and a
 *      real address are ever sent to. Someone who is on a list but never agreed
 *      to be emailed is skipped, and the skip is recorded so the owner can see
 *      why their audience is smaller than the list.
 *
 *   2. EVERY MESSAGE CARRIES AN UNSUBSCRIBE. A one-click link plus the
 *      `List-Unsubscribe` headers mail clients actually honour. Unsubscribing
 *      clears consent, so it also stops phase-3b conversion reporting for that
 *      person — one refusal, respected everywhere.
 *
 *   3. CLICK TRACKING CANNOT BECOME AN OPEN REDIRECT. Links are extracted from
 *      the body at send time and frozen onto the campaign; the tracked URL
 *      carries an INDEX into that list, never a destination. A request cannot
 *      name where it wants to go, so this endpoint can never be borrowed to
 *      launder a phishing link.
 *
 * Sending runs in the background with a small gap between messages: the admin
 * gets an immediate answer, and a slow SMTP server cannot hold a request open.
 */

const crypto = require('crypto');
const { db } = require('../db');

const STATUSES = ['draft', 'sending', 'sent'];
const GAP_MS = 120; // breathing room between messages, so we are a polite sender

function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

// ─── campaign CRUD ───────────────────────────────────────────────────

function createCampaign({ name, subject, body, listId } = {}) {
  const n = String(name || '').trim().slice(0, 200);
  if (!n) throw new Error('שם קמפיין נדרש');
  const info = db
    .prepare('INSERT INTO crm_campaigns (name, subject, body, list_id) VALUES (?, ?, ?, ?)')
    .run(n, String(subject || '').slice(0, 300), String(body || ''), listId ? Number(listId) : null);
  return getCampaign(info.lastInsertRowid);
}

function getCampaign(id) {
  const row = db.prepare('SELECT * FROM crm_campaigns WHERE id = ?').get(Number(id));
  if (!row) return null;
  let links = [];
  try { links = JSON.parse(row.links || '[]'); } catch (e) { links = []; }
  return Object.assign({}, row, { links });
}

function updateCampaign(id, patch = {}) {
  const existing = getCampaign(id);
  if (!existing) return null;
  // A campaign that has gone out is a record of what was sent — freeze it.
  if (existing.status !== 'draft') return existing;
  const set = {};
  if (patch.name !== undefined) set.name = String(patch.name).trim().slice(0, 200);
  if (patch.subject !== undefined) set.subject = String(patch.subject).slice(0, 300);
  if (patch.body !== undefined) set.body = String(patch.body);
  if (patch.listId !== undefined) set.list_id = patch.listId ? Number(patch.listId) : null;
  if (!Object.keys(set).length) return existing;
  const sets = Object.keys(set).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE crm_campaigns SET ${sets} WHERE id = @id`).run(Object.assign({ id: Number(id) }, set));
  return getCampaign(id);
}

function deleteCampaign(id) {
  return db.prepare('DELETE FROM crm_campaigns WHERE id = ?').run(Number(id)).changes > 0;
}

function listCampaigns() {
  return db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM crm_campaign_sends s WHERE s.campaign_id = c.id AND s.status = 'sent') AS sent_count,
              (SELECT COUNT(*) FROM crm_campaign_sends s WHERE s.campaign_id = c.id AND s.opened_at IS NOT NULL) AS opened_count,
              (SELECT COUNT(*) FROM crm_campaign_sends s WHERE s.campaign_id = c.id AND s.clicked_at IS NOT NULL) AS clicked_count,
              (SELECT COUNT(*) FROM crm_campaign_sends s WHERE s.campaign_id = c.id AND s.status = 'failed') AS failed_count
       FROM crm_campaigns c ORDER BY c.id DESC`
    )
    .all();
}

// ─── audience ────────────────────────────────────────────────────────

/**
 * Who will actually receive this — consent is the filter, not the list.
 * @returns {{recipients:object[], skippedNoConsent:number, skippedNoEmail:number}}
 */
function audienceFor(campaign) {
  if (!campaign || !campaign.list_id) {
    return { recipients: [], skippedNoConsent: 0, skippedNoEmail: 0 };
  }
  const members = db
    .prepare(
      `SELECT c.* FROM crm_contacts c
       JOIN crm_list_members m ON m.contact_id = c.id
       WHERE m.list_id = ? ORDER BY c.id`
    )
    .all(campaign.list_id);

  const recipients = [];
  let skippedNoConsent = 0;
  let skippedNoEmail = 0;
  for (const c of members) {
    if (!c.email) { skippedNoEmail++; continue; }
    if (!c.consent) { skippedNoConsent++; continue; }
    recipients.push(c);
  }
  return { recipients, skippedNoConsent, skippedNoEmail };
}

// ─── link extraction + rewriting ─────────────────────────────────────

/** Absolute http(s) hrefs in the body, deduped, in document order. */
function extractLinks(body) {
  const out = [];
  const re = /href\s*=\s*["'](https?:\/\/[^"'\s>]+)["']/gi;
  let m;
  while ((m = re.exec(String(body || '')))) {
    const url = m[1];
    if (out.indexOf(url) === -1) out.push(url);
    if (out.length >= 200) break; // a body with 200 distinct links is a mistake
  }
  return out;
}

function escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Personalize + instrument one recipient's copy of the body.
 * Tracked links carry the send token and the link's INDEX — never a URL.
 */
function renderBody({ body, links, token, baseUrl, contact }) {
  let html = String(body || '');

  // {{name}} / {{email}} are the only substitutions, escaped as attribute-safe
  // text so a contact's own data can never inject markup into the message.
  html = html
    .replace(/\{\{\s*name\s*\}\}/gi, escapeAttr((contact && (contact.name || '')) || ''))
    .replace(/\{\{\s*email\s*\}\}/gi, escapeAttr((contact && contact.email) || ''));

  // rewrite each known link to its tracked form
  (links || []).forEach((url, i) => {
    const tracked = `${baseUrl}/crm/c/${token}/${i}`;
    // replace only the href value, and only for this exact url
    const re = new RegExp('href\\s*=\\s*(["\'])' + url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\1', 'gi');
    html = html.replace(re, 'href="' + tracked + '"');
  });

  const unsub = `${baseUrl}/crm/u/${token}`;
  html +=
    `<hr style="margin-top:32px;border:none;border-top:1px solid #e2e8f0">` +
    `<p style="font:12px system-ui,sans-serif;color:#64748b;text-align:center">` +
    `לא רוצים לקבל עוד מיילים? <a href="${escapeAttr(unsub)}">להסרה בלחיצה אחת</a></p>`;

  // open pixel last, so a client that stops rendering early still counted the body
  html += `<img src="${escapeAttr(baseUrl)}/crm/o/${token}.gif" width="1" height="1" alt="" style="display:none">`;

  return { html, unsubscribeUrl: unsub };
}

// ─── sending ─────────────────────────────────────────────────────────

/**
 * Queue every recipient, then send in the background.
 *
 * Returns as soon as the rows exist — the admin sees "sending" immediately and
 * a slow SMTP server never holds the request. Resolution of the returned
 * promise means QUEUED, not delivered.
 *
 * @returns {{ok:boolean, queued:number, skippedNoConsent:number, skippedNoEmail:number, error?:string}}
 */
function startSend(campaignId, { baseUrl = '', sender } = {}) {
  const campaign = getCampaign(campaignId);
  if (!campaign) return { ok: false, error: 'קמפיין לא נמצא', queued: 0 };
  if (campaign.status !== 'draft') {
    return { ok: false, error: 'הקמפיין כבר נשלח', queued: 0 };
  }
  if (!campaign.subject.trim()) return { ok: false, error: 'נושא נדרש', queued: 0 };

  const { recipients, skippedNoConsent, skippedNoEmail } = audienceFor(campaign);
  if (!recipients.length) {
    return {
      ok: false, queued: 0, skippedNoConsent, skippedNoEmail,
      error: 'אין נמענים עם הסכמה לדיוור'
    };
  }

  // Freeze the link list now: the tracked indexes must keep meaning the same
  // destination for as long as the message exists in someone's inbox.
  const links = extractLinks(campaign.body);
  db.prepare("UPDATE crm_campaigns SET status = 'sending', links = ? WHERE id = ?")
    .run(JSON.stringify(links), campaign.id);

  const insert = db.prepare(
    'INSERT INTO crm_campaign_sends (campaign_id, contact_id, token) VALUES (?, ?, ?)'
  );
  const queue = db.transaction((list) => {
    const rows = [];
    for (const c of list) {
      const token = newToken();
      const info = insert.run(campaign.id, c.id, token);
      rows.push({ sendId: info.lastInsertRowid, token, contact: c });
    }
    return rows;
  });
  const rows = queue(recipients);

  // fire the actual delivery in the background
  deliverQueued(campaign.id, rows, { baseUrl, sender, links }).catch((e) => {
    console.error('[crm] campaign delivery failed:', e.message);
  });

  return { ok: true, queued: rows.length, skippedNoConsent, skippedNoEmail };
}

/** Walk the queue, one polite message at a time. Never throws. */
async function deliverQueued(campaignId, rows, { baseUrl, sender, links }) {
  const campaign = getCampaign(campaignId);
  if (!campaign) return;
  const send = sender || ((msg) => require('../notify').sendMail(msg));
  const markSent = db.prepare(
    "UPDATE crm_campaign_sends SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?"
  );
  const markFailed = db.prepare(
    "UPDATE crm_campaign_sends SET status = 'failed', error = ? WHERE id = ?"
  );

  for (const row of rows) {
    const { html, unsubscribeUrl } = renderBody({
      body: campaign.body, links, token: row.token, baseUrl, contact: row.contact
    });
    let result;
    try {
      result = await send({
        to: row.contact.email,
        subject: campaign.subject,
        html,
        headers: {
          // the headers real mail clients turn into a one-click button
          'List-Unsubscribe': '<' + unsubscribeUrl + '>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        }
      });
    } catch (e) {
      result = { ok: false, error: e.message };
    }
    if (result && result.ok) {
      markSent.run(row.sendId);
      try {
        require('./events').record({
          contactId: row.contact.id, type: 'email',
          title: campaign.subject, refId: campaign.id
        });
      } catch (e) { /* the timeline is a nicety; delivery already succeeded */ }
    } else {
      markFailed.run(String((result && result.error) || 'unknown').slice(0, 300), row.sendId);
    }
    if (GAP_MS) await new Promise((r) => setTimeout(r, GAP_MS));
  }

  db.prepare("UPDATE crm_campaigns SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(campaignId);
}

// ─── tracking ────────────────────────────────────────────────────────

function findSendByToken(token) {
  const t = String(token || '');
  if (!/^[a-f0-9]{32}$/.test(t)) return null;
  return db.prepare('SELECT * FROM crm_campaign_sends WHERE token = ?').get(t) || null;
}

/** Record an open. Idempotent — the FIRST open is the one worth knowing. */
function recordOpen(token) {
  const send = findSendByToken(token);
  if (!send) return false;
  if (!send.opened_at) {
    db.prepare('UPDATE crm_campaign_sends SET opened_at = CURRENT_TIMESTAMP WHERE id = ?').run(send.id);
  }
  return true;
}

/**
 * Resolve a tracked click to its destination.
 *
 * The URL comes from the campaign's frozen link list by index — the request
 * never supplies one — so this cannot be used as an open redirect.
 *
 * @returns {string|null} the destination, or null when the token/index is unknown
 */
function resolveClick(token, index) {
  const send = findSendByToken(token);
  if (!send) return null;
  const campaign = getCampaign(send.campaign_id);
  if (!campaign) return null;
  // Strict: the index must be a clean digit string. parseInt is too forgiving
  // ('0x0' and '0abc' both become 0), and a tracked URL we generated ourselves
  // has no reason to be anything else.
  if (!/^\d{1,4}$/.test(String(index))) return null;
  const i = Number(index);
  if (i < 0 || i >= campaign.links.length) return null;
  const url = campaign.links[i];
  if (!/^https?:\/\//i.test(url)) return null; // belt and braces

  db.prepare(
    `UPDATE crm_campaign_sends
     SET clicked_at = COALESCE(clicked_at, CURRENT_TIMESTAMP), click_count = click_count + 1
     WHERE id = ?`
  ).run(send.id);
  // a click implies an open, even when the pixel was blocked
  if (!send.opened_at) {
    db.prepare('UPDATE crm_campaign_sends SET opened_at = CURRENT_TIMESTAMP WHERE id = ?').run(send.id);
  }
  return url;
}

/**
 * One-click unsubscribe. Clears marketing consent on the contact, which also
 * stops server-side conversion reporting for them (phase 3b) — one refusal,
 * honoured everywhere.
 *
 * @returns {{ok:boolean, contact?:object}}
 */
function unsubscribe(token) {
  const send = findSendByToken(token);
  if (!send) return { ok: false };
  db.prepare('UPDATE crm_contacts SET consent = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(send.contact_id);
  try {
    require('./events').record({
      contactId: send.contact_id, type: 'note',
      title: 'הסיר/ה את עצמו/ה מרשימת הדיוור'
    });
  } catch (e) { /* the removal is what matters */ }
  return { ok: true, contactId: send.contact_id };
}

/** Per-recipient results for the campaign screen. */
function sendsFor(campaignId, { limit = 200 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 2000);
  return db
    .prepare(
      `SELECT s.*, c.email, c.name FROM crm_campaign_sends s
       JOIN crm_contacts c ON c.id = s.contact_id
       WHERE s.campaign_id = ? ORDER BY s.id LIMIT ?`
    )
    .all(Number(campaignId), n);
}

module.exports = {
  STATUSES, GAP_MS,
  createCampaign, getCampaign, updateCampaign, deleteCampaign, listCampaigns,
  audienceFor, extractLinks, renderBody,
  startSend, deliverQueued,
  findSendByToken, recordOpen, resolveClick, unsubscribe, sendsFor
};
