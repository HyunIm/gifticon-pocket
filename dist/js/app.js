import { $, all, el, button, icon, announce, placeToast, showBanner, removeBanner } from './dom.js';
import {
  categories, localDay, daysLeft, statusOf, matchesStatus, badgeLabel, formatDate, formatWon,
  codeDigits, sortCoupons, summarize, matchesQuery, isUsable,
} from './coupon.js';
import { brands, guessCategory, findBrand, makeBrand } from './brands.js';
import { openDB, getAll, mutate, putMany, deleteMany, onExternalChange, existing, errorMessage, detach } from './db.js';
import { makeThumbnail, shrinkForStorage } from './images.js';
import { readGifticon, warmUp, ReadError } from './ocr.js';
import { createBackup, backupFileName, readBackup, mergeBackup, BackupError } from './backup.js';
import { hasPushBackend, pushState, enablePush, disablePush, sendTestPush, syncReminders } from './push.js';
import { initShell, canInstall, promptInstall, openInstallGuide } from './install.js';
import { buildCalendar } from './calendar.js';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const BACKUP_KEY = 'gifticon-pocket:last-backup';
const VIEW_KEY = 'gifticon-pocket:view';
const TIPS_KEY = 'gifticon-pocket:tips';
const OCR_READY_KEY = 'gifticon-pocket:ocr-ready';
const DAY = 86400000;
const coarsePointer = matchMedia('(pointer: coarse)');
const store = {
  get: key => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
};

let ready = false;
let records = [];
let filter = 'all';
// In the 전체 list, used and expired coupons fold away under one row unless opened.
let showPast = false;
// Coupons just saved get a brief highlight so the user sees where they landed.
const justAdded = new Set();
let generation = 0;
// Cards are built once per coupon version, so typing in the search box only reorders nodes.
const cards = new Map();
let currentPage = null;
let returnFocus = null;
let dialogURLs = [];
let wakeLock = null;
// Images waiting to be registered after the current one (multi-select, share, paste).
const queue = { files: [], index: 0, total: 0, label: '' };

const dialog = el('dialog', 'coupon-dialog');
dialog.setAttribute('aria-labelledby', 'coupon-dialog-title');
const viewer = el('dialog', 'viewer');
viewer.setAttribute('aria-label', '기프티콘 원본 이미지');

/* ---------- list ---------- */

async function refresh() {
  const version = ++generation;
  const items = await getAll();
  if (version !== generation) return;
  records = items;
  render();
  afterRefresh();
}

function cardFor(record, today) {
  const label = badgeLabel(record, today);
  const key = `${record.updatedAt || record.createdAt}|${label}`;
  const cached = cards.get(record.id);
  if (cached?.key === key) {
    // A thumbnail made in the background only swaps the picture; the card (and focus) stays.
    if (record.thumb && !cached.hasThumb) {
      const img = cached.node.querySelector('.coupon-image img');
      if (img) {
        if (cached.url) URL.revokeObjectURL(cached.url);
        cached.url = img.src = URL.createObjectURL(record.thumb);
        cached.hasThumb = true;
      }
    }
    return cached.node;
  }
  if (cached?.url) URL.revokeObjectURL(cached.url);
  const card = button('', 'coupon-card', () => details(record.id));
  card.dataset.id = record.id;
  const media = el('span', 'coupon-image');
  let url = null;
  const picture = record.thumb || record.image;
  if (picture) {
    const img = el('img');
    url = img.src = URL.createObjectURL(picture);
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    media.append(img);
  } else {
    media.textContent = (record.brand || record.name).slice(0, 1);
    media.setAttribute('aria-hidden', 'true');
  }
  const info = el('span', 'coupon-info');
  info.append(el('span', 'coupon-brand', record.brand), el('strong', 'coupon-name', record.name));
  const meta = el('span', 'coupon-date', formatDate(record.expiry) + '까지');
  if (record.balance != null && !record.used) meta.textContent += ' · 잔액 ' + formatWon(record.balance);
  if (record.memo) meta.textContent += ' · ' + (record.memo.length > 18 ? record.memo.slice(0, 17) + '…' : record.memo);
  info.append(meta);
  card.append(media, info, badge(record, today));
  cards.set(record.id, { key, node: card, url, hasThumb: Boolean(record.thumb) });
  return card;
}

function badge(record, today) {
  const status = statusOf(record, today);
  const node = el('span', 'coupon-badge', badgeLabel(record, today));
  node.dataset.status = status;
  if (isUsable(status) && daysLeft(record.expiry, today) <= 1) node.dataset.urgent = 'true';
  return node;
}

