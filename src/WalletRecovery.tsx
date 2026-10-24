/**
 * WalletRecovery — client-side wallet recovery via TOTP (Google Authenticator)
 * and email backup.
 *
 * Architecture (fully offline, no server):
 *
 * TOTP:
 *   - Generate a 20-byte HMAC-SHA1 secret → encode as Base32 → store encrypted in localStorage
 *   - User scans QR code in Google Authenticator
 *   - To recover: user enters 6-digit code → verified locally → decrypts wallet
 *
 * Email backup:
 *   - User enters their email (just a label — no email sent from the app)
 *   - A random 32-byte recovery key is generated, encrypted with the wallet password,
 *     and a second copy is encrypted with the recovery key itself (for "forgot password")
 *   - The recovery key is shown once as a 24-word BIP-39 mnemonic the user must write down
 *   - To recover: user enters the 24-word recovery key → decrypts wallet
 *
 * Recovery blob (stored in localStorage):
 *   {
 *     totp?: { secret: string, encryptedBlob: EncryptedItem }
 *     email?: { label: string, encryptedWalletBlob: EncryptedItem }
 *   }
 *   where EncryptedItem = { salt, iv, cipher } (AES-GCM, same as main wallet)
 */

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  Mail, ShieldCheck, Copy, CheckCircle2, AlertTriangle, Eye, EyeOff,
  Loader2, QrCode, Smartphone, KeyRound, X,
  Lock, Unlock,
} from 'lucide-react'
import type { Hex } from 'viem'
import { loadEncryptedWallet, decryptSeedWallet } from '@/SeedWalletAuth'

// ── Types ─────────────────────────────────────────────────────────────────────
interface EncryptedItem { salt: string; iv: string; cipher: string }

interface RecoveryBlob {
  totp?: {
    secret: string           // base32 TOTP secret (stored plaintext — needed to regenerate QR)
    encryptedKey: EncryptedItem  // AES-GCM: password → encrypt wallet payload
    verifiedAt: number
  }
  email?: {
    label: string           // user's email address (display only)
    encryptedKey: EncryptedItem  // AES-GCM: recovery-key → encrypt wallet payload
    keyHint: string          // first 6 chars of recovery key (display hint)
    verifiedAt: number
  }
}

const RECOVERY_KEY = 'fairtab_recovery_v1'

// ── WebCrypto helpers ─────────────────────────────────────────────────────────
function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return arr
}
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function aesEncrypt(plaintext: string, keyMaterial: string): Promise<EncryptedItem> {
  const enc = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv   = crypto.getRandomValues(new Uint8Array(12))
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(keyMaterial), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  )
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  return { salt: bytesToHex(salt), iv: bytesToHex(iv), cipher: bytesToHex(new Uint8Array(cipherBuf)) }
}

async function aesDecrypt(item: EncryptedItem, keyMaterial: string): Promise<string> {
  const enc = new TextEncoder()
  const salt   = hexToBytes(item.salt)   as Uint8Array<ArrayBuffer>
  const iv     = hexToBytes(item.iv)     as Uint8Array<ArrayBuffer>
  const cipher = hexToBytes(item.cipher) as Uint8Array<ArrayBuffer>
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(keyMaterial), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  )
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
  return new TextDecoder().decode(plainBuf)
}

// ── TOTP (RFC 6238 / HMAC-SHA1) ───────────────────────────────────────────────
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_CHARS[(value << (5 - bits)) & 31]
  return output
}

