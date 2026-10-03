// Form controls shared by tools. Each one is bound to a getter/setter pair and
// returns { el, sync }: `sync()` redraws it from the current value after outside changes.
//   onInput  — fires on every change while dragging/typing
//   onCommit — fires once the change is finished (used for undo)
import { el } from './dom.js';
import { openColorPicker } from './color-picker.js';

function labelEl(text) {
  const s = el('span', 'ctl-label');
  s.textContent = text;
  return s;
}

// Range slider with a live value. Double-click the label to reset to `def`.
export function slider({ label, min, max, step, get, set, def, format, onInput, onCommit }) {
  const root = el('div', 'ctl ctl-slider');
  const name = labelEl(label);
  const input = Object.assign(el('input', 'range'), { type: 'range', min, max, step });
  input.setAttribute('aria-label', label);
  const value = el('output', 'ctl-value');
  const fmt = format || (v => (+v).toFixed(step >= 1 ? 0 : 2));
  function sync() {
    const v = get();
    input.value = v;
    value.textContent = fmt(v);
    input.style.setProperty('--p', ((v - min) / (max - min) * 100) + '%');
  }
  input.addEventListener('input', () => { set(+input.value); sync(); onInput?.(); });
  input.addEventListener('change', () => onCommit?.());
  if (def !== undefined) {
    name.title = 'Double-click to reset';
    name.addEventListener('dblclick', () => { set(def); sync(); onInput?.(); onCommit?.(); });
  }
  root.append(name, input, value);
  sync();
  return { el: root, sync };
}

// Color swatch with its HEX code; opens the shared color picker (wheel + HSL strips).
export function colorField({ label, get, set, onInput, onCommit }) {
  const root = el('div', 'ctl ctl-color');
  const swatch = el('button', 'swatch');
  swatch.type = 'button';
  swatch.setAttribute('aria-label', label);
  swatch.setAttribute('aria-haspopup', 'dialog');
  swatch.setAttribute('aria-expanded', 'false');
  const value = el('span', 'ctl-value');
  function sync() {
    const v = get();
    value.textContent = v.toUpperCase();
    swatch.style.setProperty('--c', v);
  }
  swatch.addEventListener('click', () => openColorPicker(swatch, {
    value: get(),
    onInput: v => { set(v); sync(); onInput?.(); },
    onClose: changed => { if (changed) onCommit?.(); },
  }));
  const name = labelEl(label);
  name.addEventListener('click', () => swatch.click());
  root.append(name, swatch, value);
  sync();
  return { el: root, sync };
}

// A row of mutually exclusive buttons. options: [[value, text, title?], …]
export function segmented({ label, options, get, set, onInput, onCommit }) {
  const root = el('div', 'ctl ctl-seg');
  const group = el('div', 'seg');
  group.setAttribute('role', 'group');
  if (label) { root.append(labelEl(label)); group.setAttribute('aria-label', label); }
  const buttons = options.map(([v, text, title]) => {
    const b = el('button');
    b.type = 'button'; b.textContent = text; b.dataset.v = v;
    if (title) b.title = title;
    b.addEventListener('click', () => { if (get() === v) return; set(v); sync(); onInput?.(); onCommit?.(); });
    group.append(b);
    return b;
  });
  function sync() { buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v) === String(get()))); }
  root.append(group);
  sync();
  return { el: root, sync };
}

// On/off switch.
export function toggle({ label, get, set, onInput, onCommit }) {
  const root = el('div', 'ctl ctl-toggle');
  const b = el('button', 'switch');
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-label', label);
  function sync() { b.setAttribute('aria-checked', !!get()); }
  b.addEventListener('click', () => { set(!get()); sync(); onInput?.(); onCommit?.(); });
  root.append(labelEl(label), b);
  sync();
  return { el: root, sync };
}
