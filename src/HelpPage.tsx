/**
 * HelpPage: plain-language guide to Fairtab. Public (no sign-in needed).
 */

import { useState } from 'react'
import { ChevronDown, ArrowLeft, Wallet, Receipt, Users, ShieldCheck, Coins } from 'lucide-react'

interface Props {
  onBack: () => void
}

const STEPS = [
  { icon: Wallet,      title: '1. Sign in',            text: 'Use Google (a wallet is created for you and protected by your PIN) or connect your own wallet such as MetaMask or OKX.' },
  { icon: Receipt,     title: '2. Create a bill',      text: 'Add what it is for, the total in USDC, who gets paid, and who owes what. Review it, then confirm it onchain.' },
  { icon: Users,       title: '3. Everyone pays',      text: 'Each person accepts the invite and pays their own share. They can pay in parts.' },
  { icon: ShieldCheck, title: '4. The payee is paid',  text: 'Once the bill is fully funded, the money goes to the payee automatically. If anything goes wrong, shares can be refunded.' },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'What is Fairtab?',
    a: 'Fairtab splits shared bills (rent, utilities, subscriptions, dinners) between people and settles them in USDC on the Arc network. A smart contract holds the money until the bill is fully paid, so nobody has to chase anyone.',
  },
  {
    q: 'Does Fairtab hold my money?',
    a: 'No. Payments go to a smart contract on Arc, not to Fairtab. Fairtab cannot access, freeze or recover your funds, and it does not charge a fee. You only pay the small network fee.',
  },
  {
    q: 'What do I need before I can use it?',
    a: 'A wallet with some USDC. On Arc, USDC is also what pays the network fee, so there is no separate gas token. Use "Add USDC" in the app to top up.',
  },
  {
    q: 'Is this real money?',
    a: 'Yes. Fairtab runs on Arc Mainnet, so USDC and fees are real and transactions cannot be reversed. Start with a small bill to learn how it works.',
  },
  {
    q: 'How does signing in with Google work?',
    a: 'Google proves who you are, and Circle creates a wallet for your Google account. The same Google account always gets the same wallet. You approve every transaction with your own PIN, and your sign-in lasts about an hour before you need to sign in again.',
  },
  {
    q: 'I was added to a bill. What now?',
    a: 'Open the Invites tab and accept the invite within 24 hours. After you accept, you can pay your share. Declining removes you from the bill.',
  },
  {
    q: 'What is a FairID?',
    a: 'A FairID is a short name, like @tunde, that you claim for your wallet so people can pay you without a long wallet address. It is free and first come, first served. Claim yours on the Account page. To pay someone, type their @name in the Send page. A FairID is only a label for your wallet: it never holds money, and you can release it or move it to another wallet at any time.',
  },
  {
    q: 'What is Commit, and is it safe?',
    a: 'Commit lets you put idle USDC into a lending vault on Arc (Steakhouse Prime USDC or Galaxy USDC, both run on Morpho) to earn yield. Your money goes straight from your wallet into the vault, and Fairtab never holds it. When you commit, Fairtab takes a small fee (0.23%) once; withdrawing is free. It is not a savings account: the yield changes and is not guaranteed, you can lose money if a borrower or the vault fails, and because most of the USDC is lent out you may have to wait to withdraw if many people leave at once. Each deposit is limited to 0.10 to 1,000 USDC. Start small.',
  },
  {
    q: 'What are the reminders?',
    a: 'The bell at the top shows invitations waiting for you, bills due within 3 days, overdue bills, new payments on bills you created, and bills where people still owe you. For those, "Copy reminder message" gives you a note to send on WhatsApp or X.',
  },
  {
    q: 'Can I pay my share in parts?',
    a: 'Yes. You can pay any amount up to what you owe, as many times as you like, until your share is covered or the deadline passes.',
  },
  {
    q: 'When does the payee get the money?',
    a: 'As soon as the last share is paid. If the automatic payment cannot go through, the payee sees a Claim button and can collect it themselves.',
  },
  {
    q: 'How do I cancel a bill?',
    a: 'Participants vote to cancel. The bill is cancelled once enough people have voted (the number is set when the bill is created, and must be more than half). Everyone then gets back what they paid.',
  },
  {
    q: 'What if the deadline passes?',
    a: 'If a bill is not fully paid by its deadline, the people who paid can claim their money back. Bills without a deadline are given a 90 day limit.',
  },
  {
    q: 'What is a recurring bill?',
    a: 'A bill that repeats every set number of days, for example monthly rent. When one round is fully paid, the next one is created.',
  },
  {
    q: 'Why does it say my sign-in expired?',
    a: 'Circle sign-ins last about an hour for your safety. Sign in again and you will get the same wallet back.',
  },
  {
    q: 'My wallet pop-up (MetaMask or OKX) appeared instead of the PIN window.',
    a: 'You are signed in with a browser wallet, not Google. Sign out from the wallet menu, then sign in with Google if you want the PIN window.',
  },
  {
    q: 'A transaction failed. What should I check?',
    a: 'Make sure the wallet has enough USDC for the amount and the network fee, that every address is correct, and that amounts add up to the total. The app shows the reason when the contract refuses a bill.',
  },
]

export function HelpPage({ onBack }: Props) {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto w-full max-w-3xl px-5 py-6">
        <button onClick={onBack} className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--accent)' }}>
          <ArrowLeft className="size-4" /> Back
        </button>

        <h1 className="display text-3xl md:text-4xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>Help</h1>
        <p className="mt-2 text-base" style={{ color: 'var(--muted)' }}>
          How Fairtab works, and answers to common questions.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {STEPS.map(({ icon: Icon, title, text }) => (
            <section key={title} className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="mb-2.5 flex size-9 items-center justify-center rounded-xl" style={{ background: 'var(--accent)' }}>
                <Icon className="size-4 text-white" />
              </div>
              <h2 className="font-semibold" style={{ color: 'var(--ink)' }}>{title}</h2>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{text}</p>
            </section>
          ))}
        </div>

        <div className="mt-6 flex items-start gap-3 rounded-2xl p-4"
          style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}>
          <Coins className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--warning)' }} />
          <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            Fairtab uses real USDC on Arc Mainnet. Transactions cannot be undone, so check every address and amount before you confirm.
          </p>
        </div>

        <h2 className="display mt-10 mb-3 text-xl font-bold" style={{ color: 'var(--ink)' }}>Frequently asked questions</h2>
        <div className="overflow-hidden rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          {FAQ.map((item, i) => {
            const isOpen = open === i
            return (
              <div key={item.q} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-semibold"
                  style={{ color: 'var(--ink)' }}>
                  <span>{item.q}</span>
                  <ChevronDown className="size-4 shrink-0 transition-transform"
                    style={{ color: 'var(--subtle)', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                </button>
                {isOpen && (
                  <p className="px-4 pb-4 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{item.a}</p>
                )}
              </div>
            )
          })}
        </div>

        <p className="mt-8 text-sm" style={{ color: 'var(--muted)' }}>
          Still stuck? Message us on{' '}
          <a href="https://x.com/fairtab_xyz" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--accent)' }}>X</a>.
          {' '}See also the <a href="/privacy" className="underline">Privacy Policy</a> and <a href="/terms" className="underline">Terms of Service</a>.
        </p>
      </div>
    </div>
  )
}
