/**
 * Comparison table
 */

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { CheckCircle2, Minus, X } from 'lucide-react'
import { useRef } from 'react'

const TOOLS = ['Cursor', 'Claude Code', 'Devin', 'Cradle']
const ROWS = [
  { label: 'Multi-agent orchestration', vals: [false, false, false, true] },
  { label: 'Parallel agents, same codebase', vals: [false, false, 'partial', true] },
  { label: 'Session Await / Resume', vals: [false, false, 'partial', true] },
  { label: 'Local-first, data on device', vals: [false, false, false, true] },
  { label: 'Works with any AI tool', vals: [false, false, false, true] },
  { label: 'Live agent observability', vals: [false, 'partial', false, true] },
  { label: 'Plugin / extension system', vals: ['partial', false, false, true] },
]

function CellIcon({ val }: { val: boolean | string }) {
  if (val === true) return <CheckCircle2 style={{ width: 14, height: 14, color: '#10b981' }} />
  if (val === 'partial') return <Minus style={{ width: 14, height: 14, color: '#f59e0b' }} />
  return <X style={{ width: 12, height: 12, color: 'var(--text-muted)' }} />
}

export function ComparisonSection() {
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(() => {
    gsap.from('.comp-table', { y: 20, opacity: 0, duration: 0.6, ease: 'power2.out', scrollTrigger: { trigger: '.comp-table', start: 'top 80%' } })
  }, { scope: sectionRef })

  return (
    <section ref={sectionRef} style={{ padding: '80px 24px', borderTop: '1px solid var(--border-subtle)' }} id="comparison">
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2 style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)', fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.02em', color: 'var(--text)', marginBottom: 12 }}>
            Not a replacement. A command center.
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-secondary)', maxWidth: 420, margin: '0 auto' }}>
            Cradle doesn't compete with your tools. It sits above them — the neutral orchestration layer no one else is building.
          </p>
        </div>

        <div className="comp-table" style={{ border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--fill-hover)' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', width: '42%', borderBottom: '1px solid var(--border)' }}>Capability</th>
                {TOOLS.map(tool => (
                  <th key={tool} style={{
                    padding: '10px 16px', textAlign: 'center', fontSize: 12, fontWeight: 500,
                    color: tool === 'Cradle' ? 'var(--text)' : 'var(--text-muted)',
                    borderBottom: '1px solid var(--border)',
                    ...(tool === 'Cradle' ? { borderLeft: '1px solid var(--border)' } : {}),
                  }}
                  >
                    {tool}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr key={row.label} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--fill)', borderBottom: i < ROWS.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                  <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-secondary)' }}>{row.label}</td>
                  {row.vals.map((v, j) => (
                    <td key={j} style={{ padding: '10px 16px', textAlign: 'center', ...(TOOLS[j] === 'Cradle' ? { borderLeft: '1px solid var(--border-subtle)' } : {}) }}>
                      <div style={{ display: 'flex', justifyContent: 'center' }}><CellIcon val={v} /></div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, marginTop: 14 }}>
          {[
            { Icon: CheckCircle2, color: '#10b981', label: 'Supported' },
            { Icon: Minus, color: '#f59e0b', label: 'Partial' },
            { Icon: X, color: 'var(--text-muted)', label: 'Not available' },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <l.Icon style={{ width: 11, height: 11, color: l.color }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
