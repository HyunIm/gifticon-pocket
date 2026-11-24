// Copies the text recognition engine from node_modules into dist/vendor so the app serves it
// from its own origin (works offline once cached, no third-party CDN).
// Run after changing the tesseract.js versions in package.json: npm run vendor
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const version = JSON.parse(await readFile(new URL('node_modules/tesseract.js/package.json', root))).version;
const target = new URL(`dist/vendor/tesseract-${version}/`, root);
const pkg = name => new URL(`node_modules/${name}/`, root);

// Older vendored versions are no longer referenced by the app.
for (const entry of await readdir(new URL('dist/vendor/', root)).catch(() => [])) {
  if (entry.startsWith('tesseract-')) await rm(new URL(`dist/vendor/${entry}`, root), { recursive: true });
}
await mkdir(target, { recursive: true });

const files = [
  [pkg('tesseract.js'), 'dist/tesseract.min.js'],
  [pkg('tesseract.js'), 'dist/worker.min.js'],
  [pkg('tesseract.js'), 'LICENSE.md', 'LICENSE-tesseract.js.md'],
  // The worker loads the engine and its .wasm from its own directory.
  [pkg('tesseract.js-core'), 'tesseract-core-simd-lstm.js'],
  [pkg('tesseract.js-core'), 'tesseract-core-simd-lstm.wasm'],
  [pkg('tesseract.js-core'), 'tesseract-core-lstm.js'],
  [pkg('tesseract.js-core'), 'tesseract-core-lstm.wasm'],
  [pkg('tesseract.js-core'), 'LICENSE', 'LICENSE-tesseract.js-core'],
  // "best_int" models: close to the best accuracy at a fraction of the size.
  [pkg('@tesseract.js-data/kor'), '4.0.0_best_int/kor.traineddata.gz'],
  [pkg('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'],
];
for (const [base, file, rename] of files) {
  await copyFile(new URL(file, base), new URL(rename || file.split('/').pop(), target));
}
console.log(`Vendored tesseract.js ${version} into dist/vendor/tesseract-${version}/`);
// Keep the app's reference in sync with the vendored version.
const ocr = new URL('dist/js/ocr.js', root);
const source = await readFile(ocr, 'utf8');
const updated = source.replace(/const VERSION = '[^']+';/, `const VERSION = '${version}';`);
if (updated !== source) await writeFile(ocr, updated);
