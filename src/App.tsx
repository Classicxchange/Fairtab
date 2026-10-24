import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { restoreCircleSession, clearCredential } from '@/CircleWalletAuth'
import { type SeedWalletSession, clearSeedWallet } from '@/SeedWalletAuth'
import { type AccountSession } from '@/AccountView'
import { WalletDropdown } from '@/WalletDropdown'
import { AccountPage, recordSignInTime } from '@/AccountPage'
import { SignInPage } from '@/SignInPage'
import { SendPage } from '@/SendPage'
import { CreateBillPage } from '@/CreateBillPage'
import { motion, AnimatePresence } from 'framer-motion'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { erc20Abi, parseUnits } from 'viem'
import { arcChain, IS_MAINNET } from '@/config'
import {
  Plus, ChevronDown, ChevronUp, ExternalLink, Clock,
  CheckCircle2, XCircle, AlertTriangle, Loader2, Receipt,
  Users, RefreshCw, Wallet,
  Send, Copy, QrCode, Link2, LayoutGrid,
  Sun, Moon, Share2, UserCircle,
  List, PenLine, ArrowDownCircle, CircleCheckBig,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { toast } from 'sonner'
import { getUsdc, buildTxExplorerUrl } from '@/onchain-facts'
import { formatUsdc, usdcDecimalsFor } from '@/onchain-money'
import artifact from '../contracts/out/HouseholdBillSplitter.sol/HouseholdBillSplitter.json'



// ─── Contract config ──────────────────────────────────────────────────────────
const CHAIN_ID = arcChain.id

// Testnet contract is deployed and live.
// Mainnet contract address must be filled in after you deploy from your own wallet:
//   forge create --rpc-url https://rpc.mainnet.arc.io --private-key $PRIVATE_KEY \
//     contracts/HouseholdBillSplitter.sol:HouseholdBillSplitter \
//     --constructor-args 0x3600000000000000000000000000000000000000
// Then replace REPLACE_WITH_MAINNET_CONTRACT_ADDRESS below with the deployed address.
const TESTNET_CONTRACT = '0xdb58ca32df331cf4729ee8668d19cc254f2d9326' as const
const MAINNET_CONTRACT = '0x2d4c3580B6B3BD5f1aEa2f0CF04649ED558769C0' as const
const CONTRACT_ADDRESS  = (IS_MAINNET ? MAINNET_CONTRACT : TESTNET_CONTRACT) as `0x${string}`
const CONTRACT_ABI = artifact.abi
const USDC_ADDRESS = getUsdc(CHAIN_ID)!.address as `0x${string}`

// ─── Types ────────────────────────────────────────────────────────────────────
type BillStatus = 0 | 1 | 2

interface Share {
  participant: `0x${string}`
  amount: bigint
  contributed: bigint
}

interface BillSummary {
  id: bigint
  creator: `0x${string}`
  payee: `0x${string}`
  totalAmount: bigint
  amountPaid: bigint
  status: BillStatus
  deadline: bigint
  recurring: boolean
  recurInterval: bigint
  cancelThreshold: number
  cancelVotes: number
  shares: Share[]
  label: string
  payoutRedirectVoteCount: number
}

// bytes32 hex → human-readable UTF-8 label (trim null bytes)
function bytes32ToLabel(hex: `0x${string}`): string {
  try {
    const bytes = hex.replace('0x', '').match(/.{2}/g)?.map(b => parseInt(b, 16)) ?? []
    return new TextDecoder().decode(new Uint8Array(bytes)).replace(/\0+$/, '').trim()
  } catch { return '' }
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const glass = {
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    boxShadow: 'var(--shadow)',
  } as React.CSSProperties,
  inner: {
    background: 'var(--surface-muted)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
  } as React.CSSProperties,
  sheet: {
    background: 'var(--surface)',
    borderTop: '1px solid var(--border)',
    boxShadow: '0 -4px 24px rgba(0,0,0,0.08)',
  } as React.CSSProperties,
}

const springs = {
  snappy: { type: 'spring', stiffness: 420, damping: 32 } as const,
  sheet:  { type: 'spring', stiffness: 380, damping: 38 } as const,
}

const fadeUp = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.18, ease: [0.25, 0.1, 0.25, 1] },
}

