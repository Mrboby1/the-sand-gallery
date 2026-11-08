import { ZipReader, ZipWriter } from './zip'
import type { Backend, UploadPart } from './backend/types'
import type { Item, Media, Snapshot, TableName, TableRow } from './types'

/**
 * "Export everything" / "Import" files (.sandgallery): a ZIP with
 *   manifest.json  format, version, where it came from (origin + key), counts, list of media files
 *   data.json      all rows (items, notes, statuses, sessions, media, costs, templates, share links, settings)
 *   media/...      the original photos/videos and their thumbnails
 *   README.txt     what this file is
 *
 * The origin key matters: a file exported from the OFFLINE version is never uploaded to the cloud. The online
 * version opens such a file as the offline version on that device instead (see SettingsPage DataSection).
 */
export const FORMAT = 'sand-gallery-export'
export const FORMAT_VERSION = 1
export const FILE_EXT = '.sandgallery'

export type Origin = 'offline' | 'cloud'

export interface Manifest {
  format: typeof FORMAT
  version: number
  /** Where the data lived. "offline" files never go to the cloud. */
  origin: Origin
  /** "offline:<device id>" or "cloud:<user id>". */
  key: string
  app: 'the-sand-gallery'
  app_version: string
  exported_at: string
  account: string | null
  counts: Record<string, number>
  files: { key: string; path: string; size: number; type: string }[]
  /** Media that could not be read while exporting. */
  missing: string[]
}

export interface Progress { step: 'data' | 'media' | 'pack' | 'rows' | 'upload' | 'done'; done: number; total: number }

const TABLES: TableName[] = ['statuses', 'templates', 'items', 'media', 'notes', 'sessions', 'cost_lines', 'share_links']

/** A random id for this browser/device (part of the offline origin key). */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('sg.deviceId')
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('sg.deviceId', id) }
    return id
  } catch { return 'unknown' }
}

