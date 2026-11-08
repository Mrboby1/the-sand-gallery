import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useApp, childrenOf } from '../store/app'
import { useLocalPref, useWeekTotal, useRunning } from '../lib/hooks'
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
  const week = useWeekTotal()
  const running = useRunning()
  const tags = useMemo(() => allTags(items), [items])
  const shown = useMemo(() => {
    if (tag) return items.filter((i) => i.tags.includes(tag)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return childrenOf(items, null)
  }, [items, tag])
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
              <span>{t('home.week')}: <span className="font-semibold text-ink tabular">{fmtDuration(week)}</span></span>
            </div>
          </div>
          <AddMenu parentId={null} />
        </div>

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
        ) : (
          <ItemsView items={shown} view={view} pathOf={tag ? pathOf : undefined} />
        )}
      </main>

      <NewItemSheet open={newOpen} onClose={() => setNewOpen(false)} parentId={null} />
    </div>
  )
}
