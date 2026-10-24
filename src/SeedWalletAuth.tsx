/**
 * SeedWalletAuth — self-custodial HD wallet auth for Fairtab.
 *
 * Flows:
 *  - Create new wallet  → generates mnemonic → user sets password → wallet stored encrypted
 *  - Import via seed phrase → user pastes 12/24 words → sets password → stored encrypted
 *  - Import via private key → user pastes 0x key → sets password → stored encrypted
 *  - Unlock (returning user) → password decrypts stored wallet
 *
 * Security model:
 *  - Private key and mnemonic NEVER leave the browser unencrypted.
 *  - AES-GCM encryption via WebCrypto API; password-derived key via PBKDF2.
 *  - Only the encrypted blob + salt is stored in localStorage.
 *  - Seed phrase is shown once on creation — user must acknowledge before proceeding.
 *  - Private key is revealed only on explicit tap of a hidden field after wallet is unlocked.
 */

import { useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Wallet, Eye, EyeOff, Copy, CheckCircle2, AlertTriangle,
  KeyRound, Loader2, ArrowLeft, ShieldCheck, LogOut, RefreshCw,
  Fingerprint, LifeBuoy, HelpCircle,
} from 'lucide-react'
import { authenticatePasskey, loadPasskeyCredId, ForgotPhraseFlow } from '@/WalletRecovery'
import { mnemonicToAccount, generateMnemonic, english, privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'

// ── Types ─────────────────────────────────────────────────────────────────────
export interface SeedWalletSession {
  address: Hex
  method: 'seed-wallet'
  /** In-memory only — private key for signing. Never persisted. */
  privateKey?: Hex
}

type Step =
  | 'choose'
  | 'recover'
  | 'create-show-seed'
  | 'create-set-password'
  | 'import-choose'
  | 'import-seed'
  | 'import-key'
  | 'import-set-password'
  | 'unlock'
  | 'forgot'
  | 'done'

// ── Storage key ────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'fairtab_seed_wallet_v1'

// ── Encrypted blob shape ──────────────────────────────────────────────────────
interface EncryptedWallet {
  salt: string      // hex
  iv: string        // hex
  cipher: string    // hex — AES-GCM encrypted JSON({ mnemonic?, privateKey, address })
}

// ── WebCrypto helpers ─────────────────────────────────────────────────────────
async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return arr
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function encryptWallet(
  payload: { mnemonic?: string; privateKey: Hex; address: Hex },
  password: string
): Promise<EncryptedWallet> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv   = crypto.getRandomValues(new Uint8Array(12))
  const key  = await deriveKey(password, salt)
  const enc  = new TextEncoder()
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(payload))
  )
  return {
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    cipher: bytesToHex(new Uint8Array(cipherBuf)),
  }
}

async function decryptWallet(
  blob: EncryptedWallet,
  password: string
): Promise<{ mnemonic?: string; privateKey: Hex; address: Hex }> {
  const salt   = hexToBytes(blob.salt)   as Uint8Array<ArrayBuffer>
  const iv     = hexToBytes(blob.iv)     as Uint8Array<ArrayBuffer>
  const cipher = hexToBytes(blob.cipher) as Uint8Array<ArrayBuffer>
  const key  = await deriveKey(password, salt)
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
  const dec = new TextDecoder()
  return JSON.parse(dec.decode(plainBuf)) as { mnemonic?: string; privateKey: Hex; address: Hex }
}

function loadBlob(): EncryptedWallet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as EncryptedWallet) : null
  } catch { return null }
}

function saveBlob(blob: EncryptedWallet) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(blob))
}

export function clearSeedWallet() {
  localStorage.removeItem(STORAGE_KEY)
}

// ── Public helpers for AccountPage ────────────────────────────────────────────
export function loadEncryptedWallet(): EncryptedWallet | null {
  return loadBlob()
}

export async function decryptSeedWallet(
  blob: ReturnType<typeof loadEncryptedWallet>,
  password: string
): Promise<{ mnemonic?: string; privateKey: Hex; address: Hex }> {
  if (!blob) throw new Error('No wallet found')
  return decryptWallet(blob, password)
}

