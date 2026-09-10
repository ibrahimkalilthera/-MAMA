// ─────────────────────────────────────────────────────────────────────────────
// scripts/generate-app-icon.mjs — rebuild build/icon.png from a source photo.
//
//   node scripts/generate-app-icon.mjs [image] [size]
//
// Defaults: image = build/icon-source.jpg (the "COMPLEXE SCOLAIRE MAMA THERA"
// emblem photo), size = 512. The source has a pure-white background; the
// emblem circle is extracted with a flood-fill from the corners (white →
// transparent), so the app icon shows the round emblem on any taskbar color.
// Output: build/icon.png — the file electron-builder turns into the .ico.
// ─────────────────────────────────────────────────────────────────────────────
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';

const [src = 'build/icon-source.jpg', sizeArg = '512'] = process.argv.slice(2);
const size = Number.parseInt(sizeArg, 10);

// Flood-fill the background connected to the image corners.
//  - source is a JPEG with a flat white background (tolerance absorbs JPEG
//    compression noise without reaching the navy band / white text)
//  - the white text/stars/figures are enclosed by navy, so they are never
//    connected to the corners and always survive
function maskEmblem(img) {
  const w = img.width;
  const h = img.height;
  const srcCtx = createCanvas(w, h).getContext('2d');
  srcCtx.drawImage(img, 0, 0);
  const { data } = srcCtx.getImageData(0, 0, w, h);

  const TOL = 48; // per-channel distance from the corner color (pure white)
  const bg = [data[0], data[1], data[2]];
  const alpha = new Uint8ClampedArray(w * h).fill(255);
  const seen = new Uint8Array(w * h);
  const stack = [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
  ];
  const inBg = (x, y) => {
    const i = (y * w + x) * 4;
    return (
      Math.abs(data[i] - bg[0]) <= TOL &&
      Math.abs(data[i + 1] - bg[1]) <= TOL &&
      Math.abs(data[i + 2] - bg[2]) <= TOL
    );
  };
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = y * w + x;
    if (seen[i]) continue;
    seen[i] = 1;
    if (!inBg(x, y)) continue;
    alpha[i] = 0;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  // Feather the boundary (1 px) so the downscale edge stays clean.
  const feathered = Uint8ClampedArray.from(alpha);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (alpha[i] !== 0) continue;
      const neighbours = [
        [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1],
      ];
      for (const [nx, ny] of neighbours) {
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && alpha[ny * w + nx] === 255) {
          feathered[i] = 90;
        }
      }
    }
  }

  const out = createCanvas(w, h);
  const octx = out.getContext('2d');
  const outImg = octx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    outImg.data[i * 4] = data[i * 4];
    outImg.data[i * 4 + 1] = data[i * 4 + 1];
    outImg.data[i * 4 + 2] = data[i * 4 + 2];
    outImg.data[i * 4 + 3] = feathered[i];
  }
  octx.putImageData(outImg, 0, 0);
  return out;
}

const img = await loadImage(src);
console.log(`source ${src}: ${img.width}×${img.height} → ${size}×${size}`);

const masked = maskEmblem(img);
const canvas = createCanvas(size, size);
const ctx = canvas.getContext('2d');
ctx.drawImage(masked, 0, 0, size, size);

const png = canvas.toBuffer('image/png');
writeFileSync('build/icon.png', png);
console.log(`✅ build/icon.png (${png.length} octets)`);