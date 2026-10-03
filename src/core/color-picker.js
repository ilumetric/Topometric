// Color picker popover: a hue/saturation wheel (hue = angle, saturation = radius, drawn at
// the current lightness) and H, S, L strips, plus HEX, old/new compare and an eyedropper.
// One popover is shared by the whole page.
//
//   openColorPicker(anchorEl, { value: '#rrggbb', onInput(hex), onClose(changed) })
import { el } from './dom.js';

/* ── Color math (sRGB, same HSL model as CSS) ── */
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}
export function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return [f(0), f(8), f(4)];
}
export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, Math.min(1, s), l];
}
export function parseHex(text) {
  let t = text.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(t)) t = t.replace(/./g, c => c + c);
  return /^[0-9a-f]{6}$/i.test(t) ? '#' + t.toLowerCase() : null;
}

/* ── Popover ── */
const WHEEL = 184;
let ui = null;          // DOM, built on first use
let state = null;       // { h, s, l, original, hex, onInput, onClose, anchor }

function build() {
  const root = el('div', 'cp');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Color picker');
  root.hidden = true;

  const wheel = el('div', 'cp-wheel');
  wheel.tabIndex = 0;
  wheel.setAttribute('role', 'slider');
  wheel.setAttribute('aria-label', 'Hue and saturation. Left and right change hue, up and down change saturation.');
  const canvas = el('canvas');
  const marker = el('span', 'cp-marker');
  wheel.append(canvas, marker);

  const strip = (key, label, max, unit) => {
    const row = el('label', 'cp-strip');
    const name = el('span', 'cp-strip-label');
    name.textContent = label;
    const input = Object.assign(el('input', 'cp-range'), { type: 'range', min: 0, max, step: key === 'h' ? 1 : .1 });
    input.setAttribute('aria-label', { h: 'Hue', s: 'Saturation', l: 'Lightness' }[key]);
    const value = el('span', 'cp-strip-value');
    row.append(name, input, value);
    input.addEventListener('input', () => {
      state[key] = key === 'h' ? +input.value : input.value / 100;
      update({ wheel: key === 'l' });
    });
    return { row, input, value, unit };
  };
  const strips = { h: strip('h', 'H', 360, '°'), s: strip('s', 'S', 100, '%'), l: strip('l', 'L', 100, '%') };

  const foot = el('div', 'cp-foot');
  const compare = el('div', 'cp-compare');
  const now = el('span', 'cp-new');
  const old = el('button', 'cp-old');
  old.type = 'button';
  old.title = 'Back to the original color';
  old.setAttribute('aria-label', 'Back to the original color');
  compare.append(now, old);
  const hex = Object.assign(el('input', 'cp-hex'), { maxLength: 7, spellcheck: false, autocomplete: 'off' });
  hex.setAttribute('aria-label', 'HEX');
  foot.append(compare, hex);
  if ('EyeDropper' in window) {
    const pick = el('button', 'btn btn-icon btn-ghost cp-pick');
    pick.type = 'button';
    pick.title = 'Pick a color from the screen';
    pick.setAttribute('aria-label', 'Pick a color from the screen');
    pick.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>';
    pick.addEventListener('click', async () => {
      try { setHex((await new EyeDropper().open()).sRGBHex); } catch (_) { }
    });
    foot.append(pick);
  }

  root.append(wheel, strips.h.row, strips.s.row, strips.l.row, foot);
  document.body.append(root);

  // Wheel drag
  const fromPointer = e => {
    const b = wheel.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width * 2 - 1, y = 1 - (e.clientY - b.top) / b.height * 2;
    state.h = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    state.s = Math.min(1, Math.hypot(x, y));
    update();
  };
  wheel.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    wheel.focus();
    wheel.setPointerCapture(e.pointerId);
    fromPointer(e);
    wheel.onpointermove = fromPointer;
  });
  wheel.addEventListener('pointerup', () => { wheel.onpointermove = null; });
  wheel.addEventListener('keydown', e => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') state.h = (state.h + (e.key === 'ArrowLeft' ? step : -step) + 360) % 360;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') state.s = Math.max(0, Math.min(1, state.s + (e.key === 'ArrowUp' ? step : -step) / 100));
    else return;
    e.preventDefault();
    update();
  });

  hex.addEventListener('input', () => {
    const v = parseHex(hex.value);
    hex.classList.toggle('is-invalid', !v);
    if (v) setHex(v, { keepText: true });
  });
  hex.addEventListener('blur', () => { hex.value = state ? state.hex.toUpperCase() : ''; hex.classList.remove('is-invalid'); });
  old.addEventListener('click', () => setHex(state.original));

  // Close on outside click, Esc, scroll or resize.
  document.addEventListener('pointerdown', e => {
    if (state && !root.contains(e.target) && !state.anchor.contains(e.target)) close();
  }, true);
  document.addEventListener('keydown', e => { if (state && e.key === 'Escape') { e.preventDefault(); close(true); } });
  window.addEventListener('resize', () => state && close());
  document.addEventListener('scroll', e => { if (state && !root.contains(e.target)) close(); }, true);

  return { root, wheel, canvas, marker, strips, now, old, hex };
}

