import type { Item, Media } from './types'
import { toast } from '../store/app'
import { t } from '../i18n'

/**
 * Downloads and "save to phone".
 * - downloadMedia: the original of a photo/video under its file name. In the online version the Worker link gets
 *   ?dl=1&name=, so the Worker answers with Content-Disposition: attachment and the file streams to disk (no copy in
 *   memory, fine for big videos). In the offline version the link is a local blob: URL.
 * - saveCameraPhoto: right after "Take photo", a copy of the same file (no network read) goes to the device. On
 *   Android Chrome that lands in Downloads/, which Google Photos / Files show by themselves.
 */

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp' }

function slug(s: string) {
  return s.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sand-gallery'
}

/** The name to save a photo/video under: its original file name, else "<project>-<n>.<ext>". */
export function downloadName(m: Media, item: Item, index: number): string {
  if (m.file_name) return m.file_name
  const ext = EXT[m.mime] ?? (m.object_key.split('.').pop() ?? 'jpg')
  return `${slug(item.title)}-${index + 1}.${ext}`
}

function clickDownload(href: string, name: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function downloadMedia(url: string, name: string) {
  if (url.startsWith('blob:') || url.startsWith('data:')) { clickDownload(url, name); return }
  const u = new URL(url)
  u.searchParams.set('dl', '1')
  u.searchParams.set('name', name)
  clickDownload(u.toString(), name)
}

/** Saves a Blob/File as a download (same data, no network). */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  clickDownload(url, name)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** The share sheet with the file where the browser supports it (Android: "Save to device", Photos...), else a download. */
export async function shareOrSave(file: File) {
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return // the person closed the share sheet
  }
  saveBlob(file, file.name)
}

// ---------------------------------------------------------------- "Save camera photos to phone" (per device, default on)
const PREF = 'sg.saveCamera'
export function saveCameraEnabled(): boolean {
  try { return localStorage.getItem(PREF) !== '0' } catch { return true }
}
export function setSaveCamera(on: boolean) {
  try { localStorage.setItem(PREF, on ? '1' : '0') } catch { /* ignore */ }
}

// "Save recorded videos to phone" (per device, default OFF): videos recorded in the app go to the Sand Gallery only,
// so they are not stored twice (once here, once by the phone's photo backup).
const VPREF = 'sg.saveVideo'
export function saveVideoEnabled(): boolean {
  try { return localStorage.getItem(VPREF) === '1' } catch { return false }
}
export function setSaveVideo(on: boolean) {
  try { localStorage.setItem(VPREF, on ? '1' : '0') } catch { /* ignore */ }
}
/** After recording a video in the app: a copy on the phone only when that setting is on. */
export function saveRecordedVideo(file: File) {
  if (!saveVideoEnabled()) return
  try { saveBlob(file, file.name) } catch { /* the toast below still offers it */ }
  toast(t('camera.videoSaved'), 'info', { label: t('camera.saveAgain'), run: () => void shareOrSave(file) }, 7000)
}

/** A clear name for a photo just taken: SandGallery_20261110_143205.jpg */
export function cameraFile(file: File): File {
  const d = new Date(), p = (n: number) => String(n).padStart(2, '0')
  const ext = EXT[file.type] ?? (file.name.split('.').pop() || 'jpg')
  const name = `SandGallery_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`
  return new File([file], name, { type: file.type || 'image/jpeg', lastModified: file.lastModified })
}

/**
 * After "Take photo": keep a copy on the phone. A download right away (the camera result arrives without a fresh tap,
 * and a browser may refuse that silently), so the toast offers to save it again with a tap (share sheet / download).
 */
export function saveCameraPhoto(file: File) {
  if (!saveCameraEnabled()) return
  try { saveBlob(file, file.name) } catch { /* the toast below still offers it */ }
  toast(t('camera.saved'), 'info', { label: t('camera.saveAgain'), run: () => void shareOrSave(file) }, 7000)
}
