import { HeartbeatLine as ActivityIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'

import { formatChronicleAccessibilityEventNotification } from './chronicle-accessibility-presenter'
import { formatChronicleDateTime } from './chronicle-time-presenter'
import type { ChronicleAccessibilityEvent } from './use-chronicle'

export interface ChronicleAccessibilityEventCardViewProps {
  event: ChronicleAccessibilityEvent
}

export function ChronicleAccessibilityEventCardView({
  event,
}: ChronicleAccessibilityEventCardViewProps) {
  const { t } = useTranslation('chronicle')

  return (
    <article className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <ActivityIcon className="size-3.5 shrink-0 !text-muted-foreground" />
        <span className="truncate text-[13px] font-medium text-foreground">
          {formatChronicleAccessibilityEventNotification(t, event.notification)}
        </span>
        <Badge variant="outline" className="ml-auto text-[11px]">
          {event.droppedBefore > 0 ? `${event.droppedBefore} dropped` : 'captured'}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
        <span className="truncate font-mono">
          {formatChronicleDateTime(t, event.capturedAt)}
        </span>
        <span className="truncate text-right">
          {event.appBundleId ?? t('common.status.unknownApp')}
        </span>
        <span className="truncate">{event.provider}</span>
        <span className="truncate text-right">
          {event.pid === null ? t('accessibility.unknownProcess') : `PID ${event.pid}`}
        </span>
        <span className="truncate">
          {event.snapshotId ? t('accessibility.snapshotLinked') : t('accessibility.snapshotNotLinked')}
        </span>
        <span className="truncate text-right">
          {event.accessibilitySnapshotId ? t('accessibility.windowClueLinked') : t('accessibility.windowClueNotLinked')}
        </span>
      </div>
      <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground/70">
        {event.sourceId}
      </p>
    </article>
  )
}
