import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { restoreCircleSession, clearCredential } from '@/CircleWalletAuth'
import { type SeedWalletSession, clearSeedWallet } from '@/SeedWalletAuth'
import { type AccountSession } from '@/AccountView'
import { WalletDropdown } from '@/WalletDropdown'
import { AccountPage, recordSignInTime } from '@/AccountPage'
import { SignInPage } from '@/SignInPage'
import { SendPage } from '@/SendPage'
import { CreateBillPage } from '@/CreateBillPage'
import { BillDetailPage } from '@/BillDetailPage'
import { motion, AnimatePresence } from 'framer-motion'
import {
  useAccount,
  useReadContract,
} from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { ConnectKitButton } from 'connectkit'
import { erc20Abi } from 'viem'
import { arcChain, IS_MAINNET } from '@/config'
import {
  Plus, AlertTriangle, Receipt,
  Users, Wallet, CheckCircle2, Copy,
  Send, QrCode, Link2, LayoutGrid,
  Sun, Moon, UserCircle,
  List, PenLine, ArrowDownCircle, CircleCheckBig,
  Bell, ChevronLeft, ChevronRight,
  ChevronRight as ChevronRightIcon,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { toast } from 'sonner'
import { getUsdc } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import artifact from '../contracts/out/HouseholdBillSplitter.sol/HouseholdBillSplitter.json'



// ─── Contract config ──────────────────────────────────────────────────────────
const CHAIN_ID = arcChain.id

// Testnet contract is deployed and live.
// Mainnet contract address must be filled in after you deploy from your own wallet:
//   forge create --rpc-url https://rpc.mainnet.arc.io --private-key $PRIVATE_KEY \
//     contracts/HouseholdBillSplitter.sol:HouseholdBillSplitter \
//     --constructor-args 0x3600000000000000000000000000000000000000
// Then replace REPLACE_WITH_MAINNET_CONTRACT_ADDRESS below with the deployed address.
const TESTNET_CONTRACT = '0x9c87ba9e35c1b986ab97174e1192badf44fb03a5' as const
const MAINNET_CONTRACT = '0xcd1dcf79d9bbf3246a21da10aecabde66fb47d08' as const
const CONTRACT_ADDRESS  = (IS_MAINNET ? MAINNET_CONTRACT : TESTNET_CONTRACT) as `0x${string}`
const CONTRACT_ABI = artifact.abi
const USDC_ADDRESS = getUsdc(CHAIN_ID)!.address as `0x${string}`

// ─── Types ────────────────────────────────────────────────────────────────────
type BillStatus = 0 | 1 | 2
type ParticipantStatus = 0 | 1 | 2 // 0=Pending, 1=Accepted, 2=Rejected

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
    borderRadius: '16px',
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
const STATUS_LABEL: Record<BillStatus, string> = { 0: 'Active', 1: 'Settled', 2: 'Cancelled' }

function statusStyle(s: BillStatus): React.CSSProperties {
  if (s === 1) return { background: 'var(--success-bg)', color: 'var(--success)' }
  if (s === 2) return { background: 'var(--danger-bg)', color: 'var(--danger)' }
  return { background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }
}

// ─── Background — clean solid canvas ─────────────────────────────────────────
function ArcBg() {
  return <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0, background: 'var(--bg)' }} />
}

