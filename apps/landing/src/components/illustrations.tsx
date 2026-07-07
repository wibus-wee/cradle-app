/**
 * Illustrations — branded SVG marks for the feature cards.
 *
 * Abstract, geometric, gradient-filled (sharing the mesh palette: violet,
 * amber, cyan, rose). Each is self-contained at 44×44 with unique gradient
 * ids so they can coexist on the same page.
 */

import type { CSSProperties } from 'react'

const size: CSSProperties = { width: 44, height: 44, display: 'block' }

/* 1. Unified — four panes, one home. */
export function UnifiedIllustration() {
  return (
    <svg viewBox="0 0 48 48" fill="none" style={size} aria-hidden="true">
      <defs>
        <linearGradient id="ill-u-v" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
        <linearGradient id="ill-u-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#fb923c" />
        </linearGradient>
        <linearGradient id="ill-u-c" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#67e8f9" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        <linearGradient id="ill-u-r" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f472b6" />
          <stop offset="1" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <rect x="7" y="7" width="18" height="18" rx="4.5" fill="url(#ill-u-v)" opacity="0.95" />
      <rect x="23" y="7" width="18" height="18" rx="4.5" fill="url(#ill-u-a)" opacity="0.95" />
      <rect x="7" y="23" width="18" height="18" rx="4.5" fill="url(#ill-u-c)" opacity="0.95" />
      <rect x="23" y="23" width="18" height="18" rx="4.5" fill="url(#ill-u-r)" opacity="0.95" />
    </svg>
  )
}

/* 2. Field — radar over a scattered field of dots. */
export function FieldIllustration() {
  const dots: Array<[number, number]> = [
    [12, 12],
[36, 12],
[12, 36],
[36, 36],
    [24, 8],
[8, 24],
[40, 24],
[24, 40],
  ]
  return (
    <svg viewBox="0 0 48 48" fill="none" style={size} aria-hidden="true">
      <defs>
        <radialGradient id="ill-f-g" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#67e8f9" />
          <stop offset="1" stopColor="#0891b2" />
        </radialGradient>
      </defs>
      {dots.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.4" fill="#67e8f9" opacity="0.4" />
      ))}
      <circle cx="24" cy="24" r="20" stroke="url(#ill-f-g)" strokeWidth="1.2" opacity="0.22" />
      <circle cx="24" cy="24" r="13" stroke="url(#ill-f-g)" strokeWidth="1.2" opacity="0.4" />
      <circle cx="24" cy="24" r="6" stroke="url(#ill-f-g)" strokeWidth="1.4" opacity="0.7" />
      <circle cx="24" cy="24" r="2.6" fill="url(#ill-f-g)" />
    </svg>
  )
}

/* 3. Coordinate — two agents merging into one coordinated outcome. */
export function CoordinateIllustration() {
  return (
    <svg viewBox="0 0 48 48" fill="none" style={size} aria-hidden="true">
      <defs>
        <linearGradient id="ill-co-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <path d="M14 16 Q14 28 22 34" stroke="url(#ill-co-g)" strokeWidth="1.5" fill="none" opacity="0.55" strokeLinecap="round" />
      <path d="M34 16 Q34 28 26 34" stroke="url(#ill-co-g)" strokeWidth="1.5" fill="none" opacity="0.55" strokeLinecap="round" />
      <circle cx="14" cy="13" r="4.5" fill="url(#ill-co-g)" />
      <circle cx="34" cy="13" r="4.5" fill="url(#ill-co-g)" />
      <circle cx="24" cy="36" r="5" fill="url(#ill-co-g)" />
    </svg>
  )
}

/* 4. Local-first — a shield with a check. */
export function LocalFirstIllustration() {
  return (
    <svg viewBox="0 0 48 48" fill="none" style={size} aria-hidden="true">
      <defs>
        <linearGradient id="ill-lf-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#fb923c" />
        </linearGradient>
      </defs>
      <path
        d="M24 5 L40 11 V23 C40 33 33 40.5 24 43.5 C15 40.5 8 33 8 23 V11 Z"
        fill="url(#ill-lf-g)"
        fillOpacity="0.14"
        stroke="url(#ill-lf-g)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M17 24 L22 29 L31 19"
        stroke="url(#ill-lf-g)"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
