// Brands commonly sold as Korean mobile gift coupons, with the category used for new coupons.
// Each entry: [display name, category, ...aliases]. Aliases are matched without spaces or case.
const table = [
  // 카페 · 디저트
  ['스타벅스', '카페', 'STARBUCKS'],
  ['투썸플레이스', '카페', '투썸', 'TWOSOME'],
  ['이디야커피', '카페', '이디야', 'EDIYA'],
  ['메가MGC커피', '카페', '메가커피', '메가엠지씨커피', 'MEGAMGCCOFFEE', 'MEGACOFFEE'],
  ['컴포즈커피', '카페', 'COMPOSECOFFEE'],
  ['빽다방', '카페'],
  ['할리스', '카페', '할리스커피', 'HOLLYS'],
  ['폴바셋', '카페', 'PAULBASSETT'],
  ['파스쿠찌', '카페', 'PASCUCCI'],
  ['커피빈', '카페', 'COFFEEBEAN'],
  ['엔제리너스', '카페', 'ANGELINUS'],
  ['탐앤탐스', '카페', 'TOMNTOMS'],
  ['커피베이', '카페'],
  ['더벤티', '카페', 'THEVENTI'],
  ['매머드커피', '카페', '매머드익스프레스', 'MAMMOTH'],
  ['공차', '카페', 'GONGCHA'],
  ['블루보틀', '카페', 'BLUEBOTTLE'],
  ['요거프레소', '카페'],
  ['셀렉토커피', '카페'],
  ['감성커피', '카페'],
  ['하삼동커피', '카페'],
  ['텐퍼센트커피', '카페'],
  ['바나프레소', '카페'],
  ['드롭탑', '카페'],
  ['달콤커피', '카페'],
  ['카페베네', '카페'],
  ['쥬씨', '카페', 'JUICY'],
  ['스무디킹', '카페', 'SMOOTHIEKING'],
  ['배스킨라빈스', '카페', '베스킨라빈스', 'BASKINROBBINS', '배라'],
  ['던킨', '카페', '던킨도너츠', 'DUNKIN'],
  ['크리스피크림', '카페', '크리스피크림도넛', 'KRISPYKREME'],
  ['파리바게뜨', '카페', '파리바게트', 'PARISBAGUETTE'],
  ['뚜레쥬르', '카페', 'TOUSLESJOURS'],
  ['설빙', '카페'],
  ['노티드', '카페', 'KNOTTED'],
  ['아티제', '카페', 'ARTISEE'],
  ['나뚜루', '카페'],
  ['하겐다즈', '카페', 'HAAGENDAZS'],
  ['디저트39', '카페'],
  ['와플대학', '카페'],
  ['파리크라상', '카페'],
  ['커피에반하다', '카페'],
  ['카페봄봄', '카페'],
  ['더리터', '카페'],
  ['그라찌에', '카페'],
  ['커피명가', '카페'],
  ['디초콜릿커피', '카페'],
  ['요아정', '카페', '요거트아이스크림의정석'],
  ['아마스빈', '카페'],
  ['팔공티', '카페'],
  // 외식
  ['BBQ', '외식', '비비큐', 'BBQ치킨'],
  ['BHC', '외식', '비에이치씨', 'BHC치킨'],
  ['교촌치킨', '외식', '교촌'],
  ['굽네치킨', '외식', '굽네'],
  ['네네치킨', '외식'],
  ['처갓집양념치킨', '외식', '처갓집'],
  ['페리카나', '외식'],
  ['호식이두마리치킨', '외식', '호식이'],
  ['푸라닭', '외식'],
  ['노랑통닭', '외식'],
  ['자담치킨', '외식'],
  ['60계치킨', '외식', '60계'],
  ['지코바', '외식'],
  ['멕시카나', '외식'],
  ['또래오래', '외식'],
  ['맥도날드', '외식', 'MCDONALDS', 'MCDONALD'],
  ['버거킹', '외식', 'BURGERKING'],
  ['롯데리아', '외식', 'LOTTERIA'],
  ['KFC', '외식', '케이에프씨'],
  ['맘스터치', '외식', 'MOMSTOUCH'],
  ['노브랜드버거', '외식'],
  ['프랭크버거', '외식'],
  ['쉐이크쉑', '외식', 'SHAKESHACK'],
  ['서브웨이', '외식', '써브웨이', 'SUBWAY'],
  ['도미노피자', '외식', '도미노', 'DOMINOS'],
  ['피자헛', '외식', 'PIZZAHUT'],
  ['파파존스', '외식', 'PAPAJOHNS'],
  ['미스터피자', '외식'],
  ['피자알볼로', '외식'],
  ['반올림피자', '외식'],
  ['피자나라치킨공주', '외식'],
  ['아웃백', '외식', '아웃백스테이크하우스', 'OUTBACK'],
  ['빕스', '외식', 'VIPS'],
  ['애슐리', '외식', 'ASHLEY'],
  ['본죽', '외식', '본죽&비빔밥'],
  ['한솥', '외식', '한솥도시락'],
  ['신전떡볶이', '외식'],
  ['엽기떡볶이', '외식', '동대문엽기떡볶이', '엽떡'],
  ['배떡', '외식'],
  ['청년다방', '외식'],
  ['국대떡볶이', '외식'],
  ['명랑핫도그', '외식'],
  ['이삭토스트', '외식', 'ISAACTOAST'],
  ['에그드랍', '외식', 'EGGDROP'],
  ['쿠우쿠우', '외식'],
  ['매드포갈릭', '외식', 'MADFORGARLIC'],
  ['샐러디', '외식', 'SALADY'],
  ['바른치킨', '외식'],
  ['깐부치킨', '외식'],
  ['땅땅치킨', '외식'],
  ['치킨플러스', '외식'],
  ['바르다김선생', '외식'],
  ['고봉민김밥', '외식'],
  ['김가네', '외식'],
  ['죠스떡볶이', '외식'],
  ['본도시락', '외식'],
  ['피자마루', '외식'],
  ['파파이스', '외식', 'POPEYES'],
  // 편의점
  ['GS25', '편의점', '지에스25'],
  ['CU', '편의점', '씨유'],
  ['세븐일레븐', '편의점', '7-ELEVEN', '7ELEVEN'],
  ['이마트24', '편의점', 'EMART24'],
  ['미니스톱', '편의점', 'MINISTOP'],
  // 쇼핑
  ['올리브영', '쇼핑', 'OLIVEYOUNG'],
  ['다이소', '쇼핑', 'DAISO'],
  ['이마트', '쇼핑', 'EMART'],
  ['홈플러스', '쇼핑', 'HOMEPLUS'],
  ['롯데마트', '쇼핑'],
  ['신세계백화점', '쇼핑', '신세계', 'SHINSEGAE'],
  ['롯데백화점', '쇼핑'],
  ['현대백화점', '쇼핑'],
  ['갤러리아', '쇼핑'],
  ['무신사', '쇼핑', 'MUSINSA'],
  ['교보문고', '쇼핑'],
  ['예스24', '쇼핑', 'YES24'],
  ['알라딘', '쇼핑'],
  ['영풍문고', '쇼핑'],
  ['아트박스', '쇼핑', 'ARTBOX'],
  ['이니스프리', '쇼핑', 'INNISFREE'],
  ['더페이스샵', '쇼핑'],
  ['아리따움', '쇼핑'],
  ['코스트코', '쇼핑', 'COSTCO'],
  ['하이마트', '쇼핑'],
  ['GS더프레시', '쇼핑', 'GSTHEFRESH'],
  ['롯데슈퍼', '쇼핑'],
  ['이마트에브리데이', '쇼핑'],
  ['마켓컬리', '쇼핑', 'KURLY'],
  ['29CM', '쇼핑'],
  ['에이블리', '쇼핑'],
  ['지그재그', '쇼핑'],
  ['탑텐', '쇼핑', 'TOPTEN'],
  ['유니클로', '쇼핑', 'UNIQLO'],
  ['ABC마트', '쇼핑'],
  ['나이키', '쇼핑', 'NIKE'],
  ['아디다스', '쇼핑', 'ADIDAS'],
  ['시코르', '쇼핑', 'CHICOR'],
  // 기타
  ['CGV', '기타'],
  ['메가박스', '기타', 'MEGABOX'],
  ['롯데시네마', '기타'],
  ['구글플레이', '기타', 'GOOGLEPLAY'],
  ['컬쳐랜드', '기타', '컬처랜드', '문화상품권'],
  ['해피머니', '기타'],
  ['배달의민족', '기타', '배민'],
  ['요기요', '기타'],
  ['쿠팡이츠', '기타'],
  ['에버랜드', '기타'],
  ['롯데월드', '기타'],
  ['네이버페이', '기타'],
  ['북앤라이프', '기타'],
  ['도서문화상품권', '기타'],
  ['티머니', '기타', 'TMONEY'],
  ['넥슨캐시', '기타'],
  ['앱스토어', '기타', 'APPSTORE', '애플기프트카드'],
  ['넷플릭스', '기타', 'NETFLIX'],
  ['왓챠', '기타', 'WATCHA'],
];

