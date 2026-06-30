/**
 * Merged search hook that queries both models.dev and the Cradle Model
 * Registry, returning a single deduplicated result list.
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import {
  getModelRegistryMappingsOptions,
  getModelRegistryMappingsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { postProvidersModelSearch } from '~/api-gen/sdk.gen'

import type { SearchResultWithSource } from './schemas'
import { SearchResultListSchema } from './schemas'

// ── Debounce helper ──────────────────────────────────────────────────────────

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(() => {
      setDebounced(value)
    }, delayMs)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [value, delayMs])

  return debounced
}

// ── Registry → SearchResult conversion ───────────────────────────────────────

function capabilitiesFromModelsDevModel(model?: Record<string, unknown>) {
  if (!model) { return {} }

  return {
    contextWindow: typeof model.limit === 'object' && model.limit !== null
      ? (model.limit as Record<string, unknown>).context as number | undefined
      : undefined,
    maxOutput: typeof model.limit === 'object' && model.limit !== null
      ? (model.limit as Record<string, unknown>).output as number | undefined
      : undefined,
    inputModalities: typeof model.modalities === 'object' && model.modalities !== null
      ? (model.modalities as Record<string, unknown>).input as string[] | undefined
      : undefined,
    outputModalities: typeof model.modalities === 'object' && model.modalities !== null
      ? (model.modalities as Record<string, unknown>).output as string[] | undefined
      : undefined,
    reasoning: model.reasoning as boolean | undefined,
    toolCall: model.tool_call as boolean | undefined,
    temperature: model.temperature as boolean | undefined,
    structuredOutput: model.structured_output as boolean | undefined,
    cost: typeof model.cost === 'object' && model.cost !== null
      ? {
          input: (model.cost as Record<string, unknown>).input as number | undefined,
          output: (model.cost as Record<string, unknown>).output as number | undefined,
          cacheRead: (model.cost as Record<string, unknown>).cache_read as number | undefined,
          cacheWrite: (model.cost as Record<string, unknown>).cache_write as number | undefined,
        }
      : undefined,
    family: model.family as string | undefined,
    knowledgeCutoff: model.knowledge as string | undefined,
    releaseDate: model.release_date as string | undefined,
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useModelSearch(
  rawQuery: string,
): { results: SearchResultWithSource[], isPending: boolean } {
  const query = useDebouncedValue(rawQuery.trim(), 220)
  const enabled = query.length > 0

  // models.dev search (POST endpoint, no generated query options — use sdk directly)
  const { data: modelsDevResults = [], isFetching: searchingDev } = useQuery({
    queryKey: ['postProvidersModelSearch', query] as const,
    enabled,
    queryFn: async () => {
      const { data } = await postProvidersModelSearch({
        body: { query },
        throwOnError: true,
      })
      return SearchResultListSchema.parse(data)
    },
    staleTime: 60_000,
  })

  // Cradle Model Registry mappings (generated query options)
  const { data: registryMappings = [], isFetching: searchingRegistry } = useQuery({
    ...getModelRegistryMappingsOptions(),
    staleTime: 5 * 60_000,
  })

  // Filter registry mappings by query
  const registryResults: SearchResultWithSource[] = enabled
    ? registryMappings
        .filter((m) => {
          const needle = query.toLowerCase()
          return (
            m.modelId.toLowerCase().includes(needle)
            || m.registryModelId.toLowerCase().includes(needle)
            || m.model?.name?.toLowerCase().includes(needle)
          )
        })
        .map(m => ({
          id: m.registryModelId,
          label: m.model?.name ?? m.registryModelId,
          capabilities: capabilitiesFromModelsDevModel(m.model as Record<string, unknown> | undefined),
          source: 'registry' as const,
        }))
    : []

  // Merge and deduplicate by id (registry entries preferred)
  const merged: SearchResultWithSource[] = (() => {
    const byId = new Map<string, SearchResultWithSource>()

    // Registry entries first (higher priority)
    for (const r of registryResults) {
      byId.set(r.id, r)
    }
    // models.dev entries (skip duplicates already from registry)
    for (const r of modelsDevResults) {
      if (!byId.has(r.id)) {
        byId.set(r.id, { ...r, source: 'models-dev' })
      }
    }

    return [...byId.values()]
  })()

  // Deduplicate by id within models.dev results (API sometimes returns dupes)
  const seen = new Set<string>()
  const results = merged.filter((r) => {
    if (seen.has(r.id)) { return false }
    seen.add(r.id)
    return true
  })

  return {
    results,
    isPending: (enabled && searchingDev) || searchingRegistry,
  }
}

export { getModelRegistryMappingsQueryKey }
