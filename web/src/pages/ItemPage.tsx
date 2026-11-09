import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  CalendarDays, CheckCircle2, ChevronRight, Copy, FolderInput, RotateCcw, ListPlus, LayoutTemplate, Link2, MoreHorizontal, Pencil, Plus, Trash2, X,
} from 'lucide-react'
import {
  useApp, childrenOf, createItem, deleteItem, descendantIds, duplicateItem, markFinished, ownFinished, reopenItem, toast, updateItem,
} from '../store/app'
import { useIsFinished, useLocalPref, useTotals } from '../lib/hooks'
import { FinishedView } from '../components/FinishedView'
import { FolderPage } from '../components/Folder'
import { setClientView, useClientView } from '../lib/clientView'
import { Eye, EyeOff } from 'lucide-react'
import { AddMenu } from '../components/AddMenu'
import { TopBar } from '../components/Shell'
import { TimerCard, FullscreenTimer } from '../components/Timer'
import { StatusBar } from '../components/StatusPill'
import { ItemsView } from '../components/ItemsView'
import { ViewSwitcher, type ViewMode } from '../components/ViewSwitcher'
import { MediaSection } from '../components/MediaGrid'
import { CostsTab, NotesTab, TimeLogTab } from '../components/Tabs'
import { MoveSheet, NewItemSheet, ShareSheet, TagEditor, saveTemplateFlow } from '../components/ItemBits'
import { Button, Empty, Menu, MenuItem, Sheet, confirmDialog, cx } from '../components/ui'
import { fmtDue } from '../components/Tile'
import { t, tn, type MsgKey } from '../i18n'

type Tab = 'gallery' | 'notes' | 'log' | 'costs'
const TABS: { id: Tab; label: MsgKey }[] = [
  { id: 'gallery', label: 'tabs.gallery' },
  { id: 'notes', label: 'tabs.notes' },
  { id: 'log', label: 'tabs.log' },
  { id: 'costs', label: 'tabs.costs' },
]

