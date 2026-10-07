// Pattern Maker renderer: draws a stack of shape layers on a 2D canvas (an OffscreenCanvas
// in the worker). Positions and sizes are fractions of the texture, so a pattern looks the
// same at every resolution. Each shape is drawn again shifted by the texture size wherever
// it crosses an edge, so the result always tiles.
//
// Every layer has its own random stream (global seed × layer seed), and every shape gets a
// sub-seed for its own details, so changing one shape setting doesn't reshuffle the layout.
//
// Strokes and lines can also be laid in courses like bricks or boards, and the Wood layer
// is not made of shapes at all: it is a grain field computed per pixel from tileable noise.

export const TYPES = {
  shards: 'Shards',
  strokes: 'Strokes',
  circles: 'Circles',
  halftone: 'Halftone',
  lines: 'Lines',
  wood: 'Wood',
};

// Layer types that can be laid out as bricks or boards.
export const BRICK_TYPES = ['strokes', 'lines'];
const BRICKS = { brickRows: 8, brickCols: 4, brickGap: .008, brickOffset: .5, brickRandom: 0, brickVary: 0, brickVertical: false };

// Settings every layer has.
export const COMMON = {
  on: true, seed: 1,
  count: 60, spread: 'random', sizeMin: .05, sizeMax: .2, bias: 0, largeFirst: true,
  angle: 0, jitter: 1,
  toneMin: .3, toneMax: .7, opacity: 1, blend: 'normal',
  gradients: 0, gradAmount: .4, gradBoth: false, gradDir: 'random',
};

// Gradient fills each type offers, laid out in the shape's own frame:
//   along   from one end of the shape to the other (random which end)
//   across  from one side to the other
//   linear  in a random direction per shape
//   radial  from the middle to the edge
//   spot    from an off-centre highlight; the offset points the same way on every shape
export const GRAD_MODES = {
  shards: ['linear', 'along', 'radial'],
  strokes: ['along', 'across', 'radial'],
  circles: ['radial', 'spot', 'linear'],
  halftone: ['radial', 'linear'],
  lines: ['along', 'across', 'radial'],
  wood: [],
};

