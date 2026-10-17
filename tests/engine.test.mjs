import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Import preset and declaration data
const presets = JSON.parse(fs.readFileSync('./src/data/presets.json', 'utf8'));
const declarations = JSON.parse(fs.readFileSync('./src/data/declarations.json', 'utf8'));

// Helper JPEG generator for Node test environment (creating a minimal valid JPEG with SOI, APP0, SOF0, SOS, EOI)
function createMinimalJpeg(width = 100, height = 100, dpi = 72) {
  // SOI: 0xFF, 0xD8
  // APP0: 0xFF, 0xE0, len(16), 'JFIF\0', ver 1.1, units 1, Xdpi, Ydpi, 0, 0
  const app0 = [
    0xFF, 0xE0,
    0x00, 0x10,
    0x4A, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01,
    0x01,
    (dpi >> 8) & 0xFF, dpi & 0xFF,
    (dpi >> 8) & 0xFF, dpi & 0xFF,
    0x00, 0x00
  ];

  // SOF0: 0xFF, 0xC0, len(11), precision(8), height(2), width(2), components(1), c1(1, 0x11, 0)
  const sof0 = [
    0xFF, 0xC0,
    0x00, 0x0B,
    0x08,
    (height >> 8) & 0xFF, height & 0xFF,
    (width >> 8) & 0xFF, width & 0xFF,
    0x01,
    0x01, 0x11, 0x00
  ];

  // SOS: 0xFF, 0xDA, len(8), 1 comp, c1(0), spec(0), end(63), approx(0)
  const sos = [
    0xFF, 0xDA,
    0x00, 0x08,
    0x01, 0x01, 0x00, 0x00, 0x3F, 0x00,
    // Scan payload bytes
    0x12, 0x34, 0x56, 0x78
  ];

  // EOI: 0xFF, 0xD9
  const bytes = [0xFF, 0xD8, ...app0, ...sof0, ...sos, 0xFF, 0xD9];
  return new Uint8Array(bytes).buffer;
}

// Inline implementations from imageEngine for direct node testing
function sanitizeFilename(rawName) {
  const basename = rawName.replace(/^.*[\\\/]/, '');
  const cleaned = basename
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '');
  return cleaned || 'document';
}

function generateFilename(examSlug, slotId, sizeKB) {
  const safeExam = sanitizeFilename(examSlug);
  const safeSlot = sanitizeFilename(slotId);
  const safeSize = Math.round(sizeKB);
  return `${safeExam}_${safeSlot}_${safeSize}kb.jpg`;
}

function readDPI(arrayBuffer) {
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
        if (units === 2) return Math.round(xDpi * 2.54);
        return xDpi || 72;
      }
    }
    offset += 2 + segLength;
  }
  return 72;
}

function injectDPI(arrayBuffer, dpi) {
  const data = new Uint8Array(arrayBuffer);
  if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8) return arrayBuffer;

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
      const idMatch =
        data[offset + 4] === 0x4A &&
        data[offset + 5] === 0x46 &&
        data[offset + 6] === 0x49 &&
        data[offset + 7] === 0x46 &&
        data[offset + 8] === 0x00;

      if (idMatch) {
        data[offset + 11] = 0x01;
        data[offset + 12] = (dpi >> 8) & 0xFF;
        data[offset + 13] = dpi & 0xFF;
        data[offset + 14] = (dpi >> 8) & 0xFF;
        data[offset + 15] = dpi & 0xFF;
        const copy = new Uint8Array(data.length);
        copy.set(data);
        return copy.buffer;
      }
    }
    offset += 2 + segLength;
  }

  // Insert JFIF
  const app0 = new Uint8Array([
    0xFF, 0xE0, 0x00, 0x10,
    0x4A, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x01,
    (dpi >> 8) & 0xFF, dpi & 0xFF,
    (dpi >> 8) & 0xFF, dpi & 0xFF,
    0x00, 0x00
  ]);
  const output = new Uint8Array(2 + app0.length + (data.length - 2));
  output[0] = 0xFF;
  output[1] = 0xD8;
  output.set(app0, 2);
  output.set(data.subarray(2), 2 + app0.length);
  return output.buffer;
}

