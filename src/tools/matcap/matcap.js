/* MatCap Generator
   A matcap is a picture of a lit sphere; renderers look up a surface's color by its
   view-space normal. Here the sphere is shaded by a fragment shader (renderer.js) from a
   small set of parameters: lights placed directly on the sphere, material, specular,
   reflections, rim, stylization. The model preview uses the shared three.js viewer, and
   the PNG is written byte for byte by our own encoder. */
import * as THREE from 'three';
import { el, icon, downloadBlob } from '../../core/dom.js';
import { encodePNG } from '../../core/codecs.js';
import { slider, colorField, segmented, toggle } from '../../core/controls.js';
import { createViewer } from '../../core/three/viewer.js';
import { loadModel, isModelFile, MODEL_ACCEPT, MODEL_EXTENSIONS } from '../../core/three/load-model.js';
import { createMatcapPainter } from './renderer.js';
import { SHAPES, createShape } from './meshes.js';
import { DEFAULTS, PRESETS, fromPreset } from './presets.js';

const STORE_KEY = 'topometric-matcap-v2';
const MAX_LIGHTS = 4;
const SIZES = [256, 512, 1024, 2048];
const THUMB = 96;
const PREVIEW_TEX = 512;

const TEMPLATE = `
  <header class="page-header">
    <div class="container">
      <h1>MatCap Generator</h1>
      <p>Shade a sphere and save it as a matcap for Blender, ZBrush or any engine.</p>
    </div>
  </header>
  <div class="page-body">
    <div class="container mc-layout">
      <div class="mc-stage">
        <div class="mc-card">
          <div class="mc-bar">
            <div data-ref="viewBar"></div>
            <div data-ref="shapeBar"></div>
            <button type="button" class="btn btn-icon btn-ghost" data-ref="load" title="Load your model: ${MODEL_EXTENSIONS.join(', ').toUpperCase()}" aria-label="Load model"></button>
            <button type="button" class="btn btn-icon btn-ghost mc-undo" data-ref="undo" title="Undo (Ctrl+Z)" aria-label="Undo" disabled></button>
          </div>
          <div class="mc-view" data-ref="view">
            <canvas data-ref="canvas"></canvas>
            <div class="mc-handles" data-ref="handles"></div>
            <p class="mc-busy" data-ref="busy" hidden>Loading…</p>
          </div>
          <p class="mc-hint" data-ref="hint"></p>
        </div>
        <div class="mc-card mc-export" data-ref="export"></div>
      </div>
      <div class="mc-panel">
        <div class="mc-card">
          <div class="mc-presets" data-ref="presets" role="group" aria-label="Presets"></div>
        </div>
        <div class="mc-card mc-settings" data-ref="settings"></div>
      </div>
    </div>
  </div>`;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch (_) { return null; }
}

