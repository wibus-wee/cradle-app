/**
 * Hero — full-viewport intro over the FoldGradient shader.
 *
 * Type-led and minimal (Raycast / Cursor / Perplexity feel): eyebrow pill,
 * tight-tracking headline, one-line value prop, multi-platform download CTAs.
 * The shader is the hero's signature visual; no faux product mock.
 * Below the hero the page is solid var(--bg), so the shader never shows
 * through content.
 *
 * The shader pauses (speed 0) when the hero scrolls out of view or when the
 * user prefers reduced motion — no GPU spent animating an offscreen canvas.
 */

import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import FoldGradient from '../foldGradient'
import { DownloadActions } from './download-cta'

const EASE = [0.22, 1, 0.36, 1] as const

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(mq.matches)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return reduced
}

export function Hero() {
  const reduced = usePrefersReducedMotion()
  const sectionRef = useRef<HTMLElement>(null)
  const [inView, setInView] = useState(true)

  useEffect(() => {
    const el = sectionRef.current
    if (!el) { return }
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: '50px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const shaderSpeed = reduced ? 0 : (inView ? 1 : 0)

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
        padding: 'clamp(72px, 14dvh, 140px) 24px 80px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* FoldGradient shader — domain-warped light-sheets, the hero's signature visual. */}
      <FoldGradient
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        colors={['#101014', '#2e3038', '#8a8f9c', '#d8dce6', '#ffe9c2']}
        bgColor="#08080a"
        shadowColor="#141418"
        softness={0.9}
        saturation={0.9}
        rotation={60}
        zoom={8}
        ribbon={0}
        ribbonWidth={1}
        speed={shaderSpeed}
      />
      {/* Center scrim for text legibility over the moving light-sheets. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(46% 42% at 50% 48%, rgba(8,8,10,0.5), transparent 72%)',
        }}
      />
      {/* Fade into the solid page below. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'linear-gradient(to bottom, transparent 60%, var(--bg) 100%)',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: EASE }}
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {/* Eyebrow */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 12px',
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            borderRadius: 999,
            marginBottom: 30,
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--text)',
              boxShadow: '0 0 8px rgba(255, 233, 194, 0.6)',
            }}
          />
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--text-secondary)',
              letterSpacing: '0.01em',
            }}
          >
            AI coding agent command center
          </span>
        </div>

        {/* Headline */}
        <h1
          style={{
            fontSize: 'clamp(2.6rem, 8vw, 5.4rem)',
            fontWeight: 600,
            lineHeight: 0.98,
            letterSpacing: '-0.045em',
            color: 'var(--text)',
            marginBottom: 'clamp(16px, 2dvh, 24px)',
            maxWidth: 920,
          }}
        >
          One layer above
          <br />
          <span style={{ color: 'var(--text-secondary)' }}>your AI tools.</span>
        </h1>

        {/* Subline */}
        <p
          style={{
            fontSize: 'clamp(1rem, 1.5vw, 1.15rem)',
            lineHeight: 1.65,
            color: 'var(--text-secondary)',
            maxWidth: 520,
            marginBottom: 'clamp(28px, 4dvh, 40px)',
          }}
        >
          Cradle orchestrates Claude Code, Cursor, Codex, and the rest — sessions,
          issues, and tools, all in one focused desktop workspace.
        </p>

        {/* CTAs — multi-platform, with Motion blur hover + platform rail */}
        <div style={{ marginTop: 0 }}>
          <DownloadActions />
        </div>
      </motion.div>
    </section>
  )
}
