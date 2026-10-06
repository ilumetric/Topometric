// Pattern Maker renderer: draws a stack of shape layers on a 2D canvas (an OffscreenCanvas
// in the worker). Positions and sizes are fractions of the texture, so a pattern looks the
// same at every resolution. Each shape is drawn again shifted by the texture size wherever
// it crosses an edge, so the result always tiles.
//
// Every layer has its own random stream (global seed × layer seed), and every shape gets a
// sub-seed for its own details, so changing one shape setting doesn't reshuffle the layout.

export const TYPES = {
  shards: 'Shards',
  strokes: 'Strokes',
  circles: 'Circles',
  halftone: 'Halftone',
  lines: 'Lines',
};

// Settings every layer has.
export const COMMON = {
  on: true, seed: 1,
  count: 60, spread: 'random', sizeMin: .05, sizeMax: .2, bias: 0, largeFirst: true,
  angle: 0, jitter: 1,
  toneMin: .3, toneMax: .7, opacity: 1, blend: 'normal',
};

// Settings of each layer type; they override COMMON where both have a value.
export const TYPE_DEFAULTS = {
  shards: { count: 120, sizeMin: .04, sizeMax: .22, sides: 4, irregular: .6, stretch: 2.5, gradients: .15 },
  strokes: { count: 120, sizeMin: .06, sizeMax: .18, stretch: 4, bend: .3, taper: .3, round: .7, wobble: .2, streaks: 0 },
  circles: { count: 80, sizeMin: .02, sizeMax: .2, bias: -.4, stretch: 1, satellites: 0, satSize: .2, satContrast: -.3 },
  halftone: { count: 10, sizeMin: .12, sizeMax: .28, dotSpacing: .012, dotSize: .75, falloff: .6, rough: .5, breakup: .15, angle: 45, jitter: 0 },
  lines: { count: 8, sizeMin: .15, sizeMax: .35, lineMode: 'straight', lines: 8, lineGap: .012, lineFill: .45, ragged: .4, arcSpan: 80, roundCaps: false, angle: 45, jitter: .1 },
};

export function newLayer(type, over) {
  return { ...COMMON, ...TYPE_DEFAULTS[type], type, seed: (Math.random() * 1e6) | 0, ...over };
}

const BLEND = { normal: 'source-over', lighten: 'lighten', darken: 'darken', overlay: 'overlay', multiply: 'multiply', screen: 'screen' };
const TAU = Math.PI * 2;
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const gray = t => { const v = Math.round(clamp01(t) * 255); return `rgb(${v},${v},${v})`; };

