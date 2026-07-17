/* Tapuz command palette (v0.88) — the OS key.
 *
 * Ctrl/⌘+K anywhere in the admin: jump to any screen, page, or action from
 * the keyboard — the desktop-app affordance (Builder.io, VS Code, Raycast).
 * Nav + action commands are baked by layout() into window.__TAPUZ_NAV__;
 * the site's pages stream in lazily from /admin/api/pages on first open.
 *
 * UMD: in Node (smoke) it exports {score, rankCommands} with no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TapuzPalette = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Match quality, lower is better; -1 = no match.
   * 0 prefix · 1 word-start · 2 substring · 4 subsequence (loose, last resort).
   */
  function score(q, text) {
    const t = String(text || '').toLowerCase();
    if (!t) return -1;
    if (t.startsWith(q)) return 0;
    for (const w of t.split(/[\s/־-]+/)) if (w.startsWith(q)) return 1;
    if (t.includes(q)) return 2;
    let i = 0;
    for (const ch of t) if (ch === q[i]) i++;
    return i === q.length ? 4 : -1;
  }

  /**
   * @param {string} query
   * @param {Array<{label:string, hint?:string, keywords?:string}>} commands
   * @returns ranked matches (stable within equal scores)
   */
  function rankCommands(query, commands, limit = 12) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return commands.slice(0, limit);
    return commands
      .map((c, idx) => {
        const main = score(q, c.label);
        const aux = Math.max(score(q, c.keywords), score(q, c.hint));
        const best = main >= 0 && (aux < 0 || main <= aux + 2) ? main : aux < 0 ? -1 : aux + 2;
        return { c, idx, s: best };
      })
      .filter((r) => r.s >= 0)
      .sort((a, b) => a.s - b.s || a.idx - b.idx)
      .slice(0, limit)
      .map((r) => r.c);
  }

  // ── Node (smoke) stops here ──
  if (typeof document === 'undefined') return { score, rankCommands };

  const baked = Array.isArray(window.__TAPUZ_NAV__) ? window.__TAPUZ_NAV__ : [];
  let pages = null; // lazy, cached per screen-load
  let openEl = null;
  let active = 0;
  let lastResults = [];

  function allCommands() {
    return pages ? baked.concat(pages) : baked;
  }

  function fetchPages() {
    if (pages) return;
    fetch('/admin/api/pages')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !d.pages) return;
        pages = d.pages.map((p) => ({
          label: p.title || p.full_path,
          hint: '/' + p.full_path + (p.status === 'draft' ? ' · טיוטה' : ''),
          icon: p.status === 'draft' ? '📝' : '📄',
          href: '/admin/edit/' + encodeURIComponent(p.full_path),
          keywords: p.full_path + ' edit page עריכה דף'
        }));
        if (openEl) render(openEl.querySelector('input').value);
      })
      .catch(() => {});
  }

  function render(query) {
    const list = openEl.querySelector('.tzp-list');
    lastResults = rankCommands(query, allCommands());
    active = Math.min(active, Math.max(0, lastResults.length - 1));
    list.innerHTML = lastResults.length
      ? lastResults.map((c, i) =>
          `<div class="tzp-row${i === active ? ' active' : ''}" data-i="${i}">` +
          `<span class="tzp-ico">${c.icon || '·'}</span>` +
          `<span class="tzp-label"></span>` +
          `<span class="tzp-hint"></span></div>`
        ).join('')
      : '<div class="tzp-empty">אין תוצאות — נסו מילה אחרת</div>';
    // labels/hints as textContent — command data never becomes markup
    list.querySelectorAll('.tzp-row').forEach((row, i) => {
      row.querySelector('.tzp-label').textContent = lastResults[i].label;
      row.querySelector('.tzp-hint').textContent = lastResults[i].hint || '';
      row.onmousemove = () => { if (active !== i) { active = i; render(query); } };
      row.onclick = () => go(lastResults[i]);
    });
  }

  function go(cmd) {
    if (!cmd || !cmd.href) return;
    close();
    if (cmd.newTab) window.open(cmd.href, '_blank', 'noopener');
    else window.location.href = cmd.href;
  }

  function open() {
    if (openEl) return;
    fetchPages();
    openEl = document.createElement('div');
    openEl.className = 'tzp-overlay';
    openEl.innerHTML =
      '<div class="tzp-panel" role="dialog" aria-label="חיפוש מהיר">' +
      '<input type="text" placeholder="קפצו לכל מקום — דף, מסך, פעולה…" autocomplete="off" />' +
      '<div class="tzp-list"></div>' +
      '<div class="tzp-foot"><span>↑↓ ניווט</span><span>Enter פתיחה</span><span>Esc סגירה</span></div>' +
      '</div>';
    document.body.appendChild(openEl);
    const input = openEl.querySelector('input');
    input.oninput = () => { active = 0; render(input.value); };
    openEl.onclick = (e) => { if (e.target === openEl) close(); };
    active = 0;
    render('');
    input.focus();
  }

  function close() {
    if (!openEl) return;
    openEl.remove();
    openEl = null;
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
      e.preventDefault();
      openEl ? close() : open();
      return;
    }
    if (!openEl) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, lastResults.length - 1); render(openEl.querySelector('input').value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(openEl.querySelector('input').value); }
    else if (e.key === 'Enter') { e.preventDefault(); go(lastResults[active]); }
  });

  // styles once — the dark-desk OS look (matches the v0.75 design system)
  const css = document.createElement('style');
  css.textContent = [
    '.tzp-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(2px);z-index:9999;direction:rtl}',
    '.tzp-panel{max-width:560px;margin:12vh auto 0;background:#0f172a;border:1px solid #334155;border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.5);overflow:hidden}',
    '.tzp-panel input{width:100%;box-sizing:border-box;padding:15px 18px;background:transparent;border:none;outline:none;color:#e2e8f0;font:600 1.02rem system-ui,sans-serif}',
    '.tzp-panel input::placeholder{color:#475569}',
    '.tzp-list{max-height:46vh;overflow:auto;border-top:1px solid #1e293b}',
    '.tzp-row{display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;color:#cbd5e1;font:500 .92rem system-ui,sans-serif}',
    '.tzp-row.active{background:#1e293b;box-shadow:inset 3px 0 0 var(--admin-accent,#f97316)}',
    '.tzp-ico{width:1.4em;text-align:center;flex:none}',
    '.tzp-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.tzp-hint{margin-inline-start:auto;color:#64748b;font-size:.78rem;direction:ltr;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:45%}',
    '.tzp-empty{padding:22px;text-align:center;color:#64748b;font:500 .9rem system-ui,sans-serif}',
    '.tzp-foot{display:flex;gap:14px;justify-content:center;padding:8px;border-top:1px solid #1e293b;color:#475569;font:500 .72rem system-ui,sans-serif}'
  ].join('');
  document.head.appendChild(css);

  return { score, rankCommands, open, close };
});
