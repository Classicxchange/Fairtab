/**
 * AccountPage — advanced wallet & account settings.
 * Shown when user is signed in. Never shows sign-in prompts.
 *
 * Sections:
 *   1. Wallet overview (address, network, method badge)
 *   2. Backup — reveal seed phrase (seed wallets only)
 *   3. Backup — reveal private key (seed wallets only)
 *   4. Security — change password (seed wallets only)
 *   5. Wallet method info (MetaMask / Google / Passkey info)
 *   6. Danger zone — sign out
 */
import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  Wallet, Shield, Key, Copy, CheckCircle2, Eye, EyeOff,
  AlertTriangle, LogOut, ExternalLink, ChevronDown, ChevronUp,
  Fingerprint, Lock, RefreshCw, ShieldCheck, Timer, LifeBuoy,
} from 'lucide-react'
import {
  RecoveryStatus, TOTPSetup, EmailRecoverySetup, PasskeySetup,
} from '@/WalletRecovery'
import type { SeedWalletSession } from '@/SeedWalletAuth'
import { decryptSeedWallet, encryptSeedWallet, loadEncryptedWallet } from '@/SeedWalletAuth'
import type { AccountSession } from '@/AccountView'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { arcChain, IS_MAINNET } from '@/config'

const CHAIN_ID = arcChain.id

// ── Shared tokens ─────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: 'var(--surface-strong)',
  border: '1px solid var(--border)',
  borderRadius: '16px',
  boxShadow: 'var(--shadow)',
}
const inner: React.CSSProperties = {
  background: 'var(--surface-muted)',
  border: '1px solid var(--border)',
  borderRadius: '10px',
}
const fadeUp = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 } }

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all shrink-0"
      style={{
        background: copied ? 'var(--success-bg)' : 'var(--surface-muted)',
        color: copied ? 'var(--success)' : 'var(--ink-2)',
        border: '1px solid var(--border)',
      }}
    >
      {copied ? <CheckCircle2 className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : (label ?? 'Copy')}
    </button>
  )
}

// ── Section toggle ────────────────────────────────────────────────────────────
function SectionToggle({
  title, subtitle, icon: Icon, iconColor, children, danger,
}: {
  title: string; subtitle: string; icon: React.ElementType
  iconColor?: string; children: React.ReactNode; danger?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={card}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 p-5 text-left"
      >
        <div className="size-10 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: danger ? 'var(--danger-bg)' : 'var(--accent-light)',
            border: `1px solid ${danger ? 'var(--danger-bg)' : 'var(--accent-border)'}`,
          }}
        >
          <Icon className="size-5" style={{ color: iconColor ?? (danger ? 'var(--danger)' : 'var(--accent)') }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: danger ? 'var(--danger)' : 'var(--ink)' }}>{title}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{subtitle}</p>
        </div>
        {open
          ? <ChevronUp className="size-4 shrink-0" style={{ color: 'var(--subtle)' }} />
          : <ChevronDown className="size-4 shrink-0" style={{ color: 'var(--subtle)' }} />
        }
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-5 pb-5 pt-0 flex flex-col gap-3"
              style={{ borderTop: '1px solid var(--border)' }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Seed phrase revealer ──────────────────────────────────────────────────────
function SeedPhraseRevealer({ onSignOut: _onSignOut }: { onSignOut: () => void }) {
  const [pw, setPw]         = useState('')
  const [mnemonic, setMn]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr]       = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)

  const handleReveal = async () => {
    if (!pw) { setErr('Enter your password'); return }
    setLoading(true); setErr(null)
    try {
      const blob = loadEncryptedWallet()
      if (!blob) { setErr('No wallet found'); setLoading(false); return }
      const { mnemonic: mn } = await decryptSeedWallet(blob, pw)
      if (!mn) { setErr('This wallet has no seed phrase (imported via private key)'); setLoading(false); return }
      setMn(mn)
      setRevealed(true)
    } catch {
      setErr('Wrong password')
    } finally { setLoading(false) }
  }

  const words = mnemonic?.split(' ') ?? []
  const [copied, setCopied] = useState(false)
  const copyAll = () => {
    if (!mnemonic) return
    void navigator.clipboard.writeText(mnemonic)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
    toast.success('Seed phrase copied — store it safely')
  }

  if (!revealed) return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex items-start gap-2 rounded-xl p-3"
        style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}>
        <AlertTriangle className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
        <p className="text-xs leading-relaxed" style={{ color: 'var(--warning)' }}>
          Never share your seed phrase. Anyone with it has full access to your wallet.
          Write it down on paper and store it offline.
        </p>
      </div>
      <input
        type="password"
        placeholder="Enter your wallet password"
        value={pw}
        onChange={e => { setPw(e.target.value); setErr(null) }}
        onKeyDown={e => e.key === 'Enter' && void handleReveal()}
        className="w-full rounded-xl px-4 py-3 text-sm outline-none"
        style={{ background: 'var(--surface-muted)', border: `1px solid ${err ? 'var(--danger)' : 'var(--border)'}`, color: 'var(--ink)' }}
      />
      {err && <p className="text-xs" style={{ color: 'var(--danger)' }}>{err}</p>}
      <button
        onClick={() => void handleReveal()}
        disabled={!pw || loading}
        className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-50"
        style={{ background: 'var(--accent)', color: 'var(--accent-dark)' }}
      >
        {loading ? <><RefreshCw className="size-4 animate-spin" /> Decrypting…</> : <><Eye className="size-4" /> Reveal seed phrase</>}
      </button>
    </div>
  )

  return (
    <div className="flex flex-col gap-3 pt-3">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
        Your 12-word seed phrase
      </p>
      <div className="grid grid-cols-3 gap-2">
        {words.map((w, i) => (
          <div key={i} className="flex items-center gap-1.5 rounded-lg px-2.5 py-2"
            style={inner}>
            <span className="text-xs tabular-nums w-4 text-right shrink-0" style={{ color: 'var(--subtle)' }}>{i + 1}</span>
            <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{w}</span>
          </div>
        ))}
      </div>
      <button onClick={copyAll}
        className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold"
        style={{
          background: copied ? 'var(--success-bg)' : 'var(--surface-muted)',
          color: copied ? 'var(--success)' : 'var(--ink-2)',
          border: '1px solid var(--border)',
        }}>
        {copied ? <CheckCircle2 className="size-4" /> : <Copy className="size-4" />}
        {copied ? 'Copied!' : 'Copy all words'}
      </button>
      <button onClick={() => { setRevealed(false); setPw(''); setMn(null) }}
        className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
        Hide seed phrase
      </button>
      <div className="flex items-start gap-2 rounded-xl p-3 mt-1"
        style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}>
        <AlertTriangle className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
        <p className="text-xs leading-relaxed" style={{ color: 'var(--warning)' }}>
          Keep this offline. Close this section when you are done.
        </p>
      </div>
    </div>
  )
}

