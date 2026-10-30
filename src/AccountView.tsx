/**
 * AccountView — Google Sign-In via Firebase Auth.
 *
 * Firebase handles the entire Google OAuth flow under their own
 * Google Cloud project — no Google Cloud Console setup needed from you.
 *
 * How it works:
 *  1. Firebase Auth opens a Google sign-in popup
 *  2. User picks their Google account
 *  3. Firebase returns a stable uid (never changes for that Google account)
 *  4. We derive a deterministic private key: PBKDF2(uid, salt, 200k, SHA-256)
 *  5. Same Google account → same wallet address, on any device, forever
 *
 * Required env vars (paste your Firebase project config):
 *   VITE_FIREBASE_API_KEY
 *   VITE_FIREBASE_AUTH_DOMAIN
 *   VITE_FIREBASE_PROJECT_ID
 *
 * Get them free at https://console.firebase.google.com
 *   → Create project → Add web app → copy the config object
 *   Then: Authentication → Sign-in method → Google → Enable
 */

import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Loader2, ShieldCheck, LogOut, Copy, CheckCircle2, AlertTriangle } from 'lucide-react'
import { privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'

// ── Firebase config from env ───────────────────────────────────────────────────
const firebaseApiKey    = import.meta.env.VITE_FIREBASE_API_KEY     as string | undefined
const firebaseAuthDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined
const firebaseProjectId  = import.meta.env.VITE_FIREBASE_PROJECT_ID  as string | undefined

const firebaseConfigured = !!(firebaseApiKey && firebaseAuthDomain && firebaseProjectId)

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

// ── Deterministic wallet from Firebase uid ─────────────────────────────────────
// PBKDF2(password=uid, salt="fairtab-wallet-v1", 200_000, SHA-256) → 32 bytes private key
// Same uid → same wallet on every device, every browser, forever.
async function derivePrivateKey(uid: string): Promise<Hex> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(uid), 'PBKDF2', false, ['deriveKey']
  )
  const derived = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('fairtab-wallet-v1'), iterations: 200_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt']
  )
  const raw = await crypto.subtle.exportKey('raw', derived)
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

// ── Lazy Firebase init — only loads the SDK when the user clicks Sign In ──────
let firebaseApp: import('firebase/app').FirebaseApp | null = null
let firebaseAuth: import('firebase/auth').Auth | null = null

async function getFirebaseAuth(): Promise<import('firebase/auth').Auth> {
  if (firebaseAuth) return firebaseAuth

  const { initializeApp, getApps } = await import('firebase/app')
  const { getAuth }                = await import('firebase/auth')

  const existing = getApps()[0]
  firebaseApp = existing ?? initializeApp({
    apiKey:     firebaseApiKey!,
    authDomain: firebaseAuthDomain!,
    projectId:  firebaseProjectId!,
  })
  firebaseAuth = getAuth(firebaseApp)
  return firebaseAuth
}