function drawWheel() {
  const dpr = Math.min(2, devicePixelRatio || 1), n = Math.round(WHEEL * dpr);
  const c = ui.canvas;
  c.width = c.height = n;
  const img = new ImageData(n, n), d = img.data, l = state.l, r0 = n / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x + .5 - r0) / r0, dy = (r0 - y - .5) / r0, r = Math.hypot(dx, dy);
    const a = Math.min(1, Math.max(0, (1 - r) * r0 + .5));       // antialiased edge
    if (a <= 0) continue;
    const [R, G, B] = hslToRgb((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, Math.min(1, r), l);
    const o = (y * n + x) * 4;
    d[o] = R; d[o + 1] = G; d[o + 2] = B; d[o + 3] = a * 255;
  }
  c.getContext('2d').putImageData(img, 0, 0);
}

function update({ wheel = false, fromHex = false, keepText = false } = {}) {
  const { h, s, l } = state;
  if (!fromHex) state.hex = rgbToHex(hslToRgb(h, s, l));
  if (wheel) drawWheel();
  const rad = h * Math.PI / 180;
  ui.marker.style.left = 50 + Math.cos(rad) * s * 50 + '%';
  ui.marker.style.top = 50 - Math.sin(rad) * s * 50 + '%';
  ui.marker.style.background = state.hex;
  ui.wheel.setAttribute('aria-valuetext', `Hue ${Math.round(h)}°, saturation ${Math.round(s * 100)}%`);
  const S = s * 100 + '%', L = l * 100 + '%';
  const tracks = {
    h: `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map(x => `hsl(${x} ${S} ${L})`).join(', ')})`,
    s: `linear-gradient(to right, hsl(${h} 0% ${L}), hsl(${h} 100% ${L}))`,
    l: `linear-gradient(to right, #000, hsl(${h} ${S} 50%), #fff)`,
  };
  for (const k of ['h', 's', 'l']) {
    const st = ui.strips[k], v = k === 'h' ? h : state[k] * 100;
    st.input.value = v;
    st.input.style.setProperty('--track', tracks[k]);
    st.value.textContent = Math.round(v) + st.unit;
  }
  ui.now.style.background = state.hex;
  if (!keepText) ui.hex.value = state.hex.toUpperCase();
  state.onInput?.(state.hex);
}

function setHex(hex, { keepText = false } = {}) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  // Keep hue/saturation where they carry no information (grays, black, white).
  if (s > 0 && l > 0 && l < 1) state.h = h;
  if (l > 0 && l < 1) state.s = s;
  state.l = l;
  state.hex = hex;
  update({ wheel: true, fromHex: true, keepText });
}

function place(anchor) {
  const a = anchor.getBoundingClientRect(), r = ui.root;
  const w = r.offsetWidth, h = r.offsetHeight, m = 8;
  const left = Math.min(Math.max(m, a.right - w), innerWidth - w - m);
  const below = a.bottom + 6, above = a.top - h - 6;
  const top = below + h <= innerHeight - m || above < m ? Math.min(below, innerHeight - h - m) : above;
  r.style.left = left + 'px';
  r.style.top = Math.max(m, top) + 'px';
}

function close(restoreFocus) {
  if (!state) return;
  const { onClose, original, hex, anchor } = state;
  state = null;
  ui.root.hidden = true;
  anchor.setAttribute('aria-expanded', 'false');
  if (restoreFocus) anchor.focus();
  onClose?.(hex !== original);
}

export function openColorPicker(anchor, { value, onInput, onClose }) {
  ui = ui || build();
  if (state) { const same = state.anchor === anchor; close(); if (same) return; }
  const [h, s, l] = rgbToHsl(hexToRgb(value));
  state = { h, s, l, hex: value, original: value, onInput: null, onClose, anchor };
  ui.old.style.background = value;
  ui.root.hidden = false;
  update({ wheel: true });
  state.onInput = onInput;
  anchor.setAttribute('aria-expanded', 'true');
  place(anchor);
  ui.wheel.focus({ preventScroll: true });
}
