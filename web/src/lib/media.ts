import type { UploadPart } from './backend/types'
import type { MediaKind } from './types'

const THUMB_MAX = 720

function extOf(file: File): string {
  const fromName = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  if (fromName && fromName.length <= 5) return fromName
  return (file.type.split('/')[1] || 'bin').replace('jpeg', 'jpg').replace('quicktime', 'mov')
}

function canvasToBlob(c: HTMLCanvasElement): Promise<{ blob: Blob; ext: string; type: string }> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => {
      if (!b) return reject(new Error('thumbnail failed'))
      if (b.type === 'image/webp') resolve({ blob: b, ext: 'webp', type: 'image/webp' })
      else c.toBlob((j) => (j ? resolve({ blob: j, ext: 'jpg', type: 'image/jpeg' }) : reject(new Error('thumbnail failed'))), 'image/jpeg', 0.84)
    }, 'image/webp', 0.82)
  })
}

function drawScaled(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const scale = Math.min(1, THUMB_MAX / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * scale))
  c.height = Math.max(1, Math.round(h * scale))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return c
}

async function photoThumb(file: File) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const c = drawScaled(bmp, bmp.width, bmp.height)
  const out = { ...(await canvasToBlob(c)), width: bmp.width, height: bmp.height }
  bmp.close()
  return out
}

function videoThumb(file: File): Promise<{ blob: Blob; ext: string; type: string; width: number; height: number; duration: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.src = url
    const done = (r: Awaited<ReturnType<typeof videoThumb>>) => { clearTimeout(timer); URL.revokeObjectURL(url); resolve(r) }
    const timer = setTimeout(() => done(null), 15000)
    v.onerror = () => done(null)
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, (v.duration || 2) / 3)
    }
    v.onseeked = async () => {
      try {
        const c = drawScaled(v, v.videoWidth, v.videoHeight)
        const b = await canvasToBlob(c)
        done({ ...b, width: v.videoWidth, height: v.videoHeight, duration: v.duration })
      } catch {
        done(null)
      }
    }
  })
}

export interface PreparedUpload {
  kind: MediaKind
  parts: UploadPart[]
  width: number | null
  height: number | null
  duration: number | null
}

/** Builds the original + a small thumbnail (photos: resized; videos: a poster frame). */
export async function makeUploadParts(file: File): Promise<PreparedUpload> {
  const kind: MediaKind = file.type.startsWith('video/') ? 'video' : 'photo'
  const original: UploadPart = { role: 'original', blob: file, contentType: file.type || 'application/octet-stream', ext: extOf(file) }
  if (kind === 'photo') {
    try {
      const th = await photoThumb(file)
      return { kind, width: th.width, height: th.height, duration: null, parts: [original, { role: 'thumb', blob: th.blob, contentType: th.type, ext: th.ext }] }
    } catch {
      return { kind, width: null, height: null, duration: null, parts: [original] }
    }
  }
  const th = await videoThumb(file)
  return {
    kind,
    width: th?.width ?? null,
    height: th?.height ?? null,
    duration: th?.duration ?? null,
    parts: th ? [original, { role: 'thumb', blob: th.blob, contentType: th.type, ext: th.ext }] : [original],
  }
}
