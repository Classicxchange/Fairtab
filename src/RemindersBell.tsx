import { useEffect, useRef, useState } from 'react'
import { Bell, Copy, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import type { Notice } from '@/reminders'

const DOT: Record<Notice['kind'], string> = {
  invite: 'var(--accent)', overdue: 'var(--danger)', 'due-soon': 'var(--warning)', waiting: 'var(--subtle)', payment: 'var(--success)',
}

export function RemindersBell({ notices, onOpenBill, onOpened }: {
  notices: Notice[]
  onOpenBill: (id: bigint) => void
  /** Called when the panel opens, so "new payment" notices can be marked as seen */
  onOpened: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  // Things that need action count on the badge; "waiting on others" is informational
  const urgent = notices.filter(n => n.kind !== 'waiting').length

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(o => { if (!o) onOpened(); return !o }) }}
        aria-label={`Reminders${urgent ? `, ${urgent} new` : ''}`}
        className="relative flex size-9 items-center justify-center rounded-full"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)', color: 'var(--ink-2)' }}>
        <Bell className="size-4" />
        {urgent > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-[16px] h-4 items-center justify-center rounded-full px-1 text-[10px] font-bold"
            style={{ background: 'var(--danger)', color: '#fff' }}>{urgent}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl"
          style={{ background: 'var(--popover)', border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-lg)' }}>
          <p className="px-4 py-3 text-sm font-bold" style={{ color: 'var(--ink)', borderBottom: '1px solid var(--border)' }}>Reminders</p>
          <div className="max-h-[60dvh] overflow-y-auto">
            {notices.length === 0 && (
              <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>You are all caught up.</p>
            )}
            {notices.map(n => (
              <div key={n.key} className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                <button onClick={() => { setOpen(false); onOpenBill(n.billId) }} className="flex w-full items-start gap-2.5 text-left">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: DOT[n.kind] }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold" style={{ color: 'var(--ink)' }}>{n.title}</span>
                    <span className="block text-xs" style={{ color: 'var(--muted)' }}>{n.detail}</span>
                  </span>
                  <ChevronRight className="mt-1 size-4 shrink-0" style={{ color: 'var(--subtle)' }} />
                </button>
                {n.remindText && (
                  <button
                    onClick={() => { void navigator.clipboard.writeText(n.remindText!); toast.success('Reminder copied. Paste it in a chat.') }}
                    className="ml-[18px] mt-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
                    style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
                    <Copy className="size-3" /> Copy reminder message
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
