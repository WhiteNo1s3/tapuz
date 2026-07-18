'use strict';

/**
 * Symbols API — the fifteenth route-group extraction. The saved-reusable-
 * block library behind the builder's 💠 panel (v0.91): list, save, delete.
 * A small, fully self-contained CRUD trio — every handler already called
 * `require('./symbols')` locally, nothing reached into server.js. The
 * builder's client panel lives in public/admin-builder.js and is
 * unaffected.
 */

const express = require('express');

const router = express.Router();

router.get('/admin/api/symbols', (req, res) => {
  try {
    res.json({ ok: true, symbols: require('../symbols').listSymbols() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/symbols', (req, res) => {
  try {
    const r = require('../symbols').saveSymbol({
      name: req.body && req.body.name,
      block: req.body && req.body.block
    });
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/symbols/delete', (req, res) => {
  try {
    const gone = require('../symbols').deleteSymbol(String((req.body && req.body.id) || ''));
    res.json({ ok: gone, error: gone ? undefined : 'לא נמצא' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
