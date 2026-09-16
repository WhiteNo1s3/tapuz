'use strict';

/**
 * Model-written raw HTML loses its script on the way in (v2.39).
 *
 * Found in the hard live tests: `<bent-html>` is an authoring tool rendered
 * RAW by design (v1.49 — the owner's escape hatch, script included). But the
 * AI doors — the copilot's create_page/edit_page, the agent API the copy
 * companion posts to, the admin paste flow — let a MODEL's document carry one
 * too, and nothing on those doors looked inside it. Proved on a scratch site:
 * a proposal holding `<script>`, an `onerror=` and a `javascript:` link passed
 * the checks, was approved (the proposal preview is sandboxed, so the script
 * never showed), was saved, and the builder's 👁 live preview then served all
 * three on the admin origin — the owner's session — and the paste flow's
 * "save and publish" would have served them to every visitor. A model's
 * output can be steered by what it read (a page, a media alt, a web snippet),
 * so its HTML is untrusted input — src/html-sanitize.js already says so in its
 * threat model; only the importer was using it.
 *
 * `scrubAiSource(source)` runs every `html` module of a document through that
 * sanitizer and says how many blocks it changed. The owner's own raw HTML (the
 * builder, the source editor) never passes here and stays exactly as written.
 */

const { sanitizeHtmlFragment } = require('./html-sanitize');

/**
 * @param {string} source a .pzn document written by a model
 * @returns {{ source: string, scrubbed: number }} the same document when
 *   nothing needed removing (byte for byte), else the serialized clean one
 */
function scrubAiSource(source) {
  const src = String(source == null ? '' : source);
  if (!/<bent-html\b/i.test(src)) return { source: src, scrubbed: 0 };
  let doc;
  const pzn = require('./pzn/index');
  try {
    doc = pzn.parse(src);
  } catch (e) {
    // an unparseable document is refused further down the door anyway; the
    // repair pass re-enters here with the repaired source
    return { source: src, scrubbed: 0 };
  }
  let scrubbed = 0;
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (!n || n.type !== 'module') continue;
      if (n.name === 'html' && n.props && typeof n.props.content === 'string') {
        const clean = sanitizeHtmlFragment(n.props.content);
        if (clean !== n.props.content) { n.props.content = clean; scrubbed++; }
      }
      walk(n.children);
    }
  };
  walk(doc.body);
  return scrubbed ? { source: pzn.serialize(doc), scrubbed } : { source: src, scrubbed: 0 };
}

/** The owner-facing sentence (Hebrew) for a scrub count. */
function scrubNotice(n) {
  return 'הוסרו קטעי קוד שרצים בדפדפן (script, on…=, javascript:) מ-' + n +
    (n === 1 ? ' בלוק HTML' : ' בלוקי HTML') + ' שהמודל כתב — שאר הדף כמו שהוצע. קוד משלכם מוסיפים בבונה.';
}

module.exports = { scrubAiSource, scrubNotice };
