import { useQuery } from '@tanstack/react-query'
import { Directory, File, Paths } from 'expo-file-system'
import { router, Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, Platform, Share } from 'react-native'

import type {
  GetWorkspacesByWorkspaceIdFilesChildrenResponse,
  GetWorkspacesByWorkspaceIdFilesContentResponse,
  GetWorkspacesByWorkspaceIdFilesInfoResponse,
  GetWorkspacesByWorkspaceIdFilesSearchResponse,
} from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import type { ServerConnection } from '@/lib/api'
import { cradleRequest } from '@/lib/api'
import { useRouteIsActive } from '@/lib/app-lifecycle-context'
import { errorMessage } from '@/lib/errors'
import { openQuickLook } from '@/native/quick-look'

import { WorkspaceFilesView } from './WorkspaceFilesView'

const MAX_TEXT_PREVIEW_BYTES = 128 * 1024

function parentPath(path: string): string {
  const separator = path.lastIndexOf('/')
  return separator < 0 ? '' : path.slice(0, separator)
}

async function downloadWorkspaceFile(
  connection: ServerConnection,
  workspaceId: string,
  path: string,
  name: string,
): Promise<File> {
  const cacheDirectory = new Directory(Paths.cache, 'cradle-files')
  cacheDirectory.create({ idempotent: true, intermediates: true })
  const destination = new File(cacheDirectory, name)
  const rawUrl
    = `${connection.url}/workspaces/${encodeURIComponent(workspaceId)}/files/raw?path=${encodeURIComponent(path)}`
  return File.downloadFileAsync(rawUrl, destination, {
    headers: connection.token ? { authorization: `Bearer ${connection.token}` } : undefined,
    idempotent: true,
  })
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
  const [fileAction, setFileAction] = useState<'preview' | 'share' | null>(null)
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

  const shareFile = async (name: string) => {
    if (!connection || !selectedFile || fileAction) { return }
    setFileAction('share')
    try {
      const downloaded = await downloadWorkspaceFile(connection, workspaceId, selectedFile, name)
      await Share.share({ title: name, url: downloaded.uri })
    }
    catch {
      Alert.alert('Could not share file', 'The file could not be downloaded to this device.')
    }
    finally {
      setFileAction(null)
    }
  }

  const previewFile = async (name: string) => {
    if (!connection || !selectedFile || fileAction) { return }
    setFileAction('preview')
    try {
      const downloaded = await downloadWorkspaceFile(connection, workspaceId, selectedFile, name)
      await openQuickLook(downloaded.uri)
    }
    catch {
      Alert.alert(
        'Could not preview file',
        'The file could not be downloaded or is not supported by iOS Quick Look.',
      )
    }
    finally {
      setFileAction(null)
    }
  }

  if (selectedFile) {
    const fileError = infoQuery.error ?? contentQuery.error
    if (infoQuery.isPending || (canPreview && contentQuery.isPending)) {
      return <LoadingState />
    }
    if (fileError) {
      return (
        <ErrorState
          description={errorMessage(fileError)}
          isActionPending={infoQuery.isFetching || (canPreview && contentQuery.isFetching)}
          onAction={() => {
            void infoQuery.refetch()
            if (canPreview) { void contentQuery.refetch() }
          }}
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
        {Platform.OS === 'ios' && (
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button
              accessibilityHint="Downloads the original file and opens it in iOS Quick Look"
              accessibilityLabel={`Preview ${fileInfo.name}`}
              disabled={fileAction !== null}
              onPress={() => { void previewFile(fileInfo.name) }}
            >
              <Stack.Toolbar.Icon sf="eye" />
              <Stack.Toolbar.Label>
                {fileAction === 'preview' ? 'Opening…' : 'Quick Look'}
              </Stack.Toolbar.Label>
            </Stack.Toolbar.Button>
            <Stack.Toolbar.Button
              accessibilityHint="Downloads the original file and opens the system share sheet"
              accessibilityLabel={`Share ${fileInfo.name}`}
              disabled={fileAction !== null}
              onPress={() => { void shareFile(fileInfo.name) }}
            >
              <Stack.Toolbar.Icon sf="square.and.arrow.up" />
              <Stack.Toolbar.Label>
                {fileAction === 'share' ? 'Sharing…' : 'Share'}
              </Stack.Toolbar.Label>
            </Stack.Toolbar.Button>
          </Stack.Toolbar>
        )}
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
          isActionPending={activeEntriesQuery.isFetching}
          onAction={() => { void activeEntriesQuery.refetch() }}
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
