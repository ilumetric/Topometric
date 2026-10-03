// Tile Maker worker: turns an ordinary texture into a seamless one, off the main thread.
//
//   1. Equalize: divides out large-scale lighting (vignetting, light falloff), so the
//      repeat doesn't show up as a grid of bright and dark patches.
//   2. Seams: the image overlaps itself by a strip at each edge. Inside the strip a path
//      is found where both sides look most alike (image quilting's minimum error
//      boundary cut); each side is used up to the path, with a short feather across it.
//      First left/right, then top/bottom on the transposed image. The second path is
//      closed around the tile, so the corners meet too.
//   3. Heal (optional): the pixels around the seams are synthesized again from patches
//      found elsewhere in the texture (heal.js). Every output pixel remembers which source
//      pixel it came from, so the seams are known exactly.
//   4. The result is resized with wrap-around filtering, so it stays seamless.
//   5. Clone brush strokes are applied last, in output pixels (the page paints the same
//      strokes on the GPU while you draw).
//
// Each stage is cached, so a change only recomputes the stages after it.
//
// Messages in:
//   { type: 'set', w, h, data }                 new source (RGBA bytes, buffer is transferred)
//   { type: 'sample', size }                    built-in example; replies { type: 'source' }
//   { type: 'process', seq, params }            replies { type: 'result', seq, W, H, data, ... } (before clone strokes)
//   { type: 'encode', seq, format, strokes }    encodes the last result with the strokes applied
//   { type: 'pixels', seq, strokes }            the same, as raw RGBA bytes
import { encodePNG, encodeTGA } from '../../core/codecs.js';
import { resampleRGBA } from '../../core/resample.js';
import { heal, dilate } from './heal.js';

const LOW = 160;            // long side of the grid the lighting is estimated on

let src = null;             // { w, h, data, opaque }
const cache = {};           // stage name -> { key, value }
let last = null;            // last result before clone strokes: { W, H, data, opaque }

function stage(name, key, make) {
  const c = cache[name];
  if (c && c.key === key) return c.value;
  cache[name] = null;                                    // free the old value first
  const value = make();
  cache[name] = { key, value };
  return value;
}

