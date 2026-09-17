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
          <iframe id="preview-frame" title="תצוגה מקדימה" sandbox="allow-scripts"
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
  // The packs grid (v2.28) — every runnable injection in src/injections
  // (the menu organizer, the theme designer, …) gets the generic card here,
  // beside the site-builder pack this page has always handed out. Hidden
  // stubs stay off the grid; a registry that fails to load leaves the page
  // itself standing.
  let packs = [];
  try { packs = require('../injections').list().filter((p) => !p.ui.hidden); } catch (e) { packs = []; }
  const packsGrid = packs.length ? `
    <div class="inj-packs">
      <div class="inj-card">
        <h3>🧩 חבילות — הזרקות מוכנות לאתר הזה</h3>
        <p class="muted">כל חבילה = משחק תפקידים שה-AI משחק על המצב האמיתי של האתר: מעתיקים פרומפט ומדביקים בצ׳אט (או מריצים עם ה-AI המחובר), מדביקים את התשובה, רואים תצוגה מקדימה — ורק אז מחילים.</p>
      </div>
      <div class="inj-packs-grid">
        ${packs.map((p) => `<section class="card" data-inject="${escapeAdmin(p.id)}"></section>`).join('')}
      </div>
    </div>
    <script src="/admin-bridge.js"></script>
    <script src="/admin-inject-card.js"></script>
    <script>
      (function () {
        var els = document.querySelectorAll('.inj-packs-grid [data-inject]');
        for (var i = 0; i < els.length; i++) {
          TapuzInjectCard.mount(els[i], els[i].getAttribute('data-inject'), {});
        }
      })();
    </script>` : '';
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
      .inj-packs { max-width:1100px; margin:0 auto; padding:0 18px 18px; }
      .inj-packs-grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-top:14px; }
      @media(max-width:860px){ .inj-packs-grid{ grid-template-columns:1fr; } }
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
    ${packsGrid}
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

// ─── חיבור AI (v2.15, Ben's spec) — the ONE setup screen ────────────────
// "Local AI" for a model on the owner's machine, the API-key tier with each
// provider's CREATE-A-KEY page linked (that page is not the paste-the-key
// page — people mix them up), the extension download, and a picture tutorial.

// ─── the window (v2.32) — how big is the model's context, really? ───────
// Ben's copilot died on `request (17246 tokens) exceeds the available context
// size (8192 tokens)`: LM Studio's GUI loads a model at 8K by default, the
// briefing alone is ~15K tokens, and nothing ever asked the runtime what it
// had loaded. Worse than the 400 is the SILENT case (map addendum 1): when
// n_ctx ≤ n_prompt < 2·n_ctx the engine answers 200 with the middle of the
// prompt thrown away — dictionary, example, older turns — and the reply is
// hollow. So the window is probed BEFORE a send (src/ai-window.js) and the
// tier of briefing is chosen to fit it; these helpers are the route-side of
// that. Nothing here writes config — the window is a fact about the runtime
// right now, not a setting.

/** The page's window hint (browser courier: the bridge probed LM Studio and
 *  the page forwards what it saw). Only a sane integer window passes — the
 *  door re-validates, but a bad hint must not reach the planner here. */
function readWindowHint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tokens = Number(raw.tokens);
  if (!Number.isInteger(tokens) || tokens < 1024 || tokens > 1048576) return null;
  const maxTokens = Number(raw.maxTokens);
  return {
    tokens,
    maxTokens: Number.isInteger(maxTokens) && maxTokens >= tokens ? maxTokens : null,
    model: String(raw.model || '').slice(0, 200),
    source: 'bridge',
    bridgeVersion: String(raw.bridgeVersion || '').slice(0, 20)
  };
}

/** The two briefing sizes the planner weighs (full = today's 45K text,
 *  compact = one line per tool) plus the fixed cost every call carries (the
 *  tool declarations). Built once per process — the dictionary does not
 *  change while the server runs, and the full text is 45K chars to build. */
let briefingSizes = null;
function getBriefingSizes() {
  if (briefingSizes) return briefingSizes;
  const { buildCopilotBriefing } = require('../pzn/agent-roleplay');
  const tools = require('../ai-tools');
  briefingSizes = {
    full: buildCopilotBriefing({ locale: 'he', tier: 'full' }).chars,
    compact: buildCopilotBriefing({ locale: 'he', tier: 'compact' }).chars,
    fixedChars: JSON.stringify(tools.toolsForProvider('openai-chat')).length
  };
  return briefingSizes;
}

/**
 * Plan the window AS a given courier, whatever provider is saved: the setup
 * screen's bridge card asks "and through the bridge?" while a cloud key may
 * still be the saved provider. Only the `?provider=` override lands here —
 * the copilot page's own chip goes through the door's `ai.planWindow`, so
 * the chip and the turn read the SAME cache (same key, same probe TTL, same
 * hint-forgetting) and can never disagree about the tier. The tier and the
 * Hebrew sentence come from src/ai-window.js so no screen re-types them.
 */
