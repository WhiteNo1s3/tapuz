'use strict';

/**
 * The store's categories (v2.69) — their own screen and their API.
 *
 * The owner: "refine the product creation and categories which are very lean
 * on tapuziel". A category used to be a name and an id typed into a card at
 * the bottom of "משלוח ותשלום", saved with the whole settings form: an edited
 * id silently took every product off it, and a row missing from the post was
 * a deleted category. Here a category is a thing of its own — a parent (one
 * level), a picture, a line of text, a hidden switch, its search-result text,
 * and an order the owner sets by dragging — and every write is one explicit
 * request that says what it changes.
 *
 * In the owner's screens these are "קטגוריות"; in the code and in the
 * <bent-store> document they stay "shelves" (catalog.js owns the rules).
 *
 * The id is the category's identity (products, pages and the document name it
 * by that), so the address of a save IS the id: POST …/shelves/<id> creates
 * (`isNew`) or edits exactly that category and never another one. The product
 * editor's inline "new category" form keeps its own small door,
 * POST /admin/api/store/shelves, in store-products.js.
 *
 * Every write ends with the storefront following it: the category pages are
 * put in step and the static site is rebuilt once.
 */

const express = require('express');
const { requireAdmin } = require('../admin-guard');
const kit = require('../store/admin-kit');

const router = express.Router();
const { esc } = kit;

function store() { return require('../store'); }

// what a save may say; the id is the address and the order is /reorder's
const FIELDS = ['label', 'parent', 'summary', 'image', 'hidden', 'seoTitle', 'seoDescription'];
const MAX_REORDER = 2000;

/** Which field a sentence from the catalog is about, so the panel can print it beside that field. */
function fieldOf(message) {
  const m = String(message || '');
  if (/קטגוריית האב|תת-קטגורי/.test(m)) return 'parent';
  if (/תמונה/.test(m)) return 'image';
  if (/מזהה/.test(m)) return 'slug';
  if (/שם/.test(m)) return 'label';
  return '';
}

function refuse(res, message, field, status = 400) {
  res.status(status).json({ ok: false, error: message, field: field || fieldOf(message) || undefined });
}

/**
 * After a category write the storefront follows. `afterShelfChange` is the
 * storefront's own hook (category pages, then one rebuild); a tree that does
 * not have it yet still gets the one rebuild.
 */
function follow(st) {
  try {
    if (typeof st.afterShelfChange === 'function') return !!(st.afterShelfChange() || {}).rebuilt;
    return !!st.refreshNow();
  } catch (e) {
    console.error('[store] the storefront did not follow a category change:', e.message);
    return false;
  }
}

/** A category's public page, or '' while it has none. */
function liveUrl(st, slug) {
  try {
    return typeof st.pages.shelfUrl === 'function' ? String(st.pages.shelfUrl(slug) || '') : '';
  } catch (e) {
    return '';
  }
}

// ── the screen ─────────────────────────────────────────────────────────

/** "12 פעילים · 15 בסך הכול": what shoppers see on it, then everything that sits on it. */
function countCell(sh) {
  const withKids = !sh.depth && sh.total !== sh.count;
  if (!sh.all) {
    return '<span class="faint">' + (withKids ? 'אין מוצרים משלה' : 'אין מוצרים') + '</span>' +
      (withKids ? `<div class="faint">${sh.total} פעילים בתת־הקטגוריות</div>` : '');
  }
  let html = sh.count === 1 ? 'פעיל אחד' : sh.count + ' פעילים';
  if (sh.all !== sh.count) html += ` · <span title="כולל מוסתרים וטיוטות">${sh.all} בסך הכול</span>`;
  if (withKids) html += `<div class="faint">${sh.total} פעילים עם תת־הקטגוריות</div>`;
  return html;
}

