import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import type { NodeWorkspaceEntry } from '~/features/nodes/node-grouping'
import { NodeWorkspacePickerView } from '~/features/nodes/node-workspace-picker-view'
import type { FabricNode } from '~/features/nodes/types'

import { WorkspaceAddDialogView } from './workspace-add-dialog-view'

const meta = {
  title: 'App/Workspace/Add Workspace Dialog',
  component: WorkspaceAddDialogView,
  args: {
    open: true,
    creating: false,
    onOpenChange: fn(),
    onAddLocal: fn(),
  },
} satisfies Meta<typeof WorkspaceAddDialogView>

export default meta
type Story = StoryObj<typeof meta>

export const Local: Story = {}

export const Creating: Story = {
  args: {
    creating: true,
  },
}

const fixtureNodes: FabricNode[] = [
  {
    nodeId: 'node-macbook',
    fabricId: 'fabric-example',
    displayName: 'wibusdeMacBook-Air-M2',
    platform: 'darwin',
    version: 'cradle-server',
    capabilities: ['chat', 'workspace', 'terminal'],
    status: 'online',
    lastSeenAt: '2026-08-18T12:05:00.000Z',
    revision: 2,
    scopes: ['admin'],
  },
  {
    nodeId: 'node-studio',
    fabricId: 'fabric-example',
    displayName: 'Studio Mac',
    platform: 'darwin',
    version: 'cradle-server',
    capabilities: ['chat', 'workspace'],
    status: 'offline',
    lastSeenAt: '2026-08-17T09:00:00.000Z',
    revision: 1,
    scopes: ['admin'],
  },
]

const fixtureEntries: NodeWorkspaceEntry[] = [
  {
    key: 'github.com/wibus/cradle-app',
    name: 'cradle-app',
    originUrl: 'https://github.com/wibus/cradle-app.git',
    repoRoot: '/Users/wibus/dev/cradle-app',
    targets: [{
      nodeId: 'node-macbook',
      nodeName: 'wibusdeMacBook-Air-M2',
      path: '/Users/wibus/dev/cradle-app',
      alreadyAdded: false,
    }],
  },
  {
    key: 'github.com/wibus/ag-vibe',
    name: 'ag-vibe',
    originUrl: 'https://github.com/wibus/ag-vibe.git',
    repoRoot: '/Users/wibus/dev/ag-vibe',
    targets: [{
      nodeId: 'node-macbook',
      nodeName: 'wibusdeMacBook-Air-M2',
      path: '/Users/wibus/dev/ag-vibe',
      alreadyAdded: true,
    }],
  },
]

export const WithRemoteDevices: Story = {
  args: {
    nodePicker: (
      <NodeWorkspacePickerView
        nodes={fixtureNodes}
        selectedNodeId="node-macbook"
        entries={fixtureEntries}
        loading={false}
        selectedNodeOffline={false}
        addingTargetKey={null}
        onSelectNode={fn()}
        onReconnect={fn()}
        onAddWorkspace={fn()}
      />
    ),
  },
}
