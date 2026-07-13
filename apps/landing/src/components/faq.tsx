/**
 * FAQ — native <details> accordion.
 *
 * Semantic and accessible by default; a small CSS rule (in styles.css) hides
 * the native disclosure triangle and rotates the custom + marker to × on
 * open. No JS state needed.
 */

import { motion } from 'motion/react'

const FAQS = [
  {
    q: 'Is Cradle free?',
    a: 'Yes. Cradle is free forever and open source.',
  },
  {
    q: 'Which agents does it support?',
    a: 'Claude Code, Cursor, Codex, Copilot, Gemini CLI, OpenCode, and anything that speaks an OpenAI-compatible protocol. Add your own with the plugin SDK.',
  },
  {
    q: 'Does my code leave my machine?',
    a: 'No. Cradle is local-first — no cloud relay, no telemetry. API keys live in your system keychain and sessions stay on disk.',
  },
  {
    q: 'What platforms does it run on?',
    a: 'macOS 14+ on Apple Silicon and Intel. More platforms are on the roadmap.',
  },
  {
    q: 'How is it different from running each tool myself?',
    a: 'Cradle is the layer above: one surface for every session, live status across agents, and automatic handoffs gated on CI, reviews, and more — so you stop babysitting.',
  },
]

const EASE = [0.22, 1, 0.36, 1] as const

export function FAQ() {
  return (
    <section
      style={{
        padding: 'clamp(72px, 12dvh, 120px) 24px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg)',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15% 0px' }}
          transition={{ duration: 0.5, ease: EASE }}
          style={{
            fontSize: 'clamp(1.5rem, 3.2vw, 2.2rem)',
            fontWeight: 600,
            lineHeight: 1.15,
            letterSpacing: '-0.025em',
            color: 'var(--text)',
            marginBottom: 40,
            textAlign: 'center',
          }}
        >
          Questions
        </motion.h2>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {FAQS.map((item, i) => (
            <motion.details
              key={item.q}
              className="faq-item"
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-10% 0px' }}
              transition={{ duration: 0.4, delay: i * 0.05, ease: EASE }}
              style={{ borderTop: '1px solid var(--border-subtle)', padding: '18px 0' }}
            >
              <summary
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  cursor: 'pointer',
                  listStyle: 'none',
                }}
              >
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 500,
                    color: 'var(--text)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {item.q}
                </span>
                <span
                  className="faq-marker"
                  aria-hidden="true"
                  style={{ position: 'relative', width: 14, height: 14, flexShrink: 0, color: 'var(--text-muted)' }}
                >
                  <span style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'currentColor' }} />
                  <span style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'currentColor' }} />
                </span>
              </summary>
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.75,
                  color: 'var(--text-secondary)',
                  marginTop: 12,
                  maxWidth: 560,
                }}
              >
                {item.a}
              </p>
            </motion.details>
          ))}
        </div>
      </div>
    </section>
  )
}
