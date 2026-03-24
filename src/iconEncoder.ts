import { deflateSync } from "zlib"

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, "ascii")
  const body = Buffer.concat([t, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

export function encodePNG(width: number, height: number, rgba: Uint8Array): string {
  const rowLen = width * 4
  const filtered = Buffer.alloc(height * (1 + rowLen))
  for (let y = 0; y < height; y++) {
    filtered[y * (1 + rowLen)] = 0 // filter: None
    for (let x = 0; x < rowLen; x++) {
      filtered[y * (1 + rowLen) + 1 + x] = rgba[y * rowLen + x]
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA

  return (
    "data:image/png;base64," +
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(filtered)), pngChunk("IEND", Buffer.alloc(0))]).toString(
      "base64"
    )
  )
}
