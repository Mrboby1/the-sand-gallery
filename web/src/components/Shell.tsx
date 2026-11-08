import { type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Moon, RefreshCw, Search, Settings as SettingsIcon, Sun, WifiOff, X } from 'lucide-react'
import { useState } from 'react'
import { setTheme } from '../lib/theme'
import { useApp, checkHealth, dismissToast, wakeUp } from '../store/app'
import { Hourglass } from './Hourglass'
import { Button, IconButton, cx } from './ui'
import { t } from '../i18n'

export function TopBar({ back, title, children, crumbs }: { back?: string | true; title?: ReactNode; children?: ReactNode; crumbs?: ReactNode }) {
  const nav = useNavigate()
  return (
    <header className="sticky top-0 z-20 border-b border-line/50 bg-bg/80 backdrop-blur-xl safe-top">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-2 sm:px-4">
        {back ? (
          <IconButton label={t('nav.back')} onClick={() => (back === true ? nav(-1) : nav(back))}><ArrowLeft size={21} /></IconButton>
        ) : (
          <Link to="/" className="mr-1 flex items-center gap-2 pl-1.5">
            <Hourglass size={22} detail="lite" />
            <span className="font-display text-[19px] font-semibold tracking-tight">{t('app.name')}</span>
          </Link>
        )}
        <div className="min-w-0 flex-1">
          {crumbs}
          {title && <div className="truncate font-display text-lg font-semibold">{title}</div>}
        </div>
        {children}
      </div>
    </header>
  )
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark')
  return (
    <button
      aria-label={dark ? t('settings.theme.light') : t('settings.theme.dark')}
      title={dark ? t('settings.theme.light') : t('settings.theme.dark')}
      onClick={() => { const next = !dark; setTheme(next ? 'dark' : 'light'); setDark(next) }}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-2"
    >
      {dark ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  )
}

export function HeaderActions() {
  return (
    <>
      <ThemeToggle />
      <Link to="/search" aria-label={t('nav.search')} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-2"><Search size={20} /></Link>
      <Link to="/settings" aria-label={t('nav.settings')} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-2"><SettingsIcon size={20} /></Link>
    </>
  )
}

export function WakeLayer() {
  const health = useApp((s) => s.health)
  const err = useApp((s) => s.wakeError)
  if (health === 'up') return null
  if (health === 'waking') {
    return (
      <div className="fade fixed inset-0 z-[80] flex flex-col items-center justify-center bg-bg px-8 text-center">
        <div className="relative flex flex-col items-center">
          <Hourglass running size={130} />
          <h2 className="mt-8 font-display text-2xl font-semibold">{t('wake.waking')}</h2>
          <p className="mt-2 max-w-xs text-muted">{t('wake.wakingBody')}</p>
          <div className="mt-6 h-1 w-48 overflow-hidden rounded-full bg-line">
            <div className="h-full w-1/3 animate-[wakebar_1.8s_ease-in-out_infinite] rounded-full bg-accent" />
          </div>
          {err && <p className="mt-4 text-sm text-danger">{t('wake.failed', { error: err })}</p>}
        </div>
        <style>{`@keyframes wakebar { 0% { transform: translateX(-100%) } 100% { transform: translateX(300%) } }`}</style>
      </div>
    )
  }
  return (
    <div className="sticky top-0 z-40 px-3 pt-[calc(0.5rem+env(safe-area-inset-top))]">
      <div className="rise mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-[#2a2017] px-4 py-3 text-[#f3e9da] shadow-lift dark:bg-[#f3e9da] dark:text-[#2a2017]">
        {health === 'asleep' ? (
          <>
            <span className="[--glass-line:#e8c79a] [--rim:#e8c79a]"><Hourglass size={22} detail="lite" /></span>
            <span className="flex-1 text-[15px] font-medium">{t('wake.asleep')}</span>
            <Button size="sm" variant="primary" onClick={() => void wakeUp()}>{t('wake.button')}</Button>
          </>
        ) : (
          <>
            <WifiOff size={18} />
            <span className="flex-1 text-sm">{t('wake.offline')}</span>
            <Button size="sm" variant="soft" className="!bg-white/15 !text-inherit" onClick={() => void checkHealth()}><RefreshCw size={14} /> {t('wake.retry')}</Button>
          </>
        )}
      </div>
      {err && health === 'asleep' && <p className="mx-auto mt-2 max-w-xl text-center text-sm text-danger">{t('wake.failed', { error: err })}</p>}
    </div>
  )
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(4rem+env(safe-area-inset-top))] z-[90] flex flex-col items-center gap-2 px-4">
      {toasts.map((x) => (
        <div key={x.id} className={cx('rise pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-2.5 text-sm shadow-lift', x.tone === 'error' ? 'bg-danger text-white' : 'bg-[#2a2017] text-[#f3e9da] dark:bg-[#f3e9da] dark:text-[#2a2017]')}>
          <span className="min-w-0 flex-1 break-words">{x.text}</span>
          {x.action && <button className="font-semibold underline" onClick={() => { x.action!.run(); dismissToast(x.id) }}>{x.action.label}</button>}
          <button aria-label={t('common.close')} onClick={() => dismissToast(x.id)} className="opacity-70 hover:opacity-100"><X size={15} /></button>
        </div>
      ))}
    </div>
  )
}