function render() {
  closeSwipe(false);
  const today = localDay();
  const query = $('#search').value;
  const category = $('#category').value;
  const counts = summarize(records, today);
  all('[data-count]').forEach(node => { node.textContent = counts[node.dataset.count] ?? 0; });
  all('[data-filter]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.filter === filter)));
  $('#collection-title').textContent = titles[filter] || titles.all;
  updateTabbar(counts.expiring);
  const shown = sortCoupons(records.filter(record =>
    matchesStatus(filter, statusOf(record, today)) &&
    (category === 'all' || record.category === category) &&
    matchesQuery(record, query)), $('#sort').value, today);
  $('#result-count').textContent = shown.length;

  const ids = new Set(records.map(record => record.id));
  for (const [id, entry] of cards) {
    if (ids.has(id)) continue;
    if (entry.url) URL.revokeObjectURL(entry.url);
    cards.delete(id);
  }
  const empty = records.length === 0;
  document.body.classList.remove('loading');
  document.body.classList.toggle('has-coupons', !empty);
  $('#empty-state').hidden = !empty;
  const list = $('#coupon-list');
  list.hidden = empty;
  const next = empty ? [] : !shown.length ? [noResults(query, category)] : withPastFolded(shown, today);
  updateList(list, next);
  list.classList.toggle('grouped', $('#sort').value === 'brand' && shown.length > 0);
  for (const id of justAdded) {
    const card = cards.get(id)?.node;
    if (!card?.isConnected) continue;
    card.classList.add('just-added');
    setTimeout(() => card.classList.remove('just-added'), 2400);
  }
  justAdded.clear();
  syncSelection();
  updateAppBadge(counts.expiring);
  updateUrgent(today);
  saveView();
}

// 전체 + 만료 임박순: usable coupons first, then one row that opens the used and expired ones.
// Puts the nodes in the list, touching the DOM only when something changed, and keeps focus on
// the same card when it is still there (re-inserting a node would otherwise drop focus).
function updateList(list, next) {
  const current = [...list.children];
  if (current.length === next.length && current.every((node, i) => node === next[i])) return;
  const active = document.activeElement;
  const focusedId = list.contains(active) ? active.closest('.coupon-card')?.dataset.id : null;
  const focusedToggle = list.contains(active) && active.classList.contains('past-toggle');
  const scrollTop = document.scrollingElement.scrollTop;
  list.replaceChildren(...next);
  if (focusedId) $(`.coupon-card[data-id="${CSS.escape(focusedId)}"]`, list)?.focus({ preventScroll: true });
  else if (focusedToggle) $('.past-toggle', list)?.focus({ preventScroll: true });
  // Swapping a focused node can make the browser move the page; put it back where it was.
  if (document.scrollingElement.scrollTop !== scrollTop) document.scrollingElement.scrollTop = scrollTop;
}

function withPastFolded(shown, today) {
  const nodes = shown.map(record => cardFor(record, today));
  if ($('#sort').value === 'brand') return withBrandGroups(shown, nodes);
  if (filter !== 'all' || $('#sort').value !== 'expiry') return stackBrands(shown, nodes, today);
  const firstPast = shown.findIndex(record => !isUsable(statusOf(record, today)));
  if (firstPast <= 0) return stackBrands(shown, nodes, today);
  const past = shown.length - firstPast;
  pastToggle.setAttribute('aria-expanded', String(showPast));
  pastToggle.replaceChildren(el('span', '', `지난 기프티콘 ${past}개`), el('span', 'past-hint', showPast ? '접기' : '사용 완료·기간 만료 보기'), icon('down'));
  return [...stackBrands(shown.slice(0, firstPast), nodes.slice(0, firstPast), today), pastToggle, ...(showPast ? nodes.slice(firstPast) : [])];
}

// Usable coupons of one brand pile up as a stack at the place of the one expiring first (+2 on
// it); a tap fans the pile out under a "스타벅스 3장 · 접기" heading. Not while searching or in
// the 브랜드순 / 지난 / 임박 views, where every coupon should be visible.
const stackOpen = new Set();
const stackNodes = new Map();
function stackBrands(shown, nodes, today) {
  if ($('#search').value.trim() || !['all', 'usable', 'available'].includes(filter)) return nodes;
  const groups = new Map();
  shown.forEach((record, i) => {
    if (!isUsable(statusOf(record, today))) return;
    if (!groups.has(record.brand)) groups.set(record.brand, []);
    groups.get(record.brand).push(i);
  });
  const out = [];
  shown.forEach((record, i) => {
    const group = isUsable(statusOf(record, today)) ? groups.get(record.brand) : null;
    if (!group || group.length < 2) { out.push(nodes[i]); return; }
    if (group[0] !== i) return;
    const cardsOf = group.map(index => nodes[index]);
    if (stackOpen.has(record.brand)) out.push(stackHead(record.brand, group.length), ...cardsOf);
    else out.push(stackPile(record.brand, cardsOf));
  });
  return out;
}

function stackPile(brand, cardsOf) {
  const key = 'pile:' + brand;
  let pile = stackNodes.get(key);
  if (!pile) {
    pile = el('div', 'coupon-stack');
    pile.dataset.brand = brand;
    stackNodes.set(key, pile);
  }
  const count = `+${cardsOf.length - 1}`;
  if (pile.firstChild !== cardsOf[0] || pile.dataset.count !== count) {
    const badge = el('span', 'stack-count', count);
    badge.append(el('span', 'visually-hidden', `, ${brand} 쿠폰 ${cardsOf.length}장. 눌러서 모두 보기`));
    pile.replaceChildren(cardsOf[0], badge);
    pile.dataset.count = count;
  }
  return pile;
}

function stackHead(brand, count) {
  const key = 'head:' + brand;
  let head = stackNodes.get(key);
  if (!head) {
    head = el('div', 'stack-head');
    stackNodes.set(key, head);
  }
  const label = `${count}장`;
  if (head.dataset.label !== label) {
    const title = el('strong', '', brand);
    title.append(el('span', '', label));
    head.replaceChildren(title, button('접기', 'button-ghost stack-fold', () => {
      stackOpen.delete(brand);
      render();
    }));
    head.dataset.label = label;
  }
  return head;
}

// One toggle node for the life of the page, so re-renders do not replace it.
const pastToggle = button('', 'past-toggle', () => {
  showPast = !showPast;
  render();
});

// 브랜드순: a heading per brand with how many coupons it has.
function withBrandGroups(shown, nodes) {
  const out = [];
  shown.forEach((record, i) => {
    if (record.brand !== shown[i - 1]?.brand) {
      const count = shown.filter(item => item.brand === record.brand).length;
      const heading = el('h3', 'group-label', record.brand);
      heading.append(el('span', '', `${count}개`));
      out.push(heading);
    }
    out.push(nodes[i]);
  });
  return out;
}

const titles = {
  all: '내 기프티콘', usable: '내 기프티콘', available: '사용 가능', expiring: '만료 임박',
  used: '사용 완료', expired: '기간 만료', past: '지난 기프티콘',
};

const emptyMessages = {
  all: '조건에 맞는 기프티콘이 없어요',
  usable: '사용할 수 있는 기프티콘이 없어요',
  past: '사용했거나 기간이 지난 기프티콘이 없어요',
  available: '사용할 수 있는 기프티콘이 없어요',
  expiring: '7일 안에 만료되는 기프티콘이 없어요',
  used: '사용 완료한 기프티콘이 없어요',
  expired: '기간이 지난 기프티콘이 없어요',
};

// Coupons running out within three days, at the top whenever the app is opened: the in-app
// reminder (and the only one where no push server is available).
const URGENT_KEY = 'gifticon-pocket:urgent-dismissed';
let urgentText = '';
function updateUrgent(today) {
  const soon = records.filter(record => isUsable(statusOf(record, today)) && daysLeft(record.expiry, today) <= 3);
  const todayCount = soon.filter(record => daysLeft(record.expiry, today) === 0).length;
  const dismissed = store.get(URGENT_KEY) === String(today);
  const text = !soon.length ? '' : todayCount && todayCount === soon.length ? `오늘 만료되는 기프티콘 ${todayCount}개가 있어요.`
    : todayCount ? `오늘 만료 ${todayCount}개 포함, 3일 안에 만료되는 기프티콘 ${soon.length}개가 있어요.`
      : `3일 안에 만료되는 기프티콘 ${soon.length}개가 있어요.`;
  if (!text || dismissed || filter === 'expiring') {
    urgentText = '';
    removeBanner('urgent');
    return;
  }
  if (text === urgentText && $('[data-banner="urgent"]')) return;
  urgentText = text;
  showBanner('urgent', text, [
    ['보기', () => {
      setFilter('expiring');
      $('.collection').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }, true],
    ['오늘은 그만', () => { store.set(URGENT_KEY, String(today)); urgentText = ''; removeBanner('urgent'); }],
  ], { tone: 'warn', first: true });
}

function noResults(query, category) {
  const box = el('div', 'no-results');
  const searching = query.trim() || category !== 'all';
  box.append(el('h3', '', query.trim() ? `‘${query.trim()}’에 맞는 기프티콘이 없어요` : emptyMessages[filter]));
  if (searching || filter !== 'all') {
    box.append(button(searching ? '검색 조건 지우기' : '전체 보기', 'button-secondary', () => {
      $('#search').value = '';
      $('#category').value = 'all';
      setFilter(homeFilter());
    }));
  }
  return box;
}

function setFilter(next) {
  if (selecting) { selecting = false; selected.clear(); }
  filter = next;
  render();
}

/* ---------- phone tab bar ---------- */

// Phones get a bottom tab bar (보관함 / 임박 / 지난 / 설정) in place of the filter chips.
const phone = matchMedia('(max-width: 760px)');
const TAB_ORDER = ['usable', 'expiring', 'past'];
const homeFilter = () => (phone.matches ? 'usable' : 'all');
const tabOf = value => value === 'expiring' ? 'expiring' : ['past', 'used', 'expired'].includes(value) ? 'past' : 'usable';

// Each layout keeps to its own filters: the chips on wide screens, the tabs on phones.
function fitFilterToLayout() {
  if (phone.matches && !TAB_ORDER.includes(filter)) filter = tabOf(filter);
  else if (!phone.matches && ['usable', 'past'].includes(filter)) filter = filter === 'usable' ? 'all' : 'used';
}

function placePill(tab) {
  const bar = $('.tabbar-glass');
  if (!tab || !bar.offsetWidth) return;
  bar.style.setProperty('--pill-x', `${tab.offsetLeft}px`);
  bar.style.setProperty('--pill-w', `${tab.offsetWidth}px`);
}

function updateTabbar(expiring) {
  const active = tabOf(filter);
  for (const tab of all('.tab[data-tab]')) {
    if (tab.dataset.tab === active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  if (!tabDrag) placePill($(`.tab[data-tab="${active}"]`));
  const badge = $('.tab-badge');
  badge.hidden = !expiring;
  badge.textContent = expiring > 99 ? '99+' : String(expiring);
  $('.tab[data-tab="expiring"]').setAttribute('aria-label', expiring ? `임박 ${expiring}개` : '임박');
}

function switchTab(next) {
  if (next === tabOf(filter) && TAB_ORDER.includes(filter)) {
    // Tapping the current tab again goes back to the top, as in native apps.
    scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    return;
  }
  const from = TAB_ORDER.indexOf(tabOf(filter));
  const to = TAB_ORDER.indexOf(next);
  setFilter(next);
  const tab = $(`.tab[data-tab="${next}"]`);
  tab.classList.remove('pop');
  void tab.offsetWidth;
  tab.classList.add('pop');
  const list = $('.collection');
  list.dataset.enter = to > from ? 'right' : 'left';
  list.classList.remove('tab-enter');
  void list.offsetWidth;
  list.classList.add('tab-enter');
  // A new tab starts at its top, unless the list is already in view.
  const top = list.getBoundingClientRect().top + scrollY - 12;
  if (scrollY > top) scrollTo({ top });
}

// The highlight can be dragged along the bar (like a slider) and lands on the tab it is let go over.
let tabDrag = null;
function wireTabbar() {
  const bar = $('.tabbar-glass');
  const tabs = () => all('.tab[data-tab]', bar);
  const nearest = x => tabs().reduce((best, tab) => {
    const d = Math.abs(tab.offsetLeft + tab.offsetWidth / 2 - x);
    return d < best.d ? { tab, d } : best;
  }, { tab: null, d: Infinity }).tab;
  let suppressClick = false;
  bar.addEventListener('pointerdown', event => {
    const start = event.target.closest('.tab[data-tab]');
    if (!start || event.button > 0) return;
    const pill = $('.tab-pill', bar);
    tabDrag = { id: event.pointerId, startX: event.clientX, pillX: pill.offsetLeft + (parseFloat(bar.style.getPropertyValue('--pill-x')) || 0), moved: false, over: null };
  });
  bar.addEventListener('pointermove', event => {
    if (!tabDrag || event.pointerId !== tabDrag.id) return;
    const dx = event.clientX - tabDrag.startX;
    if (!tabDrag.moved) {
      if (Math.abs(dx) < 8) return;
      tabDrag.moved = true;
      bar.setPointerCapture(event.pointerId);
      bar.classList.add('dragging');
    }
    const list = tabs();
    const first = list[0];
    const last = list[list.length - 1];
    const width = parseFloat(bar.style.getPropertyValue('--pill-w')) || first.offsetWidth;
    const x = Math.min(Math.max(tabDrag.pillX + dx, first.offsetLeft), last.offsetLeft + last.offsetWidth - width);
    bar.style.setProperty('--pill-x', `${x}px`);
    const over = nearest(x + width / 2);
    if (over !== tabDrag.over) {
      tabDrag.over = over;
      for (const tab of list) tab.classList.toggle('drag-over', tab === over);
      navigator.vibrate?.(8);
    }
  });
  const finish = event => {
    if (!tabDrag || event.pointerId !== tabDrag.id) return;
    const { moved, over } = tabDrag;
    tabDrag = null;
    bar.classList.remove('dragging');
    for (const tab of tabs()) tab.classList.remove('drag-over');
    if (!moved) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (over && event.type === 'pointerup') switchTab(over.dataset.tab);
    else updateTabbar(summarize(records, localDay()).expiring);
    if (over && over.dataset.tab === tabOf(filter)) placePill(over);
  };
  bar.addEventListener('pointerup', finish);
  bar.addEventListener('pointercancel', finish);
  bar.addEventListener('click', event => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    if (suppressClick) { event.preventDefault(); return; }
    if (tab.dataset.action === 'settings') settings();
    else switchTab(tab.dataset.tab);
  });
  phone.addEventListener('change', () => { fitFilterToLayout(); render(); });
  addEventListener('resize', () => placePill($('.tab[aria-current="page"]')));
}

function saveView() {
  store.set(VIEW_KEY, JSON.stringify({ filter, sort: $('#sort').value, category: $('#category').value, showPast }));
}

function restoreView() {
  try {
    const view = JSON.parse(store.get(VIEW_KEY) || '{}');
    if (['all', 'available', 'expiring', 'used', 'expired', 'usable', 'past'].includes(view.filter)) filter = view.filter;
    if ([...$('#sort').options].some(o => o.value === view.sort)) $('#sort').value = view.sort;
    if ([...$('#category').options].some(o => o.value === view.category)) $('#category').value = view.category;
    showPast = view.showPast === true;
  } catch { /* first visit */ }
  if (phone.matches && !store.get(VIEW_KEY)) filter = 'usable';
  fitFilterToLayout();
}

function updateAppBadge(count) {
  if (!('setAppBadge' in navigator)) return;
  (count ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {});
}

/* ---------- background work after every refresh ---------- */

let pushTimer;
let thumbing = false;
const thumbFailures = new Set();

function afterRefresh() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    syncReminders(records).catch(() => {});
    updateTips();
  }, 1500);
  buildMissingThumbnails();
  if (currentPage?.kind === 'details' && !currentPage.busy) {
    const record = records.find(item => item.id === currentPage.id);
    if (!record) { dialog.close(); announce('다른 창에서 삭제된 기프티콘이에요.'); }
    else if ((record.updatedAt || record.createdAt) !== currentPage.version) details(record.id);
  }
}

// Coupons saved before thumbnails existed (or imported from a backup) get one in the background.
async function buildMissingThumbnails() {
  if (thumbing) return;
  const pending = records.filter(record => record.image && !record.thumb && !thumbFailures.has(record.id));
  if (!pending.length) return;
  thumbing = true;
  try {
    for (const record of pending) {
      try {
        const thumb = await makeThumbnail(record.image);
        await mutate(record.id, current => (current?.image ? { ...current, thumb } : current || null));
      } catch {
        thumbFailures.add(record.id);
      }
    }
  } finally {
    thumbing = false;
  }
  await refresh();
}

/* ---------- tips: one suggestion at a time above the list ---------- */

function readTips() {
  try { return JSON.parse(store.get(TIPS_KEY) || '{}'); } catch { return {}; }
}
const tipSnoozed = (name, days) => Date.now() - (readTips()[name] || 0) < days * DAY;
function snoozeTip(name) {
  store.set(TIPS_KEY, JSON.stringify({ ...readTips(), [name]: Date.now() }));
  removeBanner(name);
}

let tipsRunning = false;
async function updateTips() {
  if (tipsRunning || !ready) return;
  tipsRunning = true;
  try {
    const usable = records.some(record => isUsable(statusOf(record)));
    // Reminders are the feature people miss most; offer them once there is something to remind.
    if (usable && !tipSnoozed('notify', 30) && (await pushState()) === 'off') {
      removeBanner('backup');
      showBanner('notify', '만료 전에 알려 드릴까요? 만료 3일 전과 만료일 오전 9시에 알림을 보내요.', [
        ['알림 켜기', async banner => {
          try {
            const result = await enablePush(records);
            if (result === 'on') { banner.remove(); announce('만료 알림을 켰어요.'); }
            if (result === 'denied') { snoozeTip('notify'); announce('알림이 차단됐어요. 나중에 브라우저 설정에서 허용할 수 있어요.'); }
          } catch {
            announce('알림을 켜지 못했어요. 잠시 후 설정에서 다시 시도해 주세요.');
          }
        }, true],
        ['나중에', () => snoozeTip('notify')],
      ]);
      return;
    }
    removeBanner('notify');
    // Installing gives a home screen icon (and the share menu on Android). iPhone has its own banner.
    const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (records.length && canInstall() && !apple && !tipSnoozed('install', 30)) {
      removeBanner('backup');
      showBanner('install', /Android/.test(navigator.userAgent)
        ? '앱으로 설치하면 홈 화면에서 바로 열고, 카카오톡 사진의 공유 메뉴로 등록할 수 있어요.'
        : '앱으로 설치하면 작업 표시줄이나 Dock에서 바로 열 수 있어요.', [
        ['앱 설치', async banner => { await promptInstall(); if (!canInstall()) banner.remove(); }, true],
        ['나중에', () => snoozeTip('install')],
      ]);
      return;
    }
    removeBanner('install');
    const last = Number(store.get(BACKUP_KEY) || 0);
    const oldest = Math.min(...records.map(record => record.createdAt || Date.now()));
    const overdue = last ? Date.now() - last > 60 * DAY : Date.now() - oldest > 14 * DAY;
    if (records.length >= 3 && overdue && !tipSnoozed('backup', 30)) {
      showBanner('backup', last
        ? '마지막 백업 후 두 달이 지났어요. 백업 파일을 저장해 두면 기기를 바꿔도 쿠폰을 되찾을 수 있어요.'
        : '아직 백업하지 않았어요. 백업 파일을 저장해 두면 기기를 바꾸거나 데이터가 지워져도 쿠폰을 되찾을 수 있어요.', [
        ['백업 파일 저장', () => exportBackup(), true],
        ['나중에', () => snoozeTip('backup')],
      ]);
    } else {
      removeBanner('backup');
    }
  } finally {
    tipsRunning = false;
  }
}

async function protectStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

/* ---------- dialog plumbing ---------- */

function openDialog(title, page) {
  if (!dialog.open) {
    const active = document.activeElement;
    const card = active?.closest?.('.coupon-card');
    returnFocus = { id: card?.dataset.id, index: card ? all('#coupon-list .coupon-card').indexOf(card) : -1, element: active };
  }
  currentPage = page;
  clearDialogURLs();
  keepAwake(false);
  const shell = el('div', 'dialog-shell');
  const head = el('div', 'dialog-header');
  const heading = el('h2', '', title);
  heading.id = 'coupon-dialog-title';
  const close = button('', 'icon-button', requestClose);
  close.append(icon('close'));
  close.setAttribute('aria-label', '닫기');
  head.append(heading, close);
  shell.append(head);
  dialog.replaceChildren(shell);
  placeToast();
  return shell;
}

