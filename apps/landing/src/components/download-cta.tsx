/**
 * Shared download CTAs for the landing page.
 *
 * Cradle ships for macOS, Windows, and Linux — the primary button detects the
 * visitor's OS and crossfades the label on hover with a soft blur + warm glow
 * (Motion). Secondary platform chips reveal on hover as a quiet platform rail.
 */

import { Download } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useState } from 'react'

export const RELEASES_URL = 'https://github.com/wibus-wee/cradle-app/releases'
export const REPO_URL = 'https://github.com/wibus-wee/cradle-app'

export type Platform = 'mac' | 'windows' | 'linux' | 'unknown'

const PLATFORM_LABEL: Record<Platform, string> = {
  mac: 'Download for macOS',
  windows: 'Download for Windows',
  linux: 'Download for Linux',
  unknown: 'Download Cradle',
}

const PLATFORM_CHIPS: { id: Platform, label: string }[] = [
  { id: 'mac', label: 'macOS' },
  { id: 'windows', label: 'Windows' },
  { id: 'linux', label: 'Linux' },
]

const EASE = [0.22, 1, 0.36, 1] as const

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') { return 'unknown' }
  const ua = navigator.userAgent
  // Phones aren't a desktop install target — keep the generic label.
  if (/Android|iPhone|iPad|iPod/i.test(ua)) { return 'unknown' }
  if (/Windows|Win64|Win32|WinCE/i.test(ua)) { return 'windows' }
  if (/Linux|X11|CrOS/i.test(ua)) { return 'linux' }
  if (/Mac/i.test(ua)) { return 'mac' }
  return 'unknown'
}

export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>('unknown')
  useEffect(() => {
    setPlatform(detectPlatform())
  }, [])
  return platform
}

/** Primary + ghost pair with platform-aware label and blur hover rail. */
export function DownloadActions({
  align = 'center',
  showPlatformRail = true,
}: {
  align?: 'center' | 'start'
  showPlatformRail?: boolean
}) {
  const [groupHovered, setGroupHovered] = useState(false)

  return (
    <div
      onMouseEnter={() => setGroupHovered(true)}
      onMouseLeave={() => setGroupHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'center' ? 'center' : 'flex-start',
        gap: 28,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          justifyContent: align === 'center' ? 'center' : 'flex-start',
        }}
      >
        <PrimaryDownloadButton />
        <GhostLink href={REPO_URL}>View on GitHub</GhostLink>
      </div>

      {showPlatformRail
        ? (
            <PlatformRail active={groupHovered} />
          )
        : null}
    </div>
  )
}

/** Compact nav download chip with glow + blur label reveal. */
export function NavDownloadButton() {
  const platform = usePlatform()
  const reduced = useReducedMotion()
  const [hovered, setHovered] = useState(false)
  const label = PLATFORM_LABEL[platform]

  if (reduced) {
    return (
      <a
        href={RELEASES_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 30,
          padding: '0 14px',
          border: '1px solid var(--border)',
          background: 'transparent',
          color: 'var(--text-secondary)',
          fontSize: 13,
          fontWeight: 500,
          textDecoration: 'none',
          borderRadius: 8,
        }}
      >
        <Download style={{ width: 13, height: 13 }} />
        Download
      </a>
    )
  }

  return (
    <motion.a
      href={RELEASES_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileTap={{ scale: 0.98 }}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 30,
        padding: '0 14px',
        border: '1px solid var(--border)',
        background: hovered ? 'var(--fill-hover)' : 'transparent',
        color: hovered ? 'var(--text)' : 'var(--text-secondary)',
        fontSize: 13,
        fontWeight: 500,
        textDecoration: 'none',
        borderRadius: 8,
        overflow: 'hidden',
        transition: 'background 0.15s, color 0.15s, border-color 0.15s',
        borderColor: hovered ? 'var(--border-strong)' : 'var(--border)',
      }}
    >
      <motion.span
        aria-hidden
        animate={{ opacity: hovered ? 1 : 0 }}
        transition={{ duration: 0.35, ease: EASE }}
        style={{
          position: 'absolute',
          inset: -12,
          background:
            'radial-gradient(circle at 50% 50%, rgba(255, 233, 194, 0.22), transparent 68%)',
          filter: 'blur(10px)',
          pointerEvents: 'none',
        }}
      />
      <Download style={{ width: 13, height: 13, position: 'relative' }} />
      <span
        aria-hidden
        style={{
          position: 'relative',
          display: 'inline-grid',
          overflow: 'hidden',
          maxWidth: hovered ? 160 : 72,
          transition: 'max-width 0.35s cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <motion.span
          animate={{
            opacity: hovered ? 0 : 1,
            filter: hovered ? 'blur(5px)' : 'blur(0px)',
            y: hovered ? -5 : 0,
          }}
          transition={{ duration: 0.28, ease: EASE }}
          style={{ gridArea: '1 / 1', whiteSpace: 'nowrap' }}
        >
          Download
        </motion.span>
        <motion.span
          animate={{
            opacity: hovered ? 1 : 0,
            filter: hovered ? 'blur(0px)' : 'blur(5px)',
            y: hovered ? 0 : 5,
          }}
          transition={{ duration: 0.28, ease: EASE }}
          style={{ gridArea: '1 / 1', whiteSpace: 'nowrap' }}
        >
          {label}
        </motion.span>
      </span>
    </motion.a>
  )
}