const compact = text => text.normalize('NFKC').toUpperCase().replace(/[\s·.\-_'’&]/g, '');
const hangulOnly = text => text.replace(/[^가-힣]/g, '');
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Also used for brands the user registered that are not in the table above.
export const makeBrand = (name, category, aliases = []) => ({
  name,
  category,
  matchers: [...new Set([name, ...aliases].map(compact))].map(key => ({
    length: key.length,
    // Latin keys of three characters or fewer must stand alone, or "CU" would match "CUSTOMER".
    pattern: /^[A-Z0-9]{1,3}$/.test(key) ? new RegExp(`(^|[^A-Z0-9])${escape(key)}(?![A-Z0-9])`) : null,
    key,
  })),
  // OCR garbles the Latin part of mixed names ("메가MGC커피" -> "메가46(커피"); the Hangul part survives.
  skeleton: /[A-Z]/i.test(name) && hangulOnly(name).length >= 3 ? hangulOnly(name) : '',
});

// True when text is exactly the brand's name or one of its aliases ("교촌", "메가 MGC커피").
export const isBrandText = (text, brand) => brand.matchers.some(matcher => matcher.key === compact(text));

export const brands = table.map(([name, category, ...aliases]) => makeBrand(name, category, aliases));

// Misreadings of Latin brand names seen with Tesseract. Only applied to short labelled values,
// because the same characters appear inside coupon numbers.
const confusions = [
  [/^[\[(]?[G6C][S5$]\s?2[5S][\])]?$/i, 'GS25'],
  [/^[B8]{2}[Q0O]$/i, 'BBQ'],
];

// Returns the brand with the longest name or alias mentioned in text, or null.
// loose: text is a short labelled value (교환처, [brand] prefix), so known misreadings are accepted.
// extra: more brands to consider (made with makeBrand), e.g. the ones already in the wallet.
export function findBrand(text, { loose = false, extra = [] } = {}) {
  const upper = text.normalize('NFKC').toUpperCase();
  const flat = compact(text);
  const skeleton = hangulOnly(text);
  let best = null;
  let bestScore = 0;
  for (const brand of extra.length ? [...brands, ...extra] : brands) {
    for (const { key, pattern, length } of brand.matchers) {
      const hit = pattern ? pattern.test(upper) : flat.includes(key);
      if (hit && length > bestScore) { best = brand; bestScore = length; }
    }
    // A skeleton match ranks below an exact alias of the same length.
    if (brand.skeleton && skeleton.includes(brand.skeleton) && brand.skeleton.length - 0.5 > bestScore) {
      best = brand;
      bestScore = brand.skeleton.length - 0.5;
    }
  }
  if (!best && loose) {
    const value = upper.trim();
    for (const [pattern, name] of confusions) if (pattern.test(value)) return brands.find(b => b.name === name);
  }
  return best;
}

// A short line one letter off a brand name ("꼽네치킨" for 굽네치킨): OCR misread a syllable,
// often where a highlighter mark or a logo touches the text. Only names of four or more letters
// and one wrong syllable, so ordinary words do not turn into brands. When several brands are one
// syllable off (굽네치킨 and 네네치킨), the one whose letters (jamo) are closest wins.
const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const VOWELS = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const FINALS = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
// Each syllable as initial, vowel (and final) letters, tagged with their position.
const jamo = text => [...text].flatMap(ch => {
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return [ch];
  const tail = code % 28;
  return ['i' + INITIALS[Math.floor(code / 588)], 'v' + VOWELS[Math.floor((code % 588) / 28)], ...(tail ? ['f' + FINALS[tail]] : [])];
});
// Letters OCR confuses with each other (ㄱ/ㄲ, ㅗ/ㅜ ...) cost half a change.
const LOOKALIKES = ['ㄱㄲㅋ', 'ㄷㄸㅌ', 'ㅂㅃㅍ', 'ㅅㅆ', 'ㅈㅉㅊ', 'ㄴㄷ', 'ㅗㅜㅡ', 'ㅏㅓ', 'ㅐㅔ', 'ㅑㅕ'];
const lookalike = (a, b) => a[0] === b[0] && LOOKALIKES.some(group => group.includes(a[1]) && group.includes(b[1]));
const distance = (a, b) => {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      const swap = a[i - 1] === b[j - 1] ? 0 : lookalike(a[i - 1], b[j - 1]) ? 0.5 : 1;
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + swap);
    }
    row = next;
  }
  return row[b.length];
};

