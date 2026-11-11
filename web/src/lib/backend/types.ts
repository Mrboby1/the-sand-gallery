import type { AppUser, Session, Settings, SharedGallery, Snapshot, TableName, TableRow } from '../types'

export type HealthState = 'up' | 'asleep' | 'waking' | 'unreachable'

export interface UploadPart {
  /** Logical role of the file. */
  role: 'original' | 'thumb'
  blob: Blob
  contentType: string
  ext: string
}

export interface Access { allowed: boolean; admin: boolean; email: string | null }
export interface AllowedEmail { email: string; is_admin: boolean; added_at: string }

export interface UploadResult {
  object_key: string
  thumb_key: string | null
}

/**
 * Progress of a big (multipart) upload, kept with the queued job so a cut connection or a closed app resumes
 * from the last finished part instead of starting over.
 */
export interface MultipartState {
  key: string
  uploadId: string
  thumbKey: string | null
  partSize: number
  /** finished parts: part number -> ETag */
  done: Record<number, string>
  thumbDone?: boolean
}
export interface UploadResume {
  state?: MultipartState
  /** called after every finished part (persist it) */
  save: (s: MultipartState | undefined) => void
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
  uploadMedia(itemId: string, parts: UploadPart[], onProgress?: (fraction: number) => void, resume?: UploadResume): Promise<UploadResult>
  /** Cancels an unfinished multipart upload (its parts would otherwise use storage). */
  abortUpload?(state: MultipartState): Promise<void>
  /** Resolves storage keys to displayable URLs. */
  mediaUrls(keys: string[]): Promise<Record<string, string>>
  deleteMediaObjects(keys: string[]): Promise<void>

  // public share pages
  fetchShared(token: string): Promise<SharedGallery | null>

  /** Web Push: register this device; returns the per-device secret used by the notification's Stop button. */
  pushSubscribe(sub: PushSubscriptionJSON, deviceKey: string): Promise<{ deviceId: string; deviceSecret: string }>
  pushUnsubscribe(endpoint: string): Promise<void>
  /** Sends a test notification to all of this user's devices; returns how many accepted it. */
  pushTest(): Promise<number>

  /** Runs the nightly JSON backup right now. */
  backupNow(): Promise<{ ok: boolean; key?: string; counts?: Record<string, number>; reason?: string }>

  // private online version (allow-list, migration 0011); the local backend allows everything
  /** May the signed-in person use this backend? Throws on network errors. */
  access(): Promise<Access>
  /** Owner only: the allow-list. */
  listAllowed(): Promise<AllowedEmail[]>
  addAllowed(email: string): Promise<void>
  removeAllowed(email: string): Promise<void>

  // database wake-up
  health(): Promise<HealthState>
  wake(): Promise<void>
}
