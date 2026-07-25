'use strict';

/**
 * The AI copilot surface — the thirtieth and FINAL route-group extraction,
 * and the one docs/ARCHITECTURE.md said to take as a considered group rather
 * than a page at a time: four sibling admin screens off one shared concern
 * (how a user's AI reaches this CMS), plus the APIs their client scripts call.
 *
 * Both AI tiers live here on purpose — they are one product decision seen
 * from two sides, and splitting them hid that:
 *   BYOT / keyless — GET /admin/inject (copy the roleplay pack), GET /admin/ai
 *     (paste the reply back), GET /admin/agent (pair the browser extension),
 *     fed by /admin/api/inject-pack + /admin/api/syntax-dictionary[.md].
 *   BYOK / key-in-the-CMS — GET /admin/chat, fed by /admin/api/ai/settings
 *     (GET+POST) and /admin/api/ai/chat, which call the provider's official
 *     API server-side. The key never reaches the browser.
 *
 * This group could only move once v1.37 resolved the v1.19 shadowed-route
 * bug: two of these routes were the entanglement that blocked it.
 *
 * Started life as ai-paste.js (v1.35, two pages); renamed when it absorbed
 * the rest of the cluster in v1.47.
 */

const express = require('express');
const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');
const { requireAdmin } = require('../admin-guard');

const router = express.Router();

// ─── /admin/agent — pair the browser bridge (agent tokens) ──────────
// The page; its /admin/api/agent-tokens API lives in routes/agent-tokens.js.
router.get('/admin/agent', requireAdmin, (req, res) => {
  const origin = `${req.protocol}://${req.headers.host}`;
  const html = `
    ${adminNav('agent', 'גשר סוכן')}
    <div class="container page-body" style="max-width:900px">
      <p class="lead">
        טוקנים מאובטחים שמחברים סוכן חיצוני (תוסף הדפדפן) ל‑API של תפוזיאל —
        בלי סיסמה ובלי קובץ Cookie. הטוקן מוצג <b>פעם אחת בלבד</b> ביצירה.
        נקודת הקצה: <code dir="ltr">${escapeAdmin(origin)}/agent/v1</code>
      </p>
      <section class="card">
        <h3 class="sub-head">צור טוקן חדש</h3>
        <div class="row">
          <input id="tok-name" placeholder="שם (למשל: Chrome של בן)" class="input" style="flex:1;min-width:200px">
          <label class="check-row" style="margin-bottom:0"><input type="checkbox" id="tok-write" checked> הרשאת כתיבה (יצירת דפים)</label>
          <button type="button" id="tok-create" class="btn">צור טוקן</button>
        </div>
        <div id="tok-new" class="notice ok" style="display:none;margin-top:14px">
          <div style="margin-bottom:6px">העתק עכשיו — לא יוצג שוב:</div>
          <code id="tok-secret" class="code-box"></code>
        </div>
      </section>
      <section class="card">
        <h3 class="sub-head">טוקנים פעילים</h3>
        <div id="tok-list" class="muted">טוען…</div>
      </section>
    </div>
    <script src="/admin-agent.js"></script>
  `;
  res.send(layout(html, 'גשר סוכן', accentFor('agent')));
});

