/**
 * Veltra: the Fairtab assistant. A floating button opens a chat that answers
 * questions and can PREPARE a bill draft, a send, a swap or open a screen.
 * Veltra never signs or sends anything: every action opens a normal screen where
 * you review and confirm the transaction yourself.
 */

import { useEffect, useRef, useState } from 'react'
import { X, Send, ArrowRight, ShieldCheck } from 'lucide-react'
import { VeltraBadge, VELTRA_TILE } from '@/VeltraMark'
import { toast } from 'sonner'
import { DRAFT_KEY } from '@/CreateBillPage'

interface Action {
  type: 'bill' | 'send' | 'swap' | 'navigate'
  to?: string
  amount?: string
  from?: string
  tab?: string
  draft?: Record<string, unknown>
  missing?: string[]
  warnings?: string[]
  step?: 1 | 2 | 3
}
interface Msg { role: 'user' | 'assistant'; content: string; action?: Action | null }

const SUGGESTIONS = [
  'Split a bill with friends',
  'How do I send USDC?',
  'Swap USDC to EURC',
  'Is Fairtab custodial?',
  'What is Arc?',
]

const TAB_PATH: Record<string, string> = {
  bills: '/app', send: '/app/send', receive: '/app/receive', swap: '/app/swap',
  commit: '/app/commit', account: '/app/account', help: '/help',
}

function actionLabel(a: Action): string {
  switch (a.type) {
    case 'bill': return a.step === 3 ? 'Review bill draft' : 'Continue bill draft'
    case 'send': return a.amount ? `Open Send · ${a.amount} USDC` : 'Open Send'
    case 'swap': return a.amount ? `Open Swap · ${a.amount} ${a.from} to ${a.to}` : `Open Swap · ${a.from} to ${a.to}`
    default: return `Open ${a.tab ?? 'screen'}`
  }
}

export function VeltraChat({ address, onOpenBill, onGo }: {
  address: string
  onOpenBill: () => void
  onGo: (path: string) => void
}) {
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  // Only offer Veltra when the server has a model key configured
  useEffect(() => {
    let cancelled = false
    fetch('/api/assistant/draft')
      .then(r => r.json() as Promise<{ enabled?: boolean }>)
      .then(d => { if (!cancelled) setEnabled(!!d.enabled) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy, open])

  const run = (a: Action) => {
    setOpen(false)
    if (a.type === 'bill' && a.draft) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...a.draft, step: a.step ?? 2, advancedOpen: false }))
      onOpenBill()
      if (a.step === 3) toast.success('Draft ready. Check it, then create the bill yourself.')
      else if (a.missing?.length) toast.message(`Draft started. Still needed: ${a.missing.slice(0, 3).join(', ')}.`)
      a.warnings?.slice(0, 2).forEach(w => toast.message(w))
    } else if (a.type === 'send' && a.to) {
      const q = new URLSearchParams({ to: a.to })
      if (a.amount) q.set('amount', a.amount)
      onGo(`/app/send?${q.toString()}`)
    } else if (a.type === 'swap' && a.from && a.to) {
      const q = new URLSearchParams({ from: a.from, to: a.to })
      if (a.amount) q.set('amount', a.amount)
      onGo(`/app/swap?${q.toString()}`)
    } else if (a.type === 'navigate' && a.tab && TAB_PATH[a.tab]) {
      onGo(TAB_PATH[a.tab])
    }
  }

  const submit = async (override?: string) => {
    const content = (override ?? text).trim()
    if (!content || busy) return
    const next: Msg[] = [...messages, { role: 'user', content }]
    setMessages(next)
    setText('')
    setBusy(true)
    try {
      const res = await fetch('/api/assistant/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          messages: next.slice(-10).map(m => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await res.json() as { reply?: string; action?: Action | null; error?: string }
      if (!res.ok || data.error) {
        setMessages(m => [...m, { role: 'assistant', content: data.error ?? 'Veltra could not answer that. Try again.' }])
      } else {
        setMessages(m => [...m, { role: 'assistant', content: data.reply ?? '', action: data.action ?? null }])
      }
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'I could not reach the server. Check your connection and try again.' }])
    } finally {
      setBusy(false)
    }
  }

  if (!enabled) return null

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open Veltra, the Fairtab assistant"
          className="fixed right-4 z-40 flex h-12 items-center gap-2 rounded-full pl-3 pr-4 text-sm font-semibold shadow-lg transition-transform hover:scale-105 active:scale-95 bottom-[calc(1rem+env(safe-area-inset-bottom))] lg:bottom-6 lg:right-6"
          style={{ background: VELTRA_TILE, color: '#fff', border: '1px solid rgba(96,165,250,0.45)', boxShadow: '0 8px 24px rgba(37,99,235,0.5), inset 0 1px 0 rgba(255,255,255,0.14)' }}>
          <VeltraBadge size={30} className="-ml-2" />
          Veltra
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-end lg:justify-end lg:p-6"
          style={{ background: 'rgba(8,12,24,0.45)' }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="flex h-[85dvh] w-full flex-col overflow-hidden rounded-t-3xl lg:h-[600px] lg:w-[400px] lg:rounded-3xl"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg, 0 20px 60px rgba(0,0,0,.35))' }}>
            <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <VeltraBadge size={36} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Veltra</p>
                <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>Fairtab assistant</p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5" style={{ color: 'var(--muted)' }}>
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
              {messages.length === 0 && (
                <div className="flex flex-col gap-3">
                  <VeltraBadge size={44} />
                  <p className="text-sm" style={{ color: 'var(--ink)' }}>
                    Hi, I&apos;m Veltra. I can answer questions about Fairtab and get bills, sends and swaps ready for you to review.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map(s => (
                      <button key={s} onClick={() => { void submit(s) }}
                        className="rounded-full px-3 py-1.5 text-xs font-medium"
                        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex flex-col items-start gap-2'}>
                  {m.role === 'assistant' && <VeltraBadge size={22} />}
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm"
                    style={m.role === 'user'
                      ? { background: 'var(--accent-fill)', color: '#fff' }
                      : { background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                    {m.content}
                  </div>
                  {m.action && (
                    <button onClick={() => run(m.action as Action)}
                      className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold"
                      style={{ background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid var(--border)' }}>
                      {actionLabel(m.action)} <ArrowRight className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}

              {busy && (
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
                  <VeltraBadge size={22} className="animate-pulse" /> Veltra is thinking…
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="px-4 pb-3 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2">
                <input
                  value={text}
                  maxLength={600}
                  onChange={e => setText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void submit() }}
                  placeholder="Ask Veltra or describe what you want to do"
                  className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                />
                <button onClick={() => { void submit() }} disabled={busy || !text.trim()} aria-label="Send message"
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl disabled:opacity-40"
                  style={{ background: 'var(--accent-fill)', color: '#fff' }}>
                  <Send className="size-4" />
                </button>
              </div>
              <p className="mt-2 flex items-start gap-1.5 text-[11px]" style={{ color: 'var(--subtle)' }}>
                <ShieldCheck className="mt-px size-3 shrink-0" />
                Veltra never signs or sends anything. You review and confirm every transaction. Never share keys, PINs or recovery phrases.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
