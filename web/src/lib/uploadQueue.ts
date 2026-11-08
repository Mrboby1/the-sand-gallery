// Persisted queue of photo/video uploads (IndexedDB), so files picked offline survive closing the app
// and upload automatically when the connection returns.
import type { MediaKind } from './types'

export interface UploadJob {
  id: string // becomes the media row id
  uid: string // owner (user id)
  itemId: string
  name: string
  mime: string
  size: number
  kind: MediaKind
  ext: string
  thumbType: string | null
  thumbExt: string | null
  width: number | null
  height: number | null
  duration: number | null
  created_at: string
  original: Blob
  thumb: Blob | null
  /** Set once the files are in storage, so a retry only has to save the row. */
  object_key?: string
  thumb_key?: string | null
}

const DB = 'sg-upload-queue'
const STORE = 'jobs'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then((db) => new Promise<T | undefined>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    t.oncomplete = () => { resolve(req ? (req as IDBRequest<T>).result : undefined); db.close() }
    t.onerror = () => { reject(t.error); db.close() }
    t.onabort = () => { reject(t.error); db.close() }
  }))
}

export const putJob = (job: UploadJob) => tx('readwrite', (s) => s.put(job)).then(() => undefined)
export const deleteJob = (id: string) => tx('readwrite', (s) => s.delete(id)).then(() => undefined).catch(() => undefined)
export const allJobs = async (): Promise<UploadJob[]> => ((await tx<UploadJob[]>('readonly', (s) => s.getAll() as IDBRequest<UploadJob[]>).catch(() => [])) ?? [])
  .sort((a, b) => a.created_at.localeCompare(b.created_at))

/** Free bytes the browser is likely to let us store, or null when unknown. */
export async function freeBytes(): Promise<number | null> {
  try {
    const est = await navigator.storage?.estimate?.()
    if (!est?.quota) return null
    return Math.max(0, est.quota - (est.usage ?? 0))
  } catch { return null }
}

let persistAsked = false
/** Ask the browser not to evict our storage (installed PWAs usually get it). */
export function askPersist() {
  if (persistAsked) return
  persistAsked = true
  void navigator.storage?.persist?.().catch(() => false)
}

export const mb = (n: number) => `${Math.max(0.1, Math.round((n / 1048576) * 10) / 10)} MB`
