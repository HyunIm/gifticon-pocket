// IndexedDB storage for coupons. Every write goes through one transaction and tells other tabs.
const DB_NAME = 'gifticon-pocket';
const STORE = 'coupons';
let db;
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('gifticon-pocket-updated') : null;

export class MissingRecordError extends Error {
  constructor() {
    super('다른 창에서 삭제한 기프티콘이에요. 목록을 다시 확인해 주세요.');
    this.name = 'MissingRecordError';
  }
}

export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => {
      db = request.result;
      // A newer version of the app wants to upgrade the database: let it, then reload into that version.
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('다른 창에서 이전 버전의 앱이 열려 있어요. 다른 창을 닫고 새로고침해 주세요.'));
  });
}

export function getAll() {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Safari keeps a Blob read from IndexedDB tied to a file inside the database. Writing that Blob
// back (an edit, 사용 완료, 실행 취소) can leave the record pointing at a file Safari has already
// replaced or deleted, and the image is gone. So every write stores images as in-memory copies.
const blobKeys = record => Object.keys(record || {}).filter(key => record[key] instanceof Blob);
export async function detach(record) {
  if (!record) return record;
  const copy = { ...record };
  await Promise.all(blobKeys(record).map(async key => {
    copy[key] = new Blob([await record[key].arrayBuffer()], { type: record[key].type });
  }));
  return copy;
}

function getOne(id) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// The stored image, unchanged by the edit: the same Blob, or an older copy of it.
const sameImage = (value, stored) => value === stored ||
  (value instanceof Blob && stored instanceof Blob && value.size === stored.size && value.type === stored.type);

// change(current) returns the record to store, or null to delete it. Throwing aborts the write.
export async function mutate(id, change) {
  // Copy the stored images first: a transaction cannot wait for them to be read.
  const before = await getOne(id);
  const copies = {};
  for (const key of blobKeys(before)) {
    try { copies[key] = new Blob([await before[key].arrayBuffer()], { type: before[key].type }); } catch { /* unreadable: keep as is */ }
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const get = store.get(id);
    let reason;
    let result;
    get.onsuccess = () => {
      try {
        result = change(get.result);
        if (result) {
          for (const key of Object.keys(copies)) {
            if (sameImage(result[key], get.result?.[key])) result = { ...result, [key]: copies[key] };
          }
        }
        if (result) store.put(result);
        else store.delete(id);
      } catch (error) {
        reason = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => { channel?.postMessage(id); resolve(result); };
    tx.onabort = () => reject(reason || tx.error);
  });
}

export async function putMany(input) {
  const records = await Promise.all(input.map(detach));
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    records.forEach(record => store.put(record));
    tx.oncomplete = () => { channel?.postMessage('*'); resolve(); };
    tx.onabort = () => reject(tx.error);
  });
}

export function deleteMany(ids) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    ids.forEach(id => store.delete(id));
    tx.oncomplete = () => { channel?.postMessage('*'); resolve(); };
    tx.onabort = () => reject(tx.error);
  });
}

export function onExternalChange(listener) {
  if (channel) channel.onmessage = listener;
}

export function existing(record) {
  if (!record) throw new MissingRecordError();
  return record;
}

export function errorMessage(error) {
  if (error?.name === 'QuotaExceededError') return '기기 저장 공간이 부족해요. 사용한 기프티콘을 정리하거나 더 작은 이미지를 선택해 주세요.';
  if (error?.name === 'MissingRecordError') return error.message;
  if (error?.message?.startsWith('다른 창')) return error.message;
  return '기기 저장소에 접근할 수 없어요. 브라우저 저장소 설정을 확인해 주세요.';
}
