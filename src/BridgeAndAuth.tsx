/**
 * BridgeView — crosschain USDC deposits and transfers via Circle App Kit + CCTP
 * PasskeyAuth — Circle Modular Wallets passkey sign-in (Google/email via WebAuthn)
 */
import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAccount, useSwitchChain } from 'wagmi'
import {
  ArrowLeftRight, CheckCircle2, Loader2, AlertTriangle,
  ExternalLink, ChevronDown, KeyRound, UserPlus, LogIn,
  ShieldCheck, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { isAddress, type EIP1193Provider } from 'viem'
import {
  WebAuthnMode,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
} from '@circle-fin/modular-wallets-core'
import { toWebAuthnAccount } from 'viem/account-abstraction'
import { createPublicClient } from 'viem'
import { arcTestnet } from 'viem/chains'
import { BRIDGE_CHAINS, type BridgeChain } from '@/config'
import { formatUsdc, parseUsdc } from '@/onchain-money'

// ─── App Kit singleton ───────────────────────────────────────────────────────
const appKit = new AppKit()

// ─── Modular Wallets setup ───────────────────────────────────────────────────
const clientKey  = import.meta.env.VITE_CLIENT_KEY  as string | undefined
const clientUrl  = import.meta.env.VITE_CLIENT_URL  as string | undefined

function getModularClients() {
  if (!clientKey || !clientUrl) return null
  const passkeyTransport  = toPasskeyTransport(clientUrl, clientKey)
  const modularTransport  = toModularTransport(`${clientUrl}/arcTestnet`, clientKey)
  const publicClient = createPublicClient({ chain: arcTestnet, transport: modularTransport })
  return { passkeyTransport, publicClient }
}

// ─── Shared glass tokens (keep in sync with App.tsx) ─────────────────────────
const glass = {
  card: {
    background: 'rgba(255,255,255,0.05)',
    backdropFilter: 'blur(24px) saturate(140%)',
    WebkitBackdropFilter: 'blur(24px) saturate(140%)',
    border: '1px solid rgba(90,160,255,0.14)',
    borderRadius: '20px',
  } as React.CSSProperties,
  inner: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(90,160,255,0.10)',
    borderRadius: '14px',
  } as React.CSSProperties,
}
const spectral = 'linear-gradient(90deg, #2dd87a 0%, #5fbeff 33%, #af8ff4 66%, #f05c6b 100%)'
const fadeUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.22, ease: [0.25, 0.1, 0.25, 1] as [number,number,number,number] },
}

// ─── Step tracker ────────────────────────────────────────────────────────────
type StepName = 'approve' | 'burn' | 'fetchAttestation' | 'mint'
type StepState = 'idle' | 'pending' | 'success' | 'error'
interface StepStatus { name: StepName; state: StepState; txHash?: string; explorerUrl?: string }

const STEP_LABELS: Record<StepName, string> = {
  approve:          'Approve USDC',
  burn:             'Burn on source',
  fetchAttestation: 'Circle attestation',
  mint:             'Mint on destination',
}