function rowHtml(sh, ctx) {
  const name = esc(sh.label);
  const url = ctx.url(sh.slug);
  const up = sh.parent ? ctx.bySlug.get(sh.parent) : null;
  const pill = sh.hidden
    ? ' <span class="pill" title="לא מופיעה בסינון ובאריחי הקטגוריות באתר">מוסתרת</span>'
    : (up && up.hidden ? ' <span class="pill" title="קטגוריית האב מוסתרת, ולכן גם זו אינה מוצגת באתר">מוסתרת עם האב</span>' : '');
  return `<tr class="st-cat-row${sh.depth ? ' is-child' : ''}" data-slug="${esc(sh.slug)}">
        <td class="st-cat-move"><div class="st-cat-movebox">
          <span class="st-cat-grip" draggable="true" title="גרירה לשינוי הסדר" aria-hidden="true">⠿</span>
          <button type="button" class="icon-btn" data-move="up" title="למעלה" aria-label="העלאת ${name} מקום אחד">↑</button>
          <button type="button" class="icon-btn" data-move="down" title="למטה" aria-label="הורדת ${name} מקום אחד">↓</button>
        </div></td>
        <td class="st-cat-pic">${sh.image ? `<img class="st-thumb" src="${esc(sh.image)}" alt="" loading="lazy">` : '<span class="st-thumb st-cat-nopic" aria-hidden="true"></span>'}</td>
        <td class="st-cat-name"><div class="st-cat-title"><b>${name}</b>${pill}</div><div class="faint"><span dir="ltr">${esc(sh.slug)}</span></div></td>
        <td class="st-cat-count">${countCell(sh)}</td>
        <td class="st-cat-acts"><div class="row">
          ${url ? `<a class="btn xs secondary" href="${esc(url)}" target="_blank" rel="noopener">באתר ↗</a>` : ''}
          <a class="btn xs secondary" href="/admin/store/products?shelf=${encodeURIComponent(sh.slug)}">למוצרים</a>
          <button type="button" class="btn xs secondary" data-edit>עריכה</button>
          <button type="button" class="btn xs secondary" data-delete>מחיקה</button>
        </div></td>
      </tr>`;
}

