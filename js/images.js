// Image helpers: small thumbnails for the list, and a resized copy for text recognition.
function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('이미지를 변환하지 못했어요.'))), type, quality);
  });
}

function drawScaled(bitmap, width, height, sourceHeight = bitmap.height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, bitmap.width, sourceHeight, 0, 0, width, height);
  return canvas;
}

// The list shows a 72px tile, so 240px covers 3x screens. Tall coupons keep their top part,
// where the product photo usually is.
export async function makeThumbnail(blob, width = 240) {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, width / bitmap.width);
    const sourceHeight = Math.min(bitmap.height, Math.round((width * 2) / scale));
    const canvas = drawScaled(bitmap, Math.round(bitmap.width * scale), Math.round(sourceHeight * scale), sourceHeight);
    return await canvasToBlob(canvas, 'image/jpeg', 0.82);
  } finally {
    bitmap.close();
  }
}

// Camera photos can be 4000px and several MB. Stored coupons only need to stay scannable, so
// large photos are kept at 1600px wide (still far more than a barcode needs). Screenshots and
// anything already small are stored untouched.
export async function shrinkForStorage(blob, { maxBytes = 1.5 * 1048576, maxWidth = 1600 } = {}) {
  if (blob.size <= maxBytes || blob.type === 'image/gif') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width <= maxWidth) return blob;
    const scale = maxWidth / bitmap.width;
    const canvas = drawScaled(bitmap, maxWidth, Math.round(bitmap.height * scale));
    const smaller = await canvasToBlob(canvas, 'image/jpeg', 0.9);
    return smaller.size < blob.size ? smaller : blob;
  } finally {
    bitmap.close();
  }
}

// Grey from the brightest of R, G and B: dark text stays dark, but coloured marks behind it
// (a blue highlighter under "굽네치킨", a brand-coloured band) turn light instead of mid-grey,
// so Tesseract no longer reads the mark as part of the letters.
function withoutColour(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(px[i], px[i + 1], px[i + 2]);
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

// Phone screenshots (~1080px wide) read best at their own size: downscaling saved under 10% of
// the time but misread more product names. Only large photos are scaled down, tiny images up.
// Small images (KakaoTalk gifticons are often 440px wide) come back in two sizes: 3x reads thin
// Hangul cleanly (달콤, not 날콤) but now and then garbles a line or drops a lone Latin letter
// (아메리카노 R), which 2x keeps, so ocr.js reads both and patches the 3x lines (`fallback`).
export async function prepareForReading(blob, targetWidth = 1280) {
  const bitmap = await createImageBitmap(blob);
  try {
    let scale = 1;
    const small = bitmap.width < 600;
    if (bitmap.width > targetWidth) scale = targetWidth / bitmap.width;
    else if (small) scale = Math.min(3, Math.max(targetWidth, 1320) / bitmap.width);
    if (bitmap.height * scale > 4000) scale = 4000 / bitmap.height;
    const canvas = drawScaled(bitmap, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    // The barcode reader gets the colour image; text recognition gets highlighter-free grey.
    const result = { canvas, png: await canvasToBlob(withoutColour(canvas), 'image/png') };
    const lower = Math.min(2, scale);
    if (small && lower < scale - 0.25) {
      const other = drawScaled(bitmap, Math.round(bitmap.width * lower), Math.round(bitmap.height * lower));
      result.fallback = { png: await canvasToBlob(withoutColour(other), 'image/png'), ratio: scale / lower };
    }
    return result;
  } finally {
    bitmap.close();
  }
}