// ─── Dark mode hook ───────────────────────────────────────────────────────────
function useDarkMode() {
  const [dark, setDark] = useState<boolean>(() => {
    const stored = localStorage.getItem('fairtab_theme')
    if (stored) return stored === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const toggle = useCallback(() => {
    setDark(d => {
      const next = !d
      document.documentElement.classList.toggle('dark', next)
      localStorage.setItem('fairtab_theme', next ? 'dark' : 'light')
      return next
    })
  }, [])
  // Apply on mount
  useState(() => {
    document.documentElement.classList.toggle('dark', dark)
  })
  return { dark, toggle }
}

// ─── Live clock ───────────────────────────────────────────────────────────────
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (raw: bigint) => formatUsdc(raw)
const fmtAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const STATUS_LABEL: Record<BillStatus, string> = { 0: 'Active', 1: 'Settled', 2: 'Cancelled' }

function statusStyle(s: BillStatus): React.CSSProperties {
  if (s === 1) return { background: 'var(--success-bg)', color: 'var(--success)' }
  if (s === 2) return { background: 'var(--danger-bg)', color: 'var(--danger)' }
  return { background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }
}

// ─── TxButton ─────────────────────────────────────────────────────────────────
function TxButton({ label, onClick, disabled, isPending, isConfirming, danger, outline }: {
  label: string; onClick: () => void; disabled?: boolean
  isPending?: boolean; isConfirming?: boolean; danger?: boolean; outline?: boolean
}) {
  const busy = isPending || isConfirming
  const base = 'w-full rounded-lg py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40'
  const style: React.CSSProperties = outline
    ? { background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--ink-2)' }
    : danger
      ? { background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid var(--danger-bg)' }
      : { background: 'var(--accent)', color: 'var(--accent-dark)' }
  return (
    <button onClick={onClick} disabled={disabled || busy} className={base} style={style}>
      {busy
        ? <span className="flex items-center justify-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            {isPending ? 'Confirm in wallet…' : 'Confirming…'}
          </span>
        : label}
    </button>
  )
}

// ─── Background — clean solid canvas ─────────────────────────────────────────
function ArcBg() {
  return <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0, background: 'var(--bg)' }} />
}

// ─── Pay Sheet ────────────────────────────────────────────────────────────────
function PaySheet({ bill, open, onClose, onPaid }: {
  bill: BillSummary; open: boolean; onClose: () => void; onPaid: () => void
}) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const wrongChain = chainId !== undefined && chainId !== CHAIN_ID

  const myShare = bill.shares.find(s => s.participant.toLowerCase() === address?.toLowerCase())
  const myRemaining = myShare ? myShare.amount - myShare.contributed : 0n
  const myContribPct = myShare && myShare.amount > 0n ? Number((myShare.contributed * 10000n) / myShare.amount) / 100 : 0

  const dec = usdcDecimalsFor(CHAIN_ID)
  const [payInput, setPayInput] = useState('')
  const [approveDone, setApproveDone] = useState(false)

  const payRaw = useMemo(() => {
    try { const v = parseFloat(payInput); if (!v || v <= 0) return 0n; return parseUnits(v.toFixed(dec), dec) }
    catch { return 0n }
  }, [payInput, dec])
  const payValid = payRaw > 0n && payRaw <= myRemaining

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance',
    args: address ? [address, CONTRACT_ADDRESS] : undefined,
    query: { enabled: !!address && !!myShare }, chainId: CHAIN_ID,
  })
  const needsApprove = payValid && !approveDone && (allowance === undefined || allowance < payRaw)

  const { writeContract: writeApprove, data: approveHash, isPending: approvePending } = useWriteContract()
  const { isLoading: approveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveHash })
  const { writeContract: writePay, data: payHash, isPending: payPending, reset: resetPay } = useWriteContract()
  const { isLoading: payConfirming, isSuccess: paySuccess } = useWaitForTransactionReceipt({ hash: payHash })

  const ensureChain = useCallback(() => { if (wrongChain) switchChain({ chainId: CHAIN_ID }); return !wrongChain }, [wrongChain, switchChain])

  const handleApprove = useCallback(() => {
    if (!ensureChain() || !payValid) return
    writeApprove({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [CONTRACT_ADDRESS, payRaw] })
  }, [ensureChain, payValid, payRaw, writeApprove])

  const handlePay = useCallback(() => {
    if (!ensureChain() || !payValid) return
    writePay({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'pay', args: [bill.id, payRaw] })
  }, [ensureChain, payValid, bill.id, payRaw, writePay])

  if (approveSuccess && !approveDone) { setApproveDone(true); void refetchAllowance() }
  if (paySuccess) { onPaid(); toast.success('Payment confirmed'); setPayInput(''); setApproveDone(false); resetPay() }

  if (!myShare) return null

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <motion.section className="relative w-full max-w-lg overflow-hidden rounded-t-3xl"
            style={glass.sheet}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={springs.sheet} onClick={e => e.stopPropagation()}>
            <div style={{ height: 1, background: 'var(--border)' }} />
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full" style={{ background: 'var(--border-strong)' }} />
            </div>
            <div className="px-6 pb-8 pt-3 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>Pay your share</h3>
                <button onClick={onClose} className="rounded-full p-1.5" style={{ background: 'var(--surface-muted)' }}>
                  <XCircle className="size-4" style={{ color: 'var(--subtle)' }} />
                </button>
              </div>

              {/* My share progress */}
              <div className="rounded-2xl p-4" style={glass.inner}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Your share</span>
                  <span className="mono text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
                    {fmt(myShare.contributed)} / {fmt(myShare.amount)} USDC
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: myContribPct > 0 ? `max(2px, ${myContribPct}%)` : '0', background: myContribPct >= 100 ? 'var(--success)' : 'var(--accent)' }} />
                </div>
                <p className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                  {fmt(myRemaining)} USDC remaining
                </p>
              </div>

              {/* Amount input */}
              <div className="rounded-2xl p-4" style={glass.inner}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Amount to pay now</p>
                <div className="flex items-center gap-2">
                  <TokenUSDC variant="branded" size={20} />
                  <input inputMode="decimal" value={payInput}
                    onChange={e => { setPayInput(e.target.value.replace(/[^0-9.]/g, '')); setApproveDone(false) }}
                    placeholder="0.00"
                    className="display flex-1 bg-transparent text-2xl font-bold tabular-nums outline-none placeholder:opacity-20"
                    style={{ color: 'var(--ink)' }} />
                  <button onClick={() => { setPayInput(fmt(myRemaining)); setApproveDone(false) }}
                    className="rounded-lg px-2 py-1 text-xs font-semibold"
                    style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
                    Max
                  </button>
                </div>
              </div>

              {needsApprove
                ? <TxButton label="Allow USDC" onClick={handleApprove} disabled={!payValid} isPending={approvePending} isConfirming={approveConfirming} />
                : <TxButton label={payInput ? `Pay ${payInput} USDC` : 'Enter amount'} onClick={handlePay} disabled={!payValid} isPending={payPending} isConfirming={payConfirming} />
              }

              {payHash && (
                <a href={buildTxExplorerUrl(CHAIN_ID, payHash)} target="_blank" rel="noreferrer"
                  className="flex items-center justify-center gap-1 text-xs" style={{ color: 'var(--accent)' }}>
                  View on ArcScan <ExternalLink className="size-3" />
                </a>
              )}


            </div>
          </motion.section>
        </motion.div>
      )}

    </AnimatePresence>
  )
}

