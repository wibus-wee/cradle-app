import {
  CheckLine as CheckIcon,
  ExternalLinkLine as ExternalLinkIcon,
  InformationLine as InfoIcon,
} from '@mingcute/react'
import { AnimatePresence, m } from 'motion/react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'

import type { BackgroundActivityFooterItem } from './background-activity-footer-state'

export interface BackgroundActivityFooterViewLabels {
  title: string
  open: string
  dismiss: string
  dismissAll: string
  noticeCount: (count: number) => string
}

export interface BackgroundActivityFooterViewProps {
  items: readonly BackgroundActivityFooterItem[]
  labels: BackgroundActivityFooterViewLabels
  onDismiss: (identity: string) => void
  onDismissAll: (identities: readonly string[]) => void
  onOpenAction: (url: string) => void
}

export function BackgroundActivityFooterView({
  items,
  labels,
  onDismiss,
  onDismissAll,
  onOpenAction,
}: BackgroundActivityFooterViewProps) {
  const [open, setOpen] = useState(false)
  const current = items[0] ?? null

  if (!current) {
    return null
  }

  const dismissAll = () => {
    onDismissAll(items.map(item => item.identity))
    setOpen(false)
  }

  return (
    <div
      className="flex h-full min-w-0 max-w-[min(32rem,55vw)] shrink items-center px-1"
      data-testid="background-activity-footer"
    >
      <AnimatePresence initial={false} mode="popLayout">
        <m.div
          key={current.identity}
          className="flex min-w-0 items-center text-[11px] text-muted-foreground"
          initial={{ opacity: 0, x: -6, filter: 'blur(3px)' }}
          animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, x: -4, filter: 'blur(2px)' }}
          transition={{ duration: 0.16 }}
        >
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-foreground/[0.045] py-0.5 pl-2 pr-1.5 text-left ring-1 ring-foreground/[0.055] transition-colors hover:bg-foreground/[0.075] hover:text-foreground"
                aria-label={labels.open}
                data-testid="background-activity-footer-trigger"
              >
                <InfoIcon className="size-3.5 shrink-0 text-info" aria-hidden="true" />
                <span className="min-w-0 truncate font-medium text-foreground/75">
                  {current.title}
                </span>
                {current.description && (
                  <>
                    <span aria-hidden="true" className="shrink-0 text-muted-foreground/50">·</span>
                    <span className="min-w-0 truncate">{current.description}</span>
                  </>
                )}
                {items.length > 1 && (
                  <span className="shrink-0 rounded-full bg-foreground/[0.07] px-1.5 font-mono text-[9px] tabular-nums text-foreground/60">
                    {`+${items.length - 1}`}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              sideOffset={7}
              className="w-[min(24rem,calc(100vw-1rem))] gap-0 overflow-hidden p-0"
            >
              <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">{labels.title}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {labels.noticeCount(items.length)}
                  </p>
                </div>
                {items.length > 1 && (
                  <Button type="button" variant="ghost" size="xs" onClick={dismissAll}>
                    {labels.dismissAll}
                  </Button>
                )}
              </div>
              <ul className="max-h-80 overflow-y-auto">
                {items.map(item => (
                  <li
                    key={item.identity}
                    className="border-b border-border/50 px-3 py-3 last:border-b-0"
                    data-testid="background-activity-footer-item"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-info/10 text-info">
                        <InfoIcon className="size-3.5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground">{item.title}</p>
                        {item.description && (
                          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                            {item.description}
                          </p>
                        )}
                        <div className="mt-2 flex items-center justify-end gap-1">
                          {item.actionUrl && item.actionLabel && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => item.actionUrl && onOpenAction(item.actionUrl)}
                            >
                              {item.actionLabel}
                              <ExternalLinkIcon className="size-3" aria-hidden="true" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => onDismiss(item.identity)}
                          >
                            <CheckIcon className="size-3" aria-hidden="true" />
                            {labels.dismiss}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        </m.div>
      </AnimatePresence>
    </div>
  )
}
