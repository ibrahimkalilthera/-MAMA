/**
 * Pure-node tests for the dependency-free stamp optimizer pipeline
 * (scripts/optimize-stamp.mjs): the PNG codec must round-trip losslessly,
 * the area downscale must composite alpha over the background, and the
 * indexed encoder must decode back to the same palette colors.
 *
 * The suite deliberately runs DOM-free (like offline-replay / utils): the
 * pipeline has zero browser or external dependencies by design.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePng,
  encodePng,
  encodePngIndexed,
  downscaleToRgb,
  optimizeRgbToPng,
} from '../scripts/optimize-stamp.mjs';

describe('PNG codec round-trip', () => {
  it('encodePng → decodePng is lossless for an RGB image', () => {
    const w = 5;
    const h = 4;
    const rgb = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      // deterministic gradient incl. values across the full byte range
      rgb[i * 3] = (i * 37) & 255;
      rgb[i * 3 + 1] = (i * 91 + 7) & 255;
      rgb[i * 3 + 2] = (255 - i * 23) & 255;
    }
    const png = encodePng(w, h, rgb);
    const decoded = decodePng(png);
    assert.equal(decoded.width, w);
    assert.equal(decoded.height, h);
    for (let i = 0; i < w * h; i++) {
      assert.equal(decoded.rgba[i * 4], rgb[i * 3], `R@${i}`);
      assert.equal(decoded.rgba[i * 4 + 1], rgb[i * 3 + 1], `G@${i}`);
      assert.equal(decoded.rgba[i * 4 + 2], rgb[i * 3 + 2], `B@${i}`);
      assert.equal(decoded.rgba[i * 4 + 3], 255, `A@${i}`);
    }
  });

  it('encodePngIndexed decodes back to the same palette colors', () => {
    const palette = Buffer.from([255, 0, 0, 0, 0, 255, 255, 255, 255]);
    const indices = Uint8Array.from([0, 1, 2, 0, 1, 2]);
    const png = encodePngIndexed(3, 2, palette, indices);
    const decoded = decodePng(png);
    assert.equal(decoded.width, 3);
    assert.equal(decoded.height, 2);
    for (let p = 0; p < 6; p++) {
      const entry = indices[p] * 3;
      assert.equal(decoded.rgba[p * 4], palette[entry], `R@${p}`);
      assert.equal(decoded.rgba[p * 4 + 1], palette[entry + 1], `G@${p}`);
      assert.equal(decoded.rgba[p * 4 + 2], palette[entry + 2], `B@${p}`);
      assert.equal(decoded.rgba[p * 4 + 3], 255, 'opaque');
    }
  });

  it('decodePng rejects non-PNG / unsupported inputs', () => {
    assert.throws(() => decodePng(Buffer.from('not a png at all!!')), /signature/);
    // 16-bit IHDR (bit depth 16) must be rejected with a clear message
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(4, 0);
    ihdr.writeUInt32BE(4, 4);
    ihdr[8] = 16; // bit depth
    ihdr[9] = 2;
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const chunk = (type: string, data: Buffer): Buffer => {
      const out = Buffer.alloc(12 + data.length);
      out.writeUInt32BE(data.length, 0);
      out.write(type, 4, 'ascii');
      data.copy(out, 8);
      return out; // CRC not validated by the decoder
    };
    const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))]);
    assert.throws(() => decodePng(png), /bit depth/);
  });
});

describe('area downscale', () => {
  it('composites alpha over the white background before averaging', () => {
    // 1×1 RGBA: half-transparent red on white → (255, 127, 127)
    const rgba = Buffer.from([255, 0, 0, 128]);
    const out = downscaleToRgb(rgba, 1, 1, 1, 1);
    assert.equal(out.width, 1);
    assert.equal(out.height, 1);
    assert.equal(out.data[0], 255);
    assert.equal(out.data[1], 127);
    assert.equal(out.data[2], 127);
  });

  it('averages a solid 4×4 image down to the same color', () => {
    const rgba = Buffer.alloc(4 * 4 * 4);
    for (let p = 0; p < 16; p++) {
      rgba[p * 4] = 200;
      rgba[p * 4 + 1] = 40;
      rgba[p * 4 + 2] = 40;
      rgba[p * 4 + 3] = 255;
    }
    const out = downscaleToRgb(rgba, 4, 4, 2, 2);
    assert.equal(out.width, 2);
    assert.equal(out.height, 2);
    assert.equal(out.data[0], 200);
    assert.equal(out.data[1], 40);
    assert.equal(out.data[2], 40);
    assert.equal(out.data[3], 200); // same solid color at every output pixel
  });
});

describe('optimizeRgbToPng', () => {
  it('always returns a decodable PNG that preserves a solid source color', () => {
    const w = 8;
    const h = 8;
    const rgb = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      rgb[i * 3] = 200;
      rgb[i * 3 + 1] = 45;
      rgb[i * 3 + 2] = 60;
    }
    const { png, mode } = optimizeRgbToPng(w, h, rgb);
    assert.ok(mode === 'truecolor' || mode === 'indexed');
    const decoded = decodePng(png);
    assert.equal(decoded.width, w);
    assert.equal(decoded.height, h);
    assert.equal(decoded.rgba[0], 200);
    assert.equal(decoded.rgba[1], 45);
    assert.equal(decoded.rgba[2], 60);
    assert.equal(decoded.rgba[3], 255);
  });

  it('chooses the indexed encoding on the real-size flat content (many near-white shades)', () => {
    // Simulates a 300 px stamp: mostly pure white with a few thousand
    // near-white noise shades — exactly where palette quantization wins.
    const size = 300;
    const rgb = Buffer.alloc(size * size * 3);
    for (let i = 0; i < size * size; i++) {
      const shade = 250 + ((i * 7) % 6); // 250..255 near-white
      rgb[i * 3] = shade;
      rgb[i * 3 + 1] = shade;
      rgb[i * 3 + 2] = shade;
      if (i % 97 === 0) {
        rgb[i * 3] = 200; // sparse red speckle
        rgb[i * 3 + 1] = 30;
        rgb[i * 3 + 2] = 40;
      }
    }
    const { png, mode, colors } = optimizeRgbToPng(size, size, rgb);
    assert.equal(mode, 'indexed', 'palette encoding must beat truecolor here');
    assert.ok(colors <= 256, `palette stays within the PNG limit (got ${colors})`);
    const decoded = decodePng(png);
    assert.equal(decoded.width, size);
    assert.equal(decoded.height, size);
  });
});
