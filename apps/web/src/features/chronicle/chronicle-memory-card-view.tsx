import { BrainLine as BrainIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/cn'

import {
  formatChronicleMemoryType,
  getChronicleMemoryMatchLabel,
} from './chronicle-memory-presenter'
import { formatChronicleDateTime } from './chronicle-time-presenter'
import type { MemoryEntry } from './use-chronicle'

export interface ChronicleMemoryCardViewProps {
  entry: MemoryEntry
  focused: boolean
}

export function ChronicleMemoryCardView({
  entry,
  focused,
}: ChronicleMemoryCardViewProps) {
  const { t } = useTranslation('chronicle')

  return (
    <article
      className={cn(
        'rounded-lg bg-background p-3 shadow-sm transition-[box-shadow,background-color]',
        focused
          ? 'bg-primary/5 shadow-lg ring-2 ring-primary/40'
          : 'shadow-[0_0_0_1px_rgba(0,0,0,0.05)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.05)]',
      )}
      data-testid={`chronicle-memory-card-${entry.id}`}
    >
      <div className="mb-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <BrainIcon className="size-3.5 shrink-0 !text-muted-foreground" />
          <span className="truncate text-[13px] font-medium text-foreground">
            {entry.title ?? t('memory.fallbackTitle')}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:ml-auto">
          {entry.matchKind && (
            <Badge variant="outline" className="text-[11px]">
              {getChronicleMemoryMatchLabel(t, entry)}
            </Badge>
          )}
          <Badge variant="secondary" className="text-[11px]">
            {formatChronicleMemoryType(t, entry.type)}
          </Badge>
        </div>
      </div>
      <p className="line-clamp-4 text-[13px] leading-5 text-foreground">{entry.content}</p>
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="font-mono">{formatChronicleDateTime(t, entry.createdAt)}</span>
        {entry.sourceCount !== null && entry.sourceCount !== undefined && (
          <span>{t('memory.sourceCount', { count: entry.sourceCount })}</span>
        )}
      </div>
    </article>
  )
}