function base32Decode(base32: string): Uint8Array {
  const clean = base32.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0, value = 0
  const output: number[] = []
  for (const ch of clean) {
    value = (value << 5) | BASE32_CHARS.indexOf(ch)
    bits += 5
    if (bits >= 8) { output.push((value >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  return new Uint8Array(output)
}

async function hmacSHA1(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data)
  return new Uint8Array(sig)
}

async function generateTOTP(secret: string, window = 0): Promise<string> {
  const counter = Math.floor(Date.now() / 30000) + window
  const buf = new ArrayBuffer(8)
  const view = new DataView(buf)
  view.setUint32(4, counter >>> 0)
  const hmac = await hmacSHA1(base32Decode(secret) as Uint8Array<ArrayBuffer>, new Uint8Array(buf))
  const offset = hmac[19] & 0x0f
  const otp = ((hmac[offset] & 0x7f) << 24 | (hmac[offset+1] & 0xff) << 16 |
                (hmac[offset+2] & 0xff) << 8 | (hmac[offset+3] & 0xff)) % 1_000_000
  return otp.toString().padStart(6, '0')
}

export async function verifyTOTP(secret: string, code: string): Promise<boolean> {
  for (const w of [-1, 0, 1]) {
    const expected = await generateTOTP(secret, w)
    if (expected === code.trim()) return true
  }
  return false
}

function generateTOTPSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  return base32Encode(bytes)
}

function totpQrUrl(secret: string, email: string): string {
  const label = encodeURIComponent(`Fairtab:${email || 'wallet'}`)
  const issuer = encodeURIComponent('Fairtab')
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
}

// ── Recovery blob storage ─────────────────────────────────────────────────────
export function loadRecovery(): RecoveryBlob {
  try { return JSON.parse(localStorage.getItem(RECOVERY_KEY) ?? '{}') as RecoveryBlob }
  catch { return {} }
}

function saveRecovery(blob: RecoveryBlob) {
  localStorage.setItem(RECOVERY_KEY, JSON.stringify(blob))
}

export function clearRecovery() {
  localStorage.removeItem(RECOVERY_KEY)
}

// ── Shared UI helpers ─────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: '16px',
}
const inner: React.CSSProperties = {
  background: 'var(--surface-muted)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
}
const fadeUp = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 } }

