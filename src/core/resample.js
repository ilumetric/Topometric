// Image resampling shared by the tools' workers.
// Downscaling averages the covered area of source pixels exactly; upscaling is linear
// between pixel centers. With `wrap`, upscaling reads across the opposite edge, so a
// tileable image stays tileable after resizing.

// Weights for one axis. Stored flat: entries start[d]..start[d+1] belong to pixel d.
function axis(sn, dn, wrap) {
  const start = new Int32Array(dn + 1), src = [], wt = [];
  for (let d = 0; d < dn; d++) {
    if (dn < sn) {
      const a = d * sn / dn, b = (d + 1) * sn / dn;
      for (let i = Math.floor(a); i < Math.ceil(b); i++) { src.push(i); wt.push((Math.min(b, i + 1) - Math.max(a, i)) * dn / sn); }
    } else if (wrap) {
      const f = (d + .5) * sn / dn - .5, i0 = Math.floor(f), t = f - i0;
      src.push((i0 % sn + sn) % sn); wt.push(1 - t);
      if (t > 0) { src.push((i0 + 1) % sn); wt.push(t); }
    } else {
      const f = Math.min(sn - 1, Math.max(0, (d + .5) * sn / dn - .5)), i0 = Math.floor(f), t = f - i0;
      src.push(i0); wt.push(1 - t);
      if (t > 0) { src.push(i0 + 1); wt.push(t); }
    }
    start[d + 1] = src.length;
  }
  return { start, src: Int32Array.from(src), wt: Float64Array.from(wt) };
}

// Channel c of an RGBA image, resized to dw × dh. Returns one byte per pixel.
export function resampleChannel(src, sw, sh, c, dw, dh, wrap = false) {
  const X = axis(sw, dw, wrap), Y = axis(sh, dh, wrap);
  const tmp = new Float32Array(dw * sh);                 // horizontal pass
  for (let y = 0; y < sh; y++) {
    const row = y * sw, o = y * dw;
    for (let x = 0; x < dw; x++) {
      let s = 0;
      for (let k = X.start[x], e = X.start[x + 1]; k < e; k++) s += src[(row + X.src[k]) * 4 + c] * X.wt[k];
      tmp[o + x] = s;
    }
  }
  const dst = new Uint8ClampedArray(dw * dh), acc = new Float64Array(dw);
  for (let y = 0; y < dh; y++) {                         // vertical pass
    acc.fill(0);
    for (let k = Y.start[y], e = Y.start[y + 1]; k < e; k++) {
      const r = Y.src[k] * dw, w = Y.wt[k];
      for (let x = 0; x < dw; x++) acc[x] += tmp[r + x] * w;
    }
    dst.set(acc, y * dw);                                // rounds and clamps to 0..255
  }
  return dst;
}

// The whole RGBA image resized to dw × dh.
export function resampleRGBA(src, sw, sh, dw, dh, wrap = false) {
  if (sw === dw && sh === dh) return src.slice();
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let c = 0; c < 4; c++) {
    const p = resampleChannel(src, sw, sh, c, dw, dh, wrap);
    for (let i = 0; i < p.length; i++) out[i * 4 + c] = p[i];
  }
  return out;
}
