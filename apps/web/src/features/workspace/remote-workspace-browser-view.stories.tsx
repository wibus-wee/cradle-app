import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'

import {
  remoteHostFixtures,
  remoteWorkspaceFileFixtures,
  remoteWorkspaceFixtures,
} from './fixtures/remote-workspaces'
import { RemoteWorkspaceBrowserView } from './remote-workspace-browser-view'

const workspaces = Object.values(remoteWorkspaceFixtures)

function RemoteWorkspaceBrowserCatalog() {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(
    remoteWorkspaceFixtures.cradle.id,
  )

  return (
    <RemoteWorkspaceBrowserView
      host={remoteHostFixtures.connected}
      workspaces={workspaces}
      selectedWorkspaceId={selectedWorkspaceId}
      files={remoteWorkspaceFileFixtures}
      workspacesLoading={false}
      workspacesError={null}
      filesLoading={false}
      filesError={null}
      creating={false}
      importingPath={false}
      onSelectWorkspace={setSelectedWorkspaceId}
      onBrowseAndImport={async () => {}}
      onMountExisting={async () => {}}
    />
  )
}

const meta = {
  title: 'App/Workspace/Remote Workspace Browser',
  component: RemoteWorkspaceBrowserView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-3 text-foreground sm:p-8">
        <section className="mx-auto min-h-112 w-full max-w-3xl bg-background p-3 sm:p-5">
          <Story />
        </section>
      </main>
    ),
  ],
  args: {
    host: remoteHostFixtures.connected,
    workspaces,
    selectedWorkspaceId: remoteWorkspaceFixtures.cradle.id,
    files: remoteWorkspaceFileFixtures,
    workspacesLoading: false,
    workspacesError: null,
    filesLoading: false,
    filesError: null,
    creating: false,
    importingPath: false,
    onSelectWorkspace: fn(),
    onBrowseAndImport: fn(async () => {}),
    onMountExisting: fn(async () => {}),
  },
} satisfies Meta<typeof RemoteWorkspaceBrowserView>

export default meta
type Story = StoryObj<typeof meta>

export const Interactive: Story = {
  render: () => <RemoteWorkspaceBrowserCatalog />,
  parameters: {
    controls: { disable: true },
  },
}

export const LoadingWorkspaces: Story = {
  args: {
    workspaces: [],
    selectedWorkspaceId: null,
    files: [],
    workspacesLoading: true,
  },
}

export const EmptyHost: Story = {
  args: {
    workspaces: [],
    selectedWorkspaceId: null,
    files: [],
  },
}

export const LoadingFiles: Story = {
  args: {
    files: [],
    filesLoading: true,
  },
}

export const Errors: Story = {
  args: {
    workspacesError:
      'Unable to reach the remote Cradle server. Check the host connection.',
    files: [],
    filesError: 'The selected workspace could not return its file list.',
  },
}

export const ImportingPath: Story = {
  args: {
    importingPath: true,
  },
}
