/**
 * Dependency-free stamp asset optimizer — pure Node, zero packages.
 *
 * Regenerates the optimised `public/tampon.png` from an original stamp
 * capture (typically the 1254 px / ~1.4 MB PNG) WITHOUT any external image
 * library: this script ships its own minimal PNG codec (chunk parse, scanline
 * de-filter, zlib inflate), an area-average downscale and a PNG encoder
 * (per-row filter selection + zlib deflate + CRC32). No sharp / canvas /
 * ImageMagick required — `node scripts/optimize-stamp.mjs` is all it takes.
 *
 * The math behind the default 300 px target: the stamp is drawn in a 20 mm
 * "cachet" box (24 mm on the widest bordereaux), so 300 px ≈ 380 dpi at
 * 20 mm — comfortably above the 300 dpi print standard while the embedded
 * raster in every generated PDF drops from ~4.6 MB to ~90 KB.
 *
 * Usage:
 *   node scripts/optimize-stamp.mjs <source.png> [--out <file>] [--size 300]
 *
 * Without `--out` the script only reports what the optimised file WOULD weigh
 * (and validates the round-trip) — pass `--out` to write it.
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
const MAX_PIXELS = 100_000_000 // zip-bomb guard (1254² ≈ 1.6M, cap is generous)

// ── PNG decode ───────────────────────────────────────────────────────────────

/**
 * Minimal PNG decoder (8-bit, non-interlaced; RGB/RGBA/gray/gray+alpha).
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number, rgba: Uint8Array }}
 */
export function decodePng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Not a PNG file (bad signature)')
  }
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  let plte = null
  let trns = null
  const idat = []
  let seenIhdr = false

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (offset + 8 + length + 4 > buffer.length) throw new Error('Truncated PNG chunk')
    if (type === 'IHDR') {
      seenIhdr = true
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'PLTE') {
      plte = data
    } else if (type === 'tRNS') {
      trns = data
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  if (!seenIhdr) throw new Error('PNG has no IHDR chunk')
  if (bitDepth !== 8) throw new Error(`Unsupported bit depth ${bitDepth} (only 8-bit)`)
  if (interlace !== 0) throw new Error('Interlaced PNGs are not supported')
  if (colorType === 3 && !plte) throw new Error('Palette PNG without PLTE chunk')
  const channels = CHANNELS_BY_COLOR_TYPE[colorType]
  if (channels === undefined) throw new Error(`Unsupported color type ${colorType}`)
  if (width * height > MAX_PIXELS) throw new Error(`Image too large (${width}×${height})`)

  const inflated = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const expected = height * (stride + 1)
  if (inflated.length < expected) throw new Error('Corrupt IDAT stream (too short)')

  // Undo per-scanline filters.
  const raw = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    const filter = inflated[rowStart]
    const target = raw.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? raw.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const byte = inflated[rowStart + 1 + i]
      const left = i >= channels ? target[i - channels] : 0
      const up = prev ? prev[i] : 0
      const ul = prev && i >= channels ? prev[i - channels] : 0
      let value = byte
      if (filter === 1) value = byte + left
      else if (filter === 2) value = byte + up
      else if (filter === 3) value = byte + ((left + up) >> 1)
      else if (filter === 4) {
        const p = left + up - ul
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - ul)
        value = byte + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul)
      } else if (filter !== 0) {
        throw new Error(`Unknown scanline filter ${filter}`)
      }
      target[i] = value & 0xff
    }
  }

  // Normalise to RGBA.
  const rgba = Buffer.alloc(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    const s = p * channels
    const d = p * 4
    if (colorType === 3) {
      const idx = raw[s]
      rgba[d] = plte[idx * 3]
      rgba[d + 1] = plte[idx * 3 + 1]
      rgba[d + 2] = plte[idx * 3 + 2]
      rgba[d + 3] = trns && idx < trns.length ? trns[idx] : 255
    } else if (colorType === 2) {
      rgba[d] = raw[s]
      rgba[d + 1] = raw[s + 1]
      rgba[d + 2] = raw[s + 2]
      rgba[d + 3] = 255
    } else if (colorType === 6) {
      rgba[d] = raw[s]
      rgba[d + 1] = raw[s + 1]
      rgba[d + 2] = raw[s + 2]
      rgba[d + 3] = raw[s + 3]
    } else if (colorType === 0) {
      rgba[d] = raw[s]
      rgba[d + 1] = raw[s]
      rgba[d + 2] = raw[s]
      rgba[d + 3] = 255
    } else {
      rgba[d] = raw[s]
      rgba[d + 1] = raw[s]
      rgba[d + 2] = raw[s]
      rgba[d + 3] = raw[s + 1]
    }
  }
  return { width, height, rgba }
}