// ─── Balance Card ─────────────────────────────────────────────────────────────
function BalanceCard({ address, onSend, onReceive }: {
  address?: `0x${string}`
  onSend: () => void
  onReceive: () => void
}) {
  const { data: balance, isLoading } = useReadContract({
    address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address }, chainId: CHAIN_ID,
  })

  if (!address) return null

  const balStr = balance !== undefined ? fmt(balance) : '—'

  return (
    <motion.div
      className="relative overflow-hidden rounded-3xl p-5"
      style={{
        background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 60%, #7c3aed 100%)',
        boxShadow: '0 8px 32px rgba(37,99,235,0.35)',
      }}
      {...fadeUp}>
      {/* Decorative circles */}
      <div className="absolute -top-6 -right-6 size-28 rounded-full opacity-20"
        style={{ background: 'rgba(255,255,255,0.3)' }} />
      <div className="absolute -bottom-4 -left-4 size-20 rounded-full opacity-10"
        style={{ background: 'rgba(255,255,255,0.4)' }} />

      {/* Network badge */}
      <div className="relative flex items-center justify-between mb-4">
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
          style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}>
          {IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'}
        </span>
        <TokenUSDC variant="branded" size={22} />
      </div>

      {/* Balance */}
      <div className="relative mb-5">
        <p className="text-xs font-semibold mb-1" style={{ color: 'rgba(255,255,255,0.65)' }}>USDC Balance</p>
        {isLoading
          ? <div className="h-9 w-32 rounded-xl animate-pulse" style={{ background: 'rgba(255,255,255,0.15)' }} />
          : (
            <div className="flex items-end gap-2">
              <span className="display text-4xl font-bold tabular-nums" style={{ color: '#fff', letterSpacing: '-0.04em' }}>
                {balStr}
              </span>
              <span className="mb-1 text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.6)' }}>USDC</span>
            </div>
          )
        }
        <p className="mono text-xs mt-1.5 truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {address.slice(0, 10)}…{address.slice(-8)}
        </p>
      </div>

      {/* Actions */}
      <div className="relative flex gap-2">
        <button onClick={onSend}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2.5 text-sm font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: 'rgba(255,255,255,0.22)', color: '#fff', backdropFilter: 'blur(8px)' }}>
          <Send className="size-4" /> Send
        </button>
        <button onClick={onReceive}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2.5 text-sm font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: 'rgba(255,255,255,0.22)', color: '#fff', backdropFilter: 'blur(8px)' }}>
          <QrCode className="size-4" /> Receive
        </button>
      </div>
    </motion.div>
  )
}

// ─── Compact Bill Row (rendered inside a shared container) ───────────────────
function BillRow({ bill, myParticipantStatus, onClick, isLast }: {
  bill: BillSummary
  myParticipantStatus?: ParticipantStatus
  onClick: () => void
  isLast: boolean
}) {
  const { address } = useAccount()
  const now = useNow()
  const isCreator = bill.creator.toLowerCase() === address?.toLowerCase()
  const isLate = bill.deadline > 0n && now > Number(bill.deadline) && bill.status === 0
  const progressPct = bill.totalAmount > 0n ? Number((bill.amountPaid * 100n) / bill.totalAmount) : 0
  const isPendingInvite = myParticipantStatus === 0 && !isCreator && bill.status === 0

  // ring color
  const ringColor = bill.status === 2 ? 'var(--danger)'
    : bill.status === 1 ? 'var(--success)'
    : progressPct === 100 ? 'var(--success)'
    : isPendingInvite ? 'var(--accent)'
    : 'var(--accent)'

  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-3.5 px-4 py-3.5 transition-colors"
      style={{
        borderBottom: isLast ? 'none' : '1px solid var(--border)',
        background: 'transparent',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Circular progress ring */}
      <div className="relative flex size-11 items-center justify-center shrink-0">
        <svg className="absolute inset-0 size-11 -rotate-90" viewBox="0 0 44 44" fill="none">
          <circle cx="22" cy="22" r="17" stroke="var(--border)" strokeWidth="3" />
          <circle cx="22" cy="22" r="17"
            stroke={ringColor} strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 17}`}
            strokeDashoffset={`${2 * Math.PI * 17 * (1 - progressPct / 100)}`}
            style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
        </svg>
        <span className="text-[9px] font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{progressPct}%</span>
      </div>

      {/* Bill info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 min-w-0">
          <span className="text-sm font-semibold truncate flex-1 min-w-0" style={{ color: 'var(--ink)' }}>
            {bill.label || `Bill #${bill.id.toString()}`}
          </span>
          {isPendingInvite && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
              style={{ background: 'var(--accent)', color: '#fff' }}>Invite</span>
          )}
          {isLate && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
              style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>Late</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs tabular-nums font-medium" style={{ color: 'var(--ink-2)' }}>
            {fmt(bill.totalAmount)} USDC
          </span>
          <span style={{ color: 'var(--subtle)', fontSize: 10 }}>·</span>
          <span className="flex items-center gap-0.5 text-xs" style={{ color: 'var(--muted)' }}>
            <Users className="size-3" />{bill.shares.length}
          </span>
          <span style={{ color: 'var(--subtle)', fontSize: 10 }}>·</span>
          <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
            style={statusStyle(bill.status)}>
            {STATUS_LABEL[bill.status]}
          </span>
        </div>
      </div>

      <ChevronRightIcon className="size-4 shrink-0" style={{ color: 'var(--subtle)' }} />
    </button>
  )
}

