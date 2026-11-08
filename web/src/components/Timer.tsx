import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { Maximize2, Pause, Play, X } from 'lucide-react'
import { useApp, startTimer, stopTimer } from '../store/app'
import { useItemsMap, useRunning, useTotals } from '../lib/hooks'
import { fmtClock, fmtDuration } from '../lib/time'
import { Hourglass } from './Hourglass'
import { Button, IconButton, cx } from './ui'
import { t } from '../i18n'

export function TimerCard({ itemId, hasChildren, onFullscreen }: { itemId: string; hasChildren: boolean; onFullscreen: () => void }) {
  const totals = useTotals()
  const byId = useItemsMap()
  const runningHere = totals.runningItemId === itemId
  const ticking = totals.runningChain.has(itemId)
  const total = totals.total(itemId)
  const own = totals.own(itemId)
  const childRunning = ticking && !runningHere ? byId.get(totals.runningItemId!) : null
  return (
    <div className={cx('relative overflow-hidden rounded-3xl p-4 transition sm:p-5', ticking ? 'bg-accent-soft' : 'border border-line bg-surface')}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <button onClick={onFullscreen} aria-label={t('timer.fullscreen')} className="shrink-0 transition active:scale-95">
          <Hourglass running={ticking} size={50} />
        </button>
        <div className="min-w-0 flex-1">
          <div className={cx('font-display text-[38px] font-semibold leading-none tabular sm:text-[42px]', ticking && 'text-accent-strong')}>
            {fmtClock(total)}
          </div>
          <div className="mt-1.5 truncate text-[13px] text-muted">
            {hasChildren ? (
              <>{t('timer.withSub')} · {t('timer.own')} {fmtDuration(own)}</>
            ) : (
              t('timer.total')
            )}
          </div>
          {childRunning && <div className="mt-1 truncate text-[13px] font-medium text-accent-strong">{t('timer.childRunning', { title: childRunning.title })}</div>}
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button
            variant={runningHere ? 'outline' : 'primary'}
            size="lg"
            className="flex-1 sm:w-[124px] sm:flex-none"
            onClick={() => (runningHere ? stopTimer() : startTimer(itemId))}
          >
            {runningHere ? <><Pause size={18} fill="currentColor" /> {t('timer.pause')}</> : <><Play size={18} fill="currentColor" /> {own > 0 ? t('timer.resume') : t('timer.start')}</>}
          </Button>
          <IconButton label={t('timer.fullscreen')} onClick={onFullscreen} className="h-12 w-12 border border-line"><Maximize2 size={18} /></IconButton>
        </div>
      </div>
    </div>
  )
}

export function FullscreenTimer({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const totals = useTotals()
  const item = useApp((s) => s.data.items.find((i) => i.id === itemId))
  const runningHere = totals.runningItemId === itemId
  const ticking = totals.runningChain.has(itemId)
  const [size, setSize] = useState(() => Math.min(window.innerHeight * 0.5, window.innerWidth * 0.6, 340))

  useEffect(() => {
    const h = () => setSize(Math.min(window.innerHeight * 0.5, window.innerWidth * 0.6, 340))
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === ' ') { e.preventDefault(); void (runningHere ? stopTimer() : startTimer(itemId)) }
    }
    window.addEventListener('resize', h)
    window.addEventListener('keydown', k)
    return () => { window.removeEventListener('resize', h); window.removeEventListener('keydown', k) }
  }, [onClose, runningHere, itemId])

  // Keep the screen on while the big timer is visible and running.
  useEffect(() => {
    if (!ticking || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    navigator.wakeLock.request('screen').then((l) => { lock = l }).catch(() => {})
    return () => { void lock?.release() }
  }, [ticking])

  return createPortal(
    <div className="fade fixed inset-0 z-[60] flex flex-col items-center justify-center bg-bg px-6 safe-top safe-bottom">
      <div className="gloss-only pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--sg-accent-soft),transparent_65%)] opacity-80" />
      <IconButton label={t('timer.close')} onClick={onClose} className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))]"><X size={22} /></IconButton>
      <div className="relative flex flex-col items-center">
        <Hourglass running={ticking} size={size * 0.75} />
        <div className={cx('mt-6 font-display text-6xl font-semibold tabular sm:text-7xl', ticking && 'text-accent-strong')}>{fmtClock(totals.total(itemId))}</div>
        <div className="mt-3 max-w-[80vw] truncate text-center text-lg text-muted">{item?.title}</div>
        <Button
          variant={runningHere ? 'outline' : 'primary'}
          size="lg"
          className="mt-8 h-14 w-44 text-base"
          onClick={() => (runningHere ? stopTimer() : startTimer(itemId))}
        >
          {runningHere ? <><Pause size={20} fill="currentColor" /> {t('timer.pause')}</> : <><Play size={20} fill="currentColor" /> {t('timer.start')}</>}
        </Button>
      </div>
    </div>,
    document.body,
  )
}

/** Floating chip showing the running timer anywhere in the app. */
export function RunningChip() {
  const running = useRunning()
  const byId = useItemsMap()
  const totals = useTotals()
  const loc = useLocation()
  if (!running) return null
  const item = byId.get(running.item_id)
  if (!item) return null
  const onItemPage = loc.pathname === `/i/${item.id}`
  if (onItemPage) return null
  const isItemRoute = loc.pathname.startsWith('/i/')
  return (
    <div className={cx('pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4', isItemRoute ? 'bottom-[calc(4.25rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(1.5rem+env(safe-area-inset-bottom))] justify-start pr-24 sm:justify-center sm:pr-4')}>
      <div className="rise pointer-events-auto flex max-w-md items-center gap-2 rounded-full bg-[#2a2017] py-1.5 pl-2 pr-1.5 text-[#f3e9da] shadow-lift dark:bg-[#f3e9da] dark:text-[#2a2017]">
        <Link to={`/i/${item.id}`} className="flex min-w-0 items-center gap-2 [--glass-line:#e8c79a] [--rim:#e8c79a] dark:[--glass-line:#7a5634] dark:[--rim:#7a5634]">
          <Hourglass running size={20} detail="lite" />
          <span className="min-w-0 max-w-[40vw] truncate text-sm font-medium">{item.title}</span>
          <span className="text-sm tabular opacity-80">{fmtClock(totals.own(item.id))}</span>
        </Link>
        <button onClick={() => stopTimer()} aria-label={t('timer.pause')} className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25 dark:bg-black/10">
          <Pause size={15} fill="currentColor" />
        </button>
      </div>
    </div>
  )
}
