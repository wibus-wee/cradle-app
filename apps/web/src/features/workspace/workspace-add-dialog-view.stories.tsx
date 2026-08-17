import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

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