// ── Private key revealer ──────────────────────────────────────────────────────
function PrivateKeyRevealer() {
  const [pw, setPw]    = useState('')
  const [pk, setPk]    = useState<string | null>(null)
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr]  = useState<string | null>(null)

  const handleReveal = async () => {
    if (!pw) { setErr('Enter your password'); return }
    setLoading(true); setErr(null)
    try {
      const blob = loadEncryptedWallet()
      if (!blob) { setErr('No wallet found'); setLoading(false); return }
      const { privateKey } = await decryptSeedWallet(blob, pw)
      setPk(privateKey)
    } catch {
      setErr('Wrong password')
    } finally { setLoading(false) }
  }

  if (!pk) return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex items-start gap-2 rounded-xl p-3"
        style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-bg)' }}>
        <AlertTriangle className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
        <p className="text-xs leading-relaxed" style={{ color: 'var(--danger)' }}>
          Your private key grants full control of your wallet. Never share it with anyone.
        </p>
      </div>
      <input
        type="password"
        placeholder="Enter your wallet password"
        value={pw}
        onChange={e => { setPw(e.target.value); setErr(null) }}
        onKeyDown={e => e.key === 'Enter' && void handleReveal()}
        className="w-full rounded-xl px-4 py-3 text-sm outline-none"
        style={{ background: 'var(--surface-muted)', border: `1px solid ${err ? 'var(--danger)' : 'var(--border)'}`, color: 'var(--ink)' }}
      />
      {err && <p className="text-xs" style={{ color: 'var(--danger)' }}>{err}</p>}
      <button onClick={() => void handleReveal()} disabled={!pw || loading}
        className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-50"
        style={{ background: 'var(--accent)', color: 'var(--accent-dark)' }}>
        {loading ? <><RefreshCw className="size-4 animate-spin" /> Decrypting…</> : <><Key className="size-4" /> Reveal private key</>}
      </button>
    </div>
  )

  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Private key</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setShow(s => !s)}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
            {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {show ? 'Hide' : 'Show'}
          </button>
          <CopyBtn value={pk} />
        </div>
      </div>
      <div className="rounded-xl p-3 overflow-hidden" style={inner}>
        <p className="mono text-xs break-all select-all" style={{ color: 'var(--ink)', filter: show ? 'none' : 'blur(5px)', userSelect: show ? 'auto' : 'none' }}>
          {pk}
        </p>
      </div>
      <button onClick={() => { setPk(null); setPw(''); setShow(false) }}
        className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
        Hide private key
      </button>
    </div>
  )
}

