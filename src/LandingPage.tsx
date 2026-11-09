/**
 * LandingPage — public home page shown to signed-out visitors at "/".
 * Describes the app and links to the privacy policy and terms without
 * requiring any login (needed for Google OAuth brand verification).
 */

import { useState, type ComponentType, type ReactNode } from 'react'
import {
  Sun, Moon, ArrowRight, Receipt, Send, HandCoins, AtSign, TrendingUp, ArrowDownUp, KeyRound, Check, Bell, Wallet, Mail, Menu, X as CloseIcon,
} from 'lucide-react'
import { VeltraIcon } from '@/VeltraMark'
import {
  BillsVisual, SendVisual, ReceiveVisual, FairIdVisual, CommitVisual, SwapVisual, VeltraHero, WalletVisual, HeroApp,
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
  icon: ComponentType<{ className?: string }>
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
    title: 'Send USDC to one wallet, or to many at once.',
    intro: 'Send USDC to any wallet on Arc, or switch to Bulk and pay a whole list in one go. Claim a FairID like @tunde so people can pay you without a long address.',
    points: [
      'Individual: paste a wallet address or type a FairID name, review it and confirm.',
      'Bulk: paste a list or upload a CSV of wallets and amounts, up to 200 people, for payroll, rewards or airdrops.',
      'Fairtab checks who can receive first. You confirm once for every 50 transfers, and every payment comes from your own wallet.',
      'Paid everyone and need another round? Change just the amount and send the same list again.',
      'On Arc, USDC also pays the network fee, so there is no second token to buy.',
    ],
    visual: <SendVisual />,
  },
  {
    id: 'receive', label: 'Receive', icon: HandCoins,
    title: 'Share your address or a payment link.',
    intro: 'Copy your address, or build a payment link with an amount and a note and send it to whoever owes you. Money lands straight in your own wallet.',
    points: [
      'Request a specific amount with a memo, like "October rent".',
      'Your FairID name works as a short address.',
      'Add USDC from another wallet in a few steps when you need to top up.',
    ],
    visual: <ReceiveVisual />,
  },
  {
    id: 'fairid', label: 'FairID', icon: AtSign,
    title: 'A short name instead of a long address.',
    intro: 'Claim a name like @tunde and let people pay you without copying a long wallet address.',
    points: [
      'Pick 3 to 20 letters, numbers or underscores. Names are first come, first served.',
      'Claiming costs a one-time 1 USDC, shown before you confirm.',
      'People pay you by typing your @name on the Send screen.',
      'A FairID is only a label for your wallet. It never holds money, and you can release it or move it to another wallet.',
    ],
    visual: <FairIdVisual />,
  },
  {
    id: 'commit', label: 'Commit', icon: TrendingUp,
    title: 'Put idle USDC to work.',
    intro: 'Commit spare USDC or EURC to Morpho lending vaults on Arc and watch your earnings grow live, block by block.',
    points: [
      'Choose from nine vaults for USDC or EURC, run by curators like Steakhouse, Galaxy, Gauntlet, Keyrock and Bitwise.',
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
    id: 'veltra', label: 'Veltra', icon: VeltraIcon,
    title: 'Ask Veltra instead of filling forms.',
    intro: 'Veltra is the built-in assistant. Describe what you want in plain words and it prepares the screen for you.',
    points: [
      'Answers questions about bills, sends, swaps, how Fairtab works and the Arc blockchain it runs on.',
      'Prepares a bill draft, a send, a bulk send or a swap, then opens the normal screen.',
      'Uses only the wallet addresses you type. It never adds your wallet on its own.',
      'Veltra never signs or sends anything. You review and confirm every transaction.',
    ],
    visual: <VeltraHero />,
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

const EXTRAS = [
  { icon: Bell,   title: 'Reminders', text: 'A bell shows invitations waiting, bills due soon and who still owes you, with a ready-made message to nudge them on WhatsApp or X.' },
  { icon: Mail,   title: 'Invites you control', text: 'Nobody can be charged without saying yes. Open the Invites tab to accept or decline within 24 hours.' },
  { icon: Wallet, title: 'Easy top-ups', text: 'Add USDC shows your address and the steps to fund your wallet, and a banner reminds you when your balance runs low.' },
]

function ProductSection({ p, index }: { p: Product; index: number }) {
  const Icon = p.icon
  const flip = index % 2 === 1
  return (
    <section id={p.id} className="scroll-mt-24 py-14 md:py-20" style={{ borderTop: '1px solid var(--border)' }}>
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

const NAV = [
  { id: 'bills', label: 'Bills' },
  { id: 'send', label: 'Send' },
  { id: 'swap', label: 'Swap' },
  { id: 'commit', label: 'Commit' },
  { id: 'fairid', label: 'FairID' },
  { id: 'veltra', label: 'Veltra' },
  { id: 'wallet', label: 'Security' },
]

const TRUST = ['Non-custodial', 'Settles in under a second', 'No seed phrase to start']

function XLogo({ size = 18 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

export function LandingPage({ onGetStarted, signedIn = false, dark, onToggleDark }: Props) {
  const [menu, setMenu] = useState(false)
  const cta = signedIn ? 'My account' : 'Open Fairtab'
  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg)' }}>
      <header className="sticky top-0 z-30" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', backdropFilter: 'blur(14px)' }}>
        <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-5 py-3">
          <button type="button" onClick={e => e.currentTarget.closest<HTMLElement>('.fixed')?.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Fairtab home"
            className="flex items-center gap-2.5 text-left">
            <img src="/logo.svg" alt="" className="size-9 rounded-xl" />
            <span className="display text-xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>Fairtab</span>
          </button>

          <nav aria-label="Fairtab features" className="mx-auto hidden items-center gap-1 lg:flex">
            {NAV.map(({ id, label }) => (
              <a key={id} href={`#${id}`} onClick={e => { e.preventDefault(); jumpTo(id) }}
                className="rounded-lg px-3.5 py-2 text-[15px] font-medium transition-colors hover:opacity-70" style={{ color: 'var(--ink-2)' }}>
                {label}
              </a>
            ))}
            <a href="/help" className="rounded-lg px-3.5 py-2 text-[15px] font-medium transition-colors hover:opacity-70" style={{ color: 'var(--ink-2)' }}>FAQ</a>
          </nav>

          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <a href="https://x.com/fairtab_xyz" target="_blank" rel="noopener noreferrer" aria-label="Fairtab on X" title="Fairtab on X"
              className="hidden size-10 items-center justify-center rounded-xl transition-opacity hover:opacity-70 sm:flex" style={{ color: 'var(--ink)' }}>
              <XLogo />
            </a>
            {onToggleDark && (
              <button onClick={onToggleDark} aria-label="Toggle dark mode" className="flex size-10 items-center justify-center rounded-xl"
                style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
                {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </button>
            )}
            <button onClick={onGetStarted} className="hidden items-center gap-2 rounded-full px-5 py-2.5 text-[15px] font-semibold sm:inline-flex"
              style={{ background: 'var(--accent-fill)', color: '#fff' }}>
              {cta} <ArrowRight className="size-4" />
            </button>
            <button onClick={() => setMenu(m => !m)} aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu}
              className="flex size-10 items-center justify-center rounded-xl lg:hidden"
              style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
              {menu ? <CloseIcon className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        {menu && (
          <div className="border-t px-5 pb-5 pt-3 lg:hidden" style={{ borderColor: 'var(--border)' }}>
            <div className="mx-auto grid max-w-6xl grid-cols-2 gap-2">
              {NAV.map(({ id, label }) => (
                <a key={id} href={`#${id}`} onClick={e => { e.preventDefault(); setMenu(false); jumpTo(id) }}
                  className="rounded-xl px-4 py-3 text-[15px] font-semibold" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
                  {label}
                </a>
              ))}
              <a href="/help" className="rounded-xl px-4 py-3 text-[15px] font-semibold" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink)' }}>FAQ</a>
              <a href="https://x.com/fairtab_xyz" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl px-4 py-3 text-[15px] font-semibold"
                style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink)' }}><XLogo size={15} /> Follow on X</a>
            </div>
            <button onClick={() => { setMenu(false); onGetStarted() }} className="mt-3 flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-base font-semibold"
              style={{ background: 'var(--accent-fill)', color: '#fff' }}>
              {cta} <ArrowRight className="size-4" />
            </button>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5">
        <section className="grid items-center gap-12 py-12 md:py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:py-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
              <span className="size-2 rounded-full" style={{ background: 'var(--success)' }} /> Live on Arc &middot; Wallets secured by Circle
            </span>
            <h1 className="display mt-6 text-[2.9rem] font-bold leading-[1.02] tracking-[-0.035em] sm:text-6xl lg:text-[4.6rem]" style={{ color: 'var(--ink)' }}>
              One wallet.<br />Every bill.<br />
              <span style={{ background: 'linear-gradient(90deg, #2f6bff 0%, #5b8cff 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Settled in USDC.</span>
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed" style={{ color: 'var(--muted)' }}>
              Fairtab is the bill splitter for friends, flatmates and teams, built on Arc. Split rent and subscriptions, send USDC to one wallet or many,
              swap, earn on idle balances and ask Veltra to do the typing, all settled in under a second, without anyone holding your money.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button onClick={onGetStarted} className="inline-flex items-center gap-2 rounded-full px-7 py-4 text-base font-semibold" style={{ background: 'var(--accent-fill)', color: '#fff', boxShadow: 'var(--shadow-md)' }}>
                {signedIn ? 'Open my app' : 'Open Fairtab'} <ArrowRight className="size-4" />
              </button>
              <a href="#bills" onClick={e => { e.preventDefault(); jumpTo('bills') }} className="inline-flex items-center rounded-full px-7 py-4 text-base font-semibold"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
                Explore the platform
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-7 gap-y-3 text-[15px]" style={{ color: 'var(--ink-2)' }}>
              {TRUST.map(t => (
                <li key={t} className="inline-flex items-center gap-2"><Check className="size-4" style={{ color: 'var(--success)' }} /> {t}</li>
              ))}
            </ul>
          </div>
          <HeroApp />
        </section>

        <section className="py-12 md:py-16" style={{ borderTop: '1px solid var(--border)' }}>
          <h2 className="display text-3xl font-bold tracking-tight md:text-4xl" style={{ color: 'var(--ink)' }}>How a bill works</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-4">
            {STEPS.map(({ title, text }, i) => (
              <li key={title} className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="display text-3xl font-bold" style={{ color: 'var(--accent)' }}>{String(i + 1).padStart(2, '0')}</span>
                <h3 className="mt-3 font-semibold" style={{ color: 'var(--ink)' }}>{title}</h3>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{text}</p>
              </li>
            ))}
          </ol>
        </section>

        {PRODUCTS.map((p, i) => <ProductSection key={p.id} p={p} index={i} />)}

        <section className="mt-4 py-12 md:py-16" style={{ borderTop: '1px solid var(--border)' }}>
          <h2 className="display text-2xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>And the small things that save time</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {EXTRAS.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="size-9 rounded-xl flex items-center justify-center mb-3" style={{ background: 'var(--accent-fill)' }}>
                  <Icon className="size-4 text-white" />
                </div>
                <h3 className="font-semibold" style={{ color: 'var(--ink)' }}>{title}</h3>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{text}</p>
              </div>
            ))}
          </div>
        </section>

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
          <button onClick={onGetStarted} className="rounded-xl px-5 py-3 text-sm font-semibold" style={{ background: 'var(--accent-fill)', color: '#fff' }}>
            {signedIn ? 'Open my app' : 'Get started'}
          </button>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-5 py-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"
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
