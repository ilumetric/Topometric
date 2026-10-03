// Channel Packer worker: keeps the decoded textures and does all full-size pixel work
// (resampling, packing, encoding) off the main thread, so the UI stays responsive on 4K+ maps.
//
// Messages in:
//   { type: 'set', id, w, h, data }        add or replace a texture (RGBA bytes, buffer is transferred)
//   { type: 'remove', id }
//   { type: 'compose', seq, job }          pack channels, reply with a small preview
//   { type: 'encode', seq, job, view, format }  pack (if needed) and encode a file
//   { type: 'pixels', seq, job }          pack (if needed) and reply with the full RGBA bytes
// A job is { W, H, alpha, chans: [4 × ({ id, ch, inv } | { value })] }.
import { encodePNG, encodeTGA } from '../../core/codecs.js';
import { resampleChannel } from '../../core/resample.js';

const PREVIEW_MAX = 512;
const inputs = new Map();   // id -> { w, h, data, planes: Map("WxH:c" -> Uint8ClampedArray) }
let last = null;            // last packed result: { key, W, H, alpha, data }

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
      case 'pixels': {
        const { W, H, data } = compose(m.job), copy = data.slice();
        self.postMessage({ type: 'pixels', seq: m.seq, W, H, data: copy }, [copy.buffer]);
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: 'error', op: m.type, seq: m.seq, message: String(err && err.message || err) });
  }
};
