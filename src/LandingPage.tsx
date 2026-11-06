/**
 * LandingPage — public home page shown to signed-out visitors at "/".
 * Describes the app and links to the privacy policy and terms without
 * requiring any login (needed for Google OAuth brand verification).
 */

import type { ReactNode } from 'react'
import {
  Sun, Moon, ArrowRight, Receipt, Send, QrCode, TrendingUp, ArrowDownUp, Sparkles, KeyRound, Check,
} from 'lucide-react'
import {
  BillsVisual, SendVisual, ReceiveVisual, CommitVisual, SwapVisual, VeltraVisual, WalletVisual,
} from '@/LandingVisuals'

interface Props {
  onGetStarted: () => void
  /** True when a wallet is connected: the sign-in buttons become "My account" */
  signedIn?: boolean
  dark: boolean
  onToggleDark?: () => void
}

const STEPS = [
  { title: 'Create a bill', text: 'Name it, add who owes what, choose who gets paid and set a deadline.' },
  { title: 'Everyone pays their share', text: 'People accept the invite and pay their exact share in USDC, all at once or in parts.' },
  { title: 'The payee is paid', text: 'When the bill is fully funded, the smart contract pays the payee automatically.' },
  { title: 'Not paid in time? Money back', text: 'If the deadline passes or the group cancels, everyone can take their money back.' },
]

interface Product {
  id: string
  label: string
  icon: typeof Receipt
  title: string
  intro: string
  points: string[]
  visual: ReactNode
  note?: string
}

const PRODUCTS: Product[] = [
  {
    id: 'bills', label: 'Bills', icon: Receipt,
    title: 'Split any bill. Get paid in full.',
    intro: 'Rent, utilities, a subscription or a dinner. One person creates the bill, everyone pays their own share, and the payee is paid by the smart contract.',
    points: [
      'Split by fixed amounts or percentages, with up to 20 people on one bill.',
      'Consent first: nobody pays until they accept, and invitations expire after 24 hours if ignored.',
      'Pay your share all at once or in parts before the deadline.',
      'Recurring bills repeat on a schedule, so rent and subscriptions are set up once.',
      'If the deadline passes or the group votes to cancel, refunds follow.',
      'A bell shows invitations waiting, bills due soon and who still owes you.',
    ],
    visual: <BillsVisual />,
  },
  {
    id: 'send', label: 'Send', icon: Send,
    title: 'Send USDC to a wallet or a name.',
    intro: 'Send USDC to any wallet on Arc, or claim a FairID like @tunde so people can pay you without a long address.',
    points: [
      'Paste a wallet address, scan a QR code, or type a FairID name.',
      'Review the amount and recipient before you confirm.',
      'On Arc, USDC also pays the network fee, so there is no second token to buy.',
    ],
    visual: <SendVisual />,
  },
  {
    id: 'receive', label: 'Receive', icon: QrCode,
    title: 'Get paid with a link or a QR code.',
    intro: 'Share your payment link or show your QR code. Money lands straight in your own wallet.',
    points: [
      'A personal QR code and link, ready whenever someone owes you.',
      'Your FairID name works as a short address.',
      'Add USDC from another wallet in a few steps when you need to top up.',
    ],
    visual: <ReceiveVisual />,
  },
  {
    id: 'commit', label: 'Commit', icon: TrendingUp,
    title: 'Put idle USDC to work.',
    intro: 'Commit spare USDC to Morpho lending vaults on Arc and watch your earnings grow live, block by block.',
    points: [
      'Choose between the Steakhouse Prime USDC and Galaxy USDC vaults.',
      'Withdraw whenever the vault has funds free.',
      'Commit may carry a small one-time fee, shown before you confirm.',
    ],
    note: 'Earnings are not guaranteed and you can lose money. Read the notes in the app before you commit.',
    visual: <CommitVisual />,
  },
  {
    id: 'swap', label: 'Swap', icon: ArrowDownUp,
    title: 'Swap between USDC, EURC and cirBTC.',
    intro: 'Pick a token, type an amount and see the estimate update as you type.',
    points: [
      'Token picker with logos, and an estimate that refreshes every 15 seconds.',
      'See the network fee, the swap fee and the minimum you will receive before you confirm.',
      'Priced by Circle\u2019s swap service, which may route through a third-party aggregator.',
    ],
    visual: <SwapVisual />,
  },
  {
    id: 'veltra', label: 'Veltra', icon: Sparkles,
    title: 'Ask Veltra instead of filling forms.',
    intro: 'Veltra is the built-in assistant. Describe what you want in plain words and it prepares the screen for you.',
    points: [
      'Answers questions about bills, sends, swaps and how Fairtab works.',
      'Prepares a bill draft, a send or a swap, then opens the normal screen.',
      'Uses only the wallet addresses you type. It never adds your wallet on its own.',
      'Veltra never signs or sends anything. You review and confirm every transaction.',
    ],
    visual: <VeltraVisual />,
  },
  {
    id: 'wallet', label: 'Circle wallet', icon: KeyRound,
    title: 'A wallet without a seed phrase.',
    intro: 'Sign in with Google and Circle creates a wallet for your account. Prefer your own? Connect MetaMask, OKX or WalletConnect instead.',
    points: [
      'No seed phrase to write down to get started.',
      'Every payment needs your own PIN, so only you can move your money.',
      'Fairtab never holds your funds and cannot freeze or recover them.',
    ],
    visual: <WalletVisual />,
  },
]

