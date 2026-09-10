import {
  BroomLine as ClearIcon,
  Delete2Line as DeleteIcon,
} from '@mingcute/react'
import { formatDistanceToNow } from 'date-fns'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

import type { StorageManagerAction, StorageManagerCopy } from './storage-manager-view'
import type { StorageSession } from './storage-visuals'
import { formatBytes, getSessionTotalBytes, sessionPartVisuals } from './storage-visuals'

interface StorageSessionRowViewProps {
  session: StorageSession
  copy: StorageManagerCopy
  selected: boolean
  disabled: boolean
  onSelectedChange: (checked: boolean) => void
  onAction: (action: StorageManagerAction) => void
}

export function StorageSessionRowView({
  session,
  copy,
  selected,
  disabled,
  onSelectedChange,
  onAction,
}: StorageSessionRowViewProps) {
  const totalBytes = getSessionTotalBytes(session)
  const updatedLabel = formatDistanceToNow(session.updatedAt * 1000, { addSuffix: true })

  return (
    <div
      data-testid={`storage-session-${session.id}`}
      className={cn(
        'group grid grid-cols-[auto_1fr_auto_auto] items-start gap-x-3 px-3 py-3 transition-colors',
        'hover:bg-muted/40 focus-within:bg-muted/40',
      )}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={checked => onSelectedChange(Boolean(checked))}
        disabled={session.active || disabled}
        aria-label={session.title}
        className="mt-0.5"
      />

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-[13px] font-medium text-foreground">{session.title}</p>
          {session.active && (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px] text-success">
              {copy.active}
            </Badge>
          )}
          {session.archivedAt && (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px] text-muted-foreground">
              {copy.archived}
            </Badge>
          )}
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          <span>{session.workspaceName ?? session.runtimeKind}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>{session.runtimeKind}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>{copy.messages(session.messageCount)}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>{updatedLabel}</span>
        </div>

        <div className="mt-2.5 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
          {sessionPartVisuals.map((part) => {
            const bytes = session[part.field]
            if (bytes <= 0) { return null }
            const width = totalBytes > 0 ? (bytes / totalBytes) * 100 : 0
            return (
              <Tooltip key={part.id}>
                <TooltipTrigger asChild>
                  <div
                    className={cn('h-full min-w-[2px]', part.bar)}
                    style={{ width: `${width}%` }}
                  />
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  <div className="font-medium capitalize">{copy.parts[part.id]}</div>
                  <div className="tabular-nums text-muted-foreground">{formatBytes(bytes)}</div>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end justify-center gap-0.5">
        <span className="text-[13px] font-medium tabular-nums text-foreground">
          {formatBytes(session.reclaimableBytes)}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground/70">
          {formatBytes(totalBytes)}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Tooltip>
          <TooltipTrigger render={(
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onAction('purge-transcripts')}
              disabled={session.active || disabled}
              aria-label={copy.clearTranscript}
            >
              <ClearIcon className="size-3.5" />
            </Button>
          )}
          />
          <TooltipContent>{copy.clearTranscript}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={(
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onAction('delete-sessions')}
              disabled={session.active || disabled}
              aria-label={copy.deleteSession}
              className="text-muted-foreground hover:text-destructive"
            >
              <DeleteIcon className="size-3.5" />
            </Button>
          )}
          />
          <TooltipContent>{copy.deleteSession}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
