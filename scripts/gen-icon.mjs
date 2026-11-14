// Generates resources/tray.png (32x32) and resources/icon.png (256x256).
// Pure Node: minimal PNG encoder + supersampled vector drawing.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crc])
}

function encodePng(size, rgba) {
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

function inCircle(x, y, cx, cy, r) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

function shade(t) {
  // vertical gradient #a855ff -> #7726e0
  const from = [168, 85, 255]
  const to = [110, 38, 210]
  return from.map((v, i) => Math.round(v + (to[i] - v) * t))
}

function sample(x, y) {
  if (!inRoundRect(x, y, 0.01, 0.01, 0.99, 0.99, 0.24)) return null
  const bubble =
    inRoundRect(x, y, 0.16, 0.2, 0.84, 0.6, 0.09) ||
    inTriangle(x, y, 0.28, 0.56, 0.46, 0.56, 0.3, 0.78)
  if (bubble) {
    const dot = [0.33, 0.5, 0.67].some((cx) => inCircle(x, y, cx, 0.4, 0.058))
    return dot ? [110, 38, 210] : [255, 255, 255]
  }
  return shade(y)
}

function render(size) {
  const out = Buffer.alloc(size * size * 4)
  const ss = 4
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0
      let g = 0
      let b = 0
      let hits = 0
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const x = (px + (sx + 0.5) / ss) / size
          const y = (py + (sy + 0.5) / ss) / size
          const color = sample(x, y)
          if (color) {
            r += color[0]
            g += color[1]
            b += color[2]
            hits += 1
          }
        }
      }
      const total = ss * ss
      const offset = (py * size + px) * 4
      if (hits === 0) {
        out[offset] = 0
        out[offset + 1] = 0
        out[offset + 2] = 0
        out[offset + 3] = 0
      } else {
        out[offset] = Math.round(r / hits)
        out[offset + 1] = Math.round(g / hits)
        out[offset + 2] = Math.round(b / hits)
        out[offset + 3] = Math.round((hits / total) * 255)
      }
    }
  }
  return encodePng(size, out)
}

const dir = join(process.cwd(), 'resources')
mkdirSync(dir, { recursive: true })
for (const [name, size] of [
  ['tray.png', 32],
  ['icon.png', 256]
]) {
  const file = join(dir, name)
  writeFileSync(file, render(size))
  mkdirSync(dirname(file), { recursive: true })
  console.log('wrote', file)
}
