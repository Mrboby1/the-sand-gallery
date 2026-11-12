import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

/**
 * SHA-256 of a photo/video, lowercase hex. Stored with the media row (media.sha256) so other apps (the Sus Gallery
 * phone backup) can skip files that are already here. Runs in a Web Worker (hash.worker.ts), reading the file in
 * slices: a 40-minute video (several GB) is never held in memory and the page stays smooth. Falls back to the main
 * thread (also sliced) where workers are not available.
 */
let worker: Worker | null = null
let seq = 0
const waiting = new Map<number, { resolve: (h: string) => void; reject: (e: Error) => void }>()

function getWorker(): Worker | null {
  if (worker) return worker
  try {
    worker = new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; hex?: string; error?: string }>) => {
      const w = waiting.get(e.data.id)
      if (!w) return
      waiting.delete(e.data.id)
      if (e.data.hex) w.resolve(e.data.hex)
      else w.reject(new Error(e.data.error ?? 'hash failed'))
    }
    worker.onerror = () => { for (const w of waiting.values()) w.reject(new Error('hash worker failed')); waiting.clear(); worker = null }
    return worker
  } catch { return null }
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const w = getWorker()
  if (w) {
    return new Promise((resolve, reject) => {
      const id = ++seq
      waiting.set(id, { resolve, reject })
      w.postMessage({ id, blob })
    })
  }
  const h = sha256.create()
  for (let at = 0; at < blob.size; at += 4 * 1048576) h.update(new Uint8Array(await blob.slice(at, at + 4 * 1048576).arrayBuffer()))
  return bytesToHex(h.digest())
}
