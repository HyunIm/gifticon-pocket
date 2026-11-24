export const $ = (selector, root = document) => root.querySelector(selector);
export const all = (selector, root = document) => [...root.querySelectorAll(selector)];

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function button(text, className, onClick) {
  const node = el('button', className, text);
  node.type = 'button';
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

export function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#' + id);
  svg.append(use);
  return svg;
}

// One toast at a time; an optional action button (e.g. 실행 취소) keeps it up a little longer.
const toast = el('div', 'toast');
toast.setAttribute('role', 'status');
toast.hidden = true;
// As a popover the toast joins the top layer, so it also shows above an open dialog.
const popover = typeof toast.showPopover === 'function';
if (popover) toast.popover = 'manual';
let toastTimer;

function setVisible(visible) {
  toast.hidden = !visible;
  if (!popover) return;
  if (toast.matches(':popover-open')) toast.hidePopover();
  if (visible) toast.showPopover();
}

export function announce(message, action) {
  if (!toast.isConnected) document.body.append(toast);
  clearTimeout(toastTimer);
  const text = el('span', '', message);
  toast.replaceChildren(text);
  if (action) {
    toast.append(button(action.label, 'toast-action', () => {
      setVisible(false);
      action.run();
    }));
  }
  setVisible(true);
  toastTimer = setTimeout(() => setVisible(false), action ? 8000 : 3500);
}
