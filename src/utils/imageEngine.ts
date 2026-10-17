/**
 * UploadRight — Image Quality, File-Size and Metadata Engine
 * 
 * Complies with Critical Engineering Guardrails B, C, and D:
 * - Expresses all size thresholds in bytes internally.
 * - Interior safety margin for narrow ranges.
 * - Tries quality 0.92 first; if below min, tests 0.95 then 1.0 before COM padding.
 * - Binary searches downward with explicit [0.05, 0.92] bounds if too large.
 * - Constructs each candidate using the full pipeline including DPI before measuring byte size.
 * - Strict, bounds-checked JPEG marker parser for JFIF APP0 and SOF markers.
 * - Sanitizes filenames to safe lowercase ASCII letters, digits, underscores, and hyphens.
 */

export interface ProcessOptions {
  targetWidth: number;
  targetHeight: number;
  minKB: number;
  maxKB: number;
  dpi: number;
  padWhiteBorders?: boolean;
  applyWhitener?: boolean;
  whitenerThreshold?: number;
  brightness?: number;
  contrast?: number;
  placardName?: string;
  placardDate?: string;
}

export interface ProcessResult {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  sizeBytes: number;
  sizeKB: number;
  dpi: number;
  format: 'JPEG';
  qualityUsed: number;
  isPadded: boolean;
  passesValidation: boolean;
  notes: string[];
  validationDetails: {
    format: boolean;
    dimensions: boolean;
    fileSize: boolean;
    dpi: boolean;
  };
}

/**
 * Load an image file into an HTMLImageElement safely.
 * Handles JPG, PNG, WebP, and HEIC (via dynamic loader).
 */