// ─── /admin/ai — the paste flow (BYO AI subscription, zero keys) ────
router.get('/admin/ai', (req, res) => {
  const html = `
    ${adminNav('chat', 'AI — הדבקה ידנית')}
    <div class="container page-body" style="max-width:1180px">
      <a href="/admin/chat" class="back-link">← חזרה לבונה החכם (צ׳אט)</a>
      <p class="lead" style="margin:8px 0 0">
        משוחחים עם ה‑AI שכבר יש לכם (ChatGPT / Claude / Grok) — בלי מפתחות API ובלי עלות נוספת.
        מעתיקים את המדריך, מבקשים דף, מדביקים את התשובה — והדף קם.
      </p>
      <div class="split-2">
        <section class="card">
          <h3 class="sub-head">1 · למדו את הבוט שלכם</h3>
          <p class="lead">העתיקו את המדריך והדביקו בצ'אט של ה‑AI שלכם. הוא ילמד לכתוב דפי תפוזיאל.</p>
          <button type="button" id="copy-primer" class="btn">📋 העתק את המדריך</button>
          <span id="primer-status" class="ok-text" style="margin-inline-start:10px"></span>

          <h3 style="margin-top:26px">2 · הדביקו את התשובה</h3>
          <div class="row" style="margin-bottom:10px">
            <label class="inline-field">לאיזה דף?</label>
            <select id="page-pick" class="input" style="flex:1">
              <option value="__new__">✨ דף חדש (לפי הכותרת וה-slug שהבוט כתב)</option>
            </select>
          </div>
          <textarea id="paste-box" placeholder="הדביקו כאן את כל תשובת הבוט — אפשר עם הטקסט מסביב, אנחנו נחלץ את הקוד"
            class="input code-area"></textarea>
          <div id="issue-panel" class="notice danger" style="display:none;margin-top:10px;white-space:pre-wrap"></div>
          <div class="row" style="margin-top:14px">
            <button type="button" id="apply-draft" class="btn" disabled>שמור כטיוטה</button>
            <button type="button" id="apply-publish" class="btn" disabled>שמור ופרסם</button>
          </div>
          <div id="apply-result" class="notice ok" style="display:none;margin-top:12px"></div>
        </section>
        <section class="card">
          <h3 class="sub-head">3 · תצוגה מקדימה חיה</h3>
          <iframe id="preview-frame" title="תצוגה מקדימה"
            class="preview-frame"></iframe>
        </section>
      </div>
    </div>
    <script src="/admin-ai.js"></script>
  `;
  res.send(layout(html, 'AI', accentFor('chat')));
});

