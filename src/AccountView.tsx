/**
 * AccountView — Google Sign-In (no backend needed).
 *
 * Uses Google Identity Services (GSI) popup flow to get an ID token
 * entirely in the browser. The Google `sub` (stable user ID) is used
 * to deterministically derive a private key via PBKDF2 + WebCrypto.
 * Same Google account → same wallet address, every time.
 *
 * No Circle UCW, no server calls, no passkey dependency.
 * All credential state stays in sessionStorage (cleared on tab close).
 *
 * Required:  VITE_GOOGLE_CLIENT_ID in .env
 * Optional:  nothing else
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Loader2, ShieldCheck, LogOut, Copy, CheckCircle2 } from 'lucide-react'
import { privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'

// ── Env ───────────────────────────────────────────────────────────────────────
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AccountSession {
  address: string
  username: string
  email?: string
  picture?: string
  method: 'google' | 'email' | 'passkey' | 'seed-wallet'
  /** In-memory only. Never persisted. */
  privateKey?: Hex
}

// ── GSI type shim ─────────────────────────────────────────────────────────────
interface GsiCredentialResponse { credential: string }
interface GoogleAccounts {
  id: {
    initialize(cfg: {
      client_id: string
      callback: (r: GsiCredentialResponse) => void
      auto_select?: boolean
      cancel_on_tap_outside?: boolean
    }): void
    prompt(cb?: (n: { isNotDisplayed(): boolean; isSkippedMoment(): boolean }) => void): void
    renderButton(el: HTMLElement, cfg: object): void
    disableAutoSelect(): void
  }
}
declare global { interface Window { google?: { accounts: GoogleAccounts } } }

// ── JWT decode (no verify — sub is used only as a salt for key derivation) ──
function decodeJwtPayload(token: string): Record<string, string> {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(b64)) as Record<string, string>
  } catch { return {} }
}

// ── Deterministic private key from Google sub ─────────────────────────────────
// PBKDF2(password=sub, salt="fairtab-wallet-v1", iterations=200_000, SHA-256) → 32 bytes
async function derivePrivateKey(sub: string): Promise<Hex> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(sub), 'PBKDF2', false, ['deriveKey']
  )
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('fairtab-wallet-v1'), iterations: 200_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt']
  )
  const raw = await crypto.subtle.exportKey('raw', key)
  const hex = Array.from(new Uint8Array(raw)).map(b => b.toString(16).padStart(2, '0')).join('')
  return `0x${hex}`
}

// ── Session storage (sessionStorage — cleared on tab close) ───────────────────
const SESSION_KEY = 'fairtab_google_session_v1'

function saveSession(s: AccountSession) {
  const { privateKey: _, ...safe } = s
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(safe))
}

export function loadGoogleSession(): Omit<AccountSession, 'privateKey'> | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Omit<AccountSession, 'privateKey'>) : null
  } catch { return null }
}

export function clearGoogleSession() {
  sessionStorage.removeItem(SESSION_KEY)
}

// ── Load the GSI script once ───────────────────────────────────────────────────
let gsiLoaded = false
function loadGsi(): Promise<void> {
  if (gsiLoaded || window.google?.accounts) { gsiLoaded = true; return Promise.resolve() }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true; s.defer = true
    s.onload = () => { gsiLoaded = true; resolve() }
    s.onerror = () => reject(new Error('Failed to load Google Sign-In script'))
    document.head.appendChild(s)
  })
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

