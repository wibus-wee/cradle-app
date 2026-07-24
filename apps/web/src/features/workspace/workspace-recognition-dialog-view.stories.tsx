import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { workspaceRecognitionFixtures } from './fixtures/workspace-recognition'
import { WorkspaceRecognitionDialogView } from './workspace-recognition-dialog-view'

const meta = {
  title: 'App/Workspace/Recognition Dialog',
  component: WorkspaceRecognitionDialogView,
  args: {
    recognition: workspaceRecognitionFixtures.valid,
    busy: false,
    onOpenChange: fn(),
    onOpenAsCradleWorkspace: fn(async () => {}),
    onAddAsSingleFolder: fn(async () => {}),
  },
} satisfies Meta<typeof WorkspaceRecognitionDialogView>

export default meta
type Story = StoryObj<typeof meta>

export const Valid: Story = {}

export const Experimental: Story = {
  args: {
    recognition: workspaceRecognitionFixtures.experimental,
  },
}

export const AlreadyImported: Story = {
  args: {
    recognition: workspaceRecognitionFixtures.imported,
  },
}

export const Invalid: Story = {
  args: {
    recognition: workspaceRecognitionFixtures.invalid,
  },
}

export const Busy: Story = {
  args: {
    recognition: workspaceRecognitionFixtures.valid,
    busy: true,
  },
}
