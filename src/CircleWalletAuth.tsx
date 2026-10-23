import { useState, useCallback } from 'react'
import {
  WebAuthnMode,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
  type WebAuthnCredential,
} from '@circle-fin/modular-wallets-core'
import { createPublicClient, type Hex } from 'viem'
import { arc } from 'viem/chains'
import { createBundlerClient, toWebAuthnAccount } from 'viem/account-abstraction'
import { Loader2, Fingerprint, LogOut } from 'lucide-react'
import { toast } from 'sonner'

// ─── Config ───────────────────────────────────────────────────────────────────
const clientKey = import.meta.env.VITE_CLIENT_KEY as string | undefined
const clientUrl = import.meta.env.VITE_CLIENT_URL as string | undefined

// ─── Lazy SDK init — only called when both env vars are present ───────────────
function getClients() {
  if (!clientKey || !clientUrl) return null
  try {
    const passkeyTransport = toPasskeyTransport(clientUrl, clientKey)
    const modularTransport = toModularTransport(`${clientUrl}/arc`, clientKey)
    const publicClient = createPublicClient({ chain: arc, transport: modularTransport })
    const bundlerClient = createBundlerClient({ chain: arc, transport: modularTransport })
    return { passkeyTransport, publicClient, bundlerClient }
  } catch {
    return null
  }
}

// ─── Session storage key ──────────────────────────────────────────────────────
const CRED_KEY = 'fairtab_circle_cred'

function saveCredential(cred: WebAuthnCredential) {
  sessionStorage.setItem(CRED_KEY, JSON.stringify(cred))
}

function loadCredential(): WebAuthnCredential | null {
  try {
    const raw = sessionStorage.getItem(CRED_KEY)
    return raw ? (JSON.parse(raw) as WebAuthnCredential) : null
  } catch { return null }
}

export function clearCredential() {
  sessionStorage.removeItem(CRED_KEY)
}

// ─── Restore session on mount ─────────────────────────────────────────────────
export async function restoreCircleSession(): Promise<{ address: Hex; bundler: ReturnType<typeof createBundlerClient> } | null> {
  const cred = loadCredential()
  if (!cred) return null
  const clients = getClients()
  if (!clients) return null
  try {
    const account = await toCircleSmartAccount({
      client: clients.publicClient,
      owner: toWebAuthnAccount({ credential: cred }),
    })
    return { address: account.address, bundler: clients.bundlerClient }
  } catch { return null }
}

// ─── CircleWalletAuth component ───────────────────────────────────────────────
interface Props {
  onConnected: (address: Hex, bundler: ReturnType<typeof createBundlerClient>) => void
  onDisconnected: () => void
  connectedAddress: Hex | null
}

export function CircleWalletAuth({ onConnected, onDisconnected, connectedAddress }: Props) {
  const [loading, setLoading] = useState(false)
  const configured = !!(clientKey && clientUrl)

  const handleRegister = useCallback(async () => {
    const clients = getClients()
    if (!clients) {
      toast.error('Circle Wallet not configured')
      return
    }
    setLoading(true)
    try {
      const credential = await toWebAuthnCredential({
        transport: clients.passkeyTransport,
        mode: WebAuthnMode.Register,
        username: `fairtab-${Date.now()}`,
      })
      saveCredential(credential)
      const account = await toCircleSmartAccount({
        client: clients.publicClient,
        owner: toWebAuthnAccount({ credential }),
      })
      onConnected(account.address, clients.bundlerClient)
      toast.success('Circle Wallet created')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('NotAllowedError') || msg.includes('cancelled')) {
        toast.error('Passkey cancelled')
      } else if (msg.includes('InvalidStateError')) {
        toast.error('Passkey already registered — use Sign In instead')
      } else {
        toast.error(`Circle Wallet error: ${msg}`)
      }
    } finally { setLoading(false) }
  }, [onConnected])

  const handleLogin = useCallback(async () => {
    const clients = getClients()
    if (!clients) {
      toast.error('Circle Wallet not configured')
      return
    }
    setLoading(true)
    try {
      const credential = await toWebAuthnCredential({
        transport: clients.passkeyTransport,
        mode: WebAuthnMode.Login,
      })
      saveCredential(credential)
      const account = await toCircleSmartAccount({
        client: clients.publicClient,
        owner: toWebAuthnAccount({ credential }),
      })
      onConnected(account.address, clients.bundlerClient)
      toast.success('Circle Wallet connected')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('NotAllowedError') || msg.includes('cancelled')) {
        toast.error('Passkey cancelled')
      } else {
        toast.error(`Circle Wallet error: ${msg}`)
      }
    } finally { setLoading(false) }
  }, [onConnected])

  const handleDisconnect = useCallback(() => {
    clearCredential()
    onDisconnected()
    toast.success('Circle Wallet disconnected')
  }, [onDisconnected])

  // ─── Connected state ───────────────────────────────────────────────────────
  if (connectedAddress) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
          style={{ background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}>
          <Fingerprint className="size-3.5" />
          <span>{connectedAddress.slice(0, 6)}…{connectedAddress.slice(-4)}</span>
        </div>
        <button
          onClick={handleDisconnect}
          className="flex items-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium transition-colors"
          style={{ color: 'var(--subtle)', background: 'var(--surface-muted)' }}
          title="Disconnect Circle Wallet"
        >
          <LogOut className="size-3" />
        </button>
      </div>
    )
  }

  // ─── Not configured — hide buttons entirely ────────────────────────────────
  if (!configured) return null

  // ─── Disconnected state ────────────────────────────────────────────────────
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => { void handleRegister() }}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50"
        style={{ background: 'var(--accent)', color: 'white' }}
      >
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Fingerprint className="size-3.5" />}
        New wallet
      </button>
      <button
        onClick={() => { void handleLogin() }}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50"
        style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
      >
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Fingerprint className="size-3.5" />}
        Sign in
      </button>
    </div>
  )
}
