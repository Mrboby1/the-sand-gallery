import { CalendarDays, Columns3, Grid2x2, Grid3x3, LayoutGrid, List } from 'lucide-react'
import { t, type MsgKey } from '../i18n'
import { cx } from './ui'

export type ViewMode = 'grid-s' | 'grid-m' | 'grid-l' | 'list' | 'board' | 'calendar'

const VIEWS: { id: ViewMode; icon: React.ReactNode; label: MsgKey }[] = [
  { id: 'grid-s', icon: <Grid3x3 size={17} />, label: 'views.grid.s' },
  { id: 'grid-m', icon: <LayoutGrid size={17} />, label: 'views.grid.m' },
  { id: 'grid-l', icon: <Grid2x2 size={17} />, label: 'views.grid.l' },
  { id: 'list', icon: <List size={17} />, label: 'views.list' },
  { id: 'board', icon: <Columns3 size={17} />, label: 'views.board' },
  { id: 'calendar', icon: <CalendarDays size={17} />, label: 'views.calendar' },
]

export function ViewSwitcher({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="inline-flex rounded-full bg-surface-2 p-1" role="radiogroup" aria-label="View">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          role="radio"
          aria-checked={value === v.id}
          aria-label={t(v.label)}
          title={t(v.label)}
          onClick={() => onChange(v.id)}
          className={cx(
            'inline-flex h-8 w-8 items-center justify-center rounded-full transition sm:w-9',
            value === v.id ? 'bg-surface text-accent-strong shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {v.icon}
        </button>
      ))}
    </div>
  )
}
