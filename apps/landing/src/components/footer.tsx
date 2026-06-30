/**
 * Footer — minimal
 */

export function Footer() {
  return (
    <footer style={{
      borderTop: '1px solid var(--border)',
      padding: '16px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
    }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <img src="/icon-64.webp" alt="" width={14} height={14} style={{ borderRadius: 3 }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Cradle — orchestrate your AI tools.
        </span>
      </div>
      <span style={{ fontSize: 11, color: 'var(--border-strong)' }}>·</span>
      <a href="https://x.com/wibus_wee" style={{ fontSize: 12, color: 'var(--text-muted)' }} target="_blank" rel="noopener noreferrer">
        By wibus
      </a>
    </footer>
  )
}
