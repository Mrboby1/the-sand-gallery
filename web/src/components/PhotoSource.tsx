import { useMemo, useState } from 'react'
import { Camera, ImagePlus, Search, Video } from 'lucide-react'
import { useApp, childrenOf, descendantIds } from '../store/app'
import { useFinishedProjects } from '../lib/hooks'
import { Sheet } from './ui'
import { t } from '../i18n'

/** One row of a small choice sheet (icon, title, hint). */
function Choice({ icon, title, hint, onClick }: { icon: React.ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-4 rounded-2xl px-3 py-3 text-left transition hover:bg-surface-2">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-strong">{icon}</span>
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="block text-[13px] text-muted">{hint}</span>
      </span>
    </button>
  )
}

/** Phones: "Add photos / videos" asks where from, the camera or the gallery. */
export function PhotoSourceSheet({ open, onClose, onCamera, onVideo, onPick }: { open: boolean; onClose: () => void; onCamera: () => void; onVideo: () => void; onPick: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={t('photos.addTitle')}>
      <div className="flex flex-col gap-1">
        <Choice icon={<Camera size={21} />} title={t('gallery.takePhoto')} hint={t('gallery.takePhotoHint')} onClick={() => { onClose(); onCamera() }} />
        <Choice icon={<Video size={21} />} title={t('gallery.recordVideo')} hint={t('gallery.recordVideoHint')} onClick={() => { onClose(); onVideo() }} />
        <Choice icon={<ImagePlus size={21} />} title={t('photos.fromGallery')} hint={t('gallery.chooseHint')} onClick={() => { onClose(); onPick() }} />
      </div>
    </Sheet>
  )
}

/**
 * "Add time log" outside a project (home or a folder): which project? Projects (and their subtasks) in scope,
 * active ones first, with a search box when the list is long.
 */
export function ProjectPickerSheet({ scopeId, onPick, onClose }: { scopeId: string | null; onPick: (id: string) => void; onClose: () => void }) {
  const items = useApp((s) => s.data.items)
  const fin = useFinishedProjects()
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const inScope = scopeId ? descendantIds(items, scopeId) : null
    const byId = new Map(items.map((i) => [i.id, i]))
    const path = (id: string | null) => { const parts: string[] = []; let p = id ? byId.get(id) : undefined; while (p && parts.length < 3 && p.id !== scopeId) { parts.unshift(p.title); p = p.parent_id ? byId.get(p.parent_id) : undefined } return parts.join(' › ') }
    const needle = q.trim().toLowerCase()
    return items
      .filter((i) => i.kind !== 'folder' && (!inScope || inScope.has(i.id)) && (!needle || i.title.toLowerCase().includes(needle)))
      .map((i) => ({ i, path: path(i.parent_id), done: fin.isFinished(i.id) }))
      .sort((a, b) => Number(a.done) - Number(b.done) || b.i.updated_at.localeCompare(a.i.updated_at))
      .slice(0, 80)
  }, [items, scopeId, q, fin])
  const total = scopeId ? childrenOf(items, scopeId).length : items.length
  return (
    <Sheet open onClose={onClose} title={t('timeAdd.which')}>
      {total > 6 && (
        <div className="relative mb-2">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('timeAdd.search')} aria-label={t('timeAdd.search')} className="h-10 w-full rounded-xl border border-line bg-surface-2 pl-9 pr-3 text-[15px] outline-none focus:border-accent" />
        </div>
      )}
      <div className="flex max-h-[55vh] flex-col overflow-y-auto">
        {list.map(({ i, path, done }) => (
          <button key={i.id} onClick={() => onPick(i.id)} className="flex flex-col items-start rounded-xl px-3 py-2.5 text-left hover:bg-surface-2">
            <span dir="auto" className={done ? 'text-muted' : 'font-medium'}>{i.title}</span>
            {path && <span className="text-[12.5px] text-muted">{path}</span>}
          </button>
        ))}
        {!list.length && <p className="px-3 py-4 text-sm text-muted">{t('timeAdd.none')}</p>}
      </div>
    </Sheet>
  )
}
