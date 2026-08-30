import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'

import type { GetWorkspacesByWorkspaceIdFilesSearchResponse } from '@/api-gen'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { useRouteIsActive } from '@/lib/app-lifecycle-context'
import { errorMessage } from '@/lib/errors'

import { WorkspaceSearchView } from './WorkspaceSearchView'

const SEARCH_DEBOUNCE_MS = 250

export function WorkspaceSearchContainer({ workspaceId }: { workspaceId: string }) {
  const { connection } = useConnection()
  const isRouteActive = useRouteIsActive()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const search = useQuery({
    enabled: Boolean(connection && debouncedQuery) && isRouteActive,
    queryKey: ['workspace-file-search', connection?.url, workspaceId, debouncedQuery],
    queryFn: ({ signal }) =>
      cradleRequest<GetWorkspacesByWorkspaceIdFilesSearchResponse>(
        connection!,
        `/workspaces/${encodeURIComponent(workspaceId)}/files/search?q=${encodeURIComponent(debouncedQuery)}&limit=50`,
        { signal },
      ),
  })

  return (
    <WorkspaceSearchView
      error={search.error ? errorMessage(search.error) : null}
      isSearching={Boolean(query.trim()) && (query.trim() !== debouncedQuery || search.isFetching)}
      onOpenDirectory={path => router.push({
        pathname: '/workspace-directory',
        params: { workspaceId, path },
      })}
      onOpenFile={path => router.push({
        pathname: '/workspace-file',
        params: { workspaceId, path },
      })}
      onQueryChange={setQuery}
      onRetry={() => void search.refetch()}
      query={query}
      results={search.data ?? []}
    />
  )
}
