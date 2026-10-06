/* Pattern Maker
   Generates stylized, seamlessly tiling grayscale patterns from a stack of shape layers:
   shards, brush strokes and bars, circles, halftone patches and line bundles. The pattern is
   drawn in a worker (pattern.js, worker.js) and shown repeated in the shared zoomable viewer. */
import { el, icon, downloadBlob, isTyping } from '../../core/dom.js';
import { slider, segmented, toggle } from '../../core/controls.js';
import { createViewer } from '../../core/image-viewer.js';
import { sendTo } from '../../core/handoff.js';
import { presetPicker, mergeKnown } from '../../core/presets.js';
import { TYPES, COMMON, TYPE_DEFAULTS, GRAD_MODES, newLayer } from './pattern.js';
import { PRESETS, GLOBAL, fromPreset } from './presets.js';

const STORE_KEY = 'topometric-pattern-maker-v1';
const SIZES = [512, 1024, 2048, 4096];
const THUMB = 128;
const MAX_COUNT = { shards: 600, strokes: 600, circles: 600, halftone: 60, lines: 60 };
// Gradient fills: [button text, tooltip]
const GRAD_LABELS = {
  along: ['Along', 'From one end of the shape to the other'],
  across: ['Across', 'From one side of the shape to the other'],
  linear: ['Linear', 'Straight, in a random direction on each shape'],
  radial: ['Radial', 'From the middle of the shape out to its edge'],
  spot: ['Spot', 'From an off-centre highlight, the same side on every shape'],
};
const DESCRIBE = {
  shards: 'Angular polygons: shards, chips and, with 4 sides and no irregularity, rectangles.',
  strokes: 'Brush strokes with bend, taper and round ends. With no bend, Columns and an angle of 90° they become bars.',
  circles: 'Circles and ellipses, optionally with smaller spots inside.',
  halftone: 'Patches of halftone dots that fade out towards a rough edge.',
  lines: 'Bundles of parallel lines: straight hatching or concentric arcs.',
};

const TEMPLATE = `
  <header class="page-header">
    <div class="container">
      <h1>Pattern Maker</h1>
      <p>Build stylized seamless patterns from layers of shapes, strokes, dots and lines. Everything runs locally — nothing is uploaded.</p>
    </div>
  </header>
  <div class="page-body">
    <div class="container vw-layout">
      <div class="vw-card vw-stage">
        <div class="vw-bar">
          <button type="button" class="btn vw-open" data-ref="dice" title="New random seed for the whole pattern (R)"><span>New seed</span></button>
          <div class="vw-group" role="group" aria-label="Zoom">
            <button type="button" data-ref="fit" title="Fit to view (F)">Fit</button>
            <button type="button" data-ref="one" title="Actual pixels (1)">1:1</button>
            <output data-ref="zoom" aria-live="off">100%</output>
          </div>
          <button type="button" class="vw-toggle" data-ref="tiled" aria-pressed="true" title="Repeat the texture in every direction (T)">Tiled</button>
          <button type="button" class="vw-toggle" data-ref="edges" aria-pressed="false" title="Outline the tile edges (E)">Edges</button>
        </div>
        <div class="vw-view" data-ref="view">
          <canvas data-ref="canvas"></canvas>
          <div class="vw-progress pm-busy" data-ref="progress"></div>
          <p class="vw-msg" data-ref="msg" hidden></p>
        </div>
        <p class="vw-hint">Scroll to zoom, drag to pan, double-click for 1:1. The middle of the fitted view is where four tiles meet.</p>
      </div>
      <div class="vw-panel">
        <div class="vw-card" data-ref="presets"></div>
        <div class="vw-card" data-ref="pattern"></div>
        <div class="vw-card" data-ref="layers"></div>
        <div class="vw-card pm-compact" data-ref="layer"></div>
        <div class="vw-card" data-ref="export"></div>
      </div>
    </div>
  </div>`;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch (_) { return null; }
}
const randomSeed = () => 1 + Math.floor(Math.random() * 999999);

function button(className, text, title, iconName) {
  const b = el('button', className);
  b.type = 'button';
  if (iconName) b.append(icon(iconName));
  if (text) b.append(document.createTextNode(text));
  if (title) { b.title = title; if (!text) b.setAttribute('aria-label', title); }
  return b;
}

