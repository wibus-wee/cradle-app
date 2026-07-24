import {
  BookmarkLine as BookmarkIcon,
  BookmarksLine as MarkerIcon,
  CheckLine as CheckIcon,
  CopyLine as CopyIcon,
  PencilLine as PencilIcon,
} from '@mingcute/react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'

export interface MessageBubbleEditAction {
  busy: boolean
  disabled: boolean
  label: string
  title: string
  onEdit: () => void
}

export interface MessageBubbleActionsViewProps {
  hasPlainText: boolean
  isUser: boolean
  editAction?: MessageBubbleEditAction
  onCopy?: () => Promise<void> | void
  onPin?: () => Promise<void> | void
  onMarkSelection?: () => Promise<void> | void
  forceVisible?: boolean
}

/** Props-only message action bar. Runtime persistence and selection handling stay in its adapter. */
export function MessageBubbleActionsView({
  hasPlainText,
  isUser,
  editAction,
  onCopy,
  onPin,
  onMarkSelection,
  forceVisible = false,
}: MessageBubbleActionsViewProps) {
  const [copied, setCopied] = useState(false)
  const copyFeedbackTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
    }
  }, [])

  if (!hasPlainText && !editAction) {
    return null
  }

  const handleCopy = async () => {
    await onCopy?.()
    setCopied(true)
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
    }
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopied(false)
      copyFeedbackTimerRef.current = null
    }, 1500)
  }

  return (
    <div
      className={cn(
        'mt-1 flex items-center gap-0.5 opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 transition-[opacity,transform] duration-150',
        isUser && 'justify-end',
        forceVisible && 'opacity-100 translate-y-0',
      )}
    >
      {editAction && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={editAction.disabled}
          onClick={editAction.onEdit}
          className="text-muted-foreground/50 hover:text-foreground"
          title={editAction.title}
          aria-label={editAction.label}
          data-testid="chat-edit-previous-btn"
        >
          {editAction.busy
            ? <Spinner className="size-3.5" aria-hidden="true" />
            : <PencilIcon className="size-3.5" aria-hidden="true" />}
        </Button>
      )}
      {hasPlainText && onPin && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => void onPin()}
          className="text-muted-foreground/50 hover:text-foreground"
          aria-label="Pin message"
          title="Pin in environment"
        >
          <BookmarkIcon className="size-3.5" aria-hidden="true" />
        </Button>
      )}
      {hasPlainText && isUser && onMarkSelection && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => void onMarkSelection()}
          className="text-muted-foreground/50 hover:text-foreground"
          aria-label="Mark selected text"
          title="Mark selected text in environment"
        >
          <MarkerIcon className="size-3.5" aria-hidden="true" />
        </Button>
      )}
      {hasPlainText && onCopy && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => void handleCopy()}
          className="text-muted-foreground/50 hover:text-foreground"
          aria-label="Copy message"
        >
          {copied
            ? <CheckIcon className="size-3.5 !text-emerald-500" aria-hidden="true" />
            : <CopyIcon className="size-3.5" aria-hidden="true" />}
        </Button>
      )}
    </div>
  )
}
