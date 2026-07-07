import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { ChronicleSearchHit } from '~/features/search/types'
import { getServerUrl } from '~/lib/electron'

import { ChronicleSearchHitsSchema } from './chronicle-search-normalize'

const DEBOUNCE_MS = 150

const chronicleSearchQueryKey = (
  query: string,
  workspaceId?: string | null,
) => ['chronicle-search', workspaceId ?? null, query] as const

interface UseChronicleSearchOptions {
  query: string
  workspaceId?: string | null
  enabled?: boolean
}

export function useChronicleSearch({
  query,
  workspaceId,
  enabled = true,
}: UseChronicleSearchOptions) {
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  useEffect(() => {
    const timer = setTimeout(setDebouncedQuery, DEBOUNCE_MS, query)
    return () => clearTimeout(timer)
  }, [query])

  const currentTrimmed = query.trim()
  const trimmed = debouncedQuery.trim()

  const { data = [], isFetching } = useQuery<ChronicleSearchHit[]>({
    queryKey: chronicleSearchQueryKey(trimmed, workspaceId ?? null),
    queryFn: async () => {
      if (!trimmed) {
        return []
      }
      const params = new URLSearchParams({
        query: trimmed,
        limit: '10',
      })
      if (workspaceId) {
        params.set('workspaceId', workspaceId)
      }
      const response = await fetch(`${getServerUrl()}/search/chronicle?${params.toString()}`)
      if (!response.ok) {
        throw new Error(`Chronicle search failed with status ${response.status}`)
      }
      return ChronicleSearchHitsSchema.parse(await response.json()) satisfies ChronicleSearchHit[]
    },
    enabled: enabled && !!trimmed,
    staleTime: 5_000,
  })

  const isPending = enabled && currentTrimmed.length > 0 && (isFetching || debouncedQuery !== query)

  return {
    hits: data,
    isPending,
    hasQuery: trimmed.length > 0,
  }
}
