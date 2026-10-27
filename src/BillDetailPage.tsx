/**
 * BillDetailPage — full-screen slide-in detail view for a single bill.
 * Opened when the user taps a bill row in the list.
 */
import { useState, useCallback, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, ExternalLink, Clock, CheckCircle2, XCircle,
  AlertTriangle, Loader2, RefreshCw, Users, Wallet,
  Share2, UserPlus, Check, X, Bell, Copy,
  TrendingUp,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { toast } from 'sonner'
import { erc20Abi, parseUnits } from 'viem'
import {
  useAccount, useReadContract, useWriteContract,
  useWaitForTransactionReceipt, useSwitchChain,
} from 'wagmi'
import { arcChain, IS_MAINNET } from '@/config'
import { getUsdc, buildTxExplorerUrl } from '@/onchain-facts'
import { formatUsdc, usdcDecimalsFor } from '@/onchain-money'
import artifact from '../contracts/out/HouseholdBillSplitter.sol/HouseholdBillSplitter.json'

const CHAIN_ID = arcChain.id
const TESTNET_CONTRACT = '0x9c87ba9e35c1b986ab97174e1192badf44fb03a5' as const
const MAINNET_CONTRACT = '0xcd1dcf79d9bbf3246a21da10aecabde66fb47d08' as const
const CONTRACT_ADDRESS = (IS_MAINNET ? MAINNET_CONTRACT : TESTNET_CONTRACT) as `0x${string}`
const CONTRACT_ABI = artifact.abi
const USDC_ADDRESS = getUsdc(CHAIN_ID)!.address as `0x${string}`

type BillStatus = 0 | 1 | 2
type ParticipantStatus = 0 | 1 | 2

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

const fmt = (raw: bigint) => formatUsdc(raw)
const fmtAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const STATUS_LABEL: Record<BillStatus, string> = { 0: 'Active', 1: 'Settled', 2: 'Cancelled' }

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

// ── Participant detail row ──────────────────────────────────────────────────
function ParticipantDetailRow({ billId, share, isMe, isCreator, billActive, now, onExpire, expirePending, isExpiring }: {
  billId: bigint
  share: Share
  isMe: boolean
  isCreator: boolean
  billActive: boolean
  now: number
  onExpire: (p: `0x${string}`) => void
  expirePending: boolean
  isExpiring: boolean
}) {
  const { data: statusRaw } = useReadContract({
    address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'getParticipantStatus',
    args: [billId, share.participant], chainId: CHAIN_ID,
  })
  const { data: tsRaw } = useReadContract({
    address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'inviteTimestamp',
    args: [billId, share.participant], chainId: CHAIN_ID,
  })

  const status = statusRaw as ParticipantStatus | undefined
  const inviteTs = tsRaw as bigint | undefined
  const INVITE_EXPIRY_S = 24 * 60 * 60
  const secondsLeft = inviteTs != null ? Math.max(0, Number(inviteTs) + INVITE_EXPIRY_S - now) : null
  const isExpired = secondsLeft !== null && secondsLeft === 0
  const isPending = status === 0
  const isRejected = status === 2
  const fullyPaid = share.contributed >= share.amount && share.amount > 0n
  const pct = share.amount > 0n ? Number((share.contributed * 100n) / share.amount) : 0

  function fmtCountdown(s: number) {
    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60)
    return h > 0 ? `${h}h ${m}m left` : `${m}m left`
  }

  // Icon
  const icon = isRejected
    ? <XCircle className="size-4 shrink-0" style={{ color: 'var(--danger)' }} />
    : isPending
      ? <Clock className="size-4 shrink-0" style={{ color: 'var(--warning,#f59e0b)' }} />
      : fullyPaid
        ? <CheckCircle2 className="size-4 shrink-0" style={{ color: 'var(--success)' }} />
        : <TrendingUp className="size-4 shrink-0" style={{ color: 'var(--accent)' }} />

  const barColor = isRejected ? 'var(--danger)'
    : isPending ? 'var(--warning,#f59e0b)'
    : fullyPaid ? 'var(--success)'
    : 'var(--accent)'

  const badgeBg = isRejected ? 'var(--danger-bg)'
    : isPending && isExpired ? 'var(--danger-bg)'
    : isPending ? 'rgba(245,158,11,0.12)'
    : fullyPaid ? 'var(--success-bg)'
    : 'var(--surface-muted)'
  const badgeColor = isRejected ? 'var(--danger)'
    : isPending && isExpired ? 'var(--danger)'
    : isPending ? 'var(--warning,#f59e0b)'
    : fullyPaid ? 'var(--success)'
    : 'var(--ink-2)'
  const badgeText = isRejected ? 'Declined'
    : isExpired ? 'Expired'
    : isPending ? 'Pending'
    : fullyPaid ? 'Paid'
    : `${pct}%`

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
      {/* Top row */}
      <div className="flex items-center gap-3 px-3.5 pt-3 pb-2.5">
        {icon}
        <span className="mono text-sm flex-1 min-w-0 truncate font-medium"
          style={{ color: isMe ? 'var(--accent)' : 'var(--ink-2)' }}>
          {isMe ? 'You' : fmtAddr(share.participant)}
        </span>
        {/* Countdown or amount */}
        {isPending && secondsLeft !== null && secondsLeft > 0 && (
          <span className="text-[10px] tabular-nums" style={{ color: 'var(--muted)' }}>{fmtCountdown(secondsLeft)}</span>
        )}
        {billActive && isCreator && isPending && isExpired && (
          <button onClick={() => onExpire(share.participant)} disabled={expirePending}
            className="text-xs font-bold px-2.5 py-1 rounded-xl disabled:opacity-40 transition-all active:scale-95"
            style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
            {isExpiring && expirePending ? <Loader2 className="size-3 animate-spin inline" /> : 'Remove'}
          </button>
        )}
        {!isPending && !isRejected && (
          <span className="mono text-xs tabular-nums font-semibold"
            style={{ color: fullyPaid ? 'var(--success)' : 'var(--ink-2)' }}>
            {fmt(share.contributed)}<span style={{ color: 'var(--subtle)' }}>/{fmt(share.amount)}</span>
          </span>
        )}
        {/* Status badge */}
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
          style={{ background: badgeBg, color: badgeColor }}>
          {badgeText}
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-1 w-full" style={{ background: 'var(--border)' }}>
        <div className="h-full transition-all duration-700"
          style={{
            width: isPending || isRejected ? '100%' : `${pct}%`,
            background: barColor,
            opacity: isPending || isRejected ? 0.25 : 1,
          }} />
      </div>
    </div>
  )
}

