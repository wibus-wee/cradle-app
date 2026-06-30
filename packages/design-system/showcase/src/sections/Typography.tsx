import type { Lang } from '../i18n'
import { t } from '../i18n'

interface TypographyProps {
  lang: Lang
}

const SCALE = [
  { role: 'Display', font: '--font-sans', size: '30px', weight: '600', lineH: '1.2', sample: 'Precise. Surface-textured.' },
  { role: 'Heading', font: '--font-sans', size: '18px', weight: '600', lineH: '1.3', sample: 'Design Principles' },
  { role: 'Section title', font: '--font-sans', size: '16px', weight: '600', lineH: '1.4', sample: 'Color tokens' },
  { role: 'Body lg', font: '--font-sans', size: '14px', weight: '400', lineH: '1.6', sample: 'A modern, physics-native desktop AI environment.' },
  { role: 'Body md', font: '--font-sans', size: '13px', weight: '400', lineH: '1.5', sample: 'Default text in Cradle UI components.' },
  { role: 'Body sm', font: '--font-sans', size: '12px', weight: '400', lineH: '1.5', sample: 'Secondary metadata, timestamps, secondary info.' },
  { role: 'Label md', font: '--font-sans', size: '13px', weight: '500', lineH: '1.4', sample: 'Button text, form labels' },
  { role: 'Label sm', font: '--font-sans', size: '12px', weight: '500', lineH: '1.4', sample: 'Small chips, tab labels' },
  { role: 'Caption', font: '--font-sans', size: '11px', weight: '400', lineH: '1.3', sample: 'Timestamps, footnotes, tooltips' },
  { role: 'Code sm', font: '--font-mono', size: '11px', weight: '400', lineH: '1.5', sample: 'const x = useTheme()' },
  { role: 'Code xs', font: '--font-mono', size: '10px', weight: '400', lineH: '1.0', sample: '--color-accent: #3b82f6;' },
]

export default function Typography({ lang }: TypographyProps) {
  return (
    <section className="section">
      <div className="section-head">
        <p className="section-num">{t('typeNum', lang)}</p>
        <h2 className="section-title">{t('typeTitle', lang)}</h2>
        <p className="section-lede">{t('typeLede', lang)}</p>
      </div>

      {/* Font family display */}
      <p className="subhead">Font families</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 40 }}>
        <div style={{
          padding: '20px 24px',
          background: 'var(--color-neutral-2)',
          borderRadius: 10,
          border: '1px solid var(--color-border)',
        }}
        >
          <p style={{ margin: '0 0 4px', fontFamily: 'var(--font-sans)', fontSize: 24, fontWeight: 600, color: 'var(--color-neutral-9)', letterSpacing: '-0.01em' }}>
            Geist Variable
          </p>
          <p style={{ margin: '0 0 4px', fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 400, color: 'var(--color-neutral-6)' }}>
            AaBbCcDdEeFf 0123456789
          </p>
          <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-5)' }}>
            var(--font-sans) · weights 100–900
          </p>
        </div>

        <div style={{
          padding: '20px 24px',
          background: 'var(--color-neutral-2)',
          borderRadius: 10,
          border: '1px solid var(--color-border)',
        }}
        >
          <p style={{ margin: '0 0 4px', fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 600, color: 'var(--color-neutral-9)' }}>
            Geist Mono
          </p>
          <p style={{ margin: '0 0 4px', fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 400, color: 'var(--color-neutral-6)' }}>
            const config =
{' '}
{'{'}
{' '}
stiffness: 600, damping: 40
{' '}
{'}'}
          </p>
          <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-5)' }}>
            var(--font-mono) · for code and labels
          </p>
        </div>
      </div>

      {/* Scale */}
      <p className="subhead">{t('typeScaleHead', lang)}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {SCALE.map(({ role, font, size, weight, lineH, sample }) => (
          <div key={role} style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 24,
            padding: '12px 0',
            borderBottom: '1px solid var(--color-border)',
          }}
          >
            <div style={{ width: 120, flexShrink: 0 }}>
              <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-neutral-6)', fontWeight: 500 }}>{role}</p>
              <p style={{ margin: '2px 0 0', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-5)' }}>
                {size}
{' '}
/
{weight}
{' '}
/
{lineH}
              </p>
            </div>
            <p style={{
              margin: 0,
              flex: 1,
              fontFamily: `var(${font})`,
              fontSize: size,
              fontWeight: Number(weight),
              lineHeight: lineH,
              color: 'var(--color-neutral-9)',
            }}
            >
              {sample}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
