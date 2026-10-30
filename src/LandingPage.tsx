/**
 * LandingPage — public home page shown to signed-out visitors at "/".
 * Describes the app and links to the privacy policy and terms without
 * requiring any login (needed for Google OAuth brand verification).
 */

import { Shield, Zap, Users, Sun, Moon } from 'lucide-react'

interface Props {
  onGetStarted: () => void
  dark: boolean
  onToggleDark?: () => void
}

const FEATURES = [
  { icon: Users,  title: 'Split with anyone',  text: 'Create a bill, assign each person a fixed or percentage share, and send them a link.' },
  { icon: Zap,    title: 'Pay in USDC',        text: 'Participants pay their exact share and the payee is paid automatically once the bill is fully funded.' },
  { icon: Shield, title: 'Self-custodial',     text: 'Funds are held by a smart contract on Arc, not by Fairtab. You own your wallet and your keys.' },
]

export function LandingPage({ onGetStarted, dark, onToggleDark }: Props) {
  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg)' }}>
      <header className="mx-auto w-full max-w-5xl flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="Fairtab" className="size-10 rounded-xl shadow" />
          <span className="display text-xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>Fairtab</span>
        </div>
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
            Sign in
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10 md:py-16">
        <h1 className="display text-4xl md:text-5xl font-bold tracking-tight leading-[1.15]" style={{ color: 'var(--ink)' }}>
          Split bills fairly.<br />Settle in USDC.
        </h1>
        <p className="mt-4 max-w-xl text-base md:text-lg leading-relaxed" style={{ color: 'var(--muted)' }}>
          Fairtab is a household bill splitter on the Arc blockchain. Create a shared bill for rent,
          utilities or anything else, let everyone pay their share in USDC, and the payee is paid
          once the bill is fully funded.
        </p>
        <button
          onClick={onGetStarted}
          className="mt-8 rounded-2xl px-6 py-3.5 text-base font-semibold"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          Get started
        </button>

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <section
              key={title}
              className="rounded-2xl p-5"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="size-9 rounded-xl flex items-center justify-center mb-3" style={{ background: 'var(--accent)' }}>
                <Icon className="size-4 text-white" />
              </div>
              <h2 className="font-semibold" style={{ color: 'var(--ink)' }}>{title}</h2>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{text}</p>
            </section>
          ))}
        </div>

        <section className="mt-12 max-w-xl">
          <h2 className="font-semibold" style={{ color: 'var(--ink)' }}>How Fairtab uses Google sign-in</h2>
          <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
            You can sign in with Google to identify your account. Fairtab receives your name, email
            address and profile picture from Google only to show them in the app. See the privacy
            policy for details.
          </p>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-5 py-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"
        style={{ borderTop: '1px solid var(--border)', color: 'var(--muted)' }}>
        <span>&copy; 2026 Fairtab</span>
        <a href="/privacy" className="underline">Privacy Policy</a>
        <a href="/terms" className="underline">Terms of Service</a>
      </footer>
    </div>
  )
}
