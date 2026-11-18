// Dependency-free PNG icon renderer for assets/mark.svg: a white "no" sign on a rounded orange square.
import { crc32, deflateSync } from 'node:zlib';

const BG = [194, 65, 12];
const FG = [255, 255, 255];

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

// Geometry of assets/mark.svg (128-unit viewBox), in unit coordinates centred on 0.
// Keep the two in sync: the PNGs (Chrome) and the SVG (Firefox, README) must look identical.
const U = 1 / 128;
const RADIUS = 28 * U; // rounded-square corner (rx=28)
const RING = 33 * U; // ring centre-line radius (r=33)
const STROKE = 14 * U; // stroke width
const SLASH = (64 - 40.7) * U; // slash runs from (-SLASH,-SLASH) to (SLASH,SLASH), round caps

/** Coverage of the shape at (x,y) in unit coords [0,1]^2: background alpha + white foreground. */
function sample(x, y) {
  const cx = x - 0.5, cy = y - 0.5;
  const h = 0.5 - RADIUS;
  const qx = Math.max(Math.abs(cx) - h, 0), qy = Math.max(Math.abs(cy) - h, 0);
  if (Math.hypot(qx, qy) > RADIUS) return { a: 0, fg: false };
  const ring = Math.abs(Math.hypot(cx, cy) - RING) <= STROKE / 2;
  // distance to the slash segment (capsule = round line caps)
  const t = Math.max(-SLASH, Math.min(SLASH, (cx + cy) / 2));
  const slash = Math.hypot(cx - t, cy - t) <= STROKE / 2;
  return { a: 1, fg: ring || slash };
}

export function renderIcon(size) {
  const ss = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let a = 0, f = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const s = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          a += s.a;
          f += s.fg ? 1 : 0;
        }
      const n = ss * ss;
      const alpha = a / n, fgw = a ? f / a : 0;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c] * (1 - fgw) + FG[c] * fgw);
      raw[o + 3] = Math.round(alpha * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
