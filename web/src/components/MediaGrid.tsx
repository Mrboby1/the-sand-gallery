import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, ChevronLeft, ChevronRight, CloudUpload, ExternalLink, Image as ImageIcon, Play, RotateCw, Star, Trash2, Upload, X } from 'lucide-react'
import type { Item, Media } from '../lib/types'
import { useApp, deleteMedia, dismissUpload, pendingAsMedia, retryUpload, updateItem, updateMedia, uploadFiles } from '../store/app'
import { useMediaUrl } from '../lib/hooks'
import { Thumb } from './Tile'
import { Button, IconButton, confirmDialog, cx } from './ui'
import { t } from '../i18n'

type Filter = 'all' | 'process' | 'finished'

export function UploadButton({ itemId, size = 'md' }: { itemId: string; size?: 'sm' | 'md' }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={ref} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { void uploadFiles(itemId, [...(e.target.files ?? [])]); e.target.value = '' }} />
      <Button size={size} variant="soft" onClick={() => ref.current?.click()}><Upload size={16} /> {t('gallery.upload')}</Button>
    </>
  )
}

export function MediaSection({ item }: { item: Item }) {
  const all = useApp((s) => s.data.media)
  const allPending = useApp((s) => s.pending)
  const uploads = allPending.filter((u) => u.itemId === item.id)
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<number | null>(null)
  const [drag, setDrag] = useState(false)
  const media = all
    .filter((m) => m.item_id === item.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const shown = media.filter((m) => filter === 'all' || m.phase === filter)
  const counts = { all: media.length, process: media.filter((m) => m.phase === 'process').length, finished: media.filter((m) => m.phase === 'finished').length }

  return (
    <section
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true) } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false) }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); void uploadFiles(item.id, [...e.dataTransfer.files]) }}
      className={cx('relative rounded-3xl transition', drag && 'bg-accent-soft ring-2 ring-dashed ring-accent')}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-full bg-surface-2 p-1">
          {(['all', 'process', 'finished'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cx('h-7 rounded-full px-3 text-[13px] transition', filter === f ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted')}
            >
              {t(f === 'all' ? 'gallery.all' : f === 'process' ? 'gallery.process' : 'gallery.finished')}
              <span className="ml-1 tabular opacity-60">{counts[f]}</span>
            </button>
          ))}
        </div>
        <UploadButton itemId={item.id} size="sm" />
      </div>

      {shown.length === 0 && uploads.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-line px-6 py-10 text-center text-sm text-muted">
          <ImageIcon size={28} strokeWidth={1.4} className="mb-2 text-accent/60" />
          {t('gallery.emptyMedia')}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1 overflow-hidden rounded-2xl sm:grid-cols-4 sm:gap-1.5 lg:grid-cols-6">
          {shown.map((m, i) => (
            <button
              key={m.id}
              onClick={() => setOpen(i)}
              aria-label={`${t(m.kind === 'video' ? 'gallery.video' : 'gallery.photo')} ${i + 1}${item.cover_media_id === m.id ? ` (${t('gallery.isCover')})` : ''}`}
              className="group relative aspect-square overflow-hidden bg-surface-2"
            >
              <Thumb media={m} alt={`${item.title} ${i + 1}`} className="h-full w-full transition duration-500 group-hover:scale-105" />
              {m.kind === 'video' && (
                <span className="absolute inset-0 m-auto flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm"><Play size={16} fill="white" /></span>
              )}
              {item.cover_media_id === m.id && (
                <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur"><Star size={10} fill="white" /> {t('gallery.isCover')}</span>
              )}
              {m.phase === 'finished' && <span className="absolute bottom-1.5 right-1.5 h-2 w-2 rounded-full bg-[#5f9e6e] ring-2 ring-white/80" title={t('gallery.finished')} />}
            </button>
          ))}
          {uploads.map((u) => (
            <div key={u.id} className="relative flex aspect-square flex-col items-center justify-center gap-1.5 overflow-hidden bg-surface-2 p-2 text-center">
              {/* the picture itself, from the copy kept on this device */}
              <Thumb media={pendingAsMedia(u)} alt={u.name} className={cx('absolute inset-0 h-full w-full', u.status === 'error' ? 'opacity-25' : 'opacity-80')} />
              {u.status === 'waiting' && (
                <span className="absolute bottom-1.5 left-1.5 right-1.5 inline-flex items-center justify-center gap-1 rounded-full bg-[#2a2017]/80 px-2 py-0.5 text-[10px] font-medium text-white" title={u.persisted ? t('upload.waitingKept') : t('upload.waiting')}>
                  <CloudUpload size={11} className="shrink-0" /> <span className="truncate">{t('upload.waiting')}</span>
                </span>
              )}
              {u.status === 'error' ? (
                <>
                  <AlertCircle size={22} className="relative text-danger" />
                  <span className="relative line-clamp-3 text-[11px] leading-tight text-ink">{u.error}</span>
                  <div className="relative flex gap-1">
                    <button onClick={() => retryUpload(u.id)} aria-label={`${t('upload.retry')} ${u.name}`} className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-medium text-on-primary"><RotateCw size={12} /> {t('upload.retry')}</button>
                    <button onClick={() => dismissUpload(u.id)} aria-label={`${t('upload.dismiss')} ${u.name}`} title={t('upload.dismiss')} className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-surface text-muted"><X size={13} /></button>
                  </div>
                </>
              ) : u.status === 'uploading' && (
                <svg viewBox="0 0 36 36" className="relative h-12 w-12 -rotate-90 drop-shadow" role="progressbar" aria-valuenow={Math.round(u.progress * 100)} aria-label={u.name}>
                  <circle cx="18" cy="18" r="15" fill="none" stroke="var(--sg-line)" strokeWidth="3" />
                  <circle cx="18" cy="18" r="15" fill="none" stroke="var(--sg-accent)" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${u.progress * 94.2} 94.2`} />
                </svg>
              )}
            </div>
          ))}
        </div>
      )}
      {drag && <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-3xl text-lg font-medium text-accent-strong">{t('gallery.dropHere')}</div>}
      {open !== null && shown[open] && (
        <Lightbox list={shown} index={open} item={item} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
    </section>
  )
}

/** Full-screen viewer. `readOnly` (gallery mode) hides the editing actions. */
export function Lightbox({ list, index, item, onIndex, onClose, readOnly }: { list: Media[]; index: number; item: Item; onIndex: (i: number) => void; onClose: () => void; readOnly?: boolean }) {
  const m = list[index]
  const url = useMediaUrl(m.object_key)
  const thumb = useMediaUrl(m.thumb_key)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const prev = () => index > 0 && onIndex(index - 1)
  const next = () => index < list.length - 1 && onIndex(index + 1)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })
  const isCover = item.cover_media_id === m.id
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  return createPortal(
    <div
      className="fade fixed inset-0 z-[70] flex flex-col bg-[#0d0a07] text-white"
      onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
      onTouchEnd={(e) => {
        if (!touch.current) return
        const dx = e.changedTouches[0].clientX - touch.current.x
        const dy = e.changedTouches[0].clientY - touch.current.y
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next : prev)()
        else if (dy > 110) onClose()
        touch.current = null
      }}
    >
      <div className="flex items-center justify-between px-3 py-2 safe-top">
        <IconButton label={t('common.close')} onClick={onClose} className="text-white hover:bg-white/10"><X size={22} /></IconButton>
        <span className="text-sm tabular text-white/60">{index + 1} / {list.length}</span>
        <div className="w-10" />
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {m.kind === 'video' ? (
          url ? <video key={m.id} src={url} poster={thumb} controls playsInline autoPlay className="max-h-full max-w-full" /> : <Spinner />
        ) : url ? (
          <img key={m.id} src={url} alt={`${item.title} ${index + 1}`} className="fade max-h-full max-w-full select-none object-contain" draggable={false} />
        ) : thumb ? (
          <img src={thumb} alt="" className="max-h-full max-w-full object-contain blur-[1px]" />
        ) : <Spinner />}
        {index > 0 && <button aria-label="Previous" onClick={prev} className="absolute left-3 hidden h-11 w-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 sm:flex"><ChevronLeft /></button>}
        {index < list.length - 1 && <button aria-label="Next" onClick={next} className="absolute right-3 hidden h-11 w-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 sm:flex"><ChevronRight /></button>}
      </div>
      {readOnly ? (
        <div className="flex items-center justify-center gap-2 px-3 py-3 safe-bottom">
          {url && <LbButton label={t('gallery.download')} onClick={() => window.open(url, '_blank', 'noopener')}><ExternalLink size={16} /></LbButton>}
        </div>
      ) : (
      <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-3 safe-bottom">
        <LbButton onClick={() => updateItem(item.id, { cover_media_id: isCover ? null : m.id })} active={isCover}>
          <Star size={16} fill={isCover ? 'currentColor' : 'none'} /> {isCover ? t('gallery.isCover') : t('gallery.setCover')}
        </LbButton>
        <div className="flex rounded-full bg-white/10 p-1">
          {(['process', 'finished'] as const).map((p) => (
            <button key={p} onClick={() => updateMedia(m.id, { phase: p })} className={cx('h-8 rounded-full px-3 text-sm transition', m.phase === p ? 'bg-white text-[#2a2017]' : 'text-white/75')}>
              {t(p === 'process' ? 'gallery.process' : 'gallery.finished')}
            </button>
          ))}
        </div>
        {url && <LbButton label={t('gallery.download')} onClick={() => window.open(url, '_blank', 'noopener')}><ExternalLink size={16} /></LbButton>}
        <LbButton
          label={t('gallery.deleteMedia')}
          danger
          onClick={async () => {
            if (await confirmDialog(t('gallery.deleteMediaConfirm', { kind: t(m.kind === 'video' ? 'gallery.video' : 'gallery.photo') }), { danger: true, okLabel: t('common.delete') })) {
              if (list.length === 1) onClose()
              else if (index === list.length - 1) onIndex(index - 1)
              void deleteMedia(m.id)
            }
          }}
        >
          <Trash2 size={16} />
        </LbButton>
      </div>
      )}
    </div>,
    document.body,
  )
}

function LbButton({ children, onClick, active, danger, label }: { children: React.ReactNode; onClick: () => void; active?: boolean; danger?: boolean; label?: string }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={cx('inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm transition', active ? 'bg-[#e2a55c] text-[#2a2017]' : 'bg-white/10 hover:bg-white/20', danger && 'hover:bg-[#b4483c]')}>
      {children}
    </button>
  )
}

function Spinner() {
  return <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
}
