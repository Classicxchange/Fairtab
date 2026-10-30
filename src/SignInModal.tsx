/**
 * SignInModal — sign-in button + modal.
 *
 * Options:
 *  1. MetaMask / WalletConnect (wagmi ConnectKit)
 *  2. Self-custodial seed wallet (create / import / unlock)
 *  3. Google / Email OTP / Passkey (Circle user-controlled wallets — still available)
 */
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, ChevronDown, ChevronUp } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import { AccountView, type AccountSession } from './AccountView'
import { SeedWalletAuth, type SeedWalletSession } from './SeedWalletAuth'

interface Props {
  /** Called with Google identity only (address still empty) — caller handles wallet onboarding */
  onSocialSignedIn: (session: AccountSession) => void
  onSeedSignedIn: (session: SeedWalletSession) => void
  onCircleConnected: (address: `0x${string}`) => void
  wagmiAddress?: string
  circleAddress?: string
  socialSession?: AccountSession | null
  seedSession?: SeedWalletSession | null
  onSignOut: () => void
}

export function SignInModal({
  onSocialSignedIn,
  onSeedSignedIn,
  wagmiAddress,
  socialSession,
  seedSession,
  onSignOut,
}: Props) {
  const [open, setOpen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const connected = !!(wagmiAddress || socialSession || seedSession)
  const displayAddress =
    wagmiAddress ??
    seedSession?.address ??
    socialSession?.address ??
    ''
  const displayName =
    seedSession
      ? displayAddress.slice(0, 6) + '…' + displayAddress.slice(-4)
      : socialSession?.username ??
        (displayAddress ? displayAddress.slice(0, 6) + '…' + displayAddress.slice(-4) : '')

  // ── Connected pill ─────────────────────────────────────────────────────────
  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold"
          style={{ background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}>
          <div className="size-2 rounded-full bg-green-400" />
          <span>{displayName}</span>
        </div>
        {(socialSession || seedSession) && (
          <button
            onClick={onSignOut}
            className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
          >
            Sign out
          </button>
        )}
        {wagmiAddress && <ConnectKitButton />}
      </div>
    )
  }

  return (
    <>
      {/* Sign In button */}
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all"
        style={{ background: 'var(--accent)', color: 'white', boxShadow: '0 2px 8px rgba(37,99,235,0.35)' }}
      >
        Sign In
      </motion.button>

      {/* Modal */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40"
              style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
            />

            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -12 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="fixed inset-x-4 top-16 z-50 mx-auto max-w-sm rounded-2xl overflow-hidden overflow-y-auto"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
                maxHeight: 'calc(100dvh - 5rem)',
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-5 pb-3">
                <div>
                  <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>Sign in to Fairtab</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>Choose how you want to connect</p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-center size-8 rounded-full transition-colors"
                  style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* ── Seed wallet (primary) ──────────────────────────────────── */}
              <div className="px-5 pb-4">
                <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--subtle)' }}>
                  Self-custodial wallet
                </p>
                <SeedWalletAuth
                  session={null}
                  onSignedIn={s => { onSeedSignedIn(s); setOpen(false) }}
                  onSignOut={onSignOut}
                />
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 px-5 pb-3">
                <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                <span className="text-xs" style={{ color: 'var(--subtle)' }}>or</span>
                <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
              </div>

              {/* ── MetaMask / WalletConnect ───────────────────────────────── */}
              <div className="px-5 pb-3">
                <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--subtle)' }}>
                  Web3 wallet
                </p>
                <ConnectKitButton.Custom>
                  {({ show }) => (
                    <button
                      onClick={() => { show?.(); setOpen(false) }}
                      className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all"
                      style={{
                        background: 'var(--surface-strong)',
                        border: '1px solid var(--border)',
                        color: 'var(--ink)',
                      }}
                    >
                      <img
                        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'%3E%3Ccircle cx='10' cy='10' r='10' fill='%23F5841F'/%3E%3Cpath d='M6.5 7.5h7l-1 5h-5l-1-5z' fill='white'/%3E%3C/svg%3E"
                        alt="" className="size-5 rounded-full"
                      />
                      MetaMask / WalletConnect
                      <span className="ml-auto text-xs" style={{ color: 'var(--subtle)' }}>→</span>
                    </button>
                  )}
                </ConnectKitButton.Custom>
              </div>

              {/* ── Advanced: Circle social/email/passkey (collapsible) ────── */}
              <div className="px-5 pb-5">
                <button
                  onClick={() => setShowAdvanced(s => !s)}
                  className="w-full flex items-center justify-between text-xs font-semibold py-2"
                  style={{ color: 'var(--subtle)' }}
                >
                  <span className="uppercase tracking-wide">More options (Google / Email / Passkey)</span>
                  {showAdvanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </button>

                <AnimatePresence>
                  {showAdvanced && (
                    <motion.div
                      key="advanced"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      style={{ overflow: 'hidden' }}
                    >
                      <AccountView
                        session={socialSession ?? null}
                        onSignedIn={s => { onSocialSignedIn(s); setOpen(false) }}
                        onSignOut={onSignOut}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
