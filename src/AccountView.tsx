/**
 * AccountView — Google Sign-In via Firebase Auth (identity only).
 *
 * Firebase is used purely for authentication / identity.
 * The wallet (seed phrase, private key) is managed separately via
 * SeedWalletAuth scoped to the user's Firebase UID.
 *
 * Required env vars:
 *   VITE_FIREBASE_API_KEY
 *   VITE_FIREBASE_AUTH_DOMAIN   ← set to "fairtab.online" in production
 *   VITE_FIREBASE_PROJECT_ID
 */

import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Loader2, ShieldCheck, AlertTriangle } from 'lucide-react'

// ── Firebase config from env ───────────────────────────────────────────────────
const firebaseApiKey     = import.meta.env.VITE_FIREBASE_API_KEY     as string | undefined
const firebaseAuthDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined
const firebaseProjectId  = import.meta.env.VITE_FIREBASE_PROJECT_ID  as string | undefined
export const firebaseConfigured = !!(firebaseApiKey && firebaseAuthDomain && firebaseProjectId)

// Detect mobile — popup is unreliable on Android Chrome
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AccountSession {
  /** The on-chain address (comes from the linked SeedWallet, filled after onboarding) */
  address:    string
  username:   string
  email?:     string
  picture?:   string
  method:     'google' | 'email' | 'passkey' | 'seed-wallet'
  /** Firebase UID — used to scope wallet storage per user */
  googleUid?: string
}

// ── Session storage ────────────────────────────────────────────────────────────
const SESSION_KEY = 'fairtab_google_session_v1'

export function saveSession(s: AccountSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s))
}

export function loadGoogleSession(): AccountSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as AccountSession) : null
  } catch { return null }
}

export function clearGoogleSession() {
  localStorage.removeItem(SESSION_KEY)
}

// ── Lazy Firebase init ─────────────────────────────────────────────────────────
let _auth: import('firebase/auth').Auth | null = null

export async function getFirebaseAuth(): Promise<import('firebase/auth').Auth> {
  if (_auth) return _auth
  const { initializeApp, getApps } = await import('firebase/app')
  const { getAuth: _getAuth }      = await import('firebase/auth')
  const existing = getApps()[0]
  const app = existing ?? initializeApp({
    apiKey:     firebaseApiKey!,
    authDomain: firebaseAuthDomain!,
    projectId:  firebaseProjectId!,
  })
  _auth = _getAuth(app)
  return _auth
}

/**
 * Build an identity-only session from a Firebase user.
 * address is empty string — filled in after the wallet onboarding step.
 * Exported so App.tsx can call this after getRedirectResult().
 */
