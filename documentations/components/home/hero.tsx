'use client'

import { ArrowRightLine as ArrowRight, Book2Line as BookOpen } from '@mingcute/react'
import gsap from 'gsap'
import Link from 'next/link'
import { useEffect, useRef } from 'react'

const terminalLines = [
  { type: 'prompt', text: 'cradle init my-workspace' },
  { type: 'output', text: '' },
  { type: 'output', text: '  Creating workspace "my-workspace"...' },
  { type: 'output', text: '  Initializing git repository' },
  { type: 'output', text: '  Configuring agent runtime' },
  { type: 'success', text: '  Workspace ready' },
  { type: 'output', text: '' },
  { type: 'prompt', text: 'cradle agent add architect' },
  { type: 'output', text: '' },
  { type: 'output', text: '  Provider: anthropic' },
  { type: 'output', text: '  Model: claude-sonnet-4-6' },
  { type: 'output', text: '  Skills: review, plan, refactor' },
  { type: 'success', text: '  Agent "architect" configured' },
  { type: 'output', text: '' },
  { type: 'prompt', text: 'cradle chat "refactor auth module"' },
  { type: 'output', text: '' },
  { type: 'thinking', text: '  Thinking...' },
  { type: 'output', text: '  Analyzing src/auth/ (12 files)' },
  { type: 'output', text: '  Creating refactor plan' },
  { type: 'output', text: '  3 files modified, 0 breaking changes' },
  { type: 'success', text: '  Done in 4.2s' },
]

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const descRef = useRef<HTMLParagraphElement>(null)
  const buttonsRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<HTMLDivElement>(null)
  const terminalBodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sectionRef.current) { return }

    const ctx = gsap.context(() => {
      // Heading word-by-word reveal
      if (headingRef.current) {
        const words = headingRef.current.querySelectorAll('.word')
        gsap.fromTo(
          words,
          { opacity: 0, y: 20, filter: 'blur(4px)' },
          {
            opacity: 1,
            y: 0,
            filter: 'blur(0px)',
            duration: 0.6,
            stagger: 0.05,
            ease: 'power3.out',
          },
        )
      }

      // Description
      if (descRef.current) {
        gsap.fromTo(
          descRef.current,
          { opacity: 0, y: 16 },
          { opacity: 1, y: 0, duration: 0.6, delay: 0.4, ease: 'power2.out' },
        )
      }

      // Buttons
      if (buttonsRef.current) {
        const btns = buttonsRef.current.querySelectorAll('a')
        gsap.fromTo(
          btns,
          { opacity: 0, y: 12 },
          {
            opacity: 1,
            y: 0,
            duration: 0.5,
            stagger: 0.1,
            delay: 0.6,
            ease: 'power2.out',
          },
        )
      }

      // Terminal entrance
      if (terminalRef.current) {
        gsap.fromTo(
          terminalRef.current,
          { opacity: 0, x: 40, scale: 0.96 },
          {
            opacity: 1,
            x: 0,
            scale: 1,
            duration: 0.8,
            delay: 0.2,
            ease: 'power3.out',
          },
        )
      }

      // Terminal lines type in sequentially
      if (terminalBodyRef.current) {
        const lines = terminalBodyRef.current.querySelectorAll('.t-line')
        gsap.fromTo(
          lines,
          { opacity: 0 },
          {
            opacity: 1,
            duration: 0.08,
            stagger: 0.12,
            delay: 0.6,
            ease: 'none',
          },
        )
      }
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  const titleWords = 'The AI agent platform for developers'.split(' ')

  return (
    <section
      ref={sectionRef}
      className="relative flex min-h-[90vh] items-center overflow-hidden"
    >
      {/* Subtle dot grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03] dark:opacity-[0.05]"
        style={{
          backgroundImage:
            'radial-gradient(circle, currentColor 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="relative mx-auto w-full max-w-6xl px-6 py-20 lg:px-8">
        <div className="grid items-center gap-16 lg:grid-cols-[1fr_1.2fr]">
          {/* Left: Text */}
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-fd-border/60 bg-fd-muted/50 px-3 py-1">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              <span className="text-xs font-medium text-fd-muted-foreground">
                Free forever &middot; Local-first
              </span>
            </div>

            <h1
              ref={headingRef}
              className="mb-6 text-4xl font-semibold leading-[1.1] tracking-tight text-fd-foreground sm:text-5xl lg:text-[3.5rem]"
            >
              {titleWords.map((word, i) => (
                <span key={i} className="word inline-block">
                  {word}
                  {i < titleWords.length - 1 ? ' ' : ''}
                </span>
              ))}
            </h1>

            <p
              ref={descRef}
              className="mb-10 max-w-md text-base leading-7 text-fd-muted-foreground sm:text-lg"
            >
              Chat, automate, delegate issues, and extend with plugins.
              Everything runs on your machine.
            </p>

            <div ref={buttonsRef} className="flex flex-wrap gap-3">
              <Link
                href="/docs/getting-started/overview"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-fd-primary px-6 text-sm font-medium text-fd-primary-foreground transition-all duration-150 hover:bg-fd-primary/90 active:scale-[0.97]"
              >
                <BookOpen className="size-4" />
                Get started
              </Link>
              <a
                href="https://github.com/wibus-wee/Cradle"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-fd-border px-6 text-sm font-medium text-fd-foreground transition-all duration-150 hover:bg-fd-muted active:scale-[0.97]"
              >
                Star on GitHub
                <ArrowRight className="size-3.5" />
              </a>
            </div>
          </div>

          {/* Right: Terminal */}
          <div ref={terminalRef} className="opacity-0">
            <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#0a0a0a] shadow-2xl dark:border-white/[0.08]">
              {/* Title bar */}
              <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
                <div className="size-3 rounded-full bg-[#ff5f57]" />
                <div className="size-3 rounded-full bg-[#febc2e]" />
                <div className="size-3 rounded-full bg-[#28c840]" />
                <span className="ml-3 font-mono text-[11px] text-white/30">
                  zsh — cradle
                </span>
              </div>

              {/* Terminal body */}
              <div
                ref={terminalBodyRef}
                className="max-h-[420px] overflow-hidden p-4 font-mono text-[12px] leading-[1.7]"
              >
                {terminalLines.map((line, i) => (
                  <div key={i} className="t-line opacity-0">
                    {line.type === 'prompt' && (
                      <span>
                        <span className="text-emerald-400">❯</span>
{' '}
                        <span className="text-white/90">{line.text}</span>
                      </span>
                    )}
                    {line.type === 'output' && (
                      <span className="text-white/40">{line.text}</span>
                    )}
                    {line.type === 'success' && (
                      <span className="text-emerald-400">{line.text}</span>
                    )}
                    {line.type === 'thinking' && (
                      <span className="text-violet-400">{line.text}</span>
                    )}
                  </div>
                ))}
                {/* Cursor */}
                <div className="t-line opacity-0">
                  <span className="text-emerald-400">❯</span>
{' '}
                  <span className="inline-block h-[14px] w-[7px] animate-pulse bg-white/70" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