export async function loadImageFile(file: File): Promise<HTMLImageElement> {
  const isHeic = /\.(heic|heif)$/i.test(file.name) || file.type === 'image/heic' || file.type === 'image/heif';

  let blob: Blob = file;

  if (isHeic && typeof window !== 'undefined') {
    try {
      // Dynamic import with window-level fallback to avoid build-time resolution failure
      const heic2anyLoader = new Function('url', 'return import(url)');
      const module = await heic2anyLoader('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js');
      const heic2any = module.default || module;
      const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
      blob = Array.isArray(result) ? result[0] : result;
    } catch (e) {
      console.warn('HEIC dynamic conversion skipped or failed:', e);
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode image data. Please choose a standard JPG, PNG, or WEBP image.'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Draw source image to a 2D canvas at exact target dimensions.
 * If padWhiteBorders is true, aspect-ratio is preserved with crisp white borders.
 */
export function drawToCanvas(
  img: HTMLImageElement | HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
  padWhiteBorders: boolean = false
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not acquire 2D canvas rendering context.');

  // Always initialize with opaque white background (required for government portals)
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  const srcWidth = img instanceof HTMLCanvasElement ? img.width : img.naturalWidth;
  const srcHeight = img instanceof HTMLCanvasElement ? img.height : img.naturalHeight;

  if (padWhiteBorders) {
    const scale = Math.min(targetWidth / srcWidth, targetHeight / srcHeight);
    const drawW = Math.round(srcWidth * scale);
    const drawH = Math.round(srcHeight * scale);
    const offsetX = Math.round((targetWidth - drawW) / 2);
    const offsetY = Math.round((targetHeight - drawH) / 2);
    ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
  } else {
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
  }

  return canvas;
}

/**
 * Paper Whitener filter: converts off-white or yellowish paper shadows to pure #FFFFFF
 * while preserving and enhancing dark pen ink.
 */
export function applyPaperWhitener(canvas: HTMLCanvasElement, threshold: number = 180): HTMLCanvasElement {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const clampedThreshold = Math.max(120, Math.min(240, threshold));

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Standard ITU-R BT.601 perceived luminance
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    if (lum > clampedThreshold) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
    } else {
      // Contrast stretch for pen ink
      const factor = 0.65;
      data[i] = Math.max(0, Math.round(r * factor));
      data[i + 1] = Math.max(0, Math.round(g * factor));
      data[i + 2] = Math.max(0, Math.round(b * factor));
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Brightness & Contrast adjustment filter
 */
export function applyBrightnessContrast(
  canvas: HTMLCanvasElement,
  brightness: number = 0,
  contrast: number = 0
): HTMLCanvasElement {
  if (brightness === 0 && contrast === 0) return canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const clampedB = Math.max(-50, Math.min(50, brightness));
  const clampedC = Math.max(-50, Math.min(50, contrast));

  // Contrast transfer factor
  const factor = (259 * (clampedC + 255)) / (255 * (259 - clampedC));

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] + clampedB;
    let g = data[i + 1] + clampedB;
    let b = data[i + 2] + clampedB;

    if (clampedC !== 0) {
      r = factor * (r - 128) + 128;
      g = factor * (g - 128) + 128;
      b = factor * (b - 128) + 128;
    }

    data[i] = Math.max(0, Math.min(255, Math.round(r)));
    data[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
    data[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Draw official name and date placard strip on bottom 16% of photo.
 * Supports Name only, Date only, or Name + Date.
 */
export function drawPlacard(
  canvas: HTMLCanvasElement,
  name?: string,
  date?: string
): HTMLCanvasElement {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const trimmedName = (name || '').trim();
  const trimmedDate = (date || '').trim();
  if (!trimmedName && !trimmedDate) return canvas;

  const placardHeight = Math.max(34, Math.round(canvas.height * 0.16));
  const placardY = canvas.height - placardHeight;

  // Solid white placard background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, placardY, canvas.width, placardHeight);

  // Border separator
  ctx.strokeStyle = '#D9D9DE';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, placardY);
  ctx.lineTo(canvas.width, placardY);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (trimmedName && trimmedDate) {
    const nameFontSize = Math.max(11, Math.round(placardHeight * 0.32));
    ctx.fillStyle = '#101013';
    ctx.font = `700 ${nameFontSize}px Inter, sans-serif`;
    const nameY = placardY + Math.round(placardHeight * 0.35);
    ctx.fillText(trimmedName.toUpperCase(), canvas.width / 2, nameY);

    const dateFontSize = Math.max(9, Math.round(placardHeight * 0.25));
    ctx.font = `600 ${dateFontSize}px 'Geist Mono', monospace`;
    ctx.fillStyle = '#333333';
    const dateY = placardY + Math.round(placardHeight * 0.72);
    ctx.fillText(trimmedDate, canvas.width / 2, dateY);
  } else if (trimmedName) {
    const nameFontSize = Math.max(13, Math.round(placardHeight * 0.44));
    ctx.fillStyle = '#101013';
    ctx.font = `700 ${nameFontSize}px Inter, sans-serif`;
    ctx.fillText(trimmedName.toUpperCase(), canvas.width / 2, placardY + placardHeight / 2);
  } else if (trimmedDate) {
    const dateFontSize = Math.max(12, Math.round(placardHeight * 0.40));
    ctx.font = `600 ${dateFontSize}px 'Geist Mono', monospace`;
    ctx.fillStyle = '#101013';
    ctx.fillText(trimmedDate, canvas.width / 2, placardY + placardHeight / 2);
  }

  return canvas;
}

/**
 * Convert canvas to JPEG blob at specified quality.
 */
function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas JPEG encoding failed'));
      },
      'image/jpeg',
      Math.max(0.01, Math.min(1.0, quality))
    );
  });
}

/**
 * Builds a JPEG candidate buffer with JFIF DPI header applied.
 * Guardrail B: "Construct each candidate using the same processing pipeline,
 * including DPI metadata, before evaluating its final byte size."
 */
async function buildCandidateWithDPI(canvas: HTMLCanvasElement, quality: number, dpi: number): Promise<ArrayBuffer> {
  const blob = await canvasToBlob(canvas, quality);
  const rawBuffer = await blob.arrayBuffer();
  return injectDPI(rawBuffer, dpi);
}

/**
 * Safe bounds-checked JPEG marker parser and JFIF DPI injector.
 * Guardrail C: "Parse JPEG markers rather than assuming fixed byte offsets.
 * Validate the JFIF identifier, segment lengths and density fields.
 * Handle files with existing metadata as well as files requiring a new JFIF APP0 segment."
 */