export async function encryptSeedWallet(
  payload: { mnemonic?: string; privateKey: Hex; address: Hex },
  password: string
): Promise<void> {
  const blob = await encryptWallet(payload, password)
  saveBlob(blob)
}

// ── Design tokens ─────────────────────────────────────────────────────────────
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
  warning: {
    background: 'rgba(249,115,22,0.06)',
    border: '1px solid rgba(249,115,22,0.20)',
  } as React.CSSProperties,
  danger: {
    background: 'rgba(240,98,146,0.06)',
    border: '1px solid rgba(240,98,146,0.18)',
  } as React.CSSProperties,
}
const fadeUp = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 } }

// ── Small helpers ─────────────────────────────────────────────────────────────
function CopyBtn({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button onClick={copy}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-all hover:opacity-80"
      style={{ background: 'rgba(90,160,255,0.08)', color: 'var(--subtle)', border: '1px solid rgba(90,160,255,0.12)' }}>
      {copied ? <CheckCircle2 className="size-3" style={{ color: 'var(--success)' }} /> : <Copy className="size-3" />}
      {copied ? 'Copied' : (label ?? 'Copy')}
    </button>
  )
}

function PasswordInput({
  value, onChange, placeholder, onEnter,
}: { value: string; onChange: (v: string) => void; placeholder?: string; onEnter?: () => void }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onEnter?.()}
        placeholder={placeholder ?? 'Password'}
        className="w-full rounded-xl px-4 py-3 pr-11 text-sm outline-none"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(90,160,255,0.14)', color: 'var(--ink)' }}
        autoComplete="new-password"
      />
      <button type="button" onClick={() => setShow(s => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
        style={{ color: 'var(--subtle)' }}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  session: SeedWalletSession | null
  onSignedIn: (s: SeedWalletSession) => void
  onSignOut: () => void
}

export function SeedWalletAuth({ session, onSignedIn, onSignOut }: Props) {
  const hasStored = !!loadBlob()

  const [step, setStep]             = useState<Step>(hasStored ? 'unlock' : 'choose')
  const [mnemonic, setMnemonic]     = useState('')
  const [privateKey, setPrivateKey] = useState<Hex | ''>('')
  const [address, setAddress]       = useState<Hex | ''>('')
  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [unlockPw, setUnlockPw]     = useState('')
  const [importInput, setImportInput] = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [ackSeed, setAckSeed]       = useState(false)
  const [showPk, setShowPk]         = useState(false)
  const [revealedPk, setRevealedPk] = useState<Hex | null>(null)
  // ── Step: generate new mnemonic ───────────────────────────────────────────
  const handleCreateNew = useCallback(() => {
    const mn = generateMnemonic(english)
    const acct = mnemonicToAccount(mn)
    setMnemonic(mn)
    setPrivateKey(acct.getHdKey().privateKey
      ? ('0x' + bytesToHex(acct.getHdKey().privateKey!)) as Hex
      : '0x')
    setAddress(acct.address)
    setAckSeed(false)
    setStep('create-show-seed')
    setError(null)
  }, [])

  // ── Step: save encrypted wallet after password set ────────────────────────
  const handleSaveWallet = useCallback(async (mn: string | undefined, pk: Hex, addr: Hex, pw: string, conf: string) => {
    if (pw.length < 8) { setError('Password must be at least 8 characters'); return }
    if (pw !== conf)   { setError('Passwords do not match'); return }
    setLoading(true); setError(null)
    try {
      const blob = await encryptWallet({ mnemonic: mn, privateKey: pk, address: addr }, pw)
      saveBlob(blob)
      onSignedIn({ address: addr, method: 'seed-wallet', privateKey: pk })
      setStep('done')
      toast.success('Wallet ready!')
    } catch (e) {
      setError((e as Error).message)
      toast.error('Encryption failed')
    } finally { setLoading(false) }
  }, [onSignedIn])

  // ── Step: parse import input (seed or private key) ─────────────────────────
  const handleParseImport = useCallback((raw: string) => {
    setError(null)
    const trimmed = raw.trim()
    // Detect private key: 0x + 64 hex chars
    if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
      try {
        const acct = privateKeyToAccount(trimmed as Hex)
        setPrivateKey(trimmed as Hex)
        setAddress(acct.address)
        setMnemonic('')
        setStep('import-set-password')
      } catch { setError('Invalid private key') }
      return
    }
    // Detect mnemonic: 12 or 24 words
    const words = trimmed.split(/\s+/)
    if (words.length === 12 || words.length === 24) {
      try {
        const acct = mnemonicToAccount(trimmed)
        setMnemonic(trimmed)
        setPrivateKey(acct.getHdKey().privateKey
          ? ('0x' + bytesToHex(acct.getHdKey().privateKey!)) as Hex
          : '0x')
        setAddress(acct.address)
        setStep('import-set-password')
      } catch { setError('Invalid seed phrase — check all words are correct') }
      return
    }
    setError('Enter a valid 12/24-word seed phrase or a 0x private key')
  }, [])

  // ── Step: unlock existing wallet ──────────────────────────────────────────
  const handleUnlock = useCallback(async () => {
    const blob = loadBlob()
    if (!blob) { setError('No wallet found'); return }
    setLoading(true); setError(null)
    try {
      const payload = await decryptWallet(blob, unlockPw)
      onSignedIn({ address: payload.address, method: 'seed-wallet', privateKey: payload.privateKey })
      setStep('done')
      toast.success('Wallet unlocked!')
    } catch {
      setError('Wrong password')
      toast.error('Wrong password')
    } finally { setLoading(false) }
  }, [unlockPw, onSignedIn])

  // ── Reveal private key for signed-in user ────────────────────────────────
  const handleRevealPk = useCallback(async () => {
    const blob = loadBlob()
    if (!blob || !unlockPw) {
      // Ask for password inline
      setShowPk(true)
      return
    }
    setLoading(true)
    try {
      const payload = await decryptWallet(blob, unlockPw)
      setRevealedPk(payload.privateKey)
    } catch { toast.error('Wrong password') }
    finally { setLoading(false) }
  }, [unlockPw])

  // ── Passkey unlock ────────────────────────────────────────────────────────
  const handlePasskeyUnlock = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const ok = await authenticatePasskey()
      if (!ok) { setError('Passkey authentication failed'); setLoading(false); return }
      // After passkey auth, we still need to decrypt with password.
      // Show password input with a "passkey verified" note — or if we have the pw cached, auto-unlock.
      // For now: show unlock with a success indicator that passkey was verified
      toast.success('Passkey verified — enter your password to decrypt')
    } catch (e) {
      const msg = (e as Error).message
      if (!msg.includes('cancelled') && !msg.includes('abort')) setError(msg)
    } finally { setLoading(false) }
  }, [])

  // ── Sign out ──────────────────────────────────────────────────────────────
  const handleSignOut = useCallback(() => {
    setRevealedPk(null); setUnlockPw(''); setShowPk(false)
    onSignOut()
    setStep(loadBlob() ? 'unlock' : 'choose')
    toast.success('Wallet locked')
  }, [onSignOut])

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  // ── Signed-in state ───────────────────────────────────────────────────────
  if (session) {
    return (
      <motion.div className="rounded-2xl p-5 relative overflow-hidden" style={glass.card} {...fadeUp}>
        <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: spectral }} />
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(45,216,122,0.1)', border: '1px solid rgba(45,216,122,0.2)' }}>
              <ShieldCheck className="size-5" style={{ color: 'var(--success)' }} />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Self-custodial wallet</p>
              <p className="text-xs font-mono tabular-nums mt-0.5" style={{ color: 'var(--subtle)' }}>
                {session.address.slice(0, 8)}…{session.address.slice(-6)}
              </p>
            </div>
          </div>
          <CopyBtn value={session.address} label="Copy" />
        </div>

        {/* Private key reveal */}
        <div className="rounded-xl p-3 mb-3" style={glass.inner}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium" style={{ color: 'var(--subtle)' }}>Private key</p>
            {!revealedPk && (
              <button onClick={() => setShowPk(s => !s)}
                className="text-xs flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                <Eye className="size-3" /> Reveal
              </button>
            )}
            {revealedPk && <CopyBtn value={revealedPk} label="Copy key" />}
          </div>

          {!revealedPk && !showPk && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>Enter your password to reveal</p>
          )}

          {!revealedPk && showPk && (
            <div className="flex gap-2 mt-1">
              <PasswordInput value={unlockPw} onChange={setUnlockPw} placeholder="Your password" onEnter={() => void handleRevealPk()} />
              <button onClick={() => void handleRevealPk()} disabled={loading || !unlockPw}
                className="rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50"
                style={{ background: 'var(--accent)', color: 'white' }}>
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : 'Show'}
              </button>
            </div>
          )}

          {revealedPk && (
            <div className="flex items-center gap-2">
              <p className="text-xs font-mono break-all flex-1" style={{ color: 'var(--ink)' }}>
                {showPk ? revealedPk : '••••••••••••••••••••••••••••••••'}
              </p>
              <button onClick={() => setShowPk(s => !s)} style={{ color: 'var(--subtle)' }}>
                {showPk ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={handleSignOut}
            className="flex-1 rounded-xl py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
            <LogOut className="size-3.5" /> Lock wallet
          </button>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div className="rounded-2xl p-5 relative overflow-hidden" style={glass.card} {...fadeUp}>
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: spectral }} />

      <AnimatePresence mode="wait">

        {/* ── Choose ──────────────────────────────────────────────────────── */}
        {step === 'choose' && (
          <motion.div key="choose" className="flex flex-col gap-3" {...fadeUp}>
            <div className="flex items-center gap-3 mb-1">
              <div className="size-10 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(59,142,248,0.10)', border: '1px solid rgba(90,160,255,0.18)' }}>
                <Wallet className="size-5" style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Wallet</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Create new or import existing</p>
              </div>
            </div>

            <button onClick={handleCreateNew}
              className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all hover:scale-[1.01]"
              style={{ background: 'var(--accent)', color: 'white' }}>
              <Wallet className="size-4" /> Create new wallet
            </button>

            <button onClick={() => { setStep('import-choose'); setError(null) }}
              className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all hover:scale-[1.01]"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
              <KeyRound className="size-4" style={{ color: 'var(--accent)' }} /> Import wallet
            </button>

            {/* Divider */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
              <span className="text-xs" style={{ color: 'var(--subtle)' }}>lost your phrase?</span>
              <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
            </div>

            <button onClick={() => { setStep('recover'); setError(null) }}
              className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all hover:scale-[1.01]"
              style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--ink)', border: '1px dashed rgba(90,160,255,0.3)' }}>
              <LifeBuoy className="size-4" style={{ color: 'var(--accent)' }} /> Recover wallet
            </button>
          </motion.div>
        )}

        {/* ── Recover ──────────────────────────────────────────────────────── */}
        {step === 'recover' && (
          <motion.div key="recover" className="flex flex-col gap-3" {...fadeUp}>
            <ForgotPhraseFlow
              onRecovered={() => {
                setStep('unlock')
                setUnlockPw('')
                setError(null)
                toast.info('Wallet restored — enter your password to unlock')
              }}
              onCancel={() => setStep('choose')}
            />
          </motion.div>
        )}

        {/* ── Show seed phrase ─────────────────────────────────────────────── */}
        {step === 'create-show-seed' && (
          <motion.div key="create-show-seed" className="flex flex-col gap-3" {...fadeUp}>
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Your seed phrase</p>
              <CopyBtn value={mnemonic} label="Copy all" />
            </div>

            <div className="rounded-xl p-3" style={glass.warning}>
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
                <p className="text-xs leading-relaxed" style={{ color: 'var(--warning)' }}>
                  Write this down and keep it safe. Anyone with these words controls your wallet. It will NOT be shown again.
                </p>
              </div>
            </div>

            {/* Word grid */}
            <div className="grid grid-cols-3 gap-1.5">
              {mnemonic.split(' ').map((word, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(90,160,255,0.10)' }}>
                  <span className="text-xs tabular-nums w-4 shrink-0" style={{ color: 'var(--subtle)' }}>{i + 1}</span>
                  <span className="text-xs font-mono font-medium" style={{ color: 'var(--ink)' }}>{word}</span>
                </div>
              ))}
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={ackSeed} onChange={e => setAckSeed(e.target.checked)}
                className="rounded" />
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                I have saved my seed phrase somewhere safe
              </span>
            </label>

            <button
              disabled={!ackSeed}
              onClick={() => setStep('create-set-password')}
              className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-40 transition-all"
              style={{ background: 'var(--accent)', color: 'white' }}>
              Continue
            </button>
            <button onClick={() => setStep('choose')} className="text-xs text-center" style={{ color: 'var(--subtle)' }}>← Back</button>
          </motion.div>
        )}

        {/* ── Set password (create) ────────────────────────────────────────── */}
        {step === 'create-set-password' && (
          <motion.div key="create-set-password" className="flex flex-col gap-3" {...fadeUp}>
            <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Set a password</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              This encrypts your wallet on this device. You will need it to unlock your wallet here.
            </p>
            <PasswordInput value={password} onChange={setPassword} placeholder="Password (min 8 chars)" />
            <PasswordInput value={confirm} onChange={setConfirm} placeholder="Confirm password"
              onEnter={() => void handleSaveWallet(mnemonic, privateKey as Hex, address as Hex, password, confirm)} />
            {error && <p className="text-xs px-1" style={{ color: 'var(--danger)' }}>{error}</p>}
            <button
              disabled={loading || !password || !confirm}
              onClick={() => void handleSaveWallet(mnemonic, privateKey as Hex, address as Hex, password, confirm)}
              className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: 'var(--accent)', color: 'white' }}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <><ShieldCheck className="size-4" /> Create wallet</>}
            </button>
            <button onClick={() => setStep('create-show-seed')} className="text-xs text-center" style={{ color: 'var(--subtle)' }}>← Back</button>
          </motion.div>
        )}

        {/* ── Import: choose method ────────────────────────────────────────── */}
        {step === 'import-choose' && (
          <motion.div key="import-choose" className="flex flex-col gap-3" {...fadeUp}>
            <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Import wallet</p>
            <button onClick={() => { setStep('import-seed'); setImportInput(''); setError(null) }}
              className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all hover:scale-[1.01]"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
              <RefreshCw className="size-4" style={{ color: 'var(--accent)' }} /> Use seed phrase
            </button>
            <button onClick={() => { setStep('import-key'); setImportInput(''); setError(null) }}
              className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all hover:scale-[1.01]"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
              <KeyRound className="size-4" style={{ color: 'var(--accent)' }} /> Use private key
            </button>
            <button onClick={() => setStep('choose')} className="text-xs text-center" style={{ color: 'var(--subtle)' }}>← Back</button>
          </motion.div>
        )}

        {/* ── Import: seed phrase ──────────────────────────────────────────── */}
        {step === 'import-seed' && (
          <motion.div key="import-seed" className="flex flex-col gap-3" {...fadeUp}>
            <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Enter seed phrase</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>12 or 24 words, space-separated</p>
            <textarea
              rows={4}
              value={importInput}
              onChange={e => setImportInput(e.target.value)}
              placeholder="word1 word2 word3 …"
              className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none font-mono"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(90,160,255,0.14)', color: 'var(--ink)' }}
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            />
            {error && <p className="text-xs px-1" style={{ color: 'var(--danger)' }}>{error}</p>}
            <button onClick={() => handleParseImport(importInput)} disabled={!importInput.trim()}
              className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'white' }}>
              Continue
            </button>
            <button onClick={() => setStep('import-choose')} className="text-xs text-center" style={{ color: 'var(--subtle)' }}>← Back</button>
          </motion.div>
        )}

        {/* ── Import: private key ──────────────────────────────────────────── */}
        {step === 'import-key' && (
          <motion.div key="import-key" className="flex flex-col gap-3" {...fadeUp}>
            <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Enter private key</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>0x followed by 64 hex characters</p>
            <div className="rounded-xl p-3" style={glass.danger}>
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
                <p className="text-xs leading-relaxed" style={{ color: 'var(--danger)' }}>
                  Never share your private key. Only enter it on a trusted device.
                </p>
              </div>
            </div>
            <PasswordInput value={importInput} onChange={setImportInput} placeholder="0x..." />
            {error && <p className="text-xs px-1" style={{ color: 'var(--danger)' }}>{error}</p>}
            <button onClick={() => handleParseImport(importInput)} disabled={!importInput.trim()}
              className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'white' }}>
              Continue
            </button>
            <button onClick={() => setStep('import-choose')} className="text-xs text-center" style={{ color: 'var(--subtle)' }}>← Back</button>
          </motion.div>
        )}

        {/* ── Set password (import) ────────────────────────────────────────── */}
        {step === 'import-set-password' && (
          <motion.div key="import-set-password" className="flex flex-col gap-3" {...fadeUp}>
            <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Protect with a password</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Your wallet at <span className="font-mono" style={{ color: 'var(--accent)' }}>
                {address ? (address as string).slice(0, 10) + '…' : ''}
              </span> will be encrypted on this device.
            </p>
            <PasswordInput value={password} onChange={setPassword} placeholder="Password (min 8 chars)" />
            <PasswordInput value={confirm} onChange={setConfirm} placeholder="Confirm password"
              onEnter={() => void handleSaveWallet(mnemonic || undefined, privateKey as Hex, address as Hex, password, confirm)} />
            {error && <p className="text-xs px-1" style={{ color: 'var(--danger)' }}>{error}</p>}
            <button
              disabled={loading || !password || !confirm}
              onClick={() => void handleSaveWallet(mnemonic || undefined, privateKey as Hex, address as Hex, password, confirm)}
              className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: 'var(--accent)', color: 'white' }}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <><ShieldCheck className="size-4" /> Import wallet</>}
            </button>
            <button onClick={() => setStep('import-choose')} className="text-xs text-center" style={{ color: 'var(--subtle)' }}>← Back</button>
          </motion.div>
        )}

        {/* ── Unlock ──────────────────────────────────────────────────────── */}
        {step === 'unlock' && (
          <motion.div key="unlock" className="flex flex-col gap-3" {...fadeUp}>
            <div className="flex items-center gap-3 mb-1">
              <div className="size-10 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(59,142,248,0.10)', border: '1px solid rgba(90,160,255,0.18)' }}>
                <KeyRound className="size-5" style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Unlock wallet</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Enter your password to continue</p>
              </div>
            </div>

            <PasswordInput value={unlockPw} onChange={setUnlockPw} placeholder="Password"
              onEnter={() => void handleUnlock()} />
            {error && <p className="text-xs px-1" style={{ color: 'var(--danger)' }}>{error}</p>}

            <button onClick={() => void handleUnlock()} disabled={loading || !unlockPw}
              className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: 'var(--accent)', color: 'white' }}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <><KeyRound className="size-4" /> Unlock</>}
            </button>

            {/* Passkey unlock — only shown if a passkey is registered */}
            {loadPasskeyCredId() && (
              <button onClick={() => void handlePasskeyUnlock()} disabled={loading}
                className="w-full rounded-xl py-3 text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'rgba(59,142,248,0.08)', color: 'var(--accent)', border: '1px solid rgba(90,160,255,0.18)' }}>
                <Fingerprint className="size-4" /> Use passkey (Face ID / fingerprint)
              </button>
            )}

            <div className="flex items-center justify-between pt-1">
              <button onClick={() => setStep('forgot')}
                className="flex items-center gap-1 text-xs" style={{ color: 'var(--subtle)' }}>
                <HelpCircle className="size-3.5" /> Forgot phrase?
              </button>
              <button onClick={() => { clearSeedWallet(); setStep('choose'); setUnlockPw(''); setError(null) }}
                className="flex items-center gap-1 text-xs" style={{ color: 'var(--danger)' }}>
                <ArrowLeft className="size-3.5" /> Different wallet
              </button>
            </div>
          </motion.div>
        )}

        {/* ── Forgot phrase ────────────────────────────────────────────────── */}
        {step === 'forgot' && (
          <motion.div key="forgot" {...fadeUp}>
            <ForgotPhraseFlow
              onRecovered={() => {
                // Wallet blob restored to localStorage — go back to unlock
                setStep('unlock')
                setUnlockPw('')
                setError(null)
                toast.info('Wallet restored — enter your password to unlock, or create a new password')
              }}
              onCancel={() => setStep('unlock')}
            />
          </motion.div>
        )}

      </AnimatePresence>
    </motion.div>
  )
}
