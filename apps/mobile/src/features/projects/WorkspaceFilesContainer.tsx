import { useQuery } from '@tanstack/react-query'
import { router, Stack } from 'expo-router'
import { useState } from 'react'
import { Platform } from 'react-native'

import type {
  GetWorkspacesByWorkspaceIdFilesChildrenResponse,
  GetWorkspacesByWorkspaceIdFilesContentResponse,
  GetWorkspacesByWorkspaceIdFilesInfoResponse,
  GetWorkspacesByWorkspaceIdFilesSearchResponse,
} from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { useRouteIsActive } from '@/lib/app-lifecycle-context'
import { errorMessage } from '@/lib/errors'

import { WorkspaceFilesView } from './WorkspaceFilesView'

const MAX_TEXT_PREVIEW_BYTES = 128 * 1024

function parentPath(path: string): string {
  const separator = path.lastIndexOf('/')
  return separator < 0 ? '' : path.slice(0, separator)
}

interface WorkspaceFilesContainerProps {
  workspaceId: string
  initialPath?: string
  initialFile?: string
}

export function WorkspaceFilesContainer({
  workspaceId,
  initialPath = '',
  initialFile,
}: WorkspaceFilesContainerProps) {
  const { connection } = useConnection()
  const isRouteActive = useRouteIsActive()
  const [currentPath, setCurrentPath] = useState(
    () => initialFile ? parentPath(initialFile) : initialPath,
  )
  const [selectedFile, setSelectedFile] = useState<string | null>(initialFile ?? null)
  const [search, setSearch] = useState('')
  const normalizedSearch = search.trim()
  const showsInlineSearch = Platform.OS === 'web'
  const directoryQuery = useQuery({
    enabled: Boolean(connection) && isRouteActive && !selectedFile && !normalizedSearch,
    queryKey: ['workspace-files', connection?.url, workspaceId, currentPath],
    queryFn: ({ signal }) =>
      cradleRequest<GetWorkspacesByWorkspaceIdFilesChildrenResponse>(
        connection!,
        `/workspaces/${encodeURIComponent(workspaceId)}/files/children?path=${encodeURIComponent(currentPath)}`,
        { signal },
      ),
  })
  const searchQuery = useQuery({
    enabled: Boolean(connection) && isRouteActive && !selectedFile && Boolean(normalizedSearch),
    queryKey: ['workspace-file-search', connection?.url, workspaceId, normalizedSearch],
    queryFn: ({ signal }) =>
      cradleRequest<GetWorkspacesByWorkspaceIdFilesSearchResponse>(
        connection!,
        `/workspaces/${encodeURIComponent(workspaceId)}/files/search?q=${encodeURIComponent(normalizedSearch)}&limit=100`,
        { signal },
      ),
  })
  const infoQuery = useQuery({
    enabled: Boolean(connection) && isRouteActive && Boolean(selectedFile),
    queryKey: ['workspace-file-info', connection?.url, workspaceId, selectedFile],
    queryFn: ({ signal }) =>
      cradleRequest<GetWorkspacesByWorkspaceIdFilesInfoResponse>(
        connection!,
        `/workspaces/${encodeURIComponent(workspaceId)}/files/info?path=${encodeURIComponent(selectedFile!)}`,
        { signal },
      ),
  })
  const canPreview = Boolean(
    infoQuery.data
    && (infoQuery.data.previewKind === 'text' || infoQuery.data.previewKind === 'markdown')
    && infoQuery.data.size <= MAX_TEXT_PREVIEW_BYTES,
  )
  const contentQuery = useQuery({
    enabled: Boolean(connection) && isRouteActive && Boolean(selectedFile) && canPreview,
    queryKey: ['workspace-file-content', connection?.url, workspaceId, selectedFile],
    queryFn: ({ signal }) =>
      cradleRequest<GetWorkspacesByWorkspaceIdFilesContentResponse>(
        connection!,
        `/workspaces/${encodeURIComponent(workspaceId)}/files/content?path=${encodeURIComponent(selectedFile!)}`,
        { signal },
      ),
  })

  const goBack = () => {
    if (selectedFile) {
      setSelectedFile(null)
      return
    }
    if (normalizedSearch) {
      setSearch('')
      return
    }
    if (currentPath) {
      setCurrentPath(parentPath(currentPath))
      return
    }
    router.back()
  }

  const searchBar = !selectedFile && !showsInlineSearch
    ? (
        <Stack.SearchBar
          autoCapitalize="none"
          hideWhenScrolling
          onCancelButtonPress={() => setSearch('')}
          onChangeText={event => setSearch(event.nativeEvent.text)}
          onClose={() => setSearch('')}
          placeholder="Search workspace files"
          placement="stacked"
        />
      )
    : null

  if (selectedFile) {
    const fileError = infoQuery.error ?? contentQuery.error
    if (infoQuery.isPending || (canPreview && contentQuery.isPending)) {
      return <LoadingState />
    }
    if (fileError) {
      return (
        <ErrorState
          description={errorMessage(fileError)}
          title="Could not open file"
        />
      )
    }
    if (!infoQuery.data) {
      return <LoadingState />
    }
    const fileInfo = infoQuery.data
    return (
      <>
        <Stack.Screen options={{ title: fileInfo.name }} />
        <WorkspaceFilesView
          currentPath={currentPath}
          entries={[]}
          file={{
            content: contentQuery.data?.content ?? null,
            info: fileInfo,
            previewable: canPreview,
          }}
          onBack={goBack}
          onOpenDirectory={setCurrentPath}
          onOpenFile={setSelectedFile}
          onSearchChange={setSearch}
          search={search}
        />
      </>
    )
  }

  const activeEntriesQuery = normalizedSearch ? searchQuery : directoryQuery
  if (activeEntriesQuery.isPending) {
    return (
      <>
        {searchBar}
        <LoadingState />
      </>
    )
  }
  if (activeEntriesQuery.error) {
    return (
      <>
        {searchBar}
        <ErrorState
          title={normalizedSearch ? 'Could not search files' : 'Could not browse files'}
          description={errorMessage(activeEntriesQuery.error)}
        />
      </>
    )
  }
  return (
    <>
      <Stack.Screen options={{ title: currentPath || 'Files' }} />
      {searchBar}
      <WorkspaceFilesView
        currentPath={currentPath}
        entries={activeEntriesQuery.data}
        isRefreshing={activeEntriesQuery.isRefetching}
        onBack={goBack}
        onOpenDirectory={(path) => {
          setSearch('')
          setCurrentPath(path)
        }}
        onOpenFile={setSelectedFile}
        onRefresh={async () => { await activeEntriesQuery.refetch() }}
        onSearchChange={setSearch}
        search={search}
        showsInlineSearch={showsInlineSearch}
      />
    </>
  )
}
