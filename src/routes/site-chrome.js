'use strict';

/**
 * Header & footer (site chrome) — extracted to its own route module in
 * v1.04 (docs/ARCHITECTURE.md's plan, fifth standalone-admin-page
 * extraction). Site-wide chrome every page's layout renders: header
 * tagline/logo/sticky/CTA, footer text/credit/link columns/social links.
 * Not requireAdmin — same tier as theme/SEO editing, already open to
 * editors elsewhere.
 */

const express = require('express');
const { loadConfig, saveConfig } = require('../config');
const { layout, adminNav, accentFor, escapeAdmin, jsonForScript } = require('../admin-ui');

const router = express.Router();

router.get('/admin/site-chrome', (req, res) => {
  const config = loadConfig();
  const header = config.header || {};
  const footer = config.footer || {};
  // Initial state handed to the client builder as a safe JSON island.
  const data = {
    header: {
      tagline: header.tagline || '',
      showLogo: header.showLogo !== false,
      sticky: header.sticky !== false,
      ctaLabel: header.ctaLabel || '',
      ctaUrl: header.ctaUrl || ''
    },
    footer: {
      text: footer.text || '',
      showCredit: footer.showCredit !== false,
      columns: Array.isArray(footer.columns) ? footer.columns : [],
      social: Array.isArray(footer.social) ? footer.social : []
    }
  };
  const inputCss = 'width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;box-sizing:border-box';
  const cardCss = 'background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px;margin-bottom:18px';
  const html = `
    ${adminNav('site-chrome', 'כותרת ותחתית')}
    <div class="container" style="padding-top:28px;max-width:720px;padding-bottom:60px">
      <p style="color:#64748b;margin-top:0">הכותרת והתחתית שייכות לכל האתר — כל דף שנבנה בבונה מופיע בתוכן. השינויים חלים באתר הציבורי אחרי "בנה אתר".</p>

      <section style="${cardCss}">
        <h3 style="margin-top:0">🔝 כותרת עליונה (Header)</h3>
        <label style="display:block;font-weight:600;margin-bottom:4px">תת-כותרת ליד הלוגו</label>
        <input id="h-tagline" value="${escapeAdmin(data.header.tagline)}" placeholder="הבית של המוזיקה" style="${inputCss};margin-bottom:14px">
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:12px">
          <input type="checkbox" id="h-showlogo" ${data.header.showLogo ? 'checked' : ''}> הצג לוגו בכותרת
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:16px">
          <input type="checkbox" id="h-sticky" ${data.header.sticky ? 'checked' : ''}> כותרת "דביקה" (נשארת למעלה בגלילה)
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px">כפתור פעולה — טקסט</label>
            <input id="h-ctalabel" value="${escapeAdmin(data.header.ctaLabel)}" placeholder="צור קשר" style="${inputCss}">
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px">כפתור פעולה — קישור</label>
            <input id="h-ctaurl" dir="ltr" value="${escapeAdmin(data.header.ctaUrl)}" placeholder="/contact" style="${inputCss}">
          </div>
        </div>
        <div style="font-size:0.8rem;color:#94a3b8;margin-top:8px">כפתור הפעולה מופיע רק אם מולאו גם טקסט וגם קישור.</div>
      </section>

      <section style="${cardCss}">
        <h3 style="margin-top:0">🔻 תחתית (Footer)</h3>
        <label style="display:block;font-weight:600;margin-bottom:4px">טקסט תחתית חופשי</label>
        <textarea id="f-text" rows="2" placeholder="רחוב הרצל 1, תל אביב · טל׳ 03-0000000" style="${inputCss};margin-bottom:14px">${escapeAdmin(data.footer.text)}</textarea>
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:6px">
          <input type="checkbox" id="f-credit" ${data.footer.showCredit ? 'checked' : ''}> הצג קרדיט "נבנה עם Tapuz"
        </label>
      </section>

      <section style="${cardCss}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <h3 style="margin:0">🗂️ עמודות קישורים בתחתית</h3>
          <button type="button" class="btn secondary" id="add-col" style="padding:6px 12px">+ עמודה</button>
        </div>
        <p style="color:#64748b;font-size:0.9rem;margin-top:0">כל עמודה = כותרת + רשימת קישורים.</p>
        <div id="cols-wrap"></div>
      </section>

      <section style="${cardCss}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <h3 style="margin:0">🔗 רשתות חברתיות</h3>
          <button type="button" class="btn secondary" id="add-social" style="padding:6px 12px">+ רשת</button>
        </div>
        <div id="social-wrap"></div>
      </section>

      <div style="display:flex;justify-content:flex-end;gap:10px;align-items:center">
        <span id="chrome-status" style="color:#166534;font-size:0.9rem"></span>
        <button type="button" class="btn" id="chrome-save">שמור כותרת ותחתית</button>
      </div>
      <div style="font-size:0.8rem;color:#94a3b8;margin-top:10px;text-align:end">אחרי השמירה לחצו "בנה אתר" (דשבורד) כדי לפרסם לאתר החי.</div>
    </div>

    <script type="application/json" id="chrome-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
    <script>
      (function () {
        var DATA = JSON.parse(document.getElementById('chrome-data').textContent);
        var inputCss = ${jsonForScript(inputCss)};
        var colsWrap = document.getElementById('cols-wrap');
        var socialWrap = document.getElementById('social-wrap');

        function el(tag, attrs, html) {
          var e = document.createElement(tag);
          if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
          if (html != null) e.innerHTML = html;
          return e;
        }
        function xrow() {
          return '<button type="button" class="btn secondary rm" style="padding:6px 10px">✕</button>';
        }

        // ---- Columns ----
        function addColumn(col) {
          col = col || { title: '', links: [] };
          var box = el('div', { 'class': 'chrome-col', style: 'border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:12px;background:#f8fafc' });
          var head = el('div', { style: 'display:flex;gap:8px;margin-bottom:10px' });
          var titleInput = el('input', { placeholder: 'כותרת עמודה', style: inputCss + ';flex:1' });
          titleInput.className = 'col-title';
          titleInput.value = col.title || '';
          var rmCol = el('button', { type: 'button', 'class': 'btn secondary', style: 'padding:6px 10px' }, '✕ עמודה');
          rmCol.addEventListener('click', function () { box.remove(); });
          head.appendChild(titleInput); head.appendChild(rmCol);
          box.appendChild(head);
          var linksWrap = el('div', { 'class': 'links-wrap' });
          box.appendChild(linksWrap);
          var addLink = el('button', { type: 'button', 'class': 'btn secondary', style: 'padding:5px 10px;font-size:0.82rem' }, '+ קישור');
          addLink.addEventListener('click', function () { addLinkRow(linksWrap, {}); });
          box.appendChild(addLink);
          (col.links || []).forEach(function (l) { addLinkRow(linksWrap, l); });
          if (!(col.links || []).length) addLinkRow(linksWrap, {});
          colsWrap.appendChild(box);
        }
        function addLinkRow(wrap, link) {
          var row = el('div', { 'class': 'link-row', style: 'display:flex;gap:8px;margin-bottom:8px' });
          var label = el('input', { placeholder: 'טקסט', style: inputCss + ';flex:1' });
          label.className = 'link-label'; label.value = link.label || '';
          var url = el('input', { placeholder: '/page', dir: 'ltr', style: inputCss + ';flex:1' });
          url.className = 'link-url'; url.value = link.url || '';
          var rm = el('button', { type: 'button', 'class': 'btn secondary', style: 'padding:6px 10px' }, '✕');
          rm.addEventListener('click', function () { row.remove(); });
          row.appendChild(label); row.appendChild(url); row.appendChild(rm);
          wrap.appendChild(row);
        }

        // ---- Social ----
        function addSocial(s) {
          s = s || { network: '', url: '' };
          var row = el('div', { 'class': 'social-row', style: 'display:flex;gap:8px;margin-bottom:8px' });
          var net = el('input', { placeholder: 'Facebook', style: inputCss + ';flex:1' });
          net.className = 'social-net'; net.value = s.network || '';
          var url = el('input', { placeholder: 'https://…', dir: 'ltr', style: inputCss + ';flex:2' });
          url.className = 'social-url'; url.value = s.url || '';
          var rm = el('button', { type: 'button', 'class': 'btn secondary', style: 'padding:6px 10px' }, '✕');
          rm.addEventListener('click', function () { row.remove(); });
          row.appendChild(net); row.appendChild(url); row.appendChild(rm);
          socialWrap.appendChild(row);
        }

        document.getElementById('add-col').addEventListener('click', function () { addColumn(); });
        document.getElementById('add-social').addEventListener('click', function () { addSocial(); });
        (DATA.footer.columns || []).forEach(addColumn);
        (DATA.footer.social || []).forEach(addSocial);

        // ---- Save ----
        function collect() {
          var columns = [].map.call(colsWrap.querySelectorAll('.chrome-col'), function (box) {
            var links = [].map.call(box.querySelectorAll('.link-row'), function (r) {
              return { label: r.querySelector('.link-label').value, url: r.querySelector('.link-url').value };
            }).filter(function (l) { return l.label || l.url; });
            return { title: box.querySelector('.col-title').value, links: links };
          }).filter(function (c) { return c.title || c.links.length; });
          var social = [].map.call(socialWrap.querySelectorAll('.social-row'), function (r) {
            return { network: r.querySelector('.social-net').value, url: r.querySelector('.social-url').value };
          }).filter(function (s) { return s.url; });
          return {
            header: {
              tagline: document.getElementById('h-tagline').value,
              showLogo: document.getElementById('h-showlogo').checked,
              sticky: document.getElementById('h-sticky').checked,
              ctaLabel: document.getElementById('h-ctalabel').value,
              ctaUrl: document.getElementById('h-ctaurl').value
            },
            footer: {
              text: document.getElementById('f-text').value,
              showCredit: document.getElementById('f-credit').checked,
              columns: columns,
              social: social
            }
          };
        }
        document.getElementById('chrome-save').addEventListener('click', function () {
          var status = document.getElementById('chrome-status');
          status.style.color = '#166534'; status.textContent = 'שומר…';
          fetch('/admin/api/site-chrome', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(collect())
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.ok) { status.style.color = '#166534'; status.textContent = 'נשמר ✓'; }
            else { status.style.color = '#b91c1c'; status.textContent = d.error || 'שגיאה'; }
          }).catch(function () { status.style.color = '#b91c1c'; status.textContent = 'שגיאת רשת'; });
        });
      })();
    </script>
  `;
  res.send(layout(html, 'כותרת ותחתית', accentFor('site-chrome')));
});

