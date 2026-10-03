/* Tile Maker
   Makes an ordinary texture tile seamlessly: evens out large-scale lighting, hides the
   seams with a cut along the path where the edges match best, and can heal the cut by
   synthesizing it again from the texture (worker.js, heal.js). A clone brush paints over
   anything that still gives the repeat away (clone-gpu.js while drawing, the worker for
   the file). The result is shown repeated in a zoomable viewer, next to the source tiled
   as is. */
import { el, icon, downloadBlob, isTyping } from '../../core/dom.js';
import { decodeImage, IMAGE_ACCEPT, isImageFile } from '../../core/image.js';
import { slider, segmented, toggle } from '../../core/controls.js';
import { createViewer } from '../../core/image-viewer.js';
import { receive, sendTo } from '../../core/handoff.js';
import { createCloner } from './clone-gpu.js';

const STORE_KEY = 'topometric-tile-maker-v1';
const SAMPLE_SIZE = 1024;
const DEFAULTS = { method: 'cut', seam: .15, soft: 3, heal: true, healWidth: 20, equalize: .7, scale: .25 };
const BRUSH = { size: 48, hardness: .5, opacity: 1 };
const SIZES = [512, 1024, 2048, 4096, 8192];

const TEMPLATE = `
  <header class="page-header">
    <div class="container">
      <h1>Tile Maker</h1>
      <p>Make any texture tile without visible seams or repeating light patches. Everything runs locally — files never leave your computer.</p>
    </div>
  </header>
  <div class="page-body">
    <div class="container vw-layout">
      <div class="vw-card vw-stage">
        <div class="vw-bar">
          <button type="button" class="btn vw-open" data-ref="open"><span>Open image</span></button>
          <div class="vw-group" role="group" aria-label="Zoom">
            <button type="button" data-ref="fit" title="Fit to view (F)">Fit</button>
            <button type="button" data-ref="one" title="Actual pixels (1)">1:1</button>
            <output data-ref="zoom" aria-live="off">100%</output>
          </div>
          <button type="button" class="vw-toggle" data-ref="tiled" aria-pressed="true" title="Repeat the texture in every direction (T)">Tiled</button>
          <button type="button" class="vw-toggle" data-ref="edges" aria-pressed="false" title="Outline the tile edges (E)">Edges</button>
          <button type="button" class="vw-toggle" data-ref="compare" aria-pressed="false" title="Left: the source tiled as is. Right: the result (C)">Compare</button>
          <button type="button" class="vw-toggle tm-clone-btn" data-ref="cloneBtn" aria-pressed="false" title="Clone brush (B): Alt+click picks the source, then paint">Clone</button>
        </div>
        <div class="vw-view" data-ref="view">
          <canvas data-ref="canvas"></canvas>
          <div class="tm-brush" data-ref="brush" hidden></div>
          <div class="tm-source" data-ref="source" hidden></div>
          <div class="vw-split" data-ref="split" hidden>
            <span class="vw-split-label is-before">Source</span>
            <span class="vw-split-label is-after">Seamless</span>
            <button type="button" class="vw-split-knob" data-ref="knob" aria-label="Move the before/after divider"></button>
          </div>
          <div class="vw-progress tm-busy" data-ref="progress"></div>
          <p class="tm-status" data-ref="status" hidden></p>
          <p class="vw-msg" data-ref="msg" hidden></p>
        </div>
        <p class="vw-hint" data-ref="hint"></p>
      </div>
      <div class="vw-panel">
        <div class="vw-card" data-ref="seams"></div>
        <div class="vw-card" data-ref="light"></div>
        <div class="vw-card" data-ref="clone"></div>
        <div class="vw-card" data-ref="export"></div>
      </div>
    </div>
  </div>`;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (_) { return {}; }
}

function texture(gl, w, h, data) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.RGBA8, w, h);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return t;
}

