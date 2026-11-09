/**
 * The panel that opens when you pick a vault on the Commit tab: commit, withdraw, and see what you earned.
 * Fairtab never holds the money. You deposit straight from your own wallet and confirm every transaction.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { erc20Abi, formatUnits, parseAbi, parseUnits } from 'viem'
import { Info, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { TokenEURC, TokenUSDC } from '@web3icons/react'
import { arcMainnetChain } from '@/config'
import { getUsdc } from '@/onchain-facts'
import { COMMIT_ROUTER_ABI, COMMIT_ROUTER_BY_ASSET } from '@/commitRouter'
import { EURC_ADDRESS, type VaultInfo } from '@/commitVaults'

const CHAIN_ID = arcMainnetChain.id
const MIN_DEPOSIT = 100_000n          // 0.10
const MAX_DEPOSIT = 1_000_000_000n    // 1,000
const GAS_BUFFER = 100_000n           // keep 0.10 USDC for network fees (USDC is the gas token on Arc)

export interface LiveVault {
  address: string; apy: number | null; liquidity: string | null; totalAssets: string | null
  tvlUsd: number | null; liquidityUsd: number | null
}

const vaultAbi = parseAbi([
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)',
  'function balanceOf(address account) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function previewDeposit(uint256 assets) view returns (uint256 shares)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
])

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16 } as React.CSSProperties
const fmt = (raw: bigint) => Number(formatUnits(raw, 6)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function parseAmount(text: string): bigint | null {
  if (!/^\d+(\.\d{1,6})?$/.test(text.trim())) return null
  try { return parseUnits(text.trim(), 6) } catch { return null }
}
function errorText(err: Error): string {
  const m = err.message ?? ''
  if (/user rejected|denied|cancel/i.test(m)) return 'Cancelled.'
  return (m.split('Details:')[1] ?? m).trim().slice(0, 180)
}

export function CommitVaultSheet({ vault, live, liveFailed, onClose }: { vault: VaultInfo; live: LiveVault | undefined; liveFailed: boolean; onClose: () => void }) {
  const { address } = useAccount()
  const symbol = vault.asset
  const token = (symbol === 'USDC' ? getUsdc(CHAIN_ID)?.address : EURC_ADDRESS) as `0x${string}` | undefined
  const gasBuffer = symbol === 'USDC' ? GAS_BUFFER : 0n
  const [mode, setMode] = useState<'commit' | 'withdraw'>('commit')
  const [amountText, setAmountText] = useState('')
  const [pendingMsg, setPendingMsg] = useState('')
  const enabled = !!address && !!token
  const liquidity = live?.liquidity ? BigInt(live.liquidity) : null

  // Deposits go through the Fairtab router only if it was deployed with this vault; otherwise straight to the vault
  const routerCandidate = COMMIT_ROUTER_BY_ASSET[symbol]
  const { data: routerAllows } = useReadContract({
    address: routerCandidate, abi: COMMIT_ROUTER_ABI, functionName: 'isAllowedVault', args: [vault.address], chainId: CHAIN_ID,
    query: { enabled: !!routerCandidate },
  })
  const router = routerCandidate && routerAllows === true ? routerCandidate : undefined
  const spender = router ?? vault.address

  const { data: history } = useQuery({
    queryKey: ['commit-history', address, vault.address],
    enabled: !!address, refetchInterval: 60_000, retry: 1,
    queryFn: async () => {
      const r = await fetch(`/api/commit/yield?address=${address}&vault=${vault.address}`)
      if (!r.ok) throw new Error('unavailable')
      const j = await r.json() as { deposited: string; withdrawn: string; complete: boolean }
      return { deposited: BigInt(j.deposited), withdrawn: BigInt(j.withdrawn), complete: j.complete }
    },
  })

  const { data: walletBal, refetch: refetchWallet } = useReadContract({
    address: token, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`], chainId: CHAIN_ID, query: { enabled },
  })
  const { data: shares, refetch: refetchShares } = useReadContract({
    address: vault.address, abi: vaultAbi, functionName: 'balanceOf', args: [address as `0x${string}`], chainId: CHAIN_ID, query: { enabled, refetchInterval: 3000 },
  })
  // The vault earns a little on every block, so reading its total every 500 ms lets the earned figure move live
  const { data: vaultAssets } = useReadContract({
    address: vault.address, abi: vaultAbi, functionName: 'totalAssets', chainId: CHAIN_ID, query: { enabled, refetchInterval: 500 },
  })
  const { data: vaultSupply } = useReadContract({
    address: vault.address, abi: vaultAbi, functionName: 'totalSupply', chainId: CHAIN_ID, query: { enabled, refetchInterval: 10_000 },
  })
  const committedPrecise = shares !== undefined && vaultAssets !== undefined && vaultSupply !== undefined && vaultSupply > 0n
    ? (shares * vaultAssets * 1_000_000n) / vaultSupply : undefined
  const { data: committed, refetch: refetchCommitted } = useReadContract({
    address: vault.address, abi: vaultAbi, functionName: 'convertToAssets', args: [shares ?? 0n], chainId: CHAIN_ID, query: { enabled: enabled && shares !== undefined },
  })
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: token, abi: erc20Abi, functionName: 'allowance', args: [address as `0x${string}`, spender], chainId: CHAIN_ID, query: { enabled },
  })
  const { data: feeBpsRead } = useReadContract({
    address: router, abi: COMMIT_ROUTER_ABI, functionName: 'feeBps', chainId: CHAIN_ID, query: { enabled: !!router },
  })
  const feeBps = router && feeBpsRead !== undefined ? BigInt(feeBpsRead) : 0n

  const { writeContract, data: hash, isPending: signing, reset } = useWriteContract({
    mutation: { onError: err => { toast.error(errorText(err)); setPendingMsg('') } },
  })
  const { isSuccess: confirmed, isLoading: confirming } = useWaitForTransactionReceipt({ hash })
  useEffect(() => {
    if (!confirmed) return
    toast.success(pendingMsg || 'Done')
    void refetchWallet(); void refetchShares(); void refetchCommitted(); void refetchAllowance()
    reset()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed])

  const amount = parseAmount(amountText)
  const fee = amount !== null ? (amount * feeBps) / 10_000n : 0n
  const net = amount !== null ? amount - fee : 0n
  const { data: expectedShares } = useReadContract({
    address: vault.address, abi: vaultAbi, functionName: 'previewDeposit', args: [net], chainId: CHAIN_ID,
    query: { enabled: enabled && mode === 'commit' && net > 0n },
  })

  const busy = signing || confirming
  const wallet = walletBal ?? 0n
  const myCommitted = committed ?? 0n
  const maxDeposit = wallet > gasBuffer ? (wallet - gasBuffer < MAX_DEPOSIT ? wallet - gasBuffer : MAX_DEPOSIT) : 0n
  const maxWithdraw = liquidity !== null && liquidity < myCommitted ? liquidity : myCommitted
  const needsApprove = mode === 'commit' && amount !== null && (allowance ?? 0n) < amount

  let problem = ''
  if (amountText && amount === null) problem = 'Enter a plain number such as 25 or 12.5.'
  else if (amount !== null && mode === 'commit') {
    if (amount < MIN_DEPOSIT) problem = `The minimum is 0.10 ${symbol}.`
    else if (amount > MAX_DEPOSIT) problem = `The maximum per deposit is 1,000 ${symbol}.`
    else if (amount > maxDeposit) problem = symbol === 'USDC' ? 'That is more than your wallet holds (a little USDC is kept for network fees).' : `That is more than your wallet holds.`
  } else if (amount !== null && mode === 'withdraw') {
    if (amount === 0n) problem = 'Enter an amount.'
    else if (amount > myCommitted) problem = 'That is more than you have committed.'
    else if (liquidity !== null && amount > liquidity) problem = `Only ${fmt(liquidity)} ${symbol} can be withdrawn from this vault right now.`
  }
  const canGo = !!address && amount !== null && !problem && !busy && amount > 0n

  const go = () => {
    if (!address || !token || amount === null) return
    if (mode === 'commit') {
      if (needsApprove) {
        setPendingMsg('Approved. Now press Commit to finish.')
        writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [spender, amount] })
      } else if (router) {
        const minShares = expectedShares !== undefined ? (expectedShares * 995n) / 1000n : 0n
        setPendingMsg(`Committed ${fmt(net)} ${symbol}`)
        writeContract({ address: router, abi: COMMIT_ROUTER_ABI, functionName: 'commit', args: [vault.address, amount, minShares] })
      } else {
        setPendingMsg(`Committed ${fmt(amount)} ${symbol}`)
        writeContract({ address: vault.address, abi: vaultAbi, functionName: 'deposit', args: [amount, address] })
      }
    } else {
      setPendingMsg(`Withdrew ${fmt(amount)} ${symbol}`)
      const everything = amount >= myCommitted && shares !== undefined && shares > 0n
      if (everything) writeContract({ address: vault.address, abi: vaultAbi, functionName: 'redeem', args: [shares, address, address] })
      else writeContract({ address: vault.address, abi: vaultAbi, functionName: 'withdraw', args: [amount, address, address] })
    }
  }

  const Icon = symbol === 'USDC' ? TokenUSDC : TokenEURC
  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label={vault.name}>
      <button className="absolute inset-0" style={{ background: 'rgba(8,14,40,0.55)' }} onClick={onClose} aria-label="Close" />
      <div className="relative flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto p-5 sm:rounded-l-3xl" style={{ background: typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? '#0b1a4a' : '#ffffff', borderLeft: '1px solid var(--border)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Icon variant="branded" size={36} />
            <div className="min-w-0">
              <h3 className="display text-lg font-bold leading-tight" style={{ color: 'var(--ink)' }}>{vault.name}</h3>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Curated by {vault.curator} · Morpho · Arc</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-xl p-2" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}><X className="size-4" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3" style={card}>
            <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>APY</p>
            <p className="display text-2xl font-bold" style={{ color: 'var(--success)' }}>{live?.apy != null ? `${(live.apy * 100).toFixed(2)}%` : '…'}</p>
          </div>
          <div className="p-3" style={card}>
            <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Withdrawable now</p>
            <p className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>{liquidity !== null ? fmt(liquidity) : '…'}</p>
          </div>
        </div>

        {!address ? (
          <div className="p-4 text-sm" style={{ ...card, color: 'var(--muted)' }}>Sign in with a wallet that can approve transactions to commit {symbol}.</div>
        ) : (
          <div className="flex flex-col gap-3.5">
            <EarnedSummary symbol={symbol} committed={myCommitted} committedPrecise={committedPrecise} history={history} complete={history?.complete ?? false} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>In your wallet</p>
                <p className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>{fmt(wallet)} {symbol}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Committed here</p>
                <p className="display text-lg font-bold tabular-nums" style={{ color: 'var(--success)' }}>
                  {committedPrecise !== undefined ? Number(formatUnits(committedPrecise, 12)).toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 }) : fmt(myCommitted)} {symbol}
                </p>
              </div>
            </div>

            <div className="flex rounded-xl p-1 gap-1" style={{ background: 'var(--surface-muted)' }}>
              {(['commit', 'withdraw'] as const).map(m => (
                <button key={m} onClick={() => { setMode(m); setAmountText('') }} className="flex-1 rounded-lg py-2 text-xs font-bold"
                  style={{ background: mode === m ? 'var(--accent-fill)' : 'transparent', color: mode === m ? '#fff' : 'var(--subtle)' }}>
                  {m === 'commit' ? 'Commit' : 'Withdraw'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
              <input value={amountText} onChange={e => setAmountText(e.target.value)} inputMode="decimal" placeholder="0.00" disabled={busy}
                className="display flex-1 min-w-0 bg-transparent text-2xl font-bold outline-none" style={{ color: 'var(--ink)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--subtle)' }}>{symbol}</span>
              <button type="button" disabled={busy} onClick={() => setAmountText(formatUnits(mode === 'commit' ? maxDeposit : maxWithdraw, 6))}
                className="rounded-lg px-2.5 py-1 text-xs font-bold" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>Max</button>
            </div>

            {mode === 'withdraw' && (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {liquidity !== null ? `You can withdraw up to ${fmt(maxWithdraw)} ${symbol} right now.` : liveFailed ? 'Live availability could not be loaded. A withdrawal can be refused if the vault does not have enough free funds.' : 'Checking what is available…'}
                {liquidity !== null && myCommitted > liquidity && ' The rest becomes available as borrowers repay.'}
              </p>
            )}
            {mode === 'commit' && amount !== null && amount >= MIN_DEPOSIT && feeBps > 0n && (
              <div className="rounded-xl px-3.5 py-2.5 text-xs flex flex-col gap-1" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}>
                <span className="flex justify-between"><span>Fairtab fee ({(Number(feeBps) / 100).toFixed(2)}%, charged once)</span><strong>{fmt(fee)} {symbol}</strong></span>
                <span className="flex justify-between"><span>Goes into the vault</span><strong>{fmt(net)} {symbol}</strong></span>
              </div>
            )}
            {problem && <p className="text-xs" style={{ color: 'var(--danger)' }}>{problem}</p>}

            <button disabled={!canGo} onClick={go} className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-40" style={{ background: 'var(--accent-fill)', color: '#fff' }}>
              {busy ? <><Loader2 className="size-4 animate-spin" /> Confirming…</>
                : mode === 'withdraw' ? 'Withdraw'
                : needsApprove ? 'Step 1 of 2: allow this amount' : 'Commit'}
            </button>
            <p className="flex items-start gap-1.5 text-[11px]" style={{ color: 'var(--subtle)' }}>
              <Info className="size-3 shrink-0 mt-0.5" /> {feeBps > 0n ? `Fairtab takes a ${(Number(feeBps) / 100).toFixed(2)}% fee when you commit, and nothing when you withdraw.` : 'Fairtab charges no fee on this vault.'} Network fees are paid in USDC. Yield and availability come from Morpho and change often.
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** How much you put in and how much it has grown. Hidden when there is no history to base it on. */
function EarnedSummary({ symbol, committed, committedPrecise, history, complete }: {
  symbol: string; committed: bigint; committedPrecise: bigint | undefined
  history: { deposited: bigint; withdrawn: bigint } | undefined; complete: boolean
}) {
  if (!history) return null
  const { deposited, withdrawn } = history
  if (deposited === 0n && withdrawn === 0n) {
    return committed > 0n ? <p className="text-xs" style={{ color: 'var(--muted)' }}>Your history is still loading, so earnings are not shown yet.</p> : null
  }
  const scale = 1_000_000n
  const nowValue = committedPrecise ?? committed * scale
  const earned = nowValue + (withdrawn - deposited) * scale
  const stillIn = deposited > withdrawn ? deposited - withdrawn : 0n
  const positive = earned >= 0n
  const abs = positive ? earned : -earned
  const pct = deposited > 0n ? (Number(earned) / Number(deposited * scale)) * 100 : 0
  const [whole, frac = ''] = formatUnits(abs, 12).split('.')
  const text = `${positive ? '+' : '-'}${whole}.${frac.padEnd(8, '0').slice(0, 8)}`
  return (
    <div className="rounded-xl px-3.5 py-3 flex flex-col gap-1.5" style={{ background: positive ? 'var(--success-bg)' : 'var(--danger-bg)' }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Earned so far · live</span>
        <span className="display text-lg font-bold tabular-nums" style={{ color: positive ? 'var(--success)' : 'var(--danger)' }}>{text} {symbol}</span>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--ink-2)' }}>
        You put in {fmt(deposited)} {symbol}{withdrawn > 0n ? ` and took out ${fmt(withdrawn)}` : ''}. {stillIn > 0n ? `About ${fmt(stillIn)} of that is still committed. ` : ''}
        {pct !== 0 ? `That is ${pct > 0 ? '+' : ''}${pct.toFixed(4)}% on what you put in.` : ''}
      </p>
      <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>Updates with every block. {symbol} itself only has 6 decimals, so the extra digits are shown to see it grow.</p>
      {!complete && <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>Older history could not be loaded, so this may be incomplete.</p>}
    </div>
  )
}
