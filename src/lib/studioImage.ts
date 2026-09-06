import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

let segmenterPromise: Promise<ImageSegmenter> | null = null;

async function getSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = FilesetResolver.forVisionTasks(WASM_ROOT).then(vision =>
      ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'IMAGE',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      })
    ).catch(async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
      return ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
    });
  }
  return segmenterPromise;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не удалось создать прозрачное изображение')), 'image/webp', 0.94);
  });
}

/**
 * Removes the background locally in the browser. The original photo is never
 * sent to MediaPipe or another external image-processing service.
 */
export async function createStudioCutout(file: File, maxSide = 2200): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) throw new Error('Браузер не поддерживает обработку изображения');
  sourceContext.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const segmenter = await getSegmenter();
  const result = segmenter.segment(source);
  const masks = result.confidenceMasks;
  if (!masks || masks.length < 2) throw new Error('Не удалось отделить модель от фона');

  const maskWidth = masks[0].width;
  const maskHeight = masks[0].height;
  const foregroundMasks = masks.slice(1).map(mask => mask.getAsFloat32Array());
  const maskPixels = new Uint8ClampedArray(maskWidth * maskHeight * 4);
  let minX = maskWidth;
  let minY = maskHeight;
  let maxX = 0;
  let maxY = 0;

  for (let pixel = 0; pixel < maskWidth * maskHeight; pixel += 1) {
    let confidence = 0;
    for (const mask of foregroundMasks) confidence = Math.max(confidence, mask[pixel] || 0);
    // A soft confidence ramp keeps hair and fabric edges natural without a halo.
    const alpha = Math.round(smoothstep(0.12, 0.76, confidence) * 255);
    const offset = pixel * 4;
    maskPixels[offset] = 255;
    maskPixels[offset + 1] = 255;
    maskPixels[offset + 2] = 255;
    maskPixels[offset + 3] = alpha;
    if (alpha > 20) {
      const x = pixel % maskWidth;
      const y = Math.floor(pixel / maskWidth);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const smallMask = document.createElement('canvas');
  smallMask.width = maskWidth;
  smallMask.height = maskHeight;
  smallMask.getContext('2d')?.putImageData(new ImageData(maskPixels, maskWidth, maskHeight), 0, 0);

  sourceContext.globalCompositeOperation = 'destination-in';
  sourceContext.imageSmoothingEnabled = true;
  sourceContext.imageSmoothingQuality = 'high';
  sourceContext.drawImage(smallMask, 0, 0, width, height);
  sourceContext.globalCompositeOperation = 'source-over';

  if (minX > maxX || minY > maxY) throw new Error('На фотографии не найден человек');
  const padding = Math.round(Math.max(maskWidth, maskHeight) * 0.025);
  const left = Math.max(0, Math.floor(((minX - padding) / maskWidth) * width));
  const top = Math.max(0, Math.floor(((minY - padding) / maskHeight) * height));
  const right = Math.min(width, Math.ceil(((maxX + padding + 1) / maskWidth) * width));
  const bottom = Math.min(height, Math.ceil(((maxY + padding + 1) / maskHeight) * height));

  const cropped = document.createElement('canvas');
  cropped.width = Math.max(1, right - left);
  cropped.height = Math.max(1, bottom - top);
  cropped.getContext('2d')?.drawImage(source, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);

  const blob = await canvasToBlob(cropped);
  const stem = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return new File([blob], `${stem}-studio.webp`, { type: 'image/webp', lastModified: Date.now() });
}
