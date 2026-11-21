/**
 * SupportPage: "Veltra Support". Public (no sign-in needed).
 * A chat for simple questions, with email as the next step when the chat cannot solve it.
 */

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Copy, Mail, Send, ShieldCheck } from 'lucide-react'
import { VeltraBadge } from '@/VeltraMark'
import { SUPPORT_EMAIL, supportMailto, gmailCompose } from '@/support'

interface Props { onBack: () => void }
interface Msg { role: 'user' | 'assistant'; content: string }

const GREETING = "Hi, I'm Veltra Support. Ask me a quick question about Fairtab, signing in, sending, swapping or Arc. If I can't solve it, I'll point you to the team by email."

const QUICK = [
  "I can't sign in",
  "My payment didn't arrive",
  'How do fees work?',
  'I lost access to my wallet',
]

function EmailCard({ highlight }: { highlight: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(SUPPORT_EMAIL).then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      }, () => undefined)
    }
  }
  return (
    <section id="email" aria-label="Email support" className="rounded-2xl p-4 scroll-mt-24"
      style={{
        background: 'var(--surface)',
        border: `1px solid ${highlight ? 'var(--accent)' : 'var(--border)'}`,
        boxShadow: highlight ? '0 0 0 3px var(--accent-light)' : 'none',
      }}>
      <div className="flex items-start gap-3">
        <Mail className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--accent)' }} />
        <div className="min-w-0 text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          <p className="font-semibold" style={{ color: 'var(--ink)' }}>
            {highlight ? 'Email the team' : 'Not solved? Email the team'}
          </p>
          <p className="mono mt-1 break-all text-sm font-semibold select-all" style={{ color: 'var(--ink)' }}>{SUPPORT_EMAIL}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold"
              style={{ background: 'var(--accent-fill)', color: '#fff' }}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy email'}
            </button>
            <a href={gmailCompose()} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center rounded-xl px-3 py-2 text-xs font-semibold"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
              Open in Gmail
            </a>
            <a href={supportMailto()}
              className="inline-flex items-center rounded-xl px-3 py-2 text-xs font-semibold"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
              Open my email app
            </a>
          </div>
          <p className="mt-3" style={{ color: 'var(--muted)' }}>
            Please include what you were trying to do, what happened, your wallet address and any transaction link.
          </p>
        </div>
      </div>
    </section>
  )
}

export function SupportPage({ onBack }: Props) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [escalate, setEscalate] = useState(false)
  const [botOn, setBotOn] = useState<boolean | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Is the chat set up on the server? If not, only the email card is shown.
  useEffect(() => {
    let cancelled = false
    fetch('/api/assistant/draft')
      .then(r => r.json() as Promise<{ enabled?: boolean }>)
      .then(d => { if (!cancelled) setBotOn(!!d.enabled) })
      .catch(() => { if (!cancelled) setBotOn(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, loading])

  const send = async (text: string) => {
    const content = text.trim().slice(0, 600)
    if (!content || loading) return
    const next: Msg[] = [...messages, { role: 'user', content }]
    setMessages(next)
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/assistant/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'support', messages: next }),
      })
      const data = await res.json() as { reply?: string; escalate?: boolean; error?: string }
      if (!res.ok || !data.reply) throw new Error(data.error ?? 'Veltra Support is unavailable right now.')
      setMessages([...next, { role: 'assistant', content: data.reply }])
      if (data.escalate) setEscalate(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Veltra Support is unavailable right now.'
      setMessages([...next, { role: 'assistant', content: `${msg} You can email the team instead using the options below.` }])
      setEscalate(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-5">
        <button onClick={onBack} className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--accent)' }}>
          <ArrowLeft className="size-4" /> Back
        </button>

        <header className="mb-5 flex items-center gap-3">
          <VeltraBadge size={52} />
          <div>
            <h1 className="display text-2xl font-bold tracking-tight md:text-3xl" style={{ color: 'var(--ink)' }}>Veltra Support</h1>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Quick answers now. The team by email if I can&apos;t solve it.</p>
          </div>
        </header>

        {botOn !== false && (
          <section aria-label="Chat with Veltra Support" className="flex flex-col overflow-hidden rounded-2xl"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex h-[min(58dvh,480px)] flex-col gap-3 overflow-y-auto p-4" role="log" aria-live="polite">
              <div className="flex items-start gap-2">
                <VeltraBadge size={26} className="mt-0.5 shrink-0" />
                <p className="max-w-[85%] rounded-2xl rounded-tl-md px-3.5 py-2.5 text-sm leading-relaxed"
                  style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}>{GREETING}</p>
              </div>

              {messages.length === 0 && (
                <div className="flex flex-wrap gap-2 pl-8">
                  {QUICK.map(q => (
                    <button key={q} type="button" onClick={() => void send(q)}
                      className="rounded-full px-3 py-1.5 text-xs font-semibold"
                      style={{ background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}>
                      {q}
                    </button>
                  ))}
                </div>
              )}

              {messages.map((m, i) => m.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-md px-3.5 py-2.5 text-sm leading-relaxed"
                    style={{ background: 'var(--accent-fill)', color: '#fff' }}>{m.content}</p>
                </div>
              ) : (
                <div key={i} className="flex items-start gap-2">
                  <VeltraBadge size={26} className="mt-0.5 shrink-0" />
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-md px-3.5 py-2.5 text-sm leading-relaxed"
                    style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}>{m.content}</p>
                </div>
              ))}

              {loading && (
                <div className="flex items-center gap-2">
                  <VeltraBadge size={26} className="shrink-0 animate-pulse" />
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Veltra Support is typing…</p>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <form onSubmit={e => { e.preventDefault(); void send(input) }}
              className="flex items-center gap-2 p-3" style={{ borderTop: '1px solid var(--border)' }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                maxLength={600}
                placeholder="Type your question"
                aria-label="Your question"
                className="min-w-0 flex-1 rounded-xl px-3.5 py-2.5 text-sm outline-none"
                style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }} />
              <button type="submit" disabled={loading || !input.trim()} aria-label="Send"
                className="flex size-10 shrink-0 items-center justify-center rounded-xl disabled:opacity-40"
                style={{ background: 'var(--accent-fill)', color: '#fff' }}>
                <Send className="size-4" />
              </button>
            </form>
          </section>
        )}

        {botOn === false && (
          <p className="mb-1 rounded-2xl p-4 text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
            The chat is not available right now. Please email the team below.
          </p>
        )}

        <div className="mt-4">
          <EmailCard highlight={escalate || botOn === false} />
        </div>

        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          Never share your PIN, security answers, seed phrase or private key here or by email. We will never ask for them.
          Messages in this chat are processed by an AI service.
        </p>
      </div>
    </div>
  )
}
