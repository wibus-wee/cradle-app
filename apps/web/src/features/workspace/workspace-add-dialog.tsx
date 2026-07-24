import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { getRemoteHostsOptions } from '~/api-gen/@tanstack/react-query.gen'
import type { GetRemoteHostsResponse } from '~/api-gen/types.gen'

import { RemoteWorkspaceBrowser } from './remote-workspace-browser'
import type { CreateWorkspaceInput } from './use-workspace'
import { WorkspaceAddDialogView } from './workspace-add-dialog-view'

const EMPTY_REMOTE_HOSTS: GetRemoteHostsResponse = []

export interface WorkspaceAddDialogProps {
  open: boolean
  creating: boolean
  onOpenChange: (open: boolean) => void
  onAddLocal: () => void
  onCreateRemote: (input: CreateWorkspaceInput) => Promise<void>
}

export function WorkspaceAddDialog({
  open,
  creating,
  onOpenChange,
  onAddLocal,
  onCreateRemote,
}: WorkspaceAddDialogProps) {
  const [selectedHostId, setSelectedHostId] = useState('local')
  const remoteHostsQuery = useQuery({
    ...getRemoteHostsOptions(),
    enabled: open,
  })
  const remoteHosts = remoteHostsQuery.data ?? EMPTY_REMOTE_HOSTS
  const selectedRemoteHost = remoteHosts.find(
    host => host.id === selectedHostId,
  ) ?? null

  useEffect(() => {
    if (!open) {
      setSelectedHostId('local')
    }
  }, [open])

  return (
    <WorkspaceAddDialogView
      open={open}
      creating={creating}
      remoteHosts={remoteHosts}
      remoteHostsLoading={remoteHostsQuery.isLoading}
      remoteHostsError={remoteHostsQuery.error?.message ?? null}
      selectedHostId={selectedHostId}
      remoteContent={selectedRemoteHost
        ? (
            <RemoteWorkspaceBrowser
              key={selectedRemoteHost.id}
              host={selectedRemoteHost}
              creating={creating}
              onCreate={onCreateRemote}
            />
          )
        : null}
      onOpenChange={onOpenChange}
      onSelectHost={setSelectedHostId}
      onAddLocal={onAddLocal}
    />
  )
}
