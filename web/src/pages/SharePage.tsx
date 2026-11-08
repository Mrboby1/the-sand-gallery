import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Layers, Play, X } from 'lucide-react'
import { backend } from '../lib/backend'
import type { SharedGallery } from '../lib/types'
import { Hourglass } from '../components/Hourglass'
import { StatusPill } from '../components/StatusPill'
import { Empty, cx } from '../components/ui'
import { t } from '../i18n'

type SMedia = SharedGallery['media'][number]

/** Public read-only gallery for a share link. No login, no private fields. */
export function SharePage() {
  const { token = '' } = useParams()
  const [data, setData] = useState<SharedGallery | null | undefined>(undefined)
  const [params, setParams] = useSearchParams()
  const at = params.get('at')
  const setAt = (id: string) => setParams(data && id === data.root_id ? {} : { at: id })
  const [open, setOpen] = useState<{ list: SMedia[]; i: number } | null>(null)
  useEffect(() => { backend.fetchShared(token).then(setData).catch(() => setData(null)) }, [token])
  useEffect(() => { if (data) document.title = `${data.items.find((i) => i.id === (at ?? data.root_id))?.title ?? ''} · ${t('app.name')}` }, [data, at])

  const view = useMemo(() => {
    if (!data) return null
    const cur = at ?? data.root_id
    const byId = new Map(data.items.map((i) => [i.id, i]))
    const item = byId.get(cur)
    const kids = data.items.filter((i) => i.parent_id === cur).sort((a, b) => a.sort_order - b.sort_order)
    const media = data.media.filter((m) => m.item_id === cur).sort((a, b) => a.created_at.localeCompare(b.created_at))
    const crumbs: { id: string; title: string }[] = []
    let p = item
    while (p) { crumbs.unshift({ id: p.id, title: p.title }); if (p.id === data.root_id) break; p = p.parent_id ? byId.get(p.parent_id) : undefined }
    const coverOf = (id: string): SMedia | undefined => {
      const it = byId.get(id)
      const own = data.media.filter((m) => m.item_id === id)
      const c = own.find((m) => m.id === it?.cover_media_id) ?? own[0]
      if (c) return c
      for (const k of data.items.filter((i) => i.parent_id === id)) { const kc = coverOf(k.id); if (kc) return kc }
      return undefined
    }
    return { item, kids, media, crumbs, coverOf, status: (sid: string | null) => data.statuses.find((s) => s.id === sid) }
  }, [data, at])

  if (data === undefined) return <div className="flex min-h-full items-center justify-center"><Hourglass running size={70} /></div>
  if (!data || !view?.item) return <Empty icon={<Hourglass size={70} />} title={t('share.notFound')} />

  return (
    <div className="min-h-full pb-16">
      <header className="mx-auto max-w-6xl px-4 pb-2 pt-[calc(1.5rem+env(safe-area-inset-top))] sm:px-6">
        <div className="mb-4 flex items-center gap-2 text-[13px] text-muted"><Hourglass size={16} detail="lite" /> {t('share.madeWith')}</div>
        {view.crumbs.length > 1 && (
          <nav className="mb-2 flex flex-wrap items-center gap-1 text-[13px] text-muted">
            {view.crumbs.slice(0, -1).map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1">
                <button onClick={() => setAt(c.id)} className="hover:text-ink">{c.title}</button><ChevronRight size={12} />
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <h1 dir="auto" className="font-display text-4xl font-semibold leading-tight [overflow-wrap:anywhere]">{view.item.title}</h1>
          <StatusPill status={view.status(view.item.status_id) as never} size="sm" />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
        {view.kids.length > 0 && (
          <div className="mb-8 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
            {view.kids.map((k) => {
              const c = view.coverOf(k.id)
              return (
                <button key={k.id} onClick={() => { setAt(k.id); window.scrollTo({ top: 0 }) }} className="rise group block text-left">
                  <div className="relative aspect-square overflow-hidden rounded-2xl bg-surface-2">
                    {c ? <img src={c.thumb_url ?? c.url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition group-hover:opacity-90" /> : <div className="absolute inset-0 flex items-center justify-center text-muted/60"><Layers size={34} strokeWidth={1.5} /></div>}
                  </div>
                  <div className="flex items-start justify-between gap-2 px-0.5 pt-2.5">
                    <span dir="auto" className="text-[15px] font-medium [overflow-wrap:anywhere]">{k.title}</span>
                    <StatusPill status={view.status(k.status_id) as never} size="xs" className="mt-0.5 shrink-0" />
                  </div>
                </button>
              )
            })}
          </div>
        )}
        {view.media.length > 0 && (
          <div className="columns-2 gap-2 sm:columns-3 lg:columns-4">
            {view.media.map((m, i) => (
              <figure key={m.id} className="mb-3 break-inside-avoid">
                <button onClick={() => setOpen({ list: view.media, i })} className="relative block w-full overflow-hidden rounded-xl bg-surface-2">
                  <img src={m.thumb_url ?? m.url} alt={m.note ?? ''} loading="lazy" className="block w-full" style={m.width && m.height ? { aspectRatio: `${m.width}/${m.height}` } : undefined} />
                  {m.kind === 'video' && <span className="absolute inset-0 m-auto flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white"><Play size={18} fill="white" /></span>}
                </button>
                {m.note && <figcaption dir="auto" className="mt-1.5 line-clamp-3 px-0.5 text-[13px] leading-snug text-muted">{m.note}</figcaption>}
              </figure>
            ))}
          </div>
        )}
      </main>
      {open && <ShareLightbox list={open.list} index={open.i} onIndex={(i) => setOpen({ ...open, i })} onClose={() => setOpen(null)} />}
    </div>
  )
}

function ShareLightbox({ list, index, onIndex, onClose }: { list: SMedia[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const m = list[index]
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      if (e.key === 'ArrowRight' && index < list.length - 1) onIndex(index + 1)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })
  return (
    <div className="fade fixed inset-0 z-50 flex items-center justify-center bg-[#0d0a07]">
      <button aria-label={t('common.close')} onClick={onClose} className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))] z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"><X /></button>
      <div className="flex max-h-full w-full flex-col items-center justify-center gap-3">
        {m.kind === 'video' ? <video key={m.id} src={m.url} poster={m.thumb_url ?? undefined} controls autoPlay playsInline className="max-h-[80vh] max-w-full" /> : <img key={m.id} src={m.url} alt={m.note ?? ''} className="fade max-h-[80vh] max-w-full object-contain" />}
        {m.note && <p dir="auto" className="max-w-xl whitespace-pre-line px-5 text-center text-[15px] leading-snug text-white/90">{m.note}</p>}
      </div>
      <button aria-label="Previous" disabled={index === 0} onClick={() => onIndex(index - 1)} className={cx('absolute left-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white', index === 0 && 'opacity-0')}><ChevronLeft /></button>
      <button aria-label="Next" disabled={index === list.length - 1} onClick={() => onIndex(index + 1)} className={cx('absolute right-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white', index === list.length - 1 && 'opacity-0')}><ChevronRight /></button>
    </div>
  )
}