router.get('/admin/api/site-chrome', (req, res) => {
  try {
    const config = loadConfig();
    res.json({ ok: true, header: config.header || {}, footer: config.footer || {} });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/site-chrome', (req, res) => {
  try {
    const config = loadConfig();
    const b = req.body || {};
    const str = (v) => String(v == null ? '' : v);

    if (b.header && typeof b.header === 'object') {
      const prev = config.header || {};
      config.header = {
        tagline: b.header.tagline !== undefined ? str(b.header.tagline).trim() : (prev.tagline || ''),
        showLogo: b.header.showLogo !== undefined ? !!b.header.showLogo : (prev.showLogo !== false),
        sticky: b.header.sticky !== undefined ? !!b.header.sticky : (prev.sticky !== false),
        ctaLabel: b.header.ctaLabel !== undefined ? str(b.header.ctaLabel).trim() : (prev.ctaLabel || ''),
        ctaUrl: b.header.ctaUrl !== undefined ? str(b.header.ctaUrl).trim() : (prev.ctaUrl || '')
      };
    }

    if (b.footer && typeof b.footer === 'object') {
      const prev = config.footer || {};
      let columns = prev.columns || [];
      if (Array.isArray(b.footer.columns)) {
        columns = b.footer.columns
          .map(c => ({
            title: str(c && c.title).trim(),
            links: (Array.isArray(c && c.links) ? c.links : [])
              .map(l => ({ label: str(l && l.label).trim(), url: str(l && l.url).trim() }))
              .filter(l => l.label || l.url)
          }))
          .filter(c => c.title || c.links.length);
      }
      let social = prev.social || [];
      if (Array.isArray(b.footer.social)) {
        social = b.footer.social
          .map(s => ({ network: str(s && s.network).trim(), url: str(s && s.url).trim() }))
          .filter(s => s.url);
      }
      config.footer = {
        text: b.footer.text !== undefined ? str(b.footer.text) : (prev.text || ''),
        showCredit: b.footer.showCredit !== undefined ? !!b.footer.showCredit : (prev.showCredit !== false),
        columns,
        social
      };
    }

    saveConfig(config);
    res.json({ ok: true, header: config.header, footer: config.footer });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
