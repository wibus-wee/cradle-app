import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { WorkspaceTextInputDialogView } from './workspace-text-input-dialog-view'

const meta = {
  title: 'App/Workspace/Text Input Dialog',
  component: WorkspaceTextInputDialogView,
  args: {
    open: true,
    title: 'Rename workspace',
    initialValue: 'Cradle',
    label: 'Workspace name',
    confirmLabel: 'Rename',
    onOpenChange: fn(),
    onCommit: fn(async () => {}),
  },
} satisfies Meta<typeof WorkspaceTextInputDialogView>

export default meta
type Story = StoryObj<typeof meta>

export const RenameWorkspace: Story = {}

export const CreateFolder: Story = {
  args: {
    title: 'Create folder',
    initialValue: 'docs',
    label: 'Folder name',
    confirmLabel: 'Create',
  },
}
