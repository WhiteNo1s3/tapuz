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
  function add(sku, variant, qty) {
    var cart = load();
    var hit = null;
    for (var i = 0; i < cart.items.length; i++) {
      if (cart.items[i].sku === sku && (cart.items[i].variant || '') === (variant || '')) { hit = cart.items[i]; break; }
    }
    if (hit) hit.qty = Math.min(99, (hit.qty | 0) + qty);
    else cart.items.push({ sku: sku, variant: variant || '', qty: Math.min(99, qty) });
    save(cart);
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

  function paintCount(cart) {
    var n = count(cart || load());
    var els = document.querySelectorAll('[data-tz-count]');
    for (var i = 0; i < els.length; i++) {
      els[i].textContent = n > 99 ? '99+' : String(n);
      if (n > 0) els[i].removeAttribute('hidden'); else els[i].setAttribute('hidden', '');
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
  function toast(text, withCart) {
    if (!toastEl) {
      toastEl = el('div', 'bent-toast');
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = '';
    toastEl.appendChild(el('span', 'bent-toast-text', text));
    if (withCart) toastEl.appendChild(link(URLS.cart, 'bent-toast-link', 'לעגלה ←'));
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 3200);
  }

  // ── buy buttons, the buy box, the shelf chips ──────────────────────
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;

    var addBtn = t.closest('[data-tz-add]');
    if (addBtn) {
      ev.preventDefault();
      var box = addBtn.closest('[data-tz-buy]');
      var variant = '';
      var qty = 1;
      if (box) {
        var sel = box.querySelector('[data-tz-variant]');
        if (sel) {
          variant = sel.value;
          if (!variant) {
            sel.focus();
            toast('בחרו אפשרות לפני ההוספה לעגלה', false);
            return;
          }
        }
        var q = box.querySelector('[data-tz-qty]');
        if (q) qty = Math.max(1, Math.min(99, parseInt(q.value, 10) || 1));
      }
      add(addBtn.getAttribute('data-sku'), variant, qty);
      toast('✓ ' + (addBtn.getAttribute('data-title') || 'המוצר') + ' נוסף לעגלה', true);
      addBtn.classList.add('is-added');
      setTimeout(function () { addBtn.classList.remove('is-added'); }, 900);
      return;
    }

    var thumb = t.closest('[data-tz-thumb]');
    if (thumb) {
      var buy = thumb.closest('[data-tz-buy]');
      var main = buy && buy.querySelector('.bent-buy-main');
      if (main) main.setAttribute('src', safe(thumb.getAttribute('data-tz-thumb')));
      var all = buy ? buy.querySelectorAll('[data-tz-thumb]') : [];
      for (var i = 0; i < all.length; i++) all[i].classList.toggle('is-on', all[i] === thumb);
      return;
    }

    var chip = t.closest('[data-tz-shelf]');
    if (chip) {
      var shop = chip.closest('[data-tz-shop]');
      if (!shop) return;
      var want = chip.getAttribute('data-tz-shelf');
      var chips = shop.querySelectorAll('[data-tz-shelf]');
      for (var c = 0; c < chips.length; c++) {
        var on = chips[c] === chip;
        chips[c].classList.toggle('is-on', on);
        chips[c].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      var cards = shop.querySelectorAll('.bent-shop-card');
      for (var k = 0; k < cards.length; k++) {
        cards[k].hidden = !!want && cards[k].getAttribute('data-shelf') !== want;
      }
    }
  });

  document.addEventListener('change', function (ev) {
    var sel = ev.target;
    if (!sel || !sel.matches || !sel.matches('[data-tz-variant]')) return;
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

  function qtyControl(line, onChange) {
    var wrap = el('span', 'bent-qty');
    var minus = el('button', 'bent-qty-btn', '−');
    minus.type = 'button';
    minus.setAttribute('aria-label', 'הפחתה');
    var input = el('input', 'bent-qty-input');
    input.type = 'number';
    input.min = '1';
    input.max = String(line.maxQty || 99);
    input.value = String(line.qty);
    input.setAttribute('aria-label', 'כמות');
    input.setAttribute('inputmode', 'numeric');
    var plus = el('button', 'bent-qty-btn', '+');
    plus.type = 'button';
    plus.setAttribute('aria-label', 'הוספה');
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
      rm.setAttribute('aria-label', 'הסרה מהעגלה');
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
    function paint(res) {
      body.textContent = '';
      var q = res && res.quote;
      if (!q) {
        body.appendChild(el('p', 'bent-store-closed', (res && res.message) || 'לא הצלחנו לטעון את העגלה — נסו לרענן.'));
        return;
      }
      adopt(q);
      renderIssues(body, q.issues);
      if (!q.lines.length) {
        var empty = el('div', 'bent-cart-empty');
        empty.appendChild(el('p', '', root.getAttribute('data-empty') || 'העגלה ריקה.'));
        empty.appendChild(link(root.getAttribute('data-shop') || URLS.shop, 'bent-btn', 'לחנות'));
        body.appendChild(empty);
        return;
      }
      var list = el('div', 'bent-cart-lines');
      q.lines.forEach(function (line) {
        list.appendChild(lineRow(line, true, function (n) {
          if (busy) return;
          setQty(line.sku, line.variant, n);
          refresh();
        }));
      });
      body.appendChild(list);
      body.appendChild(totalsRows(q, false));
      var actions = el('div', 'bent-cart-actions');
      actions.appendChild(link(root.getAttribute('data-shop') || URLS.shop, 'bent-btn bent-btn-ghost', 'להמשך קנייה'));
      if (q.open) actions.appendChild(link(root.getAttribute('data-checkout') || URLS.checkout, 'bent-btn', 'למעבר לקופה'));
      body.appendChild(actions);
    }
    function refresh() {
      busy = true;
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
    function paint(q) {
      summary.textContent = '';
      if (!q) { summary.appendChild(el('p', 'bent-store-closed', 'לא הצלחנו לטעון את העגלה — נסו לרענן.')); return; }
      last = q;
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
      if (submit) submit.disabled = !q.open;
    }
    function requote() {
      return post('/api/store/quote', {
        items: load().items, shipping: checked('shipping'), payment: checked('payment'), coupon: coupon
      }).then(function (d) { paint(d && d.quote); return d; }).catch(function () { paint(null); });
    }
    function clearErrors() {
      var errs = root.querySelectorAll('.bent-field-error');
      for (var i = 0; i < errs.length; i++) errs[i].textContent = '';
      var bad = root.querySelectorAll('.bent-field.is-bad');
      for (var j = 0; j < bad.length; j++) bad[j].classList.remove('is-bad');
      if (errorBox) errorBox.textContent = '';
    }
    function markField(name, message) {
      var p = root.querySelector('[data-field="' + name + '"]');
      if (!p) return false;
      p.classList.add('is-bad');
      var slot = p.querySelector('.bent-field-error');
      if (slot) slot.textContent = message;
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
  function mountOrder(root) {
    var body = root.querySelector('[data-tz-order-body]');
    if (!body) return;
    var params = new URLSearchParams(window.location.search);
    var token = params.get('o') || '';
    if (!token) {
      body.textContent = '';
      body.appendChild(el('p', 'bent-store-closed', 'לא נמצאה הזמנה להצגה. הקישור להזמנה נשלח אליכם במייל.'));
      body.appendChild(link(root.getAttribute('data-shop') || URLS.shop, 'bent-btn', 'לחנות'));
      return;
    }
    getJson('/api/store/order/' + encodeURIComponent(token)).then(function (d) {
      body.textContent = '';
      var o = d && d.order;
      if (!o) {
        body.appendChild(el('p', 'bent-store-closed', 'ההזמנה לא נמצאה.'));
        return;
      }
      var head = el('div', 'bent-order-head');
      head.appendChild(el('p', 'bent-order-check', '✓'));
      head.appendChild(el('h2', 'bent-order-title', 'הזמנה #' + o.number));
      head.appendChild(el('p', 'bent-order-status is-' + o.status, o.statusLabel + (o.paid ? ' · שולמה' : '')));
      if (o.status === 'new') head.appendChild(el('p', 'bent-order-thanks', o.thanks));
      else head.appendChild(el('p', 'bent-order-thanks', o.statusText));
      if (o.tracking) head.appendChild(el('p', 'bent-order-tracking', 'מספר מעקב: ' + o.tracking));
      body.appendChild(head);

      if (o.payment && o.payment.label && !o.paid && o.status !== 'cancelled') {
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
    }).catch(function () {
      body.textContent = '';
      body.appendChild(el('p', 'bent-store-closed', 'לא הצלחנו לטעון את ההזמנה — נסו לרענן.'));
    });
  }

  function boot() {
    paintCount();
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
