import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { GetRemoteHostsResponse } from '~/api-gen/types.gen'
import { toastManager } from '~/components/ui/toast'
import { useDirectoryPicker } from '~/features/filesystem/directory-picker-provider'
import {
  fetchRemoteUpstreamJson,
  remoteHostUpstreamQueryKey,
} from '~/features/remote-hosts/upstream-fetch'

import type { WorkspaceFileEntry } from './api/files'
import { RemoteWorkspaceBrowserView } from './remote-workspace-browser-view'
import { ensureRemoteWorkspaceForPath } from './remote-workspace-import'
import type { Workspace } from './types'
import type { CreateWorkspaceInput } from './use-workspace'

type RemoteHost = GetRemoteHostsResponse[number]

const EMPTY_REMOTE_WORKSPACES: Workspace[] = []
const EMPTY_REMOTE_WORKSPACE_FILES: WorkspaceFileEntry[] = []

export interface RemoteWorkspaceBrowserProps {
  host: RemoteHost
  creating: boolean
  onCreate: (input: CreateWorkspaceInput) => Promise<void>
}

function remoteHostWorkspacesQueryKey(hostId: string) {
  return remoteHostUpstreamQueryKey(hostId, 'workspaces')
}

function remoteHostFilesQueryKey(hostId: string, workspaceId: string) {
  return remoteHostUpstreamQueryKey(hostId, workspaceId, 'files')
}

function formatError(error: Error | null): string | null {
  return error?.message ?? null
}

export function RemoteWorkspaceBrowser({
  host,
  creating,
  onCreate,
}: RemoteWorkspaceBrowserProps) {
  const { t } = useTranslation('workspace')
  const { selectDirectory } = useDirectoryPicker()
  const queryClient = useQueryClient()
  const [selectedWorkspaceId, setSelectedWorkspaceId]
    = useState<string | null>(null)
  const [importingPath, setImportingPath] = useState(false)

  const workspacesQuery = useQuery({
    queryKey: remoteHostWorkspacesQueryKey(host.id),
    queryFn: () => fetchRemoteUpstreamJson<Workspace[]>(
      host.id,
      '/workspaces',
    ),
    retry: false,
  })
  const workspaces = workspacesQuery.data ?? EMPTY_REMOTE_WORKSPACES
  const selectedWorkspace = workspaces.find(
    workspace => workspace.id === selectedWorkspaceId,
  ) ?? workspaces[0] ?? null

  const filesQuery = useQuery({
    queryKey: remoteHostFilesQueryKey(
      host.id,
      selectedWorkspace?.id ?? '',
    ),
    queryFn: () => fetchRemoteUpstreamJson<WorkspaceFileEntry[]>(
      host.id,
      `/workspaces/${encodeURIComponent(selectedWorkspace?.id ?? '')}/files`,
    ),
    enabled: selectedWorkspace !== null,
    retry: false,
  })

  const handleMountExisting = useCallback(async () => {
    if (!selectedWorkspace) {
      return
    }

    await onCreate({
      name: selectedWorkspace.name,
      locator: {
        hostId: host.id,
        path: selectedWorkspace.locator.path,
        kind: selectedWorkspace.locator.kind,
        sourceWorkspaceId: selectedWorkspace.id,
      },
      gitIdentity: selectedWorkspace.gitIdentity,
    })
  }, [host.id, onCreate, selectedWorkspace])

  const handleBrowseAndImport = useCallback(async () => {
    setImportingPath(true)
    try {
      const path = await selectDirectory({
        hostId: host.id,
        title: t('workspace.dialog.remoteBrowseTitle'),
        description: t('workspace.dialog.remoteBrowseDescription', {
          hostName: host.displayName,
        }),
      })
      if (!path) {
        return
      }
      const input = await ensureRemoteWorkspaceForPath(host.id, path)
      await onCreate(input)
      await queryClient.invalidateQueries({
        queryKey: remoteHostWorkspacesQueryKey(host.id),
      })
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('workspace.toast.remoteWorkspaceCreateFailed'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
    finally {
      setImportingPath(false)
    }
  }, [
    host.displayName,
    host.id,
    onCreate,
    queryClient,
    selectDirectory,
    t,
  ])

  return (
    <RemoteWorkspaceBrowserView
      host={host}
      workspaces={workspaces}
      selectedWorkspaceId={selectedWorkspace?.id ?? null}
      files={filesQuery.data ?? EMPTY_REMOTE_WORKSPACE_FILES}
      workspacesLoading={workspacesQuery.isLoading}
      workspacesError={formatError(workspacesQuery.error)}
      filesLoading={filesQuery.isLoading}
      filesError={formatError(filesQuery.error)}
      creating={creating}
      importingPath={importingPath}
      onSelectWorkspace={setSelectedWorkspaceId}
      onBrowseAndImport={handleBrowseAndImport}
      onMountExisting={handleMountExisting}
    />
  )
}