// Settings of each layer type; they override COMMON where both have a value.
export const TYPE_DEFAULTS = {
  shards: { count: 120, sizeMin: .04, sizeMax: .22, sides: 4, irregular: .6, stretch: 2.5, gradients: .15, gradAmount: .5, gradBoth: true, gradMode: 'linear' },
  strokes: { ...BRICKS, gradMode: 'along', gradDir: 'fixed', tips: 'random', count: 120, sizeMin: .06, sizeMax: .18, stretch: 4, bend: .3, taper: .3, round: .7, wobble: .2, streaks: 0 },
  circles: { gradMode: 'radial', count: 80, sizeMin: .02, sizeMax: .2, bias: -.4, stretch: 1, satellites: 0, satSize: .2, satContrast: -.3 },
  halftone: { gradMode: 'radial', count: 10, sizeMin: .12, sizeMax: .28, dotSpacing: .012, dotSize: .75, falloff: .6, rough: .5, breakup: .15, angle: 45, jitter: 0 },
  lines: { ...BRICKS, gradMode: 'along', count: 8, sizeMin: .15, sizeMax: .35, lineMode: 'straight', lines: 8, lineGap: .012, lineFill: .45, ragged: .4, arcSpan: 80, roundCaps: false, angle: 45, jitter: .1 },
  wood: { rings: 14, warp: .35, warpScale: 3, detail: .35, sharpness: .55, fibers: .35, knots: 2, knotSize: .05, knotStrength: .7, woodVertical: false, toneMin: .25, toneMax: .7 },
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

// Fill for one shape: its tone, or with probability `gradients` a gradient from its tone to
// tone ± gradAmount, laid out by the shape's size in its own frame:
//   g = { hx, hy }  half extents along and across the shape, r: radius for radial fills
//   g.rev           the shape's start is at +x (a stroke whose tip points the other way)
// Along and across start at the shape's start (gradDir 'fixed': a stroke's base, so the end
// tone lands on the tip) or at a random end of each shape (gradDir 'random').
//   g.arc = { s0, span, rIn, rOut }  arcs: "along" follows the arc, "across" goes ring to ring
// Uses its own random stream, so gradient settings never move the shapes and shape
// settings never reshuffle which shapes get a gradient.
function shade(ctx, L, it, g) {
  const r = mulberry32(it.seed ^ 0x5BD1E995);
  const on = r() < L.gradients, coin = r() < .5, dir = r() * TAU, sign = L.gradBoth && r() < .5 ? -1 : 1, k = .7 + .3 * r();
  const base = gray(it.tone);
  if (!on || !L.gradAmount) return base;
  const end = gray(it.tone + sign * L.gradAmount * k), modes = GRAD_MODES[L.type];
  const mode = modes.includes(L.gradMode) ? L.gradMode : modes[0];
  const flip = L.gradDir === 'fixed' ? !!g.rev : coin;
  const [a, b] = flip ? [end, base] : [base, end];
  let fill;
  if (g.arc && mode === 'along' && ctx.createConicGradient) {
    const { s0, span } = g.arc, f = Math.min(1, span / TAU);
    fill = ctx.createConicGradient(s0, 0, 0);
    fill.addColorStop(0, a); fill.addColorStop(f, b); fill.addColorStop(1, b);
    return fill;
  }
  if (g.arc && mode !== 'along') {
    fill = ctx.createRadialGradient(0, 0, g.arc.rIn, 0, 0, g.arc.rOut);
    fill.addColorStop(0, a); fill.addColorStop(1, b);
    return fill;
  }
  if (mode === 'radial') {
    fill = ctx.createRadialGradient(0, 0, 0, 0, 0, g.r);
    fill.addColorStop(0, base); fill.addColorStop(1, end);
  } else if (mode === 'spot') {
    // the highlight sits up and to the left in the texture, whatever the shape's rotation
    const c = Math.cos(-it.a), s = Math.sin(-it.a), wx = -.38 * g.hx, wy = -.38 * g.hy;
    const ox = wx * c - wy * s, oy = wx * s + wy * c;
    fill = ctx.createRadialGradient(ox, oy, 0, ox * .5, oy * .5, g.r * 1.3);
    fill.addColorStop(0, end); fill.addColorStop(1, base);
  } else {
    const [x, y] = mode === 'along' ? [g.hx, 0] : mode === 'across' ? [0, g.hy] : [Math.cos(dir) * g.hx, Math.sin(dir) * g.hy];
    fill = ctx.createLinearGradient(-x, -y, x, y);
    fill.addColorStop(0, a); fill.addColorStop(1, b);
  }
  return fill;
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
    const fill = shade(ctx, L, it, { hx: hs, hy: hs / st, r: hs });
    place(ctx, S, it.x, it.y, it.a, hs, () => {
      ctx.fillStyle = fill;
      ctx.fill(path);
    });
  },

  // Brush strokes and bars: a bent centre line with a width profile (taper, wobble, round caps).
  strokes(ctx, S, L, it, r) {
    const len = it.size, w = (it.wid ?? len / L.stretch) / 2, bend = L.bend * (r() * 2 - 1) * len * .35;
    // the tip (the tapered end) is at +x, so it points along the angle; 'random' turns half around
    const p1 = r() * TAU, p2 = r() * TAU, tail = r() < .5 || L.tips !== 'random', N = 32;
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
    const fill = shade(ctx, L, it, { hx: len / 2, hy: w + Math.abs(bend) / 2, r: len / 2, rev: !tail });
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
    const satFill = gray(it.tone + L.satContrast * (.6 + .4 * r()));
    const fill = shade(ctx, L, it, { hx: rx, hy: ry, r: rx });
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
    const fill = shade(ctx, L, it, { hx: R, hy: R, r: R });
    place(ctx, S, it.x, it.y, it.a, reach + sp, () => { ctx.fillStyle = fill; ctx.fill(path); });
  },

  // A bundle of parallel lines: straight hatching or concentric arcs.
  lines(ctx, S, L, it, r) {
    // laid as bricks, the lines share out the brick's width between them
    const n = Math.max(1, Math.round(L.lines)), sp = Math.max(1, it.wid ? it.wid / n : L.lineGap * S), lw = Math.max(.5, sp * L.lineFill);
    const path = new Path2D();
    let rad, geo;
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
      geo = { r: rad, arc: { s0: -span / 2, span, rIn: Math.max(0, R0 - n * sp / 2 - lw / 2), rOut: rad } };
    } else {
      const len = it.size;
      for (let k = 0; k < n; k++) {
        const y = (k - (n - 1) / 2) * sp;
        path.moveTo(-len / 2 + L.ragged * r() * len * .45, y);
        path.lineTo(len / 2 - L.ragged * r() * len * .45, y);
      }
      rad = Math.hypot(len / 2, n * sp / 2) + lw;
      geo = { hx: len / 2, hy: n * sp / 2 + lw / 2, r: rad };
    }
    const stroke = shade(ctx, L, it, geo);
    place(ctx, S, it.x, it.y, it.a, rad, () => {
      ctx.lineWidth = lw;
      ctx.lineCap = L.roundCaps ? 'round' : 'butt';
      ctx.strokeStyle = stroke;
      ctx.stroke(path);
    });
  },
};

