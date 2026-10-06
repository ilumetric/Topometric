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


// The card's styles ship with this module (not in base.css), so a browser that still has an
// older base.css cached never shows the card unstyled.
const CSS = new URL('./presets.css', import.meta.url).href;
if (![...document.styleSheets].some(s => s.href === CSS) && !document.querySelector(`link[href="${CSS}"]`)) {
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: CSS }));
}

/* Preset card for a tool.
     tool      tool id (the storage list and the "tool" field of files)
     builtins  [{ name, params }] shown first; they can't be renamed or deleted
     get       () => the current parameters (plain JSON data)
     normalize optional params => full params: fills in defaults and drops unknown keys, so a
               preset from an older or hand-edited file applies and highlights correctly
     apply     (params, { name, builtin }) => sets the (normalized) parameters
     thumb     optional (params, canvas) => draws a preview; without it presets are name chips
     labels    false: thumbnails only, names as tooltips
     tile      smallest thumbnail width, px
     version   format version of this tool's params, saved with each preset
   Returns { el, sync }; call sync() after the parameters change, to update the highlight.

   Clicking a preset only ever applies it. Everything else — download, rename, delete,
   import — sits in the ⋯ menu and acts on the selected preset, so nothing is hit by accident. */
export function presetPicker({ tool, builtins = [], get, apply, normalize, thumb, labels = true, tile = 64, version = 1, showToast }) {
  const root = el('div', 'ps');
  const title = toolTitle(tool);
  const norm = params => {
    try { return normalize ? normalize(structuredClone(params)) : structuredClone(params); }
    catch (err) { console.error(err); return structuredClone(params); }
  };

  /* ── Header: Save and the ⋯ menu ── */
  const head = el('div', 'ps-head');
  const h = el('span', 'ps-title');
  h.textContent = 'Presets';
  const saveBtn = el('button', 'ps-hbtn');
  saveBtn.type = 'button';
  saveBtn.title = 'Save the current settings as a preset';
  saveBtn.append(icon('save'), document.createTextNode('Save'));
  const moreBtn = el('button', 'ps-hbtn ps-more');
  moreBtn.type = 'button';
  moreBtn.title = 'More: download, rename, delete, import';
  moreBtn.setAttribute('aria-label', 'More preset actions');
  moreBtn.setAttribute('aria-haspopup', 'menu');
  moreBtn.setAttribute('aria-expanded', 'false');
  moreBtn.append(icon('more'));
  const menu = el('div', 'ps-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const right = el('div', 'ps-hright');
  right.append(saveBtn, moreBtn, menu);
  head.append(h, right);

  /* ── Name form: save or rename ── */
  const form = el('form', 'ps-form');
  form.hidden = true;
  const input = Object.assign(el('input', 'ps-input'), { maxLength: MAX_NAME, spellcheck: false, placeholder: 'Preset name' });
  input.setAttribute('aria-label', 'Preset name');
  const ok = Object.assign(el('button', 'ps-ok'), { type: 'submit', textContent: 'Save' });
  const cancel = el('button', 'ps-cancel');
  cancel.type = 'button';
  cancel.title = 'Cancel (Esc)';
  cancel.setAttribute('aria-label', 'Cancel');
  cancel.append(icon('x'));
  form.append(input, ok, cancel);

  const list = el('div', 'ps-list ' + (thumb ? 'is-tiles' : 'is-chips') + (labels ? '' : ' no-labels'));
  list.style.setProperty('--tile', tile + 'px');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', title + ' presets');
  root.append(head, form, list);

  let user = readStore(tool);
  let items = [];                       // rendered presets: { p, builtin, key, pick }
  let picked = null;                    // the preset applied or saved last: { builtin, id | name }
  let formMode = 'save', renaming = null;
  const thumbs = new Map();             // params key -> { src, ready }

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
    list.replaceChildren();
    items = [];
    const add = (p, builtin) => {
      const params = norm(p.params), key = canon(params);
      const pick = el('button', 'ps-pick');
      pick.type = 'button';
      pick.title = p.name;
      if (thumb) pick.append(preview(params, key));
      if (labels || !thumb) {
        const name = el('span', 'ps-label');
        name.textContent = p.name;
        pick.append(name);
      } else pick.setAttribute('aria-label', p.name);
      pick.addEventListener('click', () => {
        apply(structuredClone(params), { name: p.name, builtin });
        picked = builtin ? { builtin, name: p.name } : { builtin, id: p.id };
        sync();
      });
      list.append(pick);
      items.push({ p, builtin, key, pick });
    };
    builtins.forEach(p => add(p, true));
    if (user.length) {
      const sep = el('div', 'ps-sep');
      sep.textContent = 'Saved';
      list.append(sep);
    }
    user.forEach(p => add(p, false));
    if (!builtins.length && !user.length) {
      const empty = el('p', 'ps-empty');
      empty.textContent = 'No presets yet — Save keeps the current settings as one.';
      list.append(empty);
    }
    sync();
  }

  // Highlights the presets equal to the current settings.
  let now = '';
  function sync() {
    try { now = canon(get()); } catch (_) { return; }
    items.forEach(({ key, pick }) => pick.setAttribute('aria-pressed', key === now));
  }

  // The preset the menu acts on: the one picked last if it still matches the settings,
  // else any preset that matches, else the one picked last.
  function target() {
    const last = picked && items.find(i => i.builtin === picked.builtin && (i.builtin ? i.p.name === picked.name : i.p.id === picked.id));
    if (last && last.key === now) return last;
    return items.find(i => i.key === now && !i.builtin) || items.find(i => i.key === now) || last || null;
  }

  function store(next, done) {
    try { writeStore(tool, next); done?.(); }
    catch (err) { console.error(err); showToast('Could not save presets: the browser\'s storage is full or blocked'); user = readStore(tool); render(); }
  }

  /* ── Save and rename ── */
  const findUser = name => user.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
  function syncOk() {
    const name = cleanName(input.value), i = findUser(name);
    ok.textContent = formMode === 'rename' ? 'Rename' : i >= 0 ? 'Replace' : 'Save';
    ok.disabled = !name || (formMode === 'rename' && i >= 0 && user[i].id !== renaming.id);
  }
  function openForm(mode, value) {
    formMode = mode;
    input.value = value;
    form.hidden = false;
    syncOk();
    input.focus();
    input.select();
  }
  saveBtn.addEventListener('click', () => {
    if (!form.hidden && formMode === 'save') { input.focus(); return; }
    const t = target();
    let n = user.length + 1;
    while (findUser('Preset ' + n) >= 0) n++;
    openForm('save', t && !t.builtin ? t.p.name : 'Preset ' + n);
  });
  input.addEventListener('input', syncOk);
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); form.hidden = true; } });
  cancel.addEventListener('click', () => { form.hidden = true; });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = cleanName(input.value);
    if (!name || ok.disabled) return;
    const next = user.slice();
    if (formMode === 'rename') {
      const i = next.findIndex(p => p.id === renaming.id);
      if (i >= 0) next[i] = { ...next[i], name };
      store(next, () => { form.hidden = true; });
      return;
    }
    const params = structuredClone(get()), i = findUser(name);
    let id;
    if (i >= 0) { next[i] = { ...next[i], params, v: version, at: Date.now() }; id = next[i].id; }
    else { id = newId(); next.push({ id, name, params, v: version, at: Date.now() }); }
    store(next, () => {
      form.hidden = true;
      picked = { builtin: false, id };
      showToast((i >= 0 ? 'Updated “' : 'Saved “') + name + '”');
    });
  });

  /* ── ⋯ menu ── */
  function menuItem(text, iconName, onClick, danger) {
    const b = el('button', 'ps-mi' + (danger ? ' is-danger' : ''));
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.append(icon(iconName));
    const t = el('span');
    t.textContent = text;
    b.append(t);
    b.addEventListener('click', () => { closeMenu(); onClick(); });
    return b;
  }
  function openMenu() {
    const t = target();
    menu.replaceChildren();
    if (t) {
      const name = el('div', 'ps-mlabel');
      name.textContent = t.p.name + (t.builtin ? ' · built-in' : '');
      menu.append(name, menuItem('Download', 'download', () => downloadBlob(presetFile(tool, version, [t.p]), fileSafe(`${title} - ${t.p.name}.json`))));
      if (!t.builtin) {
        menu.append(
          menuItem('Rename…', 'pencil', () => { renaming = t.p; openForm('rename', t.p.name); }),
          menuItem('Delete', 'trash', () => remove(t.p), true),
        );
      }
      menu.append(el('hr'));
    }
    menu.append(menuItem('Import from file…', 'upload', pickFiles));
    if (user.length) menu.append(menuItem(`Download all saved (${user.length})`, 'download', () => downloadBlob(presetFile(tool, version, user), fileSafe(`${title} - presets.json`))));
    const tip = el('p', 'ps-mtip');
    tip.textContent = 'Saved presets live in this browser. Download them to keep a copy; drop a .json on the list to add one.';
    menu.append(tip);
    menu.hidden = false;
    moreBtn.setAttribute('aria-expanded', 'true');
    menu.querySelector('.ps-mi')?.focus();
    setTimeout(() => document.addEventListener('pointerdown', outside));
  }
  function closeMenu(focus) {
    if (menu.hidden) return;
    menu.hidden = true;
    moreBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside);
    if (focus) moreBtn.focus();
  }
  const outside = e => { if (!right.contains(e.target)) closeMenu(); };
  moreBtn.addEventListener('click', () => menu.hidden ? openMenu() : closeMenu());
  menu.addEventListener('keydown', e => {
    const all = [...menu.querySelectorAll('.ps-mi')], i = all.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
    }
  });

  function remove(p) {
    const i = user.findIndex(q => q.id === p.id);
    if (i < 0) return;
    const next = user.slice();
    next.splice(i, 1);
    store(next, () => showToast('Deleted “' + p.name + '”', {
      action: 'Undo',
      onAction: () => { const back = readStore(tool); back.splice(Math.min(i, back.length), 0, p); store(back); },
    }));
  }

  /* ── Import ── */
  async function importAndReport(files) {
    const json = files.filter(f => /\.json$/i.test(f.name) || f.type === 'application/json');
    if (!json.length) { showToast('Drop a preset .json file'); return; }
    try {
      const added = await importFiles(json);
      const parts = Object.entries(added).map(([t, n]) => `${n} preset${n > 1 ? 's' : ''}` + (t === tool ? '' : ' to ' + toolTitle(t)));
      showToast(parts.length ? 'Added ' + parts.join(', ') : 'These presets are already here');
    } catch (err) { console.warn(err); showToast(err.name === 'QuotaExceededError' ? 'Could not save presets: the browser\'s storage is full or blocked' : err.message); }
  }
  function pickFiles() {
    const f = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json', multiple: true });
    f.onchange = () => f.files.length && importAndReport([...f.files]);
    f.click();
  }
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
