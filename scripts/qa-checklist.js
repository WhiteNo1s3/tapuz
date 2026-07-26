#!/usr/bin/env node
'use strict';

/**
 * One-command QA report for Tapuziel main.
 *
 * Mirrors GitHub `security` workflow gates + a short CRM/WhatsApp spot check,
 * then prints a table you can paste into chat or a PR.
 *
 *   npm run qa
 *   node scripts/qa-checklist.js
 *   node scripts/qa-checklist.js --quick   # pzn + route-map + CRM/WA only
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const quick = process.argv.includes('--quick');
const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
    ...opts
  });
  return {
    code: r.status == null ? 1 : r.status,
    out: (r.stdout || '') + (r.stderr || ''),
    signal: r.signal
  };
}

function head(label) {
  console.log('\n── ' + label + ' ──');
}

function row(gate, ok, detail) {
  const mark = ok ? 'PASS' : 'FAIL';
  const extra = detail ? '  ' + detail : '';
  console.log((ok ? 'OK   ' : 'FAIL ') + mark.padEnd(4) + '  ' + gate + extra);
  return ok;
}

function pkg() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  } catch (e) {
    return { version: '?', name: 'tapuziel' };
  }
}

function gitMeta() {
  const rev = sh('git', ['rev-parse', '--short', 'HEAD']);
  const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = sh('git', ['status', '-sb']);
  const log = sh('git', ['log', '-1', '--oneline']);
  return {
    rev: (rev.out || '').trim() || '?',
    branch: (branch.out || '').trim() || '?',
    dirty: /^.+[ M?]{2}|^##.*\[ahead|behind/m.test(status.out || '') || (status.out || '').split('\n').length > 2,
    tip: (log.out || '').trim().split('\n')[0] || '?',
    tracking: ((status.out || '').split('\n')[0] || '').trim()
  };
}

function runNpm(script) {
  const r = sh('npm', ['run', script, '--silent'], { shell: false });
  if (verbose && r.out) {
    const lines = r.out.trim().split('\n');
    const tail = lines.slice(-12).join('\n');
    if (tail) console.log(tail);
  }
  return r;
}

function runNode(relScript) {
  const r = sh(process.execPath, [path.join(ROOT, relScript)]);
  if (verbose && r.out) {
    const lines = r.out.trim().split('\n');
    console.log(lines.slice(-8).join('\n'));
  }
  // Prefer smoke script's own FAIL markers when exit code is wrong
  const failed = r.code !== 0 || /\bFAIL\b/.test(r.out) && /SMOKE .*: FAIL/.test(r.out);
  return { ...r, ok: !failed && r.code === 0 };
}

function countPzn(out) {
  const m = out.match(/ℹ pass (\d+)/) || out.match(/# pass (\d+)/) || out.match(/pass (\d+)/);
  const f = out.match(/ℹ fail (\d+)/) || out.match(/# fail (\d+)/);
  return {
    pass: m ? m[1] : '?',
    fail: f ? f[1] : '?'
  };
}

function main() {
  const p = pkg();
  const g = gitMeta();
  const started = Date.now();
  const results = [];

  console.log('=== Tapuziel QA checklist ===');
  console.log('product:   ' + (p.name || 'tapuziel') + ' @ ' + (p.version || '?'));
  console.log('node:      ' + process.version);
  console.log('cwd:       ' + ROOT);
  console.log('git:       ' + g.branch + ' @ ' + g.rev + (g.dirty ? ' (dirty)' : ' (clean)'));
  console.log('tip:       ' + g.tip);
  console.log('tracking:  ' + g.tracking);
  console.log('mode:      ' + (quick ? 'quick' : 'full (CI-mirror)'));
  console.log('');

  // 1) pzn unit tests (CI)
  head('1/6  test:pzn');
  {
    const r = runNpm('test:pzn');
    const c = countPzn(r.out);
    const ok = r.code === 0 && String(c.fail) === '0';
    results.push({
      gate: 'test:pzn',
      ok,
      detail: c.pass !== '?' ? c.pass + '/' + c.pass + ' pass' : (ok ? 'exit 0' : 'exit ' + r.code)
    });
    row('test:pzn', ok, results[results.length - 1].detail);
  }

  if (!quick) {
    // 2) full smoke (CI)
    head('2/6  test:smoke  (full suite — same as GitHub security job)');
    {
      const r = runNpm('test:smoke');
      const fails = (r.out.match(/SMOKE [A-Z0-9_-]+: FAIL/g) || []).length;
      const passes = (r.out.match(/SMOKE [A-Z0-9_-]+: PASS/g) || []).length;
      const ok = r.code === 0 && fails === 0;
      results.push({
        gate: 'test:smoke',
        ok,
        detail: ok ? passes + ' smoke packs PASS' : fails + ' FAIL / exit ' + r.code
      });
      row('test:smoke', ok, results[results.length - 1].detail);
    }

    // 3–4) CI re-runs these after smoke (keep parity)
    head('3/6  smoke-registry (CI step)');
    {
      const r = runNode('scripts/smoke-registry.js');
      results.push({ gate: 'smoke-registry', ok: r.ok, detail: r.ok ? 'PASS' : 'exit ' + r.code });
      row('smoke-registry', r.ok);
    }

    head('4/6  smoke-wizard (CI step)');
    {
      const r = runNode('scripts/smoke-wizard.js');
      results.push({ gate: 'smoke-wizard', ok: r.ok, detail: r.ok ? 'PASS' : 'exit ' + r.code });
      row('smoke-wizard', r.ok);
    }
  } else {
    head('2–4/6  skipped (use full mode for CI mirror)');
    results.push({ gate: 'test:smoke', ok: true, detail: 'skipped (--quick)' });
    results.push({ gate: 'smoke-registry', ok: true, detail: 'skipped (--quick)' });
    results.push({ gate: 'smoke-wizard', ok: true, detail: 'skipped (--quick)' });
  }

  // 5) CRM / WhatsApp spot (the “main gig” surfaces from the lab port)
  head('5/6  CRM + WhatsApp spot');
  const spots = [
    ['crm-contacts', 'scripts/smoke-crm-contacts.js'],
    ['crm-cards', 'scripts/smoke-crm-cards.js'],
    ['crm-interests', 'scripts/smoke-crm-interests.js'],
    ['pixel-embed', 'scripts/smoke-pixel-embed.js'],
    ['crm-tasks', 'scripts/smoke-crm-tasks.js'],
    ['crm-board', 'scripts/smoke-crm-board.js'],
    ['crm-task-reminders', 'scripts/smoke-crm-task-reminders.js'],
    ['crm-sequences', 'scripts/smoke-crm-sequences.js'],
    ['crm-unified-inbox', 'scripts/smoke-crm-unified-inbox.js'],
    ['crm-capture', 'scripts/smoke-crm-capture.js'],
    ['crm-cs', 'scripts/smoke-crm-cs.js'],
    ['whatsapp', 'scripts/smoke-whatsapp.js'],
    ['wa-ledger', 'scripts/smoke-wa-ledger.js'],
    ['wa-webhook', 'scripts/smoke-wa-webhook.js'],
    ['wa-send', 'scripts/smoke-wa-send.js']
  ];
  let spotOk = 0;
  for (const [name, file] of spots) {
    if (!fs.existsSync(path.join(ROOT, file))) {
      results.push({ gate: name, ok: false, detail: 'missing ' + file });
      row(name, false, 'file missing');
      continue;
    }
    const r = runNode(file);
    if (r.ok) spotOk++;
    results.push({ gate: name, ok: r.ok, detail: r.ok ? 'PASS' : 'exit ' + r.code });
    row(name, r.ok);
  }
  results.push({
    gate: 'crm-wa-spot',
    ok: spotOk === spots.length,
    detail: spotOk + '/' + spots.length
  });

  // 6) route-map + prod audit (high+)
  head('6/6  route-map + npm audit (prod high+)');
  {
    const r = runNode('scripts/smoke-route-map.js');
    results.push({ gate: 'route-map', ok: r.ok, detail: r.ok ? 'IN SYNC' : 'DRIFT' });
    row('route-map', r.ok, results[results.length - 1].detail);
  }
  {
    const r = sh('npm', ['audit', '--omit=dev', '--audit-level=high']);
    // npm audit exits 1 when vulns found at/above level — or when registry is down.
    const networkFail = /EAI_AGAIN|ENOTFOUND|ECONNRESET|audit endpoint returned an error|fetch failed|getaddrinfo/i.test(
      r.out || ''
    );
    let ok = r.code === 0;
    let detail = 'clean';
    if (networkFail) {
      ok = true; // do not fail the checklist on registry blips; CI still enforces audit
      detail = 'skipped (registry unreachable)';
    } else if (!ok) {
      detail = 'high/critical found';
    } else if (/low severity|moderate severity/i.test(r.out || '')) {
      detail = 'no high+ (lower noise ok)';
    }
    results.push({
      gate: 'npm audit (prod high+)',
      ok,
      detail
    });
    row('npm audit (prod high+)', ok, detail);
    if (verbose && r.out) console.log(r.out.trim().split('\n').slice(-8).join('\n'));
  }

  // Summary table
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const hard = results.filter((x) =>
    ['test:pzn', 'test:smoke', 'smoke-registry', 'smoke-wizard', 'crm-wa-spot', 'route-map', 'npm audit (prod high+)'].includes(x.gate)
  );
  // In quick mode, skipped smoke steps count as soft
  const critical = results.filter((x) => {
    if (quick && ['test:smoke', 'smoke-registry', 'smoke-wizard'].includes(x.gate)) return false;
    return [
      'test:pzn',
      'test:smoke',
      'smoke-registry',
      'smoke-wizard',
      'crm-wa-spot',
      'route-map',
      'npm audit (prod high+)'
    ].includes(x.gate);
  });
  const allOk = critical.every((x) => x.ok);

  console.log('\n=== Report ===');
  console.log('| Gate | Result | Detail |');
  console.log('|------|--------|--------|');
  for (const x of critical) {
    console.log(
      '| ' + x.gate + ' | ' + (x.ok ? '**PASS**' : '**FAIL**') + ' | ' + (x.detail || '') + ' |'
    );
  }
  console.log('');
  console.log(
    allOk
      ? 'QA checklist: ALL CRITICAL GATES GREEN (' + elapsed + 's)'
      : 'QA checklist: FAILURES — see FAIL lines above (' + elapsed + 's)'
  );
  console.log(
    'CI mirror: security.yml → test:pzn + test:smoke + smoke-registry + smoke-wizard + audit high+'
  );

  process.exit(allOk ? 0 : 1);
}

main();
