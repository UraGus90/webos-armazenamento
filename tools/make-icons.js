'use strict';

// Gera app/icon.png (80x80) e app/largeIcon.png (130x130) sem dependências externas.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function insideRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function icon(size) {
  const s = (v) => v * size;
  const bars = [
    { y: 0.24, w: 0.70, color: rgb('#4cc3d9') },
    { y: 0.43, w: 0.48, color: rgb('#6f8cff') },
    { y: 0.62, w: 0.26, color: rgb('#f2b84b') },
  ];
  const bg = rgb('#182027');
  return encodePng(size, (x, y) => {
    if (!insideRoundRect(x, y, 0, 0, size, size, s(0.2))) return [0, 0, 0, 0];
    for (const bar of bars) {
      if (insideRoundRect(x, y, s(0.15), s(bar.y), s(0.15 + bar.w), s(bar.y + 0.13), s(0.04))) return [...bar.color, 255];
    }
    return [...bg, 255];
  });
}

const appDir = path.join(__dirname, '..', 'app');
fs.writeFileSync(path.join(appDir, 'icon.png'), icon(80));
fs.writeFileSync(path.join(appDir, 'largeIcon.png'), icon(130));
console.log('Ícones gerados em app/.');
