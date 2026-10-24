/**
 * AccountView — unified sign-in: Google OAuth, Email OTP, and Passkey.
 *
 * Google + Email OTP use Circle's User-Controlled Wallets SDK (w3s-pw-web-sdk).
 * Passkey uses Circle Modular Wallets (modular-wallets-core).
 *
 * Prerequisites in Circle Console:
 *  - Wallets → User Controlled → Configurator → copy App ID → VITE_CIRCLE_APP_ID
 *  - Auth Methods → Social Logins → add Google Client ID → VITE_GOOGLE_CLIENT_ID
 *  - Auth Methods → Email OTP → configure SMTP
 */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Mail, LogIn, LogOut, KeyRound, UserPlus,
  Loader2, ShieldCheck, Copy, CheckCircle2,
} from 'lucide-react'
import {
  toCircleSmartAccount,
  toModularTransport,
  toWebAuthnCredential,
  WebAuthnMode,
} from '@circle-fin/modular-wallets-core'
import { toWebAuthnAccount } from 'viem/account-abstraction'
import { createPublicClient } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import { IS_MAINNET } from '@/config'

const activeChain = IS_MAINNET ? arc : arcTestnet

// ── Env ───────────────────────────────────────────────────────────────────────
const appId      = import.meta.env.VITE_CIRCLE_APP_ID     as string | undefined
const googleId   = import.meta.env.VITE_GOOGLE_CLIENT_ID  as string | undefined
const clientKey  = import.meta.env.VITE_CLIENT_KEY        as string | undefined
const clientUrl  = import.meta.env.VITE_CLIENT_URL        as string | undefined

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AccountSession {
  address: string
  username: string
  method: 'google' | 'email' | 'passkey' | 'seed-wallet'
  /** only set for user-controlled wallets */
  userToken?: string
  encryptionKey?: string
  walletId?: string
}

type SignInMethod = 'google' | 'email' | 'passkey'
type Step = 'choose' | 'email-input' | 'email-otp' | 'passkey-register' | 'passkey-login' | 'loading' | 'done'

// ── Shared glass tokens ────────────────────────────────────────────────────────
const spectral = 'linear-gradient(90deg,#3b8ef8,#818cf8,#e879f9,#f97316)'
const glass = {
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(90,160,255,0.14)',
    backdropFilter: 'blur(16px)',
    boxShadow: '0 4px 32px rgba(0,0,0,0.35)',
  } as React.CSSProperties,
  inner: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(90,160,255,0.08)',
  } as React.CSSProperties,
}
const fadeUp = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 } }

// ── Passkey (Modular Wallets) helpers ─────────────────────────────────────────
function getModularClients() {
  if (!clientKey || !clientUrl) return null
  const transport = toModularTransport(clientUrl, clientKey)
  return {
    passkeyTransport: transport,
    publicClient: createPublicClient({ chain: activeChain, transport }),
  }
}

// ── Google SVG icon ───────────────────────────────────────────────────────────
function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <path d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z" fill="#FFC107"/>
      <path d="M6.3 14.7l7 5.1C15.2 16.1 19.3 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 7.4 6.3 14.7z" fill="#FF3D00"/>
      <path d="M24 46c5.5 0 10.5-2 14.3-5.4l-6.6-5.6C29.5 36.9 26.9 38 24 38c-6 0-11.1-4-13-9.5l-7 5.3C7.8 41.8 15.4 46 24 46z" fill="#4CAF50"/>
      <path d="M44.5 20H24v8.5h11.8c-.8 2.4-2.4 4.5-4.4 6l6.6 5.6C41.1 37.1 45 31 45 24c0-1.3-.2-2.7-.5-4z" fill="#1976D2"/>
    </svg>
  )
}

// ── Copy-address button ───────────────────────────────────────────────────────
function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button onClick={copy} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-all hover:opacity-80"
      style={{ background: 'rgba(90,160,255,0.08)', color: 'var(--subtle)', border: '1px solid rgba(90,160,255,0.12)' }}>
      {copied ? <CheckCircle2 className="size-3" style={{ color: 'var(--success)' }} /> : <Copy className="size-3" />}
      {copied ? 'Copied' : address.slice(0, 8) + '…' + address.slice(-6)}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
interface AccountViewProps {
  session: AccountSession | null
  onSignedIn: (s: AccountSession) => void
  onSignOut: () => void
}

