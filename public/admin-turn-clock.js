/* Tapuziel — the turn clock (v2.36), shared by the copilot screen
 * (/admin/chat) and the builder's copilot drawer.
 *
 * Ben, after long Bridge sessions sat silent for minutes: "a comment from llm
 * thinking in every 45s". A local 31B model reads the whole briefing (45K
 * chars) — and after an approval the whole conversation again — before it
 * writes a single token: measured on Gemma 4 31B, headers at 0 s and the first
 * streamed chunk at 27.9 s, with nothing in between, and far longer once a
 * conversation has grown. From the chat that silence looked exactly like a
 * dead tab.
 *
 * So while a copilot turn is in flight the clock posts one short line every
 * 45 seconds saying what is actually happening, read from the bridge's own
 * progress events (TapuzBridge.drive's onProgress):
 *   - nothing streamed yet   → still reading the briefing and the conversation
 *   - a tool call has begun  → writing the page (bridge 0.5.3 says so: LM
 *                              Studio delivers a tool call's text in one frame
 *                              at the end, so there is no count to show)
 *   - the count grew         → writing, with the count so far
 *   - the count stood still  → gone quiet mid-reply (check LM Studio)
 * A call with no progress channel (a server-side model) only says it is still
 * working — it never pretends to know more.
 *
 * It reports and nothing else: it never cancels, retries or judges. The
 * ceilings stay where they are (the bridge's two silences, the server's
 * twenty minutes). The lines are the page's words, not the model's — with
 * reasoning_effort:none there are no model thoughts to show.
 */
