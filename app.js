(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const all = selector => [...document.querySelectorAll(selector)];
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const categories = ['카페', '외식', '편의점', '쇼핑', '기타'];
  const statuses = { available: '사용 가능', expiring: '만료 임박', expired: '기간 만료', used: '사용 완료' };
  const dayMs = 86400000;
  const localDay = () => {
    const now = new Date();
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  };
  const daysLeft = (date, today = localDay()) => (Date.parse(date + 'T00:00:00Z') - today) / dayMs;
  const statusOf = (item, today) => {
    if (item.used) return 'used';
    const days = daysLeft(item.expiry, today);
    if (days < 0) return 'expired';
    if (days <= 7) return 'expiring';
    return 'available';
  };
  const matchesStatus = (filter, status) => filter === 'all' || status === filter ||
    (filter === 'available' && status === 'expiring');
  const formatDate = value => value.replaceAll('-', '.');
  const normalize = value => value.toLocaleLowerCase('ko').replace(/\s/g, '');

  let db;
  let records = [];
  let filter = 'all';
  let listURLs = [];
  let imageURL;
  let previousFocus;
  let currentPage;
  let generation = 0;
  let toastTimer;
  const updates = typeof BroadcastChannel === 'function' ? new BroadcastChannel('gifticon-pocket-updated') : null;

  const dialog = el('dialog', 'coupon-dialog');
  dialog.setAttribute('aria-labelledby', 'coupon-dialog-title');
  const toast = el('div', 'toast');
  toast.setAttribute('role', 'status');
  toast.hidden = true;

  function announce(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('gifticon-pocket', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('coupons', { keyPath: 'id' });
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function refresh() {
    const version = ++generation;
    const items = await new Promise((resolve, reject) => {
      const request = db.transaction('coupons').objectStore('coupons').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (version !== generation) return;
    records = items;
    render();
  }

  function mutate(id, change) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('coupons', 'readwrite');
      const store = tx.objectStore('coupons');
      const get = store.get(id);
      let reason;
      get.onsuccess = () => {
        try {
          const next = change(get.result);
          if (next) store.put(next);
          else store.delete(id);
        } catch (error) {
          reason = error;
          tx.abort();
        }
      };
      tx.oncomplete = resolve;
      tx.onabort = () => reject(reason || tx.error);
    });
  }

  function existing(record) {
    if (!record) throw new Error('다른 창에서 삭제한 기프티콘이에요. 목록을 다시 확인해 주세요.');
    return record;
  }

  function errorMessage(error) {
    if (error?.name === 'QuotaExceededError') return '기기 저장 공간이 부족해요. 더 작은 이미지를 선택해 주세요.';
    if (error?.name === 'Error' && error.message.startsWith('다른 창')) return error.message;
    return '기기 저장소에 접근할 수 없어요. 브라우저 저장소 설정을 확인해 주세요.';
  }

  function render() {
    const list = $('#coupon-list');
    const search = normalize($('#search')?.value || '');
    const category = $('#category')?.value || 'all';
    const today = localDay();
    const counts = { all: records.length, available: 0, expiring: 0, used: 0, expired: 0 };
    const shown = records.filter(record => {
      const status = statusOf(record, today);
      counts[status]++;
      if (status === 'expiring') counts.available++;
      return matchesStatus(filter, status) && (category === 'all' || category === record.category) &&
        normalize([record.brand, record.name, record.category].join(' ')).includes(search);
    });
    all('[data-count]').forEach(n => { n.textContent = counts[n.dataset.count] ?? 0; });
    all('[data-filter]').forEach(n => {
      const active = n.dataset.filter === filter;
      n.classList.toggle('active', active);
      n.classList.toggle('is-active', active);
      n.setAttribute('aria-pressed', String(active));
    });
    if ($('#result-count')) $('#result-count').textContent = shown.length;
    if (!list) return;
    listURLs.forEach(url => URL.revokeObjectURL(url));
    listURLs = [];
    list.replaceChildren();
    const empty = $('#empty-state');
    const initialEmpty = records.length === 0 && filter === 'all' && !search && category === 'all';
    if (empty) empty.hidden = !initialEmpty;
    list.hidden = Boolean(empty && initialEmpty);
    if (!shown.length) {
      if (empty && initialEmpty) return;
      const box = el('div', 'no-results');
      box.append(el('h3', '', initialEmpty ? '첫 기프티콘을 등록해 보세요' : '조건에 맞는 기프티콘이 없어요'));
      if (initialEmpty) {
        const add = button('기프티콘 등록', 'button-primary', () => editor());
        box.append(add);
      } else {
        box.append(button('전체 보기', 'button-secondary', () => {
          if ($('#search')) $('#search').value = '';
          if ($('#category')) $('#category').value = 'all';
          setFilter('all');
        }));
      }
      list.append(box);
      return;
    }
    const sort = $('#sort')?.value;
    shown.sort((a, b) => {
      if (sort === 'newest') return b.createdAt - a.createdAt;
      if (sort === 'brand') return a.brand.localeCompare(b.brand, 'ko') || a.name.localeCompare(b.name, 'ko');
      const rank = item => item.used ? 2 : (daysLeft(item.expiry, today) < 0 ? 1 : 0);
      return rank(a) - rank(b) || a.expiry.localeCompare(b.expiry) || b.createdAt - a.createdAt;
    });
    shown.forEach(record => {
      const card = button('', 'coupon-card', () => details(record.id));
      const media = el('span', 'coupon-image');
      if (record.image) {
        const img = el('img');
        img.src = URL.createObjectURL(record.image);
        listURLs.push(img.src);
        img.alt = '';
        media.append(img);
      } else {
        media.textContent = (record.brand || record.name).slice(0, 1);
        media.setAttribute('aria-hidden', 'true');
      }
      const info = el('span', 'coupon-info');
      info.append(el('span', 'coupon-brand', record.brand), el('strong', 'coupon-name', record.name),
        el('span', 'coupon-date', formatDate(record.expiry) + '까지'));
      card.append(media, info, badge(record, today));
      list.append(card);
    });
  }

  function setFilter(next) {
    filter = next;
    render();
  }

  function button(text, cls, fn) {
    const node = el('button', cls, text);
    node.type = 'button';
    node.addEventListener('click', fn);
    return node;
  }

  function badge(record, today) {
    const status = statusOf(record, today);
    const days = daysLeft(record.expiry, today);
    const label = status === 'expiring' ? (days === 0 ? '오늘 만료' : 'D-' + days) : statuses[status];
    const node = el('span', 'coupon-badge', label);
    node.dataset.status = status;
    return node;
  }

  function clearImageURL() {
    if (imageURL) URL.revokeObjectURL(imageURL);
    imageURL = null;
  }

  function openDialog(title, page) {
    if (!dialog.open) previousFocus = document.activeElement;
    currentPage = page;
    clearImageURL();
    const shell = el('div', 'dialog-shell');
    const head = el('div', 'dialog-header');
    const h = el('h2', '', title);
    h.id = 'coupon-dialog-title';
    const close = button('×', 'icon-button', () => dialog.close());
    close.setAttribute('aria-label', '닫기');
    head.append(h, close);
    shell.append(head);
    dialog.replaceChildren(shell);
    return shell;
  }

  function showDialog() {
    if (!dialog.open) dialog.showModal();
    else dialog.querySelector('input:not([type=file]), button')?.focus();
  }

  function addPreview(parent, blob, cls) {
    clearImageURL();
    if (!blob) return;
    const img = el('img', cls);
    imageURL = URL.createObjectURL(blob);
    img.src = imageURL;
    img.alt = '등록한 기프티콘 원본';
    parent.append(img);
  }

  async function writeFromDialog(id, change, message, after) {
    const page = currentPage;
    if (page.busy) return;
    page.busy = true;
    const controls = [...dialog.querySelectorAll('button, input, select, textarea')];
    controls.forEach(n => { n.disabled = true; });
    try {
      await mutate(id, change);
      updates?.postMessage(id);
      await refresh();
      if (currentPage === page && dialog.open) after();
      announce(message);
    } catch (error) {
      const msg = errorMessage(error);
      if (currentPage === page && dialog.open) showError(msg);
      else announce(msg);
    } finally {
      page.busy = false;
      controls.forEach(n => { n.disabled = false; });
    }
  }

  function showError(message) {
    let error = dialog.querySelector('[role=alert]');
    if (!error) {
      error = el('p', 'form-error');
      error.setAttribute('role', 'alert');
      $('.dialog-body', dialog).append(error);
    }
    error.textContent = message;
  }

  function field(labelText, input) {
    const label = el('label', 'field');
    label.append(el('span', '', labelText), input);
    return label;
  }

  function textInput(name, value, placeholder, maxLength, required = false) {
    const input = el('input');
    input.type = 'text';
    input.name = name;
    input.value = value || '';
    input.placeholder = placeholder;
    input.maxLength = maxLength;
    input.required = required;
    return input;
  }

  function editor(record) {
    if (!db) { announce('기기 저장소를 준비하지 못했어요. 페이지를 새로고침해 주세요.'); return; }
    const id = record?.id || crypto.randomUUID();
    const shell = openDialog(record ? '기프티콘 수정' : '기프티콘 등록', { id });
    const form = el('form');
    const body = el('div', 'dialog-body');
    const grid = el('div', 'form-grid');
    const brand = textInput('brand', record?.brand, '예) 스타벅스', 80, true);
    const name = textInput('name', record?.name, '예) 카페 아메리카노 Tall', 120, true);
    const code = textInput('code', record?.code, '쿠폰 번호 입력', 150);
    const expiry = el('input');
    expiry.type = 'date';
    expiry.name = 'expiry';
    expiry.required = true;
    expiry.value = record?.expiry || '';
    const category = el('select');
    category.name = 'category';
    categories.forEach(value => { category.add(new Option(value, value)); });
    category.value = record?.category || '기타';
    grid.append(field('브랜드', brand), field('상품명', name), field('유효기간', expiry),
      field('카테고리', category), field('쿠폰 번호 (선택)', code));

    const upload = el('input');
    upload.type = 'file';
    upload.name = 'image';
    upload.accept = 'image/png,image/jpeg,image/webp,image/gif';
    const uploadField = field('기프티콘 이미지 (선택)', upload);
    uploadField.classList.add('image-upload');
    const preview = el('div', 'preview-wrap');
    let image = record?.image || null;
    let changedImage = false;
    const updateImage = () => {
      preview.replaceChildren();
      addPreview(preview, image, 'image-preview');
      if (image) preview.append(button('이미지 제거', 'button-secondary', () => {
        image = null;
        changedImage = true;
        upload.value = '';
        updateImage();
      }));
    };
    upload.addEventListener('change', () => {
      const file = upload.files[0];
      if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
        upload.value = '';
        showError('PNG, JPG, WebP, GIF 이미지를 선택해 주세요.');
        return;
      }
      const err = dialog.querySelector('[role=alert]');
      if (err) err.remove();
      changedImage = true;
      image = file;
      updateImage();
    });
    updateImage();
    body.append(grid, uploadField, preview);
    const actions = el('div', 'dialog-actions');
    const save = el('button', 'button-primary', record ? '수정 저장' : '등록하기');
    save.type = 'submit';
    actions.append(button('취소', 'button-secondary', () => record ? details(id) : dialog.close()), save);
    form.append(body, actions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      for (const input of [brand, name]) {
        input.value = input.value.trim();
        if (!input.reportValidity()) return;
      }
      const fields = { brand: brand.value, name: name.value, expiry: expiry.value,
        category: category.value, code: code.value.trim() };
      writeFromDialog(id, old => {
        const base = record ? existing(old) : { id, used: false, createdAt: Date.now() };
        return { ...base, ...fields, image: changedImage ? image : (base.image || null) };
      }, record ? '수정 내용을 저장했어요.' : '기프티콘을 등록했어요.', () => dialog.close());
    });
    shell.append(form);
    showDialog();
  }

  function details(id) {
    const record = records.find(item => item.id === id);
    if (!record) { dialog.close(); announce('삭제된 기프티콘이에요.'); return; }
    const shell = openDialog('기프티콘 상세', { id });
    const body = el('div', 'dialog-body');
    body.append(badge(record, localDay()), el('p', 'coupon-brand', record.brand), el('h3', 'detail-name', record.name));
    addPreview(body, record.image, 'detail-image');
    const fields = el('dl', 'detail-fields');
    const row = (title, text, cls) => { fields.append(el('dt', '', title), el('dd', cls || '', text)); };
    row('유효기간', formatDate(record.expiry) + '까지');
    row('카테고리', record.category);
    if (record.code) row('쿠폰 번호', record.code, 'coupon-code');
    body.append(fields);
    const actions = el('div', 'dialog-actions');
    actions.append(button('삭제', 'button-danger', () => confirmDelete(record)),
      button('수정', 'button-secondary', () => editor(record)),
      button(record.used ? '사용 취소' : '사용 완료', 'button-primary', () => {
        writeFromDialog(id, old => ({ ...existing(old), used: !record.used }),
          record.used ? '사용 처리를 취소했어요.' : '사용 완료로 표시했어요.', () => dialog.close());
      }));
    shell.append(body, actions);
    showDialog();
  }

  function confirmDelete(record) {
    const shell = openDialog('기프티콘을 삭제할까요?', { id: record.id });
    const body = el('div', 'dialog-body');
    body.append(el('p', '', '‘' + record.name + '’의 쿠폰 정보와 이미지가 이 기기에서 삭제돼요.'));
    const actions = el('div', 'dialog-actions');
    actions.append(button('취소', 'button-secondary', () => details(record.id)), button('삭제하기', 'button-danger',
      () => writeFromDialog(record.id, () => null, '기프티콘을 삭제했어요.', () => dialog.close())));
    shell.append(body, actions);
    showDialog();
  }

  async function start() {
    document.body.append(dialog, toast);
    dialog.addEventListener('cancel', e => { if (currentPage?.busy) e.preventDefault(); });
    dialog.addEventListener('close', () => {
      clearImageURL();
      if (previousFocus?.isConnected) previousFocus.focus();
      else $('#search')?.focus();
      currentPage = null;
    });
    document.addEventListener('click', event => {
      const action = event.target.closest('[data-action="add"], [data-filter]');
      if (!action) return;
      if (action.dataset.action === 'add') editor();
      else setFilter(action.dataset.filter);
    });
    $('#search')?.addEventListener('input', render);
    $('#category')?.addEventListener('change', render);
    $('#sort')?.addEventListener('change', render);
    try {
      db = await openDB();
      await refresh();
      const sync = () => refresh().catch(e => announce(errorMessage(e)));
      if (updates) updates.onmessage = sync;
      document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
      let lastDay = localDay();
      setInterval(() => {
        const day = localDay();
        if (day !== lastDay) { lastDay = day; render(); }
      }, 30000);
    } catch (error) {
      const list = $('#coupon-list');
      if ($('#empty-state')) $('#empty-state').hidden = true;
      if (list) {
        list.hidden = false;
        list.replaceChildren(el('p', 'no-results', errorMessage(error)));
      }
      announce(errorMessage(error));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
