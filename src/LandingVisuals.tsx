/**
 * Product illustrations for the landing page. They show the shape of each screen
 * with labels only: no balances, prices, yields or addresses are invented.
 */
import { ArrowDownUp, AtSign, Copy, HandCoins, KeyRound, Link2, Receipt, Send as SendIcon, TrendingUp, Users, Wallet } from 'lucide-react'
import { TokenEURC, TokenUSDC } from '@web3icons/react'
import type { ComponentType, ReactNode } from 'react'
import { VeltraIcon } from '@/VeltraMark'

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
  const rows: [string, string][] = [['0x4f2a…91c3', '5.00'], ['@tunde', '5.00'], ['0xb81e…07d2', '5.00']]
  return (
    <Frame label="A send form with an Individual and Bulk switch, a recipient list and an amount">
      <div className="grid grid-cols-2 gap-1 rounded-xl p-1" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold" style={{ background: 'var(--accent-fill)', color: '#fff' }}>
          <SendIcon className="size-3.5" /> Individual
        </div>
        <div className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold" style={{ color: 'var(--subtle)' }}>
          <Users className="size-3.5" /> Bulk
        </div>
      </div>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>To</p>
      <div className="mt-2 flex items-center gap-2 rounded-2xl px-3 py-3" style={inner}>
        <AtSign className="size-4" style={{ color: 'var(--accent)' }} />
        <span className="text-sm" style={{ color: 'var(--ink-2)' }}>@name or 0x wallet address</span>
      </div>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Amount</p>
      <div className="mt-2 flex items-baseline justify-between rounded-2xl px-3 py-4" style={inner}>
        <span className="display text-2xl font-bold" style={{ color: 'var(--subtle)' }}>0.00</span>
        <span className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>USDC</span>
      </div>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Or in Bulk: pay a list</p>
      <div className="mt-2 overflow-hidden rounded-2xl" style={inner}>
        {rows.map(([who, amt]) => (
          <div key={who} className="flex items-center justify-between px-3 py-2 text-xs" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="font-mono" style={{ color: 'var(--ink-2)' }}>{who}</span>
            <span className="font-semibold" style={{ color: 'var(--ink-2)' }}>{amt}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold" style={{ background: 'var(--accent-fill)', color: '#fff' }}>
        <SendIcon className="size-4" /> Send 15.00 USDC to 3
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
            <span className="size-9 shrink-0 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-fill)', color: '#fff' }}><Wallet className="size-4" /></span>
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

export function FairIdVisual() {
  return (
    <Frame label="A FairID claim screen turning a short @name into a wallet">
      <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Claim your FairID</p>
      <div className="mt-2 flex items-center gap-2 rounded-2xl px-3 py-3" style={inner}>
        <AtSign className="size-4" style={{ color: 'var(--accent)' }} />
        <span className="text-sm" style={{ color: 'var(--ink-2)' }}>yourname</span>
      </div>
      <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>3 to 20 letters, numbers or underscores. First come, first served.</p>
      <div className="my-4 flex justify-center"><ArrowDownUp className="size-4" style={{ color: 'var(--subtle)' }} /></div>
      <div className="flex items-center gap-3 rounded-2xl px-3 py-3" style={inner}>
        <span className="size-9 shrink-0 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-fill)', color: '#fff' }}><Wallet className="size-4" /></span>
        <div className="flex flex-1 flex-col gap-2"><Bar w="70%" /><Bar w="40%" /></div>
        <Chip tone="ok">Your wallet</Chip>
      </div>
      <p className="mt-4 text-xs" style={{ color: 'var(--muted)' }}>A FairID is only a label. It never holds money.</p>
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

export function VeltraHero() {
  return (
    <div
      className="relative mx-auto w-full max-w-md overflow-hidden rounded-[2rem] px-6 pt-8 pb-6"
      style={{
        background: 'radial-gradient(ellipse at 50% 32%, #17358a 0%, #0b1a4a 58%, #060d26 100%)',
        border: '1px solid rgba(96,165,250,0.28)',
        boxShadow: '0 24px 60px rgba(37,99,235,0.28)',
      }}
    >
      <img
        src="/veltra.webp"
        alt="Veltra, the Fairtab assistant: a friendly blue and white robot holding a glowing V orb"
        width={1000}
        height={800}
        loading="lazy"
        decoding="async"
        className="mx-auto h-auto w-full"
      />
      <p className="display mt-2 text-center text-xl font-bold tracking-tight" style={{ color: '#fff' }}>Meet Veltra</p>
      <p className="mt-1 text-center text-sm" style={{ color: 'rgba(219,234,254,0.8)' }}>
        Ask anything. Veltra never signs or sends: you confirm every move.
      </p>
    </div>
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

/**
 * Hero: a desktop-style app window that lists every feature in its sidebar and shows
 * the Swap screen, with two token cards floating above it. Example numbers only.
 */
export function HeroApp() {
  const side: [string, ComponentType<{ className?: string }>, boolean?][] = [
    ['Bills', Receipt], ['Send', SendIcon], ['Bulk', Users], ['Receive', HandCoins],
    ['Swap', ArrowDownUp, true], ['Commit', TrendingUp], ['FairID', AtSign], ['Veltra', VeltraIcon],
  ]
  return (
    <div role="img" aria-label="The Fairtab app: a sidebar with Bills, Send, Bulk, Receive, Swap, Commit, FairID and Veltra, showing the Swap screen" className="relative w-full">
      <div className="pointer-events-none absolute inset-0 -z-10" style={{ background: 'radial-gradient(60% 60% at 70% 30%, var(--accent-light), transparent 70%)', opacity: 0.8 }} />

      <div className="mb-3 flex gap-3 sm:absolute sm:-top-12 sm:left-4 sm:z-10 sm:mb-0">
        {([['USDC', '248.50', 'USD Coin', <TokenUSDC key="u" variant="branded" size={34} />], ['EURC', '82.40', 'Euro Coin', <TokenEURC key="e" variant="branded" size={34} />]] as const).map(([sym, amt, name, icon]) => (
          <div key={sym} className="flex flex-1 items-center gap-3 rounded-2xl px-3.5 py-3 sm:flex-none sm:min-w-[170px]" style={card}>
            {icon}
            <div className="leading-tight">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--muted)' }}>{sym}</p>
              <p className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>{amt}</p>
              <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>{name}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-3xl sm:mt-0" style={{ ...card, boxShadow: 'var(--shadow-lg)' }}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <img src="/logo.svg" alt="" className="size-8 rounded-lg" />
          <span className="display text-base font-bold" style={{ color: 'var(--ink)' }}>Fairtab</span>
          <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--muted)' }}>Arc</span>
          <span className="ml-auto rounded-full px-3 py-1 font-mono text-[11px]" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>0xe460…ccbb</span>
        </div>
        <div className="flex">
          <aside className="hidden w-44 shrink-0 flex-col gap-1 p-3 md:flex" style={{ borderRight: '1px solid var(--border)' }}>
            {side.map(([label, Icon, active]) => (
              <div key={label} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium"
                style={active ? { background: 'var(--accent-light)', color: 'var(--accent)' } : { color: 'var(--ink-2)' }}>
                <Icon className="size-4" /> {label}
              </div>
            ))}
          </aside>
          <div className="min-w-0 flex-1 p-4 md:p-6">
            <h3 className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>Swap</h3>
            <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>Exchange USDC, EURC and cirBTC on Arc.</p>
            <div className="mt-4 rounded-2xl p-3" style={inner}>
              <div className="rounded-xl px-3.5 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--muted)' }}>You pay</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="display text-3xl font-bold" style={{ color: 'var(--ink)' }}>1.00</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold" style={inner}><TokenUSDC variant="branded" size={20} /> USDC</span>
                </div>
              </div>
              <div className="-my-2 flex justify-center"><span className="relative z-10 flex size-8 items-center justify-center rounded-full" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}><ArrowDownUp className="size-4" /></span></div>
              <div className="rounded-xl px-3.5 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--muted)' }}>You receive (estimate)</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="display text-3xl font-bold" style={{ color: 'var(--ink)' }}>0.8906</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold" style={inner}><TokenEURC variant="branded" size={20} /> EURC</span>
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-center rounded-2xl py-3.5 text-sm font-semibold" style={{ background: 'var(--accent-fill)', color: '#fff' }}>Swap 1.00 USDC to EURC</div>
          </div>
        </div>
      </div>
    </div>
  )
}