export function AccountView({ session, onSignedIn, onSignOut }: AccountViewProps) {
  const [step, setStep]               = useState<Step>('choose')
  const [method, setMethod]           = useState<SignInMethod>('google')
  const [email, setEmail]             = useState('')
  const [deviceId, setDeviceId]       = useState('')
  const [otpTokens, setOtpTokens]     = useState<{ deviceToken: string; deviceEncryptionKey: string; otpToken: string } | null>(null)
  const [loginResult, setLoginResult] = useState<{ userToken: string; encryptionKey: string } | null>(null)
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [passkeyName, setPasskeyName] = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  interface W3SSdkLike {
    getDeviceId(): Promise<string>
    updateConfigs(cfg: unknown): void
    performLogin(provider: string): void
    verifyOtp(): void
    setAuthentication(auth: { userToken: string; encryptionKey: string }): void
    execute(challengeId: string, cb: (err: unknown) => void): void
  }
  const sdkRef = useRef<W3SSdkLike | null>(null)

  const modularClients = getModularClients()
  const hasW3s     = !!appId
  const hasGoogle  = hasW3s && !!googleId
  const hasPasskey = !!modularClients

  // ── Init W3S SDK ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!appId) return
    let cancelled = false

    const init = async () => {
      try {
        const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk')

        const onLoginComplete = (err: unknown, result: unknown) => {
          if (cancelled) return
          if (err) { toast.error((err as Error).message || 'Login failed'); return }
          const { userToken, encryptionKey } = result as { userToken: string; encryptionKey: string }
          setLoginResult({ userToken, encryptionKey })
          toast.success('Authenticated! Setting up wallet…')
        }

        const sdk = new W3SSdk({ appSettings: { appId } }, onLoginComplete)
        sdkRef.current = sdk

        const storedId = localStorage.getItem('fairtab_deviceId')
        if (storedId) {
          setDeviceId(storedId)
        } else {
          const id = await sdk.getDeviceId()
          setDeviceId(id)
          localStorage.setItem('fairtab_deviceId', id)
        }

        // userToken + encryptionKey are session-scoped — kept in memory only, never persisted
      } catch { if (!cancelled) toast.error('SDK init failed') }
    }
    void init()
    return () => { cancelled = true }
  }, [])

  // ── Once loginResult is set, auto-initialize user ─────────────────────────
  useEffect(() => {
    if (!loginResult || challengeId || session) return
    void (async () => {
      try {
        // Never persist userToken or encryptionKey — keep in React state only
        const res = await fetch('/api/wallet/initialize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userToken: loginResult.userToken }),
        })
        const data = await res.json() as { code?: number; challengeId?: string; alreadyInitialized?: boolean }

        if (data.alreadyInitialized || data.code === 155106) {
          // Existing user — load their wallet
          await loadWallet(loginResult.userToken)
          return
        }
        if (data.challengeId) {
          setChallengeId(data.challengeId)
          setStep('loading')
          void executeChallenge(data.challengeId, loginResult)
        }
      } catch (e) { toast.error((e as Error).message) }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginResult])

  // ── Load wallets ───────────────────────────────────────────────────────────
  const loadWallet = async (userToken: string) => {
    const res = await fetch(`/api/wallet/list?userToken=${encodeURIComponent(userToken)}`)
    const data = await res.json() as { wallets?: Array<{ id: string; address: string }> }
    const wallet = data.wallets?.[0]
    if (!wallet) { toast.error('No wallet found'); return }
    const sess: AccountSession = {
      address: wallet.address,
      username: email || 'user',
      method: method === 'google' ? 'google' : 'email',
      userToken,
      encryptionKey: loginResult?.encryptionKey,
      walletId: wallet.id,
    }
    // Persist only non-sensitive identity fields — never store userToken or encryptionKey
    const { userToken: _ut, encryptionKey: _ek, ...safeSess } = sess
    localStorage.setItem('fairtab_session_v2', JSON.stringify(safeSess))
    onSignedIn(sess)
    setStep('done')
    toast.success('Signed in!')
  }

  // ── Execute W3S challenge ─────────────────────────────────────────────────
  const executeChallenge = (cId: string, lr: { userToken: string; encryptionKey: string }) => {
    const sdk = sdkRef.current
    if (!sdk) return
    sdk.setAuthentication({ userToken: lr.userToken, encryptionKey: lr.encryptionKey })
    sdk.execute(cId, (err: unknown) => {
      if (err) { toast.error((err as Error).message || 'Challenge failed'); return }
      void loadWallet(lr.userToken)
    })
  }

  // ── Google sign-in ─────────────────────────────────────────────────────────
  const handleGoogle = async () => {
    if (!sdkRef.current || !deviceId || !googleId) return
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/wallet/device-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      })
      const { deviceToken, deviceEncryptionKey } = await res.json() as { deviceToken: string; deviceEncryptionKey: string }

      sdkRef.current.updateConfigs({
        appSettings: { appId: appId! },
        loginConfigs: {
          deviceToken,
          deviceEncryptionKey,
          google: {
            clientId: googleId,
            redirectUri: window.location.origin,
            selectAccountPrompt: true,
          },
        },
      })
      sdkRef.current.performLogin('google')
      setStep('loading')
    } catch (e) {
      setError((e as Error).message)
      toast.error((e as Error).message)
    } finally { setLoading(false) }
  }

  // ── Email OTP: send OTP ────────────────────────────────────────────────────
  const handleSendOtp = async () => {
    if (!deviceId || !email) return
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/wallet/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, email }),
      })
      const data = await res.json() as { deviceToken: string; deviceEncryptionKey: string; otpToken: string }
      setOtpTokens(data)
      sdkRef.current?.updateConfigs({
        appSettings: { appId: appId! },
        loginConfigs: { deviceToken: data.deviceToken, deviceEncryptionKey: data.deviceEncryptionKey, otpToken: data.otpToken },
      })
      setStep('email-otp')
      toast.success('OTP sent — check your inbox')
    } catch (e) {
      setError((e as Error).message)
      toast.error((e as Error).message)
    } finally { setLoading(false) }
  }

  // ── Email OTP: verify ──────────────────────────────────────────────────────
  const handleVerifyOtp = () => {
    if (!sdkRef.current || !otpTokens) return
    setStep('loading')
    sdkRef.current.verifyOtp()
  }

  // ── Passkey register ───────────────────────────────────────────────────────
  const handlePasskeyRegister = async () => {
    if (!modularClients) return
    setLoading(true); setError(null)
    try {
      const credential = await toWebAuthnCredential({
        transport: modularClients.passkeyTransport,
        mode: WebAuthnMode.Register,
        username: passkeyName.trim() || 'fairtab-user',
      })
      // sessionStorage: cleared on tab close, not accessible across origins
      sessionStorage.setItem('fairtab_passkey', JSON.stringify(credential))
      const account = await toCircleSmartAccount({
        client: modularClients.publicClient,
        owner: toWebAuthnAccount({ credential }),
      })
      const sess: AccountSession = { address: account.address, username: passkeyName.trim() || 'fairtab-user', method: 'passkey' }
      localStorage.setItem('fairtab_session_v2', JSON.stringify(sess))
      onSignedIn(sess)
      setStep('done')
      toast.success('Passkey wallet ready!')
    } catch (e) {
      const msg = (e as Error).message || 'Registration failed'
      setError(msg); toast.error(msg)
    } finally { setLoading(false) }
  }

  // ── Passkey login ──────────────────────────────────────────────────────────
  const handlePasskeyLogin = async () => {
    if (!modularClients) return
    setLoading(true); setError(null)
    try {
      const credential = await toWebAuthnCredential({
        transport: modularClients.passkeyTransport,
        mode: WebAuthnMode.Login,
      })
      sessionStorage.setItem('fairtab_passkey', JSON.stringify(credential))
      const account = await toCircleSmartAccount({
        client: modularClients.publicClient,
        owner: toWebAuthnAccount({ credential }),
      })
      const sess: AccountSession = { address: account.address, username: 'passkey-user', method: 'passkey' }
      localStorage.setItem('fairtab_session_v2', JSON.stringify(sess))
      onSignedIn(sess)
      setStep('done')
      toast.success('Signed in!')
    } catch (e) {
      const msg = (e as Error).message || 'Login failed'
      setError(msg); toast.error(msg)
    } finally { setLoading(false) }
  }

  // ── Sign out ───────────────────────────────────────────────────────────────
  const handleSignOut = () => {
    localStorage.removeItem('fairtab_session_v2')
    sessionStorage.removeItem('fairtab_passkey')
    // Legacy keys — remove if present from older sessions
    localStorage.removeItem('fairtab_userToken')
    localStorage.removeItem('fairtab_encryptionKey')
    setLoginResult(null); setChallengeId(null); setStep('choose')
    onSignOut()
    toast.success('Signed out')
  }

  // ── Signed-in state ────────────────────────────────────────────────────────
  if (session) {
    const methodLabel = session.method === 'google' ? 'Google' : session.method === 'email' ? 'Email' : 'Passkey'
    const methodColor = session.method === 'passkey' ? 'var(--accent)' : 'var(--success)'
    return (
      <motion.div className="max-w-sm mx-auto flex flex-col gap-4" {...fadeUp}>
        <motion.div className="rounded-2xl p-5 relative overflow-hidden" style={glass.card}>
          <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: spectral }} />
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="size-11 rounded-2xl flex items-center justify-center shrink-0"
                style={{ background: 'rgba(45,216,122,0.1)', border: '1px solid rgba(45,216,122,0.2)' }}>
                <ShieldCheck className="size-5" style={{ color: 'var(--success)' }} />
              </div>
              <div>
                <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{session.username}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  Signed in via <span style={{ color: methodColor }}>{methodLabel}</span>
                </p>
              </div>
            </div>
            <CopyAddress address={session.address} />
          </div>

          <div className="rounded-xl p-3 mb-4" style={glass.inner}>
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--subtle)' }}>Smart account</p>
            <p className="text-xs mono break-all" style={{ color: 'var(--muted)' }}>{session.address}</p>
          </div>

          {session.method !== 'passkey' && (
            <div className="rounded-xl p-3 mb-4 flex items-start gap-2" style={{ background: 'rgba(59,142,248,0.06)', border: '1px solid rgba(90,160,255,0.12)' }}>
              <ShieldCheck className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
              <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                Circle MPC wallet — your keys are split across devices. Gas is sponsored on Arc.
              </p>
            </div>
          )}

          <button onClick={handleSignOut}
            className="w-full rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90"
            style={{ background: 'rgba(240,98,146,0.1)', color: 'var(--danger)', border: '1px solid rgba(240,98,146,0.15)' }}>
            <LogOut className="size-4" /> Sign out
          </button>
        </motion.div>
      </motion.div>
    )
  }

  return (
    <motion.div className="max-w-sm mx-auto flex flex-col gap-4" {...fadeUp}>
      <motion.div className="rounded-2xl p-5 relative overflow-hidden" style={glass.card}>
        <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: spectral }} />

        <AnimatePresence mode="wait">

          {/* ── Choose method ─────────────────────────────────────────────── */}
          {step === 'choose' && (
            <motion.div key="choose" className="flex flex-col gap-3" {...fadeUp}>
              <div className="flex items-center gap-3 mb-1">
                <div className="size-10 rounded-2xl flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(59,142,248,0.10)', border: '1px solid rgba(90,160,255,0.18)' }}>
                  <LogIn className="size-5" style={{ color: 'var(--accent)' }} />
                </div>
                <div>
                  <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Sign in to Fairtab</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Create a wallet with your preferred method</p>
                </div>
              </div>

              {/* Google */}
              <button
                disabled={!hasGoogle || loading}
                onClick={() => { setMethod('google'); void handleGoogle() }}
                className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all hover:scale-[1.01] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                <GoogleIcon />
                Continue with Google
                {!hasGoogle && <span className="ml-auto text-xs" style={{ color: 'var(--muted)' }}>Setup needed</span>}
              </button>

              {/* Email OTP */}
              <button
                disabled={!hasW3s || loading}
                onClick={() => { setMethod('email'); setStep('email-input') }}
                className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all hover:scale-[1.01] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                <Mail className="size-4" style={{ color: 'var(--accent)' }} />
                Continue with Email
                {!hasW3s && <span className="ml-auto text-xs" style={{ color: 'var(--muted)' }}>Setup needed</span>}
              </button>

              {/* Passkey */}
              <div className="flex gap-2">
                <button
                  disabled={!hasPasskey || loading}
                  onClick={() => { setMethod('passkey'); setStep('passkey-register') }}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition-all hover:scale-[1.01] disabled:opacity-40"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                  <UserPlus className="size-4" style={{ color: 'var(--accent)' }} />
                  New passkey
                </button>
                <button
                  disabled={!hasPasskey || loading}
                  onClick={() => { setMethod('passkey'); setStep('passkey-login') }}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition-all hover:scale-[1.01] disabled:opacity-40"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                  <KeyRound className="size-4" style={{ color: 'var(--accent)' }} />
                  Use passkey
                </button>
              </div>

              {(!hasW3s || !hasGoogle) && (
                <div className="rounded-xl p-3 mt-1" style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)' }}>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--warning)' }}>
                    {!hasW3s
                      ? 'Add VITE_CIRCLE_APP_ID to .env (Console → Wallets → User Controlled → Configurator)'
                      : 'Add VITE_GOOGLE_CLIENT_ID to .env to enable Google sign-in'}
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {/* ── Email input ────────────────────────────────────────────────── */}
          {step === 'email-input' && (
            <motion.div key="email-input" className="flex flex-col gap-3" {...fadeUp}>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--ink)' }}>Enter your email</p>
              <input
                type="email" placeholder="you@example.com" value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && void handleSendOtp()}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(90,160,255,0.14)', color: 'var(--ink)' }} />
              {error && <p className="text-xs px-1" style={{ color: 'var(--danger)' }}>{error}</p>}
              <button onClick={() => void handleSendOtp()} disabled={!email || loading}
                className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'var(--accent)', color: '#080f1a' }}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <><Mail className="size-4" /> Send code</>}
              </button>
              <button onClick={() => setStep('choose')} className="text-xs text-center" style={{ color: 'var(--subtle)' }}>← Back</button>
            </motion.div>
          )}

          {/* ── Email OTP verify ───────────────────────────────────────────── */}
          {step === 'email-otp' && (
            <motion.div key="email-otp" className="flex flex-col gap-3" {...fadeUp}>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Check your inbox</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                We sent a code to <span style={{ color: 'var(--accent)' }}>{email}</span>. Click below to verify — Circle's hosted UI will open.
              </p>
              <button onClick={handleVerifyOtp}
                className="w-full rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2"
                style={{ background: 'var(--accent)', color: '#080f1a' }}>
                <CheckCircle2 className="size-4" /> Verify code
              </button>
              <button onClick={() => setStep('email-input')} className="text-xs text-center" style={{ color: 'var(--subtle)' }}>← Resend</button>
            </motion.div>
          )}

          {/* ── Passkey register ───────────────────────────────────────────── */}
          {step === 'passkey-register' && (
            <motion.div key="passkey-register" className="flex flex-col gap-3" {...fadeUp}>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Create a passkey</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Your device will prompt you to save a passkey. No password needed.</p>
              <input type="text" placeholder="Display name (optional)"
                value={passkeyName} onChange={e => setPasskeyName(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(90,160,255,0.14)', color: 'var(--ink)' }} />
              {error && <p className="text-xs px-1" style={{ color: 'var(--danger)' }}>{error}</p>}
              <button onClick={() => void handlePasskeyRegister()} disabled={loading}
                className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'var(--accent)', color: '#080f1a' }}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <><UserPlus className="size-4" /> Register passkey</>}
              </button>
              <button onClick={() => setStep('choose')} className="text-xs text-center" style={{ color: 'var(--subtle)' }}>← Back</button>
            </motion.div>
          )}

          {/* ── Passkey login ──────────────────────────────────────────────── */}
          {step === 'passkey-login' && (
            <motion.div key="passkey-login" className="flex flex-col gap-3" {...fadeUp}>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Sign in with passkey</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Your device will prompt you to use a saved passkey.</p>
              {error && <p className="text-xs px-1" style={{ color: 'var(--danger)' }}>{error}</p>}
              <button onClick={() => void handlePasskeyLogin()} disabled={loading}
                className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'var(--accent)', color: '#080f1a' }}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <><KeyRound className="size-4" /> Use passkey</>}
              </button>
              <button onClick={() => setStep('choose')} className="text-xs text-center" style={{ color: 'var(--subtle)' }}>← Back</button>
            </motion.div>
          )}

          {/* ── Loading / in-progress ──────────────────────────────────────── */}
          {step === 'loading' && (
            <motion.div key="loading" className="flex flex-col items-center gap-4 py-4" {...fadeUp}>
              <Loader2 className="size-8 animate-spin" style={{ color: 'var(--accent)' }} />
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Setting up your wallet…</p>
            </motion.div>
          )}

        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}