export function injectDPI(arrayBuffer: ArrayBuffer, dpi: number): ArrayBuffer {
  const data = new Uint8Array(arrayBuffer);

  // Validate SOI marker (0xFF 0xD8)
  if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8) {
    return arrayBuffer;
  }

  let offset = 2;
  const len = data.length;

  while (offset + 4 <= len) {
    if (data[offset] !== 0xFF) {
      offset++;
      continue;
    }

    const marker = data[offset + 1];

    // Entropy-coded data start (SOS 0xDA) or end of image (EOI 0xD9) - stop header parse
    if (marker === 0xDA || marker === 0xD9) {
      break;
    }

    // Skip fill bytes (0xFF 0xFF) or restart markers (0xD0..0xD7) which have no length
    if (marker === 0xFF || (marker >= 0xD0 && marker <= 0xD7)) {
      offset += 2;
      continue;
    }

    if (offset + 4 > len) break;
    const segLength = (data[offset + 2] << 8) | data[offset + 3];
    if (segLength < 2 || offset + 2 + segLength > len) break;

    // Check for APP0 marker (0xFF 0xE0)
    if (marker === 0xE0 && segLength >= 16) {
      // Validate 'JFIF\0' identifier at offset + 4
      const idMatch =
        data[offset + 4] === 0x4A && // J
        data[offset + 5] === 0x46 && // F
        data[offset + 6] === 0x49 && // I
        data[offset + 7] === 0x46 && // F
        data[offset + 8] === 0x00;   // \0

      if (idMatch) {
        // Density units: 1 = dots per inch (DPI)
        data[offset + 11] = 0x01;
        // X density (16-bit big endian)
        data[offset + 12] = (dpi >> 8) & 0xFF;
        data[offset + 13] = dpi & 0xFF;
        // Y density (16-bit big endian)
        data[offset + 14] = (dpi >> 8) & 0xFF;
        data[offset + 15] = dpi & 0xFF;

        const copy = new Uint8Array(data.length);
        copy.set(data);
        return copy.buffer as ArrayBuffer;
      }
    }

    offset += 2 + segLength;
  }

  // If no valid APP0 segment was present, insert a standard JFIF APP0 segment right after SOI
  return insertJFIFHeader(data, dpi);
}

/**
 * Inserts a standard 18-byte JFIF APP0 header directly after SOI (0xFF 0xD8).
 */
function insertJFIFHeader(data: Uint8Array, dpi: number): ArrayBuffer {
  const app0 = new Uint8Array([
    0xFF, 0xE0,             // Marker: APP0
    0x00, 0x10,             // Length: 16 bytes
    0x4A, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x01,             // Version 1.1
    0x01,                   // Units: 1 = DPI
    (dpi >> 8) & 0xFF, dpi & 0xFF, // Xdensity
    (dpi >> 8) & 0xFF, dpi & 0xFF, // Ydensity
    0x00, 0x00              // Thumbnail: 0x0
  ]);

  const output = new Uint8Array(2 + app0.length + (data.length - 2));
  output[0] = 0xFF;
  output[1] = 0xD8;
  output.set(app0, 2);
  output.set(data.subarray(2), 2 + app0.length);

  return output.buffer as ArrayBuffer;
}

/**
 * Bounds-checked read of DPI from JFIF APP0 segment.
 */
export function readDPI(arrayBuffer: ArrayBuffer): number {
  const data = new Uint8Array(arrayBuffer);
  if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8) return 72;

  let offset = 2;
  const len = data.length;

  while (offset + 4 <= len) {
    if (data[offset] !== 0xFF) {
      offset++;
      continue;
    }
    const marker = data[offset + 1];
    if (marker === 0xDA || marker === 0xD9) break;
    if (marker === 0xFF || (marker >= 0xD0 && marker <= 0xD7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > len) break;
    const segLength = (data[offset + 2] << 8) | data[offset + 3];
    if (segLength < 2 || offset + 2 + segLength > len) break;

    if (marker === 0xE0 && segLength >= 16) {
      const isJfif =
        data[offset + 4] === 0x4A &&
        data[offset + 5] === 0x46 &&
        data[offset + 6] === 0x49 &&
        data[offset + 7] === 0x46 &&
        data[offset + 8] === 0x00;

      if (isJfif) {
        const units = data[offset + 11];
        const xDpi = (data[offset + 12] << 8) | data[offset + 13];
        if (units === 1) return xDpi;
        if (units === 2) return Math.round(xDpi * 2.54); // dots/cm to DPI
        return xDpi || 72;
      }
    }
    offset += 2 + segLength;
  }

  return 72;
}

/**
 * Bounds-checked JPEG dimensions parser from SOF0 / SOF2 markers.
 */
