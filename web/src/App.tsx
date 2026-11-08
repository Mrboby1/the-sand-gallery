import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useApp, boot } from './store/app'
import { Home } from './pages/Home'
import { ItemPage } from './pages/ItemPage'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'
import { SharePage } from './pages/SharePage'
import { Login } from './pages/Login'
import { Toasts, WakeLayer } from './components/Shell'
import { RunningChip } from './components/Timer'
import { DialogHost } from './components/ui'
import { Hourglass } from './components/Hourglass'
import { t } from './i18n'

function Gate() {
  const phase = useApp((s) => s.phase)
  const health = useApp((s) => s.health)
  const loc = useLocation()
  useEffect(() => { void boot() }, [])
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
  if (phase !== 'ready') return null
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/i/:id" element={<ItemPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <RunningChip />
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/s/:token" element={<SharePage />} />
        <Route path="*" element={<><WakeLayer /><Gate /></>} />
      </Routes>
      <Toasts />
      <DialogHost />
    </BrowserRouter>
  )
}
