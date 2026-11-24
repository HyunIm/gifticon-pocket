import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseGifticon, findDates, cleanLine } from '../dist/js/parse.js';
import { findBrand, guessCategory, makeBrand } from '../dist/js/brands.js';

// Lines Tesseract (kor+eng, PSM 4) produced for rendered gifticons of common layouts,
// including its real misreadings ("[6525]" for "[GS25]", "(106)" for "(ICE)", "6카드" for "e카드").
const fixtures = JSON.parse(await readFile(new URL('./fixtures/ocr-lines.json', import.meta.url)));
const compact = value => value.replace(/\s/g, '');
function similarity(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length, 1);
}

for (const { sample, truth, lines } of fixtures) {
  test(`reads ${sample}`, () => {
    const got = parseGifticon(lines);
    assert.equal(got.brand, truth.brand);
    assert.equal(got.expiry, truth.expiry);
    assert.equal(got.code.replace(/\D/g, ''), truth.code);
    assert.equal(got.category, truth.category);
    assert.equal(got.balance ?? null, truth.balance ?? null);
    // OCR may misread a character in long names ("T" -> "ㅠ"); allow a small edit distance.
    assert.ok(similarity(compact(got.name), compact(truth.name)) >= 0.8, `name ${got.name} vs ${truth.name}`);
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
  assert.equal(findBrand('홈마트 할인'), null, 'a short Hangul part of a mixed name (ABC마트) does not match alone');
  assert.equal(findBrand('교환처 GS 더프레시')?.name, 'GS더프레시', 'longer names win over GS25');
});

test('brands from the wallet are recognised without a 교환처 label', () => {
  const lines = ['동네빵집 우리밀', '딸기 생크림 케이크', '1234 5678 9012', '유효기간 2027.03.01'];
  assert.equal(parseGifticon(lines).brand, '', 'unknown to the built-in list');
  const got = parseGifticon(lines, { extraBrands: [makeBrand('동네빵집 우리밀', '카페')] });
  assert.equal(got.brand, '동네빵집 우리밀');
  assert.equal(got.name, '딸기 생크림 케이크');
  assert.equal(got.category, '카페');
});

test('a product name wrapped onto two lines is joined', () => {
  const lines = [
    { text: '스타벅스', h: 37 }, { text: '아이스 카페 아메리카노 T 2잔 + 부드', h: 56 }, { text: '러운 생크림 카스텔라', h: 56 },
    { text: '9184 0022 3344', h: 38 }, { text: '유효기간 2027.02.14', h: 38 },
  ];
  assert.equal(parseGifticon(lines).name, '아이스 카페 아메리카노 T 2잔 + 부드러운 생크림 카스텔라');
  const atSpace = [{ text: '떠먹는 스트로베리', h: 50 }, { text: '초콜릿 생크림', h: 50 }, { text: '유효기간 2027.02.14', h: 30 }];
  assert.equal(parseGifticon(atSpace).name, '떠먹는 스트로베리 초콜릿 생크림');
});

test('nothing recognisable gives empty fields', () => {
  assert.deepEqual(parseGifticon(['', '!!!']), { brand: '', name: '', expiry: '', code: '', balance: null, category: '기타' });
});