export function mount(root, { showToast }) {
  root.innerHTML = TEMPLATE;
  const r = {};
  root.querySelectorAll('[data-ref]').forEach(n => { r[n.dataset.ref] = n; });
  r.undo.append(icon('undo'));
  r.load.append(icon('upload'));

  /* ── State ── */
  const saved = load();
  let p = saved?.p ? { ...structuredClone(DEFAULTS), ...saved.p } : fromPreset(PRESETS[0]);  // matcap parameters
  const out = { size: 512, bg: 'extend', bgColor: '#000000', name: 'MatCap_Clay', ...saved?.out };
  const ui = { view: 'sphere', shape: 'knot', ...saved?.ui };
  if (!SHAPES.some(([v]) => v === ui.shape)) ui.shape = 'knot';   // a loaded model is not kept between visits
  let sel = 0;                 // selected light
  let preset = saved ? -1 : 0; // highlighted preset
  let visible = false;

  const params = () => ({ ...p, bg: out.bg, bgColor: out.bgColor });
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    const keep = { ...ui, shape: ui.shape === 'custom' ? 'knot' : ui.shape };
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ p, out, ui: keep })); } catch (_) { } }, 300);
  }

  /* ── Undo ── */
  let committed = JSON.stringify(p);
  const history = [];
  function commit() {
    const now = JSON.stringify(p);
    if (now !== committed) {
      history.push(committed);
      if (history.length > 100) history.shift();
      committed = now;
    }
    r.undo.disabled = !history.length;
    save();
  }
  function undo() {
    if (!history.length) return;
    committed = history.pop();
    p = JSON.parse(committed);
    sel = Math.min(sel, p.lights.length - 1);
    preset = -1;
    r.undo.disabled = !history.length;
    refresh();
    save();
  }
  r.undo.addEventListener('click', undo);
  document.addEventListener('keydown', e => {
    if (!visible || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.code !== 'KeyZ') return;
    if (e.target.matches?.('input[type="text"], textarea, [contenteditable]')) return;
    e.preventDefault();
    undo();
  });

  /* ── Rendering: one WebGL context for the sphere, the model and the exports ── */
  let viewer = null, painter = null, matcapTarget = null, matcapMaterial = null, texDirty = true;
  try {
    viewer = createViewer(r.canvas);
    painter = createMatcapPainter(viewer.renderer);
    matcapTarget = painter.makeTarget(PREVIEW_TEX, { srgb: true });
    matcapMaterial = new THREE.MeshMatcapMaterial({ matcap: matcapTarget.texture, side: THREE.DoubleSide });
    viewer.onBeforeRender = () => {
      if (!texDirty) return;
      texDirty = false;
      painter.draw({ ...params(), bg: 'transparent' }, matcapTarget, PREVIEW_TEX);
    };
  } catch (err) {
    console.error(err);
    r.view.replaceChildren(Object.assign(el('p', 'mc-empty'), { textContent: 'This tool needs WebGL 2. Try an up-to-date Chrome, Edge, Firefox or Safari.' }));
  }

  let raf = 0;
  function changed() {
    preset = preset >= 0 && JSON.stringify(p) === JSON.stringify(fromPreset(PRESETS[preset])) ? preset : -1;
    texDirty = true;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(render);
    save();
  }
  function render() {
    syncPresets();
    placeHandles();
    const model = ui.view === 'model';
    r.settings.classList.toggle('is-normal', p.mode === 'normal');
    r.view.classList.toggle('is-model', model);
    r.view.classList.toggle('is-opaque', out.bg !== 'transparent');
    r.handles.hidden = p.mode === 'normal';
    r.handles.classList.toggle('is-over-model', model);
    r.hint.textContent = model ? 'Drag to orbit, scroll to zoom. Drag the dots to move lights. Drop a model file to preview it.'
      : p.mode === 'normal' ? 'Normal matcap: color = view-space normal.'
        : 'Click or drag on the sphere to move the selected light.';
    if (!viewer) return;
    viewer.setEnabled(visible && model);
    if (!visible) return;
    if (model) { viewer.render(); return; }
    if (!viewer.resize()) return;
    const size = viewer.renderer.getDrawingBufferSize(new THREE.Vector2()).x;
    painter.draw(params(), null, size);
  }
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }).observe(r.view);

  /* ── Model view: built-in shapes and the user's own model ── */
  const shapes = new Map();          // shape id -> mesh/object with the matcap material
  let customName = '';
  function useMatcap(obj) {
    obj.traverse(o => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material || [])) m.dispose?.();
      o.material = matcapMaterial;
    });
    return obj;
  }
  let shapeToken = 0;
  async function showShape() {
    if (!viewer) return;
    const id = ui.shape, token = ++shapeToken;
    let obj = shapes.get(id);
    if (!obj) {
      r.busy.hidden = false;
      try { obj = useMatcap(await createShape(id)); shapes.set(id, obj); }
      catch (err) { console.error(err); showToast('Could not load the ' + id + ' model'); }
      r.busy.hidden = true;
    }
    if (obj && token === shapeToken) viewer.setObject(obj, { dispose: false });
  }

  async function loadUserModel(files) {
    if (!viewer) return;
    r.busy.hidden = false;
    try {
      const { object, name } = await loadModel(files);
      const old = shapes.get('custom');
      if (old) {
        if (viewer.getObject() === old) viewer.setObject(null, { dispose: false });
        old.traverse(o => o.geometry?.dispose());
      }
      shapes.set('custom', useMatcap(object));
      customName = name.replace(/\.[^.]+$/, '');
      ui.shape = 'custom';
      ui.view = 'model';
      buildShapeBar();
      viewCtl.sync();
      viewer.resetView();
      await showShape();
      changed();
    } catch (err) {
      console.error(err);
      showToast('Could not open the model: ' + err.message);
    }
    r.busy.hidden = true;
  }

  r.load.addEventListener('click', () => {
    const f = Object.assign(document.createElement('input'), { type: 'file', accept: MODEL_ACCEPT + ',.bin,image/*', multiple: true });
    f.onchange = () => f.files.length && loadUserModel([...f.files]);
    f.click();
  });
  r.view.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    r.view.classList.add('is-dragover');
  });
  r.view.addEventListener('dragleave', () => r.view.classList.remove('is-dragover'));
  r.view.addEventListener('drop', e => {
    e.preventDefault();
    r.view.classList.remove('is-dragover');
    const files = [...e.dataTransfer.files];
    if (files.some(isModelFile)) loadUserModel(files);
    else showToast('Drop a ' + MODEL_EXTENSIONS.join(', ').toUpperCase() + ' file');
  });

  /* ── Controls ── */
  const ctls = [];
  const add = c => { ctls.push(c); return c.el; };
  function refresh() { ctls.forEach(c => c.sync()); renderLights(); changed(); }
  const bind = key => ({ get: () => p[key], set: v => { p[key] = v; }, def: DEFAULTS[key], onInput: changed, onCommit: commit });
  const lightBind = key => ({ get: () => p.lights[sel][key], set: v => { p.lights[sel][key] = v; }, onInput: changed, onCommit: commit });
  const deg = v => Math.round(v) + '°';

  function section(title, open, children) {
    const d = el('details', 'mc-sec');
    d.open = open;
    const s = el('summary');
    s.textContent = title;
    const body = el('div', 'mc-sec-body');
    body.append(...children);
    d.append(s, body);
    return d;
  }

  // Lights: chips to pick one, its settings below.
  const chips = el('div', 'mc-lights');
  const removeBtn = Object.assign(el('button', 'btn mc-remove'), { type: 'button', textContent: 'Remove light' });
  removeBtn.addEventListener('click', () => {
    if (p.lights.length < 2) return;
    p.lights.splice(sel, 1);
    sel = Math.min(sel, p.lights.length - 1);
    refresh(); commit();
  });
  function renderLights() {
    chips.replaceChildren(...p.lights.map((l, i) => {
      const b = el('button', 'mc-chip');
      b.type = 'button';
      b.textContent = i + 1;
      b.style.setProperty('--c', l.color);
      b.setAttribute('aria-pressed', i === sel);
      b.setAttribute('aria-label', 'Light ' + (i + 1));
      b.addEventListener('click', () => { sel = i; refresh(); });
      return b;
    }));
    if (p.lights.length < MAX_LIGHTS) {
      const addBtn = el('button', 'mc-chip mc-chip-add');
      addBtn.type = 'button';
      addBtn.title = 'Add light';
      addBtn.setAttribute('aria-label', 'Add light');
      addBtn.textContent = '+';
      addBtn.addEventListener('click', () => {
        p.lights.push({ x: .45, y: -.25, color: '#ffffff', intensity: .6, softness: .3 });
        sel = p.lights.length - 1;
        refresh(); commit();
      });
      chips.append(addBtn);
    }
    removeBtn.hidden = p.lights.length < 2;
  }

  r.settings.append(
    add(segmented({ label: 'Shading', options: [['shaded', 'Lit'], ['normal', 'Normal']], ...bind('mode') })),
    section('Lights', true, [
      chips,
      add(colorField({ label: 'Color', ...lightBind('color') })),
      add(slider({ label: 'Intensity', min: 0, max: 3, step: .01, ...lightBind('intensity') })),
      add(slider({ label: 'Softness', min: 0, max: 1, step: .01, ...lightBind('softness') })),
      removeBtn,
    ]),
    section('Material', true, [
      add(colorField({ label: 'Base color', ...bind('base') })),
      add(slider({ label: 'Ambient', min: 0, max: 1.5, step: .01, ...bind('ambient') })),
      add(colorField({ label: 'Sky', ...bind('sky') })),
      add(colorField({ label: 'Ground', ...bind('ground') })),
      add(slider({ label: 'Scatter', min: 0, max: 1.5, step: .01, ...bind('scatter') })),
      add(colorField({ label: 'Scatter color', ...bind('scatterColor') })),
    ]),
    section('Specular', true, [
      add(slider({ label: 'Strength', min: 0, max: 2, step: .01, ...bind('spec') })),
      add(slider({ label: 'Roughness', min: 0, max: 1, step: .01, ...bind('roughness') })),
      add(colorField({ label: 'Color', ...bind('specColor') })),
    ]),
    section('Reflection', false, [
      add(segmented({ label: 'Environment', options: [['studio', 'Studio'], ['sky', 'Sky'], ['horizon', 'Horizon']], ...bind('env') })),
      add(slider({ label: 'Strength', min: 0, max: 2, step: .01, ...bind('refl') })),
      add(slider({ label: 'Blur', min: 0, max: 1, step: .01, ...bind('blur') })),
      add(slider({ label: 'Metallic', min: 0, max: 1, step: .01, ...bind('metal') })),
      add(slider({ label: 'Rotation', min: -180, max: 180, step: 1, format: deg, ...bind('envRot') })),
    ]),
    section('Rim & edge', false, [
      add(slider({ label: 'Strength', min: 0, max: 1, step: .01, ...bind('rim') })),
      add(slider({ label: 'Width', min: 0, max: 1, step: .01, ...bind('rimWidth') })),
      add(colorField({ label: 'Color', ...bind('rimColor') })),
      add(slider({ label: 'Edge light', min: 0, max: 1, step: .01, ...bind('edgeLight') })),
      add(slider({ label: 'Edge shadow', min: 0, max: 1, step: .01, ...bind('edgeShadow') })),
      add(colorField({ label: 'Shadow color', ...bind('edgeShadowColor') })),
    ]),
    section('Stylize', false, [
      add(toggle({ label: 'Toon', ...bind('toon') })),
      add(slider({ label: 'Steps', min: 1, max: 6, step: 1, ...bind('steps') })),
      add(slider({ label: 'Edge softness', min: 0, max: 1, step: .01, ...bind('toonSoft') })),
      add(slider({ label: 'Outline', min: 0, max: .2, step: .001, format: v => (+v * 100).toFixed(1) + '%', ...bind('outline') })),
      add(colorField({ label: 'Outline color', ...bind('outlineColor') })),
      add(slider({ label: 'Stripes', min: 0, max: 40, step: 1, ...bind('stripes') })),
      add(slider({ label: 'Stripe width', min: .05, max: .95, step: .01, ...bind('stripeWidth') })),
      add(slider({ label: 'Stripe angle', min: 0, max: 180, step: 1, format: deg, ...bind('stripeAngle') })),
      add(colorField({ label: 'Stripe color', ...bind('stripeColor') })),
    ]),
    section('Adjust', false, [
      add(slider({ label: 'Exposure', min: -3, max: 3, step: .01, ...bind('exposure') })),
      add(slider({ label: 'Contrast', min: -1, max: 1, step: .01, ...bind('contrast') })),
      add(slider({ label: 'Saturation', min: 0, max: 2, step: .01, ...bind('saturation') })),
      add(slider({ label: 'Grain', min: 0, max: 1, step: .01, ...bind('grain') })),
    ]),
  );
  renderLights();

  /* ── View: sphere or model ── */
  const viewCtl = segmented({
    options: [['sphere', 'Sphere'], ['model', 'Model']],
    get: () => ui.view,
    set: v => { ui.view = v; shapeBar.hidden = v !== 'model'; if (v === 'model') showShape(); },
    onInput: changed,
  });
  r.viewBar.replaceWith(viewCtl.el);
  let shapeBar = r.shapeBar;
  function buildShapeBar() {
    const options = SHAPES.concat(shapes.has('custom') ? [['custom', customName.length > 14 ? customName.slice(0, 13) + '…' : customName, customName]] : []);
    const c = segmented({ options, get: () => ui.shape, set: v => { ui.shape = v; showShape(); }, onInput: changed });
    c.el.classList.add('mc-shapes');
    c.el.hidden = ui.view !== 'model';
    shapeBar.replaceWith(c.el);
    shapeBar = c.el;
  }
  buildShapeBar();
  if (ui.view === 'model') showShape();

  /* ── Light handles on the sphere ── */
  function placeHandles() {
    while (r.handles.children.length > p.lights.length) r.handles.lastChild.remove();
    while (r.handles.children.length < p.lights.length) {
      const h = el('button', 'mc-handle');
      h.type = 'button';
      r.handles.append(h);
    }
    p.lights.forEach((l, i) => {
      const h = r.handles.children[i];
      h.textContent = i + 1;
      h.dataset.i = i;
      h.style.left = (l.x + 1) * 50 + '%';
      h.style.top = (1 - l.y) * 50 + '%';
      h.style.setProperty('--c', l.color);
      h.setAttribute('aria-pressed', i === sel);
      h.setAttribute('aria-label', 'Light ' + (i + 1) + ' position. Arrow keys move it.');
    });
  }

  function discPoint(e) {
    const b = r.view.getBoundingClientRect();
    let x = (e.clientX - b.left) / b.width * 2 - 1, y = 1 - (e.clientY - b.top) / b.height * 2;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return [x, y];
  }

  // Lights live in the 2D disc of the matcap. On the sphere, a click anywhere places the
  // selected light; over the model the same disc spans the viewport, lights move by their
  // dots only, and a drag anywhere else orbits the camera.
  let drag = false;
  r.view.addEventListener('pointerdown', e => {
    if (!viewer || e.button !== 0 || p.mode === 'normal') return;
    const h = e.target.closest('.mc-handle');
    if (ui.view === 'model' && !h) return;
    e.preventDefault();
    r.view.setPointerCapture(e.pointerId);
    if (h) { sel = +h.dataset.i; renderLights(); ctls.forEach(c => c.sync()); }
    else { [p.lights[sel].x, p.lights[sel].y] = discPoint(e); }
    drag = true;
    r.view.classList.add('is-moving-light');
    changed();
  });
  r.view.addEventListener('pointermove', e => {
    if (!drag) return;
    [p.lights[sel].x, p.lights[sel].y] = discPoint(e);
    changed();
  });
  const endDrag = () => { if (drag) commit(); drag = false; r.view.classList.remove('is-moving-light'); };
  r.view.addEventListener('pointerup', endDrag);
  r.view.addEventListener('pointercancel', endDrag);
  r.handles.addEventListener('keydown', e => {
    const h = e.target.closest('.mc-handle');
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!h || !d) return;
    e.preventDefault();
    sel = +h.dataset.i;
    const l = p.lights[sel], step = e.shiftKey ? .1 : .02;
    let x = l.x + d[0] * step, y = l.y + d[1] * step;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    l.x = x; l.y = y;
    renderLights(); changed(); commit();
  });

  /* ── Presets ── */
  const thumbs = PRESETS.map((pr, i) => {
    const b = el('button', 'mc-preset');
    b.type = 'button';
    b.title = pr.name;
    b.setAttribute('aria-label', pr.name);
    const c = el('canvas');
    c.width = c.height = THUMB;
    b.append(c);
    b.addEventListener('click', () => {
      p = fromPreset(pr);
      sel = 0;
      preset = i;
      out.name = 'MatCap_' + pr.name.replace(/\s+/g, '');
      exportCtls.forEach(c => c.sync());
      refresh(); commit();
    });
    r.presets.append(b);
    return { b, c };
  });
  function drawThumbs() {
    if (!painter) return;
    PRESETS.forEach((pr, i) => {
      const px = painter.read({ ...fromPreset(pr), bg: 'transparent', bgColor: '#000000' }, THUMB);
      thumbs[i].c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer), THUMB, THUMB), 0, 0);
    });
  }
  function syncPresets() { thumbs.forEach(({ b }, i) => b.setAttribute('aria-pressed', i === preset)); }

  /* ── Export ── */
  const sizes = SIZES.filter(s => !painter || s <= painter.maxSize);
  const bgColorCtl = colorField({ label: 'Color', get: () => out.bgColor, set: v => { out.bgColor = v; }, onInput: changed });
  const exportCtls = [
    segmented({ label: 'Size', options: sizes.map(s => [s, String(s)]), get: () => out.size, set: v => { out.size = v; }, onInput: save }),
    segmented({
      label: 'Background',
      options: [
        ['extend', 'Extend', 'Stretch the edge colors outward (dilation), so filtering never picks up a foreign color'],
        ['color', 'Color', 'Solid color outside the sphere'],
        ['transparent', 'Transparent', 'Transparent outside the sphere'],
      ],
      get: () => out.bg, set: v => { out.bg = v; bgColorCtl.el.hidden = v !== 'color'; }, onInput: changed,
    }),
    bgColorCtl,
  ];
  bgColorCtl.el.hidden = out.bg !== 'color';
  exportCtls.push({ el: null, sync: () => { nameInput.value = out.name; } });

  const saveRow = el('div', 'mc-save');
  const nameLabel = el('label', 'mc-name');
  const nameInput = Object.assign(el('input'), { value: out.name, spellcheck: false });
  nameInput.setAttribute('aria-label', 'File name');
  nameInput.addEventListener('input', () => { out.name = nameInput.value; save(); });
  const ext = el('span');
  ext.textContent = '.png';
  nameLabel.append(nameInput, ext);
  const dl = el('button', 'btn btn-primary');
  dl.type = 'button';
  dl.append(icon('download'), document.createTextNode('Download PNG'));
  dl.disabled = !painter;
  dl.addEventListener('click', async () => {
    dl.disabled = true;
    try {
      const size = out.size, rgba = painter.read(params(), size);
      let px = rgba, ch = 4;
      if (out.bg !== 'transparent') {                   // opaque: drop the alpha channel
        ch = 3;
        px = new Uint8Array(size * size * 3);
        for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) { px[o] = rgba[i]; px[o + 1] = rgba[i + 1]; px[o + 2] = rgba[i + 2]; }
      }
      const name = (out.name.trim() || 'MatCap').replace(/\.png$/i, '').replace(/[\\/:*?"<>|]/g, '_');
      downloadBlob(await encodePNG({ W: size, H: size, px, ch }), name + '.png');
    } catch (err) { console.error(err); showToast('Could not save the file: ' + err.message); }
    dl.disabled = false;
  });
  saveRow.append(nameLabel, dl);
  const tip = el('p', 'mc-tip');
  tip.textContent = 'Blender: Preferences → Lights → MatCaps → Install. ZBrush: load it as a MatCap material.';
  r.export.append(...exportCtls.filter(c => c.el).map(c => add(c)), saveRow, tip);

  drawThumbs();
  changed();

  return {
    show() { visible = true; changed(); },
    hide() { visible = false; viewer?.setEnabled(false); },
  };
}
