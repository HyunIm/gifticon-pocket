// Coupon rules shared by the list, the reminders and the tests. Pure functions, no DOM.
export const categories = ['카페', '외식', '편의점', '쇼핑', '기타'];
export const statuses = { available: '사용 가능', expiring: '만료 임박', expired: '기간 만료', used: '사용 완료' };
export const EXPIRING_DAYS = 7;

const dayMs = 86400000;

// Today's local calendar date as a UTC timestamp, so day arithmetic ignores DST and time zones.
export function localDay(now = new Date()) {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

export const daysLeft = (expiry, today = localDay()) => Math.round((Date.parse(expiry + 'T00:00:00Z') - today) / dayMs);

export function statusOf(record, today = localDay()) {
  if (record.used) return 'used';
  const days = daysLeft(record.expiry, today);
  if (days < 0) return 'expired';
  if (days <= EXPIRING_DAYS) return 'expiring';
  return 'available';
}

// "사용 가능" includes coupons that are about to expire.
export const matchesStatus = (filter, status) =>
  filter === 'all' || status === filter || (filter === 'available' && status === 'expiring');

export const isUsable = status => status === 'available' || status === 'expiring';

// Usable coupons show how many days are left; the rest show their state.
export function badgeLabel(record, today = localDay()) {
  const status = statusOf(record, today);
  if (!isUsable(status)) return statuses[status];
  const days = daysLeft(record.expiry, today);
  return days === 0 ? '오늘 만료' : 'D-' + days;
}

export const formatDate = value => value.replaceAll('-', '.');
export const formatWon = value => Number(value).toLocaleString('ko-KR') + '원';
export const normalize = value => value.toLocaleLowerCase('ko').replace(/\s/g, '');
export const codeDigits = code => (code || '').replace(/\D/g, '');

export function sortCoupons(list, sort, today = localDay()) {
  const rank = item => (item.used ? 2 : daysLeft(item.expiry, today) < 0 ? 1 : 0);
  return [...list].sort((a, b) => {
    if (sort === 'newest') return b.createdAt - a.createdAt;
    if (sort === 'brand') return a.brand.localeCompare(b.brand, 'ko') || a.name.localeCompare(b.name, 'ko');
    return rank(a) - rank(b) || a.expiry.localeCompare(b.expiry) || b.createdAt - a.createdAt;
  });
}

export function summarize(records, today = localDay()) {
  const counts = { all: records.length, available: 0, expiring: 0, used: 0, expired: 0 };
  for (const record of records) {
    const status = statusOf(record, today);
    counts[status]++;
    if (status === 'expiring') counts.available++;
  }
  return counts;
}

const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const initialOf = char => {
  const code = char.charCodeAt(0) - 0xac00;
  return code >= 0 && code < 11172 ? CHOSEONG[Math.floor(code / 588)] : char;
};

// Brand, name, category, memo and coupon number, ignoring spaces and case. A query may use
// initial consonants for any syllable: "ㅅㅌㅂㅅ" and "스ㅌ" both find "스타벅스".
export function matchesQuery(record, query) {
  const needle = [...normalize(query)];
  if (!needle.length) return true;
  const hay = [...normalize([record.brand, record.name, record.category, record.memo || '', codeDigits(record.code)].join(' '))];
  outer: for (let start = 0; start + needle.length <= hay.length; start++) {
    for (let i = 0; i < needle.length; i++) {
      const q = needle[i];
      const t = hay[start + i];
      if (q !== t && !(CHOSEONG.includes(q) && initialOf(t) === q)) continue outer;
    }
    return true;
  }
  return false;
}
