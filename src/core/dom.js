// Small DOM helpers shared by the shell and the tools.

export const $ = (s, root = document) => root.querySelector(s);

export function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// <svg class="icon"><use href="#i-name"/></svg>; symbols live in the sprite in index.html.
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#i-' + name);
  svg.appendChild(use);
  return svg;
}

export function isTyping(e) {
  const t = e.target;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

// Saves a Blob through a temporary link; nothing is uploaded anywhere.
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
