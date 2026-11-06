/**
 * Veltra's mark: the three-sparkle glyph people associate with AI assistants,
 * on a blue-to-cyan gradient tile. Pure SVG so it also renders in the static
 * landing page copy.
 */
import type { CSSProperties } from 'react'

const STAR = 'M12 2C12.6 7.5 16.5 11.4 22 12C16.5 12.6 12.6 16.5 12 22C11.4 16.5 7.5 12.6 2 12C7.5 11.4 11.4 7.5 12 2Z'

export const VELTRA_GRADIENT = 'linear-gradient(135deg, #2563EB 0%, #4F6BF5 50%, #22B8E8 100%)'

/** The sparkle glyph alone. Takes its colour from the surrounding text colour. */
export function VeltraGlyph({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className} style={style}>
      <path d={STAR} transform="translate(9.5 14.5) scale(0.64) translate(-12 -12)" />
      <path className="veltra-twinkle" d={STAR} transform="translate(19 6) scale(0.3) translate(-12 -12)" />
      <path className="veltra-twinkle veltra-twinkle-late" d={STAR} transform="translate(19.5 18.5) scale(0.18) translate(-12 -12)" />
    </svg>
  )
}

/** The glyph in white on the Veltra gradient tile. */
export function VeltraBadge({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        background: VELTRA_GRADIENT,
        boxShadow: '0 4px 14px rgba(59,94,245,0.38), inset 0 1px 0 rgba(255,255,255,0.28)',
        color: '#fff',
      }}
    >
      <VeltraGlyph style={{ width: size * 0.64, height: size * 0.64 }} />
    </span>
  )
}
