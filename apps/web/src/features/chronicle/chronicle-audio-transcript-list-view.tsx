import { FileMusicLine as FileAudioIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { ChronicleAudioTranscriptCardView } from './chronicle-audio-transcript-card-view'
import { ChronicleEmptyState } from './chronicle-empty-state'
import type { ChronicleAudioTranscript } from './use-chronicle'

export interface ChronicleAudioTranscriptListViewProps {
  loading: boolean
  transcripts: ChronicleAudioTranscript[]
}

export function ChronicleAudioTranscriptListView({
  loading,
  transcripts,
}: ChronicleAudioTranscriptListViewProps) {
  const { t } = useTranslation('chronicle')

  if (loading) {
    return (
      <ChronicleEmptyState
        icon={<FileAudioIcon className="size-4" />}
        title={t('advanced.transcripts.loading')}
      />
    )
  }

  if (transcripts.length === 0) {
    return (
      <ChronicleEmptyState
        icon={<FileAudioIcon className="size-4" />}
        title={t('advanced.transcripts.empty')}
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {transcripts.map(transcript => (
        <ChronicleAudioTranscriptCardView
          key={transcript.id}
          transcript={transcript}
        />
      ))}
    </div>
  )
}
