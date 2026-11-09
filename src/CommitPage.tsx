/**
 * Commit: put idle USDC or EURC to work in a Morpho vault on Arc, and take it back out.
 * Fairtab never holds the money. You deposit straight from your own wallet and confirm every transaction.
 */
import { useMemo, useState } from 'react'
import { useAccount, useReadContracts } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { formatUnits, parseAbi } from 'viem'
import { ArrowUpRight, TrendingUp } from 'lucide-react'
import { TokenEURC, TokenUSDC } from '@web3icons/react'
import { arcMainnetChain, IS_MAINNET } from '@/config'
import { COMMIT_VAULTS, type VaultAsset } from '@/commitVaults'
import { CommitVaultSheet, type LiveVault } from '@/CommitVaultSheet'

const CHAIN_ID = arcMainnetChain.id
const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20 } as React.CSSProperties
const readAbi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function totalAssets() view returns (uint256)', 'function totalSupply() view returns (uint256)'])
const usd = (n: number | null | undefined) => n == null ? '…' : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

function status(l: LiveVault | undefined): 'low' | 'ok' | 'unknown' {
  if (!l || l.liquidityUsd == null || l.tvlUsd == null) return 'unknown'
  return l.liquidityUsd < 1000 || l.liquidityUsd / Math.max(l.tvlUsd, 1) < 0.05 ? 'low' : 'ok'
}

