import {
  Message1Line as MessageSquareIcon,
  Refresh1Line as RefreshIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'

import {
  formatChronicleSlackRealtimeMode,
  getChronicleSlackEventsUrl,
} from './chronicle-slack-source-presenter'
import { formatChronicleRelativeTime } from './chronicle-time-presenter'
import type { ChronicleMessageSource } from './use-chronicle'

export interface ChronicleSlackSourceCardViewProps {
  source: ChronicleMessageSource
  serverUrl: string
  syncing: boolean
  onSync: (sourceId: ChronicleMessageSource['id']) => void
}

export function ChronicleSlackSourceCardView({
  source,
  serverUrl,
  syncing,
  onSync,
}: ChronicleSlackSourceCardViewProps) {
  const { t } = useTranslation('chronicle')

  return (
    <article className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
      <div className="flex min-w-0 items-center gap-2">
        <MessageSquareIcon className="size-3.5 shrink-0 !text-muted-foreground" />
        <span className="truncate text-[13px] font-medium text-foreground">
          {source.label}
        </span>
        <Badge variant="outline" className="ml-auto text-[11px]">
          {source.status}
        </Badge>
      </div>
      <div className="mt-2 grid gap-1 text-[12px] text-muted-foreground md:grid-cols-2">
        <span className="truncate font-mono">
          {source.channelIds.join(', ') || t('slack.noChannels')}
        </span>
        <span className="truncate md:text-right">
          {t('slack.lastMessage')}
          {' '}
          {formatChronicleRelativeTime(t, source.lastMessageAt)}
        </span>
        <span className="truncate">
          {t('slack.mode.label')}
          {' '}
          {formatChronicleSlackRealtimeMode(t, source.realtimeMode)}
        </span>
        <span className="truncate font-mono md:text-right">
          {source.realtimeMode === 'events-api'
            ? getChronicleSlackEventsUrl(serverUrl, source.id)
            : t('slack.pollingEnabled')}
        </span>
        {source.lastError && (
          <span className="truncate text-destructive md:col-span-2">
            {source.lastError}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={syncing || source.status === 'syncing'}
          onClick={() => onSync(source.id)}
        >
          <RefreshIcon className="size-3.5" />
          {t('common.action.sync')}
        </Button>
        <span className="text-[12px] text-muted-foreground">
          {t('slack.lastSync')}
          {' '}
          {formatChronicleRelativeTime(t, source.lastSyncAt)}
        </span>
      </div>
    </article>
  )
}
