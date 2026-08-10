'use strict';

/**
 * Minimal ZIP writer, STORE method only (no compression, no dependencies).
 * Exists so the admin can hand the browser-extension folders to the owner as
 * one click — the dirs are tiny (tens of KB), so store-only costs nothing.
 * Format: local file headers + central directory + EOCD, UTF-8 names.
 */

const fs = require('fs');
const path = require('path');

// CRC-32 (IEEE), table-driven — the only checksum ZIP accepts.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date/time pair from a Date (ZIP's native timestamp format). */
function dosDateTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

/**
 * Zip a directory (one level of recursion is plenty for extension folders).
 * @param {string} dir absolute directory to pack
 * @param {string} [prefix] folder name inside the archive. For BROWSER
 *   EXTENSIONS this must be '' — Chrome's drag-install and Firefox's
 *   about:debugging both require manifest.json at the ZIP ROOT; a wrapping
 *   folder made the archive "corrupt" to them (found live by Ben, v2.18.1).
 * @param {Object<string,string|Buffer>} [overrides] rel-path → replacement
 *   content, so one folder can ship per-browser manifest variants.
 * @returns {Buffer} the complete .zip
 */
function zipDirectory(dir, prefix = '', overrides = {}) {
  const files = [];
  (function walk(cur, rel) {
    for (const name of fs.readdirSync(cur)) {
      const full = path.join(cur, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full, rel + name + '/');
      else files.push({ full, rel: rel + name });
    }
  })(dir, prefix ? prefix.replace(/\/?$/, '/') : '');

  const now = dosDateTime(new Date());
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    const data = overrides[f.rel] !== undefined
      ? Buffer.from(overrides[f.rel])
      : fs.readFileSync(f.full);
    const name = Buffer.from(f.rel, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);  // local header signature
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // flags: UTF-8 names
    local.writeUInt16LE(0, 8);           // method: STORE
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);          // extra length
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);        // version made by
    central.writeUInt16LE(20, 6);        // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(now.time, 12);
    central.writeUInt16LE(now.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    // extra/comment/disk/attrs all zero
    central.writeUInt32LE(offset, 42);   // local header offset
    centralParts.push(central, name);

    offset += 30 + name.length + data.length;
  }

  const centralSize = centralParts.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

module.exports = { zipDirectory, crc32 };