// =========================================================================
// LANGUAGE INJECTION (v0.55) — /admin/inject + /admin/chat
// The "banger": one button hands any AI the BenTML dictionary as a roleplay
// game pack, so the user's own chat becomes a Site Builder agent (BYOT).
// /admin/inject = copy the pack; /admin/chat = copilot that mints a mission
// the extension injects into the user's logged-in LLM tab and auto-publishes.
// All handlers below inherit the global /admin session + Origin-CSRF gate.
// =========================================================================
router.get('/admin/inject', (req, res) => {
  // Repair telemetry (v1.85) — the number that answers "is BenTML a problem
  // for models?". Rendered server-side; the card is honest when empty.
  const stats = require('../pzn-repair-stats').summary();
  const fixRows = stats.topFixes.length
    ? stats.topFixes.map((f) =>
        `<li><code>${escapeAdmin(f.code)}</code>${f.element ? ' · bent-' + escapeAdmin(f.element) : ''}` +
        `<span style="float:left;font-weight:700">${f.count}</span></li>`).join('')
    : '<li class="muted">עדיין אין נתונים — הם ייאספו מכל הדבקה של AI.</li>';
  const statsCard = `
        <div class="inj-card" style="margin-top:14px">
          <h3>🩺 מה המודלים מפספסים בשפה</h3>
          ${stats.documents
            ? `<p class="muted"><strong>${stats.cleanRate}%</strong> מהמסמכים (${stats.clean}/${stats.documents})
               הגיעו תקינים בלי שום תיקון. השאר תוקנו אוטומטית — ואלה התיקונים:</p>`
            : `<p class="muted">כל מסמך ‎.pzn שמודל מחבר נמדד כאן: כמה הגיעו נקיים, ומה בדיוק תוקן.
               המספרים האלה הם התשובה לשאלה "האם צריך לשנות את התחביר".</p>`}
          <ul class="tool-list">${fixRows}</ul>
          ${stats.documents ? `<p class="muted" style="font-size:.78rem;margin-bottom:0">
            PROP_ALIAS/ALIAS = בעיית מילון (לתקן הסבר, לא תחביר) ·
            QUARANTINE = מודול שחסר לנו · E_* = בעיית תחביר אמיתית</p>` : ''}
        </div>`;
  const html = `
    ${adminNav('chat', 'מילון השפה · משחק בונה האתרים')}
    <style>
      .inj-grid { display:grid; grid-template-columns:1.1fr .9fr; gap:18px; max-width:1100px; margin:0 auto; padding:18px; }
      @media(max-width:860px){ .inj-grid{ grid-template-columns:1fr; } }
      .inj-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:18px; }
      .inj-card h3 { margin-top:0; }
      .inj-card textarea { width:100%; box-sizing:border-box; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:.92rem; margin-top:6px; }
      .tool-list { list-style:none; padding:0; margin:0; max-height:340px; overflow:auto; }
      .tool-list li { padding:6px 0; border-bottom:1px solid #f1f5f9; font-size:.9rem; }
      .tool-list code { background:#f1f5f9; padding:1px 6px; border-radius:4px; }
      .tag { font-size:.7rem; background:#fef3c7; color:#92400e; padding:1px 7px; border-radius:99px; margin-inline-start:4px; }
      .muted { color:#64748b; font-size:.88rem; }
      #preview { background:#0f172a; color:#e2e8f0; border-radius:10px; padding:12px; font:12px/1.45 ui-monospace,monospace;
        max-height:280px; overflow:auto; white-space:pre-wrap; direction:ltr; text-align:left; }
      .ok-msg { color:#166534; } .err-msg { color:#b91c1c; }
      .inj-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
    </style>
    <div class="inj-grid">
      <div>
        <div class="inj-card">
          <h3>🎮 הזרקת שפה לסוכן (BYOT)</h3>
          <p class="muted">
            מדביקים חבילת <strong>תפקיד + מילון + כלים</strong> בצ׳אט של ה‑AI שלכם.
            הסוכן משחק <em>בונה אתרים</em> — רק עם כלי ה‑BenTML מהמילון — ומוציא ‎.pzn מלא.
            <br/>אפשר גם בלחיצה אחת מתוך התוסף (הכפתור «① הזרק משחק + מילון»).
          </p>
          <label class="muted">תיאור דף (אופציונלי — נכנס למשחק כמשימה)</label>
          <textarea id="brief" rows="3" placeholder="למשל: דף נחיתה לסטודיו צילום עם הירו, שתי עמודות ו‑CTA"></textarea>
          <label class="muted" style="display:flex;gap:8px;align-items:flex-start;margin-top:10px;cursor:pointer">
            <input type="checkbox" id="lite" style="margin-top:3px" />
            <span><strong>חבילה חסכונית</strong> — לחשבון AI חינמי (ChatGPT חינם וכד׳): מילון מקוצר שנכנס במגבלת האורך של הודעה אחת. במנוי בתשלום עדיפה החבילה המלאה.</span>
          </label>
          <div class="inj-actions">
            <button type="button" class="btn" id="btn-roleplay">📋 העתק משחק מלא (תפקיד+כלים+מילון)</button>
            <button type="button" class="btn secondary" id="btn-card">🃏 כרטיס תפקיד קצר</button>
            <button type="button" class="btn secondary" id="btn-dict">📖 מילון בלבד</button>
            <button type="button" class="btn secondary" id="btn-preview">👁 תצוגה</button>
          </div>
          <p id="status" style="margin:10px 0 0;min-height:1.2em"></p>
        </div>
        <div class="inj-card" style="margin-top:14px">
          <h3>תצוגת החבילה</h3>
          <pre id="preview">לחצו «תצוגה»…</pre>
        </div>
        ${statsCard}
      </div>
      <div>
        <div class="inj-card">
          <h3>🧰 מלאי הכלים · <span id="mod-count">—</span></h3>
          <p class="muted">כל מודול = כלי במשחק. נבנה חי מה‑registry.</p>
          <ul class="tool-list" id="tool-list"><li class="muted">טוען…</li></ul>
        </div>
        <div class="inj-card" style="margin-top:14px">
          <h3>הזרימה</h3>
          <ol class="muted" style="line-height:1.65;padding-inline-start:18px">
            <li>העתק משחק מלא → הדבק ב‑AI (או ① בתוסף)</li>
            <li>הסוכן מאשר תפקיד + כלים</li>
            <li>תארו את האתר / הדף (חוקי המשחק)</li>
            <li>קבלו ‎.pzn מלא → תוסף מפרסם / הדביקו ב‑AI</li>
          </ol>
          <p class="muted" style="margin-bottom:0">
            <a href="/admin/chat">צ׳אט סוכן (משימות + תוסף) →</a>
          </p>
        </div>
      </div>
    </div>
    <script src="/admin-inject.js"></script>
  `;
  res.send(layout(html, 'מילון · משחק', accentFor('chat')));
});

