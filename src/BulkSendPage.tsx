/**
 * Bulk send: pay many wallets in one go. Uses Arc's built-in Multicall3From so each
 * transfer still comes from your own wallet, with no Fairtab contract involved.
 * Nothing is sent until you press Send and confirm in your wallet or with your PIN.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, usePublicClient, useReadContract, useWriteContract } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { decodeFunctionResult, encodeFunctionData, erc20Abi, formatUnits, parseAbi } from 'viem'
import { CheckCircle2, ExternalLink, FileUp, Loader2, ShieldCheck, Users, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { TokenUSDC } from '@web3icons/react'
import { arcChain } from '@/config'
import { getUsdc } from '@/onchain-facts'
import { FAIRID_ABI, FAIRID_ADDRESS } from '@/fairid'
import { parseInput, type Mode, type Row } from '@/bulkParse'

export const BULK_DRAFT_KEY = 'fairtab_bulk_draft_v1'
const MULTICALL3FROM = '0x522fAf9A91c41c443c66765030741e4AaCe147D0' as const
const MC_ABI = parseAbi(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) returns ((bool success, bytes returnData)[] returnData)'])
const MAX_ROWS = 200
const BATCH_SIZE = 50
const FEE_RESERVE = 100_000n // keep 0.10 USDC for the network fee
const CHAIN_ID = arcChain.id

interface Batch { rows: Row[]; status: 'waiting' | 'sending' | 'done' | 'failed'; hash?: string; error?: string }

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const fmt = (v: bigint) => {
  const s = formatUnits(v, 6)
  const [i, d = ''] = s.split('.')
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${d ? '.' + d.padEnd(2, '0') : '.00'}`
}
export function BulkSendPage() {
  const { address, chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const usdc = getUsdc(CHAIN_ID)?.address as `0x${string}` | undefined

  // Veltra can leave a prepared list for you to review (read once, cleared in an effect)
  const [draft] = useState(() => {
    try {
      const raw = localStorage.getItem(BULK_DRAFT_KEY)
      return raw ? JSON.parse(raw) as { text?: string; mode?: Mode; sameAmount?: string } : null
    } catch { return null }
  })
  useEffect(() => { localStorage.removeItem(BULK_DRAFT_KEY) }, [])

  const [mode, setMode] = useState<Mode>(draft?.mode === 'same' ? 'same' : 'lines')
  const [text, setText] = useState(typeof draft?.text === 'string' ? draft.text.slice(0, 20_000) : '')
  const [sameAmount, setSameAmount] = useState(typeof draft?.sameAmount === 'string' ? draft.sameAmount : '')
  const fileRef = useRef<HTMLInputElement>(null)

  const parsed = useMemo(() => parseInput(text, mode, sameAmount), [text, mode, sameAmount])
  const names = useMemo(() => Array.from(new Set(parsed.filter(r => r.name).map(r => r.name as string))), [parsed])

  const { data: nameMap, isFetching: resolving } = useQuery({
    queryKey: ['bulk-resolve', names],
    enabled: names.length > 0 && !!FAIRID_ADDRESS && !!publicClient,
    queryFn: async () => {
      const map: Record<string, string> = {}
      await Promise.all(names.map(async n => {
        try {
          const a = await publicClient!.readContract({ address: FAIRID_ADDRESS!, abi: FAIRID_ABI, functionName: 'resolve', args: [n] })
          if (a && a !== '0x0000000000000000000000000000000000000000') map[n] = a
        } catch { /* not found */ }
      }))
      return map
    },
  })

  const rows: Row[] = useMemo(() => parsed.map(r => {
    if (r.error || r.address) return r
    if (r.name) {
      if (!FAIRID_ADDRESS) return { ...r, error: 'FairID names are not available here yet' }
      const a = nameMap?.[r.name]
      if (a) return { ...r, address: a as `0x${string}` }
      return resolving || !nameMap ? { ...r, error: 'Looking up…' } : { ...r, error: `No FairID named @${r.name}` }
    }
    return r
  }).map(r => {
    if (!r.error && r.address && (r.address === '0x0000000000000000000000000000000000000000' || r.address.toLowerCase() === usdc?.toLowerCase())) {
      return { ...r, error: 'This address cannot receive USDC' }
    }
    return r
  }), [parsed, nameMap, resolving, usdc])

  const { data: balanceData, refetch: refetchBalance } = useReadContract({
    address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`], chainId: CHAIN_ID,
    query: { enabled: !!address && !!usdc, refetchInterval: 8000 },
  })
  const balance = (balanceData) ?? 0n

  const good = useMemo(() => rows.filter(r => !r.error && r.address && r.amount), [rows])
  const bad = rows.filter(r => r.error)
  const total = good.reduce((s, r) => s + (r.amount ?? 0n), 0n)
  const tooMany = rows.length > MAX_ROWS
  const spendable = balance > FEE_RESERVE ? balance - FEE_RESERVE : 0n
  const short_ = total > spendable
  const dupeCounts = new Map<string, number>()
  good.forEach(r => dupeCounts.set(r.address!.toLowerCase(), (dupeCounts.get(r.address!.toLowerCase()) ?? 0) + 1))
  const dupes = Array.from(dupeCounts.values()).filter(n => n > 1).length

  // Automatic check: which recipients can receive USDC right now. It re-runs by itself
  // whenever the wallets or amounts change, so there is nothing to press.
  const [simFailed, setSimFailed] = useState<Set<number>>(new Set())
  const [checkedKey, setCheckedKey] = useState('')
  const [checkErrKey, setCheckErrKey] = useState('')
  const [retryTick, setRetryTick] = useState(0)
  const inputKey = JSON.stringify(good.map(r => [r.address, r.amount?.toString()]))
  const checked = checkedKey === inputKey
  // Results belong to the list that was sent. Change a wallet or an amount and they clear,
  // so the same list can be edited and sent again straight away.
  const [batchState, setBatchState] = useState<{ key: string; items: Batch[] }>({ key: '', items: [] })
  const batches = batchState.key === inputKey ? batchState.items : []

  // If some batches already went through and one failed, only the unsent rows are sent next
  const sentBatches = batches.filter(b => b.status === 'done')
  const unsentRows = batches.filter(b => b.status !== 'done').flatMap(b => b.rows)
  const partial = sentBatches.length > 0 && unsentRows.length > 0

  const [sending, setSending] = useState(false)
  const canCheckInputs = !!address && good.length > 0 && bad.length === 0 && !tooMany && (partial || !short_)
  const checking = canCheckInputs && !sending && checkedKey !== inputKey && checkErrKey !== inputKey
  const checkFailed = canCheckInputs && checkErrKey === inputKey && !checked

  const callsFor = (rs: Row[], allowFailure: boolean) => rs.map(r => ({
    target: usdc as `0x${string}`,
    allowFailure,
    callData: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [r.address!, r.amount!] }),
  }))

  useEffect(() => {
    if (!canCheckInputs || sending || !publicClient || !address || !usdc) return
    let cancelled = false
    const key = inputKey
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const failed = new Set<number>()
          for (let i = 0; i < good.length; i += BATCH_SIZE) {
            const chunk = good.slice(i, i + BATCH_SIZE)
            const calls = chunk.map(r => ({
              target: usdc, allowFailure: true,
              callData: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [r.address!, r.amount!] }),
            }))
            const res = await publicClient.call({
              account: address, to: MULTICALL3FROM,
              data: encodeFunctionData({ abi: MC_ABI, functionName: 'aggregate3', args: [calls] }),
            })
            const out = decodeFunctionResult({ abi: MC_ABI, functionName: 'aggregate3', data: res.data! })
            out.forEach((o, k) => { if (!o.success) failed.add(chunk[k].line) })
          }
          if (!cancelled) { setSimFailed(failed); setCheckedKey(key) }
        } catch {
          if (!cancelled) setCheckErrKey(key)
        }
      })()
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey, canCheckInputs, sending, retryTick, address, usdc, publicClient])

  const sendable = checked ? good.filter(r => !simFailed.has(r.line)) : []
  const sendTotal = sendable.reduce((s, r) => s + (r.amount ?? 0n), 0n)

  const send = async () => {
    const source = partial ? unsentRows : sendable
    if (!publicClient || !usdc || source.length === 0 || sending) return
    const fresh: Batch[] = []
    for (let i = 0; i < source.length; i += BATCH_SIZE) fresh.push({ rows: source.slice(i, i + BATCH_SIZE), status: 'waiting' })
    const chunks: Batch[] = [...sentBatches, ...fresh]
    const sentKey = inputKey
    setBatchState({ key: sentKey, items: chunks })
    setSending(true)
    for (let i = sentBatches.length; i < chunks.length; i++) {
      const update = (p: Partial<Batch>) => setBatchState(st => (st.key === sentKey ? { key: st.key, items: st.items.map((b, k) => (k === i ? { ...b, ...p } : b)) } : st))
      update({ status: 'sending' })
      try {
        const hash = await writeContractAsync({
          address: MULTICALL3FROM, abi: MC_ABI, functionName: 'aggregate3',
          args: [callsFor(chunks[i].rows, false)], chainId: CHAIN_ID,
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('The network did not accept this batch.')
        update({ status: 'done', hash })
      } catch (e) {
        const msg = (e as Error).message ?? ''
        const friendly = /EOA|spoof|sender/i.test(msg)
          ? 'Batch sends need a regular (EOA) wallet. Smart-contract wallets are not supported.'
          : /cancel|reject|denied/i.test(msg) ? 'You cancelled this batch.' : (msg.split('\n').pop() ?? 'Something went wrong').slice(0, 160)
        update({ status: 'failed', error: friendly })
        toast.error(friendly)
        break
      }
    }
    setSending(false)
    void refetchBalance()
  }

  const switchMode = (next: Mode) => {
    if (next === mode) return
    if (next === 'same') {
      // keep only the wallet on each line; remember the first amount as the shared one
      const lines = text.split(/\r?\n/)
      const firstAmount = lines.map(l => l.trim().split(/[\s,;\t]+/)[1]).find(a => a && /^\d+(\.\d{1,6})?$/.test(a))
      setText(lines.map(l => l.trim().split(/[\s,;\t]+/)[0] ?? '').filter(Boolean).join('\n'))
      if (!sameAmount && firstAmount) setSameAmount(firstAmount)
    } else {
      setText(text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => `${l.split(/[\s,;\t]+/)[0]} ${sameAmount}`.trim()).join('\n'))
    }
    setMode(next)
  }

  const onFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 200_000) { toast.error('That file is too large. Keep it under 200 KB.'); return }
    setText(await f.text())
    setMode('lines')
    if (fileRef.current) fileRef.current.value = ''
  }

  const explorer = arcChain.blockExplorers?.default.url ?? 'https://explorer.arc.io'
  const wrongNetwork = chainId !== undefined && chainId !== CHAIN_ID
  const done = batches.length > 0 && batches.every(b => b.status === 'done')
  const canSend = canCheckInputs && checked && (partial || sendable.length > 0) && !sending && !done

  if (!address) {
    return <div className="rounded-2xl p-5 text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>Sign in to send to many wallets at once.</div>
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-xl" style={{ background: 'var(--accent-light)' }}>
            <Users className="size-4" style={{ color: 'var(--accent)' }} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Bulk send</p>
            <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>Pay many wallets with one confirmation</p>
          </div>
          <TokenUSDC variant="branded" size={22} className="ml-auto" />
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl p-1" style={{ background: 'var(--surface-strong)' }}>
          {([['lines', 'Amount per line'], ['same', 'Same amount for all']] as const).map(([id, label]) => (
            <button key={id} onClick={() => switchMode(id)} disabled={sending}
              className="rounded-lg py-2 text-xs font-semibold"
              style={{ background: mode === id ? 'var(--accent-fill)' : 'transparent', color: mode === id ? '#fff' : 'var(--subtle)' }}>
              {label}
            </button>
          ))}
        </div>

        {mode === 'same' && (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            <input value={sameAmount} inputMode="decimal" placeholder="Amount for each wallet"
              onChange={e => setSameAmount(e.target.value.replace(/[^0-9.]/g, ''))} disabled={sending}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none" style={{ color: 'var(--ink)' }} />
            <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>USDC</span>
          </div>
        )}

        <textarea value={text} onChange={e => setText(e.target.value)} disabled={sending} rows={7} spellCheck={false}
          placeholder={mode === 'lines' ? '0x1234… 5\n@tunde 12.50\n0xabcd…, 3' : '0x1234…\n@tunde\n0xabcd…'}
          className="w-full rounded-xl px-3 py-2.5 font-mono text-xs outline-none resize-y"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>
            {mode === 'lines' ? 'One per line: wallet or @name, then the amount.' : 'One wallet or @name per line.'} Up to {MAX_ROWS}.
          </p>
          <button onClick={() => fileRef.current?.click()} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
            <FileUp className="size-3.5" /> CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={e => { void onFile(e.target.files?.[0]) }} />
        </div>
      </div>

      {rows.length > 0 && (
        <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[['Recipients', String(good.length)], ['Total', `${fmt(total)}`], ['Batches', String(Math.max(1, Math.ceil(good.length / BATCH_SIZE)))]].map(([k, v]) => (
              <div key={k} className="rounded-xl py-2" style={{ background: 'var(--surface-muted)' }}>
                <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--subtle)' }}>{k}</p>
                <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{v}</p>
              </div>
            ))}
          </div>
          <p className="text-xs" style={{ color: short_ ? 'var(--danger, #dc2626)' : 'var(--muted)' }}>
            Your balance: {fmt(balance)} USDC{short_ ? `. You need ${fmt(total + FEE_RESERVE)} including a little for network fees.` : '.'}
          </p>
          {tooMany && <p className="text-xs" style={{ color: 'var(--danger, #dc2626)' }}>That is more than {MAX_ROWS} lines. Split it into smaller lists.</p>}
          {dupes > 0 && <p className="text-xs" style={{ color: 'var(--muted)' }}>{dupes} wallet{dupes === 1 ? ' appears' : 's appear'} more than once. Each line is paid separately.</p>}
          {wrongNetwork && <p className="text-xs" style={{ color: 'var(--muted)' }}>Your wallet will ask to switch to {arcChain.name} when you send.</p>}

          <div className="max-h-72 overflow-y-auto rounded-xl" style={{ border: '1px solid var(--border)' }}>
            {rows.slice(0, MAX_ROWS + 5).map(r => {
              const skipped = checked && !r.error && simFailed.has(r.line)
              return (
                <div key={r.line} className="flex items-center gap-2 px-3 py-2 text-xs" style={{ borderBottom: '1px solid var(--border)' }}>
                  <span className="w-6 shrink-0 text-[10px]" style={{ color: 'var(--subtle)' }}>{r.line}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono" style={{ color: 'var(--ink)' }}>
                      {r.name ? `@${r.name}` : r.address ? short(r.address) : r.recipient}
                      {r.name && r.address ? <span style={{ color: 'var(--subtle)' }}> · {short(r.address)}</span> : null}
                    </p>
                    {(r.error || skipped) && (
                      <p className="text-[10px]" style={{ color: 'var(--danger, #dc2626)' }}>
                        {r.error ?? 'Cannot receive USDC right now. Will be skipped.'}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 font-semibold" style={{ color: 'var(--ink)' }}>{r.amount ? fmt(r.amount) : '—'}</span>
                </div>
              )
            })}
          </div>
          {bad.length > 0 && <p className="text-xs" style={{ color: 'var(--danger, #dc2626)' }}>Fix the {bad.length} line{bad.length === 1 ? '' : 's'} marked in red before you continue.</p>}

          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
              {checking ? <><Loader2 className="size-3.5 animate-spin" /> Checking who can receive…</>
                : checked ? <><ShieldCheck className="size-3.5" /> {simFailed.size ? `${simFailed.size} cannot receive right now and will be skipped.` : 'Everyone can receive.'}</>
                : checkFailed ? <>Could not check the recipients. <button onClick={() => { setCheckErrKey(''); setRetryTick(t => t + 1) }} className="font-semibold underline" style={{ color: 'var(--accent)' }}>Try again</button></>
                : 'Fix the issues above to continue.'}
            </p>
            <button onClick={() => { void send() }} disabled={!canSend}
              className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-40"
              style={{ background: 'var(--accent-fill)', color: '#fff' }}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : null}
              {sending ? 'Confirm in your wallet…'
                : done ? 'Sent. Change an amount or wallet to send again'
                : partial ? `Send the remaining ${unsentRows.length} transfer${unsentRows.length === 1 ? '' : 's'}`
                : checked ? `Send ${fmt(sendTotal)} USDC to ${sendable.length}` : 'Send'}
            </button>
            {done && (
              <button onClick={() => setBatchState({ key: '', items: [] })} className="text-xs font-semibold underline" style={{ color: 'var(--accent)' }}>
                Send the same list again
              </button>
            )}
            <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>
              Transfers cannot be reversed. Check every wallet. {BATCH_SIZE} transfers go in each confirmation.
            </p>
          </div>
        </div>
      )}

      {batches.length > 0 && (
        <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{done ? 'All sent' : 'Progress'}</p>
          {batches.map((b, i) => (
            <div key={i} className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink)' }}>
              {b.status === 'done' ? <CheckCircle2 className="size-4 text-green-500" />
                : b.status === 'failed' ? <XCircle className="size-4 text-red-500" />
                : b.status === 'sending' ? <Loader2 className="size-4 animate-spin" /> : <span className="size-4" />}
              <span className="flex-1">Batch {i + 1}: {b.rows.length} transfer{b.rows.length === 1 ? '' : 's'} · {fmt(b.rows.reduce((s, r) => s + (r.amount ?? 0n), 0n))} USDC
                {b.error ? ` · ${b.error}` : ''}</span>
              {b.hash && (
                <a href={`${explorer}/tx/${b.hash}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                  View <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
