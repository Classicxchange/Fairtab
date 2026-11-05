/**
 * FairIDCard: claim, show, release and move your FairID (a short name others can pay).
 * Everything here is a normal transaction you confirm yourself.
 */

import { useEffect, useState } from 'react'
import { useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi, formatUnits, isAddress } from 'viem'
import { AtSign, CheckCircle2, Copy, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { FAIRID_ABI, FAIRID_ADDRESS, FAIRID_NAME_PATTERN, cleanFairId } from '@/fairid'
import { arcChain } from '@/config'

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow-sm)' } as React.CSSProperties
const ZERO = '0x0000000000000000000000000000000000000000'

function errorText(err: Error): string {
  const m = err.message ?? ''
  if (/user rejected|denied|cancel/i.test(m)) return 'Cancelled.'
  return (m.split('Details:')[1] ?? m).trim().slice(0, 160)
}

export function FairIDCard({ address }: { address: string }) {
  const wallet = address as `0x${string}`
  const chainId = arcChain.id
  const [input, setInput] = useState('')
  const [moveTo, setMoveTo] = useState('')
  const [acceptFrom, setAcceptFrom] = useState('')
  const [pending, setPending] = useState('')

  const { data: currentName, refetch: refetchName } = useReadContract({
    address: FAIRID_ADDRESS, abi: FAIRID_ABI, functionName: 'nameOf', args: [wallet],
    chainId, query: { enabled: !!FAIRID_ADDRESS },
  })
  const myName = (currentName) ?? ''

  const name = cleanFairId(input)
  const nameValid = FAIRID_NAME_PATTERN.test(name)
  const { data: available, isFetching: checking } = useReadContract({
    address: FAIRID_ADDRESS, abi: FAIRID_ABI, functionName: 'isAvailableFor', args: [name, wallet],
    chainId, query: { enabled: !!FAIRID_ADDRESS && nameValid && !myName },
  })
  // Claim fee (older test deployments have none; the read fails and we treat it as free)
  const { data: feeData } = useReadContract({
    address: FAIRID_ADDRESS, abi: FAIRID_ABI, functionName: 'claimFee', chainId, query: { enabled: !!FAIRID_ADDRESS, retry: false },
  })
  const fee = typeof feeData === 'bigint' ? feeData : 0n
  const { data: usdcAddr } = useReadContract({
    address: FAIRID_ADDRESS, abi: FAIRID_ABI, functionName: 'usdc', chainId, query: { enabled: !!FAIRID_ADDRESS && fee > 0n, retry: false },
  })
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: usdcAddr, abi: erc20Abi, functionName: 'allowance', args: [wallet, FAIRID_ADDRESS!],
    chainId, query: { enabled: !!usdcAddr && fee > 0n },
  })
  const { data: usdcBalance } = useReadContract({
    address: usdcAddr, abi: erc20Abi, functionName: 'balanceOf', args: [wallet],
    chainId, query: { enabled: !!usdcAddr && fee > 0n },
  })
  const needsApprove = fee > 0n && (allowance ?? 0n) < fee
  const lacksFunds = fee > 0n && usdcBalance !== undefined && usdcBalance < fee
  const feeLabel = formatUnits(fee, 6)

  const { data: pendingMove, refetch: refetchPending } = useReadContract({
    address: FAIRID_ADDRESS, abi: FAIRID_ABI, functionName: 'pendingTransferOf', args: [wallet],
    chainId, query: { enabled: !!FAIRID_ADDRESS && !!myName },
  })
  const pendingTo = (pendingMove as readonly [string, string] | undefined)?.[0]
  const hasPendingMove = !!pendingTo && pendingTo !== ZERO

  const { writeContract, data: hash, isPending: signing, reset } = useWriteContract({
    mutation: { onError: err => { toast.error(errorText(err)); setPending('') } },
  })
  const { isSuccess: confirmed, isLoading: confirming } = useWaitForTransactionReceipt({ hash })
  useEffect(() => {
    if (!confirmed) return
    toast.success(pending || 'Done')
    void refetchName()
    void refetchPending()
    void refetchAllowance()
    reset()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed])

  if (!FAIRID_ADDRESS) return null
  const busy = signing || confirming
  const run = (label: string, fn: 'claim' | 'release' | 'proposeTransfer' | 'cancelTransfer' | 'acceptTransfer', args: unknown[]) => {
    setPending(label)
    writeContract({ address: FAIRID_ADDRESS, abi: FAIRID_ABI, functionName: fn, args } as never)
  }

  const approveFee = () => {
    if (!usdcAddr) return
    setPending(`Approved ${feeLabel} USDC. Now claim your FairID.`)
    writeContract({ address: usdcAddr, abi: erc20Abi, functionName: 'approve', args: [FAIRID_ADDRESS as `0x${string}`, fee] })
  }

  return (
    <div className="p-4 flex flex-col gap-3.5" style={card}>
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-xl" style={{ background: 'var(--accent-light)' }}>
          <AtSign className="size-4" style={{ color: 'var(--accent)' }} />
        </span>
        <div>
          <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>FairID</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>A short name people can pay instead of your wallet address</p>
        </div>
      </div>

      {!myName ? (
        <>
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--subtle)' }}>@</span>
            <input value={input} onChange={e => setInput(e.target.value)} maxLength={21} placeholder="yourname"
              className="flex-1 min-w-0 bg-transparent text-sm outline-none" style={{ color: 'var(--ink)' }} />
            {checking && <Loader2 className="size-4 animate-spin" style={{ color: 'var(--subtle)' }} />}
          </div>
          <p className="text-xs" style={{ color: input && (!nameValid || available === false) ? 'var(--danger)' : available ? 'var(--success)' : 'var(--subtle)' }}>
            {!input ? '3 to 20 letters, numbers or underscores. Free. First come, first served.'
              : !nameValid ? 'Use 3 to 20 lowercase letters, numbers or underscores.'
              : checking ? 'Checking…'
              : available ? `@${name} is available` : `@${name} is taken or on hold`}
          </p>
          {fee > 0n && (
            <p className="text-xs" style={{ color: lacksFunds ? 'var(--danger)' : 'var(--muted)' }}>
              {lacksFunds ? `You need ${feeLabel} USDC in your wallet to claim.` : `Claiming costs a one-time fee of ${feeLabel} USDC, paid straight to the FairID fee wallet. It is not refunded if you release the name later.`}
            </p>
          )}
          <button disabled={busy || !nameValid || !available || lacksFunds}
            onClick={() => (needsApprove ? approveFee() : run(`@${name} is yours`, 'claim', [name]))}
            className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#fff' }}>
            {busy ? <><Loader2 className="size-4 animate-spin" /> Confirming…</>
              : needsApprove ? `Step 1 of 2: allow ${feeLabel} USDC fee`
              : fee > 0n ? `Claim FairID for ${feeLabel} USDC` : 'Claim FairID'}
          </button>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-3" style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>
            <p className="display text-xl font-bold truncate" style={{ color: 'var(--accent)' }}>@{myName}</p>
            <button onClick={() => { void navigator.clipboard.writeText(`@${myName}`); toast.success('FairID copied') }}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold" style={{ background: 'var(--surface)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
              <Copy className="size-3" /> Copy
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>People can now pay you by typing <strong>@{myName}</strong> under Trade, on the Send tab.</p>

          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Move to another wallet</p>
            <div className="flex gap-2">
              <input value={moveTo} onChange={e => setMoveTo(e.target.value.trim())} placeholder="0x… new wallet"
                className="mono flex-1 min-w-0 rounded-xl px-3 py-2.5 text-xs outline-none" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
              <button disabled={busy || !isAddress(moveTo)} onClick={() => run('Transfer offered. The other wallet must accept it.', 'proposeTransfer', [moveTo])}
                className="shrink-0 rounded-xl px-3.5 text-xs font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>Offer</button>
            </div>
            {hasPendingMove && (
              <div className="flex items-center justify-between gap-2 text-xs" style={{ color: 'var(--muted)' }}>
                <span className="truncate">Waiting for {pendingTo.slice(0, 8)}…{pendingTo.slice(-6)} to accept</span>
                <button disabled={busy} onClick={() => run('Transfer cancelled', 'cancelTransfer', [])} className="shrink-0 flex items-center gap-1 font-semibold" style={{ color: 'var(--danger)' }}>
                  <XCircle className="size-3.5" /> Cancel
                </button>
              </div>
            )}
          </div>

          <button disabled={busy} onClick={() => { if (window.confirm(`Release @${myName}? Only you can take it back for 30 days, then anyone can claim it.`)) run('FairID released', 'release', []) }}
            className="rounded-xl py-2.5 text-xs font-semibold disabled:opacity-40" style={{ color: 'var(--danger)', background: 'var(--danger-bg)' }}>
            Release FairID
          </button>
        </>
      )}

      <details>
        <summary className="cursor-pointer text-xs font-semibold" style={{ color: 'var(--muted)' }}>Accept a FairID someone sent you</summary>
        <div className="mt-2 flex gap-2">
          <input value={acceptFrom} onChange={e => setAcceptFrom(e.target.value.trim())} placeholder="0x… wallet that sent it"
            className="mono flex-1 min-w-0 rounded-xl px-3 py-2.5 text-xs outline-none" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
          <button disabled={busy || !isAddress(acceptFrom) || !!myName} onClick={() => run('FairID accepted', 'acceptTransfer', [acceptFrom])}
            className="shrink-0 flex items-center gap-1 rounded-xl px-3.5 text-xs font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>
            <CheckCircle2 className="size-3.5" /> Accept
          </button>
        </div>
        {!!myName && <p className="mt-1.5 text-[11px]" style={{ color: 'var(--subtle)' }}>You already have a FairID. Release it first to accept another.</p>}
      </details>
    </div>
  )
}