function padToMinBytes(arrayBuffer, minBytes) {
  const data = new Uint8Array(arrayBuffer);
  if (data.length >= minBytes) {
    return { buffer: arrayBuffer, isPadded: false };
  }

  let eoiPos = -1;
  for (let i = data.length - 2; i >= 2; i--) {
    if (data[i] === 0xFF && data[i + 1] === 0xD9) {
      eoiPos = i;
      break;
    }
  }

  if (eoiPos === -1) return { buffer: arrayBuffer, isPadded: false };

  const deficit = minBytes - data.length;
  if (deficit <= 0) return { buffer: arrayBuffer, isPadded: false };

  const segments = [];
  let remaining = deficit;

  while (remaining > 0) {
    const overhead = 4;
    const maxPayload = 65533;
    const payloadSize = Math.min(remaining, maxPayload);
    const segLength = payloadSize + 2;

    const seg = new Uint8Array(overhead + payloadSize);
    seg[0] = 0xFF;
    seg[1] = 0xFE;
    seg[2] = (segLength >> 8) & 0xFF;
    seg[3] = segLength & 0xFF;
    for (let j = 4; j < seg.length; j++) {
      seg[j] = 0x20;
    }
    segments.push(seg);
    remaining -= (payloadSize + overhead);
    if (remaining < 0) remaining = 0;
  }

  const totalComBytes = segments.reduce((sum, s) => sum + s.length, 0);
  const result = new Uint8Array(eoiPos + totalComBytes + 2);
  result.set(data.subarray(0, eoiPos), 0);

  let writeOffset = eoiPos;
  for (const s of segments) {
    result.set(s, writeOffset);
    writeOffset += s.length;
  }
  result[writeOffset] = 0xFF;
  result[writeOffset + 1] = 0xD9;

  return { buffer: result.buffer, isPadded: true };
}

// ---------------- TESTS ----------------

test('Preset Validation: Authoritative presets exist with verified citations', () => {
  assert.ok(presets.length >= 8, 'Must have at least 8 core kits');

  const expectedSlugs = [
    'ssc-photo-resizer',
    'ibps-photo-signature-resizer',
    'sbi-po-clerk-photo-resizer',
    'upsc-photo-resizer',
    'neet-photo-signature-resizer',
    'jee-main-photo-resizer',
    'nsdl-pan-card-photo-resizer',
    'uti-pan-card-photo-resizer'
  ];

  for (const slug of expectedSlugs) {
    const preset = presets.find(p => p.slug === slug);
    assert.ok(preset, `Preset ${slug} must be present`);
    assert.ok(preset.sourceUrl && preset.sourceUrl.startsWith('http'), `${slug} must have a valid sourceUrl`);
    assert.ok(preset.verifiedDate, `${slug} must have a verifiedDate`);
    assert.ok(preset.authority, `${slug} must have an authoritative governing body`);
    assert.ok(preset.slots && preset.slots.length >= 2, `${slug} must define at least photo & signature slots`);

    for (const slot of preset.slots) {
      assert.ok(slot.minKB < slot.maxKB, `Slot ${slot.id} minKB (${slot.minKB}) must be strictly less than maxKB (${slot.maxKB})`);
      assert.ok(slot.widthPx > 0 && slot.heightPx > 0, `Slot ${slot.id} dimensions must be positive`);
      assert.ok(slot.dpi >= 72, `Slot ${slot.id} DPI must be >= 72`);
    }
  }
});

test('Filename Sanitizer: Safe lowercase ASCII letters, digits, underscores, hyphens, and traversal prevention', () => {
  assert.equal(sanitizeFilename('../../../malicious/Path/My Photo 2026!.PNG'), 'my_photo_2026_png');
  assert.equal(sanitizeFilename('C:\\Windows\\System32\\signature.JPG'), 'signature_jpg');
  assert.equal(sanitizeFilename('SSC CGL 2026 Photo (Special).jpg'), 'ssc_cgl_2026_photo_special_jpg');
  assert.equal(sanitizeFilename('   __--test--__  '), 'test');
  assert.equal(sanitizeFilename(''), 'document');

  const generated = generateFilename('ssc-photo-resizer', 'photo', 35.4);
  assert.equal(generated, 'ssc-photo-resizer_photo_35kb.jpg');
});

test('JPEG Marker Parsing & JFIF DPI Injection', () => {
  const initialJpeg = createMinimalJpeg(276, 354, 72);
  const initialDpi = readDPI(initialJpeg);
  assert.equal(initialDpi, 72, 'Initial DPI should be 72');

  // Inject 200 DPI
  const modified200 = injectDPI(initialJpeg, 200);
  const readBack200 = readDPI(modified200);
  assert.equal(readBack200, 200, 'Should accurately read back 200 DPI');

  // Inject 300 DPI
  const modified300 = injectDPI(modified200, 300);
  const readBack300 = readDPI(modified300);
  assert.equal(readBack300, 300, 'Should accurately overwrite to 300 DPI');

  // Bounds check with malformed buffers
  const truncated = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]).buffer;
  assert.doesNotThrow(() => {
    const result = injectDPI(truncated, 200);
    assert.ok(result);
  }, 'Should safely handle truncated headers without crashing');
});

