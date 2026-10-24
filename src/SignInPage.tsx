/**
 * SignInPage — full-screen standalone sign-in.
 * Two options only: self-custodial wallet (seed phrase) + MetaMask/WalletConnect.
 * No unnecessary wrapper divs. Clean, aesthetic, mobile-first.
 */
import { motion } from 'framer-motion'
import { ConnectKitButton } from 'connectkit'
import { Shield, Zap, Users, ArrowRight, Sun, Moon } from 'lucide-react'
import { WalletMetamask, WalletWalletConnect } from '@web3icons/react'
import { SeedWalletAuth, type SeedWalletSession } from './SeedWalletAuth'
import { type AccountSession } from './AccountView'

interface Props {
  onSeedSignedIn: (s: SeedWalletSession) => void
  onSocialSignedIn: (s: AccountSession) => void
  onCircleConnected: (addr: `0x${string}`) => void
  onSignOut: () => void
  dark: boolean
  onToggleDark?: () => void
}

export function SignInPage({ onSeedSignedIn, onSignOut, dark, onToggleDark }: Props) {
  return (
    <div className="min-h-dvh flex flex-col md:flex-row" style={{ background: 'var(--bg)' }}>

      {/* ── Left brand panel — desktop only ──────────────────────── */}
      <div className="hidden md:flex flex-col justify-between p-12 md:w-[44%] shrink-0 relative overflow-hidden"
        style={{ background: 'linear-gradient(150deg,#0f2554 0%,#1a3a7e 45%,#1e4faa 100%)' }}>
        {/* Ambient blobs */}
        <div className="absolute -top-32 -right-20 size-80 rounded-full pointer-events-none"
          style={{ background: 'rgba(79,130,255,0.22)', filter: 'blur(90px)' }} />
        <div className="absolute bottom-0 -left-20 size-64 rounded-full pointer-events-none"
          style={{ background: 'rgba(96,165,250,0.15)', filter: 'blur(70px)' }} />

        {/* Logo + name */}
        <div className="relative flex items-center gap-3 z-10">
          <img src="/logo.svg" alt="Fairtab" className="size-12 rounded-2xl shadow-lg" />
          <div>
            <p className="display text-2xl font-bold text-white tracking-tight">Fairtab</p>
            <p className="text-sm text-blue-300">powered by Arc</p>
          </div>
        </div>

        {/* Hero */}
        <div className="relative z-10 flex flex-col gap-8">
          <div>
            <h1 className="display text-[2.6rem] font-bold text-white leading-[1.15] mb-4 tracking-tight">
              Split bills.<br />Pay in USDC.<br />Stay fair.
            </h1>
            <p className="text-blue-200/80 text-base leading-relaxed max-w-[280px]">
              A self-custodial bill splitter on Arc. Your wallet, your keys, your money.
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

      {/* ── Right sign-in area ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-10 relative overflow-y-auto">

        {/* Dark toggle — absolute top-right on both mobile and desktop */}
        {onToggleDark && (
          <button
            onClick={onToggleDark}
            className="absolute top-5 right-5 flex items-center justify-center rounded-xl transition-all hover:scale-105"
            style={{ width: 38, height: 38, background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        )}

        {/* Mobile logo + name */}
        <div className="md:hidden flex items-center gap-3 mb-10 self-start">
          <img src="/logo.svg" alt="Fairtab" className="size-10 rounded-xl shadow" />
          <div>
            <p className="display text-xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>Fairtab</p>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>powered by Arc</p>
          </div>
        </div>

        {/* Page heading */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
          className="w-full max-w-sm mb-6"
        >
          <h2 className="display text-3xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
            Welcome back
          </h2>
          <p className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>
            Create or restore your self-custodial wallet
          </p>
          {/* Spectral underline */}
          <div className="mt-3 h-0.5 rounded-full w-16"
            style={{ background: 'linear-gradient(90deg,#3b8ef8,#818cf8,#e879f9)' }} />
        </motion.div>

        {/* ── Self-custodial wallet ─────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.06, ease: [0.25, 0.1, 0.25, 1] }}
          className="w-full max-w-sm"
        >
          <SeedWalletAuth
            session={null}
            onSignedIn={s => onSeedSignedIn(s)}
            onSignOut={onSignOut}
          />
        </motion.div>

        {/* ── Divider ───────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.12 }}
          className="w-full max-w-sm flex items-center gap-3 my-4"
        >
          <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
          <span className="text-xs font-medium px-1" style={{ color: 'var(--subtle)' }}>or connect</span>
          <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
        </motion.div>

        {/* ── MetaMask / WalletConnect ──────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.16, ease: [0.25, 0.1, 0.25, 1] }}
          className="w-full max-w-sm"
        >
          <ConnectKitButton.Custom>
            {({ show }) => (
              <button
                onClick={() => show?.()}
                className="w-full flex items-center gap-4 rounded-2xl px-5 py-4 text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--ink)',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                }}
              >
                {/* Stacked logos: MetaMask + WalletConnect */}
                <div className="relative shrink-0 w-12 h-9">
                  <div className="absolute left-0 top-0 size-9 rounded-xl overflow-hidden border-2 border-white dark:border-neutral-900 shadow-sm"
                    style={{ background: '#F5841F' }}>
                    <WalletMetamask variant="branded" width={36} height={36} />
                  </div>
                  <div className="absolute left-5 top-0 size-9 rounded-xl overflow-hidden border-2 border-white dark:border-neutral-900 shadow-sm"
                    style={{ background: '#3B99FC' }}>
                    <WalletWalletConnect variant="branded" width={36} height={36} />
                  </div>
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold" style={{ color: 'var(--ink)' }}>MetaMask / WalletConnect</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Connect your existing Web3 wallet</p>
                </div>
                <ArrowRight className="size-4 shrink-0" style={{ color: 'var(--subtle)' }} />
              </button>
            )}
          </ConnectKitButton.Custom>
        </motion.div>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.22 }}
          className="mt-8 text-xs text-center max-w-xs"
          style={{ color: 'var(--subtle)' }}
        >
          Fairtab never stores your private key or seed phrase. You own your keys.
        </motion.p>
      </div>
    </div>
  )
}
