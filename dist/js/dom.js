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

// A dismissible notice above the list. actions: [label, run(banner), primary?]
export function showBanner(id, message, actions, { tone } = {}) {
  const host = $('#banners');
  host.querySelector(`[data-banner="${id}"]`)?.remove();
  const banner = el('div', 'banner' + (tone ? ' banner-' + tone : ''));
  banner.dataset.banner = id;
  banner.append(el('p', '', message));
  const row = el('div', 'banner-actions');
  for (const [label, run, primary] of actions) {
    row.append(button(label, primary ? 'banner-primary' : 'banner-secondary', () => run(banner)));
  }
  banner.append(row);
  host.append(banner);
  return banner;
}

export const removeBanner = id => $(`#banners [data-banner="${id}"]`)?.remove();

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

// Everything outside an open modal sheet is inert, which would make 실행 취소 unclickable, so the
// toast lives inside the topmost open sheet (later in the DOM = opened on top here), or the body.
// Call again whenever sheets open, close or replace their content.
export function placeToast() {
  const sheets = all('dialog[open]').filter(node => node.matches(':modal'));
  const host = sheets.at(-1) || document.body;
  if (toast.parentNode === host) return;
  if (popover && toast.matches(':popover-open')) toast.hidePopover();
  host.append(toast);
  if (!toast.hidden && popover) toast.showPopover();
}

export function announce(message, action) {
  placeToast();
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