// ── Downscale (area average, composited on a background) ─────────────────────

/**
 * Area-average downscale with optional alpha compositing onto a background.
 * @param {Uint8Array} rgba
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} dstW
 * @param {number} dstH
 * @param {[number, number, number]} background RGB for alpha compositing
 * @returns {{ width: number, height: number, data: Uint8Array }} RGB rows
 */
export function downscaleToRgb(rgba, srcW, srcH, dstW, dstH, background = [255, 255, 255]) {
  if (dstW > srcW || dstH > srcH) throw new Error('Downscale only (target must be ≤ source)')
  const out = Buffer.alloc(dstW * dstH * 3)
  const [bgR, bgG, bgB] = background

  for (let oy = 0; oy < dstH; oy++) {
    const y0 = Math.floor((oy * srcH) / dstH)
    const y1 = Math.max(y0 + 1, Math.min(srcH, Math.floor(((oy + 1) * srcH) / dstH)))
    for (let ox = 0; ox < dstW; ox++) {
      const x0 = Math.floor((ox * srcW) / dstW)
      const x1 = Math.max(x0 + 1, Math.min(srcW, Math.floor(((ox + 1) * srcW) / dstW)))
      let r = 0
      let g = 0
      let b = 0
      let count = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const s = (sy * srcW + sx) * 4
          const a = rgba[s + 3] / 255
          // Composite over the background before averaging (kills fringes).
          r += rgba[s] * a + bgR * (1 - a)
          g += rgba[s + 1] * a + bgG * (1 - a)
          b += rgba[s + 2] * a + bgB * (1 - a)
          count++
        }
      }
      const d = (oy * dstW + ox) * 3
      out[d] = Math.round(r / count)
      out[d + 1] = Math.round(g / count)
      out[d + 2] = Math.round(b / count)
    }
  }
  return { width: dstW, height: dstH, data: out }
}

// ── PNG encode ───────────────────────────────────────────────────────────────

let CRC_TABLE = null

function crc32(buf, start = 0, end = buf.length) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  let crc = -1
  for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out, 4, 8 + data.length), 8 + data.length)
  return out
}

/** Sum of |signed byte| — lower means the row should compress better. */
function filterScore(filteredRow) {
  let score = 0
  for (let i = 0; i < filteredRow.length; i++) {
    const v = filteredRow[i]
    score += Math.abs(v < 128 ? v : v - 256)
  }
  return score
}

function filterRow(filter, row, prevRow, bpp) {
  const out = Buffer.alloc(row.length)
  for (let i = 0; i < row.length; i++) {
    const left = i >= bpp ? row[i - bpp] : 0
    const up = prevRow ? prevRow[i] : 0
    const ul = prevRow && i >= bpp ? prevRow[i - bpp] : 0
    let value = row[i]
    if (filter === 1) value = row[i] - left
    else if (filter === 2) value = row[i] - up
    else if (filter === 3) value = row[i] - ((left + up) >> 1)
    else if (filter === 4) {
      const p = left + up - ul
      const pa = Math.abs(p - left)
      const pb = Math.abs(p - up)
      const pc = Math.abs(p - ul)
      value = row[i] - (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul)
    }
    out[i] = value & 0xff
  }
  return out
}

/**
 * Encode 8-bit RGB rows into a PNG buffer (best per-row filter + zlib 9).
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgb
 * @returns {Buffer}
 */
