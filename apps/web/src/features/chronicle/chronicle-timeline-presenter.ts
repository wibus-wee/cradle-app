import type { TFunction } from 'i18next'

import type { TimelineEntry } from './use-chronicle'

type ChronicleTranslate = TFunction<'chronicle'>

export type ChronicleTimelineSourceFilter = 'all' | 'snapshot' | 'message' | 'audio'

export function isChronicleTimelineSourceFilter(
  value: string,
): value is ChronicleTimelineSourceFilter {
  return value === 'all' || value === 'snapshot' || value === 'message' || value === 'audio'
}

export function getChronicleTimelineEntryTitle(
  t: ChronicleTranslate,
  entry: TimelineEntry,
): string {
  if (entry.sourceType === 'audio') {
    return entry.channelName ?? entry.windowTitle ?? t('timeline.fallback.audioTranscript')
  }
  if (entry.sourceType === 'message') {
    return entry.channelName
      ? `#${entry.channelName}`
      : entry.channelId ?? t('timeline.fallback.slackMessage')
  }
  return entry.windowTitle ?? entry.appBundleId ?? t('timeline.fallback.screenRecord')
}

export function getChronicleTimelineEntrySecondaryLabel(
  t: ChronicleTranslate,
  entry: TimelineEntry,
): string | null {
  if (entry.sourceType === 'message') {
    return entry.userName ?? t('timeline.fallback.unknownUser')
  }
  if (entry.appBundleId && entry.windowTitle) {
    return entry.appBundleId
  }
  if (entry.platform) {
    return entry.platform
  }
  return null
}