// ─── Share Bill Button ────────────────────────────────────────────────────────
function ShareBillButton({ billId }: { billId: bigint }) {
  const [copied, setCopied] = useState(false)
  const handleShare = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const url = `${window.location.origin}${window.location.pathname}?bill=${billId.toString()}`
    void navigator.clipboard.writeText(url)
    setCopied(true)
    toast.success('Bill link copied!')
    setTimeout(() => setCopied(false), 2000)
  }, [billId])
  return (
    <button onClick={handleShare}
      className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition-all shrink-0 hover:scale-105 active:scale-95"
      style={{
        background: copied ? 'var(--success-bg)' : 'var(--surface-muted)',
        color: copied ? 'var(--success)' : 'var(--subtle)',
        border: '1px solid var(--border)',
      }}
      title="Copy shareable link">
      {copied ? <CheckCircle2 className="size-3" /> : <Share2 className="size-3" />}
      {copied ? 'Copied' : 'Share'}
    </button>
  )
}

// ─── Bill Card ────────────────────────────────────────────────────────────────
function BillCard({ bill, refetch }: { bill: BillSummary; refetch: () => void }) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const wrongChain = chainId !== undefined && chainId !== CHAIN_ID
  const [expanded, setExpanded] = useState(false)
  const [showPaySheet, setShowPaySheet] = useState(false)

  const myShare = bill.shares.find(s => s.participant.toLowerCase() === address?.toLowerCase())
  const isPayee = bill.payee.toLowerCase() === address?.toLowerCase()
  const isCreator = bill.creator.toLowerCase() === address?.toLowerCase()
  const progressPct = bill.totalAmount > 0n ? Number((bill.amountPaid * 100n) / bill.totalAmount) : 0
  const now = useNow()
  const isLate = bill.deadline > 0n && now > Number(bill.deadline) && bill.status === 0
  const myFullyPaid = myShare ? myShare.contributed >= myShare.amount : false

  const ensureChain = useCallback(() => { if (wrongChain) switchChain({ chainId: CHAIN_ID }); return !wrongChain }, [wrongChain, switchChain])

  const { writeContract: writeClaim, data: claimHash, isPending: claimPending } = useWriteContract()
  const { isLoading: claimConfirming, isSuccess: claimSuccess } = useWaitForTransactionReceipt({ hash: claimHash })
  const { writeContract: writeVote, data: voteHash, isPending: votePending } = useWriteContract()
  const { isLoading: voteConfirming, isSuccess: voteSuccess } = useWaitForTransactionReceipt({ hash: voteHash })
  const { writeContract: writeExpiredRefund, data: expiredHash, isPending: expiredPending } = useWriteContract()
  const { isLoading: expiredConfirming, isSuccess: expiredSuccess } = useWaitForTransactionReceipt({ hash: expiredHash })

  const { data: payoutClaimableRaw } = useReadContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'payoutClaimable', args: [bill.id], chainId: CHAIN_ID })
  const payoutClaimableAmt = (payoutClaimableRaw as bigint | undefined) ?? 0n
  const handleClaimPayout = useCallback(() => { if (ensureChain()) writeClaim({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'claimPayout', args: [bill.id] }) }, [ensureChain, bill.id, writeClaim])
  const handleVoteCancel = useCallback(() => { if (ensureChain()) writeVote({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'voteCancel', args: [bill.id] }) }, [ensureChain, bill.id, writeVote])
  const handleExpiredRefund = useCallback(() => { if (ensureChain()) writeExpiredRefund({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'claimExpiredRefund', args: [bill.id] }) }, [ensureChain, bill.id, writeExpiredRefund])

  if (claimSuccess || voteSuccess || expiredSuccess) { refetch(); toast.success('Transaction confirmed') }

  const progressColor = bill.status === 2 ? 'var(--danger)' : bill.status === 1 ? 'var(--success)' : progressPct === 100 ? 'var(--success)' : 'var(--accent)'

  return (
    <>
      <motion.div style={glass.card} className="overflow-hidden relative" {...fadeUp}
        whileHover={{ y: -1, transition: { duration: 0.15 } }}>
        {/* Accent left border — active bills only */}
        {bill.status === 0 && <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full" style={{ background: 'var(--accent)' }} />}

        <div className="p-5">
          {/* Header row */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex-1 min-w-0">
              {/* Label */}
              {bill.label && (
                <p className="text-sm font-semibold mb-1 truncate" style={{ color: 'var(--ink)' }}>{bill.label}</p>
              )}
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-xs font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                  style={statusStyle(bill.status)}>
                  {STATUS_LABEL[bill.status]}
                </span>
                {bill.recurring && (
                  <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
                    <RefreshCw className="size-3" /> Recurring
                  </span>
                )}
                {isLate && (
                  <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--danger)' }}>
                    <AlertTriangle className="size-3" /> Late
                  </span>
                )}
              </div>
              <p className="display text-2xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                {fmt(bill.totalAmount)} <span className="text-sm font-normal" style={{ color: 'var(--subtle)' }}>USDC</span>
              </p>
              <p className="mono text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
                to {fmtAddr(bill.payee)}
              </p>
            </div>

            {/* Share button */}
            <ShareBillButton billId={bill.id} />

            {/* Donut-style progress ring — simple CSS */}
            <div className="relative flex size-14 items-center justify-center flex-shrink-0">
              <svg className="absolute inset-0" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="20" stroke="var(--border)" strokeWidth="4" />
                <circle cx="24" cy="24" r="20"
                  stroke={progressColor}
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 20}`}
                  strokeDashoffset={`${2 * Math.PI * 20 * (1 - progressPct / 100)}`}
                  transform="rotate(-90 24 24)"
                  style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                />
              </svg>
              <span className="display text-xs font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                {progressPct}%
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1 rounded-full overflow-hidden mb-1" style={{ background: 'var(--border)' }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%`, background: progressColor }} />
          </div>
          <div className="flex justify-between text-xs tabular-nums mb-3" style={{ color: 'var(--subtle)' }}>
            <span>{fmt(bill.amountPaid)} paid</span>
            <span>{fmt(bill.totalAmount - bill.amountPaid)} left</span>
          </div>

          {/* Deadline */}
          {bill.deadline > 0n && (
            <div className="flex items-center gap-1.5 text-xs mb-3" style={{ color: isLate ? 'var(--danger)' : 'var(--subtle)' }}>
              <Clock className="size-3" />
              Due {new Date(Number(bill.deadline) * 1000).toLocaleDateString()}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-2">
            {/* My unpaid share — open pay sheet */}
            {address && bill.status === 0 && myShare && !myFullyPaid && !isLate && (
              <button onClick={() => setShowPaySheet(true)}
                className="w-full flex items-center justify-between rounded-2xl px-4 py-3 transition-all hover:scale-[1.01] active:scale-[0.99]"
                style={{ background: 'var(--accent-light)', border: '1px solid rgba(45,216,122,0.20)' }}>
                <div className="flex items-center gap-2">
                  <Wallet className="size-4" style={{ color: 'var(--accent)' }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>Pay your share</span>
                </div>
                <span className="mono text-xs font-semibold tabular-nums" style={{ color: 'var(--accent)' }}>
                  {fmt(myShare.amount - myShare.contributed)} USDC remaining
                </span>
              </button>
            )}

            {/* Fully paid badge */}
            {address && bill.status === 0 && myShare && myFullyPaid && (
              <div className="flex items-center gap-2 rounded-2xl px-4 py-3" style={{ background: 'var(--success-bg)' }}>
                <CheckCircle2 className="size-4 shrink-0" style={{ color: 'var(--success)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--success)' }}>Your share is fully paid</span>
              </div>
            )}

            {/* Payee claim */}
            {isPayee && bill.status === 1 && payoutClaimableAmt > 0n && (
              <TxButton label={claimSuccess ? 'Claimed!' : `Claim ${fmt(payoutClaimableAmt)} USDC`}
                onClick={handleClaimPayout} isPending={claimPending} isConfirming={claimConfirming} disabled={claimSuccess} />
            )}
            {isPayee && bill.status === 1 && payoutClaimableAmt === 0n && !claimSuccess && (
              <div className="rounded-2xl px-4 py-3 text-sm font-medium flex items-center gap-2"
                style={{ background: 'var(--success-bg, #f0fdf4)', color: 'var(--success, #16a34a)' }}>
                <CheckCircle2 className="size-4 shrink-0" />
                Payment received automatically
              </div>
            )}

            {/* Expired deadline — passive refund banner */}
            {address && bill.status === 0 && bill.deadline > 0n && now > Number(bill.deadline) && myShare && myShare.contributed > 0n && (
              <div className="rounded-2xl p-4 flex items-start gap-3"
                style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}>
                <AlertTriangle className="size-4 mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: 'var(--warning)' }}>
                    {expiredSuccess ? 'Refund claimed!' : 'This bill has expired'}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--warning)' }}>
                    {expiredSuccess
                      ? `${fmt(myShare.contributed)} USDC is on its way back to your wallet.`
                      : `Your ${fmt(myShare.contributed)} USDC contribution is ready to be returned.`}
                  </p>
                  {!expiredSuccess && (
                    <button onClick={handleExpiredRefund}
                      disabled={expiredPending || expiredConfirming}
                      className="mt-2.5 rounded-xl px-4 py-1.5 text-xs font-semibold disabled:opacity-50"
                      style={{ background: 'var(--warning)', color: '#fff' }}>
                      {expiredPending || expiredConfirming
                        ? <span className="flex items-center gap-1.5"><Loader2 className="size-3 animate-spin" /> Claiming…</span>
                        : `Get my ${fmt(myShare.contributed)} USDC back`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Expand participants */}
          <button onClick={() => setExpanded(v => !v)}
            className="mt-4 flex w-full items-center justify-between text-xs font-semibold"
            style={{ color: 'var(--subtle)' }}>
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5" /> {bill.shares.length} participants
            </span>
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
                className="overflow-hidden">
                <div className="mt-3 flex flex-col gap-2">
                  {bill.shares.map((s, i) => {
                    const fullyPaid = s.contributed >= s.amount
                    const pct = s.amount > 0n ? Number((s.contributed * 100n) / s.amount) : 0
                    const late = bill.deadline > 0n && now > Number(bill.deadline) && !fullyPaid && bill.status === 0
                    const isMe = s.participant.toLowerCase() === address?.toLowerCase()
                    return (
                      <div key={i} className="rounded-xl px-3 py-2.5" style={glass.inner}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            {fullyPaid
                              ? <CheckCircle2 className="size-3.5" style={{ color: 'var(--success)' }} />
                              : late ? <AlertTriangle className="size-3.5" style={{ color: 'var(--danger)' }} />
                                     : <Clock className="size-3.5" style={{ color: 'var(--subtle)' }} />}
                            <span className="mono text-xs" style={{ color: isMe ? 'var(--accent)' : 'var(--ink-2)' }}>
                              {isMe ? 'You' : fmtAddr(s.participant)}
                            </span>
                            {late && <span className="text-xs font-bold" style={{ color: 'var(--danger)' }}>LATE</span>}
                          </div>
                          <span className="mono text-xs tabular-nums" style={{ color: fullyPaid ? 'var(--success)' : 'var(--ink-2)' }}>
                            {fmt(s.contributed)}/{fmt(s.amount)}
                          </span>
                        </div>
                        <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                          <div className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, background: fullyPaid ? 'var(--success)' : late ? 'var(--danger)' : 'var(--accent)' }} />
                        </div>
                      </div>
                    )
                  })}

                  {/* Request cancellation */}
                  {bill.status === 0 && (isCreator || myShare) && (
                    <div className="flex items-center justify-between rounded-xl px-3 py-2.5" style={glass.inner}>
                      <div>
                        <p className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>Cancel this bill</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
                          {bill.cancelVotes > 0
                            ? `${bill.cancelVotes} of ${bill.cancelThreshold} approvals received`
                            : `Needs ${bill.cancelThreshold} approval${bill.cancelThreshold > 1 ? 's' : ''} to cancel`}
                        </p>
                      </div>
                      <button onClick={handleVoteCancel}
                        disabled={votePending || voteConfirming || voteSuccess}
                        className="rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                        style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid transparent' }}>
                        {votePending || voteConfirming
                          ? <Loader2 className="size-3 animate-spin inline" />
                          : voteSuccess ? 'Submitted' : 'Request Cancel'}
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Pay sheet per bill */}
      <PaySheet bill={bill} open={showPaySheet} onClose={() => setShowPaySheet(false)}
        onPaid={() => { setShowPaySheet(false); refetch() }} />
    </>
  )
}

// ─── Bill loader ──────────────────────────────────────────────────────────────
function BillLoader({ id, refetch, filter, address: walletAddr }: {
  id: bigint; refetch: () => void
  filter: 'all' | 'created' | 'owe' | 'done'
  address?: `0x${string}`
}) {
  const { data: billData } = useReadContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'getBill', args: [id], chainId: CHAIN_ID })
  const { data: sharesData } = useReadContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'getShares', args: [id], chainId: CHAIN_ID })
  const { data: metaData } = useReadContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'getBillMeta', args: [id], chainId: CHAIN_ID })
  if (!billData || !sharesData) return (
    <div className="rounded-2xl h-32 animate-pulse" style={{ background: 'var(--surface-muted)' }} />
  )
  const [creator, payee, totalAmount, amountPaid, status, deadline, recurring, recurInterval, cancelThreshold, cancelVotes] =
    billData as [`0x${string}`, `0x${string}`, bigint, bigint, BillStatus, bigint, boolean, bigint, number, number]
  const shares = (sharesData as Array<{ participant: `0x${string}`; amount: bigint; contributed: bigint }>).map(s => ({ participant: s.participant, amount: s.amount, contributed: s.contributed }))
  const [labelHex, payoutRedirectVoteCount] = (metaData ?? ['0x' + '0'.repeat(64), 0]) as [`0x${string}`, number]
  const label = bytes32ToLabel(labelHex)
  const bill: BillSummary = { id, creator, payee, totalAmount, amountPaid, status, deadline, recurring, recurInterval, cancelThreshold, cancelVotes, shares, label, payoutRedirectVoteCount }

  // Membership gate — always enforce when wallet is connected
  if (walletAddr) {
    const addr = walletAddr.toLowerCase()
    const isCreator = creator.toLowerCase() === addr
    const isPayee  = payee.toLowerCase() === addr
    const isParticipant = shares.some(s => s.participant.toLowerCase() === addr)
    if (!isCreator && !isPayee && !isParticipant) return null
    // Sub-filter within member bills
    if (filter !== 'all') {
      const isDone = status === 1 || status === 2
      if (filter === 'created' && !isCreator) return null
      if (filter === 'owe' && (!isParticipant || isDone)) return null
      if (filter === 'done' && !isDone) return null
    }
  }

  return <BillCard bill={bill} refetch={refetch} />
}

