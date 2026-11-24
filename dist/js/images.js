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

// Phone screenshots (~1080px wide) read best at their own size: downscaling saved under 10% of
// the time but misread more product names. Only large photos are scaled down, tiny images up.
export async function prepareForReading(blob, targetWidth = 1280) {
  const bitmap = await createImageBitmap(blob);
  try {
    let scale = 1;
    if (bitmap.width > targetWidth) scale = targetWidth / bitmap.width;
    else if (bitmap.width < 600) scale = Math.min(2, targetWidth / bitmap.width);
    if (bitmap.height * scale > 4000) scale = 4000 / bitmap.height;
    const canvas = drawScaled(bitmap, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    return { canvas, png: await canvasToBlob(canvas, 'image/png') };
  } finally {
    bitmap.close();
  }
}
