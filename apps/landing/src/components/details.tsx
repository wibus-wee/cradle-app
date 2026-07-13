/**
 * DetailsSection — a product tour: real screenshots paired with copy,
 * alternating sides.
 *
 * Redesigned from the README's <table> "Details" block into the landing's
 * editorial rhythm. Where FeaturesSection uses abstract marks and
 * FeatureHighlight uses abstract illustrations, this section shows the real
 * product surfaces — the goal here is "see what Cradle actually looks like."
 *
 * Each row carries an eyebrow, a headline, a short paragraph, and a 3-item
 * capability list so the copy column has real weight against the screenshot.
 * Screenshots sit in hairline-framed cards with a soft purple-tinted shadow;
 * no blur, no faux chrome. `reversed` alternates the columns row by row.
 *
 * Session Await lives in FeatureHighlight (its abstract cycle reads the
 * concept better than a screenshot) — it is intentionally not here.
 */

import { Check } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'

const EASE = [0.22, 1, 0.36, 1] as const

interface Detail {
  eyebrow: string
  title: ReactNode
  desc: string
  points: [string, string, string]
  image: string
  alt: string
}

const DETAILS: Detail[] = [
  {
    eyebrow: 'Workspace',
    title: 'Every agent, session, and project — one window.',
    desc: 'A unified workspace for managing all your agents, sessions, and projects. Navigate between contexts without losing your place.',
    points: [
      'Switch between agents, sessions, and projects in one sidebar',
      'Live status for every running task at a glance',
      'One home for every runner — no window-juggling',
    ],
    image: '/details/Workspace.webp',
    alt: 'Cradle workspace overview',
  },
  {
    eyebrow: 'Issue Tracking',
    title: 'A Kanban board that knows about your agents.',
    desc: 'Workflow statuses, milestones, comments, and agent delegation. Track issues visually and assign cards to AI agents directly.',
    points: [
      'Workflow statuses, milestones, and comments',
      'Delegate a card to an AI agent in one click',
      'Sync with GitHub Issues via the first-party plugin',
    ],
    image: '/details/kanban.webp',
    alt: 'Kanban issue tracking board',
  },
  {
    eyebrow: 'Cradle Diffs',
    title: 'Review what your agent changed, before it ships.',
    desc: 'A visual diff viewer for code changes made by agents. Understand what changed and why — approve or reject with confidence.',
    points: [
      'Side-by-side diff for every file the agent touched',
      'Approve, reject, or request changes inline',
      'See the reasoning behind each edit',
    ],
    image: '/details/diffs.webp',
    alt: 'Visual diff viewer for agent changes',
  },
  {
    eyebrow: 'Design Mode',
    title: 'Click. Describe. Let the agent rebuild the UI.',
    desc: 'Point at any element in the running app, sketch or describe the change you want, and the agent receives the component code and screenshot as context — then writes the edit for you.',
    points: [
      'Click-to-select any element and send its code to the agent',
      'Draw or describe changes directly on the live UI',
      'Agent receives component + screenshot as full context',
    ],
    image: '/details/design-mode.webp',
    alt: 'Visual agent command mode on the live application',
  },
  {
    eyebrow: 'Plugin System',
    title: 'Extend Cradle with official and community plugins.',
    desc: 'Add new capabilities and integrations. Build your own with the Plugin SDK — server, web, and desktop entry points.',
    points: [
      'Official plugins ship in-app',
      'Build your own with the Plugin SDK',
      'Server, web, and desktop entry points',
    ],
    image: '/details/plugins.webp',
    alt: 'Plugin system and marketplace',
  },
  {
    eyebrow: 'Your Data, Your Control',
    title: 'Local-first. No telemetry. No cloud relay.',
    desc: 'Your data stays on your machine. Cradle is built privacy-first — full local control over your agents and conversations.',
    points: [
      'API keys in your keychain, sessions on disk',
      'No telemetry, no cloud dependency',
      'Your code and conversations never leave your machine',
    ],
    image: '/details/about-data-care.webp',
    alt: 'Local-first data care',
  },
]

export function DetailsSection() {
  return (
    <section
      id="details"
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
          style={{ textAlign: 'center', marginBottom: 88 }}
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
            A look inside Cradle.
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
            Six surfaces, one workspace. Here is what each part actually looks like.
          </p>
        </motion.div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(80px, 11dvh, 140px)' }}>
          {DETAILS.map((detail, i) => (
            <DetailRow key={detail.eyebrow} detail={detail} reversed={i % 2 === 1} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}

function DetailRow({ detail, reversed, index }: { detail: Detail, reversed: boolean, index: number }) {
  const { eyebrow, title, desc, points, image, alt } = detail

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 'clamp(36px, 5vw, 72px)',
        alignItems: 'center',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-15% 0px' }}
        transition={{ duration: 0.6, ease: EASE }}
        style={{ order: reversed ? 2 : 1, minWidth: 0 }}
      >
        {/* Label — small mono index + sentence-case category. A quiet SaaS
            label; the headline below is the column's hero. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--text-muted)',
              letterSpacing: '0.02em',
            }}
          >
            {String(index + 1).padStart(2, '0')}
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-secondary)',
            }}
          >
            {eyebrow}
          </span>
        </div>

        <h3
          style={{
            fontSize: 'clamp(1.7rem, 3.3vw, 2.2rem)',
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: '-0.028em',
            color: 'var(--text)',
            marginBottom: 16,
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.6,
            color: 'var(--text-secondary)',
            marginBottom: 24,
            maxWidth: 480,
          }}
        >
          {desc}
        </p>

        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {points.map(point => (
            <li
              key={point}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                fontSize: 14,
                lineHeight: 1.5,
                color: 'var(--text-secondary)',
              }}
            >
              <Check
                aria-hidden="true"
                style={{
                  flexShrink: 0,
                  width: 15,
                  height: 15,
                  marginTop: 1,
                  color: 'var(--text-secondary)',
                }}
              />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 16 }}
        whileInView={{ opacity: 1, scale: 1, y: 0 }}
        viewport={{ once: true, margin: '-15% 0px' }}
        transition={{ duration: 0.7, ease: EASE }}
        style={{ order: reversed ? 1 : 2, minWidth: 0 }}
      >
        <div
          style={{
            position: 'relative',
            borderRadius: 12,
            overflow: 'hidden',
            border: '1px solid var(--border-strong)',
            background: 'var(--bg-subtle)',
            /* Dark drop + a faint purple-tinted halo — depth without a frame
               competing with the screenshot, and without any backdrop-blur. */
            boxShadow:
              '0 28px 70px -30px rgba(0, 0, 0, 0.75), 0 10px 30px -16px rgba(0, 0, 0, 0.5), 0 0 60px -28px rgba(167, 139, 250, 0.35)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 12,
              pointerEvents: 'none',
              boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.06)',
            }}
          />
          <img
            src={image}
            alt={alt}
            loading="lazy"
            decoding="async"
            style={{ display: 'block', width: '100%', height: 'auto' }}
          />
        </div>
      </motion.div>
    </div>
  )
}
