export default function Footer() {
  return (
    <footer style={{
      paddingTop: 48,
      paddingBottom: 32,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 16,
    }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <a
          href="https://github.com/wibus-wee/Cradle"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            color: 'var(--color-neutral-6)',
            textDecoration: 'none',
          }}
        >
          GitHub
        </a>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-neutral-5)' }}>·</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-5)' }}>
          v0.1-alpha
        </span>
      </div>

      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-5)' }}>
        Cradle Design System ·
{' '}
{new Date().getFullYear()}
      </span>
    </footer>
  )
}
