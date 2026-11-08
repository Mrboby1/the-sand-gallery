import { useEffect, useState } from 'react'
import { HardDrive, Lock, LogOut } from 'lucide-react'
import { signIn, signOut, toast, useApp } from '../store/app'
import { backend } from '../lib/backend'
import { enterOffline, leaveOffline, takeAutoSignIn } from '../lib/offline'
import { Hourglass } from '../components/Hourglass'
import { Button, confirmDialog } from '../components/ui'
import { t } from '../i18n'

/** The explainer shown before anyone starts the offline version. Resolves true when they accept. */
export function explainOffline(): Promise<boolean> {
  return confirmDialog(t('offline.explain.title'), {
    body: t('offline.explain.body'),
    points: [t('offline.explain.p1'), t('offline.explain.p2'), t('offline.explain.p3'), t('offline.explain.p4'), t('offline.explain.p5')],
    okLabel: t('offline.explain.ok'),
  })
}

/** Error that Supabase put in the URL after the Google round trip (e.g. the allow-list hook refused the account). */
function takeAuthError(): 'private' | 'other' | null {
  const q = new URLSearchParams(location.search)
  const h = new URLSearchParams(location.hash.replace(/^#/, ''))
  const msg = q.get('error_description') ?? h.get('error_description') ?? q.get('error') ?? h.get('error')
  if (!msg) return null
  history.replaceState(null, '', location.pathname)
  return /not_allowed|private/i.test(msg) ? 'private' : 'other'
}

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

const choice = 'inline-flex h-13 w-full max-w-xs items-center justify-center gap-3 rounded-full px-6 py-3.5 text-[15px] font-medium transition active:scale-[0.98] disabled:opacity-60'

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
      <div className="gloss-only pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,var(--sg-accent-soft),transparent_60%)]" />
      <div className="rise relative flex w-full flex-col items-center">{children}</div>
    </div>
  )
}

export function Login() {
  const [busy, setBusy] = useState(false)
  const [authError] = useState(takeAuthError)
  const google = async () => {
    setBusy(true)
    try { await signIn() } catch (e) { toast(String((e as Error).message ?? e), 'error'); setBusy(false) }
  }
  // coming back from the offline version with "Sign in to the online version"
  useEffect(() => { if (backend.mode === 'cloud' && takeAutoSignIn()) void google() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (backend.mode === 'local') {
    // the offline version on this device, closed with "Leave"
    return (
      <Frame>
        <Hourglass running size={110} />
        <h1 className="mt-8 font-display text-[42px] font-semibold leading-none tracking-tight sm:text-5xl">{t('app.name')}</h1>
        <p className="mt-4 max-w-xs text-[17px] leading-relaxed text-muted">{t('offline.closedHint')}</p>
        <button onClick={() => void backend.signInWithGoogle()} className={`${choice} mt-10 bg-primary text-on-primary hover:opacity-95`}>
          <HardDrive size={18} /> {t('offline.open')}
        </button>
        <button onClick={() => leaveOffline(true)} className={`${choice} mt-3 border border-line bg-surface text-ink hover:bg-surface-2`}>
          <GoogleMark /> {t('offline.toOnline')}
        </button>
      </Frame>
    )
  }

  return (
    <Frame>
      <Hourglass running size={110} />
      <h1 className="mt-8 font-display text-[42px] font-semibold leading-none tracking-tight sm:text-5xl">{t('app.name')}</h1>
      <p className="mt-4 max-w-xs text-[17px] leading-relaxed text-muted">{t('app.tagline')}</p>
      {authError && (
        <div className="mt-6 flex max-w-xs items-start gap-2.5 rounded-2xl border border-line bg-surface px-4 py-3 text-left text-[14px] leading-relaxed">
          <Lock size={16} className="mt-0.5 shrink-0 text-accent-strong" />
          <span>{authError === 'private' ? t('access.refused') : t('access.signInFailed')}</span>
        </div>
      )}
      <button disabled={busy} onClick={google} className={`${choice} mt-10 border border-line bg-surface text-ink hover:bg-surface-2`}>
        <GoogleMark /> {busy ? t('login.signing') : t('login.google')}
      </button>
      <p className="mt-2 max-w-xs text-[12.5px] text-muted">{t('login.privateHint')}</p>
      <div className="my-6 flex w-full max-w-xs items-center gap-3 text-[12px] uppercase tracking-wider text-muted">
        <span className="h-px flex-1 bg-line" />{t('login.or')}<span className="h-px flex-1 bg-line" />
      </div>
      <button onClick={async () => { if (await explainOffline()) enterOffline() }} className={`${choice} bg-primary text-on-primary hover:opacity-95`}>
        <HardDrive size={18} /> {t('offline.use')}
      </button>
      <p className="mt-2 max-w-xs text-[12.5px] text-muted">{t('offline.useHint')}</p>
    </Frame>
  )
}

/** Signed in to the online version with an account that is not on the allow-list. */
export function NotAllowed() {
  const email = useApp((s) => s.access?.email ?? s.user?.email ?? '')
  return (
    <Frame>
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent-strong"><Lock size={28} /></div>
      <h1 className="mt-6 font-display text-3xl font-semibold">{t('access.title')}</h1>
      <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-muted">{t('access.body', { email })}</p>
      <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-muted">{t('access.offline')}</p>
      <button
        onClick={async () => {
          if (!(await explainOffline())) return
          await signOut().catch(() => {})
          enterOffline()
        }}
        className={`${choice} mt-8 bg-primary text-on-primary hover:opacity-95`}
      >
        <HardDrive size={18} /> {t('offline.use')}
      </button>
      <Button variant="ghost" className="mt-3" onClick={() => signOut()}><LogOut size={16} /> {t('access.other')}</Button>
    </Frame>
  )
}
