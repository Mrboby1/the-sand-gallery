import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

/**
 * SHA-256 of a photo/video, lowercase hex. Stored with the media row (media.sha256) so other apps (the Sus Gallery
 * phone backup) can skip files that are already here. Small files use WebCrypto in one go; big ones are read in
 * 4 MB slices and hashed incrementally, so a long video never sits in memory as a whole and the page stays smooth.
 */
const ONE_SHOT_MAX = 48 * 1048576
const SLICE = 4 * 1048576

export async function sha256Hex(blob: Blob): Promise<string> {
  if (blob.size <= ONE_SHOT_MAX && typeof crypto !== 'undefined' && crypto.subtle) {
    return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())))
  }
  const h = sha256.create()
  for (let at = 0; at < blob.size; at += SLICE) {
    h.update(new Uint8Array(await blob.slice(at, at + SLICE).arrayBuffer()))
  }
  return bytesToHex(h.digest())
}
