import type { ModelDescriptor } from '~/features/agent-runtime/types'

export function filterModelsBySearch(models: ModelDescriptor[], search: string): ModelDescriptor[] {
  const normalizedSearch = search.trim().toLowerCase()
  if (!normalizedSearch) {
    return models
  }

  return models.filter(model =>
    model.label.toLowerCase().includes(normalizedSearch)
    || model.id.toLowerCase().includes(normalizedSearch))
}
