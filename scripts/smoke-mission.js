'use strict';

/**
 * v0.55 QA — the copilot mission store (the packet the extension pulls).
 * Isolated to a throwaway TAPUZ_ROOT so it never touches the real config store.
 * Proves the create → pull → advance-step lifecycle the /admin/chat → extension
 * round-trip depends on.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

// Point the store at a throwaway root BEFORE anything reads paths.js.
const ROOT = path.join(os.tmpdir(), 'tapuz-smoke-mission');
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(ROOT, 'config'), { recursive: true });
process.env.TAPUZ_ROOT = ROOT;

const store = require('../src/mission-store');
const { buildRoleplayPack } = require('../src/pzn/agent-roleplay');
const { buildBuildMessage } = require('../src/pzn/agent-mission');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

check('store file resolves under the isolated CONFIG_DIR', store.STORE.startsWith(ROOT));

// ── create ───────────────────────────────────────────────────────────
const teach = buildRoleplayPack({ locale: 'he' }).text;
const build = buildBuildMessage({ description: 'דף נחיתה', provider: 'claude' });
const m = store.createMission({
  description: 'דף נחיתה', provider: 'claude', teachMessage: teach, buildMessage: build, oneShot: teach
});
check('createMission returns id + pending + step=teach', !!m.id && m.status === 'pending' && m.step === 'teach');

// ── pull (what the extension does) ───────────────────────────────────
const latest = store.getLatestPending();
check('getLatestPending returns the created mission', latest && latest.id === m.id);
check('pulled mission carries the teach + build payload', latest.teachMessage.length > 200 && latest.buildMessage.length > 50);
check('getMission by id works', store.getMission(m.id).id === m.id);

// ── advance step → done ──────────────────────────────────────────────
const upd = store.updateMission(m.id, { step: 'done', status: 'done', fullPath: 'landing' });
check('updateMission advances step + fullPath', upd.step === 'done' && upd.status === 'done' && upd.fullPath === 'landing');
check('updateMission stamps updatedAt', !!upd.updatedAt);
check('a done mission is no longer the latest pending', store.getLatestPending() === null);

// ── undefined patch keys must NOT wipe fields ────────────────────────
const m2 = store.createMission({ description: 'x', teachMessage: 't', buildMessage: 'b', oneShot: 'o' });
store.updateMission(m2.id, { status: 'claimed', step: undefined });
check('undefined patch keys leave existing fields intact',
  store.getMission(m2.id).step === 'teach' && store.getMission(m2.id).status === 'claimed');

// ── capped at last 20 ────────────────────────────────────────────────
for (let i = 0; i < 25; i++) store.createMission({ description: 'm' + i, teachMessage: 't', buildMessage: 'b', oneShot: 'o' });
const data = JSON.parse(fs.readFileSync(store.STORE, 'utf8'));
check('store caps at the last 20 missions', data.missions.length === 20);

// cleanup
fs.rmSync(ROOT, { recursive: true, force: true });

console.log('');
console.log(fail ? 'SMOKE MISSION: FAIL' : 'SMOKE MISSION: PASS');
process.exit(fail ? 1 : 0);
