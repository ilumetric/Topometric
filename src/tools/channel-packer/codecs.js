// Lossless image codecs written by hand, so pixel values are stored exactly:
// no premultiplied alpha, no color management, no canvas rounding.
// Pixels are passed as { W, H, px, ch }: ch = 1 (gray), 3 (RGB) or 4 (RGBA) bytes per pixel, top row first.

/* ── TGA: read ── */
// Types 2/3 (raw truecolor/gray) and 10/11 (RLE), 8/24/32 bits. Returns RGBA, top row first.
export function parseTGA(buf) {
  const b = new Uint8Array(buf);
  const type = b[2], w = b[12] | b[13] << 8, h = b[14] | b[15] << 8, bpp = b[16], desc = b[17];
  if (b[1] || ![2, 3, 10, 11].includes(type) || ![8, 24, 32].includes(bpp) || !w || !h) throw new Error('Unsupported TGA');
  const ps = bpp / 8, n = w * h, data = new Uint8ClampedArray(n * 4);
  const useAlpha = ps === 4 && (desc & 15) > 0;
  let p = 18 + b[0], i = 0;
  const put = o => {
    if (o + ps > b.length) throw new Error('Truncated TGA');
    const j = i++ * 4;
    if (ps === 1) { data[j] = data[j + 1] = data[j + 2] = b[o]; data[j + 3] = 255; return; }
    data[j] = b[o + 2]; data[j + 1] = b[o + 1]; data[j + 2] = b[o]; data[j + 3] = useAlpha ? b[o + 3] : 255;
  };
  if (type < 9) while (i < n) { put(p); p += ps; }
  else while (i < n) {
    if (p >= b.length) throw new Error('Truncated TGA');
    const c = b[p++], count = (c & 127) + 1;
    if (c & 128) { const o = p; p += ps; for (let k = 0; k < count && i < n; k++) put(o); }
    else for (let k = 0; k < count && i < n; k++) { put(p); p += ps; }
  }
  const row = w * 4;
  if (!(desc & 0x20)) {                   // origin at the bottom: flip vertically
    const tmp = new Uint8ClampedArray(row);
    for (let y = 0; y < h >> 1; y++) {
      const a = y * row, z = (h - 1 - y) * row;
      tmp.set(data.subarray(a, a + row)); data.copyWithin(a, z, z + row); data.set(tmp, z);
    }
  }
  if (desc & 0x10) {                      // origin on the right: flip horizontally
    const d32 = new Uint32Array(data.buffer);
    for (let y = 0; y < h; y++) d32.subarray(y * w, y * w + w).reverse();
  }
  return { w, h, data };
}

/* ── TGA: write, RLE ── */
export function encodeTGA({ W, H, px, ch }) {
  const buf = new Uint8Array(18 + H * (W * (ch + 1)));   // worst case for RLE
  buf[2] = ch === 1 ? 11 : 10;                             // gray or truecolor, RLE
  buf[12] = W & 255; buf[13] = W >> 8; buf[14] = H & 255; buf[15] = H >> 8;
  buf[16] = ch * 8; buf[17] = ch === 4 ? 8 : 0;            // origin at the bottom
  let o = 18;
  const same = (a, b) => { for (let k = 0; k < ch; k++) if (px[a + k] !== px[b + k]) return false; return true; };
  const put = ch === 1 ? i => { buf[o++] = px[i]; }
    : i => { buf[o++] = px[i + 2]; buf[o++] = px[i + 1]; buf[o++] = px[i]; if (ch === 4) buf[o++] = px[i + 3]; };
  for (let y = H - 1; y >= 0; y--) {
    const row = y * W * ch;
    let x = 0;
    while (x < W) {
      let run = 1;
      while (x + run < W && run < 128 && same(row + x * ch, row + (x + run) * ch)) run++;
      if (run > 1) { buf[o++] = 0x80 | (run - 1); put(row + x * ch); x += run; continue; }
      let n = 1;                                           // raw pixels up to the next repeat
      while (x + n < W && n < 128 && !(x + n + 1 < W && same(row + (x + n) * ch, row + (x + n + 1) * ch))) n++;
      buf[o++] = n - 1;
      for (let k = 0; k < n; k++) put(row + (x + k) * ch);
      x += n;
    }
  }
  return new Blob([buf.subarray(0, o)], { type: 'image/x-tga' });
}

/* ── PNG: write, 8 bits per channel ── */
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });

function chunk(type, body) {
  const b = new Uint8Array(12 + body.length), v = new DataView(b.buffer);
  v.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
  b.set(body, 8);
  let c = 0xFFFFFFFF;
  for (let i = 4; i < 8 + body.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  v.setUint32(8 + body.length, (c ^ 0xFFFFFFFF) >>> 0);
  return b;
}

export async function encodePNG({ W, H, px, ch }) {
  if (typeof CompressionStream === 'undefined') throw new Error('PNG export needs a newer browser');
  const stride = W * ch, raw = new Uint8Array((stride + 1) * H);
  for (let y = 0, o = 0; y < H; y++) {
    raw[o++] = 1;                         // filter "Sub": difference with the left neighbour
    for (let x = 0, i = y * stride; x < stride; x++, i++) raw[o++] = px[i] - (x >= ch ? px[i - ch] : 0);
  }
  // "deflate" is the zlib format that PNG's IDAT expects.
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, W); v.setUint32(4, H);
  ihdr.set([8, { 1: 0, 3: 2, 4: 6 }[ch], 0, 0, 0], 8);
  return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))], { type: 'image/png' });
}
