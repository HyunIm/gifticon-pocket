import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseGifticon, findDates, cleanLine } from '../dist/js/parse.js';
import { findBrand, guessCategory, makeBrand } from '../dist/js/brands.js';

// Lines Tesseract (kor+eng, PSM 4) produced for rendered gifticons of common layouts,
// including its real misreadings ("[6525]" for "[GS25]", "(106)" for "(ICE)", "6카드" for "e카드").
const fixtures = JSON.parse(await readFile(new URL('./fixtures/ocr-lines.json', import.meta.url)));
const compact = value => value.replace(/\s/g, '');

for (const { sample, truth, lines } of fixtures) {
  test(`reads ${sample}`, () => {
    const got = parseGifticon(lines);
    assert.equal(got.brand, truth.brand);
    assert.equal(got.expiry, truth.expiry);
    assert.equal(got.code.replace(/\D/g, ''), truth.code);
    assert.equal(got.category, truth.category);
    assert.equal(got.balance ?? null, truth.balance ?? null);
    // OCR may drop a character in long names (e.g. "240ml" -> "24007"); the rest must match.
    const expected = compact(truth.name);
    const actual = compact(got.name);
    const shared = [...expected].filter((c, i) => actual[i] === c).length;
    assert.ok(shared / expected.length >= 0.75, `name ${got.name} vs ${truth.name}`);
  });
}

test('date formats', () => {
  assert.deepEqual(findDates('유효기간 2027년 1월 5일').map(d => d.value), ['2027-01-05']);
  assert.deepEqual(findDates('~ 2026. 12. 15').map(d => d.value), ['2026-12-15']);
  assert.deepEqual(findDates('2026-02-30').map(d => d.value), [], 'impossible dates are ignored');
  assert.deepEqual(findDates('26.12.31').map(d => d.value), [], 'two-digit years need an expiry label');
  assert.deepEqual(findDates('26.12.31', { allowShortYear: true }).map(d => d.value), ['2026-12-31']);
});

test('expiry prefers the labelled date over order and send dates', () => {
  const got = parseGifticon(['주문일 2027.03.01', '스타벅스', '아메리카노', '유효기간 2026.12.31', '발송일 2027.01.01']);
  assert.equal(got.expiry, '2026-12-31');
});

test('expiry label printed above the date', () => {
  assert.equal(parseGifticon(['유효기간', '2027.04.30']).expiry, '2027-04-30');
});

test('coupon number skips order numbers, phone numbers and amounts', () => {
  const got = parseGifticon(['주문번호 9988776655443322', '고객센터 1588-1234', '상품금액 30,000원', '쿠폰번호 1234-5678-9012']);
  assert.equal(got.code, '1234 5678 9012');
});

test('OCR digit confusions are fixed', () => {
  assert.equal(cleanLine('2O27.l2.3l'), '2027.12.31');
  assert.equal(parseGifticon(['유효기간 2O27.O1.15']).expiry, '2027-01-15');
});

test('brand matching', () => {
  assert.equal(findBrand('교환처 메가46(커피')?.name, '메가MGC커피');
  assert.equal(findBrand('CUSTOMER SERVICE'), null);
  assert.equal(findBrand('1047 6525 3361'), null, 'misreadings are only accepted in short labels');
  assert.equal(findBrand('6525', { loose: true })?.name, 'GS25');
  assert.equal(findBrand('이마트24 상품권')?.name, '이마트24');
  assert.equal(guessCategory('', '치즈 피자 L'), '외식');
});

test('brands from the wallet are recognised without a 교환처 label', () => {
  const lines = ['파리크라상', '딸기 생크림 케이크', '1234 5678 9012', '유효기간 2027.03.01'];
  assert.equal(parseGifticon(lines).brand, '', 'unknown to the built-in list');
  const got = parseGifticon(lines, { extraBrands: [makeBrand('파리크라상', '카페')] });
  assert.equal(got.brand, '파리크라상');
  assert.equal(got.name, '딸기 생크림 케이크');
  assert.equal(got.category, '카페');
});

test('nothing recognisable gives empty fields', () => {
  assert.deepEqual(parseGifticon(['', '!!!']), { brand: '', name: '', expiry: '', code: '', balance: null, category: '기타' });
});
