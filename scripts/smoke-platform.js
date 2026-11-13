'use strict';

/**
 * v2.69 — "prepare it for industrial usage": the platform holes, each one
 * pinned by behaviour. Module-level cases first (temp roots, no server), then
 * the REAL server, three boots on one port:
 *
 *   A  a living site (pages, an admin and an editor, the store open, the
 *      customer portal on) behind one trusted proxy, its data root under a
 *      DOT-directory on purpose — headers, health, 404s, the sitemap's
 *      scheme, the base-URL line, the saves that must rebuild, body limits,
 *      the storage downloads, the admin limiter, the damaged site.json
 *   B  an empty root the server creates itself, started with a preload that
 *      gives the store a fake cspSources — the setup code a remote browser
 *      must type, and the CSP header widened / not widened / not injectable
 *   C  another empty root with TAPUZ_SETUP_TOKEN and NO proxy trust — the
 *      loopback exemption, a damaged auth.json failing closed over HTTP, the
 *      one-time proxy warning, and SIGTERM closing the database cleanly
 *   P  site A again behind a proxy NOBODY DECLARED (the real sites' state),
 *      one short boot per scenario — a stranger's wrong passwords lock an
 *      account, never the site; the portal the same; a direct visitor unchanged
 *   S  an empty root behind that proxy — the setup-code lock that does not grow
 *   H  an empty root and a server with no terminal — the code is asked of all
 *
 * Two preloads stand in for things a test cannot wait for or own: a clock
 * that SIGUSR2 moves 31 seconds ahead, and a "this run has a terminal" flag.
 *
 * Every check that a reader reproduced as a defect fails on the commit
 * before this one and passes here.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..');
const PORT = 4096;
const BASE = 'http://127.0.0.1:' + PORT;

// nothing inherited may steer the cases below
for (const k of ['TAPUZ_TRUST_PROXY', 'TAPUZ_SETUP_TOKEN', 'TAPUZ_ADMIN_SECRET', 'TAPUZ_ADMIN_PATH', 'TAPUZ_DEMO_STORE', 'TAPUZ_PIN_FILE', 'TAPUZ_PORTAL_LOGIN_MAX', 'TAPUZ_PORTAL_REGISTER_MAX']) {
  delete process.env[k];
}

const HOLD = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-platform-'));
// send() answers 404 for an absolute path with a dot segment unless told
// otherwise — the storage downloads broke on exactly such a root
const ROOT = path.join(HOLD, '.site', 'root');
const ROOT_B = path.join(HOLD, 'empty-b');
const ROOT_C = path.join(HOLD, 'empty-c');
const ROOT_S = path.join(HOLD, 'empty-s');
const ROOT_H = path.join(HOLD, 'empty-h');
fs.mkdirSync(ROOT, { recursive: true });
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond, detail) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (!cond && detail !== undefined ? '  ← ' + String(detail).slice(0, 300) : ''));
  if (!cond) fail = true;
}
/** One group of checks: a throw inside it is a FAIL, not the end of the run. */
async function group(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(name + ' (the group threw)', false, (e && (e.stack || e.message)) || e);
  }
}
function optional(mod) {
  try { return require(mod); } catch (e) { return {}; }
}

function req(method, urlPath, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    const headers = Object.assign({ Accept: o.accept || 'text/html' }, o.headers || {});
    let data = null;
    if (o.form != null) {
      data = new URLSearchParams(o.form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (o.json != null) {
      data = JSON.stringify(o.json);
      headers['Content-Type'] = 'application/json';
    } else if (o.raw != null) {
      data = String(o.raw); // sent as it is, under the caller's own Content-Type
    }
    if (method !== 'GET' && !o.noOrigin && !headers.Origin) headers.Origin = BASE;
    if (o.cookie) headers.Cookie = o.cookie;
    // chunked: no length up front, as a streaming client sends an upload
    if (data != null && !o.chunked) headers['Content-Length'] = Buffer.byteLength(data);
    let settled = false;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        settled = true;
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json, buf });
      });
    });
    r.setTimeout(o.timeout || 10000, () => r.destroy(new Error('timeout: ' + method + ' ' + urlPath)));
    r.on('error', (e) => {
      if (settled) return;
      settled = true;
      if (o.soft) resolve({ status: 0, headers: {}, text: '', json: null, buf: Buffer.alloc(0), error: e });
      else reject(e);
    });
    if (data != null) r.write(data);
    r.end();
  });
}

function boot(root, env, nodeArgs) {
  const child = spawn(process.execPath, (nodeArgs || []).concat([path.join(REPO, 'src', 'server.js')]), {
    env: Object.assign({}, process.env, { TAPUZ_ROOT: root, PORT: String(PORT) }, env || {}),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const log = { text: '' };
  child.stdout.on('data', (c) => { log.text += c; });
  child.stderr.on('data', (c) => { log.text += c; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return { child, log, exited };
}

function waitUp(tries) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      http.get(BASE + '/_tapuz/health', (res) => { res.resume(); resolve(); }).on('error', () => {
        if (n <= 0) return reject(new Error('server did not start'));
        setTimeout(() => tick(n - 1), 150);
      });
    };
    tick(tries || 60);
  });
}

