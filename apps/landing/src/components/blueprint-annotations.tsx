/**
 * Shared UI primitives for the landing page
 */

/* ─── Star corner decoration ───────────────────────────────────── */

interface StarProps {
  className?: string
  style?: React.CSSProperties
}

export function Star({ className, style }: StarProps) {
  return (
    <div className={className} style={{ width: 14, height: 14, ...style }}>
      <svg viewBox="0 0 30 30" style={{ width: '100%', height: '100%' }}>
        <path
          fill="var(--text-muted)"
          d="M15 0 C19 9 21 11 30 15 C21 19 19 21 15 30 C11 21 9 19 0 15 C9 11 11 9 15 0 Z"
        />
      </svg>
    </div>
  )
}

/* ─── Star Borders — 4-star corner frame ───────────────────────── */

export function StarBorders({ children }: { children?: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'relative',
        border: '1px dashed var(--border-strong)',
        overflow: 'hidden',
      }}
    >
      <Star style={{ position: 'absolute', top: -6, right: -6, zIndex: 50 }} />
      <Star style={{ position: 'absolute', bottom: -6, right: -6, zIndex: 50 }} />
      <Star style={{ position: 'absolute', top: -6, left: -6, zIndex: 50 }} />
      <Star style={{ position: 'absolute', bottom: -6, left: -6, zIndex: 50 }} />
      {children}
    </div>
  )
}

/* ─── Page Guide Lines (decorative overlay) ────────────────────── */

const GUIDE_LINE_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  bottom: 0,
  width: 10,
  pointerEvents: 'none',
  zIndex: 1,
  backgroundImage: 'repeating-linear-gradient(315deg, var(--pattern-fg) 0, var(--pattern-fg) 1px, transparent 0, transparent 50%)',
  backgroundSize: '10px 10px',
  backgroundAttachment: 'fixed',
  maskImage: 'linear-gradient(to bottom, transparent 0%, black 60%)',
  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 60%)',
}

export function IntersectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      {/* Left guide line — at the left edge of the 960px content area */}
      <div
        aria-hidden="true"
        style={{
          ...GUIDE_LINE_STYLE,
          left: 'calc((100vw - 960px) / 2 - 1rem)',
          borderLeft: '1px solid var(--pattern-fg)',
        }}
      />
      {/* Right guide line — at the right edge of the 960px content area */}
      <div
        aria-hidden="true"
        style={{
          ...GUIDE_LINE_STYLE,
          right: 'calc((100vw - 960px) / 2 - 1rem)',
          borderRight: '1px solid var(--pattern-fg)',
        }}
      />

      {/* Content flows normally, full width */}
      <div style={{ position: 'relative', zIndex: 0 }}>
        {children}
      </div>
    </div>
  )
}

/* ─── Theme Toggle ─────────────────────────────────────────────── */

export function ThemeToggle() {
  const toggle = () => {
    document.documentElement.classList.toggle('dark')
  }

  return (
    <button
      onClick={toggle}
      style={{
        width: 28,
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid var(--border)',
        background: 'var(--fill)',
        cursor: 'pointer',
        color: 'var(--text-secondary)',
        transition: 'background 0.15s, color 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--fill-hover)'; e.currentTarget.style.color = 'var(--text)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--fill)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
      aria-label="Toggle theme"
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx={12} cy={12} r={5} />
        <line x1={12} y1={1} x2={12} y2={3} />
        <line x1={12} y1={21} x2={12} y2={23} />
        <line x1={4.22} y1={4.22} x2={5.64} y2={5.64} />
        <line x1={18.36} y1={18.36} x2={19.78} y2={19.78} />
        <line x1={1} y1={12} x2={3} y2={12} />
        <line x1={21} y1={12} x2={23} y2={12} />
        <line x1={4.22} y1={19.78} x2={5.64} y2={18.36} />
        <line x1={18.36} y1={5.64} x2={19.78} y2={4.22} />
      </svg>
    </button>
  )
}
