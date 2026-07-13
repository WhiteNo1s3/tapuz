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

  const STABLE_MS = 1600; // text must stop changing before we publish
  const POLL_MS = 400;

  let mission = null;
  let panel;
  let autoPublish = true;
  let watching = true;
  let lastFingerprint = '';
  let stableTimer = null;
  let lastPublishedHash = '';
  let busy = false;
  let observer = null;

  function latestReplyText() {
    const nodes = document.querySelectorAll(provider.assistant);
    if (!nodes.length) return '';
    const el = nodes[nodes.length - 1];
    return (el.innerText || el.textContent || '').trim();
  }

  function isStreaming() {
    if (!provider.streaming) return false;
    try {
      return !!document.querySelector(provider.streaming);
    } catch (e) {
      return false;
    }
  }

  function findComposer() {
    const nodes = document.querySelectorAll(provider.composer);
    if (!nodes.length) return null;
    return nodes[nodes.length - 1];
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
    return { composer: has(provider.composer), assistant: has(provider.assistant), send: has(provider.send) };
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
    const c = findComposer();
    if (!c) {
      toast('לא נמצא שדה הקלדה — הדביקו ידנית', false);
      return false;
    }
    setComposerText(c, text);
    if (send) setTimeout(() => clickSend(), 280);
    return true;
  }

  function toast(msg, ok) {
    const t = document.createElement('div');
    t.setAttribute('dir', 'rtl');
    Object.assign(t.style, {
      position: 'fixed', insetInlineEnd: '18px', bottom: '128px', zIndex: 2147483647,
      maxWidth: '360px', padding: '10px 14px', borderRadius: '10px',
      background: ok ? '#052e16' : '#450a0a', color: '#fff',
      border: '1px solid ' + (ok ? '#166534' : '#991b1b'),
      font: '500 13px system-ui, sans-serif', boxShadow: '0 6px 20px rgba(0,0,0,.25)'
    });
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 6500);
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
    el.textContent = `🔎 שדה הקלדה: ${mark(h.composer)} · תשובה: ${mark(h.assistant)} · שליחה: ${mark(h.send)}`;
    // composer + assistant are the two that matter for inject + auto-publish.
    el.style.color = h.composer && h.assistant ? '#64748b' : '#f87171';
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
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:8px;cursor:pointer">
        <input type="checkbox" id="tz-auto" checked /> פרסום אוטומטי כשה‑‎.pzn מלא
      </label>
      <div style="display:flex;flex-direction:column;gap:6px">
        <button type="button" id="tz-mission" style="${btnStyle('#7c3aed')}">⬇ משוך משימה מה‑CMS</button>
        <button type="button" id="tz-teach" style="${btnStyle('#0891b2')}">① הזרק משחק + מילון</button>
        <button type="button" id="tz-build" style="${btnStyle('#d97706')}">② הזרק תיאור + בנייה</button>
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
    if (mission && mission.teachMessage && mission.teachMessage.length > 200) {
      const ok = inject(mission.teachMessage, { send: true });
      if (ok) {
        markStep('build');
        setStatus('🎮 משחק+מילון הוזרק · אחרי אישור → ②');
        toast('משחק בונה-האתרים הוזרק לצ׳אט', true);
        lastPublishedHash = '';
      }
      return;
    }
    chrome.runtime.sendMessage({ type: 'roleplay', locale: 'he' }, (r) => {
      if (!r || !r.ok || !r.roleplay) {
        toast((r && r.error) || 'לא ניתן לטעון משחק — בדקו טוקן CMS', false);
        setStatus('שגיאה בטעינת משחק');
        return;
      }
      if (mission) mission.teachMessage = r.roleplay;
      const ok = inject(r.roleplay, { send: true });
      if (ok) {
        if (mission) markStep('build');
        setStatus('🎮 משחק+מילון הוזרק (' + (r.length || r.roleplay.length) + ' תווים) · → ②');
        toast('משחק בונה-האתרים + מילון הוזרק', true);
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
    setStatus('בנייה נשלחה · ממתין ל‑‎.pzn מלא…');
    lastPublishedHash = '';
    watching = true;
  }

  function injectOneShot() {
    if (mission && mission.oneShot) {
      inject(mission.oneShot, { send: true });
      markStep('watch');
      setStatus('פעם אחת (משחק+משימה) · ממתין ל‑‎.pzn…');
      lastPublishedHash = '';
      watching = true;
      return;
    }
    const brief = (mission && mission.description) || '';
    chrome.runtime.sendMessage({ type: 'roleplay', locale: 'he', brief }, (r) => {
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
    observer = new MutationObserver(() => onReplyMaybeChanged());
    const root = document.body || document.documentElement;
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    setInterval(() => { updateDiag(); onReplyMaybeChanged(); }, POLL_MS);
  }

  // load the autoPublish preference from the worker
  chrome.runtime.sendMessage({ type: 'getConfig' }, (c) => {
    if (c && c.ok && typeof c.autoPublish === 'boolean') {
      autoPublish = c.autoPublish;
      const box = $('tz-auto');
      if (box) box.checked = autoPublish;
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
