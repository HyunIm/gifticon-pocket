// Turns OCR lines from a gifticon image into coupon fields. Pure functions, no DOM.
import { findBrand, guessCategory } from './brands.js';

const EXPIRY_WORDS = /유효\s*기[간한]|사용\s*기[간한]|교환\s*기[간한]|만료|기한|까지|VALID|EXP/i;
const OTHER_DATE_WORDS = /주문|발송|구매|결제|발행|선물\s*일|수신|등록|승인|보낸|받은/;
const CODE_WORDS = /쿠폰\s*번호|바코드|인증\s*번호|교환\s*번호|핀\s*번호|PIN|상품권\s*번호|카드\s*번호/i;
const NOT_CODE_WORDS = /주문|문의|고객\s*센터|전화|사업자|승인|결제|대표|TEL|☎/i;
const BRAND_LABEL = /^(교환처|사용처|사용\s*매장|사용\s*가능\s*(매장|처)|사용\s*브랜드|브랜드|매장)\s*[:：]?\s*/;
// "상품" alone only counts with a colon, or it would take "상품금액 5,000원" for a name.
const NAME_LABEL = /^(?:(?:상품\s*명|품명|메뉴\s*명|교환\s*상품)\s*[:：]?|상품\s*[:：])\s*/;
const LABELS = /교환처|사용처|유효\s*기|사용\s*기|교환\s*기|주문|쿠폰\s*번호|발송|구매|결제|상품\s*금액|금액|잔액|만료|기한|바코드|매장|문의|고객|번호/;
const BOILERPLATE = /선물\s*하기|선물함|카카오톡|KAKAO|GIFTISHOW|기프티쇼|기프티콘|GIFTICON|본\s*(쿠폰|상품)|현금|교환할|사용\s*가능합니다|유의\s*사항|이용\s*안내|위시|수량|^\d{1,2}[:;]\d{2}/i;

// OCR reads 0/1 as O/l/I/| next to digits; fix those before matching numbers.
const fixDigits = text => text
  .replace(/(?<=\d)[Oo](?=[\d.\-/ ]|$)|(?<=[\d.\-/] ?)[Oo](?=\d)/g, '0')
  .replace(/(?<=\d)[lI|](?=[\d.\-/ ]|$)|(?<=[\d.\-/] ?)[lI|](?=\d)/g, '1');

export function cleanLine(text) {
  return fixDigits(text.normalize('NFKC'))
    // A lone jamo is a misread Latin letter ("T" -> "ㅣ", "L" -> "ㄴ"); real words never contain one.
    .replace(/[\u1100-\u11FF\u3131-\u318E]/g, ' ')
    // Table columns come back with separators the image never had: "유효기간 _ 2027년", "교환처 、 스타벅스".
    .replace(/\s+[_、,~\-—|]+\s+(?=\S)/g, (m) => (m.includes('~') ? ' ~ ' : ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function validDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const pad = n => String(n).padStart(2, '0');

export function findDates(text, { allowShortYear = false } = {}) {
  const found = [];
  const full = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})(?!\d)/g;
  for (const m of text.matchAll(full)) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (validDate(y, mo, d)) found.push({ value: `${y}-${pad(mo)}-${pad(d)}`, index: m.index });
  }
  if (!found.length && allowShortYear) {
    for (const m of text.matchAll(/(?<!\d)(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?!\d)/g)) {
      const [y, mo, d] = [2000 + +m[1], +m[2], +m[3]];
      if (validDate(y, mo, d)) found.push({ value: `${y}-${pad(mo)}-${pad(d)}`, index: m.index });
    }
  }
  return found;
}

function pickExpiry(lines) {
  let best = null;
  lines.forEach((line, i) => {
    const previous = lines[i - 1]?.text || '';
    const keyword = EXPIRY_WORDS.test(line.text) || (EXPIRY_WORDS.test(previous) && !/\d/.test(previous));
    const dates = findDates(line.text, { allowShortYear: keyword });
    if (!dates.length) return;
    // A range "2026.01.01 ~ 2026.12.31" ends on the expiry date.
    const latest = dates.reduce((a, b) => (b.value > a.value ? b : a));
    let score = 0;
    if (keyword) score += 4;
    if (/~|까지/.test(line.text)) score += 2;
    if (OTHER_DATE_WORDS.test(line.text)) score -= 6;
    if (!best || score > best.score || (score === best.score && latest.value > best.value)) {
      best = { value: latest.value, score };
    }
  });
  return best && best.score > -6 ? best.value : '';
}

function pickCode(lines) {
  let best = null;
  for (const line of lines) {
    if (NOT_CODE_WORDS.test(line.text) && !CODE_WORDS.test(line.text)) continue;
    // Remove dates, phone numbers and amounts so their digits are not taken for a coupon number.
    const text = line.text
      .replace(/(20\d{2})\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?/g, ' ')
      // Phone numbers (02-123-4567, 1588-1234) only when they stand alone, not inside a longer number.
      .replace(/(?<![\d-])(?:0\d{1,2}-\d{3,4}-\d{4}|1\d{3}-\d{4})(?![\d-])/g, ' ')
      .replace(/\d{1,3}(,\d{3})+\s*원?/g, ' ');
    for (const m of text.matchAll(/[0-9][0-9 \-]{6,}[0-9]/g)) {
      const digits = m[0].replace(/\D/g, '');
      if (digits.length < 8 || digits.length > 24) continue;
      let score = 0;
      if (CODE_WORDS.test(line.text)) score += 4;
      // A line holding only the number is the caption printed under the barcode.
      if (line.text.replace(/[\s\-]/g, '') === digits) score += 3;
      if (/^\d{4}([ \-]\d{2,4})+$/.test(m[0].trim())) score += 2;
      if (digits.length >= 12 && digits.length <= 16) score += 1;
      if (!best || score > best.score || (score === best.score && digits.length > best.value.length)) {
        best = { value: digits, score };
      }
    }
  }
  if (!best) return '';
  // Show the number the way it is printed on most coupons: groups of four.
  return best.value.replace(/(\d{4})(?=\d)/g, '$1 ');
}

