/**
 * How It Works — 3 steps with flow lines
 */

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Layers, PlugZap, Workflow } from 'lucide-react'
import { useRef } from 'react'

const STEPS = [
  { Icon: PlugZap, accent: '#8b5cf6', n: '01', title: 'Connect your AI tools', desc: 'Point Cradle at your existing Claude Code, Cursor, or any other runtime. No migration, no lock-in.' },
  { Icon: Layers, accent: '#3b82f6', n: '02', title: 'Dispatch tasks in parallel', desc: 'Create sessions for each agent with a specific goal. Watch them run simultaneously with real-time logs.' },
  { Icon: Workflow, accent: '#10b981', n: '03', title: 'Set conditions and walk away', desc: 'Define triggers — "resume after CI passes", "await PR approval" — and Cradle handles coordination.' },
]

export function HowItWorksSection() {
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(() => {
    gsap.from('.how-step', { y: 16, opacity: 0, duration: 0.5, stagger: 0.1, ease: 'power2.out', scrollTrigger: { trigger: '.how-steps', start: 'top 78%' } })
  }, { scope: sectionRef })

  return (
    <section ref={sectionRef} style={{ padding: '80px 24px', borderTop: '1px solid var(--border-subtle)' }} id="how-it-works">
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h2 style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)', fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.02em', color: 'var(--text)' }}>
            How it works
          </h2>
        </div>

        <div className="how-steps" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', gap: 0, alignItems: 'start' }}>
          {STEPS.map((s, i) => (
            <div key={i} style={{ display: 'contents' }}>
              <div className="how-step" style={{ padding: '24px', border: '1px dashed var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ width: 28, height: 28, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <s.Icon style={{ width: 13, height: 13, color: s.accent }} />
                  </div>
                  <span style={{ fontSize: 11, color: s.accent, border: `1px solid ${s.accent}`, padding: '2px 8px', fontWeight: 500 }}>
                    {s.n}
                  </span>
                </div>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8, lineHeight: 1.4 }}>{s.title}</h3>
                <p style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--text-secondary)' }}>{s.desc}</p>
              </div>

              {i < STEPS.length - 1 && (
                <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px', alignSelf: 'center', height: 120 }}>
                  <svg width={40} height={24} viewBox="0 0 40 24">
                    <line x1={0} y1={12} x2={32} y2={12} stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="4 4" />
                    <path d="M 30 6 L 38 12 L 30 18" fill="none" stroke="var(--border-strong)" strokeWidth={1} />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
