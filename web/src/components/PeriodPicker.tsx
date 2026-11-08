import { Check, ChevronDown } from 'lucide-react'
import { saveSettings } from '../store/app'
import { useSummaryPeriod } from '../lib/hooks'
import type { SummaryPeriod } from '../lib/types'
import { Menu, MenuItem, cx } from './ui'
import { t } from '../i18n'

export const PERIODS: SummaryPeriod[] = ['day', 'week', 'month', 'all']
export const periodLabel = (p: SummaryPeriod) => t(`period.${p}`)

/** "This week ▾": choose today / this week / this month / all time for the time-worked summary (synced setting). */
export function PeriodPicker({ className }: { className?: string }) {
  const period = useSummaryPeriod()
  return (
    <Menu
      align="left"
      inline
      trigger={(open) => (
        <button onClick={open} aria-label={t('period.choose')} className={cx('inline-flex items-center gap-0.5 rounded-full underline decoration-dotted decoration-1 underline-offset-4 transition hover:text-ink', className)}>
          {periodLabel(period)}<ChevronDown size={14} className="opacity-70" />
        </button>
      )}
    >
      {(close) => PERIODS.map((p) => (
        <MenuItem key={p} icon={p === period ? <Check size={16} /> : <span className="inline-block w-4" />} onClick={() => { close(); if (p !== period) saveSettings({ summary_period: p }) }}>
          {periodLabel(p)}
        </MenuItem>
      ))}
    </Menu>
  )
}
