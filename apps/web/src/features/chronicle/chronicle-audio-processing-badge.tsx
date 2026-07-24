import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'

import { formatChronicleAudioProcessingStatus } from './chronicle-audio-presenter'
import type { ChronicleAudioRawSegment } from './use-chronicle'

export interface ChronicleAudioProcessingBadgeProps {
  label: string
  status: ChronicleAudioRawSegment['vadStatus']
}

export function ChronicleAudioProcessingBadge({
  label,
  status,
}: ChronicleAudioProcessingBadgeProps) {
  const { t } = useTranslation('chronicle')

  return (
    <Badge variant="outline" className="text-[11px]">
      {label}
      {' '}
      {formatChronicleAudioProcessingStatus(t, status)}
    </Badge>
  )
}