/* ── Equalize ── */
function equalize({ w, h, data }, strength, scale) {
  if (strength <= 0) return data;
  // area-average down to a small grid
  const k = LOW / Math.max(w, h), lw = Math.max(2, Math.round(w * k)), lh = Math.max(2, Math.round(h * k));
  const sum = new Float64Array(lw * lh * 3), cnt = new Float64Array(lw * lh);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(lh - 1, Math.floor(y * lh / h)) * lw;
    for (let x = 0; x < w; x++) {
      const g = gy + Math.min(lw - 1, Math.floor(x * lw / w)), i = (y * w + x) * 4;
      sum[g * 3] += data[i]; sum[g * 3 + 1] += data[i + 1]; sum[g * 3 + 2] += data[i + 2];
      cnt[g]++;
    }
  }
  const mean = [0, 0, 0];
  let low = new Float64Array(lw * lh * 3);
  for (let g = 0; g < lw * lh; g++) for (let c = 0; c < 3; c++) {
    low[g * 3 + c] = sum[g * 3 + c] / cnt[g];
    mean[c] += sum[g * 3 + c];
  }
  for (let c = 0; c < 3; c++) mean[c] /= w * h;
  // Gaussian blur on the small grid, mirrored at the borders
  const sigma = Math.max(.5, scale * Math.max(lw, lh)), R = Math.ceil(sigma * 3);
  const kern = Array.from({ length: 2 * R + 1 }, (_, j) => Math.exp(-((j - R) ** 2) / (2 * sigma * sigma)));
  const mirror = (i, n) => { while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - i - 1; return i; };
  for (const [nx, ny, horiz] of [[lw, lh, true], [lw, lh, false]]) {
    const out = new Float64Array(low.length);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      let a = 0, b = 0, c = 0, ws = 0;
      for (let j = -R; j <= R; j++) {
        const g = horiz ? y * nx + mirror(x + j, nx) : mirror(y + j, ny) * nx + x, wt = kern[j + R];
        a += low[g * 3] * wt; b += low[g * 3 + 1] * wt; c += low[g * 3 + 2] * wt; ws += wt;
      }
      const o = (y * nx + x) * 3;
      out[o] = a / ws; out[o + 1] = b / ws; out[o + 2] = c / ws;
    }
    low = out;
  }
  // gain = mean / local lighting, faded by strength; one interpolated row of gains at a time
  const res = new Uint8ClampedArray(data.length), row = new Float32Array(lw * 3), gain = new Float32Array(w * 3);
  const gx0 = new Int32Array(w), gfx = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const f = Math.min(lw - 1, Math.max(0, (x + .5) * lw / w - .5));
    gx0[x] = Math.min(lw - 2, Math.floor(f)); gfx[x] = f - gx0[x];
  }
  for (let y = 0; y < h; y++) {
    const f = Math.min(lh - 1, Math.max(0, (y + .5) * lh / h - .5)), y0 = Math.min(lh - 2, Math.floor(f)), t = f - y0;
    for (let i = 0; i < lw * 3; i++) row[i] = low[y0 * lw * 3 + i] * (1 - t) + low[(y0 + 1) * lw * 3 + i] * t;
    for (let x = 0; x < w; x++) {
      const a = gx0[x] * 3, u = gfx[x];
      for (let c = 0; c < 3; c++) {
        const l = row[a + c] * (1 - u) + row[a + 3 + c] * u;
        const g = 1 + (mean[c] / Math.max(l, 1) - 1) * strength;
        gain[x * 3 + c] = Math.min(5, Math.max(.2, g));
      }
    }
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      res[i] = data[i] * gain[x * 3];
      res[i + 1] = data[i + 1] * gain[x * 3 + 1];
      res[i + 2] = data[i + 2] * gain[x * 3 + 2];
      res[i + 3] = data[i + 3];
    }
  }
  return res;
}

/* ── Seams ── */
// Minimum-cost path from top to bottom through a b × h cost grid, one column step per row.
// `cyclic`: the path must end next to where it started, so it also closes around the tile.
function cutPath(cost, b, h, lo, hi, cyclic) {
  const M = new Float64Array(b * h), from = new Int8Array(b * h), path = new Int32Array(h);
  let best = Infinity;
  // closed path: try a spread of starting columns and keep the cheapest that closes
  const n = Math.min(hi - lo + 1, 24);
  const starts = cyclic ? Array.from({ length: n }, (_, i) => Math.round(lo + i * (hi - lo) / Math.max(1, n - 1))) : [-1];
  for (const s of starts) {
    for (let x = 0; x < b; x++) M[x] = x < lo || x > hi || (s >= 0 && x !== s) ? Infinity : cost[x];
    for (let y = 1; y < h; y++) {
      const r = y * b, p = r - b;
      for (let x = 0; x < b; x++) {
        if (x < lo || x > hi) { M[r + x] = Infinity; continue; }
        let m = M[p + x], d = 0;
        if (x > lo && M[p + x - 1] < m) { m = M[p + x - 1]; d = -1; }
        if (x < hi && M[p + x + 1] < m) { m = M[p + x + 1]; d = 1; }
        M[r + x] = m + cost[r + x];
        from[r + x] = d;
      }
    }
    const r = (h - 1) * b;
    let end = -1, e = Infinity;
    for (let x = lo; x <= hi; x++) {
      if (s >= 0 && Math.abs(x - s) > 1) continue;
      if (M[r + x] < e) { e = M[r + x]; end = x; }
    }
    if (end < 0 || e >= best) continue;
    best = e;
    for (let y = h - 1, x = end; y >= 0; y--) { path[y] = x; x += from[y * b + x]; }
  }
  return path;
}