// ─── Receive View ─────────────────────────────────────────────────────────────
function ReceiveView({ unifiedAddress }: { unifiedAddress?: `0x${string}` }) {
  const { address: wagmiAddr } = useAccount()
  const address = unifiedAddress ?? wagmiAddr
  const [reqAmount, setReqAmount] = useState('')
  const [reqMemo, setReqMemo] = useState('')
  const [copied, setCopied] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  const copyAddress = useCallback(() => {
    if (!address) return
    void navigator.clipboard.writeText(address)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }, [address])

  const paymentLink = useMemo(() => {
    if (!address) return ''
    const p = new URLSearchParams({ to: address })
    if (reqAmount) p.set('amount', reqAmount)
    if (reqMemo) p.set('memo', reqMemo)
    return `${window.location.origin}?${p.toString()}`
  }, [address, reqAmount, reqMemo])

  const copyLink = useCallback(() => {
    void navigator.clipboard.writeText(paymentLink)
    setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000)
  }, [paymentLink])

  if (!address) return (
    <motion.div className="flex flex-col items-center justify-center py-20 gap-4" {...fadeUp}>
      <QrCode className="size-10" style={{ color: 'var(--subtle)' }} />
      <p className="text-sm" style={{ color: 'var(--muted)' }}>Connect a wallet to receive USDC.</p>
      <ConnectKitButton />
    </motion.div>
  )

  return (
    <motion.div className="flex flex-col gap-5 max-w-lg" {...fadeUp}>
      <div>
        <h2 className="display text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Receive USDC</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Share your address or generate a payment request link.</p>
      </div>

      {/* Address card */}
      <div className="rounded-2xl p-5 flex flex-col gap-3" style={glass.card}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Your address</span>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>{IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'}</span>
        </div>
        {/* Visual address block */}
        <div className="rounded-xl p-4 flex flex-col gap-2" style={{ background: 'rgba(79,110,247,0.06)', border: '1px solid rgba(79,110,247,0.15)' }}>
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: 'var(--accent)', boxShadow: '0 0 16px rgba(79,110,247,0.25)' }}>
              <Wallet className="size-5" style={{ color: '#fff' }} />
            </div>
            <p className="mono break-all text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>{address}</p>
          </div>
        </div>
        <button onClick={copyAddress}
          className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all hover:scale-[1.01]"
          style={{ background: copied ? 'var(--success-bg)' : 'var(--surface-strong)', color: copied ? 'var(--success)' : 'var(--ink-2)', border: '1px solid var(--border-strong)' }}>
          {copied ? <CheckCircle2 className="size-4" /> : <Copy className="size-4" />}
          {copied ? 'Copied!' : 'Copy address'}
        </button>
      </div>

      {/* Payment request generator */}
      <div className="rounded-2xl p-5 flex flex-col gap-4" style={glass.card}>
        <div className="flex items-center gap-2">
          <Link2 className="size-4" style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Request a specific amount</span>
        </div>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Generate a payment link pre-filled with an amount — send it to whoever owes you.
        </p>
        <div className="flex gap-3">
          <div className="flex-1 rounded-xl px-3 py-2.5" style={glass.inner}>
            <p className="text-xs mb-1" style={{ color: 'var(--subtle)' }}>Amount (USDC)</p>
            <input inputMode="decimal" value={reqAmount}
              onChange={e => setReqAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
              className="w-full bg-transparent text-sm font-semibold tabular-nums outline-none placeholder:opacity-30"
              style={{ color: 'var(--ink)' }} />
          </div>
          <div className="flex-1 rounded-xl px-3 py-2.5" style={glass.inner}>
            <p className="text-xs mb-1" style={{ color: 'var(--subtle)' }}>Memo</p>
            <input value={reqMemo} onChange={e => setReqMemo(e.target.value)} maxLength={60}
              placeholder="e.g. October rent"
              className="w-full bg-transparent text-sm outline-none placeholder:opacity-30"
              style={{ color: 'var(--ink)' }} />
          </div>
        </div>
        <div className="rounded-xl px-3 py-2.5 flex items-center gap-2 overflow-hidden" style={glass.inner}>
          <Link2 className="size-3.5 shrink-0" style={{ color: 'var(--subtle)' }} />
          <p className="mono text-xs flex-1 truncate" style={{ color: 'var(--subtle)' }}>{paymentLink || '—'}</p>
        </div>
        <button onClick={copyLink} disabled={!paymentLink}
          className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all hover:scale-[1.01] disabled:opacity-40"
          style={{ background: linkCopied ? 'var(--success-bg)' : 'var(--accent-light)', color: linkCopied ? 'var(--success)' : 'var(--accent)', border: `1px solid ${linkCopied ? 'var(--success-bg)' : 'rgba(79,110,247,0.2)'}` }}>
          {linkCopied ? <CheckCircle2 className="size-4" /> : <Copy className="size-4" />}
          {linkCopied ? 'Link copied!' : 'Copy payment link'}
        </button>
      </div>
    </motion.div>
  )
}

