import type { Lang } from '../i18n'
import { t } from '../i18n'

interface BackgroundProps {
  lang: Lang
}

const INFLUENCES = [
  {
    source: 'Linear',
    aspect: 'Precision + density',
    how: 'Tight spacing, high-contrast text hierarchy, monospaced labels in chrome areas. No decorative chrome — every pixel earns its place.',
  },
  {
    source: 'Vercel',
    aspect: 'Clarity + restraint',
    how: 'Neutral-first palette, generous white space in content areas, borders only when necessary. The design system doesn\'t fight the content.',
  },
  {
    source: 'Cradle (original)',
    aspect: 'Spring physics + AI-native',
    how: 'All interactive motion uses spring physics — not CSS transitions. The two-tone chrome (dimmer chrome, brighter content) is Cradle\'s own identity. Semantic accent colors map to AI content categories.',
  },
]

export default function Background({ lang }: BackgroundProps) {
  return (
    <section className="section">
      <div className="section-head">
        <p className="section-num">{t('bgNum', lang)}</p>
        <h2 className="section-title">{t('bgTitle', lang)}</h2>
        <p className="section-lede">{t('bgLede', lang)}</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 40 }}>
        {INFLUENCES.map(({ source, aspect, how }) => (
          <div key={source} style={{
            display: 'grid',
            gridTemplateColumns: '160px 1fr',
            background: 'var(--color-neutral-2)',
            borderRadius: 10,
            overflow: 'hidden',
          }}
          >
            <div style={{
              padding: '16px',
              borderRight: '1px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
            >
              <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600, color: 'var(--color-neutral-9)' }}>{source}</p>
              <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-neutral-6)' }}>{aspect}</p>
            </div>
            <div style={{ padding: '16px' }}>
              <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-neutral-7)', lineHeight: 1.6 }}>{how}</p>
            </div>
          </div>
        ))}
      </div>

      <div style={{
        padding: '20px 24px',
        background: 'var(--color-neutral-2)',
        borderRadius: 10,
        border: '1px solid var(--color-border)',
      }}
      >
        <p style={{ margin: '0 0 8px', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: 'var(--color-neutral-9)' }}>
          What makes Cradle distinct
        </p>
        <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-neutral-6)', lineHeight: 1.7 }}>
          Cradle is an AI-native desktop environment. Its design language must communicate AI content categories at a glance (workspace vs session vs agent vs global) — hence the semantic accent system. Spring physics aren't aesthetic decoration: they match the responsive, "alive" quality that AI interactions should feel like. The two-tone chrome creates a stable, predictable shell around unpredictable AI-generated content.
        </p>
      </div>
    </section>
  )
}
