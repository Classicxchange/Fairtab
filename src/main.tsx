/*
 *  ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗
 *  ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗
 *  ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║
 *  ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║
 *  ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝
 *  ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝
 *
 *  Built with Arc Studio
 *  https://studio.arc.io
 */

import './tracing'
import './console-capture'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectKitProvider } from 'connectkit'
import { Toaster } from 'sonner'
import { config } from './config'
import App from './App'
import AdminApp from './admin/AdminApp'
import './index.css'

// After a new deploy, a page opened before it can reference script files that no
// longer exist. Reload once to pick up the latest version instead of failing.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const key = 'fairtab_chunk_reload'
  if (sessionStorage.getItem(key) !== String(Math.floor(Date.now() / 60000))) {
    sessionStorage.setItem(key, String(Math.floor(Date.now() / 60000)))
    window.location.reload()
  }
})

const queryClient = new QueryClient()

// Route /auth/admin to AdminApp; everything else goes to the main App.
const isAdminRoute = window.location.pathname === '/auth/admin'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <ConnectKitProvider>
            {isAdminRoute ? <AdminApp /> : <App />}
            <Toaster position="top-center" />
          </ConnectKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </BrowserRouter>
  </StrictMode>,
)

