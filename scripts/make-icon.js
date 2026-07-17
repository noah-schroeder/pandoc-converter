#!/usr/bin/env node
/*
 * make-icon.js — generates build/icon.png (512x512) with no external tools.
 * A rounded indigo tile with a white document and a green "convert" arrow badge.
 * electron-builder resizes this into the per-OS icons it needs.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 512;
const buf = new Float64Array(S * S * 4); // straight RGBA, 0..255

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Signed distance to a rounded rectangle centered at (cx,cy).
function sdRoundRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - halfW + r;
  const qy = Math.abs(py - cy) - halfH + r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ox, oy) - r;
}
function sdCircle(px, py, cx, cy, r) { return Math.hypot(px - cx, py - cy) - r; }

// Composite src (rgba 0..255, a 0..1) over the pixel at (x,y).
function over(x, y, r, g, b, a) {
  if (a <= 0) return;
  const i = (y * S + x) * 4;
  const da = buf[i + 3] / 255;
  const outA = a + da * (1 - a);
  if (outA <= 0) return;
  buf[i] = (r * a + buf[i] * da * (1 - a)) / outA;
  buf[i + 1] = (g * a + buf[i + 1] * da * (1 - a)) / outA;
  buf[i + 2] = (b * a + buf[i + 2] * da * (1 - a)) / outA;
  buf[i + 3] = outA * 255;
}

// Coverage from a signed distance (1px anti-aliased edge).
function cov(sd) { return clamp(0.5 - sd, 0, 1); }

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    // Background tile: rounded square with a vertical indigo gradient.
    const bgSd = sdRoundRect(x, y, S / 2, S / 2, 216, 216, 108);
    const t = clamp((y - 40) / (S - 80), 0, 1);
    const r = 0x6d + (0x4f - 0x6d) * t;
    const g = 0x64 + (0x46 - 0x64) * t;
    const b = 0xff + (0xe5 - 0xff) * t;
    over(x, y, r, g, b, cov(bgSd));
  }
}

// White document.
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const sd = sdRoundRect(x, y, 232, 246, 92, 116, 16);
    over(x, y, 255, 255, 255, cov(sd));
  }
}
// Text lines on the document.
const lines = [[168], [206], [244], [282]];
for (const [ly] of lines) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const w = ly === 282 ? 44 : 66;
      const sd = sdRoundRect(x, y, 216, ly, w, 7, 6);
      over(x, y, 0xd6, 0xd9, 0xe6, cov(sd) * 0.95);
    }
  }
}

// Green "convert" arrow badge, bottom-right, overlapping the doc.
const bx = 348, by = 356, br = 60;
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    // white ring for separation
    over(x, y, 255, 255, 255, cov(sdCircle(x, y, bx, by, br + 7)));
    const cg = clamp((y - (by - br)) / (2 * br), 0, 1);
    const gg = 0x34 + (0x10 - 0x34) * cg;
    const gr = 0x22 + (0x0f - 0x22) * 0; // keep red low
    over(x, y, gr, 0x99 + (0x81 - 0x99) * cg, 0x5e, cov(sdCircle(x, y, bx, by, br)));
  }
}
// White arrow inside the badge (shaft + head), pointing right.
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const shaft = sdRoundRect(x, y, bx - 8, by, 20, 7, 4);
    over(x, y, 255, 255, 255, cov(shaft));
    // arrow head: triangle with its point on the right
    const hx = x - (bx + 6), hy = y - by;   // base at hx=0, point at hx=26
    const inHead = hx >= 0 && hx <= 26 && Math.abs(hy) <= (26 - hx) * 0.85;
    if (inHead) over(x, y, 255, 255, 255, 1);
  }
}

// ---- Encode PNG ----
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < S; x++) {
    const si = (y * S + x) * 4;
    const di = y * (S * 4 + 1) + 1 + x * 4;
    raw[di] = Math.round(clamp(buf[si], 0, 255));
    raw[di + 1] = Math.round(clamp(buf[si + 1], 0, 255));
    raw[di + 2] = Math.round(clamp(buf[si + 2], 0, 255));
    raw[di + 3] = Math.round(clamp(buf[si + 3], 0, 255));
  }
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // color type RGBA
const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const outDir = path.resolve(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'icon.png');
fs.writeFileSync(outFile, png);
console.log(`✓ Wrote ${path.relative(path.resolve(__dirname, '..'), outFile)} (${S}x${S})`);
