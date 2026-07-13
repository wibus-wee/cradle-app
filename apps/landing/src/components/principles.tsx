/**
 * Principles — three brand values, type-led.
 *
 * A quiet "why" pause between the feature cards and the how-it-works steps.
 * Pure type with a small gradient dot per value — no illustrations, to keep
 * the rhythm distinct from the illustrated sections around it.
 */

import { motion } from 'motion/react'

const PRINCIPLES = [
  {
    title: 'Local-first by default',
    desc: 'No cloud relay. No telemetry. Your code, keys, and sessions stay on your machine.',
  },
  {
    title: 'Open source, forever',
    desc: 'MIT-licensed and built in the open. Fork it, audit it, extend it with the plugin SDK.',
  },
  {
    title: 'Built for coordination',
    desc: 'Cradle isn\'t another agent. It\'s the layer above — the command center that makes them work together.',
  },
]

const EASE = [0.22, 1, 0.36, 1] as const

export function Principles() {
  return (
    <section
      style={{
        padding: 'clamp(72px, 12dvh, 120px) 24px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg)',
      }}
    >
      <div
        style={{
          maxWidth: 1080,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 32,
        }}
      >
        {PRINCIPLES.map((p, i) => (
          <motion.div
            key={p.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-10% 0px' }}
            transition={{ duration: 0.5, delay: i * 0.08, ease: EASE }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #a78bfa, #22d3ee, #fb923c)',
                marginBottom: 18,
              }}
            />
            <h3
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--text)',
                marginBottom: 10,
                letterSpacing: '-0.015em',
              }}
            >
              {p.title}
            </h3>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
              {p.desc}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
