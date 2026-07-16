// Tapuz media picker (v0.72) — one shared "grabber" so no admin screen ever
// asks a human to type an image URL by hand. Attach to any input:
//
//   <input id="my-img"> <button data-media-pick="my-img">בחר תמונה</button>
//   <script src="/admin-media-picker.js"></script>
//
// Clicking opens the media library (folders + grid, from /admin/media) with
// an upload drop — picking or uploading writes the URL into the input and
// fires an 'input' event so live previews react.
(function () {
  'use strict';
  var overlay = null;
  var currentCb = null;
  var folder = '';

  function el(tag, css, html) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function close() {
    if (overlay) { overlay.remove(); overlay = null; }
    currentCb = null;
  }

  function pick(url) {
    var cb = currentCb;
    close();
    if (cb) cb(url);
  }

  function load(listEl, crumbEl) {
    listEl.innerHTML = '<div style="grid-column:1/-1;color:#64748b;padding:18px;text-align:center">טוען…</div>';
    fetch('/admin/media?folder=' + encodeURIComponent(folder))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        crumbEl.textContent = '📁 /' + (d.folder || '');
        listEl.innerHTML = '';
        if (folder) {
          var up = el('button', cell() + 'font-size:1.4rem', '⬆️<div style="font-size:.75rem;margin-top:4px">חזרה</div>');
          up.type = 'button';
          up.onclick = function () { folder = folder.split('/').slice(0, -1).join('/'); load(listEl, crumbEl); };
          listEl.appendChild(up);
        }
        (d.folders || []).forEach(function (f) {
          var b = el('button', cell() + 'font-size:1.4rem', '📁<div style="font-size:.75rem;margin-top:4px;word-break:break-all">' + esc(f.name) + '</div>');
          b.type = 'button';
          b.onclick = function () { folder = f.path; load(listEl, crumbEl); };
          listEl.appendChild(b);
        });
        (d.files || []).forEach(function (f) {
          var b = el('button', cell() + 'padding:0;overflow:hidden');
          b.type = 'button';
          b.title = f.name;
          b.innerHTML = '<img src="' + esc(f.url) + '" alt="" style="width:100%;height:76px;object-fit:cover;display:block">' +
            '<div style="font-size:.7rem;padding:4px 6px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(f.name) + '</div>';
          b.onclick = function () { pick(f.url); };
          listEl.appendChild(b);
        });
        if (!(d.folders || []).length && !(d.files || []).length && !folder) {
          listEl.innerHTML = '<div style="grid-column:1/-1;color:#64748b;padding:18px;text-align:center">הספרייה ריקה — העלו תמונה ראשונה למטה 👇</div>';
        }
      })
      .catch(function () {
        listEl.innerHTML = '<div style="grid-column:1/-1;color:#b91c1c;padding:18px;text-align:center">שגיאה בטעינת הספרייה</div>';
      });
  }

  function cell() {
    return 'cursor:pointer;border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:10px 6px;text-align:center;';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function upload(file, listEl, crumbEl, statusEl) {
    if (!file) return;
    statusEl.textContent = 'מעלה…';
    var reader = new FileReader();
    reader.onload = function () {
      fetch('/admin/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, data: reader.result, folder: folder })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok && d.url) { pick(d.url); return; }
        statusEl.textContent = d.error || 'שגיאה בהעלאה';
      }).catch(function () { statusEl.textContent = 'שגיאת רשת'; });
    };
    reader.readAsDataURL(file);
  }

  function open(cb) {
    close();
    currentCb = cb;
    overlay = el('div', 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px');
    var modal = el('div', 'background:#f8fafc;border-radius:14px;max-width:640px;width:100%;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.35)');
    modal.setAttribute('dir', 'rtl');

    var head = el('div', 'display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e2e8f0');
    head.appendChild(el('div', 'font-weight:700', 'בחירת תמונה מהספרייה'));
    var x = el('button', 'border:none;background:none;font-size:1.2rem;cursor:pointer;color:#64748b', '✕');
    x.type = 'button';
    x.onclick = close;
    head.appendChild(x);

    var crumb = el('div', 'padding:8px 18px 0;color:#64748b;font-size:.85rem', '');
    var list = el('div', 'display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;padding:14px 18px;overflow:auto;flex:1');

    var foot = el('div', 'display:flex;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid #e2e8f0');
    var fileIn = el('input', 'flex:1');
    fileIn.type = 'file';
    fileIn.accept = 'image/*';
    var status = el('span', 'color:#64748b;font-size:.85rem', 'או העלו חדשה:');
    foot.appendChild(status);
    foot.appendChild(fileIn);
    fileIn.addEventListener('change', function () { upload(fileIn.files && fileIn.files[0], list, crumb, status); });

    modal.appendChild(head);
    modal.appendChild(crumb);
    modal.appendChild(list);
    modal.appendChild(foot);
    overlay.appendChild(modal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    folder = '';
    load(list, crumb);
  }

  // auto-wire: any <button data-media-pick="input-id"> opens the picker for it
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-media-pick]') : null;
    if (!btn) return;
    e.preventDefault();
    var input = document.getElementById(btn.getAttribute('data-media-pick'));
    if (!input) return;
    open(function (url) {
      input.value = url;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  window.TapuzMediaPicker = { open: open };
})();
