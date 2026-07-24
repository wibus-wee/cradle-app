import type { TFunction } from 'i18next'
import { z } from 'zod'

import type { DownloadTask } from '~/features/download-center/types'

import type { ChronicleModelResource } from './use-chronicle'

export type ChronicleResourceTone
  = | 'ready'
    | 'optional'
    | 'warning'
    | 'error'
    | 'loading'

const MODEL_RESOURCE_CATEGORIES: readonly ChronicleModelResource['category'][] = [
  'ocr',
  'audio-vad',
  'audio-asr',
  'speaker',
  'embedding',
  'pii',
]

const ModelResourceManifestSchema = z.object({
  files: z.array(z.object({
    sourceUrl: z.string(),
  }).passthrough()).default([]),
}).passthrough().default({ files: [] })

export function modelResourceCategoryForDownload(
  task: DownloadTask,
): ChronicleModelResource['category'] | null {
  if (task.scope !== 'server') {
    return null
  }
  const separator = task.owner.resourceId.indexOf(':')
  if (separator === -1) {
    return null
  }
  const category = task.owner.resourceId.slice(0, separator)
  return MODEL_RESOURCE_CATEGORIES.includes(
    category as ChronicleModelResource['category'],
  )
    ? category as ChronicleModelResource['category']
    : null
}

export function getChronicleResourceTone(
  resource: ChronicleModelResource,
): ChronicleResourceTone {
  if (resource.state === 'available') {
    return 'ready'
  }
  if (resource.state === 'installing') {
    return 'loading'
  }
  if (resource.state === 'error') {
    return 'error'
  }
  if (resource.required) {
    return 'warning'
  }
  return 'optional'
}

export function hasVerifiedChronicleManifestDownload(
  resource: ChronicleModelResource,
): boolean {
  return ModelResourceManifestSchema.parse(resource.metadata?.manifest).files.length > 0
}

export function getChronicleResourceStateLabel(
  t: TFunction<'chronicle'>,
  resource: ChronicleModelResource,
): string {
  if (resource.state === 'available') {
    return t('resource.state.available')
  }
  if (resource.state === 'installing') {
    return t('resource.state.installing')
  }
  if (resource.state === 'error') {
    return t('common.status.error')
  }
  if (resource.required) {
    return t('resource.state.missing')
  }
  return t('resource.state.optional')
}
