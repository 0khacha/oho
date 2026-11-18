// Dependency-free PNG icon: a white "no" sign (ring + slash) on a rounded orange square.
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

/** Coverage in [0,1] of shape at (x,y) in unit coords [0,1]^2. */
function sample(x, y) {
  const cx = x - 0.5, cy = y - 0.5;
  // rounded square
  const r = 0.22, h = 0.5 - r;
  const qx = Math.max(Math.abs(cx) - h, 0), qy = Math.max(Math.abs(cy) - h, 0);
  const inBg = Math.hypot(qx, qy) <= r;
  if (!inBg) return { a: 0, fg: false };
  const d = Math.hypot(cx, cy);
  const ring = d <= 0.31 && d >= 0.2;
  // slash from top-left to bottom-right, clipped to the ring's outer radius
  const slash = Math.abs(cx - cy) / Math.SQRT2 <= 0.055 && d <= 0.27;
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
