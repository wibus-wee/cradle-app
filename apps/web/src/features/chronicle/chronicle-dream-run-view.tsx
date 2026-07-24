import {
  CheckCircleLine as CheckCircleIcon,
  ClockLine as ClockIcon,
  Refresh1Line as RefreshIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'

import { ChronicleDreamRunCardView } from './chronicle-dream-run-card-view'
import { ChronicleEmptyState } from './chronicle-empty-state'
import type { ChronicleDreamRun } from './use-chronicle'

export interface ChronicleDreamRunViewProps {
  loading: boolean
  runs: ChronicleDreamRun[]
  busy: boolean
  onGeneratePreview: () => void
  onApplyMerge: () => void
}

export function ChronicleDreamRunView({
  loading,
  runs,
  busy,
  onGeneratePreview,
  onApplyMerge,
}: ChronicleDreamRunViewProps) {
  const { t } = useTranslation('chronicle')

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-2">
            <ClockIcon className="size-3.5 shrink-0 !text-muted-foreground" />
            <span className="truncate text-[13px] font-medium text-foreground">
              {t('dreamRun.candidatesTitle')}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:ml-auto sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onGeneratePreview}
            >
              <RefreshIcon className="size-3.5" />
              {t('dreamRun.generatePreview')}
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={busy}
              onClick={onApplyMerge}
            >
              <CheckCircleIcon className="size-3.5" />
              {t('dreamRun.applyMerge')}
            </Button>
          </div>
        </div>
      </div>

      {loading
        ? (
            <ChronicleEmptyState
              icon={<ClockIcon className="size-4" />}
              title={t('dreamRun.loading')}
            />
          )
        : runs.length === 0
          ? (
              <ChronicleEmptyState
                icon={<ClockIcon className="size-4" />}
                title={t('dreamRun.empty')}
              />
            )
          : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {runs.slice(0, 8).map(run => (
                  <ChronicleDreamRunCardView key={run.id} run={run} />
                ))}
              </div>
            )}
    </div>
  )
}
