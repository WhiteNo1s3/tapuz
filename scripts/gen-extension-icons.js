'use strict';

/**
 * Generate the Tapuziel Bridge extension icons (16/48/128) as real PNGs —
 * pure Node, no deps. A tangerine (orange fruit + green leaf): "התפוז עם הכנפיים".
 * Run: node scripts/gen-extension-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'extension');

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

/** Draw the icon at `size` px, return an RGBA Buffer (size*size*4). */
function drawIcon(size) {
  const s = size / 128; // design coords are 128-based
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = 64 * s, cy = 68 * s, r = 56 * s;
  const orange = [0xf9, 0x73, 0x16];
  const orangeLight = [0xfd, 0xba, 0x74];
  const green = [0x22, 0xc5, 0x5e];
  const greenDark = [0x15, 0x80, 0x3d];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      let rgb = null; let alpha = 0;

      // leaf: small ellipse up-right of the fruit
      const lx = (px - 84 * s) / (13 * s);
      const ly = (py - 22 * s) / (8 * s);
      const leaf = lx * lx + ly * ly;
      if (leaf <= 1) {
        rgb = mix(green, greenDark, Math.min(1, leaf)); alpha = 255;
      } else {
        // fruit body with a soft top-left highlight, 1px AA at the rim
        const d = Math.hypot(px - cx, py - cy);
        if (d <= r + s) {
          const hl = Math.max(0, ((cx - px) + (cy - py)) / (r * 2.2));
          rgb = mix(orange, orangeLight, Math.max(0, Math.min(0.55, hl)));
          alpha = d <= r - s ? 255 : Math.round(255 * Math.max(0, (r + s - d) / (2 * s)));
        }
      }
      if (rgb && alpha > 0) {
        const i = (y * size + x) * 4;
        buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; buf[i + 3] = alpha;
      }
    }
  }
  return buf;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  // filter byte 0 (none) prepended to each scanline
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

for (const size of [16, 48, 128]) {
  const png = encodePng(size, drawIcon(size));
  const name = size === 128 ? 'icon.png' : `icon${size}.png`;
  fs.writeFileSync(path.join(OUT, name), png);
  console.log(`wrote extension/${name} (${png.length} bytes)`);
}
