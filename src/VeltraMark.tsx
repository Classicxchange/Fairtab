/**
 * Veltra's mark: the head of the Veltra robot on a dark navy tile.
 * The tile keeps the head readable on both light and dark pages.
 * Images live in /public (veltra-head.webp, veltra.webp). Plain <img> so it also
 * renders in the static landing page copy.
 */

export const VELTRA_TILE = 'radial-gradient(circle at 50% 38%, #1b3a8f 0%, #0b1a4a 62%, #070f2b 100%)'

/** The robot head alone, sized by width. */
export function VeltraHead({ width = 40, className }: { width?: number; className?: string }) {
  return (
    <img
      src="/veltra-head.webp"
      alt=""
      aria-hidden="true"
      width={width}
      height={Math.round(width * 0.656)}
      decoding="async"
      className={className}
      style={{ display: 'block', width, height: 'auto' }}
    />
  )
}

/** The robot head on a rounded dark tile. */
export function VeltraBadge({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        background: VELTRA_TILE,
        border: '1px solid rgba(96,165,250,0.35)',
        boxShadow: '0 4px 14px rgba(37,99,235,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
      }}
    >
      <VeltraHead width={Math.round(size * 0.84)} />
    </span>
  )
}

/** Small tile used where an icon component is expected (menus, labels). */
export function VeltraIcon({ className }: { className?: string }) {
  return <VeltraBadge size={22} className={className} />
}
