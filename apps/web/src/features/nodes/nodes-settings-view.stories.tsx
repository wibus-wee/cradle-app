import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { NodesSettingsView } from './nodes-settings-view'

const meta = {
  title: 'App/Nodes/Devices Settings',
  component: NodesSettingsView,
  parameters: { layout: 'padded' },
  args: {
    membership: null,
    pendingEnrollment: null,
    pendingInviteCode: null,
    membershipLoading: false,
    membershipError: false,
    managedRelay: { relayUrl: 'http://192.168.1.20:8787', accessMode: 'network' },
    nodes: [],
    nodesLoading: false,
    nodesError: false,
    controllers: [],
    controllersLoading: false,
    controllersError: false,
    pendingRequests: [],
    pendingRequestsLoading: false,
    pendingRequestsError: false,
    pendingRequestAction: null,
    pendingControllerRequests: [],
    pendingControllerRequestsLoading: false,
    pendingControllerRequestsError: false,
    pendingControllerAction: null,
    networkCode: null,
    canManageAccess: false,
    reconnectingNodeId: null,
    removingNodeId: null,
    cancellingEnrollment: false,
    leavingFabric: false,
    onLinkDevice: fn(),
    onReconnect: fn(),
    onManageAccess: fn(),
    onRemoveNode: fn(),
    onRefreshMembership: fn(),
    onRefreshNodes: fn(),
    onRefreshPendingRequests: fn(),
    onApprovePendingRequest: fn(),
    onRejectPendingRequest: fn(),
    onReviewPendingController: fn(),
    onRejectPendingController: fn(),
    onCancelPendingEnrollment: fn(),
    onLeaveFabric: fn(),
    fabricSettings: null,
  },
} satisfies Meta<typeof NodesSettingsView>

export default meta
type Story = StoryObj<typeof meta>

export const NotConnected: Story = {}

export const WaitingForApproval: Story = {
  args: {
    pendingEnrollment: {
      version: 1,
      relayUrl: 'http://192.168.1.20:8787',
      fabricId: 'fabric-example',
      requestId: 'request-example',
      deliverySecret: 'delivery-secret',
      expiresAt: '2026-08-18T12:30:00.000Z',
      createdAt: 1_787_030_400,
    },
    pendingInviteCode: 'eyJ2ZXJzaW9uIjoxLCJyZWxheVVybCI6Imh0dHA6Ly8xOTIuMTY4LjEuMjA6ODc4NyJ9',
  },
}

export const LegacyWaitingState: Story = {
  args: {
    pendingEnrollment: {
      version: 1,
      relayUrl: 'http://127.0.0.1:8787',
      fabricId: 'fabric-legacy',
      requestId: 'request-legacy',
      deliverySecret: 'delivery-secret',
      expiresAt: null,
      createdAt: 1_787_030_400,
    },
  },
}

export const OwnerWithPendingApproval: Story = {
  args: {
    membership: {
      fabricId: 'fabric-example',
      relayUrl: 'http://192.168.1.20:8787',
      localNodeId: 'node-owner',
      role: 'owner',
      ownerPubkey: 'owner-public-key',
      nodeCertificate: {},
      controllerCertificate: {},
      createdAt: 1_787_030_400,
      updatedAt: 1_787_030_400,
    },
    canManageAccess: true,
    networkCode: 'fabric-network-code',
    pendingRequests: [{
      requestId: 'join-new-mac',
      displayName: 'Studio Mac',
      platform: 'darwin',
      version: 'cradle-server',
      capabilities: ['chat', 'workspace', 'terminal'],
      requestedAt: '2026-08-18T12:04:00.000Z',
      expiresAt: '2026-08-18T12:19:00.000Z',
    }],
    pendingControllerRequests: [{
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
    }],
    nodes: [{
      nodeId: 'node-owner',
      fabricId: 'fabric-example',
      displayName: 'Main Mac',
      platform: 'darwin',
      version: 'cradle-server',
      capabilities: ['chat', 'workspace', 'terminal'],
      status: 'online',
      lastSeenAt: '2026-08-18T12:05:00.000Z',
      revision: 2,
      scopes: ['admin'],
    }],
    controllers: [{
      controllerId: 'controller-subject-iphone',
      displayName: 'Wibus’s iPhone',
      grants: [{
        grantId: 'grant-iphone-control',
        controllerId: 'controller-subject-iphone',
        controllerLabel: 'Wibus’s iPhone',
        nodeId: 'node-owner',
        scope: 'control',
        revokedAt: null,
      }],
    }],
  },
}