// ── Pay panel ──────────────────────────────────────────────────────────────
function PayPanel({ bill, onPaid }: { bill: BillSummary; onPaid: () => void }) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const wrongChain = chainId !== undefined && chainId !== CHAIN_ID
  const myShare = bill.shares.find(s => s.participant.toLowerCase() === address?.toLowerCase())
  const myRemaining = myShare ? myShare.amount - myShare.contributed : 0n
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

  if (approveSuccess && !approveDone) { setApproveDone(true); void refetchAllowance() }
  if (paySuccess) { onPaid(); toast.success('Payment confirmed'); setPayInput(''); setApproveDone(false); resetPay() }

  if (!myShare || myRemaining <= 0n) return null

  const myContribPct = myShare.amount > 0n ? Number((myShare.contributed * 10000n) / myShare.amount) / 100 : 0

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--accent-border)', boxShadow: '0 4px 20px rgba(37,99,235,0.08)' }}>
      {/* Header strip */}
      <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--accent-light)' }}>
        <div className="flex size-7 items-center justify-center rounded-lg" style={{ background: 'var(--accent)' }}>
          <Wallet className="size-3.5" style={{ color: '#fff' }} />
        </div>
        <span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>Pay your share</span>
        <span className="ml-auto mono text-xs font-semibold" style={{ color: 'var(--muted)' }}>{fmt(myRemaining)} left</span>
      </div>

      <div className="p-4 flex flex-col gap-3">
        {/* Progress */}
        <div>
          <div className="flex justify-between text-xs mb-1.5" style={{ color: 'var(--muted)' }}>
            <span>{fmt(myShare.contributed)} paid</span>
            <span>{myContribPct.toFixed(0)}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${myContribPct}%`, background: myContribPct >= 100 ? 'var(--success)' : 'var(--accent)' }} />
          </div>
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
          <TokenUSDC variant="branded" size={18} />
          <input inputMode="decimal" value={payInput}
            onChange={e => { setPayInput(e.target.value.replace(/[^0-9.]/g, '')); setApproveDone(false) }}
            placeholder="0.00"
            className="flex-1 bg-transparent text-lg font-bold tabular-nums outline-none placeholder:opacity-20"
            style={{ color: 'var(--ink)' }} />
          <button onClick={() => { setPayInput(fmt(myRemaining)); setApproveDone(false) }}
            className="rounded-lg px-2.5 py-1 text-xs font-bold transition-all active:scale-95"
            style={{ background: 'var(--accent)', color: '#fff' }}>Max</button>
        </div>

        {needsApprove ? (
          <button onClick={() => { if (ensureChain()) writeApprove({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [CONTRACT_ADDRESS, payRaw] }) }}
            disabled={!payValid || approvePending || approveConfirming}
            className="w-full rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40 transition-all active:scale-[0.98]"
            style={{ background: 'var(--accent)', color: '#fff' }}>
            {approvePending || approveConfirming
              ? <><Loader2 className="size-4 animate-spin" />{approvePending ? 'Confirm in wallet…' : 'Approving…'}</>
              : 'Allow USDC'}
          </button>
        ) : (
          <button onClick={() => { if (ensureChain()) writePay({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'pay', args: [bill.id, payRaw] }) }}
            disabled={!payValid || payPending || payConfirming}
            className="w-full rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40 transition-all active:scale-[0.98]"
            style={{ background: 'var(--accent)', color: '#fff', boxShadow: payValid ? '0 4px 16px rgba(37,99,235,0.3)' : 'none' }}>
            {payPending || payConfirming
              ? <><Loader2 className="size-4 animate-spin" />{payPending ? 'Confirm in wallet…' : 'Confirming…'}</>
              : payInput ? `Pay ${payInput} USDC` : 'Enter amount'}
          </button>
        )}

        {payHash && (
          <a href={buildTxExplorerUrl(CHAIN_ID, payHash)} target="_blank" rel="noreferrer"
            className="flex items-center justify-center gap-1 text-xs" style={{ color: 'var(--accent)' }}>
            View on ArcScan <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </div>
  )
}

// ── Main BillDetailPage ────────────────────────────────────────────────────
export function BillDetailPage({ bill: initialBill, myParticipantStatus, onBack, onRefetch }: {
  bill: BillSummary
  myParticipantStatus?: ParticipantStatus
  onBack: () => void
  onRefetch: () => void
}) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const wrongChain = chainId !== undefined && chainId !== CHAIN_ID
  const now = useNow()
  const bill = initialBill

  const isCreator = bill.creator.toLowerCase() === address?.toLowerCase()
  const isPayee = bill.payee.toLowerCase() === address?.toLowerCase()
  const myShare = bill.shares.find(s => s.participant.toLowerCase() === address?.toLowerCase())
  const myFullyPaid = myShare ? myShare.contributed >= myShare.amount : false
  const progressPct = bill.totalAmount > 0n
    ? Number((bill.amountPaid * 100n) / bill.totalAmount) : 0
  const isLate = bill.deadline > 0n && now > Number(bill.deadline) && bill.status === 0

  const ensureChain = useCallback(() => { if (wrongChain) switchChain({ chainId: CHAIN_ID }); return !wrongChain }, [wrongChain, switchChain])

  // Accept / Decline — track locally so the banner hides immediately on confirmation
  const [acceptedLocally, setAcceptedLocally] = useState(false)
  const [declinedLocally, setDeclinedLocally] = useState(false)
  const { writeContract: writeAccept, data: acceptHash, isPending: acceptPending } = useWriteContract()
  const { isLoading: acceptConfirming, isSuccess: acceptSuccess } = useWaitForTransactionReceipt({ hash: acceptHash })
  const { writeContract: writeDecline, data: declineHash, isPending: declinePending } = useWriteContract()
  const { isLoading: declineConfirming, isSuccess: declineSuccess } = useWaitForTransactionReceipt({ hash: declineHash })

  if (acceptSuccess && !acceptedLocally) { setAcceptedLocally(true); onRefetch(); toast.success('Bill accepted!') }
  if (declineSuccess && !declinedLocally) { setDeclinedLocally(true); onRefetch(); onBack(); toast.success('Bill declined') }

  // Expire invite
  const { writeContract: writeExpire, data: expireHash, isPending: expirePending } = useWriteContract()
  const { isLoading: expireConfirming, isSuccess: expireSuccess } = useWaitForTransactionReceipt({ hash: expireHash })
  const [expiringParticipant, setExpiringParticipant] = useState<`0x${string}` | null>(null)
  const handleExpireInvite = useCallback((participant: `0x${string}`) => {
    if (!ensureChain()) return
    setExpiringParticipant(participant)
    writeExpire({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'expireInvite', args: [bill.id, participant] })
  }, [ensureChain, bill.id, writeExpire])
  if (expireSuccess) { onRefetch(); setExpiringParticipant(null); toast.success('Expired invite removed') }

  // Vote cancel
  const { writeContract: writeVote, data: voteHash, isPending: votePending } = useWriteContract()
  const { isLoading: voteConfirming, isSuccess: voteSuccess } = useWaitForTransactionReceipt({ hash: voteHash })
  if (voteSuccess) { onRefetch(); toast.success('Cancel vote submitted') }

  // Claim payout
  const { data: payoutClaimableRaw } = useReadContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'payoutClaimable', args: [bill.id], chainId: CHAIN_ID })
  const payoutClaimableAmt = (payoutClaimableRaw as bigint | undefined) ?? 0n
  const { writeContract: writeClaim, data: claimHash, isPending: claimPending } = useWriteContract()
  const { isLoading: claimConfirming, isSuccess: claimSuccess } = useWaitForTransactionReceipt({ hash: claimHash })
  if (claimSuccess) { onRefetch(); toast.success('Payout claimed!') }

  // Expired refund
  const { writeContract: writeExpiredRefund, data: expiredHash, isPending: expiredPending } = useWriteContract()
  const { isLoading: expiredConfirming, isSuccess: expiredSuccess } = useWaitForTransactionReceipt({ hash: expiredHash })
  if (expiredSuccess) { onRefetch(); toast.success('Refund claimed!') }

  // Add participant
  const [showAddParticipant, setShowAddParticipant] = useState(false)
  const [newParticipantAddr, setNewParticipantAddr] = useState('')
  const [newParticipantAmt, setNewParticipantAmt] = useState('')
  const { writeContract: writeAddParticipant, data: addPartHash, isPending: addPartPending } = useWriteContract()
  const { isLoading: addPartConfirming, isSuccess: addPartSuccess } = useWaitForTransactionReceipt({ hash: addPartHash })
  const handleAddParticipant = useCallback(() => {
    if (!ensureChain()) return
    const amt = parseFloat(newParticipantAmt)
    if (!newParticipantAddr.startsWith('0x') || isNaN(amt) || amt <= 0) { toast.error('Enter a valid address and amount'); return }
    const amtRaw = parseUnits(amt.toFixed(usdcDecimalsFor(CHAIN_ID)), usdcDecimalsFor(CHAIN_ID))
    writeAddParticipant({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'addParticipant', args: [bill.id, newParticipantAddr as `0x${string}`, amtRaw] })
  }, [ensureChain, bill.id, newParticipantAddr, newParticipantAmt, writeAddParticipant])
  if (addPartSuccess) { onRefetch(); setShowAddParticipant(false); setNewParticipantAddr(''); setNewParticipantAmt(''); toast.success('Participant invited') }

  // Share / copy link — canonical URL is /bill/<id>?contract=<contractAddress>
  const [copied, setCopied] = useState(false)
  const shareUrl = `${window.location.origin}/bill/${bill.id.toString()}?contract=${CONTRACT_ADDRESS}`
  const handleShare = useCallback(() => {
    void navigator.clipboard.writeText(shareUrl)
    setCopied(true); toast.success('Bill link copied!'); setTimeout(() => setCopied(false), 2000)
  }, [shareUrl])

  // Hero gradient per status
  const heroGradient = bill.status === 2
    ? 'linear-gradient(135deg, #7f1d1d 0%, #991b1b 60%, #b91c1c 100%)'
    : bill.status === 1
      ? 'linear-gradient(135deg, #064e3b 0%, #065f46 60%, #047857 100%)'
      : isLate
        ? 'linear-gradient(135deg, #78350f 0%, #92400e 60%, #b45309 100%)'
        : 'linear-gradient(135deg, #1e3a8a 0%, #4338ca 60%, #7c3aed 100%)'

  const ringStroke = bill.status === 2 ? '#f87171' : bill.status === 1 ? '#34d399' : progressPct === 100 ? '#34d399' : '#60a5fa'

  return (
    <motion.div
      className="fixed inset-0 z-40 flex flex-col"
      style={{ background: 'var(--bg)' }}
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 400, damping: 40 }}>

      {/* ── Sticky header ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3"
        style={{ background: 'var(--popover)', borderBottom: '1px solid var(--border)', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
        <button onClick={onBack}
          className="flex items-center justify-center rounded-xl transition-all active:scale-90"
          style={{ width: 38, height: 38, background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
          <ArrowLeft className="size-4" style={{ color: 'var(--ink-2)' }} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-base truncate" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
            {bill.label || `Bill #${bill.id.toString()}`}
          </h1>
          <p className="mono text-[10px] truncate" style={{ color: 'var(--muted)' }}>
            {IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'} · Bill #{bill.id.toString()} · {CONTRACT_ADDRESS.slice(0,6)}…{CONTRACT_ADDRESS.slice(-4)}
          </p>
        </div>
        <button onClick={handleShare}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95"
          style={{
            background: copied ? 'var(--success-bg)' : 'var(--surface-muted)',
            color: copied ? 'var(--success)' : 'var(--ink-2)',
            border: '1px solid var(--border)',
          }}>
          {copied ? <CheckCircle2 className="size-3.5" /> : <Share2 className="size-3.5" />}
          {copied ? 'Copied' : 'Share'}
        </button>
      </header>

      {/* ── Scrollable body ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-lg flex flex-col">

          {/* ── Hero card (gradient, full-width, no padding) ── */}
          <div className="relative overflow-hidden" style={{ background: heroGradient, minHeight: 200 }}>
            {/* Decorative circles */}
            <div className="absolute -top-10 -right-10 size-48 rounded-full"
              style={{ background: 'rgba(255,255,255,0.07)' }} />
            <div className="absolute -bottom-8 -left-8 size-36 rounded-full"
              style={{ background: 'rgba(255,255,255,0.05)' }} />

            <div className="relative px-5 pt-6 pb-7 flex flex-col gap-4">
              {/* Status badge row */}
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full"
                  style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}>
                  {STATUS_LABEL[bill.status]}
                  {bill.recurring && <RefreshCw className="size-3 opacity-80" />}
                  {isLate && <AlertTriangle className="size-3 opacity-80" />}
                </span>
                {/* Large progress ring */}
                <div className="relative flex size-[72px] items-center justify-center">
                  <svg className="absolute inset-0 size-[72px] -rotate-90" viewBox="0 0 72 72" fill="none">
                    <circle cx="36" cy="36" r="28" stroke="rgba(255,255,255,0.2)" strokeWidth="5" />
                    <circle cx="36" cy="36" r="28"
                      stroke={ringStroke}
                      strokeWidth="5" strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 28}`}
                      strokeDashoffset={`${2 * Math.PI * 28 * (1 - progressPct / 100)}`}
                      style={{ transition: 'stroke-dashoffset 0.7s ease' }} />
                  </svg>
                  <span className="text-sm font-bold tabular-nums" style={{ color: '#fff' }}>{progressPct}%</span>
                </div>
              </div>

              {/* Amount */}
              <div>
                <div className="flex items-end gap-2.5 mb-1">
                  <span className="text-5xl font-bold tabular-nums" style={{ color: '#fff', letterSpacing: '-0.04em', lineHeight: 1 }}>
                    {fmt(bill.totalAmount)}
                  </span>
                  <span className="mb-1 text-base font-semibold" style={{ color: 'rgba(255,255,255,0.55)' }}>USDC</span>
                </div>
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  to {isPayee ? 'You' : fmtAddr(bill.payee)}
                </p>
              </div>

              {/* Progress bar */}
              <div>
                <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: 'rgba(255,255,255,0.15)' }}>
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${progressPct}%`, background: ringStroke }} />
                </div>
                <div className="flex justify-between text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  <span>{fmt(bill.amountPaid)} paid</span>
                  <span>{fmt(bill.totalAmount - bill.amountPaid)} remaining</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Content sections ─────────────────────────────────────── */}
          <div className="px-4 py-5 flex flex-col gap-4">

            {/* ── Meta grid ── */}
            <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow)' }}>
              <div className="grid grid-cols-2">
                {/* Creator */}
                <div className="px-4 py-3.5" style={{ borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--muted)' }}>Creator</p>
                  <div className="flex items-center gap-1.5">
                    <span className="mono text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
                      {isCreator ? 'You' : fmtAddr(bill.creator)}
                    </span>
                    <button onClick={() => { void navigator.clipboard.writeText(bill.creator); toast.success('Copied') }}
                      className="rounded p-0.5 transition-all active:scale-90" style={{ color: 'var(--subtle)' }}>
                      <Copy className="size-3" />
                    </button>
                  </div>
                </div>
                {/* Payee */}
                <div className="px-4 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--muted)' }}>Payee</p>
                  <div className="flex items-center gap-1.5">
                    <span className="mono text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
                      {isPayee ? 'You' : fmtAddr(bill.payee)}
                    </span>
                    <button onClick={() => { void navigator.clipboard.writeText(bill.payee); toast.success('Copied') }}
                      className="rounded p-0.5 transition-all active:scale-90" style={{ color: 'var(--subtle)' }}>
                      <Copy className="size-3" />
                    </button>
                  </div>
                </div>
                {/* Due date */}
                {bill.deadline > 0n && (
                  <div className="px-4 py-3.5" style={{ borderRight: '1px solid var(--border)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--muted)' }}>Due Date</p>
                    <p className="text-xs font-semibold" style={{ color: isLate ? 'var(--danger)' : 'var(--ink-2)' }}>
                      {new Date(Number(bill.deadline) * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      {isLate && <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>Late</span>}
                    </p>
                  </div>
                )}
                {/* Cancel threshold */}
                <div className="px-4 py-3.5" style={{ borderRight: bill.deadline > 0n ? 'none' : '1px solid var(--border)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--muted)' }}>Cancel Votes</p>
                  <p className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
                    {bill.cancelVotes}/{bill.cancelThreshold}
                  </p>
                </div>
                {/* Recurring */}
                {bill.recurring && (
                  <div className="px-4 py-3.5 col-span-2" style={{ borderTop: '1px solid var(--border)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--muted)' }}>Recurring</p>
                    <p className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--ink-2)' }}>
                      <RefreshCw className="size-3" /> Every {Math.round(Number(bill.recurInterval) / 86400)} days
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ── Invite banner ── */}
            {myParticipantStatus === 0 && bill.status === 0 && !isCreator && !acceptedLocally && !declinedLocally && (
              <AnimatePresence>
                <motion.div
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl overflow-hidden"
                  style={{ border: '1px solid rgba(79,110,247,0.3)', background: 'linear-gradient(135deg,rgba(79,110,247,0.10),rgba(79,110,247,0.05))' }}>
                  <div className="flex items-start gap-3 p-4 pb-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl"
                      style={{ background: 'linear-gradient(135deg,var(--accent),#7c3aed)', boxShadow: '0 4px 12px rgba(79,110,247,0.35)' }}>
                      <Bell className="size-4.5" style={{ color: '#fff' }} />
                    </div>
                    <div>
                      <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>You've been invited</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Accept to join and pay your share, or decline to opt out.</p>
                    </div>
                  </div>
                  <div className="flex gap-2 px-4 pb-4">
                    <button onClick={() => { if (ensureChain()) writeDecline({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'rejectInvite', args: [bill.id] }) }}
                      disabled={declinePending || declineConfirming}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40 transition-all active:scale-[0.97]"
                      style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid rgba(220,38,38,0.2)' }}>
                      {declinePending || declineConfirming ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />} Decline
                    </button>
                    <button onClick={() => { if (ensureChain()) writeAccept({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'acceptInvite', args: [bill.id] }) }}
                      disabled={acceptPending || acceptConfirming}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold disabled:opacity-40 transition-all active:scale-[0.97]"
                      style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 4px 16px rgba(37,99,235,0.35)' }}>
                      {acceptPending || acceptConfirming ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Accept
                    </button>
                  </div>
                </motion.div>
              </AnimatePresence>
            )}

            {/* ── Pay panel — show when accepted (either from props or just now) ── */}
            {address && bill.status === 0 && myShare && !myFullyPaid && !isLate && (myParticipantStatus === 1 || acceptedLocally) && (
              <PayPanel bill={bill} onPaid={() => onRefetch()} />
            )}

            {/* ── Fully paid banner ── */}
            {address && bill.status === 0 && myShare && myFullyPaid && (
              <div className="flex items-center gap-3 rounded-2xl px-4 py-3.5"
                style={{ background: 'var(--success-bg)', border: '1px solid rgba(5,150,105,0.2)' }}>
                <div className="flex size-8 items-center justify-center rounded-xl" style={{ background: 'var(--success)' }}>
                  <CheckCircle2 className="size-4" style={{ color: '#fff' }} />
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: 'var(--success)' }}>Your share is fully paid</p>
                  <p className="text-xs" style={{ color: 'var(--success)', opacity: 0.75 }}>Great job staying on top of it.</p>
                </div>
              </div>
            )}

            {/* ── Payee received / claim ── */}
            {isPayee && bill.status === 1 && payoutClaimableAmt > 0n && (
              <button onClick={() => { if (ensureChain()) writeClaim({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'claimPayout', args: [bill.id] }) }}
                disabled={claimPending || claimConfirming || claimSuccess}
                className="w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold disabled:opacity-40 transition-all active:scale-[0.98]"
                style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 4px 16px rgba(37,99,235,0.3)' }}>
                {claimPending || claimConfirming
                  ? <><Loader2 className="size-4 animate-spin" />{claimPending ? 'Confirm in wallet…' : 'Confirming…'}</>
                  : `Claim ${fmt(payoutClaimableAmt)} USDC`}
              </button>
            )}
            {isPayee && bill.status === 1 && payoutClaimableAmt === 0n && (
              <div className="flex items-center gap-3 rounded-2xl px-4 py-3.5"
                style={{ background: 'var(--success-bg)', border: '1px solid rgba(5,150,105,0.2)' }}>
                <CheckCircle2 className="size-5 shrink-0" style={{ color: 'var(--success)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--success)' }}>Payment received automatically</span>
              </div>
            )}

            {/* ── Expired refund ── */}
            {address && bill.status === 0 && bill.deadline > 0n && now > Number(bill.deadline) && myShare && myShare.contributed > 0n && (
              <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}>
                <div className="flex items-start gap-3 p-4 pb-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--warning)' }}>
                    <AlertTriangle className="size-4" style={{ color: '#fff' }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold" style={{ color: 'var(--warning)' }}>
                      {expiredSuccess ? 'Refund initiated' : 'This bill has expired'}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--warning)', opacity: 0.8 }}>
                      {expiredSuccess
                        ? `${fmt(myShare.contributed)} USDC is on its way back.`
                        : `Your ${fmt(myShare.contributed)} USDC contribution can be returned.`}
                    </p>
                  </div>
                </div>
                {!expiredSuccess && (
                  <div className="px-4 pb-4">
                    <button onClick={() => { if (ensureChain()) writeExpiredRefund({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'claimExpiredRefund', args: [bill.id] }) }}
                      disabled={expiredPending || expiredConfirming}
                      className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                      style={{ background: 'var(--warning)', color: '#fff' }}>
                      {expiredPending || expiredConfirming
                        ? <><Loader2 className="size-3.5 animate-spin" /> Claiming…</>
                        : `Get ${fmt(myShare.contributed)} USDC back`}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Participants section ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Users className="size-4" style={{ color: 'var(--muted)' }} />
                  <span className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
                    Participants <span className="font-normal" style={{ color: 'var(--muted)' }}>({bill.shares.length})</span>
                  </span>
                </div>
                {bill.status === 0 && isCreator && (
                  <button onClick={() => setShowAddParticipant(v => !v)}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all active:scale-95"
                    style={{
                      background: showAddParticipant ? 'var(--danger-bg)' : 'var(--accent-light)',
                      color: showAddParticipant ? 'var(--danger)' : 'var(--accent)',
                    }}>
                    {showAddParticipant ? <X className="size-3" /> : <UserPlus className="size-3" />}
                    {showAddParticipant ? 'Cancel' : 'Add'}
                  </button>
                )}
              </div>

              {/* Add participant form */}
              <AnimatePresence>
                {showAddParticipant && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                    className="mb-3 rounded-2xl overflow-hidden"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div className="p-4 flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <UserPlus className="size-3.5" style={{ color: 'var(--accent)' }} />
                        <p className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>Invite a participant</p>
                      </div>
                      <input value={newParticipantAddr} onChange={e => setNewParticipantAddr(e.target.value.trim())}
                        placeholder="Wallet address (0x…)"
                        className="mono w-full rounded-xl px-3 py-2.5 text-xs outline-none"
                        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
                      <div className="flex gap-2">
                        <input inputMode="decimal" value={newParticipantAmt}
                          onChange={e => setNewParticipantAmt(e.target.value.replace(/[^0-9.]/g, ''))}
                          placeholder="Share amount (USDC)"
                          className="flex-1 rounded-xl px-3 py-2.5 text-xs outline-none"
                          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
                        <button onClick={handleAddParticipant} disabled={addPartPending || addPartConfirming}
                          className="rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-40 flex items-center gap-1.5 transition-all active:scale-95"
                          style={{ background: 'var(--accent)', color: '#fff' }}>
                          {addPartPending || addPartConfirming ? <Loader2 className="size-3 animate-spin" /> : null}
                          Invite
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Participant rows — single container */}
              <div className="rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--shadow)' }}>
                {bill.shares.map((s, i) => (
                  <div key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                    <ParticipantDetailRow
                      billId={bill.id} share={s}
                      isMe={s.participant.toLowerCase() === address?.toLowerCase()}
                      isCreator={isCreator} billActive={bill.status === 0}
                      now={now} onExpire={handleExpireInvite}
                      expirePending={expirePending || expireConfirming}
                      isExpiring={expiringParticipant === s.participant} />
                  </div>
                ))}
              </div>
            </div>

            {/* ── Cancel vote ── */}
            {bill.status === 0 && (isCreator || myShare) && (
              <div className="flex items-center justify-between rounded-2xl px-4 py-3.5"
                style={{ background: 'var(--surface)', boxShadow: 'var(--shadow)' }}>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>Request cancellation</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
                    {bill.cancelVotes > 0
                      ? `${bill.cancelVotes} of ${bill.cancelThreshold} approvals`
                      : `Needs ${bill.cancelThreshold} approval${bill.cancelThreshold !== 1 ? 's' : ''}`}
                  </p>
                </div>
                <button onClick={() => { if (ensureChain()) writeVote({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'voteCancel', args: [bill.id] }) }}
                  disabled={votePending || voteConfirming || voteSuccess}
                  className="rounded-xl px-3.5 py-1.5 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 transition-all active:scale-95"
                  style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                  {votePending || voteConfirming ? <Loader2 className="size-3 animate-spin" /> : null}
                  {voteSuccess ? 'Voted' : 'Vote Cancel'}
                </button>
              </div>
            )}

            {/* ── ArcScan footer ── */}
            <a href={`https://${IS_MAINNET ? '' : 'testnet.'}explorer.arc.io/address/${CONTRACT_ADDRESS}`}
              target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-xs font-medium transition-all hover:opacity-80"
              style={{ background: 'var(--surface-muted)', color: 'var(--subtle)', border: '1px solid var(--border)' }}>
              <ExternalLink className="size-3.5" /> View contract on ArcScan
            </a>

            {/* bottom padding */}
            <div className="h-4" />
          </div>
        </div>
      </div>
    </motion.div>
  )
}