export function ItemPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const items = useApp((s) => s.data.items)
  const media = useApp((s) => s.data.media)
  const statuses = useApp((s) => s.data.statuses)
  const dueOn = useApp((s) => s.data.settings.due_dates_enabled)
  const item = items.find((i) => i.id === id)
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'gallery'
  const [full, setFull] = useState(params.get('timer') === 'full')
  const [view, setView] = useLocalPref<ViewMode>('sg.view.item', 'grid-m')
  const [sheet, setSheet] = useState<null | 'new' | 'move' | 'share' | 'template'>(null)
  const totals = useTotals()
  const isFinished = useIsFinished()
  const clientView = useClientView()
  const [manage, setManage] = useState(false)
  useEffect(() => { setManage(false) }, [id])

  const kids = useMemo(() => (item ? childrenOf(items, item.id) : []), [items, item])
  const scope = useMemo(() => (item ? new Set([item.id, ...descendantIds(items, item.id)]) : new Set<string>()), [items, item])
  const crumbs = useMemo(() => {
    const out: { id: string; title: string }[] = []
    let p = item?.parent_id ? items.find((i) => i.id === item.parent_id) : undefined
    while (p && out.length < 8) { out.unshift({ id: p.id, title: p.title }); p = p.parent_id ? items.find((i) => i.id === p!.parent_id) : undefined }
    return out
  }, [items, item])

  useEffect(() => { window.scrollTo({ top: 0 }) }, [id])
  useEffect(() => {
    document.title = item ? `${item.title} · ${t('app.name')}` : t('app.name')
    return () => { document.title = t('app.name') }
  }, [item?.title]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) {
    return (
      <div className="min-h-full">
        <TopBar back="/" />
        <Empty title="Not found" body="This item was deleted or never existed." />
      </div>
    )
  }

  const setTab = (tb: Tab) => setParams(tb === 'gallery' ? {} : { tab: tb }, { replace: true })
  const crumbsNav = (
    <nav className="no-scrollbar flex items-center gap-1 overflow-x-auto whitespace-nowrap text-[13px] text-muted">
      <Link to="/" className="hover:text-ink">{t('nav.home')}</Link>
      {crumbs.length > 3 && (
        <span className="inline-flex items-center gap-1">
          <ChevronRight size={12} className="opacity-50" />
          <Link to={`/i/${crumbs[crumbs.length - 3].id}`} title={crumbs.slice(0, -2).map((c) => c.title).join(' › ')} className="hover:text-ink">…</Link>
        </span>
      )}
      {(crumbs.length > 3 ? crumbs.slice(-2) : crumbs).map((c) => (
        <span key={c.id} className="inline-flex min-w-0 items-center gap-1">
          <ChevronRight size={12} className="shrink-0 opacity-50" />
          <Link to={`/i/${c.id}`} dir="auto" className="max-w-[8rem] truncate hover:text-ink">{c.title}</Link>
        </span>
      ))}
    </nav>

  )
  const menu = (
    <Menu trigger={(toggle) => <button aria-label={t('common.more')} onClick={toggle} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-2"><MoreHorizontal size={21} /></button>}>
      {(close) => (
        <>
          {ownFinished(item, statuses)
            ? <MenuItem icon={<RotateCcw size={16} />} onClick={() => { close(); void reopenItem(item.id) }}>{t('finished.reopen')}</MenuItem>
            : <MenuItem icon={<CheckCircle2 size={16} />} onClick={() => { close(); void markFinished(item.id) }}>{t('finished.mark')}</MenuItem>}
          <MenuItem icon={<Link2 size={16} />} onClick={() => { close(); setSheet('share') }}>{t('item.share')}</MenuItem>
          <MenuItem icon={<FolderInput size={16} />} onClick={() => { close(); setSheet('move') }}>{t('item.move')}</MenuItem>
          <MenuItem icon={<Copy size={16} />} onClick={async () => { close(); const nid = await duplicateItem(item.id); if (nid) nav(`/i/${nid}`) }}>{t('item.duplicate')}</MenuItem>
          <MenuItem
            icon={<LayoutTemplate size={16} />}
            onClick={() => { close(); void saveTemplateFlow(item) }}
          >
            {t('item.saveTemplate')}
          </MenuItem>
          <MenuItem icon={<Plus size={16} />} onClick={() => { close(); setSheet('template') }}>{t('item.newFromTemplate')}</MenuItem>
          <div className="my-1 h-px bg-line" />
          <MenuItem
            danger
            icon={<Trash2 size={16} />}
            onClick={async () => {
              close()
              const ok = await confirmDialog(t('item.delete'), { body: t('item.deleteConfirm', { title: item.title, items: tn('item.subitems', subtreeCount), media: tn('item.media', mediaCount) }), danger: true, okLabel: t('common.delete') })
              if (ok) { nav(backTo, { replace: true }); await deleteItem(item.id) }
            }}
          >
            {t('item.delete')}
          </MenuItem>
        </>
      )}
    </Menu>
  )

  if (item.kind === 'folder') return <FolderPage item={item} crumbs={crumbsNav} />

  const backTo = item.parent_id ? `/i/${item.parent_id}` : '/'
  const finished = isFinished(item.id)
  const subtreeCount = scope.size - 1
  const mediaCount = media.filter((m) => scope.has(m.item_id)).length

  if (finished && !manage) {
    return (
      <div className="min-h-full pb-16">
        <TopBar back={backTo} crumbs={crumbsNav}>
          <ClientViewToggle />
          <Button size="sm" variant="ghost" onClick={() => setManage(true)}><Pencil size={15} /> {t('gallery.manage')}</Button>
          {menu}
        </TopBar>
        <main className="mx-auto max-w-6xl px-4 sm:px-6">
          <FinishedView item={item} />
        </main>
        {sheet === 'move' && <MoveSheet item={item} onClose={() => setSheet(null)} />}
        {sheet === 'share' && <ShareSheet item={item} onClose={() => setSheet(null)} />}
        {sheet === 'template' && <ApplyTemplateSheet itemId={item.id} onClose={() => setSheet(null)} />}
      </div>
    )
  }

  return (
    <div className="min-h-full pb-[calc(9rem+env(safe-area-inset-bottom))]">
      <TopBar
        back={backTo}
        crumbs={crumbsNav}
      >
        <AddMenu parentId={item.id} parentTitle={item.title} variant="button" />
        {menu}
      </TopBar>

      <main className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
        {finished && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl bg-accent-soft px-4 py-2.5 text-sm">
            <span>{t('gallery.manageBanner')}</span>
            <Button size="sm" variant="primary" onClick={() => setManage(false)}>{t('gallery.backToGallery')}</Button>
          </div>
        )}
        <TitleEditor value={item.title} onSave={(v) => updateItem(item.id, { title: v })} />

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
          <TimerCard itemId={item.id} hasChildren={kids.length > 0} onFullscreen={() => setFull(true)} />
          <div className="flex flex-col gap-3 lg:pt-1">
            <TagEditor item={item} />
            {dueOn && <DueDate value={item.due_date} onChange={(v) => updateItem(item.id, { due_date: v })} />}
          </div>
        </div>

        <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-4 mt-5 bg-bg/85 px-4 backdrop-blur-xl sm:-mx-6 sm:px-6">
          <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line" role="tablist">
            {TABS.filter((tb) => !(tb.id === 'costs' && finished && clientView)).map((tb) => (
              <button
                key={tb.id}
                role="tab"
                aria-selected={tab === tb.id}
                onClick={() => setTab(tb.id)}
                className={cx('relative h-11 shrink-0 px-3.5 text-[15px] transition', tab === tb.id ? 'font-semibold text-ink' : 'text-muted hover:text-ink')}
              >
                {t(tb.label)}
                {tab === tb.id && <span className="absolute inset-x-2 -bottom-px h-[3px] rounded-full bg-accent" />}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-5">
          {tab === 'gallery' && (
            <div className="flex flex-col gap-8">
              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="font-display text-xl font-semibold">{t('gallery.items')} <span className="text-base font-normal text-muted tabular">{kids.length || ''}</span></h2>
                  <div className="flex items-center gap-2">
                    {kids.length > 0 && <div className="hidden sm:block"><ViewSwitcher value={view} onChange={setView} /></div>}
                    <Button size="sm" variant="primary" onClick={() => setSheet('new')}><Plus size={16} /> {t('item.newSub')}</Button>
                  </div>
                </div>
                {kids.length > 0 && <div className="mb-3 sm:hidden"><ViewSwitcher value={view} onChange={setView} /></div>}
                {kids.length > 0 || view === 'calendar' ? (
                  <ItemsView items={kids} view={view} scopeIds={scope} rootId={item.id} />
                ) : (
                  <button onClick={() => setSheet('new')} className="flex w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line px-4 py-7 text-center transition hover:border-accent">
                    <span className="inline-flex items-center gap-2 font-medium text-accent-strong"><ListPlus size={18} /> {t('add.emptyItem')}</span>
                    <span className="text-[13px] text-muted">{t('add.emptyItemBody')}</span>
                  </button>
                )}
              </section>
              <section>
                <h2 className="mb-3 font-display text-xl font-semibold">{t('gallery.media')}</h2>
                <MediaSection item={item} />
              </section>
            </div>
          )}
          {tab === 'notes' && <NotesTab item={item} />}
          {tab === 'log' && <TimeLogTab item={item} hasChildren={kids.length > 0} />}
          {tab === 'costs' && !(finished && clientView) && <CostsTab item={item} totalMs={totals.total(item.id)} />}
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line/60 bg-bg/90 backdrop-blur-xl safe-bottom">
        <div className="mx-auto max-w-6xl">
          <StatusBar statuses={statuses} value={item.status_id} onChange={(sid) => updateItem(item.id, { status_id: sid })} />
        </div>
      </div>

      <AddMenu parentId={item.id} parentTitle={item.title} aboveBar variant="fab" />
      {full && <FullscreenTimer itemId={item.id} onClose={() => setFull(false)} />}
      <NewItemSheet open={sheet === 'new'} onClose={() => setSheet(null)} parentId={item.id} stay />
      {sheet === 'move' && <MoveSheet item={item} onClose={() => setSheet(null)} />}
      {sheet === 'share' && <ShareSheet item={item} onClose={() => setSheet(null)} />}
      {sheet === 'template' && <ApplyTemplateSheet itemId={item.id} onClose={() => setSheet(null)} />}
    </div>
  )
}

/** Discreet eye button: client view hides costs and prices on finished items (remembered on this device). */
function ClientViewToggle() {
  const on = useClientView()
  return (
    <button
      onClick={() => { setClientView(!on); toast(on ? t('client.offToast') : t('client.onToast')) }}
      aria-pressed={on}
      aria-label={on ? t('client.turnOff') : t('client.turnOn')}
      title={on ? t('client.turnOff') : t('client.turnOn')}
      className={cx('inline-flex h-9 w-9 items-center justify-center rounded-full transition', on ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:bg-surface-2')}
    >
      {on ? <EyeOff size={17} /> : <Eye size={17} />}
    </button>
  )
}

function TitleEditor({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef({ v: value, saved: value })
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  useEffect(() => { if (document.activeElement !== ref.current) setV(value); latest.current.saved = value }, [value])
  // Save while typing (debounced) and when the page is hidden/closed, not only on blur/Enter.
  useEffect(() => {
    const flushNow = () => { clearTimeout(timer.current); const nv = latest.current.v.trim(); if (nv && nv !== latest.current.saved) { latest.current.saved = nv; saveRef.current(nv) } }
    window.addEventListener('pagehide', flushNow)
    document.addEventListener('visibilitychange', flushNow)
    return () => { flushNow(); window.removeEventListener('pagehide', flushNow); document.removeEventListener('visibilitychange', flushNow) }
  }, [])
  const change = (nv: string) => {
    setV(nv)
    latest.current.v = nv
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { const x = nv.trim(); if (x && x !== latest.current.saved) { latest.current.saved = x; saveRef.current(x) } }, 900)
  }
  useEffect(() => {
    const el = ref.current
    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }
  }, [v])
  return (
    <div className="group relative">
      <textarea
        ref={ref}
        rows={1}
        value={v}
        dir="auto"
        onChange={(e) => change(e.target.value.replace(/\n/g, ''))}
        onBlur={() => { clearTimeout(timer.current); const nv = v.trim(); if (nv && nv !== latest.current.saved) { latest.current.saved = nv; onSave(nv) } else if (!nv) setV(value) }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() } }}
        aria-label={t('item.rename')}
        className="block w-full resize-none overflow-hidden bg-transparent pr-8 font-display text-[30px] font-semibold leading-tight outline-none sm:text-[38px]"
      />
      <Pencil size={16} className="pointer-events-none absolute right-1 top-3 text-muted opacity-0 transition group-hover:opacity-100" />
    </div>
  )
}

function DueDate({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => ref.current?.showPicker?.()}
        className={cx('relative inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition', value ? 'bg-accent-soft text-accent-strong' : 'border border-dashed border-line text-muted hover:border-accent')}
      >
        <CalendarDays size={14} />
        {value ? `${t('item.due')} ${fmtDue(value)}` : t('item.setDue')}
        <input
          ref={ref}
          type="date"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={t('item.setDue')}
        />
      </button>
      {value && <button aria-label={t('item.clearDue')} onClick={() => onChange(null)} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2"><X size={14} /></button>}
    </div>
  )
}

function countTpl(n: { children?: unknown[] }[]): number {
  return n.reduce((k, x) => k + 1 + countTpl((x.children ?? []) as { children?: unknown[] }[]), 0)
}

function ApplyTemplateSheet({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const templates = useApp((s) => s.data.templates)
  const nav = useNavigate()
  return (
    <Sheet open onClose={onClose} title={t('item.newFromTemplate')}>
      {!templates.length && <p className="text-sm text-muted">{t('settings.noTemplates')}</p>}
      <div className="flex flex-col gap-1">
        {templates.map((x) => (
          <button
            key={x.id}
            onClick={async () => {
              onClose()
              const nid = await createItem(itemId, '', x.id)
              toast(t('item.createdFromTemplate', { title: x.item_title || x.name }), 'info', { label: t('share.open'), run: () => nav(`/i/${nid}`) })
            }}
            className="flex flex-col items-start rounded-xl px-3 py-3 text-left hover:bg-surface-2"
          >
            <span className="font-medium" dir="auto">{x.name}</span>
            <span className="text-sm text-muted">{t('item.templateWillCreate', { title: x.item_title || x.name, n: countTpl(x.tree) })}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}