// Makes the image seamless left to right. The output is b pixels narrower: its first
// b columns mix the right strip (continuing the tile to the left) and the left strip
// (continuing into the rest of the image).
function seamX({ w, h, data }, b, soft, method, cyclic) {
  const W = w - b, out = new Uint8ClampedArray(W * h * 4);
  for (let y = 0; y < h; y++) out.set(data.subarray((y * w + b) * 4, (y * w + w - b) * 4), (y * W + b) * 4);
  const A = x => x, B = x => w - b + x;                  // source columns of the two strips
  const mask = new Float32Array(b * h);                  // weight of A (the left strip)
  if (method === 'blend') {
    for (let x = 0; x < b; x++) { const t = (x + .5) / b, m = t * t * (3 - 2 * t); for (let y = 0; y < h; y++) mask[y * b + x] = m; }
  } else {
    // squared difference of the strips, smoothed over 3 × 3 so the path ignores single noisy pixels
    const raw = new Float32Array(b * h), cost = new Float32Array(b * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) {
      const i = (y * w + A(x)) * 4, j = (y * w + B(x)) * 4;
      let d = 0;
      for (let c = 0; c < 4; c++) { const e = data[i + c] - data[j + c]; d += e * e; }
      raw[y * b + x] = d;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = cyclic ? (y + dy + h) % h : Math.min(h - 1, Math.max(0, y + dy)), xx = Math.min(b - 1, Math.max(0, x + dx));
        s += raw[yy * b + xx];
      }
      cost[y * b + x] = s + 1;                         // +1: among equal costs prefer shorter paths
    }
    const f = Math.min(soft, Math.floor((b - 2) / 2));
    const path = cutPath(cost, b, h, f, b - 1 - f, cyclic);
    for (let y = 0; y < h; y++) {
      const p = path[y];
      for (let x = 0; x < b; x++) {
        let m;
        if (f <= 0) m = x >= p ? 1 : 0;
        else { const t = Math.min(1, Math.max(0, (x - p + f) / (2 * f))); m = t * t * (3 - 2 * t); }
        mask[y * b + x] = m;
      }
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) {
    const m = mask[y * b + x], i = (y * w + A(x)) * 4, j = (y * w + B(x)) * 4, o = (y * W + x) * 4;
    for (let c = 0; c < 4; c++) out[o + c] = data[i + c] * m + data[j + c] * (1 - m);
  }
  return { w: W, h, data: out, mask, b };
}

// The same choice for a map of where each pixel came from (one 32-bit value per pixel):
// a pixel belongs to the side that weighs more.
function selectX(idx, w, h, b, mask) {
  const W = w - b, out = new Uint32Array(W * h);
  for (let y = 0; y < h; y++) {
    out.set(idx.subarray(y * w + b, y * w + w - b), y * W + b);
    for (let x = 0; x < b; x++) out[y * W + x] = idx[y * w + (mask[y * b + x] >= .5 ? x : w - b + x)];
  }
  return out;
}

function transpose32(s, w, h) {
  const d = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[x * h + y] = s[y * w + x];
  return d;
}
function transpose({ w, h, data }) {
  const d = transpose32(new Uint32Array(data.buffer, data.byteOffset, w * h), w, h);
  return { w: h, h: w, data: new Uint8ClampedArray(d.buffer) };
}

// Pixels whose right or lower neighbour didn't come from the next source pixel lie on a
// seam; the hole to heal is everything within r of them.
function seamHole(idx, W, H, srcW, r) {
  const seam = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, i = idx[p];
    const right = y * W + (x + 1) % W, down = ((y + 1) % H) * W + x;
    if (idx[right] !== i + 1 || i % srcW === srcW - 1) { seam[p] = 1; seam[right] = 1; }
    if (idx[down] !== i + srcW) { seam[p] = 1; seam[down] = 1; }
  }
  return dilate(seam, W, H, r);
}

const healKeyOf = ({ equalize, scale, seam, soft, method, heal: on, healWidth }) =>
  `${equalize}:${scale}|${seam}:${soft}:${method}|${on ? healWidth : 'off'}`;
const healCached = params => cache.heal?.key === healKeyOf(params);

