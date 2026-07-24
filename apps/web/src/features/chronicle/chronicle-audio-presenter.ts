import type { TFunction } from 'i18next'

import type {
  ChronicleAudioRawSegment,
  ChronicleAudioTranscript,
} from './use-chronicle'

type ChronicleTranslate = TFunction<'chronicle'>

export function formatChronicleAudioTranscriptStatus(
  t: ChronicleTranslate,
  status: ChronicleAudioTranscript['status'],
): string {
  if (status === 'recording') {
    return t('common.status.recording')
  }
  if (status === 'completed') {
    return t('common.status.completed')
  }
  if (status === 'imported') {
    return t('common.status.imported')
  }
  return t('common.status.error')
}

export function formatChronicleAudioSegmentTitle(
  t: ChronicleTranslate,
  segment: ChronicleAudioRawSegment,
): string {
  if (segment.source === 'system') {
    return t('audioRaw.title.system')
  }
  if (segment.source === 'mixed') {
    return t('audioRaw.title.mixed')
  }
  return t('audioRaw.title.microphone')
}

export function formatChronicleAudioProcessingStatus(
  t: ChronicleTranslate,
  status: ChronicleAudioRawSegment['vadStatus'],
): string {
  if (status === 'pending') {
    return t('common.status.pending')
  }
  if (status === 'ready') {
    return t('common.status.completed')
  }
  if (status === 'error') {
    return t('common.status.error')
  }
  return t('audioRaw.processing.notConnected')
}