export function readJPEGDimensions(arrayBuffer: ArrayBuffer): { width: number; height: number } | null {
  const data = new Uint8Array(arrayBuffer);
  if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8) return null;

  let offset = 2;
  const len = data.length;

  while (offset + 4 <= len) {
    if (data[offset] !== 0xFF) {
      offset++;
      continue;
    }
    const marker = data[offset + 1];
    if (marker === 0xDA || marker === 0xD9) break;

    // SOF0 (Baseline DCT 0xC0) or SOF2 (Progressive DCT 0xC2)
    if (marker === 0xC0 || marker === 0xC2) {
      if (offset + 9 <= len) {
        const height = (data[offset + 5] << 8) | data[offset + 6];
        const width = (data[offset + 7] << 8) | data[offset + 8];
        return { width, height };
      }
    }

    if (marker === 0xFF || (marker >= 0xD0 && marker <= 0xD7)) {
      offset += 2;
      continue;
    }

    const segLength = (data[offset + 2] << 8) | data[offset + 3];
    if (segLength < 2 || offset + 2 + segLength > len) break;
    offset += 2 + segLength;
  }

  return null;
}

/**
 * Injects ISO-compliant JPEG Comment (COM, 0xFF 0xFE) segments immediately BEFORE
 * the EOI marker (0xFF 0xD9) to reach the required minBytes safely.
 * Bounds-checked and validates markers.
 */
export function padToMinBytes(arrayBuffer: ArrayBuffer, minBytes: number): { buffer: ArrayBuffer; isPadded: boolean } {
  const data = new Uint8Array(arrayBuffer);
  if (data.length >= minBytes) {
    return { buffer: arrayBuffer, isPadded: false };
  }

  // Find the final EOI marker (0xFF 0xD9) scanning backward from end
  let eoiPos = -1;
  for (let i = data.length - 2; i >= 2; i--) {
    if (data[i] === 0xFF && data[i + 1] === 0xD9) {
      eoiPos = i;
      break;
    }
  }

  if (eoiPos === -1) {
    return { buffer: arrayBuffer, isPadded: false };
  }

  const deficit = minBytes - data.length;
  if (deficit <= 0) return { buffer: arrayBuffer, isPadded: false };

  // Max payload per single COM segment is 65533 bytes (65535 - 2 bytes length)
  const segments: Uint8Array[] = [];
  let remaining = deficit;

  while (remaining > 0) {
    // Each COM segment overhead is 4 bytes: [0xFF, 0xFE, lenHi, lenLo]
    const overhead = 4;
    const maxPayload = 65533;
    const payloadSize = Math.min(remaining, maxPayload);
    const segLength = payloadSize + 2;

    const seg = new Uint8Array(overhead + payloadSize);
    seg[0] = 0xFF;
    seg[1] = 0xFE; // COM marker
    seg[2] = (segLength >> 8) & 0xFF;
    seg[3] = segLength & 0xFF;

    // Fill comment payload with safe benign space bytes
    for (let j = 4; j < seg.length; j++) {
      seg[j] = 0x20;
    }

    segments.push(seg);
    remaining -= (payloadSize + overhead);
    if (remaining < 0) remaining = 0;
  }

  const totalComBytes = segments.reduce((sum, s) => sum + s.length, 0);
  const result = new Uint8Array(eoiPos + totalComBytes + 2);

  // Copy data before EOI
  result.set(data.subarray(0, eoiPos), 0);

  // Insert COM segments
  let writeOffset = eoiPos;
  for (const s of segments) {
    result.set(s, writeOffset);
    writeOffset += s.length;
  }

  // Re-append EOI
  result[writeOffset] = 0xFF;
  result[writeOffset + 1] = 0xD9;

  return { buffer: result.buffer as ArrayBuffer, isPadded: true };
}

/**
 * Image Quality and File-Size Optimizer
 * 
 * Guardrail B Specifications:
 * 1. Express all size thresholds in bytes internally.
 * 2. Keep configured min lower than max; use interior safety margin.
 * 3. Try quality 0.92 first.
 * 4. If below min: test 0.95 then 1.0 before COM padding fallback.
 * 5. If too large: binary-search downward with explicit lower (0.05) and upper (0.92) bounds.
 * 6. Construct each candidate using the full pipeline with DPI before evaluating byte size.
 */
