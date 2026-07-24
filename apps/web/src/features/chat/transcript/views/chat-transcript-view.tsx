import { AlertLine as AlertCircleIcon } from '@mingcute/react'
import { m } from 'motion/react'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { useRef } from 'react'
import type { VirtualizerHandle } from 'virtua'
import { Virtualizer } from 'virtua'

import { cn } from '~/lib/cn'
import type { PublicStatus } from '~/store/chat/types'

export interface ChatTranscriptViewProps<Message> {
  messages: Message[]
  renderMessage: (message: Message) => ReactElement
  status: PublicStatus
  error?: string | null
  isReady: boolean
  emptyLabel: string
  errorFallbackLabel: string
  viewportRef?: RefObject<HTMLDivElement | null>
  virtualizerRef?: RefObject<VirtualizerHandle | null>
  keepMountedIndices?: number[]
  onVirtualScroll?: (offset: number) => void
  compactInset?: boolean
  historyControl?: ReactNode
}

/** Props-only transcript surface shared by the runtime adapter and preview fixtures. */
export function ChatTranscriptView<Message>({
  messages,
  renderMessage,
  status,
  error,
  isReady,
  emptyLabel,
  errorFallbackLabel,
  viewportRef,
  virtualizerRef,
  keepMountedIndices,
  onVirtualScroll,
  compactInset,
  historyControl,
}: ChatTranscriptViewProps<Message>) {
  const localViewportRef = useRef<HTMLDivElement>(null)
  const resolvedViewportRef = viewportRef ?? localViewportRef

  return (
    <div
      ref={resolvedViewportRef}
      data-testid="chat-transcript-view"
      className="h-full overflow-x-hidden overflow-y-auto outline-none [scrollbar-gutter:stable]"
    >
      <div
        className={cn(
          'mx-auto flex min-h-full flex-col pt-4',
          compactInset ? 'px-4' : 'max-w-[90%] px-4 pr-12',
        )}
        style={{ paddingBottom: 'var(--chat-composer-inset, 0px)' }}
      >
        <div className="flex-1">
          {historyControl
            ? <div className="flex justify-center pb-3">{historyControl}</div>
            : null}
          {messages.length === 0 && isReady
            ? (
                <div className="flex h-full items-center justify-center py-32">
                  <p className="select-none text-sm text-muted-foreground">{emptyLabel}</p>
                </div>
              )
            : null}

          <Virtualizer
            ref={virtualizerRef}
            data={messages}
            scrollRef={resolvedViewportRef}
            startMargin={24}
            keepMounted={keepMountedIndices}
            onScroll={onVirtualScroll}
          >
            {renderMessage}
          </Virtualizer>

          {status === 'error'
            ? (
                <m.div
                  data-testid="chat-error-banner"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
                  className="flex items-start gap-2 pl-1 pt-4"
                >
                  <AlertCircleIcon
                    className="size-3.5 shrink-0 !text-destructive/70"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 break-all text-xs text-destructive/70">
                    {error ?? errorFallbackLabel}
                  </span>
                </m.div>
              )
            : null}
        </div>
      </div>
    </div>
  )
}
