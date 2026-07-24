import { BrainLine as BrainIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/cn'

import {
  formatChronicleKnowledgeCardStatus,
  formatChronicleKnowledgeCardType,
  formatChronicleKnowledgeDimension,
} from './chronicle-knowledge-presenter'
import { formatChronicleRelativeTime } from './chronicle-time-presenter'
import type { ChronicleKnowledgeCard } from './use-chronicle'

export interface ChronicleKnowledgeCardViewProps {
  card: ChronicleKnowledgeCard
  focused: boolean
}

export function ChronicleKnowledgeCardView({
  card,
  focused,
}: ChronicleKnowledgeCardViewProps) {
  const { t } = useTranslation('chronicle')

  return (
    <article
      className={cn(
        'rounded-lg bg-background p-3 shadow-sm transition-[box-shadow,background-color]',
        focused
          ? 'bg-primary/5 shadow-lg ring-2 ring-primary/40'
          : 'shadow-[0_0_0_1px_rgba(0,0,0,0.05)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.05)]',
      )}
      data-testid={`chronicle-knowledge-card-${card.id}`}
    >
      <div className="mb-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <BrainIcon className="size-3.5 shrink-0 !text-muted-foreground" />
          <span className="truncate text-[13px] font-medium text-foreground">{card.title}</span>
        </div>
        <div className="sm:ml-auto">
          <Badge variant="outline" className="text-[11px]">
            {formatChronicleKnowledgeDimension(t, card.dimension)}
          </Badge>
        </div>
      </div>
      <p className="line-clamp-4 min-h-20 text-[13px] leading-5 text-foreground">
        {card.content}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge variant="secondary" className="text-[11px]">
          {formatChronicleKnowledgeCardType(t, card.cardType)}
        </Badge>
        <Badge variant="outline" className="text-[11px]">
v
{card.version}
        </Badge>
        <Badge variant="outline" className="text-[11px]">
          {Math.round(card.confidence * 100)}
          %
        </Badge>
        {card.status !== 'active' && (
          <Badge variant="outline" className="text-[11px]">
            {formatChronicleKnowledgeCardStatus(t, card.status)}
          </Badge>
        )}
        {card.tags.slice(0, 4).map(tag => (
          <Badge key={tag} variant="outline" className="text-[11px]">{tag}</Badge>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="truncate">
          {t('knowledgeCard.sourceSegments', { count: card.sourceSegmentIds.length })}
        </span>
        <span className="shrink-0 font-mono">
          {formatChronicleRelativeTime(t, card.updatedAt)}
        </span>
      </div>
    </article>
  )
}
