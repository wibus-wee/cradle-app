'use client'

import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useEffect, useRef } from 'react'

gsap.registerPlugin(ScrollTrigger)

export function ProductShowcase() {
  const sectionRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLDivElement>(null)
  const mockupRef = useRef<HTMLDivElement>(null)

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

      if (mockupRef.current) {
        gsap.fromTo(
          mockupRef.current,
          { opacity: 0, y: 40, scale: 0.98 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.8,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: mockupRef.current,
              start: 'top 85%',
              once: true,
            },
          },
        )
      }
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  return (
    <section ref={sectionRef} className="relative py-24">
      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        <div ref={headingRef} className="mb-16 text-center">
          <p className="mb-2 font-mono text-xs font-medium tracking-wider text-fd-muted-foreground">
            PRODUCT
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-fd-foreground sm:text-3xl">
            One surface, every workflow
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-fd-muted-foreground">
            Chat, Kanban, agents, and automation — all in a single desktop
            workspace. No context switching.
          </p>
        </div>

        {/* UI Mockup */}
        <div ref={mockupRef} className="opacity-0">
          <div className="overflow-hidden rounded-xl border border-fd-border/50 bg-fd-card shadow-lg">
            {/* Window chrome */}
            <div className="flex h-10 items-center gap-2 border-b border-fd-border/50 bg-fd-muted/30 px-4">
              <div className="size-3 rounded-full bg-[#ff5f57]" />
              <div className="size-3 rounded-full bg-[#febc2e]" />
              <div className="size-3 rounded-full bg-[#28c840]" />
              <span className="ml-4 text-xs text-fd-muted-foreground">
                Cradle — my-workspace
              </span>
            </div>

            {/* App layout simulation */}
            <div className="flex min-h-[400px]">
              {/* Sidebar */}
              <div className="hidden w-56 shrink-0 border-r border-fd-border/30 bg-fd-muted/20 p-3 sm:block">
                <div className="mb-4 flex items-center gap-2 px-2">
                  <div className="size-6 rounded-md bg-violet-500/15" />
                  <span className="text-xs font-medium text-fd-foreground">
                    my-workspace
                  </span>
                </div>

                {[
                  { label: 'Chat', active: true, count: '3' },
                  { label: 'Kanban', active: false, count: '12' },
                  { label: 'Agents', active: false, count: '4' },
                  { label: 'Automation', active: false, count: '' },
                  { label: 'Chronicle', active: false, count: '' },
                  { label: 'Files', active: false, count: '' },
                ].map(item => (
                  <div
                    key={item.label}
                    className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs ${
                      item.active
                        ? 'bg-fd-muted font-medium text-fd-foreground'
                        : 'text-fd-muted-foreground'
                    }`}
                  >
                    <span>{item.label}</span>
                    {item.count && (
                      <span className="tabular-nums text-[10px] text-fd-muted-foreground">
                        {item.count}
                      </span>
                    )}
                  </div>
                ))}

                <div className="my-3 h-px bg-fd-border/30" />

                {['Providers', 'Settings'].map(label => (
                  <div
                    key={label}
                    className="rounded-md px-2.5 py-1.5 text-xs text-fd-muted-foreground"
                  >
                    {label}
                  </div>
                ))}
              </div>

              {/* Main content area */}
              <div className="flex flex-1 flex-col">
                {/* Chat messages */}
                <div className="flex-1 space-y-4 p-5">
                  {/* User message */}
                  <div className="flex justify-end">
                    <div className="max-w-[70%] rounded-lg rounded-br-sm bg-fd-muted px-3.5 py-2.5 text-sm text-fd-foreground">
                      Refactor the auth module to use JWT with refresh tokens
                    </div>
                  </div>

                  {/* Assistant message */}
                  <div className="flex justify-start">
                    <div className="max-w-[80%] space-y-3 px-1">
                      <p className="text-sm leading-6 text-fd-foreground">
                        I'll analyze the current auth module and create a
                        refactoring plan. Let me start by examining the existing
                        code.
                      </p>

                      {/* Tool call block */}
                      <div className="rounded-md border border-fd-border/40 bg-fd-muted/30 px-3 py-2">
                        <div className="flex items-center gap-2 text-xs text-fd-muted-foreground">
                          <div className="size-1.5 animate-pulse rounded-full bg-violet-500" />
                          <span className="font-mono">read_files</span>
                          <span className="text-fd-muted-foreground/60">
                            &middot; 3 files
                          </span>
                        </div>
                      </div>

                      <p className="text-sm leading-6 text-fd-foreground">
                        I found the current session-based auth in
{' '}
                        <code className="rounded bg-fd-muted px-1 py-0.5 font-mono text-xs">
                          src/auth/
                        </code>
                        . Here's the refactoring plan:
                      </p>

                      {/* Todo list */}
                      <div className="space-y-1.5 rounded-md border border-fd-border/40 bg-fd-muted/20 p-3">
                        {[
                          { done: true, text: 'Create JWT token service' },
                          { done: true, text: 'Add refresh token rotation' },
                          { done: false, text: 'Update middleware chain' },
                          { done: false, text: 'Migrate existing sessions' },
                        ].map((item, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-xs"
                          >
                            <div
                              className={`size-3.5 rounded border ${
                                item.done
                                  ? 'border-emerald-500/50 bg-emerald-500/20'
                                  : 'border-fd-border'
                              }`}
                            />
                            <span
                              className={
                                item.done
                                  ? 'text-fd-muted-foreground line-through'
                                  : 'text-fd-foreground'
                              }
                            >
                              {item.text}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Composer bar */}
                <div className="border-t border-fd-border/30 p-3">
                  <div className="flex items-center gap-3 rounded-lg border border-fd-border/40 bg-fd-background px-4 py-2.5">
                    <span className="flex-1 text-sm text-fd-muted-foreground">
                      Continue with the refactoring...
                    </span>
                    <div className="flex items-center gap-1.5 text-xs text-fd-muted-foreground">
                      <kbd className="rounded border border-fd-border/40 bg-fd-muted px-1.5 py-0.5 font-mono text-[10px]">
                        Enter
                      </kbd>
                      <span>to send</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