function labelledValue(lines, label) {
  for (const [i, line] of lines.entries()) {
    const m = line.text.match(label);
    if (!m) continue;
    const value = line.text.slice(m[0].length).replace(/^[:：\s]+/, '').trim();
    if (value) return value;
    // "교환처" alone on a line: the value is printed underneath.
    const next = lines[i + 1]?.text;
    if (next && !LABELS.test(next)) return next;
  }
  return '';
}

function pickBrand(lines, extra) {
  const labelled = labelledValue(lines, BRAND_LABEL);
  if (labelled) {
    const known = findBrand(labelled, { loose: true, extra });
    if (known) return known.name;
  }
  for (const line of lines) {
    const prefix = line.text.match(/^\[([^\]]{1,20})\]/);
    const known = prefix && findBrand(prefix[1], { loose: true, extra });
    if (known) return known.name;
  }
  // Brand names show up on their own line or inside the product name; count every mention.
  const votes = new Map();
  for (const line of lines) {
    const known = findBrand(line.text, { loose: line.text.length <= 4, extra });
    if (known) votes.set(known.name, (votes.get(known.name) || 0) + 1);
  }
  const top = [...votes].sort((a, b) => b[1] - a[1])[0];
  if (top) return top[0];
  if (labelled && /[가-힣A-Za-z]/.test(labelled) && labelled.length <= 20) return labelled;
  return '';
}

// Cafe menus start with (ICE)/(HOT), which OCR reads as "(106)" or "(H0T)".
const fixMenuTags = name => name
  .replace(/^\([I1l|][CcG6(0O][E36]\)/, '(ICE)')
  .replace(/^\(H[O0]T\)/i, '(HOT)')
  // "e카드" (gift card) loses its e to a 6.
  .replace(/(^|\s)6\s?카드/, '$1e카드');

function stripBrandPrefix(name, brand, extra) {
  name = fixMenuTags(name);
  const m = name.match(/^\[([^\]]{1,20})\]\s*/);
  if (m && (!brand || findBrand(m[1], { loose: true, extra })?.name === brand || !/[가-힣]{2}/.test(m[1]))) {
    return name.slice(m[0].length);
  }
  return name;
}

function pickName(lines, brand, extra) {
  const labelled = labelledValue(lines, NAME_LABEL);
  if (labelled) return stripBrandPrefix(labelled, brand, extra);
  const heights = lines.map(l => l.h).filter(Boolean).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 1;
  let best = null;
  for (const line of lines) {
    const text = line.text;
    if (LABELS.test(text) || BOILERPLATE.test(text)) continue;
    if (findDates(text).length || /\d[\d \-]{7,}\d/.test(text)) continue;
    if (!/[가-힣]{2}|[A-Za-z]{3}/.test(text) || text.length < 2) continue;
    if (line.conf != null && line.conf < 45) continue;
    // A line that only names the brand is the brand caption, not the product.
    const known = findBrand(text, { loose: text.length <= 4, extra });
    if (known && text.replace(/[\s\[\]()]/g, '').length <= known.name.length + 2) continue;
    if (/^[A-Z\s]+$/.test(text) && known) continue;
    const score = (line.h || median) / median + (line.conf ?? 80) / 400 + (/[가-힣]/.test(text) ? 0.2 : 0);
    if (!best || score > best.score) best = { text, score };
  }
  return best ? stripBrandPrefix(best.text, brand, extra) : '';
}

function pickBalance(lines, name) {
  const all = lines.map(l => l.text).join('\n');
  // Only money vouchers have a balance; a product coupon may still print its price.
  if (!/금액권|상품권|기프트\s*카드|[E6]\s*카드|잔액|충전|\d\s*[만천]?\s*원\s*(권|교환권)/i.test(all + '\n' + name)) return null;
  const amounts = [];
  for (const line of [name, ...lines.map(l => l.text)]) {
    for (const m of line.matchAll(/(\d{1,3}(?:,\d{3})+|\d{3,7})\s*원/g)) amounts.push(+m[1].replace(/,/g, ''));
    for (const m of line.matchAll(/(\d+)\s*(만|천)\s*원/g)) amounts.push(+m[1] * (m[2] === '만' ? 10000 : 1000));
  }
  const valid = amounts.filter(n => n >= 1000 && n <= 10000000);
  return valid.length ? Math.max(...valid) : null;
}

// lines: [{ text, h?, y?, conf? }] or strings, top to bottom.
// extraBrands: brands outside the built-in list (made with makeBrand), e.g. the user's own.
export function parseGifticon(input, { extraBrands = [] } = {}) {
  const lines = input
    .map(line => (typeof line === 'string' ? { text: line } : line))
    .map(line => ({ ...line, text: cleanLine(line.text || '') }))
    .filter(line => line.text);
  const brand = pickBrand(lines, extraBrands);
  const name = pickName(lines, brand, extraBrands);
  return {
    brand,
    name,
    expiry: pickExpiry(lines),
    code: pickCode(lines),
    balance: pickBalance(lines, name),
    category: guessCategory(brand, name, extraBrands),
  };
}
