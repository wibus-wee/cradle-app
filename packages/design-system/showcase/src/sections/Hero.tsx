import type { Lang } from '../i18n'
import { t } from '../i18n'

interface HeroProps {
  lang: Lang
}

const NEUTRALS = [
  { n: 1, hex: '#ffffff' },
  { n: 2, hex: '#f5f5f5' },
  { n: 3, hex: '#ebebeb' },
  { n: 4, hex: '#d4d4d4' },
  { n: 5, hex: '#a3a3a3' },
  { n: 6, hex: '#737373' },
  { n: 7, hex: '#595959' },
  { n: 8, hex: '#404040' },
  { n: 9, hex: '#262626' },
  { n: 10, hex: '#141414' },
]

const PILLS = ['Linear-inspired', 'Two-tone chrome', 'Spring physics', 'English-first']

export default function Hero({ lang }: HeroProps) {
  return (
    <section className="section" style={{ paddingTop: 0, borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ paddingTop: 64, paddingBottom: 0, textAlign: 'center' }}>
        <p style={{
          margin: '0 0 16px',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--color-accent)',
          letterSpacing: '0.06em',
        }}
        >
          {t('heroEyebrow', lang)}
        </p>

        <h1 style={{
          margin: '0 0 16px',
          fontFamily: 'var(--font-sans)',
          fontSize: 30,
          fontWeight: 600,
          lineHeight: 1.2,
          letterSpacing: '-0.02em',
          color: 'var(--color-neutral-10)',
        }}
        >
          Precise. Surface-textured.
<br />
Spring-everywhere.
        </h1>

        <p style={{
          margin: '0 auto 32px',
          maxWidth: 480,
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--color-neutral-6)',
        }}
        >
          {t('heroTagline', lang)}
        </p>

        {/* Design principle pills */}
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 48 }}>
          {PILLS.map(pill => (
            <span key={pill} style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 28,
              padding: '0 12px',
              background: 'var(--color-neutral-2)',
              border: '1px solid var(--color-border)',
              borderRadius: 9999,
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--color-neutral-7)',
            }}
            >
{pill}
            </span>
          ))}
        </div>

        {/* Token preview */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 24,
          flexWrap: 'wrap',
          paddingBottom: 48,
        }}
        >
          {/* Accent swatch */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: '#3b82f6',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
            }}
            />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-6)' }}>
              {t('heroTokenAccent', lang)}
            </span>
          </div>

          {/* Neutral range */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', gap: 2 }}>
              {NEUTRALS.map(({ n, hex }) => (
                <div key={n} style={{
                  width: 14,
                  height: 40,
                  borderRadius: 4,
                  background: hex,
                  border: '1px solid var(--color-border)',
                }}
                />
              ))}
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-6)' }}>
              {t('heroTokenNeutral', lang)}
{' '}
1–10
            </span>
          </div>

          {/* Font stacks */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 600, color: 'var(--color-neutral-9)' }}>
                Geist Variable
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-neutral-6)' }}>
                Geist Mono
              </span>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-6)' }}>
              {t('heroTokenSans', lang)}
{' '}
/
{t('heroTokenMono', lang)}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
