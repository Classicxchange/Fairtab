import { useState, useCallback, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain,
} from 'wagmi'
import {
  parseUnits, isAddress, createWalletClient, createPublicClient, http,
  encodeFunctionData, type Chain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { SeedWalletSession } from '@/SeedWalletAuth'
import { WalletUnlockModal } from '@/SeedWalletAuth'
import { TxConfirmModal, type TxDetail, type EstimateParams } from '@/TxConfirmModal'
import { TokenUSDC } from '@web3icons/react'
import {
  Plus, XCircle, CheckCircle2, Loader2, ExternalLink, Tag, Users,
  ArrowLeft, ArrowRight, RefreshCw, Calendar, Shield, AlertTriangle,
  ChevronDown, ChevronUp,
  Home, Zap, Wifi, Tv, ShoppingCart, Car, Lightbulb, Music,
  Dumbbell, UtensilsCrossed, Plane, Package,
} from 'lucide-react'
import { toast } from 'sonner'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { usdcDecimalsFor } from '@/onchain-money'
import { arcChain } from '@/config'
import artifact from '../contracts/out/HouseholdBillSplitter.sol/HouseholdBillSplitter.json'
import { IS_MAINNET } from '@/config'

const TESTNET_CONTRACT = '0x9c87ba9e35c1b986ab97174e1192badf44fb03a5' as const
const MAINNET_CONTRACT = '0xcd1dcf79d9bbf3246a21da10aecabde66fb47d08' as const
const CONTRACT_ADDRESS  = (IS_MAINNET ? MAINNET_CONTRACT : TESTNET_CONTRACT) as `0x${string}`
const CONTRACT_ABI = artifact.abi
const CHAIN_ID = arcChain.id

function labelToBytes32(s: string): `0x${string}` {
  const enc = new TextEncoder().encode(s)
  const truncated = enc.slice(0, 32)
  const padded = new Uint8Array(32)
  padded.set(truncated)
  return ('0x' + Array.from(padded).map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
}

const glass = {
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', boxShadow: 'var(--shadow)' } as React.CSSProperties,
  inner: { background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: '12px' } as React.CSSProperties,
}

const fadeSlide = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
  transition: { duration: 0.22, ease: [0.25, 0.1, 0.25, 1] },
}

interface ParticipantRow { address: string; value: string }

const BILL_CATEGORIES: { icon: React.ElementType; label: string; color: string }[] = [
  { icon: Home,            label: 'Rent',        color: '#6366f1' },
  { icon: Zap,             label: 'Electricity', color: '#f59e0b' },
  { icon: Wifi,            label: 'Internet',    color: '#3b82f6' },
  { icon: Tv,              label: 'Netflix',     color: '#ef4444' },
  { icon: ShoppingCart,    label: 'Groceries',   color: '#10b981' },
  { icon: Car,             label: 'Car / Gas',   color: '#f97316' },
  { icon: Lightbulb,       label: 'Utilities',   color: '#eab308' },
  { icon: Music,           label: 'Spotify',     color: '#22c55e' },
  { icon: Dumbbell,        label: 'Gym',         color: '#8b5cf6' },
  { icon: UtensilsCrossed, label: 'Dining',      color: '#ec4899' },
  { icon: Plane,           label: 'Travel',      color: '#0ea5e9' },
  { icon: Package,         label: 'Other',       color: '#94a3b8' },
]

interface Props {
  onClose: () => void
  onCreated: () => void
  seedSession?: SeedWalletSession | null
  /** Called when the user successfully unlocks their wallet mid-flow */
  onUpgradeSeedSession?: (upgraded: SeedWalletSession) => void
  /** Firebase UID — needed to load wallet blob for unlock prompt */
  googleUid?: string
}

// ─── Draft persistence ────────────────────────────────────────────────────────
const DRAFT_KEY = 'fairtab_bill_draft_v1'
interface BillDraft {
  step: 1 | 2 | 3
  billLabel: string
  selectedCategory: string
  payee: string
  totalAmount: string
  usePercentages: boolean
  deadline: string
  recurring: boolean
  recurDays: string
  cancelThreshold: string
  rows: ParticipantRow[]
  advancedOpen: boolean
}
function loadDraft(): BillDraft | null {
  try { const raw = localStorage.getItem(DRAFT_KEY); return raw ? (JSON.parse(raw) as BillDraft) : null } catch { return null }
}
function saveDraft(d: BillDraft) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)) } catch { /* ignore */ }
}
function clearDraft() { localStorage.removeItem(DRAFT_KEY) }

