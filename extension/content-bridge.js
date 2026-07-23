/* Tapuziel Bridge — the BYOT panel on the LLM tab.
 *
 * NO CMS token here (security invariant — the token lives only in the background
 * worker). Uses the user's own logged-in chat session: inject the roleplay game
 * + build prompt, watch the reply for a COMPLETE .pzn, and auto-publish. */
(function () {
  'use strict';

  const provider = self.TapuzProviders && self.TapuzProviders.forHost(location.hostname);
  const X = self.TapuzExtract;
  if (!provider || !X) return;

  // Copy-first hosts (ChatGPT/Gemini): direct injection no-ops or spooks the
  // site, so ①/② deliver via clipboard + human paste. Verbs gender-agree:
  // משחק הוזרק/הועתק (m) · בנייה נשלחה/הועתקה (f).
  const DELIVER_M = provider.copyFirst ? 'הועתק ללוח — הדביקו (Ctrl+V) ושלחו' : 'הוזרק';
  const DELIVER_F = provider.copyFirst ? 'הועתקה ללוח — הדביקו (Ctrl+V) ושלחו' : 'נשלחה';

  const STABLE_MS = 1600; // text must stop changing before we publish
  const POLL_MS = 400;

  let mission = null;
  let panel;
  let autoPublish = true;
  let packLite = false; // free chat plan → inject the lite pack (fits the message gate)
  let watching = true;
  let lastFingerprint = '';
  let stableTimer = null;
  let lastPublishedHash = '';
  let busy = false;
  let observer = null;

  // Coalesce DOM mutations. ChatGPT streams tokens as a storm of childList +
  // characterData mutations; running latestReplyText() (which reads innerText and
  // forces layout) + analyzeReply() on every one pegs the main thread and freezes
  // the tab. Cap the watcher to one run per CHECK_THROTTLE_MS instead.
  const CHECK_THROTTLE_MS = 300;
  let checkScheduled = false;
  let lastCheckAt = 0;

  function isOwnNode(n) {
    if (!n) return false;
    if (n === panel || n === fab) return true;
    if (panel && n.nodeType === 1 && panel.contains(n)) return true;
    return !!(n.nodeType === 1 && n.dataset && n.dataset.tzToast);
  }

  function mutationsAreOwn(muts) {
    if (!muts || !muts.length) return false;
    for (let i = 0; i < muts.length; i++) {
      if (!isOwnNode(muts[i].target)) return false;
    }
    return true; // every mutation came from our own panel/toast/fab — ignore
  }

  function scheduleCheck(muts) {
    if (mutationsAreOwn(muts)) return;
    if (checkScheduled) return;
    checkScheduled = true;
    const wait = Math.max(0, CHECK_THROTTLE_MS - (Date.now() - lastCheckAt));
    setTimeout(() => {
      checkScheduled = false;
      lastCheckAt = Date.now();
      onReplyMaybeChanged();
    }, wait);
  }

  function latestReplyText() {
    let nodes = [];
    try {
      nodes = document.querySelectorAll(provider.assistant);
    } catch (e) {
      /* invalid selector — fall through to generic */
    }
    if (nodes.length) {
      const el = nodes[nodes.length - 1];
      return (el.innerText || el.textContent || '').trim();
    }
    return genericReplyText();
  }

  // Fallback reply reader — when the provider's assistant selector no longer
  // matches, walk a prioritized list of common reply containers and take the
  // last sizeable one. Filters on textContent (no layout) and only reads the
  // layout-forcing innerText on the single chosen node.
  function genericReplyText() {
    const tiers = [
      '[data-message-author-role="assistant"]',
      '[data-message-author-role]',
      'article',
      '[class*="markdown"]',
      '[class*="prose"]',
      '[class*="message"]'
    ];
    for (const sel of tiers) {
      let els;
      try {
        els = Array.from(document.querySelectorAll(sel));
      } catch (e) {
        continue;
      }
      els = els.filter((el) => !isOwnNode(el) && (el.textContent || '').trim().length > 40);
      if (els.length) {
        const el = els[els.length - 1];
        return (el.innerText || el.textContent || '').trim();
      }
    }
    return '';
  }

  function isStreaming() {
    if (!provider.streaming) return false;
    try {
      return !!document.querySelector(provider.streaming);
    } catch (e) {
      return false;
    }
  }

  function isVisible(el) {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 16) return false;
    const s = window.getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && el.getAttribute('aria-hidden') !== 'true';
  }

  // Generic composer finder — the safety net for when a provider redesign breaks
  // its CSS selector. Picks the largest visible editable, preferring the one
  // nearest the viewport bottom (where a chat composer lives). Keeps inject alive
  // even on an unrecognized layout.
  function genericComposer() {
    let cands;
    try {
      cands = Array.from(
        document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]')
      );
    } catch (e) {
      return null;
    }
    cands = cands.filter((el) => !isOwnNode(el) && isVisible(el));
    if (!cands.length) return null;
    const vh = window.innerHeight || 800;
    let best = null;
    let bestScore = -Infinity;
    for (const el of cands) {
      const r = el.getBoundingClientRect();
      const score = r.width * r.height + (r.bottom / vh) * 40000; // area + bottom-proximity
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function findComposer() {
    try {
      const nodes = document.querySelectorAll(provider.composer);
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (isVisible(nodes[i])) return nodes[i];
      }
      if (nodes.length) return nodes[nodes.length - 1];
    } catch (e) {
      /* stale/invalid provider selector — fall through to the generic net */
    }
    return genericComposer();
  }

  // React tracks controlled <textarea>/<input> value via its OWN setter, so a
  // plain `el.value = text` does NOT fire onChange — the model never sees the
  // text and the send button stays disabled. Go through the native prototype
  // setter so React's tracker picks it up. (The #1 reason inject silently fails
  // on ChatGPT / Grok textareas.)
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function setComposerText(el, text) {
    if (!el) return false;
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      setNativeValue(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    // contenteditable (Claude ProseMirror, Gemini rich-textarea, new ChatGPT)
    try {
      document.execCommand('selectAll', false, null);
      const ok = document.execCommand('insertText', false, text);
      if (!ok) throw new Error('insertText refused');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
      return true;
    } catch (e) {
      el.textContent = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
  }

  // Which provider selectors actually resolve on THIS page — surfaced in the
  // panel so per-provider tuning (in a loaded Chrome) is guided, not blind.
  function selectorHealth() {
    const has = (sel) => {
      try { return !!(sel && document.querySelector(sel)); } catch (e) { return false; }
    };
    // Report real capability, not just raw-selector matches: composer/assistant
    // count as healthy when the generic fallback can operate, and send counts as
    // healthy whenever we have a composer (Enter-key fallback always works).
    return {
      composer: !!findComposer(),
      assistant: has(provider.assistant) || !!genericReplyText(),
      send: has(provider.send) || !!findComposer()
    };
  }

  // Clipboard write for the manual-paste fallback. Never a network call — the
  // content script must not fetch. navigator.clipboard first, execCommand second.
  function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {
      /* fall through to execCommand */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.dataset.tzToast = '1'; // mark as our own so the observer ignores it
      ta.style.position = 'fixed';
      ta.style.top = '-2000px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  function clickSend() {
    if (provider.send) {
      const btn = document.querySelector(provider.send);
      if (btn && !btn.disabled) {
        btn.click();
        return true;
      }
    }
    const c = findComposer();
    if (c) {
      c.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
      );
      return true;
    }
    return false;
  }

  function inject(text, { send } = {}) {
    if (provider.copyFirst) {
      const copied = copyToClipboard(text);
      toast(
        copied
          ? '📋 הועתק ללוח — הדביקו בצ׳אט (Ctrl+V) ושלחו'
          : 'העתקה נכשלה — סמנו והעתיקו ידנית',
        copied,
        20000
      );
      return copied;
    }
    const c = findComposer();
    if (!c) {
      // Graceful degradation: put the text on the clipboard so "paste manually"
      // is actually possible, and keep the guidance on screen long enough to act.
      const copied = copyToClipboard(text);
      toast(
        copied
          ? 'לא נמצא שדה הקלדה — הטקסט הועתק ללוח. הדביקו עם Ctrl+V ושלחו'
          : 'לא נמצא שדה הקלדה — סמנו והעתיקו את הטקסט ידנית',
        false,
        30000
      );
      return false;
    }
    const ok = setComposerText(c, text);
    if (!ok) {
      copyToClipboard(text);
      toast('ההזרקה נכשלה — הטקסט הועתק ללוח. הדביקו עם Ctrl+V', false, 30000);
      return false;
    }
    if (send) setTimeout(() => clickSend(), 280);
    return true;
  }

  function toast(msg, ok, ms) {
    const t = document.createElement('div');
    t.setAttribute('dir', 'rtl');
    t.dataset.tzToast = '1';
    Object.assign(t.style, {
      position: 'fixed', insetInlineEnd: '18px', bottom: '128px', zIndex: 2147483647,
      maxWidth: '360px', padding: '10px 14px', borderRadius: '10px',
      background: ok ? '#052e16' : '#450a0a', color: '#fff',
      border: '1px solid ' + (ok ? '#166534' : '#991b1b'),
      font: '500 13px system-ui, sans-serif', boxShadow: '0 6px 20px rgba(0,0,0,.25)'
    });
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms || 6500);
  }

  function btnStyle(bg) {
    return `border:none;border-radius:9px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#fff;background:${bg};text-align:right;width:100%`;
  }

  function $(id) {
    return panel && panel.querySelector('#' + id);
  }

  function setStatus(t) {
    const el = $('tz-status');
    if (el) el.textContent = t;
  }

  function setWatchUi(analysis) {
    const badge = $('tz-watch');
    if (!badge) return;
    if (!watching) { badge.textContent = '⏸ מעקב כבוי'; badge.style.color = '#94a3b8'; return; }
    if (busy) { badge.textContent = '⏳ מפרסם…'; badge.style.color = '#fbbf24'; return; }
    if (isStreaming()) { badge.textContent = '📡 סטרימינג…'; badge.style.color = '#38bdf8'; return; }
    if (analysis && analysis.complete) {
      badge.textContent = '✅ ‎.pzn מלא · ' + (autoPublish ? 'אוטו' : 'ידני');
      badge.style.color = '#34d399';
    } else if (analysis && analysis.reason === 'stream_open_fence') {
      badge.textContent = '… fence פתוח'; badge.style.color = '#fbbf24';
    } else if (analysis && analysis.reason === 'missing_close_html') {
      badge.textContent = '… מחכה ל‑</html>'; badge.style.color = '#fbbf24';
    } else {
      badge.textContent = autoPublish ? '👁 ממתין ל‑‎.pzn מלא' : '👁 מעקב (פרסום ידני)';
      badge.style.color = '#94a3b8';
    }
  }

  function updateDiag() {
    const el = $('tz-diag');
    if (!el) return;
    const h = selectorHealth();
    const mark = (b) => (b ? '✓' : '✗');
    el.textContent = provider.copyFirst
      ? `🔎 מסירה: 📋 לוח (העתק-הדבק) · תשובה: ${mark(h.assistant)}`
      : `🔎 שדה הקלדה: ${mark(h.composer)} · תשובה: ${mark(h.assistant)} · שליחה: ${mark(h.send)}`;
    // what matters for THIS host's delivery mode + auto-publish:
    // copy-first needs only the reply reader; inject needs composer too.
    el.style.color = (provider.copyFirst ? h.assistant : h.composer && h.assistant) ? '#64748b' : '#f87171';
  }

  function simpleHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return String(h);
  }

  function onReplyMaybeChanged() {
    if (!watching) return;
    const text = latestReplyText();
    if (!text) return;
    const analysis = X.analyzeReply(text);
    setWatchUi(analysis);

    if (isStreaming()) {
      clearTimeout(stableTimer);
      stableTimer = null;
      lastFingerprint = text.length + ':' + text.slice(-80);
      return;
    }

    const fp = text.length + ':' + text.slice(-120);
    if (fp !== lastFingerprint) {
      lastFingerprint = fp;
      clearTimeout(stableTimer);
      stableTimer = setTimeout(() => tryAutoPublish(text), STABLE_MS);
      return;
    }
    if (analysis.complete && autoPublish && !stableTimer) {
      tryAutoPublish(text);
    }
  }

  function tryAutoPublish(text) {
    stableTimer = null;
    if (!autoPublish || !watching || busy) return;
    if (isStreaming()) return;
    const analysis = X.analyzeReply(text || latestReplyText());
    setWatchUi(analysis);
    if (!analysis.complete) return;
    const hash = simpleHash(analysis.source);
    if (hash === lastPublishedHash) return;
    publishSource(analysis.source, { auto: true });
  }

  function publishSource(sourceOrRaw, { auto, force } = {}) {
    const analysis = X.analyzeReply(sourceOrRaw);
    let payload = sourceOrRaw;
    if (analysis.source) payload = analysis.complete || force ? sourceOrRaw : analysis.source;
    if (!force && !analysis.complete && !X.isCompletePzn(sourceOrRaw)) {
      toast('עדיין לא ‎.pzn מלא: ' + (analysis.reason || 'incomplete'), false);
      setStatus('לא מוכן · ' + (analysis.reason || ''));
      return;
    }
    if (busy) return;
    busy = true;
    setWatchUi(analysis);
    setStatus(auto ? 'פרסום אוטומטי…' : 'מפרסם…');
    chrome.runtime.sendMessage(
      { type: 'publish', text: payload, publish: true, requireComplete: !force },
      (r) => {
        busy = false;
        if (r && r.ok) {
          lastPublishedHash = simpleHash(analysis.source || X.extractPzn(payload));
          setStatus((r.created ? '✨ נוצר: ' : '✨ עודכן: ') + r.fullPath);
          toast((auto ? 'אוטו · ' : '') + (r.created ? 'נוצר ' : 'עודכן ') + r.fullPath, true);
          if (mission) {
            chrome.runtime.sendMessage({
              type: 'missionStep', id: mission.id, step: 'done', status: 'done', fullPath: r.fullPath
            });
          }
          if (r.url) {
            const a = document.createElement('a');
            a.href = r.url; a.target = '_blank'; a.rel = 'noopener';
            a.textContent = ' צפה'; a.style.color = '#7dd3fc';
            const st = $('tz-status');
            if (st) st.appendChild(a);
          }
        } else {
          toast('שגיאה: ' + ((r && r.error) || '?'), false);
          setStatus('פרסום נכשל');
        }
        setWatchUi(X.analyzeReply(latestReplyText()));
      }
    );
  }

  function publishLatest(force) {
    publishSource(latestReplyText(), { auto: false, force: !!force });
  }

  function pullMission() {
    chrome.runtime.sendMessage({ type: 'mission' }, (r) => {
      if (!r || !r.ok || !r.mission) {
        toast((r && r.error) || 'אין משימה — צרו אחת ב‑/admin/chat', false);
        setStatus('אין משימה ממתינה');
        return;
      }
      mission = r.mission;
      if (mission.targetPage) {
        chrome.runtime.sendMessage({ type: 'setConfig', target: mission.targetPage });
      }
      setStatus('משימה: ' + (mission.description || '').slice(0, 72) + '…');
      toast('משימה נטענה · ① משחק+מילון → ② בנייה → אוטו', true);
      lastPublishedHash = '';
    });
  }

  function markStep(step) {
    if (!mission) return;
    chrome.runtime.sendMessage({ type: 'missionStep', id: mission.id, step });
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.setAttribute('dir', 'rtl');
    Object.assign(panel.style, {
      position: 'fixed', insetInlineEnd: '16px', bottom: '16px', zIndex: 2147483646,
      width: '300px', padding: '12px', borderRadius: '14px',
      background: 'linear-gradient(160deg,#0f172a,#1e293b)', color: '#e2e8f0',
      font: '500 13px system-ui, sans-serif', boxShadow: '0 12px 40px rgba(0,0,0,.45)',
      border: '1px solid #334155'
    });
    panel.innerHTML = `
      <div style="font-weight:800;margin-bottom:4px">🍊 תפוזיאל · בונה אתרים (${provider.label})</div>
      <div id="tz-status" style="font-size:12px;color:#94a3b8;margin-bottom:4px;line-height:1.4">
        ה‑session שלכם · בלי מפתחות בשרת
      </div>
      <div id="tz-watch" style="font-size:11px;margin-bottom:4px;color:#94a3b8">👁 מאתחל מעקב…</div>
      <div id="tz-diag" style="font-size:10px;margin-bottom:8px;color:#64748b">🔎 בודק שדות…</div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:4px;cursor:pointer">
        <input type="checkbox" id="tz-auto" checked /> פרסום אוטומטי כשה‑‎.pzn מלא
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:8px;cursor:pointer" title="מילון מקוצר שנכנס במגבלת האורך של הודעה בחשבון חינמי">
        <input type="checkbox" id="tz-lite" /> חשבון חינמי — חבילה חסכונית
      </label>
      <div style="display:flex;flex-direction:column;gap:6px">
        <button type="button" id="tz-mission" style="${btnStyle('#7c3aed')}">⬇ משוך משימה מה‑CMS</button>
        <button type="button" id="tz-teach" style="${btnStyle('#0891b2')}">① ${provider.copyFirst ? 'העתק' : 'הזרק'} משחק + מילון</button>
        <button type="button" id="tz-build" style="${btnStyle('#d97706')}">② ${provider.copyFirst ? 'העתק' : 'הזרק'} תיאור + בנייה</button>
        <button type="button" id="tz-oneshot" style="${btnStyle('#334155')}">①+② בפעם אחת (משחק+משימה)</button>
        <button type="button" id="tz-publish" style="${btnStyle('#059669')}">③ פרסם עכשיו (ידני)</button>
      </div>
    `;
    document.body.appendChild(panel);

    $('tz-auto').onchange = () => {
      autoPublish = $('tz-auto').checked;
      chrome.runtime.sendMessage({ type: 'setConfig', autoPublish });
      setWatchUi(X.analyzeReply(latestReplyText()));
    };
    $('tz-lite').onchange = () => {
      packLite = $('tz-lite').checked;
      chrome.runtime.sendMessage({ type: 'setConfig', packSize: packLite ? 'lite' : 'full' });
    };
    $('tz-mission').onclick = pullMission;
    $('tz-teach').onclick = () => injectTeachRoleplay();
    $('tz-build').onclick = () => injectBuild();
    $('tz-oneshot').onclick = () => injectOneShot();
    $('tz-publish').onclick = () => publishLatest(true);
  }

  /**
   * ① — inject the full site-builder roleplay pack (dictionary + tools + role).
   * Works even without a mission: you can always start the game on a blank chat.
   */
  function injectTeachRoleplay() {
    setStatus('טוען משחק + מילון…');
    // lite mode: the mission's prebuilt teach message is full-size — skip it
    // and fetch the lite pack, or a free plan rejects the paste.
    if (!packLite && mission && mission.teachMessage && mission.teachMessage.length > 200) {
      const ok = inject(mission.teachMessage, { send: true });
      if (ok) {
        markStep('build');
        setStatus('🎮 משחק+מילון ' + DELIVER_M + ' · אחרי אישור → ②');
        if (!provider.copyFirst) toast('משחק בונה-האתרים הוזרק לצ׳אט', true);
        lastPublishedHash = '';
      }
      return;
    }
    chrome.runtime.sendMessage({ type: 'roleplay', locale: 'he', size: packLite ? 'lite' : 'full' }, (r) => {
      if (!r || !r.ok || !r.roleplay) {
        toast((r && r.error) || 'לא ניתן לטעון משחק — בדקו טוקן CMS', false);
        setStatus('שגיאה בטעינת משחק');
        return;
      }
      if (mission && !packLite) mission.teachMessage = r.roleplay;
      const ok = inject(r.roleplay, { send: true });
      if (ok) {
        if (mission) markStep('build');
        setStatus('🎮 משחק+מילון ' + DELIVER_M + ' (' + (r.length || r.roleplay.length) + ' תווים) · → ②');
        if (!provider.copyFirst) toast('משחק בונה-האתרים + מילון הוזרק', true);
        lastPublishedHash = '';
      }
    });
  }

  function injectBuild() {
    if (!mission || !mission.buildMessage) {
      toast('משכו משימה מה‑CMS (עם תיאור דף) או כתבו משימה ב‑/admin/chat', false);
      return;
    }
    inject(mission.buildMessage, { send: true });
    markStep('watch');
    setStatus('בנייה ' + DELIVER_F + ' · ממתין ל‑‎.pzn מלא…');
    lastPublishedHash = '';
    watching = true;
  }

  function injectOneShot() {
    // (lite mode skips the prebuilt full-size one-shot — same reason as ①)
    if (!packLite && mission && mission.oneShot) {
      inject(mission.oneShot, { send: true });
      markStep('watch');
      setStatus('פעם אחת (משחק+משימה) · ממתין ל‑‎.pzn…');
      lastPublishedHash = '';
      watching = true;
      return;
    }
    const brief = (mission && mission.description) || '';
    chrome.runtime.sendMessage({ type: 'roleplay', locale: 'he', brief, size: packLite ? 'lite' : 'full' }, (r) => {
      if (!r || !r.ok || !r.roleplay) {
        toast((r && r.error) || 'אין הודעת פעם-אחת', false);
        return;
      }
      inject(r.roleplay, { send: true });
      markStep('watch');
      setStatus('פעם אחת · ממתין ל‑‎.pzn מלא…');
      lastPublishedHash = '';
      watching = true;
    });
  }

  function startWatching() {
    if (observer) return;
    observer = new MutationObserver(scheduleCheck);
    const root = document.body || document.documentElement;
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    setInterval(() => { updateDiag(); onReplyMaybeChanged(); }, POLL_MS);
  }

  // load the autoPublish + pack-size preferences from the worker
  chrome.runtime.sendMessage({ type: 'getConfig' }, (c) => {
    if (c && c.ok && typeof c.autoPublish === 'boolean') {
      autoPublish = c.autoPublish;
      const box = $('tz-auto');
      if (box) box.checked = autoPublish;
    }
    if (c && c.ok) {
      packLite = c.packSize === 'lite';
      const lite = $('tz-lite');
      if (lite) lite.checked = packLite;
    }
  });

  const fab = document.createElement('button');
  fab.textContent = '🍊';
  fab.title = 'פרסם תשובה אחרונה (אם מלאה)';
  Object.assign(fab.style, {
    position: 'fixed', insetInlineEnd: '18px', bottom: '340px', zIndex: 2147483645,
    width: '44px', height: '44px', borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: '#f59e0b', fontSize: '20px', boxShadow: '0 6px 20px rgba(0,0,0,.3)'
  });
  fab.onclick = () => publishLatest(false);

  const mount = () => {
    if (!document.body) return;
    if (!panel) buildPanel();
    if (!fab.isConnected) document.body.appendChild(fab);
    startWatching();
    setWatchUi(null);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  setTimeout(pullMission, 900);
})();