function mulberry32(a) {
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const mix = (a, b) => (Math.imul(a ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul(b + 0x632BE5AB, 0xC2B2AE35)) >>> 0;

// Draws `draw` at (x, y) rotated by `a`, and again shifted by ±S wherever the shape's
// bounding circle (radius `rad`) crosses an edge.
function place(ctx, S, x, y, a, rad, draw) {
  const c = Math.cos(a), s = Math.sin(a);
  for (let i = -1; i <= 1; i++) {
    const X = x + i * S;
    if (X + rad < 0 || X - rad > S) continue;
    for (let j = -1; j <= 1; j++) {
      const Y = y + j * S;
      if (Y + rad < 0 || Y - rad > S) continue;
      ctx.setTransform(c, s, -s, c, X, Y);
      draw();
    }
  }
}

/* ── Shapes: each draws one item in its own coordinates (centre at 0, 0, unrotated) ── */
const SHAPES = {
  // Angular polygons: shards, chips and rectangles (4 sides, no irregularity).
  shards(ctx, S, L, it, r) {
    const n = Math.max(3, Math.round(L.sides)), hs = it.size / 2, st = L.stretch, irr = L.irregular;
    const path = new Path2D();
    for (let k = 0; k < n; k++) {
      const th = (k + .5 + (r() - .5) * irr * .9) * TAU / n, rad = hs * (1 - irr * .6 * r());
      path[k ? 'lineTo' : 'moveTo'](Math.cos(th) * rad, Math.sin(th) * rad / st);
    }
    path.closePath();
    let fill = gray(it.tone);
    const grad = r() < L.gradients, dir = r() * TAU, other = clamp01(it.tone + (r() < .5 ? -1 : 1) * (.3 + .4 * r()));
    place(ctx, S, it.x, it.y, it.a, hs, () => {
      if (grad) {
        const gx = Math.cos(dir) * hs, gy = Math.sin(dir) * hs / st;
        fill = ctx.createLinearGradient(-gx, -gy, gx, gy);
        fill.addColorStop(0, gray(it.tone));
        fill.addColorStop(1, gray(other));
      }
      ctx.fillStyle = fill;
      ctx.fill(path);
    });
  },

  // Brush strokes and bars: a bent centre line with a width profile (taper, wobble, round caps).
  strokes(ctx, S, L, it, r) {
    const len = it.size, w = len / L.stretch / 2, bend = L.bend * (r() * 2 - 1) * len * .35;
    const p1 = r() * TAU, p2 = r() * TAU, tail = r() < .5, N = 32;
    const cx = [], cy = [], nx = [], ny = [], hw = [];
    for (let i = 0; i <= N; i++) {
      const t = (1 - Math.cos(Math.PI * i / N)) / 2;            // denser near the ends, for round caps
      const u = 2 * t - 1, dx = len, dy = -2 * bend * u, d = Math.hypot(dx, dy);
      cx.push((t - .5) * len); cy.push(bend * (1 - u * u));
      nx.push(-dy / d); ny.push(dx / d);
      let h = w * (1 - L.taper * (tail ? t : 1 - t)) * (1 + L.wobble * .4 * (Math.sin(t * 10.7 + p1) * .6 + Math.sin(t * 19.5 + p2) * .4));
      const e = Math.min(t, 1 - t) * len, rc = L.round * w;
      if (rc > 0 && e < rc) h *= Math.sqrt(Math.max(0, 1 - (1 - e / rc) ** 2));
      hw.push(Math.max(0, h));
    }
    const path = new Path2D();
    for (let i = 0; i <= N; i++) path[i ? 'lineTo' : 'moveTo'](cx[i] + nx[i] * hw[i], cy[i] + ny[i] * hw[i]);
    for (let i = N; i >= 0; i--) path.lineTo(cx[i] - nx[i] * hw[i], cy[i] - ny[i] * hw[i]);
    path.closePath();
    // streaks: thin lines along the stroke, a shade lighter or darker, like bristle marks
    const streaks = [];
    for (let k = 0, m = L.streaks > 0 ? 3 + Math.floor(r() * 6) : 0; k < m; k++) {
      const v = (r() * 2 - 1) * .9, sp = new Path2D();
      for (let i = 0; i <= N; i++) sp[i ? 'lineTo' : 'moveTo'](cx[i] + nx[i] * hw[i] * v, cy[i] + ny[i] * hw[i] * v);
      streaks.push({ path: sp, width: w * (.04 + .1 * r()), tone: gray(it.tone + (r() - .5) * .5), alpha: L.streaks * (.4 + .6 * r()) });
    }
    const fill = gray(it.tone);
    place(ctx, S, it.x, it.y, it.a, len / 2 + Math.abs(bend) + w, () => {
      ctx.fillStyle = fill;
      ctx.fill(path);
      if (!streaks.length) return;
      ctx.save();
      ctx.clip(path);
      for (const s of streaks) {
        ctx.globalAlpha = L.opacity * s.alpha;
        ctx.lineWidth = s.width;
        ctx.strokeStyle = s.tone;
        ctx.stroke(s.path);
      }
      ctx.restore();
    });
  },

  // Circles and ellipses, optionally with smaller spots inside.
  circles(ctx, S, L, it, r) {
    const rx = it.size / 2, ry = rx / L.stretch, path = new Path2D();
    path.ellipse(0, 0, rx, ry, 0, 0, TAU);
    const m = Math.round(L.satellites * (.5 + r())), sat = new Path2D();
    for (let k = 0; k < m; k++) {
      const a = r() * TAU, d = Math.sqrt(r()) * .85, sr = rx * L.satSize * (.35 + .65 * r());
      const x = Math.cos(a) * d * rx, y = Math.sin(a) * d * ry;
      sat.moveTo(x + sr, y);
      sat.ellipse(x, y, sr, sr * (.75 + .25 * r()), r() * Math.PI, 0, TAU);
    }
    const fill = gray(it.tone), satFill = gray(it.tone + L.satContrast * (.6 + .4 * r()));
    place(ctx, S, it.x, it.y, it.a, rx * 1.2, () => {
      ctx.fillStyle = fill;
      ctx.fill(path);
      if (m) { ctx.fillStyle = satFill; ctx.fill(sat); }
    });
  },

  // A patch of halftone dots: a blob that fades out towards its rough edge.
  halftone(ctx, S, L, it, r) {
    const R = it.size / 2, sp = Math.max(1.5, L.dotSpacing * S), rough = L.rough * .45;
    const h = [[2, r() * TAU, r()], [3, r() * TAU, r()], [5, r() * TAU, r()]];
    const norm = h.reduce((s, x) => s + x[2], 0) || 1;
    const edge = th => R * (1 + rough * h.reduce((s, [k, ph, amp]) => s + amp * Math.sin(k * th + ph), 0) / norm);
    const reach = R * (1 + rough), m = Math.ceil(reach / sp), path = new Path2D();
    for (let j = -m; j <= m; j++) for (let i = -m; i <= m; i++) {
      const x = i * sp, y = j * sp, d = Math.hypot(x, y);
      if (d >= reach) continue;
      const q = d / edge(Math.atan2(y, x));
      if (q >= 1) continue;
      let f = L.falloff > 0 ? Math.min(1, (1 - q) / L.falloff) : 1;
      if (L.breakup > 0) f *= 1 - L.breakup * r();
      const dr = sp * .5 * L.dotSize * Math.sqrt(f);
      if (dr < .3) continue;
      path.moveTo(x + dr, y);
      path.arc(x, y, dr, 0, TAU);
    }
    const fill = gray(it.tone);
    place(ctx, S, it.x, it.y, it.a, reach + sp, () => { ctx.fillStyle = fill; ctx.fill(path); });
  },

  // A bundle of parallel lines: straight hatching or concentric arcs.
  lines(ctx, S, L, it, r) {
    const n = Math.max(1, Math.round(L.lines)), sp = Math.max(1, L.lineGap * S), lw = Math.max(.5, sp * L.lineFill);
    const path = new Path2D();
    let rad;
    if (L.lineMode === 'arc') {
      const R0 = it.size / 2, span = L.arcSpan * Math.PI / 180;
      for (let k = 0; k < n; k++) {
        const rk = R0 + (k - (n - 1) / 2) * sp;
        if (rk <= lw) continue;
        const s0 = -span / 2 + L.ragged * r() * span * .3, s1 = span / 2 - L.ragged * r() * span * .3;
        path.moveTo(rk * Math.cos(s0), rk * Math.sin(s0));
        path.arc(0, 0, rk, s0, s1);
      }
      rad = R0 + n * sp / 2 + lw;
    } else {
      const len = it.size;
      for (let k = 0; k < n; k++) {
        const y = (k - (n - 1) / 2) * sp;
        path.moveTo(-len / 2 + L.ragged * r() * len * .45, y);
        path.lineTo(len / 2 - L.ragged * r() * len * .45, y);
      }
      rad = Math.hypot(len / 2, n * sp / 2) + lw;
    }
    const stroke = gray(it.tone);
    place(ctx, S, it.x, it.y, it.a, rad, () => {
      ctx.lineWidth = lw;
      ctx.lineCap = L.roundCaps ? 'round' : 'butt';
      ctx.strokeStyle = stroke;
      ctx.stroke(path);
    });
  },
};

function drawLayer(ctx, S, L, seed) {
  const rnd = mulberry32(seed), n = Math.max(0, Math.round(L.count)), items = [];
  const lo = Math.min(L.sizeMin, L.sizeMax), hi = Math.max(L.sizeMin, L.sizeMax), pw = Math.pow(4, -L.bias);
  const cols = Math.max(1, Math.round(Math.sqrt(n) * (L.spread === 'grid' ? 1 : 1.5)));
  const rows = Math.max(1, Math.ceil(n / cols));
  for (let i = 0; i < n; i++) {
    let x = rnd(), y = rnd();
    const jx = rnd() - .5, jy = rnd() - .5;
    if (L.spread === 'grid') { x = (i % cols + .5 + jx * .8) / cols; y = (Math.floor(i / cols) + .5 + jy * .8) / rows; }
    else if (L.spread === 'columns') x = (i % cols + .5 + jx * .5) / cols;
    else if (L.spread === 'rows') y = (i % cols + .5 + jy * .5) / cols;
    items.push({
      x: (x - Math.floor(x)) * S, y: (y - Math.floor(y)) * S,
      size: (lo + (hi - lo) * Math.pow(rnd(), pw)) * S,
      a: (L.angle + (rnd() * 2 - 1) * L.jitter * 90) * Math.PI / 180,
      tone: L.toneMin + (L.toneMax - L.toneMin) * rnd(),
      seed: (rnd() * 4294967296) >>> 0,
    });
  }
  if (L.largeFirst) items.sort((a, b) => b.size - a.size);
  ctx.globalCompositeOperation = BLEND[L.blend] || 'source-over';
  const draw = SHAPES[L.type];
  for (const it of items) {
    ctx.globalAlpha = L.opacity;
    draw(ctx, S, L, it, mulberry32(it.seed));
  }
}

// Draws the pattern and returns its RGBA pixels with levels, invert and grain applied.
export function render(ctx, S, g, layers) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = gray(g.bg);
  ctx.fillRect(0, 0, S, S);
  for (const L of layers) if (L.on && SHAPES[L.type]) drawLayer(ctx, S, L, mix(g.seed >>> 0, L.seed >>> 0));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  const data = ctx.getImageData(0, 0, S, S).data;
  const lo = Math.min(g.black, g.white - .004), k = 1 / Math.max(.004, g.white - lo);
  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v++) { const t = clamp01((v / 255 - lo) * k); lut[v] = (g.invert ? 1 - t : t) * 255; }
  // per-pixel noise is independent from pixel to pixel, so it tiles as it is
  const grain = g.grain * 255, rnd = mulberry32(mix(g.seed >>> 0, 0x5EED));
  for (let i = 0; i < data.length; i += 4) {
    let v = lut[data[i]];
    if (grain) v += (rnd() + rnd() - 1) * grain;
    data[i] = data[i + 1] = data[i + 2] = v;     // Uint8ClampedArray rounds and clamps
    data[i + 3] = 255;
  }
  return data;
}
