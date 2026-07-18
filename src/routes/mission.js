'use strict';

/**
 * Copilot MISSION admin API — the thirteenth route-group extraction. The
 * admin-facing endpoints that mint and manage a "mission" (the roleplay
 * teach-pack + build-quest a BYO-AI copilot runs): list providers, produce
 * a teach pack, create a mission, activate it. These are the `/admin/api/
 * mission/*` routes only — the copilot's own PULL side (`/agent/v1/mission`,
 * `/agent/v1/mission/:id/step`, bearer-token, on the public /agent surface)
 * stays in server.js: same feature, different surface + different auth.
 */

const express = require('express');

const router = express.Router();

router.get('/admin/api/mission/providers', (req, res) => {
  const agentMission = require('../pzn/agent-mission');
  res.json({ ok: true, providers: agentMission.listProviders() });
});

router.post('/admin/api/mission/teach', (req, res) => {
  const { buildRoleplayPack } = require('../pzn/agent-roleplay');
  const agentMission = require('../pzn/agent-mission');
  const media = require('../media').listAllMedia(40);
  const provider = (req.body && req.body.provider) || 'generic';
  // The full roleplay game pack = exactly what the extension ① injects.
  const pack = buildRoleplayPack({ locale: 'he', includeFullDictionary: true, media });
  const meta = agentMission.PROVIDERS[provider] || agentMission.PROVIDERS.generic;
  res.json({
    ok: true,
    message: pack.text,
    kind: 'site-builder-roleplay',
    provider,
    providerLabel: meta.label,
    moduleCount: pack.moduleCount
  });
});

router.post('/admin/api/mission/create', (req, res) => {
  try {
    const { buildRoleplayPack } = require('../pzn/agent-roleplay');
    const agentMission = require('../pzn/agent-mission');
    const missionStore = require('../mission-store');
    const { description, provider, title, slug, targetPage } = req.body || {};
    if (!description || !String(description).trim()) {
      return res.status(400).json({ ok: false, error: 'description required' });
    }
    const p = provider || 'generic';
    const media = require('../media').listAllMedia(40);
    // ① TEACH = full roleplay game + dictionary (the tool inventory) + real media.
    const teachPack = buildRoleplayPack({ locale: 'he', includeFullDictionary: true, media });
    // ② BUILD = the quest with the completion contract (agent already in character).
    const buildMessage = agentMission.buildBuildMessage({ description, title, slug, provider: p });
    // one-shot = the roleplay that already bakes the player brief in as the quest.
    const oneShot = buildRoleplayPack({
      locale: 'he',
      includeFullDictionary: true,
      media,
      playerBrief: [description, title && `title: ${title}`, slug && `slug: ${slug}`]
        .filter(Boolean)
        .join('\n')
    }).text;
    const mission = missionStore.createMission({
      description,
      title,
      slug,
      provider: p,
      teachMessage: teachPack.text,
      buildMessage,
      oneShot,
      targetPage: targetPage || '__new__'
    });
    const meta = agentMission.PROVIDERS[p] || agentMission.PROVIDERS.generic;
    mission.providerUrl = meta.url;
    mission.kind = 'site-builder-roleplay';
    res.json({ ok: true, mission, providerLabel: meta.label, moduleCount: teachPack.moduleCount });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/mission/activate/:id', (req, res) => {
  const missionStore = require('../mission-store');
  const m = missionStore.updateMission(req.params.id, { status: 'pending', step: 'teach' });
  if (!m) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, mission: m });
});

module.exports = router;
