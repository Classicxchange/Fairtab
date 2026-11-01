/**
 * Bill category icons: solid, layered illustrations (24x24) that use the current
 * text colour, so they follow the tile's colour and turn white when selected.
 * Rendered at the same size as before (size-4 inside the size-8 tile).
 */

import type { CSSProperties, ReactNode } from 'react'

interface IconProps {
  className?: string
  style?: CSSProperties
}

function Svg({ className, style, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** House with chimney and door */
export function HomeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="16.2" y="3.6" width="2.6" height="5" rx=".7" opacity=".55" />
      <path
        fillRule="evenodd"
        d="M11.3 2.9a1.1 1.1 0 0 1 1.4 0l8.5 7.3a1 1 0 0 1-.65 1.76H19.3V19.6a1.9 1.9 0 0 1-1.9 1.9h-2.6v-4.6a1.2 1.2 0 0 0-1.2-1.2h-3.2a1.2 1.2 0 0 0-1.2 1.2v4.6H6.6a1.9 1.9 0 0 1-1.9-1.9v-7.64H3.45a1 1 0 0 1-.65-1.76z"
      />
    </Svg>
  )
}

/** Lightning bolt with a glow */
export function BoltIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13.6 1.9 4.4 13.2h5.5L8.8 22.1 19.6 10.6h-5.7z" opacity=".35" transform="translate(.2 .4) scale(.985)" />
      <path
        d="M13.4 2 4.6 12.9h5.7l-1.1 8.7 9.2-11.1h-5.6z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

/** Wi-Fi signal: arcs fade out with distance */
export function WifiSignalIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.4 9.2a14.2 14.2 0 0 1 19.2 0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity=".4" />
      <path d="M5.8 12.7a9.4 9.4 0 0 1 12.4 0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity=".7" />
      <path d="M9.2 16.2a4.6 4.6 0 0 1 5.6 0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="12" cy="19.6" r="1.8" />
    </Svg>
  )
}

/** Shopping cart with items */
export function CartIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M1.9 3.4h2.6a1 1 0 0 1 .98.8l.45 2.4" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.3 6.5h15.6a.9.9 0 0 1 .88 1.1l-1.5 6a1.9 1.9 0 0 1-1.84 1.4H8.8a1.9 1.9 0 0 1-1.86-1.5z" />
      <circle cx="9.3" cy="19.4" r="1.9" />
      <circle cx="17.2" cy="19.4" r="1.9" />
      <rect x="9" y="2.6" width="3.2" height="3.2" rx=".8" opacity=".55" />
      <rect x="13.4" y="3.6" width="3" height="2.2" rx=".7" opacity=".55" />
    </Svg>
  )
}

/** Car, side view, with windows and wheels */
export function CarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M5.7 7.9A2.4 2.4 0 0 1 7.8 6.6h8.4a2.4 2.4 0 0 1 2 1.1l1.6 2.5 1.2.3c1 .25 1.7 1.15 1.7 2.2v3a1.2 1.2 0 0 1-1.2 1.2h-.7a2.9 2.9 0 0 0-5.7 0H9.2a2.9 2.9 0 0 0-5.7 0h-.3A1.2 1.2 0 0 1 2 15.7v-2.9c0-1 .7-1.9 1.6-2.2l.6-.2zM8.2 8.5 6.7 10.7h4.2V8.5zm4.6 0v2.2h5.1l-1.4-2.1a.8.8 0 0 0-.7-.4z"
      />
      <circle cx="6.35" cy="17.2" r="2.35" />
      <circle cx="17.65" cy="17.2" r="2.35" />
      <circle cx="6.35" cy="17.2" r=".9" opacity=".35" fill="#fff" />
      <circle cx="17.65" cy="17.2" r=".9" opacity=".35" fill="#fff" />
    </Svg>
  )
}

/** Lightbulb with base */
export function BulbIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 1.9a7.2 7.2 0 0 0-4.2 13.1v1.9a1.3 1.3 0 0 0 1.3 1.3h5.8a1.3 1.3 0 0 0 1.3-1.3V15A7.2 7.2 0 0 0 12 1.9z" />
      <rect x="8.9" y="19.1" width="6.2" height="1.8" rx=".9" opacity=".7" />
      <rect x="10.1" y="21.5" width="3.8" height="1.4" rx=".7" opacity=".45" />
      <path d="M9.4 8.6a3 3 0 0 1 2.3-2.3" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity=".5" />
    </Svg>
  )
}

/** Dumbbell with plates */
export function DumbbellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6.5" y="10.8" width="11" height="2.4" rx="1.1" opacity=".7" />
      <rect x="4.4" y="6" width="3.3" height="12" rx="1.3" />
      <rect x="16.3" y="6" width="3.3" height="12" rx="1.3" />
      <rect x="1.6" y="8.6" width="2.4" height="6.8" rx="1.1" opacity=".7" />
      <rect x="20" y="8.6" width="2.4" height="6.8" rx="1.1" opacity=".7" />
    </Svg>
  )
}

/** Fork and knife */
export function CutleryIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M5 2.6v5.2a2.5 2.5 0 0 0 5 0V2.6M7.5 2.6v6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="6.5" y="9" width="2" height="12.4" rx="1" />
      <path d="M17.2 2.4c2.3 1.2 3.4 4 3.4 7.3v3.2h-3.4z" opacity=".75" />
      <rect x="16.2" y="12.4" width="2.2" height="9" rx="1.1" />
    </Svg>
  )
}

/** Airplane in flight */
export function PlaneIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <g transform="rotate(45 12 12)">
        <path d="M21.4 15.8v-1.9l-7.9-4.8V3.8a1.5 1.5 0 0 0-3 0v5.3l-7.9 4.8v1.9l7.9-2.4v4.6l-2 1.5v1.6l3.5-1 3.5 1v-1.6l-2-1.5v-4.6z" />
      </g>
    </Svg>
  )
}

/** Isometric parcel box */
export function ParcelIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2 21.2 6.6 12 11.2 2.8 6.6z" opacity=".55" />
      <path d="M2.8 8.3 11.1 12.4v9.4L2.8 17.6z" />
      <path d="M21.2 8.3 12.9 12.4v9.4l8.3-4.2z" opacity=".8" />
    </Svg>
  )
}
