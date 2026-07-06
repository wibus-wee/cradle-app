'use client'

import {
  BrainLine as Brain,
  FlashLine as Zap,
  GitBranchLine as GitBranch,
  Message1Line as MessageSquare,
  PluginLine as Plug,
  ProcessLine as Workflow,
  RobotLine as Bot,
  TerminalLine as Terminal,
} from '@mingcute/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useEffect, useRef } from 'react'

gsap.registerPlugin(ScrollTrigger)

const features = [
  {
    title: 'Chat with agents',
    description:
      'Multi-turn conversations with tool use, file access, and streaming responses. Agents see your full workspace context.',
    icon: MessageSquare,
    tone: 'violet' as const,
    span: 'col-span-2 row-span-1',
  },
  {
    title: 'Issue delegation',
    description:
      'Assign Kanban issues to agents. They read context, plan, and execute — then report back.',
    icon: Bot,
    tone: 'blue' as const,
    span: 'col-span-1 row-span-1',
  },
  {
    title: 'Automation',
    description:
      'Schedule recurring agent tasks, CI hooks, and event-driven workflows.',
    icon: Workflow,
    tone: 'amber' as const,
    span: 'col-span-1 row-span-1',
  },
  {
    title: 'Chronicle memory',
    description:
      'Capture local context, OCR, snapshots. Agents recall what happened across sessions.',
    icon: Brain,
    tone: 'rose' as const,
    span: 'col-span-1 row-span-1',
  },
  {
    title: 'Git-native',
    description:
      'Full Git integration. Branches, diffs, commits — agents work with your actual repo, not a sandbox.',
    icon: GitBranch,
    tone: 'emerald' as const,
    span: 'col-span-1 row-span-1',
  },
  {
    title: 'Plugin ecosystem',
    description:
      'Extend with MCP tools, server routes, web panels, and desktop hooks. Install from the marketplace.',
    icon: Plug,
    tone: 'cyan' as const,
    span: 'col-span-2 row-span-1',
  },
  {
    title: 'Multi-provider',
    description:
      'Claude, GPT, Gemini, local models. Switch providers per agent, per task.',
    icon: Zap,
    tone: 'violet' as const,
    span: 'col-span-1 row-span-1',
  },
  {
    title: 'CLI-first',
    description:
      'Every operation has a CLI equivalent. Script it, automate it, pipe it.',
    icon: Terminal,
    tone: 'amber' as const,
    span: 'col-span-1 row-span-1',
  },
]

const toneStyles = {
  violet: {
    badge: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    glow: 'group-hover:shadow-violet-500/[0.06]',
  },
  blue: {
    badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    glow: 'group-hover:shadow-blue-500/[0.06]',
  },
  amber: {
    badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    glow: 'group-hover:shadow-amber-500/[0.06]',
  },
  rose: {
    badge: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    glow: 'group-hover:shadow-rose-500/[0.06]',
  },
  emerald: {
    badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    glow: 'group-hover:shadow-emerald-500/[0.06]',
  },
  cyan: {
    badge: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
    glow: 'group-hover:shadow-cyan-500/[0.06]',
  },
}

export function BentoFeatures() {
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

      const cards = sectionRef.current!.querySelectorAll('.bento-card')
      gsap.fromTo(
        cards,
        { opacity: 0, y: 24 },
        {
          opacity: 1,
          y: 0,
          duration: 0.5,
          stagger: 0.07,
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
        <div ref={headingRef} className="mb-12">
          <p className="mb-2 font-mono text-xs font-medium tracking-wider text-fd-muted-foreground">
            CAPABILITIES
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-fd-foreground sm:text-3xl">
            Everything you need, nothing you don't
          </h2>
        </div>

        <div className="grid auto-rows-[160px] gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => {
            const Icon = feature.icon
            const tones = toneStyles[feature.tone]
            return (
              <div
                key={feature.title}
                className={`bento-card group relative flex flex-col justify-between rounded-xl border border-fd-border/50 bg-fd-card p-5 opacity-0 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${tones.glow} ${feature.span}`}
              >
                <span
                  className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg ${tones.badge}`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-sm font-medium text-fd-foreground">
                    {feature.title}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-fd-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
