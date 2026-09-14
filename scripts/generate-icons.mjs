// scripts/generate-icons.mjs
// One-off placeholder PWA icon generator: dark square, white "Uy." wordmark,
// rendered as a tiny hand-rolled PNG (no canvas/image deps needed). Run with
// `node scripts/generate-icons.mjs`. Regenerate only if the wordmark design
// changes — these are functional placeholders, see README/report notes.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const INK = [0x1c, 0x1d, 0x1f]; // matches --ink dark tone from the design
const WHITE = [0xff, 0xff, 0xff];

// 5x7 bitmap glyphs (1 = lit pixel)
const GLYPHS = {
  U: [
    '10001',
    '10001',
    '10001',
    '10001',
    '10001',
    '10001',
    '01110',
  ],
  y: [
    '00000',
    '00000',
    '10001',
    '10001',
    '01111',
    '00001',
    '01110',
  ],
  '.': [
    '00000',
    '00000',
    '00000',
    '00000',
    '00000',
    '01100',
    '01100',
  ],
};

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgbaPixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // raw scanlines, each prefixed with filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgbaPixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idatData = deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function roundedSquareMask(size, radius, x, y) {
  const cx = Math.min(Math.max(x, radius), size - radius - 1);
  const cy = Math.min(Math.max(y, radius), size - radius - 1);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = Math.round(size * 0.22);

  // background: rounded dark square
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const inside = roundedSquareMask(size, radius, x, y);
      const [r, g, b] = inside ? INK : [0, 0, 0];
      pixels[idx] = r; pixels[idx + 1] = g; pixels[idx + 2] = b;
      pixels[idx + 3] = inside ? 255 : 0;
    }
  }

  // wordmark "Uy." centered, scaled bitmap font
  const text = ['U', 'y', '.'];
  const glyphCols = 5, glyphRows = 7, gap = 1;
  const totalCols = text.length * glyphCols + (text.length - 1) * gap;
  const scale = Math.floor((size * 0.56) / totalCols);
  const textWidth = totalCols * scale;
  const textHeight = glyphRows * scale;
  const startX = Math.round((size - textWidth) / 2);
  const startY = Math.round((size - textHeight) / 2);

  let cursorX = startX;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    for (let gy = 0; gy < glyphRows; gy++) {
      for (let gx = 0; gx < glyphCols; gx++) {
        if (glyph[gy][gx] !== '1') continue;
        for (let py = 0; py < scale; py++) {
          for (let px = 0; px < scale; px++) {
            const x = cursorX + gx * scale + px;
            const y = startY + gy * scale + py;
            if (x < 0 || y < 0 || x >= size || y >= size) continue;
            const idx = (y * size + x) * 4;
            pixels[idx] = WHITE[0]; pixels[idx + 1] = WHITE[1]; pixels[idx + 2] = WHITE[2];
            pixels[idx + 3] = 255;
          }
        }
      }
    }
    cursorX += (glyphCols + gap) * scale;
  }

  return encodePNG(size, size, pixels);
}

const sizes = [192, 512];
for (const size of sizes) {
  const png = renderIcon(size);
  const file = path.join(outDir, `icon-${size}.png`);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}

// Apple touch icon: iOS ignores alpha/rounding and applies its own mask, so
// give it an opaque square version at a common size.
function renderAppleTouchIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      pixels[idx] = INK[0]; pixels[idx + 1] = INK[1]; pixels[idx + 2] = INK[2];
      pixels[idx + 3] = 255;
    }
  }
  const text = ['U', 'y', '.'];
  const glyphCols = 5, glyphRows = 7, gap = 1;
  const totalCols = text.length * glyphCols + (text.length - 1) * gap;
  const scale = Math.floor((size * 0.56) / totalCols);
  const textWidth = totalCols * scale;
  const textHeight = glyphRows * scale;
  const startX = Math.round((size - textWidth) / 2);
  const startY = Math.round((size - textHeight) / 2);
  let cursorX = startX;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    for (let gy = 0; gy < glyphRows; gy++) {
      for (let gx = 0; gx < glyphCols; gx++) {
        if (glyph[gy][gx] !== '1') continue;
        for (let py = 0; py < scale; py++) {
          for (let px = 0; px < scale; px++) {
            const x = cursorX + gx * scale + px;
            const y = startY + gy * scale + py;
            if (x < 0 || y < 0 || x >= size || y >= size) continue;
            const idx = (y * size + x) * 4;
            pixels[idx] = WHITE[0]; pixels[idx + 1] = WHITE[1]; pixels[idx + 2] = WHITE[2];
            pixels[idx + 3] = 255;
          }
        }
      }
    }
    cursorX += (glyphCols + gap) * scale;
  }
  return encodePNG(size, size, pixels);
}

const appleTouchPng = renderAppleTouchIcon(180);
writeFileSync(path.join(outDir, 'apple-touch-icon.png'), appleTouchPng);
console.log('wrote apple-touch-icon.png (180x180)');
