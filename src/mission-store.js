'use strict';

/**
 * Pending build missions for the Chrome extension (v0.55, BYOT copilot).
 *
 * The CMS copilot (/admin/chat) writes a mission; the extension — authenticated
 * with an agent token — pulls it and injects the roleplay/build prompts into the
 * user's already-logged-in LLM tab. The server never holds LLM cookies.
 *
 * Stored as a small gitignored JSON file under CONFIG_DIR, mirroring how agent
 * tokens are persisted (src/agent-tokens.js). Missions are ephemeral — only the
 * last 20 are kept.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./paths');

const STORE = path.join(CONFIG_DIR, 'missions.json');

function load() {
  try {
    if (fs.existsSync(STORE)) {
      const data = JSON.parse(fs.readFileSync(STORE, 'utf8'));
      if (Array.isArray(data.missions)) return data;
    }
  } catch (e) {
    /* fresh */
  }
  return { missions: [] };
}

function save(data) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(data, null, 2), 'utf8');
}

function createMission({
  description,
  title,
  slug,
  provider = 'generic',
  teachMessage,
  buildMessage,
  oneShot,
  targetPage = '__new__'
}) {
  const mission = {
    id: crypto.randomBytes(8).toString('hex'),
    status: 'pending', // pending | claimed | done
    createdAt: new Date().toISOString(),
    description,
    title: title || '',
    slug: slug || '',
    provider,
    teachMessage,
    buildMessage,
    oneShot,
    targetPage,
    step: 'teach' // teach | build | watch | publish | done
  };
  const data = load();
  data.missions = [mission, ...data.missions].slice(0, 20); // keep last 20
  save(data);
  return mission;
}

function getLatestPending() {
  return load().missions.find((m) => m.status === 'pending') || null;
}

function getMission(id) {
  return load().missions.find((m) => m.id === id) || null;
}

function updateMission(id, patch) {
  const data = load();
  const m = data.missions.find((x) => x.id === id);
  if (!m) return null;
  const clean = { ...patch };
  // drop undefined so we don't wipe fields
  Object.keys(clean).forEach((k) => clean[k] === undefined && delete clean[k]);
  Object.assign(m, clean, { updatedAt: new Date().toISOString() });
  save(data);
  return m;
}

module.exports = {
  createMission,
  getLatestPending,
  getMission,
  updateMission,
  STORE
};
