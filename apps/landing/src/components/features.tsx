/**
 * Features — bento grid of value props.
 *
 * Each card carries a custom branded illustration (see illustrations.tsx)
 * instead of a generic icon. Subtle non-blurred surfaces; hairline borders
 * brighten on hover. motion whileInView stagger for the entrance.
 */

import { motion } from 'motion/react'
import type { ComponentType } from 'react'
import { useState } from 'react'

import {
  CoordinateIllustration,
  FieldIllustration,
  LocalFirstIllustration,
  UnifiedIllustration,
} from './illustrations'

interface Feature {
  Illustration: ComponentType
  title: string
  desc: string
}

const FEATURES: Feature[] = [
  {
    Illustration: UnifiedIllustration,
    title: 'Every agent, one home',
    desc: 'Run Claude Code, Cursor, Codex, and Copilot side by side. Switch runners without switching apps.',
  },
  {
    Illustration: FieldIllustration,
    title: 'See the whole field',
    desc: 'Live status for every session, run, and await. Know what is still working — without checking six windows.',
  },
  {
    Illustration: CoordinateIllustration,
    title: 'Coordinate, don\'t babysit',
    desc: 'Chain agents, gate on CI and reviews, hand off automatically. Cradle does the waiting for you.',
  },
  {
    Illustration: LocalFirstIllustration,
    title: 'Local-first by default',
    desc: 'No cloud relay, no telemetry. API keys in your keychain, sessions on disk. Your code stays yours.',
  },
]

const EASE = [0.22, 1, 0.36, 1] as const

export function FeaturesSection() {
  return (
    <section
      id="features"
      style={{
        padding: 'clamp(72px, 12dvh, 120px) 24px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg)',
      }}
    >
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15% 0px' }}
          transition={{ duration: 0.5, ease: EASE }}
          style={{ textAlign: 'center', marginBottom: 56 }}
        >
          <h2
            style={{
              fontSize: 'clamp(1.5rem, 3.2vw, 2.2rem)',
              fontWeight: 600,
              lineHeight: 1.15,
              letterSpacing: '-0.025em',
              color: 'var(--text)',
              marginBottom: 14,
            }}
          >
            Everything you need to orchestrate AI.
            <br />
            <span style={{ color: 'var(--text-muted)' }}>Nothing you don't.</span>
          </h2>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.7,
              color: 'var(--text-secondary)',
              maxWidth: 460,
              margin: '0 auto',
            }}
          >
            One desktop workspace for every agent, every session, every handoff.
          </p>
        </motion.div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
          }}
        >
          {FEATURES.map((feature, i) => (
            <FeatureCard key={feature.title} feature={feature} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}

function FeatureCard({ feature, index }: { feature: Feature, index: number }) {
  const [hovered, setHovered] = useState(false)
  const { Illustration, title, desc } = feature

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.5, delay: index * 0.06, ease: EASE }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: 28,
        background: hovered ? 'var(--fill-hover)' : 'var(--fill)',
        border: `1px solid ${hovered ? 'var(--border-strong)' : 'var(--border)'}`,
        borderRadius: 12,
        transition: 'border-color 0.25s, background 0.25s',
      }}
    >
      <div style={{ marginBottom: 18 }}>
        <Illustration />
      </div>
      <h3
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--text)',
          marginBottom: 8,
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h3>
      <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)' }}>{desc}</p>
    </motion.div>
  )
}
