// Shell: sidebar, hash routing and lazy loading of tools.
import { $, el, icon } from './core/dom.js';
import { showToast } from './core/toast.js';
import { TOOLS } from './tools/registry.js';

const BRAND = 'Topometric';
const main = $('#main'), nav = $('#nav');

/* ═══ Sidebar links ═══ */
for (const t of TOOLS) {
  const a = el('a');
  a.href = '#' + t.id;
  a.dataset.page = t.id;
  const label = el('span', 'nav-label'), short = el('span', 'nav-label-short');
  label.textContent = t.title;
  short.textContent = t.short || t.title;
  a.append(icon(t.icon), label, short);
  const li = el('li');
  li.append(a);
  nav.append(li);
}

/* ═══ Pages ═══ */
const pages = new Map();   // tool id -> { section, api }

function loadCss(href) {
  return new Promise(resolve => {
    const link = Object.assign(el('link'), { rel: 'stylesheet', href });
    link.onload = link.onerror = resolve;
    document.head.append(link);
  });
}

function page(tool) {
  let p = pages.get(tool.id);
  if (p) return p;
  const section = el('section', 'page');
  section.id = 'page-' + tool.id;
  const status = el('p', 'page-status');
  status.textContent = 'Loading…';
  section.append(status);
  main.append(section);
  p = { section, api: null };
  pages.set(tool.id, p);
  // Script and styles load in parallel; the page shows up once both are ready.
  Promise.all([import(tool.module), tool.css && loadCss(tool.css)])
    .then(([mod]) => {
      section.replaceChildren();
      p.api = mod.mount(section, { showToast }) || null;
      if (current === tool.id) p.api?.show?.();
    })
    .catch(err => {
      console.error(err);
      status.textContent = 'Could not load ' + tool.title + '. Reload the page to try again.';
      status.classList.add('error');
    });
  return p;
}

/* ═══ Routing: #tool-id ═══ */
let current = null;
function route() {
  const id = location.hash.slice(1).split('/')[0];
  const tool = TOOLS.find(t => t.id === id) || TOOLS[0];
  if (tool.id === current) return;
  if (current) {
    const prev = pages.get(current);
    prev.section.classList.remove('is-active');
    prev.api?.hide?.();
  }
  current = tool.id;
  const p = page(tool);
  p.section.classList.add('is-active');
  p.api?.show?.();
  nav.querySelectorAll('a[data-page]').forEach(a => {
    if (a.dataset.page === tool.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = tool.title + ' · ' + BRAND;
  main.scrollTop = 0;
}
window.addEventListener('hashchange', route);

/* ═══ Sidebar collapse ═══ */
const sidebarToggle = $('#sidebarToggle');
const sideLinks = document.querySelectorAll('.sidebar-nav a, .sidebar-footer a');
sideLinks.forEach(a => { if (!a.getAttribute('aria-label')) a.setAttribute('aria-label', a.querySelector('.nav-label, .footer-label').textContent); });

function applySidebar(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  sidebarToggle.setAttribute('aria-expanded', !collapsed);
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  sidebarToggle.setAttribute('aria-label', label);
  sidebarToggle.title = label + ' (Ctrl+Shift+S)';
  // Labels are hidden when collapsed, so they move into tooltips.
  sideLinks.forEach(a => { if (collapsed) a.title = a.getAttribute('aria-label'); else a.removeAttribute('title'); });
}
function toggleSidebar() {
  const collapsed = !document.body.classList.contains('sidebar-collapsed');
  applySidebar(collapsed);
  try { localStorage.setItem('topometric-sidebar-collapsed', collapsed ? '1' : '0'); } catch (_) { }
}
sidebarToggle.addEventListener('click', () => { toggleSidebar(); sidebarToggle.blur(); });
// Touch screens have no hover, so tapping the short brand expands the sidebar too.
$('.sidebar-brand').addEventListener('click', e => {
  if (document.body.classList.contains('sidebar-collapsed') && matchMedia('(min-width: 769px)').matches) {
    e.preventDefault();
    toggleSidebar();
  }
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyS') { e.preventDefault(); toggleSidebar(); }
});
applySidebar(document.body.classList.contains('sidebar-collapsed'));

route();
