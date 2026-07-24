import { ClockLine as ClockIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/cn'

import {
  formatChronicleDreamRunStatus,
  formatChronicleDreamRunType,
} from './chronicle-dream-run-presenter'
import { formatChronicleRelativeTime } from './chronicle-time-presenter'
import type { ChronicleDreamRun } from './use-chronicle'

export interface ChronicleDreamRunCardViewProps {
  run: ChronicleDreamRun
}

export function ChronicleDreamRunCardView({
  run,
}: ChronicleDreamRunCardViewProps) {
  const { t } = useTranslation('chronicle')

  return (
    <article className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <ClockIcon className="size-3.5 shrink-0 !text-muted-foreground" />
        <span className="truncate text-[13px] font-medium text-foreground">
          {formatChronicleDreamRunType(t, run.runType)}
        </span>
        <Badge
          variant={run.status === 'completed' ? 'secondary' : 'outline'}
          className={cn(
            'ml-auto text-[11px]',
            { 'border-destructive/20 bg-destructive/10 text-destructive': run.status === 'failed' },
          )}
        >
          {formatChronicleDreamRunStatus(t, run.status)}
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
        <span>{t('dreamRun.inputCount', { count: run.inputCount })}</span>
        <span>{t('dreamRun.candidateCount', { count: run.result.candidateCount })}</span>
        <span>{t('dreamRun.mergedCount', { count: run.mergedCount })}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{run.result.vectorMode}</span>
        <span className="shrink-0 font-mono">
          {formatChronicleRelativeTime(t, run.startedAt)}
        </span>
      </div>
      {run.errorMessage && (
        <p className="mt-1 line-clamp-2 text-[11px] text-destructive">
          {run.errorMessage}
        </p>
      )}
    </article>
  )
}
