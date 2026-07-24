import {
  BrainLine as BrainIcon,
  CheckCircleLine as CheckCircleIcon,
  ChipLine as CpuIcon,
  HeartbeatLine as ActivityIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'

import {
  formatChronicleActivityPipelineStatus,
  formatChronicleActivitySegmentType,
  formatChronicleDurationSeconds,
} from './chronicle-activity-presenter'
import { ChronicleActivitySourceBadge } from './chronicle-activity-source-badge'
import { formatChronicleDateTime } from './chronicle-time-presenter'
import type { ChronicleActivitySegment } from './use-chronicle'

export interface ChronicleActivitySegmentCardViewProps {
  segment: ChronicleActivitySegment
  busy: boolean
  onTriage: () => void
  onSummarize: () => void
  onCrystallize: () => void
}

export function ChronicleActivitySegmentCardView({
  segment,
  busy,
  onTriage,
  onSummarize,
  onCrystallize,
}: ChronicleActivitySegmentCardViewProps) {
  const { t } = useTranslation('chronicle')

  return (
    <article className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <ActivityIcon className="size-3.5 shrink-0 !text-muted-foreground" />
        <span className="truncate text-[13px] font-medium text-foreground">
          {segment.title ?? segment.frontApp ?? t('activitySegment.fallback.title')}
        </span>
        <Badge variant="outline" className="ml-auto text-[11px]">
          {formatChronicleActivitySegmentType(t, segment.segmentType)}
        </Badge>
      </div>
      <p className="line-clamp-3 min-h-15 text-[13px] leading-5 text-foreground">
        {segment.summary ?? t('activitySegment.fallback.summary')}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
        <span className="truncate font-mono">
          {formatChronicleDateTime(t, segment.startedAt)}
        </span>
        <span className="truncate text-right">
          {formatChronicleDurationSeconds(t, segment.durationSeconds)}
        </span>
        <span className="truncate">
          {segment.frontApp ?? t('common.status.unknownApp')}
        </span>
        <span className="truncate text-right">
          {formatChronicleActivityPipelineStatus(t, segment.pipelineStatus)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <ChronicleActivitySourceBadge
          label={t('activitySegment.source.screen')}
          value={segment.sourceCounts.snapshotIds ?? 0}
        />
        <ChronicleActivitySourceBadge
          label="Slack"
          value={segment.sourceCounts.messageIds ?? 0}
        />
        <ChronicleActivitySourceBadge
          label={t('activitySegment.source.audio')}
          value={segment.sourceCounts.audioRawSegmentIds ?? 0}
        />
        <ChronicleActivitySourceBadge
          label={t('activitySegment.source.transcript')}
          value={segment.sourceCounts.audioTranscriptIds ?? 0}
        />
        <ChronicleActivitySourceBadge
          label={t('activitySegment.source.memory')}
          value={segment.sourceCounts.memoryIds ?? 0}
        />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || segment.pipelineStatus === 'summarized' || segment.pipelineStatus === 'crystallized'}
          onClick={onTriage}
        >
          <CpuIcon className="size-3.5" />
          {t('activitySegment.action.triage')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || segment.pipelineStatus === 'summarized' || segment.pipelineStatus === 'crystallized'}
          onClick={onSummarize}
        >
          <BrainIcon className="size-3.5" />
          {t('activitySegment.action.summarize')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || segment.pipelineStatus === 'crystallized'}
          onClick={onCrystallize}
        >
          <CheckCircleIcon className="size-3.5" />
          {t('activitySegment.action.crystallize')}
        </Button>
      </div>
    </article>
  )
}
