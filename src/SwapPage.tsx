/**
 * SwapPage: swap between the tokens Circle supports on Arc (USDC, EURC and cirBTC).
 * The quote comes from Circle's swap service, which routes through a third-party aggregator.
 * Your wallet signs every transaction. Fairtab never holds your tokens.
 */

import { useCallback, useState } from 'react'
import { useAccount, useReadContract, useSwitchChain } from 'wagmi'
import { erc20Abi, formatUnits, parseUnits } from 'viem'
import { AlertTriangle, ArrowDownUp, ExternalLink, Info, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { arcMainnetChain, IS_MAINNET } from '@/config'
import { buildTxExplorerUrl } from '@/onchain-facts'

const CHAIN_ID = arcMainnetChain.id

interface SwapToken { symbol: string; kit: 'USDC' | 'EURC' | 'CIRBTC'; address: `0x${string}`; decimals: number }
const TOKENS: SwapToken[] = [
  { symbol: 'USDC', kit: 'USDC', address: '0x3600000000000000000000000000000000000000', decimals: 6 },
  { symbol: 'EURC', kit: 'EURC', address: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1', decimals: 6 },
  { symbol: 'cirBTC', kit: 'CIRBTC', address: '0x171A4217b86A807A64eB94757Db6849fb4bDbAA0', decimals: 8 },
]
const SLIPPAGES = [{ bps: 50, label: '0.5%' }, { bps: 100, label: '1%' }, { bps: 300, label: '3%' }]
const GAS_RESERVE = 100_000n // keep 0.10 USDC for network fees when swapping all of your USDC
const BIG_AMOUNT_USD = 100

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow-sm)' } as React.CSSProperties

interface Quote {
  key: string
  out: string
  min: string | null
  outSymbol: string
  fees: Array<{ type: string; amount: string; token: string }>
}

function fmtUnits(raw: bigint, decimals: number, max = 6): string {
  const n = Number(formatUnits(raw, decimals))
  return n.toLocaleString(undefined, { minimumFractionDigits: Math.min(2, max), maximumFractionDigits: max })
}

function friendlyError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/user rejected|denied|cancel/i.test(m)) return 'Cancelled.'
  if (/no route|not supported|unsupported/i.test(m)) return 'There is no route for this pair right now. Try a different amount or pair.'
  if (/slippage|price/i.test(m)) return 'The price moved too much. Review a fresh quote and try again.'
  if (/rate limit|429/i.test(m)) return 'Too many requests. Wait a moment and try again.'
  return m.replace(/\s+/g, ' ').slice(0, 200)
}

