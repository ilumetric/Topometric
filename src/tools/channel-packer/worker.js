// Channel Packer worker: keeps the decoded textures and does all full-size pixel work
// (resampling, packing, encoding) off the main thread, so the UI stays responsive on 4K+ maps.
//
// Messages in:
//   { type: 'set', id, w, h, data }        add or replace a texture (RGBA bytes, buffer is transferred)
//   { type: 'remove', id }
//   { type: 'compose', seq, job }          pack channels, reply with a small preview
//   { type: 'encode', seq, job, view, format }  pack (if needed) and encode a file
// A job is { W, H, alpha, chans: [4 × ({ id, ch, inv } | { value })] }.
import { encodePNG, encodeTGA } from '../../core/codecs.js';

const PREVIEW_MAX = 512;
const inputs = new Map();   // id -> { w, h, data, planes: Map("WxH:c" -> Uint8ClampedArray) }
let last = null;            // last packed result: { key, W, H, alpha, data }

/* ── Resampling, one channel at a time ── */
// Weights for one axis. Downscaling averages the covered area of source pixels exactly;
// upscaling is linear between pixel centers. Stored flat: entries start[d]..start[d+1] belong to pixel d.
function axis(sn, dn) {
  const start = new Int32Array(dn + 1), src = [], wt = [];
  for (let d = 0; d < dn; d++) {
    if (dn < sn) {
      const a = d * sn / dn, b = (d + 1) * sn / dn;
      for (let i = Math.floor(a); i < Math.ceil(b); i++) { src.push(i); wt.push((Math.min(b, i + 1) - Math.max(a, i)) * dn / sn); }
    } else {
      const f = Math.min(sn - 1, Math.max(0, (d + .5) * sn / dn - .5)), i0 = Math.floor(f), t = f - i0;
      src.push(i0); wt.push(1 - t);
      if (t > 0) { src.push(i0 + 1); wt.push(t); }
    }
    start[d + 1] = src.length;
  }
  return { start, src: Int32Array.from(src), wt: Float64Array.from(wt) };
}

function resampleChannel(src, sw, sh, c, dw, dh) {
  const X = axis(sw, dw), Y = axis(sh, dh);
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

// Channel c of an input at W×H. Cached for the current output size only.
function plane(inp, c, W, H) {
  const size = W + 'x' + H, key = size + ':' + c;
  let p = inp.planes.get(key);
  if (!p) {
    for (const k of inp.planes.keys()) if (!k.startsWith(size + ':')) inp.planes.delete(k);
    p = resampleChannel(inp.data, inp.w, inp.h, c, W, H);
    inp.planes.set(key, p);
  }
  return p;
}

/* ── Packing ── */
function compose(job) {
  const key = JSON.stringify(job);
  if (last && last.key === key) return last;
  last = null;                                           // free the old result before allocating
  const { W, H } = job, n = W * H, data = new Uint8ClampedArray(n * 4);
  job.chans.forEach((spec, ch) => {
    const inp = spec.id != null && inputs.get(spec.id);
    if (!inp) {                                          // unlinked: constant value
      const v = spec.value ?? 0;
      for (let i = ch; i < n * 4; i += 4) data[i] = v;
      return;
    }
    const inv = spec.inv;
    if (inp.w === W && inp.h === H) {
      const s = inp.data, sc = spec.ch;
      if (inv) for (let i = 0; i < n; i++) data[i * 4 + ch] = 255 - s[i * 4 + sc];
      else for (let i = 0; i < n; i++) data[i * 4 + ch] = s[i * 4 + sc];
    } else {
      const p = plane(inp, spec.ch, W, H);
      if (inv) for (let i = 0; i < n; i++) data[i * 4 + ch] = 255 - p[i];
      else for (let i = 0; i < n; i++) data[i * 4 + ch] = p[i];
    }
  });
  return last = { key, W, H, alpha: job.alpha, data };
}

// Nearest-pixel thumbnail of the packed result, raw RGBA.
function preview({ W, H, data }) {
  const k = Math.min(1, PREVIEW_MAX / Math.max(W, H));
  const pw = Math.max(1, Math.round(W * k)), ph = Math.max(1, Math.round(H * k));
  const d32 = new Uint32Array(data.buffer), out = new Uint32Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(H - 1, Math.floor((y + .5) * H / ph));
    for (let x = 0; x < pw; x++) out[y * pw + x] = d32[sy * W + Math.min(W - 1, Math.floor((x + .5) * W / pw))];
  }
  return { pw, ph, preview: new Uint8ClampedArray(out.buffer) };
}

// Bytes to write: 1 (one channel as gray), 3 (RGB) or 4 (RGBA) per pixel.
function pixels({ W, H, alpha, data }, view) {
  const n = W * H, one = view !== 'rgb';
  const ch = one ? 1 : alpha ? 4 : 3, px = new Uint8Array(n * ch);
  if (one) { const c = +view; for (let i = 0; i < n; i++) px[i] = data[i * 4 + c]; }
  else if (ch === 4) px.set(data);
  else for (let i = 0, o = 0; i < n; i++, o += 3) { px[o] = data[i * 4]; px[o + 1] = data[i * 4 + 1]; px[o + 2] = data[i * 4 + 2]; }
  return { W, H, px, ch };
}

/* ── Messages ── */
self.onmessage = async ({ data: m }) => {
  try {
    switch (m.type) {
      case 'set':
        inputs.set(m.id, { w: m.w, h: m.h, data: m.data, planes: new Map() });
        last = null;
        break;
      case 'remove':
        inputs.delete(m.id);
        last = null;
        break;
      case 'compose': {
        const r = preview(compose(m.job));
        self.postMessage({ type: 'composed', seq: m.seq, ...r }, [r.preview.buffer]);
        break;
      }
      case 'encode': {
        const img = pixels(compose(m.job), m.view);
        const blob = m.format === 'png' ? await encodePNG(img) : encodeTGA(img);
        self.postMessage({ type: 'encoded', seq: m.seq, blob });
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: 'error', op: m.type, seq: m.seq, message: String(err && err.message || err) });
  }
};
