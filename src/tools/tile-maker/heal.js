/* Seam healing: the pixels around the seams are synthesized again from patches found
   elsewhere in the texture, the way content-aware fill works — PatchMatch nearest-patch
   search (Barnes et al. 2009) with patch voting, coarse to fine (Wexler et al. 2007).
   A cut that went through a stone becomes a plausible stone edge instead of two halves.

   The image is treated as a torus: patches wrap around the edges, so the result stays
   seamless. Only pixels inside `hole` change. */

const PR = 3;                          // patch radius: 7 × 7 patches

let seed = 0x9E3779B9;
function rnd() {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
}

// Any set pixel within r (a square, wrapping around the edges); sliding-window counts.
export function dilate(mask, w, h, r) {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  const rx = Math.min(r, (w - 1) >> 1), ry = Math.min(r, (h - 1) >> 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let c = 0;
    for (let k = -rx; k <= rx; k++) c += mask[row + (k + w) % w];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = c > 0 ? 1 : 0;
      c += mask[row + (x + rx + 1) % w] - mask[row + (x - rx + w) % w];
    }
  }
  for (let x = 0; x < w; x++) {
    let c = 0;
    for (let k = -ry; k <= ry; k++) c += tmp[((k + h) % h) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = c > 0 ? 1 : 0;
      c += tmp[((y + ry + 1) % h) * w + x] - tmp[((y - ry + h) % h) * w + x];
    }
  }
  return out;
}

function half(img, hole, w, h) {
  const W = w >> 1, H = h >> 1, out = new Float32Array(W * H * 4), oh = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = (2 * y * w + 2 * x), o = y * W + x;
    for (let c = 0; c < 4; c++) out[o * 4 + c] = (img[a * 4 + c] + img[(a + 1) * 4 + c] + img[(a + w) * 4 + c] + img[(a + w + 1) * 4 + c]) / 4;
    oh[o] = hole[a] | hole[a + 1] | hole[a + w] | hole[a + w + 1];
  }
  return { w: W, h: H, img: out, hole: oh };
}

