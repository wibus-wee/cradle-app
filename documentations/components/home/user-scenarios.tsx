'use client'

import {
  BugLine as Bug,
  FileCodeLine as FileCode,
  GitPullRequestLine as GitPullRequest,
  LayersLine as Layers,
} from '@mingcute/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useEffect, useRef } from 'react'

gsap.registerPlugin(ScrollTrigger)

const scenarios = [
  {
    icon: FileCode,
    tone: 'violet' as const,
    title: 'Refactor a legacy module',
    before: '4 hours of reading code, planning, and manual edits',
    after: 'Agent analyzes the codebase, proposes a plan, and executes the refactor — you review the diff',
    time: '~15 min',
  },
  {
    icon: Bug,
    tone: 'rose' as const,
    title: 'Debug a production issue',
    before: 'Copy-pasting logs, searching Stack Overflow, trial and error',
    after: 'Agent reads logs, traces the error path, identifies the root cause, and patches the fix',
    time: '~5 min',
  },
  {
    icon: GitPullRequest,
    tone: 'emerald' as const,
    title: 'Write a PR from a ticket',
    before: 'Context switch to Jira, read requirements, write code, write description',
    after: 'Delegate the issue to an agent — it reads the ticket, implements, and opens the PR',
    time: '~10 min',
  },
  {
    icon: Layers,
    tone: 'blue' as const,
    title: 'Set up a new service',
    before: 'Boilerplate, config files, CI pipeline, Docker, docs — hours of setup',
    after: 'Agent scaffolds the service, configures CI, writes initial tests, and creates the README',
    time: '~20 min',
  },
]

const toneStyles = {
  violet: {
    badge: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
  rose: {
    badge: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  },
  emerald: {
    badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  blue: {
    badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
}

export function UserScenarios() {
  const sectionRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sectionRef.current) { return }

    const ctx = gsap.context(() => {
      if (headingRef.current) {
        gsap.fromTo(
          headingRef.current,
          { opacity: 0, y: 24 },
          {
            opacity: 1,
            y: 0,
            duration: 0.6,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: headingRef.current,
              start: 'top 85%',
              once: true,
            },
          },
        )
      }

      const cards = sectionRef.current!.querySelectorAll('.scenario-card')
      gsap.fromTo(
        cards,
        { opacity: 0, y: 32 },
        {
          opacity: 1,
          y: 0,
          duration: 0.5,
          stagger: 0.12,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: cards[0],
            start: 'top 85%',
            once: true,
          },
        },
      )
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  return (
    <section ref={sectionRef} className="relative py-24">
      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        <div ref={headingRef} className="mb-12 text-center">
          <p className="mb-2 font-mono text-xs font-medium tracking-wider text-fd-muted-foreground">
            USE CASES
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-fd-foreground sm:text-3xl">
            From hours to minutes
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-fd-muted-foreground">
            Real workflows that Cradle agents handle end-to-end.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {scenarios.map((scenario) => {
            const Icon = scenario.icon
            const tones = toneStyles[scenario.tone]
            return (
              <div
                key={scenario.title}
                className="scenario-card rounded-xl border border-fd-border/50 bg-fd-card p-6 opacity-0 shadow-sm transition-all duration-200 hover:shadow-md"
              >
                <div className="mb-4 flex items-center gap-3">
                  <span
                    className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg ${tones.badge}`}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <h3 className="text-sm font-medium text-fd-foreground">
                    {scenario.title}
                  </h3>
                </div>

                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 rounded bg-fd-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-fd-muted-foreground">
                      BEFORE
                    </span>
                    <p className="text-xs leading-5 text-fd-muted-foreground">
                      {scenario.before}
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                      AFTER
                    </span>
                    <p className="text-xs leading-5 text-fd-foreground">
                      {scenario.after}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <span className="font-mono text-lg font-semibold tabular-nums text-fd-foreground">
                    {scenario.time}
                  </span>
                  <span className="text-xs text-fd-muted-foreground">
                    with Cradle
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
