/**
 * Problem — 4 pain-point cards
 */

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Eye, Layers, MessageSquare, Terminal } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

gsap.registerPlugin(useGSAP)

const PAIN_POINTS = [
  { Icon: Layers, title: 'Six tools, six windows', desc: 'Claude Code in one terminal. Cursor in another. Copilot somewhere in VS Code. Codex in its own UI. Context is scattered.' },
  { Icon: Eye, title: 'Zero visibility', desc: 'Which agent is still running? Which one got stuck? What did it do while you were in a meeting?' },
  { Icon: MessageSquare, title: 'Manual coordination', desc: 'Wait for CI? Check it yourself. PR merged? Go back and tell the agent. You\'re doing the agent\'s job.' },
  // { Icon: Terminal, title: 'Context dies with the session', desc: 'Close the tab and the work is gone. No history, no checkpoints, no way to resume where the agent left off.' },
]

function PainCard({ Icon, title, desc }: typeof PAIN_POINTS[0]) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={useCallback(() => setHovered(true), [])}
      onMouseLeave={useCallback(() => setHovered(false), [])}
      style={{
        padding: '24px',
        background: hovered ? 'var(--fill-hover)' : 'transparent',
        border: `1px solid ${hovered ? 'var(--border-strong)' : 'var(--border)'}`,
        transition: 'border-color 0.25s, background 0.25s',
        cursor: 'default',
      }}
    >
      <div style={{
        width: 28, height: 28, border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14,
      }}
      >
        <Icon style={{ width: 13, height: 13, color: 'var(--text-secondary)' }} />
      </div>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{title}</h3>
      <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)' }}>{desc}</p>
    </div>
  )
}

export function ProblemSection() {
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(() => {
    gsap.from('.prob-header', { y: 20, opacity: 0, duration: 0.6, ease: 'power2.out', scrollTrigger: { trigger: '.prob-header', start: 'top 82%' } })
    gsap.from('.pain-card', { y: 20, opacity: 0, duration: 0.5, stagger: 0.08, ease: 'power2.out', scrollTrigger: { trigger: '.pain-grid', start: 'top 80%' } })
  }, { scope: sectionRef })

  return (
    <section ref={sectionRef} style={{ padding: '80px 24px', borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div className="prob-header" style={{ textAlign: 'center', marginBottom: 48 }}>
          <h2 style={{
            fontSize: 'clamp(1.4rem, 3vw, 2rem)', fontWeight: 600, lineHeight: 1.15,
            letterSpacing: '-0.02em', color: 'var(--text)', marginBottom: 12,
          }}
          >
            Your AI tools are brilliant.
            <br />
            <span style={{ color: 'var(--text-muted)' }}>Managing them is a mess.</span>
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-secondary)', maxWidth: 440, margin: '0 auto' }}>
            You spend more time coordinating tools than actually shipping.
            That's not a you problem — it's a missing layer problem.
          </p>
        </div>
        <div className="pain-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          {PAIN_POINTS.map(p => (
            <div key={p.title} className="pain-card">
              <PainCard {...p} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
