'use strict';

/**
 * The site's small JSON stores (config/auth.json, config/site.json, menus,
 * theme overrides) — written so a crash can never leave half a file, and
 * read so "the file is not there" and "the file is there and broken" are two
 * different answers (v2.69).
 *
 * Why it matters: every one of those stores used to be a bare writeFileSync
 * and a read that turned a parse error into the defaults. A truncated
 * auth.json therefore read as "no accounts", the next request wrote a new
 * signing secret over it, and "create the first admin" reopened to the
 * internet. A missing file is a first run; a damaged file is an accident
 * somebody has to look at — the caller decides what each one means, and this
 * module only makes sure it can tell them apart.
 */

const fs = require('fs');
const path = require('path');

// what a filesystem with no fsync answers (some network and FUSE mounts);
// the bytes were written all the same
const NO_FSYNC = new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS']);
// "no temp file beside it, or no rename onto it" — see writeAtomic's catch
const NO_SIBLING = new Set(['EACCES', 'EPERM', 'EROFS', 'EXDEV', 'EBUSY']);

function flush(fd) {
  try {
    fs.fsyncSync(fd);
  } catch (e) {
    if (!e || !NO_FSYNC.has(e.code)) throw e;
  }
}

/**
 * The file a path really names when the name itself is a symlink (or a chain
 * of them). Any other path comes back exactly as it was given — a linked
 * directory above it is none of this function's business.
 */
function throughLinks(file) {
  try {
    if (!fs.lstatSync(file).isSymbolicLink()) return file;
  } catch (e) {
    return file; // no such name yet: it is created as given
  }
  try { return fs.realpathSync(file); } catch (e) { /* a link to a file not made yet */ }
  try { return path.resolve(path.dirname(file), fs.readlinkSync(file)); } catch (e) { return file; }
}

/** The write this module replaced — kept for the one case writeAtomic names. */
function writeInPlace(file, text, encoding, mode, durable) {
  const fd = fs.openSync(file, 'w', mode === undefined ? 0o666 : mode);
  try {
    // a mode the caller asked for by name (0600 for the accounts file) is a
    // promise about who may read it, kept here as the rename path keeps it;
    // with no mode asked, a file written in place has the one it had
    if (mode !== undefined) { try { fs.fchmodSync(fd, mode); } catch (e) { /* not ours to change */ } }
    fs.writeFileSync(fd, text, encoding);
    if (durable) flush(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Write the whole file or none of it: the bytes go to a sibling temp file,
 * are flushed to the disk, and only then take the real name (a rename inside
 * one directory is atomic). A failure at any step removes the temp file and
 * leaves the old content exactly as it was.
 *
 * Three things it must not break while doing so (the v2.69 review found each
 * one): a symlinked file is written THROUGH its link; an existing file keeps
 * its permissions whatever the umask; and where no sibling file can be made
 * or renamed at all, the file is written in place as it always was — the
 * one case that is not whole-or-nothing, taken only when the alternative is
 * that nothing can be saved.
 *
 * @param {string} file absolute path
 * @param {string|Buffer} text
 * @param {{ mode?: number, durable?: boolean }} [opts] `mode` for the new
 *   file (absent: an existing file keeps the permissions it had). `durable:
 *   false` skips the flush to disk — still whole-or-nothing against a killed
 *   process, which is all a file that can be regenerated needs (the static
 *   export writes hundreds of them per build).
 */
function writeAtomic(file, text, opts) {
  const o = opts || {};
  const durable = o.durable !== false;
  // A config file that is a symlink into shared storage (a release directory
  // linking to the one copy that outlives deploys): the rename below would
  // put a plain file where the link was and leave the shared copy stale, so
  // the next deploy that restored the link dropped every save since. Write
  // where the link points; the link itself is never touched.
  file = throughLinks(file);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let mode = o.mode;
  let keepMode = false;
  if (mode === undefined) {
    try { mode = fs.statSync(file).mode & 0o777; keepMode = true; } catch (e) { mode = 0o666; }
  }
  const encoding = typeof text === 'string' ? 'utf8' : undefined;
  const tmp = file + '.' + process.pid + '.tmp';
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'w', mode);
    // open() takes the mode through the umask: 0666 came out 0644, and on a
    // host with umask 077 an exported page went from 0644 to 0600 at its
    // first rebuild. The permissions the file HAD are set as they were.
    if (keepMode) { try { fs.fchmodSync(fd, mode); } catch (e) { /* a filesystem without permission bits */ } }
    fs.writeFileSync(fd, text, encoding);
    if (durable) flush(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
  } catch (e) {
    if (fd !== null) { try { fs.closeSync(fd); } catch (e2) { /* already closed */ } }
    try { fs.unlinkSync(tmp); } catch (e2) { /* never created */ }
    // The directory would not take a sibling file, or would not let it take
    // the name — a directory this process may not write to, or a file
    // mounted on its own (the rename then crosses a mount). The file itself
    // may still be writable, and the bare write this module replaced worked
    // there; refusing instead meant no settings or account save at all. So
    // there, and only there, the old way: in place, not whole-or-nothing.
    if (!e || !NO_SIBLING.has(e.code)) throw e;
    writeInPlace(file, text, encoding, o.mode, durable);
    return;
  }
  if (!durable) return;
  // The rename itself lives in the directory entry; flushing that too is what
  // makes the new name survive a power cut. Not every platform lets a
  // directory be opened (Windows), and the write above already succeeded.
  try {
    const dfd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
  } catch (e) { /* best effort */ }
}

/**
 * Read a JSON file and say which of three things happened.
 *   missing — no such file (a first run)
 *   ok      — parsed; `data` holds the value
 *   corrupt — the file exists and cannot be read or parsed; `error` says why
 * A leading byte-order mark (a file saved from Notepad) is not damage.
 *
 * @param {string} file absolute path
 * @returns {{ state: 'missing'|'ok'|'corrupt', data: any, error: string }}
 */
function readJson(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { state: 'missing', data: null, error: '' };
    return { state: 'corrupt', data: null, error: String((e && e.message) || e) };
  }
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  try {
    return { state: 'ok', data: JSON.parse(raw), error: '' };
  } catch (e) {
    return { state: 'corrupt', data: null, error: String((e && e.message) || e) };
  }
}

/**
 * Keep one copy of a damaged file beside it, named <file>.corrupt-<stamp>,
 * so whoever repairs it has the exact bytes that were found. Called on every
 * read of a damaged store, so it copies only when no existing copy already
 * holds the same bytes — a server that restarts ten times leaves one copy.
 *
 * @param {string} file absolute path
 * @returns {string} the copy's path ('' when nothing could be copied)
 */
function keepCorruptCopy(file) {
  try {
    const bytes = fs.readFileSync(file);
    const dir = path.dirname(file);
    const prefix = path.basename(file) + '.corrupt-';
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(prefix)) continue;
      try {
        if (fs.readFileSync(path.join(dir, name)).equals(bytes)) return path.join(dir, name);
      } catch (e) { /* an unreadable old copy is not a match */ }
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const copy = path.join(dir, prefix + stamp);
    fs.writeFileSync(copy, bytes, { mode: 0o600 });
    return copy;
  } catch (e) {
    return '';
  }
}

module.exports = { writeAtomic, readJson, keepCorruptCopy };
