import { useState, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain,
} from 'wagmi'
import { erc20Abi, parseUnits, isAddress, createWalletClient, createPublicClient, http, encodeFunctionData } from 'viem'
import {
  TokenUSDC,
} from '@web3icons/react'
import {
  Send, CheckCircle2, Loader2, AlertTriangle, ExternalLink, ArrowRight, Wallet,
  ChevronDown, ScanLine, Copy,
} from 'lucide-react'
import { toast } from 'sonner'
import { getUsdc, buildTxExplorerUrl } from '@/onchain-facts'
import { formatUsdc, usdcDecimalsFor } from '@/onchain-money'
import { arcChain, IS_MAINNET } from '@/config'
import type { Chain } from 'viem'
import { type SeedWalletSession } from '@/SeedWalletAuth'
import { privateKeyToAccount } from 'viem/accounts'

const CHAIN_ID = arcChain.id
const USDC_ADDRESS = getUsdc(CHAIN_ID)!.address as `0x${string}`

const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] },
}

const fmt = (raw: bigint) => formatUsdc(raw)

const glass = {
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', boxShadow: 'var(--shadow)' } as React.CSSProperties,
  inner: { background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: '12px' } as React.CSSProperties,
}

// Quick amounts for fast input
const QUICK_AMOUNTS = ['10', '25', '50', '100', '200', '500']

interface Props {
  unifiedAddress?: `0x${string}`
  seedSession?: SeedWalletSession | null
}