export function encodePng(width, height, rgb) {
  const bpp = 3
  const stride = width * bpp
  if (rgb.length < stride * height) throw new Error('RGB buffer too short for the given size')

  const scanlines = []
  for (let y = 0; y < height; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? rgb.subarray((y - 1) * stride, y * stride) : null
    let best = 0
    let bestScore = Infinity
    for (let f = 0; f <= 4; f++) {
      const candidate = filterRow(f, row, prev, bpp)
      const score = filterScore(candidate)
      if (score < bestScore) {
        bestScore = score
        best = f
      }
    }
    scanlines.push(Buffer.from([best]))
    scanlines.push(filterRow(best, row, prev, bpp))
  }

  const idat = zlib.deflateSync(Buffer.concat(scanlines), { level: 9 })

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))])
}

// ── Palette quantization (median cut) + indexed encode ───────────────────────

function colorKey(r, g, b) {
  return (r << 16) | (g << 8) | b
}

/**
 * Median-cut quantizer: reduces an RGB image to ≤ maxColors colours.
 * @param {Uint8Array} rgb
 * @param {number} pixelCount
 * @param {number} maxColors
 * @returns {{ palette: Buffer, indices: Uint8Array, colors: number }}
 */
function quantizeRgb(rgb, pixelCount, maxColors) {
  const hist = new Map()
  for (let i = 0; i < pixelCount * 3; i += 3) {
    const key = colorKey(rgb[i], rgb[i + 1], rgb[i + 2])
    hist.set(key, (hist.get(key) ?? 0) + 1)
  }

  // Median cut over boxes of (key, count).
  let boxes = [
    [...hist.entries()].map(([key, count]) => ({
      r: (key >> 16) & 255,
      g: (key >> 8) & 255,
      b: key & 255,
      count,
    })),
  ]
  while (boxes.length < maxColors && boxes.some((b) => b.length > 1)) {
    // Split the box with the widest population-weighted channel range.
    let target = -1
    let bestScore = -1
    let bestChannel = 0
    for (let i = 0; i < boxes.length; i++) {
      const colors = boxes[i]
      let total = 0
      let minR = 255
      let maxR = 0
      let minG = 255
      let maxG = 0
      let minB = 255
      let maxB = 0
      for (const c of colors) {
        total += c.count
        if (c.r < minR) minR = c.r
        if (c.r > maxR) maxR = c.r
        if (c.g < minG) minG = c.g
        if (c.g > maxG) maxG = c.g
        if (c.b < minB) minB = c.b
        if (c.b > maxB) maxB = c.b
      }
      const ranges = [maxR - minR, maxG - minG, maxB - minB]
      let channel = 0
      if (ranges[1] > ranges[channel]) channel = 1
      if (ranges[2] > ranges[channel]) channel = 2
      const score = ranges[channel] * total
      if (score > bestScore) {
        bestScore = score
        target = i
        bestChannel = channel
      }
    }
    if (target === -1) break
    const colors = boxes[target]
    const value = (c) => (bestChannel === 0 ? c.r : bestChannel === 1 ? c.g : c.b)
    colors.sort((a, b) => value(a) - value(b))
    let half = 0
    for (const c of colors) half += c.count
    half /= 2
    let acc = 0
    let splitAt = 1
    for (let i = 0; i < colors.length; i++) {
      acc += colors[i].count
      if (acc >= half && i > 0) {
        splitAt = i + 1
        break
      }
    }
    boxes = [...boxes.slice(0, target), colors.slice(0, splitAt), colors.slice(splitAt), ...boxes.slice(target + 1)]
  }

  // Average each box into a palette entry.
  const palette = Buffer.alloc(boxes.length * 3)
  for (let i = 0; i < boxes.length; i++) {
    let r = 0
    let g = 0
    let b = 0
    let total = 0
    for (const c of boxes[i]) {
      r += c.r * c.count
      g += c.g * c.count
      b += c.b * c.count
      total += c.count
    }
    palette[i * 3] = Math.round(r / total)
    palette[i * 3 + 1] = Math.round(g / total)
    palette[i * 3 + 2] = Math.round(b / total)
  }

  // Remap every pixel to its nearest palette entry.
  const indices = new Uint8Array(pixelCount)
  for (let p = 0; p < pixelCount; p++) {
    const r = rgb[p * 3]
    const g = rgb[p * 3 + 1]
    const b = rgb[p * 3 + 2]
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < boxes.length; i++) {
      const dr = r - palette[i * 3]
      const dg = g - palette[i * 3 + 1]
      const db = b - palette[i * 3 + 2]
      const dist = dr * dr + dg * dg + db * db
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    }
    indices[p] = best
  }

  return { palette, indices, colors: boxes.length }
}

