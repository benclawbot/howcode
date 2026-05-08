import { QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import '@fontsource-variable/inter'
import './styles.css'
import App from './app'
import { applyStoredPiGuiTheme } from './app/app-shell/usePiGuiTheme'
import { installDevWebDesktopBridge } from './app/dev-web-bridge'
import { queryClient } from './app/query/query-client'
import {
  getRemoteBridgeUrl,
} from './app/hooks/useDesktopBridge'

// Always install the bridge for Pi-Mobile PWA and dev:web mode
// In Electron desktop, window.piDesktop already exists
// In Pi-Mobile or dev:web, we install the HTTP bridge client
if (!window.piDesktop) {
  installDevWebDesktopBridge()
  
  // Auto-detect remote bridge URL from current origin for Pi-Mobile
  const url = new URL(window.location.href)
  const isPiMobile = url.pathname === '/' && !window.location.port
  
  // For Pi-Mobile, save the remote bridge URL (not token - we'll get token from bridge)
  if (isPiMobile) {
    const remoteUrl = `http://100.69.199.38:5174`
    // Only save URL - the bridge will provide the actual token via /__howcode/config
    localStorage.setItem('pi-mobile-bridge-url', remoteUrl)
  }
}

// Debug: Log remote bridge status
console.log('[Pi-Mobile] Remote bridge URL:', getRemoteBridgeUrl())

try {
  applyStoredPiGuiTheme()
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  )
} catch (error) {
  const root = document.getElementById('root')
  if (root) {
    root.innerHTML = `<pre class="bootstrap-error">Bootstrap error:\n${String(error)}</pre>`
  }

  throw error
}
