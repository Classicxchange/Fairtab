/**
 * AccountView — Circle user-controlled wallets (Google OAuth + email OTP).
 *
 * Google: Circle's own OAuth via W3SSdk.performLogin (no Firebase).
 * Email:  W3SSdk.verifyOtp opens Circle's hosted OTP UI.
 * No local private keys. Circle MPC handles all key management.
 *
 * Required frontend env vars:
 *   VITE_CIRCLE_APP_ID       — App ID from Circle Console > Wallets > User Controlled > Configurator
 *   VITE_GOOGLE_CLIENT_ID    — Google OAuth client ID (also registered in Circle Console)
 *
 * Required Vercel env vars (server-side only):
 *   CIRCLE_API_KEY           — Circle API key
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Loader2, ShieldCheck, AlertTriangle, Mail } from 'lucide-react'
import type { W3SSdk as W3SSdkType } from '@circle-fin/w3s-pw-web-sdk'

// ── Env vars ──────────────────────────────────────────────────────────────────
const circleAppId    = import.meta.env.VITE_CIRCLE_APP_ID     as string | undefined
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID  as string | undefined
export const circleConfigured = !!(circleAppId)

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AccountSession {
  address:        string
  username:       string
  email?:         string
  picture?:       string
  method:         'google' | 'email' | 'passkey' | 'seed-wallet'
  /** Kept for backwards compat with older session blobs */
  googleUid?:     string
  /** In-memory only — never stored */
  userToken?:     string
  encryptionKey?: string
}

// ── Session storage — address only, no secrets ────────────────────────────────
const SESSION_KEY = 'fairtab_circle_session_v1'

type StoredSession = Omit<AccountSession, 'userToken' | 'encryptionKey'>

export function saveSession(s: StoredSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s))
}

export function loadGoogleSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch { return null }
}

export function clearGoogleSession() {
  localStorage.removeItem(SESSION_KEY)
}

// ── Cookie helpers (deviceToken must survive OAuth page redirect) ─────────────
function setCookie(name: string, value: string, days = 1) {
  const exp = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`
}
function getCookie(name: string): string {
  return document.cookie.split('; ').reduce<string>((acc, c) => {
    const [k, v] = c.split('=')
    return k === name ? decodeURIComponent(v ?? '') : acc
  }, '')
}
function delCookie(name: string) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`
}

// ── Google icon ───────────────────────────────────────────────────────────────
function GoogleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <path d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z" fill="#FFC107"/>
      <path d="M6.3 14.7l7 5.1C15.2 16.1 19.3 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 7.4 6.3 14.7z" fill="#FF3D00"/>
      <path d="M24 46c5.5 0 10.5-2 14.3-5.4l-6.6-5.6C29.5 36.9 26.9 38 24 38c-6 0-11.1-4-13-9.5l-7 5.3C7.8 41.8 15.4 46 24 46z" fill="#4CAF50"/>
      <path d="M44.5 20H24v8.5h11.8c-.8 2.4-2.4 4.5-4.4 6l6.6 5.6C41.1 37.1 45 31 45 24c0-1.3-.2-2.7-.5-4z" fill="#1976D2"/>
    </svg>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface AccountViewProps {
  session: AccountSession | null
  onSignedIn: (s: AccountSession) => void
  onSignOut: () => void
}

type Step = 'choose' | 'email-input' | 'loading' | 'done'