// ── Change password ───────────────────────────────────────────────────────────
function ChangePassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext]       = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState<string | null>(null)
  const [ok, setOk]           = useState(false)

  const handleChange = async () => {
    if (!current || !next || !confirm) { setErr('Fill all fields'); return }
    if (next !== confirm) { setErr('New passwords do not match'); return }
    if (next.length < 8) { setErr('Password must be at least 8 characters'); return }
    setLoading(true); setErr(null)
    try {
      const blob = loadEncryptedWallet()
      if (!blob) { setErr('No wallet found'); return }
      const payload = await decryptSeedWallet(blob, current)
      await encryptSeedWallet(payload, next)
      setOk(true)
      toast.success('Password updated')
      setCurrent(''); setNext(''); setConfirm('')
      setTimeout(() => setOk(false), 3000)
    } catch {
      setErr('Current password is wrong')
    } finally { setLoading(false) }
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      {ok && (
        <div className="flex items-center gap-2 rounded-xl p-3"
          style={{ background: 'var(--success-bg)', border: '1px solid var(--success-bg)' }}>
          <CheckCircle2 className="size-4" style={{ color: 'var(--success)' }} />
          <p className="text-xs font-semibold" style={{ color: 'var(--success)' }}>Password updated successfully</p>
        </div>
      )}
      {[
        { label: 'Current password', val: current, set: setCurrent },
        { label: 'New password',     val: next,    set: setNext    },
        { label: 'Confirm new',      val: confirm, set: setConfirm },
      ].map(({ label, val, set }) => (
        <div key={label}>
          <p className="text-xs mb-1.5 font-medium" style={{ color: 'var(--muted)' }}>{label}</p>
          <input type="password" value={val} onChange={e => { set(e.target.value); setErr(null) }}
            placeholder="••••••••"
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: 'var(--surface-muted)', border: `1px solid ${err ? 'var(--danger)' : 'var(--border)'}`, color: 'var(--ink)' }} />
        </div>
      ))}
      {err && <p className="text-xs" style={{ color: 'var(--danger)' }}>{err}</p>}
      <button onClick={() => void handleChange()} disabled={!current || !next || !confirm || loading}
        className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-50"
        style={{ background: 'var(--accent)', color: 'var(--accent-dark)' }}>
        {loading ? <><RefreshCw className="size-4 animate-spin" /> Updating…</> : <><Lock className="size-4" /> Update password</>}
      </button>
    </div>
  )
}

// ── Sign-out timer setting ────────────────────────────────────────────────────
const TIMER_KEY     = 'fairtab_signout_timer'
const SIGNIN_TS_KEY = 'fairtab_signin_ts'

const TIMER_OPTIONS = [
  { label: 'Immediately', value: 0 },
  { label: '5 minutes',   value: 5 },
  { label: '15 minutes',  value: 15 },
  { label: '30 minutes',  value: 30 },
  { label: '1 hour',      value: 60 },
  { label: '4 hours',     value: 240 },
  { label: 'Never',       value: -1 },
]

/** Call this once when the user successfully signs in */
export function recordSignInTime() {
  localStorage.setItem(SIGNIN_TS_KEY, String(Date.now()))
}

/**
 * On mount: check if the elapsed time since last sign-in exceeds the chosen
 * timer. If so, sign out immediately. If not, schedule a timeout for the
 * remaining time. This keeps the session alive across reloads as long as
 * the timer hasn't elapsed.
 */
export function useAutoSignOut(onSignOut: () => void) {
  useEffect(() => {
    const timerMins = parseInt(localStorage.getItem(TIMER_KEY) ?? '-1', 10)
    // -1 = Never; keep session alive
    if (timerMins === -1) return
    // 0 = Immediately on next load
    if (timerMins === 0) {
      toast.info('Session expired — signing out')
      onSignOut()
      return
    }
    const timerMs   = timerMins * 60 * 1000
    const signInTs  = parseInt(localStorage.getItem(SIGNIN_TS_KEY) ?? '0', 10)
    const elapsed   = Date.now() - signInTs
    const remaining = timerMs - elapsed
    if (remaining <= 0) {
      // Timer already elapsed — sign out now
      toast.info('Session expired — signing out')
      onSignOut()
      return
    }
    // Schedule sign-out for the remaining time
    const id = setTimeout(() => {
      toast.info('Session expired — signing out')
      onSignOut()
    }, remaining)
    return () => clearTimeout(id)
  }, [onSignOut])
}