export function findBrandNear(text, extra = []) {
  const flat = compact(text);
  if (flat.length < 4 || flat.length > 10) return null;
  const letters = jamo(flat);
  let best = null;
  let bestDistance = Infinity;
  let tie = false;
  for (const brand of extra.length ? [...brands, ...extra] : brands) {
    const name = compact(brand.name);
    if (name.length !== flat.length || name.length < 4) continue;
    let diff = 0;
    for (let i = 0; i < name.length && diff < 2; i++) if (name[i] !== flat[i]) diff++;
    if (diff !== 1) continue;
    const d = distance(letters, jamo(name));
    if (d < bestDistance) { best = brand; bestDistance = d; tie = false; }
    else if (d === bestDistance && brand !== best) tie = true;
  }
  return best && !tie && bestDistance <= 2 ? best : null;
}

const categoryWords = [
  ['카페', /커피|아메리카노|라떼|카페|프라푸치노|케이크|케익|도넛|아이스크림|빙수|음료|스무디|에이드|마카롱|베이커리/],
  ['외식', /치킨|피자|버거|떡볶이|도시락|스테이크|뷔페|김밥|샌드위치/],
  ['편의점', /편의점/],
  ['쇼핑', /백화점|기프트카드|마트/],
];

export function guessCategory(brand, name, extra = []) {
  const known = brand && findBrand(brand, { loose: true, extra });
  if (known) return known.category;
  for (const [category, pattern] of categoryWords) if (pattern.test(name || '')) return category;
  return '기타';
}
