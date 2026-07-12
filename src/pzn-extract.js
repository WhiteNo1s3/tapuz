'use strict';

/**
 * extractPzn — pull a .pzn document out of a pasted AI reply.
 *
 * Bots wrap answers in prose and code fences; users paste the whole thing.
 * Priority:
 *   1. fenced code block (``` / ~~~) containing a full document or bent-* tags
 *   2. bare <!DOCTYPE html> ... </html> slice inside prose
 *   3. the whole text as-is (already clean source)
 *
 * Returns the candidate source string — validation happens downstream
 * (parse/validate reject garbage with actionable errors).
 */

function looksLikeDocument(s) {
  return /<!DOCTYPE\s+html/i.test(s) || /<html[\s>]/i.test(s);
}

function looksLikePzn(s) {
  return looksLikeDocument(s) || /<bent-[a-z]/i.test(s);
}

/**
 * @param {string} text raw pasted reply
 * @returns {string} best-candidate .pzn source (may equal text)
 */
function extractPzn(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return '';

  // 1. code fences — prefer the one that looks most like a document
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

module.exports = { extractPzn, looksLikePzn };
