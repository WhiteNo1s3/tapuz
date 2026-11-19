'use strict';

/**
 * Site settings + whole-site package — the eighteenth route-group
 * extraction. The general site-settings page (name, description,
 * homepage, baseUrl, language) and its save API, plus the portable
 * whole-site export/import (the ".pzn is our RPM" pillar, one level up
 * from theme packages) — every route requireAdmin, since import
 * creates/overwrites pages and site config.
 */

const express = require('express');
const { requireAdmin } = require('../admin-guard');
const { loadConfig, saveConfig, normalizeBaseUrl } = require('../config');
const { listPages, getPageByFullPath } = require('../pages');
const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');

const router = express.Router();

router.get('/admin/settings', requireAdmin, (req, res) => {
  const config = loadConfig();
  const publishedPages = listPages().filter((p) => p.status === 'published');
  const autoHome = require('../seo').pickHomePath(publishedPages);
  const homeOptions = [
    `<option value="" ${!config.homepage ? 'selected' : ''}>אוטומטי — זיהוי חכם${autoHome ? ` (כרגע: /${escapeAdmin(autoHome)})` : ' (כרגע: אין — 404 בשורש!)'}</option>`
  ].concat(publishedPages.map((p) =>
    `<option value="${escapeAdmin(p.full_path)}" ${config.homepage === p.full_path ? 'selected' : ''}>${escapeAdmin(p.title)} — /${escapeAdmin(p.full_path)}</option>`
  )).join('');
  const html = `
    ${adminNav('settings', 'הגדרות אתר')}
    <div class="container page-body" style="max-width:620px">
      <p class="lead">הגדרות כלליות של האתר. לוגו וצבעים נמצאים ב<a href="/admin/theme">ערכת הנושא</a>.</p>
      <section class="card">
        <label class="field-label">שם האתר</label>
        <input id="st-title" value="${escapeAdmin(config.title)}" class="input mb">
        <label class="field-label">תיאור האתר</label>
        <textarea id="st-desc" rows="2" class="input mb">${escapeAdmin(config.description)}</textarea>
        <label class="field-label">🏠 דף הבית</label>
        <select id="st-homepage" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:6px">
          ${homeOptions}
        </select>
        <div class="faint" style="margin-bottom:14px">הדף שמוגש בשורש האתר (/). אפשר גם מרשימת הדפים — כפתור 🏠 קבע כדף הבית.</div>
        <label class="field-label">כתובת בסיס (baseUrl)</label>
        <input id="st-baseurl" dir="ltr" value="${escapeAdmin(config.baseUrl || '')}" placeholder="https://example.co.il" class="input mb">
        <label class="field-label">שפה ראשית</label>
        <select id="st-lang" class="input mb">
          <option value="he" ${config.language !== 'en' ? 'selected' : ''}>עברית</option>
          <option value="en" ${config.language === 'en' ? 'selected' : ''}>English</option>
        </select>
        <div class="row end">
          <span id="st-status" class="ok-text"></span>
          <button type="button" class="btn" id="st-save">שמור הגדרות</button>
        </div>
      </section>

      <section class="card" style="margin-top:18px">
        <h3 class="sub-head">🔁 אשף ההקמה — סיבוב נוסף</h3>
        <p class="lead">רוצים לרענן את המראה או להשלים דפי בסיס שחסרים? האשף רץ שוב בבטחה:
        דפים קיימים <b>לא נדרסים</b> — מתעדכנים רק שם האתר, התיאור, ערכת הנושא והתפריט הראשי.</p>
        <a class="btn secondary" href="/admin/setup?again=1">🪄 הרץ את האשף שוב</a>
      </section>

      <section class="card" style="margin-top:18px">
        <h3 class="sub-head">📦 ייצוא / ייבוא אתר שלם</h3>
        <p class="lead">קובץ אחד עם כל הדפים (טיוטה + מפורסם), ערכת הנושא והתפריטים — לגיבוי או להעברה בין התקנות Tapuz. ייבוא לעולם לא דורס דף קיים אלא אם מסמנים "דרוס דפים קיימים".</p>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
          <a class="btn secondary" href="/admin/api/site-package/export" download>⬇ ייצוא האתר</a>
          <a class="btn secondary" href="/admin/api/site-package/export?assets=1" download>⬇ ייצוא עם התמונות</a>
        </div>
        <label class="field-label">ייבוא — הדביקו את תוכן הקובץ (JSON)</label>
        <textarea id="sp-import-text" rows="4" dir="ltr" placeholder='{"format":"tapuz-site", ...}' style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:10px;box-sizing:border-box;font-family:monospace;font-size:0.82rem"></textarea>
        <label class="field-label">או בחרו את הקובץ (חבילה עם תמונות גדולה מדי להדבקה)</label>
        <input type="file" id="sp-import-file" accept=".json,application/json" style="display:block;margin-bottom:12px">
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:10px">
          <input type="checkbox" id="sp-pages-only"> ייבוא דפים בלבד — ערכת הנושא, התפריטים, הגדרות האתר והחנות לא משתנים
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:6px">
          <div>
            <label class="field-label">קידומת לכתובות</label>
            <input id="sp-prefix" dir="ltr" placeholder="en" maxlength="40" class="input">
          </div>
          <div>
            <label class="field-label">שפת הדפים</label>
            <input id="sp-lang" dir="ltr" placeholder="en" maxlength="12" class="input">
          </div>
        </div>
        <div class="faint" style="margin-bottom:12px">עם הקידומת en הדף bridge מגיע לכתובת en-bridge, והקישורים בין הדפים המיובאים מתעדכנים. השפה קובעת גם את כיוון הדף: en משמאל לימין, he מימין לשמאל.</div>
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:10px">
          <input type="checkbox" id="sp-overwrite"> דרוס דפים קיימים (ברירת מחדל: דילוג על התנגשויות)
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:10px">
          <input type="checkbox" id="sp-assets" checked> הביאו גם את התמונות שבחבילה
        </label>
        <label class="field-label">קישור תרגומים — שורה לכל זוג: דף מיובא = דף קיים באתר</label>
        <textarea id="sp-translations" rows="3" dir="ltr" placeholder="en-bridge = הגשר" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:10px;box-sizing:border-box;font-family:monospace;font-size:0.82rem"></textarea>
        <div class="row end">
          <span id="sp-import-status" style="font-size:0.85rem"></span>
          <button type="button" class="btn" id="sp-preview">תצוגה מקדימה</button>
        </div>
        <div id="sp-preview-out" style="margin:10px 0"></div>
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:10px">
          <input type="checkbox" id="sp-confirm"> אני מאשר/ת ייבוא אמיתי — לפני הייבוא נשמרת תמונת מצב של האתר
        </label>
        <div class="row end">
          <button type="button" class="btn secondary" id="sp-import-apply" disabled>ייבוא</button>
        </div>

        <h3 class="sub-head" style="margin-top:22px">↩ תמונות מצב — חזרה למצב שלפני ייבוא</h3>
        <p class="faint">לפני כל ייבוא אמיתי נשמרת תמונת מצב. "שחזר" מחזיר רק את מה שהייבוא הזה כתב: דף שהוא יצר נמחק, דף שהוא דרס חוזר למצבו, והתמונות שהוסיף מוסרות. ערכת הנושא, התפריטים, הגדרות האתר וקטלוג החנות חוזרים רק אחרי ייבוא מלא. דף שהייבוא לא נגע בו נשאר כמו שהוא, והיסטוריית הגרסאות נשמרת. לפני השחזור מוצג מה בדיוק יחזור.</p>
        <div id="sp-snapshots"></div>
      </section>
    </div>
    <script>
      (function () {
        var $ = function (id) { return document.getElementById(id); };
        var status = $('sp-import-status');
        var fileText = '';
        function say(text, bad) { status.textContent = text; status.style.color = bad ? '#b91c1c' : '#166534'; }
        function postJson(url, body) {
          return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(function (r) {
              if (r.status === 413) return { ok: false, error: 'החבילה גדולה מדי לייבוא בבת אחת' };
              return r.json();
            });
        }
        $('sp-import-file').addEventListener('change', function () {
          var f = this.files && this.files[0];
          fileText = '';
          if (!f) return;
          var reader = new FileReader();
          reader.onload = function () { fileText = String(reader.result || ''); say('הקובץ נטען: ' + f.name); };
          reader.onerror = function () { say('לא הצלחנו לקרוא את הקובץ', true); };
          reader.readAsText(f);
        });
        function readOptions() {
          var pkg;
          try { pkg = JSON.parse(fileText || $('sp-import-text').value || ''); } catch (e) { say('לא JSON תקין', true); return null; }
          var translations = {};
          $('sp-translations').value.split('\\n').forEach(function (line) {
            var i = line.indexOf('=');
            if (i < 0) return;
            var from = line.slice(0, i).trim();
            var to = line.slice(i + 1).trim();
            if (from && to) translations[from] = to;
          });
          return {
            package: pkg,
            mode: $('sp-pages-only').checked ? 'pages' : 'full',
            prefix: $('sp-prefix').value.trim(),
            lang: $('sp-lang').value.trim(),
            overwrite: $('sp-overwrite').checked,
            assets: $('sp-assets').checked,
            translations: translations
          };
        }
        // the answer of a dry run or of a real import, as lists — every word
        // from the package goes in as text, never as markup
        var WHY = { exists: 'כבר קיים באתר', duplicate: 'כתובת כפולה בחבילה', store: 'דף של החנות', reserved: 'כתובת שמורה למערכת', error: 'המקור אינו תקין' };
        var WHY_PAIR = { source: 'הדף המיובא לא נמצא', target: 'דף היעד לא קיים באתר', self: 'דף לא מתקשר לעצמו', error: 'הקישור נכשל' };
        function line(out, text, bold) {
          var el = document.createElement('div');
          el.style.cssText = 'margin-top:8px' + (bold ? ';font-weight:700' : '');
          el.textContent = text;
          out.appendChild(el);
        }
        function group(out, title, items) {
          if (!items || !items.length) return;
          line(out, title + ' (' + items.length + ')', true);
          var ul = document.createElement('ul');
          ul.style.cssText = 'margin:4px 0 0;padding-inline-start:20px;font-size:0.88rem';
          items.forEach(function (text) {
            // an English address inside a Hebrew list keeps its own order,
            // and the bullet stays on the list's side
            var li = document.createElement('li');
            var words = document.createElement('bdi');
            words.textContent = text;
            li.appendChild(words);
            ul.appendChild(li);
          });
          out.appendChild(ul);
        }
        function renderReport(d) {
          var out = $('sp-preview-out');
          out.textContent = '';
          out.style.cssText = 'margin:10px 0;padding:12px 14px;border:1.5px solid ' + (d.dryRun ? '#cbd5e1' : '#86efac') + ';border-radius:8px;background:' + (d.dryRun ? '#f8fafc' : '#f0fdf4');
          var dry = d.dryRun;
          var move = function (x) { return x.from === x.path ? x.path : x.from + ' → ' + x.path; };
          line(out, dry ? 'תצוגה מקדימה — שום דבר לא נכתב' : 'הייבוא הושלם ✓', true);
          line(out, d.mode === 'pages'
            ? 'דפים בלבד: ערכת הנושא, התפריטים, הגדרות האתר והחנות לא משתנים.'
            : 'ייבוא מלא: ערכת הנושא, התפריטים והגדרות האתר ' + (dry ? 'יוחלפו' : 'הוחלפו') + ' באלה שבחבילה, והחנות שבה ' + (dry ? 'תתמזג' : 'התמזגה') + ' בחנות האתר.');
          group(out, dry ? 'דפים שייווצרו' : 'דפים שנוצרו', d.created.map(move));
          group(out, dry ? 'דפים שיידרסו' : 'דפים שנדרסו', d.overwritten.map(move));
          group(out, dry ? 'דפים שידולגו' : 'דפים שדולגו', d.skipped.map(function (x) {
            return move(x) + ' — ' + (WHY[x.reason] || x.reason) + (x.reason === 'error' && x.message ? ': ' + x.message : '');
          }));
          group(out, 'כתובת שמורה — הדף מקבל שם אחר', d.renamed.map(move));
          group(out, dry ? 'תרגומים שיקושרו' : 'תרגומים שקושרו', d.translations.linked.map(function (x) { return x.path + ' ⇄ ' + x.target; }));
          group(out, 'תרגומים שלא קושרו', d.translations.missing.map(function (x) { return x.source + ' = ' + x.target + ' — ' + (WHY_PAIR[x.reason] || x.reason); }));
          group(out, dry ? 'תמונות שיתווספו' : 'תמונות שנוספו', d.assets.added);
          group(out, 'תמונות שכבר באתר (אותו קובץ)', d.assets.reused);
          group(out, 'תמונות בשם חדש (באתר יש קובץ אחר באותו שם)', d.assets.renamed.map(function (x) { return x.from + ' → ' + x.to; }));
          group(out, 'קבצים שנדחו', d.assets.rejected.map(function (x) { return x.path + ' — ' + x.reason; }));
          group(out, 'תמונות חסרות — לא בחבילה ולא באתר', d.assets.missing);
          line(out, 'קישורים פנימיים ' + (dry ? 'שיעודכנו' : 'שעודכנו') + ': ' + d.linkRewrites);
        }
        function send(apply) {
          var o = readOptions();
          if (!o) return;
          if (apply) o.apply = true;
          say(apply ? 'מייבא…' : 'בודק…');
          postJson('/admin/api/site-package/import', o).then(function (d) {
            if (!d.ok) { say(d.error || 'שגיאה', true); return; }
            renderReport(d);
            if (d.dryRun) { say('זו תצוגה מקדימה — שום דבר לא נכתב'); return; }
            $('sp-confirm').checked = false;
            $('sp-import-apply').disabled = true;
            if (d.rebuildError) say('יובא, אבל האתר לא נבנה מחדש: ' + d.rebuildError, true);
            else say('הושלם ✓ נוצרו ' + d.created.length + ', נדרסו ' + d.overwritten.length + ', דולגו ' + d.skipped.length);
            loadSnapshots();
          }).catch(function () { say('שגיאת רשת', true); });
        }
        // preview is the default action; a real import waits for the confirm
        $('sp-preview').addEventListener('click', function () { send(false); });
        $('sp-confirm').addEventListener('change', function () { $('sp-import-apply').disabled = !this.checked; });
        $('sp-import-apply').addEventListener('click', function () { if ($('sp-confirm').checked) send(true); });

        function loadSnapshots() {
          fetch('/admin/api/site-package/snapshots').then(function (r) { return r.json(); }).then(function (d) {
            var box = $('sp-snapshots');
            box.textContent = '';
            var list = (d && d.snapshots) || [];
            if (!list.length) {
              var none = document.createElement('p');
              none.className = 'faint';
              none.textContent = 'אין עדיין תמונות מצב.';
              box.appendChild(none);
              return;
            }
            list.forEach(function (s) {
              var when = s.at ? new Date(s.at).toLocaleString('he-IL') : s.id;
              var what = String(s.reason || '').indexOf('pre-restore') === 0 ? 'לפני שחזור' : (s.mode === 'pages' ? 'לפני ייבוא דפים' : 'לפני ייבוא מלא');
              var row = document.createElement('div');
              row.style.cssText = 'display:flex;gap:10px;align-items:center;justify-content:space-between;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;margin-bottom:6px';
              var label = document.createElement('span');
              label.style.fontSize = '0.88rem';
              label.textContent = when + ' — ' + what + ' · ' + s.pages + ' דפים';
              var btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'btn sm secondary';
              btn.textContent = 'שחזר';
              btn.addEventListener('click', function () { restore(s); });
              row.appendChild(label);
              row.appendChild(btn);
              box.appendChild(row);
            });
          }).catch(function () { /* the list is a convenience; the import still works */ });
        }
        function rollbackWarning(s) {
          var when = s.at ? new Date(s.at).toLocaleString('he-IL') : s.id;
          var rb = s.rollback || {};
          var pages = rb.pages || [];
          var lines = [];
          lines.push('לשחזר את המצב של ' + when + '?');
          lines.push('יחזור רק מה שהפעולה הזו כתבה. דף שהיא לא נגעה בו נשאר כמו שהוא.');
          if (!pages.length) {
            lines.push('דפים: לא נרשמו דפים לשחזור — אף דף לא ישתנה.');
          } else {
            lines.push('דפים (' + pages.length + '):');
            pages.forEach(function (p) {
              lines.push('• ' + p.path + ' — ' + (p.action === 'delete' ? 'יימחק, כי לא היה קיים בתמונה הזו' : 'יחזור למצב שנשמר בתמונה הזו'));
            });
          }
          var parts = [];
          if (rb.theme) parts.push('ערכת הנושא');
          if (rb.menus) parts.push('התפריטים');
          if (rb.config) parts.push('הגדרות האתר');
          if (rb.store) parts.push('קטלוג החנות');
          if (parts.length) lines.push('גם יוחזרו: ' + parts.join(', ') + '.');
          else lines.push('ערכת הנושא, התפריטים, הגדרות האתר וקטלוג החנות לא כלולים.');
          if (rb.assetsRemoved) lines.push('יוסרו ' + rb.assetsRemoved + ' תמונות שהפעולה הוסיפה.');
          if (rb.assetsRestored) lines.push('יוחזרו ' + rb.assetsRestored + ' תמונות שהוסרו.');
          lines.push('היסטוריית הגרסאות נשמרת. לפני השחזור נשמרת תמונת מצב נוספת, כך שאפשר לבטל גם אותו.');
          return lines.join('\\n');
        }
        function restore(s) {
          if (!window.confirm(rollbackWarning(s))) return;
          say('משחזר…');
          postJson('/admin/api/site-package/restore', { snapshotId: s.id }).then(function (d) {
            if (!d.ok) { say(d.error || 'שגיאה', true); return; }
            $('sp-preview-out').textContent = '';
            $('sp-preview-out').style.cssText = 'margin:10px 0';
            var removed = (d.removedPages && d.removedPages.length) || 0;
            var restored = (d.restoredPages && d.restoredPages.length) || 0;
            if (d.rebuildError) say('שוחזר, אבל האתר לא נבנה מחדש: ' + d.rebuildError, true);
            else say('שוחזר ✓ ' + d.pages + ' דפים באתר' + (removed ? ', הוסרו ' + removed : '') + (restored ? ', הוחזרו ' + restored : ''));
            loadSnapshots();
          }).catch(function () { say('שגיאת רשת', true); });
        }
        loadSnapshots();
      })();
      document.getElementById('st-save').addEventListener('click', function () {
        fetch('/admin/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: document.getElementById('st-title').value,
            description: document.getElementById('st-desc').value,
            homepage: document.getElementById('st-homepage').value,
            baseUrl: document.getElementById('st-baseurl').value,
            language: document.getElementById('st-lang').value
          })
        }).then(function (r) { return r.json(); }).then(function (d) {
          var st = document.getElementById('st-status');
          if (!d.ok) { st.textContent = d.error || 'שגיאה'; return; }
          if (typeof d.baseUrl === 'string') document.getElementById('st-baseurl').value = d.baseUrl;
          st.textContent = d.rebuildError ? ('נשמר, אבל האתר לא נבנה מחדש: ' + d.rebuildError) : 'נשמר ✓ האתר עודכן';
        }).catch(function () { document.getElementById('st-status').textContent = 'שגיאת רשת'; });
      });
    </script>
  `;
  res.send(layout(html, 'הגדרות אתר', accentFor('settings')));
});

