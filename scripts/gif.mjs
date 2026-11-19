// Dev-only, dependency-free: decode PNG screenshots and encode an animated GIF (for assets/demo.gif).
import { inflateSync } from 'node:zlib';

/** Decode an 8-bit, non-interlaced RGB/RGBA PNG (what Chromium screenshots are) to RGBA pixels. */
export function decodePNG(buf) {
  let pos = 8, width = 0, height = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('only 8-bit non-interlaced PNGs');
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bpp) throw new Error('unsupported PNG color type ' + colorType);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      out[(y * width + x) * 4] = line[x * bpp];
      out[(y * width + x) * 4 + 1] = line[x * bpp + 1];
      out[(y * width + x) * 4 + 2] = line[x * bpp + 2];
      out[(y * width + x) * 4 + 3] = 255;
    }
    prev = line;
  }
  return { width, height, data: out };
}

/** Box-downscale RGBA by an integer factor. */
export function downscale(img, f) {
  const w = Math.floor(img.width / f), h = Math.floor(img.height / f);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += img.data[((y * f + dy) * img.width + x * f + dx) * 4 + c];
        out[(y * w + x) * 4 + c] = Math.round(s / (f * f));
      }
  return { width: w, height: h, data: out };
}

// Fixed palette: 6x7x6 colour cube (252) + 4 greys. Good enough for UI screenshots.
const PALETTE = [];
for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) PALETTE.push([r * 51, Math.round(g * 42.5), b * 51]);
for (const v of [34, 85, 170, 221]) PALETTE.push([v, v, v]);
const nearest = (r, g, b) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < PALETTE.length; i++) {
    const p = PALETTE[i], d = (p[0] - r) ** 2 * 2 + (p[1] - g) ** 2 * 4 + (p[2] - b) ** 2 * 3;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
};
const cache = new Map();
const index = (r, g, b) => {
  const k = (r << 16) | (g << 8) | b;
  let v = cache.get(k);
  if (v === undefined) cache.set(k, (v = nearest(r, g, b)));
  return v;
};

/** GIF LZW for 8-bit indices. */
function lzw(indices) {
  const MIN = 8, CLEAR = 256, EOI = 257;
  const out = [];
  let cur = 0, nbits = 0;
  const emit = (code, size) => {
    cur |= code << nbits;
    nbits += size;
    while (nbits >= 8) { out.push(cur & 255); cur >>>= 8; nbits -= 8; }
  };
  let dict = new Map(), next = EOI + 1, size = MIN + 1;
  emit(CLEAR, size);
  let w = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = w * 256 + k;
    const hit = dict.get(key);
    if (hit !== undefined) { w = hit; continue; }
    emit(w, size);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(CLEAR, size);
      dict = new Map(); next = EOI + 1; size = MIN + 1;
    }
    w = k;
  }
  emit(w, size);
  emit(EOI, size);
  if (nbits > 0) out.push(cur & 255);
  return Buffer.from(out);
}

/** frames: [{ img: {width,height,data RGBA}, delayMs }] -> GIF bytes (looping). */
export function encodeGIF(frames) {
  const { width, height } = frames[0].img;
  const parts = [];
  const hdr = Buffer.alloc(13);
  hdr.write('GIF89a', 0, 'ascii');
  hdr.writeUInt16LE(width, 6);
  hdr.writeUInt16LE(height, 8);
  hdr[10] = 0xf7; // global colour table, 256 entries
  parts.push(hdr);
  const pal = Buffer.alloc(768);
  PALETTE.forEach((p, i) => { pal[i * 3] = p[0]; pal[i * 3 + 1] = p[1]; pal[i * 3 + 2] = p[2]; });
  parts.push(pal);
  parts.push(Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0x00, 0x00, 0x00]));
  for (const { img, delayMs } of frames) {
    const gce = Buffer.from([0x21, 0xf9, 0x04, 0x04, 0, 0, 0, 0]);
    gce.writeUInt16LE(Math.round(delayMs / 10), 4);
    parts.push(gce);
    const desc = Buffer.alloc(10);
    desc[0] = 0x2c;
    desc.writeUInt16LE(img.width, 5);
    desc.writeUInt16LE(img.height, 7);
    parts.push(desc);
    const idx = new Uint8Array(img.width * img.height);
    for (let i = 0; i < idx.length; i++) idx[i] = index(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
    const data = lzw(idx);
    const blocks = [Buffer.from([8])];
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.subarray(i, i + 255);
      blocks.push(Buffer.from([chunk.length]), chunk);
    }
    blocks.push(Buffer.from([0]));
    parts.push(...blocks);
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}