async function signInWithGoogle(): Promise<{ uid: string; email: string; displayName: string; photoURL: string }> {
  const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth')
  const auth     = await getFirebaseAuth()
  const provider = new GoogleAuthProvider()
  provider.addScope('email')
  provider.addScope('profile')
  const result = await signInWithPopup(auth, provider)
  const user   = result.user
  return {
    uid:         user.uid,
    email:       user.email       ?? '',
    displayName: user.displayName ?? user.email?.split('@')[0] ?? 'User',
    photoURL:    user.photoURL    ?? '',
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

// ── Copy address button ───────────────────────────────────────────────────────
function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(address)
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      }}
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

  const handleGoogleSignIn = useCallback(async () => {
    if (!firebaseConfigured) return
    setLoading(true); setError(null)
    try {
      const { uid, email, displayName, photoURL } = await signInWithGoogle()

      // Derive deterministic wallet (~200ms)
      const privateKey = await derivePrivateKey(uid)
      const account    = privateKeyToAccount(privateKey)

      const sess: AccountSession = {
        address:    account.address,
        username:   displayName,
        email,
        picture:    photoURL,
        method:     'google',
        privateKey, // in-memory only, never persisted
      }
      saveSession(sess)
      onSignedIn(sess)
      toast.success(`Welcome, ${displayName}!`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // User closed the popup — don't show an error
      if (msg.includes('popup-closed') || msg.includes('cancelled') || msg.includes('dismissed')) {
        setError(null)
      } else {
        setError(msg)
        toast.error('Google sign-in failed: ' + msg)
      }
    } finally {
      setLoading(false)
    }
  }, [onSignedIn])

  const handleSignOut = useCallback(() => {
    clearGoogleSession()
    onSignOut()
    toast.success('Signed out')
  }, [onSignOut])

  // ── Signed-in state ───────────────────────────────────────────────────────
  if (session) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-5 flex flex-col gap-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>

        {/* User info row */}
        <div className="flex items-center gap-3">
          {session.picture
            ? <img src={session.picture} alt={session.username}
                className="size-11 rounded-full shrink-0"
                style={{ outline: '2px solid var(--border)', outlineOffset: 1 }} />
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
          <span className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold shrink-0"
            style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
            <ShieldCheck className="size-3" /> Google
          </span>
        </div>

        {/* Wallet address */}
        <div className="rounded-xl p-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--subtle)' }}>
            Wallet address
          </p>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-mono truncate flex-1" style={{ color: 'var(--ink-2)' }}>{session.address}</p>
            <CopyAddress address={session.address} />
          </div>
        </div>

        {/* Info */}
        <div className="rounded-xl p-3 flex items-start gap-2"
          style={{ background: 'rgba(59,142,248,0.05)', border: '1px solid rgba(59,142,248,0.12)' }}>
          <ShieldCheck className="size-3.5 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
          <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
            Same Google account → same wallet on any device. No seed phrase needed.
          </p>
        </div>

        {/* Sign out */}
        <button onClick={handleSignOut}
          className="w-full rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90"
          style={{ background: 'rgba(240,98,146,0.08)', color: 'var(--danger)', border: '1px solid rgba(240,98,146,0.15)' }}>
          <LogOut className="size-4" /> Sign out
        </button>
      </motion.div>
    )
  }

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
          Add these to your <code className="font-mono" style={{ color: 'var(--accent)' }}>.env</code> file:
        </p>

        <div className="rounded-xl p-3 font-mono text-xs select-all"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)', whiteSpace: 'pre' }}>
{`VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=....firebaseapp.com
VITE_FIREBASE_PROJECT_ID=...`}
        </div>

        <ol className="text-xs leading-relaxed list-decimal list-inside flex flex-col gap-1" style={{ color: 'var(--muted)' }}>
          <li>Go to <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer"
              className="underline" style={{ color: 'var(--accent)' }}>console.firebase.google.com</a></li>
          <li>Create a project → Add web app → copy the config</li>
          <li>Authentication → Sign-in method → Google → Enable</li>
          <li>Add the 3 values above to your <code className="font-mono">.env</code> and redeploy</li>
        </ol>
      </motion.div>
    )
  }

  // ── Sign-in button ────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-3">

      {loading ? (
        <div className="flex flex-col items-center gap-3 py-6">
          <Loader2 className="size-7 animate-spin" style={{ color: 'var(--accent)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Signing you in…</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>A Google pop-up should appear</p>
        </div>
      ) : (
        <>
          <button
            onClick={() => { void handleGoogleSignIn() }}
            className="w-full flex items-center justify-center gap-3 rounded-2xl px-5 py-4 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.98]"
            style={{
              background: '#fff',
              border: '1.5px solid #dadce0',
              color: '#3c4043',
              boxShadow: '0 1px 6px rgba(0,0,0,0.10)',
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
            Your wallet is tied to your Google account — no seed phrase needed.
          </p>
        </>
      )}
    </motion.div>
  )
}