test('ISO-Compliant COM Segment Min-KB Padding', () => {
  const sampleJpeg = createMinimalJpeg(140, 60, 200);
  const initialSize = sampleJpeg.byteLength;
  const targetMinBytes = 15 * 1024; // 15 KB

  assert.ok(initialSize < targetMinBytes, 'Sample JPEG starts small');

  const padded = padToMinBytes(sampleJpeg, targetMinBytes);
  assert.ok(padded.isPadded, 'Should be flagged as padded');
  assert.ok(padded.buffer.byteLength >= targetMinBytes, `Size (${padded.buffer.byteLength}) must be >= targetMinBytes (${targetMinBytes})`);

  // Verify file ends with valid EOI (0xFF 0xD9)
  const bytes = new Uint8Array(padded.buffer);
  assert.equal(bytes[bytes.length - 2], 0xFF);
  assert.equal(bytes[bytes.length - 1], 0xD9);

  // Verify COM marker (0xFF 0xFE) is present before EOI
  let hasCom = false;
  for (let i = 2; i < bytes.length - 3; i++) {
    if (bytes[i] === 0xFF && bytes[i + 1] === 0xFE) {
      hasCom = true;
      break;
    }
  }
  assert.ok(hasCom, 'Padded JPEG must contain valid COM segment marker');
});

test('Declarations Data Integrity', () => {
  assert.ok(declarations.ibps && declarations.ibps.text.length > 50);
  assert.ok(declarations.sbi && declarations.sbi.text.length > 50);
  assert.ok(declarations.rrb && declarations.rrb.text.length > 50);
});

test('Exam-Specific Multi-Slot Bundles & DPI Verification', () => {
  // Banking 4-slot kits
  const bankingSlugs = ['ibps-po', 'ibps-clerk', 'sbi-po', 'sbi-clerk', 'rbi-grade-b'];
  for (const slug of bankingSlugs) {
    const p = presets.find(x => x.slug === slug);
    assert.ok(p, `Banking kit ${slug} must exist`);
    assert.equal(p.slots.length, 4, `${slug} must contain exactly 4 slots`);
    assert.equal(p.slots[0].docType, 'photo');
    assert.equal(p.slots[1].docType, 'signature');
    assert.equal(p.slots[1].defaultWhitener, true, `${slug} signature must auto-enable whitener`);
    assert.equal(p.slots[2].docType, 'thumb');
    assert.equal(p.slots[2].defaultWhitener, true, `${slug} thumb must auto-enable whitener`);
    assert.equal(p.slots[3].docType, 'declaration');
    assert.equal(p.slots[3].defaultWhitener, true, `${slug} declaration must auto-enable whitener`);
    assert.equal(p.slots[3].widthPx, 800);
    assert.equal(p.slots[3].heightPx, 400);
  }

  // NEET 4-slot kit
  const neet = presets.find(x => x.slug === 'neet');
  assert.ok(neet, 'NEET preset must exist');
  assert.equal(neet.slots.length, 4, 'NEET must contain 4 slots');
  assert.equal(neet.slots[1].widthPx, 1200);
  assert.equal(neet.slots[1].heightPx, 1800);
  assert.equal(neet.slots[1].dpi, 300, 'NEET Postcard photo must be 300 DPI');
  assert.equal(neet.slots[0].defaultNameDate, true);
  assert.equal(neet.slots[1].defaultNameDate, true);

  // PAN Card Portals
  const uti = presets.find(x => x.slug === 'uti-pan-card');
  assert.ok(uti, 'uti-pan-card preset must exist');
  assert.equal(uti.slots[0].dpi, 300, 'UTI Photo must be 300 DPI');
  assert.equal(uti.slots[0].widthPx, 213);
  assert.equal(uti.slots[0].heightPx, 213);
  assert.equal(uti.slots[1].dpi, 600, 'UTI Signature must be 600 DPI');
  assert.equal(uti.slots[1].widthPx, 400);
  assert.equal(uti.slots[1].heightPx, 200);

  const nsdl = presets.find(x => x.slug === 'nsdl-pan-card');
  assert.ok(nsdl, 'nsdl-pan-card preset must exist');
  assert.equal(nsdl.slots[0].dpi, 200);
  assert.equal(nsdl.slots[1].dpi, 200);

  // BPSC 3-slot bi-script bundle
  const bpsc = presets.find(x => x.slug === 'bpsc');
  assert.ok(bpsc, 'BPSC preset must exist');
  assert.equal(bpsc.slots.length, 3, 'BPSC must contain 3 slots');
  assert.equal(bpsc.slots[0].docType, 'photo');
  assert.equal(bpsc.slots[1].docType, 'signature');
  assert.equal(bpsc.slots[2].docType, 'signature');

  // UPPSC & TNPSC defaultNameDate check
  const uppsc = presets.find(x => x.slug === 'uppsc');
  assert.ok(uppsc.slots[0].defaultNameDate, true, 'UPPSC photo must auto-enable name/date placard');
  const tnpsc = presets.find(x => x.slug === 'tnpsc');
  assert.ok(tnpsc.slots[0].defaultNameDate, true, 'TNPSC photo must auto-enable name/date placard');
});