// One pyramid level: improve the nearest-neighbour field, then rebuild the hole from it.
function level(lv, prev, iterations, finest) {
  const { w, h, img, hole } = lv, n = w * h;
  const near = dilate(hole, w, h, PR);            // targets: patches that touch the hole; never sources
  const active = [], valid = [];
  for (let i = 0; i < n; i++) (near[i] ? active : valid).push(i);
  if (!valid.length || !active.length) return null;
  const XW = new Int32Array(w + 2 * PR), YW = new Int32Array(h + 2 * PR);
  for (let i = 0; i < XW.length; i++) XW[i] = (i - PR + w * 4) % w;
  for (let i = 0; i < YW.length; i++) YW[i] = (i - PR + h * 4) % h;
  const wx = x => (x % w + w) % w, wy = y => (y % h + h) % h;

  function dist(px, py, qx, qy, best) {
    let d = 0;
    for (let dy = 0; dy <= 2 * PR; dy++) {
      const rp = YW[py + dy] * w, rq = YW[qy + dy] * w;
      for (let dx = 0; dx <= 2 * PR; dx++) {
        const a = (rp + XW[px + dx]) * 4, b = (rq + XW[qx + dx]) * 4;
        const e0 = img[a] - img[b], e1 = img[a + 1] - img[b + 1], e2 = img[a + 2] - img[b + 2], e3 = img[a + 3] - img[b + 3];
        d += e0 * e0 + e1 * e1 + e2 * e2 + e3 * e3;
      }
      if (d >= best) return d;
    }
    return d;
  }
  const randomValid = () => valid[Math.floor(rnd() * valid.length)];

  // Start: the coarse field scaled up, or random sources at the coarsest level.
  const nnx = new Int32Array(n), nny = new Int32Array(n), nnd = new Float32Array(n);
  for (const p of active) {
    const px = p % w, py = (p / w) | 0;
    let q = -1;
    if (prev) {
      const pi = Math.min(py >> 1, prev.h - 1) * prev.w + Math.min(px >> 1, prev.w - 1);
      if (prev.near[pi]) {
        const qx = wx(prev.nnx[pi] * 2 + (px & 1)), qy = wy(prev.nny[pi] * 2 + (py & 1));
        if (!near[qy * w + qx]) q = qy * w + qx;
      }
    }
    if (q < 0) q = randomValid();
    nnx[p] = q % w; nny[p] = (q / w) | 0;
    nnd[p] = dist(px, py, nnx[p], nny[p], Infinity);
  }

  function search(forward) {
    const step = forward ? 1 : -1, m = active.length;
    for (let k = forward ? 0 : m - 1; k >= 0 && k < m; k += step) {
      const p = active[k], px = p % w, py = (p / w) | 0;
      let bx = nnx[p], by = nny[p], bd = nnd[p];
      // propagation: the neighbour's match, shifted back by one pixel
      for (let t = 0; t < 2; t++) {
        const ox = t === 0 ? -step : 0, oy = t === 0 ? 0 : -step;
        const nb = wy(py + oy) * w + wx(px + ox);
        if (!near[nb]) continue;
        const cx = wx(nnx[nb] - ox), cy = wy(nny[nb] - oy);
        if (near[cy * w + cx]) continue;
        const d = dist(px, py, cx, cy, bd);
        if (d < bd) { bd = d; bx = cx; by = cy; }
      }
      // random search in shrinking windows around the best match
      for (let rad = Math.max(w, h) / 2; rad >= 1; rad *= .5) {
        const cx = wx(bx + Math.round((rnd() * 2 - 1) * rad)), cy = wy(by + Math.round((rnd() * 2 - 1) * rad));
        if (near[cy * w + cx]) continue;
        const d = dist(px, py, cx, cy, bd);
        if (d < bd) { bd = d; bx = cx; by = cy; }
      }
      nnx[p] = bx; nny[p] = by; nnd[p] = bd;
    }
  }

  // Each hole pixel: weighted average of what the overlapping patches' matches say it is.
  // Good matches count far more than poor ones, which keeps the result from going soft;
  // `sharp` (the last pass) makes it nearly the single best match's word.
  // Sources never touch the hole, so pixels can be written in place.
  function vote(sharp) {
    const sample = [];
    for (let i = 0; i < Math.min(active.length, 4000); i++) sample.push(nnd[active[Math.floor(rnd() * active.length)]]);
    sample.sort((a, b) => a - b);
    const sig = (sharp ? .15 : .5) * (sample[Math.floor(sample.length * .25)] || 1) + 1e-6;
    const wt = new Float32Array(n);
    for (const p of active) wt[p] = Math.exp(-Math.min(80, nnd[p] / sig));
    for (let i = 0; i < n; i++) {
      if (!hole[i]) continue;
      const x = i % w, y = (i / w) | 0;
      let r = 0, g = 0, b = 0, a = 0, ws = 0;
      for (let dy = -PR; dy <= PR; dy++) for (let dx = -PR; dx <= PR; dx++) {
        const p = YW[y - dy + PR] * w + XW[x - dx + PR], k = wt[p];
        const s = (YW[nny[p] + dy + PR] * w + XW[nnx[p] + dx + PR]) * 4;
        r += img[s] * k; g += img[s + 1] * k; b += img[s + 2] * k; a += img[s + 3] * k; ws += k;
      }
      if (ws > 0) { img[i * 4] = r / ws; img[i * 4 + 1] = g / ws; img[i * 4 + 2] = b / ws; img[i * 4 + 3] = a / ws; }
    }
  }

  if (prev) vote(false);
  for (let it = 0; it < iterations; it++) {
    search(true);
    search(false);
    vote(finest && it === iterations - 1);
    for (const p of active) nnd[p] = dist(p % w, (p / w) | 0, nnx[p], nny[p], Infinity);
  }
  return { w, h, near, nnx, nny };
}

// data: RGBA bytes (w × h), hole: 1 where pixels should be synthesized.
export function heal(w, h, data, hole, levels = 3) {
  seed = 0x9E3779B9;                            // same input, same output
  const img = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) img[i] = data[i];
  const pyr = [{ w, h, img, hole }];
  while (pyr.length <= levels) {
    const l = pyr[pyr.length - 1];
    if (l.w < 64 || l.h < 64) break;
    pyr.push(half(l.img, l.hole, l.w, l.h));
  }
  let prev = null;
  for (let L = pyr.length - 1; L >= 0; L--) prev = level(pyr[L], prev, L === 0 ? 3 : 4, L === 0) || prev;
  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < w * h; i++) if (hole[i]) for (let c = 0; c < 4; c++) out[i * 4 + c] = img[i * 4 + c];
  return out;
}