async function planWindowAs(hint, providerOverride) {
  const ai = require('../ai');
  const aw = require('../ai-window');
  const s = ai.getSettings();
  const providerId = providerOverride || s.provider || 'claude';
  const cloud = providerId !== 'local' && providerId !== 'browser';
  let model = String(s.model || '').trim();
  let probe = null;
  if (providerId === 'local') {
    probe = await aw.probeLocalWindow(s.baseUrl, model);
    if (probe) {
      model = probe.model || model;
      aw.noteWindow(aw.windowKey('local', model), probe.tokens, 'probe', { maxTokens: probe.maxTokens, jit: probe.jit });
    }
  } else if (providerId === 'browser' && hint) {
    model = hint.model || model;
    aw.noteWindow(aw.windowKey('browser', model), hint.tokens, 'hint', { maxTokens: hint.maxTokens, bridgeVersion: hint.bridgeVersion });
  }
  const known = cloud
    ? { tokens: Infinity, source: 'cloud', ratio: aw.DEFAULT_RATIO, maxTokens: null, jit: false }
    : aw.getWindow(aw.windowKey(providerId, model));
  const sizes = getBriefingSizes();
  // An UNKNOWN window (no probe, no hint — an old bridge, a non-LM-Studio
  // server, a model LM Studio will JIT-load) is planned on the advisory
  // number, which the door uses for the compact tier's history budget only
  // — it can never promote to the full dictionary (the contract's rule), so
  // the copilot starts compact and shrinks further if the model refuses.
  const advisory = (require('../providers').getProvider('local') || {}).contextTokens || 24000;
  const planOn = known.tokens ? { tokens: known.tokens, source: known.source } : { tokens: advisory, source: 'advisory' };
  const plan = aw.pickTier({
    tokens: planOn.tokens, source: planOn.source, ratio: known.ratio,
    sizes: { full: sizes.full, compact: sizes.compact }, fixedChars: sizes.fixedChars
  });
  // what read_page may hand back whole — the door's own rule, so the
  // sentence promises exactly what the tool keeps
  const editMaxChars = plan.tier ? aw.editAllowance(plan.roomChars) : 0;
  const jit = !!((probe && probe.jit) || known.jit);
  const message = aw.describeWindow({
    tokens: cloud ? Infinity : known.tokens, source: known.source, tier: plan.tier, model,
    bridgeVersion: hint ? hint.bridgeVersion : '', jit, editMaxChars,
    minTokens: plan.tier ? undefined : aw.minWindowFor(plan.promptTokens)
  });
  return {
    provider: providerId,
    model,
    window: {
      tokens: cloud || !known.tokens ? null : known.tokens,
      maxTokens: known.maxTokens || null,
      source: known.source,
      jit
    },
    tier: plan.tier,
    tierHe: aw.HE.tierHe(plan.tier),
    message,
    recommended: aw.RECOMMENDED_WINDOW,
    editMaxChars: Number.isFinite(editMaxChars) ? editMaxChars : null,
    probe
  };
}

/** The window as the copilot page and the setup screen see it. The browser
 *  courier passes its hint in the query (the server cannot reach the owner's
 *  LM Studio — only their browser can, and it already asked). The saved
 *  provider is planned by the door itself (ai.planWindow — the one planner
 *  converse uses); `?provider=browser|local` plans as that courier instead. */
router.get('/admin/api/ai/window', requireAdmin, async (req, res) => {
  try {
    const q = req.query || {};
    const hint = readWindowHint({
      tokens: q.tokens, maxTokens: q.maxTokens, model: q.model, source: q.source, bridgeVersion: q.bridgeVersion
    });
    const override = q.provider === 'browser' || q.provider === 'local' ? q.provider : '';
    const plan = override ? await planWindowAs(hint, override) : await require('../ai').planWindow({ hint });
    res.json({
      ok: true,
      provider: plan.provider,
      model: plan.model,
      window: plan.window,
      tier: plan.tier,
      tierHe: plan.tierHe,
      message: plan.message,
      recommended: plan.recommended,
      editMaxChars: plan.editMaxChars
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, code: e.code || '' });
  }
});