function showDialog() {
  if (!dialog.open) dialog.showModal();
  else dialog.querySelector('.dialog-body button, .dialog-body input:not([type=file]), .dialog-actions button')?.focus({ preventScroll: true });
  dialog.scrollTop = 0;
}

async function requestClose() {
  const page = currentPage;
  if (!page || page.busy) return;
  if (page.confirmClose && !(await page.confirmClose())) return;
  if (currentPage !== page) return;
  queue.files = [];
  dialog.close();
}

// In-app replacement for confirm(): a small sheet above whatever is open. Resolves true/false.
const askDialog = el('dialog', 'coupon-dialog ask-dialog');
askDialog.setAttribute('aria-labelledby', 'ask-message');
function ask(message, { yes = '확인', no = '취소', danger = false } = {}) {
  if (askDialog.open) askDialog.close();
  return new Promise(resolve => {
    const text = el('p', 'ask-message', message);
    text.id = 'ask-message';
    const finish = answer => {
      askDialog.onclose = null;
      askDialog.close();
      resolve(answer);
    };
    const actions = el('div', 'ask-actions');
    actions.append(button(no, 'button-secondary', () => finish(false)), button(yes, danger ? 'button-danger' : 'button-primary', () => finish(true)));
    const shell = el('div', 'dialog-shell');
    shell.append(text, actions);
    askDialog.replaceChildren(shell);
    askDialog.onclose = () => resolve(false);
    askDialog.showModal();
    actions.lastChild.focus();
  });
}

function clearDialogURLs() {
  dialogURLs.forEach(url => URL.revokeObjectURL(url));
  dialogURLs = [];
}

function objectURL(blob) {
  const url = URL.createObjectURL(blob);
  dialogURLs.push(url);
  return url;
}

// Return focus to the card the dialog was opened from without scrolling the page.
function restoreFocus() {
  const target = returnFocus;
  returnFocus = null;
  if (!target) return;
  const card = target.id && $(`.coupon-card[data-id="${CSS.escape(target.id)}"]`);
  if (card) { card.focus({ preventScroll: true }); return; }
  // The card left the list (used and folded away, filtered out, deleted): focus whatever now
  // sits in its place, so keyboard and screen reader users stay where they were.
  if (target.index >= 0) {
    const now = all('#coupon-list .coupon-card');
    const fallback = now[Math.min(target.index, now.length - 1)] || $('.past-toggle');
    if (fallback) { fallback.focus({ preventScroll: true }); return; }
  }
  if (target.element?.isConnected && target.element !== document.body) target.element.focus({ preventScroll: true });
}

async function keepAwake(on) {
  if (!('wakeLock' in navigator)) return;
  if (!on) {
    const lock = wakeLock;
    wakeLock = null;
    await lock?.release().catch(() => {});
    return;
  }
  if (wakeLock || document.hidden) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    wakeLock = null;
  }
}

async function writeFromDialog(id, change, message, after) {
  const page = currentPage;
  if (page.busy) return false;
  page.busy = true;
  const controls = all('button, input, select, textarea', dialog);
  controls.forEach(node => { node.disabled = true; });
  try {
    await mutate(id, change);
    await refresh();
    if (currentPage === page && dialog.open) after();
    if (message) announce(message);
    return true;
  } catch (error) {
    if (currentPage === page && dialog.open) showError(errorMessage(error));
    else announce(errorMessage(error));
    return false;
  } finally {
    page.busy = false;
    controls.forEach(node => { node.disabled = false; });
  }
}

function showError(message) {
  let error = $('.form-error', dialog);
  if (!error) {
    error = el('p', 'form-error');
    error.setAttribute('role', 'alert');
    $('.dialog-actions', dialog).before(error);
  }
  error.textContent = message;
}

/* ---------- register / edit ---------- */

