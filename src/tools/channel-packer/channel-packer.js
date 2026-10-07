/* Channel Packer
   Inputs are loaded textures with R G B A outputs, the result has four inputs.
   Wires are dragged from channel to channel. Alpha is written only when input A
   is connected and enabled; otherwise the file is saved without an alpha channel.

   Decoding happens here (core/image.js, the browser decoder needs the main thread);
   everything full-size — resampling, packing, encoding — runs in worker.js. */
import { el, icon, downloadBlob } from '../../core/dom.js';
import { sendTo } from '../../core/handoff.js';
import { decodeImage as decode, IMAGE_ACCEPT as ACCEPT, isImageFile } from '../../core/image.js';

const CH = ['R', 'G', 'B', 'A'];
const COLORS = ['var(--ch-r)', 'var(--ch-g)', 'var(--ch-b)', 'var(--ch-a)'];
const MAX_INPUTS = 4;
const POW2 = [128, 256, 512, 1024, 2048, 4096, 8192];
const DEFAULT_NAME = 'T_Packed_01';
const INFO_TEXT = 'In Unreal, uncheck sRGB and set Compression Settings to Masks (no sRGB).';
const SVG_NS = 'http://www.w3.org/2000/svg';

const TEMPLATE = `
  <header class="page-header">
    <div class="container">
      <h1>Channel Packer</h1>
      <p>Load textures and drag wires from their channels to the output channels. Everything runs locally — files never leave your computer.</p>
    </div>
  </header>
  <div class="page-body">
    <div class="container">
      <div class="pk-graph" data-ref="graph">
        <svg class="pk-wires" data-ref="wires" aria-hidden="true"></svg>

        <div class="pk-inputs" data-ref="inputs">
          <label class="pk-drop" data-ref="drop">
            <input type="file" data-ref="file" accept="${ACCEPT}" multiple hidden>
            <svg class="icon"><use href="#i-upload" /></svg>
            <span><b>Add textures</b><br>PNG, JPG, TGA — or drop them here</span>
          </label>
        </div>

        <div class="pk-node pk-out">
          <div class="pk-out-body">
            <div class="pk-out-socks" data-ref="outSocks"></div>
            <div class="pk-view">
              <div class="pk-preview" data-ref="previewBox">
                <canvas data-ref="preview" width="1" height="1"></canvas>
                <p class="pk-empty" data-ref="empty">Connect channels</p>
              </div>
              <div class="pk-chips" data-ref="chips" role="group" aria-label="What to save">
                <button type="button" data-view="rgb" aria-pressed="true" title="Save all channels">RGB</button>
                <span class="pk-chips-sep" aria-hidden="true"></span>
                <button type="button" data-view="0" title="Save only R as grayscale">R</button>
                <button type="button" data-view="1" title="Save only G as grayscale">G</button>
                <button type="button" data-view="2" title="Save only B as grayscale">B</button>
                <button type="button" data-view="3" title="Save only A as grayscale">A</button>
              </div>
            </div>
          </div>
          <div class="pk-size">
            <span>Size</span>
            <select data-ref="size" aria-label="Output size"></select>
            <span class="pk-custom" data-ref="custom" hidden>
              <select data-ref="w" aria-label="Width"></select>
              <span>×</span>
              <select data-ref="h" aria-label="Height"></select>
            </span>
          </div>
          <div class="pk-space">
            <span>Values</span>
            <div class="pk-format" data-ref="space" role="group" aria-label="Values">
              <button type="button" data-space="srgb" aria-pressed="true" title="Values as they are, for textures imported with sRGB on">sRGB</button>
              <button type="button" data-space="linear" aria-pressed="false" title="For textures imported with sRGB off (Unreal: sRGB unchecked, Grayscale or Masks): R, G and B are converted from sRGB to linear so they look the same in the engine; alpha is kept">Linear</button>
            </div>
          </div>
          <div class="pk-save">
            <label class="pk-name"><input data-ref="name" value="${DEFAULT_NAME}" spellcheck="false" aria-label="File name"><span data-ref="ext">.tga</span></label>
            <div class="pk-format" data-ref="format" role="group" aria-label="File format">
              <button type="button" data-format="tga" aria-pressed="true">TGA</button>
              <button type="button" data-format="png" aria-pressed="false">PNG</button>
            </div>
            <button type="button" class="btn btn-primary" data-ref="download" disabled>
              <svg class="icon"><use href="#i-download" /></svg><span data-ref="downloadLabel">Download</span>
            </button>
          </div>
          <button type="button" class="btn btn-ghost pk-send" data-ref="send" disabled title="Open the packed map in Kuwahator to paint it with brush strokes">
            <svg class="icon"><use href="#i-brush" /></svg><span>Open in Kuwahator</span>
          </button>
          <p class="pk-info" data-ref="info">${INFO_TEXT}</p>
        </div>
      </div>
    </div>
  </div>`;

