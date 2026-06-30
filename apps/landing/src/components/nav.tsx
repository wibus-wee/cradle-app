/**
 * Nav — minimal fixed header
 */

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { DownloadLine as Download } from '@mingcute/react'
import { useEffect, useRef, useState } from 'react'
import { ThemeToggle } from './blueprint-annotations'

gsap.registerPlugin(useGSAP)

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useGSAP(() => {
    gsap.from(navRef.current, { y: -10, opacity: 0, duration: 0.5, delay: 0.2, ease: 'power2.out' })
  }, { scope: navRef })

  return (
    <nav
      ref={navRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        transition: 'background 0.25s, border-color 0.25s',
        background: scrolled ? 'var(--nav-bg)' : 'transparent',
        backdropFilter: scrolled ? 'blur(12px)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(12px)' : 'none',
        borderBottom: scrolled ? '1px solid var(--border)' : '1px solid transparent',
      }}
    >
      <div style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '0 24px',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
      >
        {/* Logo */}
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <img
            src="/icon-64.webp"
            alt="Cradle"
            width={24}
            height={24}
            decoding="async"
            style={{ borderRadius: 6 }}
          />
          <span style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text)',
            letterSpacing: '-0.02em',
          }}
          >
            Cradle
          </span>
        </a>

        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ThemeToggle />
          <a
            href="https://github.com/wibus-wee/cradle-app/releases"
            target='_block'
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
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = 'var(--fill-hover)'
              ;(e.currentTarget as HTMLAnchorElement).style.color = 'var(--text)'
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-secondary)'
            }}
          >
            <Download style={{ width: 13, height: 13 }} />
            Download
          </a>
        </div>
      </div>
    </nav>
  )
}
