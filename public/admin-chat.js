/* /admin/chat — the copilot beside the builder (v0.85 → v2.32).
   The user's LLM key lives in the CMS (or the model lives on their machine,
   reached directly or through the Bridge V2 extension); the chat calls the
   provider from the server, speaks BenTML, and every write stops at an
   approval card and lands as a DRAFT.

   v2.32 (Ben: "put pagebuilder also in the page… choose with dropdown menu
   any of the current pages… update in realtime when we use the robot, it
   cannot be separated"): the page carries a CANVAS — the real builder in an
   iframe (`/admin/edit/:path?embed=copilot`). Blank canvas = no iframe. A
   proposal is rendered through /admin/api/pzn/preview into a sandboxed frame
   OVER the canvas, never into it: until the owner approves, it is not a
   draft and must not look like one. This file never saves, never publishes —
   the builder inside the frame saves its own draft, the door writes the
   approved one (a smoke pins the absence of those routes here).

   Also v2.32 — the window. The model's context is measured before a send
   (GET /admin/api/ai/window) and after every turn (d.window), the chip says
   which tier the copilot runs in, and an error carries a `fix` line with the
   LM Studio click path. Reply hygiene: an empty reply is never pushed into
   history (that was the "2 turns to get an unrelated answer"); the server's
   `memo` stands in for it.

   v2.43 (Ben: "i want the copilot to show canvas of the menu when needed"):
   the canvas has a THIRD state beside blank and page — the site's MENU. The
   dropdown's "🧭 תפריט האתר" entry opens it; so does the robot, when it
   reads the menus into an empty canvas or proposes a new one. It shows the
   organizer's tree and fit line over the REAL header in a frame
   (GET /admin/api/menus/state → /admin/menus/preview/:id). A menu proposal
   rides the same overlay a page proposal does, with what the DOOR judged —
   moved / added / removed / renamed, the fit line, the warnings — drawn by
   the injection card's own renderPreview (one renderer, two screens), and
   the candidate header framed under it. One thing differs and the page says
   so in words: an approved menu is LIVE, not a draft — so the line that
   follows the apply carries the ↩ undo (POST /admin/api/menus/restore, the
   owner's own click; the copilot has no such tool). */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const log = $('chat-log');
  const input = $('chat-input');
  const HISTORY_CAP = 40; // turns kept client-side; the server fits them to the window
  const history = []; // [{role, content}] — sent with each turn
  let usedShown = 0;  // how many entries of the turn's `used` ledger were already shown
  const REPLY_CUT = 'התשובה נחתכה באמצע — המודל הגיע לסוף החלון. הגדילו את Context Length ב-LM Studio, או בקשו דף קצר יותר.';
  const BRIDGE_MIN = '0.5.0'; // tools (read/create/edit) need the bridge that forwards tool calls

  let providers = [];
  let settings = { provider: 'claude', model: '', hasKey: false, keyTail: '', keyTails: {} };
  /** v2.52 — the key on file for THIS supplier (its last four characters), or ''. Keys are kept per supplier:
   *  before, one stored key was sent to whichever supplier was picked next. */
  const tailOf = (p) => ((settings.keyTails || {})[p && p.id]) || '';
  let sessionUsd = 0; // what the suppliers billed for this conversation, by the turns' own estimates
  let pages = []; // the dropdown's source of truth (GET /admin/api/pages)
  let loadedPath = ''; // the page in the canvas ('' = blank OR the menu — see menuOpen)
  // v2.43 — the canvas's third state. MENU_KEY is the dropdown's value for it.
  // The colons are the point: deriveSlug (src/pzn/intent.js) strips `:` from
  // every page path, so no page can ever carry this value — `__menu__` could
  // (underscores survive), and a page by that name would have hijacked it.
  const MENU_KEY = '::menu::';
  let menuOpen = false; // the site's menu is in the canvas (loadedPath stays '')
  // A window too small to answer a menu read does not get the menu tools at
  // all (src/ai.js pickCopilotTier — an 8,192 window keeps v2.42's bytes).
  // The owner is told ONCE, where it matters: with the menu open, or when
  // they ask about it. Never silently — a robot that "cannot" without saying
  // why looks broken.
  let menuToolsOff = false;
  let menuToolsNoted = false;
  function noteMenuToolsOff() {
    if (!menuToolsOff || menuToolsNoted) return;
    if (!menuOpen && !/תפריט|menu/i.test(lastUserMessage)) return;
    menuToolsNoted = true;
    bubble('system',
      'החלון של המודל קטן מדי לכלי התפריט — הקופיילוט יכול להציע סדר במילים, אבל לא לקרוא או לשנות את התפריט. ' +
      'הגדילו את Context Length ל-32768 ב-LM Studio, או סדרו ב<a href="/admin/menus">עורך התפריטים</a>.', 'warn');
  }
  let inflight = false; // ONE turn per page — composer, send and approvals lock
  let openProposal = null; // { pending, card } while an approval card waits
  let unloadArmed = false;

  // Bridge V2 (extension-v2a) — shared glue lives in /admin-bridge.js;
  // this page only reacts to its presence/model/window events.
  const bridge = window.TapuzBridge || {
    present: false, models: [], version: '', window: null,
    call: () => Promise.reject(new Error('אין גשר')), drive: (d) => Promise.resolve(d)
  };
  // the bridge glue may have finished probing BEFORE this script ran (a fast
  // local box: hello → /v1/models → /api/v0/models all land while the
  // settings fetch is still in flight) — its `windowSettled` flag says so,
  // and a null window that has settled (an old extension) counts as settled
  let bridgeWindowSettled = !!(bridge.window || bridge.windowSettled);
  document.addEventListener('tapuz-bridge-hello', () => { if (providers.length) renderSettings(); });
  document.addEventListener('tapuz-bridge-models', () => { if (currentProvider().browserRelay) syncProviderUI(); });
  document.addEventListener('tapuz-bridge-window', () => {
    bridgeWindowSettled = true;
    if (savedProvider().browserRelay) refreshWindow();
  });

  async function api(path, opts = {}) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok || (data && data.ok === false)) {
      // the door's error carries a code and a fix line — keep both on the Error
      const err = new Error((data && data.error) || res.statusText);
      err.code = (data && data.code) || '';
      err.fix = (data && data.fix) || '';
      err.issues = (data && data.issues) || null;
      throw err;
    }
    return data;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  function bubble(role, html, extraClass) {
    const div = document.createElement('div');
    div.className = 'bubble ' + role + (extraClass ? ' ' + extraClass : '');
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  /** An error as the door reported it: the message, then the fix (the click
   *  path in LM Studio) as a second line when there is one. */
  function errorBubble(e) {
    const fix = e && e.fix ? '<span class="fix">' + esc(e.fix) + '</span>' : '';
    return bubble('system', 'שגיאה: ' + esc(e && e.message ? e.message : e) + fix, 'danger');
  }

  function setStatus(msg) {
    const el = $('chat-status');
    if (el) el.textContent = msg || '';
  }

  /** Lock the page while a turn is in flight: the composer, the send button,
   *  every approval button, and the canvas toolbar's pulsing line. */
  function setInflight(v, note) {
    inflight = v;
    input.disabled = v;
    $('btn-send').disabled = v;
    $('cp-new-chat').disabled = v;
    $('cp-page-select').disabled = v;
    const working = $('cp-working');
    if (working) working.hidden = !v;
    // only the OPEN proposal's buttons follow the lock — answered cards stay
    // disabled for good
    const gates = openProposal ? Array.from(openProposal.card.querySelectorAll('[data-ok]')) : [];
    gates.concat(Array.from(proposal.querySelectorAll('[data-ok]'))).forEach((b) => { b.disabled = v || !openProposal; });
    setStatus(v ? (note || 'חושב…') : '');
    armUnload();
  }

  /** A turn in flight or a proposal waiting = something the owner would lose
   *  by closing the tab. */
  function armUnload() {
    const want = inflight || !!openProposal;
    if (want === unloadArmed) return;
    unloadArmed = want;
    if (want) window.addEventListener('beforeunload', onUnload);
    else window.removeEventListener('beforeunload', onUnload);
  }
  function onUnload(e) {
    e.preventDefault();
    e.returnValue = '';
  }

  /* ── history hygiene (§0.7) ── */

  /** Push a turn only when it says something. An empty assistant turn in the
   *  history is what made the model answer the wrong question. */
  function remember(role, content) {
    const text = String(content == null ? '' : content).trim();
    if (!text) return;
    history.push({ role, content: text });
    while (history.length > HISTORY_CAP) history.shift();
  }

  /* ── settings card ── */

  function currentProvider() {
    const checked = document.querySelector('input[name="ai-provider"]:checked');
    return providers.find((x) => x.id === (checked && checked.value)) || providers[0] || {};
  }

  function fillModels() {
    const p = currentProvider();
    const sel = $('ai-model');
    // A local runtime serves whatever model it has loaded, so its name is a
    // free-text field, not a list we could possibly know ahead of time.
    if (p.openModel) {
      sel.innerHTML = '';
      sel.hidden = true;
      $('ai-model-free').hidden = false;
      $('ai-model-free').value = settings.model || '';
      // the bridge reports what LM Studio actually has loaded — offer it
      $('ai-model-free').placeholder = (p.browserRelay && bridge.models[0])
        ? bridge.models[0] + ' · זוהה מהתוסף (ריק = אוטומטי)'
        : (p.defaultModel || 'שם המודל שטעון');
      return;
    }
    sel.hidden = false;
    $('ai-model-free').hidden = true;
    sel.innerHTML = (p.models || []).map((m) =>
      '<option value="' + esc(m) + '"' + (m === settings.model ? ' selected' : '') + '>' + esc(m) + '</option>'
    ).join('');
  }

  /** Everything that depends on WHICH provider is selected right now. Split
   *  out of renderSettings because picking a provider must update the whole
   *  card immediately — rebuilding the <select> here would snap the choice
   *  back to the saved one before the user has saved it. */
  function syncProviderUI() {
    fillModels();
    const p = currentProvider();
    // The base-URL row belongs to the local provider alone; the public ones
    // have a fixed endpoint the server will not let anyone repoint.
    $('ai-local-row').hidden = !p.baseUrlDefault;
    $('ai-base').value = settings.baseUrl || '';
    $('ai-base').placeholder = p.baseUrlDefault || '';
    $('ai-key-state').textContent = p.browserRelay
      ? '· לא נדרש — המודל אצלכם, דרך התוסף'
      : p.keyOptional
        ? '· לרוב לא נדרש למודל מקומי'
        : (tailOf(p) ? '· מוגדר (…' + tailOf(p) + ')' : '· לא מוגדר לספק הזה');
    $('ai-key').placeholder = tailOf(p)
      ? 'להחלפה — הדביקו מפתח חדש'
      : (p.keyHint || 'sk-…');
  }

  function renderSettings() {
    // Radios, not a <select> (v1.70): each provider row carries its readiness.
    // "Ready" = local runtime (no key needed) or the saved provider with its
    // key. Not-ready rows are toned down (.is-off) but stay clickable —
    // choosing one is exactly how you get to configure it.
    const box = $('ai-provider-radios');
    box.innerHTML = providers.map((p) => {
      // browser-relay readiness = the extension announced itself on THIS page;
      // everything else keeps the key/local rule.
      const ready = p.browserRelay
        ? bridge.present
        : (p.keyOptional || !!tailOf(p));
      const chip = p.browserRelay
        ? (bridge.present ? 'תוסף מחובר ✓' : 'דורש את תוסף Bridge V2')
        : p.keyOptional
          ? 'מקומי · ללא מפתח'
          : (ready ? 'מוגדר ✓' : 'דורש מפתח');
      return '<label class="provider-radio' + (ready ? '' : ' is-off') + '">' +
        '<input type="radio" name="ai-provider" value="' + esc(p.id) + '"' +
        (p.id === settings.provider ? ' checked' : '') + '>' +
        '<span class="pr-label">' + esc(p.label) + '</span>' +
        '<span class="pr-chip">' + chip + '</span></label>';
    }).join('');
    syncProviderUI();
  }

  async function saveSettings() {
    const p = currentProvider();
    const body = {
      provider: p.id,
      model: p.openModel ? $('ai-model-free').value.trim() : $('ai-model').value
    };
    if (p.baseUrlDefault) body.baseUrl = $('ai-base').value.trim();
    const key = $('ai-key').value.trim();
    if (key) body.apiKey = key; // empty field = keep the stored key
    $('ai-settings-status').textContent = 'שומר…';
    try {
      const d = await api('/admin/api/ai/settings', { method: 'POST', body: JSON.stringify(body) });
      settings = d;
      $('ai-key').value = '';
      renderSettings();
      $('ai-settings-status').textContent = 'נשמר ✓';
      // a local runtime needs no key, so the chat is ready the moment it is picked
      if (d.hasKey || currentProvider().keyOptional) { welcome(true); refreshWindow(); }
    } catch (e) {
      $('ai-settings-status').textContent = 'שגיאה: ' + e.message;
    }
  }

  /* ── the window chip ── */

  function savedProvider() {
    return providers.find((x) => x.id === settings.provider) || {};
  }

  /** The bridge's own reading of LM Studio's loaded window (bridge 0.5.0
   *  probes /api/v0/models on hello). Only the browser courier has one — the
   *  server probes for the local provider itself. */
  function windowHint() {
    if (!savedProvider().browserRelay) return null;
    const w = bridge.window;
    return w && w.tokens ? {
      tokens: w.tokens, maxTokens: w.maxTokens || null, model: w.model || '',
      source: 'bridge', bridgeVersion: w.bridgeVersion || bridge.version || ''
    } : null;
  }

  /** The first turn waits (up to `ms`) for the bridge to finish probing, so
   *  the send carries the hint instead of racing it. */
  function awaitBridgeWindow(ms) {
    if (!savedProvider().browserRelay || bridgeWindowSettled || !bridge.present) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { clearTimeout(t); document.removeEventListener('tapuz-bridge-window', done); resolve(); };
      const t = setTimeout(done, ms);
      document.addEventListener('tapuz-bridge-window', done);
    });
  }

  function versionLt(a, b) {
    const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
    const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
    }
    return false;
  }

  function setChip(w, extra) {
    const chip = $('cp-window');
    if (!chip) return;
    chip.classList.remove('is-full', 'is-compact', 'is-bad');
    if (!w) { chip.textContent = 'חלון —'; chip.title = 'עוד לא נמדד'; return; }
    const tierHe = w.tier === 'full' ? 'מלא' : w.tier === 'compact' ? 'מקוצר' : 'קטן מדי';
    // a cloud key has no window (∞); a local model whose window could not be
    // read is a question mark, never a promise
    const tokens = w.tokens ? fmt(w.tokens) : (w.tier === 'full' ? '∞' : '?');
    let text = 'חלון ' + tokens + ' · ' + tierHe;
    if (w.promptTokens) text += ' · הפנייה האחרונה ' + fmt(w.promptTokens) + ' טוקנים';
    chip.textContent = text;
    chip.title = (extra || w.message || '') + (w.model ? '\n' + w.model : '');
    chip.classList.add(w.tier === 'full' ? 'is-full' : w.tier === 'compact' ? 'is-compact' : 'is-bad');
  }

  let lastWindowMessage = '';

  /** GET /admin/api/ai/window → the welcome sentence + the chip. The browser
   *  courier passes its hint in the query; the server probes for local. */
  async function refreshWindow() {
    const p = savedProvider();
    if (!(settings.hasKey || p.keyOptional)) { setChip(null); return; }
    if (p.browserRelay && !bridge.present) { setChip(null); return; }
    const hint = windowHint();
    const q = hint ? '?' + new URLSearchParams({
      tokens: hint.tokens, maxTokens: hint.maxTokens || '', model: hint.model, source: 'bridge', bridgeVersion: hint.bridgeVersion
    }).toString() : '';
    try {
      const d = await api('/admin/api/ai/window' + q);
      setChip({ tokens: d.window && d.window.tokens, tier: d.tier, model: d.model, message: d.message });
      menuToolsOff = d.menuTools === false && !!d.tier; // (no tier at all is the chip's own, louder story)
      noteMenuToolsOff();
      if (d.message && d.message !== lastWindowMessage) {
        lastWindowMessage = d.message;
        bubble('system', esc(d.message), d.tier === 'full' ? '' : d.tier === 'compact' ? 'warn' : 'danger');
      }
    } catch (e) {
      setChip(null);
    }
  }

  /* ── welcome ── */

  let bridgeWarned = false;
  function welcome(fresh) {
    if (fresh) { log.innerHTML = ''; lastWindowMessage = ''; bridgeWarned = false; }
    const p = savedProvider();
    if (p.browserRelay) {
      bubble('system', bridge.present
        ? 'הקופיילוט מחובר למודל המקומי דרך הדפדפן ✓ שום דבר לא עוזב את המחשב שלכם.'
        : 'הספק הנבחר עובד דרך תוסף Bridge V2 — פתחו את התוסף ולחצו "חבר את האתר הפתוח".');
      warnOldBridge();
    } else if (settings.hasKey || p.keyOptional) {
      bubble('system', 'הקופיילוט מחובר ✓ תארו דף — והוא ייבנה כטיוטה בלחיצה. המפתח שלכם נשאר בשרת.');
    } else {
      bubble('system', 'עוד אין מפתח API. הגדירו אותו למטה (נשמר בשרת בלבד) — או השתמשו במסלולים ללא מפתח.');
    }
  }

  /** A bridge older than 0.5.0 drops the model's tool calls on the way (the
   *  0.4.0 signature) — plain chat works, reading/editing pages does not. */
  function warnOldBridge() {
    if (bridgeWarned || !bridge.present) return;
    if (!versionLt(bridge.version || '0', BRIDGE_MIN)) return;
    bridgeWarned = true;
    bubble('system',
      'התוסף Bridge V2 ' + esc(bridge.version || '(גרסה לא ידועה)') +
      ' — לכלים (קריאת דפים, יצירה, עריכה) צריך ' + BRIDGE_MIN + ': הורידו מ<a href="/admin/ai-setup">חיבור AI</a> וטענו מחדש.',
      'warn');
  }

  /* ── the canvas: the real builder, in a frame ── */

  const frame = $('cp-canvas-frame');
  const select = $('cp-page-select');

  function builder() {
    try { return loadedPath && frame.contentWindow && frame.contentWindow.TapuzBuilder || null; }
    catch (e) { return null; }
  }

  /** The dropdown: every page, drafts and published apart, each line saying
   *  what it is and whether it carries unpublished changes. */
  async function loadPages(keep) {
    try {
      const d = await api('/admin/api/pages');
      pages = d.pages || [];
    } catch (e) { pages = []; }
    const line = (p) => esc(p.title || p.full_path) + ' · /' + esc(p.full_path) + ' · ' +
      (p.status === 'published' ? 'פורסם' : 'טיוטה') + (p.has_unpublished ? ' • שינויים' : '');
    const opt = (p) => '<option value="' + esc(p.full_path) + '">' + line(p) + '</option>';
    const drafts = pages.filter((p) => p.status !== 'published');
    const published = pages.filter((p) => p.status === 'published');
    // the menu sits beside the pages (v2.43): it is the one thing on the site
    // the copilot edits that is not a page
    select.innerHTML = '<option value="">— קנבס ריק —</option>' +
      '<option value="' + MENU_KEY + '">🧭 תפריט האתר</option>' +
      (drafts.length ? '<optgroup label="טיוטות">' + drafts.map(opt).join('') + '</optgroup>' : '') +
      (published.length ? '<optgroup label="פורסמו">' + published.map(opt).join('') + '</optgroup>' : '');
    const want = menuOpen ? MENU_KEY : (keep != null ? keep : loadedPath);
    select.value = want;
    if (select.value !== want) select.value = ''; // the page is gone — the canvas says so
  }

  /** Put a page in the canvas, or the site's menu (MENU_KEY), or clear it.
   *  The URL follows, so a reload or a shared link lands on the same canvas. */
  function selectPage(fullPath, opts = {}) {
    const want = String(fullPath || '');
    menuOpen = want === MENU_KEY;
    loadedPath = menuOpen ? '' : want;
    const empty = $('cp-canvas-empty');
    const open = $('cp-open-full');
    const prev = $('btn-stage-preview');
    const menuCanvas = $('cp-menu-canvas');
    menuCanvas.hidden = !menuOpen;
    if (!menuOpen) $('cp-menu-frame').removeAttribute('src');
    if (menuOpen) {
      // no builder here: the menu's editor is /admin/menus, and 👁 is the
      // builder's own device preview — the framed header IS the live view
      frame.hidden = true;
      frame.removeAttribute('src');
      empty.hidden = true;
      open.href = '/admin/menus';
      open.textContent = 'פתחו בעורך התפריטים ↗';
      open.hidden = false;
      prev.disabled = true;
      loadMenuCanvas();
      noteMenuToolsOff(); // the canvas still SHOWS the menu; the robot just cannot touch it here
    } else if (!loadedPath) {
      frame.hidden = true;
      frame.removeAttribute('src');
      empty.hidden = false;
      open.hidden = true;
      prev.disabled = true;
    } else {
      frame.src = '/admin/edit/' + encodeURIComponent(loadedPath) + '?embed=copilot';
      frame.hidden = false;
      empty.hidden = true;
      open.href = '/admin/edit/' + encodeURIComponent(loadedPath);
      open.textContent = 'פתחו בבונה המלא ↗';
      open.hidden = false;
      prev.disabled = false;
    }
    if (select.value !== want) select.value = want;
    if (!opts.keepUrl) {
      const u = new URL(location.href);
      if (loadedPath) u.searchParams.set('page', loadedPath); else u.searchParams.delete('page');
      if (menuOpen) u.searchParams.set('canvas', 'menu'); else u.searchParams.delete('canvas');
      replaceUrl(u);
    }
  }

  /* ── the menu canvas (v2.43): today's menu, as the organizer sees it ── */

  /** The organizer's preview without its own frame — this page frames the
   *  header itself (the canvas fills the pane; a proposal gets the device
   *  widths). Drawn by the injection card's renderer: textContent only, so a
   *  label a model wrote can never become markup here. */
  function drawMenuPreview(box, preview) {
    const p = Object.assign({}, preview || {}, { previewUrl: '', previewHtml: '' });
    if (window.TapuzInjectCard && typeof window.TapuzInjectCard.renderPreview === 'function') {
      window.TapuzInjectCard.renderPreview(box, p);
    } else {
      // the renderer did not load: the fit line alone is still the truth
      box.textContent = p.fitLine || '';
    }
  }

  let menuLoadSeq = 0;
  /** GET /admin/api/menus/state → the tree + the fit line + the real header
   *  in the frame. Called on select, after an apply and after an undo. */
  async function loadMenuCanvas() {
    const seq = ++menuLoadSeq;
    const status = $('cp-menu-status');
    status.textContent = 'טוען…';
    try {
      const d = await api('/admin/api/menus/state');
      if (seq !== menuLoadSeq || !menuOpen) return; // the owner moved on
      drawMenuPreview($('cp-menu-preview'), d.preview);
      // a fresh preview id every load — so the frame can never show a stale menu
      $('cp-menu-frame').src = (d.preview && d.preview.previewUrl) || '/admin/menus/preview/live';
      status.textContent = '';
    } catch (e) {
      if (seq !== menuLoadSeq) return;
      status.textContent = 'לא הצלחתי לטעון את התפריט: ' + (e.message || e);
    }
  }
  function replaceUrl(u) {
    try { window.history.replaceState(null, '', u.pathname + u.search); } catch (e) { /* sandboxed preview */ }
  }

  /** The builder autosaves on its own clock; before the copilot reads or
   *  edits, the draft on disk must be what the owner sees — so save first. */
  async function saveCanvas() {
    const b = builder();
    if (!b || typeof b.savePage !== 'function') return;
    try { await b.savePage({ silent: true }); } catch (e) { /* view-only or mid-load */ }
  }

  /** The draft changed on disk — the embedded builder reloads to show it.
   *  (The menu canvas refetches instead: there is no builder to reload.) */
  function reloadCanvas() {
    if (menuOpen) { loadMenuCanvas(); return; }
    if (!loadedPath) return;
    try { frame.contentWindow.location.reload(); }
    catch (e) { frame.src = frame.getAttribute('src'); }
  }

  function selectedInfo() {
    try {
      const b = builder();
      const blk = b && b._getSelected && b._getSelected();
      if (!blk) return null;
      const d = blk.data || {};
      const text = String(d.text || d.title || d.heading || d.content || '').replace(/<[^>]+>/g, '').slice(0, 280);
      return { id: blk.id || '', type: blk.type || '', text };
    } catch (e) { return null; }
  }

  /** What the copilot is told about where the owner stands. */
  function pageContext() {
    // 'menu' (v2.43): with the menu in the canvas, "סדר את זה" means the menu
    const ctx = { canvas: menuOpen ? 'menu' : (loadedPath ? 'page' : 'blank'), surface: 'copilot' };
    if (loadedPath) {
      ctx.page = loadedPath;
      const sel = selectedInfo();
      if (sel) ctx.selected = sel;
    }
    return ctx;
  }

  /* ── the proposal frame: the copilot's document, rendered, before the gate ── */

  const proposal = $('cp-proposal');
  const proposalFrame = $('cp-proposal-frame');

  /** Show a document over the canvas. `what` names it; `answerable` keeps
   *  the approve/refuse pair (a pending) or swaps it for a close button (a
   *  document the reply merely carried — the 🪄 button in the bubble creates
   *  it). Rendering is the CMS's own compiler (/admin/api/pzn/preview): what
   *  the owner sees is what approval would save. */
  async function showProposal(source, what, answerable) {
    proposal.hidden = false;
    $('cp-proposal-what').textContent = what || '';
    $('cp-proposal-error').hidden = true;
    $('cp-proposal-menu').hidden = true; // a page proposal carries no menu strip
    proposal.querySelectorAll('[data-ok]').forEach((b) => { b.hidden = !answerable; b.disabled = inflight; });
    proposal.querySelector('[data-close]').hidden = !!answerable;
    proposalFrame.removeAttribute('src');
    proposalFrame.removeAttribute('srcdoc');
    armUnload();
    try {
      const d = await api('/admin/api/pzn/preview', { method: 'POST', body: JSON.stringify({ source }) });
      proposalFrame.srcdoc = d.html || '';
    } catch (e) {
      const box = $('cp-proposal-error');
      const issues = (e.issues || []).map((i) => '• ' + (i.code ? i.code + ': ' : '') + (i.message || '')).join('\n');
      box.textContent = 'הקופיילוט הציע מסמך שלא עובר את הבדיקה — דחו ובקשו תיקון\n' + e.message + (issues ? '\n' + issues : '');
      box.hidden = false;
    }
  }

  /** A MENU proposal (v2.43), over the canvas like a page proposal — never in
   *  it. Nothing is parsed here: `p.preview` is what the organizer's door
   *  judged on the server (the tool loop's preflight), so the owner approves
   *  the very plan that will be applied — what moved, what was added,
   *  removed or renamed, the fit line, the knob changes — and sees it on the
   *  real header, framed at the device width they pick. `src`, not `srcdoc`:
   *  the candidate is rendered by GET /admin/menus/preview/:id. Same sandbox
   *  as the page proposal (no scripts; a published page ships none).
   *  `answerable` false = the weaker mode (see previewMenuReply): a document
   *  the reply merely carried — shown, closable, and NOT approvable here. */
  function showMenuProposal(p, answerable) {
    const preview = p.preview || {};
    proposal.hidden = false;
    $('cp-proposal-what').textContent = answerable ? proposalTitle(p) : 'תפריט מהתשובה — להחלה: מסדר/ת התפריטים בעורך התפריטים';
    $('cp-proposal-error').hidden = true;
    proposal.querySelectorAll('[data-ok]').forEach((b) => { b.hidden = !answerable; b.disabled = inflight; });
    proposal.querySelector('[data-close]').hidden = !!answerable;
    drawMenuPreview($('cp-proposal-menu-preview'), preview);
    const warn = $('cp-proposal-menu-warn');
    warn.textContent = '';
    (p.warnings || []).forEach((t) => {
      const li = document.createElement('li');
      li.textContent = String(t);
      warn.appendChild(li);
    });
    warn.hidden = !(p.warnings || []).length;
    // "approval applies this to the LIVE site" is only true where there IS an approval
    proposal.querySelector('.cp-menu-live').hidden = !answerable;
    $('cp-proposal-menu').hidden = false;
    proposalFrame.removeAttribute('srcdoc'); // srcdoc wins over src — it must go first
    if (preview.previewUrl) proposalFrame.src = String(preview.previewUrl);
    else proposalFrame.removeAttribute('src');
    armUnload();
  }

  function hideProposal() {
    proposal.hidden = true;
    proposalFrame.removeAttribute('src');
    proposalFrame.removeAttribute('srcdoc');
    $('cp-proposal-menu').hidden = true;
    armUnload();
  }

  function proposalTitle(p) {
    const inp = p.input || {};
    if (p.tool === 'organize_menu') return 'סידור התפריט — על הכותרת האמיתית של האתר';
    if (p.tool === 'create_page') {
      const m = /<title>([^<]*)<\/title>/i.exec(String(inp.source || ''));
      return 'דף חדש: "' + ((inp.title || (m && m[1]) || '').trim() || 'ללא כותרת') + '"';
    }
    if (p.tool === 'edit_page') return 'עריכת "' + (inp.slug || loadedPath || '') + '"';
    return p.summary || '';
  }

  /* ── one assistant turn on the screen ── */

  /** What it said, what it looked at, and — if it wants to WRITE — the
   *  approval gate. The server has already stopped short of doing anything;
   *  this is the only thing that lets it through. */
  function renderTurn(d) {
    // `used` is the whole turn's ledger (the door keeps it across relay steps
    // and the approval), so an approval's response repeats the reads that
    // came before the proposal — show only what is new since the last render
    const fresh = (d.used || []).slice(usedShown);
    usedShown = (d.used || []).length;
    const looked = fresh.filter((t) => t === 'list_pages' || t === 'read_page' || t === 'read_menus');
    if (looked.length) {
      bubble('system', '🔎 הקופיילוט קרא מהאתר: ' + esc(looked.join(', ')));
    }
    if (d.reply) {
      const b = bubble('assistant',
        '<div style="white-space:pre-wrap;word-break:break-word;direction:rtl">' + esc(d.reply) + '</div>' +
        replyActions(d.reply));
      wireActions(b, d.reply);
      // a document in the reply with no tool call: still show it rendered —
      // the 🪄 button above creates it, the frame lets the owner see it first.
      // A MENU document is not a page (v2.43): it goes to the organizer's
      // door, never to the page compiler — see previewMenuReply.
      if (!d.pending && carriesMenuDocument(d.reply)) {
        previewMenuReply(d.reply);
      } else if (!d.pending && carriesDocument(d.reply)) {
        showProposal(d.reply, 'מסמך מהתשובה — לחצו 🪄 בצ׳אט כדי ליצור', false);
      }
    } else if (d.memo && !d.pending && !d.applied) {
      bubble('system', esc(d.memo));
    }
    if (d.truncated) bubble('system', esc(REPLY_CUT), 'warn');
    if (d.pending) renderApproval(d.pending);
    // the canvas follows what the robot reads: an empty canvas opens the
    // first page it looked at — also when the same turn already proposes an
    // edit to it, so the owner compares the proposal against the page under
    // it (approval then reloads that same canvas)
    if (!loadedPath && !menuOpen && Array.isArray(d.reads) && d.reads[0]) {
      selectPage(d.reads[0]);
    }
    // …and the menu the same way (v2.43): an EMPTY canvas opens the menu the
    // robot just read. A page the owner is working on is never pulled away
    // for a mere read — only a menu PROPOSAL does that (renderApproval), since
    // the owner must see what they are about to change.
    if (!loadedPath && !menuOpen && fresh.includes('read_menus')) selectPage(MENU_KEY);
  }

  /** Every turn ends here: the chip learns the last window, a notice from the
   *  door (a shrink-and-retry) becomes a system bubble. */
  function noteTurn(d) {
    if (!d) return;
    if (d.notice) bubble('system', esc(d.notice), 'warn');
    // v2.52 — the premium tier's meter, shown. v2.51 put `spend` on every response (the tokens of THIS response,
    // the price the CMS holds, the money); the page never said it. One quiet line per response that cost
    // something, with the cache's share and the conversation so far. An estimate at list price — the supplier's
    // invoice decides. Nothing for a model on the owner's machine (its `spend` has no price and bills nothing).
    const sp = d.spend;
    if (sp && sp.provider !== 'local' && sp.provider !== 'browser' && (sp.prompt_tokens || sp.completion_tokens)) {
      const n = (v) => Number(v || 0).toLocaleString('en-US');
      const usd = (v) => '$' + (v < 0.01 ? v.toFixed(4) : v.toFixed(3));
      const cached = sp.cache_read_tokens ? ' · ' + n(sp.cache_read_tokens) + ' מהמטמון' : '';
      if (sp.usd != null) {
        sessionUsd += Number(sp.usd) || 0;
        bubble('system', 'עלות משוערת: ' + usd(Number(sp.usd)) + ' · ' + n(sp.prompt_tokens) + ' טוקנים נקראו' + cached +
          ' · בשיחה הזו עד כה ' + usd(sessionUsd) + (sp.priceAsOf ? ' · מחירון ' + esc(sp.priceAsOf) : ''), 'cost');
      } else {
        bubble('system', n(sp.prompt_tokens) + ' טוקנים נקראו' + cached + ' · ' + n(sp.completion_tokens) + ' נכתבו · אין בידינו מחירון למודל הזה', 'cost');
      }
    }
    if (d.window) {
      // the TURN's own word on the menu tools beats the chip's forecast
      if (d.window.menuTools === false) menuToolsOff = true;
      else if (d.window.menuTools === true) menuToolsOff = false;
      noteMenuToolsOff();
      setChip({
        tokens: d.window.tokens, tier: d.window.tier, model: d.window.model,
        promptTokens: d.window.promptTokens, message: lastWindowMessage
      });
    }
  }

  function renderApproval(p) {
    const isMenu = p.tool === 'organize_menu';
    // The fine print is per tool because the truth is (v2.43): a page write
    // is a draft, a menu write is LIVE. Saying "draft only" over a menu
    // would be the one lie on this screen.
    const fine = isMenu
      ? 'שום דבר לא השתנה עדיין. אישור <b>מחיל את התפריט על האתר החי</b> — גיבוי נשמר לפני ההחלה, ואפשר לבטל בלחיצה. ההצעה מוצגת בקנבס, על הכותרת האמיתית.'
      : 'שום דבר לא נשמר עדיין. אישור יוצר/יעדכן <b>טיוטה</b> בלבד — הדף החי לא משתנה.' +
        (p.input && p.input.source ? ' ההצעה מוצגת בקנבס.' : '');
    const b = bubble('system',
      '<div style="font-weight:700;margin-bottom:6px">✋ הקופיילוט מבקש רשות</div>' +
      '<div style="margin-bottom:4px">' + esc(p.summary) + '</div>' +
      (isMenu && p.preview && p.preview.fitLine ? '<div style="margin-bottom:4px;font-size:.84rem">' + esc(p.preview.fitLine) + '</div>' : '') +
      '<div class="faint" style="font-size:.78rem;margin-bottom:8px">' + fine + '</div>' +
      '<div class="actions">' +
      '<button type="button" class="act primary" data-ok="1">' + (isMenu ? '✓ אשר והחל על האתר' : '✓ אשר') + '</button>' +
      '<button type="button" class="act" data-ok="0">✕ לא עכשיו</button>' +
      '</div>');
    openProposal = { pending: p, card: b };
    b.querySelectorAll('[data-ok]').forEach((btn) => {
      btn.addEventListener('click', () => answer(btn.dataset.ok === '1'));
    });
    if (isMenu) {
      // the owner must see what they are about to change: the menu canvas
      // opens UNDER the proposal (the builder's draft is saved first — the
      // owner may have typed while the model was thinking)
      if (!menuOpen) saveCanvas().then(() => { if (openProposal && openProposal.pending === p) selectPage(MENU_KEY); });
      showMenuProposal(p, true);
    } else if (p.input && p.input.source) {
      showProposal(p.input.source, proposalTitle(p), true);
    }
    armUnload();
  }

  /* What an approved write left behind, said the moment the page KNOWS it
     (v2.42). Over the bridge the server applies the write and answers with
     the model's closing call as a continuation — and that envelope already
     carries `applied`. The closing turn re-reads the whole conversation on a
     31B model (HARD-BATTERY-v2: ~4 minutes of «כותב» after the draft existed),
     so the draft is announced and opened in the canvas right here, and the
     status line says the model is only summarising. `appliedShown` keeps the
     line from repeating when the turn finally ends. */
  let appliedShown = null;

  async function showApplied(a) {
    if (!a || appliedShown) return;
    appliedShown = a;
    // the proposal became a draft: its "not saved yet" preview must go now,
    // and the canvas below shows the draft itself
    hideProposal();
    const warn = a.warnings && a.warnings.length ? ' · ' + a.warnings.length + ' אזהרות' : '';
    if (a.organized) {
      // v2.43 — live, not a draft: say where it landed and hand the way back
      // in the same breath. The canvas shows the menu as it now IS.
      if (menuOpen) loadMenuCanvas(); else selectPage(MENU_KEY);
      const line = bubble('system',
        'התפריט עודכן באתר ✓' + (a.fitLine ? ' · ' + esc(a.fitLine) : '') + warn +
        (a.rebuildError ? ' · <span class="fix">בניית האתר נכשלה: ' + esc(a.rebuildError) + '</span>' : '') +
        (a.backupId ? '<div class="actions"><button type="button" class="act" data-undo="1">↩ בטל — החזר את התפריט הקודם</button>' +
          '<a class="act" href="/admin/menus" style="text-decoration:none">עורך התפריטים ↗</a></div>' : ''));
      const undo = line.querySelector('[data-undo]');
      if (undo) undo.addEventListener('click', () => undoMenu(a.backupId, undo));
      return;
    }
    if (a.edited) {
      bubble('system', 'בוצע ✓ הטיוטה בקנבס' + warn);
      if (loadedPath === a.slug) reloadCanvas();
      else selectPage(a.slug);
      loadPages();
    } else if (a.created) {
      await loadPages(a.slug);
      selectPage(a.slug);
      bubble('system', 'נוצרה טיוטה ✓ הדף פתוח בקנבס · <a href="/admin/edit/' + encodeURIComponent(a.slug) + '">בונה מלא</a>' + warn);
    }
  }

  /** ↩ the owner's own click (v2.43). The copilot has NO undo tool — putting
   *  a menu back is a human act, like publishing — so this is the page
   *  calling the menus route directly (POST /admin/api/menus/restore, which
   *  snapshots the current state first: an undo is itself undoable from
   *  /admin/menus). The model is told on its next turn, through history. */
  async function undoMenu(backupId, btn) {
    if (inflight) return;
    btn.disabled = true;
    btn.textContent = 'מחזיר…';
    try {
      await api('/admin/api/menus/restore', { method: 'POST', body: JSON.stringify({ backupId }) });
      btn.textContent = 'הוחזר ✓';
      bubble('system', '↩ התפריט הקודם הוחזר. (השינוי שבוטל נשמר כגיבוי בעורך התפריטים.)');
      remember('user', '(ביטלתי את שינוי התפריט האחרון — התפריט הקודם הוחזר)');
      if (menuOpen) loadMenuCanvas();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '↩ בטל — החזר את התפריט הקודם';
      errorBubble(e);
    }
  }

  /** The status line while the model still works AFTER the write landed. */
  function statusWithDraft(text) {
    if (!appliedShown) return text;
    return (appliedShown.organized ? 'התפריט כבר עודכן ✓ · המודל מסכם: ' : 'הטיוטה כבר נשמרה ✓ · המודל מסכם: ') + text;
  }

  /** The gate — the chat card and the proposal bar both land here. */
  async function answer(ok) {
    if (inflight || !openProposal) return;
    const { pending: p, card } = openProposal;
    openProposal = null;
    appliedShown = null;
    card.querySelectorAll('[data-ok]').forEach((x) => { x.disabled = true; });
    const pressed = card.querySelector('[data-ok="' + (ok ? '1' : '0') + '"]');
    if (pressed) pressed.textContent = ok ? 'מבצע…' : 'נדחה';
    proposal.querySelectorAll('[data-ok]').forEach((x) => { x.disabled = true; });
    if (!ok) hideProposal();
    // the builder may hold unsaved edits the copilot's write would clobber
    await saveCanvas();
    setInflight(true, ok ? 'מבצע…' : 'מודיע לקופיילוט…');
    try {
      // approvals ride the same driver — an approved write hands control
      // back to the model, which may need more bridge round-trips
      const d = await chatTurn({ approve: { id: p.id, ok } });
      remember('assistant', d.reply || d.memo);
      hideProposal();
      // v2.40: the owner's own word comes first — a model has claimed a
      // refused edit was done; this line is the page's, not the model's
      if (!ok) bubble('system', '✕ דחיתם את ההצעה — שום דבר לא נשמר.');
      // a key provider finishes in one round, so the draft is announced here;
      // over the bridge chatTurn already said it when the continuation arrived
      if (ok) await showApplied(d.applied);
      renderTurn(d);
    } catch (e) {
      // v2.61 — the draft already landed this turn (the continuation carried
      // it); whatever stopped the model's closing words is not an error to
      // the owner. Live: the Bridge's two silent minutes ended in red, eight
      // minutes after ✓ had saved the page.
      if (appliedShown) bubble('system', esc('המודל השתתק לפני שסיכם במילים (' + (e && e.message ? e.message : e) + ') — זה לא משנה דבר: השינוי כבר בדף.'), 'warn');
      else errorBubble(e);
    } finally {
      setInflight(false);
    }
  }

  function carriesDocument(reply) {
    // a reply that carries a page — in either dialect: a <bent-*> tag
    // document or a "BENTML 0.2" keyword document
    return /<bent-|<!DOCTYPE html|^\s*BENTML\s+v?\d+\.\d+/im.test(reply);
  }

  /* ── the weaker mode (v2.43): a menu the model could only DESCRIBE ──
     A model with no tool support — or a courier that returns no tool calls —
     cannot call organize_menu; asked to sort the menu it prints a
     `<bent-menus>` document into the chat. That must not break: before this
     the `<bent-` test above took it for a PAGE, lit "🪄 צור דף" over a menu
     and pushed it through the page compiler. Now it is recognised for what
     it is, judged by the organizer's own door (POST /admin/api/menus/preview
     — never writes) and shown on the canvas like any proposal, with a close
     button instead of an approval: there is no pending id behind it, so this
     page has nothing to approve. Applying it stays where a pasted reply has
     always been applied — the organizer card on /admin/menus. */
  function carriesMenuDocument(reply) {
    return /<bent-menus?[\s>]/i.test(reply) && !/<!DOCTYPE html/i.test(reply);
  }

  let lastUserMessage = ''; // the door's brief in the weaker mode (what the OWNER asked)

  async function previewMenuReply(reply) {
    try {
      const d = await api('/admin/api/menus/preview', { method: 'POST', body: JSON.stringify({ reply, brief: lastUserMessage }) });
      if (openProposal) return; // a real proposal arrived meanwhile — it owns the overlay
      if (!menuOpen && !loadedPath) selectPage(MENU_KEY);
      showMenuProposal({ tool: 'organize_menu', preview: d.preview, warnings: d.warningTexts || [] }, false);
    } catch (e) {
      // the door refused it (no menu in it, too many unknown pages…): say why, show nothing
      bubble('system', 'התפריט שבתשובה לא עבר את הבדיקה: ' + esc(e.message), 'warn');
    }
  }

  function replyActions(reply) {
    if (carriesMenuDocument(reply)) {
      return '<div class="actions">' +
        '<a class="act primary" href="/admin/menus" style="text-decoration:none">🧭 להחלה: מסדר/ת התפריטים ↗</a>' +
        '<button type="button" class="act" data-act="copy">העתק</button>' +
        '</div>';
    }
    if (!carriesDocument(reply)) return '';
    return '<div class="actions">' +
      '<button type="button" class="act primary" data-act="create">🪄 צור דף מהתשובה (טיוטה)</button>' +
      '<button type="button" class="act" data-act="copy">העתק</button>' +
      '</div>';
  }

  /* Drive one copilot turn to completion. With the browser provider the
     server answers with modelCall continuations — relay each through the
     bridge and hand the local model's output back until a real reply (or an
     approval request) arrives. Key providers finish in a single round.
     Every hop's window rides back on the response; the chip follows. */
  async function chatTurn(payload) {
    const post = (p) => api('/admin/api/ai/chat', { method: 'POST', body: JSON.stringify(p) }).then(async (d) => {
      noteTurn(d);
      // the write already landed and the model is only being asked to say
      // so (v2.42): show the draft NOW, not after its closing turn
      if (d.modelCall && d.applied) await showApplied(d.applied);
      return d;
    });
    // one line in the chat every 45 s while the turn runs (v2.36): a local
    // model reads for minutes before its first token, and silence looked dead
    const clock = window.TapuzTurnClock
      ? window.TapuzTurnClock.start((text) => bubble('system', esc(statusWithDraft(text)), 'clock'))
      : null;
    const onProgress = (p) => {
      if (clock) clock.progress(p);
      // a heartbeat with nothing streamed is the model READING, not writing 0
      setStatus(statusWithDraft(window.TapuzTurnClock ? window.TapuzTurnClock.status(p) : '✍ המודל שלכם כותב… ' + fmt(p.tokens || 0) + ' טוקנים'));
    };
    try {
      const d = await post(payload);
      if (d.modelCall) setStatus(statusWithDraft('המודל המקומי חושב… (דרך התוסף)'));
      return await bridge.drive(d, post, undefined, onProgress);
    } finally {
      if (clock) clock.stop();
    }
  }

  async function send() {
    if (inflight) return;
    const message = input.value.trim();
    if (!message) return;
    usedShown = 0; // a new turn, a new ledger
    appliedShown = null;
    const p = savedProvider();
    // a keyless provider (local / browser-relay) is ready without any key
    if (!settings.hasKey && !p.keyOptional) {
      bubble('system', 'קודם מגדירים מפתח למטה — או עוברים ל<a href="/admin/ai">הדבקה ידנית</a>.');
      return;
    }
    if (p.browserRelay && !bridge.present) {
      bubble('system', 'הספק הנבחר עובד דרך תוסף Bridge V2 — פתחו את התוסף ולחצו "חבר את האתר הפתוח", ואז רעננו.');
      return;
    }
    // a proposal left unanswered is not forgotten — the model is told
    if (openProposal) {
      openProposal.card.querySelectorAll('[data-ok]').forEach((x) => { x.disabled = true; });
      openProposal = null;
      hideProposal();
      remember('assistant', '(הצעה קודמת לא נענתה)');
    }
    input.value = '';
    lastUserMessage = message;
    bubble('user', esc(message));
    setInflight(true, 'חושב…');
    try {
      await saveCanvas();
      await awaitBridgeWindow(3000);
      const payload = { message, history: history.slice(), context: pageContext() };
      const hint = windowHint();
      if (hint) payload.window = hint;
      const d = await chatTurn(payload);
      remember('user', message);
      remember('assistant', d.reply || d.memo);
      renderTurn(d);
    } catch (e) {
      remember('user', message);
      errorBubble(e);
      if (e.code === 'BRIDGE_TOO_OLD' || e.code === 'BRIDGE_DROPPED_TOOLS') { bridgeWarned = false; warnOldBridge(); }
    } finally {
      setInflight(false);
      input.focus();
    }
  }

  function wireActions(container, reply) {
    container.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.act === 'copy') {
          try { await navigator.clipboard.writeText(reply); btn.textContent = 'הועתק ✓'; } catch (e) { /* no clipboard */ }
          return;
        }
        // create: the forgiving pipeline — extract → repair → DRAFT page
        btn.disabled = true;
        btn.textContent = 'בונה…';
        try {
          const d = await api('/admin/api/pzn/create-from-source', {
            method: 'POST',
            body: JSON.stringify({ source: reply })
          });
          hideProposal();
          await loadPages(d.fullPath);
          selectPage(d.fullPath);
          bubble('system',
            'נוצרה טיוטה ✓ הדף פתוח בקנבס · ' +
            '<a href="/admin/edit/' + encodeURIComponent(d.fullPath) + '">בונה מלא</a>' +
            (d.warnings && d.warnings.length ? ' · ' + d.warnings.length + ' אזהרות' : ''));
          if (d.scrubbed) bubble('system', esc(d.notice || ''), 'warn'); // v2.39: script removed from the model's HTML
          btn.textContent = 'נוצר ✓';
        } catch (e) {
          bubble('system', 'הבנייה נכשלה: ' + esc(e.message), 'danger');
          btn.disabled = false;
          btn.textContent = '🪄 צור דף מהתשובה (טיוטה)';
        }
      });
    });
  }

  /* ── boot ── */

  (async function init() {
    try {
      const d = await api('/admin/api/ai/settings');
      providers = d.providers || [];
      settings = d;
      renderSettings();
    } catch (e) {
      bubble('system', 'שגיאה בטעינת ההגדרות: ' + esc(e.message), 'danger');
    }
    welcome(false);

    // the canvas: the dropdown, the preselected page, the buttons
    await loadPages();
    const params = new URL(location.href).searchParams;
    const want = params.get('page') || '';
    if (want && pages.some((p) => p.full_path === want)) selectPage(want, { keepUrl: true });
    else if (params.get('canvas') === 'menu') selectPage(MENU_KEY, { keepUrl: true });
    else selectPage('', { keepUrl: true });

    select.addEventListener('change', () => {
      if (inflight) { select.value = menuOpen ? MENU_KEY : loadedPath; return; }
      selectPage(select.value);
    });
    $('btn-stage-preview').addEventListener('click', () => {
      const b = builder();
      if (b && typeof b.openResponsivePreview === 'function') b.openResponsivePreview();
    });
    $('cp-new-chat').addEventListener('click', () => {
      if (inflight) return;
      history.length = 0;
      if (openProposal) { openProposal = null; hideProposal(); }
      welcome(true);
      refreshWindow();
      input.focus();
    });
    proposal.querySelectorAll('[data-ok]').forEach((btn) => {
      btn.addEventListener('click', () => answer(btn.dataset.ok === '1'));
    });
    proposal.querySelector('[data-close]').addEventListener('click', hideProposal);
    proposal.querySelectorAll('[data-rsp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        proposal.querySelectorAll('[data-rsp]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const w = btn.dataset.rsp;
        proposal.querySelector('.rsp-frame').style.width = w === 'full' ? '100%' : w + 'px';
      });
    });
    // the embedded builder announces its own saves — the dropdown's "• שינויים"
    // marker follows without a reload
    window.addEventListener('message', (ev) => {
      if (ev.origin !== location.origin || !ev.data || ev.data.source !== 'tapuziel-builder') return;
      if (ev.data.type === 'tz-builder-saved') loadPages();
    });
    // a phone shows one pane at a time
    const wrap = $('chat-wrap');
    document.querySelectorAll('#cp-tabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#cp-tabs button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        wrap.classList.toggle('tab-chat', btn.dataset.tab === 'chat');
        wrap.classList.toggle('tab-canvas', btn.dataset.tab === 'canvas');
      });
    });

    $('ai-provider-radios').addEventListener('change', syncProviderUI);
    $('ai-save').addEventListener('click', saveSettings);
    $('btn-send').addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); }
    });

    // the window: measured now for local/cloud; the browser courier's chip
    // fills in when the bridge finishes probing (tapuz-bridge-window)
    if (!savedProvider().browserRelay || bridgeWindowSettled) refreshWindow();
  })();
})();
