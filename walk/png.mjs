// A screenshot's pixels, for a walk that must read what a WebGL canvas drew (its drawing buffer is
// cleared after each frame, so the page cannot read it back; the compositor's screenshot can).
// Decodes the 8-bit, non-interlaced RGB and RGBA PNGs a browser's screenshot is.
import { inflateSync } from 'node:zlib';

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let w = 0, h = 0, type = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const kind = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('only 8-bit non-interlaced PNGs');
      type = data[9];
    } else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    off += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (!bpp) throw new Error(`PNG colour type ${type}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    raw.copy(line, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 255;
    }
    line.copy(prev);
    for (let x = 0; x < w; x++) {
      out[(y * w + x) * 4] = line[x * bpp];
      out[(y * w + x) * 4 + 1] = line[x * bpp + 1];
      out[(y * w + x) * 4 + 2] = line[x * bpp + 2];
      out[(y * w + x) * 4 + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
  }
  return { w, h, data: out };
}

/** How many distinct colours (to 4 bits a channel), and the share of pixels unlike the corner's colour. */
export function colourStats(png) {
  const { w, h, data } = png;
  const seen = new Set();
  const [r0, g0, b0] = [data[0], data[1], data[2]];
  let unlike = 0;
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    seen.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    if (Math.abs(r - r0) + Math.abs(g - g0) + Math.abs(b - b0) > 24) unlike++;
  }
  return { colours: seen.size, unlike: unlike / (w * h) };
}