function ProductSection({ p, index }: { p: Product; index: number }) {
  const Icon = p.icon
  const flip = index % 2 === 1
  return (
    <section id={p.id} className="scroll-mt-28 py-12 md:py-16" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="grid items-center gap-8 md:grid-cols-2 md:gap-14">
        <div className={flip ? 'md:order-2' : ''}>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
            <Icon className="size-4" /> {p.label}
          </p>
          <h2 className="display mt-3 text-balance text-3xl md:text-4xl font-bold tracking-tight leading-[1.15]" style={{ color: 'var(--ink)' }}>{p.title}</h2>
          <p className="mt-3 text-pretty text-base leading-relaxed" style={{ color: 'var(--muted)' }}>{p.intro}</p>
          <ul className="mt-5 flex flex-col gap-2.5">
            {p.points.map(point => (
              <li key={point} className="flex items-start gap-2.5 text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                <Check className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--success)' }} /> <span>{point}</span>
              </li>
            ))}
          </ul>
          {p.note && <p className="mt-4 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{p.note}</p>}
        </div>
        <div className={flip ? 'md:order-1' : ''}>{p.visual}</div>
      </div>
    </section>
  )
}

function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function LandingPage({ onGetStarted, signedIn = false, dark, onToggleDark }: Props) {
  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg)' }}>
      <header className="mx-auto w-full max-w-5xl flex items-center justify-between px-5 py-4">
        <button type="button" onClick={e => e.currentTarget.closest<HTMLElement>('.fixed')?.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Fairtab home"
          className="flex items-center gap-3 text-left">
          <img src="/logo.svg" alt="Fairtab" className="size-10 rounded-xl shadow" />
          <span className="display text-xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>Fairtab</span>
        </button>
        <div className="flex items-center gap-2">
          {onToggleDark && (
            <button
              onClick={onToggleDark}
              aria-label="Toggle dark mode"
              className="flex items-center justify-center rounded-xl"
              style={{ width: 38, height: 38, background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          )}
          <button
            onClick={onGetStarted}
            className="rounded-xl px-4 py-2 text-sm font-semibold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {signedIn ? 'My account' : 'Sign in'}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10 md:py-16">
        <h1 className="display text-4xl md:text-5xl font-bold tracking-tight leading-[1.15]" style={{ color: 'var(--ink)' }}>
          Split bills fairly.<br />Settle in USDC.
        </h1>
        <p className="mt-4 max-w-2xl text-base md:text-lg leading-relaxed" style={{ color: 'var(--muted)' }}>
          Fairtab is a bill splitter for friends, flatmates and teams, built on Arc, Circle&apos;s blockchain for stablecoins.
          Split bills, send and receive USDC, swap, earn and ask an assistant, all from one wallet. Create a shared bill for rent, utilities, a subscription or a dinner, let everyone pay their share in USDC,
          and the payee is paid automatically once the bill is fully funded. No chasing, no awkward reminders, no one
          holding the money for you.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            onClick={onGetStarted}
            className="rounded-2xl px-6 py-3.5 text-base font-semibold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {signedIn ? 'Open my app' : 'Get started'}
          </button>
          <a href="/help" className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--accent)' }}>
            How it works <ArrowRight className="size-4" />
          </a>
        </div>
        <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm" style={{ color: 'var(--muted)' }}>
          <li>Funds held by a smart contract, not by Fairtab</li>
          <li>Sign in with Google, no seed phrase</li>
          <li>USDC is also the network fee</li>
        </ul>

        <section className="mt-16">
          <h2 className="display text-2xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>How it works</h2>
          <ol className="mt-5 grid gap-4 md:grid-cols-4">
            {STEPS.map(({ title, text }, i) => (
              <li key={title} className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="size-8 rounded-full flex items-center justify-center text-sm font-bold mb-3" style={{ background: 'var(--accent)', color: '#fff' }}>{i + 1}</span>
                <h3 className="font-semibold" style={{ color: 'var(--ink)' }}>{title}</h3>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-16">
          <h2 className="display text-2xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>Everything in one place</h2>
          <p className="mt-2 text-sm max-w-xl" style={{ color: 'var(--muted)' }}>Seven tools, one wallet. Scroll to see each one, or jump straight to it.</p>
        </section>

        <nav aria-label="Fairtab features" className="sticky top-0 z-20 -mx-5 mt-5 px-5 py-3 flex gap-2 overflow-x-auto"
          style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
          {PRODUCTS.map(({ id, label, icon: Icon }) => (
            <a key={id} href={`#${id}`} onClick={e => { e.preventDefault(); jumpTo(id) }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-2)', minHeight: 44 }}>
              <Icon className="size-4" /> {label}
            </a>
          ))}
        </nav>

        {PRODUCTS.map((p, i) => <ProductSection key={p.id} p={p} index={i} />)}

        <section className="mt-16 grid gap-6 md:grid-cols-2">
          <div>
            <h2 className="display text-2xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>Your money stays yours</h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              Fairtab never holds your funds and cannot freeze or recover them. Payments go to a smart contract on Arc
              that follows fixed rules everyone can read. There is no Fairtab fee for splitting a bill: you only pay the
              small network fee, in USDC. Commit, where you put idle USDC into a lending vault, is the one feature that
              may carry a small one-time fee, shown before you confirm.
            </p>
          </div>
          <div>
            <h2 className="display text-2xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>Real money, so go gently</h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              Fairtab runs on Arc Mainnet. USDC and fees are real, and transactions cannot be reversed. Start with a small
              bill. Earning yield through Commit is not guaranteed and you can lose money, so read the notes in the app
              before you use it.
            </p>
          </div>
        </section>

        <section className="mt-12 max-w-2xl">
          <h2 className="font-semibold" style={{ color: 'var(--ink)' }}>How Fairtab uses Google sign-in</h2>
          <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
            You can sign in with Google to identify your account. Fairtab receives your name, email
            address and profile picture from Google only to show them in the app. See the privacy
            policy for details.
          </p>
        </section>

        <section className="mt-12 rounded-2xl p-6 md:p-8 flex flex-col items-start gap-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h2 className="display text-2xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>Ready to split your first bill?</h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>It takes a minute to sign in and send your first invite.</p>
          <button onClick={onGetStarted} className="rounded-xl px-5 py-3 text-sm font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>
            {signedIn ? 'Open my app' : 'Get started'}
          </button>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-5 py-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"
        style={{ borderTop: '1px solid var(--border)', color: 'var(--muted)' }}>
        <span>&copy; 2026 Fairtab</span>
        <a href="/privacy" className="underline">Privacy Policy</a>
        <a href="/terms" className="underline">Terms of Service</a>
        <a href="/help" className="underline">Help</a>
        <a
          href="https://x.com/fairtab_xyz"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Fairtab on X"
          title="Fairtab on X"
          className="sm:ml-auto inline-flex items-center justify-center rounded-lg size-9 transition-opacity hover:opacity-70"
          style={{ color: 'var(--ink)' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>
      </footer>
    </div>
  )
}
