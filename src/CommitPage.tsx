/**
 * CommitPage: put idle USDC to work in a Morpho vault on Arc, and take it back out.
 * Fairtab never holds the money. You deposit straight into the vault from your own wallet,
 * and confirm every transaction yourself.
 */

import { useEffect, useState } from 'react'
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { useQuery, useQueries } from '@tanstack/react-query'
import { erc20Abi, formatUnits, parseAbi, parseUnits } from 'viem'
import { AlertTriangle, Info, Loader2, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { arcMainnetChain, IS_MAINNET } from '@/config'
import { getUsdc } from '@/onchain-facts'
import { COMMIT_ROUTER_ABI, COMMIT_ROUTER_ADDRESS } from '@/commitRouter'

const CHAIN_ID = arcMainnetChain.id
const MIN_DEPOSIT = 100_000n          // 0.10 USDC
const MAX_DEPOSIT = 1_000_000_000n    // 1,000 USDC
const GAS_BUFFER = 100_000n           // keep 0.10 USDC for network fees

const VAULTS = [
  { id: 'steakhouse', name: 'Steakhouse Prime USDC', curator: 'Steakhouse Financial', address: '0xbeef0016cb2Fd5C352ea7CA08a9f54739DFa7298' as const },
  { id: 'galaxy', name: 'Galaxy USDC', curator: 'Galaxy Curation', address: '0x8E357432CC12ff425c36432F312968aEb16112AF' as const },
]

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

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow-sm)' } as React.CSSProperties
const fmt = (raw: bigint) => Number(formatUnits(raw, 6)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface LiveVault { address: string; apy: number | null; liquidity: string | null; totalAssets: string | null }

function parseAmount(text: string): bigint | null {
  if (!/^\d+(\.\d{1,6})?$/.test(text.trim())) return null
  try { return parseUnits(text.trim(), 6) } catch { return null }
}

function errorText(err: Error): string {
  const m = err.message ?? ''
  if (/user rejected|denied|cancel/i.test(m)) return 'Cancelled.'
  return (m.split('Details:')[1] ?? m).trim().slice(0, 180)
}

export function CommitPage() {
  const { address } = useAccount()
  const usdc = getUsdc(CHAIN_ID)?.address as `0x${string}` | undefined
  const [vaultId, setVaultId] = useState(VAULTS[0].id)
  const [mode, setMode] = useState<'commit' | 'withdraw'>('commit')
  const [amountText, setAmountText] = useState('')
  const [pendingMsg, setPendingMsg] = useState('')
  const vault = VAULTS.find(v => v.id === vaultId) ?? VAULTS[0]

  const { data: live, isError: liveFailed } = useQuery({
    queryKey: ['commit-live'],
    queryFn: async () => {
      const r = await fetch('/api/commit/vaults')
      if (!r.ok) throw new Error('unavailable')
      return (await r.json() as { vaults: LiveVault[] }).vaults
    },
    refetchInterval: 60_000,
    retry: 1,
  })
  const liveFor = (addr: string) => live?.find(v => v.address.toLowerCase() === addr.toLowerCase())
  const liveSel = liveFor(vault.address)
  const liquidity = liveSel?.liquidity ? BigInt(liveSel.liquidity) : null

  const enabled = !!address && !!usdc && IS_MAINNET

  // What this wallet has put in and taken out of each vault, so we can show what it earned
  const historyQueries = useQueries({
    queries: VAULTS.map(v => ({
      queryKey: ['commit-history', address, v.address],
      enabled: !!address && IS_MAINNET,
      refetchInterval: 60_000,
      retry: 1,
      queryFn: async () => {
        const r = await fetch(`/api/commit/yield?address=${address}&vault=${v.address}`)
        if (!r.ok) throw new Error('unavailable')
        const j = await r.json() as { deposited: string; withdrawn: string; complete: boolean }
        return { deposited: BigInt(j.deposited), withdrawn: BigInt(j.withdrawn), complete: j.complete }
      },
    })),
  })
  const vaultIndex = VAULTS.findIndex(v => v.id === vaultId)
  const historySel = historyQueries[vaultIndex]?.data
  const { data: walletUsdc, refetch: refetchWallet } = useReadContract({
    address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`], chainId: CHAIN_ID, query: { enabled },
  })
  const { data: shares, refetch: refetchShares } = useReadContract({
    address: vault.address, abi: vaultAbi, functionName: 'balanceOf', args: [address as `0x${string}`], chainId: CHAIN_ID,
    query: { enabled, refetchInterval: 3000 },
  })
  // Vaults earn a little on every block (about every half second). Reading the vault's total every 500 ms
  // lets the earned figure move live. Polling pauses while the tab is hidden.
  const { data: vaultAssets } = useReadContract({
    address: vault.address, abi: vaultAbi, functionName: 'totalAssets', chainId: CHAIN_ID, query: { enabled, refetchInterval: 500 },
  })
  const { data: vaultSupply } = useReadContract({
    address: vault.address, abi: vaultAbi, functionName: 'totalSupply', chainId: CHAIN_ID, query: { enabled, refetchInterval: 10_000 },
  })
  // Your share of the vault in units of 0.000000000001 USDC (six more digits than the token itself)
  const committedPrecise = shares !== undefined && vaultAssets !== undefined && vaultSupply !== undefined && vaultSupply > 0n
    ? (shares * vaultAssets * 1_000_000n) / vaultSupply
    : undefined
  const { data: committed, refetch: refetchCommitted } = useReadContract({
    address: vault.address, abi: vaultAbi, functionName: 'convertToAssets', args: [shares ?? 0n], chainId: CHAIN_ID, query: { enabled: enabled && shares !== undefined },
  })
  // With the router set up, deposits go through it (it takes the fee); otherwise straight to the vault
  const spender = COMMIT_ROUTER_ADDRESS ?? vault.address
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: usdc, abi: erc20Abi, functionName: 'allowance', args: [address as `0x${string}`, spender], chainId: CHAIN_ID, query: { enabled },
  })
  const { data: feeBpsRead } = useReadContract({
    address: COMMIT_ROUTER_ADDRESS, abi: COMMIT_ROUTER_ABI, functionName: 'feeBps', chainId: CHAIN_ID, query: { enabled: !!COMMIT_ROUTER_ADDRESS },
  })
  const feeBps = COMMIT_ROUTER_ADDRESS && feeBpsRead !== undefined ? BigInt(feeBpsRead) : 0n

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

  if (!IS_MAINNET) {
    return (
      <div className="p-5 flex flex-col gap-2" style={card}>
        <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Commit is available on Arc Mainnet</p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>These vaults only exist on mainnet, so there is nothing to commit to on the test network.</p>
      </div>
    )
  }

  const busy = signing || confirming
  const wallet = walletUsdc ?? 0n
  const myCommitted = committed ?? 0n
  const maxDeposit = wallet > GAS_BUFFER ? (wallet - GAS_BUFFER < MAX_DEPOSIT ? wallet - GAS_BUFFER : MAX_DEPOSIT) : 0n
  const maxWithdraw = liquidity !== null && liquidity < myCommitted ? liquidity : myCommitted
  const needsApprove = mode === 'commit' && amount !== null && (allowance ?? 0n) < amount

  let problem = ''
  if (amountText && amount === null) problem = 'Enter a plain number such as 25 or 12.5.'
  else if (amount !== null && mode === 'commit') {
    if (amount < MIN_DEPOSIT) problem = 'The minimum is 0.10 USDC.'
    else if (amount > MAX_DEPOSIT) problem = 'The maximum per deposit is 1,000 USDC.'
    else if (amount > maxDeposit) problem = 'That is more than your wallet holds (a little USDC is kept for network fees).'
  } else if (amount !== null && mode === 'withdraw') {
    if (amount === 0n) problem = 'Enter an amount.'
    else if (amount > myCommitted) problem = 'That is more than you have committed.'
    else if (liquidity !== null && amount > liquidity) problem = `Only ${fmt(liquidity)} USDC can be withdrawn from this vault right now.`
  }
  const canGo = !!address && amount !== null && !problem && !busy && amount > 0n

  const go = () => {
    if (!address || !usdc || amount === null) return
    if (mode === 'commit') {
      if (needsApprove) {
        setPendingMsg('Approved. Now press Commit to finish.')
        writeContract({ address: usdc, abi: erc20Abi, functionName: 'approve', args: [spender, amount] })
      } else if (COMMIT_ROUTER_ADDRESS) {
        // Accept up to 0.5% fewer shares than the vault quoted, otherwise stop
        const minShares = expectedShares !== undefined ? (expectedShares * 995n) / 1000n : 0n
        setPendingMsg(`Committed ${fmt(net)} USDC`)
        writeContract({ address: COMMIT_ROUTER_ADDRESS, abi: COMMIT_ROUTER_ABI, functionName: 'commit', args: [vault.address, amount, minShares] })
      } else {
        setPendingMsg(`Committed ${fmt(amount)} USDC`)
        writeContract({ address: vault.address, abi: vaultAbi, functionName: 'deposit', args: [amount, address] })
      }
    } else {
      setPendingMsg(`Withdrew ${fmt(amount)} USDC`)
      const everything = amount >= myCommitted && shares !== undefined && shares > 0n
      if (everything) writeContract({ address: vault.address, abi: vaultAbi, functionName: 'redeem', args: [shares, address, address] })
      else writeContract({ address: vault.address, abi: vaultAbi, functionName: 'withdraw', args: [amount, address, address] })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>Commit</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Put idle USDC to work and earn yield. Withdraw whenever the vault has the funds available.</p>
      </div>

      <div className="p-4 flex flex-col gap-2" style={{ ...card, background: 'var(--warning-bg)', border: '1px solid var(--warning)' }}>
        <p className="flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--ink)' }}><AlertTriangle className="size-3.5" /> Read this first</p>
        <ul className="text-xs leading-relaxed list-disc pl-4" style={{ color: 'var(--ink-2)' }}>
          <li>Your USDC goes into a lending vault run by a third party, not by Fairtab. Fairtab never holds it and cannot recover it.</li>
          <li>The yield is variable and not guaranteed. You can lose money if a borrower or the vault fails.</li>
          <li>Most of a vault's USDC is lent out. If many people withdraw, you may have to wait until borrowers repay.</li>
          <li>This is real money on Arc Mainnet. Start small. Each deposit must be between 0.10 and 1,000 USDC.</li>
        </ul>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {VAULTS.map(v => {
          const l = liveFor(v.address)
          const active = v.id === vaultId
          return (
            <button key={v.id} onClick={() => { setVaultId(v.id); setAmountText('') }} className="text-left p-4 flex flex-col gap-1.5"
              style={{ ...card, border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent-light)' : 'var(--surface)' }}>
              <span className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--ink)' }}><TrendingUp className="size-4" style={{ color: 'var(--accent)' }} />{v.name}</span>
              <span className="text-[11px]" style={{ color: 'var(--muted)' }}>Curated by {v.curator} · Morpho</span>
              <span className="text-xs" style={{ color: 'var(--ink-2)' }}>
                Yield <strong>{l?.apy != null ? `${(l.apy * 100).toFixed(2)}%` : '…'}</strong> a year
              </span>
              <span className="text-xs" style={{ color: 'var(--ink-2)' }}>
                Available to withdraw now <strong>{l?.liquidity ? `${fmt(BigInt(l.liquidity))} USDC` : '…'}</strong>
              </span>
            </button>
          )
        })}
      </div>

      {!address ? (
        <div className="p-4 text-sm" style={{ ...card, color: 'var(--muted)' }}>Sign in with a wallet that can approve transactions to commit USDC.</div>
      ) : (
        <div className="p-4 flex flex-col gap-3.5" style={card}>
          <EarnedSummary committed={myCommitted} committedPrecise={committedPrecise} history={historySel} complete={historySel?.complete ?? false} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>In your wallet</p>
              <p className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>{fmt(wallet)} USDC</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Committed here</p>
              <p className="display text-lg font-bold tabular-nums" style={{ color: 'var(--success)' }}>
                {committedPrecise !== undefined ? Number(formatUnits(committedPrecise, 12)).toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 }) : fmt(myCommitted)} USDC
              </p>
            </div>
          </div>

          <div className="flex rounded-xl p-1 gap-1" style={{ background: 'var(--surface-muted)' }}>
            {(['commit', 'withdraw'] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setAmountText('') }} className="flex-1 rounded-lg py-2 text-xs font-bold"
                style={{ background: mode === m ? 'var(--accent)' : 'transparent', color: mode === m ? '#fff' : 'var(--subtle)' }}>
                {m === 'commit' ? 'Commit' : 'Withdraw'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            <input value={amountText} onChange={e => setAmountText(e.target.value)} inputMode="decimal" placeholder="0.00" disabled={busy}
              className="display flex-1 min-w-0 bg-transparent text-2xl font-bold outline-none" style={{ color: 'var(--ink)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--subtle)' }}>USDC</span>
            <button type="button" disabled={busy} onClick={() => setAmountText(formatUnits(mode === 'commit' ? maxDeposit : maxWithdraw, 6))}
              className="rounded-lg px-2.5 py-1 text-xs font-bold" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>Max</button>
          </div>

          {mode === 'withdraw' && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              {liquidity !== null ? `You can withdraw up to ${fmt(maxWithdraw)} USDC right now.` : liveFailed ? 'Live availability could not be loaded. A withdrawal can be refused if the vault does not have enough free funds.' : 'Checking what is available…'}
              {liquidity !== null && myCommitted > liquidity && ' The rest becomes available as borrowers repay.'}
            </p>
          )}
          {mode === 'commit' && amount !== null && amount >= MIN_DEPOSIT && feeBps > 0n && (
            <div className="rounded-xl px-3.5 py-2.5 text-xs flex flex-col gap-1" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}>
              <span className="flex justify-between"><span>Fairtab fee ({(Number(feeBps) / 100).toFixed(2)}%, charged once)</span><strong>{fmt(fee)} USDC</strong></span>
              <span className="flex justify-between"><span>Goes into the vault</span><strong>{fmt(net)} USDC</strong></span>
            </div>
          )}
          {problem && <p className="text-xs" style={{ color: 'var(--danger)' }}>{problem}</p>}

          <button disabled={!canGo} onClick={go} className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>
            {busy ? <><Loader2 className="size-4 animate-spin" /> Confirming…</>
              : mode === 'withdraw' ? 'Withdraw'
              : needsApprove ? 'Step 1 of 2: allow this amount' : 'Commit'}
          </button>
          <p className="flex items-start gap-1.5 text-[11px]" style={{ color: 'var(--subtle)' }}>
            <Info className="size-3 shrink-0 mt-0.5" /> {feeBps > 0n ? `Fairtab takes a ${(Number(feeBps) / 100).toFixed(2)}% fee when you commit, and nothing when you withdraw.` : 'Fairtab charges no fee.'} Network fees are paid in USDC. Figures like yield and availability come from Morpho and change often.
          </p>
        </div>
      )}
    </div>
  )
}

/** Shows how much you put in and how much it has grown. Hidden when there is no history to base it on. */
function EarnedSummary({ committed, committedPrecise, history, complete }: {
  committed: bigint
  committedPrecise: bigint | undefined
  history: { deposited: bigint; withdrawn: bigint } | undefined
  complete: boolean
}) {
  if (!history) return null
  const { deposited, withdrawn } = history
  if (deposited === 0n && withdrawn === 0n) {
    return committed > 0n ? (
      <p className="text-xs" style={{ color: 'var(--muted)' }}>Your history is still loading, so earnings are not shown yet.</p>
    ) : null
  }
  // Everything you have ever taken out plus what is still there, minus everything you put in.
  // Worked out with six extra digits so it can move with every block.
  const scale = 1_000_000n
  const nowValue = committedPrecise ?? committed * scale
  const earned = nowValue + (withdrawn - deposited) * scale
  const stillIn = deposited > withdrawn ? deposited - withdrawn : 0n
  const positive = earned >= 0n
  const abs = positive ? earned : -earned
  const pct = deposited > 0n ? (Number(earned) / Number(deposited * scale)) * 100 : 0
  const shown = formatUnits(abs, 12)
  const [whole, frac = ''] = shown.split('.')
  const text = `${positive ? '+' : '-'}${whole}.${frac.padEnd(8, '0').slice(0, 8)}`
  return (
    <div className="rounded-xl px-3.5 py-3 flex flex-col gap-1.5" style={{ background: positive ? 'var(--success-bg)' : 'var(--danger-bg)' }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Earned so far · live</span>
        <span className="display text-lg font-bold tabular-nums" style={{ color: positive ? 'var(--success)' : 'var(--danger)' }}>{text} USDC</span>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--ink-2)' }}>
        You put in {fmt(deposited)} USDC{withdrawn > 0n ? ` and took out ${fmt(withdrawn)}` : ''}. {stillIn > 0n ? `About ${fmt(stillIn)} of that is still committed. ` : ''}
        {pct !== 0 ? `That is ${pct > 0 ? '+' : ''}${pct.toFixed(4)}% on what you put in.` : ''}
      </p>
      <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>Updates with every block. USDC itself only has 6 decimals, so the extra digits are shown to see it grow.</p>
      {!complete && <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>Older history could not be loaded, so this may be incomplete.</p>}
    </div>
  )
}