// Connection test for the local runtime: hit its /models (OpenAI shape) and
// report what is loaded. Never called with a key; loopback enforced twice.
// v2.32: also asks LM Studio's native /api/v0/models for the LOADED context
// length — the number the 8K error was about — so the ✅ line can say
// whether page building will fit before anyone types a word.
router.post('/admin/api/ai/test', requireAdmin, async (req, res) => {
  const { resolveLocalEndpoint } = require('../providers');
  const raw = String((req.body || {}).baseUrl || '');
  const endpoint = resolveLocalEndpoint(raw);
  if (!endpoint) {
    return res.status(400).json({ ok: false, error: 'הכתובת חייבת להצביע על המחשב הזה (127.0.0.1 / localhost)' });
  }
  const modelsUrl = endpoint.replace(/\/(chat\/)?completions\/?$/, '/models');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(modelsUrl, { signal: ctrl.signal });
    const data = await r.json().catch(() => null);
    if (!r.ok) return res.json({ ok: false, error: 'השרת המקומי ענה ' + r.status + ' — בדקו שהשרת דולק' });
    const models = (((data || {}).data) || []).map((m) => m.id).filter(Boolean);
    // the window, when the runtime tells (LM Studio does; Ollama does not —
    // the test line then simply has no window sentence). Never fails the test.
    let window = null;
    let windowMessage = '';
    try {
      const aw = require('../ai-window');
      const model = String((req.body || {}).model || require('../ai').getSettings().model || '').trim();
      const probe = await aw.probeLocalWindow(raw, model);
      if (probe) {
        window = { tokens: probe.tokens, maxTokens: probe.maxTokens, model: probe.model, jit: !!probe.jit, loaded: probe.loaded || [] };
        const sizes = getBriefingSizes();
        // a JIT case (configured model not loaded yet) has no number — the
        // sentence says what LM Studio will do on the first request
        const plan = aw.pickTier({
          tokens: probe.tokens || 0, source: 'probe', ratio: aw.DEFAULT_RATIO,
          sizes: { full: sizes.full, compact: sizes.compact }, fixedChars: sizes.fixedChars
        });
        windowMessage = aw.describeWindow({
          tokens: probe.tokens, source: 'probe', tier: probe.tokens ? plan.tier : undefined,
          model: probe.model || model, jit: !!probe.jit,
          editMaxChars: plan.tier ? aw.editAllowance(plan.roomChars) : 0,
          minTokens: plan.tier ? undefined : aw.minWindowFor(plan.promptTokens)
        });
      }
    } catch (e) { /* the window is a bonus on this line, never a failure */ }
    res.json({ ok: true, endpoint, models, window, windowMessage });
  } catch (e) {
    res.json({
      ok: false,
      error: 'אין תשובה מ-' + modelsUrl + ' — פתחו את LM Studio, טאב Developer, והפעילו את השרת (Start Server)'
    });
  } finally {
    clearTimeout(timer);
  }
});

