/**
 * Hero — full viewport intro
 *
 * Gradient background, dot grid texture, star-bordered icon frame.
 */

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Download } from 'lucide-react'
import { motion } from 'motion/react'
import { useRef } from 'react'
import { StarBorders } from './blueprint-annotations'

gsap.registerPlugin(useGSAP)

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(() => {
    gsap.set('.hero-icon-wrap', { opacity: 0, scale: 0.95, y: 20 })
    gsap.set('.hero-title', { opacity: 0, y: 24 })
    gsap.set('.hero-sub', { opacity: 0, y: 16 })
    gsap.set('.hero-ctas', { opacity: 0, y: 12 })

    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
    tl.to('.hero-icon-wrap', { opacity: 1, scale: 1, y: 0, duration: 0.7, ease: 'expo.out' })
      .to('.hero-title', { opacity: 1, y: 0, duration: 0.7 }, '-=0.3')
      .to('.hero-sub', { opacity: 1, y: 0, duration: 0.6 }, '-=0.4')
      .to('.hero-ctas', { opacity: 1, y: 0, duration: 0.5 }, '-=0.3')
  }, { scope: sectionRef })

  return (
    <section
      ref={sectionRef}
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 'clamp(48px, 12dvh, 120px) 24px 60px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background gradient + dot grid */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(44.02% 44.02% at 14.38% 14.47%, var(--hero-gradient-1) 0%, transparent 100%), radial-gradient(50.49% 50.49% at 85.46% 82.33%, var(--hero-gradient-2) 0%, transparent 100%)`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'radial-gradient(var(--pattern-fg) 1px, transparent 1px)',
            backgroundSize: '10px 10px',
            backgroundAttachment: 'fixed',
          }}
        />
      </div>

      {/* Icon */}
      <div className="hero-icon-wrap" style={{ position: 'relative', zIndex: 1, marginBottom: 36 }}>
        <StarBorders>
          <div style={{ padding: 16 }}>
            <img
              src="/icon.png"
              alt="Cradle"
              width={120}
              height={120}
              fetchPriority="high"
              decoding="async"
              style={{ display: 'block' }}
            />
          </div>
        </StarBorders>
      </div>

      {/* Headline */}
      <h1
        className="hero-title"
        style={{
          position: 'relative',
          zIndex: 1,
          fontSize: 'clamp(2.5rem, 8vw, 5.5rem)',
          fontWeight: 700,
          lineHeight: 0.95,
          letterSpacing: '-0.04em',
          color: 'var(--text)',
          marginBottom: 'clamp(12px, 2dvh, 20px)',
        }}
      >
        One layer above
        <br />
        <span style={{ color: 'var(--text-muted)' }}>your AI tools.</span>
      </h1>

      {/* Subline */}
      <p
        className="hero-sub"
        style={{
          position: 'relative',
          zIndex: 1,
          fontSize: 'clamp(0.95rem, 1.6vw, 1.1rem)',
          lineHeight: 1.7,
          color: 'var(--text-secondary)',
          maxWidth: 460,
          marginBottom: 'clamp(20px, 3dvh, 36px)',
        }}
      >
        Your AI coding tools are brilliant. Managing them is a mess.
        Cradle is the command center that coordinates all of them.
      </p>

      {/* CTAs */}
      <div className="hero-ctas" style={{ position: 'relative', zIndex: 1, display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <motion.a
          href="https://github.com/wibus-wee/cradle-app/releases"
          target='_block'
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 22px',
            background: 'var(--text)',
            color: 'var(--bg)',
            fontWeight: 600,
            fontSize: 13,
            textDecoration: 'none',
            transition: 'opacity 0.15s',
          }}
        >
          <Download style={{ width: 14, height: 14 }} />
          Download for macOS
        </motion.a>
      </div>

      {/* Footnote */}
      <div style={{ position: 'relative', zIndex: 1, marginTop: 48 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          macOS 14+ · Apple Silicon & Intel · Free forever
        </span>
      </div>
    </section>
  )
}
