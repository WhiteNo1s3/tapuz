/* /admin/inject — dictionary + roleplay game pack for users to inject into agents.
   v0.55: the "banger" — one copy hands any AI the BenTML tool inventory as a game. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  async function api(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(res.statusText);
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  }

  async function copy(text) {
    await navigator.clipboard.writeText(text);
    const kb = (text.length / 1000).toFixed(1);
    $('status').textContent = `✓ הועתק (${kb}K תווים) — הדביקו בצ׳אט חדש של ה‑AI`;
    $('status').className = 'ok-msg';
    setTimeout(() => {
      $('status').textContent = '';
    }, 4000);
  }

  // free-plan (lite) packs — remembered per browser, appended to pack requests
  const LITE_KEY = 'tapuz-inject-lite';
  function packQuery() {
    const brief = $('brief').value.trim();
    return (brief ? '&brief=' + encodeURIComponent(brief) : '') + ($('lite').checked ? '&size=lite' : '');
  }

  let cache = null;

  async function load() {
    cache = await api('/admin/api/inject-pack');
    $('mod-count').textContent = String(cache.moduleCount || (cache.tools && cache.tools.length) || '—');
    const list = $('tool-list');
    list.innerHTML = (cache.tools || [])
      .map(
        (t) =>
          `<li><code>${t.tool}</code> <span class="muted">${t.title}</span> ${
            t.kind === 'container' ? '<span class="tag">מיכל</span>' : ''
          }</li>`
      )
      .join('');
  }

  $('lite').checked = localStorage.getItem(LITE_KEY) === '1';
  $('lite').onchange = () => localStorage.setItem(LITE_KEY, $('lite').checked ? '1' : '0');

  $('btn-roleplay').onclick = async () => {
    const text = await api('/admin/api/inject-pack?format=roleplay' + packQuery());
    await copy(typeof text === 'string' ? text : text.roleplayMarkdown || text.text);
  };

  $('btn-dict').onclick = async () => {
    const md = await api('/admin/api/syntax-dictionary.md');
    await copy(typeof md === 'string' ? md : md.markdown || JSON.stringify(md));
  };

  $('btn-card').onclick = async () => {
    const brief = $('brief').value.trim();
    const r = await api(
      '/admin/api/inject-pack?format=card' + (brief ? '&brief=' + encodeURIComponent(brief) : '')
    );
    await copy(typeof r === 'string' ? r : r.roleCard || r.text);
  };

  $('btn-preview').onclick = async () => {
    const text = await api('/admin/api/inject-pack?format=roleplay' + packQuery());
    const t = typeof text === 'string' ? text : text.roleplayMarkdown || text.text;
    $('preview').textContent = t.slice(0, 8000) + (t.length > 8000 ? '\n…' : '');
  };

  load().catch((e) => {
    $('status').textContent = e.message;
    $('status').className = 'err-msg';
  });
})();
