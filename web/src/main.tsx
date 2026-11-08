import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { applyTheme } from './lib/theme'
import App from './App'
import { setupUpdates } from './lib/updates'

applyTheme()
if (!location.pathname.startsWith('/s/')) setupUpdates()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Dev-only: ?seed=1 fills the local backend with demo content.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('seed')) {
  void import('./dev/seed').then((m) => m.seedDemo()).then(() => location.replace('/'))
}