function field(labelText, input, className, hint) {
  const label = el('label', 'field' + (className ? ' ' + className : ''));
  label.append(el('span', '', labelText), input);
  if (hint) label.append(hint);
  return label;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// "2026.12.31 (목) · 37일 남음": a quick check that the read or typed date is the right one.
function expiryHint(value) {
  // Empty: some browsers (iOS) show a blank box, so say what goes there.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { text: '눌러서 날짜를 선택해 주세요', warn: false };
  const days = daysLeft(value);
  const weekday = WEEKDAYS[new Date(value + 'T00:00:00').getDay()];
  if (days < 0) return { text: `${weekday}요일 · 이미 지난 날짜예요`, warn: true };
  if (days === 0) return { text: `${weekday}요일 · 오늘 만료`, warn: true };
  return { text: `${weekday}요일 · ${days}일 남음`, warn: days > 3660 };
}

// Known brands plus the ones already in the wallet, for the brand field's suggestions.
function brandOptions() {
  let list = $('#brand-options');
  if (!list) {
    list = el('datalist');
    list.id = 'brand-options';
    document.body.append(list);
  }
  const names = [...new Set([...records.map(record => record.brand), ...brands.map(brand => brand.name)])];
  list.replaceChildren(...names.map(name => new Option(name)));
  return list.id;
}

function textInput(name, value, placeholder, maxLength, required = false) {
  const input = el('input');
  input.type = 'text';
  input.name = name;
  input.value = value ?? '';
  input.placeholder = placeholder;
  input.maxLength = maxLength;
  input.required = required;
  input.autocomplete = 'off';
  return input;
}

const parseWon = value => {
  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
};

// Brands already in the wallet that the built-in list does not know, so the next coupon from
// the same shop is recognised too. The latest coupon of each brand decides its category.
function walletBrands() {
  const seen = new Map();
  for (const record of [...records].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) {
    const name = record.brand?.trim();
    if (!name || seen.has(name) || findBrand(name)) continue;
    if (!/[가-힣]{2}|[A-Za-z]{3}/.test(name)) continue;
    seen.set(name, makeBrand(name, record.category));
  }
  return [...seen.values()];
}

function startImport(files) {
  const images = [...files].filter(file => IMAGE_TYPES.includes(file.type));
  if (!images.length) {
    announce('PNG, JPG, WebP, GIF 이미지만 등록할 수 있어요.');
    return;
  }
  if (!ready) { announce('기기 저장소를 준비하지 못했어요. 페이지를 새로고침해 주세요.'); return; }
  if (currentPage?.busy) return;
  queue.files = images.slice(1);
  queue.index = 1;
  queue.total = images.length;
  queue.label = '';
  editor(null, { file: images[0] });
}

function nextInQueue() {
  const file = queue.files.shift();
  if (!file) { dialog.close(); return; }
  queue.index++;
  editor(null, { file });
}

function editor(record, { file = null, pick = false } = {}) {
  if (!ready) { announce('기기 저장소를 준비하지 못했어요. 페이지를 새로고침해 주세요.'); return; }
  const isNew = !record;
  if (isNew && !file) Object.assign(queue, { files: [], index: 1, total: 1, label: '' });
  const id = record?.id || crypto.randomUUID();
  const queueTitle = () => `${queue.label || '기프티콘 등록'} (${queue.index}/${queue.total})`;
  const title = isNew ? (queue.total > 1 ? queueTitle() : '기프티콘 등록') : '기프티콘 수정';
  const page = { kind: 'editor', id, dirty: Boolean(file), touched: new Set(), autofilled: new Set(), readToken: 0 };
  page.confirmClose = () => {
    const parts = [];
    if (page.dirty) parts.push('작성 중인 내용이 저장되지 않아요.');
    if (queue.files.length) parts.push(`남은 이미지 ${queue.files.length}장도 등록하지 않아요.`);
    return !parts.length || ask(parts.join(' ') + ' 닫을까요?', { yes: '닫기', no: '계속 작성', danger: true });
  };
  const shell = openDialog(title, page);
  const form = el('form', 'editor-form');
  const body = el('div', 'dialog-body');

  // Image first: picking one fills in the rest.
  const picker = el('div', 'image-picker');
  const upload = el('input');
  upload.type = 'file';
  upload.accept = IMAGE_TYPES.join(',');
  upload.multiple = isNew;
  upload.className = 'visually-hidden';
  upload.setAttribute('aria-label', '기프티콘 이미지 선택');
  const preview = el('div', 'picker-preview');
  const status = el('p', 'read-status');
  status.setAttribute('role', 'status');
  const pickButton = button('', 'button-secondary', () => upload.click());
  const removeButton = button('이미지 제거', 'button-ghost', () => setImage(null));
  // Several images: register the rest without confirming each one.
  const autoButton = button('', 'auto-button', () => autoRegisterRest({
    file: image,
    complete: Boolean(inputs.brand.value.trim() && inputs.name.value.trim() && inputs.expiry.value),
    fields: {
      brand: inputs.brand.value.trim(), name: inputs.name.value.trim(), expiry: inputs.expiry.value,
      category: inputs.category.value, code: inputs.code.value.trim(), balance: parseWon(inputs.balance.value), memo: inputs.memo.value.trim(),
    },
    thumb: page.thumb,
  }));
  const updateAuto = () => {
    autoButton.hidden = !isNew || !queue.files.length;
    autoButton.textContent = `남은 ${queue.files.length}장은 확인 없이 자동 등록`;
    secondary.textContent = isNew && queue.files.length ? '건너뛰기' : '취소';
  };
  picker.append(preview, el('div', 'picker-actions'), status, autoButton, upload);
  picker.querySelector('.picker-actions').append(pickButton, removeButton);
  // iPhone has no share target: copying the image in KakaoTalk and pasting here skips Photos.
  if (navigator.clipboard?.read) {
    const paste = button('', 'button-ghost', async () => {
      try {
        for (const item of await navigator.clipboard.read()) {
          const type = item.types.find(t => IMAGE_TYPES.includes(t));
          if (!type) continue;
          setImage(new File([await item.getType(type)], 'clipboard.' + type.split('/')[1], { type }));
          return;
        }
        status.className = 'read-status empty';
        status.textContent = '복사한 이미지가 없어요. 카카오톡 등에서 이미지를 길게 눌러 복사한 뒤 다시 눌러 주세요.';
      } catch {
        status.className = 'read-status empty';
        status.textContent = '클립보드를 읽지 못했어요. 이미지를 복사한 뒤 다시 시도해 주세요.';
      }
    });
    paste.append(icon('clipboard'), document.createTextNode('붙여넣기'));
    picker.querySelector('.picker-actions').append(paste);
  }

  const inputs = {
    brand: textInput('brand', record?.brand, '예) 스타벅스', 80, true),
    name: textInput('name', record?.name, '예) 카페 아메리카노 Tall', 120, true),
    expiry: el('input'),
    category: el('select'),
    code: textInput('code', record?.code, '쿠폰 번호 입력', 150),
    balance: textInput('balance', record?.balance != null ? record.balance.toLocaleString('ko-KR') : '', '예) 30,000', 15),
    memo: textInput('memo', record?.memo, '예) 생일 선물', 200),
  };
  Object.assign(inputs.expiry, { type: 'date', name: 'expiry', required: true, value: record?.expiry || '' });
  inputs.category.name = 'category';
  categories.forEach(value => inputs.category.add(new Option(value, value)));
  inputs.category.value = record?.category || '기타';
  // Some codes contain letters (app store cards), so the code field keeps the full keyboard.
  inputs.code.setAttribute('autocapitalize', 'characters');
  inputs.code.spellcheck = false;
  inputs.balance.inputMode = 'numeric';
  inputs.brand.setAttribute('list', brandOptions());
  const hint = el('span', 'field-hint');
  hint.setAttribute('aria-live', 'polite');
  const updateHint = () => {
    const { text, warn } = expiryHint(inputs.expiry.value);
    hint.textContent = text;
    hint.classList.toggle('warn', warn);
  };
  const grid = el('div', 'form-grid');
  grid.append(
    field('브랜드', inputs.brand, 'wide'), field('상품명', inputs.name, 'wide'),
    field('유효기간', inputs.expiry, '', hint), field('카테고리', inputs.category),
    field('쿠폰 번호 (선택)', inputs.code, 'wide'),
    field('금액권 잔액 (원)', inputs.balance), field('메모 (선택)', inputs.memo),
  );
  for (const [key, input] of Object.entries(inputs)) {
    input.addEventListener(key === 'category' ? 'change' : 'input', () => {
      page.dirty = true;
      page.touched.add(key);
      input.classList.remove('autofilled', 'needs-input');
    });
  }
  inputs.expiry.addEventListener('input', updateHint);
  inputs.expiry.addEventListener('change', updateHint);
  // Picking a known brand picks its category, unless the user chose one.
  inputs.brand.addEventListener('change', () => {
    if (page.touched.has('category')) return;
    const category = guessCategory(inputs.brand.value, inputs.name.value);
    if (category !== '기타' || !record) inputs.category.value = category;
  });
  inputs.code.addEventListener('blur', () => {
    // Digit-only numbers read more easily (and match the barcode caption) in groups of four.
    if (/^[\d\s-]+$/.test(inputs.code.value) && codeDigits(inputs.code.value).length >= 8) {
      inputs.code.value = codeDigits(inputs.code.value).replace(/(\d{4})(?=\d)/g, '$1 ');
    }
  });
  inputs.code.addEventListener('change', () => {
    const digits = codeDigits(inputs.code.value);
    const duplicate = digits.length >= 6 && records.find(item => item.id !== id && codeDigits(item.code) === digits);
    if (!duplicate) return;
    status.className = 'read-status warn';
    status.textContent = `같은 쿠폰 번호로 등록된 ‘${duplicate.name}’이(가) 있어요.`;
  });
  inputs.balance.addEventListener('blur', () => {
    const won = parseWon(inputs.balance.value);
    inputs.balance.value = won == null ? '' : won.toLocaleString('ko-KR');
  });
  body.append(picker, grid);
  updateHint();
  // Phone keyboards: Enter (다음) moves to the next field instead of submitting half a form.
  const order = [inputs.brand, inputs.name, inputs.expiry, inputs.code, inputs.balance, inputs.memo];
  order.forEach((input, i) => { input.enterKeyHint = i === order.length - 1 ? 'done' : 'next'; });
  form.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || !order.includes(event.target)) return;
    const next = order[order.indexOf(event.target) + 1];
    if (!next) return;
    event.preventDefault();
    next.focus();
  });

  let image = record?.image || null;
  let changedImage = false;

  function showPreview() {
    preview.replaceChildren();
    clearDialogURLs();
    pickButton.replaceChildren(icon('image'), document.createTextNode(image ? '다른 이미지' : '이미지 선택'));
    removeButton.hidden = !image;
    if (image) {
      const zoom = button('', 'picker-zoom', () => openViewer(image));
      zoom.setAttribute('aria-label', '선택한 이미지 크게 보기');
      const img = el('img', 'picker-image');
      img.src = objectURL(image);
      img.alt = '';
      zoom.append(img);
      preview.append(zoom);
    } else {
      const hint = el('p', 'picker-hint');
      hint.append(el('strong', '', '기프티콘 이미지를 골라 주세요'),
        el('span', '', isNew ? '브랜드, 상품명, 유효기간, 쿠폰 번호를 자동으로 채워요. 여러 장을 한 번에 골라도 돼요.' : '이미지를 바꾸면 빈 칸을 자동으로 채워요.'));
      preview.append(hint);
    }
  }

  function setImage(next) {
    image = next;
    changedImage = true;
    // Made while the user reviews the form, so saving does not wait for it.
    page.thumb = next ? makeThumbnail(next).catch(() => null) : Promise.resolve(null);
    page.dirty = true;
    $('.form-error', dialog)?.remove();
    showPreview();
    if (next) readInto(next);
    else { page.readToken++; status.textContent = ''; }
  }
  page.setImage = setImage;

  async function readInto(blob) {
    const token = ++page.readToken;
    const still = () => token === page.readToken && currentPage === page;
    status.className = 'read-status reading';
    status.textContent = '이미지를 읽고 있어요… 0%';
    try {
      const firstTime = !store.get(OCR_READY_KEY);
      const fields = await readGifticon(blob, progress => {
        if (!still()) return;
        // The first 30% is loading the engine; on the very first run that is a ~7MB download.
        status.textContent = progress < 0.3
          ? (firstTime ? '처음 한 번 읽기 도구를 내려받고 있어요(약 7MB)…' : '읽기 도구를 준비하고 있어요…')
          : `이미지를 읽고 있어요… ${Math.round(progress * 100)}%`;
      }, { extraBrands: walletBrands() });
      store.set(OCR_READY_KEY, '1');
      if (!still()) return;
      let filled = 0;
      for (const key of ['brand', 'name', 'expiry', 'code', 'balance', 'category']) {
        const value = fields[key];
        const input = inputs[key];
        if (value == null || value === '' || page.touched.has(key)) continue;
        // Never overwrite what the user or the saved coupon already had, except earlier autofill.
        if (key !== 'category' && input.value && !page.autofilled.has(key)) continue;
        if (key === 'category' && record) continue;
        input.value = key === 'balance' ? Number(value).toLocaleString('ko-KR') : value;
        page.autofilled.add(key);
        input.classList.add('autofilled');
        input.classList.remove('needs-input');
        if (key !== 'category') filled++;
      }
      updateHint();
      const missing = ['brand', 'name', 'expiry'].filter(key => !inputs[key].value);
      missing.forEach(key => inputs[key].classList.add('needs-input'));
      const duplicate = fields.code && records.find(item => item.id !== id && codeDigits(item.code) === codeDigits(fields.code));
      status.className = 'read-status ' + (filled ? 'done' : 'empty');
      status.textContent = filled
        ? (missing.length ? '읽은 내용을 채웠어요. 빈 칸을 채운 뒤 등록해 주세요.' : '자동으로 채웠어요. 내용을 확인한 뒤 등록해 주세요.')
        : '읽을 수 있는 정보를 찾지 못했어요. 직접 입력해 주세요.';
      if (duplicate) {
        status.className = 'read-status warn';
        status.textContent += ` 같은 쿠폰 번호로 등록된 ‘${duplicate.name}’이(가) 있어요.`;
      }
    } catch (error) {
      if (!still()) return;
      status.className = 'read-status empty';
      status.textContent = error instanceof ReadError ? error.message : '이미지를 읽지 못했어요. 직접 입력해 주세요.';
    }
  }

  upload.addEventListener('change', () => {
    const files = [...upload.files];
    upload.value = '';
    if (!files.length) return;
    const valid = files.filter(item => IMAGE_TYPES.includes(item.type));
    if (!valid.length) { showError('PNG, JPG, WebP, GIF 이미지를 선택해 주세요.'); return; }
    if (isNew && valid.length > 1) {
      queue.files.push(...valid.slice(1));
      queue.total = queue.index + queue.files.length;
      $('#coupon-dialog-title').textContent = queueTitle();
      updateAuto();
    }
    setImage(valid[0]);
  });
  for (const type of ['dragenter', 'dragover']) {
    picker.addEventListener(type, event => { event.preventDefault(); picker.classList.add('dragging'); });
  }
  picker.addEventListener('dragleave', () => picker.classList.remove('dragging'));
  picker.addEventListener('drop', event => {
    event.preventDefault();
    picker.classList.remove('dragging');
    const dropped = [...event.dataTransfer.files].filter(item => IMAGE_TYPES.includes(item.type));
    if (dropped.length) setImage(dropped[0]);
  });

  const actions = el('div', 'dialog-actions');
  const save = el('button', 'button-primary', isNew ? '등록하기' : '수정 저장');
  save.type = 'submit';
  // 건너뛰기 while more images wait, otherwise 취소.
  const secondary = button('', 'button-secondary', () => {
    if (currentPage?.busy) return;
    if (isNew && queue.files.length) { nextInQueue(); return; }
    page.confirmClose().then(ok => {
      if (!ok || currentPage !== page) return;
      page.dirty = false;
      if (record) details(id); else requestClose();
    });
  });
  actions.append(secondary, save);
  updateAuto();
  form.append(body, actions);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (page.busy || page.saving) return;
    for (const input of [inputs.brand, inputs.name]) {
      input.value = input.value.trim();
      if (!input.reportValidity()) return;
    }
    if (!inputs.expiry.reportValidity()) return;
    const fields = {
      brand: inputs.brand.value,
      name: inputs.name.value,
      expiry: inputs.expiry.value,
      category: inputs.category.value,
      code: inputs.code.value.trim(),
      balance: parseWon(inputs.balance.value),
      memo: inputs.memo.value.trim(),
    };
    page.saving = true;
    const thumb = changedImage ? await page.thumb : null;
    if (changedImage && image) image = await shrinkForStorage(image).catch(() => image);
    page.saving = false;
    if (isNew) justAdded.add(id);
    const saved = await writeFromDialog(id, old => {
      const base = record ? existing(old) : { id, used: false, createdAt: Date.now() };
      return {
        ...base, ...fields,
        image: changedImage ? image : (base.image || null),
        thumb: changedImage ? thumb : (base.thumb || null),
        updatedAt: Date.now(),
      };
    }, isNew ? '기프티콘을 등록했어요.' : '수정 내용을 저장했어요.', () => {
      page.dirty = false;
      if (isNew && queue.files.length) nextInQueue();
      else if (record) details(id);
      else dialog.close();
    });
    if (saved) protectStorage();
  });
  shell.append(form);
  showPreview();
  showDialog();
  if (file) setImage(file);
  else if (isNew) warmUp();
  // On phones, go straight to the photo picker: that is how most coupons arrive.
  if (pick && isNew && coarsePointer.matches) upload.click();
}

// Reads each remaining image and saves it when brand, name and expiry were all found and the
// number is new. The rest come back one by one for the user to check.
async function autoRegisterRest(draft) {
  const files = queue.files.splice(0);
  const review = [];
  const codes = new Set(records.map(record => codeDigits(record.code)).filter(Boolean));
  const extraBrands = walletBrands();
  let saved = 0;
  const page = { kind: 'auto', busy: true, stop: false };
  const shell = openDialog('자동 등록', page);
  const body = el('div', 'dialog-body auto-progress');
  const label = el('p', 'read-status reading', '준비하고 있어요…');
  label.setAttribute('role', 'status');
  const bar = el('progress');
  bar.max = files.length;
  bar.value = 0;
  const note = el('p', 'settings-note', '브랜드·상품명·유효기간을 모두 읽은 기프티콘만 바로 등록하고, 나머지는 끝난 뒤 하나씩 보여 드려요.');
  body.append(label, bar, note);
  const actions = el('div', 'dialog-actions');
  const stop = button('중지', 'button-secondary', () => { page.stop = true; stop.disabled = true; label.textContent = '지금 이미지까지만 처리하고 멈출게요…'; });
  actions.append(stop);
  shell.append(body, actions);
  showDialog();

  const save = async (file, fields, thumb) => {
    const now = Date.now();
    const record = {
      id: crypto.randomUUID(), used: false, createdAt: now, updatedAt: now, memo: '', balance: null, category: '기타',
      ...fields, image: await shrinkForStorage(file).catch(() => file), thumb: (await thumb) || (await makeThumbnail(file).catch(() => null)),
    };
    await putMany([record]);
    justAdded.add(record.id);
    if (record.code) codes.add(codeDigits(record.code));
    saved++;
  };
  try {
    if (draft.complete && draft.file) await save(draft.file, draft.fields, draft.thumb);
    else if (draft.file) review.push(draft.file);
    for (const [i, file] of files.entries()) {
      if (page.stop) { review.push(...files.slice(i)); break; }
      label.textContent = `자동 등록 중… ${i + 1}/${files.length}`;
      try {
        const found = await readGifticon(file, undefined, { extraBrands });
        const duplicate = found.code && codes.has(codeDigits(found.code));
        if (found.brand && found.name && found.expiry && !duplicate) {
          await save(file, { brand: found.brand, name: found.name, expiry: found.expiry, category: found.category, code: found.code, balance: found.balance });
        } else {
          review.push(file);
        }
      } catch {
        review.push(file);
      }
      bar.value = i + 1;
    }
  } catch (error) {
    announce(errorMessage(error));
  } finally {
    page.busy = false;
  }
  await refresh().catch(() => {});
  if (saved) protectStorage();
  if (!review.length) {
    dialog.close();
    announce(`기프티콘 ${saved}개를 자동으로 등록했어요.`);
    return;
  }
  announce(saved ? `${saved}개를 등록했어요. ${review.length}개는 확인이 필요해요.` : `${review.length}개 모두 확인이 필요해요.`);
  Object.assign(queue, { files: review.slice(1), index: 1, total: review.length, label: '확인이 필요한 기프티콘' });
  editor(null, { file: review[0] });
}