async function optimizeJpegSize(
  canvas: HTMLCanvasElement,
  minBytes: number,
  maxBytes: number,
  dpi: number
): Promise<{ buffer: ArrayBuffer; quality: number; isPadded: boolean; notes: string[] }> {
  const notes: string[] = [];

  // Interior safety margin to avoid razor-thin boundary cuts:
  // For tight ranges (e.g. 10KB to 20KB), safety margin is ~3-5% or 512 bytes
  const rangeDelta = maxBytes - minBytes;
  const interiorMargin = Math.max(256, Math.min(1024, Math.floor(rangeDelta * 0.05)));
  const targetMin = minBytes + interiorMargin;
  const targetMax = maxBytes - interiorMargin;

  // Step 1: Try quality 0.92 first
  const initialQ = 0.92;
  const initialBuf = await buildCandidateWithDPI(canvas, initialQ, dpi);
  const initialSize = initialBuf.byteLength;

  // Case A: Fits comfortably within [minBytes, maxBytes]
  if (initialSize >= minBytes && initialSize <= maxBytes) {
    notes.push('Balanced high-fidelity output at quality 0.92 without compression artifacts.');
    return { buffer: initialBuf, quality: initialQ, isPadded: false, notes };
  }

  // Case B: Below minBytes — Test quality 0.95 and then 1.0 before any metadata-padding fallback
  if (initialSize < minBytes) {
    // Test 0.95
    const q95Buf = await buildCandidateWithDPI(canvas, 0.95, dpi);
    if (q95Buf.byteLength >= minBytes && q95Buf.byteLength <= maxBytes) {
      notes.push('Elevated quality to 0.95 to meet portal minimum size requirement.');
      return { buffer: q95Buf, quality: 0.95, isPadded: false, notes };
    }

    // Test 1.0
    const q100Buf = await buildCandidateWithDPI(canvas, 1.0, dpi);
    if (q100Buf.byteLength >= minBytes && q100Buf.byteLength <= maxBytes) {
      notes.push('Maximized quality to 1.0 to meet portal minimum size requirement.');
      return { buffer: q100Buf, quality: 1.0, isPadded: false, notes };
    }

    // If still below minimum even at quality 1.0, apply safe COM metadata-padding fallback
    if (q100Buf.byteLength < minBytes) {
      const padded = padToMinBytes(q100Buf, targetMin);
      notes.push('Notice: Input document was naturally sparse. Safe ISO-compliant metadata padding was applied to meet the portal minimum size requirement.');
      return { buffer: padded.buffer, quality: 1.0, isPadded: true, notes };
    }
  }

  // Case C: Too large at 0.92 (> maxBytes) — Binary search downward with explicit bounds [0.05, 0.92]
  let lowerBound = 0.05;
  let upperBound = 0.92;
  let bestCandidate: { buffer: ArrayBuffer; quality: number } | null = null;
  let bestDistance = Infinity;

  // Binary search with max 10 iterations
  for (let iter = 0; iter < 10; iter++) {
    const testQ = parseFloat(((lowerBound + upperBound) / 2).toFixed(3));
    const candidateBuf = await buildCandidateWithDPI(canvas, testQ, dpi);
    const candidateSize = candidateBuf.byteLength;

    if (candidateSize >= minBytes && candidateSize <= maxBytes) {
      // Valid candidate! Check if within interior comfort zone
      const distFromIdeal = Math.abs(candidateSize - (targetMin + targetMax) / 2);
      if (distFromIdeal < bestDistance) {
        bestDistance = distFromIdeal;
        bestCandidate = { buffer: candidateBuf, quality: testQ };
      }

      // If we are already comfortably inside interior target, we can return early
      if (candidateSize >= targetMin && candidateSize <= targetMax) {
        notes.push(`Optimized JPEG quality to ${(testQ * 100).toFixed(0)}% to fit strictly within portal limits.`);
        return { buffer: candidateBuf, quality: testQ, isPadded: false, notes };
      }
    }

    if (candidateSize > maxBytes) {
      upperBound = testQ;
    } else {
      lowerBound = testQ;
    }
  }

  if (bestCandidate) {
    notes.push(`Precision-matched quality to ${(bestCandidate.quality * 100).toFixed(0)}% to satisfy file-size boundary.`);
    return { buffer: bestCandidate.buffer, quality: bestCandidate.quality, isPadded: false, notes };
  }

  // If even at lowerBound the file exceeds maxBytes (e.g. extremely dense image or narrow limit):
  const lowestBuf = await buildCandidateWithDPI(canvas, lowerBound, dpi);
  if (lowestBuf.byteLength <= maxBytes) {
    notes.push(`Applied strong compression at ${(lowerBound * 100).toFixed(0)}% quality to satisfy portal maximum.`);
    return { buffer: lowestBuf, quality: lowerBound, isPadded: false, notes };
  }

  // Explaining limitation clearly per Guardrail B
  notes.push(`Image detail density exceeds the portal's tight ${Math.round(maxBytes / 1024)} KB limit at target dimensions. Please crop tighter or use plain white background.`);
  return { buffer: lowestBuf, quality: lowerBound, isPadded: false, notes };
}

