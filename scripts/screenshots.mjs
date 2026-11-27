// Captures the README screenshots (docs/screenshots/*.webp) from the real app with demo coupons.
// The demo coupon images are drawn here, so no real coupon ever ends up in the repository.
//
//   npm run build && npm run screenshots
//
// Needs Playwright with Chromium (npx playwright install chromium) and Python with Pillow to
// convert the captures to WebP. Serves dist/ itself on a free port under /gifticon-pocket/.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { extname, join, normalize } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const root = new URL('../', import.meta.url).pathname;
const dist = join(root, 'dist');
const out = join(root, 'docs/screenshots');
const raw = join(out, 'raw');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.gz': 'application/gzip' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith('/gifticon-pocket/')) { res.writeHead(404).end(); return; }
  let file = normalize(join(dist, path.slice('/gifticon-pocket/'.length)));
  if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
  if (path.endsWith('/')) file = join(file, 'index.html');
  try {
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/gifticon-pocket/`;

// Demo coupons: [brand, product, days left, code, card colour, accent]
const demo = [
  ['스타벅스', '아이스 카페 아메리카노 T', 2, '9184 2735 6610', '#0b6b4f', '#d9efe5'],
  ['스타벅스', '카페 라떼 T', 12, '9184 2735 7721', '#0b6b4f', '#d9efe5'],
  ['스타벅스', '돌체 콜드 브루 T', 30, '9184 2735 8832', '#0b6b4f', '#d9efe5'],
  ['메가MGC커피', '달콤 한잔 세트', 5, '6079 7958 2637', '#f2c12e', '#fff6d6'],
  ['투썸플레이스', '떠먹는 아박 + 아메리카노 R', 21, '9945 4682 0434', '#c8102e', '#fde4e8'],
  ['굽네치킨', '오리지널 + 시카고피자 + 콜라1.25L', 16, '6419 7969 6125', '#1d9fe0', '#e1f3fc'],
  ['배스킨라빈스', '파인트 아이스크림', 44, '5521 8830 1247', '#ec4a9c', '#fde3f0'],
  ['CU', '모바일 상품권 5천원권', -3, '1047 9925 3361', '#7b3fa0', '#efe3f7'],
];

function couponHTML([brand, name, days, code, color, tint]) {
  const date = new Date(Date.now() + days * 86400000);
  const ymd = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  const bars = [...code.replace(/\D/g, '') + '7319'].map((d, i) => `<i style="width:${1 + (+d % 3)}px;margin-right:${1 + ((+d + i) % 2) * 2}px"></i>`).join('');
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;font-family:"Noto Sans CJK KR","Noto Sans KR",sans-serif;background:#fff}
    .c{width:440px;height:760px;display:flex;flex-direction:column}
    .art{height:330px;background:linear-gradient(135deg,${tint},#fff);display:grid;place-items:center}
    .cup{width:150px;height:190px;border-radius:14px 14px 40px 40px;background:${color};box-shadow:0 18px 30px #0002;display:grid;place-items:center;color:#fff;font-weight:900;font-size:28px;letter-spacing:-1px}
    .t{padding:26px 30px 0}.b{font-size:18px;color:#555}.n{font-size:28px;margin:6px 0 18px;line-height:1.25}.e{font-size:17px;color:#666}
    .bc{margin:auto 30px 34px;padding:18px;border:1px solid #ddd;border-radius:10px;text-align:center}
    .bars{display:flex;justify-content:center;height:78px}.bars i{display:block;background:#111}
    .num{font:700 22px monospace;margin-top:8px}</style>
    <div class="c"><div class="art"><div class="cup">${brand.slice(0, 2)}</div></div>
    <div class="t"><div class="b">${brand}</div><div class="n">${name}</div><div class="e">유효기간 : ~ ${ymd}</div></div>
    <div class="bc"><div class="bars">${bars}</div><div class="num">${code}</div></div></div>`;
}

const browser = await chromium.launch();
const maker = await browser.newPage({ viewport: { width: 440, height: 760 } });
const images = [];
for (const item of demo) {
  await maker.setContent(couponHTML(item));
  images.push((await maker.screenshot()).toString('base64'));
}
// A coupon that is not in the wallet yet, for the registration screen.
await maker.setContent(couponHTML(['이디야커피', '아이스 카페라떼 L', 25, '7713 2048 5596', '#1b3c8c', '#e3eaf9']));
const newCoupon = await maker.screenshot();
await maker.close();

