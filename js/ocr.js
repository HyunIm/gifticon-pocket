// Reads a gifticon image on the device: Tesseract for text, the barcode (BarcodeDetector, or zxing
// where the browser has none) for the number. Nothing leaves the device. The engine (~6MB) loads on first use and the
// service worker keeps it for offline use.
import { parseGifticon } from './parse.js';
import { prepareForReading } from './images.js';

const VERSION = '7.0.0';
const base = new URL(`../vendor/tesseract-${VERSION}/`, import.meta.url).href;
const ZXING_VERSION = '3.1.6';
const zxingBase = new URL(`../vendor/zxing-wasm-${ZXING_VERSION}/`, import.meta.url).href;
const IDLE_MS = 60000;

let workerPromise;
let idleTimer;
let reading = 0;
let report = () => {};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('script'));
    document.head.append(script);
  });
}

function simdSupported() {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

// Loading takes the first 30% of the bar, recognition the rest.
const stages = { 'loading tesseract core': [0, 0.15], 'loading language traineddata': [0.15, 0.25], 'initializing api': [0.25, 0.3], 'recognizing text': [0.3, 1] };

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      if (!window.Tesseract) await loadScript(base + 'tesseract.min.js');
      const core = simdSupported() ? 'tesseract-core-simd-lstm.js' : 'tesseract-core-lstm.js';
      const worker = await window.Tesseract.createWorker(['kor', 'eng'], window.Tesseract.OEM.LSTM_ONLY, {
        workerPath: base + 'worker.min.js',
        corePath: base + core,
        langPath: base.slice(0, -1),
        workerBlobURL: false,
        // The service worker caches the model files; no second copy in IndexedDB.
        cacheMethod: 'none',
        logger: message => {
          const [from, to] = stages[message.status] || [];
          if (from != null) report(from + (to - from) * (message.progress || 0));
        },
      });
      // PSM 4 (one column of lines of different sizes) matches coupon layouts best.
      // debug_file keeps Tesseract's diagnostics ("Estimating resolution…") out of the console.
      await worker.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1', debug_file: '/dev/null' });
      return worker;
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

function scheduleIdle() {
  clearTimeout(idleTimer);
  // The engine holds 100MB+ of memory; release it once the user is done importing.
  idleTimer = setTimeout(async () => {
    if (reading) return;
    const pending = workerPromise;
    workerPromise = null;
    (await pending?.catch(() => null))?.terminate();
  }, IDLE_MS);
}

// The longest all-digit value among the barcodes found: the coupon number.
const bestNumber = values => values.map(v => v.replace(/[\s-]/g, '')).filter(v => /^\d{8,24}$/.test(v))
  .sort((a, b) => b.length - a.length)[0] || '';

async function detectNative(canvas) {
  if (!('BarcodeDetector' in window)) return '';
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    const wanted = ['code_128', 'ean_13', 'itf', 'code_39', 'qr_code', 'pdf417', 'data_matrix'].filter(f => formats.includes(f));
    if (!wanted.length) return '';
    const codes = await new window.BarcodeDetector({ formats: wanted }).detect(canvas);
    return bestNumber(codes.map(c => c.rawValue));
  } catch {
    return '';
  }
}

// zxing (WebAssembly, ~1MB, loaded on first use) where the browser has no barcode reader of its
// own, which includes iPhone Safari. The barcode is far more reliable than reading its caption.
let zxingPromise;
function getZxing() {
  if (!zxingPromise) {
    zxingPromise = import(zxingBase + 'reader/index.js').then(zxing => {
      zxing.prepareZXingModule({
        overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? zxingBase + path : prefix + path) },
      });
      return zxing;
    });
    zxingPromise.catch(() => { zxingPromise = null; });
  }
  return zxingPromise;
}

async function detectZxing(canvas) {
  try {
    const zxing = await getZxing();
    const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const codes = await zxing.readBarcodes(image, {
      formats: ['Code128', 'EAN-13', 'ITF', 'Code39', 'QRCode', 'PDF417', 'DataMatrix'],
      tryHarder: true,
      maxNumberOfSymbols: 4,
    });
    return bestNumber(codes.filter(code => code.isValid).map(code => code.text));
  } catch {
    return '';
  }
}

async function readBarcode(canvas) {
  return (await detectNative(canvas)) || detectZxing(canvas);
}

export class ReadError extends Error {}

// Returns { brand, name, expiry, code, balance, category } with empty strings for what was not found.
export async function readGifticon(blob, onProgress = () => {}, { targetWidth, extraBrands } = {}) {
  clearTimeout(idleTimer);
  reading++;
  report = value => onProgress(Math.min(1, Math.max(0, value)));
  try {
    const { canvas, png } = await prepareForReading(blob, targetWidth);
    let worker;
    try {
      worker = await getWorker();
    } catch {
      throw new ReadError(navigator.onLine
        ? '이미지 읽기 도구를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
        : '처음 한 번은 인터넷 연결이 필요해요. 연결된 상태에서 다시 시도해 주세요.');
    }
    const [{ data }, barcode] = await Promise.all([
      worker.recognize(png, {}, { blocks: true, text: false }),
      readBarcode(canvas),
    ]);
    const lines = [];
    for (const block of data.blocks || []) for (const paragraph of block.paragraphs) for (const line of paragraph.lines) {
      lines.push({
        text: line.text.trim(), h: line.bbox.y1 - line.bbox.y0, y: line.bbox.y0, conf: line.confidence,
        words: (line.words || []).map(word => ({ text: word.text, x0: word.bbox.x0 })),
      });
    }
    const fields = parseGifticon(lines, { extraBrands });
    if (barcode) fields.code = barcode.replace(/(\d{4})(?=\d)/g, '$1 ');
    onProgress(1);
    return fields;
  } finally {
    reading--;
    report = () => {};
    scheduleIdle();
  }
}

// Starts downloading the engine while the user is still picking a file.
export function warmUp() {
  getWorker().then(scheduleIdle, () => {});
  if (!('BarcodeDetector' in window)) getZxing().catch(() => {});
}
