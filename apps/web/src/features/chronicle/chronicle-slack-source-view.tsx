import {
  Key2Line as KeyIcon,
  Message1Line as MessageSquareIcon,
} from '@mingcute/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'

import { ChronicleEmptyState } from './chronicle-empty-state'
import { ChronicleSlackSourceCardView } from './chronicle-slack-source-card-view'
import type {
  ChronicleMessageSource,
  ChronicleSlackSourceDraft,
  ChronicleSlackSyncResult,
} from './use-chronicle'

const EMPTY_SLACK_SOURCE_DRAFT: ChronicleSlackSourceDraft = {
  label: 'Slack',
  token: '',
  signingSecret: '',
  channelIds: '',
  enabled: true,
  realtimeMode: 'events-api',
}

export interface ChronicleSlackSourceViewProps {
  loading: boolean
  sources: ChronicleMessageSource[]
  serverUrl: string
  saving: boolean
  syncing: boolean
  onSaveSource: (draft: ChronicleSlackSourceDraft) => Promise<ChronicleMessageSource>
  onSyncSource: (sourceId: ChronicleMessageSource['id']) => Promise<ChronicleSlackSyncResult>
}

export function ChronicleSlackSourceView({
  loading,
  sources,
  serverUrl,
  saving,
  syncing,
  onSaveSource,
  onSyncSource,
}: ChronicleSlackSourceViewProps) {
  const { t } = useTranslation('chronicle')
  const [draft, setDraft] = useState<ChronicleSlackSourceDraft>(EMPTY_SLACK_SOURCE_DRAFT)
  const [lastSyncMessage, setLastSyncMessage] = useState<string | null>(null)
  const canSave = draft.label.trim().length > 0
    && draft.token.trim().length > 0
    && draft.channelIds.trim().length > 0
    && (draft.realtimeMode !== 'events-api' || draft.signingSecret.trim().length > 0)

  const saveDraft = () => {
    void onSaveSource(draft).then(() => {
      setDraft(EMPTY_SLACK_SOURCE_DRAFT)
    })
  }

  const syncSource = (sourceId: ChronicleMessageSource['id']) => {
    void onSyncSource(sourceId).then((result) => {
      setLastSyncMessage(`${result.message}; ${result.ingested} imported`)
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-foreground/5 bg-background p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <MessageSquareIcon className="size-3.5 !text-muted-foreground" />
          <span className="text-[13px] font-medium text-foreground">
            {t('slack.title')}
          </span>
          <Badge variant="outline" className="ml-auto text-[11px]">
            {sources.length === 0
              ? t('common.status.disconnected')
              : t('slack.sourceCount', { count: sources.length })}
          </Badge>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <Input
            value={draft.label}
            onChange={event => setDraft(current => ({ ...current, label: event.target.value }))}
            placeholder={t('slack.placeholder.label')}
            className="h-9 text-[13px]"
          />
          <Input
            value={draft.channelIds}
            onChange={event => setDraft(current => ({ ...current, channelIds: event.target.value }))}
            placeholder={t('slack.placeholder.channelIds')}
            className="h-9 font-mono text-[13px]"
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            value={draft.realtimeMode}
            onValueChange={(value) => {
              if (value === 'polling' || value === 'events-api') {
                setDraft(current => ({ ...current, realtimeMode: value }))
              }
            }}
            variant="outline"
            size="sm"
            spacing={0}
          >
            <ToggleGroupItem
              value="events-api"
              aria-label="Slack Events API"
              className="h-8 px-2 text-[12px]"
            >
              Events API
            </ToggleGroupItem>
            <ToggleGroupItem
              value="polling"
              aria-label={t('slack.mode.pollingAriaLabel')}
              className="h-8 px-2 text-[12px]"
            >
              {t('slack.mode.polling')}
            </ToggleGroupItem>
          </ToggleGroup>
          <span className="min-w-48 flex-1 text-[12px] text-muted-foreground">
            {draft.realtimeMode === 'events-api'
              ? t('slack.mode.eventsDescription')
              : t('slack.mode.pollingDescription')}
          </span>
        </div>

        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <KeyIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 !text-muted-foreground/60" />
            <Input
              value={draft.token}
              type="password"
              onChange={event => setDraft(current => ({ ...current, token: event.target.value }))}
              placeholder="xoxb- Slack bot token"
              className="h-9 pl-8 font-mono text-[13px]"
            />
          </div>
          {draft.realtimeMode === 'events-api' && (
            <div className="relative min-w-0 flex-1">
              <KeyIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 !text-muted-foreground/60" />
              <Input
                value={draft.signingSecret}
                type="password"
                onChange={event => setDraft(current => ({ ...current, signingSecret: event.target.value }))}
                placeholder="Slack signing secret"
                className="h-9 pl-8 font-mono text-[13px]"
              />
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canSave || saving}
            onClick={saveDraft}
          >
            {t('common.action.save')}
          </Button>
        </div>

        <p className="mt-2 text-[12px] text-muted-foreground">
          {t('slack.secretHelp')}
        </p>
      </div>

      {loading
        ? (
            <ChronicleEmptyState
              icon={<MessageSquareIcon className="size-4" />}
              title={t('slack.loading')}
            />
          )
        : sources.length === 0
          ? (
              <ChronicleEmptyState
                icon={<MessageSquareIcon className="size-4" />}
                title={t('slack.empty')}
              />
            )
          : (
              <div className="flex flex-col gap-2">
                {sources.map(source => (
                  <ChronicleSlackSourceCardView
                    key={source.id}
                    source={source}
                    serverUrl={serverUrl}
                    syncing={syncing}
                    onSync={syncSource}
                  />
                ))}
              </div>
            )}

      {lastSyncMessage && (
        <p className="text-[12px] text-muted-foreground">
          {lastSyncMessage}
        </p>
      )}
    </div>
  )
}
