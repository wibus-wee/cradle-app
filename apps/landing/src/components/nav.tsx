/**
 * Nav — minimal fixed header.
 *
 * Transparent at the top, picks up a subtle frosted-glass treatment only once
 * scrolled (the one place backdrop-blur earns its keep). Dark-only; no theme
 * toggle.
 */

import { motion } from 'motion/react'
import { useEffect, useState } from 'react'

import { NavDownloadButton } from './download-cta'

export function Nav() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <motion.nav
      initial={{ y: -10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        height: 52,
        display: 'flex',
        alignItems: 'center',
        transition: 'background 0.25s, border-color 0.25s, backdrop-filter 0.25s',
        background: scrolled ? 'var(--nav-bg)' : 'transparent',
        backdropFilter: scrolled ? 'blur(12px)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(12px)' : 'none',
        borderBottom: scrolled ? '1px solid var(--border)' : '1px solid transparent',
      }}
    >
      <div
        style={{
          maxWidth: 1080,
          margin: '0 auto',
          padding: '0 24px',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <a
          href="/"
          style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
        >
          <img
            src="/icon-64.webp"
            alt="Cradle"
            width={24}
            height={24}
            decoding="async"
            style={{ borderRadius: 6 }}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text)',
              letterSpacing: '-0.02em',
            }}
          >
            Cradle
          </span>
        </a>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <NavLink href="#/blog">Blog</NavLink>
          <NavLink href="#/changelog">Changelog</NavLink>
        </div>

        <NavDownloadButton />
      </div>
    </motion.nav>
  )
}

function NavLink({ href, children }: { href: string, children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false)
  return (
    <a
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        fontSize: 13,
        fontWeight: 500,
        color: hovered ? 'var(--text)' : 'var(--text-secondary)',
        textDecoration: 'none',
        padding: '4px 10px',
        borderRadius: 6,
        background: hovered ? 'var(--fill-hover)' : 'transparent',
        transition: 'color 0.15s, background 0.15s',
      }}
    >
      {children}
    </a>
  )
}
