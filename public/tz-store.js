/* Tapuziel store — the storefront script (v2.53).
 *
 * Loaded on every page while the store is open (src/store/render.js,
 * renderStoreTag). The cart lives in THIS browser (localStorage) until the
 * shopper orders: only identifiers and quantities — never a price. Every
 * sum on the cart, the checkout and the order page comes back from the
 * server's quote (/api/store/quote), so what a shopper sees is what the
 * order will say.
 *
 * Every string that came from the server is written with textContent —
 * a product name is data, never markup.
 */
(function () {
  'use strict';
  if (window.__tzStore) return;
  window.__tzStore = true;

  var script = document.currentScript || document.querySelector('script[src*="tz-store.js"]');
  var cfg = (script && script.dataset) || {};
  var URLS = {
    cart: cfg.cart || '/cart.html',
    checkout: cfg.checkout || '/checkout.html',
    order: cfg.order || '/order.html',
    shop: cfg.shop || '/shop.html'
  };
  var KEY = 'tz_cart_v1';
  var memory = { items: [] };
  // the same sentence the checkout page prints when it is built with nothing to pay with
  var NO_PAYMENT = 'אין כרגע אמצעי תשלום זמין — אי אפשר להשלים הזמנה.';

  // ── the cart (identifiers + quantities, nothing else) ──────────────
  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      var d = raw ? JSON.parse(raw) : null;
      if (d && Array.isArray(d.items)) return { items: d.items.filter(valid) };
    } catch (e) { /* private mode or a hand-edited value */ }
    return { items: memory.items.slice() };
  }
  function valid(it) {
    return it && typeof it.sku === 'string' && it.sku && (it.qty | 0) > 0;
  }
  function save(cart) {
    memory = { items: cart.items.slice() };
    try { window.localStorage.setItem(KEY, JSON.stringify({ items: cart.items, at: Date.now() })); } catch (e) { /* memory only */ }
    paintCount(cart);
  }
  function count(cart) {
    var n = 0;
    for (var i = 0; i < cart.items.length; i++) n += cart.items[i].qty | 0;
    return n;
  }
  /**
   * Add to the cart — never past `max`, what the server would sell of this
   * product (its stock, its per-order cap). Returns how many really went in:
   * the header count must not promise what the cart page will take back.
   */
  function add(sku, variant, qty, max) {
    var cap = Math.max(1, Math.min(99, max || 99));
    var cart = load();
    var hit = null;
    for (var i = 0; i < cart.items.length; i++) {
      if (cart.items[i].sku === sku && (cart.items[i].variant || '') === (variant || '')) { hit = cart.items[i]; break; }
    }
    var have = hit ? (hit.qty | 0) : 0;
    var take = Math.max(0, Math.min(qty, cap - have));
    if (!take) return 0;
    if (hit) hit.qty = have + take;
    else cart.items.push({ sku: sku, variant: variant || '', qty: take });
    save(cart);
    return take;
  }
  function capText(max) {
    return max === 1 ? 'אפשר להזמין רק יחידה אחת מהמוצר הזה' : 'אפשר להזמין עד ' + max + ' יחידות מהמוצר הזה';
  }
  function setQty(sku, variant, qty) {
    var cart = load();
    cart.items = cart.items.filter(function (it) {
      if (it.sku === sku && (it.variant || '') === (variant || '')) {
        it.qty = qty;
        return qty > 0;
      }
      return true;
    });
    save(cart);
  }
  /** The server's quote is the truth: after it clamps or drops a line, the stored cart follows. */
  function adopt(quote) {
    if (!quote || !Array.isArray(quote.lines)) return;
    save({ items: quote.lines.map(function (l) { return { sku: l.sku, variant: l.variant || '', qty: l.qty }; }) });
  }
  function clear() { save({ items: [] }); }
  /** A cart as one comparable line: what is in it and how many — nothing else. */
  function cartSig(lines) {
    return JSON.stringify((lines || []).map(function (l) { return [l.sku, l.variant || '', l.qty | 0]; }));
  }

  function paintCount(cart) {
    var n = count(cart || load());
    var els = document.querySelectorAll('[data-tz-count]');
    for (var i = 0; i < els.length; i++) {
      els[i].textContent = n > 99 ? '99+' : String(n);
      if (n > 0) els[i].removeAttribute('hidden'); else els[i].setAttribute('hidden', '');
      // the link's name carries the count: a fixed label hid the badge from a screen reader
      var cartLink = els[i].closest ? els[i].closest('.tz-cart-link') : null;
      if (cartLink) cartLink.setAttribute('aria-label', 'עגלת קניות' + (n > 0 ? ' — ' + (n === 1 ? 'פריט אחד' : n + ' פריטים') : ''));
    }
  }

  // ── small DOM helpers (text only) ──────────────────────────────────
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function link(href, cls, text) {
    var a = el('a', cls, text);
    a.setAttribute('href', safe(href));
    return a;
  }
  function safe(href) {
    var s = String(href || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return /^(javascript|data|vbscript):/i.test(s) ? '#' : (s || '#');
  }
  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'bad_reply' }; }).then(function (d) { d.__status = r.status; return d; });
    });
  }
  function getJson(url) {
    return fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (d) { d.__status = r.status; return d; }); });
  }

  var toastEl = null;
  var toastTimer = null;
  // the live region is in the page from boot: one that is created with its
  // first message is often not announced at all
  function ensureToast() {
    if (toastEl || !document.body) return;
    toastEl = el('div', 'bent-toast');
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  function toast(text, withCart) {
    ensureToast();
    toastEl.textContent = '';
    toastEl.appendChild(el('span', 'bent-toast-text', text));
    if (withCart) toastEl.appendChild(link(URLS.cart, 'bent-toast-link', 'לעגלה ←'));
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 3200);
  }

  // ── the grid's toolbar: category chips, sort, search, "show more" ──
  // All of it works on the cards already in the page (a static export has
  // no server to ask): a card is hidden with `hidden`, the order is changed
  // by moving the nodes. Prices are compared as the minor units the server
  // wrote in data-price — never the formatted text.
  var shops = [];
  // a value from the address is looked up as an OWN key only: ?sort=__proto__
  // found Object.prototype, was handed to Array.sort and threw on every click
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function num(card, name) { return parseFloat(card.getAttribute(name)) || 0; }
  function byRank(a, b) { return num(a, 'data-rank') - num(b, 'data-rank'); }
  var SORTS = {
    '': byRank,
    'new': function (a, b) { return num(a, 'data-new') - num(b, 'data-new'); },
    'price-asc': function (a, b) { return num(a, 'data-price') - num(b, 'data-price') || byRank(a, b); },
    'price-desc': function (a, b) { return num(b, 'data-price') - num(a, 'data-price') || byRank(a, b); },
    'name': function (a, b) {
      return String(a.getAttribute('data-title') || '').localeCompare(String(b.getAttribute('data-title') || ''), 'he') || byRank(a, b);
    }
  };
  function listHas(text, sep, want) {
    var parts = String(text || '').toLowerCase().split(sep);
    for (var i = 0; i < parts.length; i++) if (parts[i] === want) return true;
    return false;
  }
  function shopOf(node) {
    var root = node && node.closest ? node.closest('[data-tz-shop]') : null;
    for (var i = 0; i < shops.length; i++) if (shops[i].root === root) return shops[i];
    return null;
  }
  function foundText(n) {
    return n === 0 ? 'לא נמצאו מוצרים מתאימים' : (n === 1 ? 'נמצא מוצר אחד' : 'נמצאו ' + n + ' מוצרים');
  }
  /**
   * Where the keyboard goes on from once a filter was taken off: a filter
   * still in force, else the first card that is showing, else the toolbar.
   * (Never the search box first — on a phone that opens the keyboard.)
   */
  function firstStop(sh) {
    var stop = sh.root.querySelector('[data-tz-unfilter]');
    var kids = sh.grid.children;
    for (var i = 0; i < kids.length && !stop; i++) {
      if (!kids[i].hidden) stop = kids[i].querySelector('a.bent-shop-link, a.bent-shop-add, button[data-tz-add]');
    }
    return stop || sh.root.querySelector('[data-tz-shelf], [data-tz-sort], [data-tz-search]');
  }

  function applyShop(sh, announce) {
    var q = sh.q.toLowerCase().trim();
    var tag = sh.tag.toLowerCase().trim();
    var shelf = sh.shelf.toLowerCase();
    var order = sh.cards.slice().sort(own(SORTS, sh.sort) ? SORTS[sh.sort] : byRank);
    var match = 0;
    var showing = 0;
    for (var i = 0; i < order.length; i++) {
      var card = order[i];
      sh.grid.appendChild(card);
      var ok = (!shelf || listHas(card.getAttribute('data-shelves'), ' ', shelf)) &&
        (!tag || listHas(card.getAttribute('data-tags'), ',', tag)) &&
        (!q || [card.getAttribute('data-title'), card.getAttribute('data-brand'), card.getAttribute('data-tags')].join(' ').toLowerCase().indexOf(q) !== -1);
      if (ok) match++;
      var vis = ok && (!sh.size || match <= sh.shown);
      card.hidden = !vis;
      if (vis) showing++;
    }
    var root = sh.root;
    var known = false;
    var chips = root.querySelectorAll('[data-tz-shelf]');
    for (var c = 0; c < chips.length; c++) {
      var on = (chips[c].getAttribute('data-tz-shelf') || '') === sh.shelf;
      if (on) known = true;
      chips[c].classList.toggle('is-on', on);
      if (chips[c].tagName === 'A') {
        if (on) chips[c].setAttribute('aria-current', 'true'); else chips[c].removeAttribute('aria-current');
      } else {
        chips[c].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    var count = root.querySelector('[data-tz-shop-count]');
    if (count) {
      count.hidden = !(sh.size && match > showing);
      count.textContent = count.hidden ? '' : 'מציג ' + showing + ' מתוך ' + match;
    }
    var moreRow = root.querySelector('[data-tz-more-row]');
    if (moreRow) {
      var left = match - showing;
      moreRow.hidden = left <= 0;
      var moreBtn = moreRow.querySelector('[data-tz-more]');
      if (moreBtn) moreBtn.textContent = 'הצגת עוד (' + Math.min(sh.size || left, left) + ')';
    }
    var none = root.querySelector('[data-tz-shop-none]');
    if (none) none.hidden = match > 0;
    // a filter that no control on the page shows (a tag link, a category
    // without a chip, a search on a grid with no search box) is said in
    // words, with its own way out
    var active = root.querySelector('[data-tz-shop-active]');
    if (active) {
      active.textContent = '';
      var say = function (key, label) {
        var b = el('button', 'bent-shop-chip is-active', label + ' ✕');
        b.type = 'button';
        b.setAttribute('data-tz-unfilter', key);
        b.setAttribute('aria-label', 'הסרת הסינון — ' + label);
        active.appendChild(b);
      };
      if (sh.shelf && !known) say('shelf', 'קטגוריה: ' + (own(sh.names, sh.shelf) ? String(sh.names[sh.shelf] || sh.shelf) : sh.shelf));
      if (sh.tag) say('tag', 'תגית: ' + sh.tag);
      if (sh.q && !root.querySelector('[data-tz-search]')) say('q', 'חיפוש: ' + sh.q);
      active.hidden = !active.firstChild;
    }
    if (announce) {
      var liveEl = root.querySelector('[data-tz-shop-live]');
      if (liveEl) liveEl.textContent = foundText(match);
    }
    if (sh.primary && window.history && window.history.replaceState) {
      try {
        var p = new URLSearchParams(window.location.search);
        var put = function (k, v) { if (v) p.set(k, v); else p.delete(k); };
        put('shelf', sh.shelf); put('tag', sh.tag); put('q', sh.q.trim()); put('sort', sh.sort);
        var qs = p.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
      } catch (e) { /* a sandboxed frame may refuse — the filter still works */ }
    }
  }

  function mountShop(root, primary) {
    var grid = root.querySelector('.bent-shop-grid');
    if (!grid) return;
    var size = parseInt(root.getAttribute('data-page-size'), 10) || 0;
    var names = {};
    try { names = JSON.parse(root.getAttribute('data-shelf-names') || '{}') || {}; } catch (e) { names = {}; }
    var sh = {
      root: root, grid: grid, cards: [].slice.call(grid.querySelectorAll('.bent-shop-card')),
      size: size, shown: size, shelf: '', tag: '', q: '', sort: '', names: names, primary: !!primary
    };
    shops.push(sh);
    if (!primary) return;
    // a category link, a tag link and a shared filtered view all land here
    var p = new URLSearchParams(window.location.search);
    sh.shelf = p.get('shelf') || '';
    sh.tag = p.get('tag') || '';
    sh.q = p.get('q') || '';
    sh.sort = own(SORTS, p.get('sort') || '') ? (p.get('sort') || '') : '';
    var input = root.querySelector('[data-tz-search]');
    if (input && sh.q) input.value = sh.q;
    var sorter = root.querySelector('[data-tz-sort]');
    if (sorter && sh.sort) sorter.value = sh.sort;
    if (sh.shelf || sh.tag || sh.q || sh.sort) applyShop(sh, false);
  }

  var searchTimer = null;
  document.addEventListener('input', function (ev) {
    var box = ev.target;
    if (!box || !box.matches || !box.matches('[data-tz-search]')) return;
    var sh = shopOf(box);
    if (!sh) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      sh.q = String(box.value || '');
      sh.shown = sh.size;
      applyShop(sh, true);
    }, 160);
  });

  // ── the buy box's gallery ──────────────────────────────────────────
  function showThumb(thumb) {
    var buy = thumb.closest('[data-tz-buy]');
    if (!buy) return;
    var all = buy.querySelectorAll('[data-tz-thumb]');
    var at = 0;
    for (var i = 0; i < all.length; i++) {
      var on = all[i] === thumb;
      if (on) at = i;
      all[i].classList.toggle('is-on', on);
      if (on) all[i].setAttribute('aria-current', 'true'); else all[i].removeAttribute('aria-current');
    }
    var main = buy.querySelector('.bent-buy-main');
    if (main) {
      main.setAttribute('src', safe(thumb.getAttribute('data-tz-thumb')));
      // the big picture's name follows the thumb that chose it
      var title = buy.getAttribute('data-title') || '';
      main.setAttribute('alt', at ? title + ' — תמונה ' + (at + 1) : title);
    }
  }
  document.addEventListener('keydown', function (ev) {
    var t = ev.target;
    var thumb = t && t.closest ? t.closest('[data-tz-thumb]') : null;
    if (!thumb) return;
    var all = [].slice.call(thumb.parentNode.querySelectorAll('[data-tz-thumb]'));
    var at = all.indexOf(thumb);
    var rtl = window.getComputedStyle(thumb.parentNode).direction === 'rtl';
    var next = -1;
    if (ev.key === 'ArrowLeft') next = at + (rtl ? 1 : -1);
    else if (ev.key === 'ArrowRight') next = at + (rtl ? -1 : 1);
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = all.length - 1;
    if (next < 0 || next >= all.length || next === at) return;
    ev.preventDefault();
    all[next].focus();
    showThumb(all[next]);
  });

  // ── buy buttons, the quantity stepper, the chips ───────────────────
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;

    var addBtn = t.closest('[data-tz-add]');
    if (addBtn) {
      ev.preventDefault();
      var box = addBtn.closest('[data-tz-buy]');
      var variant = '';
      var qty = 1;
      var max = parseInt(addBtn.getAttribute('data-max'), 10) || 99;
      if (box) {
        var sel = box.querySelector('[data-tz-variant]');
        if (sel) {
          variant = sel.value;
          if (!variant) {
            sel.focus();
            toast('בחרו אפשרות לפני ההוספה לעגלה', false);
            return;
          }
          var chosen = sel.options[sel.selectedIndex];
          if (chosen && chosen.getAttribute('data-max')) max = parseInt(chosen.getAttribute('data-max'), 10) || max;
        }
        var q = box.querySelector('[data-tz-qty]');
        if (q) qty = Math.max(1, Math.min(99, parseInt(q.value, 10) || 1));
      }
      var name = addBtn.getAttribute('data-title') || 'המוצר';
      var took = add(addBtn.getAttribute('data-sku'), variant, qty, max);
      if (!took) {
        toast(capText(max) + (max === 1 ? ' — והיא כבר בעגלה' : ' — והן כבר בעגלה'), true);
        return;
      }
      toast('✓ ' + name + (took < qty ? ' — נוספו ' + took + ' בלבד (' + capText(max) + ')' : ' נוסף לעגלה'), true);
      addBtn.classList.add('is-added');
      setTimeout(function () { addBtn.classList.remove('is-added'); }, 900);
      return;
    }

    var step = t.closest('[data-tz-step]');
    if (step) {
      var wrap = step.closest('.bent-qty');
      var field = wrap && wrap.querySelector('[data-tz-qty]');
      if (field) {
        var top = parseInt(field.max, 10) || 99;
        var want = (parseInt(field.value, 10) || 1) + (step.getAttribute('data-tz-step') === '-1' ? -1 : 1);
        if (want > top) toast(capText(top), false);
        field.value = String(Math.max(1, Math.min(top, want)));
      }
      return;
    }

    var thumb = t.closest('[data-tz-thumb]');
    if (thumb) {
      showThumb(thumb);
      return;
    }

    var chip = t.closest('[data-tz-shelf]');
    if (chip) {
      var sh = shopOf(chip);
      if (!sh) return;
      // a chip may be a link to the category's page; here the grid is
      // filtered in place instead, and the link stays for a page without us
      ev.preventDefault();
      sh.shelf = chip.getAttribute('data-tz-shelf') || '';
      sh.shown = sh.size;
      applyShop(sh, true);
      return;
    }

    var more = t.closest('[data-tz-more]');
    if (more) {
      var shMore = shopOf(more);
      if (!shMore) return;
      var before = shMore.shown;
      shMore.shown += shMore.size || 12;
      applyShop(shMore, false);
      // the keyboard goes on from the first card that just appeared
      var seen = 0;
      var kids = shMore.grid.children;
      for (var k = 0; k < kids.length; k++) {
        if (kids[k].hidden) continue;
        if (seen++ === before) {
          var first = kids[k].querySelector('a.bent-shop-link, .bent-shop-add');
          if (first) first.focus();
          break;
        }
      }
      return;
    }

    var undo = t.closest('[data-tz-unfilter], [data-tz-clear]');
    if (undo) {
      var shUndo = shopOf(undo);
      if (!shUndo) return;
      var key = undo.getAttribute('data-tz-unfilter');
      if (!key || key === 'shelf') shUndo.shelf = '';
      if (!key || key === 'tag') shUndo.tag = '';
      if (!key || key === 'q') {
        shUndo.q = '';
        var searchBox = shUndo.root.querySelector('[data-tz-search]');
        if (searchBox) searchBox.value = '';
      }
      shUndo.shown = shUndo.size;
      // the button that was pressed is about to leave the page (a "✕" chip is
      // rebuilt, "ניקוי" is hidden with its box): the keyboard that stood on
      // it must not fall back to the top of the page
      var held = document.activeElement === undo;
      applyShop(shUndo, true);
      if (held) {
        var stop = firstStop(shUndo);
        if (stop) stop.focus();
      }
    }
  });

  document.addEventListener('change', function (ev) {
    var sel = ev.target;
    if (!sel || !sel.matches) return;
    if (sel.matches('[data-tz-sort]')) {
      var sh = shopOf(sel);
      if (sh) { sh.sort = own(SORTS, sel.value) ? sel.value : ''; applyShop(sh, false); }
      return;
    }
    if (sel.matches('[data-tz-buy] [data-tz-qty]')) {
      // a typed quantity is held to the same limits as the stepper
      var cap = parseInt(sel.max, 10) || 99;
      var typed = parseInt(sel.value, 10) || 1;
      if (typed > cap) toast(capText(cap), false);
      sel.value = String(Math.max(1, Math.min(cap, typed)));
      return;
    }
    if (!sel.matches('[data-tz-variant]')) return;
    var box = sel.closest('[data-tz-buy]');
    var opt = sel.options[sel.selectedIndex];
    var now = box && box.querySelector('.bent-price-now');
    if (now && opt && opt.getAttribute('data-price')) now.textContent = opt.getAttribute('data-price');
    var was = box && box.querySelector('.bent-price-was');
    if (was) was.hidden = !!(opt && opt.value);
    var q = box && box.querySelector('[data-tz-qty]');
    if (q && opt && opt.getAttribute('data-max')) {
      q.max = opt.getAttribute('data-max');
      if ((parseInt(q.value, 10) || 1) > (parseInt(q.max, 10) || 99)) q.value = q.max;
    }
  });

  // ── the cart page ──────────────────────────────────────────────────
  function renderIssues(host, issues) {
    if (!issues || !issues.length) return;
    var ul = el('ul', 'bent-issues');
    ul.setAttribute('role', 'alert');
    for (var i = 0; i < issues.length; i++) ul.appendChild(el('li', '', issues[i].message));
    host.appendChild(ul);
  }

  // every control of a cart line says WHICH product it changes, and carries
  // a key (sku|variant|role) so focus can come back to it after a repaint
  function lineKey(line, role) {
    return line.sku + '|' + (line.variant || '') + '|' + role;
  }
  function qtyControl(line, onChange) {
    var wrap = el('span', 'bent-qty');
    var minus = el('button', 'bent-qty-btn', '−');
    minus.type = 'button';
    minus.setAttribute('aria-label', 'הפחתת הכמות של ' + line.title);
    minus.setAttribute('data-tz-key', lineKey(line, 'minus'));
    var input = el('input', 'bent-qty-input');
    input.type = 'number';
    input.min = '1';
    input.max = String(line.maxQty || 99);
    input.value = String(line.qty);
    input.setAttribute('aria-label', 'כמות — ' + line.title);
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('data-tz-key', lineKey(line, 'qty'));
    var plus = el('button', 'bent-qty-btn', '+');
    plus.type = 'button';
    plus.setAttribute('aria-label', 'הגדלת הכמות של ' + line.title);
    plus.setAttribute('data-tz-key', lineKey(line, 'plus'));
    minus.addEventListener('click', function () { onChange(Math.max(0, line.qty - 1)); });
    plus.addEventListener('click', function () { onChange(Math.min(line.maxQty || 99, line.qty + 1)); });
    input.addEventListener('change', function () { onChange(Math.max(0, Math.min(line.maxQty || 99, parseInt(input.value, 10) || 0))); });
    wrap.appendChild(minus);
    wrap.appendChild(input);
    wrap.appendChild(plus);
    return wrap;
  }

  function lineRow(line, editable, onQty) {
    var row = el('div', 'bent-cart-line');
    var media = el('span', 'bent-cart-media');
    if (line.image) {
      var img = el('img', 'bent-cart-img');
      img.src = safe(line.image);
      img.alt = '';
      img.loading = 'lazy';
      media.appendChild(img);
    }
    row.appendChild(media);
    var name = el('span', 'bent-cart-name');
    if (line.url) name.appendChild(link(line.url, 'bent-cart-link', line.title));
    else name.appendChild(el('span', 'bent-cart-link', line.title));
    if (line.variantLabel) name.appendChild(el('span', 'bent-cart-variant', line.variantLabel));
    name.appendChild(el('span', 'bent-cart-unit', line.unitText + (editable ? '' : ' × ' + line.qty)));
    row.appendChild(name);
    if (editable) {
      row.appendChild(qtyControl(line, onQty));
      var rm = el('button', 'bent-cart-remove', '✕');
      rm.type = 'button';
      rm.setAttribute('aria-label', 'הסרת ' + line.title + ' מהעגלה');
      rm.setAttribute('data-tz-key', lineKey(line, 'remove'));
      rm.addEventListener('click', function () { onQty(0); });
      row.appendChild(el('span', 'bent-cart-total', line.totalText));
      row.appendChild(rm);
    } else {
      row.appendChild(el('span', 'bent-cart-total', line.totalText));
    }
    return row;
  }

  function totalsRows(q, full) {
    var box = el('div', 'bent-totals');
    function row(label, value, cls) {
      var r = el('p', 'bent-totals-row' + (cls ? ' ' + cls : ''));
      r.appendChild(el('span', '', label));
      r.appendChild(el('span', '', value));
      box.appendChild(r);
    }
    row('סכום ביניים', q.subtotalText);
    if (q.discount) row('הנחה' + (q.coupon && q.coupon.ok ? ' (' + q.coupon.code + ')' : ''), q.discountText, 'is-discount');
    if (full && q.needsShipping) row('משלוח', q.shippingText);
    if (full) {
      row('סה״כ לתשלום', q.totalText, 'is-total');
      if (q.vat) box.appendChild(el('p', 'bent-totals-note', (q.vatIncluded ? 'מתוכם מע״מ ' : 'כולל מע״מ ') + '(' + q.vatRate + '%): ' + q.vatText));
      else if (q.vatExempt) box.appendChild(el('p', 'bent-totals-note', 'עוסק פטור — ללא מע״מ'));
    } else {
      box.appendChild(el('p', 'bent-totals-note', q.needsShipping ? 'דמי המשלוח יחושבו בקופה.' : ''));
    }
    return box;
  }

  function mountCart(root) {
    var body = root.querySelector('[data-tz-cart-body]');
    if (!body) return;
    var busy = false;
    // the page's own live region (it sits beside the body, which is rebuilt
    // whole): a quantity that changed is said — the count and the new sum.
    // Not the first paint: nothing changed yet, and the page reads itself.
    var live = root.querySelector('[data-tz-cart-live]');
    var painted = false;
    function say(text) {
      if (live && painted) live.textContent = text;
      painted = true;
    }
    function keyed(key) {
      var all = body.querySelectorAll('[data-tz-key]');
      for (var i = 0; i < all.length; i++) if (all[i].getAttribute('data-tz-key') === key) return all[i];
      return null;
    }
    function paint(res) {
      // the whole cart is rebuilt from the quote; remember where the keyboard was
      var held = document.activeElement && body.contains(document.activeElement)
        ? document.activeElement.getAttribute('data-tz-key') : null;
      body.textContent = '';
      body.removeAttribute('aria-busy');
      var q = res && res.quote;
      if (!q) {
        var failed = (res && res.message) || 'לא הצלחנו לטעון את העגלה — נסו לרענן.';
        body.appendChild(el('p', 'bent-store-closed', failed));
        say(failed);
        return;
      }
      adopt(q);
      var units = count({ items: q.lines });
      say(units ? 'בעגלה ' + (units === 1 ? 'פריט אחד' : units + ' פריטים') + ' — סכום ביניים ' + q.subtotalText : 'העגלה ריקה');
      renderIssues(body, q.issues);
      if (!q.lines.length) {
        var empty = el('div', 'bent-cart-empty');
        empty.appendChild(el('p', '', root.getAttribute('data-empty') || 'העגלה ריקה.'));
        var toShop = link(root.getAttribute('data-shop') || URLS.shop, 'bent-btn', 'לחנות');
        empty.appendChild(toShop);
        body.appendChild(empty);
        if (held) toShop.focus();
        return;
      }
      // two columns on a wide screen: the lines, and a summary card with the
      // sum and the two ways on — not a subtotal stretched across the page
      var layout = el('div', 'bent-cart-layout');
      var list = el('div', 'bent-cart-lines');
      q.lines.forEach(function (line) {
        list.appendChild(lineRow(line, true, function (n) {
          if (busy) return;
          setQty(line.sku, line.variant, n);
          refresh();
        }));
      });
      layout.appendChild(list);
      var side = el('aside', 'bent-cart-summary');
      side.setAttribute('aria-label', 'סיכום העגלה');
      side.appendChild(el('h2', 'bent-checkout-h', 'סיכום'));
      side.appendChild(totalsRows(q, false));
      var actions = el('div', 'bent-cart-actions');
      if (q.open) actions.appendChild(link(root.getAttribute('data-checkout') || URLS.checkout, 'bent-btn', 'למעבר לקופה'));
      actions.appendChild(link(root.getAttribute('data-shop') || URLS.shop, 'bent-btn bent-btn-ghost', 'להמשך קנייה'));
      side.appendChild(actions);
      layout.appendChild(side);
      body.appendChild(layout);
      if (held) {
        // the same control of the same line — or, when that line just left
        // the cart, the first control that is still there
        var back = keyed(held) || body.querySelector('[data-tz-key]');
        if (back) back.focus();
      }
    }
    function refresh() {
      busy = true;
      body.setAttribute('aria-busy', 'true');
      // emptied first, so the same sentence twice in a row is still said twice
      if (live) live.textContent = '';
      post('/api/store/quote', { items: load().items })
        .then(function (d) { busy = false; paint(d); })
        .catch(function () { busy = false; paint(null); });
    }
    refresh();
  }

  // ── the checkout ───────────────────────────────────────────────────
  function mountCheckout(root) {
    var form = root.querySelector('[data-tz-checkout-form]');
    var summary = root.querySelector('[data-tz-summary]');
    var errorBox = root.querySelector('[data-tz-error]');
    var submit = root.querySelector('[data-tz-submit]');
    var couponInput = root.querySelector('input[name="coupon"]');
    var couponMsg = root.querySelector('[data-tz-coupon-msg]');
    var shipBox = root.querySelector('[data-tz-ship-box]');
    var addressBox = root.querySelector('[data-tz-address]');
    var whyBox = root.querySelector('[data-tz-why]');
    if (!form || !summary) return;
    var coupon = '';
    var last = null;
    var sending = false;

    function checked(name) {
      var r = form.querySelector('input[name="' + name + '"]:checked');
      return r ? r.value : '';
    }
    function needsAddress() {
      var r = form.querySelector('input[name="shipping"]:checked');
      return !!(last && last.needsShipping && r && r.getAttribute('data-address') === '1');
    }
    function syncAddress() {
      var need = needsAddress();
      if (addressBox) addressBox.hidden = !need;
      ['city', 'street'].forEach(function (n) {
        var f = form.querySelector('[name="' + n + '"]');
        if (f) f.required = need;
      });
    }
    function syncPayments(q) {
      var box = root.querySelector('[data-tz-pay-choices]');
      if (!box || !q || !Array.isArray(q.payments)) return;
      var want = checked('payment');
      var sig = q.payments.map(function (p) {
        return [p.id, p.kind || '', p.label || '', p.details || '', p.sandbox ? '1' : '0'].join('\t');
      }).join('\n');
      if (box.getAttribute('data-tz-sig') !== sig) {
        var chosen = '';
        q.payments.forEach(function (p) { if (p.id === want) chosen = p.id; });
        if (!chosen && q.payment) chosen = q.payment;
        if (!chosen && q.payments.length) chosen = q.payments[0].id;
        box.textContent = '';
        q.payments.forEach(function (p) {
          var label = el('label', 'bent-choice');
          var input = document.createElement('input');
          input.type = 'radio';
          input.name = 'payment';
          input.value = String(p.id || '');
          if (p.kind) input.setAttribute('data-kind', String(p.kind));
          if (p.id === chosen) input.checked = true;
          label.appendChild(input);
          label.appendChild(el('span', 'bent-choice-label', p.label || p.id || ''));
          if (p.details) label.appendChild(el('span', 'bent-choice-note', p.details));
          if (p.kind === 'card' && (p.maxPayments | 0) > 1) {
            label.appendChild(el('span', 'bent-choice-note', 'עד ' + (p.maxPayments | 0) + ' תשלומים'));
          }
          box.appendChild(label);
        });
        // nothing to pay with is said in words — an empty box reads as a broken page
        if (!q.payments.length) box.appendChild(el('p', 'bent-pay-none', NO_PAYMENT));
        box.setAttribute('data-tz-sig', sig);
      }
      var sandbox = q.payments.some(function (p) { return p.kind === 'paypal' && p.sandbox; });
      var banners = root.querySelectorAll('.bent-test-banner');
      var paypalBanner = null;
      for (var i = 0; i < banners.length; i++) {
        if (banners[i].textContent.indexOf('ארגז חול של PayPal') !== -1) paypalBanner = banners[i];
      }
      if (sandbox && !paypalBanner) {
        paypalBanner = el('p', 'bent-test-banner', 'ארגז חול של PayPal — לא יחויב כסף אמיתי');
        paypalBanner.setAttribute('role', 'status');
        paypalBanner.setAttribute('data-tz-paypal-banner', 'js');
        var formEl = root.querySelector('[data-tz-checkout-form]');
        if (formEl) root.insertBefore(paypalBanner, formEl);
        else root.insertBefore(paypalBanner, root.firstChild);
      } else if (!sandbox && paypalBanner) {
        paypalBanner.remove();
      }
    }
    /** Why an order cannot be placed at all, or '' — said beside the button that is switched off. */
    function blockedWhy(q) {
      var codes = Array.isArray(q.blocking) ? q.blocking : [];
      if (q.noPayment || codes.indexOf('NO_PAYMENT') !== -1 || (Array.isArray(q.payments) && !q.payments.length)) return NO_PAYMENT;
      if (codes.indexOf('TOO_LARGE') !== -1) {
        var said = '';
        (q.issues || []).forEach(function (it) { if (it && it.code === 'TOO_LARGE' && it.message) said = it.message; });
        return said || 'הסכום גדול מדי להזמנה אחת — אפשר לפצל אותה לשתיים.';
      }
      return '';
    }
    function paint(q) {
      summary.textContent = '';
      summary.removeAttribute('aria-busy');
      if (whyBox) whyBox.textContent = '';
      if (!q) { summary.appendChild(el('p', 'bent-store-closed', 'לא הצלחנו לטעון את העגלה — נסו לרענן.')); return; }
      last = q;
      syncPayments(q);
      adopt(q);
      renderIssues(summary, q.issues);
      if (!q.lines.length) {
        summary.appendChild(el('p', '', 'העגלה ריקה.'));
        summary.appendChild(link(root.getAttribute('data-shop') || URLS.shop, 'bent-btn', 'לחנות'));
        if (submit) submit.disabled = true;
        return;
      }
      var list = el('div', 'bent-cart-lines is-compact');
      q.lines.forEach(function (l) { list.appendChild(lineRow(l, false)); });
      summary.appendChild(list);
      summary.appendChild(link(root.getAttribute('data-cart') || URLS.cart, 'bent-summary-edit', 'עריכת העגלה'));
      summary.appendChild(totalsRows(q, true));
      if (shipBox) shipBox.hidden = !q.needsShipping;
      (q.shippingOptions || []).forEach(function (o) {
        var price = root.querySelector('[data-tz-ship-price="' + (window.CSS && CSS.escape ? CSS.escape(o.id) : o.id) + '"]');
        if (price) price.textContent = o.free ? 'חינם ✓' : o.priceText;
      });
      syncAddress();
      if (couponMsg) {
        couponMsg.textContent = q.coupon ? q.coupon.message : '';
        couponMsg.className = 'bent-coupon-msg' + (q.coupon ? (q.coupon.ok ? ' is-ok' : ' is-bad') : '');
      }
      var why = blockedWhy(q);
      if (whyBox) whyBox.textContent = why;
      if (submit && !sending) submit.disabled = !q.open || !!why;
    }
    function requote() {
      summary.setAttribute('aria-busy', 'true');
      return post('/api/store/quote', {
        items: load().items, shipping: checked('shipping'), payment: checked('payment'), coupon: coupon
      }).then(function (d) { paint(d && d.quote); return d; }).catch(function () { paint(null); });
    }
    function clearErrors() {
      var errs = root.querySelectorAll('.bent-field-error');
      for (var i = 0; i < errs.length; i++) errs[i].textContent = '';
      var bad = root.querySelectorAll('.bent-field.is-bad');
      for (var j = 0; j < bad.length; j++) bad[j].classList.remove('is-bad');
      var flagged = root.querySelectorAll('[aria-invalid]');
      for (var k = 0; k < flagged.length; k++) flagged[k].removeAttribute('aria-invalid');
      if (errorBox) errorBox.textContent = '';
    }
    function markField(name, message) {
      var p = root.querySelector('[data-field="' + name + '"]');
      if (!p) return false;
      p.classList.add('is-bad');
      var slot = p.querySelector('.bent-field-error');
      if (slot) slot.textContent = message;
      // the field itself says it is wrong; its description is the error line (aria-describedby, in the markup)
      var input = p.querySelector('input, textarea');
      if (input) input.setAttribute('aria-invalid', 'true');
      return true;
    }

    form.addEventListener('change', function (ev) {
      var n = ev.target && ev.target.name;
      if (n === 'shipping' || n === 'payment') requote();
    });
    var applyBtn = root.querySelector('[data-tz-coupon]');
    if (applyBtn && couponInput) {
      applyBtn.addEventListener('click', function () {
        coupon = String(couponInput.value || '').trim();
        requote();
      });
      couponInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); applyBtn.click(); }
      });
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (sending) return;
      clearErrors();
      var v = function (n) { var f = form.querySelector('[name="' + n + '"]'); return f ? f.value : ''; };
      var missing = false;
      ['name', 'phone'].concat(needsAddress() ? ['city', 'street'] : []).forEach(function (n) {
        if (!String(v(n)).trim()) { markField(n, 'שדה חובה'); missing = true; }
      });
      var terms = form.querySelector('[name="acceptTerms"]');
      if (terms && !terms.checked) { markField('terms', 'יש לאשר את תנאי השימוש'); missing = true; }
      if (missing) {
        if (errorBox) errorBox.textContent = 'יש להשלים כמה פרטים';
        var firstBad = root.querySelector('.bent-field.is-bad input');
        if (firstBad) firstBad.focus();
        return;
      }
      // the order is the cart the summary shows. Every quote leaves the stored
      // cart equal to its own lines, so a difference means the cart changed
      // behind this page (another tab, a page restored by Back): it is quoted
      // again and the shopper presses once more, on the sum now in front of them
      if (!last || cartSig(load().items) !== cartSig(last.lines)) {
        var stale = last ? 'העגלה השתנתה — בדקו את הסיכום ואשרו שוב' : 'הסיכום עוד לא נטען — בדקו אותו ואשרו שוב';
        requote();
        if (errorBox) errorBox.textContent = stale;
        return;
      }
      sending = true;
      if (submit) { submit.disabled = true; submit.textContent = 'שולחים את ההזמנה…'; }
      post('/api/store/checkout', {
        items: load().items,
        shipping: checked('shipping'),
        payment: checked('payment'),
        coupon: coupon,
        customer: { name: v('name'), phone: v('phone'), email: v('email') },
        address: { city: v('city'), street: v('street'), zip: v('zip'), notes: v('notes') },
        note: v('note'),
        acceptTerms: terms ? terms.checked : undefined,
        _hp: v('_hp')
      }).then(function (d) {
        if (d && d.ok) {
          clear();
          var next = d.next || (URLS.order + '?o=' + encodeURIComponent(d.order && d.order.token || ''));
          window.location.href = next + (d.pay ? (next.indexOf('?') === -1 ? '?' : '&') + 'pay=1' : '');
          return;
        }
        sending = false;
        if (submit) { submit.disabled = false; submit.textContent = 'לביצוע ההזמנה'; }
        if (d && d.fields) {
          d.fields.forEach(function (f) { if (!markField(f.field, f.message) && errorBox) errorBox.textContent = f.message; });
        }
        if (d && d.quote) paint(d.quote);
        if (errorBox && !errorBox.textContent) errorBox.textContent = (d && d.message) || 'לא הצלחנו לשלוח את ההזמנה — נסו שוב.';
      }).catch(function () {
        sending = false;
        if (submit) { submit.disabled = false; submit.textContent = 'לביצוע ההזמנה'; }
        if (errorBox) errorBox.textContent = 'שגיאת רשת — ההזמנה לא נשלחה. נסו שוב.';
      });
    });

    requote();
  }

  // ── the order page ─────────────────────────────────────────────────
  // A card order pays from here: the button POSTs the first-party pay
  // action and follows the hosted page it gets back (never a provider URL
  // held by the browser); back from the provider (?paid=back) the page
  // asks the server a few times — the server does the verifying — and then
  // shows paid / failed / try again.
  function mountOrder(root) {
    var body = root.querySelector('[data-tz-order-body]');
    if (!body) return;
    var params = new URLSearchParams(window.location.search);
    var token = params.get('o') || '';
    if (!token) {
      body.textContent = '';
      body.removeAttribute('aria-busy');
      body.appendChild(el('p', 'bent-store-closed', 'לא נמצאה הזמנה להצגה. פתחו את הקישור שקיבלתם בסיום ההזמנה.'));
      body.appendChild(link(root.getAttribute('data-shop') || URLS.shop, 'bent-btn', 'לחנות'));
      return;
    }
    var back = params.get('paid') === 'back';
    var autoPay = params.get('pay') === '1';
    // back from the provider: ask every 3 s, up to 12 times — the server waits
    // out the provider's own callback first (Grow: ~20 s), and this fits it
    var polls = 0;
    var MAX_POLLS = 12;
    var POLL_MS = 3000;
    var starting = false;

    function startCardPayment(card, btn, note) {
      if (starting) return;
      starting = true;
      if (btn) { btn.disabled = true; btn.textContent = 'פותחים את דף התשלום…'; }
      post(card.payUrl, {}).then(function (d) {
        if (d && d.ok && d.url) { window.location.href = safe(d.url); return; }
        starting = false;
        if (btn) { btn.disabled = false; btn.textContent = 'לתשלום בכרטיס אשראי ←'; }
        if (note) note.textContent = (d && d.message) || 'לא הצלחנו לפתוח את דף התשלום — נסו שוב.';
      }).catch(function () {
        starting = false;
        if (btn) { btn.disabled = false; btn.textContent = 'לתשלום בכרטיס אשראי ←'; }
        if (note) note.textContent = 'שגיאת רשת — נסו שוב.';
      });
    }

    function cardBlock(o) {
      var card = o.payment.card || {};
      var pay = el('div', 'bent-order-pay');
      pay.appendChild(el('h3', '', 'תשלום: ' + o.payment.label));
      if (card.test) pay.appendChild(el('p', 'bent-test-banner', 'מצב בדיקות — לא יחויב כסף אמיתי'));
      if (o.payment.details) pay.appendChild(el('p', 'bent-order-pay-details', o.payment.details));
      var waiting = back && card.status === 'pending' && card.verifying && polls < MAX_POLLS;
      if (waiting) {
        polls++;
        pay.appendChild(el('p', 'bent-store-wait', 'מאמתים את התשלום…'));
        setTimeout(load, POLL_MS);
        return pay;
      }
      if (card.message && card.status !== 'none') pay.appendChild(el('p', 'bent-order-pay-state is-' + card.status, card.message));
      if (card.canPay) {
        var note = el('p', 'bent-checkout-error');
        note.setAttribute('role', 'alert');
        var btn = el('button', 'bent-btn bent-order-pay-btn', 'לתשלום בכרטיס אשראי ←');
        btn.type = 'button';
        btn.addEventListener('click', function () { startCardPayment(card, btn, note); });
        pay.appendChild(btn);
        pay.appendChild(note);
        if (autoPay && !back) {
          autoPay = false;
          pay.appendChild(el('p', 'bent-totals-note', 'מעבירים אתכם לדף התשלום…'));
          setTimeout(function () { startCardPayment(card, btn, note); }, 1200);
        }
      } else if (card.status !== 'paid' && card.status !== 'refunded') {
        pay.appendChild(el('p', 'bent-totals-note', 'תשלום בכרטיס אינו זמין כרגע — צרו איתנו קשר להשלמת התשלום.'));
      }
      return pay;
    }

    function paypalSdkOk(pp) {
      if (!pp || !pp.sdk) return false;
      if (pp.sandbox && /^https:\/\/www\.sandbox\.paypal\.com\/sdk\/js\?client-id=[A-Za-z0-9_%.-]+&currency=[A-Z]{3}&intent=capture&components=buttons$/.test(pp.sdk)) return true;
      if (pp.live === true && pp.sandbox === false && /^https:\/\/www\.paypal\.com\/sdk\/js\?client-id=[A-Za-z0-9_%.-]+&currency=[A-Z]{3}&intent=capture&components=buttons$/.test(pp.sdk)) return true;
      return false;
    }

    function paypalBlock(o) {
      var pp = o.payment.paypal || {};
      var pay = el('div', 'bent-order-pay bent-paypal');
      pay.appendChild(el('h3', '', 'תשלום: ' + o.payment.label));
      if (pp.sandbox) pay.appendChild(el('p', 'bent-test-banner', 'ארגז חול של PayPal — לא יחויב כסף אמיתי'));
      if (o.payment.details) pay.appendChild(el('p', 'bent-order-pay-details', o.payment.details));
      if (pp.message) pay.appendChild(el('p', 'bent-order-pay-state is-' + (pp.status || 'none'), pp.message));
      var note = el('p', 'bent-checkout-error');
      note.setAttribute('role', 'alert');
      if (pp.canPay && paypalSdkOk(pp)) {
        var slot = el('div', 'bent-paypal-buttons');
        slot.id = 'tz-paypal-buttons';
        pay.appendChild(slot);
        pay.appendChild(note);
        var s = document.createElement('script');
        s.src = pp.sdk;
        s.onload = function () {
          if (!window.paypal || !window.paypal.Buttons) {
            note.textContent = 'כפתור PayPal לא נטען. אפשר לרענן ולנסות שוב.';
            return;
          }
          var captureTried = false;
          function captureUnknown(said) {
            note.textContent = said || 'לא ידוע אם החיוב עבר — בודקים…';
            load();
          }
          window.paypal.Buttons({
            createOrder: function () {
              return post('/api/store/paypal/create', { token: o.token }).then(function (d) {
                if (!d || !d.ok || !d.orderId) {
                  note.textContent = (d && d.message) || 'לא הצלחנו לפתוח תשלום. לא חויב כלום.';
                  throw new Error('create');
                }
                return d.orderId;
              });
            },
            onApprove: function (data) {
              // from here a capture has been ASKED for. Only the server's own
              // clear "not charged" leaves the button for another try; a reply
              // that failed, could not be read, or says the outcome is unknown
              // is "we do not know" — said so, and the order is loaded again:
              // the server asks PayPal, and the page shows what is true.
              captureTried = true;
              return post('/api/store/paypal/capture', { token: o.token, orderId: data && data.orderID }).then(function (d) {
                if (d && d.ok) { load(); return; }
                if (d && d.message && (d.code === 'FAILED' || d.code === 'RATE_LIMITED')) { note.textContent = d.message; return; }
                captureUnknown(d && d.message);
              }, function () { captureUnknown(''); });
            },
            onCancel: function () {
              note.textContent = 'התשלום בוטל. לא חויב כלום — ההזמנה שמורה ואפשר לנסות שוב.';
              post('/api/store/paypal/cancel', { token: o.token });
            },
            onError: function () {
              if (captureTried) { captureUnknown(''); return; }
              if (!note.textContent) note.textContent = 'התשלום נכשל. לא חויב כלום — אפשר לנסות שוב.';
            }
          }).render('#tz-paypal-buttons');
        };
        s.onerror = function () {
          note.textContent = 'כפתור PayPal לא נטען. אין מפתח ארגז חול זמין, או שהרשת חסמה אותו.';
        };
        document.head.appendChild(s);
      } else if (pp.canPay) {
        note.textContent = 'כפתור PayPal לא זמין. לא חויב כלום.';
        pay.appendChild(note);
      }
      return pay;
    }

    // The demo method ("הדגמה — כסף אמיתי לא עובר"): a button that records a
    // TEST payment on the server and repaints from the order it answers with.
    function demoBlock(o) {
      var demo = o.payment.demo || {};
      var pay = el('div', 'bent-order-pay bent-demo-pay');
      pay.appendChild(el('h3', '', 'תשלום: ' + o.payment.label));
      pay.appendChild(el('p', 'bent-test-banner', 'הדגמה — כסף אמיתי לא עובר'));
      if (o.payment.details) pay.appendChild(el('p', 'bent-order-pay-details', o.payment.details));
      if (demo.paid) {
        pay.appendChild(el('p', 'bent-order-pay-state is-paid', 'שולם (הדגמה) ✓'));
        return pay;
      }
      if (demo.message) pay.appendChild(el('p', 'bent-order-pay-state', demo.message));
      if (demo.canPay) {
        var note = el('p', 'bent-checkout-error');
        note.setAttribute('role', 'alert');
        var btn = el('button', 'bent-btn bent-order-pay-btn', 'לשלם בכסף דמיוני');
        btn.type = 'button';
        btn.addEventListener('click', function () {
          btn.disabled = true;
          note.textContent = '';
          post('/api/store/demo-pay', { token: o.token || token }).then(function (d) {
            if (d && d.ok && d.order) {
              body.textContent = '';
              paint(d.order);
              var done = body.querySelector('.bent-demo-pay .bent-order-pay-state');
              if (done) { done.setAttribute('tabindex', '-1'); done.focus(); }
              return;
            }
            btn.disabled = false;
            note.textContent = (d && d.message) || 'התשלום הדמיוני לא נרשם — נסו שוב.';
          }).catch(function () {
            btn.disabled = false;
            note.textContent = 'שגיאת רשת — נסו שוב.';
          });
        });
        pay.appendChild(btn);
        pay.appendChild(note);
      }
      return pay;
    }

    function paint(o) {
      var head = el('div', 'bent-order-head');
      // the glyph follows the status: a cancelled order does not get a green tick
      var cancelled = o.status === 'cancelled';
      var glyph = el('p', 'bent-order-check' + (cancelled ? ' is-cancelled' : ''), cancelled ? '✕' : '✓');
      glyph.setAttribute('aria-hidden', 'true');
      head.appendChild(glyph);
      head.appendChild(el('h2', 'bent-order-title', 'הזמנה #' + o.number));
      head.appendChild(el('p', 'bent-order-status is-' + o.status, o.statusLabel + (o.paid ? ' · שולמה' : '')));
      if (o.status === 'new') head.appendChild(el('p', 'bent-order-thanks', o.thanks));
      else head.appendChild(el('p', 'bent-order-thanks', o.statusText));
      if (o.tracking) head.appendChild(el('p', 'bent-order-tracking', 'מספר מעקב: ' + o.tracking));
      body.appendChild(head);

      var isCard = o.payment && o.payment.kind === 'card' && o.payment.card;
      var isPaypal = o.payment && o.payment.kind === 'paypal' && o.payment.paypal;
      var isDemo = o.payment && o.payment.kind === 'demo' && o.payment.demo;
      if (isDemo && o.status !== 'cancelled') {
        body.appendChild(demoBlock(o));
      } else if (isPaypal && o.status !== 'cancelled' && (!o.paid || o.payment.paypal.sandbox)) {
        body.appendChild(paypalBlock(o));
      } else if (isCard && o.status !== 'cancelled' && (!o.paid || o.payment.card.test)) {
        body.appendChild(cardBlock(o));
      } else if (o.payment && o.payment.label && !o.paid && o.status !== 'cancelled') {
        var pay = el('div', 'bent-order-pay');
        pay.appendChild(el('h3', '', 'תשלום: ' + o.payment.label));
        if (o.payment.details) pay.appendChild(el('p', 'bent-order-pay-details', o.payment.details));
        if (o.payment.phone) {
          var phone = el('p', 'bent-order-pay-phone', 'מספר: ');
          var num = el('bdi', '', o.payment.phone);
          num.setAttribute('dir', 'ltr');
          phone.appendChild(num);
          pay.appendChild(phone);
        }
        if (o.payment.url) {
          pay.appendChild(link(o.payment.url, 'bent-btn bent-order-pay-btn', 'לתשלום ←'));
          if (params.get('pay') === '1') {
            pay.appendChild(el('p', 'bent-totals-note', 'מעבירים אתכם לדף התשלום…'));
            setTimeout(function () { window.location.href = safe(o.payment.url); }, 1600);
          }
        }
        body.appendChild(pay);
      }

      var list = el('div', 'bent-cart-lines is-compact');
      o.items.forEach(function (it) {
        list.appendChild(lineRow({ title: it.title, variantLabel: it.variantLabel, unitText: it.unitText, qty: it.qty, totalText: it.totalText, image: it.image }, false));
      });
      body.appendChild(list);
      var box = el('div', 'bent-totals');
      function row(label, value, cls) {
        if (!value) return;
        var r = el('p', 'bent-totals-row' + (cls ? ' ' + cls : ''));
        r.appendChild(el('span', '', label));
        r.appendChild(el('span', '', value));
        box.appendChild(r);
      }
      row('סכום ביניים', o.subtotalText);
      row('הנחה' + (o.coupon ? ' (' + o.coupon + ')' : ''), o.discountText, 'is-discount');
      row('משלוח' + (o.shippingLabel ? ' — ' + o.shippingLabel : ''), o.shippingText);
      row('סה״כ', o.totalText, 'is-total');
      if (o.vatText) box.appendChild(el('p', 'bent-totals-note', (o.vatIncluded ? 'מתוכם מע״מ ' : 'כולל מע״מ ') + '(' + o.vatRate + '%): ' + o.vatText));
      body.appendChild(box);
      body.appendChild(el('p', 'bent-totals-note', 'שמרו את הקישור לדף הזה כדי לעקוב אחרי ההזמנה.'));
      body.appendChild(link(root.getAttribute('data-shop') || URLS.shop, 'bent-btn bent-btn-ghost', 'להמשך קנייה'));
    }

    function load() {
      getJson('/api/store/order/' + encodeURIComponent(token)).then(function (d) {
        body.textContent = '';
        body.removeAttribute('aria-busy');
        var o = d && d.order;
        if (!o) {
          body.appendChild(el('p', 'bent-store-closed', 'ההזמנה לא נמצאה.'));
          return;
        }
        paint(o);
      }).catch(function () {
        body.textContent = '';
        body.removeAttribute('aria-busy');
        body.appendChild(el('p', 'bent-store-closed', 'לא הצלחנו לטעון את ההזמנה — נסו לרענן.'));
      });
    }
    load();
  }

  function boot() {
    ensureToast();
    paintCount();
    // the page's address (?shelf= ?tag= ?q= ?sort=) belongs to ONE grid: the
    // first that has a toolbar, else the first on the page
    var grids = document.querySelectorAll('[data-tz-shop]');
    var main = null;
    for (var g = 0; g < grids.length && !main; g++) {
      if (grids[g].querySelector('[data-tz-shelf], [data-tz-sort], [data-tz-search]')) main = grids[g];
    }
    if (!main && grids.length) main = grids[0];
    for (var s = 0; s < grids.length; s++) mountShop(grids[s], grids[s] === main);
    var carts = document.querySelectorAll('[data-tz-cart]');
    for (var i = 0; i < carts.length; i++) mountCart(carts[i]);
    var checkouts = document.querySelectorAll('[data-tz-checkout]');
    for (var j = 0; j < checkouts.length; j++) mountCheckout(checkouts[j]);
    var orders = document.querySelectorAll('[data-tz-order]');
    for (var k = 0; k < orders.length; k++) mountOrder(orders[k]);
  }
  // another tab changed the cart → this tab's badge follows
  window.addEventListener('storage', function (ev) { if (ev.key === KEY) paintCount(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
