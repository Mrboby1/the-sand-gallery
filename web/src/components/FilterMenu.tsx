import { useMemo, useState } from 'react'
import { Check, ChevronDown, Hash, ListFilter, Search } from 'lucide-react'
import type { Item } from '../lib/types'
import { Menu, cx } from './ui'
import { t } from '../i18n'

export type StatusFilter = 'all' | 'unfinished' | 'finished'
export interface ItemFilter { status: StatusFilter; tag: string | null }

/** A filter remembered per place in localStorage (e.g. home, or one folder). */
export function useItemFilter(key: string, fallback: StatusFilter): [ItemFilter, (f: ItemFilter) => void] {
  const read = (): ItemFilter => {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const [status, tag] = raw.split('|')
        if (status === 'all' || status === 'unfinished' || status === 'finished') return { status, tag: tag || null }
      }
    } catch { /* ignore */ }
    return { status: fallback, tag: null }
  }
  const [f, setF] = useState<ItemFilter>(read)
  // a different place (another folder) has its own remembered filter
  const [forKey, setForKey] = useState(key)
  if (forKey !== key) { setForKey(key); setF(read()) }
  return [f, (nf: ItemFilter) => { setF(nf); try { localStorage.setItem(key, `${nf.status}|${nf.tag ?? ''}`) } catch { /* ignore */ } }]
}

/** Applies a filter to a list. Folders are never finished; with a tag chosen only items carrying it remain. */
export function applyItemFilter(list: Item[], f: ItemFilter, isFinished: (id: string) => boolean): Item[] {
  return list.filter((i) =>
    (f.status === 'all' || (f.status === 'finished' ? i.kind !== 'folder' && isFinished(i.id) : !isFinished(i.id)))
    && (!f.tag || i.tags.includes(f.tag)))
}

const LABEL: Record<StatusFilter, 'filter.all' | 'filter.unfinished' | 'filter.finished'> = { all: 'filter.all', unfinished: 'filter.unfinished', finished: 'filter.finished' }

/**
 * One dropdown for what a gallery shows: All / Unfinished / Finished, and a tag. The button says the current choice
 * and how many items match ("Unfinished · 7 ▾").
 */
export function FilterMenu({ value, onChange, items, isFinished, shown }: {
  value: ItemFilter; onChange: (f: ItemFilter) => void; items: Item[]; isFinished: (id: string) => boolean; shown: number
}) {
  const counts = useMemo(() => {
    const byTag = value.tag ? items.filter((i) => i.tags.includes(value.tag!)) : items
    return {
      all: byTag.length,
      unfinished: byTag.filter((i) => !isFinished(i.id)).length,
      finished: byTag.filter((i) => i.kind !== 'folder' && isFinished(i.id)).length,
    }
  }, [items, isFinished, value.tag])
  const tags = useMemo(() => {
    const s = new Set<string>()
    for (const i of items) for (const tg of i.tags) s.add(tg)
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [items])
  const row = (active: boolean, label: React.ReactNode, onClick: () => void, count?: number) => (
    <button role="menuitemradio" aria-checked={active} onClick={onClick} className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-surface-2', active && 'font-medium')}>
      <span className="inline-flex w-4 justify-center">{active && <Check size={15} />}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="tabular text-[12.5px] text-muted">{count}</span>}
    </button>
  )
  return (
    <Menu
      align="left"
      inline
      trigger={(open) => (
        <button onClick={open} aria-haspopup="menu" aria-label={t('filter.label')} className="inline-flex h-10 max-w-[70vw] items-center gap-1.5 rounded-full border border-line bg-surface pl-3 pr-2.5 text-[14px] font-medium transition hover:bg-surface-2">
          <ListFilter size={15} className="shrink-0 text-muted" />
          <span className="truncate">{t(LABEL[value.status])}{value.tag && <span className="text-muted"> · #{value.tag}</span>}</span>
          <span className="tabular text-[12.5px] font-normal text-muted">{shown}</span>
          <ChevronDown size={15} className="shrink-0 text-muted" />
        </button>
      )}
    >
      {(close) => (
        <div role="menu" className="max-h-[60vh] w-64 overflow-y-auto">
          {(['all', 'unfinished', 'finished'] as const).map((st) => (
            <div key={st}>{row(value.status === st, t(LABEL[st]), () => { onChange({ ...value, status: st }); close() }, counts[st])}</div>
          ))}
          {tags.length > 0 && (
            <>
              <div className="my-1 h-px bg-line" />
              <div className="px-3 pb-1 pt-1.5 text-[11.5px] font-medium uppercase tracking-wider text-muted">{t('filter.tags')}</div>
              <TagList tags={tags} current={value.tag} row={row} onPick={(tag) => { onChange({ ...value, tag }); close() }} onClose={close} />
            </>
          )}
        </div>
      )}
    </Menu>
  )
}

/**
 * The Tags section: a small search box (live, case-insensitive, matches anywhere), "Any tag", and the matching tags.
 * Enter picks the first match; Esc clears the search, or closes the menu when it is already empty. The box gets the
 * focus on computers only, so phones do not pop up the keyboard.
 */
function TagList({ tags, current, row, onPick, onClose }: {
  tags: string[]; current: string | null
  row: (active: boolean, label: React.ReactNode, onClick: () => void, count?: number) => React.ReactNode
  onPick: (tag: string | null) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const desktop = typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches
  const needle = q.trim().toLowerCase()
  const shown = needle ? tags.filter((tg) => tg.toLowerCase().includes(needle)) : tags
  return (
    <>
      <div className="relative mx-1.5 mb-1 mt-0.5">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          autoFocus={desktop}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (shown[0]) onPick(shown[0]) }
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              if (q) setQ('')
              else onClose()
            }
          }}
          placeholder={t('filter.searchTags')}
          aria-label={t('filter.searchTags')}
          className="h-9 w-full rounded-xl border border-line bg-surface-2 pl-8 pr-2.5 text-[14px] outline-none focus:border-accent"
        />
      </div>
      {!needle && row(!current, t('filter.anyTag'), () => onPick(null))}
      {shown.map((tg) => (
        <div key={tg}>{row(current === tg, <span className="inline-flex items-center gap-1"><Hash size={12} className="text-muted" />{tg}</span>, () => onPick(current === tg ? null : tg))}</div>
      ))}
      {needle && !shown.length && <p className="px-3 py-2.5 text-[13.5px] text-muted">{t('filter.noTags')}</p>}
    </>
  )
}
