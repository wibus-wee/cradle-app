import type { Lang } from '../i18n'
import { t } from '../i18n'

interface SpacingProps {
  lang: Lang
}

const SPACING = [
  { name: 'xs', px: 4, tailwind: 'gap-1, p-1', use: 'Icon gap, tight padding' },
  { name: 'sm', px: 8, tailwind: 'gap-2, p-2', use: 'List row padding, inner gap' },
  { name: 'md', px: 16, tailwind: 'gap-4, p-4', use: 'Section padding, standard gap' },
  { name: 'lg', px: 24, tailwind: 'gap-6, p-6', use: 'Card padding, section gap' },
  { name: 'xl', px: 32, tailwind: 'gap-8, p-8', use: 'Page padding' },
  { name: '2xl', px: 64, tailwind: 'gap-16, p-16', use: 'Major section separation' },
]

const RADII = [
  { name: 'sm', px: 6, use: 'Chips, inline tags' },
  { name: 'md', px: 8, use: 'Buttons, inputs' },
  { name: 'base', px: 10, use: 'Cards, panels' },
  { name: 'lg', px: 12, use: 'Popovers, modals' },
  { name: 'xl', px: 16, use: 'Large content cards' },
  { name: 'full', px: 9999, use: 'Pills, badges' },
]

const SHADOWS = [
  {
    name: 'xs',
    value: '0 1px 2px oklch(0 0 0 / 0.04), 0 0 0 1px oklch(0 0 0 / 0.05)',
    use: 'Inputs, small controls',
  },
  {
    name: 'sm',
    value: '0 1px 3px oklch(0 0 0 / 0.08), 0 0 0 1px oklch(0 0 0 / 0.06)',
    use: 'Cards, panels',
  },
  {
    name: 'md',
    value: '0 4px 16px -2px oklch(0 0 0 / 0.10), 0 2px 4px -1px oklch(0 0 0 / 0.06)',
    use: 'Modals, popovers',
  },
]

export default function Spacing({ lang }: SpacingProps) {
  return (
    <section className="section">
      <div className="section-head">
        <p className="section-num">{t('spaceNum', lang)}</p>
        <h2 className="section-title">{t('spaceTitle', lang)}</h2>
        <p className="section-lede">{t('spaceLede', lang)}</p>
      </div>

      {/* Spacing tiers */}
      <p className="subhead">Spacing</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 40 }}>
        {SPACING.map(({ name, px, tailwind, use }) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 48, flexShrink: 0 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-7)', fontWeight: 600 }}>{name}</span>
            </div>
            <div style={{
              height: 16,
              width: px,
              background: 'var(--color-accent)',
              opacity: 0.4,
              borderRadius: 2,
              flexShrink: 0,
            }}
            />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-5)', width: 40, flexShrink: 0 }}>
{px}
px
            </span>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-neutral-6)' }}>
{tailwind}
{' '}
·
{' '}
{use}
            </span>
          </div>
        ))}
      </div>

      {/* Border radius */}
      <p className="subhead">{t('radiusHead', lang)}</p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 40 }}>
        {RADII.map(({ name, px, use }) => (
          <div key={name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 48,
              height: 48,
              background: 'var(--color-neutral-3)',
              border: '1px solid var(--color-border)',
              borderRadius: Math.min(px, 24),
            }}
            />
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500, color: 'var(--color-neutral-7)' }}>{name}</p>
              <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-5)' }}>{px === 9999 ? '9999px' : `${px}px`}</p>
              <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-neutral-5)', maxWidth: 70 }}>{use}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Shadows */}
      <p className="subhead">{t('shadowHead', lang)}</p>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {SHADOWS.map(({ name, value, use }) => (
          <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{
              width: 120,
              height: 80,
              background: 'var(--color-neutral-1)',
              borderRadius: 10,
              boxShadow: value,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--color-neutral-6)',
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
