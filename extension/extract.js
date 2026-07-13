/* Tapuziel Bridge — extract + COMPLETE .pzn detection (the auto-publish gate).
   UMD: self.TapuzExtract in the extension + Node require for smoke tests.

   The watcher must NEVER publish a half-streamed reply. isCompletePzn is the
   safety gate; analyzeReply gives the panel a live reason string. */
(function (root, factory) {
  const api = factory();
  root.TapuzExtract = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function looksLikeDocument(s) {
    return /<!DOCTYPE\s+html/i.test(s) || /<html[\s>]/i.test(s);
  }

  function looksLikePzn(s) {
    return looksLikeDocument(s) || /<bent-[a-z]/i.test(s);
  }

  /**
   * A page is COMPLETE only when we would safely publish it.
   * Partial streams fail these checks on purpose.
   */
  function isCompletePzn(source) {
    const s = String(source || '').trim();
    if (!s || s.length < 40) return false;
    if (!looksLikeDocument(s)) return false;
    if (!/<\/html\s*>/i.test(s)) return false;
    if (!/<bent-[a-z][\w-]*/i.test(s)) return false;
    // refuse a truncated tag at the very end of the stream
    if (/<bent-[a-z][\w-]*[^>]*$/i.test(s.replace(/\s+$/, ''))) return false;
    return true;
  }

  /**
   * @param {string} text raw assistant reply
   * @returns {string} best-candidate .pzn source
   */
  function extractPzn(text) {
    const raw = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!raw) return '';

    // 1. closed fences first (complete stream)
    const fences = [];
    const fenceRe = /(?:```|~~~)[^\n]*\n([\s\S]*?)(?:```|~~~)/g;
    let m;
    while ((m = fenceRe.exec(raw)) !== null) {
      const body = m[1].trim();
      if (body) fences.push(body);
    }
    const completeFence = fences.find(isCompletePzn);
    if (completeFence) return completeFence;
    const docFence = fences.find(looksLikeDocument) || fences.find(looksLikePzn);
    if (docFence) return docFence;

    // 2. bare document with closing html
    const docStart = raw.search(/<!DOCTYPE\s+html/i);
    if (docStart !== -1) {
      const end = raw.toLowerCase().lastIndexOf('</html>');
      if (end > docStart) return raw.slice(docStart, end + '</html>'.length).trim();
      return raw.slice(docStart).trim(); // incomplete
    }
    const htmlStart = raw.search(/<html[\s>]/i);
    if (htmlStart !== -1) {
      const end = raw.toLowerCase().lastIndexOf('</html>');
      if (end > htmlStart) return raw.slice(htmlStart, end + '</html>'.length).trim();
    }

    return raw;
  }

  /**
   * Analyze a full assistant reply for the auto-publish watcher.
   * @returns {{ source: string, complete: boolean, readyMarker: boolean, openFence: boolean, reason: string }}
   */
  function analyzeReply(text) {
    const raw = String(text || '').replace(/\r\n/g, '\n');
    const readyMarker = /\bPZN_READY\b/i.test(raw);
    // unclosed fence? (odd number of fence markers)
    const fenceOpens = (raw.match(/(?:```|~~~)/g) || []).length;
    const openFence = fenceOpens % 2 === 1;

    const source = extractPzn(raw);
    if (!source) {
      return { source: '', complete: false, readyMarker, openFence, reason: 'empty' };
    }
    if (openFence && !isCompletePzn(source)) {
      return { source, complete: false, readyMarker, openFence: true, reason: 'stream_open_fence' };
    }
    if (!isCompletePzn(source)) {
      const why = !/<\/html\s*>/i.test(source)
        ? 'missing_close_html'
        : !/<bent-[a-z]/i.test(source)
          ? 'no_bent_modules'
          : 'incomplete';
      return { source, complete: false, readyMarker, openFence, reason: why };
    }
    return {
      source,
      complete: true,
      readyMarker,
      openFence: false,
      reason: readyMarker ? 'pzn_ready' : 'complete_document'
    };
  }

  return { extractPzn, looksLikePzn, looksLikeDocument, isCompletePzn, analyzeReply };
});
