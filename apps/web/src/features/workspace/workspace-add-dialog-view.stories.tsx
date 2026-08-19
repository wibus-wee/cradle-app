import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
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
    nodes: [],
    selectedNodeId: null,
    onSelectNode: fn(),
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
  render: function WithRemoteDevicesStory(args) {
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
    const selectedNode = fixtureNodes.find(node => node.nodeId === selectedNodeId) ?? null
    return (
      <WorkspaceAddDialogView
        {...args}
        nodes={fixtureNodes}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        nodePane={selectedNode
          ? (
              <NodeWorkspacePickerView
                entries={selectedNode.status === 'online' ? fixtureEntries : []}
                loading={false}
                selectedNodeOffline={selectedNode.status === 'offline'}
                addingTargetKey={null}
                onReconnect={fn()}
                onAddWorkspace={fn()}
              />
            )
          : null}
      />
    )
  },
}
