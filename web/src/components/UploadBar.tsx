import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { CloudUpload } from 'lucide-react'
import { useApp, type PendingUpload } from '../store/app'
import { t } from '../i18n'

const BIG = 32 * 1048576

export function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  return `${Math.max(1, Math.round(n / 1048576))} MB`
}

export function etaText(p: PendingUpload): string | null {
  if (!p.rate || p.rate < 1024 || p.status !== 'uploading') return null
  const secs = ((1 - p.progress) * p.size) / p.rate
  if (!Number.isFinite(secs) || secs < 0) return null
  const min = Math.max(1, Math.round(secs / 60))
  return min >= 60 ? t('upload.etaHours', { h: Math.floor(min / 60), m: min % 60 }) : t('upload.etaMin', { m: min })
}

/**
 * Long videos take a while on a phone: a pill at the bottom says what is uploading, how far (GB) and how long is left,
 * and that the app must stay open (Android pauses web apps in the background). While anything uploads and the app is
 * on screen, the screen is kept on (Wake Lock), so it does not lock and stop the upload.
 */
export function UploadBar() {
  const pending = useApp((s) => s.pending)
  const nav = useNavigate()
  const active = pending.filter((p) => p.status !== 'error')
  const uploading = active.some((p) => p.status === 'uploading')
  const lock = useRef<{ release: () => Promise<void> } | null>(null)

  useEffect(() => {
    type WL = { request: (k: 'screen') => Promise<{ release: () => Promise<void> }> }
    const wl = (navigator as Navigator & { wakeLock?: WL }).wakeLock
    if (!wl) return
    let off = false
    const take = () => {
      if (off || lock.current || document.visibilityState !== 'visible') return
      wl.request('screen').then((l) => { if (off) void l.release(); else { lock.current = l; (l as unknown as EventTarget).addEventListener?.('release', () => { lock.current = null }) } }).catch(() => {})
    }
    if (uploading) take()
    else if (lock.current) { void lock.current.release().catch(() => {}); lock.current = null }
    document.addEventListener('visibilitychange', take)
    return () => { off = true; document.removeEventListener('visibilitychange', take) }
  }, [uploading])
  useEffect(() => () => { void lock.current?.release().catch(() => {}) }, [])

  const big = active.filter((p) => p.size > BIG)
  if (!big.length) return null
  const cur = big.find((p) => p.status === 'uploading') ?? big[0]
  const eta = etaText(cur)
  const waiting = big.length - 1
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(3.9rem+env(safe-area-inset-top))] z-30 flex justify-center px-3">
      <button
        onClick={() => nav(`/i/${cur.itemId}`)}
        role="status"
        className="rise pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl bg-[#2a2017] px-3.5 py-2.5 text-left text-[13px] text-[#f3e9da] shadow-lift dark:bg-[#f3e9da] dark:text-[#2a2017]"
      >
        <CloudUpload size={18} className="shrink-0" />
        <span className="min-w-0">
          <span className="block font-medium">
            {cur.status === 'uploading'
              ? t('upload.barNow', { done: fmtBytes(cur.progress * cur.size), size: fmtBytes(cur.size) })
              : t('upload.barWaiting', { size: fmtBytes(cur.size) })}
            {eta ? ` · ${eta}` : ''}
            {waiting > 0 ? ` · ${t('upload.barMore', { n: waiting })}` : ''}
          </span>
          <span className="block opacity-75">{t('upload.keepOpen')}</span>
        </span>
      </button>
    </div>
  )
}
