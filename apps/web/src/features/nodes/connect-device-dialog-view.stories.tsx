import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { ConnectDeviceDialogView } from './connect-device-dialog-view'

const meta = {
  title: 'App/Nodes/Connect Device Dialog',
  component: ConnectDeviceDialogView,
  args: {
    open: true,
    busy: false,
    managedRelay: { relayUrl: 'http://192.168.1.20:8787', accessMode: 'network' },
    networkCode: null,
    inviteCode: null,
    awaitingApproval: false,
    onOpenChange: fn(),
    onStart: fn(),
    onGetCode: fn(),
    onSubmitCode: fn(),
  },
} satisfies Meta<typeof ConnectDeviceDialogView>

export default meta
type Story = StoryObj<typeof meta>

/** No network yet: two plain-language choices. */
export const Choose: Story = {
  args: { fabricExists: false },
}

/** Network exists: show my network code and accept another computer's invite. */
export const AddComputer: Story = {
  args: {
    fabricExists: true,
    networkCode: 'eyJyZWxheVVybCI6Imh0dHBzOi8vcmVsYXkuZXhhbXBsZS5jb20iLCJmYWJyaWNJZCI6ImZhYnJpYy0xIn0',
  },
}

/** This device generated its invite code and is waiting for approval. */
export const WaitingForApproval: Story = {
  args: {
    fabricExists: false,
    inviteCode: 'eyJmYWJyaWNJZCI6ImZhYnJpYy0xIiwicmVxdWVzdElkIjoicmVxLTkiLCJzZWNyZXQiOiJzM2NyZXQifQ',
    awaitingApproval: true,
  },
}
