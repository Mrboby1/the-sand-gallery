import type { Status } from '../lib/types'
import { cx } from './ui'
import { t } from '../i18n'

/** Readable text color on top of a status color. */
export function onColor(hex: string): string {
  const m = hex.replace('#', '')
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#2a2017' : '#ffffff'
}

export function StatusPill({ status, size = 'sm', solid = true, className }: { status?: Status | null; size?: 'xs' | 'sm' | 'md'; solid?: boolean; className?: string }) {
  if (!status) return null
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center gap-1.5 truncate rounded-full font-medium',
        size === 'xs' && 'h-5 px-2 text-[11px]',
        size === 'sm' && 'h-6 px-2.5 text-xs',
        size === 'md' && 'h-8 px-3.5 text-sm',
        className,
      )}
      style={solid ? { background: status.color, color: onColor(status.color) } : { background: status.color + '22', color: status.color }}
    >
      {!solid && <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.color }} />}
      <span className="truncate">{status.name}</span>
    </span>
  )
}

/** The bottom status bar on the item page: every status as a tappable pill. */
export function StatusBar({ statuses, value, onChange }: { statuses: Status[]; value: string | null; onChange: (id: string | null) => void }) {
  const sorted = [...statuses].sort((a, b) => a.sort_order - b.sort_order)
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-3">
      {sorted.map((s) => {
        const active = s.id === value
        return (
          <button
            key={s.id}
            onClick={() => onChange(active ? null : s.id)}
            aria-pressed={active}
            className={cx(
              'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition active:scale-95',
              active ? 'border-transparent' : 'border-line bg-surface text-ink hover:bg-surface-2',
            )}
            style={active ? { background: s.color, color: onColor(s.color) } : undefined}
          >
            {!active && <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />}
            {s.name}
          </button>
        )
      })}
      {!sorted.length && <span className="text-sm text-muted">{t('item.noStatus')}</span>}
    </div>
  )
}