export function CommitPage() {
  const { address } = useAccount()
  const [filter, setFilter] = useState<'all' | VaultAsset>('all')
  const [openId, setOpenId] = useState<string | null>(null)

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

  // What this wallet holds in each vault, worked out from its share of the vault
  const { data: reads } = useReadContracts({
    contracts: COMMIT_VAULTS.flatMap(v => [
      { address: v.address, abi: readAbi, functionName: 'balanceOf', args: [address as `0x${string}`], chainId: CHAIN_ID },
      { address: v.address, abi: readAbi, functionName: 'totalAssets', chainId: CHAIN_ID },
      { address: v.address, abi: readAbi, functionName: 'totalSupply', chainId: CHAIN_ID },
    ] as const),
    query: { enabled: !!address && IS_MAINNET, refetchInterval: 15_000 },
  })
  const position = (i: number): bigint => {
    const shares = reads?.[i * 3]?.result
    const ta = reads?.[i * 3 + 1]?.result
    const ts = reads?.[i * 3 + 2]?.result
    return shares && ta !== undefined && ts && ts > 0n ? (shares * ta) / ts : 0n
  }

  const bestId = useMemo(() => {
    let best: { id: string; apy: number } | null = null
    for (const v of COMMIT_VAULTS) {
      const l = live?.find(x => x.address.toLowerCase() === v.address.toLowerCase())
      if (l?.apy != null && status(l) === 'ok' && (!best || l.apy > best.apy)) best = { id: v.id, apy: l.apy }
    }
    return best
  }, [live])

  if (!IS_MAINNET) {
    return (
      <div className="p-5 flex flex-col gap-2" style={card}>
        <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Commit is available on Arc Mainnet</p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>These vaults only exist on mainnet, so there is nothing to commit to on the test network.</p>
      </div>
    )
  }

  const shown = COMMIT_VAULTS.filter(v => filter === 'all' || v.asset === filter)
  const open = COMMIT_VAULTS.find(v => v.id === openId)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="display text-3xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>Commit</h2>
        <p className="mt-1 text-sm font-medium" style={{ color: 'var(--accent)' }}>Put your idle USDC and EURC to work while keeping your funds accessible.</p>
      </div>

      <section className="relative overflow-hidden rounded-[28px] p-7 sm:p-9" style={{ background: 'linear-gradient(120deg,#1b46d6 0%,#2a3fe0 45%,#1a2a9c 100%)', color: '#fff' }}>
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full" style={{ background: 'radial-gradient(circle,rgba(255,255,255,0.22),transparent 65%)' }} />
        <p className="flex items-center gap-2 text-sm font-semibold opacity-90"><TrendingUp className="size-4" /> Commit your idle USDC and EURC</p>
        <p className="display mt-2 text-[2.2rem] font-bold leading-tight tracking-tight sm:text-5xl">
          Up to <span style={{ color: '#7dffb0' }}>{bestId ? `${(bestId.apy * 100).toFixed(2)}%` : '…'}</span> APY
        </p>
        <p className="mt-3 max-w-md text-sm leading-relaxed opacity-85">
          Pick a vault, commit from your own wallet, and withdraw whenever the vault has funds available. Fairtab never holds your money.
        </p>
        <button onClick={() => document.getElementById('vaults')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold" style={{ color: '#142a8a' }}>
          Start committing <ArrowUpRight className="size-4" />
        </button>
        <p className="mt-4 text-[11px] opacity-70">The rate shown is the best current rate among vaults with funds available to withdraw. Rates change and are not guaranteed.</p>
      </section>

      <section id="vaults" className="scroll-mt-24">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>Vaults</h3>
          <div className="flex items-center gap-2">
            {(['all', 'USDC', 'EURC'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} className="rounded-full px-3.5 py-1.5 text-xs font-bold"
                style={{ background: filter === f ? 'var(--accent-fill)' : 'var(--surface)', color: filter === f ? '#fff' : 'var(--ink-2)', border: '1px solid var(--border)' }}>
                {f === 'all' ? 'All' : f}
              </button>
            ))}
            <span className="ml-1 text-xs" style={{ color: 'var(--muted)' }}>{shown.length} on Arc</span>
          </div>
        </div>
        {liveFailed && <p className="mb-3 text-xs" style={{ color: 'var(--muted)' }}>Live rates could not be loaded right now.</p>}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map(v => {
            const l = liveFor(v.address)
            const st = status(l)
            const mine = position(COMMIT_VAULTS.indexOf(v))
            const isBest = bestId?.id === v.id
            const Icon = v.asset === 'USDC' ? TokenUSDC : TokenEURC
            const badge = st === 'low'
              ? { text: 'Low liquidity', bg: 'var(--warning-bg, rgba(245,158,11,0.15))', color: 'var(--warning, #b45309)' }
              : isBest ? { text: 'Best rate', bg: 'var(--success-bg)', color: 'var(--success)' }
              : st === 'ok' ? { text: 'Active', bg: 'var(--success-bg)', color: 'var(--success)' } : null
            return (
              <button key={v.id} onClick={() => setOpenId(v.id)} className="group flex flex-col gap-3 p-5 text-left transition-transform hover:-translate-y-0.5"
                style={{ ...card, boxShadow: 'var(--shadow-sm)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon variant="branded" size={28} />
                    <div className="min-w-0">
                      <p className="display text-base font-bold leading-snug" style={{ color: 'var(--ink)' }}>{v.name}</p>
                      <p className="text-[11px]" style={{ color: 'var(--muted)' }}>{v.curator}</p>
                    </div>
                  </div>
                  {badge && <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: badge.bg, color: badge.color }}>{badge.text}</span>}
                </div>
                <p className="display text-[2.4rem] font-bold leading-none tracking-tight" style={{ color: 'var(--success)' }}>
                  {l?.apy != null ? `${(l.apy * 100).toFixed(2)}%` : '…'} <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--muted)' }}>APY</span>
                </p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>{usd(l?.tvlUsd)} supplied · Morpho</p>
                {mine > 0n && (
                  <p className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
                    Your position: {Number(formatUnits(mine, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {v.asset}
                  </p>
                )}
              </button>
            )
          })}
        </div>
        <p className="mt-4 text-[11px]" style={{ color: 'var(--subtle)' }}>
          Vaults are run by third-party curators on Morpho. Yield is not guaranteed and withdrawals can wait when a vault has little free cash. Fairtab shows any fee before you confirm.
        </p>
      </section>

      {open && <CommitVaultSheet vault={open} live={liveFor(open.address)} liveFailed={liveFailed} onClose={() => setOpenId(null)} />}
    </div>
  )
}