async function kill(server) {
  if (!server) return;
  server.child.kill('SIGKILL');
  await server.exited;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** One GET in HTTP/1.0, as a stock reverse proxy sends it — the raw answer. */
function rawHttp10(urlPath) {
  return new Promise((resolve) => {
    let out = '';
    const sock = require('net').connect(PORT, '127.0.0.1', () => {
      sock.write('GET ' + urlPath + ' HTTP/1.0\r\nHost: 127.0.0.1:' + PORT + '\r\nAccept: text/html\r\n\r\n');
    });
    sock.setTimeout(5000, () => sock.destroy());
    sock.on('data', (c) => { out += c; });
    sock.on('close', () => resolve(out));
    sock.on('error', () => resolve(out));
  });
}
/** The child's output arrives through a pipe: give a line a moment to land. */
async function logHas(server, re, ms) {
  const until = Date.now() + (ms || 2000);
  while (Date.now() < until) {
    if (re.test(server.log.text)) return true;
    await sleep(40);
  }
  return re.test(server.log.text);
}
const cookieOf = (res) => String((res.headers['set-cookie'] || [])[0] || '').split(';')[0];
const REMOTE = { 'X-Forwarded-For': '203.0.113.9' };
// The made-up sign-in of the stranger who tries to take an unclaimed site. It is a constant on purpose:
// written inline beside its field name, the secret scan's generic rule reads the literal as a real one.
const INTRUDER_PASS = 'intruder-pass-1';

// test-only clock: SIGUSR2 moves the child's Date.now() 31 seconds ahead, so
// a 30-second lock can be watched ending (and growing, or not) without
// waiting for it. A preload, never a switch the server itself reads.
const preloadClock = path.join(HOLD, 'preload-clock.js');
fs.writeFileSync(preloadClock, [
  "'use strict';",
  '// test-only: SIGUSR2 = 31 seconds later',
  'let ahead = 0;',
  'const realNow = Date.now;',
  'Date.now = () => realNow() + ahead;',
  "process.on('SIGUSR2', () => { ahead += 31000; console.log('[clock] +31s'); });",
  ''
].join('\n'));
// test-only terminal: a child of this smoke has pipes for output, like a
// hosted process. This preload makes it look like `npm start` in a terminal
// — and it is a preload because the server reads no switch that could say so.
const preloadTty = path.join(HOLD, 'preload-tty.js');
fs.writeFileSync(preloadTty, "'use strict';\n// test-only: this run was started in a terminal\nprocess.stdout.isTTY = true;\n");
async function advance(server) {
  const count = () => server.log.text.split('[clock]').length;
  const before = count();
  server.child.kill('SIGUSR2');
  const until = Date.now() + 3000;
  while (count() === before && Date.now() < until) await sleep(20);
  if (count() === before) throw new Error('the test clock did not move');
}

// The public pages' policy as it has been since v2.24, with no pixels, no web
// fonts and no PayPal: the string a site without any of them must keep,
// character for character.
const CSP_PLAIN = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "frame-src 'self' https://www.youtube.com https://www.google.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join('; ');

(async () => {
  // =======================================================================
  // 1. the atomic JSON helper
  // =======================================================================
  const jsonFile = optional('../src/json-file');
  await group('json-file', async () => {
    check('src/json-file.js exports writeAtomic and readJson', typeof jsonFile.writeAtomic === 'function' && typeof jsonFile.readJson === 'function');
    if (typeof jsonFile.writeAtomic !== 'function') return;
    const dir = path.join(HOLD, 'jf');
    fs.mkdirSync(dir);
    const f = path.join(dir, 'store.json');
    jsonFile.writeAtomic(f, '{"a":1}');
    check('writeAtomic writes the file', fs.readFileSync(f, 'utf8') === '{"a":1}');
    check('writeAtomic leaves no temp file behind', fs.readdirSync(dir).join(',') === 'store.json', fs.readdirSync(dir).join(','));
    jsonFile.writeAtomic(f, '{"a":2}');
    check('a second write replaces the content whole', fs.readFileSync(f, 'utf8') === '{"a":2}');

    // a failure in the middle of the write: the rename never happens
    const realRename = fs.renameSync;
    let threw = false;
    fs.renameSync = () => { throw new Error('disk pulled out'); };
    try { jsonFile.writeAtomic(f, '{"a":3,"half":'); } catch (e) { threw = true; } finally { fs.renameSync = realRename; }
    check('a write that fails midway throws', threw);
    check('…and the OLD content is intact', fs.readFileSync(f, 'utf8') === '{"a":2}');
    check('…and its temp file was cleaned up', fs.readdirSync(dir).join(',') === 'store.json', fs.readdirSync(dir).join(','));
    const realFsync = fs.fsyncSync;
    threw = false;
    fs.fsyncSync = () => { throw new Error('flush refused'); };
    try { jsonFile.writeAtomic(f, '{"a":4}'); } catch (e) { threw = true; } finally { fs.fsyncSync = realFsync; }
    check('a failed flush also leaves the old content and no temp file', threw && fs.readFileSync(f, 'utf8') === '{"a":2}' && fs.readdirSync(dir).length === 1);

    jsonFile.writeAtomic(f, '{"private":true}', { mode: 0o600 });
    if (process.platform !== 'win32') check('mode is applied to the new file (0600)', (fs.statSync(f).mode & 0o777) === 0o600);
    jsonFile.writeAtomic(f, '{"private":2}');
    if (process.platform !== 'win32') check('a later write without a mode keeps the file\'s permissions', (fs.statSync(f).mode & 0o777) === 0o600);

    // ── the states where the bare write this replaced used to work ──
    const modeOf = (file) => fs.statSync(file).mode & 0o777;
    const names = (d) => fs.readdirSync(d).sort().join(',');
    // the process dies in the middle of the write — a real kill, in a child
    const crashDir = path.join(HOLD, 'jf-crash');
    fs.mkdirSync(crashDir);
    const crashFile = path.join(crashDir, 'site.json');
    fs.writeFileSync(crashFile, '{"old":"whole"}');
    const crash = require('child_process').spawnSync(process.execPath, ['-e', [
      "const fs = require('fs');",
      'const real = fs.writeFileSync;',
      "fs.writeFileSync = (target, data, enc) => { if (typeof target !== 'number') return real(target, data, enc); real(target, String(data).slice(0, 9), enc); process.kill(process.pid, 'SIGKILL'); for (;;) { /* until the signal lands */ } };",
      'require(' + JSON.stringify(path.join(REPO, 'src', 'json-file.js')) + ').writeAtomic(' + JSON.stringify(crashFile) + ", JSON.stringify({ new: 'x'.repeat(4000) }));"
    ].join('\n')], { timeout: 15000 });
    check('a process killed in the middle of a write leaves the OLD content whole', crash.signal === 'SIGKILL' && fs.readFileSync(crashFile, 'utf8') === '{"old":"whole"}', JSON.stringify({ status: crash.status, signal: crash.signal }) + ' ' + fs.readFileSync(crashFile, 'utf8').slice(0, 40));

    if (process.platform !== 'win32') {
      // a config file that is a symlink into shared storage
      const shared = path.join(HOLD, 'jf-shared');
      const release = path.join(HOLD, 'jf-release');
      fs.mkdirSync(shared);
      fs.mkdirSync(release);
      const real = path.join(shared, 'site.json');
      const link = path.join(release, 'site.json');
      fs.writeFileSync(real, '{"v":1}');
      fs.symlinkSync(real, link);
      jsonFile.writeAtomic(link, '{"v":2}');
      check('a symlinked file is written THROUGH the link: the link survives and its target has the new content',
        fs.lstatSync(link).isSymbolicLink() && fs.readFileSync(real, 'utf8') === '{"v":2}' && fs.readFileSync(link, 'utf8') === '{"v":2}' && names(shared) === 'site.json' && names(release) === 'site.json',
        'link? ' + fs.lstatSync(link).isSymbolicLink() + ' target: ' + fs.readFileSync(real, 'utf8') + ' | ' + names(shared) + ' | ' + names(release));
      const later = path.join(release, 'menus.json');
      fs.symlinkSync(path.join(shared, 'menus.json'), later);
      jsonFile.writeAtomic(later, '{"m":1}');
      check('…also when the link points at a file that does not exist yet', fs.lstatSync(later).isSymbolicLink() && fs.existsSync(path.join(shared, 'menus.json')) && fs.readFileSync(path.join(shared, 'menus.json'), 'utf8') === '{"m":1}');

      // the umask must not narrow a file that exists
      const wide = path.join(dir, 'wide.json');
      const page = path.join(dir, 'page.html');
      fs.writeFileSync(wide, 'old');
      fs.chmodSync(wide, 0o666);
      fs.writeFileSync(page, 'old');
      fs.chmodSync(page, 0o644);
      const umaskWas = process.umask(0o077);
      let fresh = 0;
      try {
        jsonFile.writeAtomic(wide, 'new');
        jsonFile.writeAtomic(page, 'new', { durable: false });
        jsonFile.writeAtomic(path.join(dir, 'fresh.json'), 'new');
        fresh = modeOf(path.join(dir, 'fresh.json'));
      } finally { process.umask(umaskWas); }
      check('an existing file keeps its permissions exactly, whatever the umask (0666 stays 0666; a 0644 page under umask 077 stays 0644)',
        modeOf(wide) === 0o666 && modeOf(page) === 0o644 && fs.readFileSync(wide, 'utf8') === 'new', modeOf(wide).toString(8) + ' ' + modeOf(page).toString(8));
      check('…while a NEW file is still made through the umask, like any other', fresh === 0o600, fresh.toString(8));
    }

    // a filesystem that refuses fsync: the bytes were written, the save stands
    for (const code of ['EINVAL', 'ENOTSUP', 'ENOSYS']) {
      const target = path.join(dir, 'nofsync.json');
      fs.writeFileSync(target, 'old');
      let err = '';
      fs.fsyncSync = () => { throw Object.assign(new Error('fsync: ' + code), { code }); };
      try { jsonFile.writeAtomic(target, 'new-' + code); } catch (e) { err = e.message; } finally { fs.fsyncSync = realFsync; }
      check('a filesystem that answers ' + code + ' to fsync still saves', !err && fs.readFileSync(target, 'utf8') === 'new-' + code && !fs.readdirSync(dir).some((n) => /\.tmp$/.test(n)), err);
    }

    // no rename onto the file (a file mounted on its own): in place, as before
    for (const code of ['EXDEV', 'EBUSY']) {
      const target = path.join(dir, 'mounted.json');
      fs.writeFileSync(target, 'old');
      let err = '';
      fs.renameSync = () => { throw Object.assign(new Error('rename: ' + code), { code }); };
      try { jsonFile.writeAtomic(target, 'new-' + code); } catch (e) { err = e.message; } finally { fs.renameSync = realRename; }
      check('a rename refused with ' + code + ' falls back to writing the file in place, and leaves no temp file', !err && fs.readFileSync(target, 'utf8') === 'new-' + code && !fs.readdirSync(dir).some((n) => /\.tmp$/.test(n)), err || names(dir));
    }

    if (process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0) {
      // a directory this process may not write to, holding a file it may
      const locked = path.join(HOLD, 'jf-locked');
      fs.mkdirSync(locked);
      const inside = path.join(locked, 'site.json');
      fs.writeFileSync(inside, '{"v":1}');
      fs.chmodSync(locked, 0o555);
      let err = '';
      let refused = '';
      try {
        try { jsonFile.writeAtomic(inside, '{"v":2}'); } catch (e) { err = e.code || e.message; }
        check('a read-only directory with a writable file: the save still lands (in place), it used to throw EACCES', !err && fs.readFileSync(inside, 'utf8') === '{"v":2}' && names(locked) === 'site.json', err || names(locked));
        fs.chmodSync(inside, 0o444);
        try { jsonFile.writeAtomic(inside, '{"v":3}'); } catch (e) { refused = e.code || e.message; }
        check('…and when the file is not writable either, the save is refused and the content is whole', refused === 'EACCES' && fs.readFileSync(inside, 'utf8') === '{"v":2}', refused || 'it was written');
      } finally {
        fs.chmodSync(locked, 0o755);
        fs.chmodSync(inside, 0o644);
      }
    }

    check('readJson: a missing file is "missing"', jsonFile.readJson(path.join(dir, 'nope.json')).state === 'missing');
    const ok = jsonFile.readJson(f);
    check('readJson: a good file is "ok" with its data', ok.state === 'ok' && ok.data.private === 2);
    fs.writeFileSync(path.join(dir, 'cut.json'), '{"users":[{"id":"1","usern');
    const cut = jsonFile.readJson(path.join(dir, 'cut.json'));
    check('readJson: a truncated file is "corrupt", with the reason', cut.state === 'corrupt' && cut.error.length > 0 && cut.data === null);
    fs.writeFileSync(path.join(dir, 'empty.json'), '');
    check('readJson: an empty file is "corrupt", not "missing"', jsonFile.readJson(path.join(dir, 'empty.json')).state === 'corrupt');
    fs.writeFileSync(path.join(dir, 'bom.json'), String.fromCharCode(0xFEFF) + '{"n":1}');
    check('readJson: a byte-order mark is not damage', jsonFile.readJson(path.join(dir, 'bom.json')).state === 'ok');
  });

  // =======================================================================
  // 2. auth.json — a missing file is a first run, a damaged one fails closed
  // =======================================================================
  require('../src/db');
  const auth = require('../src/auth');
  const AUTH_FILE = path.join(ROOT, 'config', 'auth.json');
  let ownerToken = '';
  await group('auth.json', async () => {
    check('no auth.json: hasAdmin() is false (first run, as before)', auth.hasAdmin() === false);
    check('no auth.json: authState() is "missing"', typeof auth.authState === 'function' && auth.authState() === 'missing');
    auth.createAdmin('owner', 'owner-pass-1');
    auth.addTeamMember('dana', 'dana-pass-1', 'editor');
    check('accounts are saved and found', auth.hasAdmin() === true && !!auth.findUser('owner') && !!auth.findUser('dana'));
    check('saving left no temp file in config/', fs.readdirSync(path.join(ROOT, 'config')).every((n) => !/\.tmp$/.test(n)), fs.readdirSync(path.join(ROOT, 'config')).join(','));
    if (process.platform !== 'win32') check('auth.json is private (0600)', (fs.statSync(AUTH_FILE).mode & 0o777) === 0o600);
    ownerToken = auth.makeToken(auth.findUser('owner').id);
    check('a session signed with the file\'s secret verifies', !!auth.verifyToken(ownerToken));

    const good = fs.readFileSync(AUTH_FILE);
    const cut = good.subarray(0, Math.floor(good.length / 2));
    fs.writeFileSync(AUTH_FILE, cut);
    check('a truncated auth.json: hasAdmin() stays TRUE (create-account stays shut)', auth.hasAdmin() === true);
    check('…authState() is "corrupt"', typeof auth.authState === 'function' && auth.authState() === 'corrupt');
    // everything that used to rewrite the file: the secret, a session check
    auth.getSecret();
    auth.verifyToken(ownerToken);
    auth.verifySession({ headers: { cookie: 'tapuz_sess=' + ownerToken } });
    check('…the file is left exactly as it was found (no new secret written over it)', fs.readFileSync(AUTH_FILE).equals(cut));
    const copies = () => fs.readdirSync(path.join(ROOT, 'config')).filter((n) => n.indexOf('auth.json.corrupt-') === 0);
    check('…one copy of the damaged file is kept beside it', copies().length === 1 && fs.readFileSync(path.join(ROOT, 'config', copies()[0])).equals(cut), copies().join(','));
    auth.hasAdmin(); auth.getSecret(); auth.listUsers();
    check('…and only one, however many times it is read', copies().length === 1, copies().join(','));
    check('…nobody signs in while it is damaged', auth.verifyLogin('owner', 'owner-pass-1') === null && auth.verifyToken(ownerToken) === null);
    let refused = '';
    try { auth.createAdmin('intruder', INTRUDER_PASS); } catch (e) { refused = e.message; }
    check('…creating an account is refused in Hebrew, and still nothing is written', /פגום/.test(refused) && fs.readFileSync(AUTH_FILE).equals(cut), refused);
    refused = '';
    try { auth.addTeamMember('x2', INTRUDER_PASS, 'admin'); } catch (e) { refused = e.message; }
    check('…so is adding a team member', /פגום/.test(refused) && fs.readFileSync(AUTH_FILE).equals(cut));

    fs.writeFileSync(AUTH_FILE, good);
    check('restoring the file brings every account back, with no restart', auth.authState() === 'ok' && !!auth.verifyLogin('owner', 'owner-pass-1') && !!auth.findUser('dana'));
    check('…and the sessions its secret signed are valid again', !!auth.verifyToken(ownerToken));

    check('a cookie that is not valid percent-encoding does not throw', (() => {
      try { return auth.verifySession({ headers: { cookie: 'other=%zz; tapuz_sess=' + ownerToken } }) !== null; } catch (e) { return false; }
    })());
  });

  // =======================================================================
  // 3. site.json — same rule
  // =======================================================================
  const config = require('../src/config');
  const SITE_FILE = path.join(ROOT, 'config', 'site.json');
  await group('site.json', async () => {
    check('no site.json: the defaults, as before', config.loadConfig().title === 'Tapuziel' && typeof config.configState === 'function' && config.configState().state === 'missing');
    const c = config.loadConfig();
    c.title = 'האתר של הסמוק';
    c.homepage = 'home';
    config.saveConfig(c);
    check('a saved config reads back', config.loadConfig().title === 'האתר של הסמוק');
    const good = fs.readFileSync(SITE_FILE);
    const cut = good.subarray(0, Math.floor(good.length / 2));
    fs.writeFileSync(SITE_FILE, cut);
    const served = config.loadConfig();
    check('a truncated site.json: the site is served from the defaults', served.title === 'Tapuziel' && served.homepage === '');
    check('…configState() says "corrupt"', typeof config.configState === 'function' && config.configState().state === 'corrupt');
    let refused = '';
    try { served.title = 'נדרס'; config.saveConfig(served); } catch (e) { refused = e.message; }
    check('…a save over it is refused in Hebrew', /פגום/.test(refused), refused);
    check('…and the damaged file is NOT overwritten', fs.readFileSync(SITE_FILE).equals(cut));
    check('…a copy of it is kept beside it', fs.readdirSync(path.join(ROOT, 'config')).some((n) => n.indexOf('site.json.corrupt-') === 0));
    fs.writeFileSync(SITE_FILE, good);
    check('restoring it brings the settings back', config.loadConfig().title === 'האתר של הסמוק' && config.configState().state === 'ok');
    fs.unlinkSync(SITE_FILE);
  });

  // =======================================================================
  // 4. the request helpers
  // =======================================================================
  const httpUtil = require('../src/http-util');
  const fakeReq = (headers, remote, protocol) => ({ headers: headers || {}, socket: { remoteAddress: remote || '10.0.0.5' }, protocol: protocol || 'http' });
  await group('http-util', async () => {
    const xff = { 'x-forwarded-for': '198.51.100.1, 203.0.113.7, 192.0.2.10' };
    delete process.env.TAPUZ_TRUST_PROXY;
    check('clientIp, flag off: the socket address (X-Forwarded-For is not believed)', httpUtil.clientIp(fakeReq(xff)) === '10.0.0.5');
    process.env.TAPUZ_TRUST_PROXY = '1';
    check('clientIp, 1 hop: the rightmost entry', httpUtil.clientIp(fakeReq(xff)) === '192.0.2.10');
    process.env.TAPUZ_TRUST_PROXY = 'true';
    check('clientIp, "true": the same as 1', httpUtil.clientIp(fakeReq(xff)) === '192.0.2.10');
    process.env.TAPUZ_TRUST_PROXY = '2';
    check('clientIp, 2 hops: the second entry from the right (a CDN plus an origin proxy)', httpUtil.clientIp(fakeReq(xff)) === '203.0.113.7');
    check('clientIp, 2 hops but one entry: that entry', httpUtil.clientIp(fakeReq({ 'x-forwarded-for': '203.0.113.7' })) === '203.0.113.7');
    check('clientIp, trusted but no header: the socket address', httpUtil.clientIp(fakeReq({})) === '10.0.0.5');

    check('requestOrigin is exported', typeof httpUtil.requestOrigin === 'function');
    if (typeof httpUtil.requestOrigin !== 'function') return;
    const proxied = { host: 'shop.example', 'x-forwarded-proto': 'https, http' };
    process.env.TAPUZ_TRUST_PROXY = '1';
    // ONE reading of the header for the cookie and for the origin: the LAST
    // entry — what the nearest proxy wrote; anything before it is the client's
    const withProto = (v) => fakeReq(v === null ? { host: 'shop.example' } : { host: 'shop.example', 'x-forwarded-proto': v });
    check('requestOrigin, trusted proxy: the LAST X-Forwarded-Proto with the Host ("http, https" is https)', httpUtil.requestOrigin(withProto('http, https')) === 'https://shop.example', httpUtil.requestOrigin(withProto('http, https')));
    check('…and "https, http" is http: an entry the client wrote first does not win', httpUtil.requestOrigin(fakeReq(proxied)) === 'http://shop.example', httpUtil.requestOrigin(fakeReq(proxied)));
    check('forwardedProto is exported: trimmed, lower-cased, compared whole', typeof httpUtil.forwardedProto === 'function' &&
      httpUtil.forwardedProto(withProto(' HTTPS ')) === 'https' && httpUtil.forwardedProto(withProto('http')) === 'http' &&
      httpUtil.forwardedProto(withProto('httpsx')) === '' && httpUtil.forwardedProto(withProto('https,')) === '' && httpUtil.forwardedProto(withProto(null)) === '');
    const disagree = ['https', 'http', 'https, http', 'http, https', 'https,http', ' HTTPS ', 'https, ', 'wss', null]
      .filter((v) => auth.isHttps(withProto(v)) !== /^https:/.test(httpUtil.requestOrigin(withProto(v))));
    check('the cookie\'s Secure decision (auth.isHttps) and the origin agree on every spelling of the header', disagree.length === 0, JSON.stringify(disagree));
    check('…"https, http" is not https for the cookie either, and a lone "https" still is', auth.isHttps(fakeReq(proxied)) === false && auth.isHttps(withProto('https')) === true && auth.isHttps(withProto('http, https')) === true);
    delete process.env.TAPUZ_TRUST_PROXY;
    check('requestOrigin, proxy not trusted: the connection\'s own scheme', httpUtil.requestOrigin(fakeReq(proxied)) === 'http://shop.example');
    check('requestOrigin, direct: req.protocol + host', httpUtil.requestOrigin(fakeReq({ host: 'localhost:3000' }, '127.0.0.1', 'https')) === 'https://localhost:3000');
    const c = config.loadConfig();
    c.baseUrl = 'https://www.site.example/blog';
    config.saveConfig(c);
    check('requestOrigin: a configured base URL wins — its origin, never its path', httpUtil.requestOrigin(fakeReq(proxied)) === 'https://www.site.example');
    c.baseUrl = '';
    config.saveConfig(c);
    fs.unlinkSync(SITE_FILE);

    check('isLoopbackRequest: a browser on this machine', httpUtil.isLoopbackRequest(fakeReq({ host: 'localhost:3000' }, '127.0.0.1')) === true && httpUtil.isLoopbackRequest(fakeReq({ host: '[::1]:3000' }, '::1')) === true);
    check('isLoopbackRequest: a loopback socket that carries a forwarding header is a proxy, not the owner', httpUtil.isLoopbackRequest(fakeReq({ host: 'localhost:3000', 'x-forwarded-for': '203.0.113.9' }, '127.0.0.1')) === false);
    check('isLoopbackRequest: a loopback socket asked for a public host name is a proxy too', httpUtil.isLoopbackRequest(fakeReq({ host: 'shop.example' }, '127.0.0.1')) === false);
    check('isLoopbackRequest: a remote socket never', httpUtil.isLoopbackRequest(fakeReq({ host: 'localhost:3000' }, '203.0.113.9')) === false);
    // a stock nginx proxy_pass: loopback socket, Host rewritten to the upstream address, no forwarding header — and HTTP/1.0
    const stockProxy = Object.assign(fakeReq({ host: '127.0.0.1:3000' }, '127.0.0.1'), { httpVersionMajor: 1, httpVersionMinor: 0 });
    const browser = Object.assign(fakeReq({ host: '127.0.0.1:3000' }, '::ffff:127.0.0.1'), { httpVersionMajor: 1, httpVersionMinor: 1 });
    check('isLoopbackRequest: HTTP/1.0 is a proxy that hides itself, HTTP/1.1 on the same address is a browser', httpUtil.isLoopbackRequest(stockProxy) === false && httpUtil.isLoopbackRequest(browser) === true);
    check('isLoopbackRequest: a host NAME that merely starts with 127. is not this machine', httpUtil.isLoopbackRequest(fakeReq({ host: '127.shop.example' }, '127.0.0.1')) === false);

    check('normalizeBaseUrl: a bare domain gets https, the trailing slash goes', config.normalizeBaseUrl('www.shop.example/').value === 'https://www.shop.example');
    check('normalizeBaseUrl: empty clears', config.normalizeBaseUrl('  ').ok === true && config.normalizeBaseUrl('').value === '');
    check('normalizeBaseUrl: nonsense is refused in Hebrew', config.normalizeBaseUrl('not a url at all!!').ok === false && /כתובת האתר/.test(config.normalizeBaseUrl('ftp://x.example').error || ''));
  });

  // =======================================================================
  // 5. the setup code
  // =======================================================================
  await group('setup code', async () => {
    check('auth.setupCode / checkSetupCode are exported', typeof auth.setupCode === 'function' && typeof auth.checkSetupCode === 'function');
    if (typeof auth.setupCode !== 'function') return;
    const code = auth.setupCode();
    check('the boot code is XXXXX-XXXXX from an unambiguous alphabet', /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(code), code);
    check('…stable for the life of the process', auth.setupCode() === code);
    check('…accepted as printed, in lower case, and without the dash', auth.checkSetupCode(code) && auth.checkSetupCode(code.toLowerCase()) && auth.checkSetupCode(' ' + code.replace('-', '') + ' '));
    check('…a wrong, empty or missing code is refused', !auth.checkSetupCode('AAAAA-AAAAA') && !auth.checkSetupCode('') && !auth.checkSetupCode(undefined));
    process.env.TAPUZ_SETUP_TOKEN = 'the-owner-chose-this';
    check('TAPUZ_SETUP_TOKEN replaces the boot code', auth.setupCode() === 'the-owner-chose-this' && auth.setupCodeSource() === 'env');
    check('…and only it is accepted', auth.checkSetupCode('the-owner-chose-this') && !auth.checkSetupCode(code) && !auth.checkSetupCode('THE-OWNER-CHOSE-THIS'));
    delete process.env.TAPUZ_SETUP_TOKEN;
  });

  // =======================================================================
  // 6. reserved addresses
  // =======================================================================
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'אתר בדיקה', description: 'platform smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const pages = require('../src/pages');
  await group('reserved addresses', async () => {
    for (const slug of ['admin', 'index', 'api', 'account', '404', '_tapuz', 'Admin']) {
      let msg = '';
      try { pages.createPage({ title: 'x', slug, blocks: [] }); } catch (e) { msg = e.message; }
      check('a page cannot be created at /' + slug + ' (Hebrew refusal)', /שמורה/.test(msg), msg || 'it was created');
    }
    check('…and none of them reached the database', !pages.getPageByFullPath('admin') && !pages.getPageByFullPath('index'));
    pages.createPage({ title: 'אודות', slug: 'about-en', blocks: [] });
    // a rename is refused WITHOUT throwing: in the builder the address follows
    // the title on every save, so a throw here would refuse the content too
    let msg = '';
    let renamed = null;
    try {
      renamed = pages.updatePage('about-en', { title: 'Account', slug: 'Account', blocks: [{ type: 'heading', data: { text: 'kept' } }] });
    } catch (e) { msg = 'threw: ' + e.message; }
    check('a page cannot be RENAMED to a reserved address: it keeps the address it has', !msg && !!pages.getPageByFullPath('about-en') && !pages.getPageByFullPath('Account') && !pages.getPageByFullPath('account'), msg || 'it was renamed');
    check('…the rest of that save still lands (a retitled page must not lose its edits)', !!renamed && pages.getPageByFullPath('about-en').title === 'Account' && (pages.getPageByFullPath('about-en').draft_blocks || []).length === 1, msg);
    check('…and the result says why, in Hebrew', !!renamed && /שמורה/.test(renamed.renameRefused || ''), renamed && renamed.renameRefused);
    const plain = pages.updatePage('about-en', { title: 'אודות' });
    check('an ordinary save carries no such note', plain.renameRefused === undefined);
    msg = '';
    process.env.TAPUZ_ADMIN_PATH = '/manage-x7q';
    msg = '';
    try { pages.createPage({ title: 'x', slug: 'manage-x7q', blocks: [] }); } catch (e) { msg = e.message; }
    delete process.env.TAPUZ_ADMIN_PATH;
    check('a custom admin address is reserved too', /שמורה/.test(msg), msg || 'it was created');
    let allowed = true;
    try { pages.createPage({ title: 'מדריך', slug: 'admin-guide', blocks: [] }); pages.createPage({ title: 'חנות', slug: 'shop-notes', blocks: [] }); } catch (e) { allowed = false; }
    check('look-alikes are fine (admin-guide, shop-notes)', allowed);
    pages.savePageSource('about-en', '<bent-heading level="1">About</bent-heading>', { publish: true });
  });

  // The refusal above is new, and three importers did not expect it: a
  // design or a package that names a page "Account" used to land. Each case
  // cleans up after itself — site A below must be what it was.
  await group('imports meet a reserved address', async () => {
    // a site moved by package: the page that LIVED at a now-reserved address
    const sitePackage = require('../src/site-package');
    const heading = (t) => '<bent-heading level="1">' + t + '</bent-heading>';
    const moved = sitePackage.importSitePackage({
      format: 'tapuz-site', version: 1, name: 'an older site',
      pages: [
        { fullPath: 'sitemap', title: 'Sitemap', status: 'published', draftSource: heading('Our map, edited'), publishedSource: heading('Our map') },
        { fullPath: 'old-plain', title: 'Plain', status: 'draft', draftSource: heading('Plain') },
        { fullPath: 'admin', title: 'Admin', status: 'draft', draftSource: heading('Not here') }
      ]
    });
    const kept = pages.getPageByFullPath('sitemap');
    check('site package: a page that lived at /sitemap on the source site arrives, published, with its words',
      moved.pagesCreated.indexOf('sitemap') >= 0 && !!kept && kept.status === 'published' && /Our map/.test(String(pages.getPageSource('sitemap', 'published'))) && /Our map, edited/.test(String(pages.getPageSource('sitemap', 'draft'))),
      JSON.stringify({ created: moved.pagesCreated, skipped: moved.pagesSkipped }));
    check('site package: …the pages around it arrive too', moved.pagesCreated.indexOf('old-plain') >= 0 && !!pages.getPageByFullPath('old-plain'));
    check('site package: …but never a page at /admin — skipped, and the report says why', !pages.getPageByFullPath('admin') && moved.pagesCreated.indexOf('admin') < 0 && moved.pagesSkipped.some((s) => /^admin \(/.test(s) && /שמורה/.test(s)), JSON.stringify(moved.pagesSkipped));
    const refusal = (opts) => { try { pages.createPage(Object.assign({ title: 'x', blocks: [] }, opts)); return 'it was created'; } catch (e) { return e.code || e.message; } };
    const plainCall = refusal({ slug: 'account' });
    const adminCall = refusal({ slug: 'Admin', allowReserved: true });
    check('…createPage without the option still refuses a reserved address, and WITH it still refuses the admin\'s',
      plainCall === 'E_RESERVED_PATH' && adminCall === 'E_RESERVED_PATH' && !pages.getPageByFullPath('account') && !pages.getPageByFullPath('Admin'), plainCall + ' / ' + adminCall);
    for (const fp of ['sitemap', 'old-plain']) pages.deletePage(fp);

    // a design whose pages are named Account, 404 and Index (Geppetto)
    const P = require('../src/geppetto/puppet');
    const gp = require('../src/geppetto');
    let z = 0;
    const words = (id, y, t, size) => ({ id, type: 'text', x: 383, y, w: 600, h: 70, z: z++, paragraphs: [{ align: 'start', list: null, runs: [{ text: t, size, color: '#222222', font: 'body', bold: false }] }] });
    const designPage = (key, at, title) => ({ key, path: at, title, name: '', width: 1366, sections: [
      { key: key + '-s', anchor: '', height: 400, fill: { color: '#ffffff' }, nodes: [words(key + '-h', 100, title, 56), words(key + '-p', 200, 'Words about ' + title, 20)] }
    ] });
    const plan = gp.planFromPuppet(P.makePuppet({
      source: 'canva', format: 'canva-app', origin: 'https://studio.example/', site: { title: 'Studio', lang: 'en', dir: 'ltr' },
      pages: [designPage('h', '/', 'Studio'), designPage('a', '/account', 'Account'), designPage('n', '/404', '404'), designPage('i', '/index', 'Index')]
    }), {});
    let landed = null;
    let threw = '';
    try {
      landed = await gp.landPlan(plan.id, { mode: 'drafts', media: false, theme: false }, { transport: async () => { throw new Error('no network in a smoke'); }, rebuild: false });
    } catch (e) { threw = e.message; }
    const at = landed ? landed.pages.map((p) => p.fullPath) : [];
    check('Geppetto: a design with pages named Account, 404 and Index lands — each beside the reserved address, none on it',
      !threw && at.length === 4 && at.indexOf('account-2') >= 0 && at.indexOf('404-2') >= 0 && at.indexOf('index-2') >= 0 && at.every((fp) => !pages.isReservedPath(fp) && !!pages.getPageByFullPath(fp)), threw || at.join(','));
    for (const fp of at) pages.deletePage(fp);
  });

  // =======================================================================
  // 7. the build id on a host that writes no .build-id
  // =======================================================================
  const buildInfo = require('../src/build-info');
  await group('build id', async () => {
    check('deployFingerprint is exported', typeof buildInfo.deployFingerprint === 'function');
    if (typeof buildInfo.deployFingerprint !== 'function') return;
    const pkg = path.join(HOLD, 'pkg');
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(pkg, rel)), { recursive: true }); fs.writeFileSync(path.join(pkg, rel), text); };
    put('package.json', '{"version":"1.0.0"}');
    put('src/server.js', '// server');
    put('src/store/render.js', '// cards');
    put('themes/default/css/main.css', 'body{}');
    put('public/tz-store.js', '// store');
    put('public/index.html', '<html>exported</html>');
    put('public/css/main.css', 'exported{}');
    const a = buildInfo.deployFingerprint(pkg);
    check('the fingerprint is a short hex string', /^[0-9a-f]{8}$/.test(a), a);
    check('…stable while nothing changes', buildInfo.deployFingerprint(pkg) === a);
    const bump = (rel) => { const t = new Date(Date.now() + 120000 + Math.floor(Math.random() * 1e6)); fs.utimesSync(path.join(pkg, rel), t, t); };
    bump('themes/default/css/main.css');
    const b = buildInfo.deployFingerprint(pkg);
    check('…changes when the theme stylesheet was redeployed', b !== a);
    bump('public/tz-store.js');
    const c = buildInfo.deployFingerprint(pkg);
    check('…changes when the storefront script was redeployed', c !== b);
    bump('src/store/render.js');
    const d = buildInfo.deployFingerprint(pkg);
    check('…changes when any server file was redeployed (the product cards)', d !== c);
    put('package.json', '{"version":"1.0.1"}');
    const e = buildInfo.deployFingerprint(pkg);
    check('…changes with package.json', e !== d);
    put('public/index.html', '<html>exported again</html>');
    put('public/css/main.css', 'exported-again{}');
    check('…does NOT change when the site is merely exported again', buildInfo.deployFingerprint(pkg) === e);
    if (!fs.existsSync(path.join(REPO, '.build-id'))) {
      const id = buildInfo.buildId();
      check('without .build-id the id is <version>+dev.<fingerprint>, not the constant "+dev"', id === require('../package.json').version + '+dev.' + buildInfo.deployFingerprint(), id);
    }
  });

  // =======================================================================
  // 8. the export writes whole files
  // =======================================================================
  await group('export', async () => {
    const exp = require('../src/export');
    const pub = path.join(ROOT, 'public');
    exp.exportAll();
    check('a full export leaves no temp file in public/', fs.readdirSync(pub).concat(fs.readdirSync(path.join(pub, 'css'))).every((n) => !/\.tmp$/.test(n)));
    const stale = path.join(pub, 'home.html.99999.tmp');
    fs.writeFileSync(stale, 'half a pa');
    const old = new Date(Date.now() - 5 * 60 * 1000);
    fs.utimesSync(stale, old, old);
    const inFlight = path.join(pub, 'home.html.88888.tmp');
    fs.writeFileSync(inFlight, 'another process, right now');
    // the theme stylesheet: once per build, not once per page
    const css = path.join(pub, 'css', 'main.css');
    const realRename = fs.renameSync;
    let cssWrites = 0;
    fs.renameSync = function (from, to) { if (to === css) cssWrites++; return realRename.apply(fs, arguments); };
    try { exp.exportAll(); } finally { fs.renameSync = realRename; }
    check('exportAll writes the theme stylesheet once for the whole build', cssWrites === 1, cssWrites + ' writes');
    check('a temp file a killed export left behind is swept by the next build', !fs.existsSync(stale));
    check('…a fresh one (another process, mid-write) is left alone', fs.existsSync(inFlight));
    fs.unlinkSync(inFlight);
    // killed between the bytes and the rename: the live page is still whole
    const home = path.join(pub, 'home.html');
    const before = fs.readFileSync(home, 'utf8');
    fs.renameSync = function (from, to) { if (to === home) throw new Error('killed'); return realRename.apply(fs, arguments); };
    try { exp.exportPage('home'); } catch (e) { /* the kill */ } finally { fs.renameSync = realRename; }
    check('an export that dies mid-page leaves the live page whole', fs.readFileSync(home, 'utf8') === before && /<\/html>\s*$/.test(before));
  });

  // =======================================================================
  // the living site for boot A: the store open, the portal on, a customer
  // =======================================================================
  await group('site A setup', async () => {
    const c = config.loadConfig();
    c.crm = Object.assign({}, c.crm, { enabled: true, portal: { enabled: true, allowSelfRegister: true } });
    config.saveConfig(c);
    require('../src/store').flip(true);
    const person = require('../src/crm/contacts').upsertContact({ email: 'shopper@example.com', name: 'Shopper', status: 'customer' }).contact;
    require('../src/crm/portal').createForContact(person.id, 'shopper', 'password99');
  });
  // the parent never touches this database again — the server owns it now
  try { require('../src/db').db.close(); } catch (e) { /* already closed */ }

  // =======================================================================
  // BOOT A — the living site, behind one trusted proxy
  // =======================================================================
  let server = null;
  const INDEX = path.join(ROOT, 'public', 'index.html');
  const indexHtml = () => fs.readFileSync(INDEX, 'utf8');
  try {
    server = boot(ROOT, { TAPUZ_TRUST_PROXY: '1' });
    await waitUp();

    await group('A: health and headers', async () => {
      const h = await req('GET', '/_tapuz/health', { accept: '*/*' });
      check('GET /_tapuz/health → 200 { ok, version, build, db }', h.status === 200 && h.json && h.json.ok === true && h.json.db === 'ok' &&
        h.json.version === require('../package.json').version && typeof h.json.build === 'string' && h.json.build.length > 0, h.status + ' ' + h.text.slice(0, 120));
      check('…exactly those four keys, nothing secret', h.json && Object.keys(h.json).sort().join(',') === 'build,db,ok,version' && h.text.indexOf(ROOT) < 0 && !/secret|token|password/i.test(h.text));
      check('…never cached', h.headers['cache-control'] === 'no-store');

      const home = await req('GET', '/');
      const api = await req('GET', '/api/store/catalog', { accept: 'application/json' });
      const portal = await req('GET', '/account/login');
      const admin = await req('GET', '/admin/login');
      check('the home page answers', home.status === 200 && /<html lang="he" dir="rtl">/.test(home.text));
      check('X-Powered-By is gone from every kind of response', [home, api, portal, admin, h].every((r) => r.headers['x-powered-by'] === undefined));
      check('/api/store/catalog carries nosniff + X-Frame-Options', api.status === 200 && api.headers['x-content-type-options'] === 'nosniff' && api.headers['x-frame-options'] === 'SAMEORIGIN', JSON.stringify(api.headers));
      check('/account/login carries nosniff + X-Frame-Options (the form cannot be framed)', portal.status === 200 && portal.headers['x-content-type-options'] === 'nosniff' && portal.headers['x-frame-options'] === 'SAMEORIGIN' && !!portal.headers['referrer-policy'], JSON.stringify(portal.headers));
      check('the admin keeps its own stricter DENY', admin.headers['x-frame-options'] === 'DENY' && admin.headers['referrer-policy'] === 'same-origin');
      check('no HSTS over plain http', home.headers['strict-transport-security'] === undefined && api.headers['strict-transport-security'] === undefined);
      const https = await req('GET', '/', { headers: Object.assign({ 'X-Forwarded-Proto': 'https' }, REMOTE) });
      const httpsApi = await req('GET', '/api/store/catalog', { accept: 'application/json', headers: Object.assign({ 'X-Forwarded-Proto': 'https' }, REMOTE) });
      check('HSTS when the visitor is on https (the trusted proxy says so)', https.headers['strict-transport-security'] === 'max-age=31536000' && httpsApi.headers['strict-transport-security'] === 'max-age=31536000');
      check('the public policy without PayPal, pixels or fonts is the original string, character for character', home.headers['content-security-policy'] === CSP_PLAIN, home.headers['content-security-policy']);
    });

    await group('A: 404', async () => {
      const dead = await req('GET', '/no-such-page-anywhere');
      check('a dead address → 404', dead.status === 404);
      check('…a page of this site, not Express\'s "Cannot GET"', !/Cannot GET/.test(dead.text) && /class="site-header/.test(dead.text) && /<footer/.test(dead.text), dead.text.slice(0, 200));
      check('…in the site\'s language and direction', /<html lang="he" dir="rtl">/.test(dead.text) && /הדף לא נמצא/.test(dead.text));
      check('…noindex, in the page and in the header', /<meta name="robots" content="noindex/.test(dead.text) && /noindex/.test(dead.headers['x-robots-tag'] || ''));
      check('…with a way home, and to the shop while the store is open', /href="\/"[^>]*>חזרה לדף הבית</.test(dead.text) && /href="\/shop\.html"[^>]*>לחנות</.test(dead.text));
      check('…no canonical, og:url or structured data for an address that does not exist', !/rel="canonical"/.test(dead.text) && !/og:url/.test(dead.text) && !/ld\+json/.test(dead.text));
      check('…the stylesheet is linked, not inlined (the answer stays small)', /href="\/css\/main\.css\?v=[0-9a-f]+"/.test(dead.text) && !/<style>/.test(dead.text) && dead.buf.length < 40000, dead.buf.length + ' bytes');
      check('…and it wears the public policy', dead.headers['content-security-policy'] === CSP_PLAIN);
      const deadHtml = await req('GET', '/shop-retired-product.html');
      check('a retired page\'s .html address gets the same page', deadHtml.status === 404 && /הדף לא נמצא/.test(deadHtml.text));
      const post = await req('POST', '/no-such-page-anywhere', { form: { a: '1' } });
      check('a POST to nowhere is a 404 too, never "Cannot POST"', post.status === 404 && !/Cannot POST/.test(post.text));
      const apiDead = await req('GET', '/api/nope', { accept: '*/*' });
      check('under /api/ → JSON { ok:false, error:"not found" }', apiDead.status === 404 && apiDead.json && apiDead.json.ok === false && apiDead.json.error === 'not found', apiDead.text.slice(0, 120));
      const agentDead = await req('GET', '/agent/nope', { accept: '*/*' });
      check('under /agent/ → JSON', agentDead.status === 404 && agentDead.json && agentDead.json.ok === false);
      const jsonCaller = await req('GET', '/whatever', { accept: 'application/json' });
      check('a JSON caller anywhere → JSON', jsonCaller.status === 404 && jsonCaller.json && jsonCaller.json.error === 'not found');
      const img = await req('GET', '/assets/missing-picture.png', { accept: 'image/*' });
      check('a missing file is one short line, not a web page', img.status === 404 && /text\/plain/.test(img.headers['content-type'] || '') && img.buf.length < 40);
    });

    let cookie = '';
    let editorCookie = '';
    await group('A: sign in', async () => {
      const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
      cookie = cookieOf(login);
      const ed = await req('POST', '/admin/login', { form: { username: 'dana', password: 'dana-pass-1' } });
      editorCookie = cookieOf(ed);
      check('the owner and the editor sign in', login.status === 302 && cookie.length > 20 && ed.status === 302 && editorCookie.length > 20);
      const adminDead = await req('GET', '/admin/no-such-screen', { cookie });
      check('a dead address inside the admin → 404 in the admin\'s own shell, with a way back', adminDead.status === 404 && /admin-side/.test(adminDead.text) && /אין מסך כזה/.test(adminDead.text) && /href="\/admin\/dashboard"/.test(adminDead.text));
      const adminApiDead = await req('GET', '/admin/api/no-such-endpoint', { cookie, accept: '*/*' });
      check('a dead /admin/api address → JSON', adminApiDead.status === 404 && adminApiDead.json && adminApiDead.json.error === 'not found');
      const denied = await req('GET', '/admin/team', { cookie: editorCookie });
      check('an editor on a manager-only screen → 403 in the admin shell, with a way back', denied.status === 403 && /admin-side/.test(denied.text) && /למנהלים בלבד/.test(denied.text) && /href="\/admin\/dashboard"/.test(denied.text), denied.text.slice(0, 160));
      const deniedJson = await req('GET', '/admin/api/integrations', { cookie: editorCookie, accept: 'application/json' });
      check('…and JSON for a JSON caller, carrying both error and message', deniedJson.status === 403 && deniedJson.json && deniedJson.json.ok === false && !!deniedJson.json.error && !!deniedJson.json.message);
    });

    await group('A: the admin lockout, with the proxy declared', async () => {
      // the flag is set: each visitor has an address of his own, and the
      // lockout is what it has been since S4 — address, and address+username
      const attacker = { 'X-Forwarded-For': '203.0.113.201' };
      const spray = [];
      for (const name of ['admin', 'root', 'administrator', 'test', 'manager', 'webmaster']) {
        const r = await req('POST', '/admin/login', { form: { username: name, password: 'guess-guess-1' }, headers: attacker });
        spray.push(r.status);
      }
      const locked = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' }, headers: attacker });
      const wait = Number(locked.headers['retry-after']);
      check('A: six wrong passwords from one address, for any usernames, lock that address (429, Retry-After 30, the sentence)',
        spray.every((s) => s === 302) && locked.status === 429 && wait > 0 && wait <= 30 && /נחסמת זמנית עקב ניסיונות כושלים/.test(locked.text) && !locked.headers['set-cookie'], spray.join(',') + ' → ' + locked.status + ' retry-after ' + wait);
      const other = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' }, headers: { 'X-Forwarded-For': '203.0.113.202' } });
      check('A: …and only that address: the owner signs in from his own', other.status === 302 && cookieOf(other).length > 20 && !/err=/.test(other.headers.location || ''), other.status + ' ' + other.headers.location);
    });

    await group('A: the sitemap\'s scheme', async () => {
      const proxied = await req('GET', '/sitemap.xml', { accept: '*/*', headers: Object.assign({ Host: 'shop.example', 'X-Forwarded-Proto': 'https' }, REMOTE) });
      check('behind a trusted TLS proxy the sitemap prints https://', proxied.status === 200 && /<loc>https:\/\/shop\.example\//.test(proxied.text) && !/http:\/\/shop\.example/.test(proxied.text), proxied.text.slice(0, 300));
      const robots = await req('GET', '/robots.txt', { accept: '*/*', headers: Object.assign({ Host: 'shop.example', 'X-Forwarded-Proto': 'https' }, REMOTE) });
      check('…and so does robots.txt', /Sitemap: https:\/\/shop\.example\/sitemap\.xml/.test(robots.text), robots.text);
      const direct = await req('GET', '/sitemap.xml', { accept: '*/*', headers: { Host: 'shop.example' } });
      check('a plain http request still prints http://', /<loc>http:\/\/shop\.example\//.test(direct.text));
      // a proxy that APPENDS: the client's own "http" first, the proxy's "https" last
      const appended = Object.assign({ Host: 'shop.example', 'X-Forwarded-Proto': 'http, https' }, REMOTE);
      const robots2 = await req('GET', '/robots.txt', { accept: '*/*', headers: appended });
      const login2 = await req('POST', '/admin/login', { form: { username: 'dana', password: 'dana-pass-1' }, headers: Object.assign({ Origin: 'https://shop.example' }, appended) });
      check('X-Forwarded-Proto "http, https": robots.txt prints https:// AND the session cookie is Secure — one reading, the proxy\'s entry',
        /Sitemap: https:\/\/shop\.example\/sitemap\.xml/.test(robots2.text) && login2.status === 302 && /; Secure/.test(String((login2.headers['set-cookie'] || [])[0] || '')), robots2.text.replace(/\s+/g, ' ').slice(-60) + ' | ' + String((login2.headers['set-cookie'] || [])[0] || '').slice(-40));
      const flipped = Object.assign({ Host: 'shop.example', 'X-Forwarded-Proto': 'https, http' }, REMOTE);
      const robots3 = await req('GET', '/robots.txt', { accept: '*/*', headers: flipped });
      const login3 = await req('POST', '/admin/login', { form: { username: 'dana', password: 'dana-pass-1' }, headers: Object.assign({ Origin: 'http://shop.example' }, flipped) });
      check('…and "https, http": http:// and no Secure — again the same answer from both', /Sitemap: http:\/\/shop\.example\/sitemap\.xml/.test(robots3.text) && login3.status === 302 && !/Secure/.test(String((login3.headers['set-cookie'] || [])[0] || '')));
    });

    await group('A: the base-URL line', async () => {
      const local = await req('GET', '/admin/dashboard', { cookie });
      check('on the server\'s own machine the dashboard says nothing about the address', local.status === 200 && !/כתובת האתר עוד לא הוגדרה/.test(local.text));
      const viaProxy = Object.assign({ Host: 'shop.example', 'X-Forwarded-Proto': 'https' }, REMOTE);
      const dash = await req('GET', '/admin/dashboard', { cookie, headers: viaProxy });
      check('a hosted site with no base URL: the dashboard says so, in one line', dash.status === 200 && /כתובת האתר עוד לא הוגדרה: בלי זה אין קישור קנוני, ותמונות שיתוף לא יוצגו\./.test(dash.text));
      check('…with a button that offers the https address the owner is on', /action="\/admin\/seo\/base-url-here"/.test(dash.text) && /https:\/\/shop\.example/.test(dash.text));
      check('…and no word about an http:// sitemap here: with the proxy declared the sitemap already prints https://', !/מדפיסה כתובות/.test(dash.text));
      const list = await req('GET', '/admin', { cookie, headers: viaProxy });
      check('…and the pages list (where a login lands) says it too', list.status === 200 && /כתובת האתר עוד לא הוגדרה/.test(list.text));
      const overHttp = await req('POST', '/admin/seo/base-url-here', { cookie, headers: Object.assign({ Host: 'shop.example', Origin: 'http://shop.example' }, REMOTE) });
      check('the button refuses to save an http address', overHttp.status === 302 && /base=http/.test(overHttp.headers.location || '') && !config.loadConfig().baseUrl);
      const save = await req('POST', '/admin/seo/base-url-here', { cookie, headers: Object.assign({ Origin: 'https://shop.example' }, viaProxy) });
      check('the button saves the https origin through the validated door', save.status === 302 && /base=saved/.test(save.headers.location || '') && config.loadConfig().baseUrl === 'https://shop.example', (save.headers.location || '') + ' / ' + config.loadConfig().baseUrl);
      check('…and rebuilds: the exported home now has its canonical link', /<link rel="canonical" href="https:\/\/shop\.example\/">/.test(indexHtml()));
      const after = await req('GET', '/admin/dashboard?base=saved', { cookie, headers: viaProxy });
      check('…the line is gone and the dashboard confirms', !/כתובת האתר עוד לא הוגדרה/.test(after.text) && /כתובת האתר נשמרה/.test(after.text));
      const sm = await req('GET', '/sitemap.xml', { accept: '*/*', headers: { Host: 'other.example' } });
      check('with a base URL set the sitemap prints it, whatever the request looks like', /<loc>https:\/\/shop\.example\//.test(sm.text) && !/other\.example/.test(sm.text));
    });

    await group('A: saves that reach visitors', async () => {
      const seo = await req('POST', '/admin/api/seo', { cookie, json: { titlePattern: '{page} · {site} · SEOSAVE' } });
      check('SEO save answers ok with rebuildError', seo.status === 200 && seo.json.ok === true && seo.json.rebuildError === '', seo.text.slice(0, 160));
      check('…and the exported home carries the new title pattern', /<title>[^<]*SEOSAVE<\/title>/.test(indexHtml()));

      const settings = await req('POST', '/admin/api/settings', { cookie, json: { title: 'חנות הסמוק החדשה' } });
      check('settings save (the site name alone) answers ok with rebuildError', settings.status === 200 && settings.json.ok === true && settings.json.rebuildError === '', settings.text.slice(0, 160));
      check('…and the exported home carries the new name', /חנות הסמוק החדשה/.test(indexHtml()));
      const badBase = await req('POST', '/admin/api/settings', { cookie, json: { baseUrl: 'not a url at all!!' } });
      check('the settings screen refuses a broken base URL (it used to store it raw)', badBase.status === 400 && /כתובת האתר/.test((badBase.json || {}).error || '') && config.loadConfig().baseUrl === 'https://shop.example');
      const goodBase = await req('POST', '/admin/api/settings', { cookie, json: { baseUrl: ' www.site.example/ ' } });
      check('…and normalises a good one exactly as the SEO screen does', goodBase.status === 200 && config.loadConfig().baseUrl === 'https://www.site.example' && goodBase.json.baseUrl === 'https://www.site.example');
      check('…which reaches the exported canonical', /<link rel="canonical" href="https:\/\/www\.site\.example\/">/.test(indexHtml()));

      const chrome = await req('POST', '/admin/api/site-chrome', { cookie, json: { header: { tagline: 'TAGLINE-SMOKE' } } });
      check('header/footer save answers ok with rebuildError', chrome.status === 200 && chrome.json.ok === true && chrome.json.rebuildError === '');
      check('…and the exported home carries the tagline', /TAGLINE-SMOKE/.test(indexHtml()));

      const integ = await req('POST', '/admin/api/integrations', { cookie, json: { whatsapp: { enabled: true, phone: '972501234567', position: 'start' }, search: { enabled: true } } });
      check('integrations save answers ok with rebuildError', integ.status === 200 && integ.json.ok === true && integ.json.rebuildError === '');
      check('…the exported home carries the WhatsApp button, and the search index was written', /wa\.me\/972501234567/.test(indexHtml()) && fs.existsSync(path.join(ROOT, 'public', 'search-index.json')));

      const link = await req('POST', '/admin/api/translations/link', { cookie, json: { pathA: 'home', langA: 'he', pathB: 'about-en', langB: 'en' } });
      check('linking translations answers ok with rebuildError', link.status === 200 && link.json.ok === true && link.json.rebuildError === '', link.text.slice(0, 160));
      check('…and the exported home carries the language switch', /tapuz-lang-switch/.test(indexHtml()));
      const unlink = await req('POST', '/admin/api/translations/unlink', { cookie, json: { path: 'about-en' } });
      check('unlinking rebuilds too: the switch is gone', unlink.status === 200 && unlink.json.rebuildError === '' && !/tapuz-lang-switch/.test(indexHtml()));

      const pagesText = [(await req('GET', '/admin/site-chrome', { cookie })).text, (await req('GET', '/admin/integrations', { cookie })).text, (await req('GET', '/admin/translations', { cookie })).text].join('\n');
      check('no screen tells the owner to go and press "בנה אתר" any more', pagesText.length > 3000 && !/אחרי "בנה אתר"|לחצו "בנה אתר"/.test(pagesText));
    });

    await group('A: the 404 follows the site', async () => {
      const toEn = await req('POST', '/admin/api/settings', { cookie, json: { language: 'en' } });
      check('the site switches to English', toEn.status === 200 && toEn.json.ok === true);
      const dead = await req('GET', '/still-no-such-page');
      check('the 404 is English and left-to-right at once (rendered again after the rebuild)', dead.status === 404 && /<html lang="en" dir="ltr">/.test(dead.text) && /Page not found/.test(dead.text) && /Back to the home page/.test(dead.text), dead.text.slice(0, 120));
      await req('POST', '/admin/api/settings', { cookie, json: { language: 'he' } });
      const back = await req('GET', '/still-no-such-page');
      check('…and Hebrew again when the site is', /<html lang="he" dir="rtl">/.test(back.text) && /הדף לא נמצא/.test(back.text));
    });

    await group('A: a reserved address, through the admin\'s own doors', async () => {
      // the plain "new page" form has no catch of its own
      const made = await req('POST', '/admin/create', { cookie, form: { title: 'API' } });
      // a reserved address reads as a TAKEN one: the page is made at the next
      // free address, the way a second page with the same title always was
      check('"new page" titled API → made at a free address (API-2), never a refusal screen or "server error"',
        made.status === 302 && /\/admin\/edit\/API-2$/.test(made.headers.location || ''),
        made.status + ' ' + (made.headers.location || made.text.slice(0, 120)));
      const madeJson = await req('POST', '/admin/create', { cookie, form: { title: 'API' }, accept: 'application/json' });
      check('…and a second one takes the next free address', madeJson.status === 302 && /\/admin\/edit\/API-3$/.test(madeJson.headers.location || ''), madeJson.status + ' ' + (madeJson.headers.location || ''));
      const list = await req('GET', '/admin/api/pages', { cookie, accept: 'application/json' });
      check('…no page was created at /API', list.status === 200 && !/"full_path":"api"/i.test(list.text), list.text.slice(0, 120));
      const notes = await req('POST', '/admin/create', { cookie, form: { title: 'Notes' } });
      check('an ordinary title still makes its page', notes.status === 302 && /\/admin\/edit\/Notes$/.test(notes.headers.location || ''), notes.headers.location);
      // the builder's save: the address follows the title
      const saved = await req('POST', '/admin/save', { cookie, json: { full_path: 'Notes', title: 'Account', slug: 'Account', blocks: [{ type: 'heading', data: { text: 'reserved-save' } }] } });
      check('the builder\'s save of a page retitled "Account" is accepted, at the address it had',
        saved.status === 200 && saved.json && saved.json.ok === true && saved.json.full_path === 'Notes', saved.status + ' ' + saved.text.slice(0, 160));
      const after = await req('GET', '/admin/api/pages', { cookie, accept: 'application/json' });
      check('…the new title is saved, and nothing lives at /Account', /"title":"Account"/.test(after.text) && !/"full_path":"account"/i.test(after.text));
    });

    await group('A: body limits', async () => {
      const big = 'a'.repeat(1024 * 1024);
      const anon = await req('POST', '/admin/api/seo', { json: { description: 'x', pad: big }, accept: 'application/json' });
      const anonPublic = await req('POST', '/api/nowhere', { json: { pad: big }, accept: 'application/json' });
      check('an anonymous 1 MB JSON POST anywhere else → 413', anonPublic.status === 413, anonPublic.status);
      const forged = await req('POST', '/admin/api/seo', { json: { pad: big }, cookie: 'tapuz_sess=forged.signature', accept: 'application/json' });
      check('a forged session cookie does not buy the admin\'s allowance (refused, nothing saved)', forged.status === 401 && forged.json && forged.json.ok === false, forged.status);
      const small = await req('POST', '/admin/api/seo', { json: { description: 'x', pad: 'a'.repeat(200 * 1024) }, accept: 'application/json' });
      check('an anonymous 200 KB POST passes the parser and meets the gate (401)', small.status === 401, small.status);
      // An owner whose session ran out saves a big page: the answer must be
      // the gate's "not signed in", word for word — never "payload too large"
      check('a signed-out 1 MB JSON POST to the admin → 401 "לא מחובר", the very JSON the gate gives a small one (it was a 413 "payload too large")',
        anon.status === 401 && anon.json && anon.json.ok === false && anon.json.error === 'לא מחובר' && JSON.stringify(anon.json) === JSON.stringify(small.json), anon.status + ' ' + anon.text.slice(0, 80));
      // …and it is still refused UNREAD: a megabyte that is not JSON at all
      // would be a 400 from any parser that had looked at it
      const garbage = await req('POST', '/admin/api/seo', { raw: '{"pad": "' + big, headers: { 'Content-Type': 'application/json' }, accept: 'application/json' });
      check('…refused before it is parsed: a megabyte of broken JSON gets the same 401, not a parser\'s 400', garbage.status === 401 && garbage.json && garbage.json.error === 'לא מחובר', garbage.status + ' ' + garbage.text.slice(0, 80));
      const streamed = await req('POST', '/admin/upload', { json: { name: 'photo.jpg', data: big }, chunked: true, accept: 'application/json' });
      check('…the same for an upload sent without a Content-Length (chunked)', streamed.status === 401 && streamed.json && streamed.json.error === 'לא מחובר', streamed.status + ' ' + streamed.text.slice(0, 80));
      const publicGarbage = await req('POST', '/admin-guide', { json: { pad: big }, accept: 'application/json' });
      check('…and only under /admin: a look-alike public address keeps its 413', publicGarbage.status === 413, publicGarbage.status);
      const mine = await req('POST', '/admin/api/seo', { cookie, json: { description: 'תיאור', pad: big } });
      check('a signed-in admin\'s 1 MB JSON POST is accepted (uploads still work)', mine.status === 200 && mine.json && mine.json.ok === true, mine.status + ' ' + mine.text.slice(0, 80));
    });

    await group('A: downloads from a root under a dot-directory', async () => {
      const made = await req('POST', '/admin/db/backup', { cookie, form: {} });
      check('a backup is made', made.status === 302 && /db=backed/.test(made.headers.location || ''), made.headers.location);
      const shelf = path.join(ROOT, 'db', 'backups');
      const name = fs.readdirSync(shelf).filter((n) => /^tapuz-.*\.sqlite$/.test(n))[0];
      const dl = await req('GET', '/admin/db/backup/' + encodeURIComponent(name), { cookie, accept: '*/*', soft: true, timeout: 8000 });
      check('the backup downloads (send used to answer 404 for the dot segment)', dl.status === 200 && dl.buf.subarray(0, 15).toString('latin1') === 'SQLite format 3', dl.status + ' ' + (dl.error ? dl.error.message : dl.text.slice(0, 60)));
      const pzn = await req('GET', '/admin/db/export.pzn', { cookie, accept: '*/*', soft: true, timeout: 8000 });
      check('the .pzn export downloads (it used to hang until the socket timed out)', pzn.status === 200 && pzn.buf.subarray(0, 15).toString('latin1') === 'SQLite format 3' && /\.pzn/.test(pzn.headers['content-disposition'] || ''), pzn.status + ' ' + (pzn.error ? pzn.error.message : ''));
      check('…and its temp file is gone', fs.readdirSync(shelf).every((n) => !/^export-.*\.tmp$/.test(n)), fs.readdirSync(shelf).join(','));
    });

    await group('A: assets', async () => {
      const assets = path.join(ROOT, 'public', 'assets');
      fs.mkdirSync(assets, { recursive: true });
      fs.writeFileSync(path.join(assets, 'photo-1700000000000.png'), 'not really a png');
      fs.writeFileSync(path.join(assets, 'logo.png'), 'not really a png');
      const upload = await req('GET', '/assets/photo-1700000000000.png', { accept: 'image/*' });
      check('an upload (its name carries its timestamp) is cacheable for a week', upload.status === 200 && upload.headers['cache-control'] === 'public, max-age=604800', upload.headers['cache-control']);
      const fixed = await req('GET', '/assets/logo.png', { accept: 'image/*' });
      check('a fixed-name file under assets/ keeps revalidating', fixed.status === 200 && fixed.headers['cache-control'] === 'public, max-age=0', fixed.headers['cache-control']);
    });

    await group('A: the customer portal', async () => {
      const noOrigin = await req('POST', '/account/login', { form: { username: 'shopper', password: 'password99' }, noOrigin: true });
      check('a portal POST with no Origin/Referer → 403 (same rule as the admin)', noOrigin.status === 403 && /הבקשה נדחתה/.test(noOrigin.text), noOrigin.status);
      const cross = await req('POST', '/account/login', { form: { username: 'shopper', password: 'password99' }, headers: { Origin: 'https://evil.example' } });
      check('…and a cross-site POST → 403', cross.status === 403 && !cross.headers['set-cookie']);
      const logoutCross = await req('POST', '/account/logout', { headers: { Origin: 'https://evil.example' } });
      check('…another site cannot sign a customer out either', logoutCross.status === 403);
      const reflected = await req('GET', '/account/login?err=' + encodeURIComponent('Your account is locked, call 555-0100'));
      check('?err= prints only its own table, never the address\'s sentence', reflected.status === 200 && !/555-0100/.test(reflected.text) && /משהו השתבש/.test(reflected.text));
      const regReflected = await req('GET', '/account/register?err=' + encodeURIComponent('pay here'));
      check('…on the register screen too', regReflected.status === 200 && !/pay here/.test(regReflected.text) && /משהו השתבש/.test(regReflected.text));
      const good = await req('POST', '/account/login', { form: { username: 'shopper', password: 'password99' }, headers: Object.assign({ 'X-Forwarded-Proto': 'https' }, REMOTE) });
      const setCookie = String((good.headers['set-cookie'] || [])[0] || '');
      check('a real login over https: the session cookie is Secure', good.status === 302 && good.headers.location === '/account' && /tapuz_portal=/.test(setCookie) && /; Secure/.test(setCookie), setCookie);
      const plain = await req('POST', '/account/login', { form: { username: 'shopper', password: 'password99' }, headers: { 'X-Forwarded-For': '203.0.113.50' } });
      check('…over plain http it is not (the site still works without TLS)', plain.status === 302 && !/Secure/.test(String((plain.headers['set-cookie'] || [])[0] || '')));
      // the admin's own guard: five free tries, the sixth failure sets the lock
      const attacker = { 'X-Forwarded-For': '203.0.113.66' };
      const statuses = [];
      for (let i = 0; i < 7; i++) {
        const r = await req('POST', '/account/login', { form: { username: 'shopper', password: 'guess-' + i }, headers: attacker });
        statuses.push(r.status);
      }
      check('six wrong passwords from one address lock it out: the next try is a 429', statuses.slice(0, 6).every((s) => s === 302) && statuses[6] === 429, statuses.join(','));
      const locked = await req('POST', '/account/login', { form: { username: 'shopper', password: 'password99' }, headers: attacker });
      check('…even the right password waits out the lock, with Retry-After', locked.status === 429 && Number(locked.headers['retry-after']) > 0 && !locked.headers['set-cookie']);
      const other = await req('POST', '/account/login', { form: { username: 'shopper', password: 'password99' }, headers: { 'X-Forwarded-For': '203.0.113.77' } });
      check('…while another address signs in normally (the key is the visitor, not the proxy)', other.status === 302 && other.headers.location === '/account');
    });

    await group('A: an import that names a reserved address', async () => {
      // the reviewer's file: a WordPress export with pages Contact, Sitemap, Team
      const item = (title, name, body) => '<item><title>' + title + '</title><wp:post_name>' + name + '</wp:post_name><wp:post_type>page</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>' + body + '</p>]]></content:encoded></item>';
      const wxr = '<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wp="http://wordpress.org/export/1.2/"><channel><title>t</title>' +
        item('Contact', 'contact-wp', 'hello') + item('Sitemap', 'sitemap', 'map') + item('Team', 'team-wp', 'team') + '</channel></rss>';
      const imp = await req('POST', '/admin/api/import', { cookie, json: { format: 'wordpress', publish: false, content: wxr } });
      const made = ((imp.json && imp.json.created) || []).map((c) => c.fullPath);
      check('a WordPress import with a page named Sitemap finishes: all three pages, Sitemap beside the reserved address (it was a 500 "import failed" with one page made)',
        imp.status === 200 && imp.json && imp.json.ok === true && imp.json.count === 3 && made.join(',') === 'contact-wp,sitemap-2,team-wp', imp.status + ' ' + imp.text.slice(0, 200));
      const list = await req('GET', '/admin/api/pages', { cookie, accept: 'application/json' });
      check('…and all three are in the pages list, none at /sitemap', /"full_path":"contact-wp"/.test(list.text) && /"full_path":"sitemap-2"/.test(list.text) && /"full_path":"team-wp"/.test(list.text) && !/"full_path":"sitemap"/.test(list.text));
      // the HTML-paste door (decompile + create) had the same loop
      const dec = await req('POST', '/admin/api/pzn/decompile', { cookie, json: { html: '<h1>Account</h1><p>Your details live here.</p>', title: 'Account', slug: 'account', create: true, assets: false } });
      check('pasted HTML titled Account becomes a draft beside the reserved address (it was a refusal)', dec.status === 200 && dec.json && dec.json.ok === true && /^account-\d+$/.test(dec.json.fullPath || ''), dec.status + ' ' + dec.text.slice(0, 160));
    });

    await group('A: a damaged site.json, over HTTP', async () => {
      const good = fs.readFileSync(SITE_FILE);
      const cut = good.subarray(0, Math.floor(good.length / 2));
      fs.writeFileSync(SITE_FILE, cut);
      const dash = await req('GET', '/admin/dashboard', { cookie });
      check('the dashboard says the settings file is damaged', dash.status === 200 && /קובץ הגדרות האתר פגום/.test(dash.text));
      const save = await req('POST', '/admin/api/seo', { cookie, json: { description: 'דריסה' } });
      check('a save answers a Hebrew refusal, not "נשמר"', save.status === 400 && save.json && save.json.ok === false && /פגום/.test(save.json.error || ''), save.text.slice(0, 120));
      check('…and the file on disk is untouched', fs.readFileSync(SITE_FILE).equals(cut));
      // a plain form POST whose route has no catch of its own
      const form = await req('POST', '/admin/crm/settings', { cookie, form: { enabled: '1' } });
      check('a form save with no catch of its own shows the same sentence in the admin shell, not "server error"',
        form.status === 500 && /admin-side/.test(form.text) && /השינוי לא נשמר/.test(form.text) && /פגום/.test(form.text) && !/server error/.test(form.text), form.status + ' ' + form.text.slice(0, 100));
      check('…the file is still untouched, and the refusal is in the server log', fs.readFileSync(SITE_FILE).equals(cut) && await logHas(server, /\[http\] POST \/admin\/crm\/settings -> 500/));
      fs.writeFileSync(SITE_FILE, good);
      const again = await req('GET', '/admin/dashboard', { cookie });
      check('restored, the warning is gone', again.status === 200 && !/קובץ הגדרות האתר פגום/.test(again.text));
    });

    await group('A: the admin limiter speaks JSON to JSON callers', async () => {
      // 300 a minute; twice that in case the window turns over mid-loop
      let tripped = false;
      for (let i = 0; i < 640 && !tripped; i++) {
        const r = await req('GET', '/admin/login');
        if (r.status === 429) tripped = true;
      }
      check('the admin flood cap trips', tripped);
      const j = await req('GET', '/admin/api/pages', { cookie, accept: 'application/json' });
      check('…a JSON caller gets JSON it can print (fetch().json() used to throw on the text)', j.status === 429 && /application\/json/.test(j.headers['content-type'] || '') && j.json && j.json.ok === false && /יותר מדי בקשות/.test(j.json.error || '') && Number(j.headers['retry-after']) > 0, j.status + ' ' + j.text.slice(0, 80));
      const h = await req('GET', '/admin/dashboard', { cookie });
      check('…a page navigation still gets the sentence', h.status === 429 && /יותר מדי בקשות/.test(h.text));
      const health = await req('GET', '/_tapuz/health', { accept: '*/*' });
      check('…and the health route is untouched by the cap', health.status === 200);
    });
  } catch (e) {
    check('boot A ran to the end', false, (e && (e.stack || e.message)) || e);
  } finally {
    await kill(server);
  }

  // =======================================================================
  // BOOT P — the same living site behind a proxy NOBODY DECLARED: the state
  // the real sites are in. Every forwarded visitor has the proxy's address.
  // =======================================================================
  server = null;
  try {
    // Every scenario gets a server of its own: the locks live in the
    // process, and one scenario's lock must never be another one's excuse —
    // each check below fails or passes for its own reason on any tree.
    const rebootP = async (env) => {
      await kill(server);
      server = boot(ROOT, env || {}, ['--require', preloadClock]);
      await waitUp();
    };
    // caps of 3 logins and 1 registration a minute: any run of requests
    // would trip them at once if they were still keyed on the proxy
    const TIGHT = { TAPUZ_PORTAL_LOGIN_MAX: '3', TAPUZ_PORTAL_REGISTER_MAX: '1' };
    const stranger = { 'X-Forwarded-For': '203.0.113.66' };
    const ownerAt = { 'X-Forwarded-For': '198.51.100.7' };
    const LOCK_SENTENCE = /נחסמת זמנית עקב ניסיונות כושלים/;

    await rebootP();
    await group('P: the admin sign-in, shared address — a stranger and other usernames', async () => {
      const seen = [];
      for (const name of ['admin', 'root', 'administrator', 'test', 'manager', 'webmaster', 'info', 'support']) {
        const r = await req('POST', '/admin/login', { form: { username: name, password: 'guess-guess-1' }, headers: stranger });
        seen.push(r.status);
      }
      check('P: a stranger\'s wrong passwords for OTHER usernames never lock the door (eight tries, eight plain refusals)', seen.every((s) => s === 302), seen.join(','));
      const owner = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' }, headers: ownerAt });
      check('P: …and the owner then signs in with the right password', owner.status === 302 && cookieOf(owner).length > 20 && !/err=/.test(owner.headers.location || ''), owner.status + ' ' + owner.headers.location);
    });

    await rebootP();
    await group('P: the admin sign-in, shared address — the owner\'s own username', async () => {
      // the account's own lock is what it was: five free tries, the sixth
      // failure locks — and a padded or re-cased name is the same account
      const grind = [];
      for (const name of ['owner', 'Owner', ' owner', 'OWNER ', 'owner\t', 'oWnEr']) {
        const r = await req('POST', '/admin/login', { form: { username: name, password: 'guess-guess-2' }, headers: stranger });
        grind.push(r.status);
      }
      const locked = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' }, headers: ownerAt });
      const wait1 = Number(locked.headers['retry-after']);
      check('P: six wrong passwords for the owner\'s OWN username still lock that username (429, Retry-After 30, the same sentence)',
        grind.every((s) => s === 302) && locked.status === 429 && wait1 > 0 && wait1 <= 30 && LOCK_SENTENCE.test(locked.text) && !locked.headers['set-cookie'], grind.join(',') + ' → ' + locked.status + ' retry-after ' + wait1);
      const editor = await req('POST', '/admin/login', { form: { username: 'dana', password: 'dana-pass-1' }, headers: ownerAt });
      check('P: …while another account signs in: the lock is the account\'s, not the site\'s', editor.status === 302 && cookieOf(editor).length > 20, editor.status);

      // the ladder: the next failure after the lock doubles it
      await advance(server);
      const afterLock = await req('POST', '/admin/login', { form: { username: 'owner', password: 'guess-guess-3' }, headers: stranger });
      const second = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' }, headers: ownerAt });
      const wait2 = Number(second.headers['retry-after']);
      check('P: the escalation ladder is kept: one more failure after the lock → 60 seconds', afterLock.status === 302 && second.status === 429 && wait2 > 30 && wait2 <= 60, afterLock.status + ' → ' + second.status + ' retry-after ' + wait2);
      await advance(server);
      await advance(server);
      const back = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' }, headers: ownerAt });
      check('P: …and when it ends the right password is let in', back.status === 302 && cookieOf(back).length > 20 && !/err=/.test(back.headers.location || ''), back.status + ' ' + back.headers.location);
    });

    await rebootP();
    await group('P: the base-URL line says what the sitemap does', async () => {
      // boot A saved the address; take it away again, as on a site where the
      // button was never clicked (the server reads the file afresh)
      const c = config.loadConfig();
      const savedBase = c.baseUrl;
      c.baseUrl = '';
      config.saveConfig(c);
      try {
        const viaProxy = Object.assign({ Host: 'shop.example', 'X-Forwarded-Proto': 'https' }, ownerAt);
        const signIn = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' }, headers: ownerAt });
        const dash = await req('GET', '/admin/dashboard', { cookie: cookieOf(signIn), headers: viaProxy });
        const sm = await req('GET', '/sitemap.xml', { accept: '*/*', headers: viaProxy });
        check('P: an https site behind the undeclared proxy: the sitemap prints http:// (finding 7 — nothing in code changes that)', /<loc>http:\/\/shop\.example\//.test(sm.text), sm.text.slice(0, 200));
        check('P: …and the line that offers the address button now says so, in the same notice',
          dash.status === 200 && /כתובת האתר עוד לא הוגדרה: בלי זה אין קישור קנוני, ותמונות שיתוף לא יוצגו\. עד שהכתובת נשמרת, גם מפת האתר \(<span dir="ltr">sitemap\.xml<\/span>\) מדפיסה כתובות <span dir="ltr">http:\/\/<\/span>\./.test(dash.text) &&
          /action="\/admin\/seo\/base-url-here"/.test(dash.text) && dash.text.split('כתובת האתר עוד לא הוגדרה').length === 2, dash.status + ' ' + (dash.text.match(/כתובת האתר עוד לא הוגדרה[^<]*/) || [''])[0]);
      } finally {
        const back = config.loadConfig();
        back.baseUrl = savedBase;
        config.saveConfig(back);
      }
    });

    await rebootP(TIGHT);
    await group('P: the customer portal, shared address — other names, and the caps', async () => {
      const seen = [];
      for (const name of ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace']) {
        const r = await req('POST', '/account/login', { form: { username: name, password: 'guess-guess-1' }, headers: stranger });
        seen.push(r.status);
      }
      check('P: a visitor\'s wrong portal passwords for other names lock nobody, and the per-minute cap (3 here) is not the site\'s', seen.every((s) => s === 302), seen.join(','));
      const customer = await req('POST', '/account/login', { form: { username: 'shopper', password: 'password99' }, headers: ownerAt });
      check('P: …a customer with the right password signs in from another address', customer.status === 302 && customer.headers.location === '/account' && /tapuz_portal=/.test(String(customer.headers['set-cookie'] || '')), customer.status + ' ' + customer.headers.location);

      const regs = [];
      for (const n of [1, 2, 3]) {
        const r = await req('POST', '/account/register', { form: { username: 'newcomer' + n, password: 'password-' + n + n, name: 'Newcomer ' + n, email: 'newcomer' + n + '@example.com' }, headers: stranger });
        regs.push(r.status + ' ' + r.headers.location);
      }
      check('P: registration is not capped on the shared address either (three in a row, cap 1)', regs.every((s) => s === '302 /account'), regs.join(' | '));
    });

    await rebootP();
    await group('P: the customer portal, shared address — a customer\'s own name', async () => {
      const joined = await req('POST', '/account/register', { form: { username: 'neighbour', password: 'password-nb', name: 'Neighbour', email: 'neighbour@example.com' }, headers: ownerAt });
      if (joined.status !== 302) throw new Error('the second customer could not register: ' + joined.status);
      // the account's own lock holds, whatever is typed around the name
      const grind = [];
      for (const name of ['shopper', 'Shopper', ' shopper ', 'shop per', 'SHOPPER!', 'shopper']) {
        const r = await req('POST', '/account/login', { form: { username: name, password: 'guess-guess-2' }, headers: stranger });
        grind.push(r.status);
      }
      const locked = await req('POST', '/account/login', { form: { username: 'shopper', password: 'password99' }, headers: ownerAt });
      const wait = Number(locked.headers['retry-after']);
      check('P: six wrong passwords for one customer\'s name lock that account (429, Retry-After 30, "too many failed tries")',
        grind.every((s) => s === 302) && locked.status === 429 && wait > 0 && wait <= 30 && /יותר מדי ניסיונות כושלים/.test(locked.text) && !locked.headers['set-cookie'], grind.join(',') + ' → ' + locked.status + ' retry-after ' + wait + ' ' + locked.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(-90));
      const neighbour = await req('POST', '/account/login', { form: { username: 'neighbour', password: 'password-nb' }, headers: ownerAt });
      check('P: …and another customer signs in meanwhile', neighbour.status === 302 && neighbour.headers.location === '/account', neighbour.status + ' ' + neighbour.headers.location);
    });

    await rebootP(TIGHT);
    await group('P: no forwarding header — the address is the visitor\'s own, and nothing changed', async () => {
      const logins = [];
      for (let i = 0; i < 4; i++) {
        const r = await req('POST', '/account/login', { form: { username: 'shopper', password: 'password99' } });
        logins.push(r.status);
      }
      check('P: a direct visitor still meets the portal\'s per-minute cap (3 pass, the 4th is a 429)', logins.slice(0, 3).every((s) => s === 302) && logins[3] === 429, logins.join(','));
      const reg1 = await req('POST', '/account/register', { form: { username: 'direct1', password: 'password-d1', name: 'Direct 1', email: 'direct1@example.com' } });
      const reg2 = await req('POST', '/account/register', { form: { username: 'direct2', password: 'password-d2', name: 'Direct 2', email: 'direct2@example.com' } });
      check('P: …and the registration cap (1 passes, the 2nd is a 429)', reg1.status === 302 && reg2.status === 429 && Number(reg2.headers['retry-after']) > 0, reg1.status + ',' + reg2.status);

      const spray = [];
      for (const name of ['admin', 'root', 'administrator', 'test', 'manager', 'webmaster']) {
        const r = await req('POST', '/admin/login', { form: { username: name, password: 'guess-guess-4' } });
        spray.push(r.status);
      }
      const owner = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
      const wait = Number(owner.headers['retry-after']);
      check('P: a direct visitor\'s six wrong passwords, for any usernames, still lock HIS address (the address-only lock is intact)',
        spray.every((s) => s === 302) && owner.status === 429 && wait > 0 && wait <= 30 && LOCK_SENTENCE.test(owner.text), spray.join(',') + ' → ' + owner.status + ' retry-after ' + wait);
      const forwarded = await req('POST', '/admin/login', { form: { username: 'dana', password: 'dana-pass-1' }, headers: ownerAt });
      check('P: …and forwarded visitors are not counted in it', forwarded.status === 302 && cookieOf(forwarded).length > 20, forwarded.status);
    });
  } catch (e) {
    check('boot P ran to the end', false, (e && (e.stack || e.message)) || e);
  } finally {
    await kill(server);
  }

  // =======================================================================
  // BOOT S — an empty root behind the same undeclared proxy: the setup-code
  // lock has no account name to key on, so there it is one lock for all —
  // and it must not be one a stranger can keep shut for good
  // =======================================================================
  server = null;
  try {
    server = boot(ROOT_S, {}, ['--require', preloadClock]);
    await waitUp();
    await group('S: the setup-code lock, shared address', async () => {
      await logHas(server, /קוד הקמה: [A-Z0-9]{5}-[A-Z0-9]{5}/);
      const m = server.log.text.match(/קוד הקמה: ([A-Z0-9]{5}-[A-Z0-9]{5})/);
      const code = m ? m[1] : '';
      const who = { username: 'owner', password: 'owner-pass-1', confirm: 'owner-pass-1' };
      const stranger = { 'X-Forwarded-For': '203.0.113.66' };
      const ownerAt = { 'X-Forwarded-For': '198.51.100.7' };
      const guess = async (n) => (await req('POST', '/admin/create-account', { form: Object.assign({ setupCode: 'GUESS-0000' + n }, who), headers: stranger }));
      const AUTH_S = path.join(ROOT_S, 'config', 'auth.json');

      const first = [];
      for (let i = 0; i < 6; i++) first.push((await guess(i)).status);
      const locked = await guess(6);
      const wait1 = Number(locked.headers['retry-after']);
      check('S: guessing is still locked out: five free tries, the sixth wrong code closes the door (429, Retry-After 30)',
        first.every((s) => s === 302) && locked.status === 429 && wait1 > 0 && wait1 <= 30 && /נחסמת זמנית/.test(locked.text), first.join(',') + ' → ' + locked.status + ' retry-after ' + wait1);
      const early = await req('POST', '/admin/create-account', { form: Object.assign({ setupCode: code }, who), headers: ownerAt });
      check('S: …for everybody while it lasts (nothing tells the owner from the stranger there)', early.status === 429 && !fs.existsSync(AUTH_S), early.status);

      await advance(server);
      const fresh = [];
      for (let i = 0; i < 5; i++) fresh.push((await guess(10 + i)).status);
      const sixth = await guess(15);
      const again = await guess(16);
      const wait2 = Number(again.headers['retry-after']);
      check('S: when the lock ends there are five FRESH tries — one more wrong code does not shut it again',
        fresh.every((s) => s === 302) && sixth.status === 302, fresh.join(',') + ' then ' + sixth.status);
      check('S: …and the second lock is as long as the first: 30 seconds, never the ladder\'s 60', again.status === 429 && wait2 > 0 && wait2 <= 30, again.status + ' retry-after ' + wait2);

      await advance(server);
      const right = await req('POST', '/admin/create-account', { form: Object.assign({ setupCode: code }, who), headers: ownerAt });
      check('S: half a minute later the owner\'s right code opens the first account', right.status === 302 && cookieOf(right).length > 20 && !/err=/.test(right.headers.location || '') && fs.existsSync(AUTH_S), right.status + ' ' + right.headers.location);
    });
  } catch (e) {
    check('boot S ran to the end', false, (e && (e.stack || e.message)) || e);
  } finally {
    await kill(server);
  }

  // =======================================================================
  // BOOT H — another empty root, and a server with NO terminal: a hosted
  // process. The request is the one a same-machine forwarder makes when it
  // adds no forwarding header — loopback socket, HTTP/1.1, Host
  // 127.0.0.1:<port>, Origin to match. It used to be taken for the owner's
  // own browser and let past the setup code.
  // =======================================================================
  server = null;
  try {
    server = boot(ROOT_H, {});
    await waitUp();
    await group('H: a hosted process asks everyone for the setup code', async () => {
      const AUTH_H = path.join(ROOT_H, 'config', 'auth.json');
      const form = await req('GET', '/admin/create-account');
      check('H: no terminal: a request from this machine sees the "קוד הקמה" field', form.status === 200 && /name="setupCode"/.test(form.text) && /יומן השרת/.test(form.text));
      const post = await req('POST', '/admin/create-account', { form: { username: 'intruder', password: INTRUDER_PASS, confirm: INTRUDER_PASS } });
      check('H: …and cannot create the first account without the code (it used to: 302 to the setup wizard, an admin in auth.json)',
        post.status === 302 && /create-account\?err=/.test(post.headers.location || '') && !post.headers['set-cookie'] && !fs.existsSync(AUTH_H), post.status + ' ' + post.headers.location);
      await logHas(server, /קוד הקמה: [A-Z0-9]{5}-[A-Z0-9]{5}/);
      const code = (server.log.text.match(/קוד הקמה: ([A-Z0-9]{5}-[A-Z0-9]{5})/) || [])[1] || '';
      const withCode = await req('POST', '/admin/create-account', { form: { username: 'owner', password: 'owner-pass-1', confirm: 'owner-pass-1', setupCode: code } });
      check('H: …with the code from the log, it does', withCode.status === 302 && cookieOf(withCode).length > 20 && !/err=/.test(withCode.headers.location || '') && fs.existsSync(AUTH_H), withCode.status + ' ' + withCode.headers.location);
    });
  } catch (e) {
    check('boot H ran to the end', false, (e && (e.stack || e.message)) || e);
  } finally {
    await kill(server);
  }

  // =======================================================================
  // BOOT B — an empty root, a remote browser, and a fake cspSources
  // =======================================================================
  const control = path.join(HOLD, 'csp-control.json');
  const preload = path.join(HOLD, 'preload-paypal.js');
  fs.writeFileSync(preload, [
    "'use strict';",
    '// test-only: give the store module the cspSources() the platform reads',
    "const fs = require('fs');",
    'const paypal = require(' + JSON.stringify(path.join(REPO, 'src', 'store', 'paypal.js')) + ');',
    'paypal.cspSources = function () { return JSON.parse(fs.readFileSync(' + JSON.stringify(control) + ", 'utf8')); };",
    ''
  ].join('\n'));
  server = null;
  try {
    // preloadTty: this boot stands for a server started in a terminal — the
    // only kind that lets a browser on its own machine past the setup code
    server = boot(ROOT_B, { TAPUZ_TRUST_PROXY: '1' }, ['--require', preload, '--require', preloadClock, '--require', preloadTty]);
    await waitUp();

    await group('B: the PayPal sources in the policy', async () => {
      const cspOf = async () => (await req('GET', '/')).headers['content-security-policy'];
      check('a cspSources() that throws widens nothing (the policy never fails open)', (await cspOf()) === CSP_PLAIN);
      fs.writeFileSync(control, JSON.stringify({ script: [], frame: [], connect: [], img: [] }));
      check('empty arrays (PayPal not ready): the original string, character for character', (await cspOf()) === CSP_PLAIN, await cspOf());
      fs.writeFileSync(control, JSON.stringify({
        script: ['https://www.sandbox.paypal.com', 'https://www.paypal.com'],
        frame: ['https://www.sandbox.paypal.com'],
        connect: ['https://api-m.sandbox.paypal.com'],
        img: ['https://www.paypalobjects.com']
      }));
      const wide = await cspOf();
      check('script-src gains exactly the store\'s origins', /script-src 'self' 'unsafe-inline' https:\/\/www\.googletagmanager\.com https:\/\/www\.sandbox\.paypal\.com https:\/\/www\.paypal\.com;/.test(wide), wide);
      check('frame-src gains them', /frame-src 'self' https:\/\/www\.youtube\.com https:\/\/www\.google\.com https:\/\/www\.sandbox\.paypal\.com;/.test(wide));
      check('connect-src gains them', /connect-src 'self' https:\/\/api-m\.sandbox\.paypal\.com;/.test(wide));
      check('img-src gains them', /img-src 'self' data: https: https:\/\/www\.paypalobjects\.com;/.test(wide));
      check('nothing else moved', wide.replace(' https://www.sandbox.paypal.com https://www.paypal.com', '').replace(' https://www.sandbox.paypal.com', '').replace(' https://api-m.sandbox.paypal.com', '').replace(' https://www.paypalobjects.com', '') === CSP_PLAIN);
      fs.writeFileSync(control, JSON.stringify({ script: ["https://ok.example; object-src *", 'https://*.paypal.com', 'http://plain.example', 42], frame: 'https://not-an-array.example', connect: [], img: [] }));
      const guarded = await cspOf();
      check('a source that is not a bare https origin is dropped (it cannot write its own directive)', !/object-src \*/.test(guarded) && !/plain\.example/.test(guarded) && !/not-an-array/.test(guarded) && /https:\/\/\*\.paypal\.com/.test(guarded), guarded);
      fs.unlinkSync(control);
    });

    await group('B: the first account needs the setup code', async () => {
      await logHas(server, /קוד הקמה: [A-Z0-9]{5}-[A-Z0-9]{5}/);
      const m = server.log.text.match(/קוד הקמה: ([A-Z0-9]{5}-[A-Z0-9]{5})/);
      const code = m ? m[1] : '';
      check('the boot log prints "no admin yet", the data root, and a setup code', /אין עדיין חשבון מנהל/.test(server.log.text) && server.log.text.indexOf(ROOT_B) >= 0 && !!code, server.log.text.slice(0, 600));
      const formRemote = await req('GET', '/admin/create-account', { headers: REMOTE });
      check('a remote browser sees the "קוד הקמה" field and where to find the code', formRemote.status === 200 && /name="setupCode"/.test(formRemote.text) && /קוד הקמה/.test(formRemote.text) && /יומן השרת/.test(formRemote.text));
      const formLocal = await req('GET', '/admin/create-account');
      check('a browser on the server\'s own machine is not asked for one (the server was started in a terminal)', formLocal.status === 200 && !/name="setupCode"/.test(formLocal.text));
      const pct = await req('GET', '/admin/create-account?err=%25', { headers: REMOTE });
      check('?err=%25 renders the form (it used to be a 500)', pct.status === 200 && /name="username"/.test(pct.text), pct.status);

      const who = { username: 'owner', password: 'owner-pass-1', confirm: 'owner-pass-1' };
      const none = await req('POST', '/admin/create-account', { form: who, headers: REMOTE });
      check('remote, no code → refused', none.status === 302 && /create-account\?err=/.test(none.headers.location || '') && !none.headers['set-cookie'], none.status + ' ' + none.headers.location);
      const wrong = await req('POST', '/admin/create-account', { form: Object.assign({ setupCode: 'AAAAA-AAAAA' }, who), headers: REMOTE });
      check('remote, wrong code → refused', wrong.status === 302 && /create-account\?err=/.test(wrong.headers.location || '') && !wrong.headers['set-cookie']);
      const still = await req('GET', '/admin/login');
      check('…and there is still no account', still.status === 302 && /create-account/.test(still.headers.location || '') && !fs.existsSync(path.join(ROOT_B, 'config', 'auth.json')));
      // on the server's own machine the POST passes the code gate too: the
      // refusal it meets is the next one (the passwords), and nothing is created
      const localPost = await req('POST', '/admin/create-account', { form: { username: 'owner', password: 'owner-pass-1', confirm: 'something-else' } });
      check('local, no code: not stopped at the code (the answer is about the passwords)', localPost.status === 302 && /create-account\?err=/.test(localPost.headers.location || '') &&
        !/%D7%A7%D7%95%D7%93/.test(localPost.headers.location || '') && !fs.existsSync(path.join(ROOT_B, 'config', 'auth.json')), localPost.headers.location);
      // a proxy on the same machine that hides itself speaks HTTP/1.0
      const old = await rawHttp10('/admin/create-account');
      check('an HTTP/1.0 request from this machine is a hidden proxy: it is asked for the code', /^HTTP\/1\.[01] 200/.test(old) && /name="setupCode"/.test(old), old.slice(0, 80));
      // guesses meet the login's own lockout, per visitor
      const guesser = { 'X-Forwarded-For': '203.0.113.99' };
      const tries = [];
      for (let i = 0; i < 7; i++) {
        const g = await req('POST', '/admin/create-account', { form: Object.assign({ setupCode: 'GUESS-0000' + i }, who), headers: guesser });
        tries.push(g.status);
      }
      check('six wrong codes from one address lock it out (429, Retry-After)', tries.slice(0, 6).every((s) => s === 302) && tries[6] === 429, tries.join(','));
      // the proxy is declared in this boot, so the lock is that visitor's
      // own — and it is the ladder it was: one more wrong code after the
      // first lock doubles it
      await advance(server);
      const oneMore = await req('POST', '/admin/create-account', { form: Object.assign({ setupCode: 'GUESS-00007' }, who), headers: guesser });
      const doubled = await req('POST', '/admin/create-account', { form: Object.assign({ setupCode: 'GUESS-00008' }, who), headers: guesser });
      const waitB = Number(doubled.headers['retry-after']);
      check('…and with the proxy declared that lock still escalates (the next wrong code after it → 60 seconds)', oneMore.status === 302 && doubled.status === 429 && waitB > 30 && waitB <= 60, oneMore.status + ' → ' + doubled.status + ' retry-after ' + waitB);
      const right = await req('POST', '/admin/create-account', { form: Object.assign({ setupCode: code.toLowerCase().replace('-', '') }, who), headers: REMOTE });
      check('remote, the code from the log → the account is created and signed in', right.status === 302 && !!right.headers['set-cookie'] && !/err=/.test(right.headers.location || ''), right.status + ' ' + right.headers.location);
      const shut = await req('GET', '/admin/create-account', { headers: REMOTE });
      check('…and the screen closes behind it', shut.status === 302 && /\/admin\/login$/.test(shut.headers.location || ''));
    });
  } catch (e) {
    check('boot B ran to the end', false, (e && (e.stack || e.message)) || e);
  } finally {
    await kill(server);
  }

  // =======================================================================
  // BOOT C — TAPUZ_SETUP_TOKEN, no proxy trust, a damaged auth.json, SIGTERM
  // =======================================================================
  // the store queues a site rebuild at the very moment the signal lands (what
  // an order does): this listener is registered before the server's own, so
  // it runs first
  const preloadQueue = path.join(HOLD, 'preload-queue-refresh.js');
  fs.writeFileSync(preloadQueue, [
    "'use strict';",
    '// test-only: an order-style queued rebuild, exactly when SIGTERM arrives',
    "process.on('SIGTERM', () => { require(" + JSON.stringify(path.join(REPO, 'src', 'store', 'index.js')) + ').scheduleRefresh(); });',
    ''
  ].join('\n'));
  server = null;
  try {
    server = boot(ROOT_C, { TAPUZ_SETUP_TOKEN: 'smoke-setup-token' }, ['--require', preloadQueue]);
    await waitUp();
    const AUTH_C = path.join(ROOT_C, 'config', 'auth.json');

    await group('C: the token from the environment is asked of everyone', async () => {
      await logHas(server, /TAPUZ_SETUP_TOKEN/);
      check('the boot log names TAPUZ_SETUP_TOKEN and prints no code', /TAPUZ_SETUP_TOKEN/.test(server.log.text) && !/קוד הקמה: [A-Z0-9]{5}-[A-Z0-9]{5}/.test(server.log.text) && server.log.text.indexOf('smoke-setup-token') < 0);
      check('…and says the data root was just created', /נוצרה עכשיו/.test(server.log.text) && server.log.text.indexOf(ROOT_C) >= 0);
      const who = { username: 'owner', password: 'owner-pass-1', confirm: 'owner-pass-1' };
      const wrong = await req('POST', '/admin/create-account', { form: Object.assign({ setupCode: 'guess' }, who), headers: REMOTE });
      check('a forwarded request is not "local" even with proxy trust off: wrong token → refused', wrong.status === 302 && /err=/.test(wrong.headers.location || '') && !fs.existsSync(AUTH_C));
      await req('GET', '/', { headers: REMOTE });
      await logHas(server, /\[proxy\]/);
      await sleep(150);
      const warnings = server.log.text.split('[proxy]').length - 1;
      check('one warning, once: X-Forwarded-For arrived while TAPUZ_TRUST_PROXY is off', warnings === 1 && /TAPUZ_TRUST_PROXY/.test(server.log.text), warnings + ' warnings');
      const formLocal = await req('GET', '/admin/create-account');
      check('with a token set, even a browser on the server\'s own machine is asked for it ("local" is only a guess)', formLocal.status === 200 && /name="setupCode"/.test(formLocal.text) && /TAPUZ_SETUP_TOKEN/.test(formLocal.text) && !/smoke-setup-token/.test(formLocal.text));
      const localNone = await req('POST', '/admin/create-account', { form: who });
      check('…local, no token → refused, no account', localNone.status === 302 && /err=/.test(localNone.headers.location || '') && !localNone.headers['set-cookie'] && !fs.existsSync(AUTH_C), localNone.status + ' ' + localNone.headers.location);
      const local = await req('POST', '/admin/create-account', { form: Object.assign({ setupCode: 'smoke-setup-token' }, who) });
      check('…local, the token → the first account is created and signed in', local.status === 302 && !!local.headers['set-cookie'] && fs.existsSync(AUTH_C), local.status + ' ' + local.headers.location);
    });

    await group('C: a damaged auth.json, over HTTP', async () => {
      const good = fs.readFileSync(AUTH_C);
      const cut = good.subarray(0, Math.floor(good.length / 2));
      fs.writeFileSync(AUTH_C, cut);
      const create = await req('GET', '/admin/create-account', { headers: REMOTE });
      check('create-account stays SHUT (it used to reopen to the internet)', create.status === 302 && /\/admin\/login$/.test(create.headers.location || ''), create.status + ' ' + create.headers.location);
      const post = await req('POST', '/admin/create-account', { form: { username: 'intruder', password: INTRUDER_PASS, confirm: INTRUDER_PASS, setupCode: 'smoke-setup-token' } });
      check('…even with the right token and from this machine', post.status === 302 && /\/admin\/login$/.test(post.headers.location || '') && !post.headers['set-cookie']);
      const login = await req('GET', '/admin/login');
      check('the login screen explains, in Hebrew, that the accounts file is damaged and how to restore it', login.status === 200 && /קובץ החשבונות פגום/.test(login.text) && /config\/auth\.json/.test(login.text) && /גיבוי/.test(login.text));
      const tryIn = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
      check('nobody signs in meanwhile', tryIn.status === 302 && /login\?err=1/.test(tryIn.headers.location || ''));
      await req('GET', '/admin/dashboard', { cookie: 'tapuz_sess=aaaa.bbbb' });
      check('the file is exactly as it was found — no new secret was written over it', fs.readFileSync(AUTH_C).equals(cut));
      check('one copy of it is kept beside it', fs.readdirSync(path.join(ROOT_C, 'config')).filter((n) => n.indexOf('auth.json.corrupt-') === 0).length === 1);
      check('the server log says so', (await logHas(server, /NOT overwritten/)) && /\[auth\]/.test(server.log.text));
      fs.writeFileSync(AUTH_C, good);
      const back = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
      check('the file restored: the owner signs in again, with no restart', back.status === 302 && !!back.headers['set-cookie'] && !/err=/.test(back.headers.location || ''));
    });

    await group('C: SIGTERM', async () => {
      const wal = path.join(ROOT_C, 'db', 'tapuz.db-wal');
      const walBefore = fs.existsSync(wal) ? fs.statSync(wal).size : 0;
      check('the database has an open write-ahead log before the signal', walBefore > 0, walBefore + ' bytes');
      const stamp = path.join(ROOT_C, 'public', '.built-by');
      const stampBefore = fs.existsSync(stamp) ? fs.statSync(stamp).mtimeMs : 0;
      await sleep(30);
      const t0 = Date.now();
      server.child.kill('SIGTERM');
      const end = await Promise.race([server.exited, sleep(9000).then(() => null)]);
      const took = Date.now() - t0;
      check('SIGTERM → the process exits 0, by itself, well inside 8 seconds', !!end && end.code === 0 && end.signal === null && took < 8000, JSON.stringify(end) + ' after ' + took + 'ms');
      const walAfter = fs.existsSync(wal) ? fs.statSync(wal).size : 0;
      check('…with the write-ahead log folded back into the database file', walAfter === 0, walAfter + ' bytes');
      check('…and it said so', await logHas(server, /\[shutdown\] SIGTERM/, 500));
      const stampAfter = fs.existsSync(stamp) ? fs.statSync(stamp).mtimeMs : 0;
      check('a site rebuild the store had queued when the signal landed still ran (the export stamp is newer)', stampAfter > stampBefore && stampAfter >= t0 - 5, stampBefore + ' → ' + stampAfter + ' (signal at ' + t0 + ')');
      const gone = await req('GET', '/_tapuz/health', { soft: true, timeout: 1500 });
      check('…the port is released', gone.status === 0);
      if (end) server = null;
    });
  } catch (e) {
    check('boot C ran to the end', false, (e && (e.stack || e.message)) || e);
  } finally {
    await kill(server);
  }

  // =======================================================================
  // BOOT D — a promise nobody caught, well after the server is up
  // =======================================================================
  const preloadReject = path.join(HOLD, 'preload-reject.js');
  fs.writeFileSync(preloadReject, [
    "'use strict';",
    '// test-only: a rejection with no handler, long after boot',
    "setTimeout(() => { Promise.reject(new Error('smoke: nobody caught this')); }, 1500);",
    ''
  ].join('\n'));
  server = null;
  try {
    server = boot(ROOT_C, {}, ['--require', preloadReject]);
    await group('D: an unhandled rejection', async () => {
      await waitUp();
      const end = await Promise.race([server.exited, sleep(8000).then(() => null)]);
      check('the process ends non-zero, so the host starts a clean one', !!end && end.code === 1, JSON.stringify(end));
      check('…and the log says what it was, under [fatal]', await logHas(server, /\[fatal\] unhandled promise rejection: Error: smoke: nobody caught this/, 500), server.log.text.slice(-300));
      if (end) server = null;
    });
  } catch (e) {
    check('boot D ran to the end', false, (e && (e.stack || e.message)) || e);
  } finally {
    await kill(server);
  }

  console.log('');
  console.log(fail ? 'SMOKE PLATFORM: FAIL' : 'SMOKE PLATFORM: PASS');
  try { fs.rmSync(HOLD, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  console.log('SMOKE PLATFORM: FAIL');
  process.exit(1);
});
