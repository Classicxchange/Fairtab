/**
 * BillAssistant: describe a bill in plain English and get a pre-filled draft.
 * The assistant only prepares the form. It never signs or sends anything: the draft
 * opens on the normal review screen, and you confirm the transaction yourself.
 */

import { useEffect, useState } from 'react'
import { Sparkles, Loader2, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { DRAFT_KEY } from '@/CreateBillPage'

interface DraftResponse {
  draft: Record<string, unknown>
  missing: string[]
  warnings: string[]
  step: 1 | 2 | 3
  error?: string
}

export function BillAssistant({ address, onDraftReady }: { address: string; onDraftReady: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState(false)

  // Only show the box when the server has a model key configured
  useEffect(() => {
    let cancelled = false
    fetch('/api/assistant/draft')
      .then(r => r.json() as Promise<{ enabled?: boolean }>)
      .then(d => { if (!cancelled) setEnabled(!!d.enabled) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const submit = async () => {
    const prompt = text.trim()
    if (!prompt || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/assistant/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, address }),
      })
      const data = await res.json() as DraftResponse
      if (!res.ok || data.error) {
        toast.error(data.error ?? 'Veltra could not draft that. Try again.')
        return
      }
      // Same format the bill form already saves, so it opens exactly where it should
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        ...data.draft,
        step: data.step,
        advancedOpen: false,
      }))
      setText('')
      onDraftReady()
      if (data.step === 3) {
        toast.success('Draft ready. Check it, then create the bill yourself.')
      } else {
        toast.message(`Draft started. Still needed: ${data.missing.slice(0, 3).join(', ')}.`)
      }
      data.warnings.slice(0, 2).forEach(w => toast.message(w))
    } catch {
      toast.error('Could not reach Veltra. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  if (!enabled) return null

  return (
    <div className="rounded-2xl p-3.5 flex flex-col gap-2.5"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-xl" style={{ background: 'var(--accent-light)' }}>
          <Sparkles className="size-3.5" style={{ color: 'var(--accent)' }} />
        </span>
        <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Veltra <span className="font-normal" style={{ color: 'var(--muted)' }}>· describe your bill</span></p>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={text}
          maxLength={600}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void submit() }}
          placeholder="e.g. Split $120 rent with 0x… and 0x…, I get paid"
          className="flex-1 min-w-0 rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
        />
        <button
          onClick={() => { void submit() }}
          disabled={busy || !text.trim()}
          aria-label="Draft bill"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#fff' }}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
        </button>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>
        Veltra only fills in the form. You review it and confirm the transaction yourself.
      </p>
    </div>
  )
}
