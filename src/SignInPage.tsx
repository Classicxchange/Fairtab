/**
 * SignInPage — full-page sign-in experience replacing the modal.
 *
 * Layout: full-screen split
 *  - Left panel (desktop): brand hero with gradient + features
 *  - Right panel: sign-in card (self-custodial wallet primary)
 *
 * On mobile: single centered card with brand header.
 */
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ConnectKitButton } from 'connectkit'
import { ChevronDown, ChevronUp, Shield, Zap, Users, ArrowRight, Sun, Moon } from 'lucide-react'
import { SeedWalletAuth, type SeedWalletSession } from './SeedWalletAuth'
import { AccountView, type AccountSession } from './AccountView'

interface Props {
  onSeedSignedIn: (s: SeedWalletSession) => void
  onSocialSignedIn: (s: AccountSession) => void
  onCircleConnected: (addr: `0x${string}`) => void
  onSignOut: () => void
  dark: boolean
  onToggleDark?: () => void
}

export function SignInPage({ onSeedSignedIn, onSocialSignedIn, onSignOut, dark, onToggleDark }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  return (
    <div className="min-h-dvh flex flex-col md:flex-row" style={{ background: 'var(--bg)' }}>

      {/* ── Left brand panel (desktop only) ─────────────────────── */}
      <div
        className="hidden md:flex flex-col justify-between p-12 md:w-[45%] lg:w-[42%] shrink-0 relative overflow-hidden"
        style={{
          background: 'linear-gradient(145deg, #1a3a6b 0%, #1e4080 40%, #2563eb 100%)',
        }}
      >
        {/* Decorative blobs */}
        <div className="absolute -top-24 -right-24 size-72 rounded-full pointer-events-none"
          style={{ background: 'rgba(37,99,235,0.35)', filter: 'blur(80px)' }} />
        <div className="absolute -bottom-16 -left-16 size-56 rounded-full pointer-events-none"
          style={{ background: 'rgba(96,165,250,0.20)', filter: 'blur(60px)' }} />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <img src="/logo.svg" alt="Fairtab" className="size-12 rounded-2xl" />
          <div>
            <p className="display text-2xl font-bold text-white">Fairtab</p>
            <p className="text-sm text-blue-200">powered by Arc</p>
          </div>
        </div>

        {/* Hero copy */}
        <div className="relative flex flex-col gap-8">
          <div>
            <h1 className="display text-4xl font-bold text-white leading-tight mb-4">
              Split bills.<br />Pay in USDC.<br />Stay fair.
            </h1>
            <p className="text-blue-200 text-base leading-relaxed max-w-xs">
              A self-custodial bill splitter on Arc. Your wallet, your keys, your money.
            </p>
          </div>

          {/* Feature list */}
          <div className="flex flex-col gap-4">
            {[
              { icon: Shield, text: 'Self-custodial — you own your keys' },
              { icon: Zap,    text: 'Sub-second finality on Arc' },
              { icon: Users,  text: 'Split bills with anyone, settled onchain' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="size-8 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(255,255,255,0.12)' }}>
                  <Icon className="size-4 text-white" />
                </div>
                <span className="text-sm text-blue-100">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="relative text-xs text-blue-300 mt-8">
          Settled onchain · Arc Testnet &amp; Mainnet
        </p>
      </div>

      {/* ── Right sign-in panel ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-start md:justify-center px-5 py-8 md:py-0 overflow-y-auto">

        {/* Mobile top bar: brand + dark toggle */}
        <div className="md:hidden w-full flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="Fairtab" className="size-10 rounded-xl" />
            <div>
              <p className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>Fairtab</p>
              <p className="text-xs" style={{ color: 'var(--subtle)' }}>powered by Arc</p>
            </div>
          </div>
          {onToggleDark && (
            <button onClick={onToggleDark}
              className="flex items-center justify-center rounded-xl transition-colors"
              style={{ width: 36, height: 36, background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          )}
        </div>

        {/* Desktop dark toggle (top-right corner) */}
        {onToggleDark && (
          <div className="hidden md:block absolute top-6 right-6">
            <button onClick={onToggleDark}
              className="flex items-center justify-center rounded-xl transition-colors"
              style={{ width: 36, height: 36, background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
        )}



        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
          className="w-full max-w-md flex flex-col gap-0 rounded-3xl overflow-hidden"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: '0 8px 48px rgba(0,0,0,0.18)',
          }}
        >
          {/* Card header */}
          <div className="px-7 pt-7 pb-5">
            <h2 className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>
              Sign in to Fairtab
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--subtle)' }}>
              Create or restore your self-custodial wallet
            </p>
          </div>

          {/* Spectral accent line */}
          <div className="h-px mx-7" style={{
            background: 'linear-gradient(90deg, #3b8ef8, #818cf8, #e879f9, #f97316)',
            opacity: 0.6,
          }} />

          {/* ── Seed wallet (primary) ─────────────────────────────── */}
          <div className="px-7 pt-5 pb-4">
            <p className="text-xs font-bold uppercase tracking-widest mb-3"
              style={{ color: 'var(--subtle)', letterSpacing: '0.1em' }}>
              Self-custodial wallet
            </p>
            <SeedWalletAuth
              session={null}
              onSignedIn={s => onSeedSignedIn(s)}
              onSignOut={onSignOut}
            />
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 px-7 py-2">
            <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--subtle)' }}>or</span>
            <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
          </div>

          {/* ── MetaMask / WalletConnect ──────────────────────────── */}
          <div className="px-7 py-3">
            <p className="text-xs font-bold uppercase tracking-widest mb-3"
              style={{ color: 'var(--subtle)', letterSpacing: '0.1em' }}>
              Web3 wallet
            </p>
            <ConnectKitButton.Custom>
              {({ show }) => (
                <button
                  onClick={() => show?.()}
                  className="w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
                  style={{
                    background: 'var(--surface-strong)',
                    border: '1px solid var(--border)',
                    color: 'var(--ink)',
                  }}
                >
                  {/* MetaMask fox icon */}
                  <div className="size-8 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: '#F5841F' }}>
                    <svg viewBox="0 0 35 33" width="20" height="18" fill="none">
                      <path d="M32.9 1L19.4 10.7l2.5-5.9L32.9 1z" fill="#E17726" stroke="#E17726" strokeWidth=".3" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M2.1 1l13.4 9.8-2.4-5.9L2.1 1z" fill="#E27625" stroke="#E27625" strokeWidth=".3" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M28.1 23.5l-3.6 5.5 7.7 2.1 2.2-7.5-6.3-.1zM1.7 23.6l2.2 7.5 7.7-2.1-3.6-5.5-6.3.1z" fill="#E27625" stroke="#E27625" strokeWidth=".3" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M11.1 14.6l-2.1 3.2 7.5.3-.3-8.1-5.1 4.6zM23.9 14.6l-5.2-4.7-.2 8.2 7.4-.3-2-3.2zM11.6 29l4.5-2.2-3.9-3-0.6 5.2zM18.9 26.8l4.5 2.2-.6-5.2-3.9 3z" fill="#E27625" stroke="#E27625" strokeWidth=".3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <span>MetaMask / WalletConnect</span>
                  <ArrowRight className="ml-auto size-4" style={{ color: 'var(--subtle)' }} />
                </button>
              )}
            </ConnectKitButton.Custom>
          </div>

          {/* ── Advanced (collapsed) ──────────────────────────────── */}
          <div className="px-7 pb-7 pt-1">
            <button
              onClick={() => setShowAdvanced(s => !s)}
              className="w-full flex items-center justify-between rounded-xl px-4 py-3 text-xs font-bold transition-all"
              style={{
                background: 'var(--surface-muted)',
                color: 'var(--subtle)',
                border: '1px solid var(--border)',
                letterSpacing: '0.08em',
              }}
            >
              <span className="uppercase">More options (Google / Email / Passkey)</span>
              {showAdvanced
                ? <ChevronUp className="size-3.5 shrink-0" />
                : <ChevronDown className="size-3.5 shrink-0" />
              }
            </button>

            <AnimatePresence>
              {showAdvanced && (
                <motion.div
                  key="advanced"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="pt-4">
                    <AccountView
                      session={null}
                      onSignedIn={s => onSocialSignedIn(s)}
                      onSignOut={onSignOut}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Footer note */}
        <p className="mt-6 text-xs text-center max-w-xs" style={{ color: 'var(--subtle)' }}>
          By signing in you agree to manage your own keys. Fairtab never stores your private key or seed phrase.
        </p>
      </div>
    </div>
  )
}
