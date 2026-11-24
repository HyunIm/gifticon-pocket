import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDay, daysLeft, statusOf, badgeLabel, sortCoupons, summarize, matchesQuery } from '../dist/js/coupon.js';

const today = Date.UTC(2026, 10, 24);
const coupon = (expiry, extra = {}) => ({ id: expiry, brand: 'B', name: 'N', expiry, createdAt: 0, ...extra });

test('local day ignores the time of day', () => {
  assert.equal(localDay(new Date(2026, 10, 24, 23, 59)), today);
  assert.equal(localDay(new Date(2026, 10, 24, 0, 1)), today);
});

test('days left and status', () => {
  assert.equal(daysLeft('2026-11-24', today), 0);
  assert.equal(daysLeft('2026-12-01', today), 7);
  assert.equal(statusOf(coupon('2026-11-23'), today), 'expired');
  assert.equal(statusOf(coupon('2026-11-24'), today), 'expiring');
  assert.equal(statusOf(coupon('2026-12-01'), today), 'expiring');
  assert.equal(statusOf(coupon('2026-12-02'), today), 'available');
  assert.equal(statusOf(coupon('2026-11-01', { used: true }), today), 'used');
  assert.equal(badgeLabel(coupon('2026-11-24'), today), '오늘 만료');
  assert.equal(badgeLabel(coupon('2026-11-27'), today), 'D-3');
  assert.equal(badgeLabel(coupon('2027-01-03'), today), 'D-40', 'usable coupons always show days left');
  assert.equal(badgeLabel(coupon('2026-11-20'), today), '기간 만료');
});

test('expiry sort puts usable coupons first, then expired, then used', () => {
  const list = [coupon('2026-11-01', { used: true }), coupon('2026-11-20'), coupon('2027-01-01'), coupon('2026-12-01')];
  assert.deepEqual(sortCoupons(list, 'expiry', today).map(c => c.expiry), ['2026-12-01', '2027-01-01', '2026-11-20', '2026-11-01']);
});

test('summary counts expiring coupons as available too', () => {
  const counts = summarize([coupon('2026-11-25'), coupon('2027-01-01'), coupon('2026-01-01'), coupon('2027-01-01', { used: true })], today);
  assert.deepEqual(counts, { all: 4, available: 2, expiring: 1, used: 1, expired: 1 });
});

test('search matches brand, name, category, memo and code ignoring spaces', () => {
  const record = { brand: '스타벅스', name: '아이스 아메리카노', category: '카페', memo: '생일 선물', code: '9184 2735 6610' };
  assert.ok(matchesQuery(record, '아이스아메'));
  assert.ok(matchesQuery(record, '생일'));
  assert.ok(matchesQuery(record, '27356'), 'coupon number without spaces');
  assert.ok(!matchesQuery(record, '투썸'));
  assert.ok(matchesQuery(record, ''));
});

test('initial consonant search', () => {
  const record = { brand: '스타벅스', name: '아이스 아메리카노', category: '카페' };
  assert.ok(matchesQuery(record, 'ㅅㅌㅂㅅ'));
  assert.ok(matchesQuery(record, '스ㅌ'));
  assert.ok(matchesQuery(record, 'ㅇㅁㄹㅋㄴ'));
  assert.ok(!matchesQuery(record, 'ㅌㅆ'));
});
