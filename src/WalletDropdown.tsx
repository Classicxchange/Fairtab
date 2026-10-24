/**
 * WalletDropdown — header wallet pill with dropdown menu.
 * Shows connected address; clicking opens a panel with:
 *   - Copy address
 *   - Go to Account settings
 *   - Sign out
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Copy, CheckCircle2, LogOut, Settings, ChevronDown,
  Wallet, ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { useDisconnect } from 'wagmi'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { arcChain, IS_MAINNET } from '@/config'

const CHAIN_ID = arcChain.id

interface Props {
  address: string
  onGoToAccount: () => void
  onSignOut: () => void
}

export function WalletDropdown({ address, onGoToAccount, onSignOut }: Props) {
  const [open, setOpen]   = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { disconnect } = useDisconnect()

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const copyAddress = useCallback(() => {
    void navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success('Address copied')
  }, [address])

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`
  const explorerUrl = buildAddressExplorerUrl(CHAIN_ID, address)

  return (
    <div ref={ref} className="relative">
      {/* Pill button */}
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold transition-all"
        style={{
          background: 'var(--surface-strong)',
          border: '1px solid var(--border-strong)',
          color: 'var(--ink)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <span className="size-2 rounded-full shrink-0" style={{ background: 'var(--success)' }} />
        <span className="mono text-xs">{short}</span>
        <ChevronDown
          className="size-3.5 transition-transform"
          style={{
            color: 'var(--subtle)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </motion.button>

      {/* Dropdown panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="absolute right-0 mt-2 w-64 rounded-2xl overflow-hidden z-50"
            style={{
              background: 'var(--popover)',
              border: '1px solid var(--border-strong)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            {/* Address header */}
            <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="size-8 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>
                  <Wallet className="size-4" style={{ color: 'var(--accent)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                    {IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'}
                  </p>
                  <p className="mono text-xs truncate" style={{ color: 'var(--ink-2)' }}>{address}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={copyAddress}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all"
                  style={{
                    background: copied ? 'var(--success-bg)' : 'var(--surface-muted)',
                    color: copied ? 'var(--success)' : 'var(--ink-2)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {copied ? <CheckCircle2 className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all"
                  style={{
                    background: 'var(--surface-muted)',
                    color: 'var(--ink-2)',
                    border: '1px solid var(--border)',
                    textDecoration: 'none',
                  }}
                >
                  <ExternalLink className="size-3.5" />
                  Explorer
                </a>
              </div>
            </div>

            {/* Menu items */}
            <div className="p-2">
              <button
                onClick={() => { setOpen(false); onGoToAccount() }}
                className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all text-left"
                style={{ color: 'var(--ink-2)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-muted)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <Settings className="size-4 shrink-0" style={{ color: 'var(--subtle)' }} />
                Account settings
              </button>
              <button
                onClick={() => { setOpen(false); disconnect(); onSignOut() }}
                className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all text-left"
                style={{ color: 'var(--danger)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--danger-bg)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <LogOut className="size-4 shrink-0" />
                Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
