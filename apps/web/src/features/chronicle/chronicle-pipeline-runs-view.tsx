import {
  ChipLine as CpuIcon,
  Refresh1Line as RefreshIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

import {
  formatChroniclePipelineRunStatus,
  formatChroniclePipelineStage,
  formatChroniclePipelineTrigger,
} from './chronicle-activity-presenter'
import { formatChronicleRelativeTime } from './chronicle-time-presenter'
import type { ChroniclePipelineRun } from './use-chronicle'

export interface ChroniclePipelineRunsViewProps {
  runs: ChroniclePipelineRun[]
  busy: boolean
  onRunNow: () => void
}

export function ChroniclePipelineRunsView({
  runs,
  busy,
  onRunNow,
}: ChroniclePipelineRunsViewProps) {
  const { t } = useTranslation('chronicle')

  return (
    <section className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
      <div className="mb-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <CpuIcon className="size-3.5 shrink-0 !text-muted-foreground" />
          <span className="truncate text-[13px] font-medium text-foreground">
            {t('pipeline.runs.title')}
          </span>
          <Badge variant="outline" className="text-[11px]">{runs.length}</Badge>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full sm:ml-auto sm:w-auto"
          disabled={busy}
          onClick={onRunNow}
        >
          <RefreshIcon className="size-3.5" />
          {t('pipeline.runs.runNow')}
        </Button>
      </div>
      {runs.length === 0
        ? <p className="text-[12px] text-muted-foreground">{t('pipeline.runs.empty')}</p>
        : (
            <div className="flex flex-col gap-1.5">
              {runs.slice(0, 8).map(run => (
                <article key={run.id} className="rounded-md bg-muted/40 px-2.5 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[12px] font-medium text-foreground">
                      {formatChroniclePipelineTrigger(t, run.trigger)}
                    </span>
                    <Badge
                      variant={run.status === 'success' ? 'secondary' : 'outline'}
                      className={cn(
                        'ml-auto text-[11px]',
                        {
                          'border-destructive/20 bg-destructive/10 text-destructive': run.status === 'error',
                          'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300': run.status === 'queued' || run.status === 'running',
                        },
                      )}
                    >
                      {formatChroniclePipelineRunStatus(t, run.status)}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="truncate">{formatChroniclePipelineStage(t, run.stage)}</span>
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
              ))}
            </div>
          )}
    </section>
  )
}