// ─── Bill loader ──────────────────────────────────────────────────────────────
function BillLoader({ id, filter, address: walletAddr, onVisible, onInvite, onOpen, isLast, autoOpen }: {
  id: bigint
  filter: 'all' | 'created' | 'owe' | 'done' | 'invites'
  address?: `0x${string}`
  onVisible?: (id: bigint) => void
  onInvite?: (id: bigint) => void
  onOpen: (bill: BillSummary, myStatus: ParticipantStatus | undefined) => void
  isLast: boolean
  autoOpen?: boolean
}) {
  const { data: billData } = useReadContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'getBill', args: [id], chainId: CHAIN_ID })
  const { data: sharesData } = useReadContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'getShares', args: [id], chainId: CHAIN_ID })
  const { data: metaData } = useReadContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'getBillMeta', args: [id], chainId: CHAIN_ID })
  const { data: myStatusRaw, isFetched: myStatusFetched } = useReadContract({
    address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'getParticipantStatus',
    args: walletAddr ? [id, walletAddr] : undefined,
    query: { enabled: !!walletAddr, retry: false }, chainId: CHAIN_ID,
  })
  const myStatus = (myStatusRaw as ParticipantStatus | undefined)
  // Auto-open once on deep-link (fires only once when data is ready)
  const autoOpened = useRef(false)

  // Derive bill object for use in effects — may be undefined if data not yet loaded
  const billReady = !!(billData && sharesData)
  const [creator = '', payee = '', totalAmount = 0n, amountPaid = 0n, status = 0, deadline = 0n, recurring = false, recurInterval = 0n, cancelThreshold = 0, cancelVotes = 0] =
    billData as [`0x${string}`, `0x${string}`, bigint, bigint, BillStatus, bigint, boolean, bigint, number, number] ?? []
  const shares = billReady
    ? (sharesData as Array<{ participant: `0x${string}`; amount: bigint; contributed: bigint }>).map(s => ({ participant: s.participant, amount: s.amount, contributed: s.contributed }))
    : []
  const [labelHex, payoutRedirectVoteCount] = (metaData ?? ['0x' + '0'.repeat(64), 0]) as [`0x${string}`, number]
  const label = bytes32ToLabel(labelHex)
  const bill: BillSummary = { id, creator: creator as `0x${string}`, payee: payee as `0x${string}`, totalAmount, amountPaid, status: status, deadline, recurring, recurInterval, cancelThreshold, cancelVotes, shares, label, payoutRedirectVoteCount }

  // Auto-open on deep-link: must be before any early return (Rules of Hooks)
  useEffect(() => {
    if (!autoOpen || !billReady || autoOpened.current) return
    if (walletAddr && !myStatusFetched) return
    autoOpened.current = true
    onOpen(bill, myStatus)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, billReady, myStatusFetched, walletAddr])

  if (!billReady) return (
    <div className="rounded-2xl h-16 animate-pulse" style={{ background: 'var(--surface-muted)' }} />
  )

  // Membership gate — always enforce when wallet is connected
  if (walletAddr) {
    const addr = walletAddr.toLowerCase()
    const isCreator = creator.toLowerCase() === addr
    const isPayee  = payee.toLowerCase() === addr
    const isParticipant = shares.some(s => s.participant.toLowerCase() === addr)

    // Not a member of this bill at all — hide completely
    if (!isCreator && !isPayee && !isParticipant) return null

    // Wait for status to resolve before making any filter decision for participants
    if (isParticipant && !isCreator && !myStatusFetched) {
      return <div className="rounded-2xl h-16 animate-pulse" style={{ background: 'var(--surface-muted)' }} />
    }

    const isPending = myStatus === 0 && isParticipant && !isCreator

    if (filter === 'invites') {
      if (!isPending) return null
      onInvite?.(id)
    } else {
      if (isPending) return null
      if (filter === 'created' && !isCreator) return null
      if (filter === 'owe') {
        const isDone = status === 1 || status === 2
        if (!isParticipant || isDone) return null
      }
      if (filter === 'done') {
        const isDone = status === 1 || status === 2
        if (!isDone) return null
      }
      onVisible?.(id)
    }
  }

  return <BillRow bill={bill} myParticipantStatus={myStatus} onClick={() => onOpen(bill, myStatus)} isLast={isLast} />
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