export function SwapPage() {
  const { address, connector, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const [fromSym, setFromSym] = useState('USDC')
  const [toSym, setToSym] = useState('EURC')
  const [amountText, setAmountText] = useState('')
  const [slippage, setSlippage] = useState(100)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')

  const from = TOKENS.find(t => t.symbol === fromSym) ?? TOKENS[0]
  const to = TOKENS.find(t => t.symbol === toSym) ?? TOKENS[1]
  const enabled = !!address && IS_MAINNET

  const { data: fromBalance, refetch: refetchFrom } = useReadContract({
    address: from.address, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`], chainId: CHAIN_ID,
    query: { enabled, refetchInterval: 8000 },
  })
  const { data: toBalance, refetch: refetchTo } = useReadContract({
    address: to.address, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`], chainId: CHAIN_ID,
    query: { enabled, refetchInterval: 8000 },
  })

  let amountRaw: bigint | null = null
  if (/^\d+(\.\d+)?$/.test(amountText.trim())) {
    const frac = amountText.trim().split('.')[1] ?? ''
    if (frac.length <= from.decimals) {
      try { amountRaw = parseUnits(amountText.trim(), from.decimals) } catch { amountRaw = null }
    }
  }
  const balance = fromBalance ?? 0n
  const maxSpend = from.kit === 'USDC' ? (balance > GAS_RESERVE ? balance - GAS_RESERVE : 0n) : balance
  const currentKey = `${address}|${from.kit}|${to.kit}|${amountText.trim()}|${slippage}`

  let problem = ''
  if (amountText && amountRaw === null) problem = `Enter a plain number with up to ${from.decimals} decimals.`
  else if (amountRaw !== null && amountRaw === 0n) problem = 'Enter an amount above zero.'
  else if (amountRaw !== null && amountRaw > maxSpend) problem = from.kit === 'USDC' ? 'That is more than you hold (a little USDC is kept for network fees).' : `That is more than your ${from.symbol} balance.`

  const clear = () => { setQuote(null); setError(''); setTxHash('') }

  const flip = () => { setFromSym(toSym); setToSym(fromSym); setAmountText(''); clear() }

  const getAdapterAndKit = useCallback(async () => {
    if (!connector) throw new Error('Your wallet is not connected.')
    if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
    const provider = (await connector.getProvider()) as import('viem').EIP1193Provider
    const [{ AppKit }, { createViemAdapterFromProvider }] = await Promise.all([
      import('@circle-fin/app-kit'),
      import('@circle-fin/adapter-viem-v2'),
    ])
    const adapter = await createViemAdapterFromProvider({ provider })
    return { kit: new AppKit(), adapter }
  }, [connector, chainId, switchChainAsync])

  const review = async () => {
    if (!address || amountRaw === null || problem || from.kit === to.kit) return
    setQuoting(true); setError(''); setQuote(null); setTxHash('')
    const key = currentKey
    try {
      const { kit, adapter } = await getAdapterAndKit()
      const est = await kit.estimateSwap({
        from: { adapter, chain: 'Arc' },
        tokenIn: from.kit, tokenOut: to.kit,
        amountIn: amountText.trim(),
        config: { slippageBps: slippage, allowanceStrategy: 'approve' },
      })
      const out = est.estimatedOutput
      const stop = (est as { stopLimit?: { amount: string } }).stopLimit
      setQuote({
        key, out: out.amount, outSymbol: to.symbol, min: stop?.amount ?? null,
        fees: (est.fees ?? []).map(f => ({ type: String(f.type), amount: String(f.amount), token: String(f.token) })),
      })
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setQuoting(false)
    }
  }

  const swap = async () => {
    if (!quote || quote.key !== currentKey || amountRaw === null) return
    setSwapping(true); setError('')
    try {
      const { kit, adapter } = await getAdapterAndKit()
      const result = await kit.swap({
        from: { adapter, chain: 'Arc' },
        tokenIn: from.kit, tokenOut: to.kit,
        amountIn: amountText.trim(),
        config: { slippageBps: slippage, allowanceStrategy: 'approve' },
      })
      setTxHash(result.txHash ?? '')
      toast.success(`Swapped ${amountText.trim()} ${from.symbol} to ${to.symbol}`)
      setQuote(null); setAmountText('')
      void refetchFrom(); void refetchTo()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setSwapping(false)
    }
  }

  if (!IS_MAINNET) {
    return (
      <div className="p-5 flex flex-col gap-2" style={card}>
        <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Swap is available on Arc Mainnet</p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>Swapping works with real tokens on mainnet, so there is nothing to swap on the test network.</p>
      </div>
    )
  }

  const quoteFresh = quote !== null && quote.key === currentKey
  const bigSwap = (from.kit !== 'CIRBTC' && amountRaw !== null && Number(formatUnits(amountRaw, from.decimals)) > BIG_AMOUNT_USD)
  const busy = quoting || swapping

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>Swap</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Swap between USDC, EURC and cirBTC (Circle&apos;s tokenized Bitcoin) on Arc.</p>
      </div>

      <div className="p-4 flex flex-col gap-2" style={{ ...card, background: 'var(--warning-bg)', border: '1px solid var(--warning)' }}>
        <p className="flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--ink)' }}><AlertTriangle className="size-3.5" /> Real money</p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          Swaps use real tokens on Arc Mainnet and cannot be undone. Prices can move between the quote and the swap, so you set a slippage limit. Start with a small amount. Bitcoin and euro prices change, so what you get back can be worth less than what you put in.
        </p>
      </div>

      {!address ? (
        <div className="p-4 text-sm" style={{ ...card, color: 'var(--muted)' }}>Sign in with a wallet that can approve transactions to swap.</div>
      ) : (
        <div className="p-4 flex flex-col gap-3.5" style={card}>
          {/* You pay */}
          <div className="rounded-xl px-3.5 py-3 flex flex-col gap-2" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
              <span>You pay</span>
              <button type="button" disabled={busy} onClick={() => { setAmountText(formatUnits(maxSpend, from.decimals)); clear() }} style={{ color: 'var(--accent)' }}>
                Balance {fmtUnits(balance, from.decimals)} · Max
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input value={amountText} onChange={e => { setAmountText(e.target.value); clear() }} inputMode="decimal" placeholder="0.00" disabled={busy}
                className="display flex-1 min-w-0 bg-transparent text-2xl font-bold outline-none" style={{ color: 'var(--ink)' }} />
              <select value={fromSym} disabled={busy} onChange={e => { const v = e.target.value; setFromSym(v); if (v === toSym) setToSym(fromSym); setAmountText(''); clear() }}
                className="rounded-lg px-2.5 py-2 text-sm font-bold outline-none" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                {TOKENS.map(t => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
              </select>
            </div>
          </div>

          <button type="button" onClick={flip} disabled={busy} aria-label="Swap the two tokens"
            className="mx-auto -my-1 flex size-9 items-center justify-center rounded-full" style={{ background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}>
            <ArrowDownUp className="size-4" />
          </button>

          {/* You receive */}
          <div className="rounded-xl px-3.5 py-3 flex flex-col gap-2" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
              <span>You receive (estimate)</span>
              <span>Balance {fmtUnits(toBalance ?? 0n, to.decimals)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="display flex-1 min-w-0 text-2xl font-bold" style={{ color: quoteFresh ? 'var(--ink)' : 'var(--subtle)' }}>{quoteFresh ? quote.out : '0.00'}</span>
              <select value={toSym} disabled={busy} onChange={e => { const v = e.target.value; setToSym(v); if (v === fromSym) setFromSym(toSym); setAmountText(''); clear() }}
                className="rounded-lg px-2.5 py-2 text-sm font-bold outline-none" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                {TOKENS.map(t => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Slippage limit</span>
            <div className="flex rounded-lg p-0.5 gap-0.5" style={{ background: 'var(--surface-muted)' }}>
              {SLIPPAGES.map(s => (
                <button key={s.bps} type="button" disabled={busy} onClick={() => { setSlippage(s.bps); clear() }} className="rounded-md px-2.5 py-1 text-xs font-bold"
                  style={{ background: slippage === s.bps ? 'var(--accent)' : 'transparent', color: slippage === s.bps ? '#fff' : 'var(--subtle)' }}>{s.label}</button>
              ))}
            </div>
          </div>

          {problem && <p className="text-xs" style={{ color: 'var(--danger)' }}>{problem}</p>}

          {quoteFresh && (
            <div className="rounded-xl px-3.5 py-3 text-xs flex flex-col gap-1.5" style={{ background: 'var(--success-bg)', color: 'var(--ink-2)' }}>
              <span className="flex justify-between gap-3"><span>You pay</span><strong>{amountText.trim()} {from.symbol}</strong></span>
              <span className="flex justify-between gap-3"><span>You get about</span><strong>{quote.out} {quote.outSymbol}</strong></span>
              {quote.min && <span className="flex justify-between gap-3"><span>At least ({(slippage / 100).toString()}% slippage)</span><strong>{quote.min} {quote.outSymbol}</strong></span>}
              {quote.fees.map((f, i) => (
                <span key={i} className="flex justify-between gap-3"><span>{f.type === 'gas' ? 'Estimated network fee' : 'Swap fee'}</span><strong>{Number(f.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })} {f.token}</strong></span>
              ))}
              <span style={{ color: 'var(--subtle)' }}>This quote is an estimate and can change before the swap goes through.</span>
            </div>
          )}

          {bigSwap && <p className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--warning)' }}><AlertTriangle className="size-3.5 shrink-0 mt-0.5" /> This is more than {BIG_AMOUNT_USD} in value. Consider a small test swap first.</p>}
          {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}

          {!quoteFresh ? (
            <button disabled={busy || !amountText || !!problem || amountRaw === null} onClick={() => { void review() }}
              className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>
              {quoting ? <><Loader2 className="size-4 animate-spin" /> Getting a quote…</> : 'Review quote'}
            </button>
          ) : (
            <button disabled={busy} onClick={() => { void swap() }}
              className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>
              {swapping ? <><Loader2 className="size-4 animate-spin" /> Swapping… confirm each step</> : `Swap ${amountText.trim()} ${from.symbol} to ${to.symbol}`}
            </button>
          )}

          {txHash && (
            <a href={buildTxExplorerUrl(CHAIN_ID, txHash)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
              <ExternalLink className="size-3" /> Swap complete. View the transaction
            </a>
          )}
          <p className="flex items-start gap-1.5 text-[11px]" style={{ color: 'var(--subtle)' }}>
            <Info className="size-3 shrink-0 mt-0.5" /> Swaps are priced by Circle&apos;s swap service, which routes through a third-party aggregator (such as LiFi) that can change by route and has its own terms. Your first swap of a token asks for an approval, then the swap, and you confirm each. Fairtab adds no fee. Only USDC, EURC and cirBTC can be swapped on Arc today.
          </p>
        </div>
      )}
    </div>
  )
}
