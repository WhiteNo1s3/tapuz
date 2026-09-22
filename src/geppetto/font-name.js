'use strict';

/**
 * The family name out of a font file's bytes — WOFF2 / WOFF / TTF / OTF.
 *
 * Why this exists: a Canva static export names its fonts by an opaque id
 * (`font-family: YAEnXEEs5-Q-0`) and the real family lives only inside the
 * font file the page loads. Geppetto's theme wants "Montserrat", not a hash,
 * so the fetch layer downloads one face per id and asks this module. Pure
 * bytes in, a string out; never throws — a broken or unknown file is null.
 *
 * Every container ends in the same sfnt `name` table:
 *   TTF/OTF  offset table → table directory → name
 *   WOFF     directory with per-table zlib compression
 *   WOFF2    directory + ONE brotli stream holding every table back to back
 */

const zlib = require('zlib');

const MAX_INPUT = 3 * 1024 * 1024; // a web font past 3 MB is not a font we name
const NAME_TAG = 'name';

/** The WOFF2 known-tag table (index → tag), in spec order. */
const WOFF2_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'
];

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  return null;
}

/** 'woff2' | 'woff' | 'ttf' | 'otf' | null from the first four bytes. */
function sniffFontFormat(input) {
  const buf = toBuffer(input);
  if (!buf || buf.length < 4) return null;
  const tag = buf.toString('latin1', 0, 4);
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'OTTO') return 'otf';
  if (tag === 'true' || tag === 'typ1') return 'ttf';
  if (buf.readUInt32BE(0) === 0x00010000) return 'ttf';
  return null;
}

// ── locating the name table ──────────────────────────────────────────────

/** sfnt (TTF/OTF): the `name` table bytes, or null. */
function nameTableSfnt(buf) {
  if (buf.length < 12) return null;
  const numTables = buf.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const at = 12 + i * 16;
    if (at + 16 > buf.length) return null;
    if (buf.toString('latin1', at, at + 4) !== NAME_TAG) continue;
    const offset = buf.readUInt32BE(at + 8);
    const length = buf.readUInt32BE(at + 12);
    if (offset + length > buf.length) return null;
    return buf.subarray(offset, offset + length);
  }
  return null;
}

/** WOFF: the `name` table, inflated when the directory says it is compressed. */
function nameTableWoff(buf) {
  if (buf.length < 44) return null;
  const numTables = buf.readUInt16BE(12);
  for (let i = 0; i < numTables; i++) {
    const at = 44 + i * 20;
    if (at + 20 > buf.length) return null;
    if (buf.toString('latin1', at, at + 4) !== NAME_TAG) continue;
    const offset = buf.readUInt32BE(at + 4);
    const compLength = buf.readUInt32BE(at + 8);
    const origLength = buf.readUInt32BE(at + 12);
    if (offset + compLength > buf.length) return null;
    const raw = buf.subarray(offset, offset + compLength);
    return compLength < origLength ? zlib.inflateSync(raw) : raw;
  }
  return null;
}

/** UIntBase128 (WOFF2's variable-length integer) → { value, next } or null. */
function readBase128(buf, at) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (at + i >= buf.length) return null;
    const byte = buf[at + i];
    if (i === 0 && byte === 0x80) return null; // leading zeros are forbidden
    if (value & 0xfe000000) return null; // would overflow 32 bits
    value = (value * 128) + (byte & 0x7f);
    if (!(byte & 0x80)) return { value, next: at + i + 1 };
  }
  return null;
}

/**
 * WOFF2: walk the directory to learn where `name` sits inside the single
 * brotli stream, decompress, and slice it out. A transformed table (glyf and
 * loca with transform version 0, others with a version ≠ 0) occupies its
 * transformLength in the stream; every other table its origLength.
 */
