/**
 * CTA — closing download section.
 */

import { motion } from 'motion/react'

import { DownloadActions } from './download-cta'

export function CTASection() {
  return (
    <section
      id="download"
      style={{
        padding: 'clamp(96px, 16dvh, 160px) 24px',
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-15% 0px' }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}
      >
        <h2
          style={{
            fontSize: 'clamp(1.6rem, 3.6vw, 2.4rem)',
            fontWeight: 600,
            lineHeight: 1.15,
            letterSpacing: '-0.025em',
            color: 'var(--text)',
            marginBottom: 14,
          }}
        >
          Your agents are waiting.
        </h2>
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.7,
            color: 'var(--text-secondary)',
            maxWidth: 400,
            margin: '0 auto 32px',
          }}
        >
          Download Cradle for macOS, Windows, or Linux — and turn scattered tools
          into one command center.
        </p>

        <DownloadActions />
      </motion.div>
    </section>
  )
}