function process({ equalize: strength, scale, seam, soft, method, heal: healOn, healWidth, size }) {
  const eqKey = strength + ':' + scale;
  const eq = stage('equalize', eqKey, () => ({ w: src.w, h: src.h, data: equalize(src, strength, scale) }));
  const cutKey = eqKey + '|' + seam + ':' + soft + ':' + method;
  const cut = stage('cut', cutKey, () => {
    const bx = Math.max(4, Math.round(src.w * seam)), by = Math.max(4, Math.round(src.h * seam));
    const idx0 = new Uint32Array(src.w * src.h);
    for (let i = 0; i < idx0.length; i++) idx0[i] = i;
    const r1 = seamX(eq, bx, soft, method, false);
    const idx1 = selectX(idx0, src.w, src.h, bx, r1.mask);
    const t = transpose(r1), r2 = seamX(t, by, soft, method, true);
    const idx2 = selectX(transpose32(idx1, r1.w, r1.h), t.w, t.h, by, r2.mask);
    const img = transpose(r2);
    return { ...img, idx: transpose32(idx2, r2.w, r2.h) };
  });
  const healKey = cutKey + '|' + (healOn ? healWidth : 'off');
  const healed = stage('heal', healKey, () => {
    if (!healOn) return cut.data;
    const r = Math.round(healWidth) + (method === 'cut' ? soft : 0);
    const hole = seamHole(cut.idx, cut.w, cut.h, src.w, r);
    return heal(cut.w, cut.h, cut.data, hole, Math.max(1, Math.min(4, Math.ceil(Math.log2(r / 2)))));
  });
  let W = cut.w, H = cut.h, data = healed;
  const cropW = W, cropH = H;
  if (size > 0) {
    // keep the aspect ratio: the long side becomes `size`, the short one the nearest power of two
    const pow2 = v => 2 ** Math.round(Math.log2(v));
    const tw = W >= H ? size : Math.min(size, pow2(size * W / H)), th = H >= W ? size : Math.min(size, pow2(size * H / W));
    data = resampleRGBA(data, W, H, tw, th, true);
    W = tw; H = th;
  }
  return { W, H, data, cropW, cropH, opaque: src.opaque };
}

/* ── Built-in example: cobblestones under uneven light, not tileable on purpose ── */
function hash(x, y, k) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(k, 1442695041) | 0;
  n = Math.imul(n ^ n >>> 13, 1274126177);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
function noise(x, y, k) {
  const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash(xi, yi, k), b = hash(xi + 1, yi, k), c = hash(xi, yi + 1, k), d = hash(xi + 1, yi + 1, k);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
function sample(n) {
  const data = new Uint8ClampedArray(n * n * 4), cells = 7.3;
  for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) {
    const u = px / n * cells, v = py / n * cells, ci = Math.floor(u), cj = Math.floor(v);
    let f1 = 9, f2 = 9, id = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj;
      const d = Math.hypot(u - i - .15 - .7 * hash(i, j, 1), v - j - .15 - .7 * hash(i, j, 2));
      if (d < f1) { f2 = f1; f1 = d; id = hash(i, j, 3); } else if (d < f2) f2 = d;
    }
    const grain = noise(u * 9, v * 9, 4) * .6 + noise(u * 23, v * 23, 5) * .4;
    const edge = Math.min(1, Math.max(0, (f2 - f1 - .03) / .07)), stone = edge * edge * (3 - 2 * edge);
    const tone = (.42 + .38 * id) * (.8 + .35 * grain) * (1 - .35 * f1);
    const sc = [tone * 1.02, tone * .93, tone * .82], mc = [.2, .19, .17].map(m => m * (.7 + .6 * grain));
    // light falls off to the lower right, with a vignette — the kind of thing equalize removes
    const lx = px / n, ly = py / n, light = (1.25 - .55 * lx - .35 * ly) * (1 - .35 * ((lx - .4) ** 2 + (ly - .35) ** 2));
    const o = (py * n + px) * 4, fine = (hash(px, py, 6) - .5) * .05;
    for (let c = 0; c < 3; c++) data[o + c] = ((mc[c] + (sc[c] - mc[c]) * stone) * light + fine) * 255;
    data[o + 3] = 255;
  }
  return data;
}

