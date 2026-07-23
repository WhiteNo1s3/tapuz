// Tapuz admin navigation (v1.62) — swap the content, keep the shell.
//
// Ben: "site jumps when pressing on admin menu... ajax is an old form of
// refreshing something and not annoying the other part of the site."
//
// Every sidebar click used to be a full document reload: the fixed rail and
// topbar were torn down and rebuilt identically, which the eye reads as a
// jump/flash. Here a click FETCHES the destination and replaces only
// #admin-main; the sidebar and topbar never repaint, so nothing jumps.
//
// This is progressive enhancement: if anything is off — JS error, a redirect
// to login, a modified click, a page with no #admin-main — it falls straight
// back to a normal browser navigation. It can never leave you stuck.
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

  /** Only a same-origin left-click to an /admin screen is swappable. A
   *  modified click (new tab / download), an external link, target=_blank, or
   *  a bare hash is left to the browser untouched. */
  function swappableLink(a, e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey ||
        e.shiftKey || e.altKey) return null;
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return null;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return null;
    var url;
    try { url = new URL(a.href, location.href); } catch (x) { return null; }
    if (url.origin !== location.origin) return null;
    if (url.pathname !== '/admin' && url.pathname.indexOf('/admin/') !== 0) return null;
    return url;
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

  function go(url, push) {
    if (loading) return;
    var full = url.pathname + url.search;
    setLoading(true);
    fetch(full, { headers: { 'X-Tapuz-Nav': '1' }, credentials: 'same-origin' })
      .then(function (r) {
        // a login redirect answers 200 on the login page but has no
        // #admin-main; parse() catches that and we hand off below
        if (!r.ok) throw new Error('http ' + r.status);
        return r.text();
      })
      .then(function (text) {
        var data = parse(text);
        if (!data) { location.href = full; return; }
        if (push) history.pushState({ tapuz: true }, '', full);
        apply(data, url.pathname);
        setLoading(false);
      })
      .catch(function () { location.href = full; });
  }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('.admin-side a, a[data-nav-swap]') : null;
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
