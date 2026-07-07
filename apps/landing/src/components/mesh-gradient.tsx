/**
 * MeshGradient — layered radial-gradient "mesh" backdrop.
 *
 * Several overlapping radial gradients sit at different points across the
 * frame; `mix-blend-mode: screen` stacks them additively on the dark base so
 * the color zones blend with no hard edges. A bottom fade melts the gradient
 * into the page's solid background, and a soft center scrim keeps centered
 * text legible against the brighter blooms.
 */

import type { CSSProperties } from 'react'

interface MeshGradientProps {
  /** Extra styles on the root layer (e.g. to scope opacity). */
  style?: CSSProperties
}

export function MeshGradient({ style }: MeshGradientProps) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: 'var(--bg)',
        ...style,
      }}
    >
      {/* Color zones — screen-blended so overlaps add light, not edges. */}
      <Layer blend="screen" background="radial-gradient(42% 52% at 18% 26%, rgba(139,92,248,0.55), transparent 60%)" />
      <Layer blend="screen" background="radial-gradient(40% 50% at 84% 20%, rgba(251,146,60,0.45), transparent 60%)" />
      <Layer blend="screen" background="radial-gradient(46% 56% at 78% 80%, rgba(34,211,238,0.42), transparent 60%)" />
      <Layer blend="screen" background="radial-gradient(38% 48% at 22% 82%, rgba(236,72,153,0.38), transparent 60%)" />
      <Layer blend="screen" background="radial-gradient(30% 40% at 50% 50%, rgba(99,102,241,0.28), transparent 65%)" />

      {/* Fade into the solid page below so the hero doesn't end on a hard line. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to bottom, transparent 58%, var(--bg) 100%)',
        }}
      />

      {/* Center scrim for text legibility. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(44% 40% at 50% 48%, rgba(8,8,10,0.5), transparent 72%)',
        }}
      />
    </div>
  )
}

function Layer({ blend, background }: { blend: 'screen' | 'normal', background: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background,
        mixBlendMode: blend,
      }}
    />
  )
}
