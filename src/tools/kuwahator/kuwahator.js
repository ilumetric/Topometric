/* Kuwahator
   Anisotropic Kuwahara filter: turns a texture into painted strokes that follow its
   shapes. The filter runs on the GPU in tiles (kuwahara.js), the result is shown in a
   zoomable viewer (viewer.js), and the file is read back from an 8-bit target and written
   by our own TGA/PNG encoders. */
import { el, icon, downloadBlob, isTyping } from '../../core/dom.js';
import { encodePNG, encodeTGA } from '../../core/codecs.js';
import { decodeImage, IMAGE_ACCEPT, isImageFile } from '../../core/image.js';
import { slider, segmented, toggle } from '../../core/controls.js';
import { receive } from '../../core/handoff.js';
import { createKuwahara } from './kuwahara.js';
import { createViewer } from '../../core/image-viewer.js';

const STORE_KEY = 'topometric-kuwahator-v1';
const SAMPLE_SIZE = 1024;
const DEFAULTS = { radius: 6, smoothness: .35, sharpness: .5, anisotropy: 1 };
const CH = ['R', 'G', 'B', 'A'];

const TEMPLATE = `
  <header class="page-header">
    <div class="container">
      <h1>Kuwahator</h1>
      <p>Turn a texture into painted strokes with an anisotropic Kuwahara filter. Runs on your GPU — files never leave your computer.</p>
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
          <button type="button" class="vw-toggle" data-ref="tiled" aria-pressed="false" title="Repeat the image in every direction (T)">Tiled</button>
          <button type="button" class="vw-toggle" data-ref="compare" aria-pressed="false" title="Before / after split (C)">Compare</button>
          <div class="vw-group vw-chips" data-ref="chips" role="group" aria-label="Channels">
            <button type="button" data-chan="-1" aria-pressed="true" title="Color">RGB</button>
            <button type="button" data-chan="0" title="Red as grayscale">R</button>
            <button type="button" data-chan="1" title="Green as grayscale">G</button>
            <button type="button" data-chan="2" title="Blue as grayscale">B</button>
            <button type="button" data-chan="3" title="Alpha as grayscale">A</button>
          </div>
        </div>
        <div class="vw-view" data-ref="view">
          <canvas data-ref="canvas"></canvas>
          <div class="vw-split" data-ref="split" hidden>
            <span class="vw-split-label is-before">Before</span>
            <span class="vw-split-label is-after">After</span>
            <button type="button" class="vw-split-knob" data-ref="knob" aria-label="Move the before/after divider"></button>
          </div>
          <div class="vw-progress" data-ref="progress"></div>
          <p class="vw-msg" data-ref="msg" hidden></p>
        </div>
        <p class="vw-hint">Scroll to zoom, drag to pan, double-click for 1:1. Drop an image anywhere on the view.</p>
      </div>
      <div class="vw-panel">
        <div class="vw-card" data-ref="settings"></div>
        <div class="vw-card" data-ref="export"></div>
      </div>
    </div>
  </div>`;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (_) { return {}; }
}

