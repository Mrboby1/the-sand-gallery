import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layers, Play } from 'lucide-react'
import type { Item, Media } from '../lib/types'
import { useApp, childrenOf } from '../store/app'
import { useCoverFor, useMediaUrl, useTotals } from '../lib/hooks'
import { fmtDuration } from '../lib/time'
import { Lightbox } from './MediaGrid'
import { Thumb } from './Tile'
import { cx } from './ui'
import { t, tn, locale } from '../i18n'

/** "42h total · finished Nov 2026" */
export function finishedLine(item: Item, totalMs: number): string {
  const parts: string[] = []
  if (totalMs > 0) parts.push(t('gallery.total', { time: fmtDuration(totalMs) }))
  const when = item.finished_at ?? item.updated_at
  if (when) parts.push(t('gallery.finishedLine', { date: new Date(when).toLocaleDateString(locale, { month: 'short', year: 'numeric' }) }))
  return parts.join(' · ')
}

/** A finished item as a photo album: a stack of prints with the cover on top. */
export function AlbumTile({ item, cover, count, size = 'm' }: { item: Item; cover: Media | null; count: number; size?: 's' | 'm' | 'l' }) {
  return (
    <Link to={`/i/${item.id}`} className="group rise block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      <div className="relative aspect-square">
        {/* two prints peeking out behind the cover */}
        <div className="absolute inset-x-4 -top-2 bottom-4 rounded-2xl border border-line bg-surface-2" />
        <div className="absolute inset-x-2 -top-1 bottom-2 rounded-2xl border border-line bg-surface" />
        <div className="absolute inset-0 overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-line">
          <Thumb media={cover} alt={item.title} className="absolute inset-0 h-full w-full transition duration-300 group-hover:opacity-90" />
          {!cover && <Layers size={size === 's' ? 24 : 34} strokeWidth={1.5} className="absolute inset-0 m-auto text-muted/60" />}
        </div>
      </div>
      <div className={cx('px-0.5', size === 's' ? 'pt-2' : 'pt-3')}>
        <div dir="auto" className={cx('font-display font-semibold leading-snug [overflow-wrap:anywhere]', size === 's' ? 'line-clamp-1 text-[13px]' : 'line-clamp-2 text-[16px]')}>{item.title}</div>
        {size !== 's' && count > 0 && <div className="mt-0.5 text-[12.5px] text-muted">{tn('item.media', count)}</div>}
      </div>
    </Link>
  )
}

function MasonryTile({ m, onOpen, alt }: { m: Media; onOpen: () => void; alt: string }) {
  const url = useMediaUrl(m.thumb_key ?? (m.kind === 'photo' ? m.object_key : null))
  const ratio = m.width && m.height ? `${m.width} / ${m.height}` : '1 / 1'
  return (
    <button onClick={onOpen} aria-label={alt} className="group relative mb-2 block w-full overflow-hidden rounded-xl bg-surface-2 sm:mb-3" style={{ aspectRatio: ratio }}>
      {url && <img src={url} alt={alt} loading="lazy" decoding="async" className="fade absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:opacity-90" />}
      {m.kind === 'video' && <span className="absolute inset-0 m-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#2a2017]/60 text-white"><Play size={18} fill="white" /></span>}
    </button>
  )
}

/** The pure browsing view of a finished item: title, a short description, albums and a big photo wall. */
export function FinishedView({ item }: { item: Item }) {
  const items = useApp((s) => s.data.items)
  const allMedia = useApp((s) => s.data.media)
  const totals = useTotals()
  const covers = useCoverFor()
  const [open, setOpen] = useState<number | null>(null)
  const [more, setMore] = useState(false)
  const kids = useMemo(() => childrenOf(items, item.id), [items, item.id])
  // finished pieces first, then the process shots; oldest first within each
  const media = useMemo(
    () => allMedia.filter((m) => m.item_id === item.id).sort((a, b) => (a.phase === b.phase ? a.created_at.localeCompare(b.created_at) : a.phase === 'finished' ? -1 : 1)),
    [allMedia, item.id],
  )
  const notes = item.notes.trim()
  const long = notes.length > 280
  const line = finishedLine(item, totals.total(item.id))

  return (
    <div className="rise">
      <header className="pb-6 pt-2 text-center sm:pt-6">
        <h1 dir="auto" className="font-display text-[34px] font-semibold leading-tight [overflow-wrap:anywhere] sm:text-5xl">{item.title}</h1>
        {line && <p className="mt-2 text-[13px] text-muted">{line}</p>}
        {notes && (
          <div className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-ink/85">
            <p dir="auto" className="whitespace-pre-line">{long && !more ? notes.slice(0, 280).trimEnd() + '…' : notes}</p>
            {long && <button onClick={() => setMore(!more)} className="mt-1 text-[13px] font-medium text-accent-strong">{more ? t('gallery.less') : t('gallery.more')}</button>}
          </div>
        )}
      </header>

      {kids.length > 0 && (
        <div className="mb-8 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          {kids.map((k) => <AlbumTile key={k.id} item={k} cover={covers.cover(k)} count={covers.countMedia(k.id)} />)}
        </div>
      )}

      {media.length > 0 ? (
        <div className="columns-2 gap-2 sm:columns-3 sm:gap-3 lg:columns-4">
          {media.map((m, i) => <MasonryTile key={m.id} m={m} alt={`${item.title} ${i + 1}`} onOpen={() => setOpen(i)} />)}
        </div>
      ) : !kids.length && (
        <p className="py-12 text-center text-muted">{t('gallery.empty')}</p>
      )}

      {open !== null && media[open] && <Lightbox list={media} index={open} item={item} onIndex={setOpen} onClose={() => setOpen(null)} readOnly />}
    </div>
  )
}
