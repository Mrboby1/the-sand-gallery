// Domain types. Field names match the Postgres columns (snake_case) so rows pass through unchanged.

export type UUID = string
export type ISODate = string // timestamptz as ISO string
export type SummaryPeriod = 'day' | 'week' | 'month' | 'all'

export interface Status {
  id: UUID
  owner_id?: UUID
  name: string
  color: string
  sort_order: number
  /** Items with this status switch to the pure gallery view. */
  is_finished?: boolean
  created_at?: ISODate
}

export interface Item {
  id: UUID
  owner_id?: UUID
  parent_id: UUID | null
  title: string
  notes: string
  status_id: UUID | null
  tags: string[]
  due_date: string | null // YYYY-MM-DD
  cover_media_id: UUID | null
  sort_order: number
  created_at: ISODate
  updated_at: ISODate
  /** Set (by the database) when the item gets a finished status. */
  finished_at?: ISODate | null
  /** 'folder' groups projects and folders (no status/timer/costs); missing or 'item' = project/subtask. */
  kind?: 'item' | 'folder'
}

/** One note of an item (an item can have many; newest first, pinned ones on top). */
export interface Note {
  id: UUID
  owner_id?: UUID
  item_id: UUID
  body: string
  pinned: boolean
  created_at: ISODate
  updated_at: ISODate
}

export interface Session {
  id: UUID
  owner_id?: UUID
  item_id: UUID
  started_at: ISODate
  ended_at: ISODate | null
  note?: string | null
}

export type MediaKind = 'photo' | 'video'
export type MediaPhase = 'process' | 'finished'

export interface Media {
  id: UUID
  owner_id?: UUID
  item_id: UUID
  object_key: string
  thumb_key: string | null
  kind: MediaKind
  mime: string
  size_bytes: number
  width: number | null
  height: number | null
  duration_s: number | null
  phase: MediaPhase
  /** Note / caption for this photo or video. */
  note?: string | null
  /** Original file name (used when it is downloaded). */
  file_name?: string | null
  created_at: ISODate
}

export interface CostLine {
  id: UUID
  owner_id?: UUID
  item_id: UUID
  label: string
  qty: number
  unit_cost: number
  created_at: ISODate
}

export interface TemplateNode {
  title: string
  tags?: string[]
  children?: TemplateNode[]
}

export interface Template {
  id: UUID
  owner_id?: UUID
  name: string
  /** Title given to the new item; defaults to the template name. */
  item_title: string
  tags: string[]
  tree: TemplateNode[]
  created_at: ISODate
}

export interface ShareLink {
  id: UUID
  owner_id?: UUID
  item_id: UUID
  token: string
  created_at: ISODate
  revoked_at: ISODate | null
}

export interface Settings {
  owner_id?: UUID
  hourly_rate: number
  currency: string
  markup_pct: number
  week_starts_on: number // 0 = Sunday, 1 = Monday
  due_dates_enabled: boolean
  /** Timer notification + reminders (all devices). */
  notify_enabled: boolean
  /** Legacy (whole hours); kept for older app versions. */
  reminder_hours: number
  /** "Still working?" reminder every N minutes while a timer runs (from 15); 0 = off. */
  reminder_minutes: number
  /** Colour hues 0-360 chosen in Settings > Appearance; null = original colours. */
  hg_hue: number | null
  sand_hue: number | null
  bg_hue: number | null
  /** Colour of the frozen (paused) hourglass; null = icy blue. */
  freeze_hue: number | null
  /** Brightness of each colour, -50..50 (null/0 = normal). */
  hg_light?: number | null
  sand_light?: number | null
  bg_light?: number | null
  freeze_light?: number | null
  /** Period of the "time worked" summary (home header, Time log). */
  summary_period: SummaryPeriod
  updated_at?: ISODate
}

/** Daily review: "How did the day go", one per (local) date. */
export interface DayNote {
  id: UUID
  owner_id?: UUID
  /** YYYY-MM-DD, local date */
  day: string
  body: string
  created_at: ISODate
  updated_at: ISODate
}

export interface Snapshot {
  items: Item[]
  notes: Note[]
  day_notes: DayNote[]
  statuses: Status[]
  sessions: Session[]
  media: Media[]
  cost_lines: CostLine[]
  templates: Template[]
  share_links: ShareLink[]
  settings: Settings
}

export type TableName = 'items' | 'notes' | 'statuses' | 'sessions' | 'media' | 'cost_lines' | 'templates' | 'share_links' | 'day_notes'

export interface TableRow {
  items: Item
  notes: Note
  day_notes: DayNote
  statuses: Status
  sessions: Session
  media: Media
  cost_lines: CostLine
  templates: Template
  share_links: ShareLink
}

export interface AppUser {
  id: UUID
  email: string | null
  name: string | null
  avatar_url: string | null
}

/** Public, read-only gallery returned for a share link. */
export interface SharedGallery {
  root_id: UUID
  items: Pick<Item, 'id' | 'parent_id' | 'title' | 'status_id' | 'cover_media_id' | 'sort_order' | 'kind'>[]
  statuses: Pick<Status, 'id' | 'name' | 'color'>[]
  media: (Pick<Media, 'id' | 'item_id' | 'kind' | 'width' | 'height' | 'phase' | 'created_at' | 'note'> & { url: string; thumb_url: string | null })[]
}

export const DEFAULT_SETTINGS: Settings = {
  hourly_rate: 0,
  currency: 'ILS',
  markup_pct: 0,
  week_starts_on: 0,
  due_dates_enabled: false,
  notify_enabled: true,
  reminder_hours: 2,
  reminder_minutes: 120,
  hg_hue: null,
  sand_hue: null,
  bg_hue: null,
  freeze_hue: null,
  summary_period: 'week',
}

export const DEFAULT_STATUSES: Pick<Status, 'name' | 'color' | 'is_finished'>[] = [
  { name: 'Idea', color: '#9b87c9', is_finished: false },
  { name: 'In progress', color: '#d9903d', is_finished: false },
  { name: 'On hold', color: '#8f9aa6', is_finished: false },
  { name: 'Done', color: '#5f9e6e', is_finished: true },
  { name: 'Sold', color: '#c0564a', is_finished: true },
]
