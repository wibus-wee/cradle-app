import type { Lang } from '../i18n'
import { t } from '../i18n'

interface DecisionProps {
  lang: Lang
}

const DECISIONS = [
  { need: 'Background color', use: 'var(--color-neutral-1) for content, var(--color-neutral-2) for chrome' },
  { need: 'Primary text', use: 'var(--color-neutral-9) — full opacity, no modifiers' },
  { need: 'Secondary text', use: 'var(--color-neutral-6)' },
  { need: 'Tertiary text', use: 'var(--color-neutral-7)' },
  { need: 'Decorative / disabled', use: 'var(--color-neutral-5)' },
  { need: 'Interactive hover bg', use: 'var(--color-neutral-3)' },
  { need: 'Border', use: 'rgba(0,0,0,0.08) — never var(--color-neutral-5)' },
  { need: 'Category color', use: 'Matching --color-accent-* at 10% bg opacity, 60% text' },
  { need: 'Depth / surface feel', use: 'inset-shadow — NOT box-shadow elevation' },
  { need: 'CTA button', use: 'bg-neutral-9 text-neutral-1 (inverted)' },
  { need: 'Code / mono font', use: 'var(--font-mono) — never hardcode Geist Mono' },
  { need: 'Animation', use: 'Spring physics stiffness 600 damping 40 — no linear or ease-in-out' },
  { need: 'Section header', use: 'sentence case, font-medium — no uppercase tracking' },
  { need: 'Border radius (buttons)', use: '8px (md)' },
  { need: 'Border radius (cards)', use: '10px (base)' },
  { need: 'Border radius (modals)', use: '12px (lg)' },
]

export default function Decision({ lang }: DecisionProps) {
  return (
    <section className="section">
      <div className="section-head">
        <p className="section-num">{t('decideNum', lang)}</p>
        <h2 className="section-title">{t('decideTitle', lang)}</h2>
        <p className="section-lede">{t('decideLede', lang)}</p>
      </div>

      <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
        {DECISIONS.map(({ need, use }, i) => (
          <div key={need} style={{
            display: 'grid',
            gridTemplateColumns: '240px 1fr',
            borderBottom: i < DECISIONS.length - 1 ? '1px solid var(--color-border)' : undefined,
          }}
          >
            <div style={{
              padding: '10px 16px',
              background: 'var(--color-neutral-2)',
              borderRight: '1px solid var(--color-border)',
            }}
            >
              <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500, color: 'var(--color-neutral-7)' }}>{need}</p>
            </div>
            <div style={{ padding: '10px 16px' }}>
              <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-8)', lineHeight: 1.5 }}>{use}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
