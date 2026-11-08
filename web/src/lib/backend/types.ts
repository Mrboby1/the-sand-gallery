import type { AppUser, Session, Settings, SharedGallery, Snapshot, TableName, TableRow } from '../types'

export type HealthState = 'up' | 'asleep' | 'waking' | 'unreachable'

export interface UploadPart {
  /** Logical role of the file. */
  role: 'original' | 'thumb'
  blob: Blob
  contentType: string
  ext: string
}

export interface UploadResult {
  object_key: string
  thumb_key: string | null
}

/**
 * Everything the UI needs from the outside world. Two implementations:
 *  - LocalBackend: localStorage + IndexedDB, for development and offline demos.
 *  - SupabaseBackend: Supabase (DB + Auth) plus the Cloudflare Worker (B2 media, wake-up, share pages).
 */
export interface Backend {
  readonly mode: 'local' | 'cloud'

  // auth
  getUser(): Promise<AppUser | null>
  onAuthChange(cb: (user: AppUser | null) => void): () => void
  signInWithGoogle(): Promise<void>
  signOut(): Promise<void>

  // data
  loadAll(): Promise<Snapshot>
  insert<T extends TableName>(table: T, rows: TableRow[T][]): Promise<void>
  update<T extends TableName>(table: T, id: string, patch: Partial<TableRow[T]>): Promise<void>
  remove(table: TableName, ids: string[]): Promise<void>
  saveSettings(s: Settings): Promise<void>

  /**
   * Closes any open session and opens a new one for the item. `at` is when it happened (for calls queued
   * offline); null means "now" on the server clock. Idempotent per sessionId.
   */
  startTimer(itemId: string, sessionId: string, at?: string | null): Promise<Session>
  /** Closes the open session, if any, at `at` (null = now). Returns the closed session. */
  stopTimer(at?: string | null): Promise<Session | null>

  /** Called with a short debounce whenever another device changed data. */
  subscribe(onRemoteChange: () => void): () => void

  // media
  uploadMedia(itemId: string, parts: UploadPart[], onProgress?: (fraction: number) => void): Promise<UploadResult>
  /** Resolves storage keys to displayable URLs. */
  mediaUrls(keys: string[]): Promise<Record<string, string>>
  deleteMediaObjects(keys: string[]): Promise<void>

  // public share pages
  fetchShared(token: string): Promise<SharedGallery | null>

  /** Runs the nightly JSON backup right now. */
  backupNow(): Promise<{ ok: boolean; key?: string; counts?: Record<string, number>; reason?: string }>

  // database wake-up
  health(): Promise<HealthState>
  wake(): Promise<void>
}
