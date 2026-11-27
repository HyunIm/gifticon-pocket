import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar } from '../dist/js/calendar.js';

const now = new Date(2026, 10, 27, 12);
const coupon = (id, expiry, extra = {}) => ({ id, brand: '스타벅스', name: '아메리카노', expiry, category: '카페', code: '', ...extra });

test('one all-day event per usable coupon with two 9:00 alarms', () => {
  const { text, count } = buildCalendar([
    coupon('a', '2026-12-10', { code: '1234 5678', balance: 30000 }),
    coupon('used', '2026-12-31', { used: true }),
    coupon('old', '2026-11-01'),
  ], now);
  assert.equal(count, 1, 'used and expired coupons are left out');
  assert.match(text, /^BEGIN:VCALENDAR\r\n/);
  assert.ok(text.endsWith('END:VCALENDAR\r\n'));
  assert.match(text, /UID:a@gifticon-pocket/);
  assert.match(text, /DTSTART;VALUE=DATE:20261210\r\nDTEND;VALUE=DATE:20261211/);
  assert.match(text, /SUMMARY:기프티콘 만료: 스타벅스 아메리카노/);
  assert.match(text, /DESCRIPTION:쿠폰 번호: 1234 5678\\n잔액: 30\\,000원/);
  assert.match(text, /TRIGGER:-P2DT15H/);
  assert.match(text, /TRIGGER:PT9H/);
});

test('long lines are folded at 75 bytes and special characters escaped', () => {
  const { text } = buildCalendar([coupon('b', '2027-01-31', { name: '아이스 카페 아메리카노 T 2잔 + 부드러운 생크림 카스텔라, 세트; 한정' })], now);
  for (const line of text.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  const unfolded = text.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('카스텔라\\, 세트\\; 한정'), 'commas and semicolons are escaped');
});

test('month ends roll over', () => {
  const { text } = buildCalendar([coupon('c', '2026-12-31')], now);
  assert.match(text, /DTEND;VALUE=DATE:20270101/);
});