export function CreateBillPage({ onClose, onCreated, seedSession, onUpgradeSeedSession, googleUid }: Props) {
  const { address: wagmiAddress, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  // Only flag wrong chain when a wagmi wallet is connected — seed/Circle wallets
  // don't expose a chainId through wagmi so chainId will be undefined for them.
  const wrongChain = chainId !== undefined && chainId !== CHAIN_ID
  // Unified address: seed wallet takes priority over wagmi
  const address = seedSession?.address ?? wagmiAddress

  // Restore from draft on mount (lazy initialisers)
  const draft = loadDraft()

  // Form state — initialised from draft if one exists
  const [step, setStep] = useState<1 | 2 | 3>(draft?.step ?? 1)
  const [billLabel, setBillLabel] = useState(draft?.billLabel ?? '')
  const [selectedCategory, setSelectedCategory] = useState(draft?.selectedCategory ?? '')
  const [payee, setPayee] = useState((draft?.payee ?? '').trim())
  const [totalAmount, setTotalAmount] = useState(draft?.totalAmount ?? '')
  const [usePercentages, setUsePercentages] = useState(draft?.usePercentages ?? false)
  const [deadline, setDeadline] = useState(draft?.deadline ?? '')
  const [recurring, setRecurring] = useState(draft?.recurring ?? false)
  const [recurDays, setRecurDays] = useState(draft?.recurDays ?? '30')
  const [rows, setRows] = useState<ParticipantRow[]>(draft?.rows ?? [{ address: '', value: '' }, { address: '', value: '' }])

  // Derive effective rows: always inject creator address into row 0 if still blank
  // This avoids setState-in-effect; address is stable once connected
  const effectiveRows = useMemo(() => {
    const clean = rows.map(r => ({ ...r, address: r.address.trim() }))
    if (!address || clean[0]?.address) return clean
    return clean.map((r, i) => i === 0 ? { ...r, address } : r)
  }, [rows, address])
  // Mirror contract: cancelThreshold >= ceil(participants * 51/100), minimum 1
  const minCancelThreshold = Math.max(1, Math.ceil(rows.length * 51 / 100))
  const [cancelThreshold, setCancelThreshold] = useState(() => {
    const saved = draft?.cancelThreshold ? parseInt(draft.cancelThreshold) : 0
    return String(Math.max(saved || 0, Math.max(1, Math.ceil((draft?.rows?.length ?? 2) * 51 / 100))))
  })
  const [advancedOpen, setAdvancedOpen] = useState(draft?.advancedOpen ?? false)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const hasDraft = !!draft

  // Seed wallet direct-signing state
  const [seedPending, setSeedPending] = useState(false)
  const [seedHash, setSeedHash] = useState<`0x${string}` | null>(null)
  const [seedSuccess, setSeedSuccess] = useState(false)
  const [seedError, setSeedError] = useState<string | null>(null)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [estimateParams, setEstimateParams] = useState<EstimateParams | undefined>(undefined)
  const [showUnlockModal, setShowUnlockModal] = useState(false)

  // mutation: disable wagmi's preflight simulation — createBill doesn't transfer
  // USDC so a 0-balance wallet can still create a bill; simulation causes a false
  // "exceeds balance" error before the user even signs.
  const { writeContract, data: wagmiHash, isPending: wagmiPending, isError: wagmiIsError, error: wagmiError, reset: wagmiReset } = useWriteContract()
  const { isLoading: wagmiConfirming, isSuccess: wagmiSuccess } = useWaitForTransactionReceipt({ hash: wagmiHash })

  const hash = seedHash ?? wagmiHash
  const isPending = seedPending || wagmiPending
  const isConfirming = wagmiConfirming
  const isSuccess = seedSuccess || wagmiSuccess
  const isError = wagmiIsError || !!seedError
  const error = wagmiError ?? (seedError ? new Error(seedError) : null)
  const reset = () => { wagmiReset(); setSeedHash(null); setSeedSuccess(false); setSeedError(null); clearDraft() }

  const addRow = () => setRows(r => {
    const next = [...r, { address: '', value: '' }]
    const min = Math.max(1, Math.ceil(next.length * 51 / 100))
    setCancelThreshold(t => String(Math.max(parseInt(t) || 1, min)))
    return next
  })
  const removeRow = (i: number) => setRows(r => {
    const next = r.filter((_, idx) => idx !== i)
    const min = Math.max(1, Math.ceil(next.length * 51 / 100))
    setCancelThreshold(t => String(Math.max(Math.min(parseInt(t) || 1, next.length), min)))
    return next
  })
  const updateRow = (i: number, f: keyof ParticipantRow, v: string) =>
    setRows(r => r.map((row, idx) => idx === i ? { ...row, [f]: v } : row))

  // Auto-save draft whenever form state changes
  useEffect(() => {
    saveDraft({ step, billLabel, selectedCategory, payee, totalAmount, usePercentages, deadline, recurring, recurDays, cancelThreshold, rows, advancedOpen })
  }, [step, billLabel, selectedCategory, payee, totalAmount, usePercentages, deadline, recurring, recurDays, cancelThreshold, rows, advancedOpen])

  const buildArgs = useCallback(() => {
    const dec = usdcDecimalsFor(CHAIN_ID)
    const totalRaw = parseUnits(totalAmount, dec)
    const participants = effectiveRows.map(r => r.address as `0x${string}`)
    const amounts: bigint[] = usePercentages
      ? effectiveRows.map(r => BigInt(Math.round(parseFloat(r.value || '0'))))
      : effectiveRows.map(r => { const v = parseFloat(r.value || '0'); return parseUnits(v.toFixed(dec), dec) })
    const labelStr = selectedCategory
      ? `${selectedCategory} ${billLabel}`.trim().slice(0, 32)
      : billLabel
    return [
      totalRaw, labelToBytes32(labelStr),
      payee as `0x${string}`, participants, amounts, usePercentages,
      deadline ? BigInt(Math.floor(new Date(deadline).getTime() / 1000)) : 0n,
      recurring, recurring ? BigInt(parseInt(recurDays) * 86400) : 0n,
      Math.max(minCancelThreshold, Math.min(effectiveRows.length, parseInt(cancelThreshold) || minCancelThreshold)),
    ] as const
  }, [totalAmount, effectiveRows, usePercentages, selectedCategory, billLabel, payee, deadline, recurring, recurDays, cancelThreshold, minCancelThreshold])

  // Seed wallet: sign + broadcast via viem directly
  const handleSeedCreate = useCallback(async () => {
    if (!seedSession?.privateKey) return
    setSeedPending(true); setSeedError(null)
    try {
      const viemChain = arcChain as unknown as Chain
      const rpcUrl = (arcChain.rpcUrls as unknown as { default: { http: string[] } }).default.http[0]
      const account = privateKeyToAccount(seedSession.privateKey)
      const publicClient = createPublicClient({ chain: viemChain, transport: http(rpcUrl) })
      const walletClient = createWalletClient({ account, chain: viemChain, transport: http(rpcUrl) })
      const data = encodeFunctionData({ abi: CONTRACT_ABI, functionName: 'createBill', args: buildArgs() })
      const txHash = await walletClient.sendTransaction({ to: CONTRACT_ADDRESS, data, value: 0n, chain: viemChain })
      setSeedHash(txHash)
      setShowConfirmModal(false)
      await publicClient.waitForTransactionReceipt({ hash: txHash })
      setSeedSuccess(true)
      clearDraft()
      toast.success('Bill created!')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setSeedError(msg.includes('rejected') ? 'Transaction cancelled.' : msg.slice(0, 150))
      setShowConfirmModal(false)
      toast.error('Failed to create bill')
    } finally { setSeedPending(false) }
  }, [seedSession, buildArgs])

  const handleCreate = useCallback(() => {
    if (!address || !totalAmount || !payee) return
    if (!isAddress(payee)) { toast.error('Payee is not a valid address'); return }
    const invalidIdx = effectiveRows.findIndex(r => !isAddress(r.address))
    if (invalidIdx >= 0) { toast.error(`Participant ${invalidIdx + 1} has an invalid address`); return }
    if (seedSession && !seedSession.privateKey) {
      // Wallet is address-only (auto-restored) — prompt for password first
      setShowUnlockModal(true)
      return
    }
    if (seedSession?.privateKey) {
      // Build calldata for gas estimation, then show confirmation modal
      const data = encodeFunctionData({ abi: CONTRACT_ABI, functionName: 'createBill', args: buildArgs() })
      setEstimateParams({ from: address, to: CONTRACT_ADDRESS, data, value: 0n })
      setShowConfirmModal(true)
      return
    }
    if (wrongChain) { switchChain({ chainId: CHAIN_ID }); return }
    writeContract({
      address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'createBill',
      args: buildArgs(),
    })
  }, [address, wrongChain, switchChain, payee, totalAmount, effectiveRows, seedSession, buildArgs, writeContract])

  // Step validation
  const step1Valid = billLabel.length > 0 && totalAmount !== '' && parseFloat(totalAmount) > 0
  const dec = usdcDecimalsFor(CHAIN_ID)
  const totalRaw = useMemo(() => {
    try { return parseUnits(parseFloat(totalAmount || '0').toFixed(dec), dec) } catch { return 0n }
  }, [totalAmount, dec])
  const allocatedRaw = useMemo(() => {
    if (usePercentages) return null
    try {
      return effectiveRows.reduce((sum, r) => {
        const v = parseFloat(r.value || '0')
        return sum + parseUnits(v.toFixed(dec), dec)
      }, 0n)
    } catch { return null }
  }, [effectiveRows, usePercentages, dec])
  const allocationMatch = !allocatedRaw || allocatedRaw === totalRaw
  const totalBps = usePercentages ? effectiveRows.reduce((s, r) => s + parseFloat(r.value || '0'), 0) : 0

  // What still blocks the "Review bill" button, shown to the user instead of a silent disabled button
  const step2Problems: string[] = []
  if (!isAddress(payee)) step2Problems.push(payee ? 'The payee address is not a valid wallet address' : 'Enter the payee address')
  effectiveRows.forEach((r, i) => {
    if (!isAddress(r.address)) step2Problems.push(r.address ? `Participant ${i + 1}: not a valid wallet address` : `Participant ${i + 1}: enter a wallet address`)
    else if (r.value === '') step2Problems.push(`Participant ${i + 1}: enter ${usePercentages ? 'a share' : 'an amount'}`)
  })
  if (effectiveRows.length > 0 && effectiveRows.every(r => isAddress(r.address) && r.value !== '')) {
    if (!usePercentages && !allocationMatch) step2Problems.push("The amounts don't add up to the total")
    if (usePercentages && totalBps !== 10000) step2Problems.push('Shares must add up to 10 000 bps (100%)')
  }
  const step2Valid = step2Problems.length === 0

  // ── Success state ──────────────────────────────────────────────────────────
  if (isSuccess) {
    return (
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center px-4"
        style={{ background: 'var(--bg)' }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <motion.div className="flex flex-col items-center gap-6 max-w-sm w-full text-center"
          initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1 }}>
          <div className="flex size-24 items-center justify-center rounded-3xl"
            style={{ background: 'var(--success-bg)', boxShadow: '0 0 40px rgba(34,197,94,0.2)' }}>
            <CheckCircle2 className="size-12" style={{ color: 'var(--success)' }} />
          </div>
          <div>
            <p className="display text-3xl font-bold mb-2" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>
              Bill created!
            </p>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {billLabel || selectedCategory} · {totalAmount} USDC split between {rows.length} participants
            </p>
          </div>
          {hash && (
            <a href={buildTxExplorerUrl(CHAIN_ID, hash)} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-semibold transition-all hover:scale-105"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
              View on ArcScan <ExternalLink className="size-4" />
            </a>
          )}
          <button onClick={() => { reset(); onCreated(); onClose() }}
            className="rounded-2xl px-10 py-3.5 text-base font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 4px 20px rgba(79,110,247,0.3)' }}>
            View bills
          </button>
        </motion.div>
      </motion.div>
    )
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'var(--bg)' }}
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.22 }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <button onClick={step > 1 ? () => setStep(s => (s - 1) as 1|2|3) : onClose}
          className="flex size-9 items-center justify-center rounded-xl transition-all hover:scale-105"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
          <ArrowLeft className="size-4.5" style={{ color: 'var(--ink-2)' }} />
        </button>
        <div className="flex-1">
          <h2 className="display text-lg font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
            New Bill
          </h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Step {step} of 3{hasDraft && <span style={{ color: 'var(--accent)' }}> · Draft saved</span>}
          </p>
        </div>
        {/* Step dots + discard */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            {[1, 2, 3].map(s => (
              <div key={s}
                className="rounded-full transition-all duration-300"
                style={{
                  width: step === s ? 20 : 6,
                  height: 6,
                  background: step >= s ? 'var(--accent)' : 'var(--border-strong)',
                }} />
            ))}
          </div>
          {hasDraft && (
            <button onClick={() => setShowDiscardConfirm(true)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-all hover:scale-105"
              style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid rgba(220,38,38,0.15)' }}>
              <XCircle className="size-3" /> Discard
            </button>
          )}
        </div>
      </div>

      {/* Discard draft confirmation */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
          <motion.div className="w-full max-w-sm rounded-3xl p-6 flex flex-col gap-4"
            style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
            initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
            <div className="flex size-12 items-center justify-center rounded-2xl mx-auto"
              style={{ background: 'var(--danger-bg)' }}>
              <XCircle className="size-6" style={{ color: 'var(--danger)' }} />
            </div>
            <div className="text-center">
              <p className="font-bold text-base" style={{ color: 'var(--ink)' }}>Discard draft?</p>
              <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                Your saved progress will be permanently deleted.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowDiscardConfirm(false)}
                className="flex-1 rounded-2xl py-3 text-sm font-semibold"
                style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
                Keep draft
              </button>
              <button onClick={() => { clearDraft(); setShowDiscardConfirm(false); onClose() }}
                className="flex-1 rounded-2xl py-3 text-sm font-bold"
                style={{ background: 'var(--danger)', color: '#fff' }}>
                Discard
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">

          {/* ── Step 1: Bill details ─────────────────────────────────── */}
          {step === 1 && (
            <motion.div key="step1" className="px-4 py-5 flex flex-col gap-5" {...fadeSlide}>

              {/* Category picker */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>Category</p>
                <div className="grid grid-cols-4 gap-2">
                  {BILL_CATEGORIES.map(cat => {
                    const CatIcon = cat.icon
                    const isSelected = selectedCategory === cat.label
                    return (
                      <button key={cat.label} onClick={() => {
                        setSelectedCategory(isSelected ? '' : cat.label)
                        if (!billLabel) setBillLabel(cat.label)
                      }}
                        className="flex flex-col items-center gap-1.5 rounded-2xl py-3 px-1 text-xs font-medium transition-all hover:scale-105 active:scale-95"
                        style={{
                          background: isSelected ? 'var(--accent)' : 'var(--surface)',
                          border: isSelected ? 'none' : '1px solid var(--border)',
                          color: isSelected ? '#fff' : 'var(--ink-2)',
                        }}>
                        <div className="size-8 rounded-xl flex items-center justify-center"
                          style={{ background: isSelected ? 'rgba(255,255,255,0.2)' : `${cat.color}18` }}>
                          <CatIcon className="size-4" style={{ color: isSelected ? '#fff' : cat.color }} />
                        </div>
                        <span>{cat.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Bill name */}
              <div style={glass.card}>
                <div className="px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>Bill Name</p>
                  <div className="flex items-center gap-2">
                    <Tag className="size-4 shrink-0" style={{ color: 'var(--subtle)' }} />
                    <input
                      value={billLabel}
                      onChange={e => setBillLabel(e.target.value.slice(0, 32))}
                      placeholder="e.g. October Rent, Netflix Split…"
                      className="flex-1 bg-transparent text-base font-medium outline-none placeholder:opacity-30"
                      style={{ color: 'var(--ink)' }}
                    />
                    <span className="text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
                      {billLabel.length}/32
                    </span>
                  </div>
                </div>
              </div>

              {/* Total amount */}
              <div style={glass.card}>
                <div className="px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>Total Amount</p>
                  <div className="flex items-center gap-3">
                    <TokenUSDC variant="branded" size={28} />
                    <input
                      inputMode="decimal"
                      value={totalAmount}
                      onChange={e => setTotalAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                      placeholder="0.00"
                      className="display flex-1 bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:opacity-20"
                      style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}
                    />
                    <span className="text-base font-semibold" style={{ color: 'var(--subtle)' }}>USDC</span>
                  </div>
                </div>
                {/* Quick amounts */}
                <div className="px-4 pb-4 flex gap-2 flex-wrap" style={{ borderTop: '1px solid var(--border)' }}>
                  <p className="w-full text-xs pt-3 pb-1" style={{ color: 'var(--subtle)' }}>Quick amounts</p>
                  {['50', '100', '200', '500', '1000'].map(q => (
                    <button key={q} onClick={() => setTotalAmount(q)}
                      className="rounded-xl px-3 py-1.5 text-xs font-semibold transition-all hover:scale-105"
                      style={{
                        background: totalAmount === q ? 'var(--accent)' : 'var(--surface-muted)',
                        color: totalAmount === q ? '#fff' : 'var(--ink-2)',
                        border: totalAmount === q ? 'none' : '1px solid var(--border)',
                      }}>
                      ${q}
                    </button>
                  ))}
                </div>
              </div>

              {/* Deadline — collapsed into advanced */}
              <button onClick={() => setAdvancedOpen(o => !o)}
                className="flex items-center gap-2 text-xs font-semibold"
                style={{ color: 'var(--accent)' }}>
                {advancedOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                Advanced options
              </button>

              {advancedOpen && (
                <motion.div className="flex flex-col gap-4"
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                  <div className="grid grid-cols-2 gap-3">
                    {/* Deadline */}
                    <div className="rounded-2xl p-3.5" style={glass.inner}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Calendar className="size-3.5" style={{ color: 'var(--subtle)' }} />
                        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Deadline</p>
                      </div>
                      <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
                        className="w-full bg-transparent text-sm outline-none" style={{ color: 'var(--ink)', colorScheme: 'dark' }} />
                    </div>

                    {/* Cancel quorum */}
                    <div className="rounded-2xl p-3.5" style={glass.inner}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Shield className="size-3.5" style={{ color: 'var(--subtle)' }} />
                        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Cancel votes</p>
                      </div>
                      <input type="number" min={minCancelThreshold} max={rows.length} value={cancelThreshold}
                        onChange={e => {
                          const v = parseInt(e.target.value) || minCancelThreshold
                          setCancelThreshold(String(Math.max(minCancelThreshold, Math.min(rows.length, v))))
                        }}
                        className="w-full bg-transparent text-sm font-semibold tabular-nums outline-none" style={{ color: 'var(--ink)' }} />
                      <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
                        of {rows.length} needed · min {minCancelThreshold}
                      </p>
                    </div>
                  </div>

                  {/* Recurring */}
                  <div className="flex items-center gap-3 rounded-2xl p-4" style={glass.inner}>
                    <button onClick={() => setRecurring(r => !r)}
                      className="flex size-5 shrink-0 items-center justify-center rounded-md transition-all"
                      style={{ background: recurring ? 'var(--accent)' : 'transparent', border: `2px solid ${recurring ? 'var(--accent)' : 'var(--border-strong)'}` }}>
                      {recurring && <CheckCircle2 className="size-3" style={{ color: '#fff' }} />}
                    </button>
                    <div className="flex items-center gap-2 flex-wrap">
                      <RefreshCw className="size-3.5" style={{ color: 'var(--subtle)' }} />
                      <span className="text-sm font-medium" style={{ color: 'var(--ink-2)' }}>Repeat every</span>
                      <input disabled={!recurring} type="number" min={1} value={recurDays}
                        onChange={e => setRecurDays(e.target.value)}
                        className="w-14 rounded-xl px-2 py-1 text-center text-sm font-semibold tabular-nums outline-none disabled:opacity-40"
                        style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }} />
                      <span className="text-sm" style={{ color: 'var(--muted)' }}>days</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* ── Step 2: Participants ───────────────────────────────── */}
          {step === 2 && (
            <motion.div key="step2" className="px-4 py-5 flex flex-col gap-5" {...fadeSlide}>

              {/* Split mode */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>Split method</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Fixed USDC', sub: 'Exact amounts per person', value: false },
                    { label: '% Shares', sub: 'Basis points (5000 = 50%)', value: true },
                  ].map(opt => (
                    <button key={opt.label} onClick={() => setUsePercentages(opt.value)}
                      className="flex flex-col items-start gap-0.5 rounded-2xl p-4 transition-all text-left"
                      style={{
                        background: usePercentages === opt.value ? 'var(--accent)' : 'var(--surface)',
                        border: usePercentages === opt.value ? 'none' : '1px solid var(--border)',
                        boxShadow: usePercentages === opt.value ? '0 4px 16px rgba(79,110,247,0.25)' : 'none',
                      }}>
                      <span className="text-sm font-bold" style={{ color: usePercentages === opt.value ? '#fff' : 'var(--ink)' }}>{opt.label}</span>
                      <span className="text-xs" style={{ color: usePercentages === opt.value ? 'rgba(255,255,255,0.7)' : 'var(--muted)' }}>{opt.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Payee */}
              <div style={glass.card}>
                <div className="px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>Payee address</p>
                  <p className="text-xs mb-3" style={{ color: 'var(--subtle)' }}>The wallet that receives all payments (e.g. landlord)</p>
                  <input value={payee} onChange={e => setPayee(e.target.value.trim())}
                    placeholder="0x… landlord or payee"
                    className="mono w-full bg-transparent text-sm outline-none placeholder:opacity-30"
                    style={{ color: payee && !isAddress(payee) ? 'var(--danger)' : 'var(--ink)' }} />
                  {payee && !isAddress(payee) && (
                    <p className="text-xs mt-1.5 flex items-center gap-1" style={{ color: 'var(--danger)' }}>
                      <AlertTriangle className="size-3" /> Invalid address
                    </p>
                  )}
                </div>
              </div>

              {/* Participants */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Users className="size-4" style={{ color: 'var(--accent)' }} />
                    <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                      Participants ({rows.length})
                    </span>
                  </div>
                  <button onClick={addRow} disabled={rows.length >= 20}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all hover:scale-105 disabled:opacity-40"
                    style={{ background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid rgba(79,110,247,0.2)' }}>
                    <Plus className="size-3.5" /> Add participant
                  </button>
                </div>

                <div className="flex flex-col gap-2">
                  {effectiveRows.map((row, i) => {
                    const isCreatorRow = i === 0 && address && row.address.toLowerCase() === address.toLowerCase()
                    return (
                    <div key={i} className="flex items-center gap-2 rounded-2xl overflow-hidden" style={glass.inner}>
                      <div className="flex size-8 shrink-0 ml-3 items-center justify-center rounded-full text-xs font-bold"
                        style={{ background: isCreatorRow ? 'var(--accent)' : 'var(--surface)', color: isCreatorRow ? '#fff' : 'var(--accent)', border: '1px solid var(--border)' }}>
                        {isCreatorRow ? 'You' : i + 1}
                      </div>
                      <div className="flex-1 py-3 pr-1">
                        {isCreatorRow ? (
                          <p className="mono w-full text-xs truncate" style={{ color: 'var(--subtle)' }}>
                            {row.address}
                          </p>
                        ) : (
                          <input value={row.address} onChange={e => updateRow(i, 'address', e.target.value.trim())}
                            placeholder={`0x… wallet ${i + 1}`}
                            className="mono w-full bg-transparent text-xs outline-none placeholder:opacity-30"
                            style={{ color: row.address && !isAddress(row.address) ? 'var(--danger)' : 'var(--ink)' }} />
                        )}
                      </div>
                      <div className="w-28 border-l py-3 px-3" style={{ borderColor: 'var(--border)' }}>
                        <input inputMode="decimal" value={row.value}
                          onChange={e => updateRow(i, 'value', e.target.value.replace(/[^0-9.]/g, ''))}
                          placeholder={usePercentages ? '5000' : '0.00'}
                          className="w-full bg-transparent text-right text-sm font-semibold tabular-nums outline-none placeholder:opacity-30"
                          style={{ color: 'var(--ink)' }} />
                        <p className="text-right text-xs" style={{ color: 'var(--subtle)' }}>
                          {usePercentages ? 'bps' : 'USDC'}
                        </p>
                      </div>
                      {rows.length > 1 && !isCreatorRow && (
                        <button onClick={() => removeRow(i)} className="pr-3 pl-1"
                          style={{ color: 'var(--danger)' }}>
                          <XCircle className="size-4" />
                        </button>
                      )}
                    </div>
                  )})}  
                </div>

                {/* Allocation summary */}
                {!usePercentages && totalRaw > 0n && allocatedRaw !== null && (
                  <div className="mt-3 rounded-xl px-4 py-3 flex items-center justify-between"
                    style={{
                      background: allocationMatch ? 'var(--success-bg)' : 'var(--danger-bg)',
                      border: `1px solid ${allocationMatch ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                    }}>
                    <span className="text-xs font-semibold flex items-center gap-1" style={{ color: allocationMatch ? 'var(--success)' : 'var(--danger)' }}>
                      {allocationMatch ? <><CheckCircle2 className="size-3.5" /> Shares match total</> : <><AlertTriangle className="size-3.5" /> Shares don&apos;t add up to total</>}
                    </span>
                    <span className="mono text-xs tabular-nums" style={{ color: allocationMatch ? 'var(--success)' : 'var(--danger)' }}>
                      {Number(allocatedRaw) / 10 ** 6} / {totalAmount} USDC
                    </span>
                  </div>
                )}
                {usePercentages && (
                  <div className="mt-3 rounded-xl px-4 py-3 flex items-center justify-between"
                    style={{
                      background: totalBps === 10000 ? 'var(--success-bg)' : 'var(--surface-muted)',
                      border: '1px solid var(--border)',
                    }}>
                    <span className="text-xs font-semibold flex items-center gap-1" style={{ color: totalBps === 10000 ? 'var(--success)' : 'var(--muted)' }}>
                      {totalBps === 10000 ? <><CheckCircle2 className="size-3.5" /> Shares sum to 100%</> : 'Shares must sum to 10 000 bps'}
                    </span>
                    <span className="mono text-xs tabular-nums" style={{ color: totalBps === 10000 ? 'var(--success)' : 'var(--ink-2)' }}>
                      {totalBps.toLocaleString()} / 10 000
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ── Step 3: Review & create ───────────────────────────── */}
          {step === 3 && (
            <motion.div key="step3" className="px-4 py-5 flex flex-col gap-5" {...fadeSlide}>
              <div>
                <h3 className="display text-xl font-bold mb-1" style={{ color: 'var(--ink)' }}>Review bill</h3>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>Confirm the details before creating onchain.</p>
              </div>

              {/* Summary card */}
              <div className="rounded-2xl overflow-hidden" style={glass.card}>
                {/* Hero */}
                <div className="px-5 py-6 text-center"
                  style={{ background: 'linear-gradient(135deg,rgba(79,110,247,0.1),rgba(79,110,247,0.03))' }}>
                  {selectedCategory && (() => {
                    const cat = BILL_CATEGORIES.find(c => c.label === selectedCategory)
                    const ReviewIcon = cat?.icon
                    return ReviewIcon ? (
                      <div className="size-14 rounded-2xl flex items-center justify-center mx-auto mb-3"
                        style={{ background: `${cat.color}18` }}>
                        <ReviewIcon className="size-7" style={{ color: cat.color }} />
                      </div>
                    ) : null
                  })()}
                  <p className="display text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>
                    {billLabel || 'Unnamed Bill'}
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <TokenUSDC variant="branded" size={20} />
                    <span className="display text-3xl font-bold tabular-nums" style={{ color: 'var(--accent)', letterSpacing: '-0.03em' }}>
                      {totalAmount}
                    </span>
                    <span className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>USDC</span>
                  </div>
                </div>

                {/* Details */}
                <div className="px-5 py-4 flex flex-col gap-3" style={{ borderTop: '1px solid var(--border)' }}>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Payee</span>
                    <span className="mono text-xs" style={{ color: 'var(--ink-2)' }}>{payee.slice(0,6)}…{payee.slice(-4)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Participants</span>
                    <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{rows.length} wallets</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Split</span>
                    <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{usePercentages ? '% Shares' : 'Fixed USDC'}</span>
                  </div>
                  {deadline && (
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Deadline</span>
                      <span className="text-sm" style={{ color: 'var(--ink-2)' }}>{new Date(deadline).toLocaleDateString()}</span>
                    </div>
                  )}
                  {recurring && (
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Recurring</span>
                      <span className="text-sm flex items-center gap-1" style={{ color: 'var(--ink-2)' }}>
                        <RefreshCw className="size-3.5" /> Every {recurDays} days
                      </span>
                    </div>
                  )}
                </div>

                {/* Participants preview */}
                <div className="px-5 pb-4" style={{ borderTop: '1px solid var(--border)' }}>
                  <p className="text-xs font-semibold uppercase tracking-widest pt-3 mb-2" style={{ color: 'var(--muted)' }}>Participants</p>
                  <div className="flex flex-col gap-1.5">
                    {effectiveRows.map((r, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="mono text-xs" style={{ color: 'var(--ink-2)' }}>
                          {r.address.slice(0,6)}…{r.address.slice(-4)}
                          {i === 0 && address && r.address.toLowerCase() === address.toLowerCase() && (
                            <span className="ml-1 text-[10px]" style={{ color: 'var(--accent)' }}>(you)</span>
                          )}
                        </span>
                        <span className="mono text-xs font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
                          {r.value} {usePercentages ? 'bps' : 'USDC'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Only show error for seed wallet (own error state) or wagmi external wallets.
                  Never show wagmi's preflight simulation errors — createBill costs gas only,
                  no USDC balance required. */}
              {isError && error && !error.message?.includes('exceeds the balance') && !error.message?.includes('simulation') && (
                <div className="rounded-xl p-3.5 text-xs" style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  {error.message?.includes('user rejected') || error.message?.includes('rejected')
                    ? 'Transaction cancelled.'
                    : (error.message?.split('Details:')[1] ?? error.message)?.trim().slice(0, 220)}
                </div>
              )}
              {seedError && (
                <div className="rounded-xl p-3.5 text-xs" style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  {seedError.includes('rejected') ? 'Transaction cancelled.' : seedError.slice(0, 150)}
                </div>
              )}

              <button
                onClick={handleCreate}
                disabled={isPending || isConfirming || !address}
                className="w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 4px 20px rgba(79,110,247,0.3)' }}>
                {isPending || isConfirming
                  ? <><Loader2 className="size-5 animate-spin" /> {isPending ? 'Confirm in wallet…' : 'Creating…'}</>
                  : wrongChain
                    ? `Switch to ${IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'}`
                    : <><CheckCircle2 className="size-5" /> Create bill onchain</>
                }
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer nav */}
      {step < 3 && (
        <div className="px-4 py-4 shrink-0 flex flex-col gap-2.5" style={{ borderTop: '1px solid var(--border)' }}>
          {step === 2 && step2Problems.length > 0 && (
            <ul className="text-xs flex flex-col gap-1" style={{ color: 'var(--danger)' }}>
              {step2Problems.slice(0, 3).map(p => (
                <li key={p} className="flex items-center gap-1.5"><AlertTriangle className="size-3 shrink-0" /> {p}</li>
              ))}
            </ul>
          )}
          <button
            onClick={() => setStep(s => (s + 1) as 1|2|3)}
            disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
            className="w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent)', color: '#fff' }}>
            {step === 1 ? 'Add participants' : 'Review bill'}
            <ArrowRight className="size-5" />
          </button>
        </div>
      )}

      {/* ── Seed wallet transaction confirmation modal ── */}
      {seedSession && (
        <TxConfirmModal
          open={showConfirmModal}
          fromAddress={seedSession.address}
          isPending={seedPending}
          detail={{
            action: 'Create bill',
            amount: totalAmount ? `${totalAmount} USDC` : undefined,
            to: 'Bill Splitter contract',
            rows: [
              { label: 'Participants', value: `${rows.length} wallet${rows.length !== 1 ? 's' : ''}` },
              { label: 'Split', value: usePercentages ? '% shares' : 'Fixed USDC' },
              ...(deadline ? [{ label: 'Deadline', value: new Date(deadline).toLocaleDateString() }] : []),
            ],
          } satisfies TxDetail}
          onConfirm={() => { void handleSeedCreate() }}
          onCancel={() => setShowConfirmModal(false)}
          estimateParams={estimateParams}
        />
      )}
      {/* ── Wallet unlock prompt (address-only session needs password) ── */}
      {showUnlockModal && seedSession && !seedSession.privateKey && (
        <WalletUnlockModal
          uid={googleUid}
          address={seedSession.address}
          onUnlocked={pk => {
            const upgraded = { ...seedSession, privateKey: pk }
            onUpgradeSeedSession?.(upgraded)
            setShowUnlockModal(false)
            // Now trigger the actual create flow with the upgraded session
            const data = encodeFunctionData({ abi: CONTRACT_ABI, functionName: 'createBill', args: buildArgs() })
            setEstimateParams({ from: upgraded.address, to: CONTRACT_ADDRESS, data, value: 0n })
            setShowConfirmModal(true)
          }}
          onCancel={() => setShowUnlockModal(false)}
        />
      )}
    </motion.div>
  )
}
