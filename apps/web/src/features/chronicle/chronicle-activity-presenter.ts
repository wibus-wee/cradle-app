import type { TFunction } from 'i18next'

import type {
  ChronicleActivitySegment,
  ChroniclePipelineRun,
} from './use-chronicle'

type ChronicleTranslate = TFunction<'chronicle'>

export function formatChronicleActivitySegmentType(
  t: ChronicleTranslate,
  type: ChronicleActivitySegment['segmentType'],
): string {
  if (type === 'meeting') { return t('activitySegment.type.meeting') }
  if (type === 'browsing') { return t('activitySegment.type.browsing') }
  if (type === 'chat') { return t('activitySegment.type.chat') }
  if (type === 'audio') { return t('activitySegment.type.audio') }
  if (type === 'idle') { return t('activitySegment.type.idle') }
  if (type === 'work') { return t('activitySegment.type.work') }
  return t('common.status.unknown')
}

export function formatChronicleActivityPipelineStatus(
  t: ChronicleTranslate,
  status: ChronicleActivitySegment['pipelineStatus'],
): string {
  if (status === 'triaged') { return t('activitySegment.pipelineStatus.triaged') }
  if (status === 'summarized') { return t('activitySegment.pipelineStatus.summarized') }
  if (status === 'crystallized') { return t('activitySegment.pipelineStatus.crystallized') }
  if (status === 'error') { return t('common.status.error') }
  return t('activitySegment.pipelineStatus.collecting')
}

export function formatChroniclePipelineTrigger(
  t: ChronicleTranslate,
  trigger: ChroniclePipelineRun['trigger'],
): string {
  if (trigger === 'audio-raw') { return t('pipeline.trigger.audioRaw') }
  if (trigger === 'audio-transcript') { return t('pipeline.trigger.audioTranscript') }
  if (trigger === 'message') { return t('pipeline.trigger.message') }
  if (trigger === 'memory') { return t('pipeline.trigger.memory') }
  if (trigger === 'summarize') { return t('pipeline.trigger.summarize') }
  if (trigger === 'manual') { return t('pipeline.trigger.manual') }
  return t('pipeline.trigger.snapshot')
}

export function formatChroniclePipelineStage(
  t: ChronicleTranslate,
  stage: ChroniclePipelineRun['stage'],
): string {
  if (stage === 'collection') { return t('pipeline.stage.collection') }
  if (stage === 'triage') { return t('pipeline.stage.triage') }
  if (stage === 'summarization') { return t('pipeline.stage.summarization') }
  if (stage === 'crystallization') { return t('pipeline.stage.crystallization') }
  return t('pipeline.stage.segmentation')
}

export function formatChroniclePipelineRunStatus(
  t: ChronicleTranslate,
  status: ChroniclePipelineRun['status'],
): string {
  if (status === 'success') { return t('common.status.completed') }
  if (status === 'error') { return t('common.status.error') }
  if (status === 'queued') { return t('common.status.queued') }
  if (status === 'running') { return t('common.status.running') }
  if (status === 'skipped') { return t('common.status.skipped') }
  return t('common.status.unknown')
}

export function formatChronicleDurationSeconds(
  t: ChronicleTranslate,
  value: number,
): string {
  if (value < 60) {
    return t('duration.seconds', { count: Math.max(0, Math.floor(value)) })
  }
  const minutes = Math.floor(value / 60)
  if (minutes < 60) {
    return t('duration.minutes', { count: minutes })
  }
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder === 0
    ? t('duration.hours', { count: hours })
    : t('duration.hoursMinutes', { hours, minutes: remainder })
}