router.post('/admin/api/settings', requireAdmin, (req, res) => {
  try {
    const config = loadConfig();
    const b = req.body || {};
    if (b.title !== undefined) config.title = String(b.title || '').trim() || config.title;
    if (b.description !== undefined) config.description = String(b.description || '');
    // the same validated door the SEO screen uses (config.normalizeBaseUrl) —
    // this one used to store whatever was typed, broken addresses included
    if (b.baseUrl !== undefined) {
      const base = normalizeBaseUrl(b.baseUrl);
      if (!base.ok) return res.status(400).json({ ok: false, error: base.error });
      config.baseUrl = base.value;
    }
    let langChanged = false;
    if (b.language !== undefined) {
      const want = b.language === 'en' ? 'en' : 'he';
      langChanged = want !== (config.language === 'en' ? 'en' : 'he');
      config.language = want;
    }
    let homeChanged = false;
    if (b.homepage !== undefined) {
      const want = String(b.homepage || '').trim();
      if (want && !getPageByFullPath(want)) throw new Error('דף הבית שנבחר לא נמצא: ' + want);
      homeChanged = want !== (config.homepage || '');
      config.homepage = want;
    }
    saveConfig(config);
    // v2.58 — a language change turns the site around: the pages that read
    // the old site's way now read the new one (pages.flipSiteDirection), and
    // every page's chrome moved with it — so the export is rebuilt, like a
    // homepage change rebuilds it for '/'
    let flipped = [];
    if (langChanged) {
      const sl = require('../site-language');
      flipped = require('../pages').flipSiteDirection(sl.directionFor(config.language === 'en' ? 'he' : 'en'), sl.directionFor(config.language));
    }
    // v2.69 — a store without a name of its own wears the site's, and the
    // trail on every product and category page starts at the home page: both
    // are written INTO those pages, so they follow before the rebuild. A sync
    // that fails is logged and never fails the save.
    try {
      const st = require('../store');
      if (st.isOpen()) st.pages.syncCatalogPages();
    } catch (e) {
      console.error('[store] page sync after a settings save failed:', e.message);
    }
    // v2.69 — every field on this screen is printed into the exported pages
    // (the site's name in each <title> and footer, the description, the base
    // URL in canonical and og:url), so every save rebuilds, not only a new
    // homepage or language. A rebuild that fails is SAID (rebuildError), the
    // way the menus screen says it — the settings themselves are saved.
    const rebuildError = require('../rebuild').rebuildSite('a settings save');
    res.json({ ok: true, flipped, baseUrl: config.baseUrl || '', rebuildError });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ─── Site packages (v1.06) — export/import a whole site as a portable
// file, the ".pzn is our RPM" pillar one level up from theme packages
// (v0.99). Admin-only: import creates/overwrites pages and site config. ───
// `?assets=1` also bundles the uploads the pages reference, so the pictures
// travel with the pages to another site.
router.get('/admin/api/site-package/export', requireAdmin, (req, res) => {
  try {
    const pkg = require('../site-package').exportSitePackage((loadConfig().title || '') + ' — גיבוי אתר', { assets: req.query.assets === '1' });
    const filename = 'tapuz-site-' + new Date().toISOString().slice(0, 10) + '.json';
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.type('application/json').send(JSON.stringify(pkg, null, 2));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// A DRY RUN unless the body says `apply: true` (or `dryRun: false`) in so
// many words: the answer lists what would happen and nothing is written. A
// real import keeps a snapshot of the site first (src/site-snapshot.js) and
// then rebuilds the export, so the imported pages are live when it answers.
router.post('/admin/api/site-package/import', requireAdmin, (req, res) => {
  try {
    const b = req.body || {};
    const result = require('../site-package').importSitePackage(b.package, {
      apply: b.apply === true,
      dryRun: b.dryRun,
      overwrite: !!b.overwrite,
      mode: b.mode,
      prefix: b.prefix,
      lang: b.lang,
      assets: b.assets,
      translations: b.translations
    });
    const rebuildError = result.dryRun ? '' : require('../rebuild').rebuildSite('a site-package import');
    res.json({ ok: true, ...result, rebuildError });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// The way back: the snapshots every real import took, and one POST that puts
// one back. Same gate as the import itself (requireAdmin; the admin gate's
// same-origin check covers every POST under /admin).
router.get('/admin/api/site-package/snapshots', requireAdmin, (req, res) => {
  try {
    res.json({ ok: true, snapshots: require('../site-snapshot').listSnapshots() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/site-package/restore', requireAdmin, (req, res) => {
  try {
    const id = String((req.body || {}).snapshotId || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'חסר snapshotId' });
    const result = require('../site-snapshot').restoreSnapshot(id);
    const rebuildError = require('../rebuild').rebuildSite('a snapshot restore');
    res.json({ ok: true, ...result, rebuildError });
  } catch (e) {
    res.status(e.code === 'NO_SNAPSHOT' ? 404 : 400).json({ ok: false, error: e.message, code: e.code || '' });
  }
});

module.exports = router;
