/**
 * SignInPage — full-screen gate.
 *
 * Primary:   Google sign-in (via Circle UCW / AccountView)
 * Secondary: Seed phrase, Private key, MetaMask / WalletConnect
 *
 * Sections animate in order; the "Advanced" accordion reveals the
 * self-custodial and external-wallet options.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ConnectKitButton } from 'connectkit'
import {
  Shield, Zap, Users, Sun, Moon,
  ChevronDown, KeyRound, Wallet,
} from 'lucide-react'
import { WalletMetamask, WalletWalletConnect } from '@web3icons/react'
import { AccountView, type AccountSession } from './AccountView'
import { SeedWalletAuth, type SeedWalletSession } from './SeedWalletAuth'

interface Props {
  onSeedSignedIn:    (s: SeedWalletSession) => void
  onSocialSignedIn:  (s: AccountSession)    => void
  onCircleConnected: (addr: `0x${string}`)  => void
  onSignOut: () => void
  dark: boolean
  onToggleDark?: () => void
}

// ── Google icon SVG ───────────────────────────────────────────────────────────
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

type View = 'main' | 'google' | 'seed'

export function SignInPage({
  onSeedSignedIn, onSocialSignedIn, onSignOut,
  dark, onToggleDark,
}: Props) {
  const [view, setView]         = useState<View>('main')
  const [advOpen, setAdvOpen]   = useState(false)

  const hasGoogle = !!(import.meta.env.VITE_CIRCLE_APP_ID && import.meta.env.VITE_GOOGLE_CLIENT_ID)

  return (
    <div className="min-h-dvh flex flex-col md:flex-row" style={{ background: 'var(--bg)' }}>

      {/* ── Left brand panel — desktop only ──────────────────────────────── */}
      <div className="hidden md:flex flex-col justify-between p-12 md:w-[44%] shrink-0 relative overflow-hidden"
        style={{ background: 'linear-gradient(150deg,#0f2554 0%,#1a3a7e 45%,#1e4faa 100%)' }}>
        <div className="absolute -top-32 -right-20 size-80 rounded-full pointer-events-none"
          style={{ background: 'rgba(79,130,255,0.22)', filter: 'blur(90px)' }} />
        <div className="absolute bottom-0 -left-20 size-64 rounded-full pointer-events-none"
          style={{ background: 'rgba(96,165,250,0.15)', filter: 'blur(70px)' }} />

        <div className="relative flex items-center gap-3 z-10">
          <img src="/logo.svg" alt="Fairtab" className="size-12 rounded-2xl shadow-lg" />
          <div>
            <p className="display text-2xl font-bold text-white tracking-tight">Fairtab</p>
            <p className="text-sm text-blue-300">powered by Arc</p>
          </div>
        </div>

        <div className="relative z-10 flex flex-col gap-8">
          <div>
            <h1 className="display text-[2.6rem] font-bold text-white leading-[1.15] mb-4 tracking-tight">
              Split bills.<br />Pay in USDC.<br />Stay fair.
            </h1>
            <p className="text-blue-200/80 text-base leading-relaxed max-w-[280px]">
              Onchain bill splitting on Arc. Your wallet, your keys, settled in seconds.
            </p>
          </div>
          <div className="flex flex-col gap-3.5">
            {[
              { icon: Shield, text: 'Self-custodial — you own your keys' },
              { icon: Zap,    text: 'Sub-second finality on Arc' },
              { icon: Users,  text: 'Split with anyone, settled onchain' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="size-8 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)' }}>
                  <Icon className="size-4 text-white" />
                </div>
                <span className="text-sm text-blue-100/90">{text}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="relative z-10 text-xs text-blue-400/70 mt-6">Settled onchain · Arc Mainnet</p>
      </div>

      {/* ── Right sign-in area ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-10 relative overflow-y-auto">

        {/* Dark toggle */}
        {onToggleDark && (
          <button
            onClick={onToggleDark}
            className="absolute top-5 right-5 flex items-center justify-center rounded-xl transition-all hover:scale-105"
            style={{ width: 38, height: 38, background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        )}

        {/* Mobile logo */}
        <div className="md:hidden flex items-center gap-3 mb-10 self-start">
          <img src="/logo.svg" alt="Fairtab" className="size-10 rounded-xl shadow" />
          <div>
            <p className="display text-xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>Fairtab</p>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>powered by Arc</p>
          </div>
        </div>

        {/* ── View: main ─────────────────────────────────────────────────── */}
        {view === 'main' && (
          <motion.div
            key="main"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
            className="w-full max-w-sm flex flex-col gap-5"
          >
            {/* Heading */}
            <div className="mb-1">
              <h2 className="display text-3xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
                Welcome to Fairtab
              </h2>
              <p className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>
                Sign in with Google to get started
              </p>
              <div className="mt-3 h-0.5 rounded-full w-16"
                style={{ background: 'linear-gradient(90deg,#3b8ef8,#818cf8,#e879f9)' }} />
            </div>

            {/* ── PRIMARY: Google ─────────────────────────────────────────── */}
            <button
              onClick={() => setView('google')}
              className="w-full flex items-center gap-4 rounded-2xl px-5 py-4 text-base font-semibold transition-all hover:scale-[1.01] active:scale-[0.98]"
              style={{
                background: '#fff',
                border: '1.5px solid #e2e8f0',
                color: '#1a202c',
                boxShadow: '0 2px 16px rgba(0,0,0,0.08)',
              }}
            >
              <span className="shrink-0"><GoogleIcon size={22} /></span>
              <span className="flex-1 text-left">Continue with Google</span>
              {!hasGoogle && (
                <span className="text-xs font-normal px-2 py-0.5 rounded-full"
                  style={{ background: '#fef3c7', color: '#92400e' }}>Setup needed</span>
              )}
            </button>

            {/* ── DIVIDER ────────────────────────────────────────────────── */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
              <span className="text-xs font-medium px-1" style={{ color: 'var(--subtle)' }}>or use a wallet</span>
              <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
            </div>

            {/* ── SECONDARY: advanced accordion ──────────────────────────── */}
            <div className="rounded-2xl overflow-hidden"
              style={{ border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: 'var(--shadow-sm)' }}>

              {/* Accordion header */}
              <button
                onClick={() => setAdvOpen(o => !o)}
                className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold transition-colors"
                style={{ color: 'var(--ink)', background: 'transparent' }}
              >
                <span className="flex items-center gap-2">
                  <Wallet className="size-4" style={{ color: 'var(--accent)' }} />
                  Advanced options
                </span>
                <ChevronDown
                  className="size-4 transition-transform"
                  style={{ color: 'var(--muted)', transform: advOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
              </button>

              <AnimatePresence initial={false}>
                {advOpen && (
                  <motion.div
                    key="adv"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="flex flex-col"
                      style={{ borderTop: '1px solid var(--border)' }}>

                      {/* Seed phrase / private key */}
                      <button
                        onClick={() => setView('seed')}
                        className="flex items-center gap-4 px-5 py-4 text-sm font-semibold transition-colors text-left"
                        style={{ borderBottom: '1px solid var(--border)', color: 'var(--ink)', background: 'transparent' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <KeyRound className="size-5 shrink-0" style={{ color: 'var(--accent)' }} />
                        <div>
                          <p className="font-semibold" style={{ color: 'var(--ink)' }}>Seed phrase / Private key</p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Import or create a self-custodial wallet</p>
                        </div>
                      </button>

                      {/* MetaMask / WalletConnect */}
                      <ConnectKitButton.Custom>
                        {({ show }) => (
                          <button
                            onClick={() => show?.()}
                            className="flex items-center gap-4 px-5 py-4 text-sm font-semibold transition-colors text-left"
                            style={{ color: 'var(--ink)', background: 'transparent' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <div className="relative shrink-0 w-10 h-8">
                              <div className="absolute left-0 top-0 size-8 rounded-xl overflow-hidden shadow-sm"
                                style={{ border: '1.5px solid rgba(0,0,0,0.08)', background: '#F5841F' }}>
                                <WalletMetamask variant="branded" width={32} height={32} />
                              </div>
                              <div className="absolute left-4 top-0 size-8 rounded-xl overflow-hidden shadow-sm"
                                style={{ border: '1.5px solid rgba(0,0,0,0.08)', background: '#3B99FC' }}>
                                <WalletWalletConnect variant="branded" width={32} height={32} />
                              </div>
                            </div>
                            <div>
                              <p className="font-semibold" style={{ color: 'var(--ink)' }}>MetaMask / WalletConnect</p>
                              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Connect your existing Web3 wallet</p>
                            </div>
                          </button>
                        )}
                      </ConnectKitButton.Custom>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer */}
            <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
              Fairtab never stores your private key. You own your wallet.
            </p>
          </motion.div>
        )}

        {/* ── View: Google (AccountView) ─────────────────────────────────── */}
        {view === 'google' && (
          <motion.div
            key="google"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.26, ease: [0.25, 0.1, 0.25, 1] }}
            className="w-full max-w-sm flex flex-col gap-4"
          >
            {/* Back */}
            <button
              onClick={() => setView('main')}
              className="self-start flex items-center gap-1.5 text-sm font-medium"
              style={{ color: 'var(--accent)' }}
            >
              ← Back
            </button>

            {/* Heading */}
            <div className="mb-1">
              <h2 className="display text-2xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
                Sign in with Google
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                Your wallet is created automatically and secured by Circle MPC.
              </p>
            </div>

            {!hasGoogle && (
              <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
                <p className="font-semibold text-sm mb-2" style={{ color: 'var(--ink)' }}>Setup required</p>
                <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--muted)' }}>
                  Google sign-in needs two env vars and the API server running. Add these to your <code className="font-mono" style={{ color: 'var(--accent)' }}>.env</code> file:
                </p>
                <div className="rounded-xl p-3 font-mono text-xs mb-3 select-all"
                  style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{`VITE_CIRCLE_APP_ID=your_app_id
VITE_GOOGLE_CLIENT_ID=your_google_client_id
CIRCLE_API_KEY=your_api_key`}
                </div>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                  Get them from Circle Console: Wallets &rarr; User Controlled &rarr; Configurator (App ID), Auth Methods &rarr; Social Logins (Google Client ID), and Settings &rarr; API Keys (API Key).
                </p>
                <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--muted)' }}>
                  Also run the API server: <code className="font-mono" style={{ color: 'var(--accent)' }}>bun run dev:server</code>
                </p>
              </div>
            )}
            {hasGoogle && (
              <AccountView
                session={null}
                onSignedIn={s => onSocialSignedIn(s)}
                onSignOut={onSignOut}
              />
            )}
          </motion.div>
        )}

        {/* ── View: Seed wallet ──────────────────────────────────────────── */}
        {view === 'seed' && (
          <motion.div
            key="seed"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.26, ease: [0.25, 0.1, 0.25, 1] }}
            className="w-full max-w-sm flex flex-col gap-4"
          >
            {/* Back */}
            <button
              onClick={() => setView('main')}
              className="self-start flex items-center gap-1.5 text-sm font-medium"
              style={{ color: 'var(--accent)' }}
            >
              ← Back
            </button>

            {/* Heading */}
            <div className="mb-1">
              <h2 className="display text-2xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
                Self-custodial wallet
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                Create a new wallet or import from seed phrase or private key.
              </p>
            </div>

            <SeedWalletAuth
              session={null}
              onSignedIn={s => onSeedSignedIn(s)}
              onSignOut={onSignOut}
            />
          </motion.div>
        )}
      </div>
    </div>
  )
}
