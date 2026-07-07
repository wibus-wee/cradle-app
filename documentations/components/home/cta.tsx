'use client'

import { ArrowRightLine as ArrowRight, Book2Line as BookOpen } from '@mingcute/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Link from 'next/link'
import { useEffect, useRef } from 'react'

gsap.registerPlugin(ScrollTrigger)

export function CTA() {
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!sectionRef.current) { return }

    const ctx = gsap.context(() => {
      const children = sectionRef.current!.querySelectorAll('.cta-child')
      gsap.fromTo(
        children,
        { opacity: 0, y: 24 },
        {
          opacity: 1,
          y: 0,
          duration: 0.6,
          stagger: 0.1,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 85%',
            once: true,
          },
        },
      )
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  return (
    <section ref={sectionRef} className="relative py-32">
      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        <div className="flex flex-col items-center text-center">
          <h2 className="cta-child mb-4 text-3xl font-semibold tracking-tight text-fd-foreground sm:text-4xl">
            Start building with agents
          </h2>
          <p className="cta-child mb-10 max-w-md text-base leading-7 text-fd-muted-foreground">
            Free forever, local-first, and ready to extend. Install Cradle and
            ship faster today.
          </p>
          <div className="cta-child flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/docs/getting-started/overview"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-fd-primary px-6 text-sm font-medium text-fd-primary-foreground transition-all duration-150 hover:bg-fd-primary/90 active:scale-[0.97]"
            >
              <BookOpen className="size-4" />
              Read the docs
            </Link>
            <a
              href="https://github.com/wibus-wee/Cradle"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-fd-border px-6 text-sm font-medium text-fd-foreground transition-all duration-150 hover:bg-fd-muted active:scale-[0.97]"
            >
              GitHub
              <ArrowRight className="size-3.5" />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
