import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, Plus, Search, X } from 'lucide-react'
import { useApp, childrenOf } from '../store/app'
import { useFinishedProjects, useLocalPref, usePeriodTotal, useRunning, useSummaryPeriod } from '../lib/hooks'
import { PeriodPicker } from '../components/PeriodPicker'
import { fmtDuration } from '../lib/time'
import { HeaderActions, TopBar } from '../components/Shell'
import { ItemsView } from '../components/ItemsView'
import { ViewSwitcher, type ViewMode } from '../components/ViewSwitcher'
import { NewItemSheet, allTags } from '../components/ItemBits'
import { AddMenu } from '../components/AddMenu'
import { Hourglass, HourglassGlyph } from '../components/Hourglass'
import { Button, Empty, cx } from '../components/ui'
import { t } from '../i18n'

export function Home() {
  const items = useApp((s) => s.data.items)
  const [view, setView] = useLocalPref<ViewMode>('sg.view.home', 'grid-m')
  const [tag, setTag] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const period = useSummaryPeriod()
  const worked = usePeriodTotal(period)
  const running = useRunning()
  const [params, setParams] = useSearchParams()
  const showFinished = params.get('show') === 'finished'
  const [q, setQ] = useState('')
  const fin = useFinishedProjects()
  const finishedCount = fin.top.length
  const shown = useMemo(() => {
    if (showFinished) {
      const needle = q.trim().toLowerCase()
      return fin.top.filter((i) => (!tag || i.tags.includes(tag)) && (!needle || i.title.toLowerCase().includes(needle) || i.tags.some((tg) => tg.includes(needle))))
    }
    // the main gallery: active projects and folders only; finished projects live in the Finished tab
    if (tag) return items.filter((i) => i.tags.includes(tag) && !fin.isFinished(i.id)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return childrenOf(items, null).filter((i) => !fin.isFinished(i.id))
  }, [items, tag, showFinished, q, fin])
  // tag chips: only the tags used in the list being shown
  const tags = useMemo(() => allTags(showFinished ? fin.top : items.filter((i) => !fin.isFinished(i.id))), [items, showFinished, fin])
  const setShow = (finished: boolean) => { setTag(null); setQ(''); setParams(finished ? { show: 'finished' } : {}, { replace: true }) }
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const pathOf = (it: { parent_id: string | null }) => {
    const parts: string[] = []
    let p = it.parent_id ? byId.get(it.parent_id) : undefined
    while (p && parts.length < 4) { parts.unshift(p.title); p = p.parent_id ? byId.get(p.parent_id) : undefined }
    return parts.join(' › ')
  }

  return (
    <div className="min-h-full pb-28">
      <TopBar><HeaderActions /></TopBar>
      <main className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[32px] font-semibold leading-tight sm:text-4xl">{t('home.title')}</h1>
            <div className="mt-1.5 inline-flex items-center gap-2 text-[15px] text-muted">
              <HourglassGlyph size={13} running={!!running} />
              <span><PeriodPicker />: <span className="font-semibold text-ink tabular">{fmtDuration(worked)}</span></span>
            </div>
          </div>
          <AddMenu parentId={null} />
        </div>

        {(finishedCount > 0 || showFinished) && (
          <div className="mb-4 flex items-center gap-2">
            <div className="inline-flex rounded-full bg-surface-2 p-1" role="tablist" aria-label={t('finished.switch')}>
              <button role="tab" aria-selected={!showFinished} onClick={() => setShow(false)} className={cx('h-8 rounded-full px-3.5 text-[14px] transition', !showFinished ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted')}>{t('finished.active')}</button>
              <button role="tab" aria-selected={showFinished} onClick={() => setShow(true)} className={cx('inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[14px] transition', showFinished ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted')}>
                <CheckCircle2 size={14} /> {t('finished.tab')} <span className="tabular text-muted">{finishedCount}</span>
              </button>
            </div>
          </div>
        )}
        {showFinished && finishedCount > 0 && (
          <div className="relative mb-4">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('finished.search')} aria-label={t('finished.search')} className="h-10 w-full rounded-full border border-line bg-surface pl-10 pr-10 text-[15px] outline-none focus:border-accent" />
            {q && <button onClick={() => setQ('')} aria-label={t('common.clear')} className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-surface-2"><X size={14} /></button>}
          </div>
        )}

        {items.length > 0 && (
          <div className="mb-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
            <div className="no-scrollbar -mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 empty:hidden">
              {tags.map((tg) => (
                <button
                  key={tg}
                  onClick={() => setTag(tag === tg ? null : tg)}
                  className={cx('h-8 shrink-0 rounded-full px-3 text-[13px] transition', tag === tg ? 'bg-ink text-bg' : 'bg-surface-2 text-ink/80 hover:bg-accent-soft')}
                >
                  #{tg}
                </button>
              ))}
            </div>
            <ViewSwitcher value={view} onChange={setView} />
          </div>
        )}

        {items.length === 0 ? (
          <Empty icon={<Hourglass size={90} running />} title={t('home.empty.title')} body={t('home.empty.body')}>
            <Button variant="primary" size="lg" onClick={() => setNewOpen(true)}><Plus size={18} /> {t('add.firstProject')}</Button>
          </Empty>
        ) : showFinished && !shown.length ? (
          <p className="py-16 text-center text-muted">{q || tag ? t('finished.noMatch') : t('finished.empty')}</p>
        ) : (
          <ItemsView items={shown} view={view} pathOf={tag || showFinished ? pathOf : undefined} />
        )}
      </main>

      <NewItemSheet open={newOpen} onClose={() => setNewOpen(false)} parentId={null} />
    </div>
  )
}
