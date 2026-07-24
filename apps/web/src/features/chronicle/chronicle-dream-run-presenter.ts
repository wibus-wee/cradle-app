import type { TFunction } from 'i18next'

import type { ChronicleDreamRun } from './use-chronicle'

type ChronicleTranslate = TFunction<'chronicle'>

export function formatChronicleDreamRunType(
  t: ChronicleTranslate,
  type: ChronicleDreamRun['runType'],
): string {
  if (type === 'merge') { return t('dreamRun.type.merge') }
  if (type === 'archive') { return t('dreamRun.type.archive') }
  if (type === 'prune') { return t('dreamRun.type.prune') }
  if (type === 'restore') { return t('dreamRun.type.restore') }
  return t('dreamRun.type.dryRun')
}

export function formatChronicleDreamRunStatus(
  t: ChronicleTranslate,
  status: ChronicleDreamRun['status'],
): string {
  if (status === 'completed') { return t('common.status.completed') }
  if (status === 'failed') { return t('common.status.error') }
  if (status === 'running') { return t('common.status.running') }
  return t('common.status.queued')
}
