import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReminders } from '../dist/js/reminders.js';

const at = (y, m, d, h = 9) => new Date(y, m - 1, d, h).getTime();
const coupon = (id, expiry, extra = {}) => ({ id, brand: '스타벅스', name: '아메리카노 ' + id, expiry, ...extra });

test('three days before and on the expiry day, at 9:00 local time', () => {
  const now = at(2026, 11, 24, 12);
  const reminders = buildReminders([coupon('a', '2026-12-10')], now);
  assert.deepEqual(reminders.map(r => r.at), [at(2026, 12, 7), at(2026, 12, 10)]);
  assert.equal(reminders[0].title, '3일 후 만료되는 기프티콘 1개');
  assert.equal(reminders[1].title, '오늘 만료되는 기프티콘 1개');
  assert.equal(reminders[1].body, '스타벅스 아메리카노 a');
  assert.equal(reminders[1].url, '/?coupon=a', 'a single coupon opens directly');
});

test('reminders in the past and used coupons are skipped', () => {
  const now = at(2026, 11, 24, 10);
  const reminders = buildReminders([
    coupon('soon', '2026-11-26'), // D-3 was yesterday; D-day still ahead
    coupon('today', '2026-11-24'), // 9:00 today already passed
    coupon('used', '2026-12-31', { used: true }),
  ], now);
  assert.deepEqual(reminders.map(r => r.at), [at(2026, 11, 26)]);
});

test('a name that already starts with the brand is not doubled', () => {
  const [reminder] = buildReminders([coupon('x', '2026-12-10', { name: '스타벅스 e카드 5만원' })], at(2026, 12, 9));
  assert.equal(reminder.body, '스타벅스 e카드 5만원');
});

test('coupons reminded at the same time share one notification', () => {
  const now = at(2026, 11, 1);
  const reminders = buildReminders([
    coupon('a', '2026-12-10'), coupon('b', '2026-12-10'), coupon('c', '2026-12-10'), coupon('d', '2026-12-13'),
  ], now);
  const dec10 = reminders.find(r => r.at === at(2026, 12, 10));
  assert.equal(dec10.title, '곧 만료되는 기프티콘이 있어요', 'D-day of a, b, c and D-3 of d');
  assert.equal(dec10.body, '오늘: 스타벅스 아메리카노 a\n오늘: 스타벅스 아메리카노 b\n외 2개');
  const dec7 = reminders.find(r => r.at === at(2026, 12, 7));
  assert.equal(dec7.title, '3일 후 만료되는 기프티콘 3개');
  assert.equal(dec7.url, '/?filter=expiring', 'several coupons open the expiring list');
  assert.equal(new Set(reminders.map(r => r.tag)).size, reminders.length);
});
