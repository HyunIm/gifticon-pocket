// Reads a gifticon image on the device: Tesseract for text, BarcodeDetector for the number when
// the browser has it. Nothing leaves the device. The engine (~6MB) loads on first use and the
// service worker keeps it for offline use.
import { parseGifticon } from './parse.js';
import { prepareForReading } from './images.js';

const VERSION = '7.0.0';
const base = `/vendor/tesseract-${VERSION}/`;
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

async function readBarcode(canvas) {
  if (!('BarcodeDetector' in window)) return '';
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    const wanted = ['code_128', 'ean_13', 'itf', 'code_39', 'qr_code', 'pdf417', 'data_matrix'].filter(f => formats.includes(f));
    if (!wanted.length) return '';
    const codes = await new window.BarcodeDetector({ formats: wanted }).detect(canvas);
    const numeric = codes.map(c => c.rawValue.replace(/[\s-]/g, '')).filter(v => /^\d{8,24}$/.test(v));
    return numeric.sort((a, b) => b.length - a.length)[0] || '';
  } catch {
    return '';
  }
}

export class ReadError extends Error {}

// Returns { brand, name, expiry, code, balance, category } with empty strings for what was not found.
export async function readGifticon(blob, onProgress = () => {}, { targetWidth } = {}) {
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
      lines.push({ text: line.text.trim(), h: line.bbox.y1 - line.bbox.y0, y: line.bbox.y0, conf: line.confidence });
    }
    const fields = parseGifticon(lines);
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
}