(function (global) {
  'use strict';

  var TICK_MS = 45000;

  function clock(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var sec = s % 60;
    return Math.floor(s / 60) + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }

  // what a tool call is, in the owner's words
  var TOOL_WORDS = { create_page: 'את הדף החדש', edit_page: 'את השינויים בדף' };

  /** The line for one tick. Pure (the smoke runs it): `st` is the state the
   *  handle keeps, `elapsedMs` the time since the turn started.
   *
   *  Nothing streamed yet means one of two things, and a bridge ≥ 0.5.3 says
   *  which (`started`): the model is still READING, or it has begun writing a
   *  page INTO a tool call — which LM Studio delivers in one frame at the end
   *  (measured: the call's name at 32.0 s, all its text at 61.8 s). An older
   *  bridge cannot say, and then the line claims neither. */
  function line(st, elapsedMs) {
    var t = clock(elapsedMs);
    if (!st.relayed) return '⏳ עדיין עובד על התשובה — ' + t;
    if (st.chars === 0) {
      if (st.started === true) {
        if (!st.tool) return '✍ המודל התחיל לענות — ' + t;
        var what = TOOL_WORDS[st.tool] || 'לתוך ' + st.tool;
        return st.saidWriting
          ? '✍ עדיין כותב ' + what + ' — ' + t
          : '✍ המודל כותב ' + what + ' — ' + t + '. דף כזה מגיע בבת אחת כשהוא גמור, ולכן אין מונה בינתיים.';
      }
      if (st.started === false) {
        return st.saidReading
          ? '⏳ עדיין קורא — ' + t
          : '⏳ המודל עדיין קורא את התדריך והשיחה — ' + t + '. מודל מקומי גדול קורא הכול לפני שהוא כותב מילה, וזה תקין.';
      }
      return st.saidReading
        ? '⏳ עדיין עובד — ' + t
        : '⏳ המודל עדיין עובד — ' + t + '. עד שמשהו מגיע ממנו אין מה להראות: הוא קורא את התדריך, ודף שהוא כותב מגיע בבת אחת בסוף.';
    }
    if (st.chars > st.lastChars) {
      var count = st.tokens > 0 ? fmt(st.tokens) + ' טוקנים' : fmt(st.chars) + ' תווים';
      return '✍ המודל כותב — ' + count + ' עד עכשיו · ' + t;
    }
    // v2.61 — a count that stands still because the model is writing INTO a
    // tool call (LM Studio delivers that text whole, at the end). Measured
    // live: four tokens of text, then edit_page for two minutes, and this
    // line said "wrote nothing — check LM Studio" while the page was coming.
    if (st.started === true && st.tool) {
      var into = TOOL_WORDS[st.tool] || 'לתוך ' + st.tool;
      return st.saidWriting
        ? '✍ עדיין כותב ' + into + ' — ' + t
        : '✍ המודל כותב ' + into + ' — ' + t + '. דף כזה מגיע בבת אחת כשהוא גמור, ולכן המונה עומד.';
    }
    return '⏸ המודל לא כתב כלום ב-45 השניות האחרונות — ' + t + '. אם זה נמשך, בדקו את LM Studio.';
  }

  /** The live status line for one progress event (the line under the
   *  composer, between the 45 s comments). A heartbeat with nothing streamed
   *  used to say "writing… 0 tokens" — it is reading, or writing a tool call
   *  that arrives whole, and a bridge ≥ 0.5.3 says which. A document written
   *  into a tool call has characters but no content tokens. */
  function status(p) {
    var chars = Number(p && p.chars) || 0;
    var tokens = Number(p && p.tokens) || 0;
    if (!chars) {
      if (p && p.started === true) return p.tool ? '✍ המודל שלכם כותב ' + (TOOL_WORDS[p.tool] || p.tool) + '… (מגיע בבת אחת בסוף)' : '✍ המודל שלכם התחיל לענות…';
      if (p && p.started === false) return '⏳ המודל שלכם קורא את התדריך…';
      return '⏳ המודל שלכם עובד…';
    }
    // v2.61 — a few words of text, then a page into a tool call: the page is what is coming
    if (p && p.started === true && p.tool) return '✍ המודל שלכם כותב ' + (TOOL_WORDS[p.tool] || p.tool) + '… (מגיע בבת אחת בסוף)';
    return '✍ המודל שלכם כותב… ' + (tokens > 0 ? fmt(tokens) + ' טוקנים' : fmt(chars) + ' תווים');
  }

  /** Start the clock for one turn. `post(text)` renders a line in the chat.
   *  Returns { progress(p), stop() } — feed it every onProgress event, stop it
   *  when the turn ends (reply, approval card, or error). Stopping twice is
   *  harmless. `opts.tickMs` / `opts.now` / `opts.setInterval` /
   *  `opts.clearInterval` exist for the smoke. */
  function start(post, opts) {
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var every = opts.setInterval || global.setInterval.bind(global);
    var cancel = opts.clearInterval || global.clearInterval.bind(global);
    var t0 = now();
    var st = { relayed: false, chars: 0, tokens: 0, lastChars: 0, saidReading: false, saidWriting: false, started: undefined, tool: '' };
    var timer = every(function () {
      var text = line(st, now() - t0);
      if (st.relayed && st.chars === 0 && st.started !== true) st.saidReading = true;
      if (st.relayed && st.started === true && st.tool && st.chars <= st.lastChars) st.saidWriting = true;
      st.lastChars = st.chars;
      try { post(text); } catch (e) { /* a UI that throws must not stop the turn */ }
    }, opts.tickMs || TICK_MS);
    return {
      progress: function (p) {
        var chars = Number(p && p.chars) || 0;
        var tokens = Number(p && p.tokens) || 0;
        var started = p && typeof p.started === 'boolean' ? p.started : undefined;
        // a count that went DOWN, or a call that is no longer started, is the
        // next relayed call of the same turn (after a tool hop or an
        // approval): the model is reading again
        if (chars < st.chars || (st.started === true && started === false)) { st.lastChars = 0; st.saidReading = false; st.saidWriting = false; }
        var tool = (p && typeof p.tool === 'string') ? p.tool : '';
        // a different tool call is a new page on its way: explain it once more
        if (tool && tool !== st.tool) st.saidWriting = false;
        st.relayed = true;
        st.chars = chars;
        st.tokens = tokens;
        st.started = started;
        st.tool = tool;
      },
      stop: function () {
        if (timer === null) return;
        cancel(timer);
        timer = null;
      }
    };
  }

  global.TapuzTurnClock = { start: start, line: line, status: status, TICK_MS: TICK_MS };
})(typeof window !== 'undefined' ? window : this);