// ─── Bill notification scanner ───────────────────────────────────────────────
// Scans every bill on first sign-in. Fires a toast if the user was added as a
// participant to bills they didn't create, and counts unpaid shares.
function BillParticipantChecker({ id, walletAddr, onResult }: {
  id: bigint
  walletAddr: string
  onResult: (id: bigint, isNewBill: boolean, hasUnpaidShare: boolean, isPendingInvite: boolean) => void
}) {
  const { data: billData } = useReadContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'getBill', args: [id], chainId: CHAIN_ID })
  const { data: sharesData } = useReadContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'getShares', args: [id], chainId: CHAIN_ID })
  const { data: myStatusRaw, isFetched: myStatusFetched } = useReadContract({
    address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'getParticipantStatus',
    args: [id, walletAddr as `0x${string}`], chainId: CHAIN_ID,
    query: { retry: false },
  })
  const notified = useRef(false)
  useEffect(() => {
    if (!billData || !sharesData || !myStatusFetched || notified.current) return
    const bd = billData as unknown[]
    const creator = (bd[0] as string).toLowerCase()
    const status = bd[4] as number
    const addr = walletAddr.toLowerCase()
    const shares = sharesData as Array<{ participant: string; amount: bigint; contributed: bigint }>
    const myShare = shares.find(s => s.participant.toLowerCase() === addr)
    if (!myShare) return
    const isCreator = creator === addr
    const participantStatus = myStatusRaw as number // 0=Pending, 1=Accepted, 2=Rejected
    const isPendingInvite = !isCreator && participantStatus === 0
    // Only count as owed/active if participant has accepted
    const hasUnpaidShare = !isPendingInvite && status === 0 && myShare.contributed < myShare.amount
    // A "new bill" = user is participant (non-creator) and accepted
    const isNewBill = !isCreator && participantStatus === 1
    notified.current = true
    onResult(id, isNewBill, hasUnpaidShare, isPendingInvite)
  }, [billData, sharesData, myStatusFetched, myStatusRaw, walletAddr, id, onResult])
  return null
}

