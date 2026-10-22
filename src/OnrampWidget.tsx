import { useEffect, useRef, useState } from 'react'
import { createOnrampKit, fetchOnrampSession, KitError } from '@circle-fin/onramp-kit'
import type { OnrampDepositInfo, OnrampSession, OnrampSessionRequest } from '@circle-fin/onramp-kit'
import { Loader2, X } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'

const WIDGET_BASE_URL = 'https://onramp.arc.io'

// ─── Mounted widget ───────────────────────────────────────────────────────────
function MountedWidget({
  session,
  onComplete,
  onClose,
}: {
  session: OnrampSession
  onComplete: (info: OnrampDepositInfo) => void
  onClose: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const cb = useRef({ onComplete, onClose })
  useEffect(() => { cb.current = { onComplete, onClose } })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const kit = createOnrampKit({ widgetBaseUrl: WIDGET_BASE_URL })
    let credited = false
    const credit = (info: OnrampDepositInfo) => {
      if (credited) return
      credited = true
      cb.current.onComplete(info)
    }
    const widget = kit.mountIframe({
      session,
      container,
      title: 'Add funds',
      onInitializationSuccess: () => setReady(true),
      onInitializationError: () => cb.current.onClose(),
      onDepositSubmitted: (e) => credit(e.payload),
      onDepositSettled: (e) => credit(e.payload),
      onDepositNotCompleted: () => cb.current.onClose(),
    })
    return () => widget.close()
  }, [session])

  return (
    <div ref={containerRef} style={{ width: '100%', minHeight: 560, position: 'relative' }}>
      {!ready && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl"
          style={{ background: 'rgba(255,255,255,0.85)' }}
        >
          <TokenUSDC variant="branded" size={36} />
          <Loader2 className="size-5 animate-spin" style={{ color: 'var(--accent)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>Loading payment widget…</p>
        </div>
      )}
    </div>
  )
}

// ─── Public component — handles session fetch + mounting ─────────────────────
export function OnrampWidget({
  destinationAddress,
  suggestedAmount,
  onComplete,
  onClose,
}: {
  /** The wallet address that will receive the purchased USDC */
  destinationAddress: string
  /** Optional pre-fill amount in USDC (e.g. the user's remaining share) */
  suggestedAmount?: number
  onComplete: (info: OnrampDepositInfo) => void
  onClose: () => void
}) {
  type FetchState =
    | { status: 'loading' }
    | { status: 'ready'; session: OnrampSession }
    | { status: 'error'; message: string }

  const [fetchState, setFetchState] = useState<FetchState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    const body: OnrampSessionRequest = {
      appUserId: destinationAddress,
      destinationAddress,
      ...(suggestedAmount && suggestedAmount > 0
        ? { amount: suggestedAmount.toFixed(2), currency: 'USD' }
        : {}),
    }

    fetchOnrampSession({ url: '/api/onramp/sessions', body })
      .then((s) => { if (!cancelled) setFetchState({ status: 'ready', session: s }) })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof KitError ? err.message : 'Could not start onramp session.'
          setFetchState({ status: 'error', message })
        }
      })

    return () => { cancelled = true }
  }, [destinationAddress, suggestedAmount])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,20,40,0.55)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="relative w-full max-w-md rounded-3xl overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.96)',
          border: '1px solid rgba(18,45,69,0.10)',
          boxShadow: '0 32px 64px rgba(10,20,40,0.18)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(18,45,69,0.08)' }}>
          <div className="flex items-center gap-2.5">
            <TokenUSDC variant="branded" size={22} />
            <span className="font-bold text-base" style={{ color: 'var(--ink)' }}>Buy USDC with your bank</span>
          </div>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-slate-100"
            style={{ color: 'var(--muted)' }}
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          {fetchState.status === 'loading' && (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Loader2 className="size-6 animate-spin" style={{ color: 'var(--accent)' }} />
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Starting secure session…</p>
            </div>
          )}
          {fetchState.status === 'error' && (
            <div className="flex flex-col items-center gap-3 py-12 text-center px-4">
              <p className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>{fetchState.message}</p>
              <button
                onClick={onClose}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-white"
                style={{ background: 'var(--accent)' }}
              >
                Close
              </button>
            </div>
          )}
          {fetchState.status === 'ready' && (
            <MountedWidget
              session={fetchState.session}
              onComplete={onComplete}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  )
}