export function mount(root, { showToast }) {
  root.innerHTML = TEMPLATE;
  const r = {};
  root.querySelectorAll('[data-ref]').forEach(n => { r[n.dataset.ref] = n; });
  r.open.prepend(icon('upload'));

  /* ── State ── */
  const saved = load();
  const p = { ...DEFAULTS, ...saved.p };                                    // Color mode
  const pc = CH.map((_, i) => ({ on: true, ...DEFAULTS, ...saved.pc?.[i] }));  // Per channel mode
  let edit = 0;                                                             // channel being edited
  const cur = () => out.mode === 'color' ? p : pc[edit];
  const out = { mode: 'color', format: 'tga', ...saved.out };
  let image = { name: 'Sample', w: SAMPLE_SIZE, h: SAMPLE_SIZE, note: '', data: null };   // data: null = built-in sample
  let fileName = 'T_Sample_Kuwahara';
  let seamless = false;                     // filter across the edges: keeps a tileable texture tileable
  let visible = false;
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ p, pc, out })); } catch (_) { } }, 300);
  }

  /* ── GPU ── */
  const glOpts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false };
  let gl = r.canvas.getContext('webgl2', glOpts), engine = null, viewer = null;
  function fail(text) {
    r.msg.textContent = text;
    r.msg.hidden = false;
    dl.disabled = true;
  }
  function loadSource() {
    if (image.data) engine.setSource(image);
    else engine.setSample(SAMPLE_SIZE, SAMPLE_SIZE);
  }
  function initGL() {
    engine = createKuwahara(gl);
    if (viewer) viewer.build(gl); else viewer = createViewer(gl, r.canvas);
    viewer.onChange = requestDraw;
    loadSource();
  }
  // A heavy radius on a huge map can make the driver reset the GPU; rebuild and carry on.
  r.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); engine = null; fail('The GPU was reset. Restoring…'); });
  r.canvas.addEventListener('webglcontextrestored', () => {
    try { initGL(); r.msg.hidden = true; dl.disabled = false; run(); }
    catch (err) { console.error(err); fail('The GPU was reset. Reload the page to continue.'); }
  });

  /* ── Frame loop: feeds tiles to the GPU and redraws the view ── */
  let raf = 0, dirty = true, wasBusy = false;
  function requestDraw() {
    dirty = true;
    syncZoom();
    if (!raf && visible) raf = requestAnimationFrame(frame);
  }
  function frame() {
    raf = 0;
    if (!visible || !engine || gl.isContextLost()) return;
    const busy = engine.step();
    if (busy || wasBusy) dirty = true;
    if (!busy && wasBusy) engine.updateMips();
    wasBusy = busy;
    if (dirty) {
      dirty = false;
      viewer.draw(engine.result, engine.source, engine.mipsFresh ? 99 : 0);
    }
    r.progress.style.setProperty('--p', engine.progress);
    r.progress.classList.toggle('is-on', busy);
    if (busy) raf = requestAnimationFrame(frame);
  }
  function run() {
    if (!engine) return;
    engine.start(out.mode === 'color' ? p : pc.map(q => q.on ? q : null), viewer.focus(), out.mode, seamless);
    requestDraw();
  }

  /* ── Viewer bar ── */
  function syncZoom() {
    if (!viewer) return;
    const z = viewer.zoom * 100;
    r.zoom.textContent = (z >= 10 ? Math.round(z) : z.toFixed(1)) + '%';
    r.one.setAttribute('aria-pressed', Math.abs(viewer.zoom - 1) < 1e-6);
    r.fit.setAttribute('aria-pressed', viewer.fitted);
  }
  r.fit.addEventListener('click', () => viewer?.fit());
  r.one.addEventListener('click', () => viewer?.zoomAt(1));

  function setCompare(on) {
    if (!viewer) return;
    viewer.split = on ? (viewer.split >= 0 ? viewer.split : .5) : -1;
    r.compare.setAttribute('aria-pressed', on);
    r.split.hidden = !on;
    placeSplit();
    requestDraw();
  }
  function placeSplit() { if (viewer && viewer.split >= 0) r.split.style.left = viewer.split * 100 + '%'; }
  r.compare.addEventListener('click', () => setCompare(viewer.split < 0));
  function setTiled(on) {
    if (!viewer) return;
    viewer.tiled = on;
    r.tiled.setAttribute('aria-pressed', on);
    viewer.fit();
  }
  r.tiled.addEventListener('click', () => setTiled(!viewer.tiled));
  r.knob.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    r.knob.setPointerCapture(e.pointerId);
    const move = ev => {
      const b = r.view.getBoundingClientRect();
      viewer.split = Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width));
      placeSplit();
      requestDraw();
    };
    r.knob.onpointermove = move;
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

  function setChannel(c) {
    if (!viewer) return;
    viewer.chan = c;
    r.chips.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.chan === c));
    requestDraw();
  }
  r.chips.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && !b.disabled) setChannel(+b.dataset.chan);
  });

  document.addEventListener('keydown', e => {
    if (!visible || !viewer || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyF') viewer.fit();
    else if (e.code === 'Digit1' || e.code === 'Numpad1') viewer.zoomAt(1);
    else if (e.code === 'KeyC') setCompare(viewer.split < 0);
    else if (e.code === 'KeyT') setTiled(!viewer.tiled);
    else return;
    e.preventDefault();
  });

  /* ── Settings ── */
  const ctls = [];
  const add = c => { ctls.push(c); return c.el; };
  const changed = () => { run(); save(); };
  const bind = key => ({ get: () => cur()[key], set: v => { cur()[key] = v; }, def: DEFAULTS[key], onInput: changed });
  const head = el('div', 'vw-head');
  head.textContent = 'Filter';
  const reset = el('button', 'btn btn-ghost vw-reset');
  reset.type = 'button';
  reset.textContent = 'Reset';
  reset.title = 'Reset the settings shown below';
  reset.addEventListener('click', () => { Object.assign(cur(), DEFAULTS); syncSettings(); changed(); });
  head.append(reset);

  // Per channel: pick a channel to edit; each one has its own settings and can be left as is.
  const chanRow = el('div', 'kw-chans');
  const chanBtns = CH.map((c, i) => {
    const b = el('button', 'kw-ch');
    b.type = 'button';
    b.textContent = c;
    b.dataset.ch = i;
    b.addEventListener('click', () => { edit = i; syncSettings(); setChannel(i); });
    chanRow.append(b);
    return b;
  });
  const onCtl = toggle({ label: 'Filter R', get: () => pc[edit].on, set: v => { pc[edit].on = v; }, onInput: () => { syncSettings(); changed(); } });
  const sliders = el('div', 'kw-sliders');
  sliders.append(
    add(slider({ label: 'Radius', min: 1, max: 32, step: .5, format: v => (+v).toFixed(1) + ' px', ...bind('radius') })),
    add(slider({ label: 'Smoothness', min: 0, max: 1, step: .01, ...bind('smoothness') })),
    add(slider({ label: 'Sharpness', min: 0, max: 1, step: .01, ...bind('sharpness') })),
    add(slider({ label: 'Anisotropy', min: 0, max: 1, step: .01, ...bind('anisotropy') })),
  );
  const modeCtl = segmented({
    label: 'Mode',
    options: [
      ['color', 'Color', 'All channels together: strokes follow the color image'],
      ['channels', 'Per channel', 'Each channel on its own, with its own settings — for packed masks'],
    ],
    get: () => out.mode,
    set: v => { out.mode = v; setChannel(v === 'color' ? -1 : edit); },
    onInput: () => { syncSettings(); changed(); },
  });
  const tip = el('p', 'vw-tip');

  function syncSettings() {
    const per = out.mode === 'channels', alpha = engine ? !engine.opaque : false;
    if (!alpha && edit === 3) edit = 0;
    chanRow.hidden = !per;
    onCtl.el.hidden = !per;
    chanBtns.forEach((b, i) => {
      b.setAttribute('aria-pressed', i === edit);
      b.classList.toggle('is-off', !pc[i].on);
      b.disabled = i === 3 && !alpha;
      b.title = CH[i] + (pc[i].on ? '' : ' — not filtered');
    });
    onCtl.el.querySelector('.ctl-label').textContent = 'Filter ' + CH[edit];
    onCtl.sync();
    sliders.classList.toggle('is-off', per && !pc[edit].on);
    ctls.forEach(c => c.sync());
    tip.textContent = per
      ? 'Each channel is filtered as a grayscale mask with its own settings. Turn a channel off to keep it as it is.'
      : 'Radius is in pixels of the image. Smoothness blends the strokes into each other, Sharpness keeps edges crisp, Anisotropy stretches strokes along the shapes. Double-click a label to reset it.';
  }
  const seamCtl = toggle({
    label: 'Seamless', get: () => seamless, set: v => { seamless = v; },
    onInput: () => { if (seamless && !viewer.tiled) setTiled(true); run(); },
  });
  seamCtl.el.title = 'Filter across the edges, so a tileable texture stays tileable';
  r.settings.append(head, modeCtl.el, chanRow, onCtl.el, sliders, seamCtl.el, tip);

  /* ── Export ── */
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
  const info = el('p', 'vw-tip');
  const saveRow = el('div', 'vw-save');
  saveRow.append(nameLabel, formatCtl.el);
  r.export.append(saveRow, dl, info);

  function syncInfo() {
    ext.textContent = '.' + out.format;
    const alpha = engine ? !engine.opaque : false;
    info.textContent = `${image.name} · ${image.w} × ${image.h} · saved as ${alpha ? 'RGBA' : 'RGB'}` + (image.note ? ` · ${image.note}` : '') + '.';
    r.chips.querySelector('[data-chan="3"]').disabled = !alpha;
    if (!alpha && viewer?.chan === 3) setChannel(out.mode === 'color' ? -1 : 0);
    syncSettings();
  }

  dl.addEventListener('click', async () => {
    if (!engine) return;
    dl.disabled = true;
    try {
      const [W, H] = engine.size, rgba = engine.read();
      let px = rgba, ch = 4;
      if (engine.opaque) {
        ch = 3;
        px = new Uint8Array(W * H * 3);
        for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) { px[o] = rgba[i]; px[o + 1] = rgba[i + 1]; px[o + 2] = rgba[i + 2]; }
      }
      const img = { W, H, px, ch };
      const blob = out.format === 'png' ? await encodePNG(img) : encodeTGA(img);
      const base = (fileName.trim() || 'Kuwahara').replace(/\.(png|tga)$/i, '').replace(/[\\/:*?"<>|]/g, '_');
      downloadBlob(blob, base + '.' + out.format);
    } catch (err) { console.error(err); showToast('Could not save the file: ' + err.message); }
    dl.disabled = !engine;
    requestDraw();
  });

  /* ── Loading images ── */
  function setImage({ name, w, h, data, note }, base) {
    engine.setSource({ w, h, data });
    image = { name, w, h, note: note || '', data };
    fileName = base + '_Kuwahara';
    nameInput.value = fileName;
    viewer.setImage(w, h);
    syncInfo();
    run();
  }
  async function openFile(file) {
    if (!engine) return;
    try { setImage({ name: file.name, ...await decodeImage(file) }, file.name.replace(/\.[^.]+$/, '')); }
    catch (err) {
      console.error(err);
      showToast('Could not open ' + file.name + (err.message ? ': ' + err.message : ''));
    }
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
  try {
    if (!gl) throw new Error('no WebGL 2');
    initGL();
    viewer.setImage(SAMPLE_SIZE, SAMPLE_SIZE);
    if (out.mode === 'channels') setChannel(edit);
    setCompare(true);                     // before/after split is on from the start
  } catch (err) {
    console.error(err);
    engine = null;
    fail(gl ? 'Could not start the GPU filter: ' + err.message : 'This tool needs WebGL 2. Try an up-to-date Chrome, Edge, Firefox or Safari.');
  }
  syncInfo();
  new ResizeObserver(() => { viewer?.resize(); placeSplit(); requestDraw(); }).observe(r.view);

  let started = false;
  return {
    show() {
      visible = true;
      // the first filter pass waits for the view to have a size, so it starts where the user looks
      // an image sent from another tool (Channel Packer) replaces the current one
      const sent = receive('kuwahator');
      if (sent && engine) {
        started = true;
        viewer.resize();
        // packed maps are masks: filter each channel on its own
        if (sent.packed) { out.mode = 'channels'; modeCtl.sync(); setChannel(edit); syncSettings(); }
        // a seamless texture from Tile Maker: keep it seamless and show it tiled
        seamless = !!sent.tileable; seamCtl.sync();
        if (seamless !== viewer.tiled) setTiled(seamless);
        setImage(sent, sent.base);
      } else if (!started && engine) { started = true; viewer.resize(); viewer.fit(); run(); }
      requestDraw();
    },
    hide() { visible = false; cancelAnimationFrame(raf); raf = 0; },
  };
}
