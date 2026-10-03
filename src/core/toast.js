// One toast at a time at the bottom of the screen, optionally with an action button.
import { $ } from './dom.js';

const toastEl = $('#toast'), toastMsg = $('#toastMsg'), toastAction = $('#toastAction');
let timer;

export function hideToast() { toastEl.classList.remove('show'); }

export function showToast(msg, opts = {}) {
  toastMsg.textContent = msg;
  toastAction.hidden = !opts.action;
  if (opts.action) {
    toastAction.textContent = opts.action;
    toastAction.onclick = () => { hideToast(); opts.onAction(); };
  }
  toastEl.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(hideToast, opts.action ? 5000 : 2200);
}