const pathOf = (key: string) => 'media/' + key.replace(/^sand-gallery\//, '').replace(/[^\w./-]/g, '_')

export async function exportAll(
  b: Backend,
  who: { origin: Origin; userId: string; account: string | null },
  onProgress: (p: Progress) => void,
): Promise<{ blob: Blob; manifest: Manifest; name: string }> {
  onProgress({ step: 'data', done: 0, total: 1 })
  const snap = await b.loadAll()
  const keys = [...new Set(snap.media.flatMap((m) => [m.object_key, m.thumb_key]).filter((k): k is string => !!k))]
  const zip = new ZipWriter()
  const files: Manifest['files'] = []
  const missing: string[] = []
  let done = 0
  onProgress({ step: 'media', done, total: keys.length })
  for (let i = 0; i < keys.length; i += 40) {
    const chunk = keys.slice(i, i + 40)
    const urls = await b.mediaUrls(chunk)
    for (const k of chunk) {
      try {
        if (!urls[k]) throw new Error('no url')
        const res = await fetch(urls[k])
        if (!res.ok) throw new Error(String(res.status))
        const blob = await res.blob()
        const path = pathOf(k)
        await zip.add(path, blob)
        files.push({ key: k, path, size: blob.size, type: blob.type })
      } catch (e) {
        if (e instanceof Error && e.message === 'zip-too-large') throw e
        missing.push(k)
      }
      onProgress({ step: 'media', done: ++done, total: keys.length })
    }
  }
  onProgress({ step: 'pack', done: 0, total: 1 })
  const exported_at = new Date().toISOString()
  const manifest: Manifest = {
    format: FORMAT,
    version: FORMAT_VERSION,
    origin: who.origin,
    key: who.origin === 'offline' ? `offline:${deviceId()}` : `cloud:${who.userId}`,
    app: 'the-sand-gallery',
    app_version: __APP_VERSION__,
    exported_at,
    account: who.account,
    counts: Object.fromEntries(TABLES.map((t) => [t, (snap[t] as unknown[]).length])),
    files,
    missing,
  }
  await zip.add('data.json', JSON.stringify(snap))
  await zip.add('manifest.json', JSON.stringify(manifest, null, 2))
  await zip.add('README.txt', [
    'The Sand Gallery - export',
    '',
    `Exported ${exported_at} from the ${who.origin === 'offline' ? 'OFFLINE version (data that lived only on one device)' : 'online version'}.`,
    'Open The Sand Gallery > Settings > Your data > Import to bring it back.',
    who.origin === 'offline' ? 'Files from the offline version are never uploaded to the cloud; they open as the offline version.' : '',
    '',
    'data.json holds all projects, notes, times and costs; media/ holds the original photos and videos.',
  ].join('\n'))
  onProgress({ step: 'done', done: 1, total: 1 })
  const d = new Date(), pad = (n: number) => String(n).padStart(2, '0')
  const name = `sand-gallery-${who.origin}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}${FILE_EXT}`
  return { blob: zip.finish('application/zip'), manifest, name }
}

/** Saves a Blob as a file download. */
export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export interface Archive { manifest: Manifest; data: Snapshot; zip: ZipReader }

export class ImportError extends Error {}

export async function readArchive(file: Blob): Promise<Archive> {
  let zip: ZipReader
  try { zip = await ZipReader.open(file) } catch { throw new ImportError('not-export') }
  const m = await zip.text('manifest.json').catch(() => null)
  const d = await zip.text('data.json').catch(() => null)
  if (!m || !d) throw new ImportError('not-export')
  let manifest: Manifest, data: Snapshot
  try { manifest = JSON.parse(m) as Manifest; data = JSON.parse(d) as Snapshot } catch { throw new ImportError('not-export') }
  if (manifest.format !== FORMAT) throw new ImportError('not-export')
  if (typeof manifest.version !== 'number' || manifest.version > FORMAT_VERSION) throw new ImportError('newer-version')
  // the key decides: anything that is not clearly a cloud file is treated as offline (never uploaded)
  if (!(manifest.origin === 'cloud' && String(manifest.key).startsWith('cloud:'))) manifest.origin = 'offline'
  for (const t of TABLES) if (!Array.isArray(data[t])) (data as unknown as Record<string, unknown[]>)[t] = []
  return { manifest, data, zip }
}

export interface ImportResult { added: Record<string, number>; skipped: number; missingMedia: number }

const EXT_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', avif: 'image/avif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4' }
const extOf = (key: string) => (key.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin'

function noOwner<T extends object>(row: T): T {
  const c = { ...row } as Record<string, unknown>
  delete c.owner_id
  return c as T
}

/**
 * Adds everything from the archive to `target` (merge): rows that already exist (same id) are skipped, statuses are
 * matched by name, photos/videos are stored again through the target backend (local device storage, or the cloud for
 * a cloud file being restored). Settings are taken over only when the target is empty.
 */
export async function importInto(target: Backend, arc: Archive, onProgress: (p: Progress) => void): Promise<ImportResult> {
  const { data, manifest, zip } = arc
  onProgress({ step: 'rows', done: 0, total: 1 })
  const have = await target.loadAll()
  const added: Record<string, number> = {}
  let skipped = 0
  const exists = (t: TableName) => new Set((have[t] as { id: string }[]).map((r) => r.id))
  const insert = async <T extends TableName>(t: T, rows: TableRow[T][]) => {
    for (let i = 0; i < rows.length; i += 200) await target.insert(t, rows.slice(i, i + 200).map(noOwner))
    added[t] = (added[t] ?? 0) + rows.length
  }
  const wasEmpty = have.items.length === 0

  // statuses: reuse one with the same name
  const statusMap = new Map<string, string>()
  const byName = new Map(have.statuses.map((s) => [s.name.trim().toLowerCase(), s.id]))
  const haveStatus = exists('statuses')
  const newStatuses = []
  let order = have.statuses.length
  for (const s of data.statuses) {
    const same = byName.get(s.name.trim().toLowerCase())
    if (same) { statusMap.set(s.id, same); continue }
    if (haveStatus.has(s.id)) { statusMap.set(s.id, s.id); continue }
    statusMap.set(s.id, s.id)
    newStatuses.push({ ...s, sort_order: order++ })
  }
  await insert('statuses', newStatuses)

  const haveTpl = exists('templates')
  await insert('templates', data.templates.filter((x) => !haveTpl.has(x.id) || (skipped++, false)))

  // items, parents first (depth by depth), covers set after the media exist
  const haveItems = exists('items')
  const itemIds = new Set([...haveItems, ...data.items.map((i) => i.id)])
  const todo = data.items.filter((i) => !haveItems.has(i.id) || (skipped++, false))
  const depthOf = new Map<string, number>()
  const byId = new Map(data.items.map((i) => [i.id, i]))
  const depth = (i: Item, guard = 0): number => {
    if (depthOf.has(i.id)) return depthOf.get(i.id)!
    const p = i.parent_id ? byId.get(i.parent_id) : undefined
    const d = p && guard < 50 ? depth(p, guard + 1) + 1 : 0
    depthOf.set(i.id, d)
    return d
  }
  const levels: Item[][] = []
  for (const i of todo) (levels[depth(i)] ??= []).push(i)
  const covers: { id: string; cover: string }[] = []
  for (const level of levels) {
    if (!level) continue
    await insert('items', level.map((i) => {
      if (i.cover_media_id) covers.push({ id: i.id, cover: i.cover_media_id })
      return {
        ...i,
        parent_id: i.parent_id && itemIds.has(i.parent_id) ? i.parent_id : null,
        status_id: i.status_id ? statusMap.get(i.status_id) ?? null : null,
        cover_media_id: null,
      }
    }))
  }

  // media: store the files again through the target backend
  const haveMedia = exists('media')
  const files = new Map(manifest.files.map((f) => [f.key, f]))
  const mediaTodo = data.media.filter((m) => (!haveMedia.has(m.id) && itemIds.has(m.item_id)) || (skipped++, false))
  let missingMedia = 0
  const newMedia: Media[] = []
  for (let n = 0; n < mediaTodo.length; n++) {
    const m = mediaTodo[n]
    onProgress({ step: 'upload', done: n, total: mediaTodo.length })
    const f = files.get(m.object_key)
    const blob = f ? await zip.blob(f.path, f.type || m.mime || EXT_TYPES[extOf(m.object_key)] || '') : null
    if (!blob) { missingMedia++; continue }
    const parts: UploadPart[] = [{ role: 'original', blob, contentType: blob.type || m.mime || EXT_TYPES[extOf(m.object_key)] || (m.kind === 'video' ? 'video/mp4' : 'image/jpeg'), ext: extOf(m.object_key) }]
    const tf = m.thumb_key ? files.get(m.thumb_key) : undefined
    const thumb = tf ? await zip.blob(tf.path, tf.type || EXT_TYPES[extOf(tf.key)] || 'image/jpeg') : null
    if (thumb && m.thumb_key) parts.push({ role: 'thumb', blob: thumb, contentType: thumb.type || 'image/jpeg', ext: extOf(m.thumb_key) })
    const r = await target.uploadMedia(m.item_id, parts)
    const row = { ...m, object_key: r.object_key, thumb_key: r.thumb_key }
    await target.insert('media', [noOwner(row)])
    newMedia.push(row)
  }
  added.media = newMedia.length
  onProgress({ step: 'upload', done: mediaTodo.length, total: mediaTodo.length })

  const mediaIds = new Set([...haveMedia, ...newMedia.map((m) => m.id)])
  for (const c of covers) if (mediaIds.has(c.cover)) await target.update('items', c.id, { cover_media_id: c.cover })

  onProgress({ step: 'rows', done: 0, total: 1 })
  const keep = <T extends { id: string; item_id: string }>(t: TableName, rows: T[]) => {
    const h = exists(t)
    return rows.filter((r) => (!h.has(r.id) && itemIds.has(r.item_id)) || (skipped++, false))
  }
  await insert('notes', keep('notes', data.notes ?? []))
  // a timer that was running when the file was made stops at the moment of the export
  await insert('sessions', keep('sessions', data.sessions).map((s) => (s.ended_at ? s : { ...s, ended_at: manifest.exported_at > s.started_at ? manifest.exported_at : s.started_at })))
  await insert('cost_lines', keep('cost_lines', data.cost_lines))
  // share links are not imported: they are public links of the place the data came from

  if (wasEmpty && data.settings) await target.saveSettings({ ...have.settings, ...noOwner(data.settings), owner_id: have.settings.owner_id })
  onProgress({ step: 'done', done: 1, total: 1 })
  return { added, skipped, missingMedia }
}
