/**
 * SignInModal — single "Sign In" button that opens a modal with all sign-in options:
 * Google, Email OTP, Wallet Connect (MetaMask/injected), and Passkey.
 */
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import { AccountView, type AccountSession } from './AccountView'

interface Props {
  onSocialSignedIn: (session: AccountSession) => void
  onCircleConnected: (address: `0x${string}`) => void
  wagmiAddress?: string
  circleAddress?: string
  socialSession?: AccountSession | null
  onSignOut: () => void
}

export function SignInModal({
  onSocialSignedIn,
  wagmiAddress,
  circleAddress,
  socialSession,
  onSignOut,
}: Props) {
  const [open, setOpen] = useState(false)

  const connected = !!(wagmiAddress || circleAddress || socialSession)
  const displayAddress = wagmiAddress ?? circleAddress ?? socialSession?.address ?? ''
  const displayName = socialSession?.username ?? (displayAddress ? `${displayAddress.slice(0, 6)}…${displayAddress.slice(-4)}` : '')

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold"
          style={{ background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}>
          <div className="size-2 rounded-full bg-green-400" />
          <span>{displayName}</span>
        </div>
        {socialSession && (
          <button
            onClick={onSignOut}
            className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
          >
            Sign out
          </button>
        )}
        {/* ConnectKit handles MetaMask disconnect */}
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
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
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
              className="fixed inset-x-4 top-20 z-50 mx-auto max-w-sm rounded-2xl overflow-hidden"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-5 pb-2">
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

              {/* Wallet Connect option */}
              <div className="px-5 pb-3">
                <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--subtle)' }}>
                  Web3 Wallet
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
                      <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'%3E%3Ccircle cx='10' cy='10' r='10' fill='%23F5841F'/%3E%3Cpath d='M6.5 7.5h7l-1 5h-5l-1-5z' fill='white'/%3E%3C/svg%3E" alt="" className="size-5 rounded-full" />
                      MetaMask / WalletConnect
                      <span className="ml-auto text-xs" style={{ color: 'var(--subtle)' }}>→</span>
                    </button>
                  )}
                </ConnectKitButton.Custom>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 px-5 pb-3">
                <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                <span className="text-xs" style={{ color: 'var(--subtle)' }}>or continue with</span>
                <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
              </div>

              {/* Google + Email + Passkey via AccountView */}
              <div className="px-5 pb-5">
                <AccountView
                  session={null}
                  onSignedIn={(session) => {
                    onSocialSignedIn(session)
                    setOpen(false)
                  }}
                  onSignOut={onSignOut}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