// Shapes scattered by the layer's count, spread and size settings.
function scatter(L, rnd, S) {
  const n = Math.max(0, Math.round(L.count)), items = [];
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
      // angles count counterclockwise, 90° points up (the canvas y axis points down)
      a: -(L.angle + (rnd() * 2 - 1) * L.jitter * 90) * Math.PI / 180,
      tone: L.toneMin + (L.toneMax - L.toneMin) * rnd(),
      seed: (rnd() * 4294967296) >>> 0,
    });
  }
  if (L.largeFirst) items.sort((a, b) => b.size - a.size);
  return items;
}

// Bricks or boards: courses that fill the tile exactly, so the bond repeats seamlessly.
//   brickRows    courses across the tile        brickCols    bricks per course
//   brickGap     joint width, share of the tile brickOffset  shift of each course (0.5: half bond)
//   brickRandom  random extra shift per course  brickVary    random brick lengths (boards)
// The shift per course is rounded to a whole number of steps over the tile, so the last
// course meets the first one with the same bond. Jitter tilts each brick by up to ±5°.
function bricks(L, rnd, S) {
  const rows = Math.max(1, Math.round(L.brickRows)), cols = Math.max(1, Math.round(L.brickCols));
  const rowH = S / rows, gap = L.brickGap * S, step = Math.round(L.brickOffset * rows) / rows;
  const base = L.brickVertical ? -Math.PI / 2 : 0, items = [];
  for (let r = 0; r < rows; r++) {
    const lens = [];
    for (let c = 0; c < cols; c++) lens.push(Math.pow(4, (rnd() * 2 - 1) * L.brickVary));
    const sum = lens.reduce((a, b) => a + b, 0);
    let x = ((r * step + L.brickRandom * rnd()) % 1) * S / cols;
    for (let c = 0; c < cols; c++) {
      const len = lens[c] / sum * S, mid = (x + len / 2) % S, across = (r + .5) * rowH;
      x += len;
      items.push({
        x: L.brickVertical ? across : mid, y: L.brickVertical ? mid : across,
        size: Math.max(1, len - gap), wid: Math.max(1, rowH - gap),
        a: base - (rnd() * 2 - 1) * L.jitter * 5 * Math.PI / 180,
        tone: L.toneMin + (L.toneMax - L.toneMin) * rnd(),
        seed: (rnd() * 4294967296) >>> 0,
      });
    }
  }
  return items;
}

function drawLayer(ctx, S, L, seed) {
  ctx.globalCompositeOperation = BLEND[L.blend] || 'source-over';
  if (L.type === 'wood') { drawWood(ctx, S, L, seed); return; }
  const rnd = mulberry32(seed);
  const items = L.spread === 'bricks' && BRICK_TYPES.includes(L.type) ? bricks(L, rnd, S) : scatter(L, rnd, S);
  const draw = SHAPES[L.type];
  for (const it of items) {
    ctx.globalAlpha = L.opacity;
    draw(ctx, S, L, it, mulberry32(it.seed));
  }
}

/* ── Wood ──
   A grain field: each pixel's ring coordinate is f = v·rings + warp, where v runs across the
   grain. Across the tile f grows by exactly `rings`, and the warp is periodic noise, so the
   rings line up at every edge. Knots push the rings aside into closed eyes. The tone follows
   the ring profile: light earlywood darkening into a thin latewood line, plus fibers — fine
   streaks that follow the rings. */