// ── Main component ─────────────────────────────────────────────────────────────
export function AccountView({ session, onSignedIn, onSignOut }: AccountViewProps) {
  const sdkRef = useRef<W3SSdkType | null>(null)
  const [step, setStep]       = useState<Step>(session ? 'done' : 'choose')
  const [error, setError]     = useState<string | null>(null)
  const [email, setEmail]     = useState('')
  const [loadMsg, setLoadMsg] = useState('')

  // In-memory only — never stored in state that serialises
  const authRef = useRef<{ userToken: string; encryptionKey: string } | null>(null)

  // ── Create or load wallet after login completes ────────────────────────────
  const finishInit = useCallback(async (userToken: string, encKey: string, emailUsed?: string) => {
    const sdk = sdkRef.current
    if (!sdk) { setError('SDK not ready'); setStep('choose'); return }

    setStep('loading'); setLoadMsg('Setting up your wallet…'); setError(null)
    authRef.current = { userToken, encryptionKey: encKey }

    try {
      // Initialize user + wallet (or fetch existing)
      const initRes = await fetch('/api/wallet/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userToken }),
      })
      const initData = await initRes.json() as {
        challengeId?: string
        alreadyInitialized?: boolean
        error?: string
      }
      if (initData.error) throw new Error(initData.error)

      if (initData.challengeId) {
        setLoadMsg('Creating your wallet…')
        await new Promise<void>((resolve, reject) => {
          sdk.setAuthentication({ userToken, encryptionKey: encKey })
          sdk.execute(initData.challengeId!, (err) => {
            if (err) reject(new Error((err as Error).message ?? 'Wallet creation failed'))
            else resolve()
          })
        })
      }

      setLoadMsg('Loading wallet…')
      const listRes = await fetch(`/api/wallet/list?userToken=${encodeURIComponent(userToken)}`)
      const listData = await listRes.json() as { wallets?: { address: string }[]; error?: string }
      if (listData.error) throw new Error(listData.error)

      const walletAddress = listData.wallets?.[0]?.address ?? ''
      if (!walletAddress) throw new Error('No wallet found. Please try again.')

      const sess: AccountSession = {
        address:       walletAddress,
        username:      emailUsed ? emailUsed.split('@')[0] : 'Circle User',
        email:         emailUsed || undefined,
        method:        emailUsed ? 'email' : 'google',
        userToken,
        encryptionKey: encKey,
      }
      saveSession({ address: sess.address, username: sess.username, email: sess.email, method: sess.method })
      onSignedIn(sess)
      setStep('done')
      toast.success(`Wallet ready — ${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('choose')
    }
  }, [onSignedIn])

  // ── SDK init — runs once ────────────────────────────────────────────────────
  useEffect(() => {
    if (!circleAppId) return
    let cancelled = false

    void (async () => {
      try {
        const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk')
        const deviceToken    = getCookie('fairtab_dt')
        const deviceEncKey   = getCookie('fairtab_dek')

        const onLoginComplete = (_err: unknown, result: unknown) => {
          if (cancelled) return
          if (_err) {
            setError('Login failed: ' + ((_err as Error).message ?? 'Unknown'))
            setStep('choose')
            return
          }
          const { userToken, encryptionKey } = result as { userToken: string; encryptionKey: string }
          delCookie('fairtab_dt'); delCookie('fairtab_dek')
          void finishInit(userToken, encryptionKey, email || undefined)
        }

        const sdk = new W3SSdk(
          {
            appSettings: { appId: circleAppId },
            loginConfigs: {
              deviceToken,
              deviceEncryptionKey: deviceEncKey,
              ...(googleClientId ? {
                google: {
                  clientId: googleClientId,
                  redirectUri: window.location.origin,
                  selectAccountPrompt: true,
                },
              } : {}),
            },
          },
          onLoginComplete,
        )
        sdkRef.current = sdk
        const id = await sdk.getDeviceId()
        if (!getCookie('fairtab_did')) setCookie('fairtab_did', id, 30)
      } catch {
        if (!cancelled) setError('Failed to initialise Circle SDK')
      }
    })()

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Google sign-in ─────────────────────────────────────────────────────────
  const handleGoogleSignIn = useCallback(async () => {
    const sdk = sdkRef.current
    if (!sdk || !circleAppId || !googleClientId) return
    setStep('loading'); setLoadMsg('Connecting to Google…'); setError(null)
    try {
      const deviceId = getCookie('fairtab_did') || await sdk.getDeviceId()
      const dtRes = await fetch('/api/wallet/device-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      })
      const dtData = await dtRes.json() as {
        deviceToken?: string
        deviceEncryptionKey?: string
        error?: string
      }
      if (dtData.error) throw new Error(dtData.error)
      setCookie('fairtab_dt',  dtData.deviceToken!,           1)
      setCookie('fairtab_dek', dtData.deviceEncryptionKey!,   1)

      const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk')
      const onLoginComplete = (_err: unknown, result: unknown) => {
        if (_err) { setError('Google login failed'); setStep('choose'); return }
        const { userToken, encryptionKey } = result as { userToken: string; encryptionKey: string }
        delCookie('fairtab_dt'); delCookie('fairtab_dek')
        void finishInit(userToken, encryptionKey, undefined)
      }
      const freshSdk = new W3SSdk(
        {
          appSettings: { appId: circleAppId },
          loginConfigs: {
            deviceToken:         dtData.deviceToken!,
            deviceEncryptionKey: dtData.deviceEncryptionKey!,
            google: {
              clientId:            googleClientId,
              redirectUri:         window.location.origin,
              selectAccountPrompt: true,
            },
          },
        },
        onLoginComplete,
      )
      sdkRef.current = freshSdk
      await freshSdk.getDeviceId()
      const { SocialLoginProvider } = await import('@circle-fin/w3s-pw-web-sdk/dist/src/types')
      void freshSdk.performLogin(SocialLoginProvider.GOOGLE)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('choose')
    }
  }, [finishInit])

  // ── Email OTP: request OTP then open Circle's hosted OTP UI ───────────────
  const handleEmailSignIn = useCallback(async () => {
    const sdk = sdkRef.current
    if (!sdk || !circleAppId || !email.trim()) return
    setStep('loading'); setLoadMsg('Sending OTP to ' + email + '…'); setError(null)
    try {
      const deviceId = getCookie('fairtab_did') || await sdk.getDeviceId()
      const res = await fetch('/api/wallet/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, email }),
      })
      const data = await res.json() as {
        deviceToken?: string
        deviceEncryptionKey?: string
        otpToken?: string
        error?: string
      }
      if (data.error) throw new Error(data.error)

      setCookie('fairtab_dt',  data.deviceToken!,           1)
      setCookie('fairtab_dek', data.deviceEncryptionKey!,   1)

      // Update SDK config with new device token + otpToken, then open Circle's OTP UI
      sdk.updateConfigs({
        appSettings: { appId: circleAppId },
        loginConfigs: {
          deviceToken:         data.deviceToken!,
          deviceEncryptionKey: data.deviceEncryptionKey!,
          otpToken:            data.otpToken,
        },
      })
      // verifyOtp opens Circle's hosted UI where user enters the code
      sdk.verifyOtp()
      setLoadMsg('Enter the code from your email…')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('email-input')
    }
  }, [email])

  // ── Not configured ────────────────────────────────────────────────────────
  if (!circleConfigured) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-5 flex flex-col gap-3"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0" style={{ color: 'var(--warning)' }} />
          <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Circle Wallet not configured</p>
        </div>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
          Add <code className="font-mono" style={{ color: 'var(--accent)' }}>VITE_CIRCLE_APP_ID</code> to your{' '}
          <code className="font-mono" style={{ color: 'var(--accent)' }}>.env</code>.
        </p>
      </motion.div>
    )
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (step === 'loading') {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="flex flex-col items-center gap-3 py-8">
        <Loader2 className="size-8 animate-spin" style={{ color: 'var(--accent)' }} />
        <p className="text-sm font-semibold text-center px-4" style={{ color: 'var(--ink)' }}>{loadMsg}</p>
      </motion.div>
    )
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (step === 'done' && session) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-4 flex items-center gap-3"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="size-10 rounded-full flex items-center justify-center shrink-0 text-base font-bold"
          style={{ background: 'var(--accent)', color: '#fff' }}>
          {session.username.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate" style={{ color: 'var(--ink)' }}>{session.username}</p>
          <p className="text-xs font-mono truncate mt-0.5" style={{ color: 'var(--muted)' }}>
            {session.address.slice(0, 6)}…{session.address.slice(-4)}
          </p>
        </div>
        <span className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold shrink-0"
          style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
          <ShieldCheck className="size-3" /> Circle
        </span>
        <button onClick={onSignOut}
          className="text-xs px-3 py-1.5 rounded-xl font-semibold transition-all hover:opacity-80"
          style={{ background: 'rgba(240,98,146,0.08)', color: 'var(--danger)', border: '1px solid rgba(240,98,146,0.15)' }}>
          Sign out
        </button>
      </motion.div>
    )
  }

  // ── Email input ────────────────────────────────────────────────────────────
  if (step === 'email-input') {
    return (
      <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
        className="flex flex-col gap-3">
        {error && (
          <div className="rounded-xl p-3 flex items-start gap-2"
            style={{ background: 'rgba(240,98,146,0.06)', border: '1px solid rgba(240,98,146,0.18)' }}>
            <AlertTriangle className="size-3.5 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
            <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>Email address</label>
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleEmailSignIn() }}
            placeholder="you@example.com" autoFocus
            className="rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
          />
        </div>
        <button onClick={() => { void handleEmailSignIn() }} disabled={!email.trim()}
          className="w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold transition-all hover:scale-[1.01] disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#fff' }}>
          <Mail className="size-4" />
          Send code
        </button>
        <button onClick={() => { setStep('choose'); setError(null) }}
          className="text-xs text-center" style={{ color: 'var(--muted)' }}>
          ← Back
        </button>
      </motion.div>
    )
  }

  // ── Choose method ──────────────────────────────────────────────────────────
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-3">
      {error && (
        <div className="rounded-xl p-3 flex items-start gap-2"
          style={{ background: 'rgba(240,98,146,0.06)', border: '1px solid rgba(240,98,146,0.18)' }}>
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
          <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>
        </div>
      )}

      {googleClientId && (
        <button onClick={() => { void handleGoogleSignIn() }}
          className="w-full flex items-center justify-center gap-3 rounded-2xl px-5 py-4 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.98]"
          style={{ background: '#fff', border: '1.5px solid #dadce0', color: '#3c4043', boxShadow: '0 1px 6px rgba(0,0,0,0.10)' }}>
          <GoogleIcon size={20} />
          Continue with Google
        </button>
      )}

      <button onClick={() => { setStep('email-input'); setError(null) }}
        className="w-full flex items-center justify-center gap-3 rounded-2xl px-5 py-4 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.98]"
        style={{ background: 'var(--surface)', border: '1.5px solid var(--border)', color: 'var(--ink)' }}>
        <Mail className="size-5" style={{ color: 'var(--accent)' }} />
        Continue with Email
      </button>

      <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
        A Circle wallet is created automatically — no seed phrase needed.
      </p>
    </motion.div>
  )
}

// ── Badge shown in navbar / account tab when connected ─────────────────────────
export function GoogleIdentityBadge({ session, onSignOut }: { session: AccountSession; onSignOut: () => void }) {
  return (
    <div className="rounded-2xl p-4 flex items-center gap-3"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="size-10 rounded-full flex items-center justify-center shrink-0 text-base font-bold"
        style={{ background: 'var(--accent)', color: '#fff' }}>
        {session.username.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate" style={{ color: 'var(--ink)' }}>{session.username}</p>
        {session.email && <p className="text-xs truncate mt-0.5" style={{ color: 'var(--muted)' }}>{session.email}</p>}
      </div>
      <span className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold shrink-0"
        style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
        <ShieldCheck className="size-3" /> Circle
      </span>
      <button onClick={onSignOut}
        className="text-xs px-3 py-1.5 rounded-xl font-semibold transition-all hover:opacity-80"
        style={{ background: 'rgba(240,98,146,0.08)', color: 'var(--danger)', border: '1px solid rgba(240,98,146,0.15)' }}>
        Sign out
      </button>
    </div>
  )
}
