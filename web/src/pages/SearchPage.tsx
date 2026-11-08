import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useApp } from '../store/app'
import { useLocalPref } from '../lib/hooks'
import { TopBar } from '../components/Shell'
import { ItemsView } from '../components/ItemsView'
import { ViewSwitcher, type ViewMode } from '../components/ViewSwitcher'
import { allTags } from '../components/ItemBits'
import { cx } from '../components/ui'
import { onColor } from '../components/StatusPill'
import { t } from '../i18n'

export function SearchPage() {
  const items = useApp((s) => s.data.items)
  const media = useApp((s) => s.data.media)
  const notes = useApp((s) => s.data.notes)
  const statuses = useApp((s) => s.data.statuses)
  const [q, setQ] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [view, setView] = useLocalPref<ViewMode>('sg.view.search', 'list')
  const all = useMemo(() => allTags(items), [items])
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle && !tags.length && !status) return []
    const noteHits = new Set(needle ? [...media.filter((m) => m.note?.toLowerCase().includes(needle)).map((m) => m.item_id), ...notes.filter((n) => n.body.toLowerCase().includes(needle)).map((n) => n.item_id)] : [])
    return items
      .filter((i) => tags.every((tg) => i.tags.includes(tg)))
      .filter((i) => !status || i.status_id === status)
      .filter((i) => !needle || i.title.toLowerCase().includes(needle) || i.notes.toLowerCase().includes(needle) || noteHits.has(i.id) || i.tags.some((tg) => tg.includes(needle.replace(/^#/, ''))))
      .sort((a, b) => {
        const at = a.title.toLowerCase().includes(needle) ? 0 : 1
        const bt = b.title.toLowerCase().includes(needle) ? 0 : 1
        return at - bt || b.updated_at.localeCompare(a.updated_at)
      })
  }, [items, media, notes, q, tags, status])
  const pathOf = (it: { parent_id: string | null }) => {
    const parts: string[] = []
    let p = it.parent_id ? byId.get(it.parent_id) : undefined
    while (p && parts.length < 4) { parts.unshift(p.title); p = p.parent_id ? byId.get(p.parent_id) : undefined }
    return parts.join(' › ')
  }
  const toggle = (tg: string) => setTags((cur) => (cur.includes(tg) ? cur.filter((x) => x !== tg) : [...cur, tg]))

  return (
    <div className="min-h-full pb-24">
      <TopBar back="/" title={t('nav.search')} />
      <main className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
        <div className="relative">
          <Search size={19} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search.placeholder')}
            className="h-13 w-full rounded-2xl border border-line bg-surface py-3.5 pl-12 pr-11 text-[16px] outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          {q && <button aria-label={t('tags.clear')} onClick={() => setQ('')} className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-surface-2"><X size={16} /></button>}
        </div>

        <div className="mt-4">
          <div className="mb-2 text-[13px] font-medium text-muted">{t('tags.filter')}</div>
          <div className="flex flex-wrap gap-1.5">
            {all.map((tg) => (
              <button key={tg} onClick={() => toggle(tg)} className={cx('h-8 rounded-full px-3 text-[13px] transition', tags.includes(tg) ? 'bg-ink text-bg' : 'bg-surface-2 hover:bg-accent-soft')}>#{tg}</button>
            ))}
            {!all.length && <span className="text-sm text-muted">{t('tags.none')}</span>}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[...statuses].sort((a, b) => a.sort_order - b.sort_order).map((s) => (
              <button
                key={s.id}
                onClick={() => setStatus(status === s.id ? null : s.id)}
                className={cx('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition', status === s.id ? 'border-transparent' : 'border-line hover:bg-surface-2')}
                style={status === s.id ? { background: s.color, color: onColor(s.color) } : undefined}
              >
                {status !== s.id && <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />}{s.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6">
          {results.length > 0 && <div className="mb-3 flex justify-end"><ViewSwitcher value={view} onChange={setView} /></div>}
          {results.length > 0 ? (
            <ItemsView items={results} view={view} pathOf={pathOf} scopeIds={new Set(results.map((r) => r.id))} />
          ) : (
            <p className="py-12 text-center text-muted">{q || tags.length || status ? t('search.empty') : t('search.hint')}</p>
          )}
        </div>
      </main>
    </div>
  )
}
