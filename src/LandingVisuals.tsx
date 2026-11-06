/**
 * Product illustrations for the landing page. They show the shape of each screen
 * with labels only: no balances, prices, yields or addresses are invented.
 */
import { ArrowDownUp, AtSign, Check, Copy, KeyRound, Link2, Send as SendIcon, Wallet } from 'lucide-react'
import { VeltraBadge } from '@/VeltraMark'
import type { ReactNode } from 'react'

const card = { background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' } as const
const inner = { background: 'var(--surface-strong)', border: '1px solid var(--border)' } as const

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="img" aria-label={label} className="w-full max-w-sm mx-auto rounded-3xl p-4 md:p-5" style={card}>
      {children}
    </div>
  )
}

function Chip({ tone, children }: { tone: 'ok' | 'wait' | 'neutral'; children: ReactNode }) {
  const style =
    tone === 'ok' ? { background: 'var(--success-bg)', color: 'var(--success)' }
    : tone === 'wait' ? { background: 'var(--accent-light)', color: 'var(--accent)' }
    : { background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }
  return <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={style}>{children}</span>
}

function Bar({ w }: { w: string }) {
  return <div className="h-2.5 rounded-full" style={{ width: w, background: 'var(--border)' }} />
}

export function BillsVisual() {
  const rows: { name: string; chip: ReactNode }[] = [
    { name: 'Participant 1', chip: <Chip tone="ok">Paid</Chip> },
    { name: 'Participant 2', chip: <Chip tone="wait">Paying in parts</Chip> },
    { name: 'Participant 3', chip: <Chip tone="neutral">Invited</Chip> },
  ]
  return (
    <Frame label="A shared bill with three participants and their payment status">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2"><Bar w="7rem" /><Bar w="4rem" /></div>
        <Chip tone="wait">Open</Chip>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {rows.map(r => (
          <div key={r.name} className="flex items-center justify-between rounded-2xl px-3 py-3" style={inner}>
            <div className="flex items-center gap-3">
              <div className="size-8 rounded-full" style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border)' }} />
              <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{r.name}</span>
            </div>
            {r.chip}
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs" style={{ color: 'var(--muted)' }}>When every share is in, the payee is paid automatically.</p>
    </Frame>
  )
}

export function SendVisual() {
  return (
    <Frame label="A send form with a recipient and an amount">
      <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>To</p>
      <div className="mt-2 flex items-center gap-2 rounded-2xl px-3 py-3" style={inner}>
        <AtSign className="size-4" style={{ color: 'var(--accent)' }} />
        <span className="text-sm" style={{ color: 'var(--ink-2)' }}>@name or 0x wallet address</span>
      </div>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Amount</p>
      <div className="mt-2 flex items-baseline justify-between rounded-2xl px-3 py-4" style={inner}>
        <span className="display text-2xl font-bold" style={{ color: 'var(--subtle)' }}>0.00</span>
        <span className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>USDC</span>
      </div>
      <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>
        <SendIcon className="size-4" /> Review and send
      </div>
    </Frame>
  )
}

export function ReceiveVisual() {
  return (
    <Frame label="A receive screen with your address and a payment request link">
      <div className="flex flex-col gap-3">
        <div className="rounded-2xl px-4 py-3" style={inner}>
          <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Your address</p>
          <div className="mt-2 flex items-center gap-3">
            <span className="size-9 shrink-0 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent)', color: '#fff' }}><Wallet className="size-4" /></span>
            <span className="h-2.5 flex-1 rounded-full" style={{ background: 'var(--border)' }} />
          </div>
          <div className="mt-3 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
            <Copy className="size-4" /> Copy address
          </div>
        </div>
        <div className="rounded-2xl px-4 py-3" style={inner}>
          <p className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--ink)' }}><Link2 className="size-4" style={{ color: 'var(--accent)' }} /> Request a specific amount</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-xl px-3 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>Amount (USDC)</p>
            </div>
            <div className="rounded-xl px-3 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>Memo</p>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold" style={{ background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid var(--border)' }}>
            <Copy className="size-4" /> Copy payment link
          </div>
        </div>
      </div>
    </Frame>
  )
}

export function CommitVisual() {
  const vaults = [
    { name: 'Steakhouse Prime USDC', by: 'Curated by Steakhouse Financial' },
    { name: 'Galaxy USDC', by: 'Curated by Galaxy Curation' },
  ]
  return (
    <Frame label="Two lending vaults where idle USDC can be committed">
      <div className="flex flex-col gap-3">
        {vaults.map(v => (
          <div key={v.name} className="rounded-2xl px-4 py-4" style={inner}>
            <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{v.name}</p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>{v.by}</p>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--muted)' }}>Earnings update every block</span>
              <Chip tone="wait">Commit</Chip>
            </div>
          </div>
        ))}
      </div>
    </Frame>
  )
}

function SwapRow({ label, token }: { label: string; token: string }) {
  return (
    <div className="rounded-2xl px-4 py-4" style={inner}>
      <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>{label}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="display text-2xl font-bold" style={{ color: 'var(--subtle)' }}>0.00</span>
        <span className="rounded-full px-3 py-1 text-sm font-semibold" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}>{token}</span>
      </div>
    </div>
  )
}

export function SwapVisual() {
  return (
    <Frame label="A swap card converting between USDC, EURC and cirBTC">
      <SwapRow label="You pay" token="USDC" />
      <div className="relative z-10 -my-3 flex justify-center">
        <div className="size-9 rounded-full flex items-center justify-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--accent)' }}>
          <ArrowDownUp className="size-4" />
        </div>
      </div>
      <SwapRow label="You get" token="EURC" />
      <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>The estimate refreshes on its own every 15 seconds.</p>
    </Frame>
  )
}

export function VeltraVisual() {
  return (
    <Frame label="A chat where Veltra turns a request into a bill draft for review">
      <div className="flex flex-col gap-3">
        <div className="self-end max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm" style={{ background: 'var(--accent)', color: '#fff' }}>
          Split this month&apos;s rent between these three wallets.
        </div>
        <div className="self-start max-w-[90%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm" style={{ ...inner, color: 'var(--ink)' }}>
          <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--accent)' }}><VeltraBadge size={22} /> Veltra</span>
          <span className="mt-1 block">Draft ready. Check it, then create the bill yourself.</span>
        </div>
        <div className="self-start flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
          <Check className="size-3.5" style={{ color: 'var(--success)' }} /> Nothing is sent until you confirm.
        </div>
      </div>
    </Frame>
  )
}

export function WalletVisual() {
  return (
    <Frame label="Sign-in options: Google or your own wallet">
      <div className="flex flex-col gap-2">
        {[
          { icon: KeyRound, text: 'Continue with Google' },
          { icon: Wallet, text: 'MetaMask, OKX or WalletConnect' },
        ].map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-center gap-3 rounded-2xl px-4 py-3.5" style={inner}>
            <Icon className="size-4" style={{ color: 'var(--accent)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{text}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs" style={{ color: 'var(--muted)' }}>No seed phrase to write down. Every payment asks for your own PIN.</p>
    </Frame>
  )
}