/* ---------- details ---------- */

const refundNote = '유효기간이 지났어도 구매처(선물하기 앱 등)에서 기간 연장이나 환불을 받을 수 있는 경우가 많아요. 만료 후에도 결제 금액의 90%를 돌려받을 수 있는지 선물함에서 확인해 보세요.';

function details(id) {
  const record = records.find(item => item.id === id);
  if (!record) { dialog.close(); announce('삭제된 기프티콘이에요.'); return; }
  const today = localDay();
  const status = statusOf(record, today);
  const page = { kind: 'details', id, version: record.updatedAt || record.createdAt };
  const shell = openDialog('기프티콘 상세', page);
  const body = el('div', 'dialog-body');
  body.append(badge(record, today), el('p', 'coupon-brand', record.brand), el('h3', 'detail-name', record.name));
  // The main thing people open a coupon for: showing it at the counter.
  if (isUsable(status) && (record.image || record.code)) {
    const show = button('', 'show-button', () => openViewer(record.image, record));
    show.append(icon('expand'), document.createTextNode('쿠폰 보여주기'));
    body.append(show);
  }

  const fields = el('dl', 'detail-fields');
  const row = (title, value) => {
    const dd = el('dd');
    if (value instanceof Node) dd.append(value); else dd.textContent = value;
    fields.append(el('dt', '', title), dd);
    return dd;
  };
  const days = daysLeft(record.expiry, today);
  const remaining = record.used ? '' : days > 0 ? ` (${days}일 남음)` : days === 0 ? ' (오늘까지)' : ' (만료)';
  const expiryRow = el('span', 'code-row');
  expiryRow.append(el('span', '', formatDate(record.expiry) + '까지' + remaining));
  // Many gift coupons can be extended in the store app; record the new date right here.
  if (!record.used && (status === 'expired' || status === 'expiring')) {
    expiryRow.append(button('연장했어요', 'copy-button', () => extendForm(record, expiryRow)));
  }
  row('유효기간', expiryRow);
  if (record.balance != null) {
    const balanceRow = el('span', 'code-row');
    balanceRow.append(el('span', '', formatWon(record.balance)));
    if (isUsable(status) && record.balance > 0) {
      balanceRow.append(button('사용 금액 입력', 'copy-button', () => spendForm(record, balanceRow)));
    }
    row('잔액', balanceRow);
  }
  row('카테고리', record.category);
  if (record.code) {
    const wrap = el('span', 'code-row');
    const copy = button('복사', 'copy-button', async () => {
      const digits = codeDigits(record.code);
      const value = /^[\d\s-]+$/.test(record.code) ? digits : record.code;
      try {
        await navigator.clipboard.writeText(value);
        copy.textContent = '복사했어요';
      } catch {
        copy.textContent = '복사 실패';
      }
      setTimeout(() => { copy.textContent = '복사'; }, 2000);
    });
    copy.setAttribute('aria-label', '쿠폰 번호 복사');
    wrap.append(el('span', 'coupon-code', record.code), copy);
    row('쿠폰 번호', wrap);
  }
  if (record.memo) row('메모', record.memo);
  body.append(fields);
  if (status === 'expired') body.append(el('p', 'notice', refundNote));

  if (record.image) {
    const figure = el('figure', 'detail-figure');
    const open = button('', 'detail-image-button', () => openViewer(record.image, record));
    open.setAttribute('aria-label', '이미지 크게 보기');
    const img = el('img', 'detail-image');
    img.src = objectURL(record.image);
    img.alt = '등록한 기프티콘 원본';
    const hint = el('span', 'zoom-hint');
    hint.append(icon('expand'), document.createTextNode('크게 보기'));
    open.append(img, hint);
    figure.append(open);
    const share = shareButton(record);
    if (share) {
      const tools = el('div', 'figure-actions');
      tools.append(share);
      figure.append(tools);
    }
    body.append(figure);
  }

  const actions = el('div', 'dialog-actions');
  actions.append(
    button('삭제', 'button-danger action-delete', () => confirmDelete(record)),
    button('수정', 'button-secondary', () => editor(record)),
    button(record.used ? '사용 취소' : '사용 완료', 'button-primary', () => markUsed(record, !record.used)),
  );
  shell.append(body, actions);
  showDialog();
  // The screen stays on while a usable coupon is shown at the counter.
  if (status === 'available' || status === 'expiring') {
    page.awake = true;
    keepAwake(true);
  }
}

function extendForm(record, host) {
  const form = el('form', 'spend-form');
  const input = el('input');
  Object.assign(input, { type: 'date', value: record.expiry, min: record.expiry, required: true });
  input.setAttribute('aria-label', '새 유효기간');
  const submit = el('button', 'copy-button', '저장');
  submit.type = 'submit';
  form.append(input, submit, button('취소', 'copy-button', () => details(record.id)));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!input.value || input.value <= record.expiry) { input.focus(); return; }
    const expiry = input.value;
    const previous = record.expiry;
    const done = await writeFromDialog(record.id, old => ({ ...existing(old), expiry, updatedAt: Date.now() }), null, () => details(record.id));
    if (!done) return;
    announce(`유효기간을 ${formatDate(expiry)}까지로 바꿨어요.`, {
      label: '실행 취소',
      run: () => mutate(record.id, old => ({ ...existing(old), expiry: previous, updatedAt: Date.now() }))
        .then(refresh).catch(error => announce(errorMessage(error))),
    });
  });
  host.replaceChildren(form);
  input.focus();
}

// Gift cards (금액권) are spent in parts: subtract what was used, and finish it at zero.
function spendForm(record, host) {
  const form = el('form', 'spend-form');
  const input = el('input');
  Object.assign(input, { type: 'text', inputMode: 'numeric', placeholder: '사용한 금액', autocomplete: 'off' });
  input.setAttribute('aria-label', '사용한 금액(원)');
  const submit = el('button', 'copy-button', '차감');
  submit.type = 'submit';
  form.append(input, submit, button('취소', 'copy-button', () => details(record.id)));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const spent = parseWon(input.value);
    if (!spent) { input.focus(); return; }
    const before = { balance: record.balance, used: record.used };
    const balance = Math.max(0, record.balance - spent);
    const finished = balance === 0;
    const done = await writeFromDialog(record.id, old => ({ ...existing(old), balance, used: finished || old.used, updatedAt: Date.now() }), null,
      () => (finished ? dialog.close() : details(record.id)));
    if (!done) return;
    announce(finished ? '잔액을 모두 써서 사용 완료로 표시했어요.' : `${formatWon(spent)} 사용 · 잔액 ${formatWon(balance)}`, {
      label: '실행 취소',
      run: () => mutate(record.id, old => ({ ...existing(old), ...before, updatedAt: Date.now() }))
        .then(refresh).catch(error => announce(errorMessage(error))),
    });
  });
  input.addEventListener('blur', () => {
    const won = parseWon(input.value);
    if (won != null) input.value = won.toLocaleString('ko-KR');
  });
  host.replaceChildren(el('span', '', formatWon(record.balance)), form);
  input.focus();
}

// Passing a coupon on (선물) or saving it elsewhere: the system share sheet, where supported.
function shareButton(record) {
  if (!record.image || !navigator.canShare) return null;
  const extension = (record.image.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const name = `${record.brand} ${record.name}`.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'gifticon';
  const file = new File([record.image], `${name}.${extension}`, { type: record.image.type });
  if (!navigator.canShare({ files: [file] })) return null;
  const node = button('', 'button-ghost', async () => {
    try {
      await navigator.share({ files: [file], title: record.name });
    } catch (error) {
      if (error?.name !== 'AbortError') announce('이미지를 공유하지 못했어요.');
    }
  });
  node.append(icon('share'), document.createTextNode('이미지 공유'));
  return node;
}

/* ---------- feedback when a coupon is used ---------- */

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// A card as it looks now, to animate after the list has already re-rendered without it.
function captureCard(id) {
  const node = cards.get(id)?.node;
  if (!node?.isConnected) return null;
  const rect = node.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > innerHeight) return null;
  return { clone: node.cloneNode(true), rect };
}

