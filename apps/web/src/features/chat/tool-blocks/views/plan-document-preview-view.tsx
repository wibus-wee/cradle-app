import { StaticRender } from '@cradle/streamdown'
import {
  FullscreenLine as Maximize2Icon,
  LayoutTopLine as PanelTopIcon,
} from '@mingcute/react'
import type { KeyboardEvent, MouseEvent } from 'react'

import { Button } from '~/components/ui/button'

export interface PlanDocumentOpenInput {
  toolCallId: string
  text: string
}

export interface PlanDocumentPreviewViewProps {
  toolCallId: string
  text: string
  onOpen?: (input: PlanDocumentOpenInput) => void
}

/** Props-only plan preview. Runtime panel ownership is supplied through onOpen. */
export function PlanDocumentPreviewView({
  toolCallId,
  text,
  onOpen,
}: PlanDocumentPreviewViewProps) {
  const openPlan = () => onOpen?.({ toolCallId, text })

  const handlePreviewClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null
    if (target?.closest('a, button')) {
      return
    }
    openPlan()
  }

  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openPlan()
    }
  }

  return (
    <div
      className="group/plan relative overflow-hidden rounded-md border border-border/70 bg-background/85 shadow-xs transition-[border-color,box-shadow] duration-150 hover:border-border hover:shadow-sm"
      data-testid="chat-plan-document"
      role="button"
      tabIndex={0}
      aria-label="Open plan document"
      onClick={handlePreviewClick}
      onKeyDown={handlePreviewKeyDown}
    >
      <div className="flex h-8 items-center justify-between border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <PanelTopIcon className="size-3.5 shrink-0 !text-muted-foreground/60" aria-hidden="true" />
          <span className="min-w-0 truncate text-xs font-medium text-foreground/80">
            Plan document
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 shrink-0 text-muted-foreground/70 opacity-70 transition-[opacity,scale] duration-150 hover:text-foreground group-hover/plan:opacity-100 active:scale-[0.96]"
          aria-label="Open plan document in panel"
          onClick={openPlan}
        >
          <Maximize2Icon className="size-3" aria-hidden="true" />
        </Button>
      </div>
      <div
        className="streamdown-root max-h-64 overflow-y-auto px-3 py-3 text-xs leading-relaxed"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent, black 18px, black calc(100% - 24px), transparent)',
        }}
      >
        <StaticRender content={text} />
      </div>
    </div>
  )
}