function SignOutTimerSetting({ onSignOut }: { onSignOut: () => void }) {
  const [selected, setSelected] = useState<number>(() =>
    parseInt(localStorage.getItem(TIMER_KEY) ?? '0', 10)
  )
  const [saved, setSaved] = useState(false)

  const handleSave = (val: number) => {
    setSelected(val)
    localStorage.setItem(TIMER_KEY, String(val))
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
    toast.success('Sign-out timer updated')
    // If "immediately", sign out right away
    if (val === 0) {
      setTimeout(onSignOut, 400)
    }
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Choose when to automatically sign out after the app loads.
        The timer starts when you open the app.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {TIMER_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => handleSave(opt.value)}
            className="flex items-center justify-center rounded-xl py-2.5 text-sm font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: selected === opt.value ? 'var(--accent)' : 'var(--surface-muted)',
              color: selected === opt.value ? '#fff' : 'var(--ink-2)',
              border: `1px solid ${selected === opt.value ? 'var(--accent)' : 'var(--border)'}`,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {saved && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2"
          style={{ background: 'var(--success-bg)' }}>
          <CheckCircle2 className="size-3.5" style={{ color: 'var(--success)' }} />
          <p className="text-xs font-semibold" style={{ color: 'var(--success)' }}>Timer saved</p>
        </div>
      )}
    </div>
  )
}