export function mount(root, { showToast }) {
  root.innerHTML = TEMPLATE;
  const r = {};
  root.querySelectorAll('[data-ref]').forEach(n => { r[n.dataset.ref] = n; });
  r.dice.prepend(icon('dice'));

  /* ── State ── */
  const saved = load();
  const start = saved?.layers ? saved : fromPreset(PRESETS[0]);
  const g = { ...GLOBAL, ...start.g };
  let layers = start.layers.map(L => ({ ...COMMON, ...TYPE_DEFAULTS[L.type], ...L }));
  let sel = Math.min(saved?.sel ?? layers.length - 1, layers.length - 1);
  const out = { format: 'tga', ...saved?.out };
  let fileName = 'T_Pattern_' + (saved ? 'Custom' : PRESETS[0].name);
  let visible = false, saveTimer = 0;
  const cur = () => layers[sel];
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ g, layers, sel, out })); } catch (_) { } }, 300);
  }

  /* ── Undo: snapshots of the whole pattern, taken when a change is finished ── */
  const snap = () => JSON.stringify({ g, layers, sel });
  let hist = [snap()], hi = 0;
  function commit() {
    const s = snap();
    if (hist[hi] === s) return;
    hist = hist.slice(0, hi + 1);
    hist.push(s);
    if (hist.length > 100) hist.shift();
    hi = hist.length - 1;
  }
  function stepHistory(d) {
    const j = hi + d;
    if (j < 0 || j >= hist.length) return;
    hi = j;
    const s = JSON.parse(hist[hi]);
    Object.assign(g, s.g);
    layers = s.layers;
    sel = s.sel;
    refresh();
  }

  /* ── View ── */
  const gl = r.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false });
  let viewer = null, tex = null, texS = 0, result = null;
  function fail(text) { r.msg.textContent = text; r.msg.hidden = false; }
  try {
    if (!gl) throw new Error('This tool needs WebGL 2. Try an up-to-date Chrome, Edge, Firefox or Safari.');
    viewer = createViewer(gl, r.canvas);
    viewer.tiled = true;
    viewer.onChange = requestDraw;
  } catch (err) { console.error(err); fail(err.message); }
  r.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); fail('The GPU was reset. Reload the page to continue.'); });

  function upload(S, data) {
    if (!gl || gl.isContextLost()) return;
    if (!tex || texS !== S) {
      if (tex) gl.deleteTexture(tex);
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(S)) + 1, gl.RGBA8, S, S);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      texS = S;
    } else gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  let raf = 0;
  function requestDraw() {
    syncZoom();
    if (!raf && visible && viewer) raf = requestAnimationFrame(() => {
      raf = 0;
      if (tex) viewer.draw(tex, tex, 99);
    });
  }
  function syncZoom() {
    if (!viewer) return;
    const z = viewer.zoom * 100;
    r.zoom.textContent = (z >= 10 ? Math.round(z) : z.toFixed(1)) + '%';
    r.one.setAttribute('aria-pressed', Math.abs(viewer.zoom - 1) < 1e-6);
    r.fit.setAttribute('aria-pressed', viewer.fitted);
  }
  r.fit.addEventListener('click', () => viewer?.fit());
  r.one.addEventListener('click', () => viewer?.zoomAt(1));
  function setTiled(on) {
    if (!viewer) return;
    viewer.tiled = on;
    r.tiled.setAttribute('aria-pressed', on);
    r.edges.disabled = !on;
    viewer.fit();
  }
  function setEdges(on) {
    if (!viewer) return;
    viewer.edges = on;
    r.edges.setAttribute('aria-pressed', on);
    requestDraw();
  }
  r.tiled.addEventListener('click', () => setTiled(!viewer.tiled));
  r.edges.addEventListener('click', () => setEdges(!viewer.edges));

  /* ── Worker: at most one render in flight, changes meanwhile merge into one follow-up ── */
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  let busy = false, dirty = false, reqSeq = 0;
  const requests = new Map();
  function run() {
    if (busy) { dirty = true; return; }
    busy = true; dirty = false;
    r.progress.classList.add('is-on');
    worker.postMessage({ type: 'render', g: { ...g }, layers });
  }
  function request(msg, transfer) {
    return new Promise((resolve, reject) => {
      const s = ++reqSeq;
      requests.set(s, { resolve, reject });
      worker.postMessage({ ...msg, seq: s }, transfer || []);
    });
  }
  worker.onmessage = ({ data: m }) => {
    if (m.type === 'result' || (m.type === 'error' && m.op === 'render')) {
      if (m.type === 'error') { showToast('Could not draw the pattern: ' + m.message); fail('Could not draw the pattern: ' + m.message); }
      else {
        const first = !result;
        r.msg.hidden = true;
        upload(m.S, m.data);
        result = { S: m.S };
        viewer?.setImage(m.S, m.S, !first);
        syncInfo();
        requestDraw();
      }
      busy = false;
      if (dirty) run(); else r.progress.classList.remove('is-on');
    } else {
      const q = requests.get(m.seq);
      requests.delete(m.seq);
      if (m.type === 'error') q?.reject(new Error(m.message)); else q?.resolve(m);
    }
  };
  worker.onerror = e => { console.error(e); fail('The drawing worker failed to start'); };

  /* ── Small builders ── */
  function head(text, ...extra) {
    const h = el('div', 'vw-head');
    const t = el('span');
    t.textContent = text;
    const tools = el('div', 'pm-head-tools');
    tools.append(...extra);
    h.append(t, tools);
    return { el: h, title: t };
  }
  function sub(text) { const s = el('div', 'pm-sub'); s.textContent = text; return s; }
  function tip(text) { const t = el('p', 'vw-tip'); t.textContent = text; return t; }
  const pct = v => Math.round(v * 100) + '%';
  const pct1 = v => (v * 100).toFixed(1) + '%';
  const deg = v => Math.round(v) + '°';
  const num = v => (+v).toFixed(2);
  const int = v => String(Math.round(v));
  function changed() { presets.sync(); run(); save(); }

  /* ── Presets: the built-in patterns and the user's own (core/presets.js) ── */
  // A preset is the pattern without the export size.
  const params = () => ({ g: { ...g, size: undefined }, layers });
  const toParams = ({ g: pg, layers: pl }) => ({ g: { ...pg, size: undefined }, layers: pl });
  const presets = presetPicker({
    tool: 'pattern-maker',
    builtins: PRESETS.map(pr => ({ name: pr.name, params: toParams(fromPreset(pr)) })),
    get: () => JSON.parse(JSON.stringify(params())),
    normalize: pp => JSON.parse(JSON.stringify({
      g: { ...mergeKnown(GLOBAL, pp.g), size: undefined },
      layers: (Array.isArray(pp.layers) ? pp.layers : [])
        .filter(L => TYPES[L?.type])
        .map(L => mergeKnown({ ...COMMON, ...TYPE_DEFAULTS[L.type], type: L.type }, L)),
    })),
    apply(pp, { name }) {
      Object.assign(g, pp.g, { size: g.size });
      layers = pp.layers;
      sel = layers.length - 1;
      fileName = 'T_Pattern_' + name.replace(/[^\w-]+/g, '');
      nameInput.value = fileName;
      refresh();
      commit();
    },
    thumb: (pp, canvas) => request({ type: 'thumbs', size: THUMB, items: [{ g: { ...GLOBAL, ...pp.g }, layers: pp.layers }] }).then(({ images }) => {
      canvas.width = canvas.height = THUMB;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(images[0].buffer), THUMB, THUMB), 0, 0);
    }),
    tile: 64,
    showToast,
  });
  r.presets.append(presets.el);

  /* ── Pattern: seed, background and levels ── */
  const seedRow = el('div', 'ctl pm-seed');
  const seedLabel = el('span', 'ctl-label');
  seedLabel.textContent = 'Seed';
  const seedInput = Object.assign(el('input', 'pm-num'), { type: 'number', min: 1, max: 999999, step: 1 });
  seedInput.setAttribute('aria-label', 'Seed');
  seedInput.addEventListener('input', () => {
    const v = Math.round(+seedInput.value);
    if (!Number.isFinite(v)) return;
    g.seed = v; changed();
  });
  seedInput.addEventListener('change', commit);
  const seedDice = button('btn btn-icon btn-ghost pm-dice', '', 'New random seed (R)', 'dice');
  seedDice.addEventListener('click', newSeed);
  r.dice.addEventListener('click', newSeed);
  seedRow.append(seedLabel, seedInput, seedDice);
  function newSeed() { g.seed = randomSeed(); seedInput.value = g.seed; changed(); commit(); }

  const gctls = [];
  const gadd = c => { gctls.push(c); return c.el; };
  const gbind = key => ({ get: () => g[key], set: v => { g[key] = v; }, def: GLOBAL[key], onInput: changed, onCommit: commit });
  const undoBtn = button('btn btn-icon btn-ghost', '', 'Undo (Ctrl+Z)', 'undo');
  undoBtn.addEventListener('click', () => stepHistory(-1));
  r.pattern.append(
    head('Pattern', undoBtn).el,
    seedRow,
    gadd(slider({ label: 'Background', min: 0, max: 1, step: .01, format: pct, ...gbind('bg') })),
    sub('Levels'),
    gadd(slider({ label: 'Black point', min: 0, max: .9, step: .01, format: pct, ...gbind('black') })),
    gadd(slider({ label: 'White point', min: .1, max: 1, step: .01, format: pct, ...gbind('white') })),
    gadd(slider({ label: 'Grain', min: 0, max: .3, step: .005, format: pct1, ...gbind('grain') })),
    gadd(toggle({ label: 'Invert', ...gbind('invert') })),
    tip('Layers are drawn from the bottom of the list up. Seed reshuffles every layer at once; each layer also has its own.'),
  );

  /* ── Layer list ── */
  const list = el('div', 'pm-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Layers');
  const addRow = el('div', 'pm-add');
  for (const [type, label] of Object.entries(TYPES)) {
    const b = button('pm-add-btn', label, 'Add a ' + label.toLowerCase() + ' layer above the selected one', 'plus');
    b.addEventListener('click', () => {
      const L = newLayer(type);
      layers.splice(sel + 1, 0, L);
      sel += 1;
      refresh(); changed(); commit();
    });
    addRow.append(b);
  }
  r.layers.append(head('Layers').el, list, sub('Add layer'), addRow);

  function summary(L) {
    return `${Math.round(L.count)} · ${(Math.min(L.sizeMin, L.sizeMax) * 100).toFixed(1)}–${(Math.max(L.sizeMin, L.sizeMax) * 100).toFixed(1)}%`;
  }
  function renderList() {
    list.replaceChildren();
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i], row = el('div', 'pm-layer');
      row.classList.toggle('is-sel', i === sel);
      row.classList.toggle('is-off', !L.on);
      const eye = button('pm-ibtn', '', L.on ? 'Hide layer' : 'Show layer', L.on ? 'eye' : 'eye-off');
      eye.addEventListener('click', () => { L.on = !L.on; renderList(); changed(); commit(); });
      const grip = el('span', 'pm-grip');
      grip.append(icon('grip'));
      grip.title = 'Drag to reorder';
      const name = el('button', 'pm-name');
      name.type = 'button';
      name.setAttribute('role', 'option');
      name.setAttribute('aria-selected', i === sel);
      name.title = 'Drag to reorder. Alt+↑ / Alt+↓ move the layer';
      const t = el('span'), s = el('small');
      t.textContent = TYPES[L.type];
      s.textContent = summary(L);
      name.append(t, s);
      name.addEventListener('click', () => {
        if (dragged) return;
        sel = i; renderList(); buildLayer(); save();
      });
      name.addEventListener('keydown', e => {
        const d = e.altKey && { ArrowUp: 1, ArrowDown: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        moveLayer(i, i + d);
        list.children[layers.length - 1 - sel]?.querySelector('.pm-name')?.focus();
      });
      const dup = button('pm-ibtn', '', 'Duplicate with a new seed', 'copy');
      dup.addEventListener('click', () => {
        layers.splice(i + 1, 0, { ...L, seed: randomSeed() });
        sel = i + 1;
        refresh(); changed(); commit();
      });
      const del = button('pm-ibtn', '', 'Delete layer', 'trash');
      del.addEventListener('click', () => {
        layers.splice(i, 1);
        sel = Math.max(0, Math.min(sel >= i ? sel - 1 : sel, layers.length - 1));
        refresh(); changed(); commit();
        showToast(TYPES[L.type] + ' layer deleted', { action: 'Undo', onAction: () => stepHistory(-1) });
      });
      row.addEventListener('pointerdown', e => startDrag(e, row, i));
      row.append(grip, eye, name, dup, del);
      list.append(row);
    }
    if (!layers.length) list.append(tip('No layers yet — add one below, or pick a preset.'));
  }
  // Moves layer `from` to index `to`; the selection follows the layer it was on.
  function moveLayer(from, to) {
    to = Math.max(0, Math.min(layers.length - 1, to));
    if (from === to) return;
    const selected = layers[sel];
    layers.splice(to, 0, ...layers.splice(from, 1));
    sel = layers.indexOf(selected);
    refresh(); changed(); commit();
  }

  /* ── Drag to reorder: the row follows the pointer, the others make room ──
     The list shows the top layer first, so a row's slot is layers.length - 1 - index. */
  let dragged = false;
  function startDrag(e, row, index) {
    if (e.button !== 0 || e.target.closest('.pm-ibtn')) return;
    // on touch screens only the grip drags, so the list still scrolls the page
    if (e.pointerType !== 'mouse' && !e.target.closest('.pm-grip')) return;
    const rows = [...list.children], from = rows.indexOf(row), y0 = e.clientY;
    const pitch = row.offsetHeight + parseFloat(getComputedStyle(list).rowGap || 0);
    let on = false, slot = from;
    dragged = false;
    // listen on the window, not with pointer capture: capture would retarget the click
    // of a plain press away from the name button
    const move = ev => {
      if (ev.pointerId !== e.pointerId) return;
      const dy = ev.clientY - y0;
      if (!on && Math.abs(dy) < 4) return;
      if (!on) { on = dragged = true; row.classList.add('is-dragging'); list.classList.add('is-sorting'); }
      ev.preventDefault();
      const top = -from * pitch, bottom = (rows.length - 1 - from) * pitch;
      const y = Math.max(top, Math.min(bottom, dy));
      row.style.transform = `translateY(${y}px)`;
      slot = Math.max(0, Math.min(rows.length - 1, from + Math.round(y / pitch)));
      rows.forEach((r, k) => {
        if (r === row) return;
        const shift = k > from && k <= slot ? -pitch : k < from && k >= slot ? pitch : 0;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const end = ev => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (!on) return;
      rows.forEach(r => { r.style.transform = ''; });
      row.classList.remove('is-dragging');
      list.classList.remove('is-sorting');
      if (ev.type === 'pointerup' && slot !== from) moveLayer(index, layers.length - 1 - slot);
      setTimeout(() => { dragged = false; });     // swallow the click that ends the drag
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  /* ── Selected layer's settings ── */
  let lctls = [];
  function buildLayer() {
    r.layer.replaceChildren();
    lctls = [];
    arcCtl = null;
    const L = cur();
    r.layer.hidden = !L;
    if (!L) return;
    const add = c => { lctls.push(c); return c.el; };
    const bind = key => ({
      get: () => cur()[key], set: v => { cur()[key] = v; },
      def: { ...COMMON, ...TYPE_DEFAULTS[L.type] }[key],
      onInput: () => { changed(); syncLayerVisibility(); syncSummary(); }, onCommit: commit,
    });
    const s = (label, key, min, max, step, format) => add(slider({ label, min, max, step, format, ...bind(key) }));

    const reseed = button('btn btn-icon btn-ghost pm-dice', '', 'New seed for this layer', 'dice');
    reseed.addEventListener('click', () => { cur().seed = randomSeed(); changed(); commit(); });
    const reset = button('btn btn-ghost vw-reset', 'Reset', 'Reset this layer to its defaults; keeps its seed');
    reset.addEventListener('click', () => {
      const { seed, on } = cur();
      layers[sel] = newLayer(L.type, { seed, on });
      refresh(); changed(); commit();
    });
    const h = head(TYPES[L.type] + ' layer', reseed, reset);

    const shape = [];
    if (L.type === 'shards') shape.push(
      s('Sides', 'sides', 3, 8, 1, int),
      s('Irregular', 'irregular', 0, 1, .01, pct),
      s('Stretch', 'stretch', 1, 8, .05, num),
    );
    else if (L.type === 'strokes') shape.push(
      s('Stretch', 'stretch', 1, 12, .05, num),
      s('Bend', 'bend', 0, 1, .01, pct),
      s('Taper', 'taper', 0, 1, .01, pct),
      s('Round ends', 'round', 0, 1, .01, pct),
      s('Wobble', 'wobble', 0, 1, .01, pct),
      s('Streaks', 'streaks', 0, 1, .01, pct),
    );
    else if (L.type === 'circles') shape.push(
      s('Stretch', 'stretch', 1, 3, .01, num),
      s('Spots', 'satellites', 0, 16, 1, int),
      s('Spot size', 'satSize', .05, .5, .01, pct),
      s('Spot tone', 'satContrast', -1, 1, .01, v => (v > 0 ? '+' : '') + Math.round(v * 100) + '%'),
    );
    else if (L.type === 'halftone') shape.push(
      s('Spacing', 'dotSpacing', .003, .04, .0005, v => (v * 100).toFixed(2) + '%'),
      s('Dot size', 'dotSize', .1, 1.2, .01, pct),
      s('Falloff', 'falloff', 0, 1, .01, pct),
      s('Roughness', 'rough', 0, 1, .01, pct),
      s('Breakup', 'breakup', 0, 1, .01, pct),
    );
    else if (L.type === 'lines') shape.push(
      add(segmented({
        label: 'Mode',
        options: [['straight', 'Straight', 'Parallel straight lines: hatching'], ['arc', 'Arcs', 'Concentric arcs']],
        ...bind('lineMode'), onInput: () => { changed(); syncLayerVisibility(); },
      })),
      s('Lines', 'lines', 1, 40, 1, int),
      s('Spacing', 'lineGap', .003, .04, .0005, v => (v * 100).toFixed(2) + '%'),
      s('Thickness', 'lineFill', .05, .95, .01, pct),
      s('Ragged', 'ragged', 0, 1, .01, pct),
      arcCtl = s('Arc span', 'arcSpan', 10, 300, 1, deg),
      add(toggle({ label: 'Round caps', ...bind('roundCaps') })),
    );

    r.layer.append(
      h.el,
      tip(DESCRIBE[L.type]),
      sub('Placement'),
      s('Count', 'count', 0, MAX_COUNT[L.type], 1, int),
      add(segmented({
        label: 'Spread',
        options: [
          ['random', 'Random', 'Anywhere'],
          ['grid', 'Grid', 'Even coverage: one shape per cell of a jittered grid'],
          ['columns', 'Cols', 'Shapes line up in columns'],
          ['rows', 'Rows', 'Shapes line up in rows'],
        ],
        ...bind('spread'),
      })),
      s('Size min', 'sizeMin', .003, .5, .001, pct1),
      s('Size max', 'sizeMax', .003, .5, .001, pct1),
      s('Size bias', 'bias', -1, 1, .01, v => v < -.02 ? 'small' : v > .02 ? 'large' : 'even'),
      add(toggle({ label: 'Large first', ...bind('largeFirst') })),
      sub('Shape'),
      ...shape,
      sub('Gradient'),
      add(segmented({
        label: 'Fill',
        options: GRAD_MODES[L.type].map(m => [m, ...GRAD_LABELS[m]]),
        get: () => GRAD_MODES[L.type].includes(cur().gradMode) ? cur().gradMode : GRAD_MODES[L.type][0],
        set: v => { cur().gradMode = v; },
        onInput: () => changed(), onCommit: commit,
      })),
      s('Shapes', 'gradients', 0, 1, .01, pct),
      s('End tone', 'gradAmount', -1, 1, .01, v => (v > 0 ? '+' : '') + Math.round(v * 100) + '%'),
      add(toggle({ label: 'Both ways', ...bind('gradBoth') })),
      sub('Rotation'),
      s('Angle', 'angle', 0, 180, 1, deg),
      s('Jitter', 'jitter', 0, 1, .01, pct),
      sub('Tone'),
      s('Tone min', 'toneMin', 0, 1, .01, pct),
      s('Tone max', 'toneMax', 0, 1, .01, pct),
      s('Opacity', 'opacity', 0, 1, .01, pct),
      add(segmented({
        label: 'Blend',
        options: [
          ['normal', 'Normal'], ['lighten', 'Lighten', 'Only brightens what is below'],
          ['darken', 'Darken', 'Only darkens what is below'], ['overlay', 'Overlay', 'Adds contrast to what is below'],
        ],
        ...bind('blend'),
      })),
      tip('Sizes are a share of the texture, so the pattern looks the same at any resolution. Tone is the gray level each shape gets at random between min and max. Gradient: Shapes is the share of shapes that get one; End tone is how much lighter (+) or darker (−) it gets; Both ways lets half of them go the other way. Double-click a label to reset it.'),
    );
    syncLayerVisibility();
  }
  let arcCtl = null;
  function syncLayerVisibility() {
    if (arcCtl) arcCtl.hidden = cur()?.lineMode !== 'arc';
  }
  function syncSummary() {
    const row = list.children[layers.length - 1 - sel];
    const s = row?.querySelector('small');
    if (s) s.textContent = summary(cur());
  }

  /* ── Export ── */
  const sizeCtl = segmented({
    label: 'Size',
    options: SIZES.map(s => [s, s < 1024 ? String(s) : s / 1024 + 'K', s + ' × ' + s + ' px']),
    get: () => g.size, set: v => { g.size = +v; }, onInput: () => { run(); save(); },
  });
  sizeCtl.el.classList.add('pm-size');
  const nameLabel = el('label', 'vw-name');
  const nameInput = Object.assign(el('input'), { value: fileName, spellcheck: false });
  nameInput.setAttribute('aria-label', 'File name');
  nameInput.addEventListener('input', () => { fileName = nameInput.value; });
  const ext = el('span');
  nameLabel.append(nameInput, ext);
  const formatCtl = segmented({
    options: [['tga', 'TGA'], ['png', 'PNG']],
    get: () => out.format, set: v => { out.format = v; }, onInput: () => { syncInfo(); save(); },
  });
  formatCtl.el.classList.add('vw-format');
  const dl = button('btn btn-primary vw-dl', 'Download', '', 'download');
  dl.disabled = true;
  const send = button('btn btn-ghost pm-send', 'Open in Kuwahator', 'Paint the pattern with brush strokes; it arrives with Seamless on', 'brush');
  send.disabled = true;
  const info = el('p', 'vw-tip');
  const saveRow = el('div', 'vw-save');
  saveRow.append(nameLabel, formatCtl.el);
  r.export.append(sizeCtl.el, saveRow, dl, send, info);

  function syncInfo() {
    ext.textContent = '.' + out.format;
    dl.disabled = send.disabled = !result;
    info.textContent = `${g.size} × ${g.size} · grayscale · tiles seamlessly.`;
  }
  const baseName = () => (fileName.trim() || 'Pattern').replace(/\.(png|tga)$/i, '').replace(/[\\/:*?"<>|]/g, '_');
  dl.addEventListener('click', async () => {
    if (!result) return;
    dl.disabled = true;
    try { downloadBlob((await request({ type: 'encode', format: out.format })).blob, baseName() + '.' + out.format); }
    catch (err) { console.error(err); showToast('Could not save the file: ' + err.message); }
    dl.disabled = !result;
  });
  send.addEventListener('click', async () => {
    if (!result) return;
    send.disabled = true;
    try {
      const { W, H, data } = await request({ type: 'pixels' });
      const base = baseName();
      sendTo('kuwahator', { name: base + ' (Pattern Maker)', base, w: W, h: H, data, tileable: true });
    } catch (err) { console.error(err); showToast('Could not send the texture: ' + err.message); }
    send.disabled = !result;
  });

  /* ── Keys ── */
  document.addEventListener('keydown', e => {
    if (!visible || isTyping(e)) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); stepHistory(e.shiftKey ? 1 : -1); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); stepHistory(1); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || !viewer) return;
    if (e.code === 'KeyF') viewer.fit();
    else if (e.code === 'Digit1' || e.code === 'Numpad1') viewer.zoomAt(1);
    else if (e.code === 'KeyT') setTiled(!viewer.tiled);
    else if (e.code === 'KeyE' && viewer.tiled) setEdges(!viewer.edges);
    else if (e.code === 'KeyR') newSeed();
    else return;
    e.preventDefault();
  });

  // Redraws every panel from the state, after a preset, undo or a change to the list.
  function refresh() {
    seedInput.value = g.seed;
    gctls.forEach(c => c.sync());
    sizeCtl.sync();
    presets.sync();
    renderList();
    buildLayer();
    syncInfo();
    run();
    save();
  }

  /* ── Start ── */
  refresh();
  new ResizeObserver(() => { viewer?.resize(); requestDraw(); }).observe(r.view);

  return {
    show() { visible = true; viewer?.resize(); requestDraw(); },
    hide() { visible = false; cancelAnimationFrame(raf); raf = 0; },
  };
}
