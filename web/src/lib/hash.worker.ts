/// <reference lib="webworker" />
// SHA-256 of a (possibly multi-GB) file off the main thread, read in 8 MB slices so it never sits in memory whole.
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

const SLICE = 8 * 1048576

self.onmessage = async (e: MessageEvent<{ id: number; blob: Blob }>) => {
  const { id, blob } = e.data
  try {
    let hex: string
    if (blob.size <= 48 * 1048576 && crypto?.subtle) {
      hex = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())))
    } else {
      const h = sha256.create()
      for (let at = 0; at < blob.size; at += SLICE) h.update(new Uint8Array(await blob.slice(at, at + SLICE).arrayBuffer()))
      hex = bytesToHex(h.digest())
    }
    self.postMessage({ id, hex })
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) })
  }
}