router.get('/admin/store/shelves', requireAdmin, (req, res) => {
  const st = store();
  const list = st.catalog.listShelves();
  const ctx = { url: (slug) => liveUrl(st, slug), bySlug: new Map(list.map((s) => [s.slug, s])) };
  // one <tbody> per top-level category: it travels with its sub-categories when it is moved
  const groups = [];
  for (const sh of list) {
    if (!sh.depth) groups.push({ top: sh, rows: [] });
    groups[groups.length - 1].rows.push(rowHtml(sh, ctx));
  }
  const table = list.length ? `
      <div class="st-cat-scroll">
      <table class="tbl st-cat-table" id="st-cat-table">
        <thead><tr><th class="st-cat-move" aria-label="סדר"></th><th class="st-cat-pic" aria-label="תמונה"></th><th>קטגוריה</th><th>מוצרים</th><th aria-label="פעולות"></th></tr></thead>
        ${groups.map((g) => `<tbody class="st-cat-group" data-group="${esc(g.top.slug)}">
      ${g.rows.join('\n      ')}
        </tbody>`).join('\n        ')}
      </table>
      </div>`
    : `
      <div class="empty-state">
        <p>עוד אין קטגוריות. קטגוריה היא מדף בחנות: אפשר לסנן לפיה, לתת לה תמונה ותיאור, ולקבל לה דף משלה.</p>
        <button type="button" class="btn" data-shelf-new>+ קטגוריה חדשה</button>
      </div>`;

  const body = `
    <section class="card st-cats" id="st-cats" data-shelves="${esc(JSON.stringify(list))}">
      <div class="st-cat-headline">
        <p class="lead">${list.length ? 'הסדר כאן הוא הסדר באתר: גוררים את ⠿ או לוחצים ↑ ↓. תת־קטגוריה נשארת תחת הקטגוריה שלה.' : ''}</p>
        <p class="st-cat-out" id="st-cat-out" aria-live="polite"></p>
      </div>${table}
    </section>

    <div class="modal st-cat-dialog" id="st-cat-editor" role="dialog" aria-modal="true" aria-labelledby="st-cat-editor-title">
      <form class="modal-content" id="st-cat-form" onsubmit="return false" novalidate>
        <div class="st-cat-dialog-head"><h3 class="sub-head" id="st-cat-editor-title">קטגוריה חדשה</h3><button type="button" class="icon-btn" data-close aria-label="סגירה">✕</button></div>
        <div class="st-cat-dialog-body st-cat-form">
          <div class="st-cat-form-2">
            <label class="st-cat-field"><span>שם *</span>
              <input class="input" name="label" maxlength="60" autocomplete="off">
              <span class="st-cat-field-err" data-err="label" role="alert"></span></label>
            <label class="st-cat-field"><span>מזהה</span>
              <input class="input" name="slug" dir="ltr" maxlength="80" autocomplete="off" spellcheck="false" placeholder="ייווצר מהשם">
              <span class="st-cat-field-err" data-err="slug" role="alert"></span></label>
          </div>
          <label class="st-cat-field"><span>קטגוריית־אב</span>
            <select class="input" name="parent"></select>
            <span class="st-cat-field-help" data-parent-help hidden>לקטגוריה עם תת־קטגוריות אי אפשר לקבוע אב</span>
            <span class="st-cat-field-err" data-err="parent" role="alert"></span></label>
          <div class="st-cat-field"><label for="st-cat-image">תמונה</label>
            <div class="st-cat-image">
              <span class="st-thumb st-cat-nopic" data-thumb><img alt=""></span>
              <input class="input" id="st-cat-image" name="image" dir="ltr" maxlength="500" autocomplete="off" placeholder="/assets/…">
              <button type="button" class="btn sm secondary" data-media-pick="st-cat-image">🖼 בחירה</button>
              <button type="button" class="btn sm secondary" data-image-clear title="בלי תמונה" aria-label="הסרת התמונה">✕</button>
            </div>
            <span class="st-cat-field-err" data-err="image" role="alert"></span></div>
          <label class="st-cat-field"><span class="st-cat-field-top"><span>תיאור קצר</span><span class="st-cat-counter" data-count="summary"></span></span>
            <textarea class="input" name="summary" rows="2" maxlength="300"></textarea></label>
          <div class="st-cat-field">
            <label class="check-row"><input type="checkbox" name="hide"> מוסתרת מהאתר</label>
            <span class="st-cat-field-help">לא תופיע בסינון ובאריחי הקטגוריות; המוצרים שלה נשארים בחנות.</span></div>
          <fieldset class="st-cat-fieldset"><legend>תצוגה בגוגל (SEO)</legend>
            <label class="st-cat-field"><span class="st-cat-field-top"><span>כותרת</span><span class="st-cat-counter" data-count="seoTitle"></span></span>
              <input class="input" name="seoTitle" maxlength="70" autocomplete="off" placeholder="ריק = שם הקטגוריה"></label>
            <label class="st-cat-field"><span class="st-cat-field-top"><span>תיאור</span><span class="st-cat-counter" data-count="seoDescription"></span></span>
              <textarea class="input" name="seoDescription" rows="2" maxlength="160" placeholder="ריק = התיאור הקצר"></textarea></label>
          </fieldset>
        </div>
        <div class="st-cat-dialog-foot"><span id="st-cat-form-out" aria-live="polite"></span>
          <span class="row"><button type="button" class="btn secondary" data-close>ביטול</button><button type="submit" class="btn" id="st-cat-save">שמירה</button></span></div>
      </form>
    </div>

    <div class="modal st-cat-dialog st-cat-dialog-narrow" id="st-cat-delete" role="dialog" aria-modal="true" aria-labelledby="st-cat-delete-title">
      <div class="modal-content">
        <div class="st-cat-dialog-head"><h3 class="sub-head" id="st-cat-delete-title">מחיקת קטגוריה</h3><button type="button" class="icon-btn" data-close aria-label="סגירה">✕</button></div>
        <div class="st-cat-dialog-body">
          <p class="st-cat-del-count" data-del-count></p>
          <label class="st-cat-field" data-del-move><span>להעביר אותם אל</span>
            <select class="input" name="moveTo"></select></label>
          <p class="st-cat-field-help" data-del-kids>תת־הקטגוריות יעלו לרמה הראשית.</p>
          <p class="st-cat-field-help">המוצרים עצמם לא נמחקים.</p>
        </div>
        <div class="st-cat-dialog-foot"><span id="st-cat-delete-out" aria-live="polite"></span>
          <span class="row"><button type="button" class="btn secondary" data-close>ביטול</button><button type="button" class="btn danger" id="st-cat-delete-go">מחיקה</button></span></div>
      </div>
    </div>

    <script src="/admin-media-picker.js"></script>
    <script src="/admin-store-shelves.js"></script>`;
  res.send(kit.screen({
    key: 'store-shelves', title: 'קטגוריות', body,
    actions: '<button type="button" class="btn" data-shelf-new>+ קטגוריה חדשה</button>'
  }));
});

