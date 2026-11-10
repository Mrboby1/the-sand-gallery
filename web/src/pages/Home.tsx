import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useApp, childrenOf } from '../store/app'
import { useFinishedProjects, useLocalPref, usePeriodTotal, useRunning, useSummaryPeriod } from '../lib/hooks'
import { PeriodPicker } from '../components/PeriodPicker'
import { fmtDuration } from '../lib/time'
import { HeaderActions, TopBar } from '../components/Shell'
import { ItemsView } from '../components/ItemsView'
import { ViewSwitcher, type ViewMode } from '../components/ViewSwitcher'
import { NewItemSheet } from '../components/ItemBits'
import { FilterMenu, applyItemFilter, useItemFilter } from '../components/FilterMenu'
import { AddMenu } from '../components/AddMenu'
import { Hourglass, HourglassGlyph } from '../components/Hourglass'
import { Button, Empty } from '../components/ui'
import { t } from '../i18n'

export function Home() {
  const items = useApp((s) => s.data.items)
  const [view, setView] = useLocalPref<ViewMode>('sg.view.home', 'grid-m')
  const [newOpen, setNewOpen] = useState(false)
  const period = useSummaryPeriod()
  const worked = usePeriodTotal(period)
  const running = useRunning()
  const fin = useFinishedProjects()
  // one filter: All / Unfinished (default, keeps finished work apart) / Finished, plus a tag; top-level items only
  // (what is inside a folder shows in that folder)
  const [filter, setFilter] = useItemFilter('sg.filter.home', 'unfinished')
  const top = useMemo(() => childrenOf(items, null), [items])
  const shown = useMemo(() => {
    const list = applyItemFilter(top, filter, fin.isFinished)
    return filter.status === 'finished' ? [...list].sort((x, y) => (y.finished_at ?? y.updated_at).localeCompare(x.finished_at ?? x.updated_at)) : list
  }, [top, filter, fin])

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

        {items.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <FilterMenu value={filter} onChange={setFilter} items={top} isFinished={fin.isFinished} shown={shown.length} />
            <ViewSwitcher value={view} onChange={setView} />
          </div>
        )}

        {items.length === 0 ? (
          <Empty icon={<Hourglass size={90} running />} title={t('home.empty.title')} body={t('home.empty.body')}>
            <Button variant="primary" size="lg" onClick={() => setNewOpen(true)}><Plus size={18} /> {t('add.firstProject')}</Button>
          </Empty>
        ) : !shown.length ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted">
            <p>{filter.status === 'finished' && !filter.tag ? t('finished.empty') : t('filter.none')}</p>
            <button onClick={() => setFilter({ status: 'all', tag: null })} className="text-[14px] font-medium text-accent-strong underline-offset-2 hover:underline">{t('filter.showAll')}</button>
          </div>
        ) : (
          <ItemsView items={shown} view={view} />
        )}
      </main>

      <NewItemSheet open={newOpen} onClose={() => setNewOpen(false)} parentId={null} />
    </div>
  )
}