// Phones: a used coupon shrinks into the 지난 tab, so it is clear where it went.
function flyToPast(captures) {
  const tab = $('.tab[data-tab="past"]');
  if (calm() || !phone.matches || !tab?.offsetWidth) return;
  const target = tab.getBoundingClientRect();
  const flights = captures.filter(Boolean).map(({ clone, rect }) => {
    clone.classList.remove('selected', 'swiping');
    clone.classList.add('flying');
    Object.assign(clone.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    document.body.append(clone);
    const dx = target.left + target.width / 2 - (rect.left + rect.width / 2);
    const dy = target.top + target.height / 2 - (rect.top + rect.height / 2);
    return clone.animate([
      { transform: 'none', opacity: 1 },
      { transform: `translate(${dx * 0.35}px, ${dy * 0.15 - 20}px) scale(.8)`, opacity: 0.9, offset: 0.35 },
      { transform: `translate(${dx}px, ${dy}px) scale(.1)`, opacity: 0.15 },
    ], { duration: 560, easing: 'cubic-bezier(.4,0,.7,.2)' }).finished.finally(() => clone.remove());
  });
  if (flights.length) Promise.all(flights).then(() => {
    tab.classList.remove('pop');
    void tab.offsetWidth;
    tab.classList.add('pop');
  }, () => {});
}

// A check that draws itself in the middle of the screen: done.
function doneStamp() {
  if (calm()) return;
  const stamp = el('div', 'done-stamp');
  stamp.setAttribute('aria-hidden', 'true');
  stamp.innerHTML = '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="23"/><path d="m15 27 7.5 7.5L38 19"/></svg>';
  const host = all('dialog[open]').filter(node => node.matches(':modal')).at(-1) || document.body;
  host.append(stamp);
  setTimeout(() => stamp.remove(), 950);
}

async function markUsed(record, used) {
  // A gift card with money left was probably only partly spent.
  if (used && record.balance > 0 && !(await ask(`잔액 ${formatWon(record.balance)}이 남아 있어요. 전부 사용했나요? 일부만 썼다면 ‘사용 금액 입력’으로 잔액을 줄여 주세요.`, { yes: '다 썼어요', no: '취소' }))) return;
  const capture = used ? captureCard(record.id) : null;
  const done = await writeFromDialog(record.id, old => ({ ...existing(old), used, updatedAt: Date.now() }), null, () => dialog.close());
  if (!done) return;
  if (used) {
    navigator.vibrate?.(30);
    doneStamp();
    flyToPast([capture]);
  }
  announce(used ? `‘${record.name}’ 사용 완료` : '사용 처리를 취소했어요.', {
    label: '실행 취소',
    run: () => mutate(record.id, old => ({ ...existing(old), used: !used, updatedAt: Date.now() }))
      .then(refresh).catch(error => announce(errorMessage(error))),
  });
}

// Coupons of the same brand that can be shown at the counter, soonest to expire first: the
// full-screen view pages through them, so several 스타벅스 coupons are used one after another.
function viewerGroup(record) {
  const today = localDay();
  const group = sortCoupons(records.filter(item => item.brand === record.brand && isUsable(statusOf(item, today)) &&
    (item.image || item.code)), 'expiry', today);
  return group.length > 1 && group.some(item => item.id === record.id) ? group : null;
}

// Full-screen coupon for the counter. With a record, the bottom bar shows the number and lets
// the user mark it used right there, without going back to the details sheet.
let viewerPager = null;
function openViewer(blob, record) {
  let group = record ? viewerGroup(record) : null;
  let index = group ? group.findIndex(item => item.id === record.id) : 0;
  const close = button('', 'icon-button viewer-close', () => viewer.close());
  close.append(icon('close'));
  close.setAttribute('aria-label', '닫기');
  const draw = direction => {
    const current = group ? group[index] : record;
    const picture = group ? current.image : blob;
    let content;
    if (picture) {
      content = el('img', 'viewer-image');
      content.src = objectURL(picture);
      content.alt = '기프티콘 원본';
    } else {
      // No image: the number, large enough for the cashier to type in.
      content = el('div', 'viewer-code');
      content.append(el('p', '', current.brand), el('strong', '', current.code));
    }
    if (direction) content.classList.add('slide-in-' + direction);
    viewer.replaceChildren(close, content);
    viewer.classList.toggle('has-bar', Boolean(current));
    if (!current) return;
    const bar = el('div', 'viewer-bar');
    const info = el('div', 'viewer-info');
    info.append(el('strong', '', current.name));
    if (current.code) info.append(el('span', 'coupon-code', current.code));
    if (current.balance != null) info.append(el('span', 'viewer-balance', `잔액 ${formatWon(current.balance)}`));
    bar.append(info);
    if (group) {
      // Which of the brand's coupons this is; swipe sideways (or tap) for the others.
      const pager = el('div', 'viewer-pager');
      pager.setAttribute('aria-label', `${group.length}장 중 ${index + 1}번째`);
      group.forEach((item, i) => {
        const dot = button('', 'viewer-dot', () => go(i));
        dot.setAttribute('aria-label', `${i + 1}번째 쿠폰`);
        if (i === index) dot.setAttribute('aria-current', 'true');
        pager.append(dot);
      });
      viewer.append(pager);
    }
    if (isUsable(statusOf(current))) {
      bar.append(button('사용 완료', 'button-primary', async () => {
        if (!group) { viewer.close(); markUsed(current, true); return; }
        // Several coupons: stay on screen and move to the next one.
        if (!(await quickToggleUsed(current, { stamp: true }))) return;
        group = group.filter(item => item.id !== current.id);
        if (!group.length) { viewer.close(); return; }
        if (group.length === 1) { record = group[0]; group = null; index = 0; blob = record.image; draw('right'); return; }
        index = Math.min(index, group.length - 1);
        draw('right');
      }));
    }
    viewer.append(bar);
    // Redrawing replaced the viewer's children, the 실행 취소 toast among them.
    placeToast();
  };
  const go = next => {
    if (!group || next < 0 || next >= group.length || next === index) return false;
    const direction = next > index ? 'right' : 'left';
    index = next;
    draw(direction);
    navigator.vibrate?.(8);
    return true;
  };
  viewerPager = { next: () => go(index + 1), prev: () => go(index - 1) };
  draw();
  viewer.showModal();
}

// Safari's images read from IndexedDB point at files inside the database: deleting the coupon
// deletes those files, so 실행 취소 keeps a copy with the images in memory, made before the delete.
const keepForUndo = detach;

/* ---------- swipe a card: right = 사용 완료 (or 사용 취소), left = 삭제, both undoable ---------- */

async function quickToggleUsed(record, { stamp = false } = {}) {
  const used = !record.used;
  if (used && record.balance > 0 && !(await ask(`잔액 ${formatWon(record.balance)}이 남아 있어요. 전부 사용했나요? 일부만 썼다면 ‘사용 금액 입력’으로 잔액을 줄여 주세요.`, { yes: '다 썼어요', no: '취소' }))) return false;
  try {
    await mutate(record.id, old => ({ ...existing(old), used, updatedAt: Date.now() }));
    await refresh();
  } catch (error) {
    announce(errorMessage(error));
    return false;
  }
  if (used) navigator.vibrate?.(30);
  if (used && stamp) doneStamp();
  announce(used ? `‘${record.name}’ 사용 완료` : '사용 처리를 취소했어요.', {
    label: '실행 취소',
    run: () => mutate(record.id, old => ({ ...existing(old), used: !used, updatedAt: Date.now() }))
      .then(refresh).catch(error => announce(errorMessage(error))),
  });
  return true;
}

async function quickDelete(record) {
  let kept;
  try {
    kept = await keepForUndo(record);
    await mutate(record.id, () => null);
    await refresh();
  } catch (error) {
    announce(errorMessage(error));
    return false;
  }
  announce('기프티콘을 삭제했어요.', {
    label: '실행 취소',
    run: () => mutate(record.id, () => ({ ...kept, updatedAt: Date.now() }))
      .then(refresh).then(() => announce('삭제를 취소했어요.')).catch(error => announce(errorMessage(error))),
  });
  return true;
}

// One backdrop for the card being dragged, placed behind it: what letting go will do.
const swipeBack = el('div', 'swipe-back');
// Swiping only uncovers a button (OPEN px wide): 사용 완료 on the left, 삭제 on the right.
// Nothing happens until that button is tapped.
const OPEN = 96;
let openSwipe = null;
function closeSwipe(animate = true) {
  if (!openSwipe) return;
  const { card } = openSwipe;
  openSwipe = null;
  if (animate) {
    card.classList.add('swipe-return');
    setTimeout(() => card.classList.remove('swipe-return'), 250);
  }
  card.style.transform = '';
  card.classList.remove('swiping');
  swipeBack.remove();
  swipeBack.classList.remove('armed');
  delete swipeBack.dataset.side;
}

/* ---------- select several: long-press a card, then tap others; act on all at once ---------- */

const selected = new Set();
let selecting = false;
const selectBar = el('div', 'select-bar');
selectBar.setAttribute('role', 'toolbar');
selectBar.setAttribute('aria-label', '선택한 기프티콘');
selectBar.hidden = true;

function startSelecting(id) {
  selecting = true;
  selected.clear();
  if (id) selected.add(id);
  navigator.vibrate?.(15);
  syncSelection();
}

function stopSelecting() {
  if (!selecting) return;
  selecting = false;
  selected.clear();
  syncSelection();
}

function toggleSelected(id) {
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  if (!selected.size) { stopSelecting(); return; }
  syncSelection();
}

// Card checkmarks and the action bar follow the selection (also after every re-render).
function syncSelection() {
  const ids = new Set(records.map(record => record.id));
  for (const id of selected) if (!ids.has(id)) selected.delete(id);
  if (selecting && !selected.size && !records.length) selecting = false;
  document.body.classList.toggle('selecting', selecting);
  for (const card of all('#coupon-list .coupon-card')) {
    const on = selecting && selected.has(card.dataset.id);
    card.classList.toggle('selected', on);
    if (selecting) card.setAttribute('aria-pressed', String(on)); else card.removeAttribute('aria-pressed');
  }
  selectBar.hidden = !selecting;
  if (!selecting) return;
  if (!selectBar.isConnected) document.body.append(selectBar);
  const chosen = records.filter(record => selected.has(record.id));
  const today = localDay();
  const usable = chosen.filter(record => isUsable(statusOf(record, today)));
  const close = button('', 'icon-button', stopSelecting);
  close.append(icon('close'));
  close.setAttribute('aria-label', '선택 취소');
  const actions = el('div', 'select-actions');
  if (chosen.length === 1) {
    const [only] = chosen;
    if (usable.length && (only.image || only.code)) actions.append(button('보여주기', 'button-secondary', () => { stopSelecting(); openViewer(only.image, only); }));
    actions.append(button('수정', 'button-secondary', () => { stopSelecting(); editor(only); }));
  }
  if (usable.length) actions.append(button('사용 완료', 'button-primary', () => bulkUsed(usable)));
  actions.append(button('삭제', 'button-danger', () => bulkDelete(chosen)));
  selectBar.replaceChildren(close, el('strong', 'select-count', `${chosen.length}개 선택`), actions);
}

async function bulkUsed(list) {
  const withMoney = list.filter(record => record.balance > 0);
  if (withMoney.length && !(await ask(`잔액이 남은 금액권 ${withMoney.length}개가 있어요. 모두 사용 완료할까요?`, { yes: '모두 사용 완료', no: '취소' }))) return;
  const now = Date.now();
  const captures = list.map(record => captureCard(record.id));
  try {
    for (const record of list) await mutate(record.id, old => ({ ...existing(old), used: true, updatedAt: now }));
  } catch (error) { announce(errorMessage(error)); await refresh(); return; }
  stopSelecting();
  await refresh();
  navigator.vibrate?.(30);
  flyToPast(captures);
  announce(`${list.length}개를 사용 완료했어요.`, {
    label: '실행 취소',
    run: () => list.reduce((done, record) => done.then(() =>
      mutate(record.id, old => ({ ...existing(old), used: record.used, updatedAt: Date.now() }))), Promise.resolve())
      .then(refresh).catch(error => announce(errorMessage(error))),
  });
}

async function bulkDelete(list) {
  let kept;
  try {
    kept = await Promise.all(list.map(keepForUndo));
    await deleteMany(list.map(record => record.id));
  } catch (error) { announce(errorMessage(error)); return; }
  stopSelecting();
  await refresh();
  announce(`${list.length}개를 삭제했어요.`, {
    label: '실행 취소',
    run: () => putMany(kept.map(record => ({ ...record, updatedAt: Date.now() })))
      .then(refresh).then(() => announce('삭제를 취소했어요.')).catch(error => announce(errorMessage(error))),
  });
}

// Sideways swipes in the full-screen coupon and the details sheet move to the next coupon.
function horizontalSwipe(target, onSwipe) {
  let start = null;
  target.addEventListener('pointerdown', event => {
    if (event.button > 0 || event.target.closest('input, textarea, select')) { start = null; return; }
    start = { x: event.clientX, y: event.clientY, t: Date.now() };
  });
  const end = event => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const quick = Date.now() - start.t < 600;
    start = null;
    if (event.type !== 'pointerup' || Math.abs(dx) < (quick ? 50 : 90) || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    if (onSwipe(dx < 0 ? 'next' : 'prev')) {
      // The tap that ends a swipe must not also press a button underneath.
      const block = e => { e.stopPropagation(); e.preventDefault(); };
      target.addEventListener('click', block, { capture: true, once: true });
      setTimeout(() => target.removeEventListener('click', block, { capture: true }), 0);
    }
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}

// The coupon next to the one open in details, in the order the list shows them.
function neighbour(id, step) {
  const ids = all('#coupon-list .coupon-card').map(card => card.dataset.id);
  const i = ids.indexOf(id);
  return i < 0 ? null : ids[i + step] || null;
}

function stepDetails(direction) {
  if (currentPage?.kind !== 'details' || currentPage.busy) return false;
  const next = neighbour(currentPage.id, direction === 'next' ? 1 : -1);
  if (!next) return false;
  details(next);
  $('.dialog-body', dialog)?.classList.add('slide-in-' + (direction === 'next' ? 'right' : 'left'));
  navigator.vibrate?.(8);
  return true;
}

function wireSwipe() {
  horizontalSwipe(viewer, direction => viewerPager?.[direction]() || false);
  horizontalSwipe(dialog, stepDetails);
  viewer.addEventListener('close', () => { viewerPager = null; });
  document.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.target.closest('input, textarea, select')) return;
    const direction = event.key === 'ArrowRight' ? 'next' : 'prev';
    if (viewer.open) viewerPager?.[direction]();
    else if (dialog.open) stepDetails(direction);
  });
  const list = $('#coupon-list');
  let drag = null;
  let suppressClick = false;
  let pressTimer;
  const reset = card => {
    card.style.transform = '';
    card.classList.remove('swiping');
    swipeBack.remove();
    swipeBack.classList.remove('armed');
    delete swipeBack.dataset.side;
  };
  // With a 삭제 button showing, any other touch just closes it (and does nothing else).
  document.addEventListener('pointerdown', event => {
    if (!openSwipe || swipeBack.contains(event.target)) return;
    closeSwipe();
    if (list.contains(event.target)) {
      suppressClick = true;
      const release = () => setTimeout(() => { suppressClick = false; }, 0);
      addEventListener('pointerup', release, { once: true, capture: true });
    }
    event.stopPropagation();
  }, true);
  list.addEventListener('pointerdown', event => {
    const card = event.target.closest('.coupon-card');
    if (!card || event.button > 0 || drag || suppressClick) return;
    drag = { card, id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, state: 'pending', armed: false };
    // Holding a card still starts selecting (or adds it while selecting).
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      if (!drag || drag.card !== card || drag.state !== 'pending') return;
      drag = null;
      suppressClick = true;
      if (selecting) toggleSelected(card.dataset.id); else startSelecting(card.dataset.id);
    }, 450);
  });
  list.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (drag.state === 'pending') {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimeout(pressTimer);
      if (selecting || (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx))) { if (Math.abs(dx) > 8 || Math.abs(dy) > 8) drag = null; return; }
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      drag.state = 'swiping';
      drag.record = records.find(record => record.id === drag.card.dataset.id);
      if (!drag.record) { drag = null; return; }
      list.setPointerCapture(event.pointerId);
      drag.card.classList.add('swiping');
      const { card } = drag;
      const listBox = list.getBoundingClientRect();
      const cardBox = card.getBoundingClientRect();
      Object.assign(swipeBack.style, { top: `${cardBox.top - listBox.top}px`, left: `${cardBox.left - listBox.left}px`, width: `${card.offsetWidth}px`, height: `${card.offsetHeight}px` });
      list.append(swipeBack);
    }
    // The card stops at the button; further it follows the finger only a little.
    const shown = Math.abs(dx) <= OPEN ? dx : Math.sign(dx) * (OPEN + (Math.abs(dx) - OPEN) * 0.2);
    drag.dx = dx;
    drag.card.style.transform = `translateX(${shown}px)`;
    const side = dx > 0 ? 'use' : 'delete';
    if (swipeBack.dataset.side !== side) {
      swipeBack.dataset.side = side;
      const record = drag.record;
      const undo = side === 'use' && record.used;
      const action = button('', 'swipe-action', async () => {
        const card = openSwipe?.card;
        openSwipe = null;
        if (card) {
          card.classList.add('swipe-return');
          card.style.transform = `translateX(${side === 'use' ? '' : '-'}${card.offsetWidth + 40}px)`;
          await new Promise(resolve => setTimeout(resolve, 180));
        }
        const done = side === 'use' ? await quickToggleUsed(record) : await quickDelete(record);
        if (!done && card) { card.style.transform = ''; swipeBack.remove(); }
      });
      action.append(icon(side === 'delete' ? 'trash' : undo ? 'undo' : 'check'),
        el('span', '', side === 'delete' ? '삭제' : undo ? '사용 취소' : '사용 완료'));
      action.style.width = `${OPEN}px`;
      swipeBack.replaceChildren(action);
    }
    const armed = Math.abs(dx) >= OPEN;
    if (armed !== drag.armed) {
      drag.armed = armed;
      swipeBack.classList.toggle('armed', armed);
      if (armed) navigator.vibrate?.(10);
    }
  });
  const finish = async event => {
    clearTimeout(pressTimer);
    if (suppressClick && !drag) { setTimeout(() => { suppressClick = false; }, 0); return; }
    if (!drag || event.pointerId !== drag.id) return;
    const { card, state, dx, record } = drag;
    drag = null;
    if (state !== 'swiping') return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (Math.abs(dx) >= OPEN / 2 && event.type !== 'pointercancel') {
      // Stay open on the button until it is tapped or the user touches anything else.
      card.classList.add('swipe-return');
      card.style.transform = `translateX(${Math.sign(dx) * OPEN}px)`;
      setTimeout(() => card.classList.remove('swipe-return'), 250);
      openSwipe = { card, record };
      swipeBack.querySelector('.swipe-action')?.focus({ preventScroll: true });
      return;
    }
    card.classList.add('swipe-return');
    reset(card);
    setTimeout(() => card.classList.remove('swipe-return'), 250);
  };
  list.addEventListener('pointerup', finish);
  list.addEventListener('pointercancel', finish);
  // A drag (or a long press) is not a tap: it must not open the details. While selecting, a tap
  // picks the card instead.
  list.addEventListener('click', event => {
    const card = event.target.closest('.coupon-card');
    if (!card) return;
    if (suppressClick) { event.stopPropagation(); event.preventDefault(); return; }
    if (selecting) { event.stopPropagation(); event.preventDefault(); toggleSelected(card.dataset.id); return; }
    const pile = card.closest('.coupon-stack');
    if (pile) {
      event.stopPropagation();
      event.preventDefault();
      stackOpen.add(pile.dataset.brand);
      render();
      for (const node of all(`#coupon-list .coupon-card`)) {
        const record = records.find(item => item.id === node.dataset.id);
        if (record?.brand === pile.dataset.brand) node.classList.add('fan-in');
      }
      setTimeout(() => all('#coupon-list .fan-in').forEach(node => node.classList.remove('fan-in')), 400);
    }
  }, true);
  // Right-click (desktop) also starts selecting.
  list.addEventListener('contextmenu', event => {
    const card = event.target.closest('.coupon-card');
    if (!card) return;
    event.preventDefault();
    if (selecting) toggleSelected(card.dataset.id); else startSelecting(card.dataset.id);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && openSwipe) { closeSwipe(); return; }
    if (event.key === 'Escape' && selecting && !dialog.open && !viewer.open) stopSelecting();
  });
}