function StepRow({ step }: { step: StepStatus }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="size-7 flex items-center justify-center rounded-full shrink-0"
        style={{
          background: step.state === 'success' ? 'var(--success-bg)'
            : step.state === 'pending' ? 'rgba(59,142,248,0.12)'
            : step.state === 'error'   ? 'var(--danger-bg)'
            : 'var(--surface-muted)',
        }}>
        {step.state === 'success' && <CheckCircle2 className="size-4" style={{ color: 'var(--success)' }} />}
        {step.state === 'pending' && <Loader2 className="size-4 animate-spin" style={{ color: 'var(--accent)' }} />}
        {step.state === 'error'   && <AlertTriangle className="size-4" style={{ color: 'var(--danger)' }} />}
        {step.state === 'idle'    && <div className="size-2 rounded-full" style={{ background: 'var(--subtle)' }} />}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium" style={{ color: step.state === 'idle' ? 'var(--subtle)' : 'var(--ink)' }}>
          {STEP_LABELS[step.name]}
        </p>
      </div>
      {step.explorerUrl && (
        <a href={step.explorerUrl} target="_blank" rel="noopener noreferrer"
          className="text-xs flex items-center gap-1" style={{ color: 'var(--accent)' }}>
          Tx <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  )
}

// ─── Chain selector ──────────────────────────────────────────────────────────
function ChainSelect({ value, onChange, exclude }: {
  value: typeof BRIDGE_CHAINS[number]
  onChange: (c: typeof BRIDGE_CHAINS[number]) => void
  exclude?: number
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold w-full"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(90,160,255,0.16)', color: 'var(--ink)' }}>
        <span className="flex-1 text-left">{value.label}</span>
        <ChevronDown className="size-4 shrink-0" style={{ color: 'var(--muted)' }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="absolute z-50 left-0 right-0 mt-1 rounded-xl overflow-hidden py-1"
            style={{ background: 'rgba(10,18,34,0.97)', backdropFilter: 'blur(24px)', border: '1px solid rgba(90,160,255,0.18)' }}
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}>
            {BRIDGE_CHAINS.filter(c => c.chainId !== exclude).map(c => (
              <button key={c.chainId} onClick={() => { onChange(c); setOpen(false) }}
                className="w-full text-left px-4 py-2.5 text-sm transition-all hover:bg-white/5"
                style={{ color: c.chainId === value.chainId ? 'var(--accent)' : 'var(--ink)' }}>
                {c.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// BRIDGE VIEW
// ═══════════════════════════════════════════════════════════════════════════════
export function BridgeView() {
  const { connector, address } = useAccount()
  const { switchChainAsync } = useSwitchChain()

  const [fromChain, setFromChain] = useState<BridgeChain>(BRIDGE_CHAINS[0])
  const [toChain,   setToChain]   = useState<BridgeChain>(BRIDGE_CHAINS[1])
  const [amount, setAmount]       = useState('')
  const [toAddress, setToAddress] = useState(address ?? '')
  const [steps, setSteps]         = useState<StepStatus[]>([])
  const [bridging, setBridging]   = useState(false)
  const [done, setDone]           = useState(false)

  const initSteps = (): StepStatus[] => ([
    { name: 'approve',          state: 'idle' },
    { name: 'burn',             state: 'idle' },
    { name: 'fetchAttestation', state: 'idle' },
    { name: 'mint',             state: 'idle' },
  ])

  const updateStep = useCallback((name: StepName, patch: Partial<StepStatus>) => {
    setSteps(prev => prev.map(s => s.name === name ? { ...s, ...patch } : s))
  }, [])

  const handleSwap = () => {
    const prev = fromChain
    setFromChain(toChain)
    setToChain(prev)
  }

  const handleBridge = async () => {
    if (!connector || !address) { toast.error('Connect a wallet first'); return }
    if (!amount || Number(amount) <= 0) { toast.error('Enter an amount'); return }
    const trimmed = toAddress.trim()
    if (trimmed && !isAddress(trimmed)) { toast.error('Destination must be a valid 0x address'); return }
    const dest = (trimmed || address) as `0x${string}`

    setBridging(true)
    setDone(false)
    setSteps(initSteps())

    try {
      await switchChainAsync({ chainId: fromChain.chainId })
      const provider = await connector.getProvider() as EIP1193Provider
      const adapter  = await createViemAdapterFromProvider({ provider })

      // Show approve as in-progress immediately
      updateStep('approve', { state: 'pending' })

      const result = await appKit.bridge({
        from: { adapter, chain: fromChain.kitName },
        to:   { adapter, chain: toChain.kitName, address: dest },
        amount,
      })

      // Sync all step final states from result
      const stepNames = Object.keys(STEP_LABELS)
      for (const step of result.steps as Array<{ name: string; state: string; txHash?: string; explorerUrl?: string }>) {
        if (stepNames.includes(step.name)) {
          updateStep(step.name as StepName, {
            state: step.state === 'success' ? 'success' : step.state === 'pending' ? 'pending' : 'error',
            txHash: step.txHash,
            explorerUrl: step.explorerUrl,
          })
        }
      }

      if (result.state === 'success') {
        setDone(true)
        toast.success(`Bridged ${amount} USDC to ${toChain.label}!`)
      } else {
        toast.error('Bridge did not complete — check steps below')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bridge failed')
    } finally {
      setBridging(false)
    }
  }

  const amountNum = Number(amount)
  const canBridge = !!connector && !!address && amountNum > 0 && fromChain.chainId !== toChain.chainId && !bridging

  return (
    <motion.div className="max-w-lg mx-auto flex flex-col gap-5" {...fadeUp}>
      {/* Header */}
      <div>
        <h2 className="display text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
          Cross-chain Transfer
        </h2>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Move USDC between chains instantly via CCTP. Fast mode: ~10–20 seconds.
        </p>
      </div>

      {/* Transfer card */}
      <div className="rounded-2xl p-5 flex flex-col gap-4 relative overflow-hidden" style={glass.card}>
        <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: spectral }} />

        {/* From chain */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>From</p>
          <ChainSelect value={fromChain} onChange={setFromChain} exclude={toChain.chainId} />
        </div>

        {/* Swap button */}
        <div className="flex justify-center">
          <button onClick={handleSwap} disabled={bridging}
            className="flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-all hover:scale-105 active:scale-95 disabled:opacity-40"
            style={{ background: 'rgba(59,142,248,0.12)', color: 'var(--accent)', border: '1px solid rgba(90,160,255,0.18)' }}>
            <ArrowLeftRight className="size-4" /> Swap chains
          </button>
        </div>

        {/* To chain */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>To</p>
          <ChainSelect value={toChain} onChange={setToChain} exclude={fromChain.chainId} />
        </div>

        {/* Amount */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>Amount (USDC)</p>
          <div className="flex items-center gap-2 rounded-xl px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(90,160,255,0.14)' }}>
            <input
              type="number" min="0" step="0.01" placeholder="0.00"
              value={amount} onChange={e => setAmount(e.target.value)}
              className="flex-1 bg-transparent text-xl font-bold tabular-nums outline-none"
              style={{ color: 'var(--ink)', fontFamily: 'Space Grotesk, sans-serif' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>USDC</span>
          </div>
        </div>

        {/* Destination override */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>
            Destination address <span style={{ color: 'var(--subtle)', fontWeight: 400 }}>(defaults to your wallet)</span>
          </p>
          <input
            type="text" placeholder={address ?? '0x…'}
            value={toAddress} onChange={e => setToAddress(e.target.value)}
            className="w-full rounded-xl px-4 py-3 text-sm font-mono outline-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(90,160,255,0.14)', color: 'var(--ink)' }} />
        </div>

        {/* Bridge button */}
        <button onClick={() => void handleBridge()} disabled={!canBridge}
          className="w-full rounded-xl py-3.5 text-sm font-bold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#080f1a', boxShadow: canBridge ? '0 0 20px rgba(59,142,248,0.25)' : 'none' }}>
          {bridging ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Bridging…
            </span>
          ) : done ? (
            <span className="flex items-center justify-center gap-2">
              <CheckCircle2 className="size-4" /> Bridge complete!
            </span>
          ) : (
            `Bridge USDC → ${toChain.label}`
          )}
        </button>
      </div>

      {/* Step tracker */}
      <AnimatePresence>
        {steps.length > 0 && (
          <motion.div className="rounded-2xl p-4" style={glass.card}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--subtle)' }}>
              Transfer progress
            </p>
            <div className="divide-y" style={{ borderColor: 'rgba(90,160,255,0.08)' }}>
              {steps.map(s => <StepRow key={s.name} step={s} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Info strip */}
      <div className="rounded-xl px-4 py-3 flex items-start gap-3" style={glass.inner}>
        <Zap className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
        <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
          Powered by Circle CCTP v2. Fast mode completes in ~10–20 seconds. No bridging fee beyond the source-chain gas. USDC lands natively on the destination chain.
        </p>
      </div>
    </motion.div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PASSKEY AUTH (Circle Modular Wallets — passkey / email sign-in)
// ═══════════════════════════════════════════════════════════════════════════════
type AuthMode = 'idle' | 'register' | 'login'

interface PasskeySession {
  address: string
  username: string
}

interface PasskeyAuthProps {
  onSignedIn: (session: PasskeySession) => void
  onSignOut: () => void
  session: PasskeySession | null
}

export function PasskeyAuth({ onSignedIn, onSignOut, session }: PasskeyAuthProps) {
  const [mode, setMode] = useState<AuthMode>('idle')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clients = getModularClients()
  const isConfigured = !!clients && !!clientKey

  const handleRegister = async () => {
    if (!clients) return
    setLoading(true); setError(null)
    try {
      const credential = await toWebAuthnCredential({
        transport: clients.passkeyTransport,
        mode: WebAuthnMode.Register,
        username: username.trim() || 'fairtab-user',
      })
      localStorage.setItem('fairtab_passkey', JSON.stringify(credential))
      const account = await toCircleSmartAccount({
        client: clients.publicClient,
        owner: toWebAuthnAccount({ credential }),
      })
      const sess: PasskeySession = { address: account.address, username: username.trim() || 'fairtab-user' }
      localStorage.setItem('fairtab_session', JSON.stringify(sess))
      onSignedIn(sess)
      toast.success('Passkey created! Wallet ready.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Registration failed'
      setError(msg)
      toast.error(msg)
    } finally { setLoading(false) }
  }

  const handleLogin = async () => {
    if (!clients) return
    setLoading(true); setError(null)
    try {
      const credential = await toWebAuthnCredential({
        transport: clients.passkeyTransport,
        mode: WebAuthnMode.Login,
      })
      localStorage.setItem('fairtab_passkey', JSON.stringify(credential))
      const account = await toCircleSmartAccount({
        client: clients.publicClient,
        owner: toWebAuthnAccount({ credential }),
      })
      const sess: PasskeySession = { address: account.address, username: 'fairtab-user' }
      localStorage.setItem('fairtab_session', JSON.stringify(sess))
      onSignedIn(sess)
      toast.success('Signed in!')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Login failed'
      setError(msg)
      toast.error(msg)
    } finally { setLoading(false) }
  }

  if (session) {
    return (
      <motion.div className="rounded-2xl p-5 relative overflow-hidden" style={glass.card} {...fadeUp}>
        <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: spectral }} />
        <div className="flex items-center gap-3 mb-4">
          <div className="size-10 rounded-2xl flex items-center justify-center"
            style={{ background: 'var(--success-bg)', border: '1px solid rgba(45,216,122,0.2)' }}>
            <ShieldCheck className="size-5" style={{ color: 'var(--success)' }} />
          </div>
          <div>
            <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{session.username}</p>
            <p className="text-xs mono mt-0.5" style={{ color: 'var(--muted)' }}>
              {session.address.slice(0, 10)}…{session.address.slice(-6)}
            </p>
          </div>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>
          Signed in with passkey. This is a smart account — gas is sponsored.
        </p>
        <button onClick={onSignOut}
          className="w-full rounded-xl py-2.5 text-sm font-semibold"
          style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid rgba(240,98,146,0.15)' }}>
          Sign out
        </button>
      </motion.div>
    )
  }

  if (!isConfigured) {
    return (
      <motion.div className="rounded-2xl p-5 relative overflow-hidden" style={glass.card} {...fadeUp}>
        <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: spectral }} />
        <div className="flex items-center gap-3 mb-3">
          <KeyRound className="size-5" style={{ color: 'var(--muted)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Passkey sign-in</p>
        </div>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
          Paste your <span style={{ color: 'var(--accent)' }}>VITE_CLIENT_KEY</span> into <code className="mono">.env</code> to enable passkey sign-in.
          Get it from Circle Console → Keys → Client Keys.
        </p>
      </motion.div>
    )
  }

  return (
    <motion.div className="rounded-2xl p-5 relative overflow-hidden" style={glass.card} {...fadeUp}>
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: spectral }} />

      <div className="flex items-center gap-3 mb-4">
        <div className="size-10 rounded-2xl flex items-center justify-center"
          style={{ background: 'rgba(59,142,248,0.10)', border: '1px solid rgba(90,160,255,0.18)' }}>
          <KeyRound className="size-5" style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Passkey sign-in</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>No password, no seed phrase</p>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {mode === 'idle' && (
          <motion.div key="idle" className="flex flex-col gap-2"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button onClick={() => setMode('register')}
              className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all hover:scale-[1.01]"
              style={{ background: 'var(--accent)', color: '#080f1a' }}>
              <UserPlus className="size-4" /> Create account with passkey
            </button>
            <button onClick={() => setMode('login')}
              className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all hover:bg-white/5"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
              <LogIn className="size-4" /> Sign in with existing passkey
            </button>
          </motion.div>
        )}

        {mode === 'register' && (
          <motion.div key="register" className="flex flex-col gap-3"
            initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
            <div>
              <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--subtle)' }}>Display name (optional)</p>
              <input type="text" placeholder="e.g. alice"
                value={username} onChange={e => setUsername(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(90,160,255,0.14)', color: 'var(--ink)' }} />
            </div>
            {error && <p className="text-xs px-1" style={{ color: 'var(--danger)' }}>{error}</p>}
            <button onClick={() => void handleRegister()} disabled={loading}
              className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#080f1a' }}>
              {loading ? <Loader2 className="size-4 animate-spin inline" /> : 'Register passkey'}
            </button>
            <button onClick={() => { setMode('idle'); setError(null) }}
              className="text-xs text-center" style={{ color: 'var(--subtle)' }}>← Back</button>
          </motion.div>
        )}

        {mode === 'login' && (
          <motion.div key="login" className="flex flex-col gap-3"
            initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Your device will prompt you to use a saved passkey.
            </p>
            {error && <p className="text-xs px-1" style={{ color: 'var(--danger)' }}>{error}</p>}
            <button onClick={() => void handleLogin()} disabled={loading}
              className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#080f1a' }}>
              {loading ? <Loader2 className="size-4 animate-spin inline" /> : 'Sign in with passkey'}
            </button>
            <button onClick={() => { setMode('idle'); setError(null) }}
              className="text-xs text-center" style={{ color: 'var(--subtle)' }}>← Back</button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── Re-export formatUsdc so callers don't need two imports ──────────────────
export { formatUsdc, parseUsdc }