export function mount(root, { showToast }) {
  root.innerHTML = TEMPLATE;
  const r = {};
  root.querySelectorAll('[data-ref]').forEach(n => { r[n.dataset.ref] = n; });
  r.open.prepend(icon('upload'));

  /* ── State ── */
  const saved = load();
  const p = { ...DEFAULTS, ...saved.p };
  const out = { size: 0, format: 'tga', ...saved.out };              // size 0: no resampling
  const brush = { ...BRUSH, ...saved.brush };
  let image = { name: 'Sample', w: SAMPLE_SIZE, h: SAMPLE_SIZE, note: '' };
  let result = null;                                                 // { W, H, cropW, cropH, opaque }
  let fileName = 'T_Sample_Tile';
  let visible = false, saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ p, out, brush })); } catch (_) { } }, 300);
  }

  /* ── View ── */
  const gl = r.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false });
  let viewer = null, cloner = null, srcTex = null;
  function fail(text) { r.msg.textContent = text; r.msg.hidden = false; }
  try {
    if (!gl) throw new Error('This tool needs WebGL 2. Try an up-to-date Chrome, Edge, Firefox or Safari.');
    viewer = createViewer(gl, r.canvas);
    cloner = createCloner(gl);
    viewer.tiled = true;
    viewer.onChange = () => { requestDraw(); placeOverlays(); };
  } catch (err) { console.error(err); fail(err.message); }
  r.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); fail('The GPU was reset. Reload the page to continue.'); });

  let raf = 0;
  function requestDraw() {
    syncZoom();
    if (!raf && visible && viewer) raf = requestAnimationFrame(() => {
      raf = 0;
      if (result && srcTex) viewer.draw(cloner.texture, srcTex, 99);
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
  function setCompare(on) {
    if (!viewer) return;
    viewer.split = on ? (viewer.split >= 0 ? viewer.split : .5) : -1;
    r.compare.setAttribute('aria-pressed', on);
    r.split.hidden = !on;
    placeSplit();
    requestDraw();
  }
  function placeSplit() { if (viewer && viewer.split >= 0) r.split.style.left = viewer.split * 100 + '%'; }
  r.tiled.addEventListener('click', () => setTiled(!viewer.tiled));
  r.edges.addEventListener('click', () => setEdges(!viewer.edges));
  r.compare.addEventListener('click', () => setCompare(viewer.split < 0));
  r.knob.addEventListener('pointerdown', e => {
    e.preventDefault();
    r.knob.setPointerCapture(e.pointerId);
    r.knob.onpointermove = ev => {
      const b = r.view.getBoundingClientRect();
      viewer.split = Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width));
      placeSplit();
      requestDraw();
    };
    r.knob.onpointerup = r.knob.onpointercancel = () => { r.knob.onpointermove = null; };
  });
  r.knob.addEventListener('keydown', e => {
    const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!d) return;
    e.preventDefault();
    viewer.split = Math.min(1, Math.max(0, viewer.split + d * (e.shiftKey ? .1 : .02)));
    placeSplit();
    requestDraw();
  });

  /* ── Worker: at most one job in flight, changes meanwhile merge into one follow-up ── */
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  let seq = 0, busy = false, dirty = false, reqSeq = 0;
  const requests = new Map();
  function run() {
    if (busy) { dirty = true; return; }
    busy = true; dirty = false;
    r.progress.classList.add('is-on');
    worker.postMessage({ type: 'process', seq: ++seq, params: { ...p, size: out.size } });
  }
  // A file or the raw pixels of the result, clone strokes included.
  function request(msg) {
    return new Promise((resolve, reject) => {
      const s = ++reqSeq;
      requests.set(s, { resolve, reject });
      worker.postMessage({ ...msg, seq: s, strokes });
    });
  }
  worker.onmessage = ({ data: m }) => {
    if (m.type === 'source') {                       // the built-in sample
      setSourceTexture(m.w, m.h, m.data);
      run();
    } else if (m.type === 'result' || (m.type === 'error' && m.op === 'process')) {
      if (m.type === 'error') showToast('Could not make the tile: ' + m.message);
      else if (gl && !gl.isContextLost()) {
        if (painting) cancelStroke();
        cloner.setBase(m.W, m.H, m.data);
        cloner.replay(strokes);
        const first = !result;
        result = { W: m.W, H: m.H, cropW: m.cropW, cropH: m.cropH, opaque: m.opaque };
        viewer.setImage(m.W, m.H, !first);
        syncInfo();
        requestDraw();
      }
      r.status.hidden = !m.partial;
      r.status.textContent = 'Healing seams…';
      if (m.partial) return;                        // the healed result is on its way
      busy = false;
      if (dirty) run(); else r.progress.classList.remove('is-on');
    } else if (m.type === 'encoded' || m.type === 'pixels' || (m.type === 'error' && (m.op === 'encode' || m.op === 'pixels'))) {
      const q = requests.get(m.seq);
      requests.delete(m.seq);
      if (m.type === 'error') q?.reject(new Error(m.message)); else q?.resolve(m);
    }
  };
  worker.onerror = e => { console.error(e); showToast('The processing worker failed to start'); };

  function setSourceTexture(w, h, data) {
    if (!gl || gl.isContextLost()) return;
    if (srcTex) gl.deleteTexture(srcTex);
    srcTex = texture(gl, w, h, data);
    viewer.beforeSize = [w, h];
  }

  /* ── Settings ── */
  const ctls = [];
  const add = c => { ctls.push(c); return c.el; };
  const changed = () => { run(); save(); };
  const bind = key => ({ get: () => p[key], set: v => { p[key] = v; }, def: DEFAULTS[key], onInput: changed });
  function head(text, keys, onReset) {
    const h = el('div', 'vw-head');
    h.textContent = text;
    const b = el('button', 'btn btn-ghost vw-reset');
    b.type = 'button';
    b.textContent = 'Reset';
    b.addEventListener('click', onReset || (() => { keys.forEach(k => { p[k] = DEFAULTS[k]; }); syncSettings(); changed(); }));
    h.append(b);
    return h;
  }
  function tip(text) { const t = el('p', 'vw-tip'); t.textContent = text; return t; }
  const pct = v => Math.round(v * 100) + '%';
  const px = v => Math.round(v) + ' px';
  const softCtl = slider({ label: 'Softness', min: 0, max: 24, step: 1, format: px, ...bind('soft') });
  const healWidthCtl = slider({ label: 'Heal width', min: 4, max: 48, step: 1, format: px, ...bind('healWidth') });
  function syncSettings() {
    ctls.forEach(c => c.sync());
    softCtl.el.hidden = p.method !== 'cut';
    healWidthCtl.el.hidden = !p.heal;
  }
  r.seams.append(
    head('Seams', ['method', 'seam', 'soft', 'heal', 'healWidth']),
    add(segmented({
      label: 'Method',
      options: [
        ['cut', 'Smart cut', 'Joins the edges along the path where they match best: no ghosting, keeps detail sharp'],
        ['blend', 'Crossfade', 'Fades the edges into each other: for soft textures like clouds, gradients or fog'],
      ],
      ...bind('method'), onInput: () => { syncSettings(); changed(); },
    })),
    add(slider({ label: 'Overlap', min: .04, max: .4, step: .01, format: pct, ...bind('seam') })),
    add(softCtl),
    add(toggle({ label: 'Heal seams', ...bind('heal'), onInput: () => { syncSettings(); changed(); } })),
    add(healWidthCtl),
    tip('The edges overlap by this share of the image, so the result is that much smaller. Heal paints the strip around the seam again from similar spots of the texture, so a cut through a stone or a leaf turns into a natural edge.'),
  );
  r.light.append(
    head('Lighting', ['equalize', 'scale']),
    add(slider({ label: 'Equalize', min: 0, max: 1, step: .01, format: pct, ...bind('equalize') })),
    add(slider({ label: 'Scale', min: .05, max: .6, step: .01, format: pct, ...bind('scale') })),
    tip('Evens out light and color that change across the photo, so the tiles don\'t form a grid of bright and dark patches. Scale is the size of the changes to remove; smaller removes more.'),
  );
  syncSettings();

  /* ── Clone brush ──
     Alt+click picks the source; the first stroke fixes the offset between source and
     brush, and later strokes keep it (like "Aligned" in Photoshop) until a new source. */
  let strokes = [];                    // see applyStrokes in worker.js for the format
  let cloneOn = false, cloneSrc = null, cloneOff = null, painting = null, lastPt = null, hoverPt = null;
  const bctl = (key, label, min, max, step, format) => slider({
    label, min, max, step, format, get: () => brush[key], set: v => { brush[key] = v; }, def: BRUSH[key],
    onInput: () => { save(); placeOverlays(); },
  });
  const brushCtls = [
    bctl('size', 'Size', 4, 400, 1, px),
    bctl('hardness', 'Hardness', 0, .95, .01, pct),
    bctl('opacity', 'Opacity', .05, 1, .01, pct),
  ];
  const undoBtn = Object.assign(el('button', 'btn'), { type: 'button', textContent: 'Undo stroke' });
  const clearBtn = Object.assign(el('button', 'btn btn-ghost'), { type: 'button', textContent: 'Clear all' });
  undoBtn.title = 'Ctrl+Z';
  const cloneRow = el('div', 'tm-clone-row');
  cloneRow.append(undoBtn, clearBtn);
  const cloneOnCtl = toggle({ label: 'Clone brush', get: () => cloneOn, set: v => setClone(v) });
  r.clone.append(
    head('Clone', [], () => { Object.assign(brush, BRUSH); brushCtls.forEach(c => c.sync()); save(); placeOverlays(); }),
    cloneOnCtl.el, ...brushCtls.map(c => c.el), cloneRow,
    tip('Paints over spots that give the repeat away — a stain, a bright pebble — with texture from somewhere else. Alt+click picks where to copy from. Space+drag or the middle button pans, [ and ] change the size. Strokes stay when you change the settings above.'),
  );
  function syncClone() {
    cloneOnCtl.sync();
    r.cloneBtn.setAttribute('aria-pressed', cloneOn);
    undoBtn.disabled = !strokes.length;
    clearBtn.disabled = !strokes.length;
    r.view.classList.toggle('is-cloning', cloneOn);
    r.hint.textContent = cloneOn
      ? (cloneSrc ? 'Paint to clone. Alt+click picks a new source. Space+drag or middle button pans, [ ] size, Ctrl+Z undoes a stroke.'
        : 'Alt+click the spot to copy from, then paint over what you want to hide.')
      : 'Scroll to zoom, drag to pan, double-click for 1:1. The middle of the fitted view is where four tiles meet.';
    placeOverlays();
  }
  function setClone(on) {
    cloneOn = on;
    if (viewer) viewer.tool = on ? tool : null;
    if (!on && viewer) viewer.panKey = false;
    syncClone();
  }
  r.cloneBtn.addEventListener('click', () => setClone(!cloneOn));

  const radius = () => brush.size / 2;                                  // output px
  function placeOverlays() {
    if (!viewer) return;
    const show = cloneOn && hoverPt && result && !viewer.panKey;
    r.brush.hidden = !show;
    if (show) {
      const [x, y] = viewer.toScreen(hoverPt[0], hoverPt[1]), d = 2 * radius() * viewer.zoom / (window.devicePixelRatio || 1);
      Object.assign(r.brush.style, { left: x + 'px', top: y + 'px', width: d + 'px', height: d + 'px' });
    }
    // where the brush copies from: the picked point, or the brush shifted by the offset
    const s = !cloneOn || !cloneSrc ? null : cloneOff && hoverPt ? [hoverPt[0] + cloneOff[0], hoverPt[1] + cloneOff[1]] : cloneOff ? null : cloneSrc;
    r.source.hidden = !s;
    if (s) {
      const [x, y] = viewer.toScreen(s[0], s[1]);
      Object.assign(r.source.style, { left: x + 'px', top: y + 'px' });
    }
  }

  // Dabs every ~15 % of the radius along the pointer path, in output pixels.
  function addDabs(to) {
    const [W, H] = cloner.size, step = Math.max(1, radius() * .15);
    const from = lastPt || to, d = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const n = lastPt ? Math.floor(d / step) : 0;
    const start = painting.dabs.length;
    if (!lastPt) painting.dabs.push([to[0] / W, to[1] / H]);
    for (let i = 1; i <= n; i++) {
      const t = i * step / d;
      painting.dabs.push([(from[0] + (to[0] - from[0]) * t) / W, (from[1] + (to[1] - from[1]) * t) / H]);
    }
    if (lastPt && n === 0) return;
    lastPt = n ? [from[0] + (to[0] - from[0]) * n * step / d, from[1] + (to[1] - from[1]) * n * step / d] : to;
    cloner.extend(painting, start);
    requestDraw();
  }
  function cancelStroke() { painting = null; lastPt = null; cloner.cancel(); }

  const tool = {
    down(e, pt) {
      if (!result) return;
      if (e.altKey) {                                  // pick the source
        cloneSrc = pt; cloneOff = null;
        syncClone();
        return;
      }
      if (!cloneSrc) { showToast('Alt+click the spot to copy from first'); return; }
      if (!cloneOff) cloneOff = [cloneSrc[0] - pt[0], cloneSrc[1] - pt[1]];
      const [W, H] = cloner.size;
      painting = { r: radius() / W, hardness: brush.hardness, opacity: brush.opacity, off: [cloneOff[0] / W, cloneOff[1] / H], dabs: [] };
      lastPt = null;
      cloner.begin();
      addDabs(pt);
      hoverPt = pt; placeOverlays();
    },
    move(e, pt) {
      hoverPt = pt;
      if (painting) addDabs(pt);
      placeOverlays();
    },
    up() {
      if (!painting) return;
      cloner.commit();
      strokes.push(painting);
      painting = null; lastPt = null;
      syncClone();
    },
    hover(e, pt) { hoverPt = pt; placeOverlays(); },
  };
  function undoStroke() {
    if (!strokes.length) return;
    strokes.pop();
    cloner.replay(strokes);
    syncClone();
    requestDraw();
  }
  undoBtn.addEventListener('click', undoStroke);
  clearBtn.addEventListener('click', () => { strokes = []; cloner.replay(strokes); syncClone(); requestDraw(); });

  /* ── Keys ── */
  document.addEventListener('keydown', e => {
    if (!visible || !viewer || isTyping(e)) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyZ' && strokes.length) { e.preventDefault(); undoStroke(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space' && cloneOn) { if (!viewer.panKey) { viewer.panKey = true; r.view.classList.add('is-pan-key'); placeOverlays(); } }
    else if (e.code === 'KeyF') viewer.fit();
    else if (e.code === 'Digit1' || e.code === 'Numpad1') viewer.zoomAt(1);
    else if (e.code === 'KeyC') setCompare(viewer.split < 0);
    else if (e.code === 'KeyT') setTiled(!viewer.tiled);
    else if (e.code === 'KeyE' && viewer.tiled) setEdges(!viewer.edges);
    else if (e.code === 'KeyB') setClone(!cloneOn);
    else if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && cloneOn) {
      brush.size = Math.min(400, Math.max(4, Math.round(brush.size * (e.code === 'BracketLeft' ? .8 : 1.25))));
      brushCtls[0].sync(); save(); placeOverlays();
    }
    else return;
    e.preventDefault();
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'Space' && viewer?.panKey) { viewer.panKey = false; r.view.classList.remove('is-pan-key'); placeOverlays(); }
  });

  /* ── Export ── */
  const sizeCtl = segmented({
    label: 'Size',
    options: [[0, 'Native', 'No resampling: the source minus the overlap']].concat(SIZES.map(s => [s, s < 1024 ? String(s) : s / 1024 + 'K', s + ' px on the long side'])),
    get: () => out.size, set: v => { out.size = +v; }, onInput: () => { run(); save(); },
  });
  sizeCtl.el.classList.add('tm-size');
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
  const dl = el('button', 'btn btn-primary vw-dl');
  dl.type = 'button';
  dl.append(icon('download'), document.createTextNode('Download'));
  dl.disabled = true;
  const send = el('button', 'btn btn-ghost tm-send');
  send.type = 'button';
  send.title = 'Paint the seamless texture with brush strokes; Kuwahator keeps it seamless';
  send.append(icon('brush'), document.createTextNode('Open in Kuwahator'));
  send.disabled = true;
  const info = el('p', 'vw-tip');
  const saveRow = el('div', 'vw-save');
  saveRow.append(nameLabel, formatCtl.el);
  r.export.append(add(sizeCtl), saveRow, dl, send, info);

  function syncInfo() {
    ext.textContent = '.' + out.format;
    dl.disabled = send.disabled = !result;
    if (!result) { info.textContent = image.name + ' · ' + image.w + ' × ' + image.h; return; }
    const { W, H, cropW, cropH, opaque } = result;
    info.textContent = `${image.name} · ${image.w} × ${image.h} → ${W} × ${H}` +
      (W !== cropW || H !== cropH ? ` (resampled from ${cropW} × ${cropH})` : '') +
      `, ${opaque ? 'RGB' : 'RGBA'}` + (image.note ? ` · ${image.note}` : '') + '.';
  }
  const baseName = () => (fileName.trim() || 'Tile').replace(/\.(png|tga)$/i, '').replace(/[\\/:*?"<>|]/g, '_');

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
      sendTo('kuwahator', { name: base + ' (Tile Maker)', base, w: W, h: H, data, tileable: true });
    } catch (err) { console.error(err); showToast('Could not send the texture: ' + err.message); }
    send.disabled = !result;
  });

  /* ── Loading images ── */
  function setImage({ name, w, h, data, note }, base) {
    setSourceTexture(w, h, data);
    worker.postMessage({ type: 'set', w, h, data }, [data.buffer]);
    image = { name, w, h, note: note || '' };
    result = null;
    strokes = []; cloneSrc = null; cloneOff = null;
    syncClone();
    fileName = base + '_Tile';
    nameInput.value = fileName;
    syncInfo();
    run();
  }
  async function openFile(file) {
    try { setImage({ name: file.name, ...await decodeImage(file) }, file.name.replace(/\.[^.]+$/, '')); }
    catch (err) { console.error(err); showToast('Could not open ' + file.name + (err.message ? ': ' + err.message : '')); }
  }
  r.open.addEventListener('click', () => {
    const f = Object.assign(document.createElement('input'), { type: 'file', accept: IMAGE_ACCEPT });
    f.onchange = () => f.files[0] && openFile(f.files[0]);
    f.click();
  });
  r.view.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    r.view.classList.add('is-dragover');
  });
  r.view.addEventListener('dragleave', e => { if (!r.view.contains(e.relatedTarget)) r.view.classList.remove('is-dragover'); });
  r.view.addEventListener('drop', e => {
    e.preventDefault();
    r.view.classList.remove('is-dragover');
    const file = [...e.dataTransfer.files].find(isImageFile);
    if (file) openFile(file); else showToast('Drop a PNG, JPG, TGA, WebP or BMP image');
  });

  /* ── Start ── */
  setCompare(true);
  syncClone();
  syncInfo();
  worker.postMessage({ type: 'sample', size: SAMPLE_SIZE });
  new ResizeObserver(() => { viewer?.resize(); placeSplit(); placeOverlays(); requestDraw(); }).observe(r.view);

  return {
    show() {
      visible = true;
      const sent = receive('tile-maker');
      if (sent) setImage(sent, sent.base);
      viewer?.resize();
      requestDraw();
    },
    hide() { visible = false; cancelAnimationFrame(raf); raf = 0; },
  };
}
