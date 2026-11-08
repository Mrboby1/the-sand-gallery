/**
 * Minimal ZIP support for export/import files.
 *
 * Writer: "stored" entries (no compression: photos and videos are already compressed), built as a list of Blobs so a
 * big gallery does not have to sit in memory as one buffer (the browser can keep Blob data on disk).
 * Reader: parses the central directory and returns each entry as a slice of the original File (no copying); entries
 * compressed with deflate (if someone re-zipped the file) are inflated with DecompressionStream.
 * No ZIP64: one archive is limited to 4 GB.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array, crc = 0xffffffff): number {
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return crc
}

/** CRC-32 of a Blob, read in 4 MB chunks. */
async function blobCrc(blob: Blob): Promise<number> {
  let crc = 0xffffffff
  const CHUNK = 4 * 1024 * 1024
  for (let off = 0; off < blob.size; off += CHUNK) crc = crc32(new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer()), crc)
  return (crc ^ 0xffffffff) >>> 0
}

function dosTime(d: Date): [number, number] {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return [time, date]
}

export const ZIP_LIMIT = 0xffffffff - 1024 * 1024

export class ZipWriter {
  private parts: Blob[] = []
  private central: Uint8Array[] = []
  private offset = 0
  private count = 0
  private readonly enc = new TextEncoder()

  get size() { return this.offset }

  async add(path: string, data: Blob | string) {
    const blob = typeof data === 'string' ? new Blob([data], { type: 'application/json' }) : data
    const name = this.enc.encode(path)
    if (this.offset + blob.size + 200 > ZIP_LIMIT) throw new Error('zip-too-large')
    const crc = await blobCrc(blob)
    const [time, date] = dosTime(new Date())
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true) // version needed
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint16(8, 0, true) // stored
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, blob.size, true)
    local.setUint32(22, blob.size, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true)
    this.parts.push(new Blob([local.buffer, name]), blob)

    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true)
    cen.setUint16(4, 20, true)
    cen.setUint16(6, 20, true)
    cen.setUint16(8, 0x0800, true)
    cen.setUint16(10, 0, true)
    cen.setUint16(12, time, true)
    cen.setUint16(14, date, true)
    cen.setUint32(16, crc, true)
    cen.setUint32(20, blob.size, true)
    cen.setUint32(24, blob.size, true)
    cen.setUint16(28, name.length, true)
    cen.setUint32(42, this.offset, true)
    const entry = new Uint8Array(46 + name.length)
    entry.set(new Uint8Array(cen.buffer), 0)
    entry.set(name, 46)
    this.central.push(entry)
    this.offset += 30 + name.length + blob.size
    this.count++
  }

  finish(type = 'application/zip'): Blob {
    const cdSize = this.central.reduce((n, e) => n + e.length, 0)
    const end = new DataView(new ArrayBuffer(22))
    end.setUint32(0, 0x06054b50, true)
    end.setUint16(8, this.count, true)
    end.setUint16(10, this.count, true)
    end.setUint32(12, cdSize, true)
    end.setUint32(16, this.offset, true)
    return new Blob([...this.parts, ...this.central.map((e) => e.slice().buffer), end.buffer], { type })
  }
}

export interface ZipEntry { name: string; method: number; size: number; compressedSize: number; localOffset: number }

export class ZipReader {
  private constructor(private file: Blob, readonly entries: Map<string, ZipEntry>) {}

  static async open(file: Blob): Promise<ZipReader> {
    const tailLen = Math.min(file.size, 22 + 65535)
    const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer())
    let eocd = -1
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break }
    if (eocd < 0) throw new Error('not-a-zip')
    const total = tail.getUint16(eocd + 10, true)
    const cdSize = tail.getUint32(eocd + 12, true)
    const cdOffset = tail.getUint32(eocd + 16, true)
    const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer())
    const dec = new TextDecoder()
    const entries = new Map<string, ZipEntry>()
    let p = 0
    for (let n = 0; n < total; n++) {
      if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('bad-zip')
      const method = cd.getUint16(p + 10, true)
      const compressedSize = cd.getUint32(p + 20, true)
      const size = cd.getUint32(p + 24, true)
      const nameLen = cd.getUint16(p + 28, true)
      const extraLen = cd.getUint16(p + 30, true)
      const commentLen = cd.getUint16(p + 32, true)
      const localOffset = cd.getUint32(p + 42, true)
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen))
      entries.set(name, { name, method, size, compressedSize, localOffset })
      p += 46 + nameLen + extraLen + commentLen
    }
    return new ZipReader(file, entries)
  }

  has(name: string) { return this.entries.has(name) }

  async blob(name: string, type = ''): Promise<Blob | null> {
    const e = this.entries.get(name)
    if (!e) return null
    const h = new DataView(await this.file.slice(e.localOffset, e.localOffset + 30).arrayBuffer())
    if (h.getUint32(0, true) !== 0x04034b50) throw new Error('bad-zip')
    const start = e.localOffset + 30 + h.getUint16(26, true) + h.getUint16(28, true)
    const raw = this.file.slice(start, start + e.compressedSize, type)
    if (e.method === 0) return raw
    if (e.method === 8 && typeof DecompressionStream !== 'undefined') {
      const out = await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob()
      return type ? new Blob([out], { type }) : out
    }
    throw new Error('unsupported-zip')
  }

  async text(name: string): Promise<string | null> {
    const b = await this.blob(name)
    return b ? b.text() : null
  }
}
