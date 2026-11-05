/**
 * SwapPage: swap between the tokens Circle supports on Arc (USDC, EURC and cirBTC).
 * The quote comes from Circle's swap service, which routes through a third-party aggregator.
 * Your wallet signs every transaction. Fairtab never holds your tokens.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, useReadContract, useSwitchChain } from 'wagmi'
import { erc20Abi, formatUnits, parseUnits, type EIP1193Provider } from 'viem'
import { TokenBTC, TokenEURC, TokenUSDC } from '@web3icons/react'
import { AlertTriangle, ArrowDownUp, ChevronDown, ExternalLink, Info, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { arcMainnetChain, IS_MAINNET } from '@/config'
import { buildTxExplorerUrl } from '@/onchain-facts'

const CHAIN_ID = arcMainnetChain.id

interface SwapToken { symbol: string; name: string; kit: 'USDC' | 'EURC' | 'CIRBTC'; address: `0x${string}`; decimals: number }
const TOKENS: SwapToken[] = [
  { symbol: 'USDC', name: 'USD Coin', kit: 'USDC', address: '0x3600000000000000000000000000000000000000', decimals: 6 },
  { symbol: 'EURC', name: 'Euro Coin', kit: 'EURC', address: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1', decimals: 6 },
  { symbol: 'cirBTC', name: 'Circle Bitcoin', kit: 'CIRBTC', address: '0x171A4217b86A807A64eB94757Db6849fb4bDbAA0', decimals: 8 },
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

const ARC_RPC = arcMainnetChain.rpcUrls.default.http[0]

/**
 * A read-only wallet connection used only to ask for price quotes. It reports your address and forwards
 * reads to the Arc network. It cannot sign or send anything, so typing an amount never opens your wallet.
 */
function quoteProvider(address: `0x${string}`): EIP1193Provider {
  return {
    async request({ method, params }: { method: string; params?: unknown }) {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [address]
      if (method === 'eth_chainId') return `0x${CHAIN_ID.toString(16)}`
      if (method === 'wallet_switchEthereumChain') return null
      if (method === 'eth_sendTransaction' || method.startsWith('eth_sign') || method === 'personal_sign') {
        throw new Error('This connection can only get quotes.')
      }
      const r = await fetch(ARC_RPC, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }),
      })
      const j = await r.json() as { result?: unknown; error?: { message: string } }
      if (j.error) throw new Error(j.error.message)
      return j.result
    },
    on() {}, removeListener() {},
  } as unknown as EIP1193Provider
}

/** The token's logo. cirBTC is Circle's tokenized Bitcoin, so it uses the Bitcoin logo. */
function TokenLogo({ symbol, size = 24 }: { symbol: string; size?: number }) {
  if (symbol === 'EURC') return <TokenEURC variant="branded" size={size} />
  if (symbol === 'cirBTC') return <TokenBTC variant="branded" size={size} />
  return <TokenUSDC variant="branded" size={size} />
}