export function buildSession(user: import('firebase/auth').User): AccountSession {
  return {
    address:   '',
    username:  user.displayName ?? user.email?.split('@')[0] ?? 'User',
    email:     user.email    ?? undefined,
    picture:   user.photoURL ?? undefined,
    method:    'google',
    googleUid: user.uid,
  }
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

// ── Main sign-in component ────────────────────────────────────────────────────
interface AccountViewProps {
  /** Called with an identity-only session (address = '') after Google sign-in */
  onSignedIn: (s: AccountSession) => void
}

export function AccountView({ onSignedIn }: AccountViewProps) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const handleGoogleSignIn = useCallback(async () => {
    if (!firebaseConfigured) return
    setLoading(true); setError(null)
    try {
      const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import('firebase/auth')
      const auth     = await getFirebaseAuth()
      const provider = new GoogleAuthProvider()
      provider.addScope('email')
      provider.addScope('profile')

      if (isMobile) {
        await signInWithRedirect(auth, provider)
        return // page navigates away; App.tsx picks up getRedirectResult on return
      }

      try {
        const result = await signInWithPopup(auth, provider)
        const sess   = buildSession(result.user)
        saveSession(sess)
        onSignedIn(sess)
        toast.success(`Welcome, ${sess.username}!`)
      } catch (popupErr) {
        const msg = popupErr instanceof Error ? popupErr.message : String(popupErr)
        if (msg.includes('popup-blocked') || msg.includes('popup-closed')) {
          await signInWithRedirect(auth, provider)
          return
        }
        throw popupErr
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!msg.includes('cancelled') && !msg.includes('popup-closed') && !msg.includes('dismissed')) {
        setError(msg)
        toast.error('Google sign-in failed')
      }
    } finally {
      setLoading(false)
    }
  }, [onSignedIn])

  // ── Not configured ────────────────────────────────────────────────────────
  if (!firebaseConfigured) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-5 flex flex-col gap-3"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0" style={{ color: 'var(--warning)' }} />
          <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Firebase not configured</p>
        </div>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
          Add these to your <code className="font-mono" style={{ color: 'var(--accent)' }}>.env</code>:
        </p>
        <div className="rounded-xl p-3 font-mono text-xs select-all"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)', whiteSpace: 'pre' }}>
{`VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=fairtab.online
VITE_FIREBASE_PROJECT_ID=...`}
        </div>
      </motion.div>
    )
  }

  // ── Sign-in button ────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-3">

      {loading ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="size-8 animate-spin" style={{ color: 'var(--accent)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            {isMobile ? 'Redirecting to Google…' : 'Signing you in…'}
          </p>
          <p className="text-xs text-center px-4" style={{ color: 'var(--muted)' }}>
            {isMobile
              ? 'You will be redirected back to Fairtab automatically.'
              : 'A Google sign-in window should appear.'}
          </p>
        </div>
      ) : (
        <>
          <button
            onClick={() => { void handleGoogleSignIn() }}
            className="w-full flex items-center justify-center gap-3 rounded-2xl px-5 py-4 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.98]"
            style={{
              background:  '#fff',
              border:      '1.5px solid #dadce0',
              color:       '#3c4043',
              boxShadow:   '0 1px 6px rgba(0,0,0,0.10)',
            }}>
            <GoogleIcon size={20} />
            Continue with Google
          </button>

          {error && (
            <div className="rounded-xl p-3 flex items-start gap-2"
              style={{ background: 'rgba(240,98,146,0.06)', border: '1px solid rgba(240,98,146,0.18)' }}>
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
              <p className="text-xs leading-relaxed" style={{ color: 'var(--danger)' }}>{error}</p>
            </div>
          )}

          <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
            Sign in with Google, then set up your self-custodial wallet.
          </p>
        </>
      )}
    </motion.div>
  )
}

// ── Signed-in identity badge (used in AccountPage) ────────────────────────────
export function GoogleIdentityBadge({
  session,
  onSignOut,
}: {
  session: AccountSession
  onSignOut: () => void
}) {
  return (
    <div className="rounded-2xl p-4 flex items-center gap-3"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      {session.picture
        ? <img src={session.picture} alt={session.username}
            className="size-10 rounded-full shrink-0"
            referrerPolicy="no-referrer"
            style={{ outline: '2px solid var(--border)', outlineOffset: 1 }} />
        : (
          <div className="size-10 rounded-full flex items-center justify-center shrink-0 text-base font-bold"
            style={{ background: 'var(--accent)', color: '#fff' }}>
            {session.username.charAt(0).toUpperCase()}
          </div>
        )
      }
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate" style={{ color: 'var(--ink)' }}>{session.username}</p>
        {session.email && <p className="text-xs truncate mt-0.5" style={{ color: 'var(--muted)' }}>{session.email}</p>}
      </div>
      <span className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold shrink-0"
        style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
        <ShieldCheck className="size-3" /> Google
      </span>
      <button
        onClick={onSignOut}
        className="text-xs px-3 py-1.5 rounded-xl font-semibold transition-all hover:opacity-80"
        style={{ background: 'rgba(240,98,146,0.08)', color: 'var(--danger)', border: '1px solid rgba(240,98,146,0.15)' }}>
        Sign out
      </button>
    </div>
  )
}
