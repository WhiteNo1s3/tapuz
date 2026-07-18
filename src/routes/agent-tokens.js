'use strict';

/**
 * Agent token management — the fourteenth route-group extraction. The
 * admin-only API that mints/lists/revokes bearer tokens for the public
 * `/agent` surface (a minted token is site access at the same tier as an
 * SMTP or AI credential, so every route here is requireAdmin — v0.95). The
 * token VERIFICATION path (`agentTokens.verifyAgentToken`, used by the
 * `/agent` bearer middleware) stays in server.js: different surface, and
 * it's middleware wiring, not a route.
 */

const express = require('express');
const agentTokens = require('../agent-tokens');
const { requireAdmin } = require('../admin-guard');

const router = express.Router();

router.get('/admin/api/agent-tokens', requireAdmin, (req, res) => {
  res.json({ ok: true, tokens: agentTokens.listTokens() });
});

router.post('/admin/api/agent-tokens', requireAdmin, (req, res) => {
  try {
    const { name, scopes } = req.body || {};
    const { token, record } = agentTokens.mintToken({ name, scopes });
    res.json({ ok: true, token, record }); // `token` is returned exactly once
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.delete('/admin/api/agent-tokens/:id', requireAdmin, (req, res) => {
  const removed = agentTokens.revokeToken(req.params.id);
  res.json({ ok: removed });
});

module.exports = router;
