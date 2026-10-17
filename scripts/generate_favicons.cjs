const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 32 32" fill="none">
  <!-- Solid Black Circle -->
  <circle cx="16" cy="16" r="14.5" fill="#000000"/>
  
  <!-- Upload Tray -->
  <path d="M22 19.5v2a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 10 21.5v-2" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  
  <!-- Upload Arrow -->
  <polyline points="19.5 12.5 16 9 12.5 12.5" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="16" y1="9" x2="16" y2="19" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Green Privacy Status Dot -->
  <circle cx="24" cy="8" r="3.5" fill="#1ea64a" stroke="#000000" stroke-width="1.5"/>
</svg>`;

async function run() {
  const publicDir = path.resolve(__dirname, '../public');

  fs.writeFileSync(path.join(publicDir, 'favicon.svg'), svg);
  console.log('✓ Wrote public/favicon.svg');

  const png16 = await sharp(Buffer.from(svg)).resize(16, 16).png().toBuffer();
  const png32 = await sharp(Buffer.from(svg)).resize(32, 32).png().toBuffer();
  const png48 = await sharp(Buffer.from(svg)).resize(48, 48).png().toBuffer();
  const png192 = await sharp(Buffer.from(svg)).resize(192, 192).png().toBuffer();
  const png512 = await sharp(Buffer.from(svg)).resize(512, 512).png().toBuffer();

  fs.writeFileSync(path.join(publicDir, 'favicon.png'), png192);
  fs.writeFileSync(path.join(publicDir, 'favicon-32x32.png'), png32);
  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), png192);
  console.log('✓ Wrote PNG icons: favicon.png, favicon-32x32.png, apple-touch-icon.png');

  // Build standard multi-resolution Windows ICO (16x16, 32x32, 48x48)
  const images = [
    { size: 16, buffer: png16 },
    { size: 32, buffer: png32 },
    { size: 48, buffer: png48 }
  ];

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(images.length, 4); // count

  let offset = 6 + images.length * 16;
  const entries = [];
  const buffers = [];

  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.size, 0); // width
    entry.writeUInt8(img.size, 1); // height
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(img.buffer.length, 8); // size
    entry.writeUInt32LE(offset, 12); // offset

    entries.push(entry);
    buffers.push(img.buffer);
    offset += img.buffer.length;
  }

  const icoBuffer = Buffer.concat([header, ...entries, ...buffers]);
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), icoBuffer);
  console.log('✓ Wrote public/favicon.ico (' + icoBuffer.length + ' bytes, header: ' + icoBuffer.slice(0, 4).toString('hex') + ')');
}

run().catch(console.error);
