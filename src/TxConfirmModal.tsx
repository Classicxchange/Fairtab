/**
 * TxConfirmModal — shown before a seed-wallet transaction is signed.
 * Mimics the "Confirm transaction" modal that MetaMask / ConnectKit shows.
 */
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldCheck, X, Loader2, AlertTriangle, ExternalLink } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { IS_MAINNET } from '@/config'

export interface TxDetail {
  /** Short action label, e.g. "Create bill", "Send USDC", "Pay share" */
  action: string
  /** Optional human-readable amount with unit, e.g. "100 USDC" */
  amount?: string
  /** Optional truncated recipient / contract label, e.g. "Bill contract" or "0x1234…5678" */
  to?: string
  /** Optional extra rows: [{label, value}] */
  rows?: { label: string; value: string }[]
  /** Danger/warning note shown in a red box */
  warning?: string
}

interface Props {
  open: boolean
  detail: TxDetail
  /** Wallet address sending the tx */
  fromAddress: string
  isPending: boolean
  onConfirm: () => void
  onCancel: () => void
}

const glass = {
  modal: {
    background: 'var(--surface-strong)',
    border: '1px solid var(--border)',
    borderRadius: '24px',
    boxShadow: '0 24px 64px rgba(0,0,0,0.25)',
  } as React.CSSProperties,
}

function fmtAddr(a: string) {
  return a.length > 12 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a
}

export function TxConfirmModal({ open, detail, fromAddress, isPending, onConfirm, onCancel }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-0 sm:px-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={e => { if (e.target === e.currentTarget) onCancel() }}>

          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />

          {/* Sheet */}
          <motion.div
            className="relative w-full sm:max-w-sm"
            style={glass.modal}
            initial={{ y: 48, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 48, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 36 }}
            onClick={e => e.stopPropagation()}>

            {/* Drag handle (mobile) */}
            <div className="flex justify-center pt-3 sm:hidden">
              <div className="h-1 w-10 rounded-full" style={{ background: 'var(--border-strong)' }} />
            </div>

            <div className="px-6 pt-5 pb-6 flex flex-col gap-5">

              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-2xl"
                    style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>
                    <ShieldCheck className="size-5" style={{ color: 'var(--accent)' }} />
                  </div>
                  <div>
                    <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Confirm transaction</p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>Review before signing</p>
                  </div>
                </div>
                <button onClick={onCancel} disabled={isPending}
                  className="flex size-8 items-center justify-center rounded-xl transition-all hover:scale-105 disabled:opacity-30"
                  style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                  <X className="size-4" style={{ color: 'var(--muted)' }} />
                </button>
              </div>

              {/* Amount hero */}
              {detail.amount && (
                <div className="flex flex-col items-center gap-2 py-4 rounded-2xl"
                  style={{ background: 'linear-gradient(135deg,rgba(37,99,235,0.08),rgba(37,99,235,0.02))', border: '1px solid var(--accent-border)' }}>
                  <div className="flex items-center gap-2">
                    <TokenUSDC variant="branded" size={28} />
                    <span className="display text-3xl font-bold tabular-nums" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>
                      {detail.amount}
                    </span>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                    style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
                    {detail.action}
                  </span>
                </div>
              )}

              {/* Details table */}
              <div className="flex flex-col gap-2.5 rounded-2xl px-4 py-3.5"
                style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                <Row label="Action" value={detail.action} />
                <Row label="From" value={fmtAddr(fromAddress)} mono />
                {detail.to && <Row label="To" value={detail.to} mono />}
                <Row label="Network" value={IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'} accent />
                <Row label="Gas fee" value="Paid in USDC" />
                {detail.rows?.map(r => <Row key={r.label} label={r.label} value={r.value} />)}
              </div>

              {/* Warning */}
              {detail.warning && (
                <div className="flex items-start gap-2.5 rounded-xl px-4 py-3"
                  style={{ background: 'var(--danger-bg)', border: '1px solid rgba(220,38,38,0.2)' }}>
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--danger)' }}>{detail.warning}</p>
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-3">
                <button onClick={onCancel} disabled={isPending}
                  className="flex-1 rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40"
                  style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
                  Cancel
                </button>
                <button onClick={onConfirm} disabled={isPending}
                  className="flex-[2] flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
                  style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 4px 20px rgba(37,99,235,0.3)' }}>
                  {isPending
                    ? <><Loader2 className="size-4 animate-spin" /> Signing…</>
                    : <><ExternalLink className="size-4" /> Confirm &amp; sign</>
                  }
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Row({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>{label}</span>
      <span className={`text-xs font-semibold ${mono ? 'font-mono' : ''}`}
        style={{ color: accent ? 'var(--accent)' : 'var(--ink)' }}>
        {value}
      </span>
    </div>
  )
}
