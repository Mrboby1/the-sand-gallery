import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { create } from 'zustand'
import {
  CalendarDays, Copy, FolderInput, Image as ImageIcon, LayoutTemplate, Link2, MoreVertical, Pause, Pencil, Play, Tag,
  Trash2, CircleDot, X, CheckCircle2, RotateCcw } from 'lucide-react'
import {
  useApp, deleteWithUndo, duplicateItem, startTimer, stopTimer, toast, updateItem, markFinished, ownFinished, reopenItem } from '../store/app'
import { useRunning } from '../lib/hooks'
import { MoveSheet, ShareSheet, TagEditor, saveTemplateFlow } from './ItemBits'
import { FolderDeleteSheet } from './Folder'
import { StatusBar } from './StatusPill'
import { Thumb } from './Tile'
import { Button, Input, Sheet, confirmDialog, cx, promptDialog } from './ui'
import { t } from '../i18n'

type Sub = 'status' | 'tags' | 'due' | 'cover' | 'move' | 'share' | 'folderDelete'
interface MenuState { id: string | null; pos: { x: number; y: number } | null; sub: Sub | null }
const useMenu = create<MenuState>(() => ({ id: null, pos: null, sub: null }))

/** Opens the actions menu for an item: a popover at `pos` on desktop, a bottom sheet otherwise. */
export function openItemMenu(id: string, pos: { x: number; y: number } | null = null) {
  useMenu.setState({ id, pos, sub: null })
}
const closeMenu = () => useMenu.setState({ id: null, pos: null, sub: null })

const LONG_PRESS_MS = 450

/**
 * After a long-press the browser still sends the tap's mouse/click events when the finger lifts; the menu
 * that just opened is under the finger, so swallow them briefly or they would close it straight away.
 */
export function swallowNextClick(touchAlreadyEnded = false) {
  const stop = (e: Event) => { e.preventDefault(); e.stopPropagation() }
  const types = ['mousedown', 'mouseup', 'click'] as const
  types.forEach((ty) => document.addEventListener(ty, stop, { capture: true }))
  const off = () => types.forEach((ty) => document.removeEventListener(ty, stop, { capture: true }))
  if (touchAlreadyEnded) { setTimeout(off, 450); return }
  document.addEventListener('touchend', () => setTimeout(off, 400), { once: true, capture: true })
  setTimeout(off, 8000)
}

/**
 * Wraps an item tile/row: long-press on touch (with a light haptic and a press-in effect), right-click,
 * or the "⋮" shown on hover with a mouse, all open the item's actions. A long press that starts moving
 * is left alone (scrolling, or dragging on the board).
 */
