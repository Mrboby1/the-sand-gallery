import { Link } from 'react-router-dom'
import { CalendarDays, Film, Layers } from 'lucide-react'
import type { Item, Media, Status } from '../lib/types'
import { useMediaUrl } from '../lib/hooks'
import { fmtDuration } from '../lib/time'
import { HourglassGlyph } from './Hourglass'
import { StatusPill } from './StatusPill'
import { cx } from './ui'
import { useStyle } from '../lib/theme'
import { tn } from '../i18n'

export function Thumb({ media, className, alt = '' }: { media: Media | null; className?: string; alt?: string }) {
  const url = useMediaUrl(media ? media.thumb_key ?? (media.kind === 'photo' ? media.object_key : null) : null)
  if (!media) return <div className={cx('sand-texture', className)} />
  if (!url) return <div className={cx('animate-pulse bg-surface-2', className)} />
  return <img src={url} alt={alt} loading="lazy" decoding="async" draggable={false} className={cx('object-cover', className)} />
}

export function fmtDue(d: string) {
  const date = new Date(d + 'T00:00:00')
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

type TileProps = Parameters<typeof GlossyItemTile>[0]

/** Gallery tile: flat (photo + caption below) by default, or the glossy overlay style. */
export function ItemTile(props: TileProps) {
  const style = useStyle()
  return style === 'glossy' ? <GlossyItemTile {...props} /> : <FlatItemTile {...props} />
}

function FlatItemTile({
  item, status, cover, total, running, ticking, kids, mediaCount, size = 'm', showDue,
}: {
  item: Item; status?: Status | null; cover: Media | null; total: number; running: boolean; ticking: boolean
  kids: number; mediaCount: number; size?: 's' | 'm' | 'l'; showDue: boolean
}) {
  const overdue = item.due_date && new Date(item.due_date + 'T23:59:59') < new Date()
  return (
    <Link
      to={`/i/${item.id}`}
      className="group rise relative block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <div className={cx('relative overflow-hidden rounded-2xl bg-surface-2', size === 's' ? 'aspect-square rounded-xl' : 'aspect-square')}>
        <Thumb media={cover} alt={item.title} className="absolute inset-0 h-full w-full transition duration-300 group-hover:opacity-90" />
        {!cover && (
          <div className="absolute inset-0 flex items-center justify-center text-muted/60">
            <Layers size={size === 's' ? 24 : 34} strokeWidth={1.5} />
          </div>
        )}
        {cover?.kind === 'video' && (
          <span className="absolute right-2 top-2 rounded-full bg-[#2a2017]/70 p-1.5 text-white"><Film size={13} /></span>
        )}
        {status && size !== 's' && <StatusPill status={status} size="xs" className="absolute left-2 top-2" />}
        {size === 's' && status && <span className="absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface" style={{ background: status.color }} />}
        {running && <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-white dark:text-[#1d1813]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />{fmtDuration(total)}</span>}
      </div>
      <div className={cx('px-0.5', size === 's' ? 'pt-1.5' : 'pt-2.5')}>
        <div className={cx('font-medium leading-snug text-ink', size === 's' ? 'line-clamp-1 text-[12px]' : size === 'm' ? 'line-clamp-2 text-[15px]' : 'line-clamp-2 text-[17px]')}>
          {item.title}
        </div>
        {size !== 's' && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px] text-muted">
            {(total > 0 || ticking) && (
              <span className={cx('inline-flex items-center gap-1 tabular', ticking && 'font-medium text-accent-strong')}>
                <HourglassGlyph size={9} running={ticking} />
                {fmtDuration(total)}
              </span>
            )}
            {kids > 0 && <span>{tn('item.subitems', kids)}</span>}
            {showDue && item.due_date && (
              <span className={cx('inline-flex items-center gap-1', overdue && 'text-danger')}>
                <CalendarDays size={12} /> {fmtDue(item.due_date)}
              </span>
            )}
            {kids === 0 && mediaCount > 0 && size === 'l' && <span>{tn('item.media', mediaCount)}</span>}
          </div>
        )}
      </div>
    </Link>
  )
}

function GlossyItemTile({
  item, status, cover, total, running, ticking, kids, mediaCount, size = 'm', showDue,
}: {
  item: Item; status?: Status | null; cover: Media | null; total: number; running: boolean; ticking: boolean
  kids: number; mediaCount: number; size?: 's' | 'm' | 'l'; showDue: boolean
}) {
  const overdue = item.due_date && new Date(item.due_date + 'T23:59:59') < new Date()
  return (
    <Link
      to={`/i/${item.id}`}
      className="group rise relative block overflow-hidden rounded-2xl bg-surface shadow-tile ring-1 ring-line/60 transition duration-300 hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline-2 focus-visible:outline-accent"
    >
      <div className={cx('relative overflow-hidden', size === 's' ? 'aspect-square' : 'aspect-[4/5]')}>
        <Thumb media={cover} alt={item.title} className="absolute inset-0 h-full w-full transition duration-500 group-hover:scale-[1.03]" />
        {!cover && (
          <div className="absolute inset-0 flex items-center justify-center text-accent/50">
            <Layers size={size === 's' ? 26 : 38} strokeWidth={1.4} />
          </div>
        )}
        {cover?.kind === 'video' && (
          <span className="absolute right-2 top-2 rounded-full bg-black/45 p-1.5 text-white backdrop-blur"><Film size={13} /></span>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#1a120a]/80 via-[#1a120a]/25 to-transparent" />
        {status && size !== 's' && <StatusPill status={status} size="xs" className="absolute left-2.5 top-2.5 shadow-sm" />}
        <div className="absolute inset-x-0 bottom-0 p-3 text-white">
          <div className={cx('font-display font-semibold leading-tight drop-shadow-sm', size === 's' ? 'line-clamp-2 text-[13px]' : size === 'm' ? 'line-clamp-2 text-[17px]' : 'line-clamp-2 text-xl')}>
            {item.title}
          </div>
          {size !== 's' && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white/85">
              {(total > 0 || ticking) && (
                <span className={cx('inline-flex items-center gap-1 tabular', ticking && 'text-[#ffd59a]')}>
                  <span className="[--glass-line:#fff] [--rim:#fff]"><HourglassGlyph size={10} running={ticking} /></span>
                  {fmtDuration(total)}
                </span>
              )}
              {kids > 0 && <span>{tn('item.subitems', kids)}</span>}
              {showDue && item.due_date && (
                <span className={cx('inline-flex items-center gap-1', overdue && 'text-[#ffb4a8]')}>
                  <CalendarDays size={12} /> {fmtDue(item.due_date)}
                </span>
              )}
              {kids === 0 && mediaCount > 0 && size === 'l' && <span>{tn('item.media', mediaCount)}</span>}
            </div>
          )}
        </div>
        {running && <span className="absolute right-2.5 top-2.5 h-2.5 w-2.5 animate-pulse rounded-full bg-[#ffcf8a] ring-4 ring-[#ffcf8a]/30" />}
        {size === 's' && status && <span className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full ring-2 ring-white/70" style={{ background: status.color }} />}
      </div>
    </Link>
  )
}

export function ItemRow({
  item, status, cover, total, ticking, kids, showDue, path,
}: { item: Item; status?: Status | null; cover: Media | null; total: number; ticking: boolean; kids: number; showDue: boolean; path?: string }) {
  return (
    <Link to={`/i/${item.id}`} className="rise flex items-center gap-3 rounded-2xl px-2 py-2 transition hover:bg-surface-2">
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface-2">
        <Thumb media={cover} className="h-full w-full" />
        {!cover && <Layers size={20} strokeWidth={1.5} className="absolute inset-0 m-auto text-accent/50" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{item.title}</div>
        <div className="mt-0.5 flex items-center gap-2 truncate text-xs text-muted">
          {path && <span className="truncate">{path}</span>}
          {!path && kids > 0 && <span>{tn('item.subitems', kids)}</span>}
          {item.tags.slice(0, 3).map((tg) => <span key={tg}>#{tg}</span>)}
          {showDue && item.due_date && <span className="inline-flex items-center gap-1"><CalendarDays size={11} />{fmtDue(item.due_date)}</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusPill status={status} size="xs" />
        {(total > 0 || ticking) && (
          <span className={cx('inline-flex items-center gap-1 text-xs tabular text-muted', ticking && 'text-accent-strong')}>
            <HourglassGlyph size={9} running={ticking} /> {fmtDuration(total)}
          </span>
        )}
      </div>
    </Link>
  )
}
