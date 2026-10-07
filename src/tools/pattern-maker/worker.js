// Pattern Maker worker: draws the pattern on an OffscreenCanvas off the main thread
// (pattern.js) and writes the file.
//
// Messages in:
//   { type: 'render', seq, g, layers }     replies { type: 'result', seq, S, data } (RGBA bytes)
//   { type: 'thumbs', seq, items, size }   small previews of presets; replies { type: 'thumbs', seq, images }
//   { type: 'encode', seq, format, linear } the last result as a grayscale TGA or PNG, linear: sRGB → linear values
//   { type: 'pixels', seq }                the last result as RGBA bytes
import { render } from './pattern.js';
import { encodePNG, encodeTGA } from '../../core/codecs.js';
import { toLinear } from '../../core/colorspace.js';

const canvases = new Map();       // size -> 2D context
let last = null;                  // { S, data }

function context(S) {
  let ctx = canvases.get(S);
  if (!ctx) {
    if (typeof OffscreenCanvas === 'undefined') throw new Error('this browser cannot draw in a worker; try an up-to-date Chrome, Edge, Firefox or Safari');
    // drawn on the CPU: measured faster than a GPU canvas once the pixels are read back
    ctx = new OffscreenCanvas(S, S).getContext('2d', { alpha: false, willReadFrequently: true });
    // keep the thumbnail canvas and the current one only
    for (const k of canvases.keys()) if (k > 256) canvases.delete(k);
    canvases.set(S, ctx);
  }
  return ctx;
}

self.onmessage = async ({ data: m }) => {
  try {
    switch (m.type) {
      case 'render': {
        const S = m.g.size, data = render(context(S), S, m.g, m.layers);
        last = { S, data };
        const copy = data.slice();
        self.postMessage({ type: 'result', seq: m.seq, S, data: copy }, [copy.buffer]);
        break;
      }
      case 'thumbs': {
        const S = m.size, images = m.items.map(({ g, layers }) => render(context(S), S, { ...g, size: S }, layers).slice());
        self.postMessage({ type: 'thumbs', seq: m.seq, images }, images.map(d => d.buffer));
        break;
      }
      case 'pixels': {
        const copy = last.data.slice();
        self.postMessage({ type: 'pixels', seq: m.seq, W: last.S, H: last.S, data: copy }, [copy.buffer]);
        break;
      }
      case 'encode': {
        const { S, data } = last, px = new Uint8Array(S * S);
        for (let i = 0; i < px.length; i++) px[i] = data[i * 4];
        if (m.linear) toLinear(px, 1);
        const img = { W: S, H: S, px, ch: 1 };                // grayscale file
        const blob = m.format === 'png' ? await encodePNG(img) : encodeTGA(img);
        self.postMessage({ type: 'encoded', seq: m.seq, blob });
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: 'error', op: m.type, seq: m.seq, message: String(err && err.message || err) });
  }
};