// ─── the packs those two pages hand out ─────────────────────────────
// Syntax dictionary — single source for agents + humans. v1.37 resolved the
// v1.19 shadowed-route bug: this pair was registered TWICE in server.js, and
// an older block-registry pair won by Express's first-match rule, leaving
// these dead. The older pair is gone; the pzn dictionary — the one
// inject-pack, agent-bridge and agent-roleplay already use — now serves the
// endpoint, so /admin/inject's "copy dictionary" matches its own tool list.
// (src/syntax-dictionary.js still backs docs/SYNTAX-DICTIONARY.md via
// `npm run gen:dictionary`; it is no longer an HTTP surface.)
// Repair telemetry, machine-readable (v1.85) — same numbers as the card.
router.get('/admin/api/pzn/repair-stats', requireAdmin, (req, res) => {
  res.json(Object.assign({ ok: true }, require('../pzn-repair-stats').summary()));
});

router.get('/admin/api/syntax-dictionary', (req, res) => {
  const { buildDictionary, toAgentTools } = require('../pzn/syntax-dictionary');
  res.json({ ok: true, dictionary: buildDictionary(), tools: toAgentTools() });
});

router.get('/admin/api/syntax-dictionary.md', (req, res) => {
  const { buildDictionary, toMarkdown } = require('../pzn/syntax-dictionary');
  res.type('text/markdown; charset=utf-8').send(toMarkdown(buildDictionary()));
});

router.get('/admin/api/inject-pack', (req, res) => {
  const { buildRoleplayPack, buildRoleCard, buildInjectBundle } = require('../pzn/agent-roleplay');
  const { buildDictionary, toMarkdown } = require('../pzn/syntax-dictionary');
  const media = require('../media').listAllMedia(40);
  const brief = req.query.brief ? String(req.query.brief) : '';
  const locale = req.query.locale === 'en' ? 'en' : 'he';
  const format = String(req.query.format || 'json');
  const size = String(req.query.size || '') === 'lite' ? 'lite' : 'full';
  const opts = { playerBrief: brief, locale, media, size };
  if (format === 'roleplay') {
    return res.type('text/markdown; charset=utf-8').send(buildRoleplayPack(opts).text);
  }
  if (format === 'card') {
    return res.type('text/plain; charset=utf-8').send(buildRoleCard(opts));
  }
  if (format === 'dictionary' || format === 'dict') {
    return res.type('text/markdown; charset=utf-8').send(toMarkdown(buildDictionary()));
  }
  res.json(buildInjectBundle(opts));
});

