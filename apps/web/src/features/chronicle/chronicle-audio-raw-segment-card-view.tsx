import { FileMusicLine as FileAudioIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { formatPercentFromRatio, formatShortDurationMs } from '~/lib/number-format'

import { formatChronicleAudioSegmentTitle } from './chronicle-audio-presenter'
import { ChronicleAudioProcessingBadge } from './chronicle-audio-processing-badge'
import { formatChronicleDateTime } from './chronicle-time-presenter'
import type { ChronicleAudioRawSegment } from './use-chronicle'

export interface ChronicleAudioRawSegmentCardViewProps {
  segment: ChronicleAudioRawSegment
}

export function ChronicleAudioRawSegmentCardView({
  segment,
}: ChronicleAudioRawSegmentCardViewProps) {
  const { t } = useTranslation('chronicle')

  return (
    <article className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <FileAudioIcon className="size-3.5 shrink-0 !text-muted-foreground" />
        <span className="truncate text-[13px] font-medium text-foreground">
          {formatChronicleAudioSegmentTitle(t, segment)}
        </span>
        <Badge
          variant={segment.active ? 'secondary' : 'outline'}
          className="ml-auto text-[11px]"
        >
          {segment.active ? t('audioRaw.active') : t('audioRaw.quiet')}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[12px] text-muted-foreground">
        <span className="truncate">
          {formatChronicleDateTime(t, segment.recordedAt)}
        </span>
        <span className="truncate text-right">
          {formatShortDurationMs(segment.durationMs)}
        </span>
        <span className="truncate">
          RMS
          {' '}
          {formatPercentFromRatio(segment.rms)}
        </span>
        <span className="truncate text-right">
          Peak
          {' '}
          {formatPercentFromRatio(segment.peak)}
        </span>
        <span className="truncate">
          {segment.sampleRate}
          {' '}
          Hz
        </span>
        <span className="truncate text-right">
          {segment.channels}
          {' '}
          {t('audioRaw.channels')}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <ChronicleAudioProcessingBadge label="VAD" status={segment.vadStatus} />
        <ChronicleAudioProcessingBadge label="ASR" status={segment.asrStatus} />
        <ChronicleAudioProcessingBadge
          label={t('audioRaw.speaker')}
          status={segment.speakerStatus}
        />
      </div>
      <div className="mt-2 space-y-1 text-[11px] text-muted-foreground/70">
        <p className="truncate font-mono">{segment.audioPath}</p>
        <p className="truncate font-mono">{segment.metadataPath}</p>
      </div>
    </article>
  )
}