// Extension downloads, one build per BROWSER (v2.18.1), the Bridge wired to
// the site it was downloaded from (v2.34). The build itself — the whitelist,
// the per-browser manifest, the wiring — is src/extension-build.js (v2.41),
// shared with scripts/update-bridge.js so a developer's folder and this ZIP
// never differ. No param ever touches the filesystem.
router.get('/admin/ai-setup/extension-:which-:browser.zip', requireAdmin, (req, res) => {
  try {
    const { extensionBuild } = require('../extension-build');
    const build = extensionBuild(req.params.which, req.params.browser, req.hostname);
    if (!build) return res.status(404).json({ ok: false, error: 'unknown extension build' });
    const { zipDirectory } = require('../zip-store');
    const buf = zipDirectory(build.dir, '', { 'manifest.json': build.manifestText });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${build.base}-${req.params.browser}.zip"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/admin/ai-setup', requireAdmin, (req, res) => {
  // the bridge ZIP is wired to this host unless it is loopback — say which
  const bridgeWired = !!require('../bridge-manifest').siteMatchPattern(req.hostname);
  const html = `
    ${adminNav('ai-setup', 'חיבור AI')}
    <div class="container page-body" style="max-width:1180px">
      <p class="lead" style="margin:8px 0 0">
        מחברים בינה לתפוזיאל באחת משתי דרכים — <strong>מודל מקומי</strong> שרץ אצלכם בחינם,
        או <strong>מפתח API</strong> של ספק ענן. עד שמחברים, הקופיילוט פשוט לא מופיע בבונה.
      </p>
      <div id="ai-status-banner" class="notice" style="margin-top:14px">בודק מצב…</div>

      <div class="split-2" style="margin-top:18px">
        <section class="card">
          <h3 class="sub-head">🖥️ Local AI — מודל על המחשב שלכם</h3>
          <p class="lead">חינם, פרטי, בלי מונה: LM Studio (או Ollama) מריץ מודל פתוח על המחשב, ותפוזיאל מדבר איתו ישירות.</p>
          <img src="/demo/ai-tut-lmstudio.jpg" alt="איור: LM Studio עם מודל טעון ושרת דולק" class="ai-tut-img">
          <ol class="ai-steps">
            <li>מורידים את <a href="https://lmstudio.ai" target="_blank" rel="noopener">LM Studio</a> ובוחרים מודל (מסך Discover).</li>
            <li>בטאב <strong>Developer</strong> לוחצים <strong>Start Server</strong> — הכתובת תהיה <code dir="ltr">http://127.0.0.1:1234/v1</code>.</li>
            <li>מדביקים את הכתובת כאן, שומרים, ולוחצים ״בדיקת חיבור״.</li>
          </ol>
          <img src="/demo/ai-tut-connect.jpg" alt="איור: הכתובת המקומית עוברת מ-LM Studio אל תפוזיאל" class="ai-tut-img">
          <label class="field-label">כתובת השרת המקומי</label>
          <input id="ai-base-url" class="input" dir="ltr" placeholder="http://127.0.0.1:1234/v1">
          <label class="field-label" style="margin-top:10px">מודל (לא חובה — ריק = מה שטעון)</label>
          <input id="ai-local-model" class="input" dir="ltr" placeholder="local-model">
          <div class="row" style="margin-top:12px">
            <button type="button" id="ai-save-local" class="btn">שמור Local AI</button>
            <button type="button" id="ai-test-local" class="btn secondary">🔌 בדיקת חיבור</button>
          </div>
          <div id="ai-test-result" class="notice" style="display:none;margin-top:10px;white-space:pre-wrap"></div>
        </section>

        <section class="card">
          <h3 class="sub-head">🔑 מפתח API — ספק ענן</h3>
          <p class="lead">יש לכם חשבון אצל ספק? יוצרים מפתח בעמוד הייעודי של הספק (זה עמוד אחר מהעמוד שבו מדביקים אותו כאן!) ומדביקים למטה.</p>
          <img src="/demo/ai-tut-key.jpg" alt="איור: יוצרים מפתח אצל הספק ומדביקים בתפוזיאל" class="ai-tut-img">
          <label class="field-label">ספק</label>
          <select id="ai-provider" class="input"></select>
          <div id="ai-key-create" class="notice" style="margin-top:10px"></div>
          <label class="field-label" style="margin-top:10px">המפתח (נשמר בשרת שלכם בלבד, לא מוצג שוב)</label>
          <input id="ai-api-key" class="input" dir="ltr" type="password" autocomplete="off" placeholder="">
          <div class="muted" id="ai-key-state" style="margin-top:6px"></div>
          <label class="field-label" style="margin-top:10px">מודל</label>
          <select id="ai-model" class="input"></select>
          <div class="row" style="margin-top:12px">
            <button type="button" id="ai-save-key" class="btn">שמור ספק ומפתח</button>
            <button type="button" id="ai-clear-key" class="btn secondary">נקה מפתח</button>
          </div>
        </section>
      </div>

      <section class="card" id="ai-bridge-card" style="margin-top:18px">
        <h3 class="sub-head">🌉 האתר בענן, המודל אצלכם — Bridge V2</h3>
        <p class="lead">
          כשהאתר מאוחסן אצל ספק אירוח, <strong>השרת לא יכול להגיע</strong> ל-LM Studio שרץ על המחשב שלכם —
          אבל <strong>הדפדפן שלכם כן</strong>. התוסף Bridge V2 מעביר כל קריאה: החבילות (מסדר התפריטים,
          מעצב הערכה) רצות על ה-GPU שלכם, בלי מפתחות, בלי מונה, והמודל לא נחשף לאינטרנט לרגע.
        </p>
        <div id="ai-bridge-state" class="notice">מחפש את הגשר…</div>
        <label class="field-label" style="margin-top:10px">מודל</label>
        <select id="ai-bridge-model" class="input"></select>
        <div class="row" style="margin-top:12px">
          <button type="button" id="ai-save-bridge" class="btn">חבר דרך הדפדפן</button>
          <a class="btn secondary" href="#ai-ext-card">⬇ להתקנת התוסף</a>
        </div>
      </section>

      <section class="card" id="ai-ext-card" style="margin-top:18px">
        <h3 class="sub-head">🧩 התוסף לדפדפן — Chrome וגם Firefox</h3>
        <p class="lead">
          שתי תוספות, לפי הצורך: <strong>מלווה ההעתקה</strong> — כפתור אחד מעתיק חבילת BenTML מוכנה יחד עם
          המחשבה שלכם; מדביקים בכל צ׳אט שיש לכם, שולחים בעצמכם, ומדביקים את התשובה חזרה — והיא נהיית דף.
          <strong>בלי שום נוכחות באתרי הצ׳אט</strong>: הצ׳אטים הציבוריים הם השותפים הטבעיים שלנו — לא נוגעים,
          לא מזריקים, ושום עדכון שלהם לא שובר אותנו. <strong>Bridge V2</strong> — מגשר בין אתר מאוחסן בענן
          לבין המודל המקומי שרץ אצלכם.
        </p>
        <div class="ai-ext-grid">
          <div class="ai-ext-block">
            <div class="ai-ext-name">מלווה ההעתקה</div>
            <a class="btn" data-ext-browser="chrome" href="/admin/ai-setup/extension-byot-chrome.zip">⬇ ל-Chrome / Edge</a>
            <a class="btn" data-ext-browser="firefox" href="/admin/ai-setup/extension-byot-firefox.zip">⬇ ל-Firefox</a>
          </div>
          <div class="ai-ext-block">
            <div class="ai-ext-name">Bridge V2</div>
            <a class="btn secondary" data-ext-browser="chrome" href="/admin/ai-setup/extension-bridge-chrome.zip">⬇ ל-Chrome / Edge</a>
            <a class="btn secondary" data-ext-browser="firefox" href="/admin/ai-setup/extension-bridge-firefox.zip">⬇ ל-Firefox</a>
          </div>
          <div class="ai-ext-block">
            <div class="ai-ext-name">חיבור</div>
            <a class="btn secondary" href="/admin/agent">🔑 טוקן סוכן (המלווה צריך אחד)</a>
          </div>
        </div>
        <div id="ai-ext-howto" class="notice" style="margin-top:12px">
          <strong>Chrome / Edge:</strong> פותחים <code dir="ltr">chrome://extensions</code>, מדליקים
          Developer mode, וגוררים את קובץ ה-ZIP אל החלון.<br>
          <strong>Firefox:</strong> פותחים <code dir="ltr">about:debugging#/runtime/this-firefox</code>,
          לוחצים <strong>Load Temporary Add-on</strong> ובוחרים את ה-ZIP שהורדתם.
          <span class="muted">(התקנה קבועה ב-Firefox דורשת חתימת Mozilla — בינתיים הטעינה הזמנית עובדת מצוין,
          ונחתום כשנעלה לחנות.)</span><br>
          ${bridgeWired
            ? '<strong>Bridge V2 מגיע מחובר לאתר הזה</strong> — ה-ZIP נבנה בשבילו, אז אחרי ההתקנה מרעננים את הדף וזהו. חלצו אותו לתיקייה משלו, לא לתוך עותק של הריפו. לאתר נוסף: פופאפ התוסף → ״חבר את האתר הפתוח״.'
            : '<strong>Bridge V2 באתר מקומי:</strong> אחרי ההתקנה — פופאפ התוסף → ״חבר את האתר הפתוח״. (ZIP שיורד מאתר מאוחסן מגיע כבר מחובר אליו.)'}
        </div>
      </section>
    </div>
    <style>
      .ai-tut-img { width:100%; border-radius:10px; border:1px solid var(--ws-border); margin:10px 0; }
      .ai-steps { margin:10px 0 14px; padding-inline-start:20px; line-height:1.9; }
      .ai-steps code { background:var(--ws-well); padding:1px 6px; border-radius:5px; }
      #ai-key-create a { word-break: break-all; display: inline-block; }
      .ai-ext-grid { display:flex; gap:16px; flex-wrap:wrap; }
      .ai-ext-block { display:flex; flex-direction:column; gap:8px; min-width:180px; }
      .ai-ext-name { font-weight:800; font-size:.85rem; color:var(--accent-ink); }
      .ai-ext-block .btn { text-align:center; }
      a.btn.is-your-browser { outline:3px solid color-mix(in srgb, var(--accent) 45%, transparent); position:relative; }
      a.btn.is-your-browser::after {
        content:'הדפדפן שלך ✓';
        position:absolute; top:-10px; inset-inline-end:8px;
        background:var(--accent); color:#fff; font-size:.62rem; font-weight:800;
        padding:1px 8px; border-radius:999px;
      }
    </style>
    <script src="/admin-bridge.js"></script>
    <script src="/admin-ai-setup.js"></script>
  `;
  res.send(layout(html, 'חיבור AI', accentFor('ai-setup')));
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
    // A relay step carries no message either — it resumes a browser-provider
    // turn with the local model's output (see ai.js, browser-relay).
    const step = b.step && b.step.id
      ? { id: String(b.step.id), result: b.step.result }
      : null;
    if (!message && !approve && !step) return res.status(400).json({ ok: false, error: 'הודעה ריקה' });
    // The CONNECTED copilot gets its own briefing, not the paste-into-a-chat
    // roleplay pack: it arrived through the owner's API key, it is already
    // inside the CMS, and it is talking to the person who owns the site. Same
    // dictionary and same real media manifest — only the framing differs.
    const { buildCopilotBriefing } = require('../pzn/agent-roleplay');
    const media = require('../media').listAllMedia(40);
    let siteTitle = '';
    try { siteTitle = String(require('../config').loadConfig().title || ''); } catch (e) { /* unnamed site */ }
    // Situational awareness (v1.71, Ben: "grasp the situation of being the
    // helper in CMS… adding text to a selected item, help in the page
    // builder"). When the chat arrives FROM the builder it carries context:
    // which page is open and which module is selected — so "the selected
    // item" means that exact block, and edits target the open page.
    // v2.32 adds two facts the copilot PAGE knows: which surface the owner is
    // on (the builder drawer or the copilot screen with its own canvas) and
    // whether that canvas is blank — a blank canvas means "build", an open
    // page means "read it first, then edit".
    const ctx = b.context && typeof b.context === 'object' ? b.context : null;
    const surface = ctx && ctx.surface === 'copilot' ? 'copilot' : 'builder';
    const canvas = ctx && ctx.canvas === 'blank' ? 'blank' : (ctx && (ctx.canvas === 'page' || ctx.page) ? 'page' : undefined);
    let situation = '';
    if (ctx && ctx.page) {
      const pageSlug = String(ctx.page).slice(0, 200);
      situation = '\n\n---\n\n## המצב עכשיו — בעל/ת האתר בתוך בונה הדפים\n' +
        'הדף הפתוח בבונה: `' + pageSlug + '`. כשמבקשים ממך לערוך "את הדף" — זה הדף. ' +
        'השתמש/י ב-edit_page עם ה-slug הזה והחזר/י את המסמך המלא עם השינויים המבוקשים בלבד.\n';
      const sel = ctx.selected && typeof ctx.selected === 'object' ? ctx.selected : null;
      if (sel && sel.type) {
        situation += '\n**הפריט המסומן כרגע:** מודול `' + String(sel.type).slice(0, 40) + '`' +
          (sel.id ? ' (id: `' + String(sel.id).slice(0, 60) + '`)' : '') +
          (sel.text ? ' — הטקסט הנוכחי שלו: "' + String(sel.text).slice(0, 280) + '"' : '') +
          '. כשמבקשים "הוסף טקסט לפריט המסומן" או "שנה את זה" — הכוונה לבלוק הזה בדיוק, לא לדף אחר ולא לבלוק אחר.\n';
      }
    } else if (canvas === 'blank') {
      situation = '\n\n---\n\n## המצב עכשיו — בעל/ת האתר במסך הקופיילוט, הקנבס ריק\n' +
        'אין דף פתוח. כשמבקשים לבנות דף — create_page; כשמבקשים לערוך דף קיים — list_pages ואז read_page ואז edit_page.\n';
    }
    if (surface === 'copilot') {
      situation += '\nבעל/ת האתר רואה את הדף בקנבס לידך; כל הצעה שלך מוצגת לו/ה ברינדור אמיתי לפני האישור — לכן החזר/י תמיד מסמך שלם.';
    }
    // The door picks the TIER (full dictionary vs. one line per tool) from the
    // window it measured, so the route hands it a builder, not a string — the
    // same situation rides on whichever tier fits.
    const systemFor = (tier) => buildCopilotBriefing({ locale: 'he', media, siteTitle, tier, canvas }).text + situation;
    const out = await require('../ai').converse({
      systemFor,
      user: message,
      history: Array.isArray(b.history) ? b.history : [],
      approve,
      step,
      window: readWindowHint(b.window),
      context: ctx
    });
    res.json({
      ok: true,
      reply: out.reply || '',
      memo: out.memo || '',
      pending: out.pending || null,
      modelCall: out.modelCall || null,
      // the page's ceiling for the relayed call (admin-bridge.js drive reads
      // d.timeoutMs) — the local model's twenty minutes, never the page's guess
      ...(out.modelCall ? { timeoutMs: out.timeoutMs } : {}),
      applied: out.applied || null,
      used: out.used || [],
      reads: out.reads || [],
      window: out.window || null,
      notice: out.notice || '',
      truncated: !!out.truncated
    });
  } catch (e) {
    // the code and the fix ride with the message: the page prints the fix as
    // a second line (the click path in LM Studio), the code picks the bubble
    res.status(400).json({ ok: false, error: e.message, code: e.code || '', fix: e.fix || '' });
  }
});