function BillNotificationScanner({ count, address: walletAddr, onOwedCount }: {
  count: number
  address?: `0x${string}`
  onOwedCount: (n: number) => void
}) {
  const toastedRef = useRef(false)
  const inviteToastedRef = useRef(false)
  const seenKey = `fairtab_seen_bills_${walletAddr ?? ''}`
  const seenInviteKey = `fairtab_seen_invites_${walletAddr ?? ''}`
  const newBillIds = useRef<bigint[]>([])
  const newInviteIds = useRef<bigint[]>([])
  const owedCount = useRef(0)
  const resolvedCount = useRef(0)

  const ids = useMemo(() => Array.from({ length: count }, (_, i) => BigInt(i)), [count])

  const handleResult = useCallback((id: bigint, isNewBill: boolean, hasUnpaidShare: boolean, isPendingInvite: boolean) => {
    resolvedCount.current++
    if (hasUnpaidShare) { owedCount.current++; onOwedCount(owedCount.current) }

    if (isPendingInvite) {
      // Pending invite: track separately, show Invites toast
      try {
        const seen = (JSON.parse(localStorage.getItem(seenInviteKey) ?? '[]') as unknown) as string[]
        if (!seen.includes(id.toString())) newInviteIds.current.push(id)
      } catch { newInviteIds.current.push(id) }
    } else if (isNewBill) {
      // Accepted bill the user is part of
      try {
        const seen = (JSON.parse(localStorage.getItem(seenKey) ?? '[]') as unknown) as string[]
        if (!seen.includes(id.toString())) newBillIds.current.push(id)
      } catch { newBillIds.current.push(id) }
    }

    if (resolvedCount.current !== count) return

    // Fire invite toast for unseen pending invites
    if (newInviteIds.current.length > 0 && !inviteToastedRef.current) {
      inviteToastedRef.current = true
      const n = newInviteIds.current.length
      toast(`You have ${n} pending bill invite${n > 1 ? 's' : ''}`, {
        description: 'Open the "Invites" tab to accept or decline.',
        duration: 8000,
        action: { label: 'View', onClick: () => {} },
      })
      try {
        const seen = (JSON.parse(localStorage.getItem(seenInviteKey) ?? '[]') as unknown) as string[]
        localStorage.setItem(seenInviteKey, JSON.stringify([...new Set([...seen, ...newInviteIds.current.map(i => i.toString())])]))
      } catch {}
    }

    // Fire "added to bills" toast for accepted bills
    if (newBillIds.current.length > 0 && !toastedRef.current) {
      toastedRef.current = true
      const n = newBillIds.current.length
      toast(`You've been added to ${n} bill${n > 1 ? 's' : ''}`, {
        description: 'Open the "I Owe" tab to see your shares.',
        duration: 8000,
        action: { label: 'View', onClick: () => {} },
      })
      try {
        const seen = (JSON.parse(localStorage.getItem(seenKey) ?? '[]') as unknown) as string[]
        localStorage.setItem(seenKey, JSON.stringify([...new Set([...seen, ...newBillIds.current.map(i => i.toString())])]))
      } catch {}
    }
  }, [count, seenKey, seenInviteKey, onOwedCount])

  if (!walletAddr || count === 0) return null
  return (
    <>
      {ids.map(id => (
        <BillParticipantChecker key={id.toString()} id={id} walletAddr={walletAddr} onResult={handleResult} />
      ))}
    </>
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

  const queryClient = useQueryClient()

  const { data: billCount, refetch: refetchCount } = useReadContract({
    address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'billCount', chainId: CHAIN_ID,
  })

  const [showCreate, setShowCreate] = useState(false)
  const [filter, setFilter] = useState<'all' | 'created' | 'owe' | 'done' | 'invites'>('all')
  const [owedBillCount, setOwedBillCount] = useState(0)
  const [inviteBillCount, setInviteBillCount] = useState(0)
  // Selected bill for detail page
  const [selectedBill, setSelectedBill] = useState<{ bill: BillSummary; myStatus: ParticipantStatus | undefined } | null>(null)

  // ── URL routing ─────────────────────────────────────────────────────────────
  // Pattern: /bill/<id>?contract=<contractAddress>
  // Parse prefilled params from URL
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), [])
  const prefilledTo = urlParams.get('to')
  // Deep-link: /bill/<id> or legacy ?bill=N
  const deepLinkBillId = useMemo(() => {
    const pathMatch = window.location.pathname.match(/^\/bill\/(\d+)$/)
    if (pathMatch) return BigInt(pathMatch[1])
    const b = urlParams.get('bill')
    return b != null ? BigInt(b) : null
  }, [urlParams])

  // Open a bill: push /bill/<id>?contract=<addr> into history
  const openBill = useCallback((bill: BillSummary, myStatus: ParticipantStatus | undefined) => {
    const url = `/bill/${bill.id.toString()}?contract=${CONTRACT_ADDRESS}`
    window.history.pushState({ billId: bill.id.toString() }, '', url)
    setSelectedBill({ bill, myStatus })
  }, [])

  // Close the detail page: pop the URL back to /
  const closeBill = useCallback(() => {
    window.history.replaceState({}, '', '/')
    setSelectedBill(null)
  }, [])

  // Handle browser back button
  useEffect(() => {
    const onPop = () => {
      // If we navigated back from a bill page, close the detail view
      if (!window.location.pathname.match(/^\/bill\//)) {
        setSelectedBill(null)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const { dark, toggle: toggleDark } = useDarkMode()
  const [tab, setTab] = useState<'bills' | 'send' | 'receive' | 'account'>(prefilledTo ? 'send' : 'bills')

  const count = billCount != null ? Number(billCount) : 0

  // Track which bill IDs are visible to this user (passed the membership gate)
  const visibleBillIds = useRef(new Set<string>())
  const [userBillCount, setUserBillCount] = useState(0)
  const handleBillVisible = useCallback((id: bigint) => {
    const key = `${address ?? ''}:${id.toString()}`
    if (visibleBillIds.current.has(key)) return
    visibleBillIds.current.add(key)
    setUserBillCount(visibleBillIds.current.size)
  }, [address])

  // Track invite count
  const inviteBillIds = useRef(new Set<string>())
  const handleInviteBill = useCallback((id: bigint) => {
    const key = `${address ?? ''}:${id.toString()}`
    if (inviteBillIds.current.has(key)) return
    inviteBillIds.current.add(key)
    setInviteBillCount(inviteBillIds.current.size)
  }, [address])

  // When a deep-link bill arrives, scroll to it once bills are loaded
  const deepLinkRef = useCallback((node: HTMLDivElement | null) => {
    if (node) setTimeout(() => node.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)
  }, [])

  const PAGE_SIZE = 10
  const [page, setPage] = useState(0)
  const allIds = Array.from({ length: count }, (_, i) => BigInt(i)).reverse()
  const pageCount = Math.max(1, Math.ceil(allIds.length / PAGE_SIZE))
  const ids = allIds.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const refetch = useCallback(() => {
    void refetchCount()
    void queryClient.invalidateQueries()
  }, [refetchCount, queryClient])

  // Reset page when filter changes
  const handleFilterChange = useCallback((f: typeof filter) => {
    setFilter(f); setPage(0)
  }, [setFilter])

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

            {/* Desktop balance card */}
            {address && (
              <BalanceCard
                address={address}
                onSend={() => setTab('send')}
                onReceive={() => setTab('receive')}
              />
            )}

            <p className="text-center text-xs" style={{ color: 'var(--subtle)' }}>
              Settled onchain · {IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'}
            </p>
          </aside>

          {/* ── Main content ────────────────────────────────────── */}
          <main className="flex-1 min-w-0 flex flex-col gap-6">
            {/* Mobile balance card — shown above tab bar */}
            {address && (
              <div className="md:hidden">
                <BalanceCard
                  address={address}
                  onSend={() => setTab('send')}
                  onReceive={() => setTab('receive')}
                />
              </div>
            )}

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
                      <div className="flex gap-2 overflow-x-auto pb-1 pt-0.5 px-0.5 scrollbar-none -mx-0.5">
                        {([
                          { id: 'all',     label: 'All',     icon: List,            count: userBillCount   },
                          { id: 'created', label: 'Created', icon: PenLine,         count: 0               },
                          { id: 'owe',     label: 'I Owe',   icon: ArrowDownCircle, count: owedBillCount   },
                          { id: 'done',    label: 'Done',    icon: CircleCheckBig,  count: 0               },
                          { id: 'invites', label: 'Invites', icon: Bell,            count: inviteBillCount },
                        ] as Array<{ id: 'all'|'created'|'owe'|'done'|'invites', label: string, icon: React.ElementType, count: number }>).map(({ id: f, label: fl, icon: FilterIcon, count: tabCount }) => {
                          const active = filter === f
                          const showBadge = tabCount > 0
                          return (
                            <button key={f} onClick={() => handleFilterChange(f)}
                              className="relative flex items-center gap-1.5 shrink-0 rounded-2xl px-3.5 py-2 text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                              style={{
                                background: active ? 'var(--accent)' : 'var(--surface)',
                                color: active ? '#fff' : 'var(--ink-2)',
                                border: active ? 'none' : '1px solid var(--border)',
                                boxShadow: active ? '0 2px 12px rgba(79,110,247,0.25)' : 'none',
                              }}>
                              <FilterIcon className="size-3.5 shrink-0" />
                              <span>{fl}</span>
                              {showBadge && (
                                <span className="inline-flex items-center justify-center rounded-full min-w-[18px] h-[18px] px-1 text-[10px] font-bold leading-none"
                                  style={{
                                    background: (f === 'invites' || f === 'owe') && !active
                                      ? 'var(--danger)'
                                      : active ? 'rgba(255,255,255,0.28)' : 'var(--surface-muted)',
                                    color: (f === 'invites' || f === 'owe') && !active ? '#fff' : active ? '#fff' : 'var(--ink-2)',
                                  }}>
                                  {tabCount}
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Deep-link invite banner */}
                  {deepLinkBillId !== null && (
                    <motion.div className="rounded-2xl p-4 flex items-start gap-3" {...fadeUp}
                      style={{ background: 'linear-gradient(135deg,rgba(79,110,247,0.10),rgba(79,110,247,0.04))', border: '1px solid rgba(79,110,247,0.25)' }}>
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl"
                        style={{ background: 'var(--accent)', boxShadow: '0 0 12px rgba(79,110,247,0.3)' }}>
                        <Receipt className="size-4" style={{ color: '#fff' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>You've been added to a bill</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                          Bill #{deepLinkBillId.toString()} is highlighted below. Open it to see your share and pay when ready.
                        </p>
                      </div>
                    </motion.div>
                  )}

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
                    <>
                      {/* Hidden auto-opener for deep-linked bills not on current page */}
                      {deepLinkBillId !== null && !ids.includes(deepLinkBillId) && (
                        <div style={{ display: 'none' }}>
                          <BillLoader
                            id={deepLinkBillId} filter="all" address={address}
                            onOpen={openBill} isLast={false} autoOpen={true}
                          />
                        </div>
                      )}

                      {/* Single unified bill list container */}
                      <motion.div
                        className="overflow-hidden rounded-2xl"
                        style={{ background: 'var(--surface)', boxShadow: 'var(--shadow)' }}
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                        {ids.map((id, i) => (
                          <div key={id.toString()}
                            ref={deepLinkBillId === id ? deepLinkRef : undefined}
                            style={deepLinkBillId === id ? { background: 'rgba(79,110,247,0.07)' } : {}}>
                            <BillLoader
                              id={id} filter={filter} address={address}
                              onVisible={handleBillVisible} onInvite={handleInviteBill}
                              onOpen={openBill}
                              isLast={i === ids.length - 1}
                              autoOpen={deepLinkBillId === id}
                            />
                          </div>
                        ))}
                      </motion.div>

                      {/* Pagination */}
                      {pageCount > 1 && (
                        <div className="flex items-center justify-between pt-2">
                          <button
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            disabled={page === 0}
                            className="flex items-center gap-1.5 rounded-2xl px-4 py-2 text-xs font-semibold transition-all disabled:opacity-30 hover:scale-105 active:scale-95"
                            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
                            <ChevronLeft className="size-3.5" /> Prev
                          </button>
                          <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                            Page {page + 1} of {pageCount}
                          </span>
                          <button
                            onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                            disabled={page >= pageCount - 1}
                            className="flex items-center gap-1.5 rounded-2xl px-4 py-2 text-xs font-semibold transition-all disabled:opacity-30 hover:scale-105 active:scale-95"
                            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
                            Next <ChevronRight className="size-3.5" />
                          </button>
                        </div>
                      )}
                    </>
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

      {/* ── Bill notification scanner (fires once on sign-in) ─── */}
      <BillNotificationScanner count={count} address={address} onOwedCount={setOwedBillCount} />

      {/* ── Payout ready toast (fires once on wallet connect) ──── */}
      <PayoutReadyToaster count={count} address={address} />

      {/* ── Bill Detail Page (full-screen slide-in) ─────────────── */}
      <AnimatePresence>
        {selectedBill && (
          <BillDetailPage
            key={selectedBill.bill.id.toString()}
            bill={selectedBill.bill}
            myParticipantStatus={selectedBill.myStatus}
            onBack={closeBill}
            onRefetch={refetch}
          />
        )}
      </AnimatePresence>

      {/* ── Create Bill Page (full-screen) ───────────────────────── */}
      <AnimatePresence>
        {showCreate && (
          <CreateBillPage
            onClose={() => setShowCreate(false)}
            onCreated={() => {
              setShowCreate(false)
              // Force full query invalidation so the new bill appears immediately
              void refetchCount().then(() => queryClient.invalidateQueries())
            }}
            seedSession={seedSession}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