// ── API ────────────────────────────────────────────────────────────────

router.get('/admin/api/store/shelves', requireAdmin, (req, res) => {
  try {
    res.json({ ok: true, shelves: store().catalog.listShelves() });
  } catch (e) { refuse(res, e.message, '', 500); }
});

// Before /:slug. A category may itself be called "reorder": a body with no
// list of ids is not an order, so it falls through to the save below.
router.post('/admin/api/store/shelves/reorder', requireAdmin, (req, res, next) => {
  const slugs = req.body && req.body.slugs;
  if (!Array.isArray(slugs)) return next();
  try {
    const st = store();
    const shelves = st.catalog.reorderShelves(slugs.slice(0, MAX_REORDER).map((s) => String(s == null ? '' : s)));
    res.json({ ok: true, shelves, rebuilt: follow(st) });
  } catch (e) { refuse(res, e.message); }
});

router.post('/admin/api/store/shelves/:slug', requireAdmin, (req, res) => {
  try {
    const st = store();
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const typed = String(req.params.slug || '').trim();
    let slug = typed;
    if (b.isNew === true) {
      // what a person typed as an id is tidied the way the catalog tidies it
      slug = st.catalog.isSlug(typed) ? typed : st.catalog.slugify(typed);
      if (!st.catalog.isSlug(slug)) return refuse(res, 'מזהה הקטגוריה אינו תקין — אותיות, ספרות ומקפים', 'slug');
      // "new" over an id that is taken would quietly rewrite somebody else's category
      if (st.catalog.getShelf(slug)) return refuse(res, 'כבר יש קטגוריה עם המזהה הזה — בחרו מזהה אחר', 'slug');
    } else if (!st.catalog.getShelf(slug)) {
      return refuse(res, 'הקטגוריה לא נמצאה — אולי נמחקה בחלון אחר', '', 404);
    }
    const input = { slug };
    for (const k of FIELDS) if (b[k] !== undefined) input[k] = b[k];
    const shelf = st.catalog.saveShelf(input);
    const rebuilt = follow(st);
    res.json({ ok: true, shelf, created: b.isNew === true, shelves: st.catalog.listShelves(), rebuilt });
  } catch (e) { refuse(res, e.message); }
});

router.post('/admin/api/store/shelves/:slug/delete', requireAdmin, (req, res) => {
  try {
    const st = store();
    const slug = String(req.params.slug || '');
    const list = st.catalog.listShelves();
    const was = list.find((s) => s.slug === slug);
    if (!was) return refuse(res, 'הקטגוריה לא נמצאה — אולי כבר נמחקה', '', 404);
    const moveTo = String((req.body && req.body.moveTo) || '');
    // the catalog would fall back to "no category" for a target it cannot
    // find — the owner asked for a move, so a missing target is a refusal
    if (moveTo && (moveTo === slug || !list.some((s) => s.slug === moveTo))) {
      return refuse(res, 'הקטגוריה שאליה מעבירים את המוצרים לא נמצאה', 'moveTo');
    }
    // a delete that moves products or frees sub-categories can be put back:
    // the catalog as it was goes on the backups list of the BenTML screen
    let backupId = null;
    if (was.all || list.some((s) => s.parent === slug)) {
      try {
        backupId = st.document.backup('admin:category-delete:' + slug);
      } catch (e) {
        return refuse(res, e.message);
      }
    }
    const r = st.catalog.deleteShelf(slug, { moveTo });
    const rebuilt = follow(st);
    res.json({ ok: true, deleted: r.deleted, moved: r.moved, movedTo: r.movedTo, backupId, shelves: st.catalog.listShelves(), rebuilt });
  } catch (e) { refuse(res, e.message); }
});

module.exports = router;
