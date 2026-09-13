'use strict';

/**
 * Theme effects as an injection descriptor — a STUB in v2.28.
 *
 * The effects prompt lives inside src/routes/theme.js (buildEffectsPrompt is
 * not exported) and its paste door is the studio's own; lifting both onto
 * the generic runner is a follow-up once that builder is exposed. Until
 * then the pack is registered so the id, the family and the card slot are
 * claimed, but it is hidden from the packs grid (ui.hidden) and every verb
 * answers NOT_READY — the routes turn that into a 400, never a crash.
 */

function notReady() {
  const e = new Error('חבילת האפקטים תגיע בגרסה הבאה — בינתיים האפקטים נשארים בסטודיו הערכות');
  e.code = 'NOT_READY';
  return e;
}

module.exports = {
  id: 'theme-effects',
  kind: 'theme-effects',
  family: 'theme',
  title: '✨ אפקטים לערכה',
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
