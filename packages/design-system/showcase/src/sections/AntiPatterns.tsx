import type { Lang } from '../i18n'
import { t } from '../i18n'

interface AntiPatternsProps {
  lang: Lang
}

const PATTERNS = [
  {
    title: 'Tailwind built-in neutrals',
    wrong: 'className="text-neutral-500 bg-neutral-100"',
    right: 'style={{ color: "var(--color-neutral-6)", background: "var(--color-neutral-2)" }}',
    why: 'Built-in neutrals bypass the semantic tier system and break dark mode inversion.',
  },
  {
    title: 'Raw hex in inline styles',
    wrong: 'style={{ color: "#737373", background: "#f5f5f5" }}',
    right: 'style={{ color: "var(--color-neutral-6)", background: "var(--color-neutral-2)" }}',
    why: 'Raw hex bypasses tokens. A single token change now requires a codebase search.',
  },
  {
    title: 'Opacity on top of text tokens',
    wrong: 'className="text-[var(--color-neutral-9)]/70"',
    right: 'className="text-[var(--color-neutral-6)]"',
    why: 'The 4 text tiers have pre-verified WCAG ratios. /70 creates an unverified 5th tier.',
  },
  {
    title: 'Elevation shadows',
    wrong: 'className="shadow-lg rounded-xl"',
    right: 'style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(0,0,0,0.06)" }}',
    why: 'Elevation shadows make components look floating. Cradle uses surface texture, not elevation.',
  },
  {
    title: 'Uppercase + tracking labels',
    wrong: 'className="uppercase tracking-wider font-semibold text-xs"',
    right: 'className="text-sm font-medium text-[var(--color-neutral-7)]"',
    why: 'Uppercase tracking is a dated pattern. Cradle follows Linear/Vercel: minimal, confident typography.',
  },
]

export default function AntiPatterns({ lang }: AntiPatternsProps) {
  return (
    <section className="section">
      <div className="section-head">
        <p className="section-num">{t('antiNum', lang)}</p>
        <h2 className="section-title">{t('antiTitle', lang)}</h2>
        <p className="section-lede">{t('antiLede', lang)}</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {PATTERNS.map(({ title, wrong, right, why }) => (
          <div key={title} style={{
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            overflow: 'hidden',
          }}
          >
            <div style={{
              padding: '10px 16px',
              background: 'var(--color-neutral-2)',
              borderBottom: '1px solid var(--color-border)',
            }}
            >
              <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: 'var(--color-neutral-9)' }}>{title}</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
              {/* Wrong */}
              <div style={{
                padding: '14px 16px',
                borderRight: '1px solid var(--color-border)',
                background: 'rgba(239,68,68,0.03)',
              }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '1px 8px',
                    background: 'rgba(239,68,68,0.1)',
                    borderRadius: 9999,
                    fontFamily: 'var(--font-sans)',
                    fontSize: 11,
                    fontWeight: 500,
                    color: '#ef4444',
                  }}
                  >
{t('antiDontLabel', lang)}
                  </span>
                </div>
                <code style={{
                  display: 'block',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: 'var(--color-neutral-7)',
                  wordBreak: 'break-all',
                }}
                >
{wrong}
                </code>
              </div>

              {/* Right */}
              <div style={{
                padding: '14px 16px',
                background: 'rgba(16,185,129,0.03)',
              }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '1px 8px',
                    background: 'rgba(16,185,129,0.1)',
                    borderRadius: 9999,
                    fontFamily: 'var(--font-sans)',
                    fontSize: 11,
                    fontWeight: 500,
                    color: '#10b981',
                  }}
                  >
{t('antiDoLabel', lang)}
                  </span>
                </div>
                <code style={{
                  display: 'block',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: 'var(--color-neutral-7)',
                  wordBreak: 'break-all',
                }}
                >
{right}
                </code>
              </div>
            </div>

            <div style={{
              padding: '8px 16px',
              background: 'var(--color-neutral-2)',
              borderTop: '1px solid var(--color-border)',
            }}
            >
              <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-neutral-6)', lineHeight: 1.5 }}>{why}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