/** A token chooser that shows each token's logo, name and symbol. */
function TokenPicker({ value, onChange, disabled }: { value: string; onChange: (symbol: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" disabled={disabled} onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}
        className="flex items-center gap-2 rounded-full pl-1.5 pr-2.5 py-1.5 text-sm font-bold"
        style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
        <TokenLogo symbol={value} size={24} />
        {value}
        <ChevronDown className="size-4" style={{ color: 'var(--subtle)' }} />
      </button>
      {open && (
        <ul role="listbox" className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-2xl p-1.5"
          style={{ background: 'var(--popover)', border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-lg)' }}>
          {TOKENS.map(t => (
            <li key={t.symbol} role="option" aria-selected={t.symbol === value}>
              <button type="button" onClick={() => { onChange(t.symbol); setOpen(false) }}
                className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left"
                style={{ background: t.symbol === value ? 'var(--accent-light)' : 'transparent' }}>
                <TokenLogo symbol={t.symbol} size={28} />
                <span className="flex flex-col">
                  <span className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{t.symbol}</span>
                  <span className="text-[11px]" style={{ color: 'var(--muted)' }}>{t.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SwapPage() {
  const { address, connector, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const prefill = useMemo(() => {
    const q = new URLSearchParams(window.location.search)
    const sym = (v: string | null) => {
      const u = (v ?? '').toUpperCase()
      return TOKENS.some(t => t.symbol.toUpperCase() === u) ? TOKENS.find(t => t.symbol.toUpperCase() === u)!.symbol : null
    }
    const from = sym(q.get('from'))
    const to = sym(q.get('to'))
    const amt = q.get('amount') ?? ''
    return {
      from: from ?? 'USDC',
      to: to && to !== (from ?? 'USDC') ? to : (from === 'EURC' ? 'USDC' : 'EURC'),
      amount: /^\d+(\.\d{1,8})?$/.test(amt) ? amt : '',
    }
  }, [])
  const [fromSym, setFromSym] = useState(prefill.from)
  const [toSym, setToSym] = useState(prefill.to)
  const [amountText, setAmountText] = useState(prefill.amount)
  const [slippage, setSlippage] = useState(100)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteError, setQuoteError] = useState<{ key: string; message: string } | null>(null)
  const [tick, setTick] = useState(0)
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

  const clear = () => { setQuote(null); setQuoteError(null); setError(''); setTxHash('') }

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

  // Quote automatically as you type: a short pause after the last keystroke, then a fresh estimate.
  // It also refreshes every 15 seconds so the price you confirm is recent.
  const canQuote = !!address && amountRaw !== null && !problem && from.kit !== to.kit && IS_MAINNET
  useEffect(() => {
    if (!canQuote || !address) return
    let cancelled = false
    const key = currentKey
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const [{ AppKit }, { createViemAdapterFromProvider }] = await Promise.all([
            import('@circle-fin/app-kit'),
            import('@circle-fin/adapter-viem-v2'),
          ])
          const adapter = await createViemAdapterFromProvider({ provider: quoteProvider(address) })
          const est = await new AppKit().estimateSwap({
            from: { adapter, chain: 'Arc' },
            tokenIn: from.kit, tokenOut: to.kit,
            amountIn: amountText.trim(),
            config: { slippageBps: slippage, allowanceStrategy: 'approve' },
          })
          if (cancelled) return
          const stop = (est as { stopLimit?: { amount: string } }).stopLimit
          setQuote({
            key, out: est.estimatedOutput.amount, outSymbol: to.symbol, min: stop?.amount ?? null,
            fees: (est.fees ?? []).map(f => ({ type: String(f.type), amount: String(f.amount), token: String(f.token) })),
          })
          setQuoteError(null)
        } catch (e) {
          if (!cancelled) setQuoteError({ key, message: friendlyError(e) })
        }
      })()
    }, tick === 0 ? 350 : 0)
    return () => { cancelled = true; clearTimeout(timer) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuote, currentKey, tick])

  useEffect(() => {
    if (!canQuote || swapping) return
    const id = setInterval(() => setTick(t => t + 1), 15_000)
    return () => clearInterval(id)
  }, [canQuote, swapping])

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
  const quoteFailed = quoteError !== null && quoteError.key === currentKey
  const quoting = canQuote && !quoteFresh && !quoteFailed
  const bigSwap = (from.kit !== 'CIRBTC' && amountRaw !== null && Number(formatUnits(amountRaw, from.decimals)) > BIG_AMOUNT_USD)
  const busy = swapping

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
              <TokenPicker value={fromSym} disabled={busy} onChange={v => { setFromSym(v); if (v === toSym) setToSym(fromSym); setAmountText(''); clear() }} />
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
              <span className="display flex-1 min-w-0 text-2xl font-bold" style={{ color: quoteFresh ? 'var(--ink)' : 'var(--subtle)' }}>
                {quoteFresh ? quote.out : quoting ? <span className="inline-flex items-center gap-2 text-base font-semibold"><Loader2 className="size-4 animate-spin" /> Getting price…</span> : '0.00'}
              </span>
              <TokenPicker value={toSym} disabled={busy} onChange={v => { setToSym(v); if (v === fromSym) setFromSym(toSym); setAmountText(''); clear() }} />
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
              <span className="flex justify-between items-center gap-3"><span>You pay</span><strong className="flex items-center gap-1.5"><TokenLogo symbol={from.symbol} size={16} />{amountText.trim()} {from.symbol}</strong></span>
              <span className="flex justify-between items-center gap-3"><span>You get about</span><strong className="flex items-center gap-1.5"><TokenLogo symbol={quote.outSymbol} size={16} />{quote.out} {quote.outSymbol}</strong></span>
              {quote.min && <span className="flex justify-between gap-3"><span>At least ({(slippage / 100).toString()}% slippage)</span><strong>{quote.min} {quote.outSymbol}</strong></span>}
              {quote.fees.map((f, i) => (
                <span key={i} className="flex justify-between gap-3"><span>{f.type === 'gas' ? 'Estimated network fee' : 'Swap fee'}</span><strong>{Number(f.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })} {f.token}</strong></span>
              ))}
              <span style={{ color: 'var(--subtle)' }}>This quote is an estimate and can change before the swap goes through.</span>
            </div>
          )}

          {bigSwap && <p className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--warning)' }}><AlertTriangle className="size-3.5 shrink-0 mt-0.5" /> This is more than {BIG_AMOUNT_USD} in value. Consider a small test swap first.</p>}
          {(error || quoteFailed) && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error || quoteError?.message}</p>}

          <button disabled={busy || !quoteFresh} onClick={() => { void swap() }}
            className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>
            {swapping ? <><Loader2 className="size-4 animate-spin" /> Swapping… confirm each step</>
              : quoting ? <><Loader2 className="size-4 animate-spin" /> Getting a quote…</>
              : quoteFresh ? `Swap ${amountText.trim()} ${from.symbol} to ${to.symbol}`
              : amountText && !problem ? 'No quote available' : 'Enter an amount'}
          </button>

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
