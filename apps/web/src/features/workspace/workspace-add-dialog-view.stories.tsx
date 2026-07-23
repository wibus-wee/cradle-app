import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'

import {
  remoteHostFixtures,
  remoteWorkspaceFileFixtures,
  remoteWorkspaceFixtures,
} from './fixtures/remote-workspaces'
import { RemoteWorkspaceBrowserView } from './remote-workspace-browser-view'
import { WorkspaceAddDialogView } from './workspace-add-dialog-view'

const remoteHosts = Object.values(remoteHostFixtures)
const remoteWorkspaces = Object.values(remoteWorkspaceFixtures)

interface WorkspaceAddDialogCatalogProps {
  initialHostId: string
  creating?: boolean
}

function WorkspaceAddDialogCatalog({
  initialHostId,
  creating = false,
}: WorkspaceAddDialogCatalogProps) {
  const [open, setOpen] = useState(true)
  const [selectedHostId, setSelectedHostId] = useState(initialHostId)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(
    remoteWorkspaceFixtures.cradle.id,
  )
  const selectedHost = remoteHosts.find(
    host => host.id === selectedHostId,
  ) ?? null

  return (
    <WorkspaceAddDialogView
      open={open}
      creating={creating}
      remoteHosts={remoteHosts}
      remoteHostsLoading={false}
      remoteHostsError={null}
      selectedHostId={selectedHostId}
      remoteContent={selectedHost
        ? (
            <RemoteWorkspaceBrowserView
              host={selectedHost}
              workspaces={remoteWorkspaces}
              selectedWorkspaceId={selectedWorkspaceId}
              files={remoteWorkspaceFileFixtures}
              workspacesLoading={false}
              workspacesError={null}
              filesLoading={false}
              filesError={null}
              creating={creating}
              importingPath={false}
              onSelectWorkspace={setSelectedWorkspaceId}
              onBrowseAndImport={async () => {}}
              onMountExisting={async () => {}}
            />
          )
        : null}
      onOpenChange={setOpen}
      onSelectHost={setSelectedHostId}
      onAddLocal={() => {}}
    />
  )
}

const meta = {
  title: 'App/Workspace/Add Workspace Dialog',
  component: WorkspaceAddDialogView,
  args: {
    open: true,
    creating: false,
    remoteHosts,
    remoteHostsLoading: false,
    remoteHostsError: null,
    selectedHostId: 'local',
    remoteContent: null,
    onOpenChange: fn(),
    onSelectHost: fn(),
    onAddLocal: fn(),
  },
} satisfies Meta<typeof WorkspaceAddDialogView>

export default meta
type Story = StoryObj<typeof meta>

export const Local: Story = {
  render: () => <WorkspaceAddDialogCatalog initialHostId="local" />,
  parameters: {
    controls: { disable: true },
  },
}

export const Remote: Story = {
  render: () => (
    <WorkspaceAddDialogCatalog
      initialHostId={remoteHostFixtures.connected.id}
    />
  ),
  parameters: {
    controls: { disable: true },
  },
}

export const CreatingRemote: Story = {
  render: () => (
    <WorkspaceAddDialogCatalog
      initialHostId={remoteHostFixtures.connected.id}
      creating
    />
  ),
  parameters: {
    controls: { disable: true },
  },
}

export const LoadingHosts: Story = {
  args: {
    remoteHosts: [],
    remoteHostsLoading: true,
  },
}

export const HostError: Story = {
  args: {
    remoteHosts: [],
    remoteHostsError:
      'Remote hosts are unavailable. Check the server connection and try again.',
  },
}