async function seed(page) {
  await page.evaluate(async ({ demo, images }) => {
    const db = await new Promise(resolve => {
      const request = indexedDB.open('gifticon-pocket', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('coupons', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction('coupons', 'readwrite');
    const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    const category = brand => (/치킨|피자/.test(brand) ? '외식' : brand === 'CU' ? '편의점' : '카페');
    demo.forEach(([brand, name, days, code], i) => {
      const bytes = Uint8Array.from(atob(images[i]), c => c.charCodeAt(0));
      tx.objectStore('coupons').put({
        id: 'demo' + i, brand, name, expiry: day(days), category: category(brand), code, used: days < 0,
        createdAt: Date.now() - i * 1000, updatedAt: Date.now() - i * 1000, memo: '', balance: null,
        image: new Blob([bytes], { type: 'image/png' }),
      });
    });
    await new Promise(resolve => { tx.oncomplete = resolve; });
    db.close();
    // Seen-before state: no first-visit tips in the pictures.
    const now = String(Date.now());
    localStorage.setItem('gifticon-pocket:last-backup', now);
    localStorage.setItem('gifticon-pocket:ios-banner-dismissed', now);
    localStorage.setItem('gifticon-pocket:urgent-dismissed', new Date().toISOString().slice(0, 10));
    localStorage.setItem('gifticon-pocket:tips', JSON.stringify({ notify: +now, install: +now, backup: +now, import: +now }));
  }, { demo, images });
}

async function phone(colorScheme) {
  const context = await browser.newContext({ ...devices['iPhone 13'], colorScheme });
  const page = await context.newPage();
  await page.goto(base);
  await seed(page);
  await page.reload();
  await page.waitForSelector('.coupon-card');
  await page.evaluate(() => {
    document.querySelectorAll('[data-banner]').forEach(node => node.remove());
    document.querySelector('#install-button').hidden = true;
  });
  await page.waitForTimeout(500);
  return { context, page };
}

const shot = async (page, name) => {
  // Reminder banners come back on every refresh; the pictures show the app itself.
  await page.evaluate(() => document.querySelectorAll('[data-banner]').forEach(node => node.remove()));
  await page.screenshot({ path: join(raw, name + '.png') });
};
const swipe = async (page, card, dx) => {
  const box = await card.boundingBox();
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + (dx * i) / 12, y);
  await page.mouse.up();
  await page.waitForTimeout(450);
};

await rm(raw, { recursive: true, force: true });
await mkdir(raw, { recursive: true });

{
  const { context, page } = await phone('dark');
  await shot(page, 'home-dark');
  // Same-brand pile fanned out
  await page.locator('.coupon-stack .coupon-card').first().click();
  await page.waitForTimeout(500);
  await shot(page, 'stack-dark');
  await page.locator('.stack-fold').click();
  // Long-press selection
  const cards = page.locator('#coupon-list .coupon-card');
  const box = await cards.nth(1).boundingBox();
  await page.mouse.move(box.x + 120, box.y + 40);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await cards.nth(2).click();
  await page.waitForTimeout(400);
  await shot(page, 'select-dark');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // Swipe right: 사용 완료 button
  await swipe(page, cards.nth(1), 220);
  await shot(page, 'swipe-dark');
  await context.close();
}
{
  const { context, page } = await phone('light');
  await shot(page, 'home-light');
  await page.locator('.coupon-stack .coupon-card').first().click();
  await page.waitForTimeout(400);
  await page.locator('#coupon-list .coupon-card').first().click();
  await page.waitForTimeout(500);
  await shot(page, 'details-light');
  await page.locator('.show-button').click();
  await page.waitForTimeout(500);
  await shot(page, 'viewer-light');
  await page.locator('.viewer-close').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // Registration: the image is read and the form filled in
  await page.locator('.tab-add').click();
  await page.waitForSelector('dialog .image-picker');
  const sample = join(raw, 'register-sample.png');
  await writeFile(sample, newCoupon);
  await page.locator('dialog input[type=file]').setInputFiles(sample);
  await page.waitForSelector('.read-status.done, .read-status.empty, .read-status.warn', { timeout: 120000 });
  await page.waitForTimeout(300);
  await shot(page, 'register-light');
  await page.keyboard.press('Escape');
  await page.locator('.ask-dialog .button-danger').click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('.tab[data-action=settings]').click();
  await page.waitForTimeout(500);
  await page.locator('.segmented').scrollIntoViewIfNeeded();
  await shot(page, 'settings-light');
  await context.close();
}
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto(base);
  await seed(page);
  await page.reload();
  await page.waitForSelector('.coupon-card');
  await page.evaluate(() => {
    document.querySelectorAll('[data-banner]').forEach(node => node.remove());
    document.querySelector('#install-button').hidden = true;
  });
  await page.waitForTimeout(500);
  await shot(page, 'desktop-light');
  await context.close();
}

await browser.close();
server.close();

// Phone captures shrink to 540px wide (sharp at the ~270px they are shown); desktop to 1280px.
execFileSync('python3', ['-c', `
import glob, os
from PIL import Image
raw, out = ${JSON.stringify(raw)}, ${JSON.stringify(out)}
for path in glob.glob(os.path.join(raw, '*.png')):
    name = os.path.splitext(os.path.basename(path))[0]
    if name == 'register-sample': continue
    im = Image.open(path).convert('RGB')
    width = 1280 if name.startswith('desktop') else 540
    if im.width > width: im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(os.path.join(out, name + '.webp'), 'WEBP', quality=82, method=6)
`]);
await rm(raw, { recursive: true, force: true });
console.log(`Screenshots written to docs/screenshots/`);
