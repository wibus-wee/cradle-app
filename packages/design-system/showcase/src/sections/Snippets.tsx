import type { Lang } from '../i18n'
import { t } from '../i18n'

interface SnippetsProps {
  lang: Lang
}

export default function Snippets({ lang }: SnippetsProps) {
  return (
    <section className="section">
      <div className="section-head">
        <p className="section-num">{t('snippetNum', lang)}</p>
        <h2 className="section-title">{t('snippetTitle', lang)}</h2>
        <p className="section-lede">{t('snippetLede', lang)}</p>
      </div>

      {/* Hero snippet */}
      <p className="subhead">Hero</p>
      <div className="snippet-frame" style={{ marginBottom: 24 }}>
        <div className="snippet-frame__head">
          <span>hero.html</span>
          <span>templates/snippets/</span>
        </div>
        <div className="snippet-frame__body">
          <div style={{ padding: '48px 0 32px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 16px', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--color-accent)', letterSpacing: '0.06em' }}>Cradle Design System · v0.1</p>
            <h1 style={{ margin: '0 0 16px', fontFamily: 'var(--font-sans)', fontSize: 30, fontWeight: 600, lineHeight: 1.2, letterSpacing: '-0.02em', color: 'var(--color-neutral-10)' }}>
Precise. Surface-textured.
<br />
Spring-everywhere.
            </h1>
            <p style={{ margin: '0 auto 32px', maxWidth: 480, fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 400, lineHeight: 1.6, color: 'var(--color-neutral-6)' }}>A modern, physics-native desktop AI environment. Between Linear and Vercel: precise, high-contrast, unsentimental.</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 16px', background: 'var(--color-neutral-9)', color: 'var(--color-neutral-1)', borderRadius: 8, fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500 }}>Get started</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 16px', background: 'transparent', color: 'var(--color-neutral-7)', border: '1px solid var(--color-border)', borderRadius: 8, fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500 }}>View tokens</div>
            </div>
          </div>
        </div>
      </div>

      {/* Code Block snippet */}
      <p className="subhead">Code block</p>
      <div className="snippet-frame" style={{ marginBottom: 24 }}>
        <div className="snippet-frame__head">
          <span>code-block.html</span>
          <span>templates/snippets/</span>
        </div>
        <div className="snippet-frame__body">
          <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 14px',
              background: 'var(--color-neutral-9)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>tokens.css</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Copy</span>
            </div>
            <pre style={{
              margin: 0,
              padding: '16px 20px',
              background: 'var(--color-neutral-10)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              lineHeight: 1.7,
              color: 'var(--color-neutral-1)',
              overflowX: 'auto',
            }}
            >
              <code>
{`@theme {
  --color-neutral-1: #ffffff;
  --color-neutral-9: #262626;
  --color-accent:    #3b82f6;
  --font-sans: 'Geist Variable', sans-serif;
}`}
              </code>
            </pre>
          </div>
        </div>
      </div>

      {/* Form snippet */}
      <p className="subhead">Form</p>
      <div className="snippet-frame" style={{ marginBottom: 24 }}>
        <div className="snippet-frame__head">
          <span>form.html</span>
          <span>templates/snippets/</span>
        </div>
        <div className="snippet-frame__body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 400 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500, color: 'var(--color-neutral-7)' }}>Name</label>
              <div style={{
                height: 32,
                padding: '0 10px',
                background: 'var(--color-neutral-1)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                color: 'var(--color-neutral-5)',
              }}
              >
Enter your name
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <div style={{ height: 32, padding: '0 14px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 8, display: 'flex', alignItems: 'center', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: 'var(--color-neutral-7)' }}>Cancel</div>
              <div style={{ height: 32, padding: '0 14px', background: 'var(--color-neutral-9)', borderRadius: 8, display: 'flex', alignItems: 'center', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: 'var(--color-neutral-1)' }}>Submit</div>
            </div>
          </div>
        </div>
      </div>

      {/* Stat Grid snippet */}
      <p className="subhead">Stat grid</p>
      <div className="snippet-frame" style={{ marginBottom: 24 }}>
        <div className="snippet-frame__head">
          <span>stat-grid.html</span>
          <span>templates/snippets/</span>
        </div>
        <div className="snippet-frame__body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div style={{ padding: 16, background: 'var(--color-neutral-2)', border: '1px solid var(--color-border)', borderRadius: 10 }}>
              <p style={{ margin: '0 0 4px', fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 500, color: 'var(--color-neutral-6)' }}>Sessions today</p>
              <p style={{ margin: '0 0 8px', fontFamily: 'var(--font-sans)', fontSize: 30, fontWeight: 600, lineHeight: 1.2, letterSpacing: '-0.02em', color: 'var(--color-neutral-9)' }}>142</p>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', background: 'rgba(16,185,129,0.1)', borderRadius: 9999, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: 'var(--color-success)' }}>+12%</span>
            </div>
            <div style={{ padding: 16, background: 'var(--color-neutral-2)', border: '1px solid var(--color-border)', borderRadius: 10 }}>
              <p style={{ margin: '0 0 4px', fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 500, color: 'var(--color-neutral-6)' }}>Active agents</p>
              <p style={{ margin: '0 0 8px', fontFamily: 'var(--font-sans)', fontSize: 30, fontWeight: 600, lineHeight: 1.2, letterSpacing: '-0.02em', color: 'var(--color-neutral-9)' }}>8</p>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', background: 'rgba(245,158,11,0.1)', borderRadius: 9999, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: 'var(--color-warning)' }}>−2 idle</span>
            </div>
            <div style={{ padding: 16, background: 'var(--color-neutral-2)', border: '1px solid var(--color-border)', borderRadius: 10 }}>
              <p style={{ margin: '0 0 4px', fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 500, color: 'var(--color-neutral-6)' }}>Documents indexed</p>
              <p style={{ margin: '0 0 8px', fontFamily: 'var(--font-sans)', fontSize: 30, fontWeight: 600, lineHeight: 1.2, letterSpacing: '-0.02em', color: 'var(--color-neutral-9)' }}>2.4k</p>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', background: 'rgba(59,130,246,0.1)', borderRadius: 9999, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: 'var(--color-accent)' }}>+48 new</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sheet snippet description */}
      <p className="subhead">Sheet</p>
      <div className="snippet-frame" style={{ marginBottom: 24 }}>
        <div className="snippet-frame__head">
          <span>sheet.html</span>
          <span>templates/snippets/</span>
        </div>
        <div className="snippet-frame__body">
          <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-neutral-6)', lineHeight: 1.6 }}>
            280px right-side panel with neutral-2 header, scrollable list of items, and a full-width CTA footer button. Insert into scaffold.html to see it fixed to the right edge of the viewport.
          </p>
        </div>
      </div>

      {/* Modal snippet description */}
      <p className="subhead">Modal</p>
      <div className="snippet-frame" style={{ marginBottom: 24 }}>
        <div className="snippet-frame__head">
          <span>modal.html</span>
          <span>templates/snippets/</span>
        </div>
        <div className="snippet-frame__body">
          <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-neutral-6)', lineHeight: 1.6 }}>
            Dialog overlay with rgba(0,0,0,0.4) backdrop, centered 480px panel, header with close button, body with warning state, footer with cancel + destructive buttons. Drop into scaffold.html to test blocking overlay behavior.
          </p>
        </div>
      </div>

      {/* Comment Thread snippet */}
      <p className="subhead">Comment thread</p>
      <div className="snippet-frame" style={{ marginBottom: 24 }}>
        <div className="snippet-frame__head">
          <span>comment-thread.html</span>
          <span>templates/snippets/</span>
        </div>
        <div className="snippet-frame__body">
          <div style={{ maxWidth: 600 }}>
            {/* Top-level comment */}
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 9999, background: 'var(--color-neutral-3)', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, color: 'var(--color-neutral-6)' }}>AK</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: 'var(--color-neutral-9)' }}>Alex Kim</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-5)' }}>3h ago</span>
                </div>
                <p style={{ margin: '0 0 8px', fontFamily: 'var(--font-sans)', fontSize: 13, lineHeight: 1.6, color: 'var(--color-neutral-7)' }}>The two-tone chrome separation is the right call. Having the sidebar at neutral-2 vs content at neutral-1 creates a clear spatial hierarchy without needing borders.</p>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 500, color: 'var(--color-neutral-5)' }}>Reply</span>
              </div>
            </div>
            {/* Nested reply */}
            <div style={{ margin: '8px 0 0 38px', paddingLeft: 16, borderLeft: '2px solid var(--color-neutral-3)' }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ width: 24, height: 24, borderRadius: 9999, background: 'var(--color-neutral-3)', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 600, color: 'var(--color-neutral-6)' }}>JL</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500, color: 'var(--color-neutral-9)' }}>Jamie Lee</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-neutral-5)' }}>2h ago</span>
                  </div>
                  <p style={{ margin: '0 0 6px', fontFamily: 'var(--font-sans)', fontSize: 12, lineHeight: 1.6, color: 'var(--color-neutral-7)' }}>Agreed. And the inset-shadow approach for depth keeps it from looking like Material Design's "floating cards" problem.</p>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 500, color: 'var(--color-neutral-5)' }}>Reply</span>
                </div>
              </div>
            </div>
            {/* Second top-level comment */}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <div style={{ width: 28, height: 28, borderRadius: 9999, background: 'var(--color-neutral-3)', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, color: 'var(--color-neutral-6)' }}>MT</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: 'var(--color-neutral-9)' }}>Morgan T.</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-5)' }}>1h ago</span>
                </div>
                <p style={{ margin: '0 0 8px', fontFamily: 'var(--font-sans)', fontSize: 13, lineHeight: 1.6, color: 'var(--color-neutral-7)' }}>Spring physics for all interactive motion is the right default. The 600/40 config feels snappy but not jittery. Messages at 500/35 feel slightly warmer which suits the chat context.</p>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 500, color: 'var(--color-neutral-5)' }}>Reply</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* List Card snippet */}
      <p className="subhead">List card</p>
      <div className="snippet-frame">
        <div className="snippet-frame__head">
          <span>list-card.html</span>
          <span>templates/snippets/</span>
        </div>
        <div className="snippet-frame__body">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[
              { icon: 'AI', title: 'Agent workspace session', desc: 'Summarized 3 documents, answered 12 queries', time: '2m ago' },
              { icon: 'WS', title: 'Design system review', desc: 'Token audit completed, 4 anti-patterns found', time: '14m ago' },
              { icon: 'SY', title: 'System health check', desc: 'All services nominal, 99.8% uptime', time: '1h ago' },
            ].map(item => (
              <li key={item.icon} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--color-neutral-2)', borderRadius: 10, border: '1px solid var(--color-border)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--color-neutral-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-6)' }}>{item.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: '0 0 2px', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: 'var(--color-neutral-9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</p>
                  <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-neutral-6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.desc}</p>
                </div>
                <span style={{ flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-neutral-5)' }}>{item.time}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