function confirmDelete(record) {
  const shell = openDialog('기프티콘을 삭제할까요?', { kind: 'confirm', id: record.id });
  const body = el('div', 'dialog-body');
  body.append(el('p', '', '‘' + record.name + '’의 쿠폰 정보와 이미지가 이 기기에서 삭제돼요.'));
  const actions = el('div', 'dialog-actions');
  actions.append(button('취소', 'button-secondary', () => details(record.id)), button('삭제하기', 'button-danger', async () => {
    let snapshot;
    try {
      snapshot = await keepForUndo(records.find(item => item.id === record.id) || record);
    } catch (error) {
      showError(errorMessage(error));
      return;
    }
    const deleted = await writeFromDialog(record.id, () => null, null, () => dialog.close());
    if (!deleted) return;
    announce('기프티콘을 삭제했어요.', {
      label: '실행 취소',
      run: () => mutate(record.id, () => ({ ...snapshot, updatedAt: Date.now() }))
        .then(refresh).then(() => announce('삭제를 취소했어요.'))
        .catch(error => announce(errorMessage(error))),
    });
  }));
  shell.append(body, actions);
  showDialog();
}

/* ---------- settings ---------- */

const THEME_KEY = 'gifticon-pocket:theme';
const THEME_COLORS = { light: '#ffffff', dark: '#1e1b23' };

// index.html applies the saved theme before first paint; this keeps the browser bar in step.
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  for (const meta of all('meta[name="theme-color"]')) {
    const own = /dark/.test(meta.media) ? 'dark' : 'light';
    meta.content = THEME_COLORS[root.dataset.theme || own];
  }
}

function themeControl() {
  const current = store.get(THEME_KEY) || 'system';
  const group = el('fieldset', 'segmented');
  group.append(el('legend', 'visually-hidden', '화면 테마'));
  for (const [value, label] of [['system', '기기 설정'], ['light', '밝게'], ['dark', '어둡게']]) {
    const option = el('label', '', label);
    const input = el('input');
    Object.assign(input, { type: 'radio', name: 'theme', value, checked: value === current });
    input.addEventListener('change', () => {
      store.set(THEME_KEY, value);
      applyTheme(value);
    });
    option.prepend(input);
    group.append(option);
  }
  return group;
}

function section(title, ...children) {
  const node = el('section', 'settings-section');
  node.append(el('h3', '', title), ...children);
  return node;
}

async function settings() {
  const page = { kind: 'settings' };
  const shell = openDialog('설정', page);
  const body = el('div', 'dialog-body settings');
  const notify = el('div', 'settings-block');
  const backup = el('div', 'settings-block');
  const space = el('div', 'settings-block');
  body.append(
    hasPushBackend ? section('만료 알림', el('p', 'settings-desc', '만료 3일 전과 만료일 오전 9시에 알려 드려요.'), notify,
      el('p', 'settings-note', '알림을 보내려고 유효기간과 브랜드·상품명을 서버에 보관해요. 쿠폰 번호와 이미지는 보내지 않아요.')) :
      section('만료 임박', el('p', 'settings-desc', '유효기간이 7일 이내인 기프티콘을 확인할 수 있어요.'),
        button('만료 임박 보기', 'button-secondary', () => { dialog.close(); setFilter('expiring'); })),
    section('캘린더 알림', el('p', 'settings-desc', hasPushBackend
      ? '알림 대신 캘린더를 쓰고 싶다면, 만료일을 캘린더에 넣어 두면 만료 3일 전과 당일 오전 9시에 캘린더가 알려 줘요.'
      : '만료일을 휴대폰 캘린더에 넣어 두면 만료 3일 전과 당일 오전 9시에 캘린더가 알려 줘요. 앱을 열지 않아도 알림이 와요.'),
      calendarButton(),
      el('p', 'settings-note', '쿠폰을 새로 등록했다면 다시 받아 추가해 주세요. 같은 쿠폰은 겹치지 않고 바뀐 내용으로 갱신돼요.')),
    section('백업', el('p', 'settings-desc', '기기를 바꾸거나 브라우저 데이터를 지우면 쿠폰도 사라져요. 가끔 백업 파일을 저장해 두세요.'), backup),
    section('저장 공간', space),
    section('화면', el('p', 'settings-desc', '기기 설정을 따르거나 밝은 화면·어두운 화면으로 고정할 수 있어요.'), themeControl()),
  );
  const past = records.filter(record => !isUsable(statusOf(record)));
  body.append(section('정리', el('p', 'settings-desc', '사용했거나 기간이 지난 기프티콘을 한 번에 지워 목록과 저장 공간을 비워요.'),
    past.length ? button(`지난 기프티콘 ${past.length}개 삭제`, 'button-danger', () => cleanUp(past)) : el('p', 'settings-status', '정리할 기프티콘이 없어요.')));
  if (canInstall()) {
    body.append(section('앱 설치', el('p', 'settings-desc', '홈 화면에 추가하면 앱처럼 열리고 오프라인에서도 쓸 수 있어요.'),
      button('앱 설치', 'button-secondary', () => promptInstall())));
  }
  const actions = el('div', 'dialog-actions');
  actions.append(button('닫기', 'button-secondary', requestClose));
  shell.append(body, actions);
  showDialog();
  const still = () => currentPage === page;

  async function drawNotify() {
    if (!hasPushBackend) return;
    const state = await pushState();
    if (!still()) return;
    const line = (text, cls = 'settings-status') => el('p', cls, text);
    const run = (label, cls, task) => {
      const node = button(label, cls, async () => {
        node.disabled = true;
        try {
          await task();
        } catch {
          announce(navigator.onLine ? '알림 설정을 바꾸지 못했어요. 잠시 후 다시 시도하거나 브라우저를 최신 버전으로 업데이트해 주세요.' : '인터넷에 연결된 상태에서 다시 시도해 주세요.');
        }
        if (still()) drawNotify();
      });
      return node;
    };
    if (state === 'unsupported') notify.replaceChildren(line('이 브라우저는 알림을 지원하지 않아요.'));
    else if (state === 'needs-install') {
      notify.replaceChildren(line('iPhone·iPad는 홈 화면에 추가한 앱에서만 알림을 받을 수 있어요.'),
        button('홈 화면에 추가하는 방법', 'button-secondary', openInstallGuide));
    } else if (state === 'denied') {
      notify.replaceChildren(line('알림이 차단돼 있어요. 브라우저나 기기 설정에서 기프티콘 포켓의 알림을 허용해 주세요.'));
    } else if (state === 'off') {
      notify.replaceChildren(line('알림이 꺼져 있어요.'), run('알림 켜기', 'button-primary', async () => {
        const result = await enablePush(records);
        if (result === 'on') announce('만료 알림을 켰어요.');
      }));
    } else {
      const row = el('div', 'settings-actions');
      row.append(
        run('테스트 알림 보내기', 'button-secondary', async () => { await sendTestPush(); announce('테스트 알림을 보냈어요. 잠시 후 도착해요.'); }),
        run('알림 끄기', 'button-ghost', async () => { await disablePush(); announce('만료 알림을 껐어요.'); }),
      );
      notify.replaceChildren(line('알림이 켜져 있어요.', 'settings-status on'), row);
    }
  }

  function drawBackup() {
    const last = Number(store.get(BACKUP_KEY) || 0);
    const input = el('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.className = 'visually-hidden';
    input.setAttribute('aria-label', '백업 파일 선택');
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.value = '';
      if (file) await importBackup(file);
      if (still()) { drawBackup(); drawSpace(); }
    });
    const row = el('div', 'settings-actions');
    row.append(
      button('백업 파일 저장', 'button-primary', exportBackup),
      button('백업 불러오기', 'button-secondary', () => input.click()),
      input,
    );
    backup.replaceChildren(el('p', 'settings-status', last
      ? `마지막 백업: ${formatDate(new Date(last).toISOString().slice(0, 10))}`
      : '아직 백업 파일을 저장하지 않았어요.'), row);
  }

  async function drawSpace() {
    let persisted = false;
    let usage = '';
    try {
      persisted = await navigator.storage?.persisted?.() || false;
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.usage != null) usage = ` · 사용 중 ${(estimate.usage / 1048576).toFixed(1)}MB`;
    } catch { /* unsupported */ }
    if (!still()) return;
    const status = el('p', 'settings-status' + (persisted ? ' on' : ''),
      (persisted ? '보호됨: 공간이 부족해도 브라우저가 지우지 않아요.' : '보호 안 됨: 기기 공간이 부족하면 브라우저가 지울 수 있어요.'));
    const detail = el('p', 'settings-note', `기프티콘 ${records.length}개${usage}`);
    space.replaceChildren(status, detail);
    if (!persisted && navigator.storage?.persist) {
      space.append(button('보호 요청', 'button-secondary', async () => {
        const granted = await protectStorage();
        announce(granted ? '저장 공간을 보호하도록 설정했어요.' : '브라우저가 요청을 허락하지 않았어요. 앱을 설치하면 보호될 가능성이 높아져요.');
        if (still()) drawSpace();
      }));
    }
  }

  drawBackup();
  await Promise.all([drawNotify(), drawSpace()]);
}

