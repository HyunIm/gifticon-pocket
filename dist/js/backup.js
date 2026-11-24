// Backup file: one JSON document with the coupons and their original images (base64).
// Thumbnails are left out and rebuilt after import.
import { categories } from './coupon.js';

const FORMAT = 'gifticon-pocket-backup';
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function blobToDataURL(blob) {
  return `data:${blob.type || 'application/octet-stream'};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}

function dataURLToBlob(value) {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(value || '');
  if (!m || !IMAGE_TYPES.includes(m[1])) return null;
  return new Blob([base64ToBytes(m[2])], { type: m[1] });
}

export async function createBackup(records, now = new Date()) {
  const coupons = [];
  for (const record of records) {
    const { image, thumb, ...rest } = record;
    coupons.push({ ...rest, image: image ? await blobToDataURL(image) : null });
  }
  const json = JSON.stringify({ format: FORMAT, version: 1, exportedAt: now.toISOString(), coupons });
  return new Blob([json], { type: 'application/json' });
}

export function backupFileName(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  // ASCII only: some browsers replace a non-ASCII download name with "download".
  return `gifticon-pocket-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`;
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function toRecord(item) {
  if (!item || typeof item !== 'object') return null;
  const id = text(item.id, 100);
  const brand = text(item.brand, 80);
  const name = text(item.name, 120);
  const expiry = text(item.expiry, 10);
  if (!id || !brand || !name || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  const createdAt = Number.isFinite(item.createdAt) ? item.createdAt : Date.now();
  const balance = Number.isFinite(item.balance) && item.balance >= 0 ? Math.round(item.balance) : null;
  return {
    id, brand, name, expiry,
    category: categories.includes(item.category) ? item.category : '기타',
    code: text(item.code, 150),
    memo: text(item.memo, 200),
    balance,
    used: item.used === true,
    createdAt,
    updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : createdAt,
    image: dataURLToBlob(item.image),
    thumb: null,
  };
}

export class BackupError extends Error {}

export async function readBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new BackupError('백업 파일을 읽을 수 없어요. 기프티콘 포켓에서 저장한 .json 파일을 선택해 주세요.');
  }
  if (data?.format !== FORMAT || !Array.isArray(data.coupons)) {
    throw new BackupError('기프티콘 포켓 백업 파일이 아니에요.');
  }
  const records = data.coupons.map(toRecord).filter(Boolean);
  return { records, skipped: data.coupons.length - records.length };
}

// Keeps whichever copy of a coupon was changed last.
export function mergeBackup(current, incoming) {
  const byId = new Map(current.map(record => [record.id, record]));
  const changes = [];
  let added = 0;
  let updated = 0;
  for (const record of incoming) {
    const mine = byId.get(record.id);
    if (!mine) { added++; changes.push(record); continue; }
    if ((record.updatedAt || 0) > (mine.updatedAt || mine.createdAt || 0)) { updated++; changes.push(record); }
  }
  return { changes, added, updated, unchanged: incoming.length - added - updated };
}
