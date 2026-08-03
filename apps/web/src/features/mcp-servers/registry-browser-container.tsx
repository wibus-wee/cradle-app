import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { getMcpServersRegistryServers } from '~/api-gen/sdk.gen'

import type { RegistryCandidate } from './registry-browser'
import { RegistryBrowserView } from './registry-browser'

const SEARCH_DEBOUNCE_MS = 300

export interface RegistryBrowserProps {
  onInstall: (candidate: RegistryCandidate) => void
}

export function RegistryBrowser({ onInstall }: RegistryBrowserProps) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  const query = useInfiniteQuery({
    queryKey: ['mcp-servers-registry', debouncedSearch],
    initialPageParam: '',
    queryFn: async ({ pageParam }) => {
      const { data, error } = await getMcpServersRegistryServers({
        query: {
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      })
      if (error) { throw new Error(String(error)) }
      return data
    },
    getNextPageParam: lastPage => lastPage?.nextCursor ?? undefined,
  })

  const candidates = query.data?.pages.flatMap(page => page?.servers ?? []) ?? []

  return (
    <RegistryBrowserView
      search={search}
      candidates={candidates}
      isLoading={query.isLoading}
      isError={query.isError}
      hasNextPage={query.hasNextPage ?? false}
      isFetchingNextPage={query.isFetchingNextPage}
      onSearchChange={setSearch}
      onRetry={() => void query.refetch()}
      onLoadMore={() => void query.fetchNextPage()}
      onInstall={onInstall}
    />
  )
}
