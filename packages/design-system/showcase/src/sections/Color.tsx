import type { Lang } from '../i18n'
import { t } from '../i18n'

interface ColorProps {
  lang: Lang
}

const NEUTRALS = [
  { n: 1, hex: '#ffffff', tier: 'Surface', use: 'Page bg, content card' },
  { n: 2, hex: '#f5f5f5', tier: 'Chrome', use: 'Sidebar, header, footer bg' },
  { n: 3, hex: '#ebebeb', tier: 'Fill', use: 'Hover bg, subtle fill' },
  { n: 4, hex: '#d4d4d4', tier: 'Fill+', use: 'Strong fill, dividers' },
  { n: 5, hex: '#a3a3a3', tier: 'Border', use: 'Ring — NEVER as text' },
  { n: 6, hex: '#737373', tier: 'Text', use: 'Secondary text, muted' },
  { n: 7, hex: '#595959', tier: 'Text', use: 'Chrome foreground, tertiary' },
  { n: 8, hex: '#404040', tier: 'Text', use: 'Strong secondary' },
  { n: 9, hex: '#262626', tier: 'Text', use: 'Primary body text, CTA bg' },
  { n: 10, hex: '#141414', tier: 'Dark', use: 'Dark mode bg, max emphasis' },
]

const ACCENTS = [
  { name: '--color-accent', hex: '#3b82f6', category: 'Workspace (default)' },
  { name: '--color-accent-session', hex: '#8b5cf6', category: 'Session / Builtin' },
  { name: '--color-accent-global', hex: '#0ea5e9', category: 'Global' },
  { name: '--color-accent-scope', hex: '#10b981', category: 'Workspace scope / Doc' },
  { name: '--color-accent-agent', hex: '#f43f5e', category: 'Agent' },
  { name: '--color-accent-legacy', hex: '#f59e0b', category: 'Legacy' },
  { name: '--color-accent-diff', hex: '#f97316', category: 'Diff' },
  { name: '--color-accent-summary', hex: '#ec4899', category: 'Summary' },
]

const SEMANTICS = [
  { name: '--color-success', hex: '#10b981', label: 'Success' },
  { name: '--color-warning', hex: '#f59e0b', label: 'Warning' },
  { name: '--color-error', hex: '#ef4444', label: 'Error' },
  { name: '--color-info', hex: '#3b82f6', label: 'Info' },
]

export default function Color({ lang }: ColorProps) {
  return (
    <section className="section">
      <div className="section-head">
        <p className="section-num">{t('colorNum', lang)}</p>
        <h2 className="section-title">{t('colorTitle', lang)}</h2>
        <p className="section-lede">{t('colorLede', lang)}</p>
      </div>

      <p className="subhead">{t('colorNeutralHead', lang)}</p>
      <div className="swatches">
        {NEUTRALS.map(({ n, hex, tier, use }) => (
          <div key={n} className="swatch">
            <div className="swatch__chip" style={{ background: hex }} />
            <div className="swatch__info">
              <p className="swatch__name">
neutral-
{n}
              </p>
              <p className="swatch__role">
{tier}
{' '}
·
{' '}
{use}
              </p>
              <span className="swatch__hex">{hex}</span>
            </div>
          </div>
        ))}
      </div>

      <p className="subhead">{t('colorAccentHead', lang)}</p>
      <div className="swatches">
        {ACCENTS.map(({ name, hex, category }) => (
          <div key={name} className="swatch swatch--accent">
            <div className="swatch__chip" style={{ background: hex }} />
            <div className="swatch__info">
              <p className="swatch__name">{name.replace('--color-', '')}</p>
              <p className="swatch__role">{category}</p>
              <span className="swatch__hex">{hex}</span>
            </div>
          </div>
        ))}
      </div>

      <p className="subhead">{t('colorSemanticHead', lang)}</p>
      <div className="swatches" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', maxWidth: 640 }}>
        {SEMANTICS.map(({ name, hex, label }) => (
          <div key={name} className="swatch swatch--accent">
            <div className="swatch__chip" style={{ background: hex }} />
            <div className="swatch__info">
              <p className="swatch__name">{label}</p>
              <p className="swatch__role">{name}</p>
              <span className="swatch__hex">{hex}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