// Periodic value noise on an nx × ny lattice: f(u, v) for u, v in [0, 1), wrapping at 1.
function tileNoise(rnd, nx, ny) {
  const g = new Float32Array(nx * ny);
  for (let i = 0; i < g.length; i++) g[i] = rnd() * 2 - 1;
  return (u, v) => {
    const x = u * nx, y = v * ny, xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = (xi % nx + nx) % nx, y0 = (yi % ny + ny) % ny, x1 = (x0 + 1) % nx, y1 = (y0 + 1) % ny;
    const a = g[y0 * nx + x0], b = g[y0 * nx + x1], c = g[y1 * nx + x0], d = g[y1 * nx + x1];
    return a + (b - a) * fx + (c - a + (a - b + d - c) * fx) * fy;
  };
}

const woodCanvas = new Map();      // size -> scratch canvas the field is drawn on

function drawWood(ctx, S, L, seed) {
  const rnd = mulberry32(seed), rings = Math.max(1, Math.round(L.rings)), ws = Math.max(1, Math.round(L.warpScale));
  // the warp varies slowly along the grain and faster across it, so the rings run long
  const big = tileNoise(rnd, ws, ws * 3), small = tileNoise(rnd, ws * 3, ws * 9);
  const fibers = tileNoise(rnd, 1, rings * 24);
  const A = L.warp * .25 * rings, D = L.detail * .35;

  // the warp is smooth: evaluate it on a coarse grid and interpolate per pixel
  const G = Math.min(S, 256), grid = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) grid[j * G + i] = big(i / G, j / G) + D * small(i / G, j / G);

  // f in grain space: x along the grain, y across it
  const f = new Float32Array(S * S), k = G / S;
  for (let y = 0; y < S; y++) {
    const gy = y * k, j0 = Math.floor(gy), fy = gy - j0, r0 = j0 % G * G, r1 = (j0 + 1) % G * G, base = y / S * rings;
    for (let x = 0; x < S; x++) {
      const gx = x * k, i0 = Math.floor(gx), fx = gx - i0, i1 = (i0 + 1) % G;
      const a = grid[r0 + i0], b = grid[r0 + i1], c = grid[r1 + i0], d = grid[r1 + i1];
      f[y * S + x] = base + A * (a + (b - a) * fx + (c - a + (a - b + d - c) * fx) * fy);
    }
  }

  // knots: a bump in f makes the rings close around it; the middle gets darker
  const dark = new Float32Array(L.knots > 0 ? S * S : 0);
  for (let n = 0, m = Math.round(L.knots); n < m; n++) {
    const kx = rnd() * S, ky = rnd() * S, rk = L.knotSize * (.6 + .8 * rnd()) * S, sx = rk * 2.2;
    const lift = (rnd() < .5 ? -1 : 1) * L.knotStrength * rk / S * rings * 4;
    const bx = Math.ceil(sx * 3), by = Math.ceil(rk * 3);
    for (let dy = -by; dy <= by; dy++) {
      const y = ((Math.round(ky) + dy) % S + S) % S, qy = dy / rk;
      for (let dx = -bx; dx <= bx; dx++) {
        const x = ((Math.round(kx) + dx) % S + S) % S, qx = dx / sx, e = Math.exp(-(qx * qx + qy * qy));
        if (e < .002) continue;
        f[y * S + x] += lift * e;
        dark[y * S + x] += L.knotStrength * e * e * e;              // a small, soft core
      }
    }
  }

  let c = woodCanvas.get(S);
  if (!c) { woodCanvas.clear(); c = new OffscreenCanvas(S, S); woodCanvas.set(S, c); }
  const wctx = c.getContext('2d'), img = wctx.createImageData(S, S), px = img.data;
  const hi = L.toneMax * 255, span = (L.toneMin - L.toneMax) * 255, power = 1 + L.sharpness * 10, fib = L.fibers * 40;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, v = f[i], t = v - Math.floor(v);
    let g = hi + span * Math.pow(t, power) + fib * fibers(0, v / rings);
    if (dark.length) g += span * Math.min(1, dark[i]) * .45;
    const o = (L.woodVertical ? x * S + y : i) * 4;
    px[o] = px[o + 1] = px[o + 2] = g;
    px[o + 3] = 255;
  }
  wctx.putImageData(img, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = L.opacity;
  ctx.drawImage(c, 0, 0);
}

// Draws the pattern and returns its RGBA pixels with levels, invert and grain applied.
export function render(ctx, S, g, layers) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = gray(g.bg);
  ctx.fillRect(0, 0, S, S);
  for (const L of layers) if (L.on && (SHAPES[L.type] || L.type === 'wood')) drawLayer(ctx, S, L, mix(g.seed >>> 0, L.seed >>> 0));
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