// ── Recovery account section (sub-navigation inside SectionToggle) ───────────
function RecoveryAccountSection({ address: _addr }: { address: string }) {
  const [subView, setSubView] = useState<'status' | 'totp' | 'email'>('status')
  return (
    <div className="flex flex-col gap-3 pt-3">
      <AnimatePresence mode="wait">
        {subView === 'status' && (
          <motion.div key="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <RecoveryStatus
              onSetupTOTP={() => setSubView('totp')}
              onSetupEmail={() => setSubView('email')}
            />
          </motion.div>
        )}
        {subView === 'totp' && (
          <motion.div key="totp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <TOTPSetup onDone={() => setSubView('status')} />
            <button onClick={() => setSubView('status')} className="text-xs mt-2" style={{ color: 'var(--subtle)' }}>Back</button>
          </motion.div>
        )}
        {subView === 'email' && (
          <motion.div key="email" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <EmailRecoverySetup onDone={() => setSubView('status')} />
            <button onClick={() => setSubView('status')} className="text-xs mt-2" style={{ color: 'var(--subtle)' }}>Back</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main AccountPage ─────────────────────────────────────────────────────────
interface AccountPageProps {
  address: string
  seedSession: SeedWalletSession | null
  socialSession: AccountSession | null
  wagmiAddress?: string
  onSignOut: () => void
}

export function AccountPage({ address, seedSession, socialSession, wagmiAddress, onSignOut }: AccountPageProps) {
  const [copied, setCopied] = useState(false)
  useAutoSignOut(onSignOut)

  const isSeed    = !!seedSession
  const isMetaMask = !!wagmiAddress && !seedSession
  const isSocial  = !!socialSession && !seedSession

  const methodLabel = isSeed
    ? 'Self-custodial wallet'
    : isMetaMask
    ? 'MetaMask / WalletConnect'
    : socialSession?.method === 'google' ? 'Google account'
    : socialSession?.method === 'email'  ? 'Email OTP'
    : socialSession?.method === 'passkey' ? 'Passkey'
    : 'Connected wallet'

  const methodIcon = isSeed
    ? <Key className="size-4" style={{ color: 'var(--accent)' }} />
    : isMetaMask
    ? <Wallet className="size-4" style={{ color: 'var(--accent)' }} />
    : <Fingerprint className="size-4" style={{ color: 'var(--accent)' }} />

  const explorerUrl = buildAddressExplorerUrl(CHAIN_ID, address)

  const copyAddress = useCallback(() => {
    void navigator.clipboard.writeText(address)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
    toast.success('Address copied')
  }, [address])

  return (
    <motion.div className="flex flex-col gap-4 max-w-lg" {...fadeUp}>
      <div className="mb-1">
        <h2 className="display text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Account</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Manage your wallet and security settings.</p>
      </div>

      {/* ── Wallet overview ─────────────────────────────────────────── */}
      <div style={card} className="p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="size-11 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>
            <ShieldCheck className="size-5" style={{ color: 'var(--accent)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Wallet connected</p>
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                {IS_MAINNET ? 'Mainnet' : 'Testnet'}
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{methodLabel}</p>
          </div>
          <div className="size-8 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--accent-light)' }}>
            {methodIcon}
          </div>
        </div>

        {/* Address row */}
        <div className="rounded-xl p-3 flex items-center gap-3" style={inner}>
          <div className="flex-1 min-w-0">
            <p className="text-xs mb-1 font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
              Wallet address
            </p>
            <p className="mono text-xs break-all leading-relaxed" style={{ color: 'var(--ink-2)' }}>{address}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={copyAddress}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all"
            style={{
              background: copied ? 'var(--success-bg)' : 'var(--accent)',
              color: copied ? 'var(--success)' : 'var(--accent-dark)',
            }}>
            {copied ? <CheckCircle2 className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Copied!' : 'Copy address'}
          </button>
          <a href={explorerUrl} target="_blank" rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl py-2.5 px-4 text-sm font-semibold transition-all"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)', textDecoration: 'none' }}>
            <ExternalLink className="size-4" />
            Explorer
          </a>
        </div>
      </div>

      {/* ── Backup sections (seed wallets only) ─────────────────────── */}
      {isSeed && (
        <>
          <SectionToggle
            title="Backup seed phrase"
            subtitle="View your 12-word recovery phrase — store it offline"
            icon={Shield}
          >
            <SeedPhraseRevealer onSignOut={onSignOut} />
          </SectionToggle>

          <SectionToggle
            title="Export private key"
            subtitle="One-click export — use with MetaMask or any wallet"
            icon={Key}
          >
            <PrivateKeyRevealer />
          </SectionToggle>

          <SectionToggle
            title="Change wallet password"
            subtitle="Update the password protecting your encrypted wallet"
            icon={Lock}
          >
            <ChangePassword />
          </SectionToggle>

          {/* Recovery methods */}
          <SectionToggle
            title="Account recovery"
            subtitle="Set up Google Authenticator or email backup to recover if you lose your seed phrase"
            icon={LifeBuoy}
          >
            <RecoveryAccountSection address={address} />
          </SectionToggle>

          {/* Passkey */}
          <SectionToggle
            title="Passkey (Face ID / fingerprint)"
            subtitle="Register a biometric passkey to unlock without typing your password"
            icon={Fingerprint}
          >
            <PasskeySetup address={address} onDone={() => toast.success('Passkey active')} />
          </SectionToggle>
        </>
      )}

      {/* ── Info for MetaMask / social ───────────────────────────────── */}
      {!isSeed && (
        <div style={card} className="p-5 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--accent-light)' }}>
              <Shield className="size-4" style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Wallet security</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                {isMetaMask
                  ? 'Your keys are managed by MetaMask. Back up your seed phrase in MetaMask settings.'
                  : 'Your keys are secured by Circle MPC infrastructure. No local backup needed.'}
              </p>
            </div>
          </div>
          {isSocial && (
            <div className="rounded-xl p-3 flex items-start gap-2"
              style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>
              <ShieldCheck className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                Circle MPC wallet — your private key is split across secure enclaves.
                Sign in with {socialSession?.method === 'google' ? 'your Google account' : 'email'} on any device to recover access.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Sign-out timer ───────────────────────────────────────── */}
      <SectionToggle
        title="Sign-out timer"
        subtitle="Auto sign out after a set time when the app opens"
        icon={Timer}
      >
        <SignOutTimerSetting onSignOut={onSignOut} />
      </SectionToggle>

      {/* ── Sign out ─────────────────────────────────────────────── */}
      <SectionToggle
        title="Sign out"
        subtitle="Lock this wallet and return to the sign-in screen"
        icon={LogOut}
        danger
      >
        <div className="flex flex-col gap-3 pt-3">
          {isSeed && (
            <div className="flex items-start gap-2 rounded-xl p-3"
              style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}>
              <AlertTriangle className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
              <p className="text-xs leading-relaxed" style={{ color: 'var(--warning)' }}>
                Make sure you have backed up your seed phrase before signing out.
                Without it you will not be able to recover this wallet.
              </p>
            </div>
          )}
          <button
            onClick={onSignOut}
            className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-all"
            style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid var(--danger-bg)' }}
          >
            <LogOut className="size-4" /> Sign out now
          </button>
        </div>
      </SectionToggle>
    </motion.div>
  )
}
