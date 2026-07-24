import { FileMusicLine as FileAudioIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { ChronicleAudioRawSegmentCardView } from './chronicle-audio-raw-segment-card-view'
import { ChronicleEmptyState } from './chronicle-empty-state'
import type { ChronicleAudioRawSegment } from './use-chronicle'

export interface ChronicleAudioRawSegmentListViewProps {
  loading: boolean
  segments: ChronicleAudioRawSegment[]
}

export function ChronicleAudioRawSegmentListView({
  loading,
  segments,
}: ChronicleAudioRawSegmentListViewProps) {
  const { t } = useTranslation('chronicle')

  if (loading) {
    return (
      <ChronicleEmptyState
        icon={<FileAudioIcon className="size-4" />}
        title={t('advanced.audioSegments.loading')}
      />
    )
  }

  if (segments.length === 0) {
    return (
      <ChronicleEmptyState
        icon={<FileAudioIcon className="size-4" />}
        title={t('advanced.audioSegments.empty')}
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {segments.map(segment => (
        <ChronicleAudioRawSegmentCardView key={segment.id} segment={segment} />
      ))}
    </div>
  )
}
