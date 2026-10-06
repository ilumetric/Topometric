// Presets, the same way in every tool: the tool's built-in presets plus the user's own,
// kept in this browser (localStorage, one list per tool). A preset holds only a tool's
// parameters — never images — and can be downloaded as a small JSON file and imported
// again anywhere. A file always says which tool it belongs to, so importing it from any
// tool's page adds it to the right list.
//
// File format:
//   { "format": "topometric-preset", "version": 1, "tool": "<tool id>",
//     "presets": [{ "name": "…", "params": { … } }] }
import { el, icon, downloadBlob } from './dom.js';
import { TOOLS } from '../tools/registry.js';

const FORMAT = 'topometric-preset';
const EVENT = 'topometric-presets';
const MAX_NAME = 60;
const storeKey = tool => 'topometric-presets-' + tool;
const toolTitle = id => TOOLS.find(t => t.id === id)?.title || id;

function readStore(tool) {
  try {
    const list = JSON.parse(localStorage.getItem(storeKey(tool)));
    return Array.isArray(list) ? list.filter(p => p && typeof p.name === 'string' && isObject(p.params)) : [];
  } catch (_) { return []; }
}
// Throws when storage is full or blocked; every picker of this tool redraws.
function writeStore(tool, list) {
  localStorage.setItem(storeKey(tool), JSON.stringify(list));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: tool }));
}

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
// JSON with sorted keys, so two equal parameter sets compare equal whatever their key order.
const canon = v => JSON.stringify(v, (k, x) => isObject(x) ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const cleanName = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
const fileSafe = s => s.replace(/[\\/:*?"<>|]+/g, '_');

// Takes the values of `src` that `defaults` also has, with the same type; everything else
// comes from `defaults`. Tools use it to read parameters from a file safely.
export function mergeKnown(defaults, src) {
  const out = structuredClone(defaults);
  if (!isObject(src)) return out;
  for (const k of Object.keys(defaults)) {
    const v = src[k], d = defaults[k];
    if (v === undefined || v === null) continue;
    if (typeof d === 'number' ? Number.isFinite(v) : Array.isArray(d) ? Array.isArray(v) : typeof v === typeof d) out[k] = structuredClone(v);
  }
  return out;
}

function presetFile(tool, version, presets) {
  const body = { format: FORMAT, version, tool, presets: presets.map(p => ({ name: p.name, params: p.params })) };
  return new Blob([JSON.stringify(body, null, 2) + '\n'], { type: 'application/json' });
}

// Adds the presets in JSON files to the lists of the tools they belong to.
// Returns { [tool]: count }; throws with a readable message for a bad file.
async function importFiles(files) {
  const added = {};
  for (const file of files) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (_) { throw new Error(file.name + ' is not a preset file'); }
    if (data?.format !== FORMAT || !Array.isArray(data.presets)) throw new Error(file.name + ' is not a Topometric preset file');
    if (!TOOLS.some(t => t.id === data.tool)) throw new Error(file.name + ' is for a tool this version doesn\'t have');
    const list = readStore(data.tool);
    for (const p of data.presets) {
      const name = cleanName(p?.name) || 'Imported', params = p?.params;
      if (!isObject(params)) continue;
      const key = canon(params);
      if (list.some(q => q.name === name && canon(q.params) === key)) continue;      // already there
      let unique = name;
      for (let n = 2; list.some(q => q.name.toLowerCase() === unique.toLowerCase()); n++) unique = `${name} (${n})`;
      list.push({ id: newId(), name: unique, params, v: data.version || 1, at: Date.now() });
      added[data.tool] = (added[data.tool] || 0) + 1;
    }
    writeStore(data.tool, list);
  }
  return added;
}

/* Preset card for a tool.
     tool      tool id (the storage list and the "tool" field of files)
     builtins  [{ name, params }] shown first; they can't be deleted
     get       () => the current parameters (plain JSON data)
     normalize optional params => full params: fills in defaults and drops unknown keys, so a
               preset from an older or hand-edited file applies and highlights correctly
     apply     (params, { name, builtin }) => sets the (normalized) parameters
     thumb     optional (params, canvas) => draws a preview; without it presets are name chips
     labels    false: thumbnails only, names as tooltips
     version   format version of this tool's params, saved with each preset
   Returns { el, sync }; call sync() after the parameters change, to update the highlight. */
export function presetPicker({ tool, builtins = [], get, apply, normalize, thumb, labels = true, tile = 64, version = 1, showToast }) {
  const root = el('div', 'ps');
  const title = toolTitle(tool);

  /* ── Header: Save, Import, Download all ── */
  const head = el('div', 'vw-head ps-head');
  const h = el('span');
  h.textContent = 'Presets';
  const tools = el('div', 'ps-tools');
  const saveBtn = smallBtn('Save', 'Save the current settings as a preset', 'save');
  const importBtn = smallBtn('Import', 'Add presets from .json files', 'upload');
  const allBtn = smallBtn('', 'Download all your saved presets as one file', 'download');
  tools.append(saveBtn, importBtn, allBtn);
  head.append(h, tools);

  /* ── Name form for saving ── */
  const form = el('form', 'ps-form');
  form.hidden = true;
  const nameField = el('label', 'vw-name ps-name');
  const input = Object.assign(el('input'), { maxLength: MAX_NAME, spellcheck: false, placeholder: 'Preset name' });
  input.setAttribute('aria-label', 'Preset name');
  nameField.append(input);
  const ok = Object.assign(el('button', 'btn btn-primary ps-ok'), { type: 'submit', textContent: 'Save' });
  const cancel = Object.assign(el('button', 'btn btn-ghost ps-cancel'), { type: 'button', textContent: 'Cancel' });
  form.append(nameField, ok, cancel);

  const grid = el('div', 'ps-list ' + (thumb ? 'is-tiles' : 'is-chips') + (labels ? '' : ' no-labels'));
  grid.style.setProperty('--tile', tile + 'px');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', title + ' presets');
  const hint = el('p', 'vw-tip ps-hint');
  hint.textContent = 'Your presets are kept in this browser. Download them to keep a copy or share them; Import or drop a .json file here to add them back.';
  root.append(head, form, grid, hint);

  const norm = params => {
    try { return normalize ? normalize(structuredClone(params)) : structuredClone(params); }
    catch (err) { console.error(err); return structuredClone(params); }
  };
  let user = readStore(tool);
  let items = [];                       // rendered presets: { key, node }
  let lastUser = '';                    // name of the saved preset picked or saved last: Save offers to update it
  const thumbs = new Map();             // params key -> canvas, drawn once

  function smallBtn(text, tip, iconName) {
    const b = el('button', 'btn btn-ghost ps-btn' + (text ? '' : ' btn-icon'));
    b.type = 'button';
    b.title = tip;
    if (!text) b.setAttribute('aria-label', tip);
    b.append(icon(iconName));
    if (text) b.append(document.createTextNode(text));
    return b;
  }

  // Each preview is drawn once per parameter set, then copied into the tile's own canvas
  // (the same parameters can show up twice, as a built-in and as a saved copy).
  function preview(params, key) {
    let t = thumbs.get(key);
    if (!t) {
      const src = el('canvas');
      src.width = src.height = 128;
      t = { src, ready: Promise.resolve().then(() => thumb(structuredClone(params), src)) };
      t.ready.catch(err => console.error(err));
      thumbs.set(key, t);
    }
    const c = el('canvas');
    c.width = c.height = 1;
    t.ready.then(() => {
      c.width = t.src.width; c.height = t.src.height;
      c.getContext('2d').drawImage(t.src, 0, 0);
    }, () => { });
    return c;
  }

  function render() {
    grid.replaceChildren();
    items = [];
    const add = (p, builtin, index) => {
      const params = norm(p.params), key = canon(params);
      const node = el('div', 'ps-item' + (builtin ? '' : ' is-user'));
      const pick = el('button', 'ps-pick');
      pick.type = 'button';
      pick.title = builtin ? p.name : p.name + ' — double-click to rename';
      if (!labels) pick.setAttribute('aria-label', p.name);
      if (thumb) pick.append(preview(params, key));
      const name = el('span', 'ps-label');
      name.textContent = p.name;
      if (labels || !thumb) pick.append(name);
      pick.addEventListener('click', () => {
        apply(structuredClone(params), { name: p.name, builtin });
        lastUser = builtin ? '' : p.name;
        sync();
      });
      if (!builtin) pick.addEventListener('dblclick', () => rename(p, node));
      const acts = el('div', 'ps-acts');
      const dl = actBtn('Download this preset', 'download');
      dl.addEventListener('click', () => downloadBlob(presetFile(tool, version, [p]), fileSafe(`${title} - ${p.name}.json`)));
      acts.append(dl);
      if (!builtin) {
        const del = actBtn('Delete this preset', 'trash');
        del.addEventListener('click', () => remove(index));
        acts.append(del);
      }
      node.append(pick, acts);
      grid.append(node);
      items.push({ key, node });
    };
    builtins.forEach(p => add(p, true));
    if (user.length && builtins.length) {
      const sep = el('div', 'ps-sep');
      sep.textContent = 'Saved';
      grid.append(sep);
    }
    user.forEach((p, i) => add(p, false, i));
    if (!builtins.length && !user.length) {
      const empty = el('p', 'vw-tip ps-empty');
      empty.textContent = 'No presets yet. Save the current settings to make one.';
      grid.append(empty);
    }
    allBtn.disabled = !user.length;
    sync();
  }
  function actBtn(tip, iconName) {
    const b = el('button', 'ps-act');
    b.type = 'button';
    b.title = tip;
    b.setAttribute('aria-label', tip);
    b.append(icon(iconName));
    return b;
  }

  // Highlights every preset equal to the current parameters.
  function sync() {
    let now;
    try { now = canon(get()); } catch (_) { return; }
    items.forEach(({ key, node }) => node.querySelector('.ps-pick').setAttribute('aria-pressed', key === now));
  }

  function store(list, done) {
    try { writeStore(tool, list); done?.(); }
    catch (err) { console.error(err); showToast('Could not save presets: the browser\'s storage is full or blocked'); user = readStore(tool); render(); }
  }

  /* ── Save ── */
  const findUser = name => user.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
  function syncOk() { ok.textContent = findUser(cleanName(input.value)) >= 0 ? 'Replace' : 'Save'; }
  saveBtn.addEventListener('click', () => {
    if (!form.hidden) { input.focus(); return; }
    const now = canon(get()), same = user.find(p => canon(norm(p.params)) === now);
    let n = user.length + 1;
    while (findUser('Preset ' + n) >= 0) n++;
    input.value = same ? same.name : lastUser && findUser(lastUser) >= 0 ? lastUser : 'Preset ' + n;
    form.hidden = false;
    syncOk();
    input.focus();
    input.select();
  });
  input.addEventListener('input', syncOk);
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); form.hidden = true; } });
  cancel.addEventListener('click', () => { form.hidden = true; });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = cleanName(input.value);
    if (!name) { input.focus(); return; }
    const params = structuredClone(get()), list = user.slice(), i = findUser(name);
    if (i >= 0) list[i] = { ...list[i], params, v: version, at: Date.now() };
    else list.push({ id: newId(), name, params, v: version, at: Date.now() });
    store(list, () => { form.hidden = true; lastUser = name; showToast((i >= 0 ? 'Updated “' : 'Saved “') + name + '”'); });
  });

  /* ── Rename, delete ── */
  function rename(p, node) {
    const label = node.querySelector('.ps-label');
    if (!label || node.querySelector('.ps-rename')) return;
    const field = Object.assign(el('input', 'ps-rename'), { value: p.name, maxLength: MAX_NAME, spellcheck: false });
    field.setAttribute('aria-label', 'New name');
    label.replaceWith(field);
    field.focus();
    field.select();
    let done = false;
    const finish = keep => {
      if (done) return;
      done = true;
      const name = cleanName(field.value), i = user.findIndex(q => q.id === p.id);
      if (!keep || !name || name === p.name || i < 0) { render(); return; }
      if (user.some(q => q.id !== p.id && q.name.toLowerCase() === name.toLowerCase())) { showToast('A preset named “' + name + '” already exists'); render(); return; }
      const list = user.slice();
      list[i] = { ...list[i], name };
      store(list);
    };
    field.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    field.addEventListener('blur', () => finish(true));
    field.addEventListener('click', e => e.stopPropagation());
  }
  function remove(i) {
    const list = user.slice(), [gone] = list.splice(i, 1);
    store(list, () => showToast('Deleted “' + gone.name + '”', {
      action: 'Undo',
      onAction: () => { const back = readStore(tool); back.splice(Math.min(i, back.length), 0, gone); store(back); },
    }));
  }

  /* ── Import and download ── */
  async function importAndReport(files) {
    const json = files.filter(f => /\.json$/i.test(f.name) || f.type === 'application/json');
    if (!json.length) { showToast('Drop a preset .json file'); return; }
    try {
      const added = await importFiles(json);
      const parts = Object.entries(added).map(([t, n]) => `${n} preset${n > 1 ? 's' : ''}` + (t === tool ? '' : ' to ' + toolTitle(t)));
      showToast(parts.length ? 'Added ' + parts.join(', ') : 'These presets are already here');
    } catch (err) { console.warn(err); showToast(err.message.includes('storage') ? 'Could not save presets: the browser\'s storage is full or blocked' : err.message); }
  }
  importBtn.addEventListener('click', () => {
    const f = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json', multiple: true });
    f.onchange = () => f.files.length && importAndReport([...f.files]);
    f.click();
  });
  allBtn.addEventListener('click', () => {
    if (user.length) downloadBlob(presetFile(tool, version, user), fileSafe(`${title} - presets.json`));
  });
  root.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    root.classList.add('is-dragover');
  });
  root.addEventListener('dragleave', e => { if (!root.contains(e.relatedTarget)) root.classList.remove('is-dragover'); });
  root.addEventListener('drop', e => {
    e.preventDefault();
    root.classList.remove('is-dragover');
    importAndReport([...e.dataTransfer.files]);
  });

  // Lists change from this card, an import on another tool's page, or another tab.
  window.addEventListener(EVENT, e => { if (e.detail === tool) { user = readStore(tool); render(); } });
  window.addEventListener('storage', e => { if (e.key === storeKey(tool)) { user = readStore(tool); render(); } });

  render();
  return { el: root, sync };
}
