/**
 * CTA — download section
 */

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Download } from 'lucide-react'
import { useRef } from 'react'

export function CTASection() {
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(() => {
    gsap.from('.cta-inner', { y: 20, opacity: 0, duration: 0.6, ease: 'power2.out', scrollTrigger: { trigger: '.cta-inner', start: 'top 82%' } })
  }, { scope: sectionRef })

  return (
    <section ref={sectionRef} style={{ padding: '80px 24px', borderTop: '1px solid var(--border-subtle)' }} id="download">
      <div className="cta-inner" style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
        <h2 style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)', fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.02em', color: 'var(--text)', marginBottom: 12 }}>
          Your agents are waiting.
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-secondary)', maxWidth: 380, margin: '0 auto 32px' }}>
          Download Cradle and go from scattered tools to a unified command center in minutes.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <a
            href="https://github.com/wibus-wee/cradle-app/releases"
            target='_block'
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 22px',
              background: 'var(--text)', color: 'var(--bg)',
              fontSize: 13, fontWeight: 600, textDecoration: 'none', transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.opacity = '0.88'}
            onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.opacity = '1'}
          >
            <Download style={{ width: 14, height: 14 }} />
            Download for macOS
          </a>

          <a
            href="https://github.com/wibus-wee/Cradle-app"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 22px',
              background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)',
              fontSize: 13, fontWeight: 500, textDecoration: 'none', transition: 'color 0.15s, background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'var(--fill-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'transparent' }}
          >
            View on GitHub
          </a>
        </div>

        <p style={{ marginTop: 20, fontSize: 11, color: 'var(--text-muted)' }}>
          macOS 14+ · Apple Silicon & Intel · Free forever
        </p>
      </div>
    </section>
  )
}