async function cleanUp(past) {
  if (!(await ask(`사용 완료·기간 만료 기프티콘 ${past.length}개를 삭제할까요? 삭제 직후에는 되돌릴 수 있어요.`, { yes: '삭제하기', danger: true }))) return;
  try {
    const kept = await Promise.all(past.map(keepForUndo));
    await deleteMany(past.map(record => record.id));
    dialog.close();
    await refresh();
    announce(`기프티콘 ${past.length}개를 삭제했어요.`, {
      label: '실행 취소',
      run: () => putMany(kept).then(refresh).then(() => announce('삭제를 취소했어요.')).catch(error => announce(errorMessage(error))),
    });
  } catch (error) {
    announce(errorMessage(error));
  }
}

// Downloads the expiry dates as an .ics file; opening it adds the events with their alarms
// (iPhone: 캘린더에 추가, Android: the calendar app that opens .ics files).
function calendarButton() {
  const { count } = buildCalendar(records);
  if (!count) return el('p', 'settings-status', '사용할 수 있는 기프티콘이 없어요.');
  return button(`캘린더 파일 받기 (${count}개)`, 'button-secondary', () => {
    const { text } = buildCalendar(records);
    const link = el('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    link.download = 'gifticon-pocket-expiry.ics';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    announce('캘린더 파일을 받았어요. 파일을 열어 캘린더에 추가해 주세요.');
  });
}

async function exportBackup() {
  try {
    const blob = await createBackup(records);
    const name = backupFileName();
    const file = new File([blob], name, { type: 'application/json' });
    // Phones: the share sheet can save to Files/Drive. Desktop: a plain download.
    if (coarsePointer.matches && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
      } catch (error) {
        if (error?.name === 'AbortError') return;
        throw error;
      }
    } else {
      const link = el('a');
      link.href = URL.createObjectURL(blob);
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    }
    store.set(BACKUP_KEY, String(Date.now()));
    removeBanner('backup');
    announce(`기프티콘 ${records.length}개를 백업 파일로 저장했어요.`);
    if (currentPage?.kind === 'settings') settings();
  } catch {
    announce('백업 파일을 만들지 못했어요.');
  }
}

async function importBackup(file) {
  try {
    const { records: incoming, skipped } = await readBackup(file);
    await refresh();
    const { changes, added, updated } = mergeBackup(records, incoming);
    if (changes.length) await putMany(changes);
    await refresh();
    const parts = [];
    if (added) parts.push(`${added}개 추가`);
    if (updated) parts.push(`${updated}개 업데이트`);
    if (skipped) parts.push(`${skipped}개는 읽지 못함`);
    announce(parts.length ? `백업을 불러왔어요: ${parts.join(', ')}` : '이미 모두 등록된 기프티콘이에요.');
    if (changes.length) protectStorage();
  } catch (error) {
    announce(error instanceof BackupError ? error.message : errorMessage(error));
  }
}

/* ---------- start ---------- */

// Files sent from another app's share sheet (Android): the service worker parks them in a cache.
async function takeSharedFiles() {
  if (!('caches' in window)) return [];
  const scope = new URL('../', import.meta.url).pathname;
  const cache = await caches.open('gifticon-pocket-share:' + encodeURIComponent(scope));
  const files = [];
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    const blob = await response.blob();
    files.push(new File([blob], decodeURIComponent(response.headers.get('X-File-Name') || 'shared'), { type: blob.type }));
    await cache.delete(request);
  }
  return files;
}

function imageFiles(dataTransfer) {
  return [...(dataTransfer?.files || [])].filter(file => IMAGE_TYPES.includes(file.type));
}

// Phones: drag a sheet down by its top edge (handle and title) to close it.
function enableSwipeToClose() {
  const sheetLayout = matchMedia('(max-width: 520px)');
  let startY = null;
  let distance = 0;
  dialog.addEventListener('touchstart', event => {
    if (!sheetLayout.matches || dialog.scrollTop > 0 || event.target.closest('button, input, select, a')) return;
    const fromTop = event.touches[0].clientY - dialog.getBoundingClientRect().top;
    if (fromTop > 80) return;
    startY = event.touches[0].clientY;
    distance = 0;
    dialog.style.transition = 'none';
  }, { passive: true });
  dialog.addEventListener('touchmove', event => {
    if (startY == null) return;
    distance = Math.max(0, event.touches[0].clientY - startY);
    dialog.style.transform = `translateY(${distance}px)`;
  }, { passive: true });
  const end = () => {
    if (startY == null) return;
    startY = null;
    dialog.style.transition = 'transform .2s ease-out';
    dialog.style.transform = '';
    if (distance > 90) requestClose();
  };
  dialog.addEventListener('touchend', end);
  dialog.addEventListener('touchcancel', end);
}

// iOS lays the keyboard over the page instead of resizing it, which hid the sheet's 등록하기
// button while typing. The covered height becomes --keyboard and the sheet sits above it.
// Browsers that resize the page for the keyboard (Android) report 0, so nothing changes there.
function followKeyboard() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  let last = 0;
  const update = () => {
    const covered = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
    // Small differences are toolbars appearing, not a keyboard.
    const keyboard = covered > 80 ? covered : 0;
    if (keyboard === last) return;
    last = keyboard;
    document.documentElement.style.setProperty('--keyboard', keyboard + 'px');
  };
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
}

function wireEvents() {
  followKeyboard();
  // Reloading or closing the tab mid-form would lose it; the browser asks first.
  addEventListener('beforeunload', event => {
    if (currentPage?.dirty) event.preventDefault();
  });
  document.body.append(dialog, viewer, askDialog);
  // iOS Safari only applies :active (pressed look) when a touch listener exists.
  document.addEventListener('touchstart', () => {}, { passive: true });
  dialog.addEventListener('cancel', event => {
    // A file picker closed without a choice fires a bubbling "cancel" on its <input>; only the
    // sheet's own cancel (Esc, back gesture) means "close".
    if (event.target !== dialog) return;
    // Esc / back: pages that may ask first close through requestClose once the user answers.
    if (!currentPage || currentPage.busy || currentPage.confirmClose) {
      event.preventDefault();
      if (currentPage?.confirmClose && !currentPage.busy) requestClose();
      return;
    }
    queue.files = [];
  });
  enableSwipeToClose();
  // A toast inside a sheet that closes moves out with it, still showing.
  for (const sheet of [viewer, askDialog]) sheet.addEventListener('close', () => placeToast());
  dialog.addEventListener('close', () => {
    placeToast();
    dialog.style.transform = '';
    dialog.style.transition = '';
    currentPage = null;
    clearDialogURLs();
    keepAwake(false);
    restoreFocus();
  });
  viewer.addEventListener('click', event => { if (event.target === viewer) viewer.close(); });
  // Tapping the dimmed area closes a sheet; a drag that started inside it (selecting text) does not.
  for (const sheet of [dialog, $('#install-guide'), askDialog]) {
    let pressedOutside = false;
    sheet.addEventListener('pointerdown', event => { pressedOutside = event.target === sheet; });
    sheet.addEventListener('click', event => {
      if (event.target !== sheet || !pressedOutside) return;
      if (sheet === dialog) requestClose(); else sheet.close();
    });
  }
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action="add"], [data-filter]');
    if (!target) return;
    if (target.dataset.action === 'add') { editor(null, { pick: true }); return; }
    const next = target.dataset.filter;
    // Tapping an active summary card again shows everything.
    setFilter(target.classList.contains('stat') && filter === next ? 'all' : next);
  });
  $('#settings-button').addEventListener('click', settings);
  wireSwipe();
  wireTabbar();
  $('#search').addEventListener('input', render);
  $('#category').addEventListener('change', render);
  $('#sort').addEventListener('change', render);
  // Desktop shortcuts: "/" to search, "n" to register.
  document.addEventListener('keydown', event => {
    if (dialog.open || viewer.open || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest('input, select, textarea, [contenteditable]')) return;
    if (event.key === '/') { event.preventDefault(); $('#search').focus(); }
    if (event.key === 'n') { event.preventDefault(); editor(null, { pick: true }); }
  });
  $('#search').addEventListener('keydown', event => {
    if (event.key === 'Escape' && event.target.value) { event.target.value = ''; render(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (currentPage?.awake) keepAwake(true);
    if (ready) refresh().catch(error => announce(errorMessage(error)));
  });
  addEventListener('online', () => { if (ready) syncReminders(records).catch(() => {}); });
  addEventListener('appinstalled', () => removeBanner('install'));
  // Paste a screenshot (Ctrl+V) or drop image files anywhere to register them.
  document.addEventListener('paste', event => {
    const files = imageFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    if (currentPage?.kind === 'editor' && !currentPage.busy) currentPage.setImage(files[0]);
    else if (!dialog.open) startImport(files);
  });
  // Dragging files over the window shows where they will go.
  let dragDepth = 0;
  const dragging = on => document.body.classList.toggle('drop-ready', on);
  document.addEventListener('dragenter', event => {
    if (dialog.open || ![...event.dataTransfer.types].includes('Files')) return;
    dragDepth++;
    dragging(true);
  });
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dragging(false); } });
  document.addEventListener('dragover', event => {
    if (!dialog.open && [...event.dataTransfer.types].includes('Files')) event.preventDefault();
  });
  document.addEventListener('drop', event => {
    dragDepth = 0;
    dragging(false);
    if (dialog.open) return;
    const files = imageFiles(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    startImport(files);
  });
  let lastDay = localDay();
  setInterval(() => {
    const day = localDay();
    if (day !== lastDay) { lastDay = day; render(); }
  }, 30000);
}

// How images can arrive on this device, shown on the empty screen.
function importTip() {
  const tip = $('#empty-tip');
  if (/Android/.test(navigator.userAgent)) {
    tip.textContent = matchMedia('(display-mode: standalone)').matches
      ? '카카오톡에서 기프티콘 사진을 공유하고 ‘기프티콘 포켓’을 고르면 바로 등록돼요.'
      : '앱을 설치하면 카카오톡 사진의 공유 메뉴에서 바로 보낼 수 있어요.';
  } else if (!coarsePointer.matches) {
    tip.textContent = '이미지 파일을 이 창에 끌어다 놓거나 붙여 넣어도(Ctrl+V) 돼요.';
  }
}

// Reminder links: ?coupon=<id> opens that coupon, ?filter=… shows a list.
function openFromURL(params) {
  if (params.has('coupon')) {
    if (currentPage?.dirty || currentPage?.busy) return;
    if (records.some(record => record.id === params.get('coupon'))) details(params.get('coupon'));
    else announce('알림의 기프티콘을 찾지 못했어요. 이미 삭제했을 수 있어요.');
  } else if (['available', 'expiring', 'used', 'expired'].includes(params.get('filter'))) {
    filter = params.get('filter');
    fitFilterToLayout();
    render();
  }
}

async function start() {
  wireEvents();
  importTip();
  applyTheme(store.get(THEME_KEY));
  initShell({ isBusy: () => Boolean(currentPage?.dirty || currentPage?.busy) });
  restoreView();
  const params = new URLSearchParams(location.search);
  const requested = params.get('filter');
  if (['available', 'expiring', 'used', 'expired'].includes(requested)) { filter = requested; fitFilterToLayout(); }
  try {
    await openDB();
    ready = true;
    onExternalChange(() => refresh().catch(error => announce(errorMessage(error))));
    await refresh();
  } catch (error) {
    document.body.classList.remove('loading');
    $('#empty-state').hidden = true;
    const list = $('#coupon-list');
    list.hidden = false;
    list.replaceChildren(el('p', 'no-results', errorMessage(error)));
    announce(errorMessage(error));
    return;
  }
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'open') openFromURL(new URL(event.data.url, location.href).searchParams);
  });
  if (params.has('shared')) {
    const files = await takeSharedFiles().catch(() => []);
    if (files.length) startImport(files);
    else announce('공유한 이미지를 찾지 못했어요. 다시 공유해 주세요.');
  } else if (params.get('action') === 'add') {
    editor(null);
  } else {
    openFromURL(params);
  }
  if (location.search) history.replaceState(null, '', location.pathname);
}

start();