function PrimaryDownloadButton() {
  const platform = usePlatform()
  const reduced = useReducedMotion()
  const [hovered, setHovered] = useState(false)
  const idleLabel = 'Download Cradle'
  const hoverLabel = PLATFORM_LABEL[platform]

  // Reduced motion: static platform-aware label, no dual-layer crossfade.
  if (reduced) {
    return (
      <a
        href={RELEASES_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={primaryButtonStyle}
      >
        <Download style={{ width: 14, height: 14 }} />
        {hoverLabel}
      </a>
    )
  }

  return (
    // Outer wrap keeps the warm bloom visible outside the button's overflow clip.
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <motion.span
        aria-hidden
        animate={{
          opacity: hovered ? 1 : 0,
          scale: hovered ? 1 : 0.55,
        }}
        transition={{ duration: 0.45, ease: EASE }}
        style={{
          position: 'absolute',
          inset: -22,
          zIndex: 0,
          background:
            'radial-gradient(circle at 50% 40%, rgba(255, 233, 194, 0.5), rgba(255, 233, 194, 0.08) 42%, transparent 70%)',
          filter: 'blur(16px)',
          pointerEvents: 'none',
        }}
      />
      <motion.a
        href={RELEASES_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${hoverLabel}. Available for macOS, Windows, and Linux.`}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        style={{
          ...primaryButtonStyle,
          position: 'relative',
          zIndex: 1,
          overflow: 'hidden',
        }}
      >
        {/* Specular sweep across the face. */}
        <motion.span
          aria-hidden
          animate={{ x: hovered ? '140%' : '-80%', opacity: hovered ? 1 : 0 }}
          transition={{ duration: 0.55, ease: EASE }}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: '42%',
            zIndex: 1,
            background:
              'linear-gradient(105deg, transparent, rgba(255,255,255,0.35), transparent)',
            transform: 'skewX(-18deg)',
            pointerEvents: 'none',
          }}
        />

        <motion.span
          aria-hidden
          animate={{
            y: hovered ? -1 : 0,
            rotate: hovered ? -8 : 0,
          }}
          transition={{ type: 'spring', stiffness: 420, damping: 22 }}
          style={{ position: 'relative', zIndex: 2, display: 'inline-flex' }}
        >
          <Download style={{ width: 14, height: 14 }} />
        </motion.span>

        {/* Dual-layer label: idle ↔ platform-aware, crossfaded through blur. */}
        <span
          aria-hidden
          style={{
            position: 'relative',
            zIndex: 2,
            display: 'inline-grid',
            justifyItems: 'start',
          }}
        >
          <motion.span
            animate={{
              opacity: hovered ? 0 : 1,
              filter: hovered ? 'blur(6px)' : 'blur(0px)',
              y: hovered ? -6 : 0,
              letterSpacing: hovered ? '0.02em' : '0em',
            }}
            transition={{ duration: 0.32, ease: EASE }}
            style={{ gridArea: '1 / 1', whiteSpace: 'nowrap' }}
          >
            {idleLabel}
          </motion.span>
          <motion.span
            animate={{
              opacity: hovered ? 1 : 0,
              filter: hovered ? 'blur(0px)' : 'blur(6px)',
              y: hovered ? 0 : 6,
              letterSpacing: hovered ? '0em' : '-0.02em',
            }}
            transition={{ duration: 0.32, ease: EASE }}
            style={{ gridArea: '1 / 1', whiteSpace: 'nowrap' }}
          >
            {hoverLabel}
          </motion.span>
        </span>
      </motion.a>
    </span>
  )
}

function GhostLink({ href, children }: { href: string, children: ReactNode }) {
  const reduced = useReducedMotion()
  const [hovered, setHovered] = useState(false)

  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileHover={reduced ? undefined : { scale: 1.02 }}
      whileTap={reduced ? undefined : { scale: 0.98 }}
      style={{
        ...ghostButtonStyle,
        position: 'relative',
        overflow: 'hidden',
        color: hovered ? 'var(--text)' : 'var(--text-secondary)',
        borderColor: hovered ? 'var(--border-strong)' : 'var(--border)',
        background: hovered ? 'var(--fill-hover)' : 'transparent',
        transition: 'color 0.18s, border-color 0.18s, background 0.18s',
      }}
    >
      {!reduced && (
        <motion.span
          aria-hidden
          animate={{
            opacity: hovered ? 1 : 0,
            filter: hovered ? 'blur(0px)' : 'blur(8px)',
          }}
          transition={{ duration: 0.3, ease: EASE }}
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(120% 80% at 50% 120%, rgba(255,255,255,0.08), transparent 60%)',
            pointerEvents: 'none',
          }}
        />
      )}
      <span style={{ position: 'relative' }}>{children}</span>
    </motion.a>
  )
}

function PlatformRail({ active }: { active: boolean }) {
  const reduced = useReducedMotion()
  const platform = usePlatform()

  // Always show a static footnote for reduced-motion / non-hover devices;
  // animate the richer rail when the group is hovered.
  if (reduced) {
    return (
      <p style={footnoteStyle}>
        macOS · Windows · Linux · Free forever
      </p>
    )
  }

  return (
    <div
      style={{
        position: 'relative',
        minHeight: 22,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {active
          ? (
              <motion.div
                key="rail"
                initial={{ opacity: 0, y: 6, filter: 'blur(8px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -4, filter: 'blur(6px)' }}
                transition={{ duration: 0.32, ease: EASE }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                }}
              >
                {PLATFORM_CHIPS.map((chip, i) => {
                  const isCurrent = chip.id === platform
                  return (
                    <motion.a
                      key={chip.id}
                      href={RELEASES_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      initial={{ opacity: 0, y: 8, filter: 'blur(10px)' }}
                      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                      transition={{ duration: 0.35, delay: 0.04 * i, ease: EASE }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '3px 10px',
                        borderRadius: 999,
                        border: `1px solid ${isCurrent ? 'var(--border-strong)' : 'var(--border)'}`,
                        background: isCurrent ? 'var(--fill-hover)' : 'var(--fill)',
                        color: isCurrent ? 'var(--text)' : 'var(--text-muted)',
                        fontSize: 11,
                        fontWeight: 500,
                        textDecoration: 'none',
                        letterSpacing: '0.01em',
                      }}
                      whileHover={{
                        color: 'var(--text)',
                        borderColor: 'var(--border-strong)',
                        background: 'var(--fill-hover)',
                        scale: 1.04,
                      }}
                    >
                      {isCurrent && (
                        <span
                          aria-hidden
                          style={{
                            width: 4,
                            height: 4,
                            borderRadius: '50%',
                            background: 'var(--text)',
                            boxShadow: '0 0 6px rgba(255, 233, 194, 0.7)',
                          }}
                        />
                      )}
                      {chip.label}
                    </motion.a>
                  )
                })}
                <motion.span
                  initial={{ opacity: 0, filter: 'blur(8px)' }}
                  animate={{ opacity: 1, filter: 'blur(0px)' }}
                  transition={{ duration: 0.35, delay: 0.16, ease: EASE }}
                  style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}
                >
                  Free forever
                </motion.span>
              </motion.div>
            )
          : (
              <motion.p
                key="footnote"
                initial={{ opacity: 0, y: 4, filter: 'blur(6px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -4, filter: 'blur(6px)' }}
                transition={{ duration: 0.28, ease: EASE }}
                style={footnoteStyle}
              >
                macOS · Windows · Linux · Free forever
              </motion.p>
            )}
      </AnimatePresence>
    </div>
  )
}

const primaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '11px 22px',
  background: 'var(--text)',
  color: 'var(--bg)',
  fontWeight: 600,
  fontSize: 13,
  textDecoration: 'none',
  borderRadius: 8,
}

const ghostButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '11px 22px',
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border)',
  fontWeight: 500,
  fontSize: 13,
  textDecoration: 'none',
  borderRadius: 8,
}

const footnoteStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: 'var(--text-muted)',
  textAlign: 'center',
}
