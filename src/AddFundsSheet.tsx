/**
 * AddFundsSheet: tells the user how to get USDC into their Fairtab wallet.
 * USDC is also what pays the network fee on Arc, so this is the first thing a new wallet needs.
 */

import { useState } from 'react'
import { Copy, CheckCircle2, X, ExternalLink, AlertTriangle } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { toast } from 'sonner'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { arcChain, IS_MAINNET } from '@/config'

export function AddFundsSheet({ address, onClose }: { address: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const network = IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'

  const copy = () => {
    void navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success('Address copied')
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(10,20,40,0.55)', backdropFilter: 'blur(6px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="relative w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-lg)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <TokenUSDC variant="branded" size={22} />
            <span className="font-bold text-base" style={{ color: 'var(--ink)' }}>Add USDC</span>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="flex size-8 items-center justify-center rounded-full" style={{ color: 'var(--muted)' }}>
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
            Send USDC to your Fairtab wallet to pay bills. On Arc, USDC also pays the small network fee, so you do not need any other token.
          </p>

          <div className="rounded-2xl p-3.5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Your wallet address</p>
            <p className="mono mt-1.5 break-all text-xs" style={{ color: 'var(--ink)' }}>{address}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={copy}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold"
                style={{ background: copied ? 'var(--success-bg)' : 'var(--accent-fill)', color: copied ? 'var(--success)' : '#fff' }}>
                {copied ? <CheckCircle2 className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? 'Copied' : 'Copy address'}
              </button>
              <a href={buildAddressExplorerUrl(arcChain.id, address)} target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2.5 text-xs font-semibold"
                style={{ background: 'var(--surface)', color: 'var(--ink-2)', border: '1px solid var(--border)', textDecoration: 'none' }}>
                <ExternalLink className="size-3.5" /> Explorer
              </a>
            </div>
          </div>

          <ol className="flex flex-col gap-2.5 text-sm" style={{ color: 'var(--ink-2)' }}>
            {[
              <>Choose the <strong>{network}</strong> network when you send.</>,
              <>Send <strong>USDC</strong> to the address above from an exchange or another wallet.</>,
              <>If your USDC is on another network (Ethereum, Base and so on), move it to Arc first. See the{' '}
                <a href="https://docs.arc.io" target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--accent)' }}>Arc docs</a>.</>,
              <>Your balance updates within a few seconds. Close this window to continue.</>,
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  style={{ background: 'var(--accent-fill)', color: '#fff' }}>{i + 1}</span>
                <span className="pt-0.5 leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>

          <div className="flex items-start gap-2.5 rounded-2xl p-3.5"
            style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}>
            <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--warning)' }} />
            <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
              Only send USDC on {network}. Funds sent on a different network, or other tokens, may be lost. Try a small amount first.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
