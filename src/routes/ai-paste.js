'use strict';

/**
 * BYO-AI paste-flow pages — the twenty-ninth route-group extraction:
 * GET /admin/ai (the keyless paste flow — teach your own AI subscription
 * the .pzn syntax, paste its reply back) and GET /admin/inject (the
 * copy-the-pack screen). Two cohesive onboarding pages for the North
 * Star's 'your AI subscription, not our tokens' ace. Pure server-rendered
 * HTML off the admin-ui shell; no state, no secrets. The AI settings/chat
 * APIs and the copilot chat page are a separate concern and stay put.
 */

const express = require('express');
const { layout, adminNav, accentFor } = require('../admin-ui');

const router = express.Router();

// ─── /admin/ai — the paste flow (BYO AI subscription, zero keys) ────
router.get('/admin/ai', (req, res) => {
  const html = `
    ${adminNav('chat', 'AI — הדבקה ידנית')}
    <div class="container" style="padding-top:20px;max-width:1180px">
      <a href="/admin/chat" style="font-size:.9rem;color:#7c3aed">← חזרה לבונה החכם (צ׳אט)</a>
      <p style="color:#64748b;margin:8px 0 0">
        משוחחים עם ה‑AI שכבר יש לכם (ChatGPT / Claude / Grok) — בלי מפתחות API ובלי עלות נוספת.
        מעתיקים את המדריך, מבקשים דף, מדביקים את התשובה — והדף קם.
      </p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
        <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h3 style="margin-top:0">1 · למדו את הבוט שלכם</h3>
          <p style="color:#64748b;font-size:.92rem">העתיקו את המדריך והדביקו בצ'אט של ה‑AI שלכם. הוא ילמד לכתוב דפי תפוזיאל.</p>
          <button type="button" id="copy-primer" class="btn">📋 העתק את המדריך</button>
          <span id="primer-status" style="margin-inline-start:10px;color:#16a34a;font-size:.9rem"></span>

          <h3 style="margin-top:26px">2 · הדביקו את התשובה</h3>
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
            <label style="font-size:.92rem;color:#475569">לאיזה דף?</label>
            <select id="page-pick" style="flex:1;padding:8px;border:1px solid #e2e8f0;border-radius:8px">
              <option value="__new__">✨ דף חדש (לפי הכותרת וה-slug שהבוט כתב)</option>
            </select>
          </div>
          <textarea id="paste-box" placeholder="הדביקו כאן את כל תשובת הבוט — אפשר עם הטקסט מסביב, אנחנו נחלץ את הקוד"
            style="width:100%;min-height:260px;box-sizing:border-box;padding:12px;border:1px solid #e2e8f0;border-radius:8px;font-family:ui-monospace,monospace;font-size:.85rem;direction:ltr;text-align:left"></textarea>
          <div id="issue-panel" style="display:none;margin-top:10px;padding:12px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;font-size:.9rem;white-space:pre-wrap"></div>
          <div style="display:flex;gap:10px;margin-top:14px">
            <button type="button" id="apply-draft" class="btn" disabled>שמור כטיוטה</button>
            <button type="button" id="apply-publish" class="btn" disabled>שמור ופרסם</button>
          </div>
          <div id="apply-result" style="display:none;margin-top:12px;padding:12px;border-radius:8px;background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;font-size:.95rem"></div>
        </section>
        <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h3 style="margin-top:0">3 · תצוגה מקדימה חיה</h3>
          <iframe id="preview-frame" title="תצוגה מקדימה"
            style="width:100%;height:520px;border:1px solid #e2e8f0;border-radius:8px;background:#fff"></iframe>
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

module.exports = router;
