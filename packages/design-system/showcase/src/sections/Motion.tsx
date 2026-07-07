/**
 * Motion — the "spring physics, not linear" invariant, live.
 *
 * Two playgrounds:
 *   1. Trigger the same panel entrance with linear ease vs Cradle spring —
 *      the difference is visceral, not theoretical.
 *   2. A 3-in-1 spring gallery (default / message / drill-in) with the
 *      exact stiffness/damping values used by apps/web.
 *
 * We use CSS keyframes here (no framer-motion in the showcase deps) but the
 * spring curve is approximated with cubic-bezier ~(0.16, 1, 0.3, 1) which
 * closely matches stiffness 600 / damping 40.
 */

import { useCallback, useEffect, useState } from 'react'

import type { Lang } from '../i18n'
import { t } from '../i18n'

interface MotionProps {
  lang: Lang
}

type Mode = 'linear' | 'spring'

function Trigger({ onFire, label }: { onFire: () => void, label: string }) {
  return (
    <button
      onClick={onFire}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 28,
        padding: '0 12px',
        background: 'var(--color-neutral-9)',
        color: 'var(--color-neutral-1)',
        border: 'none',
        borderRadius: 8,
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      ▶
{' '}
{label}
    </button>
  )
}

function Stage({
  active,
  mode,
  keyframeName,
}: {
  active: boolean
  mode: Mode
  keyframeName: string
}) {
  const easing = mode === 'linear' ? 'linear' : 'cubic-bezier(0.16, 1, 0.3, 1)'
  return (
    <div
      style={{
        position: 'relative',
        height: 120,
        background: 'var(--color-neutral-2)',
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: 'var(--shadow-inset-ring)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 16,
          bottom: 16,
          left: 16,
          width: 220,
          borderRadius: 8,
          background: 'var(--color-surface)',
          boxShadow: 'var(--shadow-sm)',
          padding: '10px 14px',
          fontFamily: 'var(--font-sans)',
          fontSize: 12,
          color: 'var(--color-neutral-7)',
          transform: active ? 'translateX(0) scale(1)' : 'translateX(-260px) scale(0.98)',
          opacity: active ? 1 : 0,
          filter: active ? 'blur(0)' : 'blur(4px)',
          transition: active
            ? `transform 400ms ${easing}, opacity 260ms ${easing}, filter 300ms ${easing}`
            : 'none',
          animation: active ? `${keyframeName} 700ms ${easing}` : undefined,
        }}
      >
        <p style={{ margin: 0, fontWeight: 500, color: 'var(--color-neutral-9)' }}>Panel entrance</p>
        <p style={{ margin: '4px 0 0', fontSize: 11 }}>{mode === 'linear' ? 'linear · duration 400ms' : 'spring · stiffness 600 damping 40'}</p>
      </div>
    </div>
  )
}

export default function Motion({ lang }: MotionProps) {
  const [linearOn, setLinearOn] = useState(false)
  const [springOn, setSpringOn] = useState(false)

  const trigger = useCallback((setter: (v: boolean) => void) => {
    setter(false)
    // Force reflow so the animation restarts on repeated clicks
    requestAnimationFrame(() => requestAnimationFrame(() => setter(true)))
  }, [])

  // Auto-fire once on mount so the section is not visually inert
  useEffect(() => {
    const t1 = setTimeout(setLinearOn, 300, true)
    const t2 = setTimeout(setSpringOn, 300, true)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  return (
    <section className="section">
      <div className="section-head">
        <p className="section-num">{t('motionNum', lang)}</p>
        <h2 className="section-title">{t('motionTitle', lang)}</h2>
        <p className="section-lede">{t('motionLede', lang)}</p>
      </div>

      {/* Side-by-side comparison */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 40 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: 'var(--color-neutral-9)' }}>
              {t('motionLinearTitle', lang)}
            </span>
            <Trigger onFire={() => trigger(setLinearOn)} label="replay" />
          </div>
          <Stage active={linearOn} mode="linear" keyframeName="motion-linear" />
          <p style={{ margin: '10px 0 0', fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-neutral-6)', lineHeight: 1.5 }}>
            {t('motionLinearDesc', lang)}
          </p>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: 'var(--color-neutral-9)' }}>
              {t('motionSpringTitle', lang)}
            </span>
            <Trigger onFire={() => trigger(setSpringOn)} label="replay" />
          </div>
          <Stage active={springOn} mode="spring" keyframeName="motion-spring" />
          <p style={{ margin: '10px 0 0', fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-neutral-6)', lineHeight: 1.5 }}>
            {t('motionSpringDesc', lang)}
          </p>
        </div>
      </div>

      {/* Spring token table */}
      <p className="subhead">{t('motionTokenHead', lang)}</p>
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
        {[
          {
            name: 'Spring default',
            token: '--spring-default-* (600 / 40)',
            use: 'Tab switches, panel toggles, accordions',
          },
          {
            name: 'Spring message',
            token: '--spring-message-* (500 / 35)',
            use: 'Chat message entrance — warmer, slightly slower',
          },
          {
            name: 'Panel drill-in',
            token: '--spring-drill-* (600 / 40, mass 0.8)',
            use: 'Forward navigation with x + blur transform',
          },
          {
            name: 'CSS fallback',
            token: '--ease-standard cubic-bezier(0.22, 1, 0.36, 1)',
            use: 'Non-interactive transitions (icon swap, theme flip)',
          },
        ].map(({ name, token, use }, i, arr) => (
          <div key={name} style={{
            display: 'grid',
            gridTemplateColumns: '180px 1fr 1fr',
            borderBottom: i < arr.length - 1 ? '1px solid var(--color-border)' : undefined,
          }}
          >
            <div style={{ padding: '10px 16px', background: 'var(--color-neutral-2)', borderRight: '1px solid var(--color-border)' }}>
              <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500, color: 'var(--color-neutral-7)' }}>{name}</p>
            </div>
            <div style={{ padding: '10px 14px', borderRight: '1px solid var(--color-border)' }}>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-8)' }}>{token}</code>
            </div>
            <div style={{ padding: '10px 14px' }}>
              <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-neutral-6)' }}>{use}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
