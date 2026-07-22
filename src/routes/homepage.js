'use strict';

/**
 * Homepage crowning (v0.78) — the twentieth route-group extraction. Set
 * which published page is served at '/'. Two doors onto one setHomepage()
 * helper: POST /admin/homepage (form → redirect, the pages screen) and
 * POST /admin/api/homepage (JSON, the builder publish-flow toast). Only
 * a PUBLISHED page can be crowned, and the site is rebuilt on the spot so
 * '/' is live immediately (the same "publish MEANS live" contract as v0.69).
 */

const express = require('express');
const { getPageByFullPath } = require('../pages');
const { loadConfig, saveConfig } = require('../config');
const { exportAll } = require('../export');
const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');

const router = express.Router();

function setHomepage(fullPath) {
  const page = getPageByFullPath(fullPath);
  if (!page) throw new Error('הדף לא נמצא: ' + fullPath);
  if (page.status !== 'published') throw new Error('רק דף מפורסם יכול להיות דף הבית — פרסמו אותו קודם');
  const config = loadConfig();
  config.homepage = fullPath;
  saveConfig(config);
  // '/' is a static index.html — rebuild now so the crowning is live
  // immediately (same "publish MEANS live" contract as v0.69).
  exportAll();
  return fullPath;
}

router.post('/admin/homepage', (req, res) => {
  try {
    setHomepage(String((req.body || {}).full_path || ''));
    res.redirect('/admin?homeset=1');
  } catch (e) {
    res.status(400).send(layout(
      `${adminNav('pages', 'דפים')}<div class="container page-body">
         <div style="background:#fef2f2;border:1px solid #ef4444;color:#b91c1c;padding:14px 18px;border-radius:12px">${escapeAdmin(e.message)}</div>
         <p><a href="/admin" class="btn secondary" style="margin-top:14px">חזרה לדפים</a></p>
       </div>`,
      'דפים', accentFor('pages')
    ));
  }
});

// JSON twin for the builder's publish flow ("קבע דף זה כדף הבית" toast)
router.post('/admin/api/homepage', (req, res) => {
  try {
    const fullPath = setHomepage(String((req.body || {}).full_path || ''));
    res.json({ ok: true, homepage: fullPath });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