export function ItemPress({ itemId, children, className, longPress = true, dots = 'corner' }: {
  itemId: string; children: ReactNode; className?: string; longPress?: boolean; dots?: 'corner' | 'row' | 'none'
}) {
  const [pressing, setPressing] = useState(false)
  const st = useRef<{ t?: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean; touch: boolean }>({ x: 0, y: 0, fired: false, touch: false })
  const cancel = () => { clearTimeout(st.current.t); setPressing(false) }
  return (
    <div
      className={cx('group relative no-callout transition-transform duration-150', pressing && 'scale-[0.97]', className)}
      onPointerDown={(e) => {
        st.current.fired = false
        st.current.touch = e.pointerType !== 'mouse'
        if (!longPress || e.pointerType === 'mouse') return
        st.current.x = e.clientX
        st.current.y = e.clientY
        setPressing(true)
        st.current.t = setTimeout(() => {
          st.current.fired = true
          setPressing(false)
          swallowNextClick()
          try { navigator.vibrate?.(10) } catch { /* not supported */ }
          openItemMenu(itemId)
        }, LONG_PRESS_MS)
      }}
      onPointerMove={(e) => { if (Math.hypot(e.clientX - st.current.x, e.clientY - st.current.y) > 8) cancel() }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onClickCapture={(e) => { if (st.current.fired) { e.preventDefault(); e.stopPropagation(); st.current.fired = false } }}
      onContextMenu={(e) => {
        e.preventDefault() // no browser menu / callout on tiles
        if (!st.current.touch) openItemMenu(itemId, { x: e.clientX, y: e.clientY })
      }}
    >
      {children}
      {dots !== 'none' && (
        <button
          aria-label={t('menu.actions')}
          title={t('menu.actions')}
          onClick={(e) => {
            e.preventDefault(); e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            openItemMenu(itemId, { x: r.right, y: r.bottom + 4 })
          }}
          className={cx(
            'only-hover absolute z-10 h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-ink opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100',
            dots === 'corner' ? 'right-2 top-2' : 'right-1 top-1/2 -translate-y-1/2',
          )}
        >
          <MoreVertical size={16} />
        </button>
      )}
    </div>
  )
}

interface Action { key: string; icon: ReactNode; label: string; run: () => void; danger?: boolean; disabled?: boolean }

/** Renders the open item menu and its sub-sheets. Mounted once, inside the router. */
export function ItemMenuHost() {
  const { id, pos, sub } = useMenu()
  const item = useApp((s) => (id ? s.data.items.find((i) => i.id === id) : undefined))
  const statuses = useApp((s) => s.data.statuses)
  const allMedia = useApp((s) => s.data.media)
  const dueOn = useApp((s) => s.data.settings.due_dates_enabled)
  const running = useRunning()
  const nav = useNavigate()
  const loc = useLocation()
  const desktop = !!pos && matchMedia('(hover: hover) and (pointer: fine)').matches
  useEffect(() => { closeMenu() }, [loc.pathname])
  if (!id || !item) return null

  const media = allMedia.filter((m) => m.item_id === item.id)
  const isRunning = running?.item_id === item.id
  const openSub = (s: Sub) => useMenu.setState({ sub: s, pos: null })
  const renameAction: Action = { key: 'rename', icon: <Pencil size={17} />, label: t('item.rename'), run: async () => { closeMenu(); const v = await promptDialog(t('item.rename'), item.title); if (v) void updateItem(item.id, { title: v }) } }
  const folderActions: Action[] = [
    renameAction,
    { key: 'cover', icon: <ImageIcon size={17} />, label: t('menu.cover'), run: () => openSub('cover'), disabled: !media.length },
    { key: 'move', icon: <FolderInput size={17} />, label: t('item.move'), run: () => openSub('move') },
    { key: 'share', icon: <Link2 size={17} />, label: t('item.share'), run: () => openSub('share') },
    { key: 'delete', icon: <Trash2 size={17} />, label: t('folder.delete'), danger: true, run: () => openSub('folderDelete') },
  ]
  const finishedNow = ownFinished(item, statuses)
  const itemActions: Action[] = [
    finishedNow
      ? { key: 'reopen', icon: <RotateCcw size={17} />, label: t('finished.reopen'), run: () => { closeMenu(); void reopenItem(item.id) } }
      : { key: 'finish', icon: <CheckCircle2 size={17} />, label: t('finished.mark'), run: () => { closeMenu(); void markFinished(item.id) } },
    { key: 'rename', icon: <Pencil size={17} />, label: t('item.rename'), run: async () => { closeMenu(); const v = await promptDialog(t('item.rename'), item.title); if (v) void updateItem(item.id, { title: v }) } },
    { key: 'status', icon: <CircleDot size={17} />, label: t('menu.status'), run: () => openSub('status') },
    { key: 'tags', icon: <Tag size={17} />, label: t('menu.tags'), run: () => openSub('tags') },
    { key: 'timer', icon: isRunning ? <Pause size={17} /> : <Play size={17} />, label: isRunning ? t('menu.stopTimer') : t('menu.startTimer'), run: () => { closeMenu(); void (isRunning ? stopTimer() : startTimer(item.id)) } },
    ...(dueOn ? [{ key: 'due', icon: <CalendarDays size={17} />, label: item.due_date ? t('menu.dueChange') : t('menu.dueSet'), run: () => openSub('due') }] : []),
    { key: 'cover', icon: <ImageIcon size={17} />, label: t('menu.cover'), run: () => openSub('cover'), disabled: !media.length },
    { key: 'move', icon: <FolderInput size={17} />, label: t('item.move'), run: () => openSub('move') },
    { key: 'dup', icon: <Copy size={17} />, label: t('item.duplicate'), run: async () => { closeMenu(); const nid = await duplicateItem(item.id); if (nid) toast(t('menu.duplicated'), 'info', { label: t('share.open'), run: () => nav(`/i/${nid}`) }) } },
    { key: 'tpl', icon: <LayoutTemplate size={17} />, label: t('item.saveTemplate'), run: () => { closeMenu(); void saveTemplateFlow(item) } },
    { key: 'share', icon: <Link2 size={17} />, label: t('item.share'), run: () => openSub('share') },
    {
      key: 'delete', icon: <Trash2 size={17} />, label: t('item.delete'), danger: true,
      run: async () => {
        closeMenu()
        if (!(await confirmDialog(t('item.delete'), { body: t('menu.deleteBody', { title: item.title }), danger: true, okLabel: t('common.delete') }))) return
        if (loc.pathname === `/i/${item.id}`) nav(item.parent_id ? `/i/${item.parent_id}` : '/', { replace: true })
        deleteWithUndo(item.id)
      },
    },
  ]

  const actions = item.kind === 'folder' ? folderActions : itemActions

  // ---- sub-sheets
  if (sub === 'folderDelete') return <FolderDeleteSheet item={item} onClose={closeMenu} onDeleted={() => { if (loc.pathname === `/i/${item.id}`) nav(item.parent_id ? `/i/${item.parent_id}` : '/', { replace: true }) }} />
  if (sub === 'move') return <MoveSheet item={item} onClose={closeMenu} />
  if (sub === 'share') return <ShareSheet item={item} onClose={closeMenu} />
  if (sub === 'status') {
    return (
      <Sheet open onClose={closeMenu} title={t('menu.status')}>
        <div className="-mx-4"><StatusBar statuses={statuses} value={item.status_id} onChange={(sid) => { void updateItem(item.id, { status_id: sid }); closeMenu() }} wrap /></div>
      </Sheet>
    )
  }
  if (sub === 'tags') {
    return (
      <Sheet open onClose={closeMenu} title={t('menu.tags')}>
        <TagEditor item={item} />
        <div className="mt-5 flex justify-end"><Button variant="primary" onClick={closeMenu}>{t('common.done')}</Button></div>
      </Sheet>
    )
  }
  if (sub === 'due') return <DueSheet itemId={item.id} value={item.due_date} />
  if (sub === 'cover') {
    return (
      <Sheet open onClose={closeMenu} title={t('menu.cover')}>
        <div className="grid grid-cols-3 gap-1.5">
          {media.map((m) => (
            <button key={m.id} onClick={() => { void updateItem(item.id, { cover_media_id: m.id }); closeMenu() }} className={cx('relative aspect-square overflow-hidden rounded-xl', item.cover_media_id === m.id && 'ring-3 ring-accent')}>
              <Thumb media={m} className="h-full w-full" />
            </button>
          ))}
        </div>
        {item.cover_media_id && (
          <div className="mt-4 flex justify-end"><Button variant="ghost" onClick={() => { void updateItem(item.id, { cover_media_id: null }); closeMenu() }}>{t('menu.coverRemove')}</Button></div>
        )}
      </Sheet>
    )
  }

  // ---- the menu itself
  const list = (
    <div className="flex flex-col" role="menu">
      {actions.map((a) => (
        <button
          key={a.key}
          role="menuitem"
          disabled={a.disabled}
          onClick={a.run}
          className={cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] transition hover:bg-surface-2 disabled:opacity-40', a.danger && 'text-danger')}
        >
          <span className="opacity-80">{a.icon}</span>{a.label}
        </button>
      ))}
    </div>
  )
  if (desktop && pos) return <Popover pos={pos} onClose={closeMenu}>{list}</Popover>
  return (
    <Sheet open onClose={closeMenu} title={item.title}>
      {list}
    </Sheet>
  )
}

function Popover({ pos, onClose, children }: { pos: { x: number; y: number }; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [xy, setXy] = useState(pos)
  useEffect(() => {
    const el = ref.current
    if (el) {
      const r = el.getBoundingClientRect()
      setXy({ x: Math.max(8, Math.min(pos.x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(pos.y, innerHeight - r.height - 8)) })
    }
    const out = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const armOut = setTimeout(() => document.addEventListener('mousedown', out), 0)
    window.addEventListener('keydown', esc)
    // ignore the scroll that can land right after opening (e.g. the page settling)
    const armScroll = setTimeout(() => window.addEventListener('scroll', onClose, true), 300)
    return () => { clearTimeout(armOut); clearTimeout(armScroll); document.removeEventListener('mousedown', out); window.removeEventListener('keydown', esc); window.removeEventListener('scroll', onClose, true) }
  }, [pos, onClose])
  return createPortal(
    <div ref={ref} style={{ left: xy.x, top: xy.y }} className="rise fixed z-[96] w-60 rounded-2xl border border-line bg-surface p-1.5 shadow-lift">
      {children}
    </div>,
    document.body,
  )
}

function DueSheet({ itemId, value }: { itemId: string; value: string | null }) {
  const [v, setV] = useState(value ?? '')
  return (
    <Sheet open onClose={closeMenu} title={t('item.setDue')}>
      <Input type="date" value={v} onChange={(e) => setV(e.target.value)} />
      <div className="mt-4 flex justify-between gap-2">
        <Button variant="ghost" onClick={() => { void updateItem(itemId, { due_date: null }); closeMenu() }} disabled={!value}><X size={15} /> {t('item.clearDue')}</Button>
        <Button variant="primary" onClick={() => { void updateItem(itemId, { due_date: v || null }); closeMenu() }}>{t('common.save')}</Button>
      </div>
    </Sheet>
  )
}
