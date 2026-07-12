/* Tapuziel Bridge — pull a .pzn document out of a bot's chat reply.
   UMD: works as an extension global (self.TapuzExtract) and as a Node module
   (require) so the same logic is unit-tested in scripts/smoke-extension.js. */
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
   * @param {string} text raw assistant reply
   * @returns {string} best-candidate .pzn source (may equal text)
   */
  function extractPzn(text) {
    const raw = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!raw) return '';

    // 1. code fences — prefer the one that looks like a document
    const fences = [];
    const fenceRe = /(?:```|~~~)[^\n]*\n([\s\S]*?)(?:```|~~~)/g;
    let m;
    while ((m = fenceRe.exec(raw)) !== null) {
      const body = m[1].trim();
      if (body) fences.push(body);
    }
    const docFence = fences.find(looksLikeDocument) || fences.find(looksLikePzn);
    if (docFence) return docFence;

    // 2. bare document inside prose
    const docStart = raw.search(/<!DOCTYPE\s+html/i);
    if (docStart !== -1) {
      const end = raw.toLowerCase().lastIndexOf('</html>');
      if (end > docStart) return raw.slice(docStart, end + '</html>'.length).trim();
      return raw.slice(docStart).trim();
    }
    const htmlStart = raw.search(/<html[\s>]/i);
    if (htmlStart !== -1) {
      const end = raw.toLowerCase().lastIndexOf('</html>');
      if (end > htmlStart) return raw.slice(htmlStart, end + '</html>'.length).trim();
    }

    // 3. whole text
    return raw;
  }

  return { extractPzn, looksLikePzn, looksLikeDocument };
});