// ── Copy address button ───────────────────────────────────────────────────────
function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button onClick={copy}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-all hover:opacity-80"
      style={{ background: 'var(--surface-muted)', color: 'var(--subtle)', border: '1px solid var(--border)' }}>
      {copied ? <CheckCircle2 className="size-3" style={{ color: 'var(--success)' }} /> : <Copy className="size-3" />}
      {copied ? 'Copied' : `${address.slice(0, 6)}…${address.slice(-4)}`}
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
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const btnRef                = useRef<HTMLDivElement>(null)
  const configured            = !!googleClientId

  // ── Handle credential response from GSI ──────────────────────────────────
  const handleCredential = useCallback(async (response: GsiCredentialResponse) => {
    setLoading(true); setError(null)
    try {
      const payload = decodeJwtPayload(response.credential)
      const sub     = payload.sub
      const email   = payload.email ?? ''
      const name    = payload.name ?? email.split('@')[0]
      const picture = payload.picture ?? ''

      if (!sub) throw new Error('Google sign-in did not return a user ID')

      // Derive deterministic private key — runs in ~200ms
      const privateKey = await derivePrivateKey(sub)
      const account    = privateKeyToAccount(privateKey)

      const sess: AccountSession = {
        address:    account.address,
        username:   name,
        email,
        picture,
        method:     'google',
        privateKey, // in-memory only — not persisted
      }
      saveSession(sess)
      onSignedIn(sess)
      toast.success(`Signed in as ${name}`)
    } catch (e) {
      const msg = (e instanceof Error) ? e.message : String(e)
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [onSignedIn])

  // ── Init GSI and render the button ────────────────────────────────────────
  useEffect(() => {
    if (!googleClientId || !btnRef.current) return
    let cancelled = false

    void loadGsi().then(() => {
      if (cancelled || !btnRef.current || !window.google) return
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (r) => { void handleCredential(r) },
        auto_select: false,
        cancel_on_tap_outside: true,
      })
      window.google.accounts.id.renderButton(btnRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        width: btnRef.current.offsetWidth || 320,
        logo_alignment: 'left',
      })
    }).catch((e: unknown) => {
      if (!cancelled) setError((e instanceof Error) ? e.message : 'Failed to load Google Sign-In')
    })

    return () => { cancelled = true }
  }, [handleCredential])

  const handleSignOut = () => {
    clearGoogleSession()
    window.google?.accounts.id.disableAutoSelect()
    onSignOut()
    toast.success('Signed out')
  }

  // ── Signed-in state ───────────────────────────────────────────────────────
  if (session) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-5 flex flex-col gap-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>

        <div className="flex items-center gap-3">
          {session.picture
            ? <img src={session.picture} alt={session.username} className="size-11 rounded-full shrink-0" style={{ outline: '2px solid var(--border)' }} />
            : (
              <div className="size-11 rounded-full flex items-center justify-center shrink-0 text-lg font-bold"
                style={{ background: 'var(--accent)', color: '#fff' }}>
                {session.username.charAt(0).toUpperCase()}
              </div>
            )
          }
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate" style={{ color: 'var(--ink)' }}>{session.username}</p>
            {session.email && <p className="text-xs truncate mt-0.5" style={{ color: 'var(--muted)' }}>{session.email}</p>}
          </div>
          <div className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold"
            style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
            <ShieldCheck className="size-3" /> Google
          </div>
        </div>

        <div className="rounded-xl p-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--subtle)' }}>Wallet address</p>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-mono truncate flex-1" style={{ color: 'var(--ink-2)' }}>{session.address}</p>
            <CopyAddress address={session.address} />
          </div>
        </div>

        <div className="rounded-xl p-3 flex items-start gap-2"
          style={{ background: 'rgba(59,142,248,0.05)', border: '1px solid rgba(59,142,248,0.12)' }}>
          <ShieldCheck className="size-3.5 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
          <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
            Your wallet is derived from your Google account. Sign in with the same Google account on any device to access the same wallet.
          </p>
        </div>

        <button onClick={handleSignOut}
          className="w-full rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90"
          style={{ background: 'rgba(240,98,146,0.08)', color: 'var(--danger)', border: '1px solid rgba(240,98,146,0.15)' }}>
          <LogOut className="size-4" /> Sign out
        </button>
      </motion.div>
    )
  }

  // ── Sign-in state ─────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-4">

      {/* Not configured */}
      {!configured && (
        <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
          <p className="font-semibold text-sm mb-2" style={{ color: 'var(--ink)' }}>Setup required</p>
          <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--muted)' }}>
            Add your Google OAuth Client ID to <code className="font-mono" style={{ color: 'var(--accent)' }}>.env</code>:
          </p>
          <div className="rounded-xl p-3 font-mono text-xs select-all mb-3"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
            VITE_GOOGLE_CLIENT_ID=your_client_id_here
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
            Get it from{' '}
            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer"
              className="underline" style={{ color: 'var(--accent)' }}>
              Google Cloud Console
            </a>
            {' '}→ APIs &amp; Services → Credentials → OAuth 2.0 Client IDs (Web application).
            Add <code className="font-mono">fairtab.online</code> to Authorized JavaScript origins.
          </p>
        </div>
      )}

      {/* GSI button container */}
      {configured && (
        <div className="flex flex-col gap-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-4">
              <Loader2 className="size-5 animate-spin" style={{ color: 'var(--accent)' }} />
              <span className="text-sm" style={{ color: 'var(--muted)' }}>Signing you in…</span>
            </div>
          )}

          {!loading && (
            <>
              {/* GSI renders its own button into this div */}
              <div ref={btnRef} className="w-full" style={{ minHeight: 44 }} />

              {/* Fallback manual button in case GSI button doesn't render */}
              <button
                onClick={() => {
                  setError(null)
                  if (window.google) {
                    window.google.accounts.id.prompt()
                  } else {
                    setError('Google Sign-In not loaded yet. Please try again.')
                  }
                }}
                className="w-full flex items-center justify-center gap-3 rounded-2xl px-5 py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.98]"
                style={{
                  background: '#fff',
                  border: '1.5px solid #dadce0',
                  color: '#3c4043',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}>
                <GoogleIcon size={20} />
                Continue with Google
              </button>
            </>
          )}

          {error && (
            <div className="rounded-xl p-3" style={{ background: 'rgba(240,98,146,0.06)', border: '1px solid rgba(240,98,146,0.18)' }}>
              <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>
            </div>
          )}

          <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
            Your wallet is derived from your Google account. No password or seed phrase needed.
          </p>
        </div>
      )}
    </motion.div>
  )
}
