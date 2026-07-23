import { ClockLine as ClockIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'

import {
  formatAutomationDateTime,
  formatAutomationRelativeTime,
} from './automation-presentation'
import { AutomationStatusDot } from './automation-status-dot'
import { AutomationStatusText } from './automation-status-text'
import type { AutomationRun } from './types'

export interface AutomationRunRowViewProps {
  run: AutomationRun
  locale: string
  now?: number
  onStop: (runId: string) => void
  onTriage: (runId: string, status: 'resolved' | 'archived') => void
}

export function AutomationRunRowView({
  run,
  locale,
  now,
  onStop,
  onTriage,
}: AutomationRunRowViewProps) {
  const { t } = useTranslation('automation')

  return (
    <div className="group relative flex items-start gap-3 py-2 pl-1">
      <AutomationStatusDot
        status={run.status}
        className="relative z-10 mt-1.5 size-2 ring-2 ring-background"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <AutomationStatusText status={run.status} />
          <span className="truncate font-mono text-[11px] text-foreground">
            {run.id}
          </span>
          <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {run.status === 'queued' || run.status === 'running'
              ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => onStop(run.id)}
                  >
                    {t('runs.stop')}
                  </Button>
                )
              : null}
            {run.triageStatus === 'unread' || run.triageStatus === 'read'
              ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => onTriage(run.id, 'resolved')}
                    >
                      {t('triage.resolve')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => onTriage(run.id, 'archived')}
                    >
                      {t('triage.archive')}
                    </Button>
                  </>
                )
              : null}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <ClockIcon className="size-3 shrink-0" />
          <span className="tabular-nums">
            {formatAutomationDateTime(
              run.startedAt ?? run.createdAt ?? run.scheduledFor,
              locale,
              t,
            )}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span>
            {formatAutomationRelativeTime(
              run.finishedAt ?? run.startedAt ?? run.createdAt,
              t,
              now,
            )}
          </span>
        </div>
        {run.errorText && (
          <div className="mt-1 truncate text-[11px] text-red-500">
            {run.errorText}
          </div>
        )}
        {run.resultSummary
          ? (
              <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {run.resultSummary}
              </div>
            )
          : null}
      </div>
    </div>
  )
}
