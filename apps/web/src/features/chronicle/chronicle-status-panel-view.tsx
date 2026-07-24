import {
  BrainLine as BrainIcon,
  ChipLine as CpuIcon,
  ClockLine as ClockIcon,
  DriveLine as HardDriveIcon,
  EyeLine as EyeIcon,
  FileMusicLine as FileAudioIcon,
  HeartbeatLine as ActivityIcon,
  LayersLine as LayersIcon,
  Message1Line as MessageSquareIcon,
  WarningLine as TriangleAlertIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { ChronicleEmptyState } from './chronicle-empty-state'
import { ChronicleStatusBadgeView } from './chronicle-status-badge-view'
import { ChronicleStatusItemView } from './chronicle-status-item-view'
import { formatChronicleAudioRuntimeStatus } from './chronicle-status-presenter'
import {
  formatChronicleDateTime,
  formatChronicleRelativeTime,
} from './chronicle-time-presenter'
import type { ChronicleConfig, ChronicleStatus } from './use-chronicle'

export interface ChronicleStatusPanelViewProps {
  loading: boolean
  status: ChronicleStatus | null
  config: ChronicleConfig | null
  modelLabel: string | null
}

export function ChronicleStatusPanelView({
  loading,
  status,
  config,
  modelLabel,
}: ChronicleStatusPanelViewProps) {
  const { t } = useTranslation('chronicle')

  if (loading) {
    return (
      <ChronicleEmptyState
        icon={<ActivityIcon className="size-4" />}
        title={t('status.loading')}
      />
    )
  }

  const running = status?.running ?? false
  const available = status?.available ?? false
  const audioCaptureEnabled = status?.audioCaptureEnabled ?? config?.audioCaptureEnabled ?? false
  const activityPipelineEnabled = status?.activityPipelineEnabled ?? config?.activityPipelineEnabled ?? false
  const activityPipelineRunning = status?.activityPipelineRunning ?? false
  const activityPipelineIntervalMs = status?.activityPipelineIntervalMs ?? config?.activityPipelineIntervalMs ?? 120_000
  const activityPipelineBatchSize = status?.activityPipelineBatchSize ?? config?.activityPipelineBatchSize ?? 3
  const dreamSchedulerEnabled = status?.dreamSchedulerEnabled ?? config?.dreamSchedulerEnabled ?? false
  const dreamSchedulerRunning = status?.dreamSchedulerRunning ?? false
  const dreamSchedulerIntervalMs = status?.dreamSchedulerIntervalMs ?? config?.dreamSchedulerIntervalMs ?? 86_400_000
  const dreamSchedulerApplyMerge = status?.dreamSchedulerApplyMerge ?? config?.dreamSchedulerApplyMerge ?? false

  return (
    <div className="rounded-lg border border-foreground/5 bg-background p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <ActivityIcon className="size-3.5 !text-muted-foreground" />
        <span className="text-[13px] font-medium text-foreground">
          {t('status.title')}
        </span>
        <ChronicleStatusBadgeView running={running} available={available} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-10 xl:grid-cols-12">
        <ChronicleStatusItemView
          icon={<EyeIcon className="size-3.5" />}
          label={t('status.item.service')}
          value={running
            ? t('status.service.running', { pid: status?.pid ?? t('common.status.unknown') })
            : t('common.status.stopped')}
        />
        <ChronicleStatusItemView
          icon={<ClockIcon className="size-3.5" />}
          label={t('status.item.lastMemory')}
          value={formatChronicleRelativeTime(t, status?.lastSummaryAt ?? null)}
          detail={formatChronicleDateTime(t, status?.lastSummaryAt ?? null)}
        />
        <ChronicleStatusItemView
          icon={<BrainIcon className="size-3.5" />}
          label={t('status.item.memories')}
          value={String(status?.totalSummaries ?? 0)}
        />
        <ChronicleStatusItemView
          icon={<MessageSquareIcon className="size-3.5" />}
          label="Slack"
          value={String(status?.totalMessages ?? 0)}
          detail={formatChronicleRelativeTime(t, status?.lastMessageAt ?? null)}
        />
        <ChronicleStatusItemView
          icon={<EyeIcon className="size-3.5" />}
          label={t('status.item.windows')}
          value={String(status?.totalAccessibilitySnapshots ?? 0)}
          detail={formatChronicleRelativeTime(t, status?.lastAccessibilitySnapshotAt ?? null)}
        />
        <ChronicleStatusItemView
          icon={<ActivityIcon className="size-3.5" />}
          label={t('status.item.events')}
          value={String(status?.totalAccessibilityEvents ?? 0)}
          detail={formatChronicleRelativeTime(t, status?.lastAccessibilityEventAt ?? null)}
        />
        <ChronicleStatusItemView
          icon={<FileAudioIcon className="size-3.5" />}
          label={t('status.item.transcripts')}
          value={String(status?.totalAudioTranscripts ?? 0)}
          detail={formatChronicleRelativeTime(t, status?.lastAudioTranscriptAt ?? null)}
        />
        <ChronicleStatusItemView
          icon={<FileAudioIcon className="size-3.5" />}
          label={t('status.item.audio')}
          value={String(status?.totalAudioRawSegments ?? 0)}
          detail={audioCaptureEnabled
            ? formatChronicleRelativeTime(t, status?.lastAudioRawSegmentAt ?? null)
            : formatChronicleAudioRuntimeStatus(t, status?.audioRuntimeStatus ?? 'disabled')}
        />
        <ChronicleStatusItemView
          icon={<ActivityIcon className="size-3.5" />}
          label={t('status.item.activities')}
          value={String(status?.totalActivitySegments ?? 0)}
        />
        <ChronicleStatusItemView
          icon={<CpuIcon className="size-3.5" />}
          label={t('status.item.pipeline')}
          value={String(status?.totalPipelineRuns ?? 0)}
        />
        <ChronicleStatusItemView
          icon={<BrainIcon className="size-3.5" />}
          label={t('status.item.knowledge')}
          value={String(status?.totalKnowledgeCards ?? 0)}
        />
        <ChronicleStatusItemView
          icon={<ClockIcon className="size-3.5" />}
          label={t('status.item.preview')}
          value={String(status?.totalDreamRuns ?? 0)}
        />
      </div>

      <div className="mt-3 grid gap-2 border-t border-foreground/5 pt-3 text-[12px] text-muted-foreground md:grid-cols-2">
        <div className="flex min-w-0 items-center gap-2">
          <HardDriveIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {config?.storageRoot ?? t('status.storageUnavailable')}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 md:justify-end">
          <CpuIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {activityPipelineEnabled
              ? t('status.pipelineSummary', {
                  state: activityPipelineRunning ? t('common.status.running') : t('common.status.ready'),
                  seconds: Math.round(activityPipelineIntervalMs / 1000),
                  count: activityPipelineBatchSize,
                })
              : t('status.pipelineDisabled')}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <LayersIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {dreamSchedulerEnabled
              ? t('status.dreamSummary', {
                  state: dreamSchedulerRunning ? t('common.status.running') : t('common.status.ready'),
                  mode: dreamSchedulerApplyMerge ? t('control.status.autoMerge') : t('control.status.previewOnly'),
                  hours: Math.round(dreamSchedulerIntervalMs / 3_600_000),
                })
              : t('status.dreamDisabled')}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 md:justify-end">
          <CpuIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {modelLabel ?? t('status.noModel')}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {status?.lastExitCode === null || status?.lastExitCode === undefined
              ? t('status.noExitRecord')
              : t('status.lastExit', {
                  code: status.lastExitCode,
                  time: formatChronicleDateTime(t, status.lastExitAt),
                })}
          </span>
        </div>
      </div>
    </div>
  )
}
