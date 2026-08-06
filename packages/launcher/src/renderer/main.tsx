import './globals.css'
import './i18n'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initAnalytics } from './lib/analytics'
import { initPlatform } from './lib/platform'

initAnalytics()
// Before the first render: the window has no system title bar, and which edge
// has to make room for the window buttons depends on the OS.
initPlatform()

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Renderer mount point #root not found')

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
