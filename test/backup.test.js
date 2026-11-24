import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, readBackup, mergeBackup, BackupError } from '../dist/js/backup.js';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...Array.from({ length: 70000 }, (_, i) => i % 251)]);
const record = {
  id: 'a', brand: '스타벅스', name: '아메리카노', expiry: '2027-01-01', category: '카페', code: '1234',
  memo: '', balance: null, used: false, createdAt: 1, updatedAt: 5,
  image: new Blob([png], { type: 'image/png' }), thumb: new Blob(['x'], { type: 'image/jpeg' }),
};

test('backup round trip keeps fields and the original image, drops thumbnails', async () => {
  const file = await createBackup([record]);
  const { records, skipped } = await readBackup(file);
  assert.equal(skipped, 0);
  const [restored] = records;
  assert.equal(restored.name, '아메리카노');
  assert.equal(restored.thumb, null);
  assert.equal(restored.image.type, 'image/png');
  assert.deepEqual(new Uint8Array(await restored.image.arrayBuffer()), png);
});

test('invalid entries are skipped and other files rejected', async () => {
  const file = new Blob([JSON.stringify({ format: 'gifticon-pocket-backup', version: 1, coupons: [
    { id: 'x', brand: 'B', name: 'N', expiry: 'soon' },
    { id: 'y', brand: 'B', name: 'N', expiry: '2027-01-01', category: '없는분류', image: 'data:image/svg+xml;base64,PHN2Zz4=' },
  ] })]);
  const { records, skipped } = await readBackup(file);
  assert.equal(skipped, 1);
  assert.equal(records[0].category, '기타');
  assert.equal(records[0].image, null, 'only raster image types are accepted');
  await assert.rejects(readBackup(new Blob(['{"hello":1}'])), BackupError);
  await assert.rejects(readBackup(new Blob(['not json'])), BackupError);
});

test('merge keeps the copy changed last', () => {
  const current = [{ id: 'a', updatedAt: 10 }, { id: 'b', updatedAt: 10 }];
  const incoming = [{ id: 'a', updatedAt: 20 }, { id: 'b', updatedAt: 5 }, { id: 'c', updatedAt: 1 }];
  const result = mergeBackup(current, incoming);
  assert.deepEqual(result.changes.map(r => r.id), ['a', 'c']);
  assert.deepEqual([result.added, result.updated, result.unchanged], [1, 1, 1]);
});
