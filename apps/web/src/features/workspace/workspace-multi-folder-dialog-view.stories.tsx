import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { WorkspaceMultiFolderDialogView } from './workspace-multi-folder-dialog-view'

const meta = {
  title: 'App/Workspace/Multi-folder Dialog',
  component: WorkspaceMultiFolderDialogView,
  args: {
    open: true,
    creating: false,
    onOpenChange: fn(),
    onBrowseFolder: fn(async () => '/Users/demo/cradle/apps/web'),
    onCommit: fn(async () => {}),
  },
} satisfies Meta<typeof WorkspaceMultiFolderDialogView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Creating: Story = {
  args: {
    creating: true,
  },
}
