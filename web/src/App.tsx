import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useApp, boot, takeAfterLogin } from './store/app'
import { Home } from './pages/Home'
import { ItemPage } from './pages/ItemPage'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'
import { DayPage } from './pages/DayPage'
import { FeaturesPage } from './pages/FeaturesPage'
import { SharePage } from './pages/SharePage'
import { Login, NotAllowed } from './pages/Login'
import { Toasts, WakeLayer } from './components/Shell'
import { UploadBar } from './components/UploadBar'
import { RunningChip } from './components/Timer'
import { ItemMenuHost } from './components/ItemMenu'
import { TimerNotifier } from './components/TimerNotifier'
import { LookApplier } from './lib/look'
import { DialogHost } from './components/ui'
import { Hourglass } from './components/Hourglass'
import { t } from './i18n'

function Gate() {
  const phase = useApp((s) => s.phase)
  const health = useApp((s) => s.health)
  const loc = useLocation()
  const nav = useNavigate()
  useEffect(() => { void boot() }, [])
  // After the Google round trip, go back to the page that was open when signing in.
  useEffect(() => {
    if (phase !== 'ready') return
    const next = takeAfterLogin()
    if (next && next !== loc.pathname) nav(next, { replace: true })
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps
  if (loc.pathname.startsWith('/s/')) return null
  if (phase === 'booting' || (phase === 'loading' && health === 'up')) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4">
        <Hourglass running size={64} />
        <span className="text-sm text-muted">{t('common.loading')}</span>
      </div>
    )
  }
  if (phase === 'signedOut') return <Login />
  if (phase === 'notAllowed') return <NotAllowed />
  if (phase !== 'ready') {
    if (health !== 'unreachable') return null
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <Hourglass size={64} />
        <p className="max-w-xs text-muted">{t('offline.noCache')}</p>
      </div>
    )
  }
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/i/:id" element={<ItemPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/day" element={<DayPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/features" element={<FeaturesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <RunningChip />
      <ItemMenuHost />
      <TimerNotifier />
      <LookApplier />
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/s/:token" element={<SharePage />} />
        <Route path="*" element={<><WakeLayer /><Gate /><UploadBar /></>} />
      </Routes>
      <Toasts />
      <DialogHost />
    </BrowserRouter>
  )
}
