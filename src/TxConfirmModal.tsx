/**
 * TxConfirmModal — shown before a seed-wallet transaction is signed.
 * Mimics the "Confirm transaction" modal that MetaMask / ConnectKit shows.
 * When `estimateParams` is provided, runs eth_estimateGas + eth_gasPrice
 * on mount to show the real USDC gas cost (Arc native = USDC).
 */
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldCheck, X, Loader2, AlertTriangle, ExternalLink, Fuel } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { IS_MAINNET, arcChain } from '@/config'
import { createPublicClient, http, type Chain } from 'viem'

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

/** Params needed to run eth_estimateGas before signing */
export interface EstimateParams {
  from: `0x${string}`
  to: `0x${string}`
  data: `0x${string}`
  value?: bigint
}

interface Props {
  open: boolean
  detail: TxDetail
  /** Wallet address sending the tx */
  fromAddress: string
  isPending: boolean
  onConfirm: () => void
  onCancel: () => void
  /** When provided, the modal estimates gas and shows the USDC cost */
  estimateParams?: EstimateParams
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

/** Format a gas cost in native Arc units (18 decimals) → USDC display (6 decimals) */
function fmtGas(native: bigint): string {
  // Arc native gas has 18 decimals; USDC display is 6 decimals.
  // We divide by 1e12 to get the 6-decimal USDC value, then format it.
  const usdc6 = native / 1_000_000_000_000n
  const whole = usdc6 / 1_000_000n
  const frac = usdc6 % 1_000_000n
  const fracStr = frac.toString().padStart(6, '0').slice(0, 4).replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr} USDC` : `${whole} USDC`
}

export function TxConfirmModal({ open, detail, fromAddress, isPending, onConfirm, onCancel, estimateParams }: Props) {
  const [gasEstimate, setGasEstimate] = useState<string | null>(null)
  const [gasLoading, setGasLoading] = useState(false)

  useEffect(() => {
    if (!open || !estimateParams) return
    let cancelled = false
    const viemChain = arcChain as unknown as Chain
    const rpcUrl = (arcChain.rpcUrls as unknown as { default: { http: string[] } }).default.http[0]
      ?? (IS_MAINNET ? 'https://rpc.mainnet.arc.io' : 'https://rpc.testnet.arc.io')
    const client = createPublicClient({ chain: viemChain, transport: http(rpcUrl) })
    const run = async () => {
      if (cancelled) return
      setGasEstimate(null)
      setGasLoading(true)
      try {
        const [gas, gasPrice] = await Promise.all([
          client.estimateGas({ account: estimateParams.from, to: estimateParams.to, data: estimateParams.data, value: estimateParams.value ?? 0n }),
          client.getGasPrice(),
        ])
        if (!cancelled) setGasEstimate(fmtGas(gas * gasPrice))
      } catch {
        if (!cancelled) setGasEstimate('< 0.01 USDC')
      } finally {
        if (!cancelled) setGasLoading(false)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [open, estimateParams])

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
                {/* Gas fee row — estimated or fallback */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-widest flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
                    <Fuel className="size-3" /> Gas fee
                  </span>
                  <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
                    {gasLoading
                      ? <span className="flex items-center gap-1"><Loader2 className="size-3 animate-spin" style={{ color: 'var(--subtle)' }} /> Estimating…</span>
                      : gasEstimate
                        ? <span>{gasEstimate}</span>
                        : <span style={{ color: 'var(--muted)' }}>Paid in USDC</span>
                    }
                  </span>
                </div>
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
