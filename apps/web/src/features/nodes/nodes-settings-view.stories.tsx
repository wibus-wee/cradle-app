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
    networkCode: null,
    canManageAccess: false,
    reconnectingNodeId: null,
    cancellingEnrollment: false,
    onLinkDevice: fn(),
    onReconnect: fn(),
    onManageAccess: fn(),
    onRefreshMembership: fn(),
    onCancelPendingEnrollment: fn(),
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