export function SendPage({ unifiedAddress, seedSession }: Props) {
  const { address: wagmiAddress, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const address = unifiedAddress ?? wagmiAddress
  const wrongChain = chainId !== CHAIN_ID && !seedSession
  const dec = usdcDecimalsFor(CHAIN_ID)

  const urlP = useMemo(() => new URLSearchParams(window.location.search), [])
  const [to, setTo] = useState(urlP.get('to') ?? '')
  const [amount, setAmount] = useState(urlP.get('amount') ?? '')
  const [memo, setMemo] = useState(urlP.get('memo') ?? '')
  const [approveDone, setApproveDone] = useState(false)
  const [seedSending, setSeedSending] = useState(false)
  const [seedTxHash, setSeedTxHash] = useState<`0x${string}` | null>(null)
  const [step, setStep] = useState<'form' | 'confirm' | 'success'>('form')

  const toValid = isAddress(to)
  const amountRaw = useMemo(() => {
    try { const v = parseFloat(amount); if (!v || v <= 0) return 0n; return parseUnits(v.toFixed(dec), dec) }
    catch { return 0n }
  }, [amount, dec])
  const sendValid = toValid && amountRaw > 0n

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address }, chainId: CHAIN_ID,
  })
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance',
    args: address ? [address, to as `0x${string}`] : undefined,
    query: { enabled: !!address && toValid }, chainId: CHAIN_ID,
  })
  const needsApprove = sendValid && !approveDone && !seedSession && (allowance === undefined || allowance < amountRaw)

  const ensureChain = useCallback(() => {
    if (wrongChain) { switchChain({ chainId: CHAIN_ID }); return false }
    return true
  }, [wrongChain, switchChain])

  const { writeContract: writeApprove, data: approveHash, isPending: _approvePending } = useWriteContract()
  const { isLoading: _approveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveHash })
  const { writeContract: writeSend, data: wagmiSendHash, isPending: sendPending, reset: resetSend } = useWriteContract()
  const { isLoading: sendConfirming, isSuccess: sendSuccess } = useWaitForTransactionReceipt({ hash: wagmiSendHash })

  const handleApprove = useCallback(() => {
    if (!ensureChain() || !sendValid) return
    writeApprove({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [to, amountRaw] })
  }, [ensureChain, sendValid, to, amountRaw, writeApprove])

  const handleWagmiSend = useCallback(() => {
    if (!ensureChain() || !sendValid) return
    writeSend({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'transfer', args: [to, amountRaw] })
  }, [ensureChain, sendValid, to, amountRaw, writeSend])

  // Seed wallet: sign + send directly via viem
  const handleSeedSend = useCallback(async () => {
    if (!seedSession?.privateKey || !sendValid) return
    setSeedSending(true)
    try {
      const viemChain = arcChain as unknown as Chain
      const rpcUrl = (arcChain.rpcUrls as unknown as { default: { http: string[] } }).default.http[0] ?? 'https://rpc.testnet.arc.io'
      const account = privateKeyToAccount(seedSession.privateKey)
      const publicClient = createPublicClient({ chain: viemChain, transport: http(rpcUrl) })
      const walletClient = createWalletClient({ account, chain: viemChain, transport: http(rpcUrl) })
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [to, amountRaw],
      })
      const txHash = await walletClient.sendTransaction({
        to: USDC_ADDRESS,
        data,
        value: 0n,
        chain: viemChain,
      })
      setSeedTxHash(txHash)
      await publicClient.waitForTransactionReceipt({ hash: txHash })
      toast.success(`Sent ${amount} USDC`)
      setStep('success')
      void refetchBalance()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(msg.includes('rejected') ? 'Cancelled.' : 'Send failed: ' + msg.slice(0, 80))
    } finally {
      setSeedSending(false)
    }
  }, [seedSession, sendValid, to, amountRaw, amount, refetchBalance])

  if (approveSuccess && !approveDone) { setApproveDone(true); void refetchAllowance() }
  if (sendSuccess && step !== 'success') {
    toast.success(`Sent ${amount} USDC`)
    setStep('success')
    void refetchBalance()
  }

  const sendHash = wagmiSendHash ?? seedTxHash

  const handleReset = () => {
    setTo(''); setAmount(''); setMemo(''); setApproveDone(false)
    setSeedTxHash(null); resetSend(); setStep('form')
  }

  const exceedsBalance = balance !== undefined && amountRaw > balance

  // ── Success state ─────────────────────────────────────────────────────────
  if (step === 'success') {
    return (
      <motion.div className="flex flex-col items-center justify-center gap-6 py-16 max-w-md mx-auto" {...fadeUp}>
        <div className="flex size-20 items-center justify-center rounded-3xl"
          style={{ background: 'var(--success-bg)', boxShadow: '0 0 32px rgba(34,197,94,0.18)' }}>
          <CheckCircle2 className="size-10" style={{ color: 'var(--success)' }} />
        </div>
        <div className="text-center">
          <p className="display text-3xl font-bold mb-1" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>
            {amount} USDC sent
          </p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>to {to.slice(0,6)}…{to.slice(-4)}</p>
          {memo && <p className="text-sm mt-1 italic" style={{ color: 'var(--subtle)' }}>"{memo}"</p>}
        </div>
        {sendHash && (
          <a href={buildTxExplorerUrl(CHAIN_ID, sendHash)} target="_blank" rel="noreferrer"
            className="flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-semibold transition-all hover:scale-105"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
            View on ArcScan <ExternalLink className="size-4" />
          </a>
        )}
        <button onClick={handleReset}
          className="rounded-2xl px-8 py-3.5 text-sm font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: 'var(--accent)', color: '#fff' }}>
          Send again
        </button>
      </motion.div>
    )
  }

  // ── Confirm step ──────────────────────────────────────────────────────────
  if (step === 'confirm') {
    const busy = sendPending || sendConfirming || seedSending
    return (
      <motion.div className="flex flex-col gap-5 max-w-md mx-auto" {...fadeUp}>
        <div className="flex items-center gap-3">
          <button onClick={() => setStep('form')}
            className="rounded-xl p-2 transition-all hover:scale-105"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
            <ChevronDown className="size-4 rotate-90" />
          </button>
          <h2 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>Confirm send</h2>
        </div>

        <div className="rounded-2xl overflow-hidden" style={glass.card}>
          {/* Big amount */}
          <div className="px-6 py-8 text-center" style={{ background: 'linear-gradient(135deg,rgba(79,110,247,0.08),rgba(79,110,247,0.02))' }}>
            <div className="flex items-center justify-center gap-2 mb-1">
              <TokenUSDC variant="branded" size={28} />
              <span className="display text-4xl font-bold tabular-nums" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>
                {amount}
              </span>
              <span className="text-lg font-semibold" style={{ color: 'var(--muted)' }}>USDC</span>
            </div>
            {memo && <p className="text-sm italic mt-1" style={{ color: 'var(--subtle)' }}>"{memo}"</p>}
          </div>

          {/* Details */}
          <div className="px-6 py-4 flex flex-col gap-3" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="flex items-start justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>To</span>
              <span className="mono text-sm text-right break-all" style={{ color: 'var(--ink)' }}>{to}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Network</span>
              <span className="text-sm px-2.5 py-0.5 rounded-full font-semibold"
                style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
                {IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Gas</span>
              <span className="text-sm" style={{ color: 'var(--ink-2)' }}>Paid in USDC (Arc)</span>
            </div>
          </div>
        </div>

        <button
          onClick={seedSession ? handleSeedSend : (needsApprove ? handleApprove : handleWagmiSend)}
          disabled={busy || exceedsBalance}
          className="w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 4px 20px rgba(79,110,247,0.3)' }}>
          {busy
            ? <><Loader2 className="size-5 animate-spin" /> {sendPending || seedSending ? 'Confirm in wallet…' : 'Confirming…'}</>
            : needsApprove
              ? <><CheckCircle2 className="size-5" /> Allow USDC</>
              : <><Send className="size-5" /> Confirm send {amount} USDC</>
          }
        </button>
      </motion.div>
    )
  }

  // ── Form step ─────────────────────────────────────────────────────────────
  return (
    <motion.div className="flex flex-col gap-5 max-w-md mx-auto" {...fadeUp}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="display text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Send USDC</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Send to any wallet on Arc</p>
        </div>
        <div className="flex size-11 items-center justify-center rounded-2xl"
          style={{ background: 'var(--accent)', boxShadow: '0 4px 16px rgba(79,110,247,0.3)' }}>
          <Send className="size-5" style={{ color: '#fff' }} />
        </div>
      </div>

      {/* Balance card */}
      {address && balance !== undefined && (
        <motion.div
          className="flex items-center gap-3 rounded-2xl px-4 py-3.5"
          style={{ background: 'linear-gradient(135deg,rgba(79,110,247,0.1),rgba(79,110,247,0.04))', border: '1px solid rgba(79,110,247,0.15)', borderRadius: '16px' }}
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <div className="flex size-9 items-center justify-center rounded-xl"
            style={{ background: 'var(--accent)', boxShadow: '0 2px 8px rgba(79,110,247,0.25)' }}>
            <Wallet className="size-4" style={{ color: '#fff' }} />
          </div>
          <div className="flex-1">
            <p className="text-xs" style={{ color: 'var(--muted)' }}>Available balance</p>
            <p className="display text-lg font-bold tabular-nums" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
              {fmt(balance)} <span className="text-sm font-normal" style={{ color: 'var(--muted)' }}>USDC</span>
            </p>
          </div>
          <TokenUSDC variant="branded" size={28} />
        </motion.div>
      )}

      {/* Prefill warning */}
      {urlP.get('to') && (
        <div className="flex items-start gap-2.5 rounded-2xl px-4 py-3 text-xs font-medium"
          style={{ background: 'var(--warning-bg)', color: 'var(--warning)', border: '1px solid var(--warning-border)', borderRadius: '14px' }}>
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>This payment was pre-filled from a link. Verify the recipient before sending.</span>
        </div>
      )}

      {/* Recipient */}
      <div className="flex flex-col gap-1.5" style={glass.card}>
        <div className="px-4 pt-4 pb-2">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>Recipient</p>
          <div className="flex items-center gap-2">
            <input
              value={to}
              onChange={e => { setTo(e.target.value); setApproveDone(false) }}
              placeholder="0x… wallet address"
              className="mono flex-1 bg-transparent text-sm outline-none placeholder:opacity-30"
              style={{ color: toValid || !to ? 'var(--ink)' : 'var(--danger)' }}
            />
            {to && toValid && (
              <div className="flex size-6 items-center justify-center rounded-full" style={{ background: 'var(--success-bg)' }}>
                <CheckCircle2 className="size-4" style={{ color: 'var(--success)' }} />
              </div>
            )}
            <button
              onClick={() => { void navigator.clipboard.readText().then(t => { setTo(t.trim()); setApproveDone(false) }).catch(() => {}) }}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all hover:scale-105"
              style={{ background: 'var(--surface-muted)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
              <Copy className="size-3" /> Paste
            </button>
          </div>
          {to && !toValid && (
            <p className="text-xs mt-1.5 flex items-center gap-1" style={{ color: 'var(--danger)' }}>
              <AlertTriangle className="size-3" /> Invalid address
            </p>
          )}
        </div>
      </div>

      {/* Amount */}
      <div style={glass.card}>
        <div className="px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>Amount</p>
          <div className="flex items-center gap-3">
            <TokenUSDC variant="branded" size={28} />
            <input
              inputMode="decimal"
              value={amount}
              onChange={e => { setAmount(e.target.value.replace(/[^0-9.]/g, '')); setApproveDone(false) }}
              placeholder="0.00"
              className="display flex-1 bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:opacity-20"
              style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}
            />
            <span className="text-base font-semibold" style={{ color: 'var(--subtle)' }}>USDC</span>
          </div>
          {exceedsBalance && (
            <p className="mt-2 text-xs flex items-center gap-1" style={{ color: 'var(--danger)' }}>
              <AlertTriangle className="size-3" /> Exceeds your balance
            </p>
          )}
        </div>
        {/* Quick amount chips */}
        <div className="px-4 pb-4 flex flex-wrap gap-2" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="w-full text-xs pt-3 pb-1" style={{ color: 'var(--subtle)' }}>Quick amounts</p>
          {QUICK_AMOUNTS.map(q => (
            <button key={q} onClick={() => { setAmount(q); setApproveDone(false) }}
              className="rounded-xl px-3 py-1.5 text-xs font-semibold transition-all hover:scale-105 active:scale-95"
              style={{
                background: amount === q ? 'var(--accent)' : 'var(--surface-muted)',
                color: amount === q ? '#fff' : 'var(--ink-2)',
                border: amount === q ? 'none' : '1px solid var(--border)',
              }}>
              ${q}
            </button>
          ))}
          {balance !== undefined && balance > 0n && (
            <button onClick={() => { setAmount(fmt(balance)); setApproveDone(false) }}
              className="rounded-xl px-3 py-1.5 text-xs font-semibold transition-all hover:scale-105 active:scale-95"
              style={{
                background: amount === fmt(balance) ? 'var(--accent)' : 'var(--accent-light)',
                color: amount === fmt(balance) ? '#fff' : 'var(--accent)',
                border: `1px solid rgba(79,110,247,0.2)`,
              }}>
              Max
            </button>
          )}
        </div>
      </div>

      {/* Memo */}
      <div className="px-4 py-3.5" style={glass.inner}>
        <p className="text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--muted)' }}>
          Memo <span style={{ color: 'var(--subtle)', textTransform: 'none', letterSpacing: 'normal', fontWeight: 400 }}>(optional)</span>
        </p>
        <input value={memo} onChange={e => setMemo(e.target.value)} maxLength={80}
          placeholder="e.g. Rent – October, dinner, etc."
          className="w-full bg-transparent text-sm outline-none placeholder:opacity-30"
          style={{ color: 'var(--ink)' }} />
      </div>

      {/* CTA */}
      <button
        onClick={() => setStep('confirm')}
        disabled={!sendValid || exceedsBalance || !address}
        className="w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: 'var(--accent)', color: '#fff', boxShadow: sendValid ? '0 4px 20px rgba(79,110,247,0.3)' : 'none' }}>
        <span>Review send</span>
        <ArrowRight className="size-5" />
      </button>

      {/* Scan address hint */}
      <p className="text-center text-xs flex items-center justify-center gap-1.5" style={{ color: 'var(--subtle)' }}>
        <ScanLine className="size-3.5" />
        You can also scan a QR code from the Receive tab to auto-fill the address
      </p>
    </motion.div>
  )
}
