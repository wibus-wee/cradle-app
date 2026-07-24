import type { TFunction } from 'i18next'

import type { ChronicleMessageSource } from './use-chronicle'

type ChronicleTranslate = TFunction<'chronicle'>

export function formatChronicleSlackRealtimeMode(
  t: ChronicleTranslate,
  mode: ChronicleMessageSource['realtimeMode'],
): string {
  if (mode === 'events-api') {
    return 'Events API'
  }
  if (mode === 'socket-mode') {
    return 'Socket Mode'
  }
  return t('slack.mode.polling')
}

export function getChronicleSlackEventsUrl(
  serverUrl: string,
  sourceId: ChronicleMessageSource['id'],
): string {
  return `${serverUrl}/chronicle/message-sources/${sourceId}/slack/events`
}