/**
 * Full Processing Pipeline
 */
export async function processImage(
  source: HTMLImageElement | HTMLCanvasElement,
  options: ProcessOptions
): Promise<ProcessResult> {
  const {
    targetWidth,
    targetHeight,
    minKB,
    maxKB,
    dpi,
    padWhiteBorders = false,
    applyWhitener: shouldWhiten = false,
    whitenerThreshold = 180,
    placardName,
    placardDate,
  } = options;

  // Guardrail B: All size thresholds in bytes internally & min < max check
  const minBytes = Math.max(1024, Math.round(minKB * 1024));
  const maxBytes = Math.max(minBytes + 1024, Math.round(maxKB * 1024));

  // Step 1: Draw to canvas at target dimensions
  let canvas = drawToCanvas(source, targetWidth, targetHeight, padWhiteBorders);

  // Step 2: Brightness & Contrast
  if ((options.brightness && options.brightness !== 0) || (options.contrast && options.contrast !== 0)) {
    canvas = applyBrightnessContrast(canvas, options.brightness || 0, options.contrast || 0);
  }

  // Step 3: Paper Whitener
  if (shouldWhiten) {
    canvas = applyPaperWhitener(canvas, whitenerThreshold);
  }

  // Step 4: Placard (Name or Date or both)
  if ((placardName && placardName.trim().length > 0) || (placardDate && placardDate.trim().length > 0)) {
    canvas = drawPlacard(canvas, placardName, placardDate);
  }

  // Step 4: Quality & byte-size engine with full pipeline per candidate
  const optimized = await optimizeJpegSize(canvas, minBytes, maxBytes, dpi);

  // Step 5: Read back validated headers directly from binary
  const finalSize = optimized.buffer.byteLength;
  const embeddedDpi = readDPI(optimized.buffer);
  const parsedDims = readJPEGDimensions(optimized.buffer);

  const finalBlob = new Blob([optimized.buffer], { type: 'image/jpeg' });
  const finalUrl = URL.createObjectURL(finalBlob);

  const validationDetails = {
    format: true,
    dimensions: parsedDims ? (parsedDims.width === targetWidth && parsedDims.height === targetHeight) : (canvas.width === targetWidth && canvas.height === targetHeight),
    fileSize: finalSize >= minBytes && finalSize <= maxBytes,
    dpi: embeddedDpi === dpi,
  };

  const passesValidation = Object.values(validationDetails).every(Boolean);

  return {
    blob: finalBlob,
    url: finalUrl,
    width: targetWidth,
    height: targetHeight,
    sizeBytes: finalSize,
    sizeKB: parseFloat((finalSize / 1024).toFixed(1)),
    dpi: embeddedDpi,
    format: 'JPEG',
    qualityUsed: optimized.quality,
    isPadded: optimized.isPadded,
    passesValidation,
    notes: optimized.notes,
    validationDetails,
  };
}

/**
 * Guardrail D: Filename Sanitizer
 * - Sanitize filenames to safe lowercase ASCII letters, digits, underscores and hyphens.
 * - Use the correct extension (.jpg) for actual output MIME type.
 * - Prevent traversal paths and unsafe filename characters.
 */
export function sanitizeFilename(rawName: string): string {
  // Strip paths / traversal
  const basename = rawName.replace(/^.*[\\\/]/, '');

  const cleaned = basename
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '');

  return cleaned || 'document';
}

/**
 * Generate a consistent, sanitized download filename.
 */
export function generateFilename(examSlug: string, slotId: string, sizeKB: number): string {
  const safeExam = sanitizeFilename(examSlug);
  const safeSlot = sanitizeFilename(slotId);
  const safeSize = Math.round(sizeKB);
  return `${safeExam}_${safeSlot}_${safeSize}kb.jpg`;
}

/**
 * Browser download helper with proper cleanup.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const safeName = sanitizeFilename(filename.replace(/\.jpg$/i, '')) + '.jpg';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