/**
 * Encode 8-bit indexed (palette) PNG rows.
 * @param {number} width
 * @param {number} height
 * @param {Buffer} palette RGB triples (≤ 256 entries)
 * @param {Uint8Array} indices per-pixel palette index
 * @returns {Buffer}
 */
export function encodePngIndexed(width, height, palette, indices) {
  const bpp = 1
  const stride = width * bpp
  const scanlines = []
  for (let y = 0; y < height; y++) {
    const row = indices.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? indices.subarray((y - 1) * stride, y * stride) : null
    let best = 0
    let bestScore = Infinity
    for (let f = 0; f <= 4; f++) {
      const candidate = filterRow(f, row, prev, bpp)
      const score = filterScore(candidate)
      if (score < bestScore) {
        bestScore = score
        best = f
      }
    }
    scanlines.push(Buffer.from([best]))
    scanlines.push(filterRow(best, row, prev, bpp))
  }
  const idat = zlib.deflateSync(Buffer.concat(scanlines), { level: 9 })

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 3 // color type: palette
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('PLTE', palette), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))])
}

/**
 * Optimise an RGB image to a PNG, picking the smallest valid encoding
 * (indexed ≤ 256 colours when it wins, truecolor otherwise).
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgb
 * @returns {{ png: Buffer, mode: string, colors: number }}
 */
export function optimizeRgbToPng(width, height, rgb) {
  const pixelCount = width * height
  const truePng = encodePng(width, height, rgb)
  const { palette, indices, colors } = quantizeRgb(rgb, pixelCount, 256)
  const indexedPng = encodePngIndexed(width, height, palette, indices)
  if (indexedPng.length < truePng.length) {
    return { png: indexedPng, mode: 'indexed', colors }
  }
  return { png: truePng, mode: 'truecolor', colors }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { source: null, out: null, size: 300 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') {
      args.out = argv[++i]
      continue
    }
    if (a === '--size') {
      args.size = Number.parseInt(argv[++i], 10)
      continue
    }
    if (a.startsWith('--out=')) {
      args.out = a.slice(6)
      continue
    }
    if (a.startsWith('--size=')) {
      args.size = Number.parseInt(a.slice(7), 10)
      continue
    }
    if (!args.source) args.source = a
  }
  if (!Number.isFinite(args.size) || args.size < 16) throw new Error('--size must be an integer ≥ 16')
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.source) {
    console.error('Usage: node scripts/optimize-stamp.mjs <source.png> [--out <file>] [--size 300]')
    process.exit(1)
  }
  const source = fs.readFileSync(args.source)
  const { width, height, rgba } = decodePng(source)
  console.log(`source: ${width}×${height}, ${(source.length / 1024).toFixed(1)} KB`)

  if (Math.max(width, height) <= args.size) {
    console.log(`source is already ≤ ${args.size}px — re-encode with --out to still normalise it`)
    return
  }

  const scaled = downscaleToRgb(rgba, width, height, args.size, args.size)
  const { png, mode, colors } = optimizeRgbToPng(scaled.width, scaled.height, scaled.data)
  const reduction = Math.max(0, Math.round((1 - png.length / source.length) * 100))
  console.log(`output: ${scaled.width}×${scaled.height}, ${(png.length / 1024).toFixed(1)} KB (${reduction}% smaller, ${mode}${mode === 'indexed' ? `, ${colors} colors` : ''})`)

  // self-check round-trip: the written file must decode to the same size
  const check = decodePng(png)
  if (check.width !== scaled.width || check.height !== scaled.height) {
    throw new Error('round-trip verification failed')
  }

  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
    fs.writeFileSync(args.out, png)
    console.log(`wrote ${args.out}`)
  } else {
    console.log('(dry run — pass --out <file> to write)')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main()
}