// ─── /admin/chat — the copilot beside the builder (v2.32) ───────────────
// Ben: "we need to put pagebuilder also in the page of the builder he starts
// with empty canvas, we can choose with dropdown menu any of the current
// pages and see them with the chat opened, we shall make this update in
// realtime when we use the robot, it cannot be separated". So the screen is
// two columns: the chat (right, in RTL) and a CANVAS (left) — the REAL
// builder in an iframe (`/admin/edit/:path?embed=copilot`, routes/pages-
// builder.js), never a look-alike. A blank canvas is no iframe at all. The
// copilot's proposal is rendered through /admin/api/pzn/preview into a
// sandboxed frame ABOVE the canvas — it is never painted into the builder
// before the owner approves, because a proposal is not a draft yet.
// The settings card keeps every id it always had, folded under <details>.
router.get('/admin/chat', (req, res) => {
  const html = `
    ${adminNav('chat', 'קופיילוט — הדף נבנה לידכם')}
    <style>
      .chat-wrap { display:grid; grid-template-columns:minmax(340px,420px) minmax(0,1fr); gap:14px; height:calc(100vh - 110px); padding:12px 16px; box-sizing:border-box; }
      .chat-main { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:12px 14px; display:flex; flex-direction:column; min-height:0; }
      .chat-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding-bottom:8px; border-bottom:1px solid #e2e8f0; margin-bottom:8px; }
      .cp-chip { font-size:.74rem; background:#f1f5f9; color:#334155; border:1px solid #e2e8f0; border-radius:999px; padding:3px 10px; white-space:nowrap; cursor:default; }
      .cp-chip.is-full { background:#f0fdf4; color:#166534; border-color:#bbf7d0; }
      .cp-chip.is-compact { background:#fffbeb; color:#92400e; border-color:#fde68a; }
      .cp-chip.is-bad { background:#fef2f2; color:#991b1b; border-color:#fecaca; }
      #cp-new-chat { margin-inline-start:auto; }
      #chat-log { flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:10px; padding-bottom:12px; }
      .bubble { padding:11px 14px; border-radius:12px; max-width:92%; line-height:1.5; font-size:.92rem; }
      .bubble.system { background:#f1f5f9; color:#334155; align-self:center; text-align:center; font-size:.86rem; }
      .bubble.system.warn { background:#fffbeb; color:#92400e; border:1px solid #fde68a; }
      .bubble.system.danger { background:#fef2f2; color:#991b1b; border:1px solid #fecaca; }
      .bubble.system.clock { background:transparent; color:#64748b; font-size:.78rem; padding:2px 10px; }
      .bubble.system .fix { display:block; margin-top:6px; font-size:.8rem; opacity:.9; }
      .bubble.user { background:#0a66c2; color:#fff; align-self:flex-start; }
      .bubble.assistant { background:#fff7ed; border:1px solid #fed7aa; color:#7c2d12; align-self:flex-end; }
      .bubble .actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
      .bubble .act, .cp-proposal-actions .act { border:none; border-radius:8px; padding:7px 10px; cursor:pointer; font:600 12px system-ui; background:#e2e8f0; color:#0f172a; }
      .bubble .act.primary, .cp-proposal-actions .act.primary { background:#7c3aed; color:#fff; }
      .bubble .act:disabled, .cp-proposal-actions .act:disabled { opacity:.5; cursor:default; }
      .bubble .code { background:#0f172a; color:#e2e8f0; border-radius:8px; padding:8px; font:11px/1.4 ui-monospace,monospace; direction:ltr; text-align:left; white-space:pre-wrap; max-height:220px; overflow:auto; }
      .chat-compose { border-top:1px solid #e2e8f0; padding-top:10px; }
      .chat-compose textarea { width:100%; box-sizing:border-box; padding:10px; border:1px solid #cbd5e1; border-radius:8px; min-height:64px; font-size:.92rem; }
      .chat-compose textarea:disabled { background:#f8fafc; }
      .chat-compose .row { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; align-items:center; }
      #chat-settings { margin-top:10px; border-top:1px solid #e2e8f0; padding-top:8px; font-size:.9rem; }
      #chat-settings summary { cursor:pointer; color:#475569; font-size:.84rem; font-weight:600; list-style-position:inside; }
      #chat-settings .card { background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px; margin-top:10px; }
      #chat-settings .field { margin-bottom:10px; }
      #chat-settings label { display:block; font-size:.82rem; color:#475569; margin-bottom:4px; }
      #chat-settings input, #chat-settings select { width:100%; box-sizing:border-box; padding:8px; border:1px solid #cbd5e1; border-radius:8px; }
      .muted { color:#64748b; }
      /* the canvas column */
      .chat-stage { position:relative; display:flex; flex-direction:column; min-width:0; min-height:0; background:#fff; border:1px solid #e2e8f0; border-radius:14px; overflow:hidden; }
      .stage-bar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:8px 12px; border-bottom:1px solid #e2e8f0; background:#f8fafc; }
      .stage-bar select { min-width:220px; max-width:48%; padding:7px 9px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; font-size:.88rem; }
      .stage-bar .btn.sm { padding:6px 10px; font-size:.82rem; }
      .stage-bar a.cp-link { font-size:.82rem; color:#4338ca; white-space:nowrap; }
      .cp-working { font-size:.8rem; color:#7c3aed; font-weight:700; animation:cp-pulse 1.2s ease-in-out infinite; }
      @keyframes cp-pulse { 0%,100%{ opacity:.45 } 50%{ opacity:1 } }
      .cp-empty:not([hidden]) { flex:1; display:flex; align-items:center; justify-content:center; text-align:center; color:#64748b; padding:30px; line-height:1.8; font-size:.95rem; }
      .cp-empty .big { font-size:2.6rem; display:block; margin-bottom:6px; }
      #cp-canvas-frame { flex:1; width:100%; border:none; background:#fff; min-height:0; }
      /* the proposal — over the canvas, never in it */
      #cp-proposal:not([hidden]) { position:absolute; inset:0; z-index:5; display:flex; flex-direction:column; background:rgba(15,23,42,.72); backdrop-filter:blur(2px); }
      #cp-proposal .rsp-bar { flex-wrap:wrap; }
      #cp-proposal .rsp-what { font-weight:600; color:#7c2d12; background:#fff7ed; border:1px solid #fed7aa; border-radius:999px; padding:2px 10px; font-size:.8rem; }
      #cp-proposal .cp-proposal-actions { margin-inline-start:auto; display:flex; gap:8px; }
      #cp-proposal .rsp-stage { padding:14px; }
      #cp-proposal .rsp-frame { width:100%; min-height:0; height:100%; }
      #cp-proposal .rsp-frame iframe { height:100%; min-height:400px; }
      #cp-proposal-error { margin:0 14px 14px; background:#fef2f2; color:#991b1b; border:1px solid #fecaca; border-radius:10px; padding:10px 12px; font-size:.85rem; white-space:pre-wrap; }
      /* Provider choice as RADIOS (v1.70, Ben). An option that is not ready is
         toned down — still clickable (picking it is HOW you configure it),
         but honest about not working yet. */
      .provider-radios { display:flex; flex-direction:column; gap:6px; }
      .provider-radio { display:flex; align-items:center; gap:8px; padding:7px 10px; border:1px solid #e2e8f0; border-radius:8px; cursor:pointer; font-size:.88rem; background:#fff; }
      .provider-radio input { width:auto; margin:0; }
      .provider-radio .pr-chip { margin-inline-start:auto; font-size:.72rem; color:#059669; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:999px; padding:2px 8px; white-space:nowrap; }
      .provider-radio.is-off { opacity:.55; }
      .provider-radio.is-off .pr-chip { color:#92400e; background:#fffbeb; border-color:#fde68a; }
      .provider-radio:has(input:checked) { border-color:#7c3aed; background:#f5f3ff; opacity:1; }
      /* one pane at a time on a phone */
      #cp-tabs { display:none; }
      @media(max-width:900px){
        .chat-wrap { grid-template-columns:1fr; height:auto; min-height:calc(100vh - 110px); }
        #cp-tabs { display:flex; gap:6px; padding:8px 16px 0; }
        #cp-tabs button { flex:1; border:1px solid #e2e8f0; background:#fff; border-radius:8px; padding:8px; font:600 .86rem system-ui; cursor:pointer; }
        #cp-tabs button.active { background:#7c3aed; color:#fff; border-color:#7c3aed; }
        .chat-wrap.tab-chat .chat-stage { display:none; }
        .chat-wrap.tab-canvas .chat-main { display:none; }
        .chat-main { min-height:calc(100vh - 170px); }
        .chat-stage { min-height:calc(100vh - 170px); }
        .stage-bar select { max-width:100%; }
      }
    </style>
    <div id="cp-tabs">
      <button type="button" data-tab="chat" class="active">💬 צ׳אט</button>
      <button type="button" data-tab="canvas">🖼 קנבס</button>
    </div>
    <div class="chat-wrap tab-chat" id="chat-wrap">
      <div class="chat-main">
        <div class="chat-head">
          <span id="cp-window" class="cp-chip" title="בודק את חלון המודל…">חלון —</span>
          <button type="button" class="btn sm secondary" id="cp-new-chat" title="מנקה את השיחה בלבד — הקנבס נשאר">🆕 שיחה חדשה</button>
        </div>
        <div id="chat-log"></div>
        <div class="chat-compose">
          <textarea id="chat-input" placeholder="תארו את הדף שאתם רוצים, או בקשו שינוי בדף שבקנבס… (Ctrl+Enter לשליחה)"></textarea>
          <div class="row">
            <button type="button" class="btn" id="btn-send">שלח</button>
            <span id="chat-status" class="muted" style="font-size:.85rem"></span>
          </div>
        </div>
        <details id="chat-settings">
          <summary>⚙ החיבור — ספק, מודל, מפתח</summary>
          <div class="card">
            <p class="muted" style="font-size:.82rem;margin:0 0 10px">הצ׳אט קורא ל‑API הרשמי של הספק מהשרת שלכם, עם המפתח שלכם. המפתח נשמר בשרת בלבד (קובץ מוגן, מחוץ ל‑git) ולעולם לא נשלח לדפדפן.</p>
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
            <div style="font-weight:700;font-size:.86rem;margin-bottom:6px">בלי מפתח? יש מסלול</div>
            <ul class="muted" style="font-size:.84rem;line-height:1.7;padding-inline-start:18px;margin:0">
              <li><a href="/admin/ai-setup">חיבור AI</a> — מודל מקומי, מפתח ענן או תוסף Bridge V2, במסך אחד</li>
              <li><a href="/admin/inject">מילון · משחק</a> — הדביקו את החבילה בצ׳אט שאתם כבר מנויים עליו</li>
              <li><a href="/admin/ai">הדבקה ידנית</a> — הדביקו תשובת AI ובנו דף בתוך ה‑CMS</li>
              <li><a href="/admin/agent">גשר סוכן</a> — התוסף (ללא מפתח) עובד על הצ׳אט הפתוח שלכם</li>
            </ul>
          </div>
        </details>
      </div>
      <div class="chat-stage">
        <div class="stage-bar">
          <select id="cp-page-select" title="איזה דף פתוח בקנבס">
            <option value="">— קנבס ריק —</option>
          </select>
          <button type="button" class="btn sm secondary" id="btn-stage-preview" title="הרינדור האמיתי של הטיוטה — בנייד, בטאבלט ובמחשב" disabled>👁 תצוגה חיה</button>
          <a id="cp-open-full" class="cp-link" href="/admin/new" data-nav-full hidden>פתחו בבונה המלא ↗</a>
          <span id="cp-working" class="cp-working" hidden>✍️ הקופיילוט עובד על הדף…</span>
        </div>
        <div id="cp-canvas-empty" class="cp-empty">
          <div><span class="big">🖼</span>הקנבס ריק. בחרו דף מהרשימה למעלה — או תארו לקופיילוט דף חדש, והוא יופיע כאן לפני האישור ואחריו.</div>
        </div>
        <iframe id="cp-canvas-frame" title="בונה הדפים" hidden></iframe>
        <div id="cp-proposal" hidden>
          <div class="rsp-bar">
            <strong>הצעת הקופיילוט — עדיין לא נשמרה</strong>
            <span class="rsp-what" id="cp-proposal-what"></span>
            <span class="rsp-devices">
              <button type="button" data-rsp="375">📱 נייד <small>375</small></button>
              <button type="button" data-rsp="768">📱 טאבלט <small>768</small></button>
              <button type="button" data-rsp="1024">💻 מחשב <small>1024</small></button>
              <button type="button" data-rsp="full" class="active">🖥 מלא</button>
            </span>
            <span class="cp-proposal-actions">
              <button type="button" class="act primary" data-ok="1">✓ אשר</button>
              <button type="button" class="act" data-ok="0">✕ לא עכשיו</button>
              <button type="button" class="act" data-close="1" hidden>סגור</button>
            </span>
          </div>
          <div class="rsp-stage"><div class="rsp-frame"><iframe id="cp-proposal-frame" sandbox="allow-same-origin" title="תצוגת ההצעה"></iframe></div></div>
          <div id="cp-proposal-error" hidden></div>
        </div>
      </div>
    </div>
    <script src="/admin-bridge.js"></script>
    <script src="/admin-turn-clock.js"></script>
    <script src="/admin-chat.js"></script>
  `;
  res.send(layout(html, 'קופיילוט', accentFor('chat')));
});

module.exports = router;
