import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

/* ---- PNG writer -------------------------------------------------------- */

const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
const crc32 = (buf) => {
  let c = ~0;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      raw[o++] = rgba[i];
      raw[o++] = rgba[i + 1];
      raw[o++] = rgba[i + 2];
      raw[o++] = rgba[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---- geometry, in a normalised 0..1 box --------------------------------- */

/** Classic pointer: interaction is what this tool records. */
const CURSOR = [
  [0.30, 0.13],
  [0.30, 0.75],
  [0.435, 0.615],
  [0.535, 0.85],
  [0.645, 0.80],
  [0.545, 0.57],
  [0.715, 0.55],
];

/**
 * A 16 px variant: same cursor, but with a shorter head and a wider, more upright
 * tail so the tail still occupies whole pixels instead of vanishing into a
 * half-covered row.
 */
const CURSOR_16 = [
  [0.30, 0.12],
  [0.30, 0.70],
  [0.45, 0.555],
  [0.545, 0.86],
  [0.70, 0.795],
  [0.595, 0.505],
  [0.745, 0.475],
];

function inPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function inRoundedSquare(px, py, inset, radius) {
  const lo = inset;
  const hi = 1 - inset;
  if (px < lo || px > hi || py < lo || py > hi) return false;
  // Only the corner regions need the distance test.
  const cx = px < lo + radius ? lo + radius : px > hi - radius ? hi - radius : px;
  const cy = py < lo + radius ? lo + radius : py > hi - radius ? hi - radius : py;
  return Math.hypot(px - cx, py - cy) <= radius + 1e-9;
}

const inCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) <= r;

/* ---- compositing -------------------------------------------------------- */

const over = (dst, i, [r, g, b], a) => {
  if (a <= 0) return;
  const inv = 1 - a;
  const da = dst[i + 3] / 255;
  const outA = a + da * inv;
  dst[i] = Math.round((r * a + dst[i] * da * inv) / outA);
  dst[i + 1] = Math.round((g * a + dst[i + 1] * da * inv) / outA);
  dst[i + 2] = Math.round((b * a + dst[i + 2] * da * inv) / outA);
  dst[i + 3] = Math.round(outA * 255);
};

/**
 * 4×4 supersampling per pixel. Without it a diagonal like the cursor's edge
 * comes out visibly stepped at 32 px and looks amateur next to other icons.
 */
const SS = 4;

/** Scale a polygon about a point, so a size can use a different composition. */
function transform(poly, scale, dx, dy) {
  return poly.map(([x, y]) => [0.5 + (x - 0.5) * scale + dx, 0.5 + (y - 0.5) * scale + dy]);
}

function render(size) {
  const rgba = new Uint8Array(size * size * 4);
  // The red record dot is only legible at 32 px and up; at 16 px it would be a
  // three-pixel smudge that muddies the one shape that has to read.
  const withDot = size >= 32;
  const inset = size <= 16 ? 0.02 : 0.05;
  const radius = 0.2;

  // 16 px: the whole cursor, tail included, scaled to fit with a little air.
  // The tail is what stops the shape reading as a play triangle, so it stays
  // even though it is barely two pixels wide here.
  const cursor = withDot ? CURSOR : transform(CURSOR_16, 1.16, 0.0, 0);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgA = 0;
      let bgShade = 0;
      let fgA = 0;
      let dotA = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / size;
          const py = (y + (sy + 0.5) / SS) / size;

          if (inRoundedSquare(px, py, inset, radius)) {
            bgA += 1;
            bgShade += py; // vertical gradient
          }
          if (inPolygon(px, py, cursor)) fgA += 1;
          if (withDot && inCircle(px, py, 0.745, 0.255, 0.125)) dotA += 1;
        }
      }

      const total = SS * SS;
      const i = (y * size + x) * 4;

      if (bgA > 0) {
        // Deep slate to indigo: dark enough that the white cursor carries the
        // shape on both light and dark browser themes.
        const t = bgShade / bgA;
        const bg = [
          Math.round(15 + t * 16),
          Math.round(26 + t * 32),
          Math.round(56 + t * 47),
        ];
        over(rgba, i, bg, bgA / total);
      }
      if (dotA > 0) over(rgba, i, [239, 68, 68], dotA / total);
      if (fgA > 0) over(rgba, i, [255, 255, 255], fgA / total);
    }
  }
  return rgba;
}

const dir = process.argv[2];
mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 96, 128]) {
  const file = `${dir}/${size}.png`;
  writeFileSync(file, png(size, render(size)));
  console.log(file);
}
