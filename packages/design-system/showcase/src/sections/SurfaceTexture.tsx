/**
 * SurfaceTexture — the "inset, not elevation" invariant, side by side.
 *
 * Left: what Cradle refuses (Material-style floating cards on drop shadows).
 * Right: what Cradle does (1px oklch ring + subtle inset highlight, no lift).
 *
 * This is the single hardest habit to unlearn coming from web-app conventions,
 * so we render it — you *see* why the right column looks embedded and the left
 * column looks glued on.
 */

import type { Lang } from '../i18n'
import { t } from '../i18n'

interface SurfaceTextureProps {
  lang: Lang
}

function Card({ style, label }: { style: React.CSSProperties, label: string }) {
  return (
    <div style={{
      height: 96,
      padding: 14,
      borderRadius: 10,
      background: 'var(--color-surface)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      ...style,
    }}
    >
      <div style={{ height: 8, width: '60%', borderRadius: 2, background: 'var(--color-neutral-4)' }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-6)' }}>{label}</span>
    </div>
  )
}

export default function SurfaceTexture({ lang }: SurfaceTextureProps) {
  return (
    <section className="section">
      <div className="section-head">
        <p className="section-num">{t('surfaceNum', lang)}</p>
        <h2 className="section-title">{t('surfaceTitle', lang)}</h2>
        <p className="section-lede">{t('surfaceLede', lang)}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Wrong — elevation */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '1px 8px',
              background: 'rgba(239,68,68,0.1)',
              borderRadius: 9999,
              fontFamily: 'var(--font-sans)',
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--color-error)',
            }}
            >
              {t('surfaceWrongLabel', lang)}
            </span>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: 'var(--color-neutral-9)' }}>
              {t('surfaceWrongTitle', lang)}
            </span>
          </div>
          <div style={{
            padding: 24,
            background: 'var(--color-neutral-2)',
            borderRadius: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
          >
            <Card
              style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.08)' }}
              label="shadow-lg — floats"
            />
            <Card
              style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}
              label="shadow-md — lifts"
            />
          </div>
          <p style={{ margin: '10px 0 0', fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-neutral-6)', lineHeight: 1.5 }}>
            {t('surfaceWrongDesc', lang)}
          </p>
        </div>

        {/* Right — texture */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '1px 8px',
              background: 'rgba(16,185,129,0.1)',
              borderRadius: 9999,
              fontFamily: 'var(--font-sans)',
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--color-success)',
            }}
            >
              {t('surfaceRightLabel', lang)}
            </span>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: 'var(--color-neutral-9)' }}>
              {t('surfaceRightTitle', lang)}
            </span>
          </div>
          <div style={{
            padding: 24,
            background: 'var(--color-neutral-2)',
            borderRadius: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
          >
            <Card
              style={{ boxShadow: 'var(--shadow-sm)' }}
              label="shadow-sm — 1px oklch ring"
            />
            <Card
              style={{
                background: 'var(--color-surface-inset)',
                boxShadow: 'var(--shadow-inset-ring)',
              }}
              label="inset-ring — recessed well"
            />
          </div>
          <p style={{ margin: '10px 0 0', fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-neutral-6)', lineHeight: 1.5 }}>
            {t('surfaceRightDesc', lang)}
          </p>
        </div>
      </div>

      {/* Shadow token gallery */}
      <p className="subhead" style={{ marginTop: 40 }}>{t('surfaceShadowHead', lang)}</p>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {[
          { name: 'xs', shadow: 'var(--shadow-xs)', use: 'Inputs, small controls' },
          { name: 'sm', shadow: 'var(--shadow-sm)', use: 'Cards, panels' },
          { name: 'md', shadow: 'var(--shadow-md)', use: 'Modals, popovers' },
          { name: 'lg', shadow: 'var(--shadow-lg)', use: 'Overlays only' },
        ].map(({ name, shadow, use }) => (
          <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
              width: 132,
              height: 84,
              background: 'var(--color-surface)',
              borderRadius: 10,
              boxShadow: shadow,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--color-neutral-7)',
            }}
            >
              shadow-
{name}
            </div>
            <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-neutral-6)' }}>{use}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