// Small nearest-pixel copy for thumbnails, alpha ignored.
function drawThumb(canvas, w, h, data, max) {
  const k = Math.min(1, max / Math.max(w, h));
  const pw = Math.max(1, Math.round(w * k)), ph = Math.max(1, Math.round(h * k));
  canvas.width = pw; canvas.height = ph;
  const img = new ImageData(pw, ph), d = img.data;
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(h - 1, Math.floor((y + .5) * h / ph));
    for (let x = 0; x < pw; x++) {
      const i = (sy * w + Math.min(w - 1, Math.floor((x + .5) * w / pw))) * 4, o = (y * pw + x) * 4;
      d[o] = data[i]; d[o + 1] = data[i + 1]; d[o + 2] = data[i + 2]; d[o + 3] = 255;
    }
  }
  canvas.getContext('2d').putImageData(img, 0, 0);
}

/* ═══ UI ═══ */
export function mount(root, { showToast }) {
  root.innerHTML = TEMPLATE;
  const r = {};
  root.querySelectorAll('[data-ref]').forEach(n => { r[n.dataset.ref] = n; });
  const { graph, wires, drop, outSocks, preview, previewBox, info, chips } = r;
  const inputsEl = r.inputs, fileInput = r.file, sizeSel = r.size, downloadBtn = r.download;
  const chipA = chips.querySelector('[data-view="3"]');

  let sizeMode = 'auto', customW = 2048, customH = 2048;   // auto | in:<id> | custom
  let inputs = [];                        // { id, name, w, h, el, thumb, meta, pick, rm }
  let nextId = 1;
  const links = [null, null, null, null]; // per output channel: { id, ch } or null
  const fill = [0, 0, 0];                 // value of an unconnected R G B
  const invert = [false, false, false, false];
  let alphaOn = false, view = 'rgb', format = 'tga', space = 'srgb';
  let current = null;                     // what the output is right now: { job, mixed, stretched } or null
  let out = null;                         // last preview from the worker: { pw, ph, preview }

  /* ── Worker ── */
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  let composeSeq = 0, busy = false, dirty = false, encodeSeq = 0;
  const encodes = new Map();

  worker.onmessage = ({ data: m }) => {
    if (m.type === 'composed' || (m.type === 'error' && m.op === 'compose')) {
      busy = false;
      if (m.type === 'error') showToast('Could not pack: ' + m.message);
      if (dirty) requestCompose();
      else if (m.type === 'composed' && m.seq === composeSeq) { out = m; renderPreview(); }
      previewBox.classList.toggle('is-busy', busy);
    } else if (m.type === 'encoded' || m.type === 'pixels' || (m.type === 'error' && (m.op === 'encode' || m.op === 'pixels'))) {
      const p = encodes.get(m.seq);
      encodes.delete(m.seq);
      if (m.type === 'error') p?.reject(new Error(m.message)); else p?.resolve(m.type === 'pixels' ? m : m.blob);
    }
  };
  worker.onerror = e => { console.error(e); showToast('The processing worker failed to start'); };

  // At most one compose in flight; changes made meanwhile are merged into one follow-up.
  function requestCompose() {
    if (!current) { composeSeq++; out = null; renderPreview(); return; }
    if (busy) { dirty = true; return; }
    busy = true; dirty = false;
    worker.postMessage({ type: 'compose', seq: ++composeSeq, job: current.job });
    previewBox.classList.toggle('is-busy', true);
  }

  function encode(job, type = 'encode') {
    return new Promise((resolve, reject) => {
      const seq = ++encodeSeq;
      encodes.set(seq, { resolve, reject });
      worker.postMessage({ type, seq, job, view, format, linear: space === 'linear' });
    });
  }

  /* ── Sockets ── */
  function socket(side, ch, id) {
    const b = el('button', 'pk-sock');
    b.type = 'button';
    b.dataset.side = side; b.dataset.ch = ch;
    if (id) b.dataset.id = id;
    b.setAttribute('aria-label', (side === 'in' ? 'Output ' : 'Input ') + CH[ch]);
    return b;
  }

  function row(sock, label, extra, reverse) {
    const rw = el('div', 'pk-row');
    const span = el('span'); span.textContent = label;
    if (reverse) { if (extra) rw.append(...extra); rw.append(span, sock); } else { rw.append(sock, span); if (extra) rw.append(...extra); }
    return rw;
  }

  // Output inputs: R G B have fill value and invert, A has on/off and invert.
  const outRefs = CH.map((_, ch) => {
    const sock = socket('out', ch);
    const inv = el('button', 'pk-mini');
    inv.type = 'button'; inv.textContent = 'INV'; inv.title = 'Invert channel';
    inv.setAttribute('aria-pressed', 'false');
    inv.addEventListener('click', () => { invert[ch] = !invert[ch]; inv.setAttribute('aria-pressed', invert[ch]); update(); });
    let extra;
    if (ch < 3) {
      extra = el('button', 'pk-mini pk-fill');
      extra.type = 'button'; extra.dataset.v = 0; extra.title = 'Value when unconnected: black or white';
      extra.setAttribute('aria-label', 'Channel ' + CH[ch] + ' value when unconnected');
      extra.addEventListener('click', () => { fill[ch] = fill[ch] ? 0 : 255; extra.dataset.v = fill[ch]; update(); });
    } else {
      extra = el('button', 'pk-mini');
      extra.type = 'button'; extra.textContent = 'OFF'; extra.title = 'Write the alpha channel';
      extra.setAttribute('aria-pressed', 'false');
      extra.addEventListener('click', () => {
        alphaOn = !alphaOn;
        extra.setAttribute('aria-pressed', alphaOn); extra.textContent = alphaOn ? 'ON' : 'OFF';
        update();
      });
    }
    outSocks.appendChild(row(sock, CH[ch], [inv, extra]));
    return { sock, extra, inv };
  });

  /* ── Input textures ── */
  async function addFiles(files) {
    for (const file of files) {
      if (inputs.length >= MAX_INPUTS) { showToast('Up to ' + MAX_INPUTS + ' textures'); break; }
      try { addInput(file.name, await decode(file)); }
      catch (err) { console.error(err); showToast('Could not read ' + file.name); }
    }
    update();
  }

  function addInput(name, img) {
    const id = String(nextId++);
    const node = el('div', 'pk-node pk-in');
    // The preview is a replace button: the new file takes the old one's place, wires stay.
    const pick = el('button', 'pk-pick');
    pick.type = 'button'; pick.title = 'Replace texture';
    const thumb = el('canvas', 'pk-thumb');
    pick.append(thumb, icon('upload'));
    pick.addEventListener('click', () => {
      const f = Object.assign(document.createElement('input'), { type: 'file', accept: ACCEPT });
      f.onchange = () => f.files[0] && replaceInput(id, f.files[0]);
      f.click();
    });
    const meta = el('div', 'pk-meta');
    const rm = el('button', 'btn btn-icon btn-ghost pk-remove');
    rm.type = 'button';
    rm.append(icon('x'));
    rm.addEventListener('click', () => removeInput(id));
    const socks = el('div', 'pk-socks');
    CH.forEach((c, ch) => socks.appendChild(row(socket('in', ch, id), c, null, true)));
    node.append(pick, meta, rm, socks);
    node.dataset.id = id;
    inputsEl.insertBefore(node, drop);
    const inp = { id, el: node, thumb, meta, pick, rm };
    inputs.push(inp);
    setImage(inp, name, img);
  }

  function setImage(inp, name, { w, h, data, note }) {
    Object.assign(inp, { name, w, h });
    drawThumb(inp.thumb, w, h, data, 144);
    // The full-size pixels move to the worker; this thread keeps only the thumbnail.
    worker.postMessage({ type: 'set', id: inp.id, w, h, data }, [data.buffer]);
    const t = el('b'); t.textContent = name; t.title = name;
    const size = el('span'); size.textContent = w + ' × ' + h;
    inp.meta.replaceChildren(t, size);
    if (note) { const n = el('span', 'pk-note'); n.textContent = note; inp.meta.append(n); }
    inp.pick.setAttribute('aria-label', 'Replace ' + name);
    inp.rm.setAttribute('aria-label', 'Remove ' + name);
  }

  async function replaceInput(id, file) {
    const inp = inputs.find(i => i.id === id);
    if (!inp) return;
    try { setImage(inp, file.name, await decode(file)); }
    catch (err) { console.error(err); showToast('Could not read ' + file.name); return; }
    update();
  }

  function removeInput(id) {
    inputs.find(i => i.id === id)?.el.remove();
    inputs = inputs.filter(i => i.id !== id);
    links.forEach((l, ch) => { if (l && l.id === id) links[ch] = null; });
    worker.postMessage({ type: 'remove', id });
    update();
  }

  /* ── Wires ── */
  function connect(a, b) {
    const src = a.dataset.side === 'in' ? a : b, dst = a.dataset.side === 'in' ? b : a;
    if (src.dataset.side !== 'in' || dst.dataset.side !== 'out' || dst.disabled) return false;
    links[+dst.dataset.ch] = { id: src.dataset.id, ch: +src.dataset.ch };
    update();
    return true;
  }

  function center(node) {
    const g = graph.getBoundingClientRect(), b = node.getBoundingClientRect();
    return [b.left + b.width / 2 - g.left, b.top + b.height / 2 - g.top];
  }
  function curve([x1, y1], [x2, y2]) {
    const dx = Math.max(40, Math.abs(x2 - x1) * .5);
    return `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
  }
  const inSock = l => inputsEl.querySelector(`.pk-sock[data-id="${l.id}"][data-ch="${l.ch}"]`);
  let temp = null;

  function drawWires() {
    wires.replaceChildren();
    links.forEach((l, ch) => {
      const src = l && inSock(l);
      if (!src) return;
      const d = curve(center(src), center(outRefs[ch].sock));
      const hit = document.createElementNS(SVG_NS, 'path');
      hit.setAttribute('d', d); hit.setAttribute('class', 'pk-hit');
      hit.addEventListener('click', () => { links[ch] = null; update(); });
      const line = document.createElementNS(SVG_NS, 'path');
      line.setAttribute('d', d); line.setAttribute('class', 'pk-line');
      line.style.stroke = COLORS[l.ch];
      if (ch === 3 && !alphaOn) line.style.strokeOpacity = '.3';
      wires.append(hit, line);
    });
    if (temp) wires.appendChild(temp);
  }

  // Drag to connect; or click one socket, then the other.
  let drag = null, pending = null;
  graph.addEventListener('pointerdown', e => {
    const sock = e.target.closest('.pk-sock');
    if (!sock || sock.disabled || e.button !== 0) return;
    e.preventDefault();
    let from = sock;
    if (sock.dataset.side === 'out' && links[+sock.dataset.ch]) {
      // Dragging a connected output input picks the wire up and moves it with the cursor.
      from = inSock(links[+sock.dataset.ch]);
      links[+sock.dataset.ch] = null;
      update();
    }
    drag = { from, sock, x: e.clientX, y: e.clientY, moved: false };
    sock.setPointerCapture(e.pointerId);
  });
  graph.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
    drag.moved = true;
    const g = graph.getBoundingClientRect(), p = [e.clientX - g.left, e.clientY - g.top], a = center(drag.from);
    temp = temp || document.createElementNS(SVG_NS, 'path');
    temp.setAttribute('class', 'pk-line pk-temp');
    temp.style.stroke = COLORS[+drag.from.dataset.ch];
    temp.setAttribute('d', drag.from.dataset.side === 'in' ? curve(a, p) : curve(p, a));
    if (!temp.isConnected) wires.appendChild(temp);
  });
  graph.addEventListener('pointerup', e => {
    if (!drag) return;
    const { from, sock, moved } = drag;
    drag = null;
    if (temp) { temp.remove(); temp = null; }
    if (moved) {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pk-sock');
      if (target && target !== from) connect(from, target);
      setPending(null);
    } else if (pending && pending !== sock && connect(pending, sock)) setPending(null);
    else setPending(pending === sock ? null : sock);
  });
  graph.addEventListener('pointercancel', () => { drag = null; if (temp) { temp.remove(); temp = null; } });
  // Keyboard: Enter on one socket, then on another.
  graph.addEventListener('keydown', e => {
    const sock = e.target.closest('.pk-sock');
    if (!sock || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    if (pending && pending !== sock && connect(pending, sock)) setPending(null);
    else setPending(pending === sock ? null : sock);
  });
  function setPending(s) {
    pending?.classList.remove('is-pending');
    pending = s;
    pending?.classList.add('is-pending');
  }

  /* ── Output ── */
  function outSize(active) {
    if (sizeMode === 'custom') return { W: customW, H: customH };
    const src = sizeMode.startsWith('in:') && inputs.find(i => 'in:' + i.id === sizeMode);
    if (src) return { W: src.w, H: src.h };
    const big = active.reduce((a, b) => b.w * b.h > a.w * a.h ? b : a);
    return { W: big.w, H: big.h };
  }

  // "Size" list: auto, the size of any input, or custom.
  function syncSize() {
    if (sizeMode.startsWith('in:') && !inputs.some(i => 'in:' + i.id === sizeMode)) sizeMode = 'auto';
    const opts = [['auto', 'Auto — largest input']]
      .concat(inputs.map(i => ['in:' + i.id, i.name + ' · ' + i.w + ' × ' + i.h]))
      .concat([['custom', 'Custom size']]);
    sizeSel.replaceChildren(...opts.map(([v, t]) => { const o = el('option'); o.value = v; o.textContent = t; return o; }));
    sizeSel.value = sizeMode;
    r.custom.hidden = sizeMode !== 'custom';
  }

  // The job the worker packs; also decides output size and what to report about it.
  function describe() {
    const used = links.map((l, ch) => l && (ch < 3 || alphaOn) ? inputs.find(i => i.id === l.id) : null);
    const active = used.filter(Boolean);
    if (!active.length) return null;
    const { W, H } = outSize(active);
    const chans = used.map((inp, ch) => inp ? { id: inp.id, ch: links[ch].ch, inv: invert[ch] }
      : { value: ch < 3 ? (invert[ch] ? 255 - fill[ch] : fill[ch]) : 255 });
    return {
      job: { W, H, alpha: !!used[3], chans },
      mixed: active.some(i => i.w !== W || i.h !== H),
      stretched: active.some(i => Math.abs(i.w / i.h - W / H) > 1e-3),
    };
  }

  function renderPreview() {
    r.empty.hidden = !!out;
    preview.hidden = !out;
    if (!out) return;
    const { pw, ph, preview: s } = out, c = view === 'rgb' ? -1 : +view;
    preview.width = pw; preview.height = ph;
    const img = new ImageData(pw, ph), d = img.data;
    for (let o = 0; o < s.length; o += 4) {
      if (c < 0) { d[o] = s[o]; d[o + 1] = s[o + 1]; d[o + 2] = s[o + 2]; }
      else d[o] = d[o + 1] = d[o + 2] = s[o + c];
      d[o + 3] = 255;
    }
    preview.getContext('2d').putImageData(img, 0, 0);
  }

  let raf = 0;
  function update() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      outRefs.forEach(({ sock, extra }, ch) => {
        sock.classList.toggle('is-linked', !!links[ch]);
        if (ch < 3) extra.hidden = !!links[ch];
      });
      outRefs[3].sock.disabled = !alphaOn;
      inputsEl.querySelectorAll('.pk-sock').forEach(s =>
        s.classList.toggle('is-linked', links.some(l => l && l.id === s.dataset.id && l.ch === +s.dataset.ch)));
      drop.hidden = inputs.length >= MAX_INPUTS;
      syncSize();
      current = describe();
      downloadBtn.disabled = !current;
      r.send.disabled = !current;
      // A without alpha is solid white, nothing to save
      chipA.disabled = !current || !current.job.alpha;
      if (view === '3' && chipA.disabled) setView('rgb');
      else showMode();
      drawWires();
      requestCompose();
    });
  }

  r.format.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    format = b.dataset.format;
    r.ext.textContent = '.' + format;
    r.format.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
  });

  r.space.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    space = b.dataset.space;
    r.space.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    showMode();
  });

  [r.w, r.h].forEach(sel => sel.replaceChildren(...POW2.map(v => { const o = el('option'); o.value = v; o.textContent = v; return o; })));
  sizeSel.addEventListener('change', () => {
    if (sizeSel.value === 'custom' && sizeMode !== 'custom' && current) {
      // a custom size starts from the current one, rounded to a power of two
      const near = v => POW2.reduce((a, b) => Math.abs(Math.log2(b / v)) < Math.abs(Math.log2(a / v)) ? b : a);
      customW = near(current.job.W); customH = near(current.job.H);
    }
    sizeMode = sizeSel.value;
    r.w.value = customW; r.h.value = customH;
    update();
  });
  r.w.addEventListener('change', () => { customW = +r.w.value; update(); });
  r.h.addEventListener('change', () => { customH = +r.h.value; update(); });

  // R/G/B/A chip: save a single channel as grayscale.
  function showMode() {
    const one = view !== 'rgb';
    r.downloadLabel.textContent = one ? 'Download ' + CH[+view] : 'Download';
    if (!current) { info.textContent = INFO_TEXT; return; }
    const { job: { W, H, alpha }, stretched, mixed } = current;
    info.textContent = W + ' × ' + H + ', ' +
      (one ? CH[+view] + ' only, grayscale' : alpha ? 'RGBA' : 'RGB, no alpha') +
      (space === 'linear' && view !== '3' ? ', linear values' : '') +
      (stretched ? '. Input aspect ratios differ — they are stretched.' : mixed ? '. Inputs are resized to this size.' : '.') + ' ' + INFO_TEXT;
  }
  function setView(v) {
    view = v;
    chips.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.view === v));
    showMode();
    renderPreview();
  }
  chips.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && !b.disabled) setView(b.dataset.view);
  });

  const fileBase = () => (r.name.value.trim() || DEFAULT_NAME).replace(/\.(png|tga)$/i, '').replace(/[\\/:*?"<>|]/g, '_');

  downloadBtn.addEventListener('click', async () => {
    if (!current) return;
    downloadBtn.disabled = true;
    try { downloadBlob(await encode(current.job), fileBase() + '.' + format); }
    catch (err) { showToast('Could not save the file: ' + err.message); }
    downloadBtn.disabled = !current;
  });

  // The full packed map goes to Kuwahator, which opens with it.
  r.send.addEventListener('click', async () => {
    if (!current) return;
    r.send.disabled = true;
    try {
      const { W, H, data } = await encode(current.job, 'pixels');
      const base = fileBase();
      sendTo('kuwahator', { name: base + ' (Channel Packer)', base, w: W, h: H, data, packed: true });
    } catch (err) { showToast('Could not send the map: ' + err.message); }
    r.send.disabled = !current;
  });

  /* ── Loading files ── */
  fileInput.addEventListener('change', () => { addFiles([...fileInput.files]); fileInput.value = ''; });
  graph.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    const card = e.target.closest?.('.pk-in');
    graph.classList.toggle('is-dragover', !card);
    inputsEl.querySelectorAll('.pk-in').forEach(c => c.classList.toggle('is-target', c === card));
  });
  graph.addEventListener('dragleave', e => {
    if (graph.contains(e.relatedTarget)) return;
    graph.classList.remove('is-dragover');
    inputsEl.querySelectorAll('.is-target').forEach(c => c.classList.remove('is-target'));
  });
  graph.addEventListener('drop', e => {
    e.preventDefault();
    graph.classList.remove('is-dragover');
    const files = [...e.dataTransfer.files].filter(isImageFile);
    // A file dropped on a card replaces its texture.
    const card = e.target.closest?.('.pk-in');
    inputsEl.querySelectorAll('.is-target').forEach(c => c.classList.remove('is-target'));
    if (card && files.length) { replaceInput(card.dataset.id, files[0]); return; }
    addFiles(files);
  });

  // Example on first open: three grayscale maps already wired to R, G and B.
  function sample(name, fn, size = 512) {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const v = fn(x / (size - 1), y / (size - 1)) * 255, o = (y * size + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
    }
    addInput(name, { w: size, h: size, data });
  }
  sample('Radial_Gradient', (u, v) => 1 - Math.min(1, Math.hypot(u - .5, v - .5) * 1.6));
  sample('Linear_Gradient', u => u);
  sample('Checker', (u, v) => (Math.floor(u * 7.999) + Math.floor(v * 7.999)) % 2 ? .9 : .1);
  inputs.forEach((inp, ch) => links[ch] = { id: inp.id, ch: 0 });

  new ResizeObserver(() => drawWires()).observe(graph);
  update();

  return { show: () => requestAnimationFrame(drawWires) };
}
