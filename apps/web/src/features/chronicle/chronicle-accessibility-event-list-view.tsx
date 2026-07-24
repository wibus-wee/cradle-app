import { HeartbeatLine as ActivityIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { ChronicleAccessibilityEventCardView } from './chronicle-accessibility-event-card-view'
import { ChronicleEmptyState } from './chronicle-empty-state'
import type { ChronicleAccessibilityEvent } from './use-chronicle'

export interface ChronicleAccessibilityEventListViewProps {
  loading: boolean
  events: ChronicleAccessibilityEvent[]
}

export function ChronicleAccessibilityEventListView({
  loading,
  events,
}: ChronicleAccessibilityEventListViewProps) {
  const { t } = useTranslation('chronicle')

  if (loading) {
    return (
      <ChronicleEmptyState
        icon={<ActivityIcon className="size-4" />}
        title={t('advanced.accessibilityEvents.loading')}
      />
    )
  }

  if (events.length === 0) {
    return (
      <ChronicleEmptyState
        icon={<ActivityIcon className="size-4" />}
        title={t('advanced.accessibilityEvents.empty')}
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {events.map(event => (
        <ChronicleAccessibilityEventCardView key={event.id} event={event} />
      ))}
    </div>
  )
}