// ─── Payout ready toaster ─────────────────────────────────────────────────────
// Each BillPayoutChecker reads one bill's payout and calls onReady with the
// claimable amount if this wallet is the payee. PayoutReadyToaster mounts one
// checker per bill and fires a single toast once all are resolved.
function BillPayoutChecker({ id, walletAddr, onReady }: {
  id: bigint; walletAddr: string; onReady: (id: bigint, amount: bigint) => void
}) {
  const { data: claimable } = useReadContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'payoutClaimable', args: [id], chainId: CHAIN_ID })
  const { data: billData } = useReadContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'getBill', args: [id], chainId: CHAIN_ID })
  useEffect(() => {
    if (!claimable || !billData) return
    const amt = claimable as bigint
    if (amt === 0n) return
    const bd = billData as unknown[]
    const payee = (bd[1] as string).toLowerCase()
    if (payee === walletAddr.toLowerCase()) onReady(id, amt)
  }, [claimable, billData, walletAddr, id, onReady])
  return null
}

function PayoutReadyToaster({ count, address: walletAddr }: { count: number; address?: `0x${string}` }) {
  const toastedRef = useRef(false)
  const pendingRef = useRef<Map<bigint, bigint>>(new Map())
  const ids = useMemo(() => Array.from({ length: count }, (_, i) => BigInt(i)), [count])
  const handleReady = useCallback((id: bigint, amount: bigint) => {
    if (toastedRef.current) return
    pendingRef.current.set(id, amount)
    const total = [...pendingRef.current.values()].reduce((s, v) => s + v, 0n)
    toastedRef.current = true
    toast.success(`You have ${fmt(total)} USDC ready to claim`, { duration: 6000 })
  }, [])
  if (!walletAddr || count === 0) return null
  return (
    <>
      {ids.map(id => (
        <BillPayoutChecker key={id.toString()} id={id} walletAddr={walletAddr} onReady={handleReady} />
      ))}
    </>
  )
}


// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { address: wagmiAddress, chainId } = useAccount()
  const wrongChain = chainId !== undefined && chainId !== CHAIN_ID

  // ── Social session (Google / email OTP) ───────────────────────────────────
  const [socialSession, setSocialSession] = useState<AccountSession | null>(() => {
    try {
      const stored = localStorage.getItem('fairtab_session_v2')
      return stored ? (JSON.parse(stored) as AccountSession) : null
    } catch { return null }
  })

  // ── Seed wallet session ────────────────────────────────────────────────────
  const [seedSession, setSeedSession] = useState<SeedWalletSession | null>(null)

  // ── Circle Wallet (passkey smart account) ──────────────────────────────────
  const [circleAddress, setCircleAddress] = useState<`0x${string}` | null>(null)
  const [, setCircleBundler] = useState<ReturnType<typeof import('viem/account-abstraction').createBundlerClient> | null>(null)

  // Restore passkey session on mount
  useEffect(() => {
    void restoreCircleSession().then(session => {
      if (session) {
        setCircleAddress(session.address)
        setCircleBundler(session.bundler)
      }
    })
  }, [])

  // Record sign-in time when MetaMask connects
  useEffect(() => {
    if (wagmiAddress) recordSignInTime()
  }, [wagmiAddress])

  // Unified address: seed wallet > Circle passkey > social (Google/email) > MetaMask
  const address = seedSession?.address ?? circleAddress ?? (socialSession?.address as `0x${string}` | undefined) ?? wagmiAddress

  const { data: billCount, refetch: refetchCount } = useReadContract({
    address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'billCount', chainId: CHAIN_ID,
  })

  const [showCreate, setShowCreate] = useState(false)
  const [filter, setFilter] = useState<'all' | 'created' | 'owe' | 'done'>('all')
  // Parse prefilled params from URL
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), [])
  const prefilledTo = urlParams.get('to')
  // Deep-link: ?bill=N highlights that bill
  const deepLinkBillId = useMemo(() => { const b = urlParams.get('bill'); return b != null ? BigInt(b) : null }, [urlParams])

  const { dark, toggle: toggleDark } = useDarkMode()
  const [tab, setTab] = useState<'bills' | 'send' | 'receive' | 'account'>(prefilledTo ? 'send' : 'bills')

  const count = billCount != null ? Number(billCount) : 0

  // When a deep-link bill arrives, scroll to it once bills are loaded
  const deepLinkRef = useCallback((node: HTMLDivElement | null) => {
    if (node) setTimeout(() => node.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)
  }, [])

  const ids = Array.from({ length: count }, (_, i) => BigInt(i)).reverse()
  const refetch = useCallback(() => { void refetchCount() }, [refetchCount])

  return (
    <div className="relative min-h-dvh" style={{ background: 'transparent' }}>
      <ArcBg />

      {/* ── Sign-in page gate ── shown when no wallet is connected ─ */}
      <AnimatePresence>
        {!address && (
          <motion.div
            key="signin-page"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50"
            style={{ background: 'var(--bg)' }}
          >
            <SignInPage
              dark={dark}
              onToggleDark={toggleDark}
              onSeedSignedIn={s => { setSeedSession(s); recordSignInTime() }}
              onSocialSignedIn={session => {
                setSocialSession(session)
                recordSignInTime()
                localStorage.setItem('fairtab_session_v2', JSON.stringify(session))
              }}
              onCircleConnected={addr => setCircleAddress(addr)}
              onSignOut={() => {
                setSeedSession(null)
                setSocialSession(null)
                localStorage.removeItem('fairtab_session_v2')
                setCircleAddress(null)
                clearCredential()
                clearSeedWallet()
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="relative z-30 sticky top-0"
        style={{
          background: 'var(--surface-strong)',
          borderBottom: '1px solid var(--border)',
          boxShadow: 'var(--shadow-sm)',
          backdropFilter: 'blur(12px)',
        }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 gap-2">
          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0 min-w-0">
            <img src="/logo.svg" alt="Fairtab" className="size-8 shrink-0 rounded-xl" />
            <div className="hidden xs:block">
              <span className="display text-sm font-bold leading-none tracking-tight" style={{ color: 'var(--ink)' }}>Fairtab</span>
              <p className="text-[10px] leading-none mt-0.5 hidden sm:block" style={{ color: 'var(--subtle)' }}>powered by Arc</p>
            </div>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1.5 min-w-0">
            {wrongChain && address && (
              <span className="hidden sm:flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5"
                style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid var(--danger-bg)' }}>
                <AlertTriangle className="size-3" /> Wrong network
              </span>
            )}
            {/* Dark / Light toggle */}
            <motion.button
              onClick={toggleDark}
              whileTap={{ scale: 0.88 }}
              className="flex items-center justify-center rounded-xl transition-colors"
              style={{ width: 32, height: 32, background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </motion.button>

            {/* Wallet dropdown (only shown when connected) */}
            {address && (
              <WalletDropdown
                address={address}
                onGoToAccount={() => setTab('account')}
                onSignOut={() => {
                  setSeedSession(null)
                  setSocialSession(null)
                  localStorage.removeItem('fairtab_session_v2')
                  setCircleAddress(null)
                  clearCredential()
                  clearSeedWallet()
                }}
              />
            )}
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-6xl px-5 py-8">
        {/* ── Two-column layout ──────────────────────────────────── */}
        <div className="flex gap-5 items-start">

          {/* ── Left rail (sticky) ──────────────────────────────── */}
          <aside className="hidden md:flex flex-col gap-4 w-56 shrink-0 sticky top-24">
            {/* Brand hero */}
            <motion.div className="p-4 overflow-hidden" {...fadeUp}>
              <h1 className="text-base font-bold mb-0.5" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
                Fairtab
              </h1>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Split bills · Send USDC
              </p>
            </motion.div>

            {/* Nav */}
            <motion.div className="flex flex-col gap-1" {...fadeUp} transition={{ delay: 0.05 }}>
              {([
                { id: 'bills',   label: 'Bills',   icon: LayoutGrid },
                { id: 'send',    label: 'Send',    icon: Send       },
                { id: 'receive', label: 'Receive', icon: QrCode     },
                { id: 'account', label: 'Account', icon: UserCircle },
              ] as const).map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setTab(id)}
                  className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-all hover:scale-[1.01] text-left"
                  style={{
                    background: tab === id ? 'var(--accent-light)' : 'transparent',
                    color: tab === id ? 'var(--accent)' : 'var(--ink-2)',
                    border: `1px solid ${tab === id ? 'var(--accent-light)' : 'transparent'}`,
                  }}>
                  <Icon className="size-4 shrink-0" /> {label}
                </button>
              ))}
            </motion.div>

            {tab === 'bills' && (
              <>

                <motion.button onClick={() => setShowCreate(true)}
                  className="flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
                  style={{ background: 'var(--accent)', color: 'var(--accent-dark)' }}
                  {...fadeUp} transition={{ delay: 0.12 }}>
                  <Plus className="size-5" /> New Bill
                </motion.button>
              </>
            )}

            <p className="text-center text-xs" style={{ color: 'var(--subtle)' }}>
              Settled onchain · {IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'}
            </p>
          </aside>

          {/* ── Main content ────────────────────────────────────── */}
          <main className="flex-1 min-w-0 flex flex-col gap-6">
            {/* Mobile tab bar */}
            <div className="md:hidden flex rounded-2xl overflow-hidden p-1 gap-1"
              style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
              {([
                { id: 'bills',   label: 'Bills',   icon: LayoutGrid },
                { id: 'send',    label: 'Send',    icon: Send       },
                { id: 'receive', label: 'Receive', icon: QrCode     },
                { id: 'account', label: 'Account', icon: UserCircle },
              ] as const).map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setTab(id)}
                  className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-semibold transition-all rounded-xl"
                  style={{
                    background: tab === id ? 'var(--accent)' : 'transparent',
                    color: tab === id ? '#fff' : 'var(--subtle)',
                  }}>
                  <Icon className="size-4" />
                  <span className="text-[10px] font-semibold">{label}</span>
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {tab === 'send' && (
                <motion.div key="send"
                  initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.18 }}>
                  <SendPage unifiedAddress={address} seedSession={seedSession} />
                </motion.div>
              )}
              {tab === 'receive' && (
                <motion.div key="receive"
                  initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.18 }}>
                  <ReceiveView unifiedAddress={address} />
                </motion.div>
              )}
              {tab === 'bills' && (
                <motion.div key="bills"
                  initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }}
                  transition={{ duration: 0.18 }}
                  className="flex flex-col gap-6">
                  {/* Mobile create CTA */}
                  <div className="md:hidden">
                    <button onClick={() => setShowCreate(true)}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold"
                      style={{ background: 'var(--accent)', color: 'var(--accent-dark)' }}>
                      <Plus className="size-4" /> New Bill
                    </button>
                  </div>

                  {/* Bills header */}
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="display text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Bills</h2>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Onchain shared expenses on Arc</p>
                      </div>
                      <div className="flex size-11 items-center justify-center rounded-2xl"
                        style={{ background: 'var(--accent)', boxShadow: '0 4px 16px rgba(79,110,247,0.3)' }}>
                        <Receipt className="size-5" style={{ color: '#fff' }} />
                      </div>
                    </div>
                    {/* Filter chips */}
                    {address && (
                      <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
                        {([
                          { id: 'all',     label: 'All',     icon: List            },
                          { id: 'created', label: 'Created', icon: PenLine         },
                          { id: 'owe',     label: 'I Owe',   icon: ArrowDownCircle },
                          { id: 'done',    label: 'Done',    icon: CircleCheckBig  },
                        ] as const).map(({ id: f, label: fl, icon: FilterIcon }) => (
                          <button key={f} onClick={() => setFilter(f)}
                            className="flex items-center gap-1.5 shrink-0 rounded-2xl px-4 py-2 text-xs font-semibold transition-all hover:scale-105"
                            style={{
                              background: filter === f ? 'var(--accent)' : 'var(--surface)',
                              color: filter === f ? '#fff' : 'var(--ink-2)',
                              border: filter === f ? 'none' : '1px solid var(--border)',
                              boxShadow: filter === f ? '0 2px 12px rgba(79,110,247,0.25)' : 'none',
                            }}>
                            <FilterIcon className="size-3.5" />
                            {fl}
                            {f === 'all' && count > 0 && (
                              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                                style={{ background: filter === f ? 'rgba(255,255,255,0.25)' : 'var(--surface-muted)', color: filter === f ? '#fff' : 'var(--muted)' }}>
                                {count}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Bills grid or empty/gate state */}
                  {!address ? (
                    <motion.div className="flex flex-col items-center justify-center py-24 gap-5" style={glass.card} {...fadeUp}>
                      <div className="flex size-16 items-center justify-center rounded-3xl"
                        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                        <Wallet className="size-7" style={{ color: 'var(--subtle)' }} />
                      </div>
                      <div className="text-center">
                        <p className="display font-semibold text-lg" style={{ color: 'var(--ink)' }}>Connect your wallet</p>
                        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Connect to see bills you are part of.</p>
                      </div>
                      <ConnectKitButton />
                    </motion.div>
                  ) : count === 0 ? (
                    <motion.div className="flex flex-col items-center justify-center py-20 gap-5 rounded-3xl"
                      style={{ background: 'linear-gradient(135deg,rgba(79,110,247,0.06),rgba(79,110,247,0.01))', border: '1px dashed rgba(79,110,247,0.2)' }} {...fadeUp}>
                      <div className="text-6xl">🧾</div>
                      <div className="text-center px-6">
                        <p className="display font-bold text-xl mb-1" style={{ color: 'var(--ink)' }}>No bills yet</p>
                        <p className="text-sm" style={{ color: 'var(--muted)' }}>Split your first shared expense with roommates, friends, or family.</p>
                      </div>
                      <div className="flex flex-col items-center gap-3 w-full px-8">
                        <button onClick={() => setShowCreate(true)}
                          className="w-full flex items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
                          style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 4px 16px rgba(79,110,247,0.3)' }}>
                          <Plus className="size-4" /> Create your first bill
                        </button>
                        <p className="text-xs" style={{ color: 'var(--subtle)' }}>Rent · Utilities · Netflix · Groceries · and more</p>
                      </div>
                    </motion.div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {ids.map((id, i) => (
                        <motion.div key={id.toString()}
                          ref={deepLinkBillId === id ? deepLinkRef : undefined}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.22, delay: i * 0.04 }}
                          style={deepLinkBillId === id ? { outline: '2px solid var(--accent)', outlineOffset: 3, borderRadius: 14 } : {}}>
                          <BillLoader id={id} refetch={refetch} filter={filter} address={address} />
                        </motion.div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
              {tab === 'account' && (
                <motion.div key="account"
                  initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.18 }}>
                  <AccountPage
                    address={address ?? '0x'}
                    seedSession={seedSession}
                    socialSession={socialSession}
                    wagmiAddress={wagmiAddress}
                    onSignOut={() => {
                      setSeedSession(null)
                      setSocialSession(null)
                      localStorage.removeItem('fairtab_session_v2')
                      setCircleAddress(null)
                      clearCredential()
                      clearSeedWallet()
                      setTab('bills')
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </main>
        </div>
      </div>

      {/* ── Payout ready toast (fires once on wallet connect) ──── */}
      <PayoutReadyToaster count={count} address={address} />

      {/* ── Create Bill Page (full-screen) ───────────────────────── */}
      <AnimatePresence>
        {showCreate && (
          <CreateBillPage
            onClose={() => setShowCreate(false)}
            onCreated={() => { setShowCreate(false); void refetch() }}
            seedSession={seedSession}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
