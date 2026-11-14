// Tapuz admin navigation (v1.63) — swap the content, keep the shell.
//
// Ben: "site jumps when pressing on admin menu... ajax is an old form of
// refreshing something and not annoying the other part of the site." — then:
// "extend the smooth swap to in-content links too."
//
// v1.62 caught the sidebar. v1.63 catches EVERY in-shell admin link — the
// topbar brand, the dashboard hub cards, cross-links between screens, the
// analytics range tabs, the inbox filter — so the fixed rail and topbar never
// repaint no matter where you click. One document-level listener evaluates
// every anchor; swappableUrl() is the single judge of whether a target is an
// in-shell SCREEN (swap it in) or something that must leave the shell — a file
// download, an API endpoint, or the shell-less builder (let the browser go).
//
// Progressive enhancement throughout: any anchor we can't swap, any fetch
// error, any page that returns without #admin-main (a login redirect, the
// builder) falls straight to a normal browser navigation. It can never strand
// you.
(function () {
  'use strict';
  if (window.__tapuzNavInit) return;   // survive a re-execution during a swap
  window.__tapuzNavInit = true;

  var main = document.getElementById('admin-main');
  if (!main) return;                    // not a sidebar screen — nothing to do

  var loading = false;

  function setLoading(on) {
    loading = on;
    document.body.classList.toggle('nav-loading', on);
  }

  // The builder and the page preview render their OWN chrome (a topbar +
  // #builder-root, no #admin-main, no sidebar). Fetching one would find no swap
  // target and fall back anyway — but that wastes a full fetch of a heavy page
  // before the real navigation. Naming them lets a click go straight to a
  // browser navigation. A missed name here only costs one wasted fetch, never
  // correctness — parse() still catches the absent #admin-main.
  function isShellLess(p) {
    return p === '/admin/new' ||
           p.indexOf('/admin/edit/') === 0 ||
           p.indexOf('/admin/preview/') === 0;
  }

  /** The single source of truth: is this URL an in-shell admin SCREEN whose
   *  #admin-main we can swap in? Not off-site, not an API endpoint, not a file
   *  download (anything with an extension — .csv, .md), not the shell-less
   *  builder. */
  function swappableUrl(url) {
    if (url.origin !== location.origin) return false;
    var p = url.pathname;
    if (p !== '/admin' && p.indexOf('/admin/') !== 0) return false; // admin only
    if (p.indexOf('/admin/api/') === 0) return false;              // endpoints
    var last = p.substring(p.lastIndexOf('/') + 1);
    if (last.indexOf('.') !== -1) return false;                    // downloads
    if (isShellLess(p)) return false;                              // the builder
    return true;
  }

  /** Only a same-origin left-click to a swappable screen is intercepted. A
   *  modified click (new tab / download / middle button), target=_blank, a
   *  download link, a bare hash, an explicit data-nav-full opt-out, or any
   *  non-swappable target is left to the browser untouched. */
  function swappableLink(a, e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey ||
        e.shiftKey || e.altKey) return null;
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return null;
    if (a.closest('[data-nav-full]')) return null;   // explicit "leave the shell"
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return null;
    var url;
    try { url = new URL(a.href, location.href); } catch (x) { return null; }
    return swappableUrl(url) ? url : null;
  }

  /** Pull the swappable parts out of a fetched admin document. Returns null if
   *  it isn't one (a login redirect, an error page, the builder — no
   *  #admin-main), which tells the caller to hand off to a full navigation. */
  function parse(htmlText) {
    var doc = new DOMParser().parseFromString(htmlText, 'text/html');
    var newMain = doc.getElementById('admin-main');
    if (!newMain) return null;
    var accent = '';
    var m = htmlText.match(/--admin-accent:\s*([^;}\s]+)/);
    if (m) accent = m[1];
    var titleEl = doc.querySelector('title');
    var actions = doc.querySelector('.topbar-actions');
    var section = doc.querySelector('.section-title');
    // the SERVER knows which sidebar item this screen belongs to — a product's
    // editor under "מוצרים", the gateway under its settings — and marks it in
    // the document it sends. Read that mark instead of guessing from the path.
    var activeLink = doc.querySelector('.admin-nav a.active');
    return {
      mainHtml: newMain.innerHTML,
      title: titleEl ? titleEl.textContent : document.title,
      accent: accent,
      actions: actions ? actions.innerHTML : '',
      section: section ? section.textContent : '',
      bodyClass: doc.body ? doc.body.className : '',
      activeHref: activeLink ? (activeLink.getAttribute('href') || '') : ''
    };
  }

  /** Scripts inserted via innerHTML never run. Re-create them so they do,
   *  in order, and with src scripts kept synchronous so a data <script> that
   *  precedes its consumer still wins the race. Shared utility scripts that
   *  bind a document-level listener (the media picker) guard themselves against
   *  a second bind, so re-running them here is safe. */
  function runScripts(container) {
    var scripts = Array.prototype.slice.call(container.querySelectorAll('script'));
    scripts.forEach(function (old) {
      var s = document.createElement('script');
      for (var i = 0; i < old.attributes.length; i++) {
        s.setAttribute(old.attributes[i].name, old.attributes[i].value);
      }
      if (old.src) s.async = false;
      else s.textContent = old.textContent;
      old.parentNode.replaceChild(s, old);
    });
  }

  /** Move the .active highlight on the sidebar. The rail DOM is never
   *  replaced, so this is the only thing that changes on it. `activeHref` is
   *  the link the fetched document itself marks active — the same answer a
   *  full load gives. Matching the path alone left nothing highlighted after
   *  a swap to /admin/store/products/<id>, /bentml or /gateway, whose address
   *  is no sidebar link. Path equality stays as the fallback. */
  function setActive(pathname, activeHref) {
    var links = document.querySelectorAll('.admin-nav a');
    var want = pathname;
    if (activeHref) {
      try { want = new URL(activeHref, location.href).pathname; } catch (e) { want = pathname; }
    }
    for (var i = 0; i < links.length; i++) {
      var lp;
      try { lp = new URL(links[i].href, location.href).pathname; } catch (e) { lp = ''; }
      links[i].classList.toggle('active', lp === want);
    }
  }

  /** Bring the element a #fragment names into view, clear of the sticky
   *  topbar. Returns false when the page has no such element. */
  function reveal(hash) {
    var id = String(hash || '').replace(/^#/, '');
    if (!id) return false;
    try { id = decodeURIComponent(id); } catch (e) { /* keep it as written */ }
    var target = document.getElementById(id);
    if (!target) return false;
    var bar = document.querySelector('.topbar');
    var clear = bar ? bar.getBoundingClientRect().height + 12 : 12;
    window.scrollTo(0, Math.max(0, target.getBoundingClientRect().top + window.pageYOffset - clear));
    return true;
  }

  function apply(data, pathname, hash) {
    if (data.accent) document.documentElement.style.setProperty('--admin-accent', data.accent);
    document.title = data.title;
    var section = document.querySelector('.section-title');
    if (section) section.textContent = data.section;
    var actions = document.querySelector('.topbar-actions');
    if (actions) actions.innerHTML = data.actions;
    // body class is empty for sidebar screens; carry it so a screen that sets
    // one (none today, but future-proof) still applies — never carry builder.
    if (data.bodyClass !== 'builder-screen') document.body.className = data.bodyClass;
    main.innerHTML = data.mainHtml;
    runScripts(main);
    setActive(pathname, data.activeHref);
    // #admin-main is reused, not replaced, so the CSS settle animation won't
    // retrigger on its own — force a reflow to replay it.
    main.style.animation = 'none';
    void main.offsetWidth;
    // a link that names a part of the screen (…/settings#payments) lands ON
    // that part; any other swap resets to the top of the new screen without
    // the browser's reload jump. Measured while the animation is off, so its
    // opening 4px shift is not in the number.
    if (!reveal(hash)) window.scrollTo(0, 0);
    main.style.animation = '';
  }

  // what #admin-main shows right now — so a move that only changes the
  // #fragment is told apart from a move to another screen
  var shownFull = location.pathname + location.search;

  function go(requestUrl, push) {
    if (loading) return;
    var full = requestUrl.pathname + requestUrl.search;
    // the fragment never travels to the server (and the response's url comes
    // back without one), so it is carried here, from the click to the swap
    var hash = requestUrl.hash || '';
    setLoading(true);
    fetch(full, { headers: { 'X-Tapuz-Nav': '1' }, credentials: 'same-origin' })
      .then(function (r) {
        // a login redirect answers 200 on the login page but has no
        // #admin-main; parse() catches that and we hand off below
        if (!r.ok) throw new Error('http ' + r.status);
        var landed = r.url || full;   // where the server's redirects took us
        return r.text().then(function (text) { return { text: text, landed: landed }; });
      })
      .then(function (res) {
        var data = parse(res.text);
        // follow the server's redirect into the address bar — a link that 302s
        // to another screen lands there, and a lapsed session lands on login
        var url = requestUrl;
        try { url = new URL(res.landed, location.href); } catch (e) {}
        var landedFull = url.pathname + url.search;
        // a redirect to ANOTHER screen (a lapsed session → login) drops the
        // fragment: it named a part of the screen that was asked for
        var keepHash = url.pathname === requestUrl.pathname ? hash : '';
        if (!data) { location.href = landedFull + keepHash; return; }
        if (push) history.pushState({ tapuz: true }, '', landedFull + keepHash);
        shownFull = landedFull;
        apply(data, url.pathname, keepHash);
        setLoading(false);
      })
      .catch(function () { location.href = full + hash; });
  }

  /** Public hook for in-content navigations that are NOT plain anchors — today
   *  the inbox status filter is a <select onchange>. Swaps when it can,
   *  full-navigates when it can't, no-ops when you are already there. Lives on
   *  window so inline handlers can reach it; the shell script has already
   *  defined it by the time anyone interacts. */
  function navigate(href) {
    var url;
    try { url = new URL(href, location.href); } catch (e) { location.href = href; return; }
    if (!swappableUrl(url)) { location.href = href; return; }
    if (url.pathname === location.pathname && url.search === location.search) {
      showPart(url);   // already on that screen — at most a move to a part of it
      return;
    }
    go(url, true);
  }
  window.TapuzNav = { navigate: navigate, swappable: swappableUrl };

  /** A link to a PART of the screen already shown (…#payments): no fetch.
   *  The fragment goes into the address so Back returns from it, and that
   *  part comes into view below the topbar. Without a fragment: nothing —
   *  a link to where we are neither reloads nor stacks history. */
  function showPart(url) {
    if (!url.hash) return;
    if (url.hash !== location.hash) {
      history.pushState({ tapuz: true }, '', url.pathname + url.search + url.hash);
    }
    reveal(url.hash);
  }

  document.addEventListener('click', function (e) {
    // widened from the sidebar to EVERY anchor — swappableLink is the gate, so
    // a content link to a screen swaps while a download / builder / off-site
    // link falls through to the browser exactly as before
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    var url = swappableLink(a, e);
    if (!url) return;
    if (url.pathname === location.pathname && url.search === location.search) {
      e.preventDefault();     // already here — don't reload, don't stack history
      showPart(url);
      return;
    }
    e.preventDefault();
    go(url, true);
  });

  // Back / forward through the swapped history. A step that only changes the
  // #fragment on the screen already shown needs no fetch; anything else swaps
  // the screen in (and lands on its fragment).
  window.addEventListener('popstate', function () {
    var url;
    try { url = new URL(location.href); } catch (e) { return; }
    if (url.pathname + url.search === shownFull) { reveal(url.hash); return; }
    go(url, false);
  });

  // Twice the BROWSER moves the view by itself: on a history step between two
  // parts of one screen, and on a full load of an address that carries a
  // #fragment. Both times it puts the part flush against the top of the
  // window — under the sticky topbar, its heading hidden. Land it where a
  // swap lands it. (Both events fire after the browser's own move.)
  window.addEventListener('hashchange', function () { reveal(location.hash); });
  window.addEventListener('load', function () { reveal(location.hash); });
})();
