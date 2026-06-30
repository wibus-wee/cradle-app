import { z } from 'zod'

import type { ModelDescriptor } from '~/features/agent-runtime/types'

export const ALL_MODELS_DISABLED_SENTINEL = '__all_disabled__'

export type ModelVisibility
  = | { kind: 'all' }
    | { kind: 'none' }
    | { kind: 'list', ids: Set<string> }

export const ModelVisibilitySchema = z.array(z.string().min(1))
  .default([])
  .transform((values): ModelVisibility => {
    const ids = values.filter(Boolean)
    if (ids.length === 0) {
      return { kind: 'all' }
    }
    if (ids.length === 1 && ids[0] === ALL_MODELS_DISABLED_SENTINEL) {
      return { kind: 'none' }
    }

    return {
      kind: 'list',
      ids: new Set(ids.filter(id => id !== ALL_MODELS_DISABLED_SENTINEL)),
    }
  })

export function modelIsVisible(visibility: ModelVisibility, modelId: string): boolean {
  switch (visibility.kind) {
    case 'all':
      return true
    case 'none':
      return false
    case 'list':
      return visibility.ids.has(modelId)
  }
}

export function filterVisibleModels(models: ModelDescriptor[], visibility: ModelVisibility): ModelDescriptor[] {
  if (visibility.kind === 'all') {
    return models
  }
  if (visibility.kind === 'none') {
    return []
  }
  return models.filter(model => visibility.ids.has(model.id))
}
