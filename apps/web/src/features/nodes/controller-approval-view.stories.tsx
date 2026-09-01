import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { ControllerApprovalView } from './controller-approval-view'
import type { FabricNode, PendingFabricControllerRequest } from './types'

const request: PendingFabricControllerRequest = {
  requestId: 'controller-iphone',
  subjectId: 'controller-subject-iphone',
  identityPubkey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  encryptionPubkey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
  displayName: 'Wibus’s iPhone',
  platform: 'ios',
  version: '1.0.0',
  capabilities: ['chat', 'workspace'],
  requestedAt: '2026-08-18T12:06:00.000Z',
  expiresAt: '2026-08-18T12:21:00.000Z',
}

const nodes: FabricNode[] = [
  {
    nodeId: 'node-main-mac',
    fabricId: 'fabric-example',
    displayName: 'Main Mac',
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
    lastSeenAt: '2026-08-18T11:40:00.000Z',
    revision: 1,
    scopes: ['admin'],
  },
]

const meta = {
  title: 'App/Nodes/Controller Approval',
  component: ControllerApprovalView,
  args: {
    open: true,
    request,
    identityFingerprint: 'ad31f46e83b71592',
    nodes,
    submitting: false,
    onOpenChange: fn(),
    onApprove: fn(),
  },
} satisfies Meta<typeof ControllerApprovalView>

export default meta
type Story = StoryObj<typeof meta>

export const MultiNode: Story = {}

export const NoAvailableNodes: Story = {
  args: { nodes: [] },
}

export const Submitting: Story = {
  args: { submitting: true },
}
