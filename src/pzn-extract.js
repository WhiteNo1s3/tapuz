'use strict';

/**
 * extractPzn — the name every paste door has imported since v0.43.
 *
 * Since v2.20 it is a thin door onto src/bentml/extract.js — the ONE
 * extractor for both dialects ("take only the BenTML, any time, anywhere").
 * extractPzn returns the bare source in whatever dialect it found; a caller
 * that must end up with a .pzn document (the store, the create routes) uses
 * pzn-source.toPznSource, which also compiles a keyword-dialect reply.
 */

const { extractBentml, sniffDialect, looksLikePzn } = require('./bentml/extract');

/**
 * @param {string} text raw pasted reply
 * @returns {string} best-candidate source (may equal text)
 */
function extractPzn(text) {
  return extractBentml(text).source;
}

module.exports = { extractPzn, extractBentml, sniffDialect, looksLikePzn };
