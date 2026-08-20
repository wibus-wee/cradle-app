import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { NodeAccessDialogView } from './node-access-dialog-view'
import type { FabricNode, NodeGrant } from './types'

const node: FabricNode = {
  nodeId: 'node-devbox',
  fabricId: 'fabric-1',
  displayName: 'Devbox',
  platform: 'linux',
  version: '1.4.0',
  capabilities: ['chat', 'terminal'],
  status: 'online',
  lastSeenAt: '2026-08-16T08:00:00.000Z',
  revision: 3,
}

function grant(overrides: Partial<NodeGrant>): NodeGrant {
  return {
    grantId: 'grant-1',
    controllerLabel: 'Wibus’s MacBook Pro',
    scope: 'control',
    revokedAt: null,
    ...overrides,
  }
}

const meta = {
  title: 'App/Nodes/Access Dialog',
  component: NodeAccessDialogView,
  args: {
    open: true,
    node,
    revokingGrantId: null,
    onOpenChange: fn(),
    onRevokeGrant: fn(),
  },
} satisfies Meta<typeof NodeAccessDialogView>

export default meta
type Story = StoryObj<typeof meta>

export const OnlyYou: Story = {
  args: { grants: [] },
}

export const WithGrants: Story = {
  args: {
    grants: [
      grant({}),
      grant({ grantId: 'grant-2', controllerLabel: 'iPad', scope: 'view' }),
      grant({ grantId: 'grant-3', controllerLabel: 'Old laptop', scope: 'admin', revokedAt: '2026-08-10T10:00:00.000Z' }),
    ],
  },
}