function nameTableWoff2(buf) {
  if (buf.length < 48) return null;
  const numTables = buf.readUInt16BE(12);
  const totalCompressedSize = buf.readUInt32BE(20);
  let at = 48;
  let streamOffset = 0;
  let nameAt = -1;
  let nameLen = 0;
  for (let i = 0; i < numTables; i++) {
    if (at >= buf.length) return null;
    const flags = buf[at++];
    const tagIndex = flags & 0x3f;
    const transform = (flags >> 6) & 0x03;
    let tag;
    if (tagIndex === 63) {
      if (at + 4 > buf.length) return null;
      tag = buf.toString('latin1', at, at + 4);
      at += 4;
    } else {
      tag = WOFF2_TAGS[tagIndex];
    }
    const orig = readBase128(buf, at);
    if (!orig) return null;
    at = orig.next;
    let stored = orig.value;
    const glyfOrLoca = tag === 'glyf' || tag === 'loca';
    const transformed = glyfOrLoca ? transform === 0 : transform !== 0;
    if (transformed) {
      const tl = readBase128(buf, at);
      if (!tl) return null;
      at = tl.next;
      stored = tl.value;
    }
    if (tag === NAME_TAG && nameAt < 0) {
      nameAt = streamOffset;
      nameLen = orig.value;
    }
    streamOffset += stored;
  }
  if (nameAt < 0) return null;
  // A font collection carries an extra directory before the stream; naming
  // one is out of scope — the fetch layer only meets single faces.
  if (buf.toString('latin1', 4, 8) === 'ttcf') return null;
  const end = Math.min(buf.length, at + totalCompressedSize);
  const data = zlib.brotliDecompressSync(buf.subarray(at, end));
  if (nameAt + nameLen > data.length) return null;
  return data.subarray(nameAt, nameAt + nameLen);
}

// ── reading the name table ───────────────────────────────────────────────

function decodeNameString(bytes, platformID) {
  // Windows (3) and Unicode (0) strings are UTF-16BE; Macintosh (1) is Mac
  // Roman, which agrees with latin1 for every family name we meet.
  if (platformID === 3 || platformID === 0) {
    let out = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode(bytes.readUInt16BE(i));
    return out;
  }
  return bytes.toString('latin1');
}

/**
 * The family: nameID 16 (typographic family — "Montserrat", not
 * "Montserrat SemiBold") before nameID 1; a Windows record before a Mac one.
 */
function familyFromNameTable(table) {
  if (!table || table.length < 6) return null;
  const count = table.readUInt16BE(2);
  const stringOffset = table.readUInt16BE(4);
  const candidates = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    if (at + 12 > table.length) break;
    const platformID = table.readUInt16BE(at);
    const languageID = table.readUInt16BE(at + 4);
    const nameID = table.readUInt16BE(at + 6);
    const length = table.readUInt16BE(at + 8);
    const offset = table.readUInt16BE(at + 10);
    if (nameID !== 16 && nameID !== 1) continue;
    const start = stringOffset + offset;
    if (start + length > table.length) continue;
    const text = decodeNameString(table.subarray(start, start + length), platformID).replace(/\0/g, '').trim();
    if (!text) continue;
    // lower score = better: typographic family, then Windows, then US English
    const score = (nameID === 16 ? 0 : 10) + (platformID === 3 ? 0 : platformID === 0 ? 1 : 2) + (languageID === 0x409 || languageID === 0 ? 0 : 0.5);
    candidates.push({ score, text });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0].text;
}

/** 'Montserrat' | null — never throws. */
function familyFromFontBytes(input) {
  try {
    const buf = toBuffer(input);
    if (!buf || buf.length < 12 || buf.length > MAX_INPUT) return null;
    const format = sniffFontFormat(buf);
    let table = null;
    if (format === 'woff2') table = nameTableWoff2(buf);
    else if (format === 'woff') table = nameTableWoff(buf);
    else if (format === 'ttf' || format === 'otf') table = nameTableSfnt(buf);
    return familyFromNameTable(table);
  } catch (e) {
    return null;
  }
}

module.exports = { familyFromFontBytes, sniffFontFormat, WOFF2_TAGS };
