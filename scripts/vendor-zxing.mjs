// Copies the barcode reader (zxing-wasm, reader build only) from node_modules into dist/vendor so
// browsers without BarcodeDetector (iPhone Safari, desktop Firefox) can read coupon barcodes from
// the app's own origin, offline once cached. Run after changing its version: npm run vendor
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const pkg = new URL('node_modules/zxing-wasm/', root);
const { version } = JSON.parse(await readFile(new URL('package.json', pkg)));
const target = new URL(`dist/vendor/zxing-wasm-${version}/`, root);

for (const entry of await readdir(new URL('dist/vendor/', root)).catch(() => [])) {
  if (entry.startsWith('zxing-wasm-')) await rm(new URL(`dist/vendor/${entry}`, root), { recursive: true });
}
await mkdir(new URL('reader/', target), { recursive: true });
// reader/index.js imports ../share.js, so the two keep their relative layout.
for (const [from, to] of [
  ['dist/es/reader/index.js', 'reader/index.js'],
  ['dist/es/share.js', 'share.js'],
  ['dist/reader/zxing_reader.wasm', 'zxing_reader.wasm'],
  ['LICENSE', 'LICENSE'],
]) await copyFile(new URL(from, pkg), new URL(to, target));
// The .wasm is built from zxing-cpp, which is Apache-2.0 licensed.
await writeFile(new URL('NOTICE', target), 'zxing_reader.wasm is compiled from zxing-cpp (https://github.com/zxing-cpp/zxing-cpp),\nlicensed under the Apache License 2.0. The JavaScript wrapper (zxing-wasm) is MIT licensed, see LICENSE.\n');
console.log(`Vendored zxing-wasm ${version} into dist/vendor/zxing-wasm-${version}/`);

const ocr = new URL('dist/js/ocr.js', root);
const source = await readFile(ocr, 'utf8');
const updated = source.replace(/const ZXING_VERSION = '[^']+';/, `const ZXING_VERSION = '${version}';`);
if (updated !== source) await writeFile(ocr, updated);