// ─── Tier-1 AI (v0.85): the key lives in the CMS, the chat runs here ───
// Ben's realignment: key-based chat = CMS feature (server-side calls to the
// provider's official API); the extension stays the KEYLESS tier.
router.get('/admin/api/ai/settings', requireAdmin, (req, res) => {
  try {
    const ai = require('../ai');
    res.json({ ok: true, ...ai.getSettings(), providers: ai.listProviders() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/ai/settings', requireAdmin, (req, res) => {
  try {
    const b = req.body || {};
    const settings = require('../ai').saveSettings({
      provider: b.provider,
      model: b.model,
      apiKey: b.apiKey, // undefined = keep, '' = clear, value = replace
      baseUrl: b.baseUrl // local runtime address; saveSettings refuses non-loopback
    });
    res.json({ ok: true, ...settings });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/ai/chat', async (req, res) => {
  try {
    const b = req.body || {};
    const message = String(b.message || '').trim();
    // An approval carries no message — it resumes a proposal the model already
    // made and the owner just accepted (or refused).
    const approve = b.approve && b.approve.id
      ? { id: String(b.approve.id), ok: b.approve.ok === true }
      : null;
    if (!message && !approve) return res.status(400).json({ ok: false, error: 'הודעה ריקה' });
    // The CONNECTED copilot gets its own briefing, not the paste-into-a-chat
    // roleplay pack: it arrived through the owner's API key, it is already
    // inside the CMS, and it is talking to the person who owns the site. Same
    // dictionary and same real media manifest — only the framing differs.
    const { buildCopilotBriefing } = require('../pzn/agent-roleplay');
    const media = require('../media').listAllMedia(40);
    let siteTitle = '';
    try { siteTitle = String(require('../config').loadConfig().title || ''); } catch (e) { /* unnamed site */ }
    let system = buildCopilotBriefing({ locale: 'he', media, siteTitle }).text;
    // Situational awareness (v1.71, Ben: "grasp the situation of being the
    // helper in CMS… adding text to a selected item, help in the page
    // builder"). When the chat arrives FROM the builder it carries context:
    // which page is open and which module is selected — so "the selected
    // item" means that exact block, and edits target the open page.
    const ctx = b.context && typeof b.context === 'object' ? b.context : null;
    if (ctx && ctx.page) {
      const pageSlug = String(ctx.page).slice(0, 200);
      let situation = '\n\n---\n\n## המצב עכשיו — בעל/ת האתר בתוך בונה הדפים\n' +
        'הדף הפתוח בבונה: `' + pageSlug + '`. כשמבקשים ממך לערוך "את הדף" — זה הדף. ' +
        'השתמש/י ב-edit_page עם ה-slug הזה והחזר/י את המסמך המלא עם השינויים המבוקשים בלבד.\n';
      const sel = ctx.selected && typeof ctx.selected === 'object' ? ctx.selected : null;
      if (sel && sel.type) {
        situation += '\n**הפריט המסומן כרגע:** מודול `' + String(sel.type).slice(0, 40) + '`' +
          (sel.id ? ' (id: `' + String(sel.id).slice(0, 60) + '`)' : '') +
          (sel.text ? ' — הטקסט הנוכחי שלו: "' + String(sel.text).slice(0, 280) + '"' : '') +
          '. כשמבקשים "הוסף טקסט לפריט המסומן" או "שנה את זה" — הכוונה לבלוק הזה בדיוק, לא לדף אחר ולא לבלוק אחר.\n';
      }
      system += situation;
    }
    const out = await require('../ai').converse({
      system,
      user: message,
      history: Array.isArray(b.history) ? b.history : [],
      approve
    });
    res.json({ ok: true, reply: out.reply || '', pending: out.pending || null, used: out.used || [] });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/admin/chat', (req, res) => {
  const html = `
    ${adminNav('chat', 'צ׳אט סוכן — תיאור → BenTML → דף')}
    <style>
      .chat-wrap { display:grid; grid-template-columns:1fr 320px; gap:18px; max-width:1120px; margin:0 auto; padding:18px; align-items:start; }
      @media(max-width:900px){ .chat-wrap{ grid-template-columns:1fr; } }
      .chat-main { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:16px; display:flex; flex-direction:column; min-height:520px; }
      #chat-log { flex:1; overflow:auto; display:flex; flex-direction:column; gap:10px; padding-bottom:12px; }
      .bubble { padding:11px 14px; border-radius:12px; max-width:92%; line-height:1.5; font-size:.92rem; }
      .bubble.system { background:#f1f5f9; color:#334155; align-self:center; text-align:center; font-size:.86rem; }
      .bubble.user { background:#0a66c2; color:#fff; align-self:flex-start; }
      .bubble.assistant { background:#fff7ed; border:1px solid #fed7aa; color:#7c2d12; align-self:flex-end; }
      .bubble .actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
      .bubble .act { border:none; border-radius:8px; padding:7px 10px; cursor:pointer; font:600 12px system-ui; background:#e2e8f0; color:#0f172a; }
      .bubble .act.primary { background:#7c3aed; color:#fff; }
      .bubble .code { background:#0f172a; color:#e2e8f0; border-radius:8px; padding:8px; font:11px/1.4 ui-monospace,monospace; direction:ltr; text-align:left; white-space:pre-wrap; max-height:220px; overflow:auto; }
      .chat-compose { border-top:1px solid #e2e8f0; padding-top:12px; }
      .chat-compose textarea { width:100%; box-sizing:border-box; padding:10px; border:1px solid #cbd5e1; border-radius:8px; min-height:70px; font-size:.92rem; }
      .chat-compose .row { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
      .chat-side .card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:16px; margin-bottom:14px; }
      .chat-side .field { margin-bottom:10px; }
      .chat-side label { display:block; font-size:.82rem; color:#475569; margin-bottom:4px; }
      .chat-side input, .chat-side select { width:100%; box-sizing:border-box; padding:8px; border:1px solid #cbd5e1; border-radius:8px; }
      .muted { color:#64748b; }
      /* Provider choice as RADIOS (v1.70, Ben). An option that is not ready is
         toned down — still clickable (picking it is HOW you configure it),
         but honest about not working yet. */
      .provider-radios { display:flex; flex-direction:column; gap:6px; }
      .provider-radio { display:flex; align-items:center; gap:8px; padding:7px 10px; border:1px solid #e2e8f0; border-radius:8px; cursor:pointer; font-size:.88rem; }
      .provider-radio input { width:auto; margin:0; }
      .provider-radio .pr-chip { margin-inline-start:auto; font-size:.72rem; color:#059669; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:999px; padding:2px 8px; white-space:nowrap; }
      .provider-radio.is-off { opacity:.55; }
      .provider-radio.is-off .pr-chip { color:#92400e; background:#fffbeb; border-color:#fde68a; }
      .provider-radio:has(input:checked) { border-color:#7c3aed; background:#f5f3ff; opacity:1; }
    </style>
    <div class="chat-wrap">
      <div class="chat-main">
        <div id="chat-log"></div>
        <div class="chat-compose">
          <textarea id="chat-input" placeholder="תארו את הדף שאתם רוצים… (Ctrl+Enter לשליחה)"></textarea>
          <div class="row">
            <button type="button" class="btn" id="btn-send">שלח</button>
            <span id="chat-status" class="muted" style="font-size:.85rem;align-self:center"></span>
          </div>
        </div>
      </div>
      <aside class="chat-side">
        <div class="card">
          <h3 class="sub-head">🔑 המפתח שלכם — בתוך ה‑CMS</h3>
          <p class="muted" style="font-size:.85rem;margin:0 0 10px">הצ׳אט קורא ל‑API הרשמי של הספק מהשרת שלכם, עם המפתח שלכם. המפתח נשמר בשרת בלבד (קובץ מוגן, מחוץ ל‑git) ולעולם לא נשלח לדפדפן.</p>
          <div class="field"><label>ספק</label><div id="ai-provider-radios" class="provider-radios"></div></div>
          <div class="field"><label>מודל</label>
            <select id="ai-model"></select>
            <input id="ai-model-free" class="input" dir="ltr" autocomplete="off" hidden
                   placeholder="שם המודל שטעון" title="מודל מקומי מגיש את מה שטעון בו — הקלידו את שמו">
          </div>
          <div class="field" id="ai-local-row" hidden>
            <label>כתובת המודל המקומי</label>
            <input id="ai-base" class="input" dir="ltr" autocomplete="off" placeholder="http://127.0.0.1:1234/v1">
            <div class="faint" style="margin-top:4px">
              LM Studio: הפעילו את <b>Local Server</b> (ברירת מחדל 1234) · Ollama: 11434.
              מותרות רק כתובות של המחשב הזה — השרת ידחה כל כתובת חיצונית.
            </div>
          </div>
          <div class="field"><label>מפתח API <span id="ai-key-state" class="muted"></span></label>
            <input id="ai-key" type="password" dir="ltr" autocomplete="off" placeholder="sk-…">
          </div>
          <div class="row">
            <button type="button" class="btn sm" id="ai-save">שמור</button>
            <span id="ai-settings-status" class="muted" style="font-size:.82rem"></span>
          </div>
        </div>
        <div class="card">
          <h3 class="sub-head">בלי מפתח? יש מסלול</h3>
          <ul class="muted" style="font-size:.88rem;line-height:1.7;padding-inline-start:18px;margin:0">
            <li><a href="/admin/inject">מילון · משחק</a> — הדביקו את החבילה בצ׳אט שאתם כבר מנויים עליו</li>
            <li><a href="/admin/ai">הדבקה ידנית</a> — הדביקו תשובת AI ובנו דף בתוך ה‑CMS</li>
            <li><a href="/admin/agent">גשר סוכן</a> — התוסף (ללא מפתח) עובד על הצ׳אט הפתוח שלכם</li>
          </ul>
        </div>
      </aside>
    </div>
    <script src="/admin-chat.js"></script>
  `;
  res.send(layout(html, 'קופיילוט', accentFor('chat')));
});

module.exports = router;
