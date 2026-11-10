import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Camera, ChevronLeft, ChevronRight, CloudUpload, ExternalLink, ImagePlus, MessageSquareText, Pencil, Play, Plus, RotateCw, Star, Trash2, X } from 'lucide-react'
import type { Item, Media } from '../lib/types'
import { useApp, deleteMedia, dismissUpload, pendingAsMedia, retryUpload, updateItem, updateMedia, uploadFiles } from '../store/app'
import { useMediaQuery, useMediaUrl } from '../lib/hooks'
import { Thumb } from './Tile'
import { IconButton, confirmDialog, cx } from './ui'
import { t } from '../i18n'

type Filter = 'all' | 'process' | 'finished'

export function MediaSection({ item }: { item: Item }) {
  const all = useApp((s) => s.data.media)
  const allPending = useApp((s) => s.pending)
  const uploads = allPending.filter((u) => u.itemId === item.id)
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<number | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [drag, setDrag] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const pick = () => picker.current?.click()
  // phones: the camera straight away (capture), next to the normal picker
  const camera = useRef<HTMLInputElement>(null)
  const shoot = () => camera.current?.click()
  // phones/tablets: no drag and drop there, so no dotted drop zone or "drop" wording
  const touch = useMediaQuery('(pointer: coarse)')
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
      </div>
      {/* no capture attribute: phones offer both the camera and the gallery */}
      <input ref={picker} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { void uploadFiles(item.id, [...(e.target.files ?? [])]); e.target.value = '' }} />
      {/* "Take photo": opens the back camera; the photo takes the same upload path as any other */}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden data-testid="camera-input" onChange={(e) => { void uploadFiles(item.id, [...(e.target.files ?? [])]); e.target.value = '' }} />

      {shown.length === 0 && uploads.length === 0 ? (
        touch ? (
          <div className="flex flex-col gap-2">
            <button onClick={shoot} className="flex w-full items-center gap-4 rounded-3xl bg-surface-2 px-5 py-4 text-left transition active:scale-[0.99]">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-on-primary"><Camera size={22} /></span>
              <span>
                <span className="block font-medium">{t('gallery.takePhoto')}</span>
                <span className="block text-[13px] text-muted">{t('gallery.takePhotoHint')}</span>
              </span>
            </button>
            <button onClick={pick} className="flex w-full items-center gap-4 rounded-3xl bg-surface-2 px-5 py-4 text-left transition active:scale-[0.99]">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-strong"><ImagePlus size={22} /></span>
              <span>
                <span className="block font-medium">{t('gallery.choose')}</span>
                <span className="block text-[13px] text-muted">{t('gallery.chooseHint')}</span>
              </span>
            </button>
          </div>
        ) : (
          <button onClick={pick} className="flex w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed border-line px-6 py-10 text-center text-sm text-muted transition hover:border-accent hover:bg-accent-soft/40 hover:text-ink">
            <ImagePlus size={28} strokeWidth={1.4} className="mb-2 text-accent" />
            {t('gallery.emptyMediaDesktop')}
          </button>
        )
      ) : (
        <div className="grid grid-cols-3 gap-x-1 gap-y-1.5 overflow-hidden rounded-2xl sm:grid-cols-4 sm:gap-x-1.5 sm:gap-y-2 lg:grid-cols-6">
          {shown.map((m, i) => (
            <div key={m.id} className="flex min-w-0 flex-col">
            <button
              onClick={() => { setNoteOpen(false); setOpen(i) }}
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
            {m.note && <NoteBubble note={m.note} onOpen={() => { setNoteOpen(true); setOpen(i) }} />}
            </div>
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
          {touch && (
            <button onClick={shoot} aria-label={t('gallery.takePhoto')} className="flex aspect-square flex-col items-center justify-center gap-1 bg-surface-2 text-muted transition hover:bg-accent-soft hover:text-ink">
              <Camera size={22} />
              <span className="text-[11px] font-medium">{t('gallery.camera')}</span>
            </button>
          )}
          <button onClick={pick} aria-label={t('gallery.addMedia')} title={t('gallery.addMedia')} className="flex aspect-square flex-col items-center justify-center gap-1 bg-surface-2 text-muted transition hover:bg-accent-soft hover:text-ink">
            <Plus size={24} />
            <span className="text-[11px] font-medium">{t('gallery.add')}</span>
          </button>
        </div>
      )}
      {drag && <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-3xl text-lg font-medium text-accent-strong">{t('gallery.dropHere')}</div>}
      {open !== null && shown[open] && (
        <Lightbox list={shown} index={open} item={item} onIndex={(i) => { setNoteOpen(false); setOpen(i) }} onClose={() => setOpen(null)} noteOpen={noteOpen} />
      )}
    </section>
  )
}

/** Full-screen viewer. `readOnly` (gallery mode) hides the editing actions. */
export function Lightbox({ list, index, item, onIndex, onClose, readOnly, noteOpen }: { list: Media[]; index: number; item: Item; onIndex: (i: number) => void; onClose: () => void; readOnly?: boolean; noteOpen?: boolean }) {
  const m = list[index]
  const url = useMediaUrl(m.object_key)
  const thumb = useMediaUrl(m.thumb_key)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const prev = () => index > 0 && onIndex(index - 1)
  const next = () => index < list.length - 1 && onIndex(index + 1)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement
      if (e.key === 'Escape') { if (typing) (e.target as HTMLElement).blur(); else onClose() }
      if (typing) return
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
      onTouchStart={(e) => { touch.current = e.target instanceof HTMLTextAreaElement ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
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
      <MediaNote key={m.id} media={m} initialOpen={noteOpen} />
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

/** Speech bubble under a picture that has a note: a one-line preview; tapping opens the note. */
export function NoteBubble({ note, onOpen }: { note: string; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      title={note}
      aria-label={`${t('note.has')}: ${note}`}
      className="relative mx-0.5 mt-1.5 flex min-w-0 items-center gap-1 rounded-lg bg-surface-2 px-1.5 py-1 text-left text-[11px] leading-tight text-ink/85 transition hover:bg-accent-soft"
    >
      {/* the bubble's little tail, pointing up at the picture */}
      <span aria-hidden className="absolute -top-1 left-2.5 h-2 w-2 rotate-45 bg-inherit" />
      <MessageSquareText size={12} className="relative shrink-0 text-accent-strong" />
      <span dir="auto" className="relative min-w-0 truncate">{note}</span>
    </button>
  )
}

/** Small "has a note" marker for media tiles. */
export function NoteBadge() {
  return (
    <span className="absolute bottom-1.5 left-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#2a2017]/70 text-white" title={t('note.has')} aria-label={t('note.has')}>
      <MessageSquareText size={13} />
    </span>
  )
}

/**
 * The note / caption of a photo or video, under the picture in the lightbox: two lines (tap to expand),
 * an "Add note" button, and an editor that saves as you type (through the offline queue).
 */
export function MediaNote({ media, editable = true, initialOpen = false }: { media: Media; editable?: boolean; initialOpen?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(initialOpen)
  const [v, setV] = useState(media.note ?? '')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef({ v: media.note ?? '', saved: media.note ?? '' })
  const save = (nv: string) => {
    clearTimeout(timer.current)
    if (nv.trim() === (latest.current.saved ?? '').trim()) return
    latest.current.saved = nv
    void updateMedia(media.id, { note: nv.trim() ? nv : null })
  }
  useEffect(() => () => { clearTimeout(timer.current); save(latest.current.v) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const note = editing ? v : media.note ?? ''
  if (editing) {
    return (
      <div className="px-4 pb-1">
        <textarea
          autoFocus
          dir="auto"
          value={v}
          rows={3}
          placeholder={t('note.placeholder')}
          onChange={(e) => {
            const nv = e.target.value
            setV(nv)
            latest.current.v = nv
            clearTimeout(timer.current)
            timer.current = setTimeout(() => save(nv), 700)
          }}
          onBlur={() => save(latest.current.v)}
          className="block max-h-40 w-full resize-none rounded-2xl border border-white/20 bg-white/10 p-3 text-[15px] leading-relaxed text-white outline-none placeholder:text-white/45 focus:border-white/40"
        />
        <div className="mt-2 flex justify-end">
          <button onClick={() => { save(latest.current.v); setEditing(false) }} className="h-8 rounded-full bg-white px-4 text-sm font-medium text-[#2a2017]">{t('common.done')}</button>
        </div>
      </div>
    )
  }
  if (!note.trim()) {
    if (!editable) return null
    return (
      <div className="flex justify-center px-4">
        <button onClick={() => { setV(''); latest.current.v = ''; setEditing(true) }} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm text-white/70 hover:bg-white/10 hover:text-white">
          <Plus size={15} /> {t('note.add')}
        </button>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2 px-4">
      <button onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
        <p dir="auto" className={cx('whitespace-pre-line text-[15px] leading-snug text-white/90', !open && 'line-clamp-2')}>{note}</p>
      </button>
      {editable && (
        <button onClick={() => { setV(note); latest.current.v = note; setEditing(true) }} aria-label={t('note.edit')} title={t('note.edit')} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">
          <Pencil size={15} />
        </button>
      )}
    </div>
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