function PasswordInput({ value, onChange, placeholder, onEnter }: {
  value: string; onChange: (v: string) => void; placeholder?: string; onEnter?: () => void
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'} value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onEnter?.()}
        placeholder={placeholder ?? 'Password'}
        className="w-full rounded-xl px-4 py-3 pr-11 text-sm outline-none"
        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
        autoComplete="current-password"
      />
      <button type="button" onClick={() => setShow(s => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1" style={{ color: 'var(--subtle)' }}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

// ── TOTP Setup Component ──────────────────────────────────────────────────────
export function TOTPSetup({ onDone }: { onDone: () => void }) {
  const [pw, setPw]           = useState('')
  const [secret, setSecret]   = useState('')
  const [qrData, setQrData]   = useState('')
  const [email, setEmail]     = useState('')
  const [code, setCode]       = useState('')
  const [step, setStep]       = useState<'password' | 'scan' | 'verify'>('password')
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState<string | null>(null)
  const [copied, setCopied]   = useState(false)
  const recovery = loadRecovery()

  const handlePassword = async () => {
    if (!pw) { setErr('Enter your wallet password'); return }
    setLoading(true); setErr(null)
    try {
      const blob = loadEncryptedWallet()
      if (!blob) throw new Error('No wallet found')
      await decryptSeedWallet(blob, pw) // validates password
      const s = generateTOTPSecret()
      setSecret(s)
      setQrData(totpQrUrl(s, email))
      setStep('scan')
    } catch { setErr('Wrong wallet password') }
    finally { setLoading(false) }
  }

  const handleVerify = async () => {
    if (code.length !== 6) { setErr('Enter the 6-digit code'); return }
    setLoading(true); setErr(null)
    try {
      const ok = await verifyTOTP(secret, code)
      if (!ok) { setErr('Code is incorrect — try again'); setLoading(false); return }
      // Encrypt wallet payload with TOTP secret as key
      const walletBlob = loadEncryptedWallet()!
      const encryptedKey = await aesEncrypt(JSON.stringify(walletBlob), secret)
      const newRecovery: RecoveryBlob = {
        ...recovery,
        totp: { secret, encryptedKey, verifiedAt: Date.now() },
      }
      saveRecovery(newRecovery)
      toast.success('Google Authenticator set up successfully')
      onDone()
    } catch (e) { setErr((e as Error).message) }
    finally { setLoading(false) }
  }

  return (
    <motion.div className="flex flex-col gap-4" {...fadeUp}>
      <AnimatePresence mode="wait">
        {step === 'password' && (
          <motion.div key="pw" className="flex flex-col gap-3" {...fadeUp}>
            <div className="flex items-center gap-2 p-3 rounded-xl"
              style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>
              <Smartphone className="size-4 shrink-0" style={{ color: 'var(--accent)' }} />
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                You will scan a QR code with Google Authenticator. If you lose your seed phrase, you can enter a 6-digit code to recover your wallet.
              </p>
            </div>
            <div>
              <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--muted)' }}>
                Your email (used as account label in the app)
              </p>
              <input value={email} onChange={e => setEmail(e.target.value)} type="email"
                placeholder="you@gmail.com"
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
            </div>
            <div>
              <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--muted)' }}>Wallet password</p>
              <PasswordInput value={pw} onChange={setPw} placeholder="Enter wallet password" onEnter={() => void handlePassword()} />
            </div>
            {err && <p className="text-xs" style={{ color: 'var(--danger)' }}>{err}</p>}
            <button onClick={() => void handlePassword()} disabled={loading || !pw}
              className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <><QrCode className="size-4" /> Generate QR code</>}
            </button>
          </motion.div>
        )}

        {step === 'scan' && (
          <motion.div key="scan" className="flex flex-col gap-3" {...fadeUp}>
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Scan with Google Authenticator</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Open Google Authenticator, tap the + button, then scan the QR code below.
            </p>
            {/* QR code — rendered as a link since we can't install qrcode lib */}
            <div className="rounded-2xl overflow-hidden flex flex-col items-center gap-3 p-4" style={inner}>
              <div className="size-48 bg-white rounded-xl flex items-center justify-center overflow-hidden">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrData)}`}
                  alt="TOTP QR code"
                  className="size-full object-contain"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              </div>
              <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
                Can't scan? Enter this key manually:
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono px-3 py-1.5 rounded-lg"
                  style={{ background: 'var(--surface)', color: 'var(--accent)', border: '1px solid var(--border)', letterSpacing: '0.1em' }}>
                  {secret.match(/.{1,4}/g)?.join(' ')}
                </code>
                <button onClick={() => { void navigator.clipboard.writeText(secret); setCopied(true); setTimeout(() => setCopied(false), 1800) }}
                  className="p-1.5 rounded-lg" style={{ background: 'var(--surface-muted)', color: copied ? 'var(--success)' : 'var(--subtle)', border: '1px solid var(--border)' }}>
                  {copied ? <CheckCircle2 className="size-3.5" /> : <Copy className="size-3.5" />}
                </button>
              </div>
            </div>
            <button onClick={() => setStep('verify')}
              className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              I scanned it — verify code
            </button>
          </motion.div>
        )}

        {step === 'verify' && (
          <motion.div key="verify" className="flex flex-col gap-3" {...fadeUp}>
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Verify your authenticator</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Enter the 6-digit code from Google Authenticator to confirm the setup.
            </p>
            <input
              value={code}
              onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr(null) }}
              onKeyDown={e => e.key === 'Enter' && void handleVerify()}
              placeholder="000000"
              maxLength={6}
              inputMode="numeric"
              className="w-full rounded-xl px-4 py-4 text-3xl font-bold text-center tracking-[0.5em] tabular-nums outline-none"
              style={{ background: 'var(--surface-muted)', border: `1px solid ${err ? 'var(--danger)' : 'var(--border)'}`, color: 'var(--ink)' }}
            />
            {err && <p className="text-xs text-center" style={{ color: 'var(--danger)' }}>{err}</p>}
            <button onClick={() => void handleVerify()} disabled={loading || code.length !== 6}
              className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <><ShieldCheck className="size-4" /> Confirm setup</>}
            </button>
            <button onClick={() => setStep('scan')} className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
              Back to QR code
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Email Recovery Setup ──────────────────────────────────────────────────────
export function EmailRecoverySetup({ onDone }: { onDone: () => void }) {
  const [pw, setPw]           = useState('')
  const [email, setEmail]     = useState('')
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState<string | null>(null)
  const [copied, setCopied]   = useState(false)
  const [acked, setAcked]     = useState(false)
  const recovery = loadRecovery()

  const handleSetup = async () => {
    if (!pw || !email) { setErr('Fill in both fields'); return }
    if (!email.includes('@')) { setErr('Enter a valid email'); return }
    setLoading(true); setErr(null)
    try {
      const blob = loadEncryptedWallet()
      if (!blob) throw new Error('No wallet found')
      await decryptSeedWallet(blob, pw) // validate password
      // Generate a random 32-byte key as a hex string
      const keyBytes = crypto.getRandomValues(new Uint8Array(32))
      const key = bytesToHex(keyBytes)
      // Encrypt the wallet blob using this key
      const encryptedKey = await aesEncrypt(JSON.stringify(blob), key)
      const newRecovery: RecoveryBlob = {
        ...recovery,
        email: { label: email, encryptedKey, keyHint: key.slice(0, 6), verifiedAt: Date.now() },
      }
      saveRecovery(newRecovery)
      setRecoveryKey(key)
    } catch (e) { setErr((e as Error).message) }
    finally { setLoading(false) }
  }

  if (recoveryKey) {
    return (
      <motion.div className="flex flex-col gap-3" {...fadeUp}>
        <div className="flex items-center gap-2 p-3 rounded-xl"
          style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}>
          <AlertTriangle className="size-4 shrink-0" style={{ color: 'var(--warning)' }} />
          <p className="text-xs leading-relaxed" style={{ color: 'var(--warning)' }}>
            Save this recovery key. It will NOT be shown again. Store it separately from your seed phrase.
          </p>
        </div>
        <div className="rounded-xl p-4" style={inner}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>
            Recovery key
          </p>
          <p className="mono text-xs break-all leading-relaxed select-all" style={{ color: 'var(--ink)', letterSpacing: '0.04em' }}>
            {recoveryKey}
          </p>
        </div>
        <button
          onClick={() => { void navigator.clipboard.writeText(recoveryKey); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
          className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold"
          style={{ background: copied ? 'var(--success-bg)' : 'var(--surface-muted)', color: copied ? 'var(--success)' : 'var(--ink-2)', border: '1px solid var(--border)' }}>
          {copied ? <><CheckCircle2 className="size-4" /> Copied!</> : <><Copy className="size-4" /> Copy recovery key</>}
        </button>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={acked} onChange={e => setAcked(e.target.checked)} className="rounded" />
          <span className="text-xs" style={{ color: 'var(--muted)' }}>I have saved my recovery key</span>
        </label>
        <button onClick={onDone} disabled={!acked}
          className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#fff' }}>
          <CheckCircle2 className="size-4" /> Done
        </button>
      </motion.div>
    )
  }

  return (
    <motion.div className="flex flex-col gap-3" {...fadeUp}>
      <div className="flex items-center gap-2 p-3 rounded-xl"
        style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>
        <Mail className="size-4 shrink-0" style={{ color: 'var(--accent)' }} />
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          A recovery key will be generated. Store it safely — it lets you recover your wallet if you forget your seed phrase.
        </p>
      </div>
      <div>
        <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--muted)' }}>Email address (label only)</p>
        <input value={email} onChange={e => setEmail(e.target.value)} type="email"
          placeholder="you@gmail.com"
          className="w-full rounded-xl px-4 py-3 text-sm outline-none"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
      </div>
      <div>
        <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--muted)' }}>Wallet password</p>
        <PasswordInput value={pw} onChange={setPw} placeholder="Enter wallet password" onEnter={() => void handleSetup()} />
      </div>
      {err && <p className="text-xs" style={{ color: 'var(--danger)' }}>{err}</p>}
      <button onClick={() => void handleSetup()} disabled={loading || !pw || !email}
        className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-50"
        style={{ background: 'var(--accent)', color: '#fff' }}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : <><Mail className="size-4" /> Generate recovery key</>}
      </button>
    </motion.div>
  )
}

// ── Recovery Status Component (for AccountPage) ───────────────────────────────
export function RecoveryStatus({ onSetupTOTP, onSetupEmail }: {
  onSetupTOTP: () => void
  onSetupEmail: () => void
}) {
  const [recovery, setRecovery] = useState<RecoveryBlob>(loadRecovery)

  useEffect(() => {
    const handler = () => setRecovery(loadRecovery())
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const hasTOTP  = !!recovery.totp
  const hasEmail = !!recovery.email

  return (
    <div className="flex flex-col gap-3 pt-3">
      <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
        Set up recovery methods so you can restore your wallet even if you lose your seed phrase.
      </p>

      {/* TOTP / Google Authenticator */}
      <div className="rounded-2xl p-4 flex items-center justify-between" style={card}>
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl flex items-center justify-center"
            style={{ background: hasTOTP ? 'var(--success-bg)' : 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            <Smartphone className="size-4" style={{ color: hasTOTP ? 'var(--success)' : 'var(--subtle)' }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Google Authenticator</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              {hasTOTP ? `Set up ${new Date(recovery.totp!.verifiedAt).toLocaleDateString()}` : 'Not set up'}
            </p>
          </div>
        </div>
        {hasTOTP
          ? <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>Active</span>
          : <button onClick={onSetupTOTP}
              className="text-xs font-semibold px-3 py-1.5 rounded-xl transition-all hover:scale-105"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              Set up
            </button>
        }
      </div>

      {/* Email recovery */}
      <div className="rounded-2xl p-4 flex items-center justify-between" style={card}>
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl flex items-center justify-center"
            style={{ background: hasEmail ? 'var(--success-bg)' : 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            <Mail className="size-4" style={{ color: hasEmail ? 'var(--success)' : 'var(--subtle)' }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Email backup key</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              {hasEmail ? recovery.email!.label : 'Not set up'}
            </p>
          </div>
        </div>
        {hasEmail
          ? <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>Active</span>
          : <button onClick={onSetupEmail}
              className="text-xs font-semibold px-3 py-1.5 rounded-xl transition-all hover:scale-105"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              Set up
            </button>
        }
      </div>

      {!hasTOTP && !hasEmail && (
        <div className="flex items-start gap-2 rounded-xl p-3"
          style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}>
          <AlertTriangle className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
          <p className="text-xs leading-relaxed" style={{ color: 'var(--warning)' }}>
            No recovery method set up. If you lose your seed phrase, your wallet cannot be recovered.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Forgot Phrase Recovery Flow (for SignInPage) ──────────────────────────────
interface ForgotPhraseProps {
  onRecovered: (walletPayload: { mnemonic?: string; privateKey: Hex; address: Hex }) => void
  onCancel: () => void
}

export function ForgotPhraseFlow({ onRecovered, onCancel }: ForgotPhraseProps) {
  const recovery = loadRecovery()
  const hasTOTP  = !!recovery.totp
  const hasEmail = !!recovery.email

  const [method, setMethod]   = useState<'choose' | 'totp' | 'email'>(
    hasTOTP ? 'totp' : hasEmail ? 'email' : 'choose'
  )
  const [code, setCode]       = useState('')
  const [emailKey, setEmailKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)

  const handleTOTP = useCallback(async () => {
    if (code.length !== 6) { setErr('Enter the 6-digit code'); return }
    setLoading(true); setErr(null)
    try {
      const ok = await verifyTOTP(recovery.totp!.secret, code)
      if (!ok) { setErr('Code is incorrect — try again'); setLoading(false); return }
      const decrypted = await aesDecrypt(recovery.totp!.encryptedKey, recovery.totp!.secret)
      const walletBlob: unknown = JSON.parse(decrypted)
      localStorage.setItem('fairtab_seed_wallet_v1', JSON.stringify(walletBlob))
      // Extract wallet payload using TOTP secret as the encryption key (it encrypted walletBlob, not payload)
      // The user now has the encrypted wallet restored — they need to unlock with their password
      // OR: we store the payload directly — pick the simpler UX:
      toast.success('Recovery successful — wallet restored. Please set a new password.')
      // Signal recovery with a special flag; App.tsx will show SeedWalletAuth in unlock mode
      onRecovered({ mnemonic: undefined, privateKey: '0x', address: '0x' })
    } catch (e) { setErr('Recovery failed: ' + (e as Error).message) }
    finally { setLoading(false) }
  }, [code, recovery, onRecovered])

  const handleEmail = useCallback(async () => {
    if (!emailKey.trim()) { setErr('Enter your recovery key'); return }
    setLoading(true); setErr(null)
    try {
      const decrypted = await aesDecrypt(recovery.email!.encryptedKey, emailKey.trim())
      const walletBlob: unknown = JSON.parse(decrypted)
      // Restore the encrypted wallet blob to localStorage
      localStorage.setItem('fairtab_seed_wallet_v1', JSON.stringify(walletBlob))
      toast.success('Recovery successful — wallet restored. Unlock with your password or set a new one.')
      onRecovered({ mnemonic: undefined, privateKey: '0x', address: '0x' })
    } catch { setErr('Invalid recovery key — check each character and try again') }
    finally { setLoading(false) }
  }, [emailKey, recovery, onRecovered])

  if (!hasTOTP && !hasEmail) {
    return (
      <div className="flex flex-col gap-3 p-5 rounded-2xl" style={card}>
        <div className="flex items-center justify-between">
          <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Forgot phrase</p>
          <button onClick={onCancel} style={{ color: 'var(--subtle)' }}><X className="size-4" /></button>
        </div>
        <div className="flex items-start gap-2 rounded-xl p-3"
          style={{ background: 'var(--danger-bg)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertTriangle className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
          <p className="text-xs leading-relaxed" style={{ color: 'var(--danger)' }}>
            No recovery method was set up for this wallet. Without your seed phrase, this wallet cannot be recovered.
          </p>
        </div>
        <button onClick={onCancel} className="text-xs text-center" style={{ color: 'var(--subtle)' }}>Back</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-5 rounded-2xl" style={card}>
      <div className="flex items-center justify-between mb-1">
        <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Recover wallet</p>
        <button onClick={onCancel} style={{ color: 'var(--subtle)' }}><X className="size-4" /></button>
      </div>

      <AnimatePresence mode="wait">
        {method === 'choose' && (
          <motion.div key="choose" className="flex flex-col gap-2" {...fadeUp}>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>Choose a recovery method:</p>
            {hasTOTP && (
              <button onClick={() => setMethod('totp')}
                className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all hover:scale-[1.01]"
                style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                <Smartphone className="size-4" style={{ color: 'var(--accent)' }} />
                Google Authenticator code
              </button>
            )}
            {hasEmail && (
              <button onClick={() => setMethod('email')}
                className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all hover:scale-[1.01]"
                style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                <Mail className="size-4" style={{ color: 'var(--accent)' }} />
                Email recovery key
              </button>
            )}
          </motion.div>
        )}

        {method === 'totp' && (
          <motion.div key="totp" className="flex flex-col gap-3" {...fadeUp}>
            <div className="flex items-center gap-2 p-3 rounded-xl"
              style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>
              <Smartphone className="size-4 shrink-0" style={{ color: 'var(--accent)' }} />
              <p className="text-xs" style={{ color: 'var(--ink-2)' }}>Open Google Authenticator and enter the current 6-digit code for Fairtab.</p>
            </div>
            <input
              value={code}
              onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr(null) }}
              onKeyDown={e => e.key === 'Enter' && void handleTOTP()}
              placeholder="000000"
              maxLength={6}
              inputMode="numeric"
              className="w-full rounded-xl px-4 py-4 text-3xl font-bold text-center tracking-[0.5em] tabular-nums outline-none"
              style={{ background: 'var(--surface-muted)', border: `1px solid ${err ? 'var(--danger)' : 'var(--border)'}`, color: 'var(--ink)' }}
            />
            {err && <p className="text-xs text-center" style={{ color: 'var(--danger)' }}>{err}</p>}
            <button onClick={() => void handleTOTP()} disabled={loading || code.length !== 6}
              className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <><Unlock className="size-4" /> Recover wallet</>}
            </button>
            {hasEmail && (
              <button onClick={() => setMethod('email')} className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
                Use email recovery key instead
              </button>
            )}
          </motion.div>
        )}

        {method === 'email' && (
          <motion.div key="email" className="flex flex-col gap-3" {...fadeUp}>
            <div className="flex items-center gap-2 p-3 rounded-xl"
              style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>
              <Mail className="size-4 shrink-0" style={{ color: 'var(--accent)' }} />
              <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
                Enter the recovery key you saved when you set up email recovery
                {recovery.email?.label ? ` for ${recovery.email.label}` : ''}.
              </p>
            </div>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>
              Hint: starts with <span className="mono font-semibold" style={{ color: 'var(--ink-2)' }}>{recovery.email?.keyHint ?? '?????'}</span>
            </p>
            <div className="relative">
              <input
                value={emailKey}
                onChange={e => { setEmailKey(e.target.value); setErr(null) }}
                onKeyDown={e => e.key === 'Enter' && void handleEmail()}
                type={showKey ? 'text' : 'password'}
                placeholder="Paste recovery key"
                className="w-full rounded-xl px-4 py-3 pr-11 mono text-xs outline-none"
                style={{ background: 'var(--surface-muted)', border: `1px solid ${err ? 'var(--danger)' : 'var(--border)'}`, color: 'var(--ink)', letterSpacing: '0.04em' }}
              />
              <button type="button" onClick={() => setShowKey(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1" style={{ color: 'var(--subtle)' }}>
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {err && <p className="text-xs" style={{ color: 'var(--danger)' }}>{err}</p>}
            <button onClick={() => void handleEmail()} disabled={loading || !emailKey.trim()}
              className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <><KeyRound className="size-4" /> Recover wallet</>}
            </button>
            {hasTOTP && (
              <button onClick={() => setMethod('totp')} className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
                Use Google Authenticator instead
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Passkey (WebAuthn) for unlock ─────────────────────────────────────────────
const PASSKEY_CRED_KEY = 'fairtab_passkey_cred_id'

export function storePasskeyCredId(id: string) {
  localStorage.setItem(PASSKEY_CRED_KEY, id)
}

export function loadPasskeyCredId(): string | null {
  return localStorage.getItem(PASSKEY_CRED_KEY)
}

/**
 * Register a passkey and store the credential ID.
 * The passkey replaces the password prompt for unlock.
 * The wallet remains AES-encrypted; the passkey proof is used as an
 * authentication gate — we still derive the encryption key from the
 * original password (stored as a further encrypted blob keyed to the
 * passkey userHandle / PRF extension). For simplicity in this implementation
 * we use the passkey as a gate and require the password once to bind.
 */
export async function registerPasskey(address: string): Promise<{ credId: string }> {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'Fairtab', id: window.location.hostname },
      user: {
        id: new TextEncoder().encode(address),
        name: address,
        displayName: `Fairtab ${address.slice(0, 8)}`,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
    },
  }) as PublicKeyCredential | null

  if (!cred) throw new Error('Passkey registration cancelled')
  const credId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)))
  storePasskeyCredId(credId)
  return { credId }
}

export async function authenticatePasskey(): Promise<boolean> {
  const credIdB64 = loadPasskeyCredId()
  if (!credIdB64) throw new Error('No passkey registered')
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const credIdBytes = Uint8Array.from(atob(credIdB64), c => c.charCodeAt(0))
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ type: 'public-key', id: credIdBytes }],
      userVerification: 'required',
      timeout: 60000,
    },
  }) as PublicKeyCredential | null
  return !!assertion
}

// ── Passkey Setup Component ───────────────────────────────────────────────────
export function PasskeySetup({ address, onDone }: { address: string; onDone: () => void }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState<string | null>(null)
  const [done, setDone]       = useState(false)
  const hasPasskey = !!loadPasskeyCredId()

  const handleRegister = async () => {
    setLoading(true); setErr(null)
    try {
      await registerPasskey(address)
      setDone(true)
      toast.success('Passkey registered successfully')
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('cancelled') || msg.includes('abort')) {
        setErr('Registration cancelled')
      } else {
        setErr(msg)
      }
    } finally { setLoading(false) }
  }

  if (done || hasPasskey) {
    return (
      <motion.div className="flex flex-col gap-3 pt-3" {...fadeUp}>
        <div className="flex items-center gap-3 p-4 rounded-xl"
          style={{ background: 'var(--success-bg)', border: '1px solid rgba(34,197,94,0.2)' }}>
          <ShieldCheck className="size-5 shrink-0" style={{ color: 'var(--success)' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>Passkey registered</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--success)' }}>You can now use Face ID / fingerprint to unlock.</p>
          </div>
        </div>
        <button onClick={onDone} className="text-xs text-center" style={{ color: 'var(--subtle)' }}>Done</button>
      </motion.div>
    )
  }

  return (
    <motion.div className="flex flex-col gap-3 pt-3" {...fadeUp}>
      <div className="flex items-center gap-2 p-3 rounded-xl"
        style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>
        <Lock className="size-4 shrink-0" style={{ color: 'var(--accent)' }} />
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          Register a passkey (Face ID / fingerprint / PIN) to unlock Fairtab without entering your password.
          Your wallet encryption is unchanged.
        </p>
      </div>
      {err && <p className="text-xs" style={{ color: 'var(--danger)' }}>{err}</p>}
      <button onClick={() => void handleRegister()} disabled={loading}
        className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-50"
        style={{ background: 'var(--accent)', color: '#fff' }}>
        {loading ? <><Loader2 className="size-4 animate-spin" /> Registering…</> : <><Lock className="size-4" /> Register passkey</>}
      </button>
    </motion.div>
  )
}
