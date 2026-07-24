import type { TFunction } from 'i18next'

import type { ChronicleStatus } from './use-chronicle'

type ChronicleTranslate = TFunction<'chronicle'>

export function formatChronicleAudioRuntimeStatus(
  t: ChronicleTranslate,
  status: ChronicleStatus['audioRuntimeStatus'],
): string {
  if (status === 'armed') {
    return t('common.status.armed')
  }
  if (status === 'unavailable') {
    return t('common.status.unavailable')
  }
  return t('common.status.disabled')
}