/* ── Clone brush ── */
// Strokes are in output units: dab centres and the offset as fractions of the size,
// the radius as a fraction of the width. Each stroke's dabs make one mask (their maximum),
// then the stroke is laid over the image, copying from the image as it was before any
// stroke. The page draws exactly this on the GPU.
function applyStrokes({ W, H, data }, strokes) {
  if (!strokes?.length) return data;
  const out = data.slice(), mask = new Float32Array(W * H), touched = [];
  for (const s of strokes) {
    const R = s.r * W, hr = Math.min(.95, s.hardness) * R, ox = Math.round(s.off[0] * W), oy = Math.round(s.off[1] * H);
    for (const [u, v] of s.dabs) {
      const cx = u * W, cy = v * H;
      for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) {
        const row = ((y % H) + H) % H * W;
        for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
          const d = Math.hypot(x + .5 - cx, y + .5 - cy);
          if (d >= R) continue;
          let a = 1;
          if (d > hr) { const t = (d - hr) / (R - hr); a = 1 - t * t * (3 - 2 * t); }
          const i = row + ((x % W) + W) % W;
          if (a > mask[i]) { if (!mask[i]) touched.push(i); mask[i] = a; }
        }
      }
    }
    for (const i of touched) {
      const a = mask[i] * s.opacity, x = i % W, y = (i / W) | 0;
      const j = (((y + oy) % H + H) % H * W + ((x + ox) % W + W) % W) * 4;
      for (let c = 0; c < 3; c++) out[i * 4 + c] = out[i * 4 + c] * (1 - a) + data[j + c] * a;
      mask[i] = 0;
    }
    touched.length = 0;
  }
  return out;
}

function setSource(w, h, data) {
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break; }
  src = { w, h, data, opaque };
  for (const k in cache) delete cache[k];
  last = null;
}

/* ── Messages ── */
self.onmessage = async ({ data: m }) => {
  try {
    switch (m.type) {
      case 'set':
        setSource(m.w, m.h, m.data);
        break;
      case 'sample': {
        const data = sample(m.size), copy = data.slice();
        setSource(m.size, m.size, data);
        self.postMessage({ type: 'source', w: m.size, h: m.size, data: copy }, [copy.buffer]);
        break;
      }
      case 'process': {
        const post = (r, partial) => {
          const copy = r.data.slice();
          self.postMessage({ type: 'result', seq: m.seq, partial, W: r.W, H: r.H, cropW: r.cropW, cropH: r.cropH, opaque: r.opaque, data: copy }, [copy.buffer]);
        };
        // Healing takes a while: show the result without it first, then the healed one.
        if (m.params.heal && !healCached(m.params)) post(process({ ...m.params, heal: false }), true);
        post(last = process(m.params), false);
        break;
      }
      case 'pixels': {
        const data = applyStrokes(last, m.strokes);
        const copy = data === last.data ? data.slice() : data;
        self.postMessage({ type: 'pixels', seq: m.seq, W: last.W, H: last.H, data: copy }, [copy.buffer]);
        break;
      }
      case 'encode': {
        const { W, H, opaque } = last, n = W * H, data = applyStrokes(last, m.strokes);
        let px = data, ch = 4;
        if (opaque) {
          ch = 3; px = new Uint8Array(n * 3);
          for (let i = 0, o = 0; i < n; i++, o += 3) { px[o] = data[i * 4]; px[o + 1] = data[i * 4 + 1]; px[o + 2] = data[i * 4 + 2]; }
        }
        const img = { W, H, px, ch };
        const blob = m.format === 'png' ? await encodePNG(img) : encodeTGA(img);
        self.postMessage({ type: 'encoded', seq: m.seq, blob });
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: 'error', op: m.type, seq: m.seq, message: String(err && err.message || err) });
  }
};
