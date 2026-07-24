import { BrainLine as BrainIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { ChronicleEmptyState } from './chronicle-empty-state'
import { ChronicleKnowledgeCardView } from './chronicle-knowledge-card-view'
import type { ChronicleKnowledgeCard } from './use-chronicle'

export interface ChronicleKnowledgeCardGridViewProps {
  loading: boolean
  cards: ChronicleKnowledgeCard[]
  focusedKnowledgeId: string | null
}

export function ChronicleKnowledgeCardGridView({
  loading,
  cards,
  focusedKnowledgeId,
}: ChronicleKnowledgeCardGridViewProps) {
  const { t } = useTranslation('chronicle')

  if (loading) {
    return (
      <ChronicleEmptyState
        icon={<BrainIcon className="size-4" />}
        title={t('knowledge.loading')}
      />
    )
  }
  if (cards.length === 0) {
    return (
      <ChronicleEmptyState
        icon={<BrainIcon className="size-4" />}
        title={t('knowledge.empty')}
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {cards.map(card => (
        <ChronicleKnowledgeCardView
          key={card.id}
          card={card}
          focused={card.id === focusedKnowledgeId}
        />
      ))}
    </div>
  )
}
