import type { Lang } from '../i18n'
import { t } from '../i18n'

interface ManifestoProps {
  lang: Lang
}

const INVARIANTS = [
  { title: 'Surface texture, not elevation', desc: 'Use inset-shadow for depth. No floating box-shadows.' },
  { title: 'Two-tone chrome architecture', desc: 'Sidebar/header is always dimmer than content surface.' },
  { title: 'Geist Variable everywhere', desc: 'Use var(--font-sans) or var(--font-mono). Never hardcode font-family.' },
  { title: 'Pre-resolved contrast tiers', desc: 'Never add opacity on text tokens. Use the 4 resolved tiers.' },
  { title: 'Spring physics for motion', desc: 'stiffness 600, damping 40. No linear or ease-in-out for interactive state.' },
  { title: 'Spatial separation first', desc: 'Prefer layout gap over visible borders where space already separates.' },
  { title: 'Accent is semantic', desc: 'Each accent maps to a content category. Never used decoratively.' },
  { title: 'No uppercase labels', desc: 'Section headers: sentence case or lowercase only.' },
  { title: 'Static Tailwind classes only', desc: 'Never construct class names dynamically (e.g. `bg-$' + '{color}-500`).' },
  { title: 'No gradient backgrounds', desc: 'Flat surfaces with subtle inset-shadow texture only.' },
]

export default function Manifesto({ lang }: ManifestoProps) {
  return (
    <section className="section">
      <div className="section-head">
        <p className="section-num">{t('manifestoNum', lang)}</p>
        <h2 className="section-title">{t('manifestoTitle', lang)}</h2>
        <p className="section-lede">{t('manifestoLede', lang)}</p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 2,
      }}
      >
        {INVARIANTS.map((inv, i) => (
          <div key={i} style={{
            display: 'flex',
            gap: 14,
            padding: '14px 16px',
            background: 'var(--color-neutral-2)',
            borderRadius: 10,
          }}
          >
            <span style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: 'var(--color-neutral-3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--color-neutral-6)',
            }}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <div>
              <p style={{
                margin: '0 0 4px',
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--color-neutral-9)',
                lineHeight: 1.4,
              }}
              >
{inv.title}
              </p>
              <p style={{
                margin: 0,
                fontFamily: 'var(--font-sans)',
                fontSize: 12,
                color: 'var(--color-neutral-6)',
                lineHeight: 1.5,
              }}
              >
{inv.desc}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
