import {
  ExternalLinkLine as ExternalLinkIcon,
  InformationLine as InfoIcon,
} from '@mingcute/react'
import { AnimatePresence, m, useReducedMotion } from 'motion/react'
import { useEffect, useId, useRef, useState } from 'react'

import { ProviderIcon } from '~/components/common/provider-icons'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

import type { BackgroundActivityFooterItem } from './background-activity-footer-state'

function BackgroundActivityIcon({ ownerNamespace }: { ownerNamespace: string }) {
  if (ownerNamespace === 'codex-reset-watch') {
    return <ProviderIcon iconSlug="codex" presetId={null} className="size-4" />
  }

  return <InfoIcon className="size-4" aria-hidden="true" />
}

export interface BackgroundActivityFooterViewLabels {
  title: string
  open: string
}

export interface BackgroundActivityFooterViewProps {
  items: readonly BackgroundActivityFooterItem[]
  labels: BackgroundActivityFooterViewLabels
  onOpenAction: (url: string) => void
}

export function BackgroundActivityFooterView({
  items,
  labels,
  onOpenAction,
}: BackgroundActivityFooterViewProps) {
  const [open, setOpen] = useState(false)
  const shouldReduceMotion = useReducedMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const current = items[0] ?? null

  useEffect(() => {
    if (!open) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }

    window.addEventListener('pointerdown', handlePointerDown, { capture: true })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  if (!current) {
    return null
  }

  return (
    <div
      ref={rootRef}
      className="relative z-40 flex h-full min-w-0 max-w-[min(32rem,55vw)] shrink items-center px-1"
      data-testid="background-activity-footer"
    >
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          'relative flex h-6 min-w-0 items-center gap-1.5 rounded-full py-0.5 pl-2 pr-1.5 text-left text-[11px] text-[var(--text-secondary)] shadow-[var(--shadow-xs)] transition-[background-color,color,scale] duration-150 active:scale-[0.96]',
          {
            'bg-sidebar-fill text-[var(--text-primary)]': open,
            'bg-foreground/[0.035] hover:bg-sidebar-fill hover:text-[var(--text-primary)]': !open,
          },
        )}
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={labels.open}
        data-testid="background-activity-footer-trigger"
        onClick={() => setOpen(value => !value)}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <m.span
            key={current.identity}
            className="flex min-w-0 items-center gap-1.5"
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: -5, filter: 'blur(3px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: -3, filter: 'blur(2px)' }}
            transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 600, damping: 40 }}
          >
            <InfoIcon className="size-3.5 shrink-0 text-info" aria-hidden="true" />
            <span className="min-w-0 truncate font-medium text-[var(--text-primary)]">
              {current.title}
            </span>
            {current.description && (
              <>
                <span aria-hidden="true" className="shrink-0 text-[var(--text-dim)]">·</span>
                <span className="min-w-0 truncate">{current.description}</span>
              </>
            )}
            {items.length > 1 && (
              <span className="shrink-0 rounded-full bg-sidebar-fill px-1.5 font-mono text-[9px] tabular-nums text-[var(--text-tertiary)]">
                {`+${items.length - 1}`}
              </span>
            )}
          </m.span>
        </AnimatePresence>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <m.section
            id={panelId}
            role="region"
            aria-label={labels.title}
            data-testid="background-activity-footer-panel"
            className="absolute bottom-[calc(100%+0.625rem)] left-1 z-40 w-[min(22rem,calc(100vw-1rem))] origin-bottom-left overflow-hidden rounded-xl bg-sidebar/80 text-sidebar-foreground shadow-[var(--shadow-sm)] backdrop-blur-2xl backdrop-saturate-150"
            initial={shouldReduceMotion
              ? { opacity: 0 }
              : { opacity: 0, y: 10, scale: 0.985, filter: 'blur(7px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={shouldReduceMotion
              ? { opacity: 0 }
              : { opacity: 0, y: 5, scale: 0.99, filter: 'blur(3px)' }}
            transition={shouldReduceMotion
              ? { duration: 0 }
              : { type: 'spring', stiffness: 600, damping: 40, mass: 0.8 }}
          >
            <m.ul
              className="max-h-64 overflow-y-auto p-1"
              initial="hidden"
              animate="visible"
              variants={{
                hidden: {},
                visible: { transition: { staggerChildren: 0.035, delayChildren: 0.03 } },
              }}
            >
              {items.map(item => (
                <m.li
                  key={item.identity}
                  className="rounded-lg px-2.5 py-2"
                  data-testid="background-activity-footer-item"
                  variants={{
                    hidden: shouldReduceMotion
                      ? { opacity: 0 }
                      : { opacity: 0, y: 5, filter: 'blur(2px)' },
                    visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
                  }}
                  transition={shouldReduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 600, damping: 40 }}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-[var(--text-tertiary)]"
                      data-background-activity-icon={item.ownerNamespace === 'codex-reset-watch' ? 'codex' : 'info'}
                      aria-hidden="true"
                    >
                      <BackgroundActivityIcon ownerNamespace={item.ownerNamespace} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[var(--text-primary)]">{item.title}</p>
                      {item.description && (
                        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                          {item.description}
                        </p>
                      )}
                    </div>
                    {item.actionUrl && item.actionLabel && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="-mr-1 shrink-0 self-center"
                        onClick={() => item.actionUrl && onOpenAction(item.actionUrl)}
                      >
                        {item.actionLabel}
                        <ExternalLinkIcon className="size-3" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </m.li>
              ))}
            </m.ul>
          </m.section>
        )}
      </AnimatePresence>
    </div>
  )
}
