'use strict';

/**
 * The site builder (the BenTML roleplay pack) as an injection descriptor —
 * a STUB in v2.28.
 *
 * The builder pack already has a home (/admin/inject → inject-pack, the
 * /admin/ai paste door, the copilot tools); folding it onto the generic
 * runner means deciding how a multi-page reply lands (draft per page? one
 * apply per document?) — deferred, not decided here. Registered so the id
 * and family are claimed; hidden from the packs grid; every verb answers
 * NOT_READY.
 */

function notReady() {
  const e = new Error('בונה האתרים דרך המריץ יגיע בגרסה הבאה — בינתיים משתמשים ב״מילון · משחק״ ובהדבקה הידנית');
  e.code = 'NOT_READY';
  return e;
}

module.exports = {
  id: 'site-builder',
  kind: 'site-builder',
  family: 'pages',
  title: '🏗️ בונה האתרים',
  blurb: 'בקרוב',
  budget: { lite: 0, full: 0 },
  buildPrompt: null,
  parse() { throw notReady(); },
  apply() { throw notReady(); },
  undo() { throw notReady(); },
  run: { enabled: false, maxTokens: 0, timeoutMs: { local: 0, cloud: 0 }, repairable: [] },
  ui: {
    briefPlaceholder: '',
    sizes: ['lite', 'full'],
    applyLabel: '',
    mount: [],
    canApply: false,
    hidden: true,
    renderPreview() { return ''; }
  }
};
