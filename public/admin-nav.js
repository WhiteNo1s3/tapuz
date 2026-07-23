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
    return {
      mainHtml: newMain.innerHTML,
      title: titleEl ? titleEl.textContent : document.title,
      accent: accent,
      actions: actions ? actions.innerHTML : '',
      section: section ? section.textContent : '',
      bodyClass: doc.body ? doc.body.className : ''
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

  /** Move the .active highlight to the sidebar link for this path. The rail
   *  DOM is never replaced, so this is the only thing that changes on it. */
  function setActive(pathname) {
    var links = document.querySelectorAll('.admin-nav a');
    for (var i = 0; i < links.length; i++) {
      var lp;
      try { lp = new URL(links[i].href, location.href).pathname; } catch (e) { lp = ''; }
      links[i].classList.toggle('active', lp === pathname);
    }
  }

  function apply(data, pathname) {
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
    setActive(pathname);
    // #admin-main is reused, not replaced, so the CSS settle animation won't
    // retrigger on its own — force a reflow to replay it.
    main.style.animation = 'none';
    void main.offsetWidth;
    main.style.animation = '';
    // reset to the top of the new screen without the browser's reload jump
    window.scrollTo(0, 0);
  }

  function go(requestUrl, push) {
    if (loading) return;
    var full = requestUrl.pathname + requestUrl.search;
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
        if (!data) { location.href = landedFull; return; }
        if (push) history.pushState({ tapuz: true }, '', landedFull);
        apply(data, url.pathname);
        setLoading(false);
      })
      .catch(function () { location.href = full; });
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
    if (url.pathname === location.pathname && url.search === location.search) return;
    go(url, true);
  }
  window.TapuzNav = { navigate: navigate, swappable: swappableUrl };

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
      return;
    }
    e.preventDefault();
    go(url, true);
  });

  // Back / forward through the swapped history.
  window.addEventListener('popstate', function () {
    var url;
    try { url = new URL(location.href); } catch (e) { return; }
    go(url, false);
  });
})();
