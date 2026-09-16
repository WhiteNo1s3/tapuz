'use strict';

/**
 * The hero's children (v2.38) — one answer for the .pzn converter and the
 * live renderer.
 *
 * Ben: "yes fix the hero". The hero block used to FLATTEN its children into
 * four fields the builder's form edits — title, subtitle, buttonText,
 * buttonUrl. A hero written in BenTML (by a model, a paste, an import) is
 * richer than that, and every save through the builder threw the rest away:
 * measured, a hero with a level-2 centred heading, a large centred text, an
 * outline button, a spacer and a second text came back as a bare
 * <h1>, <p>, <a> — every child id, level, align, size and variant gone and
 * two children deleted. The live renderer drew only that trio, so the page the
 * owner approved in the proposal preview (compiled from .pzn, all children)
 * was not the page the live site showed.
 *
 * Now the hero block keeps its authored children in `data.blocks` (the way a
 * section does) AND the four flat fields the builder form edits. This module
 * merges the two: the children are the truth for everything the form cannot
 * express, and a form edit is applied onto them —
 *   title      ↔ the first heading's text    ('' removes that heading)
 *   subtitle   ↔ the first text's content    ('' removes that text)
 *   buttonText ↔ the first button's text     ('' removes that button)
 *   buttonUrl  ↔ the first button's url
 * A field set with no such child yet inserts one where the builder's trio
 * would put it. A hero with no `data.blocks` (made in the builder, or saved
 * before v2.38) returns null, and every caller keeps its old path.
 */

const clone = (v) => JSON.parse(JSON.stringify(v));

/** @returns {object[]|null} the hero's children as blocks, form edits applied */
function heroChildren(data) {
  if (!data || !Array.isArray(data.blocks) || !data.blocks.length) return null;
  const kids = clone(data.blocks).filter((b) => b && typeof b === 'object' && b.type);
  const first = (type) => kids.findIndex((b) => b.type === type);

  // title ↔ first heading
  if (typeof data.title === 'string') {
    const h = first('heading');
    if (h >= 0) {
      const cur = (kids[h].data && kids[h].data.text) || '';
      if (data.title === '' && cur !== '') kids.splice(h, 1);
      else if (data.title !== cur) kids[h].data = Object.assign({}, kids[h].data, { text: data.title });
    } else if (data.title) {
      kids.unshift({ type: 'heading', data: { level: 1, text: data.title } });
    }
  }

  // subtitle ↔ first text (right after the heading when it has to be added)
  if (typeof data.subtitle === 'string') {
    const t = first('text');
    if (t >= 0) {
      const cur = (kids[t].data && kids[t].data.content) || '';
      if (data.subtitle === '' && cur !== '') kids.splice(t, 1);
      else if (data.subtitle !== cur) kids[t].data = Object.assign({}, kids[t].data, { content: data.subtitle });
    } else if (data.subtitle) {
      const h = first('heading');
      kids.splice(h >= 0 ? h + 1 : 0, 0, { type: 'text', data: { content: data.subtitle } });
    }
  }

  // buttonText / buttonUrl ↔ first button (after the heading and text when added)
  if (typeof data.buttonText === 'string') {
    const b = first('button');
    if (b >= 0) {
      const d = Object.assign({}, kids[b].data);
      const cur = d.text || '';
      if (data.buttonText === '' && cur !== '') {
        kids.splice(b, 1);
      } else {
        if (data.buttonText !== cur) d.text = data.buttonText;
        if (typeof data.buttonUrl === 'string' && data.buttonUrl !== (d.url || '')) d.url = data.buttonUrl;
        kids[b].data = d;
      }
    } else if (data.buttonText) {
      const at = Math.max(first('heading'), first('text')) + 1;
      const d = { text: data.buttonText };
      if (typeof data.buttonUrl === 'string' && data.buttonUrl) d.url = data.buttonUrl;
      kids.splice(at, 0, { type: 'button', data: d });
    }
  }

  return kids;
}

module.exports = { heroChildren };
